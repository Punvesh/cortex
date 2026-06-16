import fs from "fs";
import path from "path";
import os from "os";
import type { AnalyticsStore, ToolCall } from "./types.js";

// Tokens avoided per tool call — calibrated from the benchmark
const TOKEN_COST: Record<string, number> = {
  cortex_callers:      220,
  cortex_deps:         180,
  cortex_symbols:      150,
  cortex_functions:    120,
  cortex_search:       300,
  cortex_context:      600,
  cortex_architecture: 500,
  cortex_impact:       800,
  cortex_repo_map:     400,
  cortex_path:         200,
  cortex_cycles:       250,
  cortex_git_impact:   600,
  cortex_health:        20,
};

const STORE_PATH = path.join(os.homedir(), ".cortex", "analytics.json");

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadAnalytics(): AnalyticsStore {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    return { calls: [], totalTokensAvoided: 0, totalCalls: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as AnalyticsStore;
  } catch {
    return { calls: [], totalTokensAvoided: 0, totalCalls: 0 };
  }
}

export function recordCall(tool: string, durationMs: number): void {
  try {
    const store = loadAnalytics();
    const tokensAvoided = TOKEN_COST[tool] ?? 100;
    const call: ToolCall = { tool, timestamp: new Date().toISOString(), durationMs, tokensAvoided };

    store.calls.push(call);
    // Keep last 10000 calls
    if (store.calls.length > 10000) store.calls = store.calls.slice(-10000);
    store.totalTokensAvoided += tokensAvoided;
    store.totalCalls += 1;

    fs.writeFileSync(STORE_PATH, JSON.stringify(store));
  } catch {
    // Never let analytics crash the tool
  }
}

export interface AnalyticsSummary {
  totalCalls: number;
  totalTokensAvoided: number;
  estimatedSavingsUSD: number;  // at $3/1M tokens (Sonnet)
  topTools: Array<{ tool: string; calls: number; tokensAvoided: number }>;
  callsPerDay: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export function summarize(): AnalyticsSummary {
  const store = loadAnalytics();
  const byTool = new Map<string, { calls: number; tokensAvoided: number }>();

  for (const call of store.calls) {
    const entry = byTool.get(call.tool) ?? { calls: 0, tokensAvoided: 0 };
    entry.calls++;
    entry.tokensAvoided += call.tokensAvoided ?? 0;
    byTool.set(call.tool, entry);
  }

  const topTools = [...byTool.entries()]
    .map(([tool, v]) => ({ tool, ...v }))
    .sort((a, b) => b.calls - a.calls);

  const firstCall = store.calls[0];
  const lastCall = store.calls[store.calls.length - 1];
  const daysSince = firstCall
    ? Math.max(1, (Date.now() - new Date(firstCall.timestamp).getTime()) / 86400000)
    : 1;

  return {
    totalCalls: store.totalCalls,
    totalTokensAvoided: store.totalTokensAvoided,
    estimatedSavingsUSD: parseFloat(((store.totalTokensAvoided / 1_000_000) * 3).toFixed(4)),
    topTools,
    callsPerDay: parseFloat((store.totalCalls / daysSince).toFixed(1)),
    firstSeen: firstCall?.timestamp ?? null,
    lastSeen: lastCall?.timestamp ?? null,
  };
}
