import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, RunRequest } from "../types";
import type { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { LintChatSchema } from "./zod-schemas";
import lintChatTemplate from "../../prompts/lint-chat.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";

const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];

export async function* runLintFixChat(
  req: RunRequest,
  vaultTools: VaultTools,
  _vaultRoot: string,
  domain: DomainEntry | undefined,
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  const start = Date.now();

  if (!domain) {
    yield { kind: "error", message: "lint-chat requires a domain" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }

  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);

  // 1. Load domain pages
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));

  const pages = await vaultTools.readAll(files);

  const pagesBlock = [...pages.entries()]
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  // 2. Build messages
  const systemContent = render(lintChatTemplate, {
    domain_name: domain.name,
    lint_report: req.context ?? "",
    pages_block: pagesBlock,
  });

  const chatMessages = req.chatMessages ?? [];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  // 3. Structured LLM call
  const result = await parseWithRetry({
    llm,
    model,
    baseMessages: messages,
    opts: { ...opts, jsonMode: "json_object" },
    schema: LintChatSchema,
    maxRetries: opts.structuredRetries ?? 1,
    callSite: "lint-chat.fix",
    signal,
    onEvent: (_ev: RunEvent) => {},
  });

  const parsed = result.value;

  // 4. Write pages
  for (const page of parsed.pages ?? []) {
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    try {
      await vaultTools.write(page.path, page.content);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  // 5. Emit result
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.summary, outputTokens: result.outputTokens || undefined };
}
