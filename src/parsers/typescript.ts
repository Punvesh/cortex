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
  parse(_filePath, relPath, src, parser): ParseResult {
    const result = makeResult(relPath);
    const tree = parser.parse(src);
    let currentFn = "<module>";
    const currentDecorators: string[] = [];
    const exportedSet = new Set<string>();

    function walk(node: Parser.SyntaxNode) {
      switch (node.type) {

        // ── Decorators ──────────────────────────────────────────────────
        case "decorator": {
          currentDecorators.push(text(node));
          for (const child of node.children) walk(child);
          return;
        }

        // ── Function declarations ────────────────────────────────────────
        case "function_declaration":
        case "function": {
          const nameNode = node.childForFieldName("name");
          const fnName = nameNode ? text(nameNode) : "<anonymous>";
          const isExported = isExportedNode(node);
          const isAsync = node.children.some(c => c.type === "async");
          const isGen = node.children.some(c => c.type === "*");
          result.functions.push({
            name: fnName, file: relPath, line: node.startPosition.row + 1,
            exported: isExported, async: isAsync, generator: isGen,
            decorator: [...currentDecorators],
          });
          currentDecorators.length = 0;
          if (isExported) exportedSet.add(fnName);
          else result.symbols.internal.push(fnName);
          const prev = currentFn; currentFn = fnName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }

        // ── Arrow functions ──────────────────────────────────────────────
        case "arrow_function": {
          const varDecl = node.parent;
          let fnName = "<arrow>";
          if (varDecl?.type === "variable_declarator") {
            const n = varDecl.childForFieldName("name");
            if (n) fnName = text(n);
          }
          const isExported =
            varDecl?.parent?.parent?.type === "export_statement" ||
            varDecl?.parent?.parent?.parent?.type === "export_statement";
          const isAsync = node.children.some(c => c.type === "async");
          result.functions.push({ name: fnName, file: relPath, line: node.startPosition.row + 1, exported: isExported, async: isAsync });
          if (isExported) exportedSet.add(fnName);
          else result.symbols.internal.push(fnName);
          const prev = currentFn; currentFn = fnName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }

        // ── Method definitions ───────────────────────────────────────────
        case "method_definition": {
          const nameNode = node.childForFieldName("name");
          const methodName = nameNode ? text(nameNode) : "<method>";
          const classNode = findAncestor(node, "class_declaration") ?? findAncestor(node, "class");
          const className = classNode ? (text(classNode.childForFieldName("name") ?? classNode) + ".") : "";
          const fullName = className + methodName;
          const isAsync = node.children.some(c => c.type === "async");
          result.functions.push({ name: fullName, file: relPath, line: node.startPosition.row + 1, exported: false, async: isAsync, decorator: [...currentDecorators] });
          currentDecorators.length = 0;
          result.symbols.internal.push(fullName);
          const prev = currentFn; currentFn = fullName;
          for (const child of node.children) walk(child);
          currentFn = prev; return;
        }

        // ── Call expressions (including dynamic import) ──────────────────
        case "call_expression": {
          const calleeNode = node.childForFieldName("function");
          if (calleeNode) {
            const calleeName = text(calleeNode);
            const isDynamic = calleeName === "import";
            result.callSites.push({ callee: calleeName, caller: currentFn, file: relPath, line: node.startPosition.row + 1, dynamic: isDynamic || undefined });
          }
          break;
        }

        // ── Import declarations ──────────────────────────────────────────
        case "import_statement": {
          const sourceNode = node.childForFieldName("source");
          if (!sourceNode) break;
          const source = text(sourceNode).replace(/['"]/g, "");
          const symbols: string[] = [];
          const aliases: Record<string, string> = {};

          const importClause = node.child(1);
          if (importClause?.type === "import_clause") {
            for (const child of importClause.children) {
              if (child.type === "named_imports") {
                for (const spec of child.children) {
                  if (spec.type === "import_specifier") {
                    const orig = text(spec.childForFieldName("name")!);
                    const alias = spec.childForFieldName("alias");
                    symbols.push(orig);
                    if (alias) aliases[orig] = text(alias);
                  }
                }
              } else if (child.type === "namespace_import") {
                const alias = child.namedChild(0);
                symbols.push("*");
                if (alias) aliases["*"] = text(alias);
              } else if (child.type === "identifier") {
                symbols.push("default");
                aliases["default"] = text(child);
              }
            }
          }
          result.imports.push({ from: relPath, to: source, symbols, aliases: Object.keys(aliases).length ? aliases : undefined });
          break;
        }

        // ── Export statements ────────────────────────────────────────────
        case "export_statement": {
          // export * from './y'
          const sourceNode = node.childForFieldName("source");
          if (sourceNode) {
            const source = text(sourceNode).replace(/['"]/g, "");
            const clause = node.namedChild(0);
            if (!clause || clause === sourceNode) {
              // export * from './y'
              result.imports.push({ from: relPath, to: source, symbols: ["*"], reExport: true, reExportAll: true });
              if (!result.symbols.reExportsFrom) result.symbols.reExportsFrom = [];
              result.symbols.reExportsFrom.push(source);
            } else if (clause.type === "export_clause") {
              // export { x, y as z } from './y'
              const syms: string[] = [];
              const aliases: Record<string, string> = {};
              for (const spec of clause.children) {
                if (spec.type === "export_specifier") {
                  const name = text(spec.childForFieldName("name")!);
                  const alias = spec.childForFieldName("alias");
                  syms.push(name);
                  if (alias) { aliases[name] = text(alias); exportedSet.add(text(alias)); }
                  else exportedSet.add(name);
                }
              }
              result.imports.push({ from: relPath, to: source, symbols: syms, aliases: Object.keys(aliases).length ? aliases : undefined, reExport: true });
            }
            break;
          }

          // export { a, b }
          const clause = node.namedChild(0);
          if (clause?.type === "export_clause") {
            for (const spec of clause.children) {
              if (spec.type === "export_specifier") {
                const alias = spec.childForFieldName("alias");
                const name = alias ? text(alias) : text(spec.childForFieldName("name")!);
                exportedSet.add(name);
              }
            }
          }
          break;
        }
      }
      for (const child of node.children) walk(child);
    }

    walk(tree.rootNode);

    result.symbols.exported = [...exportedSet];
    result.symbols.internal = result.symbols.internal.filter(n => !exportedSet.has(n));
    return result;
  }
};

function isExportedNode(node: Parser.SyntaxNode): boolean {
  return node.parent?.type === "export_statement" ||
    node.parent?.parent?.type === "export_statement";
}
