import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parseFile } from "./parsers/index.js";
import type { SCLIndex } from "./types.js";

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
}

/**
 * Update the index for a single changed file.
 * Removes all old entries for that file and replaces them with fresh parse.
 * Returns whether the file was actually changed (false = hash unchanged).
 */
export function updateFile(index: SCLIndex, filePath: string, root: string): boolean {
  const relPath = path.relative(root, filePath).replace(/\\/g, "/");
  const newHash = hashFile(filePath);

  if (index.fileHashes[relPath] === newHash) return false;

  // Remove old entries for this file
  index.functions = index.functions.filter(f => f.file !== relPath);
  index.callSites = index.callSites.filter(c => c.file !== relPath);
  index.imports = index.imports.filter(i => i.from !== relPath);
  index.symbols = index.symbols.filter(s => s.file !== relPath);

  // Parse fresh
  const result = parseFile(filePath, root);
  if (result) {
    index.functions.push(...result.functions);
    index.callSites.push(...result.callSites);
    index.imports.push(...result.imports);
    index.symbols.push(result.symbols);
  }

  index.fileHashes[relPath] = newHash;
  index.generatedAt = new Date().toISOString();
  return true;
}

/**
 * Remove a deleted file from the index.
 */
export function removeFile(index: SCLIndex, filePath: string, root: string): void {
  const relPath = path.relative(root, filePath).replace(/\\/g, "/");
  index.functions = index.functions.filter(f => f.file !== relPath);
  index.callSites = index.callSites.filter(c => c.file !== relPath);
  index.imports = index.imports.filter(i => i.from !== relPath);
  index.symbols = index.symbols.filter(s => s.file !== relPath);
  delete index.fileHashes[relPath];
  index.generatedAt = new Date().toISOString();
}

/**
 * Load an existing index and apply incremental updates.
 * Returns { index, changed: number, unchanged: number }.
 */
export function loadAndUpdate(indexPath: string, root: string, changedFiles: string[]): {
  index: SCLIndex;
  changed: number;
  unchanged: number;
} {
  const index: SCLIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  let changed = 0;
  let unchanged = 0;

  for (const file of changedFiles) {
    if (!fs.existsSync(file)) {
      removeFile(index, file, root);
      changed++;
    } else {
      const didChange = updateFile(index, file, root);
      if (didChange) changed++; else unchanged++;
    }
  }

  return { index, changed, unchanged };
}
