import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import type { SCLIndex } from "./types.js";
import { analyzeImpact, findPath, findCycles, findCriticalNodes, buildImportGraph } from "./graph.js";
import { analyzeGitImpact, isGitRepo } from "./git.js";
import { recordCall, summarize } from "./analytics.js";

const DEFAULT_INDEX = path.resolve("scl-index.json");

function loadIndex(): SCLIndex {
  const indexPath = process.env.SCL_INDEX ?? DEFAULT_INDEX;
  if (!fs.existsSync(indexPath)) throw new Error(`Cortex index not found at ${indexPath}. Run: cortex index`);
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

function resolveImport(from: string, to: string): string {
  if (!to.startsWith(".")) return to;
  return path.join(path.dirname(from), to).replace(/\\/g, "/");
}

function j(obj: unknown): string { return JSON.stringify(obj, null, 2); }

// Wrap handler with timing + analytics
function track<T>(tool: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  return fn().finally(() => recordCall(tool, Date.now() - start));
}

const server = new McpServer({ name: "cortex", version: "0.3.0" });

// ── 1. cortex_callers ────────────────────────────────────────────────────
server.tool("cortex_callers",
  "Find every location in the codebase that calls a specific function. Returns caller name, file, and line number. Handles method calls (obj.method).",
  { fn: z.string().describe("Function name to find callers of") },
  ({ fn }) => track("cortex_callers", async () => {
    const index = loadIndex();
    const sites = index.callSites.filter(c => c.callee === fn || c.callee.endsWith(`.${fn}`));
    return { content: [{ type: "text" as const, text: j({ fn, count: sites.length, callers: sites.map(s => ({ caller: s.caller, file: s.file, line: s.line, dynamic: s.dynamic })) }) }] };
  })
);

// ── 2. cortex_deps ───────────────────────────────────────────────────────
server.tool("cortex_deps",
  "Get the import dependency graph for a file — what it imports and what files import it. Includes aliased imports and re-exports.",
  { file: z.string().describe("Relative file path (e.g. src/auth/login.ts)") },
  ({ file }) => track("cortex_deps", async () => {
    const index = loadIndex();
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const r = resolveImport(i.from, i.to);
      return r === file || r === file.replace(/\.(ts|tsx|js|jsx|py)$/, "");
    });
    return { content: [{ type: "text" as const, text: j({ file, imports: imports.map(i => ({ module: i.to, symbols: i.symbols, aliases: i.aliases, reExport: i.reExport })), importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })) }) }] };
  })
);

// ── 3. cortex_symbols ────────────────────────────────────────────────────
server.tool("cortex_symbols",
  "List exported (public API) and internal symbols in a file. Includes re-export information for barrel files.",
  { file: z.string().describe("Relative file path") },
  ({ file }) => track("cortex_symbols", async () => {
    const index = loadIndex();
    const entry = index.symbols.find(s => s.file === file);
    if (!entry) return { content: [{ type: "text" as const, text: `No symbols for ${file}` }], isError: true };
    return { content: [{ type: "text" as const, text: j(entry) }] };
  })
);

// ── 4. cortex_functions ──────────────────────────────────────────────────
server.tool("cortex_functions",
  "Find where a function is defined. Filter by name, file, or export status. Returns file, line, async flag, and decorators.",
  { name: z.string().optional(), file: z.string().optional(), exported: z.boolean().optional() },
  ({ name, file, exported }) => track("cortex_functions", async () => {
    const index = loadIndex();
    let fns = index.functions;
    if (name) fns = fns.filter(f => f.name === name || f.name.endsWith(`.${name}`));
    if (file) fns = fns.filter(f => f.file === file);
    if (exported !== undefined) fns = fns.filter(f => f.exported === exported);
    return { content: [{ type: "text" as const, text: j({ count: fns.length, functions: fns }) }] };
  })
);

// ── 5. cortex_search ─────────────────────────────────────────────────────
server.tool("cortex_search",
  "Search for any symbol, function, import, or export across the entire codebase. Supports partial name matches.",
  { query: z.string(), kind: z.enum(["function", "import", "export", "all"]).optional().default("all") },
  ({ query, kind }) => track("cortex_search", async () => {
    const index = loadIndex();
    const q = query.toLowerCase();
    const results: Record<string, unknown[]> = {};
    if (kind === "function" || kind === "all")
      results.functions = index.functions.filter(f => f.name.toLowerCase().includes(q)).slice(0, 20);
    if (kind === "export" || kind === "all")
      results.exports = index.symbols.flatMap(s => s.exported.filter(e => e.toLowerCase().includes(q)).map(e => ({ symbol: e, file: s.file }))).slice(0, 20);
    if (kind === "import" || kind === "all")
      results.imports = index.imports.filter(i => i.to.toLowerCase().includes(q) || i.symbols.some(s => s.toLowerCase().includes(q))).slice(0, 20);
    return { content: [{ type: "text" as const, text: j({ query, total: Object.values(results).reduce((s, v) => s + v.length, 0), results }) }] };
  })
);

// ── 6. cortex_context ────────────────────────────────────────────────────
server.tool("cortex_context",
  "Get complete structural context for a file in one call: symbols, imports, importers, functions, callers of exported functions. Use this first when exploring an unfamiliar file.",
  { file: z.string() },
  ({ file }) => track("cortex_context", async () => {
    const index = loadIndex();
    const symbols = index.symbols.find(s => s.file === file);
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => { const r = resolveImport(i.from, i.to); return r === file || r === file.replace(/\.(ts|tsx|js|jsx|py)$/, ""); });
    const functions = index.functions.filter(f => f.file === file);
    const exportedFns = functions.filter(f => f.exported).map(f => f.name);
    const callers = index.callSites.filter(c => exportedFns.some(fn => c.callee === fn || c.callee.endsWith(`.${fn}`)));
    return { content: [{ type: "text" as const, text: j({ file, symbols: symbols ?? { exported: [], internal: [] }, imports: imports.map(i => ({ module: i.to, symbols: i.symbols, reExport: i.reExport })), importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })), functions: functions.map(f => ({ name: f.name, line: f.line, exported: f.exported, async: f.async })), callersOfExports: callers.map(c => ({ callee: c.callee, caller: c.caller, file: c.file, line: c.line })) }) }] };
  })
);

// ── 7. cortex_impact ─────────────────────────────────────────────────────
server.tool("cortex_impact",
  "Refactor impact analysis: given a function name, returns all direct callers, transitively affected files, affected test files, and affected exports. Answers: 'If I change this, what could break?'",
  { symbol: z.string().describe("Function or symbol name to analyse"), depth: z.number().optional().default(5).describe("Max transitive depth (default 5)") },
  ({ symbol, depth }) => track("cortex_impact", async () => {
    const index = loadIndex();
    const result = analyzeImpact(index, symbol, depth);
    return { content: [{ type: "text" as const, text: j(result) }] };
  })
);

// ── 8. cortex_path ───────────────────────────────────────────────────────
server.tool("cortex_path",
  "Find the shortest dependency path between two files or modules. Shows how 'from' reaches 'to' through the import graph.",
  { from: z.string().describe("Starting file (relative path)"), to: z.string().describe("Target file (relative path)") },
  ({ from, to }) => track("cortex_path", async () => {
    const index = loadIndex();
    return { content: [{ type: "text" as const, text: j(findPath(index, from, to)) }] };
  })
);

// ── 9. cortex_cycles ─────────────────────────────────────────────────────
server.tool("cortex_cycles",
  "Detect circular dependencies in the codebase. Returns all import cycles with their file paths.",
  {},
  () => track("cortex_cycles", async () => {
    const index = loadIndex();
    const cycles = findCycles(index);
    return { content: [{ type: "text" as const, text: j({ count: cycles.length, cycles }) }] };
  })
);

// ── 10. cortex_repo_map ──────────────────────────────────────────────────
server.tool("cortex_repo_map",
  "Generate a structured map of the repository: how files are grouped into modules, what each module exports, and how modules depend on each other. Essential for onboarding to an unfamiliar codebase.",
  {},
  () => track("cortex_repo_map", async () => {
    const index = loadIndex();
    const graph = buildImportGraph(index);
    const critical = findCriticalNodes(index, 5);

    // Group files by top-level directory
    const modules: Record<string, { files: string[]; exports: string[]; imports: string[] }> = {};
    for (const sym of index.symbols) {
      const dir = sym.file.split("/")[0] ?? ".";
      if (!modules[dir]) modules[dir] = { files: [], exports: [], imports: [] };
      modules[dir].files.push(sym.file);
      modules[dir].exports.push(...sym.exported.map(e => `${sym.file.split("/").pop()}:${e}`));
    }
    // Cross-module imports
    for (const imp of index.imports) {
      const fromDir = imp.from.split("/")[0];
      const toDir = imp.to.startsWith(".") ? resolveImport(imp.from, imp.to).split("/")[0] : imp.to.split("/")[0];
      if (fromDir !== toDir && modules[fromDir] && !modules[fromDir].imports.includes(toDir)) {
        modules[fromDir].imports.push(toDir);
      }
    }

    return { content: [{ type: "text" as const, text: j({ modules, criticalFiles: critical, totalFiles: index.symbols.length }) }] };
  })
);

// ── 11. cortex_git_impact ────────────────────────────────────────────────
server.tool("cortex_git_impact",
  "Show the structural impact of changes since a git ref (branch, commit, or tag). Returns changed files, transitively affected files, and at-risk tests.",
  { ref: z.string().describe("Git ref to compare against (e.g. main, HEAD~3, v1.0.0)") },
  ({ ref }) => track("cortex_git_impact", async () => {
    const index = loadIndex();
    const root = index.root;
    if (!isGitRepo(root)) return { content: [{ type: "text" as const, text: "Not a git repository" }], isError: true };
    return { content: [{ type: "text" as const, text: j(analyzeGitImpact(index, root, ref)) }] };
  })
);

// ── 12. cortex_architecture ──────────────────────────────────────────────
server.tool("cortex_architecture",
  "Get the high-level module dependency map. Shows which directories import which, with critical node highlighting.",
  { file: z.string().optional(), depth: z.number().optional().default(1) },
  ({ file, depth }) => track("cortex_architecture", async () => {
    const index = loadIndex();
    if (file) {
      const seen = new Set<string>();
      const graphOut: Record<string, string[]> = {};
      function expand(f: string, d: number) {
        if (seen.has(f) || d === 0) return;
        seen.add(f);
        const deps = index.imports.filter(i => i.from === f).map(i => i.to);
        graphOut[f] = deps;
        if (d > 1) deps.forEach(dep => expand(dep, d - 1));
      }
      expand(file, depth);
      return { content: [{ type: "text" as const, text: j({ root: file, depth, graph: graphOut }) }] };
    }
    const dirMap: Record<string, { imports: string[]; importedBy: string[] }> = {};
    for (const imp of index.imports) {
      const fromDir = path.dirname(imp.from);
      const toDir = imp.to.startsWith(".") ? path.dirname(resolveImport(imp.from, imp.to)) : imp.to.split("/")[0];
      if (fromDir === toDir) continue;
      if (!dirMap[fromDir]) dirMap[fromDir] = { imports: [], importedBy: [] };
      if (!dirMap[fromDir].imports.includes(toDir)) dirMap[fromDir].imports.push(toDir);
      if (!dirMap[toDir]) dirMap[toDir] = { imports: [], importedBy: [] };
      if (!dirMap[toDir].importedBy.includes(fromDir)) dirMap[toDir].importedBy.push(fromDir);
    }
    return { content: [{ type: "text" as const, text: j({ modules: Object.keys(dirMap).length, map: dirMap }) }] };
  })
);

// ── 13. cortex_health ────────────────────────────────────────────────────
server.tool("cortex_health",
  "Check index status and cumulative usage analytics: tokens avoided, queries served, estimated cost savings.",
  {},
  () => track("cortex_health", async () => {
    try {
      const index = loadIndex();
      const analytics = summarize();
      return { content: [{ type: "text" as const, text: j({ ok: true, root: index.root, generatedAt: index.generatedAt, stats: { files: index.symbols.length, functions: index.functions.length, callSites: index.callSites.length, imports: index.imports.length }, analytics }) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
    }
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cortex] MCP server running — 13 tools available");
}

main().catch(err => { console.error("[cortex] Fatal:", err); process.exit(1); });
