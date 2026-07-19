import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
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
import { createLlmLifecycle } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import chatTemplate from "../../prompts/chat.md";
import { render } from "./template";
import { promptVersionOf } from "../prompt-version";
import {
  classifyContextError,
  createPromptBudgetEvent,
  ContextRepackSuppressedError,
  estimatePreparedMessages,
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
  let executionCount = 0;
  let requestAttempt = 0;
  const callSite = opts.semanticCompression?.operation === "query"
    ? "query.answer"
    : "lint-chat.fix";

  yield { kind: "tool_use", name: "Responding", input: {} };
  let attempt: ChatAttempt;
  try {
    attempt = yield* runWithLiveEvents((emit, operationSignal) => runWithContextRepack<PackedChatRequest, ChatAttempt>({
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
        if (executionCount > 0) {
          chatLifecycle = createLlmLifecycle(
            opts.semanticCompression?.operation === "query"
              ? "answer_question"
              : "apply_lint_fixes",
          );
        }
        executionCount += 1;
        emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "preparing", Date.now(), {
          callSite,
          transport: "stream",
          attempt: requestAttempt++,
        }));
        const params = paramsForPreparedMessages(model, request.messages, opts, true);
        let streamChunkConsumed = false;
        try {
          const requestStartMs = Date.now();
          emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "sent"));
          emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "waiting"));
          const pending = llm.chat.completions.create(
            { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
            { signal: operationSignal },
          );
          const rawStream = await pending;
          const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, operationSignal);
          let attemptText = "";
          let attemptOutputTokens = 0;
          let producing = false;
          for await (const chunk of stream) {
            streamChunkConsumed = true;
            const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
            if (!producing && (reasoning.trim() || content.trim())) {
              emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "producing"));
              producing = true;
            }
            if (reasoning) emit({ kind: "assistant_text", delta: reasoning, isReasoning: true });
            if (content) {
              attemptText += content;
              emit({ kind: "assistant_text", delta: content });
            }
            if (tok !== undefined) attemptOutputTokens += tok;
          }
          const stats = getStats();
          return {
            text: attemptText,
            outputTokens: attemptOutputTokens,
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
            emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "retrying"));
          }
          rethrowForContextRepack(error, request.optionalUnits);
          if (!shouldFallbackStreamToNonStream(error, operationSignal)) throw error;
          budgetEvents.push(createPromptBudgetEvent({
            requestId: chatLifecycle.id,
            callSite: opts.semanticCompression?.operation === "query"
              ? "query.answer"
              : "lint-chat.fix",
            configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
            effectiveInputBudget: opts.inputBudgetTokens ?? 16_384,
            estimatedInputTokens: estimatePreparedMessages(
              params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
            ),
            outputBudget: opts.maxTokens,
            compressionProfile: opts.semanticCompression?.profile ?? "balanced",
            contextUnits: request.messages.length,
          }));
          emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "retrying"));
          chatLifecycle = createLlmLifecycle(
            opts.semanticCompression?.operation === "query"
              ? "answer_question"
              : "apply_lint_fixes",
          );
          emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "preparing", Date.now(), {
            callSite,
            transport: "non-stream",
            attempt: requestAttempt++,
          }));
          let response: OpenAI.Chat.ChatCompletion;
          const fallbackStartMs = Date.now();
          try {
            const fallbackParams = paramsForPreparedMessages(model, request.messages, opts, false);
            emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "sent"));
            emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "waiting"));
            const pending = llm.chat.completions.create(
              { ...fallbackParams, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
              { signal: operationSignal },
            );
            response = await pending;
          } catch (fallbackError) {
            if (classifyContextError(fallbackError) !== null && request.optionalUnits > 0) {
              emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "retrying"));
            }
            rethrowForContextRepack(fallbackError, request.optionalUnits);
            throw fallbackError;
          }
          const fallbackDurationMs = Date.now() - fallbackStartMs;
          const fallbackMessage = response.choices[0]?.message;
          const fallbackReasoning = completionReasoning(fallbackMessage);
          const fallbackText = fallbackMessage?.content ?? "";
          const fallbackTokens = extractUsage(response) ?? 0;
          if (fallbackReasoning.trim() || fallbackText.trim()) {
            emit(lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "producing"));
          }
          if (fallbackReasoning) {
            emit({ kind: "assistant_text", delta: fallbackReasoning, isReasoning: true });
          }
          if (fallbackText) emit({ kind: "assistant_text", delta: fallbackText });
          return {
            text: fallbackText,
            outputTokens: fallbackTokens,
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
      requestId: () => chatLifecycle.id,
      onEvent: (event) => budgetEvents.push(event),
    }), signal);
    signal.throwIfAborted();
  } catch (error) {
    for (const event of budgetEvents) yield event;
    if (signal.aborted || (error as Error).name === "AbortError") {
      yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
      return;
    }
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "failed");
    throw error;
  }
  for (const event of budgetEvents) yield event;
  fullText = attempt.text;
  outputTokens = attempt.outputTokens;
  streamStats = attempt.streamStats;

  if (signal.aborted) {
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
    return;
  }
  yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "validating");
  if (signal.aborted) {
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
    return;
  }
  yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "applying");
  if (signal.aborted) {
    yield lifecycleEvent(chatLifecycle.id, chatLifecycle.action, "cancelled");
    return;
  }
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
