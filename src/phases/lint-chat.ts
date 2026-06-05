import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, RunRequest } from "../types";
import type { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { LintChatSchema } from "./zod-schemas";
import type { LintChatResponse } from "./zod-schemas";
import lintChatTemplate from "../../prompts/lint-chat.md";
import { render } from "./template";
import { GLOBAL_WIKI_SCHEMA_PATH, domainWikiFolder } from "../wiki-path";
import { upsertIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
import { ensureDomainConfig } from "../domain-config";

const META_FILES = ["_index.md", "_log.md"];

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

  // 1. Load domain pages (Glob emitted immediately — before any async I/O)
  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**` } };
  await ensureDomainConfig(vaultTools, wikiVaultPath);
  const schemaContent = await tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH);
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  yield { kind: "tool_use", name: "Read", input: { files: String(files.length) } };
  const pages = await vaultTools.readAll(files);
  yield { kind: "tool_result", ok: true, preview: "loaded" };

  const pagesBlock = [...pages.entries()]
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  // 2. Build messages
  const systemContent = render(lintChatTemplate, {
    domain_name: domain.name,
    lint_report: req.context ?? "",
    pages_block: pagesBlock,
    schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
  });

  const chatMessages = req.chatMessages ?? [];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // 3. Structured LLM call
  yield { kind: "tool_use", name: "Applying fixes", input: { pages: String(files.length) } };
  const pwtEvents: RunEvent[] = [];
  let result: { value: LintChatResponse; outputTokens: number; fullText: string };
  try {
    result = await parseWithRetry({
      llm,
      model,
      baseMessages: messages,
      opts: { ...opts, jsonMode: "json_object" },
      schema: LintChatSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "lint-chat.fix",
      signal,
      onEvent: (ev) => pwtEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${result.value.pages?.length ?? 0} pages` };
  } catch (e) {
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of pwtEvents) yield ev;
    yield { kind: "error", message: `lint-chat: ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  for (const ev of pwtEvents) yield ev;

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
      continue;
    }
    if (page.annotation) {
      try {
        await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
      } catch { /* non-critical */ }
    }
  }

  // 5. Emit result
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.summary, outputTokens: result.outputTokens || undefined };
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}
