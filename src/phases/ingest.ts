import { isAbsolute, join, relative, dirname } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import { mergeEntityTypes } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { WikiPagesOutputSchema, EntitiesOutputSchema } from "./zod-schemas";
import type { WikiPagesOutput, EntitiesOutput } from "./zod-schemas";
import ingestTemplate from "../../prompts/ingest.md";
import ingestEntitiesTemplate from "../../prompts/ingest-entities.md";
import { render } from "./template";
import { GLOBAL_WIKI_SCHEMA_PATH, domainWikiFolder, validateArticlePath, domainIndexPath } from "../wiki-path";
import { ensureDomainConfig } from "../domain-config";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField, validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, filterStaleWikiLinks } from "../utils/raw-frontmatter";
import { upsertIndexAnnotation, parseIndexAnnotations, removeIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
import type { PageSimilarityService, ExtractedEntity } from "../page-similarity";
import { appendWikiLog } from "../wiki-log";
import type { IngestLogEntry } from "../wiki-log";
import { fixWikiLinks } from "../wiki-link-validator";
import { GENERIC_WIKI_STEM_REGEX, stemRegex } from "../wiki-stem";

function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^wiki_status:[ \t]*(.+)$/m.exec(content);
  return m ? m[1].trim() : "unknown";
}

export async function collectSourceStems(
  domain: DomainEntry,
  vaultTools: VaultTools,
  vaultRoot: string,
): Promise<Set<string>> {
  const stems = new Set<string>();
  for (const sp of domain.source_paths ?? []) {
    const vaultPath = isAbsolute(sp)
      ? vaultTools.toVaultPath(sp) ?? ""
      : (sp.endsWith("/") ? sp.slice(0, -1) : sp);
    if (!vaultPath) continue;
    const files = await vaultTools.listFiles(vaultPath).catch(() => [] as string[]);
    for (const f of files) {
      if (f.endsWith(".md")) {
        stems.add(f.split("/").pop()!.replace(/\.md$/, ""));
      }
    }
  }
  return stems;
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
  wikiLinkValidationRetries: number = 3,
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
  void graphDepth;
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH),
    tryRead(vaultTools, domainIndexPath(domainRoot)),
  ]);
  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));
  const annotations = cachedAnnotations ?? parseIndexAnnotations(indexContent);

  yield { kind: "assistant_text", delta: `Synthesizing wiki pages for domain "${domain.id}"...\n` };
  const start = Date.now();

  // === LLM #1: extract entities =========================================
  const messages_extract = buildExtractMessages(sourceVaultPath, sourceContent, domain);
  yield { kind: "tool_use", name: "Extracting entities", input: {} };
  const extractEvents: RunEvent[] = [];
  let entitiesResult: { value: EntitiesOutput; outputTokens: number };
  try {
    entitiesResult = await parseWithRetry({
      llm, model, baseMessages: messages_extract, opts,
      schema: EntitiesOutputSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.entities",
      signal,
      onEvent: (ev) => extractEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${entitiesResult.value.entities.length} entities` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of extractEvents) yield ev;
    yield { kind: "error", message: `ingest: entity extraction failed — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of extractEvents) yield ev;
  if (signal.aborted) return;

  // === Per-entity top-K retrieval =======================================
  let existingPages: Map<string, string>;
  const retrievalDetails: string[] = [];
  if (similarity) {
    await similarity.loadCache(domainRoot, vaultTools);
    const { results: entityMap, allFailed } = await similarity.selectByEntities(
      entitiesResult.value.entities, annotations, nonMetaPaths,
    );

    if (allFailed && entitiesResult.value.entities.length > 0 && nonMetaPaths.length > 0) {
      yield { kind: "error", message: "ingest: per-entity retrieval failed for all entities" };
      yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
      return;
    }

    const union = new Set<string>();
    for (let i = 0; i < entitiesResult.value.entities.length; i++) {
      const e = entitiesResult.value.entities[i];
      const key = `${e.name}::${e.type ?? ""}`;
      const paths = entityMap.get(key) ?? [];
      retrievalDetails.push(
        `${i + 1}/${entitiesResult.value.entities.length} ${e.name}` +
        `${e.type ? ` (${e.type})` : ""} → ${paths.length ? paths.join(", ") : "—"}`,
      );
      for (const p of paths) union.add(p);
    }

    yield {
      kind: "info_text",
      icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
      summary: `${union.size}/${nonMetaPaths.length} pages retrieved (${similarity.config.mode}, ${entitiesResult.value.entities.length} entities)`,
      details: retrievalDetails,
    };

    existingPages = await vaultTools.readAll([...union]);
  } else {
    existingPages = await vaultTools.readAll(nonMetaPaths);
  }

  const sourceStems = await collectSourceStems(domain, vaultTools, vaultRoot);

  // Pre-migration cleanup: delete legacy unprefixed wiki pages.
  if ((domain.pageNameVersion ?? 0) < 1) {
    const unprefixed = nonMetaPaths.filter((p) => {
      if (!p.endsWith(".md")) return false;
      const name = p.split("/").pop()!;
      if (name.startsWith("_")) return false;
      return !GENERIC_WIKI_STEM_REGEX.test(name.replace(/\.md$/, ""));
    });
    for (const p of unprefixed) {
      try { await vaultTools.remove(p); } catch { /* skip */ }
    }
    if (unprefixed.length > 0) {
      yield {
        kind: "info_text", icon: "🗑️",
        summary: `Deleted ${unprefixed.length} legacy page(s) without wiki_<domain>_<entity> prefix.`,
        details: unprefixed.slice(0, 10),
      };
    }
  }

  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
    entitiesResult.value.entities, sourceStems,
  );

  const inputChars = messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const inputTokEst = Math.round(inputChars / 4);
  const inputTokFmt = inputTokEst >= 1000 ? `~${(inputTokEst / 1000).toFixed(1)}k` : `~${inputTokEst}`;

  yield { kind: "tool_use", name: "Synthesising pages", input: {} };
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
    yield { kind: "tool_result", ok: true, preview: `${existingPages.size} pages · ${inputTokFmt} tokens sent` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
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

  // Stem mask guard: enforce wiki_<domain>_<entity> + reject source collisions.
  const stemMaskRe = stemRegex(domain.id);
  const stemValid: typeof pages = [];
  for (const p of pages) {
    const stem = p.path.split("/").pop()!.replace(/\.md$/, "");
    if (!stemMaskRe.test(stem)) {
      yield { kind: "tool_use", name: "Write", input: { path: p.path } };
      yield { kind: "tool_result", ok: false, preview: `stem violates mask wiki_${domain.id}_<entity>: ${stem}` };
      continue;
    }
    if (sourceStems.has(stem)) {
      yield { kind: "tool_use", name: "Write", input: { path: p.path } };
      yield { kind: "tool_result", ok: false, preview: `stem collides with source filename: ${stem}` };
      continue;
    }
    stemValid.push(p);
  }
  pages = stemValid;

  // Programmatic WikiLink fix (always run; maxPasses=0 only warns)
  const pagesMap = new Map(pages.map((p) => [p.path, p.content]));
  const allVaultPaths = await vaultTools.listFiles("").catch(() => [] as string[]);
  const knownStems = new Set([
    ...allVaultPaths.filter(p => p.endsWith(".md")).map(p => p.split("/").pop()!.replace(/\.md$/, "")),
    ...[...pagesMap.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
  ]);
  const wlFixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
  pages = pages.map((p) => ({ ...p, content: wlFixResult.fixed.get(p.path) ?? p.content }));

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

    const { content: repairedPage, warnings: pageWarnings } =
      validateAndRepairWikiPageFrontmatter(page.content);
    if (pageWarnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: `Frontmatter repaired: ${page.path}`,
        details: pageWarnings,
      };
    }
    yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, repairedPage);
      written.push(page.path);
      yield { kind: "tool_result", ok: true };

      const relPath = page.path.startsWith(wikiVaultPath + "/")
        ? page.path.slice(wikiVaultPath.length + 1)
        : page.path;
      const statusTo = parseWikiStatus(repairedPage);
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

  // === Delete loop (merge cleanup) ======================================
  const deletes = parseResult.value.deletes ?? [];
  const threshold = opts.mergeDeleteWarnThreshold ?? 5;
  if (deletes.length > threshold) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Large merge: ${deletes.length} deletions`,
      details: deletes.map((d) => d.path),
    };
  }

  const deletedPaths: string[] = [];
  for (const d of deletes) {
    if (!d.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
      yield { kind: "tool_result", ok: false, preview: `outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
    try {
      await vaultTools.remove(d.path);
      try { await removeIndexAnnotation(vaultTools, wikiVaultPath, pageId(d.path)); } catch { /* non-critical */ }
      deletedPaths.push(d.path);
      const relPath = d.path.slice(wikiVaultPath.length + 1);
      logEntries.push({ path: relPath, action: "УДАЛЕНА" });
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  const createdCount = logEntries.filter(e => e.action === "СОЗДАНА").length;
  const updatedCount = logEntries.filter(e => e.action === "ОБНОВЛЕНА").length;
  const mergedCount  = logEntries.filter(e => e.action === "УДАЛЕНА").length;
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, mergedCount, pages.length);
  yield { kind: "assistant_text", delta: resultText };

  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }

  const deletedStems = new Set(deletedPaths.map((p) => p.split("/").pop()!.replace(/\.md$/, "")));

  if (written.length > 0 || deletedPaths.length > 0) {
    if (logEntries.length > 0) {
      try {
        await appendWikiLog(vaultTools, domainRoot, domain.id, {
          op: "ingest",
          sourcePath: sourceVaultPath,
          entries: logEntries,
          outputTokens,
        });
      } catch { /* non-critical */ }
    }

    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(sourceContent).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !deletedStems.has(stem);
    });
    const writtenLinks = written.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    const { content: repairedSource, warnings: sourceWarnings } =
      validateAndRepairSourceFrontmatter(updatedSource);
    const wikiFileStems = new Set(
      [...existingPaths, ...written]
        .filter(p => !deletedPaths.includes(p) && !p.endsWith("_index.md"))
        .map(p => p.split("/").pop()!.replace(/\.md$/, ""))
    );
    // Preserve non-wiki-domain links (user-curated cross-refs) by adding their
    // stems to the set — only stems matching the wiki naming pattern are checked.
    const existingArticleStems = parseWikiArticlesFromFm(repairedSource)
      .map(link => link.slice(2, -2))
      .filter(stem => !GENERIC_WIKI_STEM_REGEX.test(stem));
    const existingStems = new Set([...wikiFileStems, ...existingArticleStems]);
    const { content: filteredSource, warnings: staleWarnings } =
      filterStaleWikiLinks(repairedSource, existingStems, ["wiki_articles", "related"]);
    const allSourceWarnings = [...sourceWarnings, ...staleWarnings];
    if (allSourceWarnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: "Source frontmatter repaired",
        details: allSourceWarnings,
      };
    }
    yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, filteredSource);
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

  if (wlFixResult.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
  }

  yield { kind: "result", durationMs: Date.now() - start, text: resultText, outputTokens: outputTokens || undefined };
}

function buildIngestSummary(
  domainId: string,
  sourcePath: string,
  createdCount: number,
  updatedCount: number,
  mergedCount: number,
  total: number,
): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  const totalActed = createdCount + updatedCount + mergedCount;
  if (totalActed === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const parts: string[] = [];
  if (createdCount > 0) parts.push(`создано ${createdCount}`);
  if (updatedCount > 0) parts.push(`обновлено ${updatedCount}`);
  if (mergedCount  > 0) parts.push(`объединено ${mergedCount}`);
  const countStr = parts.length === 1 ? `${parts[0]} стр.` : parts.join(", ");
  const skipped = total - (createdCount + updatedCount);
  const errStr = skipped > 0 ? `, ошибок ${skipped}` : "";
  return `Источник «${src}» → домен «${domainId}»: ${countStr}${errStr}`;
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

function buildExtractMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const entityTypesBlock = buildEntityTypesBlock(domain, "");
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";
  const systemContent = render(ingestEntitiesTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
  });
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Источник: ${sourcePath}\n\n${sourceContent}` },
  ];
}

function buildIngestMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
  wikiVaultPath: string,
  existingPages: Map<string, string>,
  schemaContent: string,
  indexContent: string,
  entities: ExtractedEntity[],
  sourceStems: Set<string> = new Set(),
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n")
    : "Нет.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain, wikiVaultPath);
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";

  const forbiddenStemsBlock = sourceStems.size > 0
    ? `ЗАПРЕЩЁННЫЕ ИМЕНА (источники в этом домене):\n${[...sourceStems].sort().map((s) => `- ${s}`).join("\n")}`
    : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    domain_id: domain.id,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `КОНВЕНЦИИ (_wiki_schema.md):\n${schemaContent}` : "",
    source_path: sourcePath,
    source_stem: sourcePath.split("/").pop()!.replace(/\.md$/, ""),
    forbidden_stems_block: forbiddenStemsBlock,
  });

  const existingPathSet = new Set(existingPages.keys());
  const entityLines = entities.map((e) => {
    const matching = [...existingPathSet].filter((p) => {
      const stem = p.split("/").pop()!.replace(/\.md$/, "");
      return stem.toLowerCase() === e.name.toLowerCase();
    });
    const head = `- ${e.name}${e.type ? ` (${e.type})` : ""}`;
    const snippet = e.context_snippet ? ` — ${e.context_snippet}` : "";
    const tail = ` [existing: ${matching.length > 0 ? matching.join(", ") : "—"}]`;
    return head + snippet + tail;
  });
  const entitiesBlock = entityLines.length > 0
    ? `\nИзвлечённые сущности:\n${entityLines.join("\n")}\n`
    : "";

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
        entitiesBlock,
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
