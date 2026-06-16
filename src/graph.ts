import path from "path";
import type { SCLIndex } from "./types.js";

// Resolve a relative import to a canonical relPath (without extension)
function resolveEdge(from: string, to: string): string {
  if (!to.startsWith(".")) return to;
  return path.join(path.dirname(from), to).replace(/\\/g, "/");
}

// Build adjacency: file → files it imports
export function buildImportGraph(index: SCLIndex): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const sym of index.symbols) {
    if (!graph.has(sym.file)) graph.set(sym.file, new Set());
  }
  for (const imp of index.imports) {
    if (!graph.has(imp.from)) graph.set(imp.from, new Set());
    const resolved = resolveEdge(imp.from, imp.to);
    // Match against known files (strip extension variants)
    const target = findFile(index, resolved) ?? resolved;
    graph.get(imp.from)!.add(target);
  }
  return graph;
}

// Build reverse: file → files that import it
export function buildReverseGraph(index: SCLIndex): Map<string, Set<string>> {
  const fwd = buildImportGraph(index);
  const rev = new Map<string, Set<string>>();
  for (const sym of index.symbols) rev.set(sym.file, new Set());
  for (const [from, targets] of fwd) {
    for (const to of targets) {
      if (!rev.has(to)) rev.set(to, new Set());
      rev.get(to)!.add(from);
    }
  }
  return rev;
}

// Find a file in the index matching a path (with or without extension)
function findFile(index: SCLIndex, resolved: string): string | null {
  const files = index.symbols.map(s => s.file);
  // Exact match
  if (files.includes(resolved)) return resolved;
  // Try common extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.js"]) {
    const candidate = resolved + ext;
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

// ── BFS: shortest dependency path from A to B ────────────────────────────
export interface PathResult {
  from: string;
  to: string;
  path: string[] | null;
  hops: number;
}

export function findPath(index: SCLIndex, from: string, to: string): PathResult {
  const graph = buildImportGraph(index);
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = current[current.length - 1];
    if (node === to || node.startsWith(to.replace(/\.(ts|js|py)$/, ""))) {
      return { from, to, path: current, hops: current.length - 1 };
    }
    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...current, neighbor]);
      }
    }
  }
  return { from, to, path: null, hops: -1 };
}

// ── DFS: detect all circular dependency cycles ───────────────────────────
export interface Cycle {
  cycle: string[];
  length: number;
}

export function findCycles(index: SCLIndex): Cycle[] {
  const graph = buildImportGraph(index);
  const cycles: Cycle[] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const stackArr: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    stack.add(node);
    stackArr.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (stack.has(neighbor)) {
        // Found a cycle
        const idx = stackArr.indexOf(neighbor);
        const cycle = stackArr.slice(idx);
        cycles.push({ cycle: [...cycle, neighbor], length: cycle.length });
      }
    }

    stack.delete(node);
    stackArr.pop();
  }

  for (const file of graph.keys()) {
    if (!visited.has(file)) dfs(file);
  }

  // Deduplicate (same cycle starting from different nodes)
  const seen = new Set<string>();
  return cycles.filter(c => {
    const key = [...c.cycle].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Critical nodes: files with highest in-degree (most imported) ─────────
export interface CriticalNode {
  file: string;
  importedBy: number;
  exports: number;
  score: number;
}

export function findCriticalNodes(index: SCLIndex, topN = 10): CriticalNode[] {
  const rev = buildReverseGraph(index);
  const results: CriticalNode[] = [];

  for (const [file, importedBy] of rev) {
    const sym = index.symbols.find(s => s.file === file);
    const exports = sym?.exported.length ?? 0;
    results.push({ file, importedBy: importedBy.size, exports, score: importedBy.size * 2 + exports });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

// ── Impact analysis: transitive reverse-dependency fan-out ───────────────
export interface ImpactResult {
  symbol: string;
  definedIn: string | null;
  directCallers: Array<{ caller: string; file: string; line: number }>;
  transitiveFiles: string[];
  affectedTests: string[];
  affectedExports: string[];
  depth: number;
  totalImpact: number;
}

export function analyzeImpact(index: SCLIndex, symbol: string, maxDepth = 5): ImpactResult {
  // Find definition
  const def = index.functions.find(f => f.name === symbol || f.name.endsWith(`.${symbol}`));
  const definedIn = def?.file ?? null;

  // Direct callers
  const directCallers = index.callSites
    .filter(c => c.callee === symbol || c.callee.endsWith(`.${symbol}`))
    .map(c => ({ caller: c.caller, file: c.file, line: c.line }));

  // Transitive file fan-out via reverse import graph
  const rev = buildReverseGraph(index);
  const impactedFiles = new Set<string>();
  if (definedIn) impactedFiles.add(definedIn);

  const queue: Array<{ file: string; depth: number }> = [{ file: definedIn ?? "", depth: 0 }];
  let maxReachedDepth = 0;

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth >= maxDepth || !file) continue;
    maxReachedDepth = Math.max(maxReachedDepth, depth);
    for (const importer of rev.get(file) ?? []) {
      if (!impactedFiles.has(importer)) {
        impactedFiles.add(importer);
        queue.push({ file: importer, depth: depth + 1 });
      }
    }
  }

  // Also add files that directly call the symbol
  for (const c of directCallers) impactedFiles.add(c.file);

  const transitiveFiles = [...impactedFiles].filter(f => f !== definedIn);

  // Affected tests: files matching test patterns
  const affectedTests = transitiveFiles.filter(f =>
    f.includes(".test.") || f.includes(".spec.") ||
    f.includes("__tests__") || f.includes("/tests/") || f.includes("/test/")
  );

  // Affected exports: exports from impacted files
  const affectedExports: string[] = [];
  for (const file of impactedFiles) {
    const sym = index.symbols.find(s => s.file === file);
    if (sym) affectedExports.push(...sym.exported.map(e => `${file}:${e}`));
  }

  return {
    symbol,
    definedIn,
    directCallers,
    transitiveFiles,
    affectedTests,
    affectedExports: affectedExports.slice(0, 20),
    depth: maxReachedDepth,
    totalImpact: impactedFiles.size,
  };
}

// ── Dependency clusters: group files by connectivity ─────────────────────
export interface Cluster {
  id: number;
  files: string[];
  size: number;
}

export function findClusters(index: SCLIndex): Cluster[] {
  const graph = buildImportGraph(index);
  const files = [...graph.keys()];
  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  let id = 0;

  function bfs(start: string): string[] {
    const members: string[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      members.push(node);
      for (const n of graph.get(node) ?? []) queue.push(n);
    }
    return members;
  }

  for (const file of files) {
    if (!visited.has(file)) {
      const members = bfs(file);
      clusters.push({ id: id++, files: members, size: members.length });
    }
  }

  return clusters.sort((a, b) => b.size - a.size);
}
