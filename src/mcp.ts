import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import type { SCLIndex } from "./types.js";

const DEFAULT_INDEX = path.resolve("scl-index.json");

function loadIndex(): SCLIndex {
  const indexPath = process.env.SCL_INDEX ?? DEFAULT_INDEX;
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Cortex index not found at ${indexPath}. Run: cortex index`);
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

function resolveImport(from: string, to: string): string {
  if (!to.startsWith(".")) return to;
  return path.join(path.dirname(from), to).replace(/\\/g, "/");
}

const server = new McpServer({ name: "cortex", version: "0.2.0" });

// ── Tool 1: callers ──────────────────────────────────────────────────────
server.tool(
  "cortex_callers",
  "Find all locations in the codebase that call a specific function. Returns caller name, file path, and line number.",
  { fn: z.string().describe("Function name to find call sites for") },
  async ({ fn }) => {
    const index = loadIndex();
    const sites = index.callSites.filter(c => c.callee === fn || c.callee.endsWith(`.${fn}`));
    return { content: [{ type: "text", text: JSON.stringify({ fn, count: sites.length, callers: sites.map(s => ({ caller: s.caller, file: s.file, line: s.line })) }, null, 2) }] };
  }
);

// ── Tool 2: deps ─────────────────────────────────────────────────────────
server.tool(
  "cortex_deps",
  "Get the import dependency graph for a file — what it imports and what files import it.",
  { file: z.string().describe("Relative file path (e.g. src/auth/login.ts)") },
  async ({ file }) => {
    const index = loadIndex();
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const resolved = resolveImport(i.from, i.to);
      return resolved === file || resolved === file.replace(/\.(ts|tsx|js|jsx|py)$/, "");
    });
    return { content: [{ type: "text", text: JSON.stringify({ file, imports: imports.map(i => ({ module: i.to, symbols: i.symbols })), importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })) }, null, 2) }] };
  }
);

// ── Tool 3: symbols ───────────────────────────────────────────────────────
server.tool(
  "cortex_symbols",
  "List exported (public API) and internal symbols declared in a file.",
  { file: z.string().describe("Relative file path (e.g. src/utils/format.ts)") },
  async ({ file }) => {
    const index = loadIndex();
    const entry = index.symbols.find(s => s.file === file);
    if (!entry) return { content: [{ type: "text", text: `No symbols found for ${file}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
  }
);

// ── Tool 4: functions ─────────────────────────────────────────────────────
server.tool(
  "cortex_functions",
  "Find where a function is defined. Filter by name, file, or whether it is exported.",
  {
    name: z.string().optional().describe("Function name to search for"),
    file: z.string().optional().describe("Filter to a specific file"),
    exported: z.boolean().optional().describe("If true, return only exported functions"),
  },
  async ({ name, file, exported }) => {
    const index = loadIndex();
    let fns = index.functions;
    if (name) fns = fns.filter(f => f.name === name || f.name.endsWith(`.${name}`));
    if (file) fns = fns.filter(f => f.file === file);
    if (exported !== undefined) fns = fns.filter(f => f.exported === exported);
    return { content: [{ type: "text", text: JSON.stringify({ count: fns.length, functions: fns }, null, 2) }] };
  }
);

// ── Tool 5: search ────────────────────────────────────────────────────────
server.tool(
  "cortex_search",
  "Search for any symbol (function, import, export) by name across the entire codebase. Supports partial matches.",
  {
    query: z.string().describe("Symbol name or partial name to search for"),
    kind: z.enum(["function", "import", "export", "all"]).optional().default("all").describe("What to search: function definitions, imports, exports, or all"),
  },
  async ({ query, kind }) => {
    const index = loadIndex();
    const q = query.toLowerCase();
    const results: Record<string, unknown[]> = {};

    if (kind === "function" || kind === "all") {
      results.functions = index.functions
        .filter(f => f.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map(f => ({ name: f.name, file: f.file, line: f.line, exported: f.exported }));
    }
    if (kind === "export" || kind === "all") {
      results.exports = index.symbols
        .flatMap(s => s.exported.filter(e => e.toLowerCase().includes(q)).map(e => ({ symbol: e, file: s.file })))
        .slice(0, 20);
    }
    if (kind === "import" || kind === "all") {
      results.imports = index.imports
        .filter(i => i.to.toLowerCase().includes(q) || i.symbols.some(s => s.toLowerCase().includes(q)))
        .slice(0, 20)
        .map(i => ({ from: i.from, module: i.to, symbols: i.symbols }));
    }

    const total = Object.values(results).reduce((s, v) => s + v.length, 0);
    return { content: [{ type: "text", text: JSON.stringify({ query, total, results }, null, 2) }] };
  }
);

// ── Tool 6: context ───────────────────────────────────────────────────────
server.tool(
  "cortex_context",
  "Get complete structural context for a file in one call: its symbols, imports, what imports it, and call sites for all its exported functions. The single best tool when you need to understand a file.",
  { file: z.string().describe("Relative file path") },
  async ({ file }) => {
    const index = loadIndex();
    const symbols = index.symbols.find(s => s.file === file);
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const resolved = resolveImport(i.from, i.to);
      return resolved === file || resolved === file.replace(/\.(ts|tsx|js|jsx|py)$/, "");
    });
    const functions = index.functions.filter(f => f.file === file);
    const exportedFns = functions.filter(f => f.exported).map(f => f.name);
    const callers = index.callSites.filter(c => exportedFns.some(fn => c.callee === fn || c.callee.endsWith(`.${fn}`)));

    return {
      content: [{
        type: "text", text: JSON.stringify({
          file,
          symbols: symbols ?? { exported: [], internal: [] },
          imports: imports.map(i => ({ module: i.to, symbols: i.symbols })),
          importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })),
          functions: functions.map(f => ({ name: f.name, line: f.line, exported: f.exported })),
          callersOfExports: callers.map(c => ({ callee: c.callee, caller: c.caller, file: c.file, line: c.line })),
        }, null, 2)
      }]
    };
  }
);

// ── Tool 7: architecture ──────────────────────────────────────────────────
server.tool(
  "cortex_architecture",
  "Get the high-level module dependency map of the codebase. Shows which files import which, giving an architectural overview without reading any source code.",
  {
    depth: z.number().optional().default(1).describe("How many import hops to follow from each file (1 = direct deps only)"),
    file: z.string().optional().describe("If set, show dependency graph starting from this file"),
  },
  async ({ depth, file }) => {
    const index = loadIndex();

    if (file) {
      // Fan-out from a specific file
      const seen = new Set<string>();
      const graph: Record<string, string[]> = {};

      function expand(f: string, d: number) {
        if (seen.has(f) || d === 0) return;
        seen.add(f);
        const deps = index.imports.filter(i => i.from === f).map(i => i.to);
        graph[f] = deps;
        if (d > 1) deps.forEach(dep => expand(dep, d - 1));
      }
      expand(file, depth);
      return { content: [{ type: "text", text: JSON.stringify({ root: file, depth, graph }, null, 2) }] };
    }

    // Global module map — group by directory
    const dirMap: Record<string, { imports: string[]; importedBy: string[] }> = {};

    for (const imp of index.imports) {
      const fromDir = path.dirname(imp.from);
      const toDir = imp.to.startsWith(".") ? path.dirname(resolveImport(imp.from, imp.to)) : imp.to.split("/")[0];
      if (fromDir === toDir) continue; // skip intra-module

      if (!dirMap[fromDir]) dirMap[fromDir] = { imports: [], importedBy: [] };
      if (!dirMap[fromDir].imports.includes(toDir)) dirMap[fromDir].imports.push(toDir);

      if (!dirMap[toDir]) dirMap[toDir] = { imports: [], importedBy: [] };
      if (!dirMap[toDir].importedBy.includes(fromDir)) dirMap[toDir].importedBy.push(fromDir);
    }

    return {
      content: [{
        type: "text", text: JSON.stringify({
          modules: Object.keys(dirMap).length,
          map: dirMap
        }, null, 2)
      }]
    };
  }
);

// ── Tool 8: health ────────────────────────────────────────────────────────
server.tool(
  "cortex_health",
  "Check Cortex index status — when it was last built, what project it covers, and index size.",
  {},
  async () => {
    try {
      const index = loadIndex();
      return {
        content: [{
          type: "text", text: JSON.stringify({
            ok: true, root: index.root, generatedAt: index.generatedAt,
            stats: { files: index.symbols.length, functions: index.functions.length, callSites: index.callSites.length, imports: index.imports.length },
          }, null, 2)
        }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cortex] MCP server running on stdio — 8 tools available");
}

main().catch(err => { console.error("[cortex] Fatal:", err); process.exit(1); });
