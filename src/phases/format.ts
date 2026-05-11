import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import formatTemplate from "../../prompts/format.md";
import formatSchemaDefault from "../../templates/_format_schema.md";
import { render } from "./template";
import { extractJsonObject, missingTokensWithContext, looksTruncated } from "./format-utils";
import { WIKI_ROOT } from "../wiki-path";

function extractImagePaths(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1].trim();
    if (!url.startsWith("http")) out.push(url);
  }
  return out;
}

export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const filePath = args[0];

  if (!filePath) {
    yield { kind: "error", message: "Format: file path is required" };
    return;
  }
  if (signal.aborted) return;

  const original = await vaultTools.read(filePath);
  if (!original) {
    yield { kind: "error", message: `Format: cannot read ${filePath}` };
    return;
  }

  const formatSchemaPath = `${WIKI_ROOT}/_format_schema.md`;
  let formatSchema: string;
  try {
    formatSchema = await vaultTools.read(formatSchemaPath);
  } catch {
    formatSchema = formatSchemaDefault;
    try { await vaultTools.write(formatSchemaPath, formatSchemaDefault); } catch { /* не блокируем */ }
  }

  const systemContent = render(formatTemplate, {
    format_schema: formatSchema,
    has_vision: String(hasVision),
  });

  const userInitial = `Исходный файл: ${filePath}\n---\n${original}`;

  const imagePaths = hasVision ? extractImagePaths(original) : [];

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] | string =
    imagePaths.length > 0
      ? [
          { type: "text", text: userInitial },
          ...imagePaths.map<OpenAI.Chat.ChatCompletionContentPart>((p) => ({
            type: "image_url",
            image_url: { url: p },
          })),
        ]
      : userInitial;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
    ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  yield { kind: "assistant_text", delta: `Анализ файла ${filePath}...\n` };

  const baseParams = { ...buildChatParams(model, messages, opts), response_format: { type: "json_object" } };

  let lastFinishReason: string | null = null;

  async function* callOnce(p: Record<string, unknown>): AsyncGenerator<RunEvent, string> {
    let acc = "";
    lastFinishReason = null;
    try {
      const stream = await llm.chat.completions.create(
        { ...p, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      for await (const chunk of stream) {
        const { reasoning, content } = extractStreamDeltas(chunk);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { acc += content; yield { kind: "assistant_text", delta: content }; }
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return acc;
      const resp = await llm.chat.completions.create(
        { ...p, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      acc = resp.choices[0]?.message?.content ?? "";
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
    }
    return acc;
  }

  let fullText = yield* callOnce(baseParams);
  if (signal.aborted) return;

  let parsed = extractJsonObject(fullText);
  const truncated = !parsed && (lastFinishReason === "length" || looksTruncated(fullText));
  if (!parsed && truncated) {
    yield { kind: "error", message: "Format: ответ обрезан по лимиту вывода модели — сократите страницу или увеличьте лимит (claude-agent: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh; native-agent: Settings → per-operation → format → maxTokens)" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  if (!parsed) {
    yield { kind: "assistant_text", delta: "\n[JSON невалиден — повторяю запрос]\n" };
    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent + "\n\nКРИТИЧЕСКИ ВАЖНО: верни ТОЛЬКО JSON-объект {\"report\": \"...\", \"formatted\": \"...\"} без markdown-обёртки, без ```json fence, без пояснений. Все спецсимволы внутри строк должны быть экранированы (\\n, \\\", \\\\)." },
      { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
      ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    ];
    const retryParams = { ...buildChatParams(model, retryMessages, opts), response_format: { type: "json_object" } };
    fullText = yield* callOnce(retryParams);
    if (signal.aborted) return;
    parsed = extractJsonObject(fullText);
  }
  if (!parsed) {
    const retryTruncated = lastFinishReason === "length" || looksTruncated(fullText);
    const msg = retryTruncated
      ? "Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или увеличьте лимит (claude-agent: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh; native-agent: Settings → per-operation → format → maxTokens)"
      : "Format: LLM вернул невалидный JSON (после retry)";
    yield { kind: "error", message: msg };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }

  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
  const baseName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).replace(/\.md$/, "") || "page";
  const tempPath = dir ? `${dir}/${baseName}.formatted.md` : `${baseName}.formatted.md`;

  try {
    await vaultTools.write(tempPath, parsed.formatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
    return;
  }

  const missing = missingTokensWithContext(original, parsed.formatted);
  yield { kind: "format_preview", tempPath, report: parsed.report, missingTokens: missing };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.report };
}
