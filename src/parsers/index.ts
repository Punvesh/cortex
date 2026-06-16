import Parser from "tree-sitter";
import path from "path";
import fs from "fs";
import type { LanguageAdapter, ParseResult } from "./types.js";
import { typescriptAdapter } from "./typescript.js";
import { javascriptAdapter } from "./javascript.js";
import { pythonAdapter } from "./python.js";

export type { LanguageAdapter, ParseResult };

const adapters: LanguageAdapter[] = [
  typescriptAdapter,
  javascriptAdapter,
  pythonAdapter,
];

const extensionMap = new Map<string, LanguageAdapter>();
for (const adapter of adapters) {
  for (const ext of adapter.extensions) extensionMap.set(ext, adapter);
}

export function getSupportedExtensions(): string[] {
  return [...extensionMap.keys()];
}

export function getGlobPattern(): string {
  const exts = getSupportedExtensions().map(e => e.slice(1)).join(",");
  return `**/*.{${exts}}`;
}

const parserInstances = new Map<string, Parser>();

function getParser(adapter: LanguageAdapter, file: string): Parser {
  const key = file; // TSX needs different grammar than TS
  if (!parserInstances.has(key)) {
    const p = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.setLanguage(adapter.getLanguage(file) as any);
    parserInstances.set(key, p);
    return p;
  }
  return parserInstances.get(key)!;
}

export function parseFile(filePath: string, root: string): ParseResult | null {
  const ext = path.extname(filePath).toLowerCase();
  const adapter = extensionMap.get(ext);
  if (!adapter) return null;

  const src = fs.readFileSync(filePath, "utf8");
  const relPath = path.relative(root, filePath).replace(/\\/g, "/");
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser.setLanguage(adapter.getLanguage(filePath) as any);
  return adapter.parse(filePath, relPath, src, parser);
}
