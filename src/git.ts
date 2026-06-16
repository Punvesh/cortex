import { execSync } from "child_process";
import path from "path";
import type { SCLIndex } from "./types.js";
import { analyzeImpact } from "./graph.js";

function git(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

export function isGitRepo(dir: string): boolean {
  return git(dir, "rev-parse --git-dir") !== "";
}

export function getCurrentBranch(root: string): string {
  return git(root, "rev-parse --abbrev-ref HEAD") || "unknown";
}

export function getChangedFiles(root: string, ref = "HEAD"): string[] {
  const raw = git(root, `diff --name-only ${ref}`);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map(f => f.trim());
}

export function getChangedSince(root: string, ref: string): string[] {
  const raw = git(root, `diff --name-only ${ref}...HEAD`);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean);
}

export function getStagedFiles(root: string): string[] {
  const raw = git(root, "diff --cached --name-only");
  return raw ? raw.split("\n").filter(Boolean) : [];
}

export interface GitImpactResult {
  ref: string;
  changedFiles: string[];
  impactedFiles: string[];
  affectedTests: string[];
  symbols: string[];
}

export function analyzeGitImpact(index: SCLIndex, root: string, ref: string): GitImpactResult {
  const changedFiles = getChangedSince(root, ref);
  const relChanged = changedFiles.map(f => path.relative(root, path.resolve(root, f)).replace(/\\/g, "/"));

  // Find all symbols defined in changed files
  const symbols = index.functions
    .filter(fn => relChanged.includes(fn.file))
    .map(fn => fn.name);

  // Run impact on each symbol and collect transitive files
  const impactedSet = new Set<string>(relChanged);
  const testSet = new Set<string>();

  for (const sym of symbols.slice(0, 20)) { // cap at 20 symbols
    const impact = analyzeImpact(index, sym);
    for (const f of impact.transitiveFiles) impactedSet.add(f);
    for (const t of impact.affectedTests) testSet.add(t);
  }

  return {
    ref,
    changedFiles: relChanged,
    impactedFiles: [...impactedSet].filter(f => !relChanged.includes(f)),
    affectedTests: [...testSet],
    symbols,
  };
}
