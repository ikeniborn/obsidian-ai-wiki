import type OpenAI from "openai";
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import evaluatorTemplate from "../../prompts/evaluator.md";
import { render } from "./template";
import { buildChatParams } from "./llm-utils";

export interface EvalResult {
  score: number;
  reasoning: string;
}

export function parseEvalResponse(text: string): EvalResult | null {
  const match = text.match(/\{[^{}]*"score"[^{}]*"reasoning"[^{}]*\}/s)
    ?? text.match(/\{[^{}]*"reasoning"[^{}]*"score"[^{}]*\}/s);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (
      typeof parsed !== "object" || parsed === null ||
      typeof (parsed as Record<string, unknown>).score !== "number" ||
      typeof (parsed as Record<string, unknown>).reasoning !== "string"
    ) return null;
    const p = parsed as { score: number; reasoning: string };
    return { score: Math.min(10, Math.max(0, p.score)), reasoning: p.reasoning };
  } catch {
    return null;
  }
}

export async function* runEvaluator(
  llm: LlmClient,
  model: string,
  operation: string,
  taskInput: string,
  result: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const userContent = render(evaluatorTemplate, { operation, task_input: taskInput, result });
  const messages = [{ role: "user" as const, content: userContent }];
  const params = buildChatParams(model, messages, opts);

  try {
    const nonStreamParams = { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
    const resp = await llm.chat.completions.create(nonStreamParams, { signal });
    const text = resp.choices[0]?.message?.content ?? "";
    const evalResult = parseEvalResponse(text);
    if (evalResult) {
      yield { kind: "eval_result", score: evalResult.score, reasoning: evalResult.reasoning };
    }
  } catch {
    // evaluator failures are non-fatal
  }
}
