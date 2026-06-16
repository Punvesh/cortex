import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import type { SCLIndex } from "./types.js";

const DEFAULT_INDEX = path.resolve("scl-index.json");

function loadIndex(): SCLIndex {
  const indexPath = process.env.SCL_INDEX ?? DEFAULT_INDEX;
  if (!fs.existsSync(indexPath)) {
    throw new Error(`SCL index not found at ${indexPath}. Run: scl index`);
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

const server = new McpServer({
  name: "scl",
  version: "0.1.0",
});

server.tool(
  "scl_callers",
  "Find all call sites for a function by name. Returns the caller function, file, and line number for each call site.",
  { fn: z.string().describe("Function name to find callers of") },
  async ({ fn }) => {
    const index = loadIndex();
    const sites = index.callSites.filter(
      (c) => c.callee === fn || c.callee.endsWith(`.${fn}`)
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              fn,
              count: sites.length,
              callers: sites.map((s) => ({
                caller: s.caller,
                file: s.file,
                line: s.line,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "scl_deps",
  "Get the import dependencies for a file — what it imports and what imports it.",
  { file: z.string().describe("Relative file path (e.g. src/auth/login.ts)") },
  async ({ file }) => {
    const index = loadIndex();
    const imports = index.imports.filter((i) => i.from === file);
    const importedBy = index.imports.filter((i) => {
      const resolved = i.to.startsWith(".")
        ? path.join(path.dirname(i.from), i.to).replace(/\\/g, "/")
        : i.to;
      return resolved === file || resolved === file.replace(/\.(ts|tsx)$/, "");
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              file,
              imports: imports.map((i) => ({ module: i.to, symbols: i.symbols })),
              importedBy: importedBy.map((i) => ({ file: i.from, symbols: i.symbols })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "scl_symbols",
  "List exported and internal symbols (functions, variables) declared in a file.",
  { file: z.string().describe("Relative file path (e.g. src/utils/format.ts)") },
  async ({ file }) => {
    const index = loadIndex();
    const entry = index.symbols.find((s) => s.file === file);
    if (!entry) {
      return {
        content: [{ type: "text", text: `No symbols found for ${file}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  }
);

server.tool(
  "scl_functions",
  "Find function definitions by name or file. Useful for locating where a function is defined.",
  {
    name: z.string().optional().describe("Function name to search for"),
    file: z.string().optional().describe("Filter by relative file path"),
  },
  async ({ name, file }) => {
    const index = loadIndex();
    let fns = index.functions;
    if (name) fns = fns.filter((f) => f.name === name);
    if (file) fns = fns.filter((f) => f.file === file);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: fns.length, functions: fns }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "scl_health",
  "Check SCL index status — when it was last built and how many symbols it contains.",
  {},
  async () => {
    try {
      const index = loadIndex();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                root: index.root,
                generatedAt: index.generatedAt,
                stats: {
                  files: index.symbols.length,
                  functions: index.functions.length,
                  callSites: index.callSites.length,
                  imports: index.imports.length,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: (err as Error).message }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[scl-mcp] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[scl-mcp] Fatal:", err);
  process.exit(1);
});
