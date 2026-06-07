import type { LlmClient, LlmCallOptions } from "../types";
import { buildChatParams, extractUsage } from "./llm-utils";
import { render } from "./template";
import queryFixLinksTemplate from "../../prompts/query-fix-links.md";
import type OpenAI from "openai";

export interface QueryLinkValidationResult {
  text: string;
  brokenInitial: string[];
  brokenFinal: string[];
  retried: boolean;
}

export function extractAnswerLinks(text: string): string[] {
  const re = /\[\[([^\]|#/]+?)\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

export function findBrokenLinks(links: string[], knownStems: Set<string>): string[] {
  return [...new Set(links.filter((s) => !knownStems.has(s)))];
}

export function annotateBroken(text: string, broken: Set<string>): string {
  return text.replace(/\[\[([^\]|#/]+?)\]\]/g, (full: string, stem: string) => {
    return broken.has(stem.trim()) ? `${full} *(нет в wiki)*` : full;
  });
}

export async function rewriteWithValidLinks(
  llm: LlmClient,
  model: string,
  question: string,
  originalAnswer: string,
  broken: string[],
  contextStems: string[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ text: string; outputTokens: number }> {
  const systemPrompt = render(queryFixLinksTemplate, {
    broken: broken.join(", "),
    available: contextStems.join(", "),
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Вопрос: ${question}\n\nОтвет для исправления:\n${originalAnswer}` },
  ];

  const params = buildChatParams(model, messages, { ...opts, thinkingBudgetTokens: undefined }, false);
  const resp = await llm.chat.completions.create(
    params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    { signal },
  );
  const text = resp.choices[0]?.message?.content ?? originalAnswer;
  const outputTokens = extractUsage(resp) ?? 0;
  return { text, outputTokens };
}
