import Parser from "tree-sitter";
// @ts-ignore
import TSLanguage from "tree-sitter-typescript";
import type { LanguageAdapter, ParseResult } from "./types.js";
import { makeResult, text, findAncestor } from "./utils.js";

const { typescript, tsx } = TSLanguage as { typescript: unknown; tsx: unknown };

export const typescriptAdapter: LanguageAdapter = {
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  getLanguage(file: string) {
    return file.endsWith(".tsx") ? tsx : typescript;
  },
  parse(filePath, relPath, src, parser): ParseResult {
    const result = makeResult(relPath);
    let currentFn = "<module>";

    function walk(node: Parser.SyntaxNode) {
      switch (node.type) {
        case "function_declaration":
        case "function": {
          const nameNode = node.childForFieldName("name");
          const fnName = nameNode ? text(nameNode) : "<anonymous>";
          const isExported = node.parent?.type === "export_statement";
          result.functions.push({ name: fnName, file: relPath, line: node.startPosition.row + 1, exported: isExported });
          if (isExported) result.symbols.exported.push(fnName);
          else result.symbols.internal.push(fnName);
          const prev = currentFn; currentFn = fnName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }
        case "arrow_function": {
          const varDecl = node.parent;
          const fnName = varDecl?.type === "variable_declarator"
            ? text(varDecl.childForFieldName("name")!) : "<arrow>";
          const isExported = varDecl?.parent?.parent?.type === "export_statement";
          result.functions.push({ name: fnName, file: relPath, line: node.startPosition.row + 1, exported: isExported });
          if (isExported) result.symbols.exported.push(fnName);
          else result.symbols.internal.push(fnName);
          const prev = currentFn; currentFn = fnName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }
        case "method_definition": {
          const nameNode = node.childForFieldName("name");
          const methodName = nameNode ? text(nameNode) : "<method>";
          const classNode = findAncestor(node, "class_declaration");
          const className = classNode ? text(classNode.childForFieldName("name")!) + "." : "";
          const fullName = className + methodName;
          result.functions.push({ name: fullName, file: relPath, line: node.startPosition.row + 1, exported: false });
          result.symbols.internal.push(fullName);
          const prev = currentFn; currentFn = fullName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }
        case "call_expression": {
          const calleeNode = node.childForFieldName("function");
          if (calleeNode) result.callSites.push({ callee: text(calleeNode), caller: currentFn, file: relPath, line: node.startPosition.row + 1 });
          break;
        }
        case "import_statement": {
          const sourceNode = node.childForFieldName("source");
          if (!sourceNode) break;
          const source = text(sourceNode).replace(/['"]/g, "");
          const symbols: string[] = [];
          const importClause = node.child(1);
          if (importClause?.type === "import_clause") {
            for (const child of importClause.children) {
              if (child.type === "named_imports") {
                for (const spec of child.children) {
                  if (spec.type === "import_specifier") symbols.push(text(spec.childForFieldName("name")!));
                }
              } else if (child.type === "namespace_import") symbols.push("*");
              else if (child.type === "identifier") symbols.push("default");
            }
          }
          result.imports.push({ from: relPath, to: source, symbols });
          break;
        }
        case "export_statement": {
          const clause = node.namedChild(0);
          if (clause?.type === "export_clause") {
            for (const spec of clause.children) {
              if (spec.type === "export_specifier") {
                const name = text(spec.childForFieldName("name")!);
                result.symbols.exported.push(name);
              }
            }
          }
          break;
        }
      }
      for (const child of node.children) walk(child);
    }

    walk(parser.parse(src).rootNode);

    // Deduplicate exported from internal
    const exportedSet = new Set(result.symbols.exported);
    result.symbols.internal = result.symbols.internal.filter(n => !exportedSet.has(n));

    return result;
  }
};
