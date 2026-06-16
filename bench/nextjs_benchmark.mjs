/**
 * Real-world benchmark: Cortex vs raw file reading on vercel/next.js
 *
 * 5 tasks a developer or coding agent would actually run on Next.js.
 * For each task:
 *   - Raw approach: identify which files an agent would read, measure their token cost
 *   - Cortex approach: run the actual tool call, measure response token cost
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = "C:/nextjs-bench/scl-index.json";
const SRC_ROOT   = "C:/nextjs-bench/packages/next/src";
const CHARS_PER_TOKEN = 3.5; // conservative for TypeScript code

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

const toTokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);
const fileTokens = (relPath) => {
  const abs = path.join(SRC_ROOT, relPath);
  if (!fs.existsSync(abs)) return 0;
  return toTokens(fs.readFileSync(abs, "utf8").length);
};

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────
const tasks = [

  {
    id: 1,
    name: "Find all callers of createContext",
    agentQuestion: "Where is createContext called in the Next.js source?",
    // Raw: agent reads the file that defines it + likely reads app-render and server files
    rawFiles: [
      "server/app-render/app-render.tsx",
      "server/app-render/work-unit-async-storage.external.ts",
      "server/async-storage/request-async-storage.external.ts",
      "client/components/app-router.tsx",
    ],
    cortexQuery: () => {
      const sites = index.callSites.filter(c =>
        c.callee === "createContext" || c.callee.endsWith(".createContext")
      );
      return JSON.stringify({ fn: "createContext", count: sites.length, callers: sites.slice(0, 10).map(s => ({ caller: s.caller, file: s.file, line: s.line })) }, null, 2);
    },
  },

  {
    id: 2,
    name: "What does app-render.tsx import?",
    agentQuestion: "List every module imported by server/app-render/app-render.tsx",
    // Raw: agent reads the full app-render.tsx file
    rawFiles: [
      "server/app-render/app-render.tsx",
    ],
    cortexQuery: () => {
      const file = "server/app-render/app-render.tsx";
      const imports = index.imports.filter(i => i.from === file);
      return JSON.stringify({ file, count: imports.length, imports: imports.map(i => ({ module: i.to, symbols: i.symbols.slice(0,5) })) }, null, 2);
    },
  },

  {
    id: 3,
    name: "Where is getServerSideProps defined?",
    agentQuestion: "Find the definition of getServerSideProps — which file, which line, is it exported?",
    // Raw: agent would grep or read likely files
    rawFiles: [
      "server/route-modules/pages/module.tsx",
      "server/render.tsx",
      "export-default-map.ts",
      "types.ts",
    ],
    cortexQuery: () => {
      const fns = index.functions.filter(f =>
        f.name === "getServerSideProps" || f.name.includes("getServerSideProps")
      );
      return JSON.stringify({ query: "getServerSideProps", count: fns.length, definitions: fns.map(f => ({ name: f.name, file: f.file, line: f.line, exported: f.exported })) }, null, 2);
    },
  },

  {
    id: 4,
    name: "Refactor impact of renderToHTML",
    agentQuestion: "If I change renderToHTML, what files could be affected?",
    // Raw: agent reads render.tsx + several files that might import it
    rawFiles: [
      "server/render.tsx",
      "server/next-server.ts",
      "server/app-render/app-render.tsx",
      "server/route-modules/pages/module.tsx",
      "server/dev/next-dev-server.ts",
    ],
    cortexQuery: () => {
      const symbol = "renderToHTML";
      const def = index.functions.find(f => f.name === symbol);
      const callers = index.callSites.filter(c => c.callee === symbol || c.callee.endsWith(`.${symbol}`));
      const callerFiles = [...new Set(callers.map(c => c.file))];
      return JSON.stringify({ symbol, definedIn: def?.file ?? null, directCallers: callers.length, callerFiles, }, null, 2);
    },
  },

  {
    id: 5,
    name: "Full context for middleware.ts",
    agentQuestion: "Give me the complete structural picture of server/middleware.ts",
    // Raw: agent reads middleware.ts + its direct imports
    rawFiles: [
      "server/web/edge-route-module-wrapper.ts",
      "server/base-http/index.ts",
      "server/request/request.ts",
      "server/response-cache/index.ts",
    ],
    cortexQuery: () => {
      const file = "server/middleware.ts";
      const symbols = index.symbols.find(s => s.file === file) ?? { exported: [], internal: [] };
      const imports = index.imports.filter(i => i.from === file);
      const importedBy = index.imports.filter(i => {
        const r = i.to.startsWith(".") ? path.join(path.dirname(i.from), i.to).replace(/\\/g, "/") : i.to;
        return r === file || r === file.replace(/\.tsx?$/, "");
      });
      const fns = index.functions.filter(f => f.file === file);
      return JSON.stringify({ file, symbols, imports: imports.map(i => ({ module: i.to, symbols: i.symbols })), importedBy: importedBy.map(i => ({ file: i.from })), functions: fns.map(f => ({ name: f.name, line: f.line, exported: f.exported })) }, null, 2);
    },
  },

];

// ── RUN BENCHMARK ─────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║   Cortex Benchmark — vercel/next.js (228K LOC, 1,913 files)  ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

const results = [];

for (const task of tasks) {
  console.log(`Task ${task.id}: ${task.name}`);
  console.log(`  Q: "${task.agentQuestion}"`);

  // Raw cost
  let rawChars = 0;
  const rawFileList = [];
  for (const f of task.rawFiles) {
    const abs = path.join(SRC_ROOT, f);
    if (fs.existsSync(abs)) {
      const size = fs.readFileSync(abs, "utf8").length;
      rawChars += size;
      rawFileList.push({ file: f, tokens: toTokens(size) });
    }
  }
  const rawTokens = toTokens(rawChars);

  // Cortex cost
  const cortexResponse = task.cortexQuery();
  const cortexTokens = toTokens(cortexResponse.length);

  const saved = rawTokens - cortexTokens;
  const pct = ((saved / rawTokens) * 100).toFixed(1);
  const ratio = (rawTokens / cortexTokens).toFixed(1);

  console.log(`\n  Raw files read:`);
  for (const f of rawFileList) console.log(`    ${f.file.padEnd(55)} ${f.tokens.toLocaleString()} tokens`);
  console.log(`  Raw total: ${rawTokens.toLocaleString()} tokens`);
  console.log(`  Cortex  : ${cortexTokens.toLocaleString()} tokens (${ratio}× fewer, ${pct}% reduction)`);
  console.log(`  Saved   : ${saved.toLocaleString()} tokens\n`);

  results.push({ task: task.name, rawTokens, cortexTokens, saved, pct: parseFloat(pct), ratio: parseFloat(ratio) });
}

// ── SUMMARY ───────────────────────────────────────────────────────────────
const totalRaw    = results.reduce((s, r) => s + r.rawTokens, 0);
const totalCortex = results.reduce((s, r) => s + r.cortexTokens, 0);
const totalSaved  = totalRaw - totalCortex;
const avgRatio    = (totalRaw / totalCortex).toFixed(1);
const avgPct      = ((totalSaved / totalRaw) * 100).toFixed(1);

// Cost at claude-sonnet-4-6 pricing: $3/1M input tokens
const rawCostPer100Sessions    = ((totalRaw    / 1_000_000) * 3 * 100).toFixed(4);
const cortexCostPer100Sessions = ((totalCortex / 1_000_000) * 3 * 100).toFixed(4);

console.log("═".repeat(65));
console.log("  SUMMARY — 5 tasks across vercel/next.js\n");
console.log(`  ${"Task".padEnd(42)} ${"Raw".padStart(8)} ${"Cortex".padStart(8)} ${"Saved".padStart(8)}`);
console.log("  " + "─".repeat(70));
for (const r of results) {
  console.log(`  ${r.task.padEnd(42)} ${r.rawTokens.toLocaleString().padStart(8)} ${r.cortexTokens.toLocaleString().padStart(8)} ${r.pct}%`);
}
console.log("  " + "─".repeat(70));
console.log(`  ${"TOTAL".padEnd(42)} ${totalRaw.toLocaleString().padStart(8)} ${totalCortex.toLocaleString().padStart(8)} ${avgPct}%`);
console.log(`\n  Average reduction : ${avgPct}%  (${avgRatio}× fewer tokens)`);
console.log(`  Tokens saved      : ${totalSaved.toLocaleString()}`);
console.log(`\n  Cost per 100 agent sessions (claude-sonnet-4-6 @ $3/1M tokens):`);
console.log(`    Without Cortex  : $${rawCostPer100Sessions}`);
console.log(`    With Cortex     : $${cortexCostPer100Sessions}`);
console.log(`    Savings         : $${(parseFloat(rawCostPer100Sessions) - parseFloat(cortexCostPer100Sessions)).toFixed(4)}`);
console.log();

// Write machine-readable results
fs.writeFileSync(
  path.join(__dirname, "nextjs_results.json"),
  JSON.stringify({ repo: "vercel/next.js", indexedAt: new Date().toISOString(), indexStats: { files: index.symbols.length, functions: index.functions.length, callSites: index.callSites.length, imports: index.imports.length }, results, summary: { totalRawTokens: totalRaw, totalCortexTokens: totalCortex, totalSaved, avgReductionPct: parseFloat(avgPct), avgRatio: parseFloat(avgRatio) } }, null, 2)
);
console.log("  Results written to bench/nextjs_results.json");
