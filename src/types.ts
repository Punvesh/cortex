export interface FunctionDef {
  name: string;
  file: string;
  line: number;
  exported: boolean;
}

export interface CallSite {
  callee: string;
  caller: string;
  file: string;
  line: number;
}

export interface ImportEdge {
  from: string;
  to: string;       // resolved specifier (may be relative path or module name)
  symbols: string[]; // named imports, or ['*'] for namespace, ['default'] for default
}

export interface FileSymbols {
  file: string;
  exported: string[];
  internal: string[];
}

export interface SCLIndex {
  root: string;
  generatedAt: string;
  functions: FunctionDef[];
  callSites: CallSite[];
  imports: ImportEdge[];
  symbols: FileSymbols[];
}
