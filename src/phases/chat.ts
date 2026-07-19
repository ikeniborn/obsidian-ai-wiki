import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  completionReasoning,
  extractStreamDeltas,
  extractUsage,
  shouldFallbackStreamToNonStream,
  wrapStreamWithStats,
} from "./llm-utils";
import { createLlmLifecycle } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import chatTemplate from "../../prompts/chat.md";
import { render } from "./template";
import { promptVersionOf } from "../prompt-version";
import {
  classifyContextError,
  PromptBudgetExceededError,
  runWithContextRepack,
  type PromptBudgetEvent,
} from "../prompt-budget";
import { packChatHistory } from "./query-budget";

interface PackedChatRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  optionalUnits: number;
}

interface ChatAttempt {
  text: string;
  outputTokens: number;
  events: RunEvent[];
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
        "Provider rejected the required-only Chat prompt after optional context was exhausted",
        { cause: error },
      );
    }
    throw error;
  }
  if (error instanceof PromptBudgetExceededError) throw error;
}

export async function* runLintChat(
  llm: LlmClient,
  model: string,
  domain: DomainEntry | undefined,
  signal: AbortSignal,
  opts: LlmCallOptions,
  context: string,
  history: ChatMessage[],
  operationHeader: string,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  void domain;

  const systemContent = render(chatTemplate, {
    operation_header: operationHeader,
    context: "",
  });
  let fullText = "";
  let outputTokens = 0;
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;
  const budgetEvents: PromptBudgetEvent[] = [];
  let eligibleOptionalUnitIds: string[] | undefined;
  let chatLifecycle = createLlmLifecycle(
    opts.semanticCompression?.operation === "query"
      ? "answer_question"
      : "apply_lint_fixes",
  );
  const lifecycleRetryEvents: RunEvent[] = [];

  yield { kind: "tool_use", name: "Responding", input: {} };
  let attempt: ChatAttempt;
  try {
    attempt = await runWithContextRepack<PackedChatRequest, ChatAttempt>({
      callSite: opts.semanticCompression?.operation === "query"
        ? "query.answer"
        : "lint-chat.fix",
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      build: (effectiveInputBudget) => {
        const allowedOptionalUnitIds = eligibleOptionalUnitIds === undefined
          ? undefined
          : eligibleOptionalUnitIds.slice(0, -1);
        const packed = packChatHistory({
          systemPrompt: systemContent,
          context,
          history,
          inputBudgetTokens: effectiveInputBudget,
          opts,
          allowedOptionalUnitIds,
        });
        eligibleOptionalUnitIds = packed.selectedOptionalUnitIds;
        return {
          value: {
            messages: packed.messages,
            optionalUnits: packed.selectedOptionalUnitIds.length,
          },
          estimatedInputTokens: packed.estimatedInputTokens,
          contextUnits: packed.contextUnits,
        };
      },
      execute: async (request) => {
        if (lifecycleRetryEvents.length > 0) {
          chatLifecycle = createLlmLifecycle(
            opts.semanticCompression?.operation === "query"
              ? "answer_question"
              : "apply_lint_fixes",
          );
        }
        const params = paramsForPreparedMessages(model, request.messages, opts, true);
        const lifecycleEvents: RunEvent[] = [
          lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "preparing"),
          lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "sent"),
          lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "waiting"),
        ];
        let streamChunkConsumed = false;
        try {
          const requestStartMs = Date.now();
          const rawStream = await llm.chat.completions.create(
            { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
            { signal },
          );
          const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, signal);
          let attemptText = "";
          let attemptOutputTokens = 0;
          const events: RunEvent[] = [...lifecycleEvents];
          let producing = false;
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              const stats = getStats();
              return {
                text: attemptText,
                outputTokens: attemptOutputTokens,
                events,
                streamStats: stats,
                inputTokens: stats?.inputTokens,
              };
            }
            const chunk = next.value;
            streamChunkConsumed = true;
            const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
            if (!producing && (reasoning.trim() || content.trim())) {
              events.push(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "producing"));
              producing = true;
            }
            if (reasoning) events.push({ kind: "assistant_text", delta: reasoning, isReasoning: true });
            if (content) {
              attemptText += content;
              events.push({ kind: "assistant_text", delta: content });
            }
            if (tok !== undefined) attemptOutputTokens += tok;
            if (reasoning || content) {
              return {
                text: attemptText,
                outputTokens: attemptOutputTokens,
                events,
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
              lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "retrying"),
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
          const fallbackText = fallbackMessage?.content ?? "";
          const fallbackTokens = extractUsage(response) ?? 0;
          return {
            text: fallbackText,
            outputTokens: fallbackTokens,
            events: [
              ...lifecycleEvents,
              ...(fallbackReasoning.trim() || fallbackText.trim()
                ? [
                    lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "producing"),
                    ...(fallbackReasoning
                      ? [{ kind: "assistant_text" as const, delta: fallbackReasoning, isReasoning: true }]
                      : []),
                    ...(fallbackText
                      ? [{ kind: "assistant_text" as const, delta: fallbackText }]
                      : []),
                  ]
                : []),
            ],
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
      yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
      return;
    }
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "failed");
    throw error;
  }
  const completionBudgetEvent = attempt.pendingStream
    ? budgetEvents.pop()
    : undefined;
  for (const event of lifecycleRetryEvents) yield event;
  for (const event of budgetEvents) yield event;
  fullText = attempt.text;
  outputTokens = attempt.outputTokens;
  streamStats = attempt.streamStats;
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
          fullText += content;
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
      yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
      return;
    }
    if (streamFailure) {
      yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "failed");
      throw streamFailure.error;
    }
  } else {
    for (const event of attempt.events) yield event;
  }

  if (signal.aborted) {
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
    return;
  }
  yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "validating");
  yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "applying");
  yield { kind: "tool_result", ok: !!fullText, preview: fullText ? `${fullText.length} chars` : "no response" };
  yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "completed");
  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  yield {
    kind: "eval_meta",
    fields: { question: lastUserMessage, answer: fullText, promptVersion: promptVersionOf(chatTemplate) },
  };
  yield { kind: "result", durationMs: Date.now() - start, text: fullText, outputTokens: outputTokens || undefined };
}
