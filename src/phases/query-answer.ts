import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import { queryAnswerProfile } from "./framed-output";
import { runStructuredWithRetry } from "./structured-output";
import { makeQueryAnswerSchema } from "./zod-schemas";
import { extractAnswerLinks, findBrokenLinks, annotateBroken } from "./query-link-validator";
import { resolveLink } from "./link-resolver";

/**
 * Stream one answer for a prepared system prompt + context block, then run the
 * deterministic‒llm WikiLink validation/repair tail. Yields the same events the
 * inline runQuery tail used to yield. Returns the final answer text + output tokens.
 */
export async function* answerFromContext(args: {
  llm: LlmClient;
  model: string;
  opts: LlmCallOptions;
  signal: AbortSignal;
  systemPrompt: string;
  question: string;
  contextBlock: string;
  selectedIds: Set<string>;
  wikiLinkValidationRetries: number;
}): AsyncGenerator<RunEvent, { answer: string; outputTokens: number }> {
  const { llm, model, opts, signal, systemPrompt, question, contextBlock, selectedIds, wikiLinkValidationRetries } = args;
  let outputTokens = 0;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Question: ${question}\n\nWiki pages:\n${contextBlock}` },
  ];

  const params = buildChatParams(model, messages, opts, true);
  let answer = "";
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;
  yield { kind: "tool_use", name: "Answering", input: {} };
  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
    streamStats = getStats();
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return { answer: "", outputTokens };
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }

  if (signal.aborted) return { answer, outputTokens };
  yield { kind: "tool_result", ok: !!answer, preview: answer ? `${answer.length} chars` : "no response" };

  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    const knownStems = new Set(selectedIds);
    const links = extractAnswerLinks(answer);
    const broken = findBrokenLinks(links, knownStems);
    yield {
      kind: "tool_result",
      ok: broken.length === 0,
      preview: broken.length === 0 ? "all valid" : `${broken.length} broken`,
    };

    if (broken.length > 0) {
      yield { kind: "tool_use", name: "FixingLinks", input: { broken: broken.length } };

      // Deterministic resolve first — no LLM.
      const candidates = [...knownStems];
      const resolvedPairs: string[] = [];
      const stripped: string[] = [];
      for (const b of broken) {
        const r = resolveLink(b, candidates);
        if (r.kind === "resolved" && r.stem !== b) {
          answer = answer.split(`[[${b}]]`).join(`[[${r.stem}]]`);
          resolvedPairs.push(`${b}→${r.stem}`);
        } else {
          stripped.push(b);
        }
      }
      if (resolvedPairs.length > 0) yield { kind: "rule_fired", ruleId: "resolveLink", count: resolvedPairs.length };

      // Unresolved stems → one structured LLM repair pass (zod-validated), then annotate.
      let llmFixed = 0;
      if (stripped.length > 0 && wikiLinkValidationRetries > 0) {
        const validList = candidates.filter((s) => s.startsWith("wiki_")).join(", ");
        const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content:
            `Rewrite the answer so every WikiLink points to a valid stem. ` +
            `Broken stems: ${stripped.join(", ")}. Valid stems: ${validList}. ` +
            `Return frames only: <<<ANSWER>>> repaired markdown answer, ` +
            `<<<CITATIONS>>> one valid stem per bullet line, then <<<END>>>.` },
          { role: "user", content: `Question: ${question}\n\nAnswer to fix:\n${answer}` },
        ];
        const repairEvents: RunEvent[] = [];
        try {
          const schema = makeQueryAnswerSchema(knownStems);
          const r = await runStructuredWithRetry({
            llm, model, baseMessages,
            opts: { ...opts, jsonMode: false, thinkingBudgetTokens: undefined },
            profile: queryAnswerProfile(schema),
            maxRetries: wikiLinkValidationRetries,
            callSite: "query.answer",
            signal,
            onEvent: (ev) => repairEvents.push(ev),
          });
          for (const ev of repairEvents) yield ev;
          outputTokens += r.outputTokens;
          const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
          if (stillBroken.length === 0) {
            answer = r.value.answer_markdown;
            llmFixed = stripped.length;
            stripped.length = 0;
          }
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") return { answer, outputTokens };
          for (const ev of repairEvents) yield ev;
          // fall through to annotation
        }
      }
      if (stripped.length > 0) {
        answer = annotateBroken(answer, new Set(stripped));
        yield { kind: "rule_fired", ruleId: "annotateBroken", count: stripped.length };
      }

      const parts: string[] = [];
      if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
      if (llmFixed) parts.push(`llm-fixed ${llmFixed}`);
      if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
      yield { kind: "tool_result", ok: stripped.length === 0, preview: parts.join("; ") };
      yield { kind: "assistant_replace", text: answer };
    }
  }

  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  return { answer, outputTokens };
}
