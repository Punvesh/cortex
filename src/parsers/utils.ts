import Parser from "tree-sitter";
import type { ParseResult } from "./types.js";

export function text(node: Parser.SyntaxNode): string {
  return node.text;
}

export function findAncestor(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === type) return cur;
    cur = cur.parent;
  }
  return null;
}

export function makeResult(relPath: string): ParseResult {
  return {
    functions: [],
    callSites: [],
    imports: [],
    symbols: { file: relPath, exported: [], internal: [] },
  };
}
