import { App, Notice, Platform, TFile } from "obsidian";
import { AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { validateDomainId, type DomainEntry, type AddDomainInput } from "./domain";
import type LlmWikiPlugin from "./main";
import type {
  NativeTransportDiagnostic,
  OnFileError,
  RunEvent,
  RunHistoryEntry,
  WikiOperation,
} from "./types";
import { AgentRunner, resolveFollowUpPolicyOperation } from "./agent-runner";
import type { ChatMessage } from "./types";
import { VaultTools, type VaultAdapter } from "./vault-tools";
import { arrayBufferToBase64, stripImageDataUriPrefix } from "./phases/attachment-analyzer";
import { maskProxyUrl } from "./proxy";
import { mobileFetch } from "./mobile-fetch";
import { ModelContextStore, type ModelContextRecord } from "./model-context";
import { createNativeOpenAiClient, createNativeProbeFetch } from "./native-openai-client";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import { applyDomainEvent } from "./domain";
import type { DomainStore } from "./domain-store";
import { DomainCorruptError } from "./domain-store";
import type { LocalConfigStore } from "./local-config";
import type { LlmWikiPluginSettings } from "./types";
import { DeleteSourceModal, FileErrorModal, FormatVisionModal, InfoModal } from "./modals";
import { computeDeletionPlan, sourceStem } from "./source-deletion";
import { domainWikiFolder, domainIndexPath, domainLogPath } from "./wiki-path";
import { collectPageDescriptions, parseWikiIndexJsonl } from "./wiki-index-jsonl";
import { buildOkfBundle } from "./okf-export";
import { writeOkfBundle } from "./okf-export-fs";
import {
  assertBoundedWipeIdentifier,
  WIPE_LOG_LINE_MAX_BYTES,
} from "./wipe-proof";

const AGENT_LOG_LINE_MAX_BYTES = WIPE_LOG_LINE_MAX_BYTES;
const AGENT_LOG_REASONING_CHUNK_BYTES = 128 * 1024;
/** Maximum reasoning retained in agent.jsonl per operation. */
export const AGENT_LOG_REASONING_TOTAL_BYTES = 4 * 1024 * 1024;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function takeUtf8Prefix(value: string, maxBytes: number): {
  prefix: string;
  rest: string;
  prefixBytes: number;
} {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return {
    prefix: value.slice(0, end),
    rest: value.slice(end),
    prefixBytes: bytes,
  };
}

export function boundAgentLogField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    assertBoundedWipeIdentifier(value, "agent log envelope field");
    return value;
  } catch {
    return "[invalid]";
  }
}
import { restoreSourceFrontmatter } from "./utils/raw-frontmatter";
import { graphCache } from "./wiki-graph-cache";
import { collectMdInPaths, parseWikiSources } from "./utils/vault-walk";
import { computeChangedSources, hashSource, type SourceFileInfo } from "./incremental-sources";
import { updateEvalRating, readEvalRecord, updateEvalComment, type RatingAxis, type Rating } from "./eval-log";
import {
  persistDeleteStateCommitEvent,
} from "./phases/delete";
import { processDeleteStateCommitForDispatch } from "./delete-state-dispatch";
import { finalizeRunStatus, reduceRunStatus } from "./run-status";

/** Minimal surface of the host obsidian-excalidraw-plugin's ExcalidrawAutomate. */
interface ExcalidrawAutomateLike {
  reset(): void;
  createPNGBase64?(templatePath: string): Promise<string>;
  createPNG?(templatePath: string): Promise<Blob>;
}
interface ExcalidrawHostPlugin {
  ea?: ExcalidrawAutomateLike;
}


export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;
  private _pendingFormat: { originalPath: string; tempPath: string; chat: ChatMessage[] } | null = null;
  private _currentLogMeta: { backend: string; model: string; agentLogEnabled: boolean } | null = null;
  private _currentNativeTransportDiagnostic: NativeTransportDiagnostic | undefined;
  private _llmCallIndex = 0;
  private _reasoningBuf = "";
  private _reasoningBufBytes = 0;
  private _reasoningRetainedBytes = 0;
  private _reasoningOmittedBytes = 0;
  private _reasoningTruncationReported = false;
  constructor(
    private app: App,
    private plugin: LlmWikiPlugin,
    private domainStore: DomainStore,
    private localConfigStore: LocalConfigStore,
  ) {}

  /**
   * One store for the whole plugin session, so a window probed for one operation is
   * reused by the next. `fetchFn` is resolved per request rather than captured at
   * construction: the settings it depends on (proxy, connection timeout, base URL)
   * change while the plugin is loaded, and `plugin.settings` is not populated yet
   * when the controller is constructed.
   */
  private modelContextStore = new ModelContextStore({
    read: async () => (await this.localConfigStore.load()).modelContext ?? {},
    write: async (next) => { await this.localConfigStore.save({ modelContext: next }); },
    fetchFn: async (input, init) => (await this.probeFetch())(input, init),
  });

  /** Transport construction stays in the native factory; this only supplies the inputs. */
  private async probeFetch(): Promise<typeof fetch> {
    const s = resolveEffective(this.plugin.settings, await this.localConfigStore.load());
    return createNativeProbeFetch({
      baseURL: s.nativeAgent.baseUrl,
      isMobile: Platform.isMobile,
      proxyConfig: s.proxy,
      mobileFetch,
      connectionTimeoutMs: s.llmConnectionTimeoutSec * 1000,
    });
  }

  /**
   * Cached-only pass-through for the settings tab: reads whatever `ModelContextStore`
   * already has in memory for this (baseUrl, model) pair without probing or awaiting
   * anything. Settings rendering is synchronous, so an absent record here must render
   * as "automatic" rather than trigger a network probe.
   */
  cachedModelContext(baseUrl: string, model: string): ModelContextRecord | undefined {
    return this.modelContextStore.get(baseUrl, model);
  }

  isBusy(): boolean { return this.current !== null; }

  onBusyChange?: () => void;

  get running(): boolean { return this.current !== null; }

  cancelCurrent(): void {
    if (this.current) {
      this.current.abort();
      new Notice(i18n().ctrl.cancelling);
    }
  }

  async format(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(i18n().ctrl.noActiveFile); return; }
    if (file.extension !== "md") {
      new Notice(i18n().view.formatOnlyMarkdown ?? "Format only works on markdown files");
      return;
    }

    const domains = await this.loadDomains();
    const inWiki = domains.find((d) => {
      const wikiPrefix = domainWikiFolder(d.wiki_folder);
      return file.path === wikiPrefix || file.path.startsWith(wikiPrefix + "/");
    });
    if (inWiki) {
      const T = i18n().view;
      new InfoModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        T.formatInWikiClose,
      ).open();
      return;
    }

    this._pendingFormat = { originalPath: file.path, tempPath: "", chat: [] };

    if (this.plugin.settings.vision?.enabled) {
      new FormatVisionModal(this.app, (choice) => {
        const args = choice === "without" ? [file.path, "--no-vision"] : [file.path];
        void this.dispatch("format", args);
      }).open();
    } else {
      await this.dispatch("format", [file.path]);
    }
  }

  async formatApply(keepOld: boolean): Promise<void> {
    const p = this._pendingFormat;
    if (!p || !p.tempPath) {
      new Notice(i18n().view.formatNoPending ?? "No format preview to apply");
      return;
    }
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    const adapter = this.app.vault.adapter as VaultAdapter & { rename?(from: string, to: string): Promise<void> };
    try {
      if (keepOld) {
        const deprecatedPath = p.originalPath.replace(/\.md$/, ".deprecated.md");
        if (await adapter.exists(deprecatedPath)) {
          throw new Error(`${deprecatedPath} уже существует — удалите вручную или примените delete-old`);
        }
        const originalContent = await adapter.read(p.originalPath);
        const formattedContent = await adapter.read(p.tempPath);
        const patched = restoreSourceFrontmatter(originalContent, formattedContent);
        if (adapter.rename) {
          await adapter.write(p.tempPath, patched);
          await adapter.rename(p.originalPath, deprecatedPath);
          await adapter.rename(p.tempPath, p.originalPath);
        } else {
          // fallback: read+write+remove
          await adapter.write(deprecatedPath, originalContent);
          await adapter.write(p.originalPath, patched);
          await this.app.vault.adapter.remove(p.tempPath);
        }
      } else {
        const originalContent = await adapter.read(p.originalPath);
        const content = await adapter.read(p.tempPath);
        const patched = restoreSourceFrontmatter(originalContent, content);
        const origFile = this.app.vault.getAbstractFileByPath(p.originalPath);
        if (origFile instanceof TFile) {
          await this.app.vault.modify(origFile, patched);
        } else {
          await adapter.write(p.originalPath, patched);
        }
        await this.app.vault.adapter.remove(p.tempPath);
      }
      new Notice(i18n().view.formatApplied(p.originalPath));
      this.activeView()?.appendEvent({ kind: "format_applied", path: p.originalPath });
    } catch (e) {
      new Notice(i18n().ctrl.errorPrefix((e as Error).message));
    } finally {
      this._pendingFormat = null;
      this.onBusyChange?.();
    }
  }

  async formatCancel(): Promise<void> {
    const p = this._pendingFormat;
    if (!p || !p.tempPath) { this._pendingFormat = null; return; }
    try { await this.app.vault.adapter.remove(p.tempPath); } catch { /* orphan */ }
    this._pendingFormat = null;
    new Notice(i18n().view.formatCancelled);
    this.activeView()?.appendEvent({ kind: "format_cancelled" });
    this.onBusyChange?.();
  }

  async formatRefine(message: string): Promise<void> {
    const p = this._pendingFormat;
    if (!p) {
      new Notice(i18n().view.formatNoPending ?? "No format preview to refine");
      return;
    }
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    p.chat.push({ role: "user", content: message });
    await this.dispatch("format", [p.originalPath]);
  }

  async ingestActive(domainId?: string): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(i18n().ctrl.noActiveFile); return; }
    // Pass the vault-relative path (forward slashes), NOT adapter.getFullPath():
    // an OS-absolute Windows path ("D:\…") is not recognised as absolute by
    // path-browserify, so runIngest re-roots it under the vault and the adapter
    // doubles the prefix → ENOENT (issue #14). runIngest re-derives the absolute
    // path from vaultRoot itself.
    await this.dispatch("ingest", [file.path], domainId);
  }

  async query(question: string, domainId?: string): Promise<void> {
    if (!question.trim()) return;
    await this.dispatch("query", [question.trim()], domainId);
  }

  /** Set a 👍/👎 label on a finished run's eval.jsonl record (dev mode only). Returns the persisted rating, or undefined when off / not written. */
  async rateRun(runId: string, axis: RatingAxis, rating: "up" | "down"): Promise<Rating | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return updateEvalRating(this.app.vault.adapter, this.pluginDir(), runId, axis, rating);
  }

  /** Read a finished run's persisted ratings + comment from eval.jsonl (dev mode only). */
  async readRun(runId: string): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return readEvalRecord(this.app.vault.adapter, this.pluginDir(), runId);
  }

  /** Set a finished run's free-form comment in eval.jsonl (dev mode only). Returns the persisted comment. */
  async commentRun(runId: string, comment: string): Promise<string | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return updateEvalComment(this.app.vault.adapter, this.pluginDir(), runId, comment);
  }

  private pluginDir(): string {
    return this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
  }

  async lint(domain: string, opts: { useLlm?: boolean; entityTypeFilter?: string[] } = {}): Promise<void> {
    const args = domain === "all" ? [] : [domain];
    const lintOpts = { useLlm: opts.useLlm ?? true, entityTypeFilter: opts.entityTypeFilter ?? [] };
    await this.dispatch("lint", args, undefined, undefined, undefined, undefined, undefined, lintOpts);
  }

  async chat(operation: WikiOperation, domainId: string | undefined, context: string, history: ChatMessage[], newMessage: string): Promise<void> {
    const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
    await this.dispatchChat(operation, domainId, context, chatMessages);
  }

  async lintApplyFromChat(domainId: string | undefined, lintReport: string, history: ChatMessage[], newMessage: string): Promise<void> {
    const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
    await this.dispatch("lint-chat", [], domainId, lintReport, undefined, undefined, chatMessages);
  }

  private async dispatchChat(operation: WikiOperation, domainId: string | undefined, context: string, chatMessages: ChatMessage[]): Promise<void> {
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    if (Platform.isMobile && operation !== "query") {
      new Notice(i18n().ctrl.mobileNotAvailable);
      return;
    }
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (!this.requireNativeAgent(eff)) return;
      const opKey = resolveFollowUpPolicyOperation(operation);
      this._currentLogMeta = {
        backend: "openai-compatible",
        model: eff.nativeAgent.perOperation
          ? eff.nativeAgent.operations[opKey].model
          : eff.nativeAgent.model,
        agentLogEnabled: eff.agentLogEnabled,
      };
    }

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = this.cwdOrEmpty();
    const policyOperation = resolveFollowUpPolicyOperation(operation);

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot);
    } catch (e) {
      new Notice(i18n().ctrl.errorPrefix((e as Error).message));
      console.error("[ai-wiki] buildAgentRunner failed", e);
      return;
    }
    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
    let finalText = "";
    let status: "done" | "error" | "cancelled" = "done";
    this._llmCallIndex = 0;
    this._reasoningBuf = "";
    this._reasoningBufBytes = 0;
    this._reasoningRetainedBytes = 0;
    this._reasoningOmittedBytes = 0;
    this._reasoningTruncationReported = false;

    await this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
    });

    view.setChatRunning();

    const OPERATION_LABELS: Partial<Record<WikiOperation, string>> = {
      lint: "Wiki lint check",
      ingest: "Knowledge extraction (ingest)",
      query: "Query answer (query)",
    };
    const operationHeader = OPERATION_LABELS[operation] ?? operation;

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: vaultRoot,
      signal: ctrl.signal, timeoutMs, domainId, context, chatMessages,
      operationHeader, policyOperation, runId: sessionId,
    });

    try {
      for await (const ev of runGen) {
        await this.logEvent(vaultRoot, sessionId, "chat", domainId, ev);
        this.activeView()?.appendChatEvent(ev);
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "error") status = "error";
      }
    } catch (err) {
      status = "error";
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      await this.logEvent(vaultRoot, sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
    }

    await this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });
    this._currentLogMeta = null;

    this.activeView()?.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }

  async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean, incremental?: boolean): Promise<void> {
    const args: string[] = [domain];
    if (dryRun) args.push("--dry-run");
    if (force) args.push("--force");
    if (incremental) args.push("--incremental");
    if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
    const onFileError: OnFileError | undefined = (sourcePaths?.length || incremental)
      ? (file, err, canRetry) => {
          const modal = new FileErrorModal(this.app, file, err, canRetry);
          modal.open();
          return modal.result;
        }
      : undefined;
    await this.dispatch("init", args, undefined, undefined, undefined, onFileError);
  }


  cwdOrEmpty(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const base = adapter.getBasePath?.();
    if (base == null) {
      // Mobile: getBasePath отсутствует — vault-root недоступен. Используем "" как маркер.
      // Все callers должны проверять Platform.isMobile перед обращением к fs.
      if (!Platform.isMobile) {
        console.warn("[ai-wiki] vault.adapter.getBasePath is undefined on desktop");
      }
      return "";
    }
    return base;
  }

  /**
   * Serializes a domain's wiki pages into an OKF bundle at an absolute filesystem
   * path (desktop-only). Reads pages + the domain's `index.jsonl` descriptions and
   * `log.jsonl`, builds the bundle in memory, writes it out.
   */
  async exportOkf(domain: DomainEntry, destAbs: string): Promise<{ pages: number; warnings: string[] }> {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    const prefix = wikiFolder + "/";
    const pages: Array<{ relpath: string; content: string }> = [];
    for (const file of collectMdInPaths(this.app.vault, [wikiFolder])) {
      if (file.basename.startsWith("_")) continue;
      const content = await this.app.vault.adapter.read(file.path);
      const relpath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
      pages.push({ relpath, content });
    }
    let descriptions = new Map<string, string>();
    let log = "";
    try {
      const indexRaw = await this.app.vault.adapter.read(domainIndexPath(wikiFolder));
      descriptions = collectPageDescriptions(parseWikiIndexJsonl(indexRaw, domainIndexPath(wikiFolder)));
    } catch { /* no index */ }
    try { log = await this.app.vault.adapter.read(domainLogPath(wikiFolder)); } catch { /* no log */ }
    const bundle = buildOkfBundle(pages, descriptions, log);
    await writeOkfBundle(destAbs, bundle);
    return { pages: pages.length, warnings: bundle.warnings };
  }

  async loadDomains(): Promise<DomainEntry[]> {
    try {
      return await this.domainStore.load();
    } catch (e) {
      if (e instanceof DomainCorruptError) {
        new Notice(`Domain map corrupt: ${e.message}`);
      }
      throw e;
    }
  }

  /**
   * Compute the incremental re-init plan: which source files have changed since
   * their last ingest, detected by comparing body hashes stored in analyzed_sources.
   */
  async computeIncrementalPlan(
    domainId: string,
  ): Promise<{ changed: string[]; totalSources: number; wikiFileCount: number }> {
    const domains = await this.loadDomains();
    const entry = domains.find((d) => d.id === domainId);
    if (!entry) return { changed: [], totalSources: 0, wikiFileCount: 0 };

    const base = this.cwdOrEmpty();
    const toVaultRel = (p: string): string => {
      if (!base || !p.startsWith("/")) return p;
      return p.startsWith(base) ? p.slice(base.length).replace(/^\//, "") : p;
    };

    const sourceTFiles = collectMdInPaths(this.app.vault, (entry.source_paths ?? []).map(toVaultRel));
    const seen = new Set(sourceTFiles.map((f) => f.path));
    for (const sp of (entry.source_paths ?? []).map(toVaultRel)) {
      if (sp.endsWith(".md") && !seen.has(sp)) {
        const tf = this.app.vault.getFileByPath(sp);
        if (tf) { sourceTFiles.push(tf); seen.add(sp); }
      }
    }

    const analyzed = entry.analyzed_sources ?? {};
    const sourceFiles: SourceFileInfo[] = [];
    for (const f of sourceTFiles) {
      let content = "";
      try { content = await this.app.vault.adapter.read(f.path); } catch { /* unreadable → empty body hash */ }
      sourceFiles.push({ path: f.path, hash: hashSource(content) });
    }

    const wikiFileCount = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)])
      .filter((f) => !f.path.includes("/_config/")).length;

    const { changed, baselined } = computeChangedSources({ sourceFiles, analyzed });

    // Silent baseline: persist hashes for already-ingested sources that had none.
    if (Object.keys(baselined).length > 0) {
      const merged = { ...analyzed, ...baselined };
      const next = domains.map((d) => (d.id === domainId ? { ...d, analyzed_sources: merged } : d));
      await this.domainStore.save(next);
    }

    return { changed, totalSources: sourceFiles.length, wikiFileCount };
  }

  async registerDomain(input: AddDomainInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const id = input.id.trim();
    const err = validateDomainId(id);
    if (err) { new Notice(i18n().ctrl.domainAddFailed(err)); return { ok: false, error: err }; }
    const cur = await this.domainStore.load();
    if (cur.some((d) => d.id === id)) {
      const msg = `Домен «${id}» уже существует`;
      new Notice(i18n().ctrl.domainAddFailed(msg));
      return { ok: false, error: msg };
    }
    const wikiSubfolder = input.wikiFolder.trim() || id;
    const next: DomainEntry[] = [...cur, {
      id,
      name: input.name.trim() || id,
      wiki_folder: wikiSubfolder,
      source_paths: input.sourcePaths ?? [],
      entity_types: [],
      language_notes: "",
    }];
    try {
      await this.domainStore.save(next);
    } catch (e) {
      const msg = (e as Error).message;
      new Notice(i18n().ctrl.domainAddFailed(msg));
      return { ok: false, error: msg };
    }
    new Notice(i18n().ctrl.domainAdded(id));
    return { ok: true };
  }

  async updateDomainSources(domainId: string, sourcePaths: string[]): Promise<void> {
    const domains = await this.domainStore.load();
    const next = domains.map((d) => d.id === domainId ? { ...d, source_paths: sourcePaths } : d);
    await this.domainStore.save(next);
  }

  async cleanupRemovedSources(domainId: string, removedPaths: string[]): Promise<number> {
    const domains = await this.domainStore.load();
    const entry = domains.find((d) => d.id === domainId);
    if (!entry) return 0;

    const wikiFolder = domainWikiFolder(entry.wiki_folder);
    const files = collectMdInPaths(this.app.vault, [wikiFolder]);

    let deleted = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.adapter.read(file.path);
        const sources = parseWikiSources(content);
        if (sources.length > 0 && sources.every((s) => removedPaths.some((r) => s.includes(r) || r.includes(s)))) {
          await this.app.vault.adapter.remove(file.path);
          deleted++;
        }
      } catch (e) {
        console.error(`[ai-wiki] cleanupRemovedSources: error processing ${file.path}`, e);
      }
    }
    if (deleted > 0) graphCache.invalidate(domainId);
    return deleted;
  }

  async deleteSource(domainId: string, path: string): Promise<void> {
    const domains = await this.loadDomains();
    const entry = domains.find((d) => d.id === domainId);
    if (!entry) { new Notice(i18n().ctrl.noActiveFile); return; }

    const wikiFolder = domainWikiFolder(entry.wiki_folder);
    const pageFiles = collectMdInPaths(this.app.vault, [wikiFolder])
      .filter((f) => !f.path.includes("/_config/"));
    const pages = new Map<string, string>();
    for (const f of pageFiles) {
      try { pages.set(f.path, await this.app.vault.adapter.read(f.path)); } catch { /* skip */ }
    }

    const sourceStemToPath = new Map<string, string>();
    for (const f of collectMdInPaths(this.app.vault, entry.source_paths ?? [])) {
      if (f.path !== path) sourceStemToPath.set(sourceStem(f.path), f.path);
    }
    for (const sp of entry.source_paths ?? []) {
      if (sp.endsWith(".md") && sp !== path && this.app.vault.getFileByPath(sp)) {
        sourceStemToPath.set(sourceStem(sp), sp);
      }
    }

    const plan = computeDeletionPlan(path, pages, sourceStemToPath);

    new DeleteSourceModal(this.app, entry.id, path, plan, () => {
      void this.dispatch("delete", [path, domainId], domainId).then(() => {
        graphCache.invalidate(domainId);
      });
    }).open();
  }

  private requireNativeAgent(eff: LlmWikiPluginSettings): boolean {
    const na = eff.nativeAgent;
    if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
      new Notice(i18n().ctrl.configureCloudLlm);
      return false;
    }
    return true;
  }

  private async buildAgentRunner(vaultRoot: string): Promise<AgentRunner> {
    const rawAdapter = this.app.vault.adapter as unknown as VaultAdapter;
    const vault = this.app.vault;
    const adapter = Object.create(rawAdapter) as VaultAdapter;
    adapter.mkdir = async (path: string) => {
      try { await vault.createFolder(path); } catch { /* already exists — fine */ }
    };
    adapter.resolveLink = (linkpath: string, sourcePath: string): string | null => {
      return this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
    };
    adapter.renderExcalidrawPng = async (resolvedPath: string): Promise<string | null> => {
      // Desktop-only: host plugin renders via DOM/canvas, unavailable on mobile.
      if (Platform.isMobile) return null;
      try {
        const host = (this.app as unknown as {
          plugins?: { plugins?: Record<string, ExcalidrawHostPlugin | undefined> };
        }).plugins?.plugins?.["obsidian-excalidraw-plugin"];
        const ea = host?.ea;
        if (!ea) return null;
        ea.reset();  // isolate from any prior template state
        if (ea.createPNGBase64) {
          return stripImageDataUriPrefix(await ea.createPNGBase64(resolvedPath));
        }
        if (ea.createPNG) {
          const blob = await ea.createPNG(resolvedPath);
          return arrayBufferToBase64(await blob.arrayBuffer());
        }
        return null;
      } catch {
        return null;  // any render error → Vision skipped
      }
    };
    const base = this.cwdOrEmpty();
    const vaultTools = new VaultTools(adapter, base, vault);
    const vaultName = this.app.vault.getName();
    const domains = await this.domainStore.load();
    const local = await this.localConfigStore.load();
    const s = resolveEffective(this.plugin.settings, local);

    if (s.proxy.enabled && Platform.isMobile) {
      new Notice(i18n().settings.proxy_mobile_warning);
    }

    const llm = createNativeOpenAiClient({
      baseURL: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      connectionTimeoutMs: s.llmConnectionTimeoutSec * 1000,
      idleTimeoutMs: s.llmIdleTimeoutSec * 1000,
      nativeTransportDiagnosticMode: s.devMode.enabled
        ? s.devMode.nativeTransportDiagnosticMode
        : "off",
      isMobile: Platform.isMobile,
      proxyConfig: s.proxy,
      mobileFetch,
      onProxySelected: (config) => {
        console.debug(`[ai-wiki] using proxy ${maskProxyUrl(config.url)}`);
      },
      onProxyError: (error) => {
        new Notice(i18n().settings.proxy_invalid((error as Error).message));
      },
    });

    this._currentNativeTransportDiagnostic = llm.nativeTransportDiagnostic;
    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`, Platform.isMobile, this.modelContextStore);
  }

  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (ev.kind === "run_config" && this._currentNativeTransportDiagnostic) {
      ev.nativeTransport = this._currentNativeTransportDiagnostic;
    }
    if (!(this._currentLogMeta?.agentLogEnabled ?? this.plugin.settings.agentLogEnabled)) return;

    const adapter = this.app.vault.adapter;
    // Agent log lives in the plugin dir (NOT the synced wiki tree). The pluginDir
    // always exists (the plugin loads from it), so no folder creation is needed.
    const path = `${this.pluginDir()}/agent.jsonl`;
    const appendLine = async (line: string): Promise<void> => {
      try {
        if (await adapter.exists(path)) await adapter.append(path, line);
        else await adapter.write(path, line);
      } catch { /* не блокируем операцию */ }
    };
    const envelope = {
      session: sessionId, op, domainId,
      backend: boundAgentLogField(this._currentLogMeta?.backend),
      model: boundAgentLogField(this._currentLogMeta?.model),
    };
    const appendRecord = async (
      event: Record<string, unknown> | RunEvent,
      extra: Record<string, unknown> = {},
    ): Promise<void> => {
      const record = {
        ts: new Date().toISOString(),
        ...envelope,
        event,
        ...extra,
      };
      const line = JSON.stringify(record) + "\n";
      const encodedByteLength = new TextEncoder().encode(line).length;
      if (encodedByteLength <= AGENT_LOG_LINE_MAX_BYTES) {
        await appendLine(line);
        return;
      }
      const omitted = JSON.stringify({
        ts: new Date().toISOString(),
        ...envelope,
        event: {
          kind: "log_record_omitted",
          eventKind: typeof event.kind === "string" ? event.kind : "unknown",
          byteCount: encodedByteLength,
          reason: "agent_log_line_limit",
        },
        ...extra,
      }) + "\n";
      await appendLine(omitted);
    };

    // Reasoning stays bounded in memory and on disk. Full chunks are detached before
    // writes; a failed adapter call therefore cannot replay the same buffered text.
    if (ev.kind === "assistant_text") {
      if (!ev.isReasoning) return;
      const deltaBytes = utf8ByteLength(ev.delta);
      const remaining = Math.max(
        0,
        AGENT_LOG_REASONING_TOTAL_BYTES - this._reasoningRetainedBytes,
      );
      const retained = deltaBytes <= remaining
        ? { prefix: ev.delta, rest: "", prefixBytes: deltaBytes }
        : takeUtf8Prefix(ev.delta, remaining);
      this._reasoningRetainedBytes += retained.prefixBytes;
      this._reasoningBuf += retained.prefix;
      this._reasoningBufBytes += retained.prefixBytes;
      if (!this._reasoningTruncationReported) {
        this._reasoningOmittedBytes += deltaBytes - retained.prefixBytes;
      }
      const chunks: string[] = [];
      while (this._reasoningBufBytes >= AGENT_LOG_REASONING_CHUNK_BYTES) {
        const chunk = takeUtf8Prefix(
          this._reasoningBuf,
          AGENT_LOG_REASONING_CHUNK_BYTES,
        );
        chunks.push(chunk.prefix);
        this._reasoningBuf = chunk.rest;
        this._reasoningBufBytes -= chunk.prefixBytes;
      }
      for (const chunk of chunks) {
        await appendRecord(
          { kind: "assistant_text", delta: chunk, isReasoning: true },
          { callIndex: this._llmCallIndex },
        );
      }
      return;
    }

    const reasoning = this._reasoningBuf;
    const omittedReasoningBytes = this._reasoningOmittedBytes;
    this._reasoningBuf = "";
    this._reasoningBufBytes = 0;
    this._reasoningOmittedBytes = 0;
    const reportTruncation =
      omittedReasoningBytes > 0 && !this._reasoningTruncationReported;
    if (reportTruncation) this._reasoningTruncationReported = true;

    if (reasoning) {
      await appendRecord(
        { kind: "assistant_text", delta: reasoning, isReasoning: true },
        { callIndex: this._llmCallIndex },
      );
    }
    if (reportTruncation) {
      await appendRecord({
        kind: "reasoning_omitted",
        truncated: true,
        omittedByteCount: omittedReasoningBytes,
        retainedByteLimit: AGENT_LOG_REASONING_TOTAL_BYTES,
      });
    }

    const extra = ev.kind === "llm_call_stats" ? { callIndex: this._llmCallIndex++ } : {};
    await appendRecord(ev, extra);
  }

  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError, chatMessages?: ChatMessage[], lintOpts?: { useLlm: boolean; entityTypeFilter: string[] }): Promise<void> {
    if (this.isBusy()) {
      new Notice(i18n().ctrl.operationRunning);
      return;
    }

    if (Platform.isMobile && op !== "query" && op !== "format" && op !== "delete") {
      new Notice(i18n().ctrl.mobileNotAvailable);
      return;
    }
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (!this.requireNativeAgent(eff)) return;
      const opKey = (op === "lint-chat" ? "lint" : op) as import("./types").OpKey;
      this._currentLogMeta = {
        backend: "openai-compatible",
        model: eff.nativeAgent.perOperation
          ? eff.nativeAgent.operations[opKey].model
          : eff.nativeAgent.model,
        agentLogEnabled: eff.agentLogEnabled,
      };
    }

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = this.cwdOrEmpty();
    const opKey = op === "lint-chat" ? "lint" : op;
    const opTimeoutSec = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts];

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot);
    } catch (e) {
      new Notice(i18n().ctrl.errorPrefix((e as Error).message));
      console.error("[ai-wiki] buildAgentRunner failed", e);
      return;
    }

    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();
    this.currentOp = { op, args };

    const startedAt = Date.now();
    this._llmCallIndex = 0;
    this._reasoningBuf = "";
    this._reasoningBufBytes = 0;
    this._reasoningRetainedBytes = 0;
    this._reasoningOmittedBytes = 0;
    this._reasoningTruncationReported = false;
    const sessionId = String(startedAt);
    const steps: RunHistoryEntry["steps"] = [];
    let finalText = "";
    let status: RunHistoryEntry["status"] = "done";
    let observedSuccessfulMutation = false;

    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
    view.setRunning(op, args);
    const timeoutMs = opTimeoutSec * 1000;
    let timedOut = false;
    const timeoutId = timeoutMs > 0
      ? window.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs)
      : null;
    const resolvedChatMessages = op === "format" ? this._pendingFormat?.chat : chatMessages;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages, lintOpts, runId: sessionId });

    try {
      for await (const ev of runGen) {
        if (ev.kind === "delete_state_commit") {
          const publication = await processDeleteStateCommitForDispatch(ev, {
            persist: async () => {
              const stateVaultTools = new VaultTools(
                this.app.vault.adapter,
                vaultRoot,
                this.app.vault,
              );
              return persistDeleteStateCommitEvent(
                this.domainStore,
                stateVaultTools,
                ev,
                vaultRoot,
              );
            },
            log: async (event) => this.logEvent(
              vaultRoot,
              sessionId,
              op,
              domainId,
              event,
            ),
            append: (event) => this.activeView()?.appendEvent(event),
          });
          if (!publication.ok) {
            finalText = publication.error.message;
            status = "error";
            this.collectStep(publication.error, steps);
            ctrl.abort();
            break;
          }
          observedSuccessfulMutation = true;
        } else {
          await this.logEvent(vaultRoot, sessionId, op, domainId, ev);
          this.activeView()?.appendEvent(ev);
        }
        if (ev.kind === "domain_created" || ev.kind === "domain_updated" || ev.kind === "source_path_added" || ev.kind === "source_path_removed") {
          try {
            const cur = await this.domainStore.load();
            const next = applyDomainEvent(cur, ev, { vaultRoot });
            if (next !== cur) {
              await this.domainStore.save(next);
              observedSuccessfulMutation = true;
            }
          } catch (e) {
            if (e instanceof DomainCorruptError) {
              new Notice(`Domain map corrupt: ${e.message}`);
            }
            status = "error";
            ctrl.abort();
            break;
          }
        }
        if (ev.kind === "format_preview" && this._pendingFormat) {
          this._pendingFormat.tempPath = ev.tempPath;
          this._pendingFormat.chat.push({ role: "assistant", content: ev.report });
        }
        this.collectStep(ev, steps);
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "file_outcome" && ev.status === "done") {
          observedSuccessfulMutation = true;
        }
        status = reduceRunStatus(status, ev);
      }
    } catch (err) {
      status = "error";
      if (!timedOut) {
        console.error("[ai-wiki] dispatch failed", err);
        finalText = i18n().ctrl.errorPrefix((err as Error).message);
        await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
      this._currentLogMeta = null;
    }
    status = finalizeRunStatus(status, {
      aborted: ctrl.signal.aborted,
      timedOut,
    });
    if (timedOut) {
      finalText = `Timeout after ${Math.round(timeoutMs / 1000)}s — check LLM backend URL`;
      this.activeView()?.appendEvent({ kind: "error", message: finalText });
      await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
    }
    const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "init";
    if (mutatesWiki && (status === "done" || observedSuccessfulMutation)) {
      try {
        const targets = domainId ? [domainId] : (await this.domainStore.load()).map((d) => d.id);
        for (const id of targets) graphCache.invalidate(id);
      } catch (error) {
        console.error("[ai-wiki] graph cache invalidation failed", error);
      }
    }
    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `finish status=${status} durationMs=${Date.now() - startedAt}` });

    const entry: RunHistoryEntry = {
      id: `${startedAt}`,
      operation: op,
      args,
      domainId,
      startedAt,
      finishedAt: Date.now(),
      status,
      finalText,
      steps,
    };
    this.plugin.settings.history.push(entry);
    while (this.plugin.settings.history.length > this.plugin.settings.historyLimit) {
      this.plugin.settings.history.shift();
    }
    await this.plugin.saveSettings();
    await this.activeView()?.finish(entry);

  }

  private collectStep(ev: RunEvent, steps: RunHistoryEntry["steps"]): void {
    if (ev.kind === "tool_use") {
      const inp = (ev.input as { file_path?: string; pattern?: string }) ?? {};
      steps.push({ kind: "tool_use", label: `${ev.name} ${inp.file_path ?? inp.pattern ?? ""}`.trim() });
    } else if (ev.kind === "tool_result") {
      steps.push({ kind: "tool_result", label: ev.ok ? "ok" : "error" });
    }
  }

  private async ensureView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(AI_WIKI_VIEW_TYPE);
    if (leaves.length === 0) {
      const right = this.app.workspace.getRightLeaf(false);
      if (right) await right.setViewState({ type: AI_WIKI_VIEW_TYPE, active: true });
    } else {
      void this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  private activeView(): LlmWikiView | null {
    const leaves = this.app.workspace.getLeavesOfType(AI_WIKI_VIEW_TYPE);
    const view = leaves[0]?.view;
    return view instanceof LlmWikiView ? view : null;
  }
}
