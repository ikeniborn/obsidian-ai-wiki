import { appendFileSync } from "node:fs";
import type { DomainEntry } from "./domain-map";
import { runIngest } from "./phases/ingest";
import { runQuery } from "./phases/query";
import { runLint } from "./phases/lint";
import { runFix } from "./phases/fix";
import { runLintChat } from "./phases/chat";
import { runInit } from "./phases/init";
import type { LlmCallOptions, LlmClient, LlmWikiPluginSettings, OpKey, RunEvent, RunRequest } from "./types";
import type { VaultTools } from "./vault-tools";

export class AgentRunner {
  constructor(
    private llm: LlmClient,
    private settings: LlmWikiPluginSettings,
    private vaultTools: VaultTools,
    private vaultName: string,
    private domains: DomainEntry[],
  ) {}

  private buildOptsFor(op: RunRequest["operation"]): { model: string; opts: LlmCallOptions } {
    const key = (op === "query-save" ? "query" : (op === "fix" || op === "chat") ? "lint" : op) as OpKey;
    const s = this.settings;

    if (s.backend === "claude-agent") {
      const c = s.claudeAgent.perOperation ? s.claudeAgent.operations[key] : undefined;
      if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, systemPrompt: s.systemPrompt } };
      return { model: s.claudeAgent.model, opts: { maxTokens: s.maxTokens, systemPrompt: s.systemPrompt } };
    }

    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : undefined;
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt } };
    return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt } };
  }

  private writeDevLog(entry: {
    operation: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    result: string;
    durationMs: number;
  }): void {
    const logPath = this.settings.devMode?.logPath;
    if (!logPath) return;
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }

  private async *runOperation(
    req: RunRequest,
    model: string,
    opts: LlmCallOptions,
    repoRoot: string,
    domains: DomainEntry[],
  ): AsyncGenerator<RunEvent, void, void> {
    switch (req.operation) {
      case "ingest":
        yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
        break;
      case "query":
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
        break;
      case "query-save":
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
        break;
      case "lint":
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
        break;
      case "fix":
        yield* runFix(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts, req.context, req.instruction);
        break;
      case "chat": {
        const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        yield* runLintChat(this.llm, model, domain, req.signal, opts, req.context ?? "", req.chatMessages ?? []);
        break;
      }
      case "init":
        yield* runInit(req.args, this.vaultTools, this.llm, model, domains, repoRoot, this.vaultName, req.signal, opts);
        break;
      default: {
        const start = Date.now();
        yield { kind: "error", message: `Unknown operation: ${req.operation as string}` };
        yield { kind: "result", durationMs: Date.now() - start, text: "" };
      }
    }
  }

  async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
    const { model, opts } = this.buildOptsFor(req.operation);
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}` };

    if (req.signal.aborted) return;

    const repoRoot = req.cwd ?? "";
    const domains = req.domainId
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;

    const startMs = Date.now();
    let finalResultText = "";

    for await (const ev of this.runOperation(req, model, opts, repoRoot, domains)) {
      if (ev.kind === "result") finalResultText = ev.text;
      yield ev;
    }

    if (this.settings.devMode?.enabled && finalResultText) {
      const taskInput = req.args.join(" ") || req.operation;
      this.writeDevLog({
        operation: req.operation,
        model,
        systemPrompt: opts.systemPrompt ?? "",
        userMessage: taskInput,
        result: finalResultText,
        durationMs: Date.now() - startMs,
      });
    }
  }
}
