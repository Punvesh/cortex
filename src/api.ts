import express from "express";
import fs from "fs";
import path from "path";
import type { SCLIndex } from "./types.js";

const DEFAULT_INDEX = path.resolve("scl-index.json");

function loadIndex(indexPath: string): SCLIndex {
  if (!fs.existsSync(indexPath)) throw new Error(`Index not found at ${indexPath}. Run: cortex index`);
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

function resolveImport(from: string, to: string): string {
  if (!to.startsWith(".")) return to;
  return path.join(path.dirname(from), to).replace(/\\/g, "/");
}

export function createApp(indexPath = DEFAULT_INDEX) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });

  app.get("/callers", (req, res) => {
    const fn = req.query.fn as string;
    if (!fn) return res.status(400).json({ error: "fn required" });
    const index = loadIndex(indexPath);
    const sites = index.callSites.filter(c => c.callee === fn || c.callee.endsWith(`.${fn}`));
    return res.json({ fn, count: sites.length, callers: sites.map(s => ({ caller: s.caller, file: s.file, line: s.line })) });
  });

  app.get("/deps", (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: "file required" });
    const index = loadIndex(indexPath);
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const r = resolveImport(i.from, i.to);
      return r === file || r === file.replace(/\.(ts|tsx|js|jsx|py)$/, "");
    });
    return res.json({ file, imports: imports.map(i => ({ module: i.to, symbols: i.symbols })), importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })) });
  });

  app.get("/symbols", (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: "file required" });
    const index = loadIndex(indexPath);
    const entry = index.symbols.find(s => s.file === file);
    if (!entry) return res.status(404).json({ error: `No symbols for ${file}` });
    return res.json(entry);
  });

  app.get("/functions", (req, res) => {
    const { name, file, exported } = req.query as Record<string, string>;
    const index = loadIndex(indexPath);
    let fns = index.functions;
    if (name) fns = fns.filter(f => f.name === name || f.name.endsWith(`.${name}`));
    if (file) fns = fns.filter(f => f.file === file);
    if (exported !== undefined) fns = fns.filter(f => f.exported === (exported === "true"));
    return res.json({ count: fns.length, functions: fns });
  });

  app.get("/search", (req, res) => {
    const q = (req.query.q as string)?.toLowerCase();
    if (!q) return res.status(400).json({ error: "q required" });
    const kind = (req.query.kind as string) ?? "all";
    const index = loadIndex(indexPath);
    const results: Record<string, unknown[]> = {};
    if (kind === "function" || kind === "all")
      results.functions = index.functions.filter(f => f.name.toLowerCase().includes(q)).slice(0, 30);
    if (kind === "export" || kind === "all")
      results.exports = index.symbols.flatMap(s => s.exported.filter(e => e.toLowerCase().includes(q)).map(e => ({ symbol: e, file: s.file }))).slice(0, 30);
    if (kind === "import" || kind === "all")
      results.imports = index.imports.filter(i => i.to.toLowerCase().includes(q)).slice(0, 30);
    return res.json({ q, results });
  });

  app.get("/context", (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: "file required" });
    const index = loadIndex(indexPath);
    const symbols = index.symbols.find(s => s.file === file);
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const r = resolveImport(i.from, i.to);
      return r === file || r === file.replace(/\.(ts|tsx|js|jsx|py)$/, "");
    });
    const functions = index.functions.filter(f => f.file === file);
    const exportedFns = functions.filter(f => f.exported).map(f => f.name);
    const callers = index.callSites.filter(c => exportedFns.some(fn => c.callee === fn || c.callee.endsWith(`.${fn}`)));
    return res.json({ file, symbols, imports: imports.map(i => ({ module: i.to, symbols: i.symbols })), importedBy: importedBy.map(i => ({ file: i.from, symbols: i.symbols })), functions, callersOfExports: callers });
  });

  app.get("/architecture", (req, res) => {
    const index = loadIndex(indexPath);
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
    return res.json({ modules: Object.keys(dirMap).length, map: dirMap });
  });

  app.get("/health", (_req, res) => {
    try {
      const index = loadIndex(indexPath);
      return res.json({ ok: true, root: index.root, generatedAt: index.generatedAt, stats: { files: index.symbols.length, functions: index.functions.length, callSites: index.callSites.length, imports: index.imports.length } });
    } catch (err) {
      return res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  return app;
}

if (process.argv[1]?.match(/api\.[jt]s$/)) {
  const port = parseInt(process.env.SCL_PORT ?? process.argv[2] ?? "7700");
  const indexPath = process.env.SCL_INDEX ?? process.argv[3] ?? DEFAULT_INDEX;
  createApp(indexPath).listen(port, () => console.log(`[cortex] API → http://localhost:${port}`));
}
