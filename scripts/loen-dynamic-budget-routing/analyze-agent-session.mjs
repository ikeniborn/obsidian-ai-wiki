#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const vaultRoot = process.env.AIWIKI_TEST_VAULT
  ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run";
const logPath = process.env.AIWIKI_AGENT_LOG
  ?? path.join(vaultRoot, ".obsidian/plugins/ai-wiki/agent.jsonl");
const evidenceDir = path.resolve("docs/loen/dynamic-llm-budget-routing/evidence");
const session = process.argv[2];
const variant = process.argv[3] ?? "unknown";
if (!session) {
  console.error("usage: analyze-agent-session.mjs <session-id> [variant]");
  process.exit(2);
}

function parseTs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function finalStatus(systems) {
  const finish = systems.find((message) => message.startsWith("finish status="));
  if (!finish) return "running";
  const match = finish.match(/^finish status=([^ ]+)/);
  return match?.[1] ?? "unknown";
}

function createdPages(results) {
  let total = 0;
  for (const text of results) {
    const match = text.match(/создано\s+(\d+)/);
    if (match) total += Number(match[1]);
  }
  return total;
}

function updatedPages(results) {
  let total = 0;
  for (const text of results) {
    const match = text.match(/обновлено\s+(\d+)/);
    if (match) total += Number(match[1]);
  }
  return total;
}

function percentile(values, quantile) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

fs.mkdirSync(evidenceDir, { recursive: true });
const rows = fs.readFileSync(logPath, "utf8").trim().split(/\n/)
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean)
  .filter((row) => row.session === session);
if (rows.length === 0) throw new Error(`no rows for session ${session}`);

const firstMs = parseTs(rows[0].ts);
const systems = [];
const results = [];
const structural = [];
const structuredValidation = [];
const semanticValidation = [];
const transportRetries = [];
const transportRecovered = [];
const llmStats = [];
const promptBudgets = [];
const httpResponses = [];
let runConfig;
let firstRequest;
let firstHttp;
let firstFile;
let firstPromptBudget;
let finalError;

for (const row of rows) {
  const event = row.event ?? {};
  if (event.kind === "system") systems.push(event.message ?? "");
  if (event.kind === "run_config") runConfig = event;
  if (event.kind === "llm_request_fingerprint" && !firstRequest) firstRequest = { ts: row.ts, ...event };
  if (event.kind === "native_http_response" && !firstHttp) firstHttp = { ts: row.ts, ...event };
  if (event.kind === "file_start" && !firstFile) firstFile = { ts: row.ts, ...event };
  if (event.kind === "prompt_budget" && !firstPromptBudget) firstPromptBudget = { ts: row.ts, ...event };
  if (event.kind === "prompt_budget") promptBudgets.push(event);
  if (event.kind === "llm_call_stats") llmStats.push(event);
  if (event.kind === "native_http_response") httpResponses.push(event);
  if (event.kind === "structural_error" && event.succeeded !== true) structural.push({ ts: row.ts, ...event });
  if (event.kind === "structured_validation_retry") structuredValidation.push({ ts: row.ts, ...event });
  if (event.kind === "semantic_validation_retry") semanticValidation.push({ ts: row.ts, ...event });
  if (event.kind === "transport_retry_scheduled") transportRetries.push({ ts: row.ts, ...event });
  if (event.kind === "transport_retry_recovered") transportRecovered.push({ ts: row.ts, ...event });
  if (event.kind === "result") results.push(event.text ?? "");
  if (event.kind === "error") finalError = event.message ?? "";
}

const firstHttpMs = firstMs !== undefined && firstHttp ? parseTs(firstHttp.ts) - firstMs : undefined;
const firstFileMs = firstMs !== undefined && firstFile ? parseTs(firstFile.ts) - firstMs : undefined;
const callSites = Object.fromEntries([...new Set(promptBudgets.map((event) => event.callSite))]
  .sort()
  .map((callSite) => [callSite, promptBudgets.filter((event) => event.callSite === callSite).length]));
const latencies = llmStats.map((event) => event.llmDurationMs).filter(Number.isFinite);
const output = {
  variant,
  session,
  firstTs: rows[0].ts,
  lastTs: rows.at(-1).ts,
  status: finalStatus(systems),
  diagnosticMode: runConfig?.nativeTransport?.diagnosticMode,
  transport: runConfig?.nativeTransport?.transport,
  firstRequest: firstRequest && {
    callSite: firstRequest.callSite,
    requestId: firstRequest.requestId,
    estimatedInputTokens: firstRequest.estimatedInputTokens,
    outputBudget: firstRequest.outputBudget,
    responseFormatType: firstRequest.responseFormatType,
    hash: firstRequest.preparedMessagesHash,
  },
  firstHttpMs,
  firstFileMs,
  firstPromptBudget: firstPromptBudget && {
    estimatedInputTokens: firstPromptBudget.estimatedInputTokens,
    outputBudget: firstPromptBudget.outputBudget,
    actualInputTokens: firstPromptBudget.actualInputTokens,
  },
  transportRetries: transportRetries.length,
  transportRecovered: transportRecovered.length,
  structuralRetries: structural.length,
  structuredValidationRetries: structuredValidation.length,
  semanticValidationRetries: semanticValidation.length,
  structuralSummary: structural.map((event) => `${event.callSite}:${event.errorType}:${event.message}`).slice(0, 12),
  llmCalls: llmStats.length,
  httpResponses: httpResponses.length,
  httpStatusCounts: Object.fromEntries([...new Set(httpResponses.map((event) => String(event.status)))]
    .sort()
    .map((status) => [status, httpResponses.filter((event) => String(event.status) === status).length])),
  callsBySite: callSites,
  inputTokens: llmStats.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
  outputTokens: llmStats.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
  latencyMs: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length > 0 ? Math.max(...latencies) : undefined,
    sum: latencies.reduce((sum, value) => sum + value, 0),
  },
  maxEstimatedInputTokens: promptBudgets.length > 0
    ? Math.max(...promptBudgets.map((event) => event.estimatedInputTokens ?? 0))
    : undefined,
  maxActualInputTokens: promptBudgets.length > 0
    ? Math.max(...promptBudgets.map((event) => event.actualInputTokens ?? 0))
    : undefined,
  outputBudgets: [...new Set(promptBudgets.map((event) => event.outputBudget).filter(Number.isFinite))].sort((a, b) => a - b),
  createdPages: createdPages(results),
  updatedPages: updatedPages(results),
  resultTexts: results,
  finalError,
};

const outPath = path.join(evidenceDir, `${variant}-${session}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outPath, output }, null, 2));
