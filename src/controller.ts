import { App, Notice } from "obsidian";
import { existsSync, appendFileSync, statSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
import { LLM_WIKI_VIEW_TYPE, LlmWikiView } from "./view";
import { validateDomainId, type DomainEntry, type AddDomainInput } from "./domain-map";
import type LlmWikiPlugin from "./main";
import type { RunEvent, RunHistoryEntry, WikiOperation } from "./types";
import { AgentRunner } from "./agent-runner";
import type { ChatMessage } from "./types";
import { VaultTools, type VaultAdapter } from "./vault-tools";
import { ClaudeCliClient } from "./claude-cli-client";
import OpenAI from "openai";
import { i18n } from "./i18n";
import { consolidateSourcePaths } from "./source-paths";

export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;
  constructor(private app: App, private plugin: LlmWikiPlugin) {}

  isBusy(): boolean { return this.current !== null; }

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

  async lintChat(domainId: string, lintReport: string, history: ChatMessage[], newMessage: string): Promise<void> {
    const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
    await this.dispatchChat(domainId, lintReport, chatMessages);
  }

  private async dispatchChat(domainId: string, lintReport: string, chatMessages: ChatMessage[]): Promise<void> {
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultBasePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const vaultName = this.app.vault.getName();
    const vaultSuffix = `/vaults/${vaultName}`;
    const repoRoot = vaultBasePath.endsWith(vaultSuffix)
      ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
      : vaultBasePath;

    const agentRunner = this.buildAgentRunner(repoRoot);
    const ctrl = new AbortController();
    this.current = ctrl;

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
    let finalText = "";
    let status: "done" | "error" | "cancelled" = "done";

    this.logEvent(sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
    });

    view.setChatRunning();

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: repoRoot,
      signal: ctrl.signal, timeoutMs, domainId, context: lintReport, chatMessages,
    });

    try {
      for await (const ev of runGen) {
        this.logEvent(sessionId, "chat", domainId, ev);
        this.activeView()?.appendChatEvent(ev);
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "error") status = "error";
      }
    } catch (err) {
      status = "error";
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      this.logEvent(sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.currentOp = null;
    }

    this.logEvent(sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });

    this.activeView()?.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }

  async init(domain: string, dryRun: boolean): Promise<void> {
    const args = dryRun ? [domain, "--dry-run"] : [domain];
    await this.dispatch("init", args);
  }


  cwdOrEmpty(): string {
    return (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
  }

  loadDomains(): DomainEntry[] {
    return this.plugin.settings.domains ?? [];
  }

  registerDomain(input: AddDomainInput): { ok: true } | { ok: false; error: string } {
    const id = input.id.trim();
    const err = validateDomainId(id);
    if (err) { new Notice(i18n().ctrl.domainAddFailed(err)); return { ok: false, error: err }; }
    const s = this.plugin.settings;
    if (!s.domains) s.domains = [];
    if (s.domains.some((d) => d.id === id)) {
      const msg = `Домен «${id}» уже существует`;
      new Notice(i18n().ctrl.domainAddFailed(msg));
      return { ok: false, error: msg };
    }
    const vaultName = this.app.vault.getName();
    const vaultPrefix = `vaults/${vaultName}`;
    const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
    s.domains.push({
      id,
      name: input.name.trim() || id,
      wiki_folder: `${vaultPrefix}/${wikiRelative}`,
      source_paths: [],
      entity_types: [],
      language_notes: "",
    });
    void this.plugin.saveSettings();
    new Notice(i18n().ctrl.domainAdded(id));
    return { ok: true };
  }

  private requireClaudeAgent(): string | null {
    const p = this.plugin.settings.claudeAgent.iclaudePath;
    if (!p || !existsSync(p)) {
      new Notice(i18n().ctrl.setClaudeCodePath);
      return null;
    }
    return p;
  }

  private buildAgentRunner(repoRoot: string): AgentRunner {
    const adapter = this.app.vault.adapter as unknown as VaultAdapter;
    const base = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const vaultTools = new VaultTools(adapter, base);
    const vaultName = this.app.vault.getName();
    const domains = this.plugin.settings.domains ?? [];
    const s = this.plugin.settings;

    const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
    const llm = s.backend === "claude-agent"
      ? new ClaudeCliClient({ ...s.claudeAgent, requestTimeoutSec: maxTimeoutSec, cwd: s.claudeAgent.spawnCwd || "/tmp" })
      : new OpenAI({
          baseURL: s.nativeAgent.baseUrl,
          apiKey: s.nativeAgent.apiKey,
          timeout: maxTimeoutSec * 1000,
          dangerouslyAllowBrowser: true,
        });

    return new AgentRunner(llm, s, vaultTools, vaultName, domains);
  }

  private logEvent(sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): void {
    let logPath = this.plugin.settings.agentLogPath;
    if (!logPath) return;
    try {
      const stat = existsSync(logPath) ? statSync(logPath) : null;
      if (stat?.isDirectory() || (!logPath.includes(".") && !logPath.endsWith("/"))) {
        logPath = join(logPath, "agent.jsonl");
      }
      const line = JSON.stringify({ ts: new Date().toISOString(), session: sessionId, op, domainId, event: ev }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }

  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string): Promise<void> {
    if (this.isBusy()) {
      new Notice(i18n().ctrl.operationRunning);
      return;
    }

    if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultBasePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const vaultName = this.app.vault.getName();
    const vaultSuffix = `/vaults/${vaultName}`;
    const repoRoot = vaultBasePath.endsWith(vaultSuffix)
      ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
      : vaultBasePath;

    const agentRunner = this.buildAgentRunner(repoRoot);

    const ctrl = new AbortController();
    this.current = ctrl;
    this.currentOp = { op, args };

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const steps: RunHistoryEntry["steps"] = [];
    let finalText = "";
    let status: RunHistoryEntry["status"] = "done";

    this.logEvent(sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
    view.setRunning(op, args);

    const opKey = op === "query-save" ? "query" : op;
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
    const runGen = agentRunner.run({ operation: op, args, cwd: repoRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction });

    try {
      for await (const ev of runGen) {
        this.logEvent(sessionId, op, domainId, ev);
        this.activeView()?.appendEvent(ev);
        if (ev.kind === "domain_created") {
          if (!this.plugin.settings.domains) this.plugin.settings.domains = [];
          this.plugin.settings.domains.push(ev.entry);
          void this.plugin.saveSettings();
        }
        if (ev.kind === "domain_updated") {
          const domain = this.plugin.settings.domains.find((d) => d.id === ev.domainId);
          if (domain) {
            if (ev.patch.entity_types !== undefined) domain.entity_types = ev.patch.entity_types;
            if (ev.patch.language_notes !== undefined) domain.language_notes = ev.patch.language_notes;
            void this.plugin.saveSettings();
          }
        }
        if (ev.kind === "source_path_added") {
          const domain = this.plugin.settings.domains.find((d) => d.id === ev.domainId);
          if (domain) {
            domain.source_paths = consolidateSourcePaths(
              domain.source_paths ?? [],
              ev.path,
              repoRoot,
            );
            void this.plugin.saveSettings();
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
      this.logEvent(sessionId, op, domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.currentOp = null;
    }
    this.logEvent(sessionId, op, domainId, { kind: "system", message: `finish status=${status} durationMs=${Date.now() - startedAt}` });

    const entry: RunHistoryEntry = {
      id: `${startedAt}`,
      operation: op,
      args,
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
        const pathInVault = this.toVaultPath(vaultBasePath, m[1]);
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
