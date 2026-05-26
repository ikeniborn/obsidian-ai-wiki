import type { DomainEntry } from "./domain";
import { runIngest } from "./phases/ingest";
import { runQuery } from "./phases/query";
import { runLint } from "./phases/lint";
import { runLintChat } from "./phases/chat";
import { runLintFixChat } from "./phases/lint-chat";
import { runInit } from "./phases/init";
import { runEvaluator } from "./phases/evaluator";
import { runFormat } from "./phases/format";
import type { LlmCallOptions, LlmClient, LlmWikiPluginSettings, OpKey, RunEvent, RunRequest } from "./types";
import type { VaultTools } from "./vault-tools";
import { wrapWithJsonFallback } from "./phases/llm-utils";
import { GLOBAL_DEV_LOG_PATH, domainWikiFolder } from "./wiki-path";
import { PageSimilarityService } from "./page-similarity";

export class AgentRunner {
  private llm: LlmClient;
  constructor(
    llm: LlmClient,
    private settings: LlmWikiPluginSettings,
    private vaultTools: VaultTools,
    private vaultName: string,
    private domains: DomainEntry[],
  ) {
    this.llm = wrapWithJsonFallback(llm);
  }

  private buildOptsFor(op: RunRequest["operation"]): { model: string; opts: LlmCallOptions } {
    const key = (op === "chat" || op === "lint-chat" ? "lint" : op) as OpKey;
    const s = this.settings;
    const structuredRetries = s.nativeAgent.structuredRetries ?? 1;

    if (s.backend === "claude-agent") {
      // claude-agent: maxTokens задаётся на уровне iclaude.sh (env CLAUDE_CODE_MAX_OUTPUT_TOKENS),
      // плагин его не плумит — параметр был бы избыточным.
      const c = s.claudeAgent.perOperation ? s.claudeAgent.operations[key] : undefined;
      const model = c ? c.model : s.claudeAgent.model;
      return { model, opts: { systemPrompt: s.systemPrompt, structuredRetries } };
    }

    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : undefined;
    const budgetTokens = c?.thinkingBudgetTokens ?? na.thinkingBudgetTokens;
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
    return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
  }

  private buildSimilarity(): PageSimilarityService | undefined {
    if (this.settings.backend !== "native-agent") return undefined;
    const na = this.settings.nativeAgent;
    return new PageSimilarityService({
      mode: na.embeddingModel ? "embedding" : "jaccard",
      model: na.embeddingModel,
      dimensions: na.embeddingDimensions,
      topK: na.relevantPagesTopK ?? 15,
      baseUrl: na.baseUrl,
      apiKey: na.apiKey,
    });
  }

  private async writeDevLog(_vaultRoot: string, entry: {
    operation: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    result: string;
    durationMs: number;
  }): Promise<void> {
    if (!this.settings.devMode?.enabled) return;
    const adapter = this.vaultTools.adapter;
    const path = GLOBAL_DEV_LOG_PATH;
    try {
      if (!(await adapter.exists("!Wiki"))) await adapter.mkdir("!Wiki").catch(() => {});
      if (!(await adapter.exists("!Wiki/_config"))) await adapter.mkdir("!Wiki/_config").catch(() => {});
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      if (await adapter.exists(path)) await adapter.append(path, line);
      else await adapter.write(path, line);
    } catch { /* не блокируем операцию */ }
  }

  private async *runOperation(
    req: RunRequest,
    model: string,
    opts: LlmCallOptions,
    vaultRoot: string,
    domains: DomainEntry[],
    similarity: PageSimilarityService | undefined,
  ): AsyncGenerator<RunEvent, void, void> {
    switch (req.operation) {
      case "ingest":
        yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, undefined, this.settings.graphDepth, this.settings.wikiLinkValidationRetries);
        break;
      case "query":
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, similarity);
        break;
      case "lint":
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, opts, similarity);
        break;
      case "chat": {
        const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        yield* runLintChat(
          this.llm, model, domain, req.signal, opts,
          req.context ?? "",
          req.chatMessages ?? [],
          req.operationHeader ?? "",
        );
        break;
      }
      case "lint-chat": {
        const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        yield* runLintFixChat(req, this.vaultTools, vaultRoot, domain, this.llm, model, opts, req.signal);
        break;
      }
      case "init":
        yield* runInit(req.args, this.vaultTools, this.llm, model, domains, this.vaultName, req.signal, opts, req.onFileError, similarity);
        break;
      case "format": {
        const hasVision = this.settings.backend === "claude-agent";
        const formatDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
        yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath);
        break;
      }
      default: {
        const start = Date.now();
        yield { kind: "error", message: `Unknown operation: ${req.operation as string}` };
        yield { kind: "result", durationMs: Date.now() - start, text: "" };
      }
    }
  }

  async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
    const { model, opts } = this.buildOptsFor(req.operation);
    const baseUrlHint = this.settings.backend === "native-agent"
      ? ` @ ${this.settings.nativeAgent.baseUrl}`
      : "";
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };

    if (req.signal.aborted) return;

    const vaultRoot = req.cwd ?? "";
    const domains = req.domainId
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;

    const similarity = this.buildSimilarity();
    const startMs = Date.now();
    let finalResultText = "";

    for await (const ev of this.runOperation(req, model, opts, vaultRoot, domains, similarity)) {
      if (ev.kind === "result") finalResultText = ev.text;
      yield ev;
    }

    if (this.settings.devMode?.enabled && finalResultText) {
      const taskInput = req.args.join(" ") || req.operation;
      await this.writeDevLog(vaultRoot, {
        operation: req.operation,
        model,
        systemPrompt: opts.systemPrompt ?? "",
        userMessage: taskInput,
        result: finalResultText,
        durationMs: Date.now() - startMs,
      });

      if (this.settings.devMode.evaluatorModel) {
        const evalModel = this.settings.devMode.evaluatorModel;
        for await (const ev of runEvaluator(this.llm, evalModel, req.operation, taskInput, finalResultText, req.signal)) {
          yield ev;
          if (ev.kind === "eval_result") {
            await this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
          }
        }
      }
    }
  }

  private async updateDevLogEval(_vaultRoot: string, score: number, reasoning: string): Promise<void> {
    if (!this.settings.devMode?.enabled) return;
    const adapter = this.vaultTools.adapter;
    const path = GLOBAL_DEV_LOG_PATH;
    try {
      if (!(await adapter.exists(path))) return;
      const content = await adapter.read(path);
      const lines = content.trimEnd().split("\n");
      const lastIdx = lines.length - 1;
      const last: Record<string, unknown> = JSON.parse(lines[lastIdx]) as Record<string, unknown>;
      last["eval"] = { score, reasoning };
      lines[lastIdx] = JSON.stringify(last);
      await adapter.write(path, lines.join("\n") + "\n");
    } catch { /* не блокируем */ }
  }
}
