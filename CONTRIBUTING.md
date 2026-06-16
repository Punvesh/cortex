# Contributing to Cortex

Thank you for helping make Cortex better. This is a short guide to get you moving fast.

## Setup

```bash
git clone https://github.com/Punvesh/cortex
cd cortex
npm install
npm run build
```

Verify it works by indexing itself:

```bash
node dist/cli.js index .
node dist/cli.js query search buildIndex
```

## Adding a new language

Each language is an adapter in `src/parsers/`. The interface is small:

```typescript
export interface LanguageAdapter {
  extensions: string[];
  getLanguage(file: string): any;        // return the Tree-sitter grammar
  parse(filePath, relPath, src, parser): ParseResult;
}
```

Steps:
1. Install the Tree-sitter grammar: `npm install tree-sitter-<lang>`
2. Create `src/parsers/<lang>.ts` implementing `LanguageAdapter`
3. Register it in `src/parsers/index.ts`
4. Add a test file in `tests/fixtures/<lang>/`
5. Run `npm test`

Look at `src/parsers/python.ts` as a reference — it's the most readable one.

## Adding a new MCP tool

Add it to `src/mcp.ts` using the `server.tool()` API. Tools must:
- Have a unique name prefixed with `cortex_`
- Include a clear description (this is what the AI reads to decide when to call it)
- Return JSON as text content

Also add the equivalent REST endpoint to `src/api.ts`.

## Code style

- TypeScript strict mode
- No comments unless the why is non-obvious
- No unused imports

## Pull request

- Open an issue first for large changes
- Keep PRs focused — one feature or fix per PR
- All CI checks must pass
