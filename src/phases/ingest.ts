import { isAbsolute, join, relative, dirname } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import { mergeEntityTypes } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { WikiPagesOutputSchema } from "./zod-schemas";
import type { WikiPagesOutput } from "./zod-schemas";
import ingestTemplate from "../../prompts/ingest.md";
import { render } from "./template";
import { GLOBAL_WIKI_SCHEMA_PATH, domainWikiFolder, validateArticlePath, domainIndexPath } from "../wiki-path";
import { ensureDomainConfig } from "../domain-config";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField } from "../utils/raw-frontmatter";
import { upsertIndexAnnotation, parseIndexAnnotations } from "../wiki-index";
import { pageId, bfsExpand } from "../wiki-graph";
import { graphCache } from "../wiki-graph-cache";
import type { PageSimilarityService } from "../page-similarity";
import { appendWikiLog } from "../wiki-log";
import type { IngestLogEntry } from "../wiki-log";

function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^wiki_status:[ \t]*(.+)$/m.exec(content);
  return m ? m[1].trim() : "unknown";
}

export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
  graphDepth: number = 1,
): AsyncGenerator<RunEvent> {
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "ingest: file path required" };
    return;
  }

  const absSource = isAbsolute(filePath) ? filePath : join(vaultRoot, filePath);
  const sourceVaultPath = vaultTools.toVaultPath(absSource);
  if (!sourceVaultPath) {
    yield { kind: "error", message: `Source file ${filePath} is outside the vault.` };
    return;
  }

  yield { kind: "tool_use", name: "Read", input: { path: sourceVaultPath } };
  let sourceContent: string;
  try {
    sourceContent = await vaultTools.read(sourceVaultPath);
  } catch (e) {
    yield { kind: "error", message: `Cannot read ${sourceVaultPath}: ${(e as Error).message}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: sourceContent.slice(0, 100) };

  const domain = detectDomain(absSource, domains, vaultRoot);
  if (!domain) {
    yield { kind: "error", message: "No domain found for this file. Configure domain-map." };
    return;
  }

  const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
    return;
  }

  const domainRoot = wikiVaultPath;

  await ensureDomainConfig(vaultTools, domainRoot);

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH),
    tryRead(vaultTools, domainIndexPath(domainRoot)),
  ]);

  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));

  let existingPages: Map<string, string>;
  if (similarity) {
    await similarity.loadCache(domainRoot, vaultTools);
    const annotations = cachedAnnotations ?? parseIndexAnnotations(indexContent);
    const seedPaths = await similarity.selectRelevant(sourceContent, annotations, existingPaths);

    // Build graph from all pages, BFS-expand from similarity seeds for full coverage
    const allPages = await vaultTools.readAll(nonMetaPaths);
    const { graph } = graphCache.get(domain.id, allPages);
    const seedIds = seedPaths.map((p) => pageId(p));
    const expandedIds = bfsExpand(seedIds, graph, graphDepth);
    existingPages = new Map([...allPages].filter(([p]) => expandedIds.has(pageId(p))));

    yield {
      kind: "info_text",
      icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
      summary: `${existingPages.size}/${nonMetaPaths.length} wiki-pages loaded (${similarity.config.mode}, bfs depth ${graphDepth})`,
      details: seedIds,
    };
  } else {
    existingPages = await vaultTools.readAll(nonMetaPaths);
  }

  yield { kind: "assistant_text", delta: `Synthesizing wiki pages for domain "${domain.id}"...\n` };

  const start = Date.now();
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
  );

  const pwtEvents: RunEvent[] = [];
  let parseResult: { value: WikiPagesOutput; outputTokens: number };
  try {
    parseResult = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: WikiPagesOutputSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.pages",
      signal,
      onEvent: (ev) => pwtEvents.push(ev),
    });
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    for (const ev of pwtEvents) yield ev;
    yield { kind: "error", message: `ingest: LLM output failed validation — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of pwtEvents) yield ev;
  if (signal.aborted) return;

  const outputTokens = parseResult.outputTokens;
  yield { kind: "assistant_text", delta: parseResult.value.reasoning, isReasoning: true };
  let pages = parseResult.value.pages;

  // --- Path validation + one retry ---
  const { valid, invalid } = splitByPathValidity(pages, wikiVaultPath);
  if (invalid.length > 0) {
    yield {
      kind: "assistant_text",
      delta: `⚠ Пути нарушают правило 4 сегментов, запрашиваю исправление: ${invalid.map((p) => p.path).join(", ")}\n`,
    };
    const retryText = await retryInvalidPaths(llm, model, messages, invalid, signal, opts);
    if (signal.aborted) return;
    if (retryText) {
      const retried = parseJsonPages(retryText);
      const { valid: retriedValid, invalid: retriedInvalid } = splitByPathValidity(retried, wikiVaultPath);
      // Emit ok:false for paths still invalid after retry
      for (const p of retriedInvalid) {
        yield { kind: "tool_use", name: "Write", input: { path: p.path } };
        yield { kind: "tool_result", ok: false, preview: `Path violates 4-level rule (!Wiki/<d>/<e>/<f>.md): ${p.path}` };
      }
      pages = [...valid, ...retriedValid];
    } else {
      // No retry text (error) — skip all invalid
      for (const p of invalid) {
        yield { kind: "tool_use", name: "Write", input: { path: p.path } };
        yield { kind: "tool_result", ok: false, preview: `Path violates 4-level rule (!Wiki/<d>/<e>/<f>.md): ${p.path}` };
      }
      pages = valid;
    }
  }

  const written: string[] = [];
  const logEntries: IngestLogEntry[] = [];
  for (const page of pages) {
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }

    let existingContent: string | null = null;
    try { existingContent = await vaultTools.read(page.path); } catch { /* new page */ }

    yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      written.push(page.path);
      yield { kind: "tool_result", ok: true };

      const relPath = page.path.startsWith(wikiVaultPath + "/")
        ? page.path.slice(wikiVaultPath.length + 1)
        : page.path;
      const statusTo = parseWikiStatus(page.content);
      if (existingContent === null) {
        logEntries.push({ path: relPath, action: "СОЗДАНА", statusTo });
      } else {
        logEntries.push({ path: relPath, action: "ОБНОВЛЕНА", statusFrom: parseWikiStatus(existingContent), statusTo });
      }

      if (page.annotation) {
        try {
          await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
        } catch { /* non-critical */ }
      }
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  const resultText = buildIngestSummary(domain.id, sourceVaultPath, written, pages.length);
  yield { kind: "assistant_text", delta: resultText };

  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }

  if (written.length > 0) {
    try {
      await appendWikiLog(vaultTools, domainRoot, domain.id, {
        op: "ingest",
        sourcePath: sourceVaultPath,
        entries: logEntries,
        outputTokens,
      });
    } catch { /* non-critical */ }

    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(sourceContent);
    const writtenLinks = written.map((p) => `[[${p}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    yield { kind: "tool_use", name: "Write", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, updatedSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }

  if (similarity && written.length > 0) {
    try {
      const updatedIndex = await vaultTools.read(domainIndexPath(wikiVaultPath)).catch(() => "");
      const updatedAnnotations = parseIndexAnnotations(updatedIndex);
      await similarity.refreshCache(domainRoot, vaultTools, updatedAnnotations);
    } catch { /* non-critical */ }
  }

  yield { kind: "result", durationMs: Date.now() - start, text: resultText, outputTokens: outputTokens || undefined };
}

function buildIngestSummary(domainId: string, sourcePath: string, written: string[], total: number): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  if (written.length === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const skipped = total - written.length;
  const lines = [`Источник «${src}» → домен «${domainId}»: записано ${written.length} стр.${skipped > 0 ? `, ошибок ${skipped}` : ""}`];
  for (const p of written) {
    lines.push(`  • ${p.split("/").pop()}`);
  }
  return lines.join("\n");
}

export function detectDomain(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = isAbsolute(sp) ? sp : join(vaultRoot, sp);
      return absFilePath.startsWith(abs);
    });
    if (matched) return d;
  }
  return domains[0] ?? null;
}

export function parseJsonPages(text: string): Array<{ path: string; content: string; annotation?: string }> {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[]).filter(
      (x): x is { path: string; content: string; annotation?: string } =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as { path?: unknown }).path === "string" &&
        typeof (x as { content?: unknown }).content === "string",
    );
  } catch {
    return [];
  }
}


async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

export function extractParentSourcePath(
  absSource: string,
  vaultRoot: string,
): string {
  const parentAbs = dirname(absSource);
  // Clamp: не выходить выше vault root
  const normedVault = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const clamped = (parentAbs + "/").startsWith(normedVault) ? parentAbs : vaultRoot;
  const rel = relative(vaultRoot, clamped);
  return (rel || ".") + "/";
}

function splitByPathValidity(
  pages: Array<{ path: string; content: string; annotation?: string }>,
  wikiVaultPath: string,
): {
  valid: Array<{ path: string; content: string; annotation?: string }>;
  invalid: Array<{ path: string; content: string; annotation?: string }>;
} {
  const valid: typeof pages = [];
  const invalid: typeof pages = [];
  for (const p of pages) {
    const filename = p.path.split("/").pop() ?? "";
    const isSystemFile = filename.startsWith("_") && filename.endsWith(".md");
    if (!isSystemFile && validateArticlePath(p.path, wikiVaultPath)) {
      valid.push(p);
    } else {
      invalid.push(p);
    }
  }
  return { valid, invalid };
}

async function retryInvalidPaths(
  llm: LlmClient,
  model: string,
  originalMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  invalidPages: Array<{ path: string; content: string; annotation?: string }>,
  signal: AbortSignal,
  opts: LlmCallOptions,
): Promise<string> {
  const invalidList = invalidPages.map((p) => p.path).join(", ");
  const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...originalMessages,
    {
      role: "user",
      content: `Пути нарушают правило 4 сегментов (!Wiki/<d>/<e>/<f>.md): ${invalidList}. Верни исправленный JSON-массив только для этих страниц.`,
    },
  ];
  const retryParams = buildChatParams(model, retryMessages, opts, false);
  try {
    let text = "";
    const stream = await llm.chat.completions.create(
      { ...retryParams, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { content } = extractStreamDeltas(chunk);
      if (content) text += content;
    }
    return text;
  } catch {
    return "";
  }
}

export function buildEntityTypesBlock(domain: DomainEntry, wikiVaultPath: string): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types.map((et) => {
    const pathTemplate = et.wiki_subfolder
      ? `${wikiVaultPath}/${et.wiki_subfolder}/<EntityName>.md`
      : `${wikiVaultPath}/<EntityName>.md`;
    return [
      `### Тип: ${et.type}`,
      `Описание: ${et.description}`,
      `Ключевые слова: ${et.extraction_cues.join(", ")}`,
      et.min_mentions_for_page != null ? `Мин. упоминаний для страницы: ${et.min_mentions_for_page}` : "",
      et.wiki_subfolder ? `Подпапка в wiki: ${et.wiki_subfolder}` : "",
      `Путь для сущностей этого типа: ${pathTemplate}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function buildIngestMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
  wikiVaultPath: string,
  existingPages: Map<string, string>,
  schemaContent: string,
  indexContent: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n")
    : "Нет.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain, wikiVaultPath);
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `КОНВЕНЦИИ (_wiki_schema.md):\n${schemaContent}` : "",
    source_path: sourcePath,
  });

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Wiki-папка: ${wikiVaultPath}`,
        ``,
        `Источник: ${sourcePath}`,
        sourceContent,
        ``,
        `Существующие wiki-страницы:\n${existing}`,
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
