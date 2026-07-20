import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  completionReasoning,
  extractStreamDeltas,
  extractUsage,
  runWithLiveEvents,
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
  createPromptBudgetEvent,
  ContextRepackSuppressedError,
  estimatePreparedMessages,
  PromptBudgetExceededError,
  runWithContextRepack,
  type PromptBudgetEvent,
} from "../prompt-budget";
import { packQueryChunks, type QuerySystemPrompt } from "./query-budget";
import {
  createNativeRequestLifecycle,
  createNativeRequestRetryContext,
  isNativeLlmClient,
} from "../native-llm-executor";

interface PackedAnswerRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  selectedChunks: SelectedChunk[];
  optionalUnits: number;
}

interface AnswerAttempt {
  answer: string;
  outputTokens: number;
  selectedChunks: SelectedChunk[];
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
  let executionCount = 0;
  let requestAttempt = 0;
  yield { kind: "tool_use", name: "Answering", input: {} };

  let attempt: AnswerAttempt;
  try {
    attempt = yield* runWithLiveEvents((emit, operationSignal) => runWithContextRepack<PackedAnswerRequest, AnswerAttempt>({
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
        if (executionCount > 0) {
          answerLifecycle = createLlmLifecycle("answer_question");
        }
        executionCount += 1;
        const streamAttempt = requestAttempt++;
        if (!isNativeLlmClient(llm)) {
          emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "preparing", Date.now(), {
            callSite: "query.answer",
            transport: "stream",
            attempt: streamAttempt,
          }));
        }
        const requestLifecycle = createNativeRequestLifecycle({
          initial: answerLifecycle,
          callSite: "query.answer",
          onEvent: emit,
          attemptOffset: streamAttempt,
        });
        const params = paramsForPreparedMessages(model, request.messages, opts, true);
        let streamChunkConsumed = false;
        try {
          const requestStartMs = Date.now();
          if (!isNativeLlmClient(llm)) {
            emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "sent"));
            emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "waiting"));
          }
          const pending = llm.chat.completions.create(
            { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
            {
              signal: operationSignal,
              retry: createNativeRequestRetryContext({
                callSite: "query.answer",
                opts,
                signal: operationSignal,
                onEvent: emit,
                lifecycle: requestLifecycle,
              }),
            },
          );
          const rawStream = await pending;
          const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, operationSignal);
          let attemptAnswer = "";
          let attemptOutputTokens = 0;
          let producing = false;
          for await (const chunk of stream) {
            streamChunkConsumed = true;
            const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
            if (!producing && (reasoning.trim() || content.trim())) {
              if (!isNativeLlmClient(llm)) {
                emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "producing"));
              }
              producing = true;
            }
            if (reasoning) emit({ kind: "assistant_text", delta: reasoning, isReasoning: true });
            if (content) {
              attemptAnswer += content;
              emit({ kind: "assistant_text", delta: content });
            }
            if (tok !== undefined) attemptOutputTokens += tok;
          }
          const stats = getStats();
          if (isNativeLlmClient(llm)) answerLifecycle = requestLifecycle.current();
          return {
            answer: attemptAnswer,
            outputTokens: attemptOutputTokens,
            selectedChunks: request.selectedChunks,
            streamStats: stats,
            inputTokens: stats?.inputTokens,
          };
        } catch (error) {
          if (
            operationSignal.aborted
            || (error as Error).name === "AbortError"
          ) throw error;
          if (streamChunkConsumed) throw new ContextRepackSuppressedError(error);
          if (classifyContextError(error) !== null && request.optionalUnits > 0) {
            if (!isNativeLlmClient(llm)) {
              emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "retrying"));
            }
          }
          rethrowForContextRepack(error, request.optionalUnits);
          if (!shouldFallbackStreamToNonStream(error, operationSignal)) throw error;
          budgetEvents.push(createPromptBudgetEvent({
            requestId: answerLifecycle.id,
            callSite: "query.answer",
            configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
            effectiveInputBudget: opts.inputBudgetTokens ?? 16_384,
            estimatedInputTokens: estimatePreparedMessages(
              params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
            ),
            outputBudget: opts.maxTokens,
            compressionProfile: opts.semanticCompression?.profile ?? "balanced",
            contextUnits: request.messages.length,
            sourceChunks: request.selectedChunks.length,
          }));
          emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "retrying"));
          answerLifecycle = createLlmLifecycle("answer_question");
          const fallbackAttempt = requestAttempt++;
          if (!isNativeLlmClient(llm)) {
            emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "preparing", Date.now(), {
              callSite: "query.answer",
              transport: "non-stream",
              attempt: fallbackAttempt,
            }));
          }
          const fallbackLifecycle = createNativeRequestLifecycle({
            initial: answerLifecycle,
            callSite: "query.answer",
            onEvent: emit,
            attemptOffset: fallbackAttempt,
          });
          let response: OpenAI.Chat.ChatCompletion;
          const fallbackStartMs = Date.now();
          try {
            const fallbackParams = paramsForPreparedMessages(model, request.messages, opts, false);
            if (!isNativeLlmClient(llm)) {
              emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "sent"));
              emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "waiting"));
            }
            const pending = llm.chat.completions.create(
              { ...fallbackParams, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
              {
                signal: operationSignal,
                retry: createNativeRequestRetryContext({
                  callSite: "query.answer",
                  opts,
                  signal: operationSignal,
                  onEvent: emit,
                  lifecycle: fallbackLifecycle,
                }),
              },
            );
            response = await pending;
            if (isNativeLlmClient(llm)) answerLifecycle = fallbackLifecycle.current();
          } catch (fallbackError) {
            if (classifyContextError(fallbackError) !== null && request.optionalUnits > 0) {
              if (!isNativeLlmClient(llm)) {
                emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "retrying"));
              }
            }
            rethrowForContextRepack(fallbackError, request.optionalUnits);
            throw fallbackError;
          }
          const fallbackDurationMs = Date.now() - fallbackStartMs;
          const fallbackMessage = response.choices[0]?.message;
          const fallbackReasoning = completionReasoning(fallbackMessage);
          const fallbackAnswer = fallbackMessage?.content ?? "";
          const fallbackTokens = extractUsage(response) ?? 0;
          if (fallbackReasoning.trim() || fallbackAnswer.trim()) {
            if (!isNativeLlmClient(llm)) {
              emit(lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "producing"));
            }
          }
          if (fallbackReasoning) {
            emit({ kind: "assistant_text", delta: fallbackReasoning, isReasoning: true });
          }
          if (fallbackAnswer) emit({ kind: "assistant_text", delta: fallbackAnswer });
          return {
            answer: fallbackAnswer,
            outputTokens: fallbackTokens,
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
      requestId: () => answerLifecycle.id,
      onEvent: (event) => budgetEvents.push(event),
    }), signal);
    signal.throwIfAborted();
  } catch (error) {
    for (const event of budgetEvents) yield event;
    if (signal.aborted || (error as Error).name === "AbortError") {
      if (!isNativeLlmClient(llm)) {
        yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
      }
      return { answer: "", outputTokens, selectedChunks };
    }
    if (!isNativeLlmClient(llm)) {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "failed");
    }
    throw error;
  }
  for (const event of budgetEvents) yield event;
  answer = attempt.answer;
  outputTokens = attempt.outputTokens;
  streamStats = attempt.streamStats;
  selectedChunks = attempt.selectedChunks;

  if (signal.aborted) {
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
    return { answer, outputTokens, selectedChunks };
  }
  yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "validating");
  if (signal.aborted) {
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
    return { answer, outputTokens, selectedChunks };
  }
  let displayedReplacement = false;

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
        try {
          const schema = makeQueryAnswerSchema(knownStems);
          const r = yield* runWithLiveEvents((emit, operationSignal) => runStructuredWithRetry({
            llm, model, baseMessages,
            opts: { ...opts, jsonMode: false, thinkingBudgetTokens: undefined },
            profile: queryAnswerProfile(schema),
            maxRetries: wikiLinkValidationRetries,
            callSite: "query.answer",
            lifecycle: createLlmLifecycle("answer_question"),
            signal: operationSignal,
            onEvent: emit,
            transport: "non-stream",
          }), signal);
          if (signal.aborted) {
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "cancelled");
            yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
            return { answer, outputTokens, selectedChunks };
          }
          outputTokens += r.outputTokens;
          const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
          if (stillBroken.length === 0) {
            if (signal.aborted) {
              yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "cancelled");
              yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
              return { answer, outputTokens, selectedChunks };
            }
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "applying");
            if (signal.aborted) {
              yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "cancelled");
              yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
              return { answer, outputTokens, selectedChunks };
            }
            answer = r.value.answer_markdown;
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "completed");
            llmFixed = stripped.length;
            stripped.length = 0;
          } else {
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "applying");
            yield lifecycleEvent(r.lifecycle.id, r.lifecycle.action, "completed");
          }
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") {
            yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
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
      if (signal.aborted) {
        yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
        return { answer, outputTokens, selectedChunks };
      }
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "applying");
      if (signal.aborted) {
        yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
        return { answer, outputTokens, selectedChunks };
      }
      yield { kind: "assistant_replace", text: answer };
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "completed");
      displayedReplacement = true;
    }
  }

  if (!displayedReplacement) {
    if (signal.aborted) {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
      return { answer, outputTokens, selectedChunks };
    }
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "applying");
    if (signal.aborted) {
      yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "cancelled");
      return { answer, outputTokens, selectedChunks };
    }
    yield { kind: "tool_result", ok: !!answer, preview: answer ? `${answer.length} chars` : "no response" };
    yield lifecycleEvent(answerLifecycle.id, answerLifecycle.action, "completed");
  }

  const llmCallStats = streamStats
    ? buildLlmCallStatsEvent(streamStats) as Extract<RunEvent, { kind: "llm_call_stats" }>
    : undefined;
  if (llmCallStats && !deferLlmCallStats) yield llmCallStats;
  return { answer, outputTokens, selectedChunks, llmCallStats };
}
