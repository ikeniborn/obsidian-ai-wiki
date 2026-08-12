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
  recordedMessageChars: number[];
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
    // Runs alternate between digits and punctuation, as they do in the paths,
    // versions and timestamps these prompts carry. Each run stays one class, so
    // the run count is the recorded one; the word character in front keeps two
    // runs of the same class from merging into one.
    parts.push("a", (index % 2 === 0 ? "1" : ".").repeat(size));
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

test("no text costs more than one token per UTF-8 byte", () => {
  // A run charge plus a per-character charge can otherwise exceed one token per
  // character on text that switches class every character, which no byte-level
  // tokenizer can do. An IP list, a numeric table and a timestamp are the real
  // shapes that hit it, and over-counting them shrinks every chunk budget.
  for (const dense of [".1".repeat(400), "1.1.1.1, ".repeat(80), "10.0.0.1\n".repeat(90)]) {
    assert.ok(
      estimateText(dense) <= Buffer.byteLength(dense, "utf8"),
      `${estimateText(dense)} tokens for ${Buffer.byteLength(dense, "utf8")} bytes`,
    );
  }
});

test("the ceiling is UTF-8 length, not character count", () => {
  // A byte-level tokenizer can bill one token per BYTE, so capping at the
  // character count would cap 2-4x below what the provider can charge on
  // anything outside ASCII. These two cost more than their character count and
  // never more than their UTF-8 length.
  for (const dense of ["😀1\n".repeat(50), "日,".repeat(50), "я1.".repeat(60)]) {
    const characters = [...dense].length;
    const bytes = Buffer.byteLength(dense, "utf8");
    assert.ok(estimateText(dense) <= bytes, `${estimateText(dense)} tokens for ${bytes} bytes`);
    assert.ok(
      estimateText(dense) > characters,
      `${estimateText(dense)} tokens capped at the ${characters} characters`,
    );
  }
});

test("digits and timestamps cost more per character than words, and stay under the ceiling", () => {
  const stamp = "2026-08-12T11:36:44.787Z";
  const word = "configuration providers ";
  assert.equal(stamp.length, word.length);
  assert.ok(estimateText(stamp) > estimateText(word));
  assert.ok(estimateText(stamp) <= Buffer.byteLength(stamp, "utf8"));
  // The ceiling must not flatten a page of numbers into a page of prose.
  const numbers = Array.from({ length: 40 }, (_, row) => `${row} 10.0.${row}.1 4096 0.75`).join("\n");
  const prose = "the quick brown fox jumps over the lazy dog and then some ".repeat(20);
  assert.ok(estimateText(numbers) / numbers.length > 2 * (estimateText(prose) / prose.length));
});

test("the fixture census matches the recorded prompt length", () => {
  // The census is reconstructed, so it can drift from the prompt it claims to
  // describe; the recorded per-message character lengths are what it has to add
  // up to. A case that fails this is not the prompt the provider counted.
  for (const item of fixture.cases) {
    const census = item.reconstruction;
    const characters = census.cyrillic + census.cjk + census.word + census.symbols + census.newlines;
    assert.equal(
      characters,
      item.recordedMessageChars.reduce((sum, value) => sum + value, 0),
      `${item.id}: census sums to ${characters}`,
    );
  }
});

test("the estimate never falls below the tokenizer count of the same census", () => {
  // `actualInputTokens` is the provider's count of the real prompt; the test
  // feeds a reconstruction of it. `tokenizerTokens` is that same reconstruction
  // measured with a real tokenizer, so it is the one exact comparison here —
  // it isolates the rules from the reconstruction's own error.
  for (const item of fixture.cases) {
    const estimated = estimateMessages(messagesFor(item));
    const ratio = estimated / item.reconstruction.tokenizerTokens;
    assert.ok(ratio >= 1, `${item.id}: ${estimated} against ${item.reconstruction.tokenizerTokens}`);
    assert.ok(ratio <= 1.15, `${item.id}: ${((ratio - 1) * 100).toFixed(1)}% above the tokenizer`);
  }
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
  //
  // The tolerance is the fixture's own: a case is kept only when the tokenizer
  // counts its reconstruction within 3% of the provider's number, so this
  // comparison cannot be exact - the census is an accepted approximation of the
  // prompt the provider counted, not that prompt. Asserting a hard floor here
  // would fit the rules to that approximation's error, which is what the test
  // above ("never falls below the tokenizer count of the same census") measures
  // exactly instead: it compares the estimate against the token count of the
  // very text the estimator was fed.
  const tolerance = 0.03;
  for (const item of fixture.cases) {
    const estimated = estimateMessages(messagesFor(item));
    assert.ok(
      estimated >= item.actualInputTokens * (1 - tolerance),
      `${item.id}: ${estimated} against ${item.actualInputTokens}, below the reconstruction's own 3% tolerance`,
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
