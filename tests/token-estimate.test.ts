import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type OpenAI from "openai";
import { estimateMessages, estimateText } from "../src/token-estimate";

interface Reconstruction {
  cyrillic: number;
  cjk: number;
  word: number;
  symbols: number;
  symbolRuns: number;
  newlines: number;
  tokenizerTokens: number;
}

interface Case {
  id: string;
  callSite: string;
  messages: number;
  actualInputTokens: number;
  recordedEstimateAtTheTime: number;
  reconstruction: Reconstruction;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/recorded-prompts.json", import.meta.url), "utf8"),
) as { cases: Case[] };

/**
 * Rebuilds a prompt with the recorded character census. The fixture stores
 * counts rather than text - the prompts carried a private vault's notes - so
 * the payload is synthesised: symbol runs separated by word characters, then
 * the remaining word and Cyrillic characters, then the newlines. Any rule that
 * reads text as character classes and symbol runs sees the same prompt the
 * provider counted.
 */
function messagesFor(item: Case): OpenAI.Chat.ChatCompletionMessageParam[] {
  const census = item.reconstruction;
  const runs = Math.max(census.symbolRuns, 1);
  const perRun = Math.floor(census.symbols / runs);
  const parts: string[] = [];
  let symbolsLeft = census.symbols;
  let wordLeft = census.word;
  for (let index = 0; index < runs && symbolsLeft > 0; index++) {
    const size = index === runs - 1 ? symbolsLeft : Math.max(perRun, 1);
    parts.push("a", ".".repeat(size));
    wordLeft -= 1;
    symbolsLeft -= size;
  }
  parts.push(
    "a".repeat(Math.max(wordLeft, 0)),
    "я".repeat(census.cyrillic),
    "\n".repeat(census.newlines),
  );
  const extra = Array.from({ length: item.messages - 2 }, () => (
    { role: "user" as const, content: "" }
  ));
  return [
    { role: "system", content: "" },
    { role: "user", content: parts.join("") },
    ...extra,
  ];
}

test("Cyrillic costs more tokens per character than Latin", () => {
  assert.ok(estimateText("абвгдеёжзи") > estimateText("abcdefghij"));
});

test("symbol-dense text costs more tokens per character than prose", () => {
  // The defect these rules fix: shell commands, config files and JSON envelopes
  // carry several times more tokens per character than prose, and a single
  // default rate for everything but Cyrillic made large prompts look small.
  const prose = "the service reads its configuration from a file on disk again";
  const config = "iptables -A INPUT -p tcp --dport=22 -j DROP; ufw allow 22/tcp";
  assert.equal(prose.length, config.length);
  assert.ok(estimateText(config) > 2 * estimateText(prose));
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

test("the error does not grow with prompt size", () => {
  // The rules these replaced were unbiased on 3.5k-token prompts and 22% low on
  // a 17.6k-token one: a slope, not a constant, and no calibration factor - a
  // single multiplier - can remove a slope. The fixture spans that range on
  // purpose, so comparing the extremes is what keeps a size-dependent rule out.
  const sorted = [...fixture.cases].sort((a, b) => a.actualInputTokens - b.actualInputTokens);
  const ratio = (item: Case) => estimateMessages(messagesFor(item)) / item.actualInputTokens;
  const smallest = ratio(sorted[0]);
  const largest = ratio(sorted[sorted.length - 1]);
  assert.ok(
    Math.abs(largest / smallest - 1) <= 0.1,
    `the largest case is ${((largest / smallest - 1) * 100).toFixed(1)}% off relative to the smallest`,
  );
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
