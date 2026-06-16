import Parser from "tree-sitter";
import type { FunctionDef, CallSite, ImportEdge, FileSymbols } from "../types.js";

export interface ParseResult {
  functions: FunctionDef[];
  callSites: CallSite[];
  imports: ImportEdge[];
  symbols: FileSymbols;
}

export interface LanguageAdapter {
  extensions: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLanguage(file: string): any;
  parse(filePath: string, relPath: string, src: string, parser: Parser): ParseResult;
}
