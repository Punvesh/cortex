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
- **Reduce inference cost** — 740× fewer tokens on real codebases means 740× lower cost per structural query
- **Answer structural questions in milliseconds** — pre-computed index vs. parse-on-demand

The goal is better agent outcomes. Fewer tokens is the mechanism.

---

## Benchmark — vercel/next.js

Real benchmark on the [Next.js](https://github.com/vercel/next.js) repository — one of the most widely used TypeScript codebases in the world.

**Codebase:** 228,972 LOC · 1,913 files · 13,495 functions · 42,137 call sites  
**Indexed in:** 12.6 seconds  
**Model:** claude-sonnet-4-6  
**Token counts:** measured from MCP tool response payloads vs. raw TypeScript file sizes  
**Methodology:** for each task, we measure the minimum file set an agent would need to read without Cortex, vs. the Cortex tool response

| Task | Agent question | Raw tokens | Cortex tokens | Reduction |
|---|---|---|---|---|
| Callers of `createContext` | Where is this called? | 102,815 | 355 | **289×** |
| Imports of `app-render.tsx` | What does this file import? | 90,246 | 23 | **3,923×** |
| Definition of `getServerSideProps` | Which file, which line? | 17,326 | 20 | **866×** |
| Impact of changing `renderToHTML` | What could break? | 133,980 | 34 | **3,940×** |
| Full context of `middleware.ts` | Structural picture? | 7,511 | 43 | **174×** |
| **TOTAL** | | **351,878** | **475** | **740×** |

**99.9% token reduction. Same answer.**

### What this costs

At claude-sonnet-4-6 pricing ($3 / 1M input tokens):

| | Per 100 agent sessions |
|---|---|
| Without Cortex | **$105.56** |
| With Cortex | **$0.14** |
| **Savings** | **$105.42** |

Run this benchmark yourself: `node bench/nextjs_benchmark.mjs`

---

## What Cortex does NOT do

- **Does not understand runtime behavior.** Dynamic dispatch and reflection are invisible to the AST.
- **Does not replace reading source code.** When agents need to understand logic, they read the file. Cortex handles structure, not content.
- **Does not perform semantic reasoning.** It knows where things are and how they connect, not what they mean.
- **Does not track dynamic imports perfectly.** `require(variable)` won't be captured.
- **Does not stay fresh automatically** without `cortex watch` or the CI workflow.

---

## Quickstart

```bash
git clone https://github.com/Punvesh/cortex
cd cortex && npm install && npm run build

# Index your project (Next.js takes 12.6s — yours will be faster)
node dist/cli.js index /path/to/your/project

# Query it
node dist/cli.js query impact renderToHTML      # what breaks if I change this?
node dist/cli.js query callers createContext    # who calls this?
node dist/cli.js query cycles                   # any circular dependencies?
node dist/cli.js query changed-since main       # what did my PR affect?
```

---

## MCP tools (13 total)

Connect to Claude Code — add to `~/.claude/settings.json`:

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

## Real CLI output

```
$ cortex query callers createContext

  89 caller(s) of createContext:

  server/app-render/app-render.tsx:184  ← createAppRenderContext
  server/app-render/app-render.tsx:201  ← renderToHTMLOrFlight
  client/components/app-router.tsx:312  ← AppRouter
  ...
```

```
$ cortex query impact renderToHTML

  Impact of changing renderToHTML:

  Defined in:          server/render.tsx
  Direct callers:      6
  Transitive files:    23
  Affected tests:      4

  Total impact: 27 files
```

```
$ cortex query changed-since main

  Changed files:        3
  Transitively affected: 14 files
  At-risk tests:        2
```

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

---

## Accuracy

**23/23 accuracy checks passing across all categories:**

```
[Barrel files]        4/4  ✔  re-exports, export *, reExportsFrom
[Aliased imports]     4/4  ✔  named aliases, namespace aliases
[Re-export chains]    3/3  ✔  chained re-exports, aliased re-exports
[Dynamic imports]     3/3  ✔  async import(), detection as call site
[General TypeScript]  5/5  ✔  exports, internals, call sites, imports
[Python]              4/4  ✔  public/private, __all__, class methods
```

Run: `node bench/accuracy.mjs`

---

## Watch mode (incremental)

Cortex hashes each file and only reparses what changed.  
On a 228K LOC project, a single file edit triggers **one file parse**, not a full reindex.

```
$ cortex watch .
◆ cortex watch → /my/project
✔ Index built  — 13,495 functions, 1,913 files   (12.6s initial)
✔ 1 file(s) updated — sub-100ms                   (on each save)
```

---

## Evidence

```
$ cortex stats

◆ Cortex — Usage Analytics

  Total queries:         1,243
  Tokens avoided:        8,200,000+
  Est. savings (USD):    $24.60
  Queries/day:           41.4
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
│   ├── javascript.ts  — JS/JSX
│   ├── python.ts      — Python (__all__, class methods)
│   └── index.ts       — language router
├── graph.ts           — impact, cycle detection, path finding, clusters
├── incremental.ts     — file-hash partial reindex
├── git.ts             — changed-since, git diff integration
├── analytics.ts       — local usage tracking, token savings
├── parser.ts          — buildIndex() orchestrator
├── api.ts             — REST server (9 endpoints)
├── mcp.ts             — MCP server (13 tools)
├── cli.ts             — CLI commands
└── dashboard.ts       — web UI
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Adding a language = ~80 lines implementing `LanguageAdapter`.

## License

MIT © [Punvesh](https://github.com/Punvesh)
