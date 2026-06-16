<div align="center">

# ◆ Cortex

**Structural context layer for coding agents.**

Cortex pre-computes your codebase structure so AI agents don't have to.  
27× fewer tokens. Same answer. Any agent. Any language.

[![CI](https://github.com/Punvesh/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Punvesh/cortex/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cortex-code.svg)](https://www.npmjs.com/package/cortex-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

</div>

---

## The problem

Every time an AI agent answers a question about your code, it reads raw source files and re-infers what's already deterministic — import graphs, call chains, where functions live. On a real codebase that's **thousands of wasted tokens per query**, just to re-derive structure that hasn't changed.

Cortex solves this by pre-computing that structure and exposing it as a query API and MCP server. Agents ask for resolved facts instead of reading raw files.

## Benchmark

**Task:** *"Find all callers of `buildIndex`, list what `src/cli.ts` imports, locate where `parseFile` is defined."*

| | Approach | Input tokens | Method |
|---|---|---|---|
| ❌ | Without Cortex | **6,567** | Read 6 source files |
| ✅ | With Cortex | **238** | 3 tool calls |
| | **Savings** | **96.4% / 27.6×** | Same answer |

## Quickstart

```bash
# Clone and build
git clone https://github.com/Punvesh/cortex
cd cortex && npm install && npm run build

# Index your project
node dist/cli.js index /path/to/your/project

# Query it
node dist/cli.js query callers processPayment
node dist/cli.js query deps src/auth/login.ts
node dist/cli.js query search validateToken

# Open the dashboard
node dist/cli.js dashboard
```

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

Restart Claude Code. You now have **8 structural tools** available in every session:

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

## CLI reference

```bash
cortex init                    # Initialize .cortexrc.json in current project
cortex index [dir]             # Build the context index
cortex index [dir] --out <f>   # Write index to a custom path
cortex watch [dir]             # Watch for changes and auto-reindex
cortex serve                   # Start REST API on :7700
cortex dashboard               # Open web UI in browser
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
GET /functions?name=<name>&file=<path>&exported=true
GET /search?q=<term>
GET /context?file=<path>
GET /architecture
GET /health
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

Copy this into your project at `.github/workflows/cortex-index.yml`:

```yaml
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

## Watch mode

```bash
cortex watch /path/to/project
# ◆ cortex watch — watching /path/to/project
# ✔ Index updated — 312 functions, 48 files  (triggered on save)
```

## How it works

```
Your codebase
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Cortex Parser (Tree-sitter)                    │
│  Extracts: functions · call sites · imports     │
│  Languages: TypeScript · JavaScript · Python    │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
              scl-index.json
              (flat JSON, ~50KB for 10K LOC)
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      REST API      MCP Server    CLI queries
      :7700         stdio         cortex query
          │            │
          └─────┬──────┘
                ▼
    Claude Code · Continue.dev · Cursor · any agent
```

**Parser:** Uses [Tree-sitter](https://tree-sitter.github.io/) — the same parser used by Neovim, Zed, and GitHub. Deterministic: same code always produces the same index.

**Index:** A single `scl-index.json` flat file. No database. Fast to read, easy to diff, trivial to cache.

**MCP Server:** Implements the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio. Works with any MCP-compatible client.

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

See [CONTRIBUTING.md](CONTRIBUTING.md). The fastest contribution is **adding a new language** — each language is ~80 lines implementing the `LanguageAdapter` interface.

## License

MIT © [Punvesh](https://github.com/Punvesh)
