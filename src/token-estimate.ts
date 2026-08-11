import type OpenAI from "openai";

/** A single image part costs this much regardless of its encoded length. */
export const MEDIA_TOKENS = 4_096;

/** Flat allowance per message for its role and the separators around it. */
const MESSAGE_OVERHEAD_TOKENS = 4;

// Fitted against tests/fixtures/recorded-prompts.json with the grid search in
// task-2-brief.md Step 5. Among the pairs whose minimum error is at or above
// zero (never underestimating), lat/4.2 cyr/1.9 has the smallest maximum: all
// four recorded requests land between +2.3% and +5.8% of the provider's own
// count at calibration 1 — inside the intent's 15% band.
const CHARS_PER_TOKEN_CYRILLIC = 1.9;
const CHARS_PER_TOKEN_DEFAULT = 4.2;

function isCyrillic(code: number): boolean {
  return code >= 0x0400 && code <= 0x052f;
}

function isCjk(code: number): boolean {
  return (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af);
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
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCyrillic(code)) cyrillic++;
    else if (isCjk(code)) cjk++;
    else other++;
  }
  const raw = cyrillic / CHARS_PER_TOKEN_CYRILLIC + cjk + other / CHARS_PER_TOKEN_DEFAULT;
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
