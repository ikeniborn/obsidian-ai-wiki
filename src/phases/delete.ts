import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import type { DomainEntry } from "../domain";
import type { PageSimilarityService } from "../page-similarity";
import { domainWikiFolder, validateArticlePath, isWikiPagePath } from "../wiki-path";
import { removeIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
import { stripInvalidWikiArticles } from "../utils/raw-frontmatter";
import { computeDeletionPlan, sourceStem } from "../source-deletion";
import { runIngest } from "./ingest";
import ingestTemplate from "../../prompts/ingest.md";
import { promptVersionOf } from "../prompt-version";

/**
 * Delete a source file and its wiki artifacts; rebuild multi-source pages on
 * their remaining sources. args = [sourceVaultPath, domainId].
 */
export async function* runDelete(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  graphDepth: number = 1,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const sourcePath = args[0];
  const domainId = args[1];
  if (!sourcePath || !domainId) {
    yield { kind: "error", message: "delete: source path and domain id required" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const domain = domains.find((d) => d.id === domainId);
  if (!domain) {
    yield { kind: "error", message: `delete: domain ${domainId} not found` };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const wikiFolder = domainWikiFolder(domain.wiki_folder);

  // --- Build pages map + remaining-source map (vaultTools-based) ---
  const pageFiles = (await vaultTools.listFiles(wikiFolder)).filter(isWikiPagePath);
  const pages = new Map<string, string>();
  for (const p of pageFiles) {
    try { pages.set(p, await vaultTools.read(p)); } catch { /* skip unreadable */ }
  }
  const sourceStemToPath = new Map<string, string>();
  for (const sp of domain.source_paths ?? []) {
    let files: string[];
    try { files = await vaultTools.listFiles(sp); } catch { files = []; }
    for (const f of files) {
      if (!f.endsWith(".md") || f === sourcePath) continue;
      sourceStemToPath.set(sourceStem(f), f);
    }
    // sp itself may be a single .md file source
    if (sp.endsWith(".md") && sp !== sourcePath) sourceStemToPath.set(sourceStem(sp), sp);
  }

  const plan = computeDeletionPlan(sourcePath, pages, sourceStemToPath);
  yield {
    kind: "info_text", icon: "trash", summary: `Deleting source: ${sourceStem(sourcePath)}`,
    details: [`${plan.toDelete.length} page(s) to delete`, `${plan.toRebuild.length} page(s) to rebuild`],
  };

  // --- 1. Drop source from domain config (source_paths + analyzed_sources) ---
  yield { kind: "source_path_removed", domainId, path: sourcePath };
  const targetStem = sourceStem(sourcePath);
  const curAnalyzed = domain.analyzed_sources ?? {};
  const prunedAnalyzed: Record<string, string> = {};
  for (const k of Object.keys(curAnalyzed)) {
    if (k !== sourcePath && sourceStem(k) !== targetStem) prunedAnalyzed[k] = curAnalyzed[k];
  }
  if (Object.keys(prunedAnalyzed).length !== Object.keys(curAnalyzed).length) {
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: prunedAnalyzed } };
  }

  const safeRemovePage = async (p: string): Promise<boolean> => {
    if (!validateArticlePath(p, wikiFolder)) return false;
    try { await vaultTools.remove(p); await removeIndexAnnotation(vaultTools, wikiFolder, pageId(p)); return true; }
    catch { return false; }
  };

  // --- 2. Wipe rebuild pages ---
  for (const p of plan.toRebuild) {
    if (signal.aborted) break;
    if (!(await safeRemovePage(p))) {
      yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
    }
  }

  // --- 3. Rebuild: re-ingest each remaining source (continue + collect) ---
  const failedSources: string[] = [];
  for (const src of plan.remainingSources) {
    if (signal.aborted) break;
    let sourceFailed = false;
    try {
      for await (const ev of runIngest(
        [src], vaultTools, llm, model, domains, vaultRoot, signal, opts,
        similarity, undefined, graphDepth, wikiLinkValidationRetries,
      )) {
        if (ev.kind === "error") sourceFailed = true;
        // Suppress the inner per-source `result` event — runDelete emits its own
        // final `result`; forwarding it would trip the view's stopWaiting() early.
        if (ev.kind === "result" || ev.kind === "eval_meta") continue;
        yield ev;
      }
    } catch (e) {
      sourceFailed = true;
      yield { kind: "error", message: `Rebuild failed for ${src}: ${(e as Error).message}` };
    }
    if (sourceFailed) failedSources.push(src);
  }

  // --- 4. Delete sole-source pages ---
  let deleted = 0;
  for (const p of plan.toDelete) {
    if (signal.aborted) break;
    if (await safeRemovePage(p)) deleted++;
    else yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
  }

  // --- 5. Backlink cleanup: strip references to now-missing pages from source files ---
  const remainingPageStems = new Set(
    (await vaultTools.listFiles(wikiFolder))
      .filter(isWikiPagePath)
      .map((p) => pageId(p)),
  );
  for (const src of sourceStemToPath.values()) {
    try {
      const content = await vaultTools.read(src);
      const { content: cleaned, warnings } = stripInvalidWikiArticles(content, remainingPageStems);
      if (warnings.length > 0 && cleaned !== content) await vaultTools.write(src, cleaned);
    } catch { /* skip */ }
  }

  // --- 6. Delete source file LAST, only if no rebuild failures AND not aborted (F-002) ---
  // An abort mid-rebuild leaves wiped pages un-rebuilt; deleting the source then would
  // be unrecoverable data loss, so keep the source whenever the run did not complete cleanly.
  let sourceRemoved = false;
  if (failedSources.length === 0 && !signal.aborted) {
    try { await vaultTools.remove(sourcePath); sourceRemoved = true; }
    catch (e) { yield { kind: "error", message: `Could not delete source file: ${(e as Error).message}` }; }
  }

  // --- 7. Result ---
  const parts = [
    `Deleted source ${targetStem}`,
    `pages deleted ${deleted}`,
    `rebuilt ${plan.toRebuild.length}`,
  ];
  if (failedSources.length > 0) {
    parts.push(`${failedSources.length} rebuild failure(s)`);
  }
  if (!sourceRemoved) {
    parts.push(signal.aborted ? "source kept — cancelled" : "source kept — retry");
  }
  const text = parts.filter(Boolean).join(", ") + ".";
  if (failedSources.length > 0) {
    yield { kind: "info_text", icon: "alert-triangle", summary: "Rebuild failures", details: failedSources };
  }
  yield {
    kind: "eval_meta",
    fields: {
      deleted_source: sourcePath,
      rebuilt_pages: plan.toRebuild,
      promptVersion: promptVersionOf(ingestTemplate),
    },
  };
  yield { kind: "result", durationMs: Date.now() - start, text };
}
