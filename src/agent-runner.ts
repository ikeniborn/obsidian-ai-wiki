import type { DomainEntry } from "./domain";
import { runIngest, detectDomainStrict } from "./phases/ingest";
import { join } from "path-browserify";
import { runQuery } from "./phases/query";
import { runCrossDomainQuery } from "./phases/query-cross-domain";
import { runLint } from "./phases/lint";
import { runLintChat } from "./phases/chat";
import { runLintFixChat } from "./phases/lint-chat";
import { runInit } from "./phases/init";
import { runFormat } from "./phases/format";
import { runDelete } from "./phases/delete";
import { VisionTempStore } from "./phases/vision-temp-store";
import type {
  CompressionProfile,
  LlmCallOptions,
  LlmClient,
  LlmWikiPluginSettings,
  OpKey,
  RunEvent,
  RunRequest,
  WikiOperation,
} from "./types";
import type { VaultTools } from "./vault-tools";
import { domainWikiFolder } from "./wiki-path";
import { writeEvalRecord, type EvalRecord, type EvalMetaFields, type LlmError } from "./eval-log";
import { PageSimilarityService, DEFAULT_CHUNKING } from "./page-similarity";
import { resolveLang, i18nFor } from "./i18n";
import type { BoilerplateDemotionConfig } from "./boilerplate-demotion";
import { normalizeRerankerConfig } from "./reranker";
import { resolveModelCallPolicy } from "./model-call-policy";

declare const require: NodeJS.Require;

const DISABLED_BOILERPLATE_DEMOTION: BoilerplateDemotionConfig = { enabled: false, factor: 0 };

type NodeTimers = typeof import("node:timers");

function loadDesktopTimers(): NodeTimers {
  // eslint-disable-next-line import/no-nodejs-modules -- Electron exposes Node builtins through require.
  if (typeof require === "function") return require("node:timers") as NodeTimers;

  const getBuiltinModule = (process as NodeJS.Process & {
    getBuiltinModule?: (id: string) => unknown;
  }).getBuiltinModule;
  if (typeof getBuiltinModule === "function") {
    const timers = getBuiltinModule("node:timers") ?? getBuiltinModule("timers");
    if (timers) return timers;
  }

  throw new Error("Desktop idle watchdog requires access to the Node.js timers module");
}

export function resolveFollowUpPolicyOperation(parent: WikiOperation): OpKey {
  return parent === "query" ? "query" : "lint";
}

export class AgentRunner {
  private llm: LlmClient;
  constructor(
    llm: LlmClient,
    private settings: LlmWikiPluginSettings,
    private vaultTools: VaultTools,
    private vaultName: string,
    private domains: DomainEntry[],
    private visionTempBaseDir?: string,
    private isMobile: boolean = false,
  ) {
    this.llm = llm;
  }

  private buildOptsFor(
    op: RunRequest["operation"],
    policyOperation?: RunRequest["policyOperation"],
  ): { model: string; opts: LlmCallOptions; compressionProfile: CompressionProfile } {
    const s = this.settings;
    const resolved = resolveModelCallPolicy(s, op, policyOperation);
    const structuredRetries = s.nativeAgent.structuredRetries ?? 1;
    const mergeDeleteWarnThreshold = s.nativeAgent.mergeDeleteWarnThreshold;

    if (s.backend === "claude-agent") {
      return {
        model: resolved.model,
        compressionProfile: resolved.policy.compression,
        opts: {
          ...resolved.opts,
          systemPrompt: s.systemPrompt,
          outputLanguage: s.outputLanguage,
          structuredRetries,
          mergeDeleteWarnThreshold,
        },
      };
    }

    const na = s.nativeAgent;
    return {
      model: resolved.model,
      compressionProfile: resolved.policy.compression,
      opts: {
        ...resolved.opts,
        systemPrompt: s.systemPrompt,
        outputLanguage: s.outputLanguage,
        reasoningLanguage: s.reasoningLanguage,
        structuredRetries,
        mergeDeleteWarnThreshold,
        dedupOnIngest: na.dedupOnIngest,
        dedupThreshold: na.dedupThreshold,
        lintNearDuplicate: na.lintNearDuplicate,
        nearDupThreshold: na.nearDupThreshold,
        nativeRequestRetries: s.llmIdleRetries ?? 3,
        nativeRequestIdleTimeoutMs: (s.llmIdleTimeoutSec ?? 300) * 1000,
      },
    };
  }

  private buildSimilarity(): PageSimilarityService | undefined {
    if (this.settings.backend !== "native-agent") return undefined;
    const na = this.settings.nativeAgent;
    return new PageSimilarityService({
      mode:
        na.embeddingModel === undefined ? "jaccard"
        : na.hybridRetrieval ? "hybrid"
        : "embedding",
      model: na.embeddingModel,
      dimensions: na.embeddingDimensions,
      topK: na.relevantPagesTopK ?? 15,
      baseUrl: na.baseUrl,
      apiKey: na.apiKey,
      rrfK: na.rrfK ?? 60,
      chunking: {
        maxChars: na.chunkMaxChars ?? DEFAULT_CHUNKING.maxChars,
        overlapChars: na.chunkOverlapChars ?? DEFAULT_CHUNKING.overlapChars,
        minChars: na.chunkMinChars ?? DEFAULT_CHUNKING.minChars,
        maxCount: na.chunkMaxCount ?? DEFAULT_CHUNKING.maxCount,
      },
    });
  }

  private async *runOperation(
    req: RunRequest,
    model: string,
    opts: LlmCallOptions,
    vaultRoot: string,
    domains: DomainEntry[],
    similarity: PageSimilarityService | undefined,
    visionTempStore?: VisionTempStore,
    compressionProfile?: CompressionProfile,
  ): AsyncGenerator<RunEvent, void, void> {
    const boilerplateDemotion = DISABLED_BOILERPLATE_DEMOTION;
    const reranker = normalizeRerankerConfig({
      enabled: this.settings.nativeAgent.rerankerEnabled,
      model: this.settings.nativeAgent.rerankerModel,
      rerankerTopN: this.settings.nativeAgent.rerankerTopN,
      contextTopN: this.settings.nativeAgent.contextTopN,
      timeoutMs: this.settings.nativeAgent.rerankerTimeoutMs,
    });
    const rerankerRuntime = {
      config: reranker,
      baseUrl: this.settings.nativeAgent.baseUrl ?? "",
      apiKey: this.settings.nativeAgent.apiKey ?? "",
    };
    switch (req.operation) {
      case "ingest":
        yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, undefined, this.settings.graphDepth, this.settings.wikiLinkValidationRetries);
        break;
      case "query":
        if (req.domainId === "*") {
          yield* runCrossDomainQuery(
            req.args[0] ?? "", this.vaultTools, this.llm, model, domains, req.signal,
            { graphDepth: this.settings.graphDepth, seedTopK: this.settings.seedTopK,
              seedMinScore: this.settings.seedMinScore, bfsTopK: this.settings.bfsTopK,
              seedSimilarityThreshold: this.settings.nativeAgent.seedSimilarityThreshold ?? 0,
              bfsMinScoreRatio: this.settings.nativeAgent.bfsMinScoreRatio ?? 0.6,
              boilerplateDemotion,
              rerankerRuntime },
            this.settings.nativeAgent.rrfK ?? 60,
            this.settings.wikiLinkValidationRetries ?? 3,
            opts, similarity,
          );
        } else {
          yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, this.settings.wikiLinkValidationRetries ?? 3, this.settings.nativeAgent.seedSimilarityThreshold ?? 0, this.settings.nativeAgent.bfsFusion ?? false, this.settings.nativeAgent.rrfK ?? 60, this.settings.nativeAgent.bfsMinScoreRatio ?? 0.6, boilerplateDemotion, rerankerRuntime);
        }
        break;
      case "lint":
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.wikiLinkValidationRetries, opts, similarity, req.lintOpts?.useLlm ?? true, req.lintOpts?.entityTypeFilter ?? []);
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
        const noVision = req.args.includes("--no-vision");
        const formatArgs = req.args.filter((a) => a !== "--no-vision");
        const explicitDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        const formatDomain =
          explicitDomain ??
          (formatArgs[0]
            ? detectDomainStrict(join(vaultRoot, formatArgs[0]), this.domains, vaultRoot) ?? undefined
            : undefined);
        const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
        const baseVisionSettings = {
          enabled: this.settings.vision?.enabled ?? false,
          model: this.settings.vision?.model ?? "",
          language: this.settings.outputLanguage ?? "auto",
          imageOnly: this.isMobile,
          compressionProfile,
          nativeRequestRetries: this.settings.llmIdleRetries ?? 3,
          nativeRequestIdleTimeoutMs: (this.settings.llmIdleTimeoutSec ?? 300) * 1000,
        };
        const visionSettings = noVision ? { ...baseVisionSettings, enabled: false } : baseVisionSettings;
        const progress = i18nFor(resolveLang(this.settings.outputLanguage)).formatProgress;
        yield* runFormat(formatArgs, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, this.settings.wikiLinkValidationRetries, visionSettings, visionTempStore, progress, formatDomain);
        break;
      }
      case "delete":
        yield* runDelete(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, this.settings.graphDepth, this.settings.wikiLinkValidationRetries);
        break;
      default: {
        const start = Date.now();
        yield { kind: "error", message: `Unknown operation: ${req.operation as string}` };
        yield { kind: "result", durationMs: Date.now() - start, text: "" };
      }
    }
  }

  async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
    const { model, opts, compressionProfile } = this.buildOptsFor(
      req.operation,
      req.policyOperation,
    );
    const idleTimeoutMs = (this.settings.llmIdleTimeoutSec ?? 300) * 1000;
    yield { kind: "run_config", llmIdleTimeoutMs: idleTimeoutMs };
    const baseUrlHint = this.settings.backend === "native-agent"
      ? ` @ ${this.settings.nativeAgent.baseUrl}`
      : "";
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };

    if (req.signal.aborted) return;

    const vaultRoot = req.cwd ?? "";
    const domains = req.domainId && req.domainId !== "*"
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;

    const similarity = this.buildSimilarity();
    const operationWatchdogEnabled = this.settings.backend === "claude-agent" && idleTimeoutMs > 0;
    const maxRetries = this.settings.backend === "claude-agent"
      ? this.settings.llmIdleRetries ?? 3
      : 0;
    const desktopTimers = !operationWatchdogEnabled || this.isMobile ? null : loadDesktopTimers();
    type IdleTimer = number | NodeJS.Timeout;
    const scheduleIdleAbort = (callback: () => void): IdleTimer => desktopTimers
      ? desktopTimers.setTimeout(callback, idleTimeoutMs)
      : window.setTimeout(callback, idleTimeoutMs);
    const clearIdleAbort = (timer: IdleTimer): void => {
      if (desktopTimers) desktopTimers.clearTimeout(timer as NodeJS.Timeout);
      else window.clearTimeout(timer as number);
    };
    let attempt = 0;
    let destructivePreludeSeen = false;
    let visibleAssistantTextSeen = false;

    const idleAfterDestructivePreludeAbort = () => new DOMException(
      `LLM idle timeout (${Math.round(idleTimeoutMs / 1000)}s) after destructive prelude; refusing to replay operation`,
      "AbortError",
    );
    const idleAfterVisibleOutputAbort = () => new DOMException(
      `LLM idle timeout (${Math.round(idleTimeoutMs / 1000)}s) after visible output; refusing to replay operation`,
      "AbortError",
    );

    const llmErrors: LlmError[] = [];
    const ruleFirings: Record<string, number> = {};
    let evalMeta: EvalMetaFields = {};

    let visionTempStore: VisionTempStore | undefined;
    if (req.operation === "format" && this.settings.vision?.enabled && this.visionTempBaseDir) {
      const runId = req.runId ?? Date.now().toString(36);
      visionTempStore = new VisionTempStore(this.vaultTools, `${this.visionTempBaseDir}/.vision-tmp/${runId}`);
    }

    try {
    while (true) {
      const idleCtrl = new AbortController();
      const signalAny = (AbortSignal as unknown as { any(this: void, signals: AbortSignal[]): AbortSignal }).any;
      const combined = operationWatchdogEnabled
        ? signalAny([req.signal, idleCtrl.signal])
        : req.signal;
      let idleTimer: IdleTimer | null =
        operationWatchdogEnabled ? scheduleIdleAbort(() => idleCtrl.abort()) : null;

      const resetTimer = () => {
        if (!idleTimer) return;
        clearIdleAbort(idleTimer);
        idleTimer = scheduleIdleAbort(() => idleCtrl.abort());
      };

      let finalResultText = "";
      try {
        for await (const ev of this.runOperation(
          { ...req, signal: combined },
          model,
          opts,
          vaultRoot,
          domains,
          similarity,
          visionTempStore,
          compressionProfile,
        )) {
          if (
            ev.kind === "llm_call_stats" || ev.kind === "assistant_text" ||
            ev.kind === "tool_use" || ev.kind === "tool_result"
          ) resetTimer();
          if (ev.kind === "tool_use" && ev.name === "WipeDomain") destructivePreludeSeen = true;
          if (ev.kind === "assistant_text" && !ev.isReasoning && ev.delta.length > 0) {
            visibleAssistantTextSeen = true;
          }
          if (ev.kind === "result") finalResultText = ev.text;
          if (ev.kind === "error") {
            llmErrors.push({ kind: "error", message: ev.message });
          } else if (ev.kind === "structural_error") {
            llmErrors.push({ kind: "structural_error", callSite: ev.callSite, errorType: ev.errorType, retryAttempt: ev.retryAttempt, message: ev.message });
          } else if (ev.kind === "rule_fired") {
            ruleFirings[ev.ruleId] = (ruleFirings[ev.ruleId] ?? 0) + ev.count;
          } else if (ev.kind === "eval_meta") {
            evalMeta = { ...evalMeta, ...ev.fields };
          } else if (ev.kind === "format_preview" && req.runId) {
            ev.runId = req.runId; // so the view's 👍/👎 buttons know which record to update
          }
          yield ev;
        }
        // Phases swallow AbortError silently (return instead of throw).
        // Detect silent idle abort by checking if idleCtrl fired but user didn't cancel.
        if (idleCtrl.signal.aborted && !req.signal.aborted) {
          if (visibleAssistantTextSeen) throw idleAfterVisibleOutputAbort();
          if (attempt < maxRetries) {
            if (destructivePreludeSeen) throw idleAfterDestructivePreludeAbort();
            attempt++;
            const sec = Math.round(idleTimeoutMs / 1000);
            yield { kind: "system", message: `LLM idle ${sec}s — retrying (${attempt}/${maxRetries})` };
            continue;
          }
          throw new DOMException(
            `LLM idle timeout (${Math.round(idleTimeoutMs / 1000)}s) exhausted after ${maxRetries} retries`,
            "AbortError",
          );
        }
        if (this.settings.devMode?.enabled && finalResultText && req.runId && this.visionTempBaseDir) {
          const record: EvalRecord = {
            runId: req.runId,
            ts: new Date().toISOString(),
            operation: req.operation,
            model,
            ...evalMeta,
            answer: evalMeta.answer ?? (req.operation === "format" ? undefined : finalResultText),
            llmErrors,
            ruleFirings,
            ratings: {},
          };
          // `visionTempBaseDir` IS the plugin base dir — the controller passes the
          // resolved `manifest.dir` as the 6th ctor arg (Task 5). eval.jsonl lives at
          // its root, not in the .vision-tmp subdir.
          const pluginDir = this.visionTempBaseDir;
          await writeEvalRecord(this.vaultTools.adapter, pluginDir, record);
        }
        return;
      } catch (err) {
        const isIdleAbort = !req.signal.aborted && (err as Error).name === "AbortError";
        if (isIdleAbort && attempt < maxRetries) {
          if (visibleAssistantTextSeen) throw err;
          if (destructivePreludeSeen) throw idleAfterDestructivePreludeAbort();
          attempt++;
          const sec = Math.round(idleTimeoutMs / 1000);
          yield { kind: "system", message: `LLM idle ${sec}s — retrying (${attempt}/${maxRetries})` };
          continue;
        }
        throw err;
      } finally {
        if (idleTimer) {
          clearIdleAbort(idleTimer);
          idleTimer = null;
        }
      }
    }
    } finally {
      await visionTempStore?.cleanup();
    }
  }
}
