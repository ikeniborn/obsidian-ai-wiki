import { join } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { EntityTypesDeltaSchema } from "./zod-schemas";
import { parseJsonPages } from "./ingest";
import lintTemplate from "../../prompts/lint.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm } from "../utils/raw-frontmatter";
import { checkGraphStructure, pageId } from "../wiki-graph";
import { graphCache } from "../wiki-graph-cache";
import { upsertIndexAnnotation } from "../wiki-index";

const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];

export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  hubThreshold: number = 20,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const targets = domainId
    ? domains.filter((d) => d.id === domainId)
    : domains;

  if (targets.length === 0) {
    yield { kind: "error", message: domainId ? `Domain "${domainId}" not found.` : "No domains configured." };
    return;
  }

  const start = Date.now();
  const reportParts: string[] = [];
  let outputTokens = 0;

  for (const domain of targets) {
    if (signal.aborted) return;

    const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
    const wikiVaultPath = vaultTools.toVaultPath(absWiki);
    if (!wikiVaultPath) {
      reportParts.push(`## ${domain.id}\nWiki folder outside vault — skipped.`);
      continue;
    }

    yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
    const allFiles = await vaultTools.listFiles(wikiVaultPath);
    const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
    yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

    const pages = await vaultTools.readAll(files);

    const { graph } = graphCache.get(domain.id, pages);
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph, hubThreshold);
    const allIssues = [structuralIssues, graphIssues].filter(Boolean).join("\n");

    const entityTypesBlock = buildEntityTypesBlock(domain);

    yield { kind: "assistant_text", delta: `Evaluating domain "${domain.id}" quality...\n` };
    const systemContent = render(lintTemplate, {
      domain_name: domain.name,
      entity_types_block: entityTypesBlock ? `\nТИПЫ СУЩНОСТЕЙ ДОМЕНА:\n${entityTypesBlock}` : "",
    });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: [
          `Домен: ${domain.id} (${domain.name})`,
          `Автоматические проблемы:\n${allIssues || "Нет."}`,
          "",
          `Wiki-страницы:\n${[...pages.entries()].map(([p, c]) => `--- ${p} ---\n${c}`).join("\n\n")}`,
        ].join("\n"),
      },
    ];

    const params = buildChatParams(model, messages, opts, true);
    let llmReport = "";
    try {
      const stream = await llm.chat.completions.create(
        { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      for await (const chunk of stream) {
        const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { llmReport += content; yield { kind: "assistant_text", delta: content }; }
        if (tok !== undefined) outputTokens += tok;
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return;
      const resp = await llm.chat.completions.create(
        { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      llmReport = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      if (tok !== undefined) outputTokens += tok;
      if (llmReport) yield { kind: "assistant_text", delta: llmReport };
    }

    reportParts.push(`## ${domain.id}\n${allIssues ? `**Структурные проблемы:**\n${allIssues}\n\n` : ""}${llmReport}`);

    if (signal.aborted) return;
    yield { kind: "assistant_text", delta: `\nActualizing domain config for "${domain.id}"...\n` };
    const patchRes = await actualizeDomainConfig(domain, pages, llm, model, opts, signal);
    outputTokens += patchRes.outputTokens;
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }

    if (signal.aborted) return;
    yield { kind: "assistant_text", delta: `\nApplying fixes for "${domain.id}"...\n` };
    const fixMessages = buildFixMessages(domain, wikiVaultPath, pages, allIssues, entityTypesBlock, llmReport);
    const fixParams = buildChatParams(model, fixMessages, opts, true);
    let fixFullText = "";
    try {
      const fixStream = await llm.chat.completions.create(
        { ...fixParams, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      for await (const chunk of fixStream) {
        const { content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (content) fixFullText += content;
        if (tok !== undefined) outputTokens += tok;
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return;
      const resp = await llm.chat.completions.create(
        { ...fixParams, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      fixFullText = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      if (tok !== undefined) outputTokens += tok;
    }

    const fixedPages = parseJsonPages(fixFullText);
    const writtenPaths: string[] = [];
    for (const page of fixedPages) {
      if (!page.path.startsWith(wikiVaultPath + "/")) {
        yield { kind: "tool_use", name: "Write", input: { path: page.path } };
        yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
        continue;
      }
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      try {
        await vaultTools.write(page.path, page.content);
        writtenPaths.push(page.path);
        yield { kind: "tool_result", ok: true };
        if (page.annotation) {
          try {
            await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
          } catch { /* non-critical */ }
        }
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      }
    }
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
      for (const p of writtenPaths) {
        try {
          pages.set(p, await vaultTools.read(p));
        } catch { /* non-critical */ }
      }
    }

    const backlinks = new Map<string, Set<string>>();
    for (const [wikiPath, wikiContent] of pages) {
      for (const src of parseWikiSourcesFromFm(wikiContent)) {
        const rawPath = src.slice(2, -2);
        if (!backlinks.has(rawPath)) backlinks.set(rawPath, new Set());
        backlinks.get(rawPath)!.add(`[[${wikiPath}]]`);
      }
    }

    const syncToday = new Date().toISOString().slice(0, 10);
    let syncUpdated = 0;
    for (const [rawPath, articles] of backlinks) {
      yield { kind: "tool_use", name: "Write", input: { path: rawPath } };
      try {
        const rawContent = await vaultTools.read(rawPath);
        const existingArticles = parseWikiArticlesFromFm(rawContent);
        const mergedArticles = [...new Set([...existingArticles, ...articles])];
        const newContent = upsertRawFrontmatter(rawContent, {
          wiki_updated: syncToday,
          wiki_articles: mergedArticles,
        });
        await vaultTools.write(rawPath, newContent);
        syncUpdated++;
        yield { kind: "tool_result", ok: true, preview: rawPath };
      } catch (e) {
        yield {
          kind: "tool_result",
          ok: false,
          preview: `backlink sync failed: ${rawPath}: ${(e as Error).message}`,
        };
      }
    }
    if (backlinks.size > 0) {
      reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
    }

  }

  yield { kind: "result", durationMs: Date.now() - start, text: reportParts.join("\n\n---\n\n"), outputTokens: outputTokens || undefined };
}

export function checkStructure(pages: Map<string, string>): string {
  const issues: string[] = [];
  for (const [path, content] of pages) {
    if (!content.startsWith("---")) {
      issues.push(`- ${path}: missing frontmatter`);
    }
    const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    for (const link of links) {
      const linked = [...pages.keys()].some((p) => p.endsWith(`${link}.md`));
      if (!linked) issues.push(`- ${path}: dead link [[${link}]]`);
    }
  }
  return issues.join("\n");
}

function buildEntityTypesBlock(domain: DomainEntry): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types
    .map((et) => `- ${et.type}: ${et.description}`)
    .join("\n");
}

function computeEntityDiff(oldTypes: EntityType[], newTypes: EntityType[]): string {
  const oldMap = new Map(oldTypes.map((et) => [et.type, et]));
  const newMap = new Map(newTypes.map((et) => [et.type, et]));
  const added = newTypes.filter((et) => !oldMap.has(et.type));
  const removed = oldTypes.filter((et) => !newMap.has(et.type));
  const modified = newTypes.filter((et) => {
    const old = oldMap.get(et.type);
    return old && JSON.stringify(old) !== JSON.stringify(et);
  });
  if (!added.length && !removed.length && !modified.length) return "### Изменения entity_types\nИзменений нет.";
  const lines = ["### Изменения entity_types"];
  added.forEach((et) => lines.push(`- ✚ добавлен: **${et.type}**`));
  removed.forEach((et) => lines.push(`- ✖ удалён: **${et.type}**`));
  modified.forEach((et) => lines.push(`- ✎ обновлён: **${et.type}**`));
  return lines.join("\n");
}

function buildFixMessages(
  domain: DomainEntry,
  wikiVaultPath: string,
  pages: Map<string, string>,
  allIssues: string,
  entityTypesBlock: string,
  lintReport: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const today = new Date().toISOString().slice(0, 10);
  const pagesBlock = [...pages.entries()].map(([p, c]) => `--- ${p} ---\n${c}`).join("\n\n");
  return [
    {
      role: "system",
      content: [
        `Ты — редактор wiki-базы знаний домена «${domain.name}».`,
        `Исправь проблемы в wiki-страницах и верни только изменённые страницы.`,
        `ПРАВИЛА: мёртвые ссылки [[X]] убери или замени; отсутствующий frontmatter добавь (wiki_updated: ${today}, wiki_status: stub); дублирование объедини; размытые определения уточни.`,
        entityTypesBlock ? `\nТИПЫ СУЩНОСТЕЙ:\n${entityTypesBlock}` : "",
        `\nВерни ТОЛЬКО JSON-массив изменённых страниц:`,
        `[{"path":"${wikiVaultPath}/EntityName.md","content":"полный контент"}]`,
      ].filter(Boolean).join("\n"),
    },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        allIssues ? `\nСтруктурные проблемы:\n${allIssues}` : "\nСтруктурных проблем не обнаружено.",
        `\nОтчёт Lint (рекомендации):\n${lintReport}`,
        `\nWiki-страницы:\n${pagesBlock}`,
      ].join("\n"),
    },
  ];
}

async function actualizeDomainConfig(
  domain: DomainEntry,
  pages: Map<string, string>,
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ patch: { entity_types?: EntityType[]; language_notes?: string } | null; outputTokens: number }> {
  const currentConfig = JSON.stringify({
    entity_types: domain.entity_types ?? [],
    language_notes: domain.language_notes ?? "",
  }, null, 2);

  const pagesSnippet = [...pages.entries()]
    .map(([p, c]) => `${p}:\n${c}`)
    .join("\n\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: [
        `Ты — архитектор wiki-базы знаний. Проанализируй текущий конфиг домена и реальное содержимое wiki.`,
        `Верни ТОЛЬКО валидный JSON с обновлёнными полями:`,
        `{`,
        `  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],`,
        `  "language_notes": "..."`,
        `}`,
        `Правила обновления:`,
        `- Сохраняй существующие типы если они полезны, уточняй описания по реальному контенту`,
        `- Добавляй новые типы если в wiki есть паттерны, не покрытые текущим конфигом`,
        `- Убирай типы с нулевым покрытием только если уверен что они нерелевантны`,
        `- Обновляй extraction_cues по реальным словам из wiki-страниц`,
        `- language_notes — правила написания терминов, которые агент должен соблюдать`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        ``,
        `Текущий конфиг:`,
        `\`\`\`json`,
        currentConfig,
        `\`\`\``,
        ``,
        `Wiki-страницы (фрагменты):`,
        pagesSnippet || "(нет страниц)",
      ].join("\n"),
    },
  ];

  // JSON example appended to system prompt for stronger structural guidance.
  const systemContent = (messages[0].content as string) + `\n\n## Output JSON Example\n\n` + JSON.stringify({
    reasoning: "Сохранил Process, добавил Contract по новым страницам.",
    entity_types: [
      { type: "Process", description: "Бизнес-процесс", extraction_cues: ["BPMN","workflow"], wiki_subfolder: "processes" },
      { type: "Contract", description: "Договор/SLA", extraction_cues: ["SLA","договор"], wiki_subfolder: "contracts" },
    ],
    language_notes: "Использовать русский для бизнес-терминов.",
  }, null, 2);
  messages[0] = { role: "system", content: systemContent };

  const collected: RunEvent[] = [];
  try {
    const r = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: EntityTypesDeltaSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "lint.patch",
      signal,
      onEvent: (e) => collected.push(e),
    });
    const parsed = r.value;
    const patch: { entity_types?: EntityType[]; language_notes?: string } = {};
    if (Array.isArray(parsed.entity_types)) patch.entity_types = parsed.entity_types as EntityType[];
    if (typeof parsed.language_notes === "string") patch.language_notes = parsed.language_notes;
    return { patch: Object.keys(patch).length > 0 ? patch : null, outputTokens: r.outputTokens };
  } catch {
    return { patch: null, outputTokens: 0 };
  }
}
