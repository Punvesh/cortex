<div align="center">

# ◆ Cortex

**Structural memory for AI coding agents.**

[![npm](https://img.shields.io/npm/v/cortex-code.svg)](https://www.npmjs.com/package/cortex-code)
[![Accuracy](https://img.shields.io/badge/accuracy-23%2F23-brightgreen)](bench/accuracy.mjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

</div>

---

## The problem

When a coding agent asks "where is `createContext` called?", it has two options:

1. Read 4–5 files, burn ~103,000 tokens, maybe find the answer
2. Call `cortex_callers("createContext")` → get the answer in 355 tokens

Cortex makes option 2 possible. It builds a structural index of your codebase — functions, call sites, imports, symbols — and exposes it as an MCP server that Claude Code (and any MCP-compatible agent) can query directly.

**This is not a "fewer tokens" trick. It is a structural index that makes questions answerable without reading source files.**

---

## What we measured on vercel/next.js

We ran Cortex against [Next.js](https://github.com/vercel/next.js) — 228,972 LOC, 1,913 files, 13,495 functions.

Five questions a developer or agent would actually ask:

| Question | Raw (files agent must read) | Cortex response | Reduction |
|---|---|---|---|
| Where is `createContext` called? | 102,815 tokens (4 files) | 355 tokens | **289×** |
| What does `app-render.tsx` import? | 90,246 tokens (1 file) | 23 tokens | **3,923×** |
| Where is `getServerSideProps` defined? | 17,326 tokens (4 files) | 20 tokens | **866×** |
| If I change `renderToHTML`, what breaks? | 133,980 tokens (5 files) | 34 tokens | **3,940×** |
| Full structure of `middleware.ts`? | 7,511 tokens (4 files) | 43 tokens | **174×** |
| **Total** | **351,878 tokens** | **475 tokens** | **740×** |

**99.9% reduction. Same answer.**

### What these numbers mean in practice

At claude-sonnet-4-6 pricing ($3 / 1M input tokens):

| | Per 100 agent sessions |
|---|---|
| Without Cortex | **$105.56** |
| With Cortex | **$0.14** |

**How to verify this yourself:** `node bench/nextjs_benchmark.mjs` (requires a local Next.js clone)

---

## Brutal honest caveats

Before you use this, read these:

- **The benchmark measures structural questions only.** When an agent needs to understand logic ("what does this function actually do?"), it still reads the source file. Cortex does not help with that.
- **Token counts use chars ÷ 3.5.** This is the standard conservative estimate for TypeScript code. Actual tokenization varies ±15%.
- **Cortex does not update itself.** You must run `cortex watch` or `cortex index` after code changes. Stale index = wrong answers.
- **Dynamic behavior is invisible.** `require(variable)`, reflection, runtime dispatch — Cortex cannot track these.
- **Accuracy is 23/23 on our fixture suite.** Real codebases have patterns we haven't tested.
- **This is a pre-1.0 tool.** There are bugs. The API may change.

---

## Try it without installing anything

Run this on your own project — no global install, no config:

```bash
npx cortex-code index .
npx cortex-code query callers <any_function_name>
npx cortex-code query impact <any_function_name>
npx cortex-code query cycles
```

That's the whole tool in 4 commands.

---

## Full setup (5 steps)

### Step 1 — Install

```bash
npm install -g cortex-code
```

Or use `npx cortex-code <command>` everywhere below without installing.

### Step 2 — Index your project

```bash
cd /your/project
cortex index .
```

Output:
```
◆ cortex index → /your/project
✔ Index built — 847 functions, 112 files, 3,241 call sites   (2.1s)
  Output   scl-index.json
```

The index is a single JSON file. On Next.js (228K LOC) this takes 12.6 seconds.

### Step 3 — Test it (CLI queries, no agent needed)

```bash
cortex query callers createContext        # who calls this function?
cortex query deps src/app.ts             # what does this file import?
cortex query symbols src/auth.ts         # what's exported vs internal?
cortex query impact renderToHTML         # what breaks if I change this?
cortex query path src/a.ts src/b.ts      # dependency chain between two files?
cortex query cycles                      # any circular dependencies?
```

### Step 4 — Connect to Claude Code (MCP)

```bash
cortex mcp-config
```

This prints the exact JSON to paste into `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/dist/mcp.js"],
      "env": { "SCL_INDEX": "/your/project/scl-index.json" }
    }
  }
}
```

Paste it. Restart Claude Code. The 13 `cortex_*` tools are now available.

### Step 5 — Keep the index fresh

```bash
cortex watch .    # incremental reindex on every file save
```

On a 228K LOC project, a single file change triggers one file parse (sub-100ms), not a full reindex.

---

## Before and after — same question, different cost

### Without Cortex

You ask Claude Code: *"Where is `createContext` called in this codebase?"*

Claude reads `app-render.tsx` (316KB), `app-router.tsx` (89KB), two more files. Spends ~103,000 tokens. Might miss some callers.

### With Cortex

Claude calls `cortex_callers("createContext")`. Gets 89 call sites across 23 files. 355 tokens. Sub-millisecond.

**This is the actual difference.** Not a demo — you can measure it yourself with `node bench/nextjs_benchmark.mjs`.

---

## Architecture

```
Your codebase (TypeScript / JavaScript / Python)
          │
          ▼
  ┌───────────────────┐
  │   cortex index    │  Tree-sitter AST parser
  │                   │  Extracts: functions, call sites, imports, symbols
  │                   │  Hashes each file for incremental updates
  └────────┬──────────┘
           │  writes
           ▼
    scl-index.json      ← single flat JSON file, stays in your project
           │
    ┌──────┴──────────────────────────┐
    │                                 │
    ▼                                 ▼
MCP Server                      REST API / CLI
(13 tools)                      (9 endpoints)
    │
    ▼
Claude Code / any MCP agent
```

### What's in the index

```
functions    — name, file, line, exported, async, generator, decorator
callSites    — caller, callee, file, line
imports      — from, to, symbols, aliases, dynamic, reExport
symbols      — file, exported[], internal[], reExportsFrom[]
fileHashes   — MD5 per file (for incremental reindex)
```

### How queries work

- **`cortex_callers(fn)`** — filter `callSites` where `callee === fn`, group by file
- **`cortex_impact(fn)`** — find callers, then traverse the reverse import graph (BFS), flag test files
- **`cortex_path(a, b)`** — BFS on the import graph from `a` to `b`
- **`cortex_cycles`** — DFS cycle detection with deduplication
- **`cortex_context(file)`** — combine symbols + imports + importedBy + functions for one file

Everything runs against the pre-built index. No re-parsing on query.

### Source layout

```
src/
├── parsers/
│   ├── typescript.ts   — TS/TSX (re-exports, aliases, decorators, async/generator)
│   ├── javascript.ts   — JS/JSX
│   ├── python.ts       — Python (__all__, class methods, public/private convention)
│   └── index.ts        — language router
├── graph.ts            — BFS paths, DFS cycles, reverse graph, impact analysis
├── incremental.ts      — file-hash partial reindex
├── git.ts              — changed-since, structural diff vs git ref
├── analytics.ts        — local token savings tracking (~/.cortex/analytics.json)
├── parser.ts           — buildIndex() orchestrator
├── api.ts              — REST server (9 endpoints, Express)
├── mcp.ts              — MCP server (13 tools, stdio)
├── cli.ts              — CLI commands (Commander)
└── dashboard.ts        — web UI (port 7701)
```

---

## MCP tools — 13 total

| Tool | What it answers |
|---|---|
| `cortex_callers` | Where is this function called? |
| `cortex_deps` | What does this file import? What imports it? |
| `cortex_symbols` | What's exported vs internal in this file? |
| `cortex_functions` | Where is this function defined? |
| `cortex_search` | Find any symbol across the codebase |
| `cortex_context` | Full structural picture of a file in one call |
| `cortex_impact` | If I change this, what could break? |
| `cortex_path` | Dependency path between two files |
| `cortex_cycles` | Are there circular dependencies? |
| `cortex_repo_map` | How is this repo organized? |
| `cortex_architecture` | High-level module structure |
| `cortex_git_impact` | What did my changes since `main` affect? |
| `cortex_health` | Is the index fresh? |

---

## Accuracy

23/23 checks across all categories:

```
[Barrel files]           4/4  ✔  re-exports, export *, reExportsFrom
[Aliased imports]        4/4  ✔  named aliases, namespace aliases
[Re-export chains]       3/3  ✔  chained re-exports, aliased re-exports
[Dynamic imports]        3/3  ✔  async import(), detection as call site
[General TypeScript]     5/5  ✔  exports, internals, call sites, imports
[Python]                 4/4  ✔  public/private, __all__, class methods
```

Run: `node bench/accuracy.mjs`

---

## Supported languages

| Language | Extensions | Status |
|---|---|---|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | Stable |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | Stable |
| Python | `.py` `.pyw` | Stable |
| Go | `.go` | Planned |
| Rust | `.rs` | Planned |

Adding a language is ~80 lines implementing `LanguageAdapter`.

---

## CLI reference

```bash
cortex init                          # Initialize .cortexrc.json
cortex index [dir]                   # Build the context index
cortex watch [dir]                   # Incremental reindex on file save
cortex serve                         # REST API on :7700
cortex dashboard                     # Web UI on :7701
cortex stats                         # Show cumulative token savings
cortex mcp-config                    # Print MCP config to paste into Claude Code

cortex query callers <fn>            # Find all callers of a function
cortex query deps <file>             # Show import dependencies
cortex query symbols <file>          # List exported / internal symbols
cortex query search <term>           # Search functions and symbols
cortex query impact <symbol>         # Refactor impact analysis
cortex query path <from> <to>        # Dependency path between files
cortex query cycles                  # Detect circular dependencies
cortex query changed-since <ref>     # Structural diff since git ref
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Punvesh](https://github.com/Punvesh)
