import { describe, it, expect } from "vitest";
import { buildChatParams } from "../src/phases/llm-utils";
import type OpenAI from "openai";

describe("buildChatParams — User prompt injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("appends User prompt as ## Уточнение section", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "Используй формальный стиль." });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(
      "Phase system prompt.\n\n## Уточнение\nИспользуй формальный стиль.",
    );
  });

  it("does not modify messages when systemPrompt is empty", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe("Phase system prompt.");
  });

  it("does not modify messages when systemPrompt is absent", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe("Phase system prompt.");
  });

  it("creates system message when none exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, { systemPrompt: "note" });
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("## Уточнение\nnote");
  });
});
