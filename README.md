<div align="center">

# ◆ Cortex

**The structural memory layer for AI coding agents.**

[![CI](https://github.com/Punvesh/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Punvesh/cortex/actions/workflows/ci.yml)
[![Accuracy](https://img.shields.io/badge/accuracy-100%25%20(23%2F23)-brightgreen)](bench/accuracy.mjs)
[![npm](https://img.shields.io/npm/v/cortex-code.svg)](https://www.npmjs.com/package/cortex-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

</div>

---

## Why this matters

Reducing tokens is not the goal.

Reducing tokens allows agents to:

- **Fit larger codebases into context windows** — instead of burning the window on file content, agents spend it on reasoning and implementation
- **Make fewer tool calls** — one `cortex_context` call replaces 5–10 file reads
- **Spend context on what matters** — logic, edge cases, and architecture; not import graphs
- **Reduce inference cost** — 27× fewer input tokens means 27× lower cost per structural query
- **Answer structural questions in milliseconds** — pre-computed index vs. parse-on-demand

The goal is better agent outcomes. Fewer tokens is the mechanism.

---

## The problem

Every time an AI agent answers a question about your code, it reads raw source files and re-infers what's already deterministic — import graphs, call chains, where functions live. On a real project that's thousands of wasted tokens per query, burning context that should go toward solving the actual task.

Cortex pre-computes that structure once. Agents query resolved facts instead.

---

## Benchmark

**Task:** *"Find all callers of `processPayment`, list what `src/auth/login.ts` imports, locate where `validateToken` is defined."*

**Repository:** Cortex itself — 1,377 LOC TypeScript (17 files, 188 functions, 731 call sites)  
**Model:** claude-sonnet-4-6 via Claude Code (MCP)  
**Token counts:** measured from tool response payloads vs. raw file context payloads  
**Runs:** 10 repetitions, median reported

| | Approach | Input tokens | Method |
|---|---|---|---|
| ❌ | Without Cortex | **6,567** | Read 17 source files |
| ✅ | With Cortex | **238** | 3 MCP tool calls |
| | **Savings** | **96.4% / 27.6×** | Same answer |

---

## What Cortex does NOT do

- **Does not understand runtime behavior.** Dynamic dispatch and reflection are invisible to the AST.
- **Does not replace reading source code.** When agents need to understand logic, they must read the file. Cortex handles structure, not content.
- **Does not perform semantic reasoning.** It knows where things are and how they connect, not what they mean.
- **Does not track dynamic imports perfectly.** `require(variable)` or `importlib.import_module(name)` won't be captured.
- **Does not stay fresh automatically** without `cortex watch` or the CI workflow.

---

## Quickstart

```bash
git clone https://github.com/Punvesh/cortex
cd cortex && npm install && npm run build

# Index your project
node dist/cli.js index /path/to/your/project

# Query it
node dist/cli.js query impact processPayment   # what breaks if I change this?
node dist/cli.js query callers validateToken   # who calls this?
node dist/cli.js query cycles                  # any circular dependencies?
node dist/cli.js query changed-since main      # what did my PR affect?
```

---

## MCP tools (13 total)

Connect to Claude Code by adding to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/cortex/dist/mcp.js"],
      "env": { "SCL_INDEX": "/path/to/your/project/scl-index.json" }
    }
  }
}
```

| Tool | Question it answers |
|---|---|
| `cortex_callers` | Where is this function called? |
| `cortex_deps` | What does this file import / what imports it? |
| `cortex_symbols` | What's exported vs internal in this file? |
| `cortex_functions` | Where is this function defined? |
| `cortex_search` | Find any symbol across the codebase |
| `cortex_context` | **Full structural picture of a file in one call** |
| `cortex_impact` | **If I change this, what could break?** |
| `cortex_path` | What's the dependency path between two modules? |
| `cortex_cycles` | Are there circular dependencies? |
| `cortex_repo_map` | How is this repository organized? |
| `cortex_architecture` | What's the high-level module structure? |
| `cortex_git_impact` | What did my changes since `main` affect? |
| `cortex_health` | Is the index fresh? How many tokens have I saved? |

---

## CLI reference

```bash
cortex init                          # Initialize .cortexrc.json
cortex index [dir]                   # Build the context index
cortex watch [dir]                   # Incremental reindex on file save
cortex serve                         # REST API on :7700
cortex dashboard                     # Web UI on :7701
cortex stats                         # Show cumulative token savings

cortex query callers <fn>            # Find all callers of a function
cortex query deps <file>             # Show import dependencies
cortex query symbols <file>          # List exported / internal symbols
cortex query search <term>           # Search functions and symbols
cortex query impact <symbol>         # Refactor impact analysis
cortex query path <from> <to>        # Dependency path between files
cortex query cycles                  # Detect circular dependencies
cortex query changed-since <ref>     # Structural diff since git ref
```

**Real output:**

```
$ cortex query impact buildIndex

  Impact of changing buildIndex:

  Defined in:          src/parser.ts
  Direct callers:      2
    src/cli.ts:35  ← <arrow>
    src/cli.ts:70  ← reindex

  Transitive files affected: 3
    · src/cli.ts
    · src/index.ts
    · bench/token_count.mjs

  Affected tests: 0

  Total impact: 4 files
```

```
$ cortex query cycles

  ✓ No circular dependencies found.
```

```
$ cortex query changed-since main

  Changes since main:

  Changed files:
    ~ src/graph.ts

  Transitively affected (2 files):
    · src/mcp.ts
    · src/cli.ts

  At-risk tests (0):
```

---

## Accuracy

**23/23 accuracy checks passing across all categories:**

```
[Barrel files]        4/4  ✔  re-exports, export *, reExportsFrom
[Aliased imports]     4/4  ✔  named aliases, namespace aliases
[Re-export chains]    3/3  ✔  chained re-exports, aliased re-exports
[Dynamic imports]     3/3  ✔  async import(), detection as call site
[General TypeScript]  5/5  ✔  exports, internals, call sites, imports
[Python]              4/4  ✔  public/private conventions, __all__, class methods
```

Run: `node bench/accuracy.mjs`

---

## Watch mode (incremental)

```
$ cortex watch .
◆ cortex watch → /my/project
✔ Index built — 188 functions, 17 files
✔ 1 file(s) updated — 189 fns, 17 files   ← sub-100ms on change
```

Cortex hashes each file and only reparses what changed. On a 50K LOC project, a single file edit triggers one file parse, not a full reindex.

---

## Evidence dashboard

```
$ cortex stats

◆ Cortex — Usage Analytics

  Total queries:         1,243
  Tokens avoided:        287,440
  Est. savings (USD):    $0.86
  Queries/day:           41.4

  Top tools:
    cortex_context           312 calls  68,640 tokens
    cortex_impact            201 calls  60,300 tokens
    cortex_callers           189 calls  41,580 tokens
```

---

## Supported languages

| Language | Extensions | Status |
|---|---|---|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | ✅ Stable |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | ✅ Stable |
| Python | `.py` `.pyw` | ✅ Stable |
| Go | `.go` | 🔜 Planned |
| Rust | `.rs` | 🔜 Planned |

---

## Why not Tree-sitter / Sourcegraph / CodeQL?

| | Tree-sitter | Sourcegraph | CodeQL | Semgrep | **Cortex** |
|---|---|---|---|---|---|
| Purpose | Parse trees | Code search | Security | Patterns | **Agent context** |
| MCP server | ✗ | ✗ | ✗ | ✗ | **✓** |
| Token-budget aware | ✗ | ✗ | ✗ | ✗ | **✓** |
| Refactor impact | ✗ | ✗ | ✓ (complex) | ✗ | **✓** |
| Zero config | ✗ | ✗ | ✗ | ✗ | **✓** |
| Self-hosted | ✓ | ✗ | ✓ | ✓ | **✓** |
| Built for agents | ✗ | ✗ | ✗ | ✗ | **✓** |

---

## Architecture

```
src/
├── parsers/
│   ├── typescript.ts  — TS/TSX (re-exports, aliases, decorators, async)
│   ├── javascript.ts  — JS/JSX adapter
│   ├── python.ts      — Python (__all__, class methods, private convention)
│   └── index.ts       — language router
├── graph.ts           — impact analysis, cycle detection, path finding, clusters
├── incremental.ts     — file-hash-based partial reindex
├── git.ts             — changed-since, git diff integration
├── analytics.ts       — local usage tracking and token savings
├── parser.ts          — buildIndex() orchestrator
├── api.ts             — REST server (9 endpoints)
├── mcp.ts             — MCP server (13 tools)
├── cli.ts             — CLI (index/watch/serve/dashboard/query/stats)
└── dashboard.ts       — web UI
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Adding a language = ~80 lines implementing `LanguageAdapter`.

## License

MIT © [Punvesh](https://github.com/Punvesh)
