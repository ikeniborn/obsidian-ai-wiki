import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type OpenAI from "openai";
import { estimateMessages, estimateText } from "../src/token-estimate";

interface Case {
  id: string;
  systemChars: number;
  payloadChars: number;
  messages: number;
  actualInputTokens: number;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/recorded-prompts.json", import.meta.url), "utf8"),
) as { payloadCyrillicShare: number; cases: Case[] };

/** Rebuilds a prompt with the recorded lengths and the documented script mix. */
function messagesFor(item: Case): OpenAI.Chat.ChatCompletionMessageParam[] {
  const cyrillic = Math.round(item.payloadChars * fixture.payloadCyrillicShare);
  const latin = item.payloadChars - cyrillic;
  const extra = Array.from({ length: item.messages - 2 }, () => (
    { role: "user" as const, content: "" }
  ));
  return [
    { role: "system", content: "a".repeat(item.systemChars) },
    { role: "user", content: "a".repeat(latin) + "я".repeat(cyrillic) },
    ...extra,
  ];
}

test("Cyrillic costs more tokens per character than Latin", () => {
  assert.ok(estimateText("абвгдеёжзи") > estimateText("abcdefghij"));
});

test("the uncalibrated estimate is within 15% of the provider count on every recorded case", () => {
  // The intent's metric is an absolute band, and the runtime starts every new
  // model at calibration 1, so the seed coefficients must satisfy it on their
  // own. A test that first fits an offline factor would hide exactly the case
  // that matters: the first request against a model the plugin has never seen.
  for (const item of fixture.cases) {
    const estimated = estimateMessages(messagesFor(item));
    const error = estimated / item.actualInputTokens - 1;
    assert.ok(
      Math.abs(error) <= 0.15,
      `${item.id}: ${(error * 100).toFixed(1)}% off at calibration 1 `
      + `(${estimated} against ${item.actualInputTokens})`,
    );
  }
});

test("the uncalibrated estimate never falls below the provider count", () => {
  // Overestimating wastes budget; underestimating produces real provider
  // context-length errors. The seed is biased upward on purpose.
  for (const item of fixture.cases) {
    assert.ok(
      estimateMessages(messagesFor(item)) >= item.actualInputTokens,
      `${item.id}: the seed must not underestimate`,
    );
  }
});

test("a fitted calibration factor keeps every case inside 15%", () => {
  const ratios = fixture.cases.map((item) =>
    item.actualInputTokens / estimateMessages(messagesFor(item)));
  const calibration = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  for (const item of fixture.cases) {
    const error = Math.abs(estimateMessages(messagesFor(item), calibration) / item.actualInputTokens - 1);
    assert.ok(error <= 0.15, `${item.id}: ${(error * 100).toFixed(1)}% off after calibration`);
  }
});

test("image parts cost a flat allowance and ignore the URL length", () => {
  const short = estimateMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
  ] }]);
  const long = estimateMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: `data:image/png;base64,${"a".repeat(50_000)}` } },
  ] }]);
  assert.equal(short, long);
  assert.ok(short >= 4096);
});

test("tool-call metadata is counted as text", () => {
  const bare = estimateMessages([{ role: "assistant", content: null }]);
  const withCall = estimateMessages([{
    role: "assistant",
    content: null,
    tool_calls: [{
      id: "call_1",
      type: "function",
      function: { name: "search", arguments: JSON.stringify({ query: "a".repeat(200) }) },
    }],
  }]);
  assert.ok(withCall > bare);
});

test("calibration scales the result", () => {
  const base = estimateMessages([{ role: "user", content: "abcdefgh" }]);
  assert.equal(estimateMessages([{ role: "user", content: "abcdefgh" }], 2), base * 2);
});
