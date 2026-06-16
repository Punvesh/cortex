import Parser from "tree-sitter";
// @ts-ignore — no bundled types for tree-sitter-typescript
import TSLanguage from "tree-sitter-typescript";
import fs from "fs";
import path from "path";
import { glob } from "glob";
import type { FunctionDef, CallSite, ImportEdge, FileSymbols, SCLIndex } from "./types.js";

const parser = new Parser();
// tree-sitter-typescript exports { typescript, tsx }
const { typescript, tsx } = TSLanguage as { typescript: unknown; tsx: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLanguage(file: string): any {
  return file.endsWith(".tsx") ? tsx : typescript;
}

// Extract the text of a node
function text(node: Parser.SyntaxNode): string {
  return node.text;
}

function parseFile(filePath: string, root: string): {
  functions: FunctionDef[];
  callSites: CallSite[];
  imports: ImportEdge[];
  symbols: FileSymbols;
} {
  const src = fs.readFileSync(filePath, "utf8");
  const relPath = path.relative(root, filePath).replace(/\\/g, "/");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser.setLanguage(getLanguage(filePath) as any);
  const tree = parser.parse(src);

  const functions: FunctionDef[] = [];
  const callSites: CallSite[] = [];
  const imports: ImportEdge[] = [];
  const exportedNames = new Set<string>();
  const internalNames = new Set<string>();

  // Track current enclosing function for call site attribution
  let currentFn = "<module>";

  function walk(node: Parser.SyntaxNode) {
    switch (node.type) {
      case "function_declaration":
      case "function": {
        const nameNode = node.childForFieldName("name");
        const fnName = nameNode ? text(nameNode) : "<anonymous>";
        const isExported = node.parent?.type === "export_statement";
        functions.push({
          name: fnName,
          file: relPath,
          line: node.startPosition.row + 1,
          exported: isExported,
        });
        if (isExported) exportedNames.add(fnName);
        else internalNames.add(fnName);

        const prev = currentFn;
        currentFn = fnName;
        for (const child of node.children) walk(child);
        currentFn = prev;
        return;
      }

      case "arrow_function": {
        // Arrow assigned to a variable: const foo = () => {}
        const varDecl = node.parent;
        const fnName =
          varDecl?.type === "variable_declarator"
            ? text(varDecl.childForFieldName("name")!)
            : "<arrow>";
        const isExported =
          varDecl?.parent?.parent?.type === "export_statement";
        functions.push({
          name: fnName,
          file: relPath,
          line: node.startPosition.row + 1,
          exported: isExported,
        });
        if (isExported) exportedNames.add(fnName);
        else internalNames.add(fnName);

        const prev = currentFn;
        currentFn = fnName;
        for (const child of node.children) walk(child);
        currentFn = prev;
        return;
      }

      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        const methodName = nameNode ? text(nameNode) : "<method>";
        const classNode = findAncestor(node, "class_declaration");
        const className = classNode
          ? text(classNode.childForFieldName("name")!) + "."
          : "";
        const fullName = className + methodName;
        functions.push({
          name: fullName,
          file: relPath,
          line: node.startPosition.row + 1,
          exported: false, // methods exported via class
        });
        internalNames.add(fullName);

        const prev = currentFn;
        currentFn = fullName;
        for (const child of node.children) walk(child);
        currentFn = prev;
        return;
      }

      case "call_expression": {
        const calleeNode = node.childForFieldName("function");
        if (calleeNode) {
          const callee = text(calleeNode);
          callSites.push({
            callee,
            caller: currentFn,
            file: relPath,
            line: node.startPosition.row + 1,
          });
        }
        break;
      }

      case "import_statement": {
        const sourceNode = node.childForFieldName("source");
        if (!sourceNode) break;
        const source = text(sourceNode).replace(/['"]/g, "");
        const symbols: string[] = [];

        // named imports: import { a, b } from '...'
        const importClause = node.child(1);
        if (importClause) {
          if (importClause.type === "import_clause") {
            for (const child of importClause.children) {
              if (child.type === "named_imports") {
                for (const spec of child.children) {
                  if (spec.type === "import_specifier") {
                    symbols.push(text(spec.childForFieldName("name")!));
                  }
                }
              } else if (child.type === "namespace_import") {
                symbols.push("*");
              } else if (child.type === "identifier") {
                symbols.push("default");
              }
            }
          }
        }
        imports.push({ from: relPath, to: source, symbols });
        break;
      }

      case "export_statement": {
        // export { a, b } or export const / export function handled in fn cases
        const clause = node.namedChild(0);
        if (clause?.type === "export_clause") {
          for (const spec of clause.children) {
            if (spec.type === "export_specifier") {
              const name = text(spec.childForFieldName("name")!);
              exportedNames.add(name);
            }
          }
        }
        break;
      }
    }

    for (const child of node.children) walk(child);
  }

  walk(tree.rootNode);

  // Remove from internal if also exported
  for (const name of exportedNames) internalNames.delete(name);

  return {
    functions,
    callSites,
    imports,
    symbols: {
      file: relPath,
      exported: [...exportedNames],
      internal: [...internalNames],
    },
  };
}

function findAncestor(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === type) return cur;
    cur = cur.parent;
  }
  return null;
}

export async function buildIndex(root: string): Promise<SCLIndex> {
  const files = await glob("**/*.{ts,tsx}", {
    cwd: root,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
  });

  const index: SCLIndex = {
    root,
    generatedAt: new Date().toISOString(),
    functions: [],
    callSites: [],
    imports: [],
    symbols: [],
  };

  for (const file of files) {
    try {
      const result = parseFile(file, root);
      index.functions.push(...result.functions);
      index.callSites.push(...result.callSites);
      index.imports.push(...result.imports);
      index.symbols.push(result.symbols);
    } catch (err) {
      console.warn(`[scl] skipping ${file}: ${(err as Error).message}`);
    }
  }

  return index;
}
