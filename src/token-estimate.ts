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
// its own token.
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
 * Approximate token count for a plain string. Deliberately biased upward:
 * underestimating produces real provider context-length errors, while
 * overestimating only wastes budget. The runtime calibration factor corrects
 * the remaining bias per model.
 */
export function estimateText(text: string, calibration = 1): number {
  let cyrillic = 0;
  let cjk = 0;
  let word = 0;
  let symbol = 0;
  let runs = 0;
  let previous: CharClass | undefined;
  for (const char of text) {
    const cls = classify(char.codePointAt(0) ?? 0, char);
    switch (cls) {
      case "cyrillic": cyrillic++; break;
      case "cjk": cjk++; break;
      case "word": word++; break;
      case "newline": runs++; break;
      default:
        symbol++;
        if (cls !== previous) runs++;
        break;
    }
    previous = cls;
  }
  const raw = cyrillic / CHARS_PER_TOKEN_CYRILLIC
    + cjk
    + word / CHARS_PER_TOKEN_WORD
    + symbol / CHARS_PER_TOKEN_SYMBOL
    + runs * SYMBOL_RUN_TOKENS;
  return Math.ceil(raw * calibration);
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
