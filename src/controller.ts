import { App, Notice, Platform, TFile } from "obsidian";
import { join } from "path-browserify";
import { AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { validateDomainId, type DomainEntry, type AddDomainInput } from "./domain";
import type LlmWikiPlugin from "./main";
import type { RunEvent, RunHistoryEntry, WikiOperation, OnFileError } from "./types";
import { AgentRunner } from "./agent-runner";
import type { ChatMessage } from "./types";
import { VaultTools, type VaultAdapter } from "./vault-tools";
import { arrayBufferToBase64, stripImageDataUriPrefix } from "./phases/attachment-analyzer";
import { ClaudeCliClient } from "./claude-cli-client";
import OpenAI from "openai";
import { createProxyFetch, parseNoProxy, shouldBypass, maskProxyUrl } from "./proxy";
import { mobileFetch } from "./mobile-fetch";
import { wrapMobileNoStream } from "./mobile-llm-wrap";
import { i18n } from "./i18n";
import { resolveEffective } from "./effective-settings";
import { applyDomainEvent } from "./domain";
import type { DomainStore } from "./domain-store";
import { DomainCorruptError } from "./domain-store";
import type { LocalConfig, LocalConfigStore } from "./local-config";
import type { LlmWikiPluginSettings } from "./types";
import { DeleteSourceModal, FileErrorModal, FormatVisionModal, InfoModal, ShellConsentModal } from "./modals";
import { computeDeletionPlan, sourceStem } from "./source-deletion";
import { domainWikiFolder, domainIndexPath, domainLogPath } from "./wiki-path";
import { parseIndexAnnotations } from "./wiki-index";
import { buildOkfBundle } from "./okf-export";
import { writeOkfBundle } from "./okf-export-fs";
import { restoreSourceFrontmatter } from "./utils/raw-frontmatter";
import { graphCache } from "./wiki-graph-cache";
import { collectMdInPaths, parseWikiSources } from "./utils/vault-walk";
import { computeChangedSources, hashSource, type SourceFileInfo } from "./incremental-sources";
import { updateEvalRating, readEvalRecord, updateEvalComment, type RatingAxis, type Rating } from "./eval-log";

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
  private _chatSessionId: string | undefined;
  private _currentClaudeClient: ClaudeCliClient | null = null;
  private _pendingFormat: { originalPath: string; tempPath: string; chat: ChatMessage[] } | null = null;
  private _currentLogMeta: { backend: string; model: string; agentLogEnabled: boolean } | null = null;
  private _llmCallIndex = 0;
  private _reasoningBuf = "";
  constructor(
    private app: App,
    private plugin: LlmWikiPlugin,
    private domainStore: DomainStore,
    private localConfigStore: LocalConfigStore,
  ) {}

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
      if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
      if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
      if (eff.backend === "claude-agent" && !local.shellConsentGiven) {
        new ShellConsentModal(this.app, local.iclaudePath ?? "", async () => {
          await this.localConfigStore.save({ shellConsentGiven: true });
        }).open();
        return;
      }
    }

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = this.cwdOrEmpty();

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId, "chat", this.plugin.settings.timeouts.lint);
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
      signal: ctrl.signal, timeoutMs, domainId, context, chatMessages, operationHeader, runId: sessionId,
    });

    try {
      for await (const ev of runGen) {
        await this.logEvent(vaultRoot, sessionId, "chat", domainId, ev);
        this.activeView()?.appendChatEvent(ev);
        // Обновляем session_id при каждом init-событии (первый тур — получаем ID,
        // последующие — подтверждаем что сессия жива или получаем новый ID при форке).
        if (ev.kind === "system" && ev.sessionId) {
          this._chatSessionId = ev.sessionId;
        }
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "error") { status = "error"; this._chatSessionId = undefined; }
      }
    } catch (err) {
      status = "error";
      // Сессия может быть невалидна (expired, --resume failed) — сбросить для следующего тура.
      this._chatSessionId = undefined;
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      await this.logEvent(vaultRoot, sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
    }

    // Capture session_id from claude-cli client after turn completes.
    // _generate populates lastSessionId when it reads the system init line.
    if (status === "done") {
      const capturedId = this._currentClaudeClient?.lastSessionId;
      if (capturedId) this._chatSessionId = capturedId;
    }
    // Aborted turn: session may be in indeterminate state — reset for safety.
    if (ctrl.signal.aborted) this._chatSessionId = undefined;

    await this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });

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
   * path (desktop-only). Reads pages + the domain's `_index.md` descriptions and
   * `_log.md`, builds the bundle in memory, writes it out.
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
    try { descriptions = parseIndexAnnotations(await this.app.vault.adapter.read(domainIndexPath(wikiFolder))); } catch { /* no index */ }
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
    await this.domainStore.save(next);
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

  private requireClaudeAgent(local: LocalConfig): string | null {
    const { iclaudePath } = local;
    if (!iclaudePath) {
      new Notice(i18n().ctrl.setClaudeCodePath);
      return null;
    }
    return iclaudePath;
  }

  private requireNativeAgent(eff: LlmWikiPluginSettings): boolean {
    const na = eff.nativeAgent;
    if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
      new Notice(i18n().ctrl.configureCloudLlm);
      return false;
    }
    return true;
  }

  private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string, opKey?: string, timeoutSec = 0): Promise<AgentRunner> {
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

    let llm: import("./types").LlmClient;
    if (s.backend === "claude-agent") {
      const manifestDir = this.plugin.manifest.dir
        ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
      const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
        .getFullPath(manifestDir);
      const tmpDir = join(pluginDir, "tmp");

      // Ensure tmpDir exists using vault adapter
      const tmpDirRelative = tmpDir.startsWith(base)
        ? tmpDir.slice(base.length).replace(/^\//, "")
        : tmpDir;
      if (base) {
        try {
          if (!(await adapter.exists(tmpDirRelative))) {
            await adapter.mkdir(tmpDirRelative);
          }
        } catch { /* ignore mkdir failures; will fail on actual write if needed */ }
      }

      interface InternalAdapter { remove(p: string): Promise<void>; }
      const fullAdapter = this.app.vault.adapter as unknown as InternalAdapter;
      const claudeEff = s.claudeAgent;
      const normalizedOpKey = opKey === "chat" || opKey === "lint-chat" ? "lint"
        : opKey;
      const effort = claudeEff.perOperation && normalizedOpKey
        ? (claudeEff.operations[normalizedOpKey as import("./types").OpKey]?.effort ?? claudeEff.effort)
        : claudeEff.effort;
      const client = new ClaudeCliClient({
        iclaudePath: local.iclaudePath,
        model: claudeEff.model,
        allowedTools: claudeEff.allowedTools,
        effort,
        requestTimeoutSec: timeoutSec,
        cwd: vaultRoot,
        tmpDir,
        resumeSessionId,
        tmpWrite: async (absPath: string, content: string) => {
          if (base && !absPath.startsWith(base)) {
            throw new Error(`tmpDir path outside vault: ${absPath}`);
          }
          const vaultPath = base ? absPath.slice(base.length).replace(/^\//, "") : absPath;
          await adapter.write(vaultPath, content);
        },
        tmpRemove: (absPath: string) => {
          if (base && absPath.startsWith(base)) {
            const vaultPath = absPath.slice(base.length).replace(/^\//, "");
            fullAdapter.remove(vaultPath).catch(() => { /* ignore if already gone */ });
          }
        },
      });
      this._currentClaudeClient = client;
      llm = client;
    } else {
      this._currentClaudeClient = null;

      const proxyCfg = s.proxy;
      let proxyFetch: typeof fetch | null = null;
      if (proxyCfg.enabled && Platform.isMobile) {
        new Notice(i18n().settings.proxy_mobile_warning);
      } else if (proxyCfg.enabled) {
        try {
          const baseHost = new URL(s.nativeAgent.baseUrl).hostname;
          const noProxyList = parseNoProxy(proxyCfg.noProxy);
          if (!shouldBypass(baseHost, noProxyList)) {
            proxyFetch = createProxyFetch(proxyCfg);
            if (proxyFetch) console.debug(`[ai-wiki] using proxy ${maskProxyUrl(proxyCfg.url)}`);
          }
        } catch (e) {
          new Notice(i18n().settings.proxy_invalid((e as Error).message));
        }
      }

      const openaiClient = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: timeoutSec > 0 ? timeoutSec * 1000 : undefined,
        dangerouslyAllowBrowser: true,
        fetch: Platform.isMobile ? mobileFetch : (proxyFetch ?? undefined),
      });
      llm = Platform.isMobile
        ? wrapMobileNoStream(openaiClient)
        : openaiClient;
    }

    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`, Platform.isMobile);
  }

  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!(this._currentLogMeta?.agentLogEnabled ?? this.plugin.settings.agentLogEnabled)) return;

    // Reasoning chunks (assistant_text + isReasoning) accumulate into a buffer and
    // are flushed as ONE consolidated line when the next non-assistant_text event
    // arrives. Non-reasoning assistant_text (progress chatter) stays dropped — the
    // final answer is already captured by the `result` event.
    if (ev.kind === "assistant_text") {
      if (ev.isReasoning) this._reasoningBuf += ev.delta;
      return;
    }

    const adapter = this.app.vault.adapter;
    // Agent log lives in the plugin dir (NOT the synced wiki tree). The pluginDir
    // always exists (the plugin loads from it), so no folder creation is needed.
    const path = `${this.pluginDir()}/agent.jsonl`;
    try {
      const appendLine = async (record: unknown): Promise<void> => {
        const line = JSON.stringify(record) + "\n";
        if (await adapter.exists(path)) await adapter.append(path, line);
        else await adapter.write(path, line);
      };
      const envelope = {
        session: sessionId, op, domainId,
        backend: this._currentLogMeta?.backend,
        model: this._currentLogMeta?.model,
      };

      // Flush accumulated reasoning as one line, stamped with the current call index,
      // before writing the event that triggered the flush.
      if (this._reasoningBuf) {
        await appendLine({
          ts: new Date().toISOString(),
          ...envelope,
          event: { kind: "reasoning", text: this._reasoningBuf },
          callIndex: this._llmCallIndex,
        });
        this._reasoningBuf = "";
      }

      const extra = ev.kind === "llm_call_stats" ? { callIndex: this._llmCallIndex++ } : {};
      await appendLine({
        ts: new Date().toISOString(),
        ...envelope,
        event: ev,
        ...extra,
      });
    } catch { /* не блокируем операцию */ }
  }

  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError, chatMessages?: ChatMessage[], lintOpts?: { useLlm: boolean; entityTypeFilter: string[] }): Promise<void> {
    if (this.isBusy()) {
      new Notice(i18n().ctrl.operationRunning);
      return;
    }

    // Новая операция делает предыдущий чат-контекст нерелевантным.
    this._chatSessionId = undefined;

    if (Platform.isMobile && op !== "query" && op !== "format" && op !== "delete") {
      new Notice(i18n().ctrl.mobileNotAvailable);
      return;
    }
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
      if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
      if (eff.backend === "claude-agent" && !local.shellConsentGiven) {
        new ShellConsentModal(this.app, local.iclaudePath ?? "", async () => {
          await this.localConfigStore.save({ shellConsentGiven: true });
        }).open();
        return;
      }
      const opKey = (op === "lint-chat" ? "lint" : op) as import("./types").OpKey;
      this._currentLogMeta = {
        backend: eff.backend,
        model: eff.backend === "claude-agent"
          ? (eff.claudeAgent.perOperation ? eff.claudeAgent.operations[opKey].model : eff.claudeAgent.model)
          : (eff.nativeAgent.perOperation ? eff.nativeAgent.operations[opKey].model : eff.nativeAgent.model),
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
      agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey, opTimeoutSec);
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
    const sessionId = String(startedAt);
    const steps: RunHistoryEntry["steps"] = [];
    let finalText = "";
    let status: RunHistoryEntry["status"] = "done";

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
        await this.logEvent(vaultRoot, sessionId, op, domainId, ev);
        this.activeView()?.appendEvent(ev);
        if (ev.kind === "domain_created" || ev.kind === "domain_updated" || ev.kind === "source_path_added" || ev.kind === "source_path_removed") {
          try {
            const cur = await this.domainStore.load();
            const next = applyDomainEvent(cur, ev, { vaultRoot });
            if (next !== cur) await this.domainStore.save(next);
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
        if (ev.kind === "error") status = "error";
        if (ev.kind === "exit") {
          if (ev.code !== 0 && status === "done") status = "error";
          if (ctrl.signal.aborted) status = "cancelled";
        }
      }
    } catch (err) {
      status = "error";
      console.error("[ai-wiki] dispatch failed", err);
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
      this._currentLogMeta = null;
    }
    if (ctrl.signal.aborted && status === "done" && !finalText) {
      if (timedOut) {
        status = "error";
        finalText = `Timeout after ${Math.round(timeoutMs / 1000)}s — check LLM backend URL`;
        this.activeView()?.appendEvent({ kind: "error", message: finalText });
        await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
      } else {
        status = "cancelled";
      }
    }
    if (status === "done") {
      const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "init";
      if (mutatesWiki) {
        const targets = domainId ? [domainId] : (await this.domainStore.load()).map((d) => d.id);
        for (const id of targets) graphCache.invalidate(id);
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
