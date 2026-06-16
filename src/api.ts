import express from "express";
import fs from "fs";
import path from "path";
import type { SCLIndex } from "./types.js";

const DEFAULT_INDEX = path.resolve("scl-index.json");

function loadIndex(indexPath: string): SCLIndex {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Index not found at ${indexPath}. Run: scl index`);
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

export function createApp(indexPath = DEFAULT_INDEX) {
  const app = express();
  app.use(express.json());

  // GET /callers?fn=<name>
  // Returns all call sites where <name> is the callee
  app.get("/callers", (req, res) => {
    const fn = req.query.fn as string;
    if (!fn) return res.status(400).json({ error: "fn query param required" });

    const index = loadIndex(indexPath);
    const sites = index.callSites.filter((c) => {
      // match exact name or member-access tail (e.g. "obj.fn" matches fn="fn")
      return c.callee === fn || c.callee.endsWith(`.${fn}`);
    });

    return res.json({
      fn,
      count: sites.length,
      callers: sites.map((s) => ({
        caller: s.caller,
        file: s.file,
        line: s.line,
      })),
    });
  });

  // GET /deps?file=<relpath>
  // Returns what this file imports and what imports it
  app.get("/deps", (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: "file query param required" });

    const index = loadIndex(indexPath);
    const imports = index.imports.filter((i) => i.from === file);
    const importedBy = index.imports.filter((i) => {
      // match if the import resolves to this file (handle relative paths)
      const resolved = i.to.startsWith(".")
        ? path.join(path.dirname(i.from), i.to).replace(/\\/g, "/")
        : i.to;
      return resolved === file || resolved === file.replace(/\.(ts|tsx)$/, "");
    });

    return res.json({
      file,
      imports: imports.map((i) => ({ module: i.to, symbols: i.symbols })),
      importedBy: importedBy.map((i) => ({ file: i.from, symbols: i.symbols })),
    });
  });

  // GET /symbols?file=<relpath>
  // Returns exported vs internal symbols for a file
  app.get("/symbols", (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: "file query param required" });

    const index = loadIndex(indexPath);
    const entry = index.symbols.find((s) => s.file === file);
    if (!entry) return res.status(404).json({ error: `No symbols found for ${file}` });

    return res.json(entry);
  });

  // GET /functions?name=<name>  — optional convenience endpoint
  app.get("/functions", (req, res) => {
    const name = req.query.name as string | undefined;
    const file = req.query.file as string | undefined;
    const index = loadIndex(indexPath);

    let fns = index.functions;
    if (name) fns = fns.filter((f) => f.name === name);
    if (file) fns = fns.filter((f) => f.file === file);

    return res.json({ count: fns.length, functions: fns });
  });

  // GET /health
  app.get("/health", (_req, res) => {
    try {
      const index = loadIndex(indexPath);
      return res.json({
        ok: true,
        root: index.root,
        generatedAt: index.generatedAt,
        stats: {
          files: index.symbols.length,
          functions: index.functions.length,
          callSites: index.callSites.length,
          imports: index.imports.length,
        },
      });
    } catch (err) {
      return res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  return app;
}

// When run directly: node dist/api.js [port] [indexPath]
if (process.argv[1]?.endsWith("api.js") || process.argv[1]?.endsWith("api.ts")) {
  const port = parseInt(process.env.SCL_PORT ?? process.argv[2] ?? "7700");
  const indexPath = process.env.SCL_INDEX ?? process.argv[3] ?? DEFAULT_INDEX;
  const app = createApp(indexPath);
  app.listen(port, () => {
    console.log(`[scl] API listening on http://localhost:${port}`);
    console.log(`[scl] Index: ${indexPath}`);
  });
}
