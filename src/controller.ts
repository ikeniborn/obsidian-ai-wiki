import { App, Notice, Platform, TFile } from "obsidian";
import { relative, isAbsolute, join } from "path-browserify";
import { AI_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { validateDomainId, type DomainEntry, type AddDomainInput } from "./domain";
import type LlmWikiPlugin from "./main";
import type { RunEvent, RunHistoryEntry, WikiOperation, OnFileError } from "./types";
import { AgentRunner } from "./agent-runner";
import type { ChatMessage } from "./types";
import { VaultTools, type VaultAdapter } from "./vault-tools";
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
import { FileErrorModal, ConfirmModal, ShellConsentModal } from "./modals";
import { domainWikiFolder } from "./wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "./utils/raw-frontmatter";
import { graphCache } from "./wiki-graph-cache";
import { collectMdInPaths, parseWikiSources } from "./utils/vault-walk";

function toVaultPath(vaultDir: string, savedPath: string): string | null {
  const abs = isAbsolute(savedPath) ? savedPath : join(vaultDir, savedPath);
  const rel = relative(vaultDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

function patchWikiFields(originalContent: string, formattedContent: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;
  const wikiUpdated = wikiUpdatedMatch[1].trim();
  const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(originalContent);
  const wikiAdded = wikiAddedMatch?.[1].trim();
  const wikiArticles = parseWikiArticlesFromFm(originalContent);
  return upsertRawFrontmatter(formattedContent, {
    wiki_added: wikiAdded,
    wiki_updated: wikiUpdated,
    wiki_articles: wikiArticles,
  });
}

export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;
  private _chatSessionId: string | undefined;
  private _currentClaudeClient: ClaudeCliClient | null = null;
  private _pendingFormat: { originalPath: string; tempPath: string; chat: ChatMessage[] } | null = null;
  private _currentLogMeta: { backend: string; model: string } | null = null;
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
      new ConfirmModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        () => void this.suggestIngestForWikiFile(file.path, inWiki),
      ).open();
      return;
    }

    this._pendingFormat = { originalPath: file.path, tempPath: "", chat: [] };
    await this.dispatch("format", [file.path]);
  }

  private async suggestIngestForWikiFile(filePath: string, domain: DomainEntry): Promise<void> {
    const content = await this.app.vault.adapter.read(filePath);
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) { new Notice(i18n().view.formatInWikiNoSources); return; }
    const frontmatter = m[1];
    const sourcesMatch = frontmatter.match(/wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (!sourcesMatch) { new Notice(i18n().view.formatInWikiNoSources); return; }
    const sources = sourcesMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
    if (!sources.length) { new Notice(i18n().view.formatInWikiNoSources); return; }
    await this.init(domain.id, false, sources);
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
        const patched = patchWikiFields(originalContent, formattedContent);
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
        const patched = patchWikiFields(originalContent, content);
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
    const abs = (this.app.vault.adapter as { getFullPath: (p: string) => string }).getFullPath(file.path);
    await this.dispatch("ingest", [abs], domainId);
  }

  async query(question: string, domainId?: string): Promise<void> {
    if (!question.trim()) return;
    await this.dispatch("query", [question.trim()], domainId);
  }

  async lint(domain: string): Promise<void> {
    const args = domain === "all" ? [] : [domain];
    await this.dispatch("lint", args);
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
      agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId, "chat");
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
      lint: "Lint-проверка wiki",
      ingest: "Извлечение знаний (ingest)",
      query: "Ответ на запрос (query)",
    };
    const operationHeader = OPERATION_LABELS[operation] ?? operation;

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: vaultRoot,
      signal: ctrl.signal, timeoutMs, domainId, context, chatMessages, operationHeader,
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

  async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean): Promise<void> {
    const args: string[] = [domain];
    if (dryRun) args.push("--dry-run");
    if (force) args.push("--force");
    if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
    const onFileError: OnFileError | undefined = sourcePaths?.length
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

  private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string, opKey?: string): Promise<AgentRunner> {
    const rawAdapter = this.app.vault.adapter as unknown as VaultAdapter;
    const vault = this.app.vault;
    const adapter = Object.create(rawAdapter) as VaultAdapter;
    adapter.mkdir = async (path: string) => {
      try { await vault.createFolder(path); } catch { /* already exists — fine */ }
    };
    const base = this.cwdOrEmpty();
    const vaultTools = new VaultTools(adapter, base, vault);
    const vaultName = this.app.vault.getName();
    const domains = await this.domainStore.load();
    const local = await this.localConfigStore.load();
    const s = resolveEffective(this.plugin.settings, local);

    const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
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
        requestTimeoutSec: maxTimeoutSec,
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
        timeout: maxTimeoutSec * 1000,
        dangerouslyAllowBrowser: true,
        fetch: Platform.isMobile ? mobileFetch : (proxyFetch ?? undefined),
      });
      llm = (Platform.isMobile
        ? wrapMobileNoStream(openaiClient as unknown as import("./types").LlmClient)
        : openaiClient) as unknown as import("./types").LlmClient;
    }

    return new AgentRunner(llm, s, vaultTools, vaultName, domains);
  }

  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!this.plugin.settings.agentLogEnabled) return;
    if (ev.kind === "assistant_text") return;
    const adapter = this.app.vault.adapter;
    const path = "!Wiki/.config/_agent.jsonl";
    try {
      if (!(await adapter.exists("!Wiki"))) await this.app.vault.createFolder("!Wiki").catch(() => {});
      if (!(await adapter.exists("!Wiki/.config"))) await this.app.vault.createFolder("!Wiki/.config").catch(() => {});
      const extra = ev.kind === "result" && ev.outputTokens !== undefined && ev.durationMs > 0
        ? { tokPerSec: Math.round(ev.outputTokens / (ev.durationMs / 1000)) }
        : {};
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        session: sessionId, op, domainId,
        backend: this._currentLogMeta?.backend,
        model: this._currentLogMeta?.model,
        event: ev,
        ...extra,
      }) + "\n";
      if (await adapter.exists(path)) await adapter.append(path, line);
      else await adapter.write(path, line);
    } catch { /* не блокируем операцию */ }
  }

  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError, chatMessages?: ChatMessage[]): Promise<void> {
    if (this.isBusy()) {
      new Notice(i18n().ctrl.operationRunning);
      return;
    }

    // Новая операция делает предыдущий чат-контекст нерелевантным.
    this._chatSessionId = undefined;

    if (Platform.isMobile && op !== "query" && op !== "format") {
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
      };
    }

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = this.cwdOrEmpty();
    const opKey = op === "lint-chat" ? "lint" : op;

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey);
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
    const sessionId = String(startedAt);
    const steps: RunHistoryEntry["steps"] = [];
    let finalText = "";
    let status: RunHistoryEntry["status"] = "done";

    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
    view.setRunning(op, args);
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
    let timedOut = false;
    const timeoutId = timeoutMs > 0
      ? window.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs)
      : null;
    const resolvedChatMessages = op === "format" ? this._pendingFormat?.chat : chatMessages;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages });

    try {
      for await (const ev of runGen) {
        await this.logEvent(vaultRoot, sessionId, op, domainId, ev);
        this.activeView()?.appendEvent(ev);
        if (ev.kind === "domain_created" || ev.kind === "domain_updated" || ev.kind === "source_path_added") {
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
