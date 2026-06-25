import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import chatTemplate from "../../prompts/chat.md";
import { render } from "./template";
import { promptVersionOf } from "../prompt-version";

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
    context,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;

  yield { kind: "tool_use", name: "Responding", input: {} };
  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
    streamStats = getStats();
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }

  if (signal.aborted) return;
  yield { kind: "tool_result", ok: !!fullText, preview: fullText ? `${fullText.length} chars` : "no response" };
  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  yield {
    kind: "eval_meta",
    fields: { question: lastUserMessage, answer: fullText, promptVersion: promptVersionOf(chatTemplate) },
  };
  yield { kind: "result", durationMs: Date.now() - start, text: fullText, outputTokens: outputTokens || undefined };
}
