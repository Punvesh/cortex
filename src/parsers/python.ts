import Parser from "tree-sitter";
// @ts-ignore
import PythonLanguage from "tree-sitter-python";
import type { LanguageAdapter, ParseResult } from "./types.js";
import { makeResult, text, findAncestor } from "./utils.js";

export const pythonAdapter: LanguageAdapter = {
  extensions: [".py", ".pyw"],
  getLanguage(_file: string) { return PythonLanguage; },
  parse(_filePath, relPath, src, parser): ParseResult {
    const result = makeResult(relPath);
    let currentFn = "<module>";

    // Collect top-level __all__ exports
    const allExports = new Set<string>();

    function walk(node: Parser.SyntaxNode) {
      switch (node.type) {
        case "function_definition": {
          const nameNode = node.childForFieldName("name");
          const fnName = nameNode ? text(nameNode) : "<anonymous>";
          // In Python, functions starting with _ are private by convention
          const isPublic = !fnName.startsWith("_");
          const isClassMethod = findAncestor(node, "class_definition") !== null;
          const classNode = findAncestor(node, "class_definition");
          const className = classNode ? text(classNode.childForFieldName("name")!) + "." : "";
          const fullName = className + fnName;

          result.functions.push({ name: fullName, file: relPath, line: node.startPosition.row + 1, exported: isPublic && !isClassMethod });
          if (isPublic && !isClassMethod) result.symbols.exported.push(fullName);
          else result.symbols.internal.push(fullName);

          const prev = currentFn; currentFn = fullName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }
        case "call": {
          const fnNode = node.childForFieldName("function");
          if (fnNode) result.callSites.push({ callee: text(fnNode), caller: currentFn, file: relPath, line: node.startPosition.row + 1 });
          break;
        }
        case "import_statement": {
          // import os, sys
          for (const child of node.namedChildren) {
            if (child.type === "dotted_name" || child.type === "aliased_import") {
              const name = child.childForFieldName("name") ?? child;
              result.imports.push({ from: relPath, to: text(name), symbols: [] });
            }
          }
          break;
        }
        case "import_from_statement": {
          // from module import a, b
          const moduleNode = node.childForFieldName("module_name");
          const module = moduleNode ? text(moduleNode) : "<unknown>";
          const symbols: string[] = [];
          for (const child of node.namedChildren) {
            if (child.type === "dotted_name" && child !== moduleNode) symbols.push(text(child));
            if (child.type === "aliased_import") {
              const n = child.childForFieldName("name");
              if (n) symbols.push(text(n));
            }
          }
          result.imports.push({ from: relPath, to: module, symbols });
          break;
        }
        case "expression_statement": {
          // Detect __all__ = [...]
          const assign = node.namedChild(0);
          if (assign?.type === "assignment") {
            const left = assign.childForFieldName("left");
            if (left && text(left) === "__all__") {
              const right = assign.childForFieldName("right");
              if (right?.type === "list") {
                for (const item of right.namedChildren) {
                  const val = text(item).replace(/['"]/g, "");
                  allExports.add(val);
                }
              }
            }
          }
          break;
        }
      }
      for (const child of node.children) walk(child);
    }

    walk(parser.parse(src).rootNode);

    // Apply __all__ overrides
    if (allExports.size > 0) {
      result.symbols.exported = [...allExports];
      result.symbols.internal = result.functions
        .filter(f => !allExports.has(f.name))
        .map(f => f.name);
    }

    return result;
  }
};
