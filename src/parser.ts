import { glob } from "glob";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { parseFile as _parseFile, getGlobPattern } from "./parsers/index.js";
import type { SCLIndex } from "./types.js";

export { parseFile } from "./parsers/index.js";

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
}

export async function buildIndex(
  root: string,
  onProgress?: (file: string, i: number, total: number) => void
): Promise<SCLIndex> {
  const pattern = getGlobPattern();
  const files = await glob(pattern, {
    cwd: root,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/*.d.ts", "**/build/**", "**/__pycache__/**"],
  });

  const index: SCLIndex = {
    root,
    generatedAt: new Date().toISOString(),
    fileHashes: {},
    functions: [],
    callSites: [],
    imports: [],
    symbols: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = path.relative(root, file).replace(/\\/g, "/");
    onProgress?.(relPath, i + 1, files.length);
    try {
      const result = _parseFile(file, root);
      if (!result) continue;
      index.functions.push(...result.functions);
      index.callSites.push(...result.callSites);
      index.imports.push(...result.imports);
      index.symbols.push(result.symbols);
      index.fileHashes[relPath] = hashFile(file);
    } catch {
      // skip unparseable files
    }
  }

  return index;
}
