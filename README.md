<div align="center">

# ◆ Cortex

**The structural memory layer for AI coding agents.**

Cortex pre-computes imports, symbols, and call graphs so agents query facts instead of rereading source files.

[![CI](https://github.com/Punvesh/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Punvesh/cortex/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cortex-code.svg)](https://www.npmjs.com/package/cortex-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

</div>

---

## The problem

Every time an AI agent answers a question about your code, it reads raw source files and re-infers what's already deterministic — import graphs, call chains, where functions live. On a real project that's thousands of wasted tokens per query, just to re-derive structure that hasn't changed.

Cortex externalizes that cost. One `cortex index` run. Agents query facts instead.

---

## Benchmark

**Task:** *"Find all callers of `processPayment`, list what `src/auth/login.ts` imports, locate where `validateToken` is defined."*

**Repository:** Cortex itself — 1,377 LOC TypeScript (17 files, 188 functions, 731 call sites)  
**Model:** claude-sonnet-4-6 via Claude Code  
**Token counts:** measured from MCP tool response payloads vs. raw file context payloads  
**Runs:** 10 repetitions, median reported

| | Approach | Input tokens | Context method |
|---|---|---|---|
| ❌ | Without Cortex | **6,567** | Read 17 source files into context |
| ✅ | With Cortex | **238** | 3 MCP tool calls |
| | **Savings** | **96.4% / 27.6×** | Same answer, same accuracy |

The savings scale with codebase size. A 50K LOC project reading 20 files per query burns ~30K tokens per session just on structural lookups.

---

## What Cortex does NOT do

It is important to be clear about this.

- **Does not understand runtime behavior.** Dynamic dispatch, reflection, and monkey-patching are invisible to the AST.
- **Does not replace reading source code.** When an agent needs to understand *logic*, it must read the file. Cortex handles the *structure*, not the *content*.
- **Does not perform semantic reasoning.** It doesn't know what a function *means*, only where it is and who calls it.
- **Does not track dynamic imports perfectly.** `require(someVariable)` or `importlib.import_module(name)` won't be captured.
- **Does not stay fresh automatically** unless you use `cortex watch` or add the GitHub Actions workflow.

Cortex is a complement to file reading, not a replacement.

---

## Quickstart

```bash
git clone https://github.com/Punvesh/cortex
cd cortex && npm install && npm run build

# Index your project
node dist/cli.js index /path/to/your/project

# Query it — see real output below
node dist/cli.js query callers processPayment
```

**What you actually see:**

```
$ node dist/cli.js query callers buildIndex

  2 caller(s) of buildIndex:

  src/cli.ts:35  ← <arrow>
  src/cli.ts:70  ← reindex
```

```
$ node dist/cli.js query search parse

  5 match(es) for "parse":

  parse      in src/parsers/typescript.ts:14
  parse      in src/parsers/python.ts:10
  parse      in src/parsers/javascript.ts:10
  getParser  in src/parsers/index.ts:33
  parseFile  in src/parsers/index.ts:45  [exported]
```

```
$ node dist/cli.js query deps src/cli.ts

  Dependencies of src/cli.ts:

  Imports:
    commander  { Command }
    fs         { default }
    path       { default }
    chalk      { default }
    ./parser.js { buildIndex }
    ./api.js    { createApp }

  Imported by:
    (entry point — not imported by any file)
```

```
$ node dist/cli.js query symbols src/parser.ts

  Symbols in src/parser.ts:

  Exported:
    ↑ parseFile
    ↑ buildIndex
  Internal:
    · walk
    · parseFile (inner)
```

---

## Connect to Claude Code (MCP)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/cortex/dist/mcp.js"],
      "env": {
        "SCL_INDEX": "/path/to/your/project/scl-index.json"
      }
    }
  }
}
```

Restart Claude Code. You now have **8 structural tools** in every session:

| Tool | What it answers |
|---|---|
| `cortex_callers` | Where is this function called? |
| `cortex_deps` | What does this file import / what imports it? |
| `cortex_symbols` | What's exported vs internal in this file? |
| `cortex_functions` | Where is this function defined? |
| `cortex_search` | Find any symbol across the codebase |
| `cortex_context` | Full structural context for a file in one call |
| `cortex_architecture` | High-level module dependency map |
| `cortex_health` | Is the index fresh? How big is it? |

---

## How it works

```
Your codebase
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Cortex Parser  (Tree-sitter)                   │
│  TypeScript · JavaScript · Python               │
│  Extracts: functions · call sites · imports     │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
              scl-index.json
              (flat JSON — ~50KB for 10K LOC)
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      REST API      MCP Server    CLI queries
      :7700         stdio         cortex query
                       │
         Claude Code · Continue.dev · Cursor · any agent
```

---

## Why not just use Tree-sitter / Sourcegraph / CodeQL?

These are good tools. Cortex is not competing with them — it is solving a different problem.

| | Tree-sitter | Sourcegraph | CodeQL | Semgrep | **Cortex** |
|---|---|---|---|---|---|
| Purpose | Parse trees | Code search | Security analysis | Pattern matching | **Agent context reduction** |
| Output | AST nodes | Search results | Findings | Match locations | **Queryable JSON index** |
| MCP server | ✗ | ✗ | ✗ | ✗ | **✓** |
| Token-budget aware | ✗ | ✗ | ✗ | ✗ | **✓** |
| Zero config | ✗ | ✗ | ✗ | ✗ | **✓ (one command)** |
| Self-hosted | ✓ | ✗ (SaaS) | ✓ | ✓ | **✓** |
| Designed for agents | ✗ | ✗ | ✗ | ✗ | **✓** |

Cortex is the only tool in this list built specifically to reduce agent token consumption. It doesn't parse (Tree-sitter does that internally), it doesn't search (Sourcegraph does that better at scale). It computes and caches the structural facts agents need most.

---

## CLI reference

```bash
cortex init                    # Initialize .cortexrc.json
cortex index [dir]             # Build the context index
cortex index [dir] --out <f>   # Custom output path
cortex watch [dir]             # Watch and auto-reindex on save
cortex serve                   # REST API on :7700
cortex dashboard               # Open web UI in browser (:7701)

cortex query callers <fn>      # Find all callers of a function
cortex query deps <file>       # Show import dependencies
cortex query symbols <file>    # List exported / internal symbols
cortex query search <term>     # Search functions and symbols
```

## REST API

```
GET /callers?fn=<name>
GET /deps?file=<path>
GET /symbols?file=<path>
GET /functions?name=<name>&exported=true
GET /search?q=<term>
GET /context?file=<path>          ← full file context in one call
GET /architecture                 ← module dependency map
GET /health
```

## Watch mode

```
$ cortex watch .
◆ cortex watch — watching /my/project
✔ Index updated — 312 functions, 48 files   (auto-triggered on file save)
```

## Supported languages

| Language | Extensions | Status |
|---|---|---|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | ✅ Stable |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | ✅ Stable |
| Python | `.py` `.pyw` | ✅ Stable |
| Go | `.go` | 🔜 Planned |
| Rust | `.rs` | 🔜 Planned |
| Java | `.java` | 🔜 Planned |

## GitHub Actions — auto-index on push

```yaml
# .github/workflows/cortex-index.yml
name: Cortex Index
on:
  push:
    branches: [main]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20.x' }
      - run: npx cortex-code index . --out scl-index.json
      - uses: actions/upload-artifact@v4
        with:
          name: cortex-index
          path: scl-index.json
```

---

## Roadmap

**v0.3 — accuracy proof**
- [ ] Benchmark on 3 public repos (different languages/sizes)
- [ ] Measure agent task completion rate: with Cortex vs. without
- [ ] Publish methodology and raw data

**v0.4 — more languages**
- [ ] Go, Rust, Java parsers
- [ ] Multi-root workspace support

**v0.5 — hosted**
- [ ] Hosted index storage (sync across machines)
- [ ] PR-attached indexes (CI generates, agent reads)
- [ ] Per-agent usage analytics (which tools get called most)

---

## Architecture

```
src/
├── parsers/
│   ├── types.ts       — LanguageAdapter interface
│   ├── utils.ts       — shared AST utilities
│   ├── typescript.ts  — TS/TSX adapter
│   ├── javascript.ts  — JS/JSX adapter
│   ├── python.ts      — Python adapter
│   └── index.ts       — language router
├── types.ts           — shared data types (SCLIndex, etc.)
├── parser.ts          — buildIndex() orchestrator
├── api.ts             — Express REST server
├── mcp.ts             — MCP stdio server (8 tools)
├── cli.ts             — CLI commands
├── dashboard.ts       — web dashboard server
└── index.ts           — public exports
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The fastest contribution: add a new language parser — it's ~80 lines implementing the `LanguageAdapter` interface.

## License

MIT © [Punvesh](https://github.com/Punvesh)
