import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, OnFileError } from "../types";
import { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { DomainEntrySchema } from "./zod-schemas";
import schemaTemplate from "../../templates/_wiki_schema.md";
import initTemplate from "../../prompts/init.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { runIngest } from "./ingest";
import { GLOBAL_CONFIG_DIR, domainWikiFolder, sanitizeWikiFolder, sanitizeWikiSubfolder, domainIndexPath } from "../wiki-path";
import type { PageSimilarityService } from "../page-similarity";
import { parseIndexAnnotations } from "../wiki-index";
import { i18nFor, resolveLang } from "../i18n";

export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  onFileError?: OnFileError,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const dryRun = args.includes("--dry-run");
  const sourcesIdx = args.indexOf("--sources");
  const sourcePaths = sourcesIdx >= 0 ? args.slice(sourcesIdx + 1) : [];

  const force = args.includes("--force");

  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);

  if (force) {
    if (!existing) {
      yield { kind: "error", message: `force: domain not found: "${domainId}"` };
      return;
    }
    if (dryRun) {
      yield { kind: "error", message: "force: dry-run not supported" };
      return;
    }
    const effectiveSources = sourcePaths.length ? sourcePaths : (existing.source_paths ?? []);
    if (!effectiveSources.length) {
      yield { kind: "error", message: "force: no sources to re-analyze" };
      return;
    }

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.reinitWiping(domainWikiFolder(existing.wiki_folder)) };
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: existing.wiki_folder } };
    const wiped = await wipeDomainFolder(vaultTools, existing.wiki_folder);
    yield { kind: "tool_result", ok: true };
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.removedFiles(wiped.length) };

    yield {
      kind: "domain_updated", domainId,
      patch: { entity_types: [], analyzed_sources: [] },
    };

    if (signal.aborted) return;

    existing.entity_types = [];
    existing.analyzed_sources = [];

    yield* runInitWithSources(
      domainId, effectiveSources, false, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, true, similarity,
    );
    return;
  }

  if (sourcePaths.length) {
    yield* runInitWithSources(
      domainId, sourcePaths, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, false, similarity,
    );
    return;
  }

  if (!existing) {
    yield { kind: "error", message: `init: domain not found: "${domainId}" — add it in settings first` };
    return;
  }
  if (existing.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }
  const effectiveSources = existing.source_paths ?? [];
  if (!effectiveSources.length) {
    yield { kind: "error", message: `init: no source_paths configured for "${domainId}" — add them in settings` };
    return;
  }
  yield* runInitWithSources(domainId, effectiveSources, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, false, similarity);
}

export async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  dryRun: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  force: boolean = false,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let outputTokens = 0;
  const wikiRootGuess = `!Wiki`;

  yield { kind: "tool_use", name: "Glob", input: { pattern: sourcePaths.join(", ") } };
  await ensureRootFiles(vaultTools, wikiRootGuess);
  const sourceFileLists = await Promise.all(sourcePaths.map((sp) => vaultTools.listFiles(sp)));
  const sourceFiles = [...new Set(sourceFileLists.flat())].filter((f) => f.endsWith(".md"));

  if (!sourceFiles.length) {
    yield { kind: "tool_result", ok: false, preview: "no .md files found" };
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: `${sourceFiles.length} source files` };

  const existing = domains.find((d) => d.id === domainId);
  const isResuming = !force && existing?.analyzed_sources !== undefined;
  const alreadyAnalyzed = new Set(force ? [] : (existing?.analyzed_sources ?? []));
  const toAnalyze = isResuming
    ? sourceFiles.filter((f) => !alreadyAnalyzed.has(f))
    : sourceFiles;

  yield { kind: "init_start", totalFiles: toAnalyze.length };

  if (toAnalyze.length === 0) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Domain "${domainId}": no new sources to process.`,
      outputTokens: outputTokens || undefined,
    };
    return;
  }

  const initialDomainRoot = existing ? domainWikiFolder(existing.wiki_folder) : wikiRootGuess;
  const schemaContent = render(schemaTemplate, { section_conventions: wikiSections(opts.outputLanguage ?? "auto") });
  const indexContent = await tryRead(vaultTools, domainIndexPath(initialDomainRoot));

  let annotationsCache = parseIndexAnnotations(indexContent);

  let currentDomain: DomainEntry | null = existing ?? null;

  for (let i = 0; i < toAnalyze.length; i++) {
    if (signal.aborted) return;

    const file = toAnalyze[i];
    yield { kind: "file_start", file, index: i, total: toAnalyze.length };

    let fileContent: string;
    try {
      fileContent = await vaultTools.read(file);
    } catch {
      yield { kind: "assistant_text", delta: `⚠ ${file}: не удалось прочитать файл, пропускаем\n` };
      yield { kind: "file_done", file };
      continue;
    }

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.fileChars(file, fileContent.length) };

    // --- Step 1: Analyze ---
    if (i === 0 && !isResuming) {
      // Bootstrap
      const systemContent = render(initTemplate, {
        domain_id: domainId,
        vault_name: vaultName,
        schema_block: schemaContent ? `\nWiki conventions (_wiki_schema.md):\n${schemaContent}` : "",
        index_block: indexContent ? `\nExisting structure (_index.md):\n${indexContent}` : "",
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        { role: "user", content: `Domain ID: ${domainId}\nVault name: ${vaultName}\nSource paths: ${sourcePaths.join(", ")}\n\n${file}:\n${fileContent}` },
      ];

      yield { kind: "tool_use", name: "Initialising domain", input: {} };
      const collected: RunEvent[] = [];
      let parsed: { id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: DomainEntrySchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.bootstrap",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
        yield { kind: "tool_result", ok: true, preview: `domain: ${parsed.id}` };
        if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap (${(e as Error).message})\n` };
        yield { kind: "file_done", file };
        continue;
      }
      for (const ev of collected) yield ev;

      if (signal.aborted) return;

      let entry: DomainEntry;
      try {
        entry = {
          id: parsed.id,
          name: parsed.name,
          wiki_folder: parsed.wiki_folder,
          entity_types: parsed.entity_types,
          language_notes: parsed.language_notes,
        };
        entry.wiki_folder = sanitizeWikiFolder(entry.wiki_folder ?? "");
        for (const et of entry.entity_types ?? []) {
          if (et.wiki_subfolder) et.wiki_subfolder = sanitizeWikiSubfolder(et.wiki_subfolder);
          // LLM sometimes echoes domain_id as wiki_subfolder → creates !Wiki/os/os paths
          if (et.wiki_subfolder === domainId) et.wiki_subfolder = "";
        }
        if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
        // На reinit (force=true) wiki_folder уже зафиксирован — LLM не должен его менять.
        if (force && existing) {
          entry.wiki_folder = existing.wiki_folder;
        }
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: bootstrap построение entry упало, пропускаем\n` };
        yield { kind: "file_done", file };
        continue;
      }

      if (dryRun) {
        yield {
          kind: "result",
          durationMs: Date.now() - start,
          text: `Dry run — domain entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``,
          outputTokens: outputTokens || undefined,
        };
        return;
      }

      currentDomain = {
        ...(existing ?? { id: domainId, name: entry.name }),
        wiki_folder: entry.wiki_folder,
        entity_types: entry.entity_types,
        language_notes: entry.language_notes,
        source_paths: sourcePaths,
        analyzed_sources: [],
        analyzed_sources_v2: true,
      };

      yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
      if (existing) {
        yield {
          kind: "domain_updated", domainId,
          patch: {
            entity_types: currentDomain.entity_types,
            language_notes: currentDomain.language_notes,
            wiki_folder: currentDomain.wiki_folder,
            analyzed_sources: [],
          },
        };
      } else {
        yield { kind: "domain_created", entry: currentDomain };
      }
      yield { kind: "tool_result", ok: true };
    } else {
      if (!currentDomain) {
        yield { kind: "file_done", file };
        continue;
      }
    }

    if (signal.aborted) return;
    if (!currentDomain) {
      yield { kind: "file_done", file };
      continue;
    }

    // --- Ingest: write pages + intercept domain_updated for entity_types propagation ---
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts, similarity, annotationsCache)) {
          yield ev;
          if (ev.kind === "domain_updated" && ev.domainId === domainId) {
            currentDomain = { ...currentDomain, ...ev.patch };
          }
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e as Error;
      }
      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      }
    }

    if (similarity) {
      const domainRoot = currentDomain ? domainWikiFolder(currentDomain.wiki_folder) : wikiRootGuess;
      const fresh = await tryRead(vaultTools, domainIndexPath(domainRoot));
      annotationsCache = parseIndexAnnotations(fresh);
    }

    if (signal.aborted) return;

    // --- Mark file complete: update analyzed_sources ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: [...(currentDomain.analyzed_sources ?? []), file],
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield {
      kind: "domain_updated", domainId,
      patch: {
        entity_types: currentDomain.entity_types,
        language_notes: currentDomain.language_notes,
        analyzed_sources: currentDomain.analyzed_sources,
      },
    };
    yield { kind: "tool_result", ok: true };

    yield { kind: "file_done", file };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${toAnalyze.length} source files.`,
    outputTokens: outputTokens || undefined,
  };
}

export async function wipeDomainFolder(vaultTools: VaultTools, wikiFolder: string): Promise<string[]> {
  const root = domainWikiFolder(wikiFolder);
  const files = await vaultTools.listFiles(root);
  for (const f of files) {
    try { await vaultTools.remove(f); } catch { /* skip locked */ }
  }
  await vaultTools.removeSubfolders(root);
  return files;
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const legacyIndex  = `${wikiRoot}/_index.md`;
  const legacyLog    = `${wikiRoot}/_log.md`;

  try { await vaultTools.mkdir(wikiRoot); } catch { /* already exists */ }
  try { await vaultTools.mkdir(GLOBAL_CONFIG_DIR); } catch { /* already exists */ }

  try {
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем */ }
}
