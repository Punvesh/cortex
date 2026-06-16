#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { buildIndex } from "./parser.js";
import { updateFile, removeFile } from "./incremental.js";
import { createApp } from "./api.js";
import { analyzeImpact, findPath, findCycles, findCriticalNodes } from "./graph.js";
import { getChangedSince, isGitRepo, analyzeGitImpact } from "./git.js";
import { summarize } from "./analytics.js";
import type { SCLIndex } from "./types.js";

const program = new Command();

program
  .name("cortex")
  .description("Structural memory layer for coding agents")
  .version("0.3.0");

// ── cortex index ──────────────────────────────────────────────────────────
program
  .command("index [dir]")
  .description("Parse a codebase and write the context index")
  .option("-o, --out <path>", "Output path", "scl-index.json")
  .option("--no-progress", "Suppress progress output")
  .action(async (dir: string | undefined, opts: { out: string; progress: boolean }) => {
    const root = path.resolve(dir ?? ".");
    const spinner = opts.progress ? ora(`Indexing ${chalk.cyan(root)}`).start() : null;
    const index = await buildIndex(root, (file, i, total) => {
      if (spinner) spinner.text = `[${i}/${total}] ${chalk.dim(file)}`;
    });
    fs.writeFileSync(path.resolve(opts.out), JSON.stringify(index));
    spinner?.succeed(chalk.green("Index built"));
    printStats(index, opts.out);
  });

// ── cortex watch ──────────────────────────────────────────────────────────
program
  .command("watch [dir]")
  .description("Watch for file changes and re-index incrementally")
  .option("-o, --out <path>", "Output path", "scl-index.json")
  .action(async (dir: string | undefined, opts: { out: string }) => {
    const root = path.resolve(dir ?? ".");
    const outPath = path.resolve(opts.out);
    const { default: chokidar } = await import("chokidar");

    console.log(chalk.cyan("◆ cortex watch") + chalk.dim(` → ${root}`));

    // Initial full index
    let spinner = ora("Building initial index...").start();
    const index = await buildIndex(root);
    fs.writeFileSync(outPath, JSON.stringify(index));
    spinner.succeed(chalk.green(`Index built`) + chalk.dim(` — ${index.functions.length} functions, ${index.symbols.length} files`));

    const watcher = chokidar.watch(root, {
      ignored: [/node_modules/, /dist/, /\.git/, /scl-index\.json/, /\.d\.ts$/],
      persistent: true, ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();

    const flush = async () => {
      const files = [...pending]; pending.clear();
      const current: SCLIndex = JSON.parse(fs.readFileSync(outPath, "utf8"));
      let changed = 0;
      for (const f of files) {
        if (!fs.existsSync(f)) { removeFile(current, f, root); changed++; }
        else if (updateFile(current, f, root)) changed++;
      }
      if (changed > 0) {
        fs.writeFileSync(outPath, JSON.stringify(current));
        console.log(chalk.green("✔") + chalk.dim(` ${changed} file(s) updated — ${current.functions.length} fns, ${current.symbols.length} files`));
      }
    };

    const trigger = (f: string) => {
      pending.add(f);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flush, 300);
    };

    watcher.on("add", trigger).on("change", trigger).on("unlink", trigger);
    console.log(chalk.dim("  Watching — Ctrl+C to stop\n"));
  });

// ── cortex serve ──────────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start the Cortex REST API server")
  .option("-p, --port <number>", "Port", "7700")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .action((opts: { port: string; index: string }) => {
    const port = parseInt(opts.port);
    const indexPath = path.resolve(opts.index);
    createApp(indexPath).listen(port, () => {
      console.log(chalk.cyan("◆ cortex serve") + chalk.dim(` → http://localhost:${port}`));
    });
  });

// ── cortex dashboard ──────────────────────────────────────────────────────
program
  .command("dashboard")
  .description("Open the Cortex web dashboard")
  .option("-p, --port <number>", "Port", "7701")
  .option("-i, --index <path>", "Index path", "scl-index.json")
  .action(async (opts: { port: string; index: string }) => {
    const port = parseInt(opts.port);
    const { createDashboard } = await import("./dashboard.js");
    createDashboard(path.resolve(opts.index)).listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(chalk.cyan("◆ cortex dashboard") + chalk.dim(` → ${url}`));
      import("child_process").then(({ exec }) => exec(process.platform === "win32" ? `start ${url}` : `open ${url}`));
    });
  });

// ── cortex query ──────────────────────────────────────────────────────────
const query = program.command("query").description("Query the index from the CLI");

query.command("callers <fn>")
  .option("-i, --index <path>", "", "scl-index.json")
  .description("Find all callers of a function")
  .action((fn: string, opts: { index: string }) => {
    const index = load(opts.index);
    const sites = index.callSites.filter(c => c.callee === fn || c.callee.endsWith(`.${fn}`));
    if (!sites.length) { console.log(chalk.dim("No callers found.")); return; }
    console.log(chalk.bold(`\n${sites.length} caller(s) of ${chalk.cyan(fn)}:\n`));
    for (const s of sites) console.log(`  ${chalk.white(s.file)}:${chalk.yellow(String(s.line))}  ← ${chalk.dim(s.caller)}`);
  });

query.command("deps <file>")
  .option("-i, --index <path>", "", "scl-index.json")
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
      for (const i of imports) {
        const alias = i.aliases ? ` as ${Object.values(i.aliases).join(", ")}` : "";
        const reexp = i.reExport ? chalk.dim(" [re-export]") : "";
        console.log(`    ${chalk.white(i.to)}${chalk.dim(i.symbols.length ? ` { ${i.symbols.join(", ")} }` : "")}${alias ? chalk.dim(alias) : ""}${reexp}`);
      }
    }
    if (importedBy.length) {
      console.log(chalk.dim("\n  Imported by:"));
      for (const i of importedBy) console.log(`    ${chalk.white(i.from)}`);
    }
  });

query.command("symbols <file>")
  .option("-i, --index <path>", "", "scl-index.json")
  .action((file: string, opts: { index: string }) => {
    const index = load(opts.index);
    const entry = index.symbols.find(s => s.file === file);
    if (!entry) { console.log(chalk.red(`No symbols for ${file}`)); return; }
    console.log(chalk.bold(`\nSymbols in ${chalk.cyan(file)}:\n`));
    for (const s of entry.exported) console.log(`  ${chalk.green("↑")} ${chalk.white(s)}`);
    for (const s of entry.internal) console.log(`  ${chalk.dim("·")} ${chalk.dim(s)}`);
    if (entry.reExportsFrom?.length) console.log(chalk.dim(`\n  Barrel: re-exports from ${entry.reExportsFrom.join(", ")}`));
  });

query.command("search <term>")
  .option("-i, --index <path>", "", "scl-index.json")
  .action((term: string, opts: { index: string }) => {
    const index = load(opts.index);
    const matches = index.functions.filter(f => f.name.toLowerCase().includes(term.toLowerCase())).slice(0, 20);
    if (!matches.length) { console.log(chalk.dim(`No matches for "${term}".`)); return; }
    console.log(chalk.bold(`\n${matches.length} match(es) for ${chalk.cyan(`"${term}"`)}: \n`));
    for (const m of matches) console.log(`  ${chalk.white(m.name)} ${chalk.dim(`in ${m.file}:${m.line}`)} ${m.exported ? chalk.green("[exported]") : ""} ${m.async ? chalk.blue("[async]") : ""}`);
  });

query.command("impact <symbol>")
  .option("-i, --index <path>", "", "scl-index.json")
  .option("-d, --depth <n>", "Max transitive depth", "5")
  .description("Show refactor impact — what changes if this symbol changes")
  .action((symbol: string, opts: { index: string; depth: string }) => {
    const index = load(opts.index);
    const result = analyzeImpact(index, symbol, parseInt(opts.depth));
    console.log(chalk.bold(`\nImpact of changing ${chalk.cyan(symbol)}:\n`));
    console.log(`  ${chalk.dim("Defined in:")} ${chalk.white(result.definedIn ?? "unknown")}`);
    console.log(`  ${chalk.dim("Direct callers:")} ${chalk.yellow(String(result.directCallers.length))}`);
    for (const c of result.directCallers) console.log(`    ${chalk.white(c.file)}:${c.line}  ← ${chalk.dim(c.caller)}`);
    console.log(`\n  ${chalk.dim("Transitive files affected:")} ${chalk.yellow(String(result.transitiveFiles.length))}`);
    for (const f of result.transitiveFiles.slice(0, 10)) console.log(`    ${chalk.dim("·")} ${f}`);
    if (result.transitiveFiles.length > 10) console.log(chalk.dim(`    … and ${result.transitiveFiles.length - 10} more`));
    console.log(`\n  ${chalk.dim("Affected tests:")} ${chalk.yellow(String(result.affectedTests.length))}`);
    for (const t of result.affectedTests) console.log(`    ${chalk.red("⚠")} ${t}`);
    console.log(`\n  ${chalk.bold("Total impact:")} ${chalk.red(String(result.totalImpact))} files\n`);
  });

query.command("path <from> <to>")
  .option("-i, --index <path>", "", "scl-index.json")
  .description("Find dependency path between two files")
  .action((from: string, to: string, opts: { index: string }) => {
    const index = load(opts.index);
    const result = findPath(index, from, to);
    if (!result.path) { console.log(chalk.dim(`No path found from ${from} to ${to}`)); return; }
    console.log(chalk.bold(`\nDependency path (${result.hops} hops):\n`));
    for (let i = 0; i < result.path.length; i++) {
      console.log(`  ${i > 0 ? chalk.dim("  → ") : "    "}${chalk.white(result.path[i])}`);
    }
  });

query.command("cycles")
  .option("-i, --index <path>", "", "scl-index.json")
  .description("Detect circular dependencies")
  .action((opts: { index: string }) => {
    const index = load(opts.index);
    const cycles = findCycles(index);
    if (!cycles.length) { console.log(chalk.green("✓ No circular dependencies found.")); return; }
    console.log(chalk.red(`\n${cycles.length} circular dependency cycle(s):\n`));
    for (const c of cycles) {
      console.log(`  ${chalk.red("⚠")} ${c.cycle.join(chalk.dim(" → "))}`);
    }
  });

query.command("changed-since <ref>")
  .option("-i, --index <path>", "", "scl-index.json")
  .description("Show structural impact of changes since a git ref")
  .action((ref: string, opts: { index: string }) => {
    const index = load(opts.index);
    if (!isGitRepo(index.root)) { console.log(chalk.red("Not a git repository")); return; }
    const result = analyzeGitImpact(index, index.root, ref);
    console.log(chalk.bold(`\nChanges since ${chalk.cyan(ref)}:\n`));
    console.log(chalk.dim("  Changed files:"));
    for (const f of result.changedFiles) console.log(`    ${chalk.yellow("~")} ${f}`);
    console.log(chalk.dim(`\n  Transitively affected (${result.impactedFiles.length} files):`));
    for (const f of result.impactedFiles.slice(0, 15)) console.log(`    ${chalk.dim("·")} ${f}`);
    if (result.affectedTests.length) {
      console.log(chalk.dim(`\n  At-risk tests (${result.affectedTests.length}):`));
      for (const t of result.affectedTests) console.log(`    ${chalk.red("⚠")} ${t}`);
    }
  });

// ── cortex stats ──────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show cumulative token savings and usage analytics")
  .action(() => {
    const s = summarize();
    console.log(chalk.bold("\n◆ Cortex — Usage Analytics\n"));
    console.log(`  ${chalk.dim("Total queries:")}        ${chalk.white(String(s.totalCalls))}`);
    console.log(`  ${chalk.dim("Tokens avoided:")}       ${chalk.green(s.totalTokensAvoided.toLocaleString())}`);
    console.log(`  ${chalk.dim("Est. savings (USD):")}   ${chalk.green("$" + s.estimatedSavingsUSD)}`);
    console.log(`  ${chalk.dim("Queries/day:")}          ${chalk.white(String(s.callsPerDay))}`);
    if (s.topTools.length) {
      console.log(chalk.dim("\n  Top tools:"));
      for (const t of s.topTools.slice(0, 5)) {
        console.log(`    ${chalk.white(t.tool.padEnd(28))} ${chalk.dim(t.calls + " calls")}  ${chalk.green(t.tokensAvoided.toLocaleString() + " tokens")}`);
      }
    }
    console.log();
  });

// ── cortex init ───────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialize Cortex in the current project")
  .action(() => {
    fs.writeFileSync(".cortexrc.json", JSON.stringify({ version: 1, index: "scl-index.json", include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.py"], exclude: ["node_modules", "dist", "build", "__pycache__"] }, null, 2));
    console.log(chalk.green("✓") + " Created .cortexrc.json");
    if (fs.existsSync(".gitignore")) {
      const gi = fs.readFileSync(".gitignore", "utf8");
      if (!gi.includes("scl-index.json")) { fs.appendFileSync(".gitignore", "\n# Cortex\nscl-index.json\n"); console.log(chalk.green("✓") + " Added scl-index.json to .gitignore"); }
    }
    console.log(chalk.dim("\nNext: ") + chalk.cyan("cortex index") + chalk.dim(" to build your context index"));
  });

// ── helpers ───────────────────────────────────────────────────────────────
function load(indexPath: string): SCLIndex {
  const resolved = path.resolve(indexPath);
  if (!fs.existsSync(resolved)) { console.error(chalk.red(`Index not found: ${resolved}`)); console.error(chalk.dim("Run: cortex index")); process.exit(1); }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as SCLIndex;
}

function printStats(index: SCLIndex, out: string) {
  const rows = [["Files", String(index.symbols.length)], ["Functions", String(index.functions.length)], ["Call sites", String(index.callSites.length)], ["Imports", String(index.imports.length)], ["Output", out]];
  for (const [l, v] of rows) console.log(`  ${chalk.dim(l.padEnd(12))} ${chalk.white(v)}`);
}

program.parse();
