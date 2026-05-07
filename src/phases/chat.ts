import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import chatTemplate from "../../prompts/chat.md";
import { render } from "./template";

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
    ...history.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  const params = buildChatParams(model, messages, opts);
  let fullText = "";

  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }

  if (signal.aborted) return;
  yield { kind: "result", durationMs: Date.now() - start, text: fullText };
}
