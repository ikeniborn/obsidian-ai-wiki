import { App, Notice, Platform } from "obsidian";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
import { LLM_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { validateDomainId, type DomainEntry, type AddDomainInput } from "./domain";
import type LlmWikiPlugin from "./main";
import type { RunEvent, RunHistoryEntry, WikiOperation, OnFileError } from "./types";
import { AgentRunner } from "./agent-runner";
import type { ChatMessage } from "./types";
import { VaultTools, type VaultAdapter } from "./vault-tools";
import { ClaudeCliClient } from "./claude-cli-client";
import OpenAI from "openai";
import { i18n } from "./i18n";
import { applyDomainEvent } from "./domain";
import type { DomainStore } from "./domain-store";
import { DomainCorruptError } from "./domain-store";
import type { LocalConfigStore } from "./local-config";
import { FileErrorModal } from "./modals";

export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;
  private _chatSessionId: string | undefined;
  private _currentClaudeClient: ClaudeCliClient | null = null;
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

  async ingestActive(domainId?: string): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(i18n().ctrl.noActiveFile); return; }
    const abs = (this.app.vault.adapter as { getFullPath: (p: string) => string }).getFullPath(file.path);
    await this.dispatch("ingest", [abs], domainId);
  }

  async query(question: string, save: boolean, domainId?: string): Promise<void> {
    if (!question.trim()) return;
    const op: WikiOperation = save ? "query-save" : "query";
    await this.dispatch(op, [question.trim()], domainId);
  }

  async lint(domain: string): Promise<void> {
    const args = domain === "all" ? [] : [domain];
    await this.dispatch("lint", args);
  }

  async fix(domainId: string, lintReport: string, instruction: string): Promise<void> {
    await this.dispatch("fix", [domainId], domainId, lintReport, instruction);
  }

  async chat(operation: WikiOperation, domainId: string | undefined, context: string, history: ChatMessage[], newMessage: string): Promise<void> {
    const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
    await this.dispatchChat(operation, domainId, context, chatMessages);
  }

  private async dispatchChat(operation: WikiOperation, domainId: string | undefined, context: string, chatMessages: ChatMessage[]): Promise<void> {
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    if (Platform.isMobile && operation !== "query" && operation !== "query-save") {
      new Notice("Operation not available on mobile");
      return;
    }
    if (this.plugin.settings.backend === "native-agent" && !this.requireNativeAgent()) return;
    if (this.plugin.settings.backend === "claude-agent" && !await this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";

    const agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId);
    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
    let finalText = "";
    let status: "done" | "error" | "cancelled" = "done";

    this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
    });

    view.setChatRunning();

    const OPERATION_LABELS: Partial<Record<WikiOperation, string>> = {
      lint: "Lint-проверка wiki",
      ingest: "Извлечение знаний (ingest)",
      query: "Ответ на запрос (query)",
      "query-save": "Ответ на запрос с сохранением (query-save)",
    };
    const operationHeader = OPERATION_LABELS[operation] ?? operation;

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: vaultRoot,
      signal: ctrl.signal, timeoutMs, domainId, context, chatMessages, operationHeader,
    });

    try {
      for await (const ev of runGen) {
        this.logEvent(vaultRoot, sessionId, "chat", domainId, ev);
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
      this.logEvent(vaultRoot, sessionId, "chat", domainId, { kind: "error", message: finalText });
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

    this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });

    this.activeView()?.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }

  async init(domain: string, dryRun: boolean, sourcePaths?: string[]): Promise<void> {
    const args = dryRun ? [domain, "--dry-run"] : [domain];
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
    return (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
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

  private async requireClaudeAgent(): Promise<string | null> {
    const { iclaudePath } = await this.localConfigStore.load();
    if (!iclaudePath || !existsSync(iclaudePath)) {
      new Notice(i18n().ctrl.setClaudeCodePath);
      return null;
    }
    return iclaudePath;
  }

  private requireNativeAgent(): boolean {
    const na = this.plugin.settings.nativeAgent;
    if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
      new Notice("Configure cloud LLM (baseUrl + apiKey) in settings");
      return false;
    }
    return true;
  }

  private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string): Promise<AgentRunner> {
    const adapter = this.app.vault.adapter as unknown as VaultAdapter;
    const base = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const manifestDir = this.plugin.manifest.dir
      ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
    const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
      .getFullPath(manifestDir);
    const tmpDir = join(pluginDir, "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const vaultTools = new VaultTools(adapter, base);
    const vaultName = this.app.vault.getName();
    const domains = await this.domainStore.load();
    const local = await this.localConfigStore.load();
    const s = this.plugin.settings;

    const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
    let llm: import("./types").LlmClient;
    if (s.backend === "claude-agent") {
      const client = new ClaudeCliClient({
        ...s.claudeAgent,
        iclaudePath: local.iclaudePath,
        requestTimeoutSec: maxTimeoutSec,
        cwd: vaultRoot,
        tmpDir,
        resumeSessionId,
      });
      this._currentClaudeClient = client;
      llm = client;
    } else {
      this._currentClaudeClient = null;
      llm = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: maxTimeoutSec * 1000,
        dangerouslyAllowBrowser: true,
      });
    }

    return new AgentRunner(llm, s, vaultTools, vaultName, domains);
  }

  private logEvent(vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): void {
    if (!this.plugin.settings.agentLogEnabled) return;
    try {
      const logDir = join(vaultRoot, "!Logs");
      mkdirSync(logDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), session: sessionId, op, domainId, event: ev }) + "\n";
      appendFileSync(join(logDir, "agent.jsonl"), line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }

  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError): Promise<void> {
    if (this.isBusy()) {
      new Notice(i18n().ctrl.operationRunning);
      return;
    }

    // Новая операция делает предыдущий чат-контекст нерелевантным.
    this._chatSessionId = undefined;

    if (Platform.isMobile && op !== "query" && op !== "query-save") {
      new Notice("Operation not available on mobile");
      return;
    }
    if (this.plugin.settings.backend === "native-agent" && !this.requireNativeAgent()) return;
    if (this.plugin.settings.backend === "claude-agent" && !await this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultRoot = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";

    const agentRunner = await this.buildAgentRunner(vaultRoot);

    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();
    this.currentOp = { op, args };

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const steps: RunHistoryEntry["steps"] = [];
    let finalText = "";
    let status: RunHistoryEntry["status"] = "done";

    this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
    view.setRunning(op, args);

    const opKey = op === "query-save" ? "query" : op;
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError });

    try {
      for await (const ev of runGen) {
        this.logEvent(vaultRoot, sessionId, op, domainId, ev);
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
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
    }
    this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `finish status=${status} durationMs=${Date.now() - startedAt}` });

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

    if (op === "query-save" && status === "done") {
      const m = finalText.match(/Создана\s+страница:\s*([^\s`'"]+)/i);
      if (m) {
        const pathInVault = this.toVaultPath(vaultRoot, m[1]);
        if (pathInVault) await this.app.workspace.openLinkText(pathInVault, "");
      }
    }
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
    const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
    if (leaves.length === 0) {
      const right = this.app.workspace.getRightLeaf(false);
      if (right) await right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
    } else {
      void this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  private activeView(): LlmWikiView | null {
    const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
    const view = leaves[0]?.view;
    return view instanceof LlmWikiView ? view : null;
  }

  private toVaultPath(vaultDir: string, savedPath: string): string | null {
    const abs = isAbsolute(savedPath) ? savedPath : join(vaultDir, savedPath);
    const rel = relative(vaultDir, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel;
  }
}
