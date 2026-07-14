import { isAbsolute, join, relative, dirname } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import { mergeEntityTypes } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, wikiSections } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { EntitiesOutputSchema } from "./zod-schemas";
import type { WikiPagesOutput, EntitiesOutput } from "./zod-schemas";
import { mergeContentFrameInstruction, mergedPageProfile, wikiPagesFrameInstruction, wikiPagesProfile } from "./framed-output";
import { runStructuredWithRetry } from "./structured-output";
import ingestTemplate from "../../prompts/ingest.md";
import ingestMerge from "../../prompts/ingest-merge.md";
import ingestEntitiesTemplate from "../../prompts/ingest-entities.md";
import fixPathsTemplate from "../../prompts/ingest-fix-paths.md";
import wikiSchemaTemplate from "../../templates/_wiki_schema.md";
import { render } from "./template";
import { domainWikiFolder, validateArticlePath, domainIndexPath } from "../wiki-path";
import { ensureDomainConfig } from "../domain-config";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, filterStaleWikiLinks, ensureType, ensureDescription, entityTypeFromPath, ensureResource, stripInvalidWikiArticles, recoverSourceFrontmatter, parseTagsFromFm, normalizeTag } from "../utils/raw-frontmatter";
import { collectDomainTags, renderTagRegistryBlock, thematicCategories, ensureEntityTypeTag, DEFAULT_MAX_TAG_CATEGORIES } from "../utils/tag-registry";
import { upsertIndexAnnotation, parseIndexAnnotations, removeIndexAnnotation, deriveFallbackDescription, reconcileIndex, collectDescriptions } from "../wiki-index";
import { pageId } from "../wiki-graph";
import type { PageSimilarityService, ExtractedEntity } from "../page-similarity";
import { appendWikiLog } from "../wiki-log";
import type { IngestLogEntry } from "../wiki-log";
import { fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
import { GENERIC_WIKI_STEM_REGEX, stemRegex } from "../wiki-stem";
import { i18nFor, resolveLang } from "../i18n";
import { promptVersionOf } from "../prompt-version";

function deriveSectionForPath(wikiFolder: string, fullPath: string): string {
  const prefix = wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  return parts.length >= 2 ? parts[0] : "general";
}

function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^status:[ \t]*(.+)$/m.exec(content);
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
  const schemaContent = render(wikiSchemaTemplate, { section_conventions: wikiSections(resolveLang(opts.outputLanguage)) });
  const indexContent = await tryRead(vaultTools, domainIndexPath(domainRoot));
  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));
  const annotations = cachedAnnotations ?? parseIndexAnnotations(indexContent);

  yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).ingestProgress.synthesizing(domain.id) };
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
  const foundPages: string[] = [];
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
    foundPages.push(...union);

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

  // Delete pages missing resource — invalid regardless of naming.
  const noSources = [...existingPages.entries()]
    .filter(([, content]) => !/resource:/m.test(content))
    .map(([path]) => path);
  for (const p of noSources) {
    try { await vaultTools.remove(p); } catch { /* skip */ }
  }
  if (noSources.length > 0) {
    yield {
      kind: "info_text", icon: "🗑️",
      summary: `Deleted ${noSources.length} wiki page(s) missing resource.`,
      details: noSources.slice(0, 10),
    };
  }
  for (const p of noSources) existingPages.delete(p);

  const sourceStems = await collectSourceStems(domain, vaultTools, vaultRoot);
  const tagRegistry = await collectDomainTags(vaultTools, wikiVaultPath, domain.source_paths ?? []);
  const entityTypeNames = (domain.entity_types ?? []).map((e) => e.type);
  const maxTagCategories = domain.max_tag_categories ?? DEFAULT_MAX_TAG_CATEGORIES;
  const tagRegistryBlock = renderTagRegistryBlock(tagRegistry, entityTypeNames, maxTagCategories);
  const writtenTagCats = new Set<string>();

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
    entitiesResult.value.entities, sourceStems, tagRegistryBlock,
  );

  const inputChars = messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const inputTokEst = Math.round(inputChars / 4);
  const inputTokFmt = inputTokEst >= 1000 ? `~${(inputTokEst / 1000).toFixed(1)}k` : `~${inputTokEst}`;

  yield { kind: "tool_use", name: "Synthesising pages", input: {} };
  const pwtEvents: RunEvent[] = [];
  let parseResult: { value: WikiPagesOutput; outputTokens: number };
  try {
    parseResult = await runStructuredWithRetry({
      llm, model, baseMessages: messages, opts: { ...opts, jsonMode: false },
      profile: wikiPagesProfile(),
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
  pages = pages.map((p) => {
    const fixed = wlFixResult.fixed.get(p.path) ?? p.content;
    return { ...p, content: stripDeadLinks(fixed, knownStems) };
  });

  // --- A2 reorder: the source frontmatter is written BEFORE the wiki pages so
  // that, after ingest, every wiki page's mtime is >= the source's. This keeps
  // incremental re-init honest: an unchanged source is not re-flagged. Backlinks
  // are therefore computed from the PLANNED page/delete sets (results are not yet
  // known). See docs/superpowers/specs/2026-06-24-incremental-reinit-design.md.
  const plannedDeletes = (parseResult.value.deletes ?? []).filter((d) => {
    const hasTraversal = d.path.split("/").some((seg) => seg === ".." || seg === ".");
    return !hasTraversal && validateArticlePath(d.path, wikiVaultPath);
  });
  const plannedDeletePaths = new Set(plannedDeletes.map((d) => d.path));
  const plannedDeleteStems = new Set([...plannedDeletePaths].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
  const plannedPagePaths = pages.map((p) => p.path);

  if (pages.length > 0 || plannedDeletePaths.size > 0) {
    const normalizedSource = recoverSourceFrontmatter(sourceContent);
    const existingArticles = parseWikiArticlesFromFm(normalizedSource).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !plannedDeleteStems.has(stem);
    });
    const writtenLinks = plannedPagePaths.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(normalizedSource, {
      wiki_articles: mergedArticles,
    });
    const { content: repairedSource, warnings: sourceWarnings } =
      validateAndRepairSourceFrontmatter(updatedSource);
    const wikiFileStems = new Set(
      [...existingPaths, ...plannedPagePaths]
        .filter((p) => !plannedDeletePaths.has(p) && !p.endsWith("_index.md"))
        .map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
    );
    const { content: wikiArticlesFiltered, warnings: wikiArticlesWarnings } =
      stripInvalidWikiArticles(repairedSource, wikiFileStems);
    const { content: filteredSource, warnings: relatedWarnings } =
      filterStaleWikiLinks(wikiArticlesFiltered, wikiFileStems, ["related"]);
    const allSourceWarnings = [...sourceWarnings, ...wikiArticlesWarnings, ...relatedWarnings];
    if (allSourceWarnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "Source frontmatter repaired", details: allSourceWarnings };
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

  const written: string[] = [];
  const logEntries: IngestLogEntry[] = [];
  const dedupOn = (opts.dedupOnIngest ?? false) && (opts.dedupThreshold ?? 0) > 0 && !!similarity;
  const dedupThreshold = opts.dedupThreshold ?? 0.85;
  const pidToPath = new Map(nonMetaPaths.map((p) => [pageId(p), p]));
  const createdThisRun = new Set<string>();
  if (dedupOn && similarity.config.mode === "jaccard") similarity.setJaccardCorpus(annotations);
  for (const page of pages) {
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }

    let existingContent: string | null = null;
    try { existingContent = await vaultTools.read(page.path); } catch { /* new page */ }

    if (dedupOn && existingContent === null) {
      const candidateText = `${page.annotation ?? ""}\n\n${page.content}`;
      const exclude = new Set<string>([pageId(page.path), ...createdThisRun]);
      const hit = await similarity.maxSimilarityToExisting(candidateText, exclude);
      if (hit.pid && hit.score >= dedupThreshold) {
        const targetPath = pidToPath.get(hit.pid);
        let existingTarget: string | null = null;
        if (targetPath) { try { existingTarget = await vaultTools.read(targetPath); } catch { /* gone */ } }
        if (targetPath && existingTarget !== null) {
          yield { kind: "info_text", icon: "🔁",
            summary: `Дубль: ${pageId(page.path)} ≈ ${hit.pid} (cosine ${hit.score.toFixed(2)}) → merge`,
            details: [targetPath] };
          const mergeMsgs = [{ role: "user" as const, content:
            render(ingestMerge, { existing: existingTarget, incoming: page.content, frame_instruction: mergeContentFrameInstruction }) }];
          const mergeEvents: RunEvent[] = [];
          try {
            const merged = await runStructuredWithRetry({
              llm, model, baseMessages: mergeMsgs, opts: { ...opts, jsonMode: false },
              profile: mergedPageProfile(),
              maxRetries: opts.structuredRetries ?? 1,
              callSite: "ingest.merge", signal, onEvent: (ev) => mergeEvents.push(ev),
            });
            for (const ev of mergeEvents) yield ev;
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            await vaultTools.write(targetPath, merged.value.content);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
            const relTarget = targetPath.slice(wikiVaultPath.length + 1);
            logEntries.push({ path: relTarget, action: "MERGED" });
            if (merged.value.annotation) {
              try { await upsertIndexAnnotation(vaultTools, wikiVaultPath, hit.pid, merged.value.annotation, targetPath); } catch { /* non-critical */ }
            }
            continue; // skip the normal create
          } catch (e) {
            for (const ev of mergeEvents) yield ev;
            // merge failed — fall through to a normal create rather than lose the new content
            yield { kind: "info_text", icon: "⚠️", summary: `merge не удался, создаю отдельно: ${(e as Error).message}` };
          }
        }
      }
    }
    if (existingContent === null) createdThisRun.add(pageId(page.path));

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
    const { content: entityTagged, added: entityTagAdded, tag: entityTag } =
      ensureEntityTypeTag(repairedPage, page.path, domain);
    if (entityTagAdded) {
      yield {
        kind: "info_text",
        icon: "🏷️",
        summary: `Entity tag added: ${page.path}`,
        details: [`tags: + ${entityTag} (derived from wiki_subfolder)`],
      };
    }
    const okfType = entityTypeFromPath(wikiVaultPath, page.path);
    const typed = ensureType(entityTagged, okfType);
    const described = ensureDescription(typed, page.annotation ?? "");
    const sourceStem = sourceVaultPath.split("/").pop()!.replace(/\.md$/, "");
    const { content: sourcedPage, injected } = ensureResource(described, sourceStem);
    if (injected) {
      yield {
        kind: "info_text", icon: "⚠️",
        summary: `resource injected: ${page.path}`,
        details: [`Added [[${sourceStem}]] — LLM did not emit resource`],
      };
    }
    yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, sourcedPage);
      written.push(page.path);
      for (const t of parseTagsFromFm(sourcedPage)) writtenTagCats.add(t.split("/")[0]);
      yield { kind: "tool_result", ok: true };

      const relPath = page.path.startsWith(wikiVaultPath + "/")
        ? page.path.slice(wikiVaultPath.length + 1)
        : page.path;
      const statusTo = parseWikiStatus(repairedPage);
      if (existingContent === null) {
        logEntries.push({ path: relPath, action: "CREATED", statusTo });
      } else {
        logEntries.push({ path: relPath, action: "UPDATED", statusFrom: parseWikiStatus(existingContent), statusTo });
      }

      try {
        const annotation = (page.annotation && page.annotation.trim())
          ? page.annotation
          : deriveFallbackDescription(sourcedPage, deriveSectionForPath(wikiVaultPath, page.path));
        await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), annotation, page.path);
      } catch { /* non-critical */ }
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  // Soft category-limit check: warn once per run; tags are never dropped for limit reasons.
  const entityCatSet = new Set(entityTypeNames.map((t) => normalizeTag(t)));
  const thematicAfter = new Set(thematicCategories(tagRegistry, entityTypeNames));
  for (const cat of writtenTagCats) {
    if (!entityCatSet.has(cat)) thematicAfter.add(cat);
  }
  if (thematicAfter.size > maxTagCategories) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Tag category limit exceeded: ${thematicAfter.size}/${maxTagCategories} thematic categories`,
      details: [...thematicAfter].sort(),
    };
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
    // Reject path traversal: deletes come from LLM JSON output and must stay
    // inside the wiki folder. startsWith alone is bypassable with ".." segments,
    // so enforce the same strict shape as writes plus an explicit traversal check.
    const hasTraversal = d.path.split("/").some((seg) => seg === ".." || seg === ".");
    if (hasTraversal || !validateArticlePath(d.path, wikiVaultPath)) {
      yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
      yield { kind: "tool_result", ok: false, preview: `invalid path, outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
    try {
      await vaultTools.remove(d.path);
      try { await removeIndexAnnotation(vaultTools, wikiVaultPath, pageId(d.path)); } catch { /* non-critical */ }
      deletedPaths.push(d.path);
      const relPath = d.path.slice(wikiVaultPath.length + 1);
      logEntries.push({ path: relPath, action: "DELETED" });
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  // Full bidirectional index reconciliation: add any page missing from the index
  // (legacy un-annotated pages get a deterministic fallback) and drop orphan
  // entries whose file no longer exists. Non-critical.
  try {
    const finalPaths = (await vaultTools.listFiles(wikiVaultPath))
      .filter((f) => f.endsWith(".md") && !f.endsWith("_index.md") && !f.endsWith("_log.md"));
    const finalPages = await vaultTools.readAll(finalPaths);
    const currentIndex = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
    const recon = reconcileIndex(
      currentIndex, wikiVaultPath,
      [...finalPages].map(([path, content]) => ({ path, content })),
    );
    for (const a of recon.adds) {
      await upsertIndexAnnotation(vaultTools, wikiVaultPath, a.pid, a.annotation, a.fullPath);
    }
    for (const pid of recon.removes) {
      await removeIndexAnnotation(vaultTools, wikiVaultPath, pid);
    }
  } catch { /* non-critical */ }

  const createdCount = logEntries.filter(e => e.action === "CREATED").length;
  const updatedCount = logEntries.filter(e => e.action === "UPDATED").length;
  const mergedCount  = logEntries.filter(e => e.action === "DELETED").length;
  const dedupMergedCount = logEntries.filter(e => e.action === "MERGED").length;
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, mergedCount, dedupMergedCount, pages.length);
  yield { kind: "assistant_text", delta: resultText };

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
  }

  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }

  if (similarity && written.length > 0) {
    try {
      // Read back the final on-disk content (frontmatter description included) rather
      // than reusing `pages` (pre-processing LLM output, description not yet injected).
      const writtenPages = await vaultTools.readAll(written);
      const descriptions = collectDescriptions([...writtenPages].map(([path, content]) => ({ path, content })));
      const pageBodies = new Map<string, string>();
      for (const [path, content] of writtenPages) pageBodies.set(pageId(path), content);
      await similarity.refreshCache(domainRoot, vaultTools, descriptions, pageBodies);
    } catch { /* non-critical */ }
  }

  if (wlFixResult.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
  }

  const createdPages = written.filter((p) => createdThisRun.has(pageId(p)));
  const updatedPages = written.filter((p) => !createdThisRun.has(pageId(p)));
  yield {
    kind: "eval_meta",
    fields: {
      source_paths: [sourceVaultPath],
      created_pages: createdPages,
      updated_pages: updatedPages,
      found_pages: foundPages,
      promptVersion: promptVersionOf(ingestTemplate),
    },
  };

  yield { kind: "result", durationMs: Date.now() - start, text: resultText, outputTokens: outputTokens || undefined };
}

function buildIngestSummary(
  domainId: string,
  sourcePath: string,
  createdCount: number,
  updatedCount: number,
  mergedCount: number,
  dedupMergedCount: number,
  total: number,
): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  const totalActed = createdCount + updatedCount + mergedCount + dedupMergedCount;
  if (totalActed === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const parts: string[] = [];
  if (createdCount > 0) parts.push(`создано ${createdCount}`);
  if (updatedCount > 0) parts.push(`обновлено ${updatedCount}`);
  if (mergedCount  > 0) parts.push(`объединено ${mergedCount}`);
  if (dedupMergedCount > 0) parts.push(`дублей объединено ${dedupMergedCount}`);
  const countStr = parts.length === 1 ? `${parts[0]} стр.` : parts.join(", ");
  const skipped = total - (createdCount + updatedCount + dedupMergedCount);
  const errStr = skipped > 0 ? `, ошибок ${skipped}` : "";
  return `Источник «${src}» → домен «${domainId}»: ${countStr}${errStr}`;
}

/** Match a file to a domain by source_paths prefix; null when nothing matches (no fallback). */
export function detectDomainStrict(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = isAbsolute(sp) ? sp : join(vaultRoot, sp);
      const prefix = abs.endsWith("/") ? abs : abs + "/";
      return absFilePath === abs || absFilePath.startsWith(prefix);
    });
    if (matched) return d;
  }
  return null;
}

export function detectDomain(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  return detectDomainStrict(absFilePath, domains, vaultRoot) ?? domains[0] ?? null;
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
      content: render(fixPathsTemplate, { paths: invalidList }),
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
      `### Type: ${et.type}`,
      `Description: ${et.description}`,
      `Keywords: ${et.extraction_cues.join(", ")}`,
      et.min_mentions_for_page != null ? `Min. mentions for a page: ${et.min_mentions_for_page}` : "",
      et.wiki_subfolder ? `Wiki subfolder: ${et.wiki_subfolder}` : "",
      `Path for entities of this type: ${pathTemplate}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function buildExtractMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const entityTypesBlock = buildEntityTypesBlock(domain, "");
  const langNotes = domain.language_notes ? `Language rules: ${domain.language_notes}` : "";
  const systemContent = render(ingestEntitiesTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(none defined)",
    lang_notes: langNotes,
  });
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Source: ${sourcePath}\n\n${sourceContent}` },
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
  tagRegistryBlock: string = "",
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n")
    : "None.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain, wikiVaultPath);
  const langNotes = domain.language_notes ? `Language rules: ${domain.language_notes}` : "";

  const forbiddenStemsBlock = sourceStems.size > 0
    ? `FORBIDDEN NAMES (sources in this domain):\n${[...sourceStems].sort().map((s) => `- ${s}`).join("\n")}`
    : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    domain_id: domain.id,
    entity_types_block: entityTypesBlock || "(none defined)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `CONVENTIONS (_wiki_schema.md):\n${schemaContent}` : "",
    source_path: sourcePath,
    source_stem: sourcePath.split("/").pop()!.replace(/\.md$/, ""),
    forbidden_stems_block: forbiddenStemsBlock,
    frame_instruction: wikiPagesFrameInstruction,
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
    ? `\nExtracted entities:\n${entityLines.join("\n")}\n`
    : "";

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain: ${domain.id} (${domain.name})`,
        `Wiki folder: ${wikiVaultPath}`,
        ``,
        `Source: ${sourcePath}`,
        sourceContent,
        ``,
        `Existing wiki pages:\n${existing}`,
        tagRegistryBlock ? `\n${tagRegistryBlock}` : "",
        entitiesBlock,
        indexContent ? `\nWiki index (_index.md):\n${indexContent}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
