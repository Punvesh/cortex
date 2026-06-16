#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { buildIndex } from "./parser.js";
import { createApp } from "./api.js";
import type { SCLIndex } from "./types.js";

const program = new Command();

const logo = `
  ${chalk.bold.cyan("◆ cortex")} ${chalk.dim("v0.2.0")}
  ${chalk.dim("Structural context layer for coding agents")}
`;

program
  .name("cortex")
  .description("Structural context layer for coding agents")
  .version("0.2.0")
  .hook("preAction", () => { if (process.stdout.isTTY) console.log(logo); });

// ── cortex index ──────────────────────────────────────────────────────────
program
  .command("index [dir]")
  .description("Parse a codebase and write the context index")
  .option("-o, --out <path>", "Output path", "scl-index.json")
  .option("--no-progress", "Suppress progress output")
  .action(async (dir: string | undefined, opts: { out: string; progress: boolean }) => {
    const root = path.resolve(dir ?? ".");
    const spinner = opts.progress ? ora(`Indexing ${chalk.cyan(root)} ...`).start() : null;

    let lastFile = "";
    const index = await buildIndex(root, (file, i, total) => {
      lastFile = file;
      if (spinner) spinner.text = `[${i}/${total}] ${chalk.dim(file)}`;
    });

    const outPath = path.resolve(opts.out);
    fs.writeFileSync(outPath, JSON.stringify(index), "utf8");
    spinner?.succeed(chalk.green("Index built"));

    const table = [
      ["Files",      String(index.symbols.length)],
      ["Functions",  String(index.functions.length)],
      ["Call sites", String(index.callSites.length)],
      ["Imports",    String(index.imports.length)],
      ["Output",     outPath],
    ];
    for (const [label, value] of table) {
      console.log(`  ${chalk.dim(label.padEnd(12))} ${chalk.white(value)}`);
    }
  });

// ── cortex watch ──────────────────────────────────────────────────────────
program
  .command("watch [dir]")
  .description("Watch for file changes and re-index automatically")
  .option("-o, --out <path>", "Output path", "scl-index.json")
  .action(async (dir: string | undefined, opts: { out: string }) => {
    const root = path.resolve(dir ?? ".");
    const { default: chokidar } = await import("chokidar");

    console.log(chalk.cyan("◆ cortex watch") + chalk.dim(` — watching ${root}`));

    async function reindex() {
      const spinner = ora("Re-indexing...").start();
      try {
        const index = await buildIndex(root);
        fs.writeFileSync(path.resolve(opts.out), JSON.stringify(index));
        spinner.succeed(
          chalk.green("Index updated") +
          chalk.dim(` — ${index.functions.length} functions, ${index.symbols.length} files`)
        );
      } catch (err) {
        spinner.fail(chalk.red("Index failed: " + (err as Error).message));
      }
    }

    // Initial index
    await reindex();

    const watcher = chokidar.watch(root, {
      ignored: [/node_modules/, /dist/, /\.git/, /scl-index\.json/, /\.d\.ts$/],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(reindex, 500);
    };

    watcher.on("add", trigger).on("change", trigger).on("unlink", trigger);
    console.log(chalk.dim("  Press Ctrl+C to stop\n"));
  });

// ── cortex serve ──────────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start the Cortex REST API server")
  .option("-p, --port <number>", "Port", "7700")
  .option("-i, --index <path>", "Index file path", "scl-index.json")
  .action((opts: { port: string; index: string }) => {
    const port = parseInt(opts.port);
    const indexPath = path.resolve(opts.index);
    const app = createApp(indexPath);
    app.listen(port, () => {
      console.log(chalk.cyan("◆ cortex serve") + chalk.dim(` → http://localhost:${port}`));
      const routes = ["/callers?fn=<name>", "/deps?file=<path>", "/symbols?file=<path>", "/search?q=<query>", "/context?file=<path>", "/architecture", "/health"];
      for (const r of routes) console.log(chalk.dim("  GET " + r));
    });
  });

// ── cortex dashboard ──────────────────────────────────────────────────────
program
  .command("dashboard")
  .description("Open the Cortex web dashboard")
  .option("-p, --port <number>", "Port", "7701")
  .option("-i, --index <path>", "Index file path", "scl-index.json")
  .action(async (opts: { port: string; index: string }) => {
    const port = parseInt(opts.port);
    const indexPath = path.resolve(opts.index);
    const { createDashboard } = await import("./dashboard.js");
    const app = createDashboard(indexPath);
    app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(chalk.cyan("◆ cortex dashboard") + chalk.dim(` → ${url}`));
      // Try to open browser
      import("child_process").then(({ exec }) => {
        const cmd = process.platform === "win32" ? `start ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
        exec(cmd);
      });
    });
  });

// ── cortex query ──────────────────────────────────────────────────────────
const query = program.command("query").description("Query the index from the CLI");

query.command("callers <fn>")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .description("Find all callers of a function")
  .action((fn: string, opts: { index: string }) => {
    const index = load(opts.index);
    const sites = index.callSites.filter(c => c.callee === fn || c.callee.endsWith(`.${fn}`));
    if (sites.length === 0) { console.log(chalk.dim("No callers found.")); return; }
    console.log(chalk.bold(`\n${sites.length} caller(s) of ${chalk.cyan(fn)}:\n`));
    for (const s of sites) console.log(`  ${chalk.white(s.file)}:${chalk.yellow(String(s.line))}  ← ${chalk.dim(s.caller)}`);
  });

query.command("deps <file>")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .description("Show import dependencies for a file")
  .action((file: string, opts: { index: string }) => {
    const index = load(opts.index);
    const imports = index.imports.filter(i => i.from === file);
    const importedBy = index.imports.filter(i => {
      const r = i.to.startsWith(".") ? path.join(path.dirname(i.from), i.to).replace(/\\/g, "/") : i.to;
      return r === file || r === file.replace(/\.(ts|tsx|js|py)$/, "");
    });
    console.log(chalk.bold(`\nDependencies of ${chalk.cyan(file)}:\n`));
    if (imports.length) {
      console.log(chalk.dim("  Imports:"));
      for (const i of imports) console.log(`    ${chalk.white(i.to)} ${chalk.dim(i.symbols.length ? `{ ${i.symbols.join(", ")} }` : "")}`);
    }
    if (importedBy.length) {
      console.log(chalk.dim("\n  Imported by:"));
      for (const i of importedBy) console.log(`    ${chalk.white(i.from)}`);
    }
    if (!imports.length && !importedBy.length) console.log(chalk.dim("  No dependencies found."));
  });

query.command("symbols <file>")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .description("List exported and internal symbols")
  .action((file: string, opts: { index: string }) => {
    const index = load(opts.index);
    const entry = index.symbols.find(s => s.file === file);
    if (!entry) { console.log(chalk.red(`No symbols for ${file}`)); return; }
    console.log(chalk.bold(`\nSymbols in ${chalk.cyan(file)}:\n`));
    if (entry.exported.length) {
      console.log(chalk.dim("  Exported:"));
      for (const s of entry.exported) console.log(`    ${chalk.green("↑")} ${chalk.white(s)}`);
    }
    if (entry.internal.length) {
      console.log(chalk.dim("  Internal:"));
      for (const s of entry.internal) console.log(`    ${chalk.dim("·")} ${chalk.dim(s)}`);
    }
  });

query.command("search <term>")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .description("Search for any symbol across the codebase")
  .action((term: string, opts: { index: string }) => {
    const index = load(opts.index);
    const q = term.toLowerCase();
    const matches = index.functions.filter(f => f.name.toLowerCase().includes(q)).slice(0, 20);
    if (!matches.length) { console.log(chalk.dim(`No matches for "${term}".`)); return; }
    console.log(chalk.bold(`\n${matches.length} match(es) for ${chalk.cyan(`"${term}"`)}: \n`));
    for (const m of matches) {
      console.log(`  ${chalk.white(m.name)} ${chalk.dim(`in ${m.file}:${m.line}`)} ${m.exported ? chalk.green("[exported]") : ""}`);
    }
  });

// ── cortex init ───────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialize Cortex in the current project")
  .action(() => {
    const config = { version: 1, index: "scl-index.json", include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.py"], exclude: ["node_modules", "dist", "build", "__pycache__"] };
    fs.writeFileSync(".cortexrc.json", JSON.stringify(config, null, 2));
    console.log(chalk.green("✓") + " Created .cortexrc.json");

    if (fs.existsSync(".gitignore")) {
      const gi = fs.readFileSync(".gitignore", "utf8");
      if (!gi.includes("scl-index.json")) {
        fs.appendFileSync(".gitignore", "\n# Cortex\nscl-index.json\n");
        console.log(chalk.green("✓") + " Added scl-index.json to .gitignore");
      }
    }

    console.log(chalk.dim("\nNext: run ") + chalk.cyan("cortex index") + chalk.dim(" to build your context index."));
    console.log(chalk.dim("Then: run ") + chalk.cyan("cortex serve") + chalk.dim(" or connect via MCP."));
  });

// ── helpers ───────────────────────────────────────────────────────────────
function load(indexPath: string): SCLIndex {
  const resolved = path.resolve(indexPath);
  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Index not found: ${resolved}`));
    console.error(chalk.dim("Run: cortex index"));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as SCLIndex;
}

program.parse();
