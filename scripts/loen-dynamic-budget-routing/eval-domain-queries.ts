#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveEffective } from "../../src/effective-settings";
import type { LocalConfig } from "../../src/local-config";
import { createNativeOpenAiClient } from "../../src/native-openai-client";
import type { RunEvent } from "../../src/types";
import { VaultTools } from "../../src/vault-tools";
import {
  FsVaultAdapter,
  loadDomains,
  mergeSettings,
  readJson,
  safeJoin,
} from "../eval-isolated-reinit";
import { requestUrl as headlessRequestUrl } from "./obsidian-headless-shim";

interface QueryCase {
  id: string;
  question: string;
  expectedPages: string[];
  requiredFacts: string[][];
}

interface Options {
  vault: string;
  pluginDir: string;
  domain: string;
  cases: string;
  apiKeyFile?: string;
  out: string;
  events: string;
  limit?: number;
}

interface QueryResult {
  id: string;
  question: string;
  status: "done" | "error" | "timeout";
  durationMs: number;
  answer: string;
  foundPages: string[];
  foundChunks: Array<{ articleId?: string; heading?: string; score?: number }>;
  expectedPages: string[];
  expectedPageHits: string[];
  retrievalHitAtK: boolean;
  expectedPageRecall: number;
  requiredFactPasses: boolean[];
  requiredFactCoverage: number;
  wikiLinks: string[];
  invalidWikiLinks: string[];
  wikiLinkPrecision: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  transportRetries: number;
  structuralRetries: number;
  validationRetries: number;
  groundingSanitizations: number;
  networkTransports: string[];
  error?: string;
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Invalid arguments");
    }
    values.set(flag, value);
  }
  const vault = values.get("--vault");
  const domain = values.get("--domain");
  const cases = values.get("--cases");
  const out = values.get("--out");
  const events = values.get("--events");
  if (!vault || !domain || !cases || !out || !events) {
    throw new Error("Usage: tsx eval-domain-queries.ts --vault <vault> --domain <id> --cases <json> --out <json> --events <jsonl> [--plugin-dir <dir>] [--api-key-file <path>] [--limit <n>]");
  }
  const limitValue = values.get("--limit");
  return {
    vault: path.resolve(vault),
    domain,
    cases: path.resolve(cases),
    out: path.resolve(out),
    events: path.resolve(events),
    pluginDir: values.get("--plugin-dir") ?? ".obsidian/plugins/ai-wiki",
    apiKeyFile: values.get("--api-key-file"),
    ...(limitValue === undefined ? {} : { limit: Math.max(0, Number.parseInt(limitValue, 10)) }),
  };
}

function normalized(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function pageIdFromFile(name: string): string {
  return name.replace(/\.md$/i, "");
}

async function validPageIds(vaultRoot: string, domainId: string): Promise<Set<string>> {
  const root = path.join(vaultRoot, "!Wiki", domainId);
  const ids = new Set<string>();
  for (const folder of await readdir(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const file of await readdir(path.join(root, folder.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith(".md")) ids.add(pageIdFromFile(file.name));
    }
  }
  return ids;
}

function answerWikiLinks(answer: string): string[] {
  return unique([...answer.matchAll(/!?\[\[([^\]]+)\]\]/g)]
    .map((match) => match[1].split("|")[0].split("#")[0].trim()));
}

function finalResult(
  testCase: QueryCase,
  events: RunEvent[],
  startedAt: number,
  validPages: Set<string>,
  caught?: unknown,
): QueryResult {
  const evalMeta = events.filter((event) => event.kind === "eval_meta").at(-1);
  const result = events.filter((event) => event.kind === "result").at(-1);
  const errorEvent = events.find((event) => event.kind === "error");
  const fields = evalMeta?.kind === "eval_meta" ? evalMeta.fields : {};
  const foundPages = Array.isArray(fields.found_pages)
    ? fields.found_pages.filter((value): value is string => typeof value === "string")
    : [];
  const foundChunks = Array.isArray(fields.found_chunks)
    ? fields.found_chunks.filter((value): value is QueryResult["foundChunks"][number] => !!value && typeof value === "object")
    : [];
  const answer = typeof fields.answer === "string"
    ? fields.answer
    : result?.kind === "result" ? result.text : "";
  const answerText = normalized(answer);
  const expectedPageHits = testCase.expectedPages.filter((page) => foundPages.includes(page));
  const requiredFactPasses = testCase.requiredFacts.map((alternatives) =>
    alternatives.some((alternative) => answerText.includes(normalized(alternative))));
  const wikiLinks = answerWikiLinks(answer);
  const invalidWikiLinks = wikiLinks.filter((target) => !validPages.has(target));
  const stats = events.filter((event) => event.kind === "llm_call_stats");
  const networkTransports = unique(events.flatMap((event) =>
    event.kind === "native_http_response" && event.networkTransport ? [event.networkTransport] : []));
  const timeout = caught instanceof Error && (caught.name === "AbortError" || /timeout/i.test(caught.message));
  const error = caught instanceof Error ? caught.message
    : errorEvent?.kind === "error" ? errorEvent.message
    : undefined;
  return {
    id: testCase.id,
    question: testCase.question,
    status: answer && !error ? "done" : timeout ? "timeout" : "error",
    durationMs: Date.now() - startedAt,
    answer,
    foundPages,
    foundChunks,
    expectedPages: testCase.expectedPages,
    expectedPageHits,
    retrievalHitAtK: expectedPageHits.length > 0,
    expectedPageRecall: ratio(expectedPageHits.length, testCase.expectedPages.length),
    requiredFactPasses,
    requiredFactCoverage: ratio(requiredFactPasses.filter(Boolean).length, requiredFactPasses.length),
    wikiLinks,
    invalidWikiLinks,
    wikiLinkPrecision: ratio(wikiLinks.length - invalidWikiLinks.length, wikiLinks.length),
    llmCalls: stats.length,
    inputTokens: stats.reduce((sum, event) => sum + (event.kind === "llm_call_stats" ? event.inputTokens : 0), 0),
    outputTokens: stats.reduce((sum, event) => sum + (event.kind === "llm_call_stats" ? event.outputTokens : 0), 0),
    transportRetries: events.filter((event) => event.kind === "transport_retry_scheduled").length,
    structuralRetries: events.filter((event) => event.kind === "structural_error").length,
    validationRetries: events.filter((event) =>
      event.kind === "structured_validation_retry"
      || (event.kind === "tool_use" && event.name === "RepairGrounding")).length,
    groundingSanitizations: events.filter((event) =>
      event.kind === "tool_use" && event.name === "SanitizeGrounding").length,
    networkTransports,
    ...(error ? { error } : {}),
  };
}

async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const runtime = globalThis as typeof globalThis & {
    require?: NodeJS.Require;
    window?: typeof globalThis;
    __obsidianRequestUrlForTest?: typeof headlessRequestUrl;
  };
  runtime.require ??= createRequire(import.meta.url);
  runtime.window ??= globalThis;
  runtime.__obsidianRequestUrlForTest ??= headlessRequestUrl;
  const { AgentRunner } = await import("../../src/agent-runner");

  const adapter = new FsVaultAdapter(options.vault);
  const vaultTools = new VaultTools(adapter, options.vault);
  const data = await readJson(safeJoin(options.vault, `${options.pluginDir}/data.json`));
  const local = {
    iclaudePath: "",
    ...((await readJson(safeJoin(options.vault, `${options.pluginDir}/local.json`)) ?? {}) as Partial<LocalConfig>),
  };
  const settings = resolveEffective(mergeSettings(data), local);
  if (options.apiKeyFile) settings.nativeAgent.apiKey = (await readFile(options.apiKeyFile, "utf8")).trim();
  if (settings.backend !== "native-agent") throw new Error(`Expected native-agent, got ${settings.backend}`);
  if (!settings.nativeAgent.apiKey) throw new Error("Native API key is empty");

  const domains = await loadDomains(adapter);
  if (!domains.some((domain) => domain.id === options.domain)) throw new Error(`Domain not found: ${options.domain}`);
  const cases = JSON.parse(await readFile(options.cases, "utf8")) as QueryCase[];
  const validPages = await validPageIds(options.vault, options.domain);
  const llm = createNativeOpenAiClient({
    baseURL: settings.nativeAgent.baseUrl,
    apiKey: settings.nativeAgent.apiKey,
    connectionTimeoutMs: settings.llmConnectionTimeoutSec * 1000,
    idleTimeoutMs: settings.llmIdleTimeoutSec * 1000,
    isMobile: false,
    proxyConfig: settings.proxy,
    mobileFetch: globalThis.fetch,
  });
  const runner = new AgentRunner(llm, settings, vaultTools, path.basename(options.vault), domains, undefined, false);

  await mkdir(path.dirname(options.out), { recursive: true });
  await mkdir(path.dirname(options.events), { recursive: true });
  let prior: { results?: QueryResult[] } = {};
  try {
    prior = JSON.parse(await readFile(options.out, "utf8")) as { results?: QueryResult[] };
  } catch {
    await writeFile(options.events, "", "utf8");
  }
  const results = prior.results ?? [];
  const completedIds = new Set(results.map((result) => result.id));
  const pending = cases.filter((testCase) => !completedIds.has(testCase.id));
  const selected = options.limit === undefined ? pending : pending.slice(0, options.limit);

  for (const [offset, testCase] of selected.entries()) {
    const startedAt = Date.now();
    const events: RunEvent[] = [];
    const controller = new AbortController();
    const timeoutMs = (settings.timeouts.query || 600) * 1000;
    const timeout = setTimeout(() => controller.abort(new DOMException(`Query timeout after ${timeoutMs}ms`, "AbortError")), timeoutMs);
    let caught: unknown;
    try {
      for await (const event of runner.run({
        operation: "query",
        args: [testCase.question],
        cwd: options.vault,
        signal: controller.signal,
        timeoutMs,
        domainId: options.domain,
      })) {
        events.push(event);
        await writeFile(options.events, `${JSON.stringify({
          ts: new Date().toISOString(),
          caseId: testCase.id,
          caseIndex: cases.findIndex((candidate) => candidate.id === testCase.id),
          event,
        })}\n`, { encoding: "utf8", flag: "a" });
      }
    } catch (error) {
      caught = error;
    } finally {
      clearTimeout(timeout);
    }
    const evaluated = finalResult(testCase, events, startedAt, validPages, caught);
    results.push(evaluated);
    const orderedResults = [...results].sort((a, b) =>
      cases.findIndex((candidate) => candidate.id === a.id)
      - cases.findIndex((candidate) => candidate.id === b.id));
    await writeFile(options.out, `${JSON.stringify({
      domain: options.domain,
      vault: options.vault,
      model: settings.nativeAgent.operations.query.model || settings.nativeAgent.model,
      transport: llm.nativeTransportDiagnostic,
      querySettings: {
        graphDepth: settings.graphDepth,
        seedTopK: settings.seedTopK,
        seedMinScore: settings.seedMinScore,
        bfsTopK: settings.bfsTopK,
        seedSimilarityThreshold: settings.nativeAgent.seedSimilarityThreshold,
        bfsFusion: settings.nativeAgent.bfsFusion,
        bfsMinScoreRatio: settings.nativeAgent.bfsMinScoreRatio,
        rerankerEnabled: settings.nativeAgent.rerankerEnabled,
        rerankerTopN: settings.nativeAgent.rerankerTopN,
        contextTopN: settings.nativeAgent.contextTopN,
        inputBudgetTokens: settings.nativeAgent.operations.query.inputBudgetTokens,
        maxTokens: settings.nativeAgent.operations.query.maxTokens,
      },
      results: orderedResults,
    }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      progress: completedIds.size + offset + 1,
      total: cases.length,
      id: evaluated.id,
      status: evaluated.status,
      durationMs: evaluated.durationMs,
      foundPages: evaluated.foundPages,
      expectedPageRecall: evaluated.expectedPageRecall,
      requiredFactCoverage: evaluated.requiredFactCoverage,
      wikiLinkPrecision: evaluated.wikiLinkPrecision,
      retries: evaluated.transportRetries + evaluated.structuralRetries + evaluated.validationRetries,
      error: evaluated.error,
    }));
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`[eval-domain-queries] ${(error as Error).stack ?? (error as Error).message}`);
  process.exitCode = 1;
});
