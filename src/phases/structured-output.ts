import type OpenAI from "openai";
import type { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import { structuralErrorCounter } from "../structural-error-counter";
import { render } from "./template";

const baseContract = [
  "You are a wiki agent. Follow these rules regardless of the operation.",
  "",
  "## Faithfulness",
  "Answer strictly based on the provided context.",
  "Do not invent facts that are not in the source.",
  "If the context is insufficient — say so directly.",
  "",
  "## Format",
  "Return exactly what is requested.",
  "If JSON is expected — only valid JSON, with no surrounding explanations.",
  "If text is expected — no service markers or technical artifacts.",
  "",
  "## Minimalism",
  "Do not add anything that was not requested.",
  "Do not comment on your own actions unless that is part of the task.",
  "",
  "## Terms",
  "Render ALL natural-language content in the output language — including text quoted or",
  "copied from the source: sentences, descriptions, summaries, notes, examples, and field",
  "values, even when the source is in another language (e.g. CJK). A multi-word phrase or",
  "sentence is prose, not a term — translate it.",
  "Preserve verbatim (do NOT translate) ONLY these atomic items, wherever they appear",
  "(including inside quotes, tables, and field values): code and fenced code blocks, file",
  "paths, identifiers, commands, product/proper names, abbreviations, and Obsidian embeds",
  "(`[[...]]`, `![[...]]`).",
  "When in doubt, translate.",
].join("\n");

const repairJson = [
  "{{detail}}",
  "",
  "Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.",
].join("\n");

const JSON_FALLBACK_INNER = Symbol.for("obsidian-ai-wiki.jsonFallbackInner");

export type StructuredCallSite =
  | "init.bootstrap"
  | "init.delta"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds" | "query.answer"
  | "ingest.entities"
  | "ingest.pages"
  | "ingest.merge"
  | "format.output";

type ResponseFormatMode = "json_schema" | "json_object" | "none";

export type StructuredProfile<T> =
  | { kind: "json-zod"; schema: z.ZodSchema<T> }
  | {
      kind: "framed-zod";
      schema: z.ZodSchema<T>;
      parse: (text: string) => unknown;
      repairInstruction: string;
    };

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: StructuredCallSite,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = "StructuredValidationError";
  }
}

export interface RunStructuredArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  profile: StructuredProfile<T>;
  maxRetries: number;
  callSite: StructuredCallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export interface RunStructuredResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;
}

interface CallResult {
  fullText: string;
  outputTokens: number;
  statsEvent?: RunEvent;
}

interface LlmStreamStats {
  inputTokens: number;
  outputTokens: number;
  ttftMs: number;
  llmDurationMs: number;
}

function fallbackMode(mode: ResponseFormatMode): ResponseFormatMode | null {
  if (mode === "json_schema") return "json_object";
  if (mode === "json_object") return "none";
  return null;
}

function emitStructuralError(
  onEvent: (ev: RunEvent) => void,
  callSite: StructuredCallSite,
  errorType: Extract<RunEvent, { kind: "structural_error" }>["errorType"],
  retryAttempt: number,
  succeeded: boolean | null,
  message: string,
): void {
  onEvent({ kind: "structural_error", callSite, errorType, retryAttempt, succeeded, message });
}

function emitResponseFormatFallback(
  onEvent: (ev: RunEvent) => void,
  callSite: StructuredCallSite,
  retryAttempt: number,
  from: ResponseFormatMode,
  to: ResponseFormatMode,
): void {
  emitStructuralError(
    onEvent,
    callSite,
    "response_format_fallback",
    retryAttempt,
    null,
    `${from} -> ${to}`,
  );
}

function langInstruction(lang: "ru" | "en" | "es"): string {
  switch (lang) {
    case "ru": return "Write the entire response in Russian. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "en": return "Write the entire response in English. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "es": return "Write the entire response in Spanish. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
  }
}

function resolveLang(outputLanguage: LlmCallOptions["outputLanguage"] | undefined): "ru" | "en" | "es" {
  return outputLanguage === "ru" || outputLanguage === "es" ? outputLanguage : "en";
}

function resolveReasoningLang(
  reasoningLanguage: LlmCallOptions["reasoningLanguage"] | undefined,
  outputLanguage: LlmCallOptions["outputLanguage"] | undefined,
): "ru" | "en" | "es" {
  if (reasoningLanguage === "ru" || reasoningLanguage === "en" || reasoningLanguage === "es") return reasoningLanguage;
  if (reasoningLanguage === "auto") return resolveLang(outputLanguage);
  return "en";
}

function reasoningDirective(lang: "ru" | "en" | "es"): string {
  const name = { ru: "Russian", en: "English", es: "Spanish" }[lang];
  return [
    "## Reasoning language",
    `Reason and think exclusively in ${name}.`,
    `Do not switch the reasoning language to match the source notes, user input, or quoted text, even when those are written in another language.`,
    `This rule also governs the \`reasoning\` field of any JSON output: write that field in ${name} as well.`,
  ].join("\n");
}

function injectSection(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  section: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}

function prependBaseContract(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${baseContract}\n\n${existing}` };
    return updated;
  }
  return [{ role: "system", content: baseContract }, ...messages];
}

function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  stream = false,
): Record<string, unknown> {
  let msgs = prependBaseContract(messages);
  if (opts.outputLanguage) {
    msgs = injectSection(msgs, `## Language\n${langInstruction(resolveLang(opts.outputLanguage))}`);
  }
  msgs = injectSection(msgs, reasoningDirective(resolveReasoningLang(opts.reasoningLanguage, opts.outputLanguage)));
  if (opts.systemPrompt) msgs = injectSection(msgs, `## Clarification\n${opts.systemPrompt}`);

  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (stream) params.stream_options = { include_usage: true };
  if (opts.jsonMode === "json_schema" && opts.jsonSchema) {
    params.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: false },
    };
  } else if (opts.jsonMode === "json_object") {
    params.response_format = { type: "json_object" };
  }
  if (opts.thinkingBudgetTokens && opts.thinkingBudgetTokens > 0) {
    params.thinking = { type: "enabled", budget_tokens: opts.thinkingBudgetTokens };
    delete params.response_format;
    delete params.temperature;
    delete params.top_p;
  }
  return params;
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  return fenced ? fenced[1].trim() : text;
}

function parseStructured(fullText: string): unknown {
  const text = fullText.trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const stripped = stripFences(stripThinking(text));
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  if (stripped.includes("{")) {
    try { return JSON.parse(jsonrepair(stripped)); } catch { /* fall through */ }
  }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  try { return JSON.parse(match[0]); } catch (e) {
    const posMatch = String((e as Error).message).match(/at position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      if (pos > 0) return JSON.parse(match[0].slice(0, pos));
    }
    throw e;
  }
}

function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): { content: string; outputTokens?: number; inputTokens?: number } {
  const delta = chunk.choices[0]?.delta;
  const usage = (chunk as unknown as { usage?: { completion_tokens?: number; prompt_tokens?: number } }).usage;
  const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  return {
    content: typeof delta?.content === "string" ? delta.content : "",
    outputTokens,
    inputTokens,
  };
}

function extractUsage(resp: OpenAI.Chat.ChatCompletion): number | undefined {
  const tok = resp.usage?.completion_tokens;
  return typeof tok === "number" ? tok : undefined;
}

function wrapStreamWithStats(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  requestStartMs: number,
): { stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>; getStats: () => LlmStreamStats | undefined } {
  let ttftMs: number | undefined;
  let firstChunkMs: number | undefined;
  let llmDurationMs: number | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let yielded = false;

  async function* wrapped(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    for await (const chunk of stream) {
      if (!yielded) {
        ttftMs = Date.now() - requestStartMs;
        firstChunkMs = Date.now();
        yielded = true;
      }
      const { outputTokens: tok, inputTokens: inTok } = extractStreamDeltas(chunk);
      if (tok !== undefined) outputTokens = tok;
      if (inTok !== undefined) inputTokens = inTok;
      yield chunk;
    }
    if (yielded && firstChunkMs !== undefined) llmDurationMs = Date.now() - firstChunkMs;
  }

  return {
    stream: wrapped(),
    getStats: () => {
      if (!yielded || ttftMs === undefined || llmDurationMs === undefined) return undefined;
      const effectiveDurationMs = llmDurationMs < 10 ? ttftMs : llmDurationMs;
      return { inputTokens, outputTokens, ttftMs, llmDurationMs: effectiveDurationMs };
    },
  };
}

function buildLlmCallStatsEvent(s: LlmStreamStats): RunEvent {
  const durS = s.llmDurationMs / 1000;
  return {
    kind: "llm_call_stats",
    ...s,
    inTokPerSec: durS > 0 ? Math.round(s.inputTokens / durS) : 0,
    outTokPerSec: durS > 0 ? Math.round(s.outputTokens / durS) : 0,
  };
}

const JSON_MODE_KEYWORDS = ["response_format", "json_object", "json mode", "unsupported"];

function isJsonModeError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: unknown }).status;
  if (status !== 400 && status !== 422) return false;
  const msg = String((e as { message?: unknown }).message ?? "").toLowerCase();
  return JSON_MODE_KEYWORDS.some((kw) => msg.includes(kw));
}

function initialMode<T>(profile: StructuredProfile<T>, opts: LlmCallOptions): ResponseFormatMode {
  if (profile.kind !== "json-zod") return "none";
  return opts.jsonMode === "json_object" || opts.jsonMode === "json_schema" ? "json_schema" : "none";
}

function optsForMode<T>(
  opts: LlmCallOptions,
  mode: ResponseFormatMode,
  callSite: StructuredCallSite,
  schema: z.ZodSchema<T>,
): LlmCallOptions {
  if (mode === "none") return { ...opts, jsonMode: false, jsonSchema: undefined };
  if (mode === "json_object") return { ...opts, jsonMode: "json_object", jsonSchema: undefined };
  return {
    ...opts,
    jsonMode: "json_schema",
    jsonSchema: {
      name: callSite.replace(/\./g, "_"),
      schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
    },
  };
}

export function formatZodFeedback(err: ZodError | null, raw: string): string {
  if (err === null) {
    const detail = [
      "Previous response was not valid JSON.",
      "Raw output (truncated):",
      raw.slice(0, 2000),
    ].join("\n");
    return render(repairJson, { detail });
  }
  const bullets = err.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `- ${path}: ${i.message}`;
  }).join("\n");
  return render(repairJson, {
    detail: ["Previous response failed validation:", bullets].join("\n"),
  });
}

function repairPrompt<T>(profile: StructuredProfile<T>, lastText: string, lastError: Error): string {
  if (profile.kind === "framed-zod") {
    return [
      "Previous response did not match the required frame format.",
      lastError.message,
      profile.repairInstruction,
      "Return only the required frames. Do not add commentary outside frames.",
      "Previous response (truncated):",
      lastText.slice(0, 2000),
    ].join("\n");
  }
  return lastError instanceof ZodError
    ? formatZodFeedback(lastError, lastText)
    : formatZodFeedback(null, lastText);
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<CallResult> {
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;

  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (content) fullText += content;
      if (tok !== undefined) outputTokens = tok;
    }
    const stats = getStats();
    return {
      fullText,
      outputTokens,
      statsEvent: stats ? buildLlmCallStatsEvent(stats) : undefined,
    };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError" || isJsonModeError(e)) throw e;
    const params2 = buildChatParams(model, messages, opts);
    const resp = await llm.chat.completions.create(
      { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    return {
      fullText: resp.choices[0]?.message?.content ?? "",
      outputTokens: extractUsage(resp) ?? 0,
    };
  }
}

function parseAndValidate<T>(profile: StructuredProfile<T>, fullText: string): T {
  const raw = profile.kind === "json-zod"
    ? parseStructured(fullText)
    : profile.parse(fullText);
  const parsed = profile.schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

function classifyError<T>(profile: StructuredProfile<T>, err: Error): Extract<RunEvent, { kind: "structural_error" }>["errorType"] {
  if (profile.kind === "framed-zod" && !(err instanceof ZodError)) return "frame_parse";
  if (err instanceof ZodError) return "schema_validate";
  return "json_parse";
}

function directLlm(llm: LlmClient): LlmClient {
  return (llm as { [JSON_FALLBACK_INNER]?: LlmClient })[JSON_FALLBACK_INNER] ?? llm;
}

async function callWithFormatFallback<T>(
  args: RunStructuredArgs<T>,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  mode: ResponseFormatMode,
  attempt: number,
): Promise<{ result: CallResult; mode: ResponseFormatMode }> {
  let currentMode = mode;
  while (true) {
    const callOpts: LlmCallOptions = args.profile.kind === "json-zod"
      ? optsForMode(args.opts, currentMode, args.callSite, args.profile.schema)
      : { ...args.opts, jsonMode: false, jsonSchema: undefined };

    try {
      return {
        result: await streamOnce(directLlm(args.llm), args.model, messages, callOpts, args.signal),
        mode: currentMode,
      };
    } catch (e) {
      if (args.profile.kind !== "json-zod" || !isJsonModeError(e)) throw e;
      const next = fallbackMode(currentMode);
      if (!next) throw e;
      emitResponseFormatFallback(args.onEvent, args.callSite, attempt, currentMode, next);
      currentMode = next;
    }
  }
}

export async function runStructuredWithRetry<T>(args: RunStructuredArgs<T>): Promise<RunStructuredResult<T>> {
  const { baseMessages, profile, maxRetries, callSite, signal, onEvent } = args;
  let messages = baseMessages;
  let mode = initialMode(profile, args.opts);
  let totalTokens = 0;
  let lastError: Error = new Error("no attempts");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (attempt > 0) onEvent({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });

    const call = await callWithFormatFallback(args, messages, mode, attempt);
    mode = call.mode;
    const { fullText, outputTokens, statsEvent } = call.result;
    totalTokens += outputTokens;
    if (statsEvent) onEvent(statsEvent);

    if (!fullText.trim()) {
      lastError = new Error("Empty structured output");
      emitStructuralError(onEvent, callSite, "empty_output", attempt, null, lastError.message);
      structuralErrorCounter.record(null, attempt);

      const next = profile.kind === "json-zod" ? fallbackMode(mode) : null;
      if (next) {
        emitResponseFormatFallback(onEvent, callSite, attempt, mode, next);
        mode = next;
      }

      if (attempt === maxRetries) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: repairPrompt(profile, fullText, lastError) },
      ];
      continue;
    }

    try {
      const value = parseAndValidate(profile, fullText);
      structuralErrorCounter.record(true, attempt);
      return { value, outputTokens: totalTokens, fullText };
    } catch (e) {
      lastError = e as Error;
      const isLast = attempt === maxRetries;
      const errorType = classifyError(profile, lastError);
      emitStructuralError(onEvent, callSite, errorType, attempt, isLast ? false : null, lastError.message);
      structuralErrorCounter.record(isLast ? false : null, attempt);
      if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: repairPrompt(profile, fullText, lastError) },
      ];
    }
  }

  throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
}
