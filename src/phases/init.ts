import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { IngestOutcome, LlmCallOptions, RunEvent, LlmClient, OnFileError } from "../types";
import { VaultTools } from "../vault-tools";
import { createLlmLifecycle, runStructuredStreaming, type StructuredSink } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import { DomainEntrySchema } from "./zod-schemas";
import schemaTemplate from "../../templates/_wiki_schema.md";
import initTemplate from "../../prompts/init.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { runIngest } from "./ingest";
import {
  WIKI_ROOT,
  domainIndexPath,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
} from "../wiki-path";
import type { PageSimilarityService } from "../page-similarity";
import { readPageDescriptions } from "../wiki-index-store";
import { i18nFor, resolveLang } from "../i18n";
import { promptVersionOf } from "../prompt-version";
import { EmbeddingUnavailableError } from "../embedding-error";
import { prepareBootstrapEvidence, type BootstrapEvidence } from "./ingest-evidence";
import {
  estimatePreparedMessages,
  PromptBudgetExceededError,
} from "../prompt-budget";
import { prepareChatMessages } from "./llm-utils";
import { RunEventBridge } from "../run-event-bridge";
import { contentHash } from "../content-hash";

async function* forwardIngest(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
  onDomainUpdate: (event: Extract<RunEvent, { kind: "domain_updated" }>) => void,
): AsyncGenerator<RunEvent, IngestOutcome> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
    if (next.value.kind === "domain_updated") onDomainUpdate(next.value);
    yield next.value;
  }
}

interface PreparedDomainBootstrap {
  sourceFile: string;
  sourceContent: string;
  preparedSources?: Array<{ path: string; content: string }>;
  entry: DomainEntry;
  outputTokens: number;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

async function* prepareDomainBootstrap(
  domainId: string,
  sourcePaths: string[],
  sourceFile: string,
  sourceContent: string,
  existing: DomainEntry | undefined,
  force: boolean,
  vaultName: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  startedAt: number,
): AsyncGenerator<RunEvent, PreparedDomainBootstrap | null> {
  const inputBudgetTokens = opts.inputBudgetTokens ?? 16_384;
  const outputBudgetTokens = opts.maxTokens;
  const compressionProfile = opts.semanticCompression?.profile ?? "balanced";
  const schemaContent = render(schemaTemplate, {
    section_conventions: wikiSections(resolveLang(opts.outputLanguage)),
  });
  const systemContent = render(initTemplate, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `\nWiki conventions (_wiki_schema.md):\n${schemaContent}` : "",
  });
  const bootstrapMessages = (
    bootstrapEvidence: BootstrapEvidence,
  ): OpenAI.Chat.ChatCompletionMessageParam[] => [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: JSON.stringify({
        domainId,
        vaultName,
        sourcePaths,
        sourceFile,
        bootstrapEvidence,
      }),
    },
  ];
  const emptyBootstrapEvidence: BootstrapEvidence = {
    candidates: [],
    domainThemes: [],
    languageEvidence: [],
  };
  const fixedRequestEstimate = estimatePreparedMessages(
    prepareChatMessages(bootstrapMessages(emptyBootstrapEvidence), opts),
  );
  const emptyPayloadEstimate = estimatePreparedMessages([{
    role: "user",
    content: JSON.stringify(emptyBootstrapEvidence),
  }]);
  const bootstrapPayloadBudgetTokens = inputBudgetTokens
    - fixedRequestEstimate
    + emptyPayloadEstimate;
  if (bootstrapPayloadBudgetTokens <= 0) {
    yield {
      kind: "error",
      message: `init: configuration error — fixed bootstrap prompt requires ${fixedRequestEstimate} tokens but input budget is ${inputBudgetTokens}; domain was not created.`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  const bootstrapEvents = new RunEventBridge();
  let bootstrapEvidence: BootstrapEvidence;
  try {
    bootstrapEvidence = yield* bootstrapEvents.forwardAbortable(signal, (operationSignal) =>
      prepareBootstrapEvidence(sourceContent, domainId, {
      inputBudgetTokens,
      outputBudgetTokens,
      compressionProfile,
      mapperRetries: opts.structuredRetries ?? 1,
      reducerRetries: opts.structuredRetries ?? 1,
      bootstrapPayloadBudgetTokens,
    }, {
      llm,
      model,
      opts,
      signal: operationSignal,
      onEvent: (event) => bootstrapEvents.push(event),
      configuredEntityTypes: [],
      mapCallSite: "init.bootstrap-map",
    }));
  } catch (error) {
    if ((error as Error).name === "AbortError" || signal.aborted) return null;
    const isConfigurationError = error instanceof PromptBudgetExceededError
      || /bounded mapper chunk size|requires .*budget|exceeds .*budget/i.test((error as Error).message);
    const message = isConfigurationError
      ? `init: configuration error — fixed bootstrap evidence prompt exceeds input budget: ${(error as Error).message}; domain was not created.`
      : `init: domain bootstrap failed — bounded evidence preparation failed: ${(error as Error).message}. Fix model/prompt and re-run.`;
    yield { kind: "error", message };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  const messages = bootstrapMessages(bootstrapEvidence);
  const estimatedInputTokens = estimatePreparedMessages(prepareChatMessages(messages, opts));
  if (estimatedInputTokens > inputBudgetTokens) {
    yield {
      kind: "error",
      message: `init: configuration error — fixed bootstrap prompt requires ${estimatedInputTokens} tokens but input budget is ${inputBudgetTokens}; domain was not created.`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  yield { kind: "tool_use", name: "Initialising domain", input: {} };
  const sink: StructuredSink<{
    id: string;
    name: string;
    wiki_folder: string;
    entity_types: EntityType[];
    language_notes: string;
  }> = {};
  let parsed: {
    id: string;
    name: string;
    wiki_folder: string;
    entity_types: EntityType[];
    language_notes: string;
  };
  try {
    const bootstrapLifecycle = createLlmLifecycle("bootstrap_domain");
    for await (const event of runStructuredStreaming({
      llm,
      model,
      baseMessages: messages,
      opts,
      profile: { kind: "json-zod", schema: DomainEntrySchema },
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "init.bootstrap",
      lifecycle: bootstrapLifecycle,
      signal,
      onEvent: () => {},
      transport: "non-stream",
    }, sink)) {
      yield event;
    }
    parsed = sink.value!;
    yield lifecycleEvent(sink.lifecycle!.id, sink.lifecycle!.action, "applying");
    yield lifecycleEvent(sink.lifecycle!.id, sink.lifecycle!.action, "completed");
    yield { kind: "tool_result", ok: true, preview: `domain: ${parsed.id}` };
    if (sink.fullText) yield { kind: "assistant_text", delta: sink.fullText };
  } catch (error) {
    yield { kind: "tool_result", ok: false, preview: (error as Error).message };
    if ((error as Error).name === "AbortError" || signal.aborted) return null;
    yield {
      kind: "error",
      message: `init: domain bootstrap failed — could not derive entity types (structured-output error: ${(error as Error).message}). Fix model/prompt and re-run.`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  if (signal.aborted) return null;

  let entry: DomainEntry;
  try {
    entry = {
      id: parsed.id,
      name: parsed.name,
      wiki_folder: sanitizeWikiFolder(parsed.wiki_folder),
      entity_types: parsed.entity_types,
      language_notes: parsed.language_notes,
    };
    for (const entityType of entry.entity_types ?? []) {
      if (entityType.wiki_subfolder) {
        entityType.wiki_subfolder = sanitizeWikiSubfolder(entityType.wiki_subfolder);
      }
      if (entityType.wiki_subfolder === domainId) entityType.wiki_subfolder = "";
    }
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
    if (force && existing) entry.wiki_folder = existing.wiki_folder;
  } catch {
    yield {
      kind: "error",
      message: `init: domain bootstrap failed — invalid domain entry for ${sourceFile}`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  return {
    sourceFile,
    sourceContent,
    entry,
    outputTokens: sink.outputTokens ?? 0,
  };
}

async function* forwardBootstrap(
  generator: AsyncGenerator<RunEvent, PreparedDomainBootstrap | null>,
): AsyncGenerator<RunEvent, PreparedDomainBootstrap | null> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
    yield next.value;
  }
}

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
  const incremental = args.includes("--incremental");

  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);

  if (incremental) {
    if (!existing) {
      yield { kind: "error", message: `incremental: domain not found: "${domainId}"` };
      return;
    }
    if (!existing.entity_types?.length) {
      yield { kind: "error", message: `incremental: domain "${domainId}" not initialised — run a full init/reinit first` };
      return;
    }
    if (!sourcePaths.length) {
      yield { kind: "result", durationMs: 0, text: `Domain "${domainId}": no changed sources to re-ingest.` };
      return;
    }
    yield* runIncrementalReinit(
      domainId, sourcePaths, vaultTools, llm, model, domains, signal, opts, onFileError, similarity,
    );
    return;
  }

  if (force) {
    if (!existing) {
      yield { kind: "error", message: `force: domain not found: "${domainId}"` };
      return;
    }
    if (dryRun) {
      yield { kind: "error", message: "force: dry-run not supported" };
      return;
    }
    try {
      forceDomainRoot(existing.wiki_folder);
    } catch (error) {
      yield { kind: "error", message: `force: invalid wiki folder — ${(error as Error).message}` };
      return;
    }
    const effectiveSources = sourcePaths.length ? sourcePaths : (existing.source_paths ?? []);
    if (!effectiveSources.length) {
      yield { kind: "error", message: "force: no sources to re-analyze" };
      return;
    }

    let preparedSources: Array<{ path: string; content: string }>;
    try {
      const sourceFileLists = await Promise.all(
        effectiveSources.map((sourcePath) =>
          sourcePath.endsWith(".md") ? Promise.resolve([sourcePath]) : vaultTools.listFiles(sourcePath)),
      );
      const sourceFiles = [...new Set(sourceFileLists.flat())]
        .filter((file) => file.endsWith(".md"))
        .sort(compareCodePoints);
      preparedSources = await Promise.all(sourceFiles.map(async (path) => ({
        path,
        content: await vaultTools.read(path),
      })));
    } catch (error) {
      yield { kind: "error", message: `force: could not prepare sources: ${(error as Error).message}` };
      return;
    }
    const firstSource = preparedSources[0]?.path;
    if (!firstSource) {
      yield { kind: "error", message: `No .md files found in source paths: ${effectiveSources.join(", ")}` };
      return;
    }
    const firstSourceContent = preparedSources[0].content;
    const bootstrap = forwardBootstrap(prepareDomainBootstrap(
      domainId,
      effectiveSources,
      firstSource,
      firstSourceContent,
      existing,
      true,
      vaultName,
      llm,
      model,
      signal,
      opts,
      Date.now(),
    ));
    let preparedBootstrap: PreparedDomainBootstrap | null;
    while (true) {
      const next = await bootstrap.next();
      if (next.done) {
        preparedBootstrap = next.value;
        break;
      }
      yield next.value;
    }
    if (!preparedBootstrap || signal.aborted) return;
    preparedBootstrap.preparedSources = preparedSources;

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.reinitWiping(domainWikiFolder(existing.wiki_folder)) };
    yield {
      kind: "tool_use",
      name: "WipeDomain",
      input: { folder: forceDomainRoot(existing.wiki_folder) },
    };
    if (signal.aborted) {
      yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
      return;
    }
    try {
      for (const prepared of preparedSources) {
        if (await vaultTools.read(prepared.path) !== prepared.content) {
          yield { kind: "tool_result", ok: false, preview: `source changed: ${prepared.path}` };
          yield { kind: "error", message: `force: source changed during bootstrap preflight: ${prepared.path}` };
          return;
        }
        if (signal.aborted) {
          yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
          return;
        }
      }
    } catch (error) {
      yield { kind: "tool_result", ok: false, preview: (error as Error).message };
      yield { kind: "error", message: `force: could not recheck prepared sources: ${(error as Error).message}` };
      return;
    }
    if (signal.aborted) {
      yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
      return;
    }
    let wipeManifest: WipeDomainManifest;
    try {
      wipeManifest = await wipeDomainFolderWithManifest(
        vaultTools,
        existing.wiki_folder,
        signal,
      );
    } catch (error) {
      yield { kind: "tool_result", ok: false, preview: (error as Error).message };
      yield { kind: "error", message: `force: wipe failed — ${(error as Error).message}` };
      return;
    }
    yield {
      kind: "wipe_complete",
      domainId,
      ...wipeManifest,
      atMs: Date.now(),
    };
    yield { kind: "tool_result", ok: true };
    yield {
      kind: "assistant_text",
      delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.removedFiles(
        Object.keys(wipeManifest.removedFileHashes).length,
      ),
    };

    yield* runInitWithSources(
      domainId,
      effectiveSources,
      false,
      vaultTools,
      llm,
      model,
      domains.filter((domain) => domain.id !== domainId),
      vaultName,
      signal,
      opts,
      onFileError,
      true,
      similarity,
      preparedBootstrap,
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
  preparedBootstrap?: PreparedDomainBootstrap,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let outputTokens = 0;
  const wikiRootGuess = `!Wiki`;

  yield { kind: "tool_use", name: "Glob", input: { pattern: sourcePaths.join(", ") } };
  const preparedSourceContents = new Map(
    preparedBootstrap?.preparedSources?.map(({ path, content }) => [path, content]) ?? [],
  );
  let sourceFiles: string[];
  if (preparedBootstrap?.preparedSources !== undefined) {
    sourceFiles = preparedBootstrap.preparedSources.map(({ path }) => path);
  } else {
    await ensureRootFiles(vaultTools, wikiRootGuess);
    const sourceFileLists = await Promise.all(sourcePaths.map((sp) => vaultTools.listFiles(sp)));
    sourceFiles = [...new Set(sourceFileLists.flat())].filter((f) => f.endsWith(".md"));
  }

  if (!sourceFiles.length) {
    yield { kind: "tool_result", ok: false, preview: "no .md files found" };
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: `${sourceFiles.length} source files` };

  const existing = domains.find((d) => d.id === domainId);
  // "Resuming" means the domain was already bootstrapped (has entity_types), so
  // the bootstrap step is skipped and only unanalyzed sources are processed.
  // A freshly-registered domain reloads with analyzed_sources:{} (always defined),
  // so keying on analyzed_sources would wrongly skip bootstrap and leave the
  // domain with zero entity_types — which then routes/rejects every page.
  const isResuming = !force && !!existing?.entity_types?.length;
  const alreadyAnalyzed = new Set(force ? [] : Object.keys(existing?.analyzed_sources ?? {}));
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

  const initialDomainRoot = existing
    ? domainWikiFolder(existing.wiki_folder)
    : preparedBootstrap
      ? domainWikiFolder(preparedBootstrap.entry.wiki_folder)
      : wikiRootGuess;
  let annotationsCache = await readPageDescriptions(vaultTools, initialDomainRoot);

  let currentDomain: DomainEntry | null = existing ?? null;
  let bootstrapApplied = false;
  let successfulFiles = 0;

  if (force && preparedBootstrap && !existing) {
    const entry = preparedBootstrap.entry;
    currentDomain = {
      id: domainId,
      name: entry.name,
      wiki_folder: entry.wiki_folder,
      entity_types: entry.entity_types,
      language_notes: entry.language_notes,
      source_paths: sourcePaths,
      analyzed_sources: {},
      analyzed_sources_v2: true,
    };
    outputTokens += preparedBootstrap.outputTokens;
    yield { kind: "tool_use", name: "SaveDomain", input: { id: domainId } };
    yield { kind: "domain_created", entry: currentDomain };
    yield { kind: "tool_result", ok: true };
    await vaultTools.write(domainIndexPath(domainWikiFolder(currentDomain.wiki_folder)), "");
    bootstrapApplied = true;
  }

  for (let i = 0; i < toAnalyze.length; i++) {
    if (signal.aborted) return;

    const file = toAnalyze[i];
    yield { kind: "file_start", file, index: i, total: toAnalyze.length };

    let fileContent: string;
    try {
      fileContent = preparedSourceContents.has(file)
        ? preparedSourceContents.get(file)!
        : await vaultTools.read(file);
    } catch {
      yield { kind: "assistant_text", delta: `⚠ ${file}: не удалось прочитать файл, пропускаем\n` };
      continue;
    }

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.fileChars(file, fileContent.length) };

    // --- Step 1: Analyze ---
    if (i === 0 && !isResuming && !bootstrapApplied) {
      let bootstrapResult = preparedBootstrap;
      if (bootstrapResult) {
        if (bootstrapResult.sourceFile !== file || bootstrapResult.sourceContent !== fileContent) {
          yield { kind: "error", message: `force: prepared bootstrap source changed: ${file}` };
          return;
        }
      } else {
        const bootstrap = forwardBootstrap(prepareDomainBootstrap(
          domainId,
          sourcePaths,
          file,
          fileContent,
          existing,
          force,
          vaultName,
          llm,
          model,
          signal,
          opts,
          start,
        ));
        while (true) {
          const next = await bootstrap.next();
          if (next.done) {
            bootstrapResult = next.value ?? undefined;
            break;
          }
          yield next.value;
        }
      }
      if (!bootstrapResult) return;
      outputTokens += bootstrapResult.outputTokens;
      const entry = bootstrapResult.entry;

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
        analyzed_sources: {},
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
            analyzed_sources: {},
          },
        };
      } else {
        yield { kind: "domain_created", entry: currentDomain };
      }
      yield { kind: "tool_result", ok: true };
    } else {
      if (!currentDomain) {
        continue;
      }
    }

    if (signal.aborted) return;
    if (!currentDomain) {
      continue;
    }

    // --- Ingest: write pages + intercept domain_updated for entity_types propagation ---
    let retried = false;
    let done = false;
    let ingestOutcome: IngestOutcome | undefined;
    while (!done) {
      let caughtErr: Error | null = null;
      let controlledRetryable: boolean | undefined;
      try {
        const forwarded = forwardIngest(
          runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts, similarity, annotationsCache),
          (event) => {
            if (event.domainId === domainId && currentDomain) {
              currentDomain = { ...currentDomain, ...event.patch };
            }
          },
        );
        while (true) {
          const next = await forwarded.next();
          if (next.done) {
            ingestOutcome = next.value;
            break;
          }
          yield next.value;
        }
        if (!ingestOutcome.ok) {
          controlledRetryable = ingestOutcome.retryable;
          caughtErr = new Error(ingestOutcome.message);
          caughtErr.name = ingestOutcome.stage === "embedding"
            ? "EmbeddingUnavailableError"
            : "IngestOutcomeError";
        }
      } catch (e) {
        caughtErr = e as Error;
      }
      if (caughtErr) {
        if (caughtErr instanceof EmbeddingUnavailableError || caughtErr.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caughtErr.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
          return;
        }
        const canRetry = !retried && (controlledRetryable ?? true);
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      } else {
        done = true;
      }
    }

    if (!ingestOutcome?.ok) continue;
    outputTokens += ingestOutcome.outputTokens;

    if (similarity) {
      const domainRoot = currentDomain ? domainWikiFolder(currentDomain.wiki_folder) : wikiRootGuess;
      annotationsCache = await readPageDescriptions(vaultTools, domainRoot);
    }

    if (signal.aborted) return;

    // --- Mark file complete: record analyzed_sources hash ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: {
        ...(currentDomain.analyzed_sources ?? {}),
        [file]: ingestOutcome.sourceBodyHash,
      },
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

    successfulFiles++;
    yield { kind: "file_done", file };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  yield {
    kind: "eval_meta",
    fields: {
      files_processed: successfulFiles,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised ${successfulFiles} of ${toAnalyze.length} source files.`,
    outputTokens: outputTokens || undefined,
  };
}

export async function* runIncrementalReinit(
  domainId: string,
  changedFiles: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let currentDomain = domains.find((d) => d.id === domainId) ?? null;
  if (!currentDomain) {
    yield { kind: "error", message: `incremental: domain "${domainId}" missing` };
    return;
  }

  yield { kind: "init_start", totalFiles: changedFiles.length };
  let doneCount = 0;

  for (let i = 0; i < changedFiles.length; i++) {
    if (signal.aborted) return;
    const file = changedFiles[i];
    yield { kind: "file_start", file, index: i, total: changedFiles.length };

    let retried = false;
    let fileDone = false;
    let ingestOutcome: IngestOutcome | undefined;
    while (!fileDone) {
      let caught: Error | null = null;
      let controlledRetryable: boolean | undefined;
      try {
        const forwarded = forwardIngest(
          runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts, similarity),
          (event) => {
            if (event.domainId === domainId) currentDomain = { ...currentDomain!, ...event.patch };
          },
        );
        while (true) {
          const next = await forwarded.next();
          if (next.done) {
            ingestOutcome = next.value;
            break;
          }
          yield next.value;
        }
        if (!ingestOutcome.ok) {
          controlledRetryable = ingestOutcome.retryable;
          caught = new Error(ingestOutcome.message);
          caught.name = ingestOutcome.stage === "embedding"
            ? "EmbeddingUnavailableError"
            : "IngestOutcomeError";
        }
      } catch (e) {
        caught = e as Error;
      }
      if (caught) {
        if (caught instanceof EmbeddingUnavailableError || caught.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caught.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: Date.now() - start, text: "" };
          return;
        }
        if (caught.name === "AbortError" || signal.aborted) return;
        const canRetry = !retried && (controlledRetryable ?? true);
        const choice = onFileError ? await onFileError(file, caught, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        fileDone = true;
      } else {
        fileDone = true;
      }
    }

    if (signal.aborted) return;
    if (!ingestOutcome?.ok) continue;

    const analyzedMap = currentDomain.analyzed_sources ?? {};
    const nextAnalyzed: Record<string, string> = {
      ...analyzedMap,
      [file]: ingestOutcome.sourceBodyHash,
    };
    currentDomain = {
      ...currentDomain,
      analyzed_sources: nextAnalyzed,
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: currentDomain.analyzed_sources } };
    yield { kind: "tool_result", ok: true };

    doneCount++;
    yield { kind: "file_done", file };
  }

  yield {
    kind: "eval_meta",
    fields: {
      files_processed: doneCount,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}": re-ingested ${doneCount} of ${changedFiles.length} changed source(s).`,
  };
}

/**
 * Concurrency boundary for force re-init:
 * - plugin wipes of the same root are serialized by activeDomainWipes;
 * - the atomic root-to-transaction rename is the linearization point;
 * - writers that keep using the public root are detected and preserved;
 * - the unpredictable transaction namespace is operation-owned after mkdir.
 *
 * Direct external writes into that internal namespace are unsupported. A
 * generic VaultAdapter offers no primitive that can serialize such malicious
 * writes, so this function does not claim to make them safe.
 */
export async function wipeDomainFolder(
  vaultTools: VaultTools,
  wikiFolder: string,
  signal?: AbortSignal,
  options: ForceWipeOptions = {},
): Promise<string[]> {
  const manifest = await wipeDomainFolderWithManifest(
    vaultTools,
    wikiFolder,
    signal,
    options,
  );
  const root = forceDomainRoot(wikiFolder);
  return Object.keys(manifest.removedFileHashes)
    .map((relative) => `${root}/${relative}`)
    .sort(compareCodePoints);
}

export interface WipeDomainManifest {
  removedPaths: string[];
  removedFileHashes: Record<string, string>;
  manifestHash: string;
}

export async function wipeDomainFolderWithManifest(
  vaultTools: VaultTools,
  wikiFolder: string,
  signal?: AbortSignal,
  options: ForceWipeOptions = {},
): Promise<WipeDomainManifest> {
  const root = forceDomainRoot(wikiFolder);
  requireTransactionalWipeAdapter(vaultTools);
  const snapshotByteLimit = options.snapshotByteLimit ?? FORCE_WIPE_SNAPSHOT_BYTE_LIMIT;
  const fileByteLimit = options.fileByteLimit ?? FORCE_WIPE_FILE_BYTE_LIMIT;
  if (
    !Number.isSafeInteger(snapshotByteLimit)
    || snapshotByteLimit < 0
    || !Number.isSafeInteger(fileByteLimit)
    || fileByteLimit < 0
  ) {
    throw new Error("force: invalid snapshot or per-file byte limit");
  }

  if (activeDomainWipes.has(root)) {
    throw new Error(`force: wipe already in progress for ${root}`);
  }
  activeDomainWipes.add(root);
  try {
    return await wipeDomainFolderLocked(
      vaultTools,
      root,
      signal,
      snapshotByteLimit,
      fileByteLimit,
    );
  } finally {
    activeDomainWipes.delete(root);
  }
}

async function wipeDomainFolderLocked(
  vaultTools: VaultTools,
  root: string,
  signal: AbortSignal | undefined,
  snapshotByteLimit: number,
  fileByteLimit: number,
): Promise<WipeDomainManifest> {
  if (!await checkedExists(vaultTools, root, signal)) {
    const removedPaths: string[] = [];
    const removedFileHashes: Record<string, string> = {};
    return {
      removedPaths,
      removedFileHashes,
      manifestHash: contentHash(JSON.stringify({
        removedPaths,
        removedFileHashes,
      })),
    };
  }

  const transaction = await createWipeTransaction(vaultTools, signal);
  const quarantinedRoot = `${transaction}/domain`;
  const removed = new Set<string>();
  let rootRenameAttempted = false;
  let snapshot: DomainTreeSnapshot | undefined;
  try {
    await requireEmptyDirectory(vaultTools, transaction, signal, "new transaction");
    if (
      await checkedExists(vaultTools, quarantinedRoot, signal)
    ) {
      throw new Error("force: transaction destination unexpectedly exists");
    }

    rootRenameAttempted = true;
    let renameError: Error | undefined;
    try {
      await vaultTools.rename(root, quarantinedRoot);
    } catch (error) {
      renameError = error instanceof Error ? error : new Error(String(error));
    }
    const rootAfterRename = await checkedExists(vaultTools, root, signal);
    const quarantineAfterRename = await checkedExists(vaultTools, quarantinedRoot, signal);
    if (renameError && rootAfterRename && !quarantineAfterRename) throw renameError;
    if (rootAfterRename || !quarantineAfterRename) {
      throw new Error(
        `force: atomic rename trust failure: root=${rootAfterRename} quarantine=${quarantineAfterRename}`,
      );
    }
    if (renameError) throw renameError;
    await requireDirectEntries(
      vaultTools,
      transaction,
      [],
      [quarantinedRoot],
      signal,
      "post-rename transaction",
    );

    snapshot = await inventoryDomainTree(
      vaultTools,
      quarantinedRoot,
      signal,
      snapshotByteLimit,
      fileByteLimit,
    );
    if (!snapshot.existed) {
      throw new Error("force: quarantined domain disappeared before inventory");
    }
    await requireOriginalRootAbsent(vaultTools, root, signal);

    for (const [path, bytes] of snapshot.files) {
      throwIfWipeAborted(signal);
      await requireOriginalRootAbsent(vaultTools, root, signal);
      if (
        !await checkedExists(vaultTools, path, signal)
        || !sameBytes(new Uint8Array(await checkedReadBinary(vaultTools, path, signal)), bytes)
      ) {
        throw new Error(`force: wipe target changed before removal: ${path}`);
      }

      try {
        await vaultTools.remove(path);
      } catch (error) {
        if (!await vaultTools.exists(path)) removed.add(path);
        throw error;
      }
      const pathRemains = await vaultTools.exists(path);
      if (!pathRemains) removed.add(path);
      throwIfWipeAborted(signal);
      if (pathRemains) {
        throw new Error(`force: removal did not remove ${path}`);
      }
      await requireOriginalRootAbsent(vaultTools, root, signal);
    }

    for (const folder of foldersDeepestFirst(snapshot.folders)) {
      await requireOriginalRootAbsent(vaultTools, root, signal);
      await requireEmptyDirectory(vaultTools, folder, signal, "quarantined folder");
      await vaultTools.rmdir(folder, false);
      throwIfWipeAborted(signal);
      if (await checkedExists(vaultTools, folder, signal)) {
        throw new Error(`force: non-recursive rmdir did not remove ${folder}`);
      }
    }

    await requireOriginalRootAbsent(vaultTools, root, signal);
    await removeKnownEmptyDirectory(vaultTools, transaction, signal, "transaction");
    await requireOriginalRootAbsent(vaultTools, root, signal);
  } catch (error) {
    try {
      await rollbackWipeTransaction(
        vaultTools,
        root,
        transaction,
        quarantinedRoot,
        rootRenameAttempted,
        snapshot,
        removed,
      );
    } catch (rollbackError) {
      throw new Error(
        `force: wipe failed (${(error as Error).message}); rollback failed — ${(rollbackError as Error).message}`,
      );
    }
    throw error;
  }
  const removedFileHashes: Record<string, string> = {};
  for (const [quarantinedPath, bytes] of snapshot.files) {
    const originalPath = originalPathFromQuarantine(
      quarantinedPath,
      quarantinedRoot,
      root,
    );
    removedFileHashes[originalPath.slice(root.length + 1)] = hashBytes(bytes);
  }
  const removedPaths = [
    ...Object.keys(removedFileHashes),
    ...snapshot.folders
      .filter((folder) => folder !== quarantinedRoot)
      .map((folder) => {
        const originalPath = originalPathFromQuarantine(
          folder,
          quarantinedRoot,
          root,
        );
        return `${originalPath.slice(root.length + 1)}/`;
      }),
  ].sort(compareCodePoints);
  return {
    removedPaths,
    removedFileHashes,
    manifestHash: contentHash(JSON.stringify({
      removedPaths,
      removedFileHashes,
    })),
  };
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const FORCE_WIPE_SNAPSHOT_BYTE_LIMIT = 128 * 1024 * 1024;
export const FORCE_WIPE_FILE_BYTE_LIMIT = 32 * 1024 * 1024;
// Retained snapshot plus one transient read used by compare/rollback.
export const FORCE_WIPE_PEAK_BYTE_LIMIT =
  FORCE_WIPE_SNAPSHOT_BYTE_LIMIT + FORCE_WIPE_FILE_BYTE_LIMIT;

export interface ForceWipeOptions {
  snapshotByteLimit?: number;
  fileByteLimit?: number;
}

interface DomainTreeSnapshot {
  root: string;
  existed: boolean;
  files: Map<string, Uint8Array>;
  folders: string[];
  byteLimit: number;
  fileByteLimit: number;
}

function requireTransactionalWipeAdapter(vaultTools: VaultTools): void {
  if (
    typeof vaultTools.adapter.readBinary !== "function"
    || typeof vaultTools.adapter.writeBinary !== "function"
    || typeof vaultTools.adapter.rename !== "function"
    || typeof vaultTools.adapter.stat !== "function"
    || typeof vaultTools.adapter.remove !== "function"
    || typeof vaultTools.adapter.rmdir !== "function"
  ) {
    throw new Error(
      "force: transactional wipe requires adapter stat, readBinary, writeBinary, remove, rmdir, and rename",
    );
  }
}

const activeDomainWipes = new Set<string>();
let transactionSequence = 0;

async function createWipeTransaction(
  vaultTools: VaultTools,
  signal?: AbortSignal,
): Promise<string> {
  const runToken = `${Date.now().toString(36)}-${(transactionSequence++).toString(36)}`;
  for (let attempt = 0; attempt < 64; attempt++) {
    throwIfWipeAborted(signal);
    const candidate = `${WIKI_ROOT}/.ai-wiki-reinit-txn-${runToken}-${attempt.toString(36)}`;
    if (await checkedExists(vaultTools, candidate, signal)) continue;
    let mkdirSucceeded = false;
    try {
      await vaultTools.mkdir(candidate);
      mkdirSucceeded = true;
    } catch {
      // A throwing mkdir never transfers ownership. It may be an EEXIST race,
      // including an empty foreign directory, so never inspect or remove it.
      continue;
    }
    try {
      if (!await checkedExists(vaultTools, candidate, signal)) {
        throw new Error(`force: transaction mkdir did not create ${candidate}`);
      }
      await requireEmptyDirectory(vaultTools, candidate, signal, "new transaction");
      return candidate;
    } catch (error) {
      try {
        if (mkdirSucceeded && await vaultTools.exists(candidate)) {
          const listed = await vaultTools.adapter.list(candidate);
          if (listed.files.length === 0 && listed.folders.length === 0) {
            await vaultTools.rmdir(candidate, false);
          }
        }
      } catch (cleanupError) {
        throw new Error(
          `force: transaction setup failed (${(error as Error).message}); cleanup failed — ${(cleanupError as Error).message}`,
        );
      }
      throw error;
    }
  }
  throw new Error("force: unable to allocate unique transaction path");
}

function throwIfWipeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("force: wipe cancelled");
}

async function checkedExists(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfWipeAborted(signal);
  const exists = await vaultTools.exists(path);
  throwIfWipeAborted(signal);
  return exists;
}

async function checkedReadBinary(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfWipeAborted(signal);
  const bytes = await vaultTools.readBinary(path);
  throwIfWipeAborted(signal);
  return bytes;
}

async function checkedList(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<{ files: string[]; folders: string[] }> {
  throwIfWipeAborted(signal);
  const listed = await vaultTools.adapter.list(path);
  throwIfWipeAborted(signal);
  return listed;
}

async function checkedStat(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
) {
  throwIfWipeAborted(signal);
  const stat = await vaultTools.stat(path);
  throwIfWipeAborted(signal);
  return stat;
}

async function requireOriginalRootAbsent(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
): Promise<void> {
  if (await checkedExists(vaultTools, root, signal)) {
    throw new Error(`force: original root unexpectedly exists during quarantine wipe: ${root}`);
  }
}

function originalPathFromQuarantine(path: string, quarantine: string, root: string): string {
  if (!path.startsWith(`${quarantine}/`)) {
    throw new Error(`force: untrusted quarantine result path ${path}`);
  }
  return `${root}${path.slice(quarantine.length)}`;
}

async function requireDirectEntries(
  vaultTools: VaultTools,
  path: string,
  expectedFiles: string[],
  expectedFolders: string[],
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  if (!await checkedExists(vaultTools, path, signal)) {
    throw new Error(`force: ${label} missing: ${path}`);
  }
  const listed = await checkedList(vaultTools, path, signal);
  const files = [...listed.files].sort(compareCodePoints);
  const folders = [...listed.folders].sort(compareCodePoints);
  if (
    !samePaths(files, [...expectedFiles].sort(compareCodePoints))
    || !samePaths(folders, [...expectedFolders].sort(compareCodePoints))
  ) {
    throw new Error(`force: ${label} is not empty or has unexpected children: ${path}`);
  }
}

async function requireEmptyDirectory(
  vaultTools: VaultTools,
  path: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  await requireDirectEntries(vaultTools, path, [], [], signal, label);
}

async function removeKnownEmptyDirectory(
  vaultTools: VaultTools,
  path: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  await requireEmptyDirectory(vaultTools, path, signal, label);
  await vaultTools.rmdir(path, false);
  throwIfWipeAborted(signal);
  if (await checkedExists(vaultTools, path, signal)) {
    throw new Error(`force: non-recursive rmdir did not remove ${label} ${path}`);
  }
}

function foldersDeepestFirst(folders: string[]): string[] {
  return [...folders].sort((left, right) =>
    right.split("/").length - left.split("/").length || compareCodePoints(left, right));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function forceDomainRoot(wikiFolder: string): string {
  if (
    typeof wikiFolder !== "string"
    || wikiFolder.length === 0
    || wikiFolder !== wikiFolder.trim()
    || wikiFolder === "."
    || wikiFolder === ".."
    || wikiFolder === WIKI_ROOT
    || wikiFolder.includes("/")
    || wikiFolder.includes("\\")
    || Array.from(wikiFolder).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`unsafe wikiFolder ${JSON.stringify(wikiFolder)}`);
  }
  const root = domainWikiFolder(wikiFolder);
  if (root !== `${WIKI_ROOT}/${wikiFolder}`) {
    throw new Error(`unsafe derived domain root ${JSON.stringify(root)}`);
  }
  return root;
}

function assertDirectDomainChild(root: string, parent: string, path: string): void {
  const parentPrefix = `${parent}/`;
  const child = path.startsWith(parentPrefix) ? path.slice(parentPrefix.length) : "";
  const segments = path.split("/");
  if (
    !path.startsWith(`${root}/`)
    || child.length === 0
    || child.includes("/")
    || path.includes("\\")
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`force: untrusted domain inventory path ${path}`);
  }
}

async function inventoryDomainTree(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
  snapshotByteLimit = FORCE_WIPE_SNAPSHOT_BYTE_LIMIT,
  fileByteLimit = FORCE_WIPE_FILE_BYTE_LIMIT,
): Promise<DomainTreeSnapshot> {
  const layout = await inventoryDomainLayout(
    vaultTools,
    root,
    signal,
    snapshotByteLimit,
    fileByteLimit,
  );
  if (!layout.existed) {
    return {
      root,
      existed: false,
      files: new Map(),
      folders: [],
      byteLimit: snapshotByteLimit,
      fileByteLimit,
    };
  }

  const files = new Map<string, Uint8Array>();
  let snapshotBytes = 0;
  for (const [path, expectedSize] of layout.files) {
    const buffer = await checkedReadBinary(vaultTools, path, signal);
    if (buffer.byteLength !== expectedSize) {
      throw new Error(`force: file size changed after stat: ${path}`);
    }
    snapshotBytes += buffer.byteLength;
    if (
      buffer.byteLength > fileByteLimit
      || !Number.isSafeInteger(snapshotBytes)
      || snapshotBytes > snapshotByteLimit
    ) {
      throw new Error(`force: snapshot byte limit exceeded after read: ${path}`);
    }
    // DataAdapter readBinary returns an owned ArrayBuffer. Keeping its view
    // avoids a second retained copy; later checks hold only one extra file.
    files.set(path, new Uint8Array(buffer));
    throwIfWipeAborted(signal);
  }
  return {
    root,
    existed: true,
    files,
    folders: layout.folders,
    byteLimit: snapshotByteLimit,
    fileByteLimit,
  };
}

interface DomainTreeLayout {
  existed: boolean;
  files: Map<string, number>;
  folders: string[];
}

async function inventoryDomainLayout(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
  snapshotByteLimit = FORCE_WIPE_SNAPSHOT_BYTE_LIMIT,
  fileByteLimit = FORCE_WIPE_FILE_BYTE_LIMIT,
): Promise<DomainTreeLayout> {
  if (!await checkedExists(vaultTools, root, signal)) {
    return { existed: false, files: new Map(), folders: [] };
  }

  const filePaths: string[] = [];
  const folders: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    throwIfWipeAborted(signal);
    folders.push(folder);
    const listed = await checkedList(vaultTools, folder, signal);
    const listedFiles = [...listed.files].sort(compareCodePoints);
    const listedFolders = [...listed.folders].sort(compareCodePoints);
    for (const path of listedFiles) {
      throwIfWipeAborted(signal);
      assertDirectDomainChild(root, folder, path);
      filePaths.push(path);
    }
    for (const path of listedFolders) {
      throwIfWipeAborted(signal);
      assertDirectDomainChild(root, folder, path);
      await visit(path);
      throwIfWipeAborted(signal);
    }
  };
  await visit(root);
  filePaths.sort(compareCodePoints);

  const files = new Map<string, number>();
  let totalBytes = 0;
  let maxFileBytes = 0;
  let maxFilePath = "";
  for (const path of filePaths) {
    throwIfWipeAborted(signal);
    const stat = await checkedStat(vaultTools, path, signal);
    if (
      stat === null
      || stat.type !== "file"
      || !Number.isSafeInteger(stat.size)
      || stat.size < 0
    ) {
      throw new Error(`force: invalid file stat size for ${path}`);
    }
    totalBytes += stat.size;
    if (stat.size > maxFileBytes) {
      maxFileBytes = stat.size;
      maxFilePath = path;
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes > snapshotByteLimit) {
      throw new Error(
        `force: snapshot byte limit exceeded (${totalBytes} > ${snapshotByteLimit})`,
      );
    }
    files.set(path, stat.size);
  }

  // Peak formula: retained snapshot <= snapshotByteLimit, and every later
  // comparison reads one file <= fileByteLimit, so peak <= their sum.
  if (maxFileBytes > fileByteLimit) {
    throw new Error(
      `force: per-file snapshot limit exceeded at ${maxFilePath} (${maxFileBytes} > ${fileByteLimit})`,
    );
  }
  return {
    existed: true,
    files,
    folders: folders.sort(compareCodePoints),
  };
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

async function restoreDomainTree(
  vaultTools: VaultTools,
  snapshot: DomainTreeSnapshot,
  removed: Set<string>,
): Promise<void> {
  const current = await inventoryDomainLayout(
    vaultTools,
    snapshot.root,
    undefined,
    snapshot.byteLimit,
    snapshot.fileByteLimit,
  );
  let firstTrustError: Error | undefined;
  for (const path of current.files.keys()) {
    const expected = snapshot.files.get(path);
    if (expected === undefined) {
      firstTrustError ??= new Error(`rollback trust failure at ${path}`);
      continue;
    }
    const buffer = await checkedReadBinary(vaultTools, path);
    if (
      buffer.byteLength > snapshot.fileByteLimit
      || !sameBytes(expected, new Uint8Array(buffer))
    ) {
      firstTrustError ??= new Error(`rollback trust failure at ${path}`);
    }
  }
  for (const folder of current.folders) {
    if (!snapshot.folders.includes(folder)) {
      firstTrustError ??= new Error(`rollback trust failure at unexpected folder ${folder}`);
    }
  }
  if (!snapshot.existed) {
    if (current.existed) throw new Error(`rollback trust failure: ${snapshot.root} unexpectedly exists`);
    return;
  }
  for (const folder of [...snapshot.folders].sort(
    (left, right) => left.split("/").length - right.split("/").length || compareCodePoints(left, right),
  )) {
    if (!await vaultTools.exists(folder)) await vaultTools.mkdir(folder);
  }
  for (const [path, bytes] of snapshot.files) {
    if (current.files.has(path)) continue;
    if (!removed.has(path) && current.existed) {
      firstTrustError ??= new Error(`rollback trust failure at missing unremoved file ${path}`);
      continue;
    }
    try {
      await vaultTools.writeBinary(path, bytes.buffer as ArrayBuffer);
    } catch (error) {
      firstTrustError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (firstTrustError) throw firstTrustError;
  await verifyDomainTree(vaultTools, snapshot);
}

async function verifyDomainTree(
  vaultTools: VaultTools,
  snapshot: DomainTreeSnapshot,
): Promise<void> {
  const restored = await inventoryDomainLayout(
    vaultTools,
    snapshot.root,
    undefined,
    snapshot.byteLimit,
    snapshot.fileByteLimit,
  );
  if (
    !restored.existed
    || !samePaths(restored.folders, snapshot.folders)
    || !samePaths([...restored.files.keys()], [...snapshot.files.keys()])
  ) {
    throw new Error("rollback verification failed: domain tree differs from snapshot");
  }
  for (const [path, expected] of snapshot.files) {
    const buffer = await checkedReadBinary(vaultTools, path);
    if (
      buffer.byteLength > snapshot.fileByteLimit
      || !sameBytes(expected, new Uint8Array(buffer))
    ) {
      throw new Error(`rollback verification failed: bytes differ at ${path}`);
    }
  }
}

function snapshotAtRecoveryPath(
  snapshot: DomainTreeSnapshot,
  recoveryRoot: string,
): DomainTreeSnapshot {
  const recoverPath = (path: string): string => path === snapshot.root
    ? recoveryRoot
    : `${recoveryRoot}${path.slice(snapshot.root.length)}`;
  return {
    ...snapshot,
    root: recoveryRoot,
    // Re-key paths while retaining the owned snapshot buffers. This adds no
    // second byte snapshot; verification still reads one file at a time.
    files: new Map([...snapshot.files].map(([path, bytes]) => [recoverPath(path), bytes])),
    folders: snapshot.folders.map(recoverPath),
  };
}

async function preserveSnapshotInRecovery(
  vaultTools: VaultTools,
  transaction: string,
  snapshot: DomainTreeSnapshot,
): Promise<string> {
  const recoveryRoot = `${transaction}/recovery`;
  if (await vaultTools.exists(recoveryRoot)) {
    throw new Error(`rollback trust failure: recovery path already exists at ${recoveryRoot}`);
  }

  if (!await vaultTools.exists(transaction)) {
    try {
      await vaultTools.mkdir(transaction);
    } catch (error) {
      throw new Error(
        `rollback recovery mkdir failed at ${recoveryRoot}: ${(error as Error).message}`,
      );
    }
    if (!await vaultTools.exists(transaction)) {
      throw new Error(`rollback recovery parent was not created for ${recoveryRoot}`);
    }
  }
  await requireEmptyDirectory(
    vaultTools,
    transaction,
    undefined,
    "rollback recovery transaction",
  );

  const recoverySnapshot = snapshotAtRecoveryPath(snapshot, recoveryRoot);
  await restoreDomainTree(
    vaultTools,
    recoverySnapshot,
    new Set(recoverySnapshot.files.keys()),
  );
  return recoveryRoot;
}

async function rollbackWipeTransaction(
  vaultTools: VaultTools,
  root: string,
  transaction: string,
  quarantinedRoot: string,
  rootRenameAttempted: boolean,
  snapshot: DomainTreeSnapshot | undefined,
  removed: Set<string>,
): Promise<void> {
  const rootExists = await vaultTools.exists(root);
  const quarantinedExists = await vaultTools.exists(quarantinedRoot);

  if (rootExists && !quarantinedExists && snapshot) {
    // A writer recreated the public root after the quarantined tree was
    // removed. Never merge with or overwrite that new data. Persist the old
    // snapshot in the operation-owned transaction namespace before reporting
    // the trust failure, even when final transaction teardown already ran.
    const recoveryRoot = await preserveSnapshotInRecovery(
      vaultTools,
      transaction,
      snapshot,
    );
    throw new Error(
      `rollback trust failure: original root unexpectedly exists; old snapshot preserved at recovery path ${recoveryRoot}`,
    );
  }
  if (!rootRenameAttempted || (rootExists && !quarantinedExists)) {
    if (await vaultTools.exists(transaction)) {
      const listed = await vaultTools.adapter.list(transaction);
      if (listed.files.length === 0 && listed.folders.length === 0) {
        await vaultTools.rmdir(transaction, false);
      }
    }
    return;
  }
  if (!quarantinedExists && snapshot && !rootExists) {
    await restoreDomainTree(vaultTools, snapshot, removed);
  } else if (!quarantinedExists) {
    throw new Error(`rollback trust failure: quarantined domain missing at ${quarantinedRoot}`);
  }

  if (snapshot) {
    await restoreDomainTree(vaultTools, snapshot, removed);
  }

  if (await vaultTools.exists(root)) {
    throw new Error(
      `rollback trust failure: original root unexpectedly exists; preserved with transaction ${transaction}`,
    );
  }
  if (!await vaultTools.exists(quarantinedRoot)) {
    throw new Error(`rollback trust failure: quarantined domain missing at ${quarantinedRoot}`);
  }

  await requireDirectEntries(
    vaultTools,
    transaction,
    [],
    [quarantinedRoot],
    undefined,
    "rollback transaction",
  );
  await vaultTools.rename(quarantinedRoot, root);
  const rootRestored = await vaultTools.exists(root);
  const quarantineRemoved = !await vaultTools.exists(quarantinedRoot);
  if (!rootRestored || !quarantineRemoved) {
    throw new Error(
      `rollback verification failed after quarantine rename: root=${rootRestored} quarantineAbsent=${quarantineRemoved}`,
    );
  }
  await removeKnownEmptyDirectory(vaultTools, transaction, undefined, "rollback transaction");
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const legacyIndex  = `${wikiRoot}/_index.md`;
  const legacyLog    = `${wikiRoot}/_log.md`;

  try { await vaultTools.mkdir(wikiRoot); } catch { /* already exists */ }
  // NB: do NOT create GLOBAL_CONFIG_DIR (!Wiki/_config) — it is a legacy artifact
  // (JSONL layout keeps config per-domain). Creating it here re-spawned the empty
  // dir that removeEmptyConfigDirs cleans on load. See storage-layout-sidecar-fix.

  try {
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем */ }
}
