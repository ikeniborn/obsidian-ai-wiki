import { join } from "node:path";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import { checkStructure } from "./lint";
import { parseJsonPages } from "./ingest";
import fixTemplate from "../../prompts/fix.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";

const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md"];

export async function* runFix(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  lintReport?: string,
  userInstruction?: string,
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const domain = domainId
    ? domains.find((d) => d.id === domainId)
    : domains[0];

  if (!domain) {
    yield { kind: "error", message: domainId ? `Domain "${domainId}" not found.` : "No domains configured." };
    return;
  }

  const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
    return;
  }

  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  if (files.length === 0) {
    const start = Date.now();
    yield { kind: "result", durationMs: Date.now() - start, text: "No wiki pages to fix." };
    return;
  }

  const pages = await vaultTools.readAll(files);
  const structuralIssues = checkStructure(pages);

  const entityTypesBlock = domain.entity_types?.length
    ? domain.entity_types.map((et) => `- ${et.type}: ${et.description}`).join("\n")
    : "";

  yield { kind: "assistant_text", delta: `Fixing wiki pages for domain "${domain.id}"...\n` };

  const start = Date.now();
  const messages = buildFixMessages(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, lintReport, userInstruction);
  const params = buildChatParams(model, messages, opts);

  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }

  if (signal.aborted) return;

  const fixedPages = parseJsonPages(fullText);
  const writtenPaths: string[] = [];
  const errors: string[] = [];
  for (const page of fixedPages) {
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      writtenPaths.push(page.path);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      errors.push(`${page.path}: ${(e as Error).message}`);
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  const summary = buildFixSummary(domain.id, writtenPaths, errors, structuralIssues, lintReport);
  yield { kind: "result", durationMs: Date.now() - start, text: summary };
}

function buildFixSummary(
  domainId: string,
  writtenPaths: string[],
  errors: string[],
  structuralIssues: string,
  lintReport?: string,
): string {
  const lines: string[] = [];

  const source = lintReport ? "lint-отчёта" : "структурного анализа";
  if (writtenPaths.length > 0) {
    lines.push(`Исправлено ${writtenPaths.length} стр. домена «${domainId}» на основе ${source}:`);
    for (const p of writtenPaths) {
      const name = p.split("/").pop() ?? p;
      lines.push(`  • ${name}`);
    }
  } else {
    lines.push(`Домен «${domainId}»: правки не потребовались (на основе ${source}).`);
  }

  if (errors.length > 0) {
    lines.push(`\nОшибки записи (${errors.length}):`);
    for (const e of errors) lines.push(`  ✖ ${e}`);
  }

  if (structuralIssues) {
    lines.push(`\nСтруктурные проблемы:\n${structuralIssues}`);
  } else {
    lines.push("\nСтруктурных проблем не обнаружено.");
  }

  return lines.join("\n");
}

function buildFixMessages(
  domain: DomainEntry,
  wikiVaultPath: string,
  pages: Map<string, string>,
  structuralIssues: string,
  entityTypesBlock: string,
  lintReport?: string,
  userInstruction?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const today = new Date().toISOString().slice(0, 10);
  const pagesBlock = [...pages.entries()]
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  const fixInstruction = userInstruction
    ? `Выполни задачу пользователя. Верни только изменённые страницы.`
    : `Исправь проблемы в wiki-страницах и верни только изменённые страницы.`;

  const systemContent = render(fixTemplate, {
    domain_name: domain.name,
    fix_instruction: fixInstruction,
    entity_types_block: entityTypesBlock ? `ТИПЫ СУЩНОСТЕЙ:\n${entityTypesBlock}\n` : "",
    wiki_path: wikiVaultPath,
    today,
  });

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        userInstruction ? `ЗАДАЧА:\n${userInstruction}` : "",
        lintReport ? `\nОТЧЁТ LINT:\n${lintReport}` : "",
        structuralIssues ? `\nСТРУКТУРНЫЕ ПРОБЛЕМЫ:\n${structuralIssues}` : "",
        `\nWIKI-СТРАНИЦЫ домена ${domain.id}:\n${pagesBlock}`,
      ].filter(Boolean).join("\n"),
    },
  ];
}
