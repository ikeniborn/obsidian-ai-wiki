import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStreamLine } from "../src/stream";
import type { RunEvent } from "../src/types";

function loadFixture(name: string): string[] {
  const p = resolve(__dirname, "fixtures", name);
  return readFileSync(p, "utf-8").split("\n").filter(Boolean);
}

describe("parseStreamLine", () => {
  it("ignores blank lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("ignores non-JSON banner lines (iclaude wrapper output)", () => {
    expect(parseStreamLine("not json")).toBeNull();
    expect(parseStreamLine("[34mUsing isolated config[0m")).toBeNull();
    expect(parseStreamLine("=====")).toBeNull();
  });

  it("returns parse-error event for malformed JSON-looking lines", () => {
    const ev = parseStreamLine("{not valid json");
    expect(ev?.kind).toBe("error");
    expect((ev as { message: string }).message).toMatch(/parse/i);
  });

  it("maps full ingest fixture in order", () => {
    const lines = loadFixture("stream-ingest.jsonl");
    const events: RunEvent[] = [];
    for (const l of lines) {
      const e = parseStreamLine(l);
      if (e) events.push(e);
    }
    const kinds = events.map(e => e.kind);
    expect(kinds).toEqual([
      "system",
      "tool_use",
      "tool_result",
      "assistant_text",
      "tool_use",
      "result",
    ]);
    const tu1 = events[1] as Extract<RunEvent, { kind: "tool_use" }>;
    expect(tu1.name).toBe("Read");
    const result = events[5] as Extract<RunEvent, { kind: "result" }>;
    expect(result.text).toBe("Создано 1 страница, обновлено 0");
    expect(result.durationMs).toBe(42000);
    expect(result.usdCost).toBe(0.012);
    expect(result.outputTokens).toBe(580);
  });

  it("handles tool_result with is_error true", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ENOENT", is_error: true }] },
    });
    const ev = parseStreamLine(line);
    expect(ev).toEqual({ kind: "tool_result", ok: false, preview: "ENOENT" });
  });

  it("handles error result subtype", () => {
    const line = JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "rate limit" });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe("error");
  });

  it("parses outputTokens from result event with usage", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 42000,
      is_error: false,
      result: "done",
      total_cost_usd: 0.012,
      usage: { output_tokens: 580 },
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe("result");
    expect((ev as Extract<RunEvent, { kind: "result" }>).outputTokens).toBe(580);
  });

  it("leaves outputTokens undefined when usage absent", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 42000,
      is_error: false,
      result: "done",
      total_cost_usd: 0.012,
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe("result");
    expect((ev as Extract<RunEvent, { kind: "result" }>).outputTokens).toBeUndefined();
  });

  it("returns null for unknown type without throwing", () => {
    expect(parseStreamLine(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  it("maps AskUserQuestion tool_use to ask_user event", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "aq1",
          name: "AskUserQuestion",
          input: {
            prompt: "Подтвердить entity_types?",
            options: ["подтвердить", "исключить типы", "отменить"],
          },
        }],
      },
    });
    const ev = parseStreamLine(line);
    expect(ev).toEqual({
      kind: "ask_user",
      question: "Подтвердить entity_types?",
      options: ["подтвердить", "исключить типы", "отменить"],
      toolUseId: "aq1",
    });
  });

  it("maps AskUserQuestion with no options to ask_user with empty options array", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "aq2",
          name: "AskUserQuestion",
          input: { prompt: "Введите id типов:", options: [] },
        }],
      },
    });
    const ev = parseStreamLine(line);
    expect(ev).toEqual({
      kind: "ask_user",
      question: "Введите id типов:",
      options: [],
      toolUseId: "aq2",
    });
  });

  it("extracts session_id from system init event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
      model: "claude-sonnet-4-6",
      cwd: "/home/u",
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe("system");
    expect((ev as Extract<RunEvent, { kind: "system" }>).sessionId).toBe("abc-123");
  });

  it("returns undefined sessionId when session_id is missing from system event", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-6" });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe("system");
    expect((ev as Extract<RunEvent, { kind: "system" }>).sessionId).toBeUndefined();
  });
});
