import { join } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { runStructuredWithRetry } from "./structured-output";
import { runWithContextRepack, classifyContextError, PromptBudgetExceededError } from "../prompt-budget";
import { applyPagePatch } from "../section-patches";
import { buildLintBatchMessages, buildLintRelatedSections, buildLintWorkItems, lintReplaceAuthorities, mergeLintFindings, validateLintBatchOutput, validateLintCoverage, type LintBatchOutput, type LintFinding, type LintWorkItem } from "./lint-batches";
import { EntityTypesDeltaSchema, LintBatchOutputSchema } from "./zod-schemas";
import lintTemplate from "../../prompts/lint.md";
import lintActualizeTemplate from "../../prompts/lint-actualize.md";
import wikiSchemaTemplate from "../../templates/_wiki_schema.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { domainWikiFolder, WIKI_ROOT, isWikiPagePath, effectiveSubfolder } from "../wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseResourceFromFm, validateAndRepairWikiPageFrontmatter, stripInvalidWikiArticles } from "../utils/raw-frontmatter";
import { checkGraphStructure, pageId } from "../wiki-graph";
import { checkWikiLinks, fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
import { graphCache } from "../wiki-graph-cache";
import { collectDescriptions, pageIndexRecordFromMarkdown } from "../wiki-index";
import { readPageDescriptions, reconcilePageIndex, removeArticleIndex, upsertPageIndex } from "../wiki-index-store";
import { appendWikiLog } from "../wiki-log";
import { ensureDomainConfig } from "../domain-config";
import type { PageSimilarityService } from "../page-similarity";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";
import { i18nFor, resolveLang } from "../i18n";
import { promptVersionOf } from "../prompt-version";

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
      try {
        await vaultTools.remove(f);
      } catch { /* skip */ }
      if (await vaultTools.exists(f)) continue;
      deleted++;
      await removeArticleIndex(vaultTools, wikiVaultPath, pageId(f));
      continue;
    }
    let content: string;
    try {
      content = await vaultTools.read(f);
    } catch { /* skip unreadable */
      continue;
    }
    if (!/resource:/m.test(content)) {
      try {
        await vaultTools.remove(f);
      } catch { /* skip */ }
      if (await vaultTools.exists(f)) continue;
      deleted++;
      await removeArticleIndex(vaultTools, wikiVaultPath, pageId(f));
    }
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
  const isValid = (entry: string): boolean => {
    const text = entry.trim();
    // Wiki pages belong in ## Related, not resource.
    if (wikiStems.has(text)) return false;
    // Path-based references (e.g. "Sources/raw") are always valid —
    // knownStems only tracks basenames, not full paths.
    if (text.includes("/")) return true;
    return knownStems.has(text) || titleMap.has(text.toLowerCase());
  };

  // Restore valid entries the LLM may have silently dropped or collapsed to [].
  if (originalContent) {
    const originalEntries = parseResourceFromFm(originalContent);
    const llmEntries = new Set(parseResourceFromFm(content));
    const validOriginal = originalEntries.filter(isValid);
    const missing = validOriginal.filter((e) => !llmEntries.has(e));
    if (missing.length > 0) {
      // Normalise: replace inline `resource: []` or bare `resource:` with a block list.
      const emptyKeyRe = /resource:\s*(?:\[\]\s*\n|\n(?!\s*-))/;
      if (emptyKeyRe.test(content)) {
        const block = "resource:\n" + missing.map((e) => `  - "${e}"`).join("\n") + "\n";
        content = content.replace(emptyKeyRe, block);
      } else {
        // Block-list exists — append missing items after the last list entry.
        const listBlockRe = /(resource:\s*\n(?:[ \t]+-[ \t]+[^\n]+\n?)+)/;
        content = content.replace(listBlockRe, (match) =>
          match.trimEnd() + "\n" + missing.map((e) => `  - "${e}"`).join("\n") + "\n",
        );
      }
    }
  }

  // Remove stale entries (entries present in content that are not known vault stems).
  const entries = parseResourceFromFm(content);
  if (entries.length === 0) return content;

  const toRemove = entries.filter((e) => !isValid(e));
  if (toRemove.length === 0) return content;

  // resource entries are plain strings (no YAML flow-sequence ambiguity), but
  // removal is still done via raw string substitution to preserve surrounding
  // formatting/comments untouched by a full re-parse/re-stringify round-trip.
  let result = content;
  for (const entry of toRemove) {
    // Remove the list item line containing this stem — handles both quoted and unquoted forms.
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`[ \\t]+-[ \\t]+"?${escaped}"?\\n?`, ""), "");
  }
  return result;
}

function compactFindingReport(findings: readonly LintFinding[]): string {
  if (findings.length === 0) return "No findings.";
  return findings.map((finding) =>
    `- [${finding.severity}] ${finding.path} :: ${finding.heading} :: ${finding.rule} :: ${finding.text}`
    + (finding.repairInstruction ? ` — ${finding.repairInstruction}` : "")
  ).join("\n");
}

function structuralFindings(allStructuralIssues: string, pages: Map<string, string>): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of allStructuralIssues.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const path = [...pages.keys()].find((candidate) => line.includes(candidate)
      || line.includes(candidate.split("/").pop() ?? candidate));
    if (!path) continue;
    findings.push({
      path,
      heading: "## Page",
      rule: "programmatic-structure",
      severity: "error",
      text: line.replace(/^-\s*/, ""),
      repairInstruction: "Repair the deterministic lint issue without changing unrelated sections.",
    });
  }
  return findings;
}

function packLintWorkBatches(
  items: readonly LintWorkItem[],
  domainName: string,
  schema: string,
  inputBudgetTokens: number,
): LintWorkItem[][] {
  const batches: LintWorkItem[][] = [];
  let current: LintWorkItem[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    const messages = buildLintBatchMessages({
      domainName,
      schema,
      workItems: candidate,
      relatedSections: [],
    });
    if (estimateMessages(messages) <= inputBudgetTokens || current.length === 0) {
      current = candidate;
      continue;
    }
    batches.push(current);
    current = [item];
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function estimateMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength;
}

async function runLintBatchWithSplit(args: {
  items: readonly LintWorkItem[];
  allItems?: readonly LintWorkItem[];
  pages: Map<string, string>;
  domainName: string;
  schema: string;
  llm: LlmClient;
  model: string;
  opts: LlmCallOptions;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
}): Promise<{ output: LintBatchOutput; outputTokens: number }> {
  try {
    const result = await runWithContextRepack({
      callSite: "lint.batch",
      configuredInputBudget: args.opts.inputBudgetTokens ?? 16_384,
      outputBudget: args.opts.maxTokens,
      compressionProfile: args.opts.semanticCompression?.profile ?? "balanced",
      build: (effectiveInputBudget) => {
        let relatedSections = buildLintRelatedSections(
          args.allItems ?? args.items,
          args.items,
          args.pages,
          Math.floor(effectiveInputBudget * 0.25),
        );
        let messages = buildLintBatchMessages({
          domainName: args.domainName,
          schema: args.schema,
          workItems: args.items,
          relatedSections,
        });
        let estimatedInputTokens = estimateMessages(messages);
        while (estimatedInputTokens > effectiveInputBudget && relatedSections.length > 0) {
          relatedSections = relatedSections.slice(0, -1);
          messages = buildLintBatchMessages({
            domainName: args.domainName,
            schema: args.schema,
            workItems: args.items,
            relatedSections,
          });
          estimatedInputTokens = estimateMessages(messages);
        }
        if (estimatedInputTokens > effectiveInputBudget) {
          throw new PromptBudgetExceededError(
            effectiveInputBudget,
            estimatedInputTokens,
            args.items.map((item) => item.id),
          );
        }
        return {
          value: messages,
          estimatedInputTokens,
          contextUnits: args.items.length,
        };
      },
      execute: async (messages) => {
        const r = await runStructuredWithRetry({
          llm: args.llm,
          model: args.model,
          baseMessages: messages,
          opts: {
            ...args.opts,
            jsonMode: false,
            inputBudgetTokens: args.opts.inputBudgetTokens ?? 16_384,
          },
          profile: { kind: "json-zod", schema: LintBatchOutputSchema },
          maxRetries: args.opts.structuredRetries ?? 1,
          callSite: "lint.batch",
          signal: args.signal,
          onEvent: args.onEvent,
        });
        const output = {
          ...r.value,
          deletes: r.value.deletes ?? [],
        } as unknown as LintBatchOutput;
        validateLintBatchOutput(args.items, args.pages, output);
        return { output, outputTokens: r.outputTokens, inputTokens: r.inputTokens };
      },
      onEvent: args.onEvent,
    });
    return result;
  } catch (error) {
    const canSplit = args.items.length > 1
      && (classifyContextError(error) !== null
        || error instanceof PromptBudgetExceededError
        || /coveredWorkIds|not submitted|section_hash_mismatch/i.test((error as Error).message));
    if (!canSplit) throw error;
    const middle = Math.ceil(args.items.length / 2);
    const left = await runLintBatchWithSplit({ ...args, items: args.items.slice(0, middle) });
    const right = await runLintBatchWithSplit({ ...args, items: args.items.slice(middle) });
    return {
      output: {
        coveredWorkIds: [...left.output.coveredWorkIds, ...right.output.coveredWorkIds],
        findings: mergeLintFindings([left.output.findings, right.output.findings]),
        patches: [...left.output.patches, ...right.output.patches],
        deletes: [...left.output.deletes, ...right.output.deletes],
      },
      outputTokens: left.outputTokens + right.outputTokens,
    };
  }
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
  const allFilteredArticlePaths: string[] = [];

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
      yield { kind: "info_text", icon: "🗑️", summary: `Deleted ${deletedInvalid} invalid wiki article(s).` };
    }

    yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
    await ensureDomainConfig(vaultTools, wikiVaultPath);
    const schemaContent = render(wikiSchemaTemplate, { section_conventions: wikiSections(resolveLang(opts.outputLanguage)) });
    const allFiles = await vaultTools.listFiles(wikiVaultPath);
    const files = allFiles.filter(isWikiPagePath);
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

    // Structured page descriptions + article iteration order
    const annotations = await readPageDescriptions(vaultTools, wikiVaultPath);
    const pidToPath = new Map(files.map(p => [pageId(p), p]));
    const articlePaths = [...new Set([
      ...[...annotations.keys()].map(pid => pidToPath.get(pid)!).filter(Boolean),
      ...files,
    ])];
    const filteredArticlePaths = entityTypeFilter.length > 0
      ? articlePaths.filter(p =>
          entityTypeFilter.some(et => {
            const found = domain.entity_types?.find(e => e.type === et);
            return found ? p.includes(`/${effectiveSubfolder(found)}/`) : false;
          })
        )
      : articlePaths;
    allFilteredArticlePaths.push(...filteredArticlePaths);

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
    let effectiveEntityTypes: EntityType[] = domain.entity_types ?? [];
    let mergedFindings: LintFinding[] = structuralFindings(allStructuralIssues, pages);

    if (useLlm) {
      const lintPages = new Map(filteredArticlePaths.map((path) => [path, pages.get(path) ?? ""]));
      const workItems = buildLintWorkItems(lintPages, opts.inputBudgetTokens ?? 16_384);
      validateLintCoverage(lintPages, workItems);
      const batches = packLintWorkBatches(workItems, domain.name, systemContent, opts.inputBudgetTokens ?? 16_384);
      const batchOutputs: LintBatchOutput[] = [];

      for (let i = 0; i < batches.length; i++) {
        if (signal.aborted) return;
        const batch = batches[i];
        yield { kind: "info_text", icon: "🔍", summary: `Checking batch ${i + 1}/${batches.length}: ${batch.length} work item(s)` };
        yield { kind: "tool_use", name: "Analysing wiki", input: { batch: i + 1, workItems: batch.length } };
        const pwtEvents: RunEvent[] = [];
        try {
          const result = await runLintBatchWithSplit({
            items: batch,
            pages,
            domainName: domain.name,
            schema: systemContent,
            allItems: workItems,
            llm,
            model,
            opts,
            signal,
            onEvent: (ev) => pwtEvents.push(ev),
          });
          outputTokens += result.outputTokens;
          batchOutputs.push(result.output);
          yield { kind: "tool_result", ok: true, preview: `${result.output.findings.length} findings, ${result.output.patches.length} patches` };
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") return;
          yield { kind: "tool_result", ok: false, preview: (e as Error).message };
          skippedArticles.push(...batch.map((item) => item.id));
          continue;
        }
        for (const ev of pwtEvents) yield ev;
      }

      const allBatchFindings = batchOutputs.map((output) => output.findings);
      mergedFindings = mergeLintFindings([mergedFindings, ...allBatchFindings]);
      const findingsReport = compactFindingReport(mergedFindings);
      yield { kind: "assistant_text", delta: findingsReport };
      reportParts.push(`### ${domain.id} lint findings\n${findingsReport}`);

      const allPatches = batchOutputs.flatMap((output) => output.patches);
      const patchPaths = new Set(allPatches.map((patch) => patch.path));
      if (allPatches.length > 0) {
        const previewContents = new Map<string, string>();
        for (const patch of allPatches) {
          const current = pages.get(patch.path);
          if (current === undefined) continue;
          const authorities = lintReplaceAuthorities(
            workItems.filter((item) => item.path === patch.path),
            pages,
          );
          const applied = applyPagePatch(current, patch, authorities);
          if (!applied.ok) {
            yield { kind: "tool_use", name: "Update", input: { path: patch.path } };
            yield { kind: "tool_result", ok: false, preview: applied.reason };
            continue;
          }
          previewContents.set(patch.path, applied.content);
        }
        const wlFixResult = fixWikiLinks(previewContents, wikiLinkValidationRetries, knownStems);
        if (wlFixResult.warnings.length > 0) {
          yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
        }
        for (const path of patchPaths) {
          const fixed = wlFixResult.fixed.get(path) ?? previewContents.get(path);
          if (fixed === undefined) continue;
          yield { kind: "tool_use", name: "Update", input: { path } };
          try {
            const originalContent = pages.get(path) ?? "";
            const wikiStems = new Set([...pages.keys()].map(p => p.split("/").pop()!.replace(/\.md$/, "")));
            const fixedContent = validateWikiSources(fixed, originalContent, knownStems, titleMap, wikiStems);
            await vaultTools.write(path, fixedContent);
            writtenPaths.push(path);
            pages.set(path, fixedContent);
            const record = pageIndexRecordFromMarkdown(wikiVaultPath, path, fixedContent);
            annotations.set(record.articleId, record.description);
            await upsertPageIndex(vaultTools, wikiVaultPath, record);
            yield { kind: "tool_result", ok: true };
          } catch (e) {
            yield { kind: "tool_result", ok: false, preview: (e as Error).message };
          }
        }
        reportParts.push(`#### Исправлено: ${allPatches.length} patch(es)`);
      }

      for (const { path: delPath, redirect_to } of batchOutputs.flatMap((output) => output.deletes)) {
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
          await removeArticleIndex(vaultTools, wikiVaultPath, deletedName);

          // Rewrite [[deletedName]] links in all wiki pages
          for (const [wikiPath, wikiContent] of pages) {
            if (wikiContent.includes(`[[${deletedName}]]`)) {
              const newContent = redirectName
                ? wikiContent.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
                : wikiContent.replaceAll(`[[${deletedName}]]`, "");
              await vaultTools.write(wikiPath, newContent);
              pages.set(wikiPath, newContent);
              await upsertPageIndex(
                vaultTools,
                wikiVaultPath,
                pageIndexRecordFromMarkdown(wikiVaultPath, wikiPath, newContent),
              );
            }
          }

          deletedRefs.push({ deletedName, redirectName });
          yield { kind: "tool_result", ok: true, preview: redirectName ? `merged → [[${redirectName}]]` : "deleted" };
        } catch (e) {
          yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        }
      }

      ({ graph } = graphCache.get(domain.id, pages));
      if (similarity) {
        const pageBodies = new Map<string, string>();
        for (const [path, content] of pages) pageBodies.set(pageId(path), content);
        const descriptions = collectDescriptions([...pages].map(([path, content]) => ({ path, content })));
        const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, descriptions, pageBodies, { fullCorpus: true });
        if (similarity.config.mode === "embedding" && updated > 0) {
          yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
        }
      }

    // Post-loop: delete wiki pages that ended up with no valid resource.
    // Pushes their stems into deletedRefs so the backlink rewrite below removes
    // their wiki_articles entries from source files.
    for (const wikiPath of writtenPaths) {
      const wikiContent = pages.get(wikiPath);
      if (!wikiContent) continue;
      if (parseResourceFromFm(wikiContent).length === 0) {
        const stem = pageId(wikiPath);
        try {
          if (typeof vaultTools.remove === "function") {
            await vaultTools.remove(wikiPath);
          }
        } catch { /* non-critical — page already gone */ }
        pages.delete(wikiPath);
        await removeArticleIndex(vaultTools, wikiVaultPath, stem);
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
    const patchRes = await actualizeDomainConfig(domain, mergedFindings, llm, model, opts, signal);
    yield { kind: "tool_result", ok: true, preview: patchRes.patch ? "config updated" : "no changes" };
    outputTokens += patchRes.outputTokens;
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }
    if (patch?.entity_types) effectiveEntityTypes = patch.entity_types;

    if (signal.aborted) return;
    } // end if (useLlm)

    // Empty-type cleanup (deterministic, runs in both LLM modes): an entity type whose
    // wiki subfolder holds zero article files is removed — its folder is deleted and the
    // type is stripped from the domain config so it no longer appears in the lint modal.
    const survivingTypes: EntityType[] = [];
    const removedTypes: EntityType[] = [];
    for (const et of effectiveEntityTypes) {
      const sub = effectiveSubfolder(et);
      const count = [...pages.keys()].filter((p) => p.startsWith(`${wikiVaultPath}/${sub}/`)).length;
      if (count > 0) { survivingTypes.push(et); continue; }
      removedTypes.push(et);
      try { await vaultTools.rmdir(`${wikiVaultPath}/${sub}`, true); } catch { /* folder already gone */ }
    }
    if (removedTypes.length > 0) {
      yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: survivingTypes } };
      reportParts.push(`Removed empty entity types: ${removedTypes.map((e) => e.type).join(", ")}`);
      yield {
        kind: "info_text",
        icon: "🗑️",
        summary: `Removed ${removedTypes.length} empty entity type(s): ${removedTypes.map((e) => e.type).join(", ")}`,
      };
    }

    // Bucket repair: remove wrong-bucket stems from resource; drop legacy link fields
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

    // Deterministic dead-link removal from article bodies (runs with LLM on or off).
    // Uses the vault-wide knownStems so links to source notes are preserved.
    for (const [wikiPath, wikiContent] of pages) {
      const cleaned = stripDeadLinks(wikiContent, knownStems);
      if (cleaned !== wikiContent) {
        pages.set(wikiPath, cleaned);
        await vaultTools.write(wikiPath, cleaned);
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

    // Backlink sync: wiki_articles from resource
    const backlinks = new Map<string, Set<string>>();
    for (const [wikiPath, wikiContent] of pages) {
      for (const bareName of parseResourceFromFm(wikiContent)) {
        const rawPath = bareName.includes("/")
          ? bareName
          : (stemToPath.get(bareName) ?? bareName);
        if (!backlinks.has(rawPath)) backlinks.set(rawPath, new Set());
        backlinks.get(rawPath)!.add(`[[${wikiPath.split("/").pop()!.replace(/\.md$/, "")}]]`);
      }
    }

    let syncUpdated = 0;
    for (const [rawPath, articles] of backlinks) {
      yield { kind: "tool_use", name: "Update", input: { path: rawPath } };
      try {
        const rawContent = await vaultTools.read(rawPath);
        const existingArticles = parseWikiArticlesFromFm(rawContent);
        const mergedArticles = [...new Set([...existingArticles, ...articles])];
        const newContent = upsertRawFrontmatter(rawContent, {
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

    // Full page-record reconciliation preserves chunk/future records. Runs without LLM.
    const before = new Set((await readPageDescriptions(vaultTools, wikiVaultPath)).keys());
    const after = new Set([...pages.keys()].map(pageId));
    const adds = [...after].filter((id) => !before.has(id)).length;
    const removes = [...before].filter((id) => !after.has(id)).length;
    await reconcilePageIndex(
      vaultTools,
      wikiVaultPath,
      [...pages].map(([path, content]) => ({ path, content })),
    );
    if (adds || removes) {
      reportParts.push(`Index reconciled: +${adds} / -${removes}`);
    }

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

  yield {
    kind: "eval_meta",
    fields: {
      articles: allFilteredArticlePaths,
      promptVersion: promptVersionOf(lintTemplate),
    },
  };

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

async function actualizeDomainConfig(
  domain: DomainEntry,
  findings: readonly LintFinding[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ patch: { entity_types?: EntityType[]; language_notes?: string } | null; outputTokens: number }> {
  const currentConfig = JSON.stringify({
    entity_types: domain.entity_types ?? [],
    language_notes: domain.language_notes ?? "",
  }, null, 2);

  const compactFindings = compactFindingReport(findings).slice(0, 24_000);

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
        `Compact lint findings:`,
        compactFindings,
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
