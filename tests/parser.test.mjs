import { strict as assert } from "assert";
import { test } from "node:test";
import path from "path";
import { fileURLToPath } from "url";
import { parseFile } from "../dist/parsers/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const root = fixtures;

test("TypeScript: extracts exported functions", () => {
  const result = parseFile(path.join(fixtures, "sample.ts"), root);
  assert(result !== null, "should parse TypeScript file");
  const exportedNames = result.symbols.exported;
  assert(exportedNames.includes("greet"), "greet should be exported");
  assert(exportedNames.includes("formatDate"), "formatDate should be exported");
});

test("TypeScript: marks internal functions", () => {
  const result = parseFile(path.join(fixtures, "sample.ts"), root);
  assert(result !== null);
  assert(result.symbols.internal.includes("internal"), "internal() should be internal");
});

test("TypeScript: extracts imports", () => {
  const result = parseFile(path.join(fixtures, "sample.ts"), root);
  assert(result !== null);
  const mods = result.imports.map(i => i.to);
  assert(mods.includes("fs/promises"), "should detect fs/promises import");
  assert(mods.includes("path"), "should detect path import");
});

test("TypeScript: extracts call sites", () => {
  const result = parseFile(path.join(fixtures, "sample.ts"), root);
  assert(result !== null);
  const callees = result.callSites.map(c => c.callee);
  assert(callees.includes("greet"), "should detect greet() call");
  assert(callees.includes("formatDate"), "should detect formatDate() call");
});

test("TypeScript: extracts class methods", () => {
  const result = parseFile(path.join(fixtures, "sample.ts"), root);
  assert(result !== null);
  const fnNames = result.functions.map(f => f.name);
  assert(fnNames.some(n => n.includes("getUser")), "should detect UserService.getUser");
});

test("Python: extracts public functions as exported", () => {
  const result = parseFile(path.join(fixtures, "sample.py"), root);
  assert(result !== null, "should parse Python file");
  assert(result.symbols.exported.includes("greet"), "greet should be exported");
});

test("Python: marks private functions as internal", () => {
  const result = parseFile(path.join(fixtures, "sample.py"), root);
  assert(result !== null);
  const allNames = [...result.symbols.exported, ...result.symbols.internal];
  assert(allNames.some(n => n.includes("_internal_helper")), "_internal_helper should exist");
  assert(!result.symbols.exported.includes("_internal_helper"), "_internal_helper should not be exported");
});

test("Python: extracts imports", () => {
  const result = parseFile(path.join(fixtures, "sample.py"), root);
  assert(result !== null);
  const mods = result.imports.map(i => i.to);
  assert(mods.includes("os"), "should detect os import");
});

test("Python: extracts call sites", () => {
  const result = parseFile(path.join(fixtures, "sample.py"), root);
  assert(result !== null);
  const callees = result.callSites.map(c => c.callee);
  assert(callees.includes("greet"), "should detect greet() call in get_user");
});

console.log("\n✓ All parser tests passed\n");
