/**
 * Token benchmark: raw file reading vs SCL tool calls.
 * Uses the Anthropic tokenizer approximation:
 *   ~1 token per 3.5 chars for code (denser than prose).
 * We measure exact character counts and use this ratio consistently
 * for both approaches so the comparison is fair.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CHARS_PER_TOKEN = 3.5; // conservative for code
const toTokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

const TASK = `Find all callers of "buildIndex", list what src/cli.ts imports, and locate where "parseFile" is defined.`;

// ── Approach A: read all source files (what an agent does without SCL) ────
const files = ["src/parser.ts", "src/cli.ts", "src/api.ts", "src/types.ts", "src/mcp.ts", "src/index.ts"];
const fileDetails = files.map((f) => {
  const content = fs.readFileSync(path.join("C:/SCL", f), "utf8");
  return { file: f, chars: content.length, tokens: toTokens(content.length) };
});
const rawTotalChars = fileDetails.reduce((s, f) => s + f.chars, 0);
const rawTotalTokens = toTokens(rawTotalChars);

// ── Approach B: SCL tool responses ────────────────────────────────────────
process.env.SCL_INDEX = "C:/SCL/scl-index.json";

const mcpLines = [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bench","version":"1"}}}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scl_callers","arguments":{"fn":"buildIndex"}}}',
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"scl_deps","arguments":{"file":"src/cli.ts"}}}',
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"scl_functions","arguments":{"name":"parseFile"}}}',
].join("\n");

const mcpOut = execSync(
  `node C:/SCL/dist/mcp.js`,
  { input: mcpLines, env: { ...process.env, SCL_INDEX: "C:/SCL/scl-index.json" } }
).toString();

const toolNames = { 2: "scl_callers", 3: "scl_deps", 4: "scl_functions" };
const sclDetails = mcpOut
  .split("\n")
  .filter((l) => l.match(/"id":(2|3|4)/))
  .map((l) => {
    const obj = JSON.parse(l);
    const text = obj.result.content[0].text;
    return { tool: toolNames[obj.id], chars: text.length, tokens: toTokens(text.length) };
  });

const sclTotalChars = sclDetails.reduce((s, t) => s + t.chars, 0);
const sclTotalTokens = toTokens(sclTotalChars);

// ── Output ────────────────────────────────────────────────────────────────
const saved = rawTotalTokens - sclTotalTokens;
const pct = ((saved / rawTotalTokens) * 100).toFixed(1);
const ratio = (rawTotalTokens / sclTotalTokens).toFixed(1);

console.log(JSON.stringify({
  task: TASK,
  approach_a_raw: {
    files: fileDetails,
    total_chars: rawTotalChars,
    total_tokens: rawTotalTokens,
  },
  approach_b_scl: {
    tools: sclDetails,
    total_chars: sclTotalChars,
    total_tokens: sclTotalTokens,
  },
  verdict: {
    tokens_saved: saved,
    reduction_pct: parseFloat(pct),
    ratio: `${ratio}x fewer tokens with SCL`,
  },
}, null, 2));
