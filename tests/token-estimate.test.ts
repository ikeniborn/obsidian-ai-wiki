import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type OpenAI from "openai";
import { censusMessages, estimateMessages, estimateText } from "../src/token-estimate";

interface FixtureCensus {
  cyrillic: number;
  cjk: number;
  word: number;
  symbols: number;
  symbolRuns: number;
  newlines: number;
  imageParts: number;
}

interface Case {
  id: string;
  callSite: string;
  messages: number;
  recordedMessageChars: number[];
  actualInputTokens: number;
  recordedEstimateAtTheTime: number;
  /**
   * `recorded` - the census is what `llm_request_fingerprint.census` carried, so
   * it is measured. `reconstructed` - the case predates that field and its census
   * was rebuilt from the material the call had carried, which is why only those
   * cases have a `tokenizerTokens` to bound the rebuild's own error.
   */
  provenance: "recorded" | "reconstructed";
  tokenizerTokens?: number;
  census: FixtureCensus;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/recorded-prompts.json", import.meta.url), "utf8"),
) as { cases: Case[] };

const reconstructed = fixture.cases.filter((item) => item.provenance === "reconstructed");

/**
 * Rebuilds a prompt with the recorded character census. The fixture stores
 * counts rather than text - the prompts carried a private vault's notes - so
 * the payload is synthesised: symbol runs separated by word characters, then
 * the remaining word and Cyrillic characters, then the newlines. Any rule that
 * reads text as character classes and symbol runs sees the same prompt the
 * provider counted.
 */
function messagesFor(item: Case): OpenAI.Chat.ChatCompletionMessageParam[] {
  const census = item.census;
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
  const images: OpenAI.Chat.ChatCompletionContentPart[] = Array.from(
    { length: census.imageParts },
    () => ({ type: "image_url", image_url: { url: "data:image/png;base64,a" } }),
  );
  return [
    { role: "system", content: "" },
    images.length > 0
      ? { role: "user", content: [{ type: "text", text: parts.join("") }, ...images] }
      : { role: "user", content: parts.join("") },
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

test("a reconstructed census matches the prompt length it claims to describe", () => {
  // A rebuilt census can drift from the prompt it describes; the recorded
  // per-message character lengths are what it has to add up to. A case that
  // fails this is not the prompt the provider counted. A recorded census is
  // exempt: it is the estimator's own count of content given as an array, which
  // `messageCharLengths` measures serialized, so the two disagree by design.
  for (const item of reconstructed) {
    const census = item.census;
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
  // it isolates the rules from the reconstruction's own error. Only a
  // reconstructed case has one, and only a reconstructed case needs one.
  for (const item of reconstructed) {
    assert.ok(item.tokenizerTokens, `${item.id}: reconstructed without a tokenizer count`);
    const estimated = estimateMessages(messagesFor(item));
    const ratio = estimated / item.tokenizerTokens;
    assert.ok(ratio >= 1, `${item.id}: ${estimated} against ${item.tokenizerTokens}`);
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
  // The floor a case is held to depends on where its census came from. A
  // reconstructed census is an accepted approximation of the prompt the provider
  // counted - kept only when the tokenizer agreed within 3% - so a hard floor
  // there would fit the rules to that approximation's error; the test above
  // ("never falls below the tokenizer count of the same census") is the exact
  // comparison for those. A recorded census is the estimator's own count of the
  // prompt the provider billed, so its floor is the provider's number itself,
  // less only the rounding the estimator does once per message.
  for (const item of fixture.cases) {
    const estimated = estimateMessages(messagesFor(item));
    const floor = item.provenance === "reconstructed"
      ? item.actualInputTokens * 0.97
      : item.actualInputTokens - Math.max(item.messages - 1, 0);
    assert.ok(
      estimated >= floor,
      `${item.id}: ${estimated} against ${item.actualInputTokens}, below the ${item.provenance} floor ${floor}`,
    );
  }
});

test("a census re-measures to the estimate of the messages it was taken from", () => {
  // The census is what makes a logged request re-measurable offline, so it has to
  // reproduce the estimate that was logged beside it. Summing across messages
  // costs at most one token per message boundary - the estimator rounds once per
  // message - and nothing more.
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Ты редактор вики. Отвечай строго по контракту.\n" },
    { role: "user", content: "iptables -A INPUT -p tcp --dport=22 -j DROP\n10.0.0.1 2026-08-12\n" },
    { role: "user", content: [
      { type: "text", text: "описание: screenshot of `df -h`" },
      { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
    ] },
  ];
  const census = censusMessages(messages);
  assert.equal(census.messages, messages.length);
  assert.equal(census.imageParts, 1);
  assert.ok(census.cyrillic > 0 && census.symbols > 0 && census.newlines > 0);

  const rebuilt = estimateMessages(messagesFor({
    id: "synthetic", callSite: "test", messages: census.messages,
    recordedMessageChars: [], actualInputTokens: 0, recordedEstimateAtTheTime: 0,
    provenance: "recorded", census,
  }));
  const direct = estimateMessages(messages);
  assert.ok(
    Math.abs(rebuilt - direct) <= census.messages,
    `census re-measured to ${rebuilt} against ${direct}`,
  );
});

test("a census carries counts and never the text it counted", () => {
  // This rides in agent.jsonl, which deliberately holds prompt lengths and no
  // prompt text. A field that serialised any part of a message would put a
  // private vault's notes on disk.
  const secret = "пароль hunter2 в заметке";
  const census = censusMessages([{ role: "user", content: secret }]);
  const serialized = JSON.stringify(census);
  assert.ok(!serialized.includes("hunter2"), serialized);
  for (const value of Object.values(census)) assert.equal(typeof value, "number");
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
