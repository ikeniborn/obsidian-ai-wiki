import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, OnFileError } from "../types";
import { VaultTools } from "../vault-tools";
import { parseWithRetry } from "./parse-with-retry";
import { DomainEntrySchema, EntityTypesDeltaSchema } from "./zod-schemas";
import schemaTemplate from "../../templates/_wiki_schema.md";
import initTemplate from "../../prompts/init.md";
import initIncrementalTemplate from "../../prompts/init-incremental.md";
import { render } from "./template";
import { runIngest } from "./ingest";
import { domainWikiFolder } from "../wiki-path";

export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
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

    yield { kind: "assistant_text", delta: `Re-init: wiping ${domainWikiFolder(existing.wiki_folder)}...\n` };
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: existing.wiki_folder } };
    const wiped = await wipeDomainFolder(vaultTools, existing.wiki_folder);
    yield { kind: "tool_result", ok: true };
    yield { kind: "assistant_text", delta: `removed ${wiped.length} files\n` };

    yield {
      kind: "domain_updated", domainId,
      patch: { entity_types: [], analyzed_sources: [], language_notes: "" },
    };

    if (signal.aborted) return;

    existing.entity_types = [];
    existing.analyzed_sources = [];
    existing.language_notes = "";

    yield* runInitWithSources(
      domainId, effectiveSources, false, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, true,
    );
    return;
  }

  if (sourcePaths.length) {
    yield* runInitWithSources(
      domainId, sourcePaths, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError,
    );
    return;
  }

  if (existing?.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }

  yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...\n` };

  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const start = Date.now();
  let outputTokens = 0;

  const allFiles = await vaultTools.listFiles("");
  const sampleFiles = allFiles.slice(0, 5);
  const samples = await vaultTools.readAll(sampleFiles);
  const existingDomain = domains.find((d) => d.id === domainId);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    existingDomain
      ? tryRead(vaultTools, `${domainWikiFolder(existingDomain.wiki_folder)}/_index.md`)
      : Promise.resolve(""),
  ]);

  const systemContent = render(initTemplate, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent}` : "",
    index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent}` : "",
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain ID: ${domainId}`,
        `Vault name: ${vaultName}`,
        "",
        `Примеры файлов vault:`,
        [...samples.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n"),
      ].join("\n"),
    },
  ];

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
    if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
  } catch (e) {
    for (const ev of collected) yield ev;
    if ((e as Error).name === "AbortError" || signal.aborted) return;
    yield { kind: "error", message: `Failed to parse domain entry: ${(e as Error).message}` };
    return;
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
    } as DomainEntry;
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
    if (entry.wiki_folder?.startsWith("!Wiki/")) {
      entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
    }
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to build domain entry: ${(e as Error).message}` };
    return;
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

  yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: entry.id } };
  if (existing) {
    yield { kind: "domain_updated", domainId: entry.id, patch: { entity_types: entry.entity_types, language_notes: entry.language_notes } };
  } else {
    yield { kind: "domain_created", entry };
  }
  yield { kind: "tool_result", ok: true };

  await appendLog(vaultTools, domainWikiFolder(entry.wiki_folder), domainId);

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised. Edit entity_types in plugin settings to refine extraction.`,
    outputTokens: outputTokens || undefined,
  };
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
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let outputTokens = 0;
  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const sourceFileLists = await Promise.all(sourcePaths.map((sp) => vaultTools.listFiles(sp)));
  const sourceFiles = [...new Set(sourceFileLists.flat())].filter((f) => f.endsWith(".md"));

  if (!sourceFiles.length) {
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }

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

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
  ]);

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

    yield { kind: "assistant_text", delta: `ℹ ${file}: ${fileContent.length} chars\n` };

    // --- Step 1: Analyze ---
    if (i === 0 && !isResuming) {
      // Bootstrap
      const systemContent = render(initTemplate, {
        domain_id: domainId,
        vault_name: vaultName,
        schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent}` : "",
        index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent}` : "",
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        { role: "user", content: `Domain ID: ${domainId}\nVault name: ${vaultName}\nSource paths: ${sourcePaths.join(", ")}\n\n${file}:\n${fileContent}` },
      ];

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
        if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
      } catch (e) {
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
        } as DomainEntry;
        const vaultPrefix = `vaults/${vaultName}/`;
        if (entry.wiki_folder?.startsWith(vaultPrefix)) entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
        if (entry.wiki_folder?.startsWith("!Wiki/")) entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
        if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
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
      // Incremental: delta entity_types
      const currentEntityTypes = currentDomain?.entity_types ?? [];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: initIncrementalTemplate },
        { role: "user", content: `Текущие entity_types:\n${JSON.stringify(currentEntityTypes, null, 2)}\n\nФайл: ${file}\n\n${fileContent}` },
      ];

      const collected: RunEvent[] = [];
      let parsed: { entity_types?: EntityType[]; language_notes?: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: EntityTypesDeltaSchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.delta",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
      } catch (e) {
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем (${(e as Error).message})\n` };
        yield { kind: "file_done", file };
        continue;
      }
      for (const ev of collected) yield ev;

      if (signal.aborted) return;

      const delta = { entity_types: parsed.entity_types, language_notes: parsed.language_notes };

      if (!currentDomain) {
        yield { kind: "file_done", file };
        continue;
      }

      const mergedTypes = mergeEntityTypes(currentDomain.entity_types ?? [], delta.entity_types ?? []);
      currentDomain = {
        ...currentDomain,
        entity_types: mergedTypes,
        language_notes: delta.language_notes ?? currentDomain.language_notes,
        analyzed_sources_v2: true,
      };

      yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
      yield {
        kind: "domain_updated", domainId,
        patch: {
          entity_types: currentDomain.entity_types,
          language_notes: currentDomain.language_notes,
        },
      };
      yield { kind: "tool_result", ok: true };
    }

    if (signal.aborted) return;
    if (!currentDomain) {
      yield { kind: "file_done", file };
      continue;
    }

    // --- Step 2: Ingest (immediate write) ---
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts)) {
          yield ev;
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

    if (signal.aborted) return;

    // --- Mark file complete: update analyzed_sources ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: [...(currentDomain.analyzed_sources ?? []), file],
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield {
      kind: "domain_updated", domainId,
      patch: { analyzed_sources: currentDomain.analyzed_sources },
    };
    yield { kind: "tool_result", ok: true };

    yield { kind: "file_done", file };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  await appendLog(vaultTools, wikiRootGuess, domainId);

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
  return files;
}

async function appendLog(vaultTools: VaultTools, wikiRoot: string, domainId: string): Promise<void> {
  const logPath = `${wikiRoot}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — init — ${domainId}\n- Домен создан\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* не критично */ }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_wiki_schema.md`;
  const legacyIndex = `${wikiRoot}/_index.md`;
  const legacyLog   = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем init */ }
}
