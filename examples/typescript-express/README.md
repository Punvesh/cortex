# Example: TypeScript Express API

Index a TypeScript Express project and query it:

```bash
# Index the project
cortex index /path/to/express-app

# Find all route handlers
cortex query search handler

# What does routes/auth.ts import?
cortex query deps src/routes/auth.ts

# Who calls validateToken?
cortex query callers validateToken

# Start the MCP server and connect to Claude Code
cortex serve
```

## MCP config for Claude Code

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/cortex/dist/mcp.js"],
      "env": { "SCL_INDEX": "/path/to/express-app/scl-index.json" }
    }
  }
}
```

## GitHub Actions auto-index

Copy `.github/workflows/cortex-index.yml` from the Cortex repo into your project to auto-rebuild the index on every push.
