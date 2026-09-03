import type OpenAI from "openai";

/** A single image part costs this much regardless of its encoded length. */
export const MEDIA_TOKENS = 4_096;

/** Flat allowance per message for its role and the separators around it. */
const MESSAGE_OVERHEAD_TOKENS = 4;

// A single chars-per-token rate for everything but Cyrillic is a prose rate,
// and it collapses on the shell commands, config files and JSON envelopes that
// dominate large prompts: those carry three to four times more tokens per
// character than prose, so the error grew with prompt size instead of staying
// flat. The rates below split the classes a byte-pair tokenizer actually treats
// differently and were fitted against tests/fixtures/recorded-prompts.json —
// see its `fittedAgainst` note for the corpus and the ground truth.
//
// Words absorb the space in front of them, which is why letters and spaces
// share one generous rate. Digits and symbols cost a token per run plus a small
// per-character rate, because a tokenizer opens a new token at every switch
// into punctuation and then merges only short spans of it. Every newline opens
// its own token, which is why a caller that joins pieces has to charge one per
// join — it does that by adding a newline to a census, never by reaching for the
// rate itself. Every rate stays module-private for that reason: a caller holding
// one would be weighing text a second way, beside the walk below.
const CHARS_PER_TOKEN_CYRILLIC = 3.5;
const CHARS_PER_TOKEN_WORD = 8.1;
const CHARS_PER_TOKEN_SYMBOL = 2.1;
const SYMBOL_RUN_TOKENS = 1.1;

type CharClass = "cyrillic" | "cjk" | "word" | "digit" | "symbol" | "newline";

/** Letters of any remaining script, plus the whitespace that binds them into words. */
const WORD_CHARACTER = /[\p{L}\p{M}\s]/u;

function classify(code: number, char: string): CharClass {
  // ASCII first: this runs per character of every packing candidate, and the
  // prompts it walks are mostly ASCII.
  if (code < 0x80) {
    if (code === 0x0a) return "newline";
    if (code >= 0x30 && code <= 0x39) return "digit";
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
      || code === 0x20 || code === 0x09 || code === 0x0d) return "word";
    return "symbol";
  }
  if (code >= 0x0400 && code <= 0x052f) return "cyrillic";
  if ((code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af)) return "cjk";
  return WORD_CHARACTER.test(char) ? "word" : "symbol";
}

/**
 * The two numbers a token estimate is made of, before rounding: the weighted
 * class sum and the ceiling it is capped at. A caller that assembles one from
 * summed pieces has to cap once over the whole result, because capping each
 * piece and then adding would let the sum fall below the estimate of the joined
 * text — and it should sum a `TextCensus`, not these, which do not add exactly.
 */
export interface TextMeasure {
  raw: number;
  /** UTF-8 length: a byte-level tokenizer cannot emit more than one token per byte. */
  bytes: number;
}

/**
 * The character counts `measureText` weighs, kept as counts. This is the whole
 * input the rates read, so a prompt recorded as a census can be re-measured
 * without its text ever being stored — which is what makes a recorded-prompt
 * fixture derivable from a run log. Newlines are counted apart from symbol runs
 * even though both are charged `SYMBOL_RUN_TOKENS`, because a reconstruction has
 * to place them to reproduce the run count.
 */
export interface TextCensus {
  cyrillic: number;
  cjk: number;
  word: number;
  symbols: number;
  symbolRuns: number;
  newlines: number;
}

/**
 * A prepared request's census: every message's characters summed, plus the image
 * parts, which are priced flat and carry no characters.
 */
export interface PromptCensus extends TextCensus {
  imageParts: number;
  /** Message count, because each message is charged a flat overhead on top of its text. */
  messages: number;
}

/**
 * A text's counts beside its UTF-8 length: everything an estimate is made of,
 * still in the form that adds exactly. A caller that sums pieces and renders them
 * joined wants this rather than `TextMeasure`, because the counts are integers —
 * summing them and applying the rates once reproduces the estimate of the joined
 * text bit for bit, where summing per-piece `raw` values accumulates float error.
 */
export interface TextCensusMeasure {
  census: TextCensus;
  bytes: number;
}

/**
 * The single character walk `measureText`, `censusText` and `measureCensus` are
 * projections of. They share it so a census can never drift from the measure it
 * describes: the rates are applied to the counts this returns, never to a second
 * walk.
 */
function walkText(text: string): TextCensusMeasure {
  let bytes = 0;
  let cyrillic = 0;
  let cjk = 0;
  let word = 0;
  let symbols = 0;
  let symbolRuns = 0;
  let newlines = 0;
  let previous: CharClass | undefined;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    const cls = classify(code, char);
    switch (cls) {
      case "cyrillic": cyrillic++; break;
      case "cjk": cjk++; break;
      case "word": word++; break;
      case "newline": newlines++; break;
      default:
        symbols++;
        if (cls !== previous) symbolRuns++;
        break;
    }
    previous = cls;
  }
  return { census: { cyrillic, cjk, word, symbols, symbolRuns, newlines }, bytes };
}

/** The weighted class sum, from counts alone. */
export function rawFromCensus(census: TextCensus): number {
  return census.cyrillic / CHARS_PER_TOKEN_CYRILLIC
    + census.cjk
    + census.word / CHARS_PER_TOKEN_WORD
    + census.symbols / CHARS_PER_TOKEN_SYMBOL
    + (census.symbolRuns + census.newlines) * SYMBOL_RUN_TOKENS;
}

function measureText(text: string): TextMeasure {
  const walked = walkText(text);
  return { raw: rawFromCensus(walked.census), bytes: walked.bytes };
}

function censusText(text: string): TextCensus {
  return walkText(text).census;
}

export function measureCensus(text: string): TextCensusMeasure {
  return walkText(text);
}

/**
 * Caps a class sum at what a byte-level tokenizer can physically bill. The
 * per-run charge otherwise exceeds one token per character on text that
 * alternates class every character — "1.1.1", an IP list, a numeric table. The
 * cap is UTF-8 length rather than character count because a token can cover one
 * byte but never less: on ASCII the two agree, and on anything else counting
 * characters would cap 2-4x below what the provider can charge.
 */
export function cappedTokens(measure: TextMeasure): number {
  return Math.min(measure.raw, measure.bytes);
}

/**
 * Approximate token count for a plain string. Deliberately biased upward:
 * underestimating produces real provider context-length errors, while
 * overestimating only wastes budget. The runtime calibration factor corrects
 * the remaining bias per model.
 */
export function estimateText(text: string, calibration = 1): number {
  return Math.ceil(cappedTokens(measureText(text)) * calibration);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Walks a message summing text and counting image parts, serializing nothing. */
function rawValueTokens(value: unknown): number {
  if (typeof value === "string") return estimateText(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + rawValueTokens(item), 0);
  if (!isRecord(value)) return 0;
  if (value.type === "image_url") return MEDIA_TOKENS;
  let total = 0;
  for (const item of Object.values(value)) total += rawValueTokens(item);
  return total;
}

export function estimateMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  calibration = 1,
): number {
  let total = 0;
  for (const message of messages) total += MESSAGE_OVERHEAD_TOKENS + rawValueTokens(message);
  return Math.ceil(total * calibration);
}

/** Accumulates counts over the same values `rawValueTokens` charges. */
function censusValue(value: unknown, into: PromptCensus): void {
  if (typeof value === "string") {
    const census = censusText(value);
    into.cyrillic += census.cyrillic;
    into.cjk += census.cjk;
    into.word += census.word;
    into.symbols += census.symbols;
    into.symbolRuns += census.symbolRuns;
    into.newlines += census.newlines;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) censusValue(item, into);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "image_url") {
    into.imageParts += 1;
    return;
  }
  for (const item of Object.values(value)) censusValue(item, into);
}

/**
 * The whole prepared request as counts, walking exactly the values
 * `estimateMessages` charges. Text is read and discarded, so a run log can carry
 * this where it cannot carry prompts — which is what makes a recorded request
 * re-measurable offline.
 *
 * Summing across messages loses the per-message boundary, and `estimateText`
 * rounds once per message, so re-measuring the census as one string can land up
 * to `messages - 1` tokens below the estimate that was logged beside it. The
 * boundary is not recorded because nothing reads it: the fixture this feeds
 * measures a whole prompt.
 */
export function censusMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
): PromptCensus {
  const census: PromptCensus = {
    cyrillic: 0, cjk: 0, word: 0, symbols: 0, symbolRuns: 0, newlines: 0,
    imageParts: 0, messages: messages.length,
  };
  for (const message of messages) censusValue(message, census);
  return census;
}
