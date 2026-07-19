import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  completionReasoning,
  extractStreamDeltas,
  extractUsage,
  shouldFallbackStreamToNonStream,
  wrapStreamWithStats,
} from "./llm-utils";
import { queryAnswerProfile } from "./framed-output";
import { createLlmLifecycle, runStructuredWithRetry } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import { makeQueryAnswerSchema } from "./zod-schemas";
import { extractAnswerLinks, findBrokenLinks, annotateBroken } from "./query-link-validator";
import { resolveLink } from "./link-resolver";
import type { SelectedChunk } from "../page-similarity";
import {
  classifyContextError,
  PromptBudgetExceededError,
  runWithContextRepack,
  type PromptBudgetEvent,
} from "../prompt-budget";
import { packQueryChunks, type QuerySystemPrompt } from "./query-budget";

interface PackedAnswerRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  selectedChunks: SelectedChunk[];
  optionalUnits: number;
}

interface AnswerAttempt {
  answer: string;
  outputTokens: number;
  events: RunEvent[];
  selectedChunks: SelectedChunk[];
  pendingStream?: {
    iterator: AsyncIterator<OpenAI.Chat.ChatCompletionChunk>;
    getStats(): import("./llm-utils").LlmStreamStats | undefined;
  };
  streamStats?: import("./llm-utils").LlmStreamStats;
  inputTokens?: number;
}

function paramsForPreparedMessages(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  stream: boolean,
): Record<string, unknown> {
  const params = buildChatParams(
    model,
    [],
    { ...opts, inputBudgetTokens: undefined },
    stream,
  );
  params.messages = messages;
  return params;
}

function rethrowForContextRepack(error: unknown, optionalUnits: number): void {
  if (classifyContextError(error) !== null) {
    if (optionalUnits === 0) {
      throw new Error(
        "Provider rejected the required-only Query prompt after optional context was exhausted",
        { cause: error },
      );
    }
    throw error;
  }
  if (error instanceof PromptBudgetExceededError) throw error;
}

/**
 * Stream one answer for a prepared system prompt + context block, then run the
 * deterministic‒llm WikiLink validation/repair tail. Yields the same events the
 * inline runQuery tail used to yield. Returns the final answer text + output tokens.
 */
export async function* answerFromContext(args: {
  llm: LlmClient;
  model: string;
  opts: LlmCallOptions;
  signal: AbortSignal;
  systemPrompt: QuerySystemPrompt;
  question: string;
  chunks: SelectedChunk[];
  wikiLinkValidationRetries: number;
  deferLlmCallStats?: boolean;
}): AsyncGenerator<RunEvent, {
  answer: string;
  outputTokens: number;
  selectedChunks: SelectedChunk[];
  llmCallStats?: Extract<RunEvent, { kind: "llm_call_stats" }>;
}> {
  const {
    llm,
    model,
    opts,
    signal,
    systemPrompt,
    question,
    chunks,
    wikiLinkValidationRetries,
    deferLlmCallStats = false,
  } = args;
  let outputTokens = 0;
  let answer = "";
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;
  let selectedChunks: SelectedChunk[] = [];
  const budgetEvents: PromptBudgetEvent[] = [];
  let eligibleChunks: SelectedChunk[] | undefined;
  let answerLifecycle = createLlmLifecycle("answer_question");
  const lifecycleRetryEvents: RunEvent[] = [];
  yield { kind: "tool_use", name: "Answering", input: {} };

  let attempt: AnswerAttempt;
  try {
    attempt = await runWithContextRepack<PackedAnswerRequest, AnswerAttempt>({
      callSite: "query.answer",
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      build: (effectiveInputBudget) => {
        const retryChunks = eligibleChunks === undefined
          ? chunks
          : eligibleChunks.slice(0, -1);
        const packed = packQueryChunks({
          question,
          systemPrompt,
          chunks: retryChunks,
          inputBudgetTokens: effectiveInputBudget,
          opts,
        });
        eligibleChunks = packed.selected;
        return {
          value: {
            messages: packed.messages,
            selectedChunks: packed.selected,
            optionalUnits: packed.selected.length,
          },
          estimatedInputTokens: packed.estimatedInputTokens,
          contextUnits: packed.contextUnits,
          sourceChunks: packed.selected.length,
        };
      },
      execute: async (request) => {
        if (lifecycleRetryEvents.length > 0) {
          answerLifecycle = createLlmLifecycle("answer_question");
        }
        const params = paramsForPreparedMessages(model, request.messages, opts, true);
        const lifecycleEvents: RunEvent[] = [
          lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "preparing"),
          lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "sent"),
          lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "waiting"),
        ];
        let streamChunkConsumed = false;
        try {
          const requestStartMs = Date.now();
          const rawStream = await llm.chat.completions.create(
            { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
            { signal },
          );
          const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, signal);
          let attemptAnswer = "";
          let attemptOutputTokens = 0;
          const events: RunEvent[] = [...lifecycleEvents];
          let producing = false;
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              const stats = getStats();
              return {
                answer: attemptAnswer,
                outputTokens: attemptOutputTokens,
                events,
                selectedChunks: request.selectedChunks,
                streamStats: stats,
                inputTokens: stats?.inputTokens,
              };
            }
            const chunk = next.value;
            streamChunkConsumed = true;
            const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
            if (!producing && (reasoning.trim() || content.trim())) {
              events.push(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "producing"));
              producing = true;
            }
            if (reasoning) events.push({ kind: "assistant_text", delta: reasoning, isReasoning: true });
            if (content) {
              attemptAnswer += content;
              events.push({ kind: "assistant_text", delta: content });
            }
            if (tok !== undefined) attemptOutputTokens += tok;
            if (reasoning || content) {
              return {
                answer: attemptAnswer,
                outputTokens: attemptOutputTokens,
                events,
                selectedChunks: request.selectedChunks,
                pendingStream: { iterator, getStats },
              };
            }
          }
        } catch (error) {
          if (
            signal.aborted
            || (error as Error).name === "AbortError"
          ) throw error;
          if (streamChunkConsumed) throw error;
          if (classifyContextError(error) !== null && request.optionalUnits > 0) {
            lifecycleRetryEvents.push(
              ...lifecycleEvents,
              lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "retrying"),
            );
          }
          rethrowForContextRepack(error, request.optionalUnits);
          if (!shouldFallbackStreamToNonStream(error, signal)) throw error;
          let response: OpenAI.Chat.ChatCompletion;
          const fallbackStartMs = Date.now();
          try {
            const fallbackParams = paramsForPreparedMessages(model, request.messages, opts, false);
            response = await llm.chat.completions.create(
              { ...fallbackParams, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
              { signal },
            );
          } catch (fallbackError) {
            rethrowForContextRepack(fallbackError, request.optionalUnits);
            throw fallbackError;
          }
          const fallbackDurationMs = Date.now() - fallbackStartMs;
          const fallbackMessage = response.choices[0]?.message;
          const fallbackReasoning = completionReasoning(fallbackMessage);
          const fallbackAnswer = fallbackMessage?.content ?? "";
          const fallbackTokens = extractUsage(response) ?? 0;
          return {
            answer: fallbackAnswer,
            outputTokens: fallbackTokens,
            events: [
              ...lifecycleEvents,
              ...(fallbackReasoning.trim() || fallbackAnswer.trim()
                ? [
                    lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "producing"),
                    ...(fallbackReasoning
                      ? [{ kind: "assistant_text" as const, delta: fallbackReasoning, isReasoning: true }]
                      : []),
                    ...(fallbackAnswer
                      ? [{ kind: "assistant_text" as const, delta: fallbackAnswer }]
                      : []),
                  ]
                : []),
            ],
            selectedChunks: request.selectedChunks,
            streamStats: response.usage
              ? {
                  inputTokens: response.usage.prompt_tokens,
                  outputTokens: fallbackTokens,
                  ttftMs: fallbackDurationMs,
                  llmDurationMs: fallbackDurationMs,
                }
              : undefined,
            inputTokens: response.usage?.prompt_tokens,
          };
        }
      },
      onEvent: (event) => budgetEvents.push(event),
    });
  } catch (error) {
    for (const event of lifecycleRetryEvents) yield event;
    for (const event of budgetEvents) yield event;
    if (signal.aborted || (error as Error).name === "AbortError") {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
      return { answer: "", outputTokens, selectedChunks };
    }
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "failed");
    throw error;
  }
  const completionBudgetEvent = attempt.pendingStream
    ? budgetEvents.pop()
    : undefined;
  for (const event of lifecycleRetryEvents) yield event;
  for (const event of budgetEvents) yield event;
  answer = attempt.answer;
  outputTokens = attempt.outputTokens;
  streamStats = attempt.streamStats;
  selectedChunks = attempt.selectedChunks;
  if (attempt.pendingStream) {
    let streamCompleted = false;
    let streamAborted = false;
    let streamFailure: { error: unknown } | undefined;
    try {
      for (const event of attempt.events) yield event;
      while (true) {
        const next = await attempt.pendingStream.iterator.next();
        if (next.done) {
          streamCompleted = true;
          break;
        }
        const { reasoning, content, outputTokens: tok } = extractStreamDeltas(next.value);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) {
          answer += content;
          yield { kind: "assistant_text", delta: content };
        }
        if (tok !== undefined) outputTokens += tok;
      }
      streamStats = attempt.pendingStream.getStats();
    } catch (error) {
      if (signal.aborted || (error as Error).name === "AbortError") {
        streamAborted = true;
      } else {
        streamFailure = { error };
      }
    } finally {
      if (!streamCompleted) await attempt.pendingStream.iterator.return?.();
    }
    if (completionBudgetEvent) {
      if (streamStats?.inputTokens !== undefined) {
        completionBudgetEvent.actualInputTokens = streamStats.inputTokens;
      }
      yield completionBudgetEvent;
    }
    if (streamAborted) {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
      return { answer, outputTokens, selectedChunks };
    }
    if (streamFailure) {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "failed");
      throw streamFailure.error;
    }
  } else {
    for (const event of attempt.events) yield event;
  }

  if (signal.aborted) {
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
    return { answer, outputTokens, selectedChunks };
  }
  yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "validating");
  yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "applying");
  yield { kind: "tool_result", ok: !!answer, preview: answer ? `${answer.length} chars` : "no response" };
  yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "completed");

  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    const knownStems = new Set(selectedChunks.map((chunk) => chunk.articleId));
    const links = extractAnswerLinks(answer);
    const broken = findBrokenLinks(links, knownStems);
    yield {
      kind: "tool_result",
      ok: broken.length === 0,
      preview: broken.length === 0 ? "all valid" : `${broken.length} broken`,
    };

    if (broken.length > 0) {
      yield { kind: "tool_use", name: "FixingLinks", input: { broken: broken.length } };

      // Deterministic resolve first — no LLM.
      const candidates = [...knownStems];
      const resolvedPairs: string[] = [];
      const stripped: string[] = [];
      for (const b of broken) {
        const r = resolveLink(b, candidates);
        if (r.kind === "resolved" && r.stem !== b) {
          answer = answer.split(`[[${b}]]`).join(`[[${r.stem}]]`);
          resolvedPairs.push(`${b}→${r.stem}`);
        } else {
          stripped.push(b);
        }
      }
      if (resolvedPairs.length > 0) yield { kind: "rule_fired", ruleId: "resolveLink", count: resolvedPairs.length };

      // Unresolved stems → one structured LLM repair pass (zod-validated), then annotate.
      let llmFixed = 0;
      if (stripped.length > 0 && wikiLinkValidationRetries > 0) {
        const validList = candidates.filter((s) => s.startsWith("wiki_")).join(", ");
        const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content:
            `Rewrite the answer so every WikiLink points to a valid stem. ` +
            `Broken stems: ${stripped.join(", ")}. Valid stems: ${validList}. ` +
            `Return frames only: <<<ANSWER>>> repaired markdown answer, ` +
            `<<<CITATIONS>>> one valid stem per bullet line, then <<<END>>>.` },
          { role: "user", content: `Question: ${question}\n\nAnswer to fix:\n${answer}` },
        ];
        const repairEvents: RunEvent[] = [];
        try {
          const schema = makeQueryAnswerSchema(knownStems);
          const r = await runStructuredWithRetry({
            llm, model, baseMessages,
            opts: { ...opts, jsonMode: false, thinkingBudgetTokens: undefined },
            profile: queryAnswerProfile(schema),
            maxRetries: wikiLinkValidationRetries,
            callSite: "query.answer",
            lifecycle: createLlmLifecycle("answer_question"),
            signal,
            onEvent: (ev) => repairEvents.push(ev),
            transport: "non-stream",
          });
          for (const ev of repairEvents) yield ev;
          outputTokens += r.outputTokens;
          const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
          if (stillBroken.length === 0) {
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "applying");
            answer = r.value.answer_markdown;
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "completed");
            llmFixed = stripped.length;
            stripped.length = 0;
          } else {
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "applying");
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "completed");
          }
        } catch (e) {
          for (const ev of repairEvents) yield ev;
          if (signal.aborted || (e as Error).name === "AbortError") {
            return { answer, outputTokens, selectedChunks };
          }
          // fall through to annotation
        }
      }
      if (stripped.length > 0) {
        answer = annotateBroken(answer, new Set(stripped));
        yield { kind: "rule_fired", ruleId: "annotateBroken", count: stripped.length };
      }

      const parts: string[] = [];
      if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
      if (llmFixed) parts.push(`llm-fixed ${llmFixed}`);
      if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
      yield { kind: "tool_result", ok: stripped.length === 0, preview: parts.join("; ") };
      yield { kind: "assistant_replace", text: answer };
    }
  }

  const llmCallStats = streamStats
    ? buildLlmCallStatsEvent(streamStats) as Extract<RunEvent, { kind: "llm_call_stats" }>
    : undefined;
  if (llmCallStats && !deferLlmCallStats) yield llmCallStats;
  return { answer, outputTokens, selectedChunks, llmCallStats };
}
