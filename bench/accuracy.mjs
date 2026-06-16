/**
 * Accuracy benchmark suite.
 * Parses known fixtures and verifies expected structural facts.
 * Reports accuracy % per category.
 */

import path from "path";
import { fileURLToPath } from "url";
import { parseFile } from "../dist/parsers/index.js";
import { buildIndex } from "../dist/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "../tests/fixtures/accuracy");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? "  ← " + detail : ""}`);
  }
}

// ── Barrel file accuracy ──────────────────────────────────────────────────
console.log("\n[Barrel files]");
{
  const barrelDir = path.join(fixtures, "barrel");
  const index = await buildIndex(barrelDir);
  const barrel = index.imports.filter(i => i.from === "index.ts");
  const barrelSymbols = index.symbols.find(s => s.file === "index.ts");

  check("barrel: detects re-export of authenticate",
    barrel.some(i => i.symbols.includes("authenticate") && i.reExport));
  check("barrel: detects re-export of fetchUser",
    barrel.some(i => i.symbols.includes("fetchUser") && i.reExport));
  check("barrel: detects export * from utils",
    barrel.some(i => i.reExportAll));
  check("barrel: reExportsFrom populated",
    (barrelSymbols?.reExportsFrom?.length ?? 0) > 0);
}

// ── Aliased import accuracy ───────────────────────────────────────────────
console.log("\n[Aliased imports]");
{
  const aliasDir = path.join(fixtures, "aliases");
  const result = parseFile(path.join(aliasDir, "consumer.ts"), aliasDir);

  check("alias: detects processPayment import",
    result?.imports.some(i => i.symbols.includes("processPayment")) ?? false);
  check("alias: captures alias (processPayment → pay)",
    result?.imports.some(i => i.aliases?.["processPayment"] === "pay") ?? false);
  check("alias: detects namespace import Stripe",
    result?.imports.some(i => i.symbols.includes("*") && i.aliases?.["*"] === "Stripe") ?? false);
  check("alias: checkout is exported",
    result?.symbols.exported.includes("checkout") ?? false);
}

// ── Re-export chain accuracy ──────────────────────────────────────────────
console.log("\n[Re-export chains]");
{
  const reexportDir = path.join(fixtures, "reexports");
  const result = parseFile(path.join(reexportDir, "chain.ts"), reexportDir);

  check("reexport: detects validate re-export",
    result?.imports.some(i => i.symbols.includes("validate") && i.reExport) ?? false);
  check("reexport: detects transform as convert",
    result?.imports.some(i => i.symbols.includes("transform") && i.aliases?.["transform"] === "convert") ?? false);
  check("reexport: convert appears in exported symbols",
    result?.symbols.exported.includes("convert") ?? false);
}

// ── Dynamic import accuracy ───────────────────────────────────────────────
console.log("\n[Dynamic imports]");
{
  const dynDir = path.join(fixtures, "dynamic");
  const result = parseFile(path.join(dynDir, "loader.ts"), dynDir);

  check("dynamic: loadPlugin is exported",
    result?.symbols.exported.includes("loadPlugin") ?? false);
  check("dynamic: loadConfig is exported",
    result?.symbols.exported.includes("loadConfig") ?? false);
  check("dynamic: detects dynamic import call",
    result?.callSites.some(c => c.callee === "import" || c.dynamic) ?? false);
}

// ── General symbol accuracy (existing fixtures) ───────────────────────────
console.log("\n[General TypeScript accuracy]");
{
  const sampleDir = path.join(__dirname, "../tests/fixtures");
  const result = parseFile(path.join(sampleDir, "sample.ts"), sampleDir);

  check("ts: greet is exported", result?.symbols.exported.includes("greet") ?? false);
  check("ts: formatDate is exported", result?.symbols.exported.includes("formatDate") ?? false);
  check("ts: internal() is internal", result?.symbols.internal.includes("internal") ?? false);
  check("ts: call sites captured", (result?.callSites.length ?? 0) > 0);
  check("ts: imports captured", (result?.imports.length ?? 0) > 0);
}

// ── Python accuracy ───────────────────────────────────────────────────────
console.log("\n[Python accuracy]");
{
  const sampleDir = path.join(__dirname, "../tests/fixtures");
  const result = parseFile(path.join(sampleDir, "sample.py"), sampleDir);

  check("py: greet is exported", result?.symbols.exported.includes("greet") ?? false);
  check("py: _internal_helper is not exported", !result?.symbols.exported.includes("_internal_helper") ?? false);
  check("py: class method extracted", result?.functions.some(f => f.name.includes("get_user")) ?? false);
  check("py: os import captured", result?.imports.some(i => i.to === "os") ?? false);
}

// ── Summary ───────────────────────────────────────────────────────────────
const total = passed + failed;
const pct = ((passed / total) * 100).toFixed(1);
console.log(`\n${"─".repeat(50)}`);
console.log(`  Accuracy: ${passed}/${total} checks passed (${pct}%)`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  for (const f of failures) console.log(`    ✗ ${f.label}`);
}

console.log();
process.exit(failed > 0 ? 1 : 0);
