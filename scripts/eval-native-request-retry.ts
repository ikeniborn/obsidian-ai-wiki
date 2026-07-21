#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { lifecycleEvent } from "../src/llm-lifecycle";
import { createNativeOpenAiClient } from "../src/native-openai-client";
import { createNativeOpenAiFetch } from "../src/native-openai-transport";
import { executeNativeLlmRequest } from "../src/native-llm-executor";
import { classifyNativeRetry } from "../src/native-request-retry";
import type { RunEvent } from "../src/types";

register(new URL("../tests/md-obsidian-loader.mjs", import.meta.url));

const CONNECTION_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

const SynthesisSchema = z.object({
  reasoning: z.string(),
  actions: z.array(z.object({
    action: z.string(),
    target: z.string(),
  }).strict()),
  skips: z.array(z.string()),
}).strict();

const SYNTHESIS_MESSAGES = [
  {
    role: "system" as const,
    content: "Return a compact synthetic wiki synthesis decision that matches the supplied JSON schema.",
  },
  {
    role: "user" as const,
    content: "For a synthetic source, return brief reasoning with empty `actions` and `skips` arrays.",
  },
];

export interface NativeRequestRetryEvalOptions {
  baseUrl: string;
  model: string;
  apiKeyFile: string;
  out: string;
}

export interface NativeRequestRetryEvalEvidence {
  endpointPath: string;
  model: string;
  httpStatus: number;
  durationMs: number;
  completed: boolean;
  exceededConnectionTimeoutMs: boolean;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  transport: "direct";
  attempts: number;
  retryEvents: Array<{
    kind: "transport_retry_scheduled" | "transport_retry_recovered" | "transport_retry_exhausted";
    attempt: number;
    maxRetries: number;
    lifecycleId: string;
    errorClass?: string;
    status?: number;
    delayMs?: number;
    delaySource?: "retry-after-ms" | "retry-after" | "backoff";
    meaningfulOutputSeen: boolean;
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
  }>;
  logicalRequestId: string;
  lifecycleIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function chatCompletionsPath(baseUrl: string): string {
  const url = new URL(baseUrl);
  const prefix = url.pathname.replace(/\/+$/, "");
  return `${prefix}/chat/completions`.replace(/\/{2,}/g, "/");
}

function retryEvidence(event: RunEvent): NativeRequestRetryEvalEvidence["retryEvents"][number] | null {
  if (
    event.kind !== "transport_retry_scheduled"
    && event.kind !== "transport_retry_recovered"
    && event.kind !== "transport_retry_exhausted"
  ) return null;
  return {
    kind: event.kind,
    attempt: event.attempt,
    maxRetries: event.maxRetries,
    lifecycleId: event.lifecycleId,
    ...(event.errorClass === undefined ? {} : { errorClass: event.errorClass }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
    ...(event.delaySource === undefined ? {} : { delaySource: event.delaySource }),
    meaningfulOutputSeen: event.meaningfulOutputSeen,
    connectionTimeoutMs: event.connectionTimeoutMs,
    idleTimeoutMs: event.idleTimeoutMs,
  };
}

async function persistEvidence(
  out: string,
  evidence: NativeRequestRetryEvalEvidence,
): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export async function runNativeRequestRetryEval(
  options: NativeRequestRetryEvalOptions,
): Promise<NativeRequestRetryEvalEvidence> {
  if (!options.baseUrl || !options.model || !options.apiKeyFile || !options.out) {
    throw new Error("baseUrl, model, apiKeyFile, and out are required");
  }
  if (
    typeof createNativeOpenAiFetch !== "function"
    || typeof executeNativeLlmRequest !== "function"
  ) {
    throw new Error("production native request seams are unavailable");
  }

  const runtime = globalThis as typeof globalThis & { require?: NodeJS.Require };
  runtime.require ??= createRequire(import.meta.url);
  const apiKey = (await readFile(options.apiKeyFile, "utf8")).trim();
  if (!apiKey) throw new Error("API key file is empty");

  const logicalRequestId = `eval-${randomUUID()}`;
  const events: RunEvent[] = [];
  let httpStatus = 0;
  const onEvent = (event: RunEvent): void => {
    if (event.kind === "llm_lifecycle") {
      if (event.phase === "producing" || event.phase === "validating") httpStatus = 200;
      events.push(event);
    } else if (
      event.kind === "transport_retry_scheduled"
      || event.kind === "transport_retry_recovered"
      || event.kind === "transport_retry_exhausted"
    ) {
      events.push(event);
    }
  };
  const signal = new AbortController().signal;
  const client = createNativeOpenAiClient({
    baseURL: options.baseUrl,
    apiKey,
    connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    isMobile: false,
    proxyConfig: { enabled: false, url: "" },
    mobileFetch: globalThis.fetch,
  });
  const startedAt = Date.now();
  let completed = false;
  let failureDiagnostic: { errorClass: string; status?: number } | undefined;
  try {
    const { runStructuredWithRetry } = await import("../src/phases/structured-output");
    const result = await runStructuredWithRetry({
      llm: client,
      model: options.model,
      baseMessages: SYNTHESIS_MESSAGES,
      opts: {
        temperature: 0,
        maxTokens: 256,
        jsonMode: "json_schema",
        nativeRequestRetries: MAX_RETRIES,
        nativeRequestIdleTimeoutMs: IDLE_TIMEOUT_MS,
      },
      profile: {
        kind: "json-zod",
        schema: SynthesisSchema,
      },
      maxRetries: 1,
      callSite: "ingest.synthesize",
      lifecycle: { id: logicalRequestId, action: "synthesize_wiki_pages" },
      signal,
      onEvent,
      transport: "non-stream",
    });
    httpStatus = 200;
    onEvent(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, "applying", Date.now()));
    onEvent(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, "completed", Date.now()));
    completed = true;
  } catch (error) {
    const decision = classifyNativeRetry(error);
    if (httpStatus === 0) httpStatus = decision.status ?? 0;
    failureDiagnostic = {
      errorClass: decision.errorClass,
      ...(decision.status === undefined ? {} : { status: decision.status }),
    };
  }

  const durationMs = Date.now() - startedAt;
  const retryEvents = events.flatMap((event) => {
    const sanitized = retryEvidence(event);
    return sanitized === null ? [] : [sanitized];
  });
  const lifecycleIds = [...new Set(events.flatMap((event) =>
    event.kind === "llm_lifecycle" && event.phase === "preparing" ? [event.id] : []))];
  const evidence: NativeRequestRetryEvalEvidence = {
    endpointPath: chatCompletionsPath(options.baseUrl),
    model: options.model,
    httpStatus,
    durationMs,
    completed,
    exceededConnectionTimeoutMs: durationMs > CONNECTION_TIMEOUT_MS,
    connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    transport: "direct",
    attempts: lifecycleIds.length,
    retryEvents,
    logicalRequestId,
    lifecycleIds,
  };
  await persistEvidence(options.out, evidence);
  if (!completed) {
    throw Object.assign(
      new Error("Native request retry eval failed; metadata evidence was written"),
      { diagnostic: failureDiagnostic },
    );
  }
  return evidence;
}

function parseArgs(args: string[]): NativeRequestRetryEvalOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Invalid eval arguments");
    }
    values.set(flag, value);
  }
  const baseUrl = values.get("--base-url");
  const model = values.get("--model");
  const apiKeyFile = values.get("--api-key-file");
  const out = values.get("--out");
  if (
    values.size !== 4
    || !baseUrl
    || !model
    || !apiKeyFile
    || !out
  ) {
    throw new Error(
      "Usage: tsx scripts/eval-native-request-retry.ts --base-url <url> --model <model> --api-key-file <path> --out <path>",
    );
  }
  return { baseUrl, model, apiKeyFile, out };
}

async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const evidence = await runNativeRequestRetryEval(options);
  console.log(JSON.stringify({
    out: options.out,
    httpStatus: evidence.httpStatus,
    durationMs: evidence.durationMs,
    completed: evidence.completed,
    attempts: evidence.attempts,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const diagnostic = isRecord(error) && isRecord(error.diagnostic)
      ? error.diagnostic
      : undefined;
    const category = typeof diagnostic?.errorClass === "string"
      ? diagnostic.errorClass
      : "unknown";
    const status = typeof diagnostic?.status === "number"
      ? ` status=${diagnostic.status}`
      : "";
    console.error(`[eval-native-request-retry] failed category=${category}${status}; inspect metadata output when present`);
    process.exitCode = 1;
  });
}
