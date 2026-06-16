import { glob } from "glob";
import path from "path";
import { parseFile, getGlobPattern } from "./parsers/index.js";
import type { SCLIndex } from "./types.js";

export { parseFile } from "./parsers/index.js";

export async function buildIndex(root: string, onProgress?: (file: string, i: number, total: number) => void): Promise<SCLIndex> {
  const pattern = getGlobPattern();
  const files = await glob(pattern, {
    cwd: root,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/*.d.ts", "**/build/**", "**/__pycache__/**"],
  });

  const index: SCLIndex = {
    root,
    generatedAt: new Date().toISOString(),
    functions: [],
    callSites: [],
    imports: [],
    symbols: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(path.relative(root, file), i + 1, files.length);
    try {
      const result = parseFile(file, root);
      if (!result) continue;
      index.functions.push(...result.functions);
      index.callSites.push(...result.callSites);
      index.imports.push(...result.imports);
      index.symbols.push(result.symbols);
    } catch (err) {
      // Skip unparseable files silently
    }
  }

  return index;
}
