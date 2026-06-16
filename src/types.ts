export interface FunctionDef {
  name: string;
  file: string;
  line: number;
  exported: boolean;
  async?: boolean;
  generator?: boolean;
  decorator?: string[];
}

export interface CallSite {
  callee: string;
  caller: string;
  file: string;
  line: number;
  dynamic?: boolean; // dynamic import()
}

export interface ImportEdge {
  from: string;
  to: string;
  symbols: string[];
  aliases?: Record<string, string>; // { original: alias }
  dynamic?: boolean;
  reExport?: boolean; // export { x } from './y'
  reExportAll?: boolean; // export * from './y'
}

export interface FileSymbols {
  file: string;
  exported: string[];
  internal: string[];
  reExportsFrom?: string[]; // barrel: re-exports from these files
}

export interface SCLIndex {
  root: string;
  generatedAt: string;
  fileHashes: Record<string, string>; // relPath → md5-ish hash for incremental
  functions: FunctionDef[];
  callSites: CallSite[];
  imports: ImportEdge[];
  symbols: FileSymbols[];
}

// ── Analytics ────────────────────────────────────────────────────────────

export interface ToolCall {
  tool: string;
  timestamp: string;
  durationMs: number;
  tokensAvoided?: number;
}

export interface AnalyticsStore {
  calls: ToolCall[];
  totalTokensAvoided: number;
  totalCalls: number;
}
