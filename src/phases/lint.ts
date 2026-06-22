import { join } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { EntityTypesDeltaSchema, LintOutputSchema } from "./zod-schemas";
import type { LintOutput } from "./zod-schemas";
import lintTemplate from "../../prompts/lint.md";
import lintActualizeTemplate from "../../prompts/lint-actualize.md";
import wikiSchemaTemplate from "../../templates/_wiki_schema.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { domainWikiFolder, domainIndexPath, WIKI_ROOT } from "../wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, filterStaleWikiLinks, validateAndRepairWikiPageFrontmatter, stripInvalidWikiArticles } from "../utils/raw-frontmatter";
import { checkGraphStructure, pageId, bfsExpand } from "../wiki-graph";
import { checkWikiLinks, fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
import { graphCache } from "../wiki-graph-cache";
import { upsertIndexAnnotation, parseIndexAnnotations, reconcileIndex, removeIndexAnnotation } from "../wiki-index";
import { appendWikiLog } from "../wiki-log";
import { ensureDomainConfig } from "../domain-config";
import type { PageSimilarityService } from "../page-similarity";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";
import { i18nFor, resolveLang } from "../i18n";

const META_FILES = ["_index.md", "_log.md"];

export async function cleanupInvalidPages(
  vaultTools: VaultTools,
  wikiVaultPath: string,
  _domainId: string,
): Promise<{ deleted: number }> {
  const files = await vaultTools.listFiles(wikiVaultPath);
  const candidates = files.filter((f) => {
    if (!f.endsWith(".md")) return false;
    const name = f.split("/").pop()!;
    return !name.startsWith("_");
  });
  let deleted = 0;
  for (const f of candidates) {
    const stem = f.split("/").pop()!.replace(/\.md$/, "");
    if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
      try { await vaultTools.remove(f); deleted++; } catch { /* skip */ }
      continue;
    }
    try {
      const content = await vaultTools.read(f);
      if (!/wiki_sources:/m.test(content)) {
        await vaultTools.remove(f);
        deleted++;
      }
    } catch { /* skip unreadable */ }
  }
  return { deleted };
}



export async function buildTitleMap(
  paths: string[],
  vaultTools: VaultTools,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of paths) {
    try {
      const content = await vaultTools.read(path);
      const stem = path.split("/").pop()!.replace(/\.md$/, "");

      // Prefer title: frontmatter field
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
        if (titleMatch) {
          result.set(titleMatch[1].trim().toLowerCase(), stem);
          continue;
        }
      }

      // Fall back to first H1
      const h1Match = content.match(/^# (.+)$/m);
      if (h1Match) {
        result.set(h1Match[1].trim().toLowerCase(), stem);
      }
      // No title found: skip
    } catch {
      // Unreadable file: skip silently
    }
  }
  return result;
}

export function validateWikiSources(
  content: string,
  originalContent: string,
  knownStems: Set<string>,
  titleMap: Map<string, string>,
  wikiStems: Set<string> = new Set(),
): string {
  // Normalize unquoted [[...]] items in wiki_sources — bare [[x]] is parsed by YAML as a flow sequence.
  content = content.replace(
    /(wiki_sources:\s*\n(?:[ \t]+-[ \t]+[^\n]+\n?)+)/,
    (block) => block.replace(/^([ \t]+-[ \t]+)(\[\[[^\]]+\]\])([ \t]*)$/gm, '$1"$2"$3'),
  );

  const isValid = (entry: string): boolean => {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (!m) return true; // non-wikilink format: keep as-is
    const text = m[1];
    // Wiki pages belong in wiki_outgoing_links, not wiki_sources.
    if (wikiStems.has(text)) return false;
    // Path-based references (e.g. [[Sources/raw.md]]) are always valid —
    // knownStems only tracks basenames, not full paths.
    if (text.includes("/")) return true;
    return knownStems.has(text) || titleMap.has(text.toLowerCase());
  };

  // Restore valid entries the LLM may have silently dropped or collapsed to [].
  if (originalContent) {
    const originalEntries = parseWikiSourcesFromFm(originalContent);
    const llmEntries = new Set(parseWikiSourcesFromFm(content));
    const validOriginal = originalEntries.filter(isValid);
    const missing = validOriginal.filter((e) => !llmEntries.has(e));
    if (missing.length > 0) {
      // Normalise: replace inline `wiki_sources: []` or bare `wiki_sources:` with a block list.
      const emptyKeyRe = /wiki_sources:\s*(?:\[\]\s*\n|\n(?!\s*-))/;
      if (emptyKeyRe.test(content)) {
        const block = "wiki_sources:\n" + missing.map((e) => `  - "${e}"`).join("\n") + "\n";
        content = content.replace(emptyKeyRe, block);
      } else {
        // Block-list exists — append missing items after the last list entry.
        const listBlockRe = /(wiki_sources:\s*\n(?:[ \t]+-[ \t]+[^\n]+\n?)+)/;
        content = content.replace(listBlockRe, (match) =>
          match.trimEnd() + "\n" + missing.map((e) => `  - "${e}"`).join("\n") + "\n",
        );
      }
    }
  }

  // Remove stale entries (entries present in content that are [[...]] format but not in vault).
  const entries = parseWikiSourcesFromFm(content);
  if (entries.length === 0) return content;

  const toRemove = entries.filter((e) => !isValid(e));
  if (toRemove.length === 0) return content;

  // YAML parses [[...]] as a flow sequence (nested array), so filterStaleWikiLinks
  // cannot handle wiki_sources entries. Remove them via raw string substitution.
  let result = content;
  for (const entry of toRemove) {
    // Remove the list item line containing this wikilink — handles both quoted and unquoted forms.
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`[ \\t]+-[ \\t]+"?${escaped}"?\\n?`, ""), "");
  }
  return result;
}

export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  wikiLinkValidationRetries: number = 3,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  useLlm: boolean = true,
  entityTypeFilter: string[] = [],
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

    const { deleted: deletedInvalid } = await cleanupInvalidPages(vaultTools, wikiVaultPath, domain.id);
    if (deletedInvalid > 0) {
      yield { kind: "step", icon: "🗑️", text: `Deleted ${deletedInvalid} invalid wiki article(s).` };
    }

    yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
    await ensureDomainConfig(vaultTools, wikiVaultPath);
    const schemaContent = render(wikiSchemaTemplate, { section_conventions: wikiSections(resolveLang(opts.outputLanguage)) });
    const allFiles = await vaultTools.listFiles(wikiVaultPath);
    const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
    yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

    const pages = await vaultTools.readAll(files);

    // Build initial graph + structural checks on all pages
    let { graph } = graphCache.get(domain.id, pages);
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph);
    const wikiLinkIssues = checkWikiLinks(pages);
    const allStructuralIssues = [structuralIssues, graphIssues, wikiLinkIssues].filter(Boolean).join("\n");

    // Vault-wide paths for fixWikiLinks + backlink sync (computed once)
    const allVaultPaths = await vaultTools.listFiles("").catch(() => [] as string[]);
    const allMdPaths = allVaultPaths.filter(p => p.endsWith(".md"));
    const knownStems = new Set([
      ...allMdPaths.map(p => p.split("/").pop()!.replace(/\.md$/, "")),
      ...[...pages.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
    ]);

    // Build title map from non-wiki vault files (runs once per domain)
    const nonWikiPaths = allMdPaths.filter(p => !p.startsWith(WIKI_ROOT + "/"));
    const titleMap = await buildTitleMap(nonWikiPaths, vaultTools);

    // Extend knownStems with stems from titleMap
    for (const stem of titleMap.values()) {
      knownStems.add(stem);
    }

    const stemToPath = new Map<string, string>(
      allMdPaths.map(p => [p.split("/").pop()!.replace(/\.md$/, ""), p])
    );

    // Index annotations + article iteration order
    const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
    const annotations = parseIndexAnnotations(indexRaw);
    const pidToPath = new Map(files.map(p => [pageId(p), p]));
    const articlePaths = [...new Set([
      ...[...annotations.keys()].map(pid => pidToPath.get(pid)!).filter(Boolean),
      ...files,
    ])];
    const filteredArticlePaths = entityTypeFilter.length > 0
      ? articlePaths.filter(p =>
          entityTypeFilter.some(et => {
            const subfolder = domain.entity_types?.find(e => e.type === et)?.wiki_subfolder;
            return subfolder && p.includes(`/${subfolder}/`);
          })
        )
      : articlePaths;

    // Load embedding cache before loop
    if (similarity && similarity.config.mode !== "jaccard") {
      yield { kind: "info_text", icon: "📥", summary: "загрузка кэша векторов..." };
      await similarity.loadCache(wikiVaultPath, vaultTools);
    }

    if (similarity && similarity.config.mode !== "jaccard" && (opts.lintNearDuplicate ?? false)) {
      const LINT_NEARDUP_MAX_PAGES = 500;
      const { pairs, skippedPageCount } = similarity.pairwiseNearDuplicates(
        opts.nearDupThreshold ?? 0.80, LINT_NEARDUP_MAX_PAGES,
      );
      if (skippedPageCount > 0) {
        yield { kind: "info_text", icon: "⚠️",
          summary: `near-duplicate проверка пропущена: ${skippedPageCount} страниц > ${LINT_NEARDUP_MAX_PAGES}` };
      } else if (pairs.length > 0) {
        yield { kind: "info_text", icon: "🔁",
          summary: `near-duplicate кандидаты: ${pairs.length} пар`,
          details: pairs.map((p) => `${p.a} ≈ ${p.b} (${p.score.toFixed(2)})`) };
      }
    }

    const entityTypesBlock = buildEntityTypesBlock(domain);
    const systemContent = render(lintTemplate, {
      domain_name: domain.name,
      entity_types_block: entityTypesBlock ? `\nDOMAIN ENTITY TYPES:\n${entityTypesBlock}` : "",
      schema_block: schemaContent ? `\nConventions (_wiki_schema.md):\n${schemaContent}` : "",
    });

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).lintProgress.evaluating(domain.id) };

    const deletedRefs: { deletedName: string; redirectName: string | null }[] = [];
    const writtenPaths: string[] = [];
    const skippedArticles: string[] = [];

    if (useLlm) {
      const loopPaths = filteredArticlePaths;
      const total = loopPaths.length;

    // ── Per-article loop ──────────────────────────────────────────────────────
    for (let i = 0; i < total; i++) {
      if (signal.aborted) return;

      const targetPath = loopPaths[i];
      const articleName = targetPath.split("/").pop()!.replace(/\.md$/, "");
      const articleContent = pages.get(targetPath) ?? "";

      // Context selection: top-K similar + BFS expansion
      const otherPaths = files.filter(p => p !== targetPath && pages.has(p));
      const topKPaths = similarity
        ? await similarity.selectRelevant(articleContent, annotations, otherPaths)
        : [];
      const seeds = [pageId(targetPath), ...topKPaths.map(p => pageId(p))];
      const expanded = bfsExpand(seeds, graph, 1);
      const contextPaths = [...expanded]
        .map(pid => pidToPath.get(pid))
        .filter((p): p is string => !!p && p !== targetPath && pages.has(p));

      // Per-article structural issues
      const articleIssues = allStructuralIssues
        .split("\n")
        .filter(l => l.includes(articleName) || l.includes(targetPath))
        .join("\n") || "None.";

      // Build user message
      const contextBlock = contextPaths
        .map(p => `--- ${p} ---\n${pages.get(p) ?? ""}`)
        .join("\n\n");
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: [
            `Domain: ${domain.id} (${domain.name})`,
            `Article under analysis: ${targetPath}`,
            `Automatic issues:\n${articleIssues}`,
            "",
            `--- ${targetPath} ---`,
            articleContent,
            "",
            contextBlock ? `--- Context (related articles) ---\n${contextBlock}` : "",
          ].filter(l => l !== undefined).join("\n"),
        },
      ];

      yield { kind: "info_text", icon: "🔍", summary: `Checking ${i + 1}/${total}: ${articleName}` };
      yield { kind: "tool_use", name: "Analysing wiki", input: { article: articleName, context: contextPaths.length } };

      const pwtEvents: RunEvent[] = [];
      let lintResult: { value: LintOutput; outputTokens: number };
      try {
        lintResult = await parseWithRetry({
          llm, model,
          baseMessages: messages,
          opts,
          schema: LintOutputSchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "lint.fix",
          signal,
          onEvent: (ev) => pwtEvents.push(ev),
        });
        const delCount = (lintResult.value.deletes ?? []).length;
        yield { kind: "tool_result", ok: true, preview: `${lintResult.value.fixes.length} fixes${delCount ? `, ${delCount} deleted` : ""}` };
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        const errMsg = (e as Error).message ?? "";
        const isTokenLimit = errMsg.toLowerCase().includes("context_length") || errMsg.toLowerCase().includes("too large");
        const preview = isTokenLimit ? `Article too large — skipped: ${targetPath}` : errMsg;
        yield { kind: "tool_result", ok: false, preview };
        for (const ev of pwtEvents) yield ev;
        skippedArticles.push(articleName);
        continue;
      }
      for (const ev of pwtEvents) yield ev;
      if (signal.aborted) return;

      outputTokens += lintResult.outputTokens;
      const { fixes, deletes = [] } = lintResult.value;

      yield { kind: "assistant_text", delta: lintResult.value.report };
      reportParts.push(`### ${articleName}\n${lintResult.value.report}`);

      // Apply fixes (fixWikiLinks per-step)
      if (fixes.length > 0) {
        const fixesMapThisStep = new Map(fixes.map(p => [p.path, p.content]));
        const wlFixResult = fixWikiLinks(fixesMapThisStep, wikiLinkValidationRetries, knownStems);
        if (wlFixResult.warnings.length > 0) {
          yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
        }
        for (const fix of fixes) {
          yield { kind: "assistant_text", delta: `  • ${fix.path.split("/").pop()}...\n` };
          if (!fix.path.startsWith(wikiVaultPath + "/")) {
            yield { kind: "tool_use", name: "Write", input: { path: fix.path } };
            yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
            continue;
          }
          yield { kind: "tool_use", name: "Update", input: { path: fix.path } };
          try {
            const rawFixed = wlFixResult.fixed.get(fix.path) ?? fix.content;
            const originalContent = pages.get(fix.path) ?? "";
            const wikiStems = new Set([...pages.keys()].map(p => p.split("/").pop()!.replace(/\.md$/, "")));
            const fixedContent = validateWikiSources(rawFixed, originalContent, knownStems, titleMap, wikiStems);
            await vaultTools.write(fix.path, fixedContent);
            writtenPaths.push(fix.path);
            pages.set(fix.path, fixedContent);
            if (fix.annotation) {
              annotations.set(pageId(fix.path), fix.annotation);
              try {
                await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(fix.path), fix.annotation, fix.path);
              } catch { /* non-critical */ }
            }
            yield { kind: "tool_result", ok: true };
          } catch (e) {
            yield { kind: "tool_result", ok: false, preview: (e as Error).message };
          }
        }
        reportParts.push(`#### Исправлено: ${fixes.length} страниц`);
      }

      // Process deletes
      for (const { path: delPath, redirect_to } of deletes) {
        const deletedName = pageId(delPath);
        const redirectName = redirect_to ? pageId(redirect_to) : null;

        yield { kind: "tool_use", name: "Delete", input: { path: delPath } };
        try {
          if (typeof vaultTools.remove === "function") {
            await vaultTools.remove(delPath);
          } else {
            yield { kind: "info_text", icon: "⚠️", summary: `vaultTools.remove not supported — physical delete skipped: ${delPath}` };
          }
          pages.delete(delPath);
          annotations.delete(deletedName);

          // Rewrite [[deletedName]] links in all wiki pages
          for (const [wikiPath, wikiContent] of pages) {
            if (wikiContent.includes(`[[${deletedName}]]`)) {
              const newContent = redirectName
                ? wikiContent.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
                : wikiContent.replaceAll(`[[${deletedName}]]`, "");
              await vaultTools.write(wikiPath, newContent);
              pages.set(wikiPath, newContent);
            }
          }

          deletedRefs.push({ deletedName, redirectName });
          yield { kind: "tool_result", ok: true, preview: redirectName ? `merged → [[${redirectName}]]` : "deleted" };
        } catch (e) {
          yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        }
      }

      // Rebuild graph + refresh vectors after state changes
      ({ graph } = graphCache.get(domain.id, pages));
      if (similarity) {
        const pageBodies = new Map<string, string>();
        for (const [path, content] of pages) pageBodies.set(pageId(path), content);
        const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, annotations, pageBodies);
        if (similarity.config.mode === "embedding" && updated > 0) {
          yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
        }
      }
    }
    // ── End per-article loop ──────────────────────────────────────────────────

    // Post-loop: delete wiki pages that ended up with no valid wiki_sources.
    // Pushes their stems into deletedRefs so the backlink rewrite below removes
    // their wiki_articles entries from source files.
    for (const wikiPath of writtenPaths) {
      const wikiContent = pages.get(wikiPath);
      if (!wikiContent) continue;
      if (parseWikiSourcesFromFm(wikiContent).length === 0) {
        const stem = pageId(wikiPath);
        try {
          if (typeof vaultTools.remove === "function") {
            await vaultTools.remove(wikiPath);
          }
        } catch { /* non-critical — page already gone */ }
        pages.delete(wikiPath);
        deletedRefs.push({ deletedName: stem, redirectName: null });
        yield {
          kind: "info_text" as const,
          icon: "⚠️",
          summary: `Deleted empty-sources wiki page: ${stem}`,
        };
      }
    }

    // Skipped articles summary
    if (skippedArticles.length > 0) {
      reportParts.push(`### Пропущены (ошибка LLM)\n${skippedArticles.map(a => `- ${a}.md`).join("\n")}`);
    }


    if (signal.aborted) return;

    // actualizeDomainConfig (runs once after loop)
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).lintProgress.actualizing(domain.id) };
    yield { kind: "tool_use", name: "Updating config", input: {} };
    const patchRes = await actualizeDomainConfig(domain, pages, llm, model, opts, signal);
    yield { kind: "tool_result", ok: true, preview: patchRes.patch ? "config updated" : "no changes" };
    outputTokens += patchRes.outputTokens;
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }

    if (signal.aborted) return;
    } // end if (useLlm)

    // Bucket repair: remove wrong-bucket stems from wiki_sources / wiki_outgoing_links
    const repairWarnings: Array<{ path: string; warnings: string[] }> = [];
    for (const [wikiPath, wikiContent] of pages) {
      const { content: repaired, warnings } = validateAndRepairWikiPageFrontmatter(wikiContent);
      if (repaired !== wikiContent) {
        pages.set(wikiPath, repaired);
        await vaultTools.write(wikiPath, repaired);
      }
      if (warnings.length > 0) {
        repairWarnings.push({ path: wikiPath, warnings });
      }
    }
    for (const { path, warnings } of repairWarnings) {
      yield {
        kind: "info_text" as const,
        icon: "⚠️",
        summary: `Frontmatter repaired: ${path}`,
        details: warnings,
      };
    }

    // Stale link cleanup — must run before backlink sync so pages map is consistent
    const deletedNames = new Set(deletedRefs.map(d => d.deletedName));
    const existingWikiStems = new Set(
      [
        ...[...pages.keys()].map(p => p.split("/").pop()!.replace(/\.md$/, "")),
        ...writtenPaths.map(p => p.split("/").pop()!.replace(/\.md$/, "")),
      ].filter(stem => !deletedNames.has(stem))
    );

    // Deterministic dead-link removal from article bodies (runs with LLM on or off).
    // Uses the vault-wide knownStems so links to source notes are preserved.
    for (const [wikiPath, wikiContent] of pages) {
      const cleaned = stripDeadLinks(wikiContent, knownStems);
      if (cleaned !== wikiContent) {
        pages.set(wikiPath, cleaned);
        await vaultTools.write(wikiPath, cleaned);
      }
    }

    for (const [wikiPath, wikiContent] of pages) {
      const { content: filteredWiki } =
        filterStaleWikiLinks(wikiContent, existingWikiStems, ["wiki_outgoing_links"]);
      if (filteredWiki !== wikiContent) {
        pages.set(wikiPath, filteredWiki);
        await vaultTools.write(wikiPath, filteredWiki);
      }
    }

    // Source-file wiki_articles cleanup — only files outside !Wiki/, stems from ALL domains
    const allWikiStems = new Set(
      allMdPaths
        .filter(p => p.startsWith(WIKI_ROOT + "/") && !p.includes("/_config/"))
        .map(p => p.split("/").pop()!.replace(/\.md$/, ""))
        .filter(stem => !deletedNames.has(stem))
    );
    const sourcePaths = allMdPaths.filter(p => !p.startsWith(WIKI_ROOT + "/"));
    for (const sourcePath of sourcePaths) {
      const rawContent = await vaultTools.read(sourcePath).catch(() => null);
      if (!rawContent) continue;
      const { content: filteredContent, warnings: stripWarnings } =
        stripInvalidWikiArticles(rawContent, allWikiStems);
      if (stripWarnings.length > 0) {
        yield { kind: "info_text", icon: "⚠️", summary: `wiki_articles repaired: ${sourcePath}`, details: stripWarnings };
      }
      if (filteredContent !== rawContent) await vaultTools.write(sourcePath, filteredContent);
    }

    // Backlink sync: wiki_articles from wiki_sources
    const backlinks = new Map<string, Set<string>>();
    for (const [wikiPath, wikiContent] of pages) {
      for (const src of parseWikiSourcesFromFm(wikiContent)) {
        const bareName = src.slice(2, -2);
        const rawPath = bareName.includes("/")
          ? bareName
          : (stemToPath.get(bareName) ?? bareName);
        if (!backlinks.has(rawPath)) backlinks.set(rawPath, new Set());
        backlinks.get(rawPath)!.add(`[[${wikiPath.split("/").pop()!.replace(/\.md$/, "")}]]`);
      }
    }

    const syncToday = new Date().toISOString().slice(0, 10);
    let syncUpdated = 0;
    for (const [rawPath, articles] of backlinks) {
      yield { kind: "tool_use", name: "Update", input: { path: rawPath } };
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

    // Full bidirectional index reconciliation — cure: add pages missing from the
    // index (fallback annotation when none), drop orphan entries. Runs without LLM.
    try {
      const reconPages = [...pages.entries()].map(([path, content]) => {
        const pid = pageId(path);
        const ann = annotations.get(pid);
        return ann ? { path, content, annotation: ann } : { path, content };
      });
      const currentIndex = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
      const recon = reconcileIndex(currentIndex, wikiVaultPath, reconPages);
      for (const a of recon.adds) {
        await upsertIndexAnnotation(vaultTools, wikiVaultPath, a.pid, a.annotation, a.fullPath);
      }
      for (const pid of recon.removes) {
        await removeIndexAnnotation(vaultTools, wikiVaultPath, pid);
      }
      if (recon.adds.length || recon.removes.length) {
        reportParts.push(`Index reconciled: +${recon.adds.length} / -${recon.removes.length}`);
      }
    } catch { /* non-critical */ }

    try {
      await appendWikiLog(vaultTools, wikiVaultPath, domain.id, {
        op: "lint",
        domainId: domain.id,
        fixed: writtenPaths,
        checkedCount: filteredArticlePaths.length,
        outputTokens,
      });
    } catch { /* non-critical */ }
  }

  yield { kind: "result", durationMs: Date.now() - start, text: reportParts.join("\n\n---\n\n"), outputTokens: outputTokens || undefined };
}


export function checkStructure(pages: Map<string, string>): string {
  const issues: string[] = [];
  for (const [path, content] of pages) {
    if (!content.startsWith("---")) {
      issues.push(`- ${path}: missing frontmatter`);
    }
    const links = [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))];
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

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
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
      content: lintActualizeTemplate,
    },
    {
      role: "user",
      content: [
        `Domain: ${domain.id} (${domain.name})`,
        ``,
        `Current config:`,
        `\`\`\`json`,
        currentConfig,
        `\`\`\``,
        ``,
        `Wiki pages (snippets):`,
        pagesSnippet || "(no pages)",
      ].join("\n"),
    },
  ];

  // JSON example appended to system prompt for stronger structural guidance.
  const systemContent = (messages[0].content as string) + `\n\n## Output JSON Example\n\n` + JSON.stringify({
    reasoning: "Kept Process, added Contract based on new pages.",
    entity_types: [
      { type: "Process", description: "Business process", extraction_cues: ["BPMN","workflow"], wiki_subfolder: "processes" },
      { type: "Contract", description: "Contract/SLA", extraction_cues: ["SLA","contract"], wiki_subfolder: "contracts" },
    ],
    language_notes: "Use the configured output language for business terms.",
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
    if (Array.isArray(parsed.entity_types)) patch.entity_types = parsed.entity_types;
    if (typeof parsed.language_notes === "string") patch.language_notes = parsed.language_notes;
    return { patch: Object.keys(patch).length > 0 ? patch : null, outputTokens: r.outputTokens };
  } catch {
    return { patch: null, outputTokens: 0 };
  }
}
