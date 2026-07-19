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
  createPromptBudgetEvent,
  estimatePreparedMessages,
  PromptBudgetExceededError,
} from "../prompt-budget";
import { prepareChatMessages } from "./llm-utils";
import { RunEventBridge } from "../run-event-bridge";

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
  yield createPromptBudgetEvent({
    callSite: "init.bootstrap",
    configuredInputBudget: inputBudgetTokens,
    effectiveInputBudget: inputBudgetTokens,
    estimatedInputTokens,
    outputBudget: outputBudgetTokens,
    compressionProfile,
    contextUnits: bootstrapEvidence.candidates.length
      + bootstrapEvidence.domainThemes.length
      + bootstrapEvidence.languageEvidence.length,
  });
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
    for await (const event of runStructuredStreaming({
      llm,
      model,
      baseMessages: messages,
      opts,
      profile: { kind: "json-zod", schema: DomainEntrySchema },
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "init.bootstrap",
      lifecycle: createLlmLifecycle("bootstrap_domain"),
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
    let wiped: string[];
    try {
      wiped = await wipeDomainFolder(vaultTools, existing.wiki_folder, signal);
    } catch (error) {
      yield { kind: "tool_result", ok: false, preview: (error as Error).message };
      yield { kind: "error", message: `force: wipe failed — ${(error as Error).message}` };
      return;
    }
    yield { kind: "tool_result", ok: true };
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.removedFiles(wiped.length) };

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

export async function wipeDomainFolder(
  vaultTools: VaultTools,
  wikiFolder: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const root = forceDomainRoot(wikiFolder);
  const snapshot = await inventoryDomainTree(vaultTools, root);
  const removed = new Set<string>();
  try {
    for (const [path, bytes] of snapshot.files) {
      if (signal?.aborted) throw new Error("force: wipe cancelled");
      if (!await vaultTools.exists(path) || await vaultTools.read(path) !== bytes) {
        throw new Error(`force: wipe target changed before removal: ${path}`);
      }
      try {
        await vaultTools.remove(path);
      } catch (error) {
        if (!await vaultTools.exists(path)) removed.add(path);
        throw error;
      }
      if (await vaultTools.exists(path)) {
        throw new Error(`force: removal did not remove ${path}`);
      }
      removed.add(path);
      if (signal?.aborted) throw new Error("force: wipe cancelled");
    }
    if (signal?.aborted) throw new Error("force: wipe cancelled");
    const emptied = await inventoryDomainTree(vaultTools, root);
    if (emptied.files.size > 0 || !samePaths(emptied.folders, snapshot.folders)) {
      throw new Error("force: final inventory changed before recursive removal");
    }
    await vaultTools.rmdir(root, true);
    if (await vaultTools.exists(root)) {
      throw new Error(`force: recursive rmdir did not remove ${root}; target still exists`);
    }
    if (signal?.aborted) throw new Error("force: wipe cancelled");
  } catch (error) {
    try {
      await restoreDomainTree(vaultTools, snapshot, removed);
    } catch (rollbackError) {
      throw new Error(
        `force: wipe failed (${(error as Error).message}); rollback failed — ${(rollbackError as Error).message}`,
      );
    }
    throw error;
  }
  return [...snapshot.files.keys()];
}

interface DomainTreeSnapshot {
  root: string;
  existed: boolean;
  files: Map<string, string>;
  folders: string[];
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
): Promise<DomainTreeSnapshot> {
  if (!await vaultTools.exists(root)) {
    return { root, existed: false, files: new Map(), folders: [] };
  }
  const files = new Map<string, string>();
  const folders: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    folders.push(folder);
    const listed = await vaultTools.adapter.list(folder);
    const listedFiles = [...listed.files].sort(compareCodePoints);
    const listedFolders = [...listed.folders].sort(compareCodePoints);
    for (const path of listedFiles) {
      assertDirectDomainChild(root, folder, path);
      files.set(path, await vaultTools.read(path));
    }
    for (const path of listedFolders) {
      assertDirectDomainChild(root, folder, path);
      await visit(path);
    }
  };
  await visit(root);
  return {
    root,
    existed: true,
    files: new Map([...files].sort(([left], [right]) => compareCodePoints(left, right))),
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
  const current = await inventoryDomainTree(vaultTools, snapshot.root);
  let firstTrustError: Error | undefined;
  for (const [path, bytes] of current.files) {
    const expected = snapshot.files.get(path);
    if (expected === undefined || expected !== bytes) {
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
    const currentBytes = current.files.get(path);
    if (currentBytes !== undefined) continue;
    if (!removed.has(path) && current.existed) {
      firstTrustError ??= new Error(`rollback trust failure at missing unremoved file ${path}`);
      continue;
    }
    try {
      await vaultTools.write(path, bytes);
    } catch (error) {
      firstTrustError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  const restored = await inventoryDomainTree(vaultTools, snapshot.root);
  if (firstTrustError) throw firstTrustError;
  if (!samePaths(restored.folders, snapshot.folders)
    || restored.files.size !== snapshot.files.size
    || [...snapshot.files].some(([path, bytes]) => restored.files.get(path) !== bytes)) {
    throw new Error("rollback verification failed: domain tree differs from snapshot");
  }
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
