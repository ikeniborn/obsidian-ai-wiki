import { describe, it, expect } from "vitest";
import { buildChatParams, stripThinking, parseStructured } from "../src/phases/llm-utils";
import type OpenAI from "openai";
import baseContract from "../prompts/base.md";

describe("buildChatParams — User prompt injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("appends User prompt as ## Уточнение section", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "Используй формальный стиль." });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(
      `${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nИспользуй формальный стиль.`,
    );
  });

  it("does not modify messages when systemPrompt is empty", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("does not modify messages when systemPrompt is absent", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("creates system message when none exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, { systemPrompt: "note" });
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(`${baseContract}\n\n## Уточнение\nnote`);
  });
});

describe("buildChatParams — base contract injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("prepends base contract before phase prompt", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("base contract is first: before phase prompt and before Уточнение", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "note" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nnote`);
  });

  it("prepends base contract when no system message exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, {});
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(baseContract);
  });
});

describe("stripThinking", () => {
  it("returns text unchanged when no think tags", () => {
    expect(stripThinking('{"key": "val"}')).toBe('{"key": "val"}');
  });

  it("removes single <think> block and returns only JSON", () => {
    const input = '<think>\nsome reasoning {temp: 1}\n</think>\n{"key": "val"}';
    expect(stripThinking(input)).toBe('{"key": "val"}');
  });

  it("removes multiple <think> blocks", () => {
    const input = '<think>first</think> middle <think>second</think> end';
    expect(stripThinking(input)).toBe('middle  end');
  });

  it("does not corrupt JSON when { inside <think>", () => {
    const input = '<think>Could be {"temp": 1} or other</think>\n{"real": true}';
    expect(stripThinking(input)).toBe('{"real": true}');
  });
});

describe("parseStructured", () => {
  it("parses clean JSON directly", () => {
    expect(parseStructured('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips <think> and parses JSON after", () => {
    const input = '<think>{"fake": true}\n</think>\n{"real": 42}';
    expect(parseStructured(input)).toEqual({ real: 42 });
  });

  it("throws when no JSON object found", () => {
    expect(() => parseStructured("no json here")).toThrow("No JSON object found");
  });

  it("handles nested objects correctly", () => {
    const input = '{"outer": {"inner": [1, 2]}}';
    expect(parseStructured(input)).toEqual({ outer: { inner: [1, 2] } });
  });
});

describe("buildChatParams — response_format", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: "q" },
  ];

  it("sets response_format json_schema when jsonMode=json_schema and schema provided", () => {
    const schema = { name: "test_schema", schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false } };
    const params = buildChatParams("m", messages, { jsonMode: "json_schema" }, schema);
    expect((params.response_format as { type: string }).type).toBe("json_schema");
    expect((params.response_format as { json_schema: { name: string } }).json_schema.name).toBe("test_schema");
  });

  it("sets response_format json_object when jsonMode=json_object", () => {
    const params = buildChatParams("m", messages, { jsonMode: "json_object" });
    expect((params.response_format as { type: string }).type).toBe("json_object");
  });

  it("no response_format when jsonMode absent", () => {
    const params = buildChatParams("m", messages, {});
    expect(params.response_format).toBeUndefined();
  });
});
