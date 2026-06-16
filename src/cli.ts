#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildIndex } from "./parser.js";
import { createApp } from "./api.js";
import type { SCLIndex } from "./types.js";

const program = new Command();

program
  .name("scl")
  .description("Structured Context Layer — codebase context for coding agents")
  .version("0.1.0");

// scl index [dir] [--out <path>]
program
  .command("index [dir]")
  .description("Parse a codebase and write scl-index.json")
  .option("-o, --out <path>", "Output path for index file", "scl-index.json")
  .option("--pretty", "Pretty-print the JSON output")
  .action(async (dir: string | undefined, opts: { out: string; pretty: boolean }) => {
    const root = path.resolve(dir ?? ".");
    console.log(`[scl] Indexing ${root} ...`);
    const start = Date.now();
    const index = await buildIndex(root);
    const json = opts.pretty
      ? JSON.stringify(index, null, 2)
      : JSON.stringify(index);
    fs.writeFileSync(opts.out, json, "utf8");
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[scl] Done in ${elapsed}s`);
    console.log(`      Files   : ${index.symbols.length}`);
    console.log(`      Functions: ${index.functions.length}`);
    console.log(`      CallSites: ${index.callSites.length}`);
    console.log(`      Imports  : ${index.imports.length}`);
    console.log(`      Written  : ${opts.out}`);
  });

// scl serve [--port <n>] [--index <path>]
program
  .command("serve")
  .description("Start the SCL query API server")
  .option("-p, --port <number>", "Port to listen on", "7700")
  .option("-i, --index <path>", "Path to scl-index.json", "scl-index.json")
  .action((opts: { port: string; index: string }) => {
    const port = parseInt(opts.port);
    const indexPath = path.resolve(opts.index);
    const app = createApp(indexPath);
    app.listen(port, () => {
      console.log(`[scl] API listening on http://localhost:${port}`);
      console.log(`[scl] Index: ${indexPath}`);
      console.log(`      GET /callers?fn=<name>`);
      console.log(`      GET /deps?file=<path>`);
      console.log(`      GET /symbols?file=<path>`);
      console.log(`      GET /functions?name=<name>&file=<path>`);
      console.log(`      GET /health`);
    });
  });

// scl query callers <fn> [--index <path>]
// scl query deps <file> [--index <path>]
// scl query symbols <file> [--index <path>]
const query = program.command("query").description("Query the SCL index directly");

query
  .command("callers <fn>")
  .description("Find all callers of a function")
  .option("-i, --index <path>", "Path to scl-index.json", "scl-index.json")
  .action((fn: string, opts: { index: string }) => {
    const index = loadIndexOrExit(opts.index);
    const sites = index.callSites.filter(
      (c) => c.callee === fn || c.callee.endsWith(`.${fn}`)
    );
    console.log(JSON.stringify({ fn, count: sites.length, callers: sites.map((s) => ({ caller: s.caller, file: s.file, line: s.line })) }, null, 2));
  });

query
  .command("deps <file>")
  .description("Show import dependencies for a file")
  .option("-i, --index <path>", "Path to scl-index.json", "scl-index.json")
  .action((file: string, opts: { index: string }) => {
    const index = loadIndexOrExit(opts.index);
    const imports = index.imports.filter((i) => i.from === file);
    const importedBy = index.imports.filter((i) => {
      const resolved = i.to.startsWith(".")
        ? path.join(path.dirname(i.from), i.to).replace(/\\/g, "/")
        : i.to;
      return resolved === file || resolved === file.replace(/\.(ts|tsx)$/, "");
    });
    console.log(JSON.stringify({ file, imports: imports.map((i) => ({ module: i.to, symbols: i.symbols })), importedBy: importedBy.map((i) => ({ file: i.from, symbols: i.symbols })) }, null, 2));
  });

query
  .command("symbols <file>")
  .description("List exported and internal symbols in a file")
  .option("-i, --index <path>", "Path to scl-index.json", "scl-index.json")
  .action((file: string, opts: { index: string }) => {
    const index = loadIndexOrExit(opts.index);
    const entry = index.symbols.find((s) => s.file === file);
    if (!entry) { console.error(`No symbols found for ${file}`); process.exit(1); }
    console.log(JSON.stringify(entry, null, 2));
  });

query
  .command("functions")
  .description("Find function definitions")
  .option("-n, --name <name>", "Filter by function name")
  .option("-f, --file <file>", "Filter by file path")
  .option("-i, --index <path>", "Path to scl-index.json", "scl-index.json")
  .action((opts: { name?: string; file?: string; index: string }) => {
    const index = loadIndexOrExit(opts.index);
    let fns = index.functions;
    if (opts.name) fns = fns.filter((f) => f.name === opts.name);
    if (opts.file) fns = fns.filter((f) => f.file === opts.file);
    console.log(JSON.stringify({ count: fns.length, functions: fns }, null, 2));
  });

// scl init — write a starter .scl config
program
  .command("init")
  .description("Initialize SCL in the current project")
  .action(() => {
    const config = {
      version: 1,
      index: "scl-index.json",
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["node_modules", "dist", "*.d.ts"],
    };
    fs.writeFileSync(".sclrc.json", JSON.stringify(config, null, 2), "utf8");
    console.log("[scl] Created .sclrc.json");
    console.log("[scl] Next: run `scl index` to build your context index");

    // Add to .gitignore if present
    if (fs.existsSync(".gitignore")) {
      const gi = fs.readFileSync(".gitignore", "utf8");
      if (!gi.includes("scl-index.json")) {
        fs.appendFileSync(".gitignore", "\n# SCL index\nscl-index.json\n");
        console.log("[scl] Added scl-index.json to .gitignore");
      }
    }
  });

function loadIndexOrExit(indexPath: string): SCLIndex {
  const resolved = path.resolve(indexPath);
  if (!fs.existsSync(resolved)) {
    console.error(`[scl] Index not found: ${resolved}`);
    console.error(`      Run: scl index`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as SCLIndex;
}

program.parse();
