# Cortex

**Provider-agnostic structural context layer for coding agents.**

Cortex sits between your codebase and any coding agent (Claude Code, Continue.dev, Cursor, Copilot, etc.). Instead of every agent re-parsing and re-inferring codebase structure on every query, Cortex pre-computes it and exposes it as a queryable API and MCP server.

**Result: 27× fewer input tokens. Same answer.**

```
Codebase → cortex index → scl-index.json
                                ↓
            Claude Code | Continue.dev | Cursor | any MCP client
```

---

## The problem

When an agent reads your codebase to answer a question, it burns tokens reconstructing what's already deterministically knowable — import graphs, call chains, where functions are defined. On a real codebase that's thousands of tokens per query, just to re-infer structure that hasn't changed.

Cortex externalizes that reconstruction cost. Agents query resolved facts instead of raw files.

---

## Benchmark

Task: *"Find all callers of `buildIndex`, list what `src/cli.ts` imports, locate where `parseFile` is defined."*

| Approach | Input tokens | Method |
|---|---|---|
| Without Cortex | 6,567 | Read 6 source files |
| With Cortex | 238 | 3 tool calls |
| **Savings** | **96.4% / 27.6×** | Same answer |

---

## Install

```bash
npm install -g cortex-scl   # coming soon
# or run from source:
git clone https://github.com/Punvesh/cortex
cd cortex && npm install && npm run build
```

---

## Usage

### 1. Index your codebase

```bash
node dist/cli.js index /path/to/your/project
# Done in 0.04s — 6 files, 69 functions, 269 call sites, 22 imports
```

### 2. Query from the CLI

```bash
# Who calls processPayment?
node dist/cli.js query callers processPayment

# What does auth/login.ts import?
node dist/cli.js query deps src/auth/login.ts

# What's exported from utils/format.ts?
node dist/cli.js query symbols src/utils/format.ts

# Where is validateToken defined?
node dist/cli.js query functions --name validateToken
```

### 3. Start the REST API

```bash
node dist/cli.js serve --port 7700
# GET http://localhost:7700/callers?fn=processPayment
# GET http://localhost:7700/deps?file=src/auth/login.ts
# GET http://localhost:7700/symbols?file=src/utils/format.ts
# GET http://localhost:7700/health
```

### 4. Connect via MCP (Claude Code / Continue.dev)

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

Restart Claude Code. You'll have 5 new tools:

| Tool | What it answers |
|---|---|
| `scl_callers` | Where is this function called? |
| `scl_deps` | What does this file import / what imports it? |
| `scl_symbols` | What's exported vs internal in this file? |
| `scl_functions` | Where is this function defined? |
| `scl_health` | Is the index fresh? How big is it? |

---

## Architecture

```
src/
├── types.ts     — shared types (SCLIndex, FunctionDef, CallSite, ImportEdge)
├── parser.ts    — Tree-sitter AST walker → scl-index.json
├── api.ts       — Express REST server
├── mcp.ts       — MCP stdio server (5 tools)
├── cli.ts       — scl init / index / serve / query commands
└── index.ts     — public exports
```

**Parser:** Uses [Tree-sitter](https://tree-sitter.github.io/) with the TypeScript grammar. Extracts function declarations, arrow functions, method definitions, call expressions, and import statements. Deterministic — same code always produces the same index.

**Index:** A single `scl-index.json` flat file. Designed to be regenerated on commit (CI hook) or on demand. No database required.

**MCP server:** Implements the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio. Any MCP-compatible client can connect.

---

## Supported languages

- [x] TypeScript / TSX
- [ ] JavaScript (planned)
- [ ] Python (planned)
- [ ] Go (planned)

---

## Roadmap

- [ ] Multi-language support (JS, Python, Go)
- [ ] Semantic layer (naming conventions, architectural rules)
- [ ] Git hook for automatic re-indexing on commit
- [ ] `npm install -g cortex-scl` package
- [ ] VS Code extension

---

## Contributing

PRs welcome. The parser (`src/parser.ts`) is the best place to start — adding a new language means adding a new Tree-sitter grammar and a new `walk()` implementation.

---

## License

MIT
