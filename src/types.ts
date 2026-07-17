import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "./domain";
import type { EvalMetaFields } from "./eval-log";
import type { FileMutation } from "./file-transaction";
import type { IngestLogEntry } from "./wiki-log";

export type WikiOperation =
  | "ingest"
  | "query"
  | "lint"
  | "lint-chat"
  | "chat"
  | "init"
  | "format"
  | "delete";

export type StructuredCallSite =
  | "init.bootstrap"
  | "init.bootstrap-map"
  | "init.delta"
  | "lint.patch"
  | "lint.fix"
  | "lint.batch"
  | "lint-chat.fix"
  | "lint-chat.patch"
  | "query.seeds"
  | "query.answer"
  | "ingest.entities"
  | "ingest.evidence-map"
  | "ingest.evidence-reduce"
  | "ingest.pages"
  | "ingest.synthesize"
  | "ingest.merge"
  | "ingest.classify"
  | "format.output"
  | "format.segment"
  | "vision.analysis";

export type OnFileError = (
  file: string,
  err: Error,
  canRetry: boolean,
) => Promise<"skip" | "retry" | "stop">;

export interface IngestDeferredEffects {
  domainPatch?: { entity_types: EntityType[] };
  sourcePathAdded?: { domainId: string; path: string };
  log?: {
    sourcePath: string;
    entries: IngestLogEntry[];
    outputTokens: number;
  };
  manifestComplete: boolean;
  mutations: FileMutation[];
}

/** Internal delete-rebuild mode; never derived from user-configurable settings. */
export interface IngestInternalExecution {
  deferCommitEffects: true;
  transaction: {
    readonly manifestComplete: boolean;
    readonly mutations: FileMutation[];
  };
}

export interface DeleteEntityTypeDelta {
  type: string;
  before?: EntityType;
  after?: EntityType;
}

export interface DeleteStateCommitEvent {
  kind: "delete_state_commit";
  domainId: string;
  journalPath: string;
  journalHash: string;
  /** Exact SHA-256 of the controller-persisted published journal receipt. */
  receiptHash?: string;
  metadataPath: string;
  sourcePathAdds: string[];
  sourcePathRemoved: string;
  analyzedRemoval: { path: string; beforeHash?: string };
  entityTypeDeltas: DeleteEntityTypeDelta[];
}

export type IngestOutcome =
  | {
      ok: true;
      sourcePath: string;
      created: string[];
      updated: string[];
      deleted: string[];
      outputTokens: number;
      sourceBodyHash: string;
      deferred?: IngestDeferredEffects;
    }
  | {
      ok: false;
      sourcePath?: string;
      stage: "read" | "evidence" | "context" | "synthesis" | "patch" | "write" | "index" | "embedding" | "backlink";
      message: string;
      retryable: boolean;
      deferred?: IngestDeferredEffects;
    };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type WikiDomain = string;

export interface RunRequest {
  operation: WikiOperation;
  policyOperation?: OpKey;
  args: string[];
  cwd: string | undefined;
  signal: AbortSignal;
  timeoutMs: number;
  domainId?: string;
  runId?: string;
  context?: string;
  instruction?: string;
  onFileError?: OnFileError;
  chatMessages?: ChatMessage[];
  operationHeader?: string;
  lintOpts?: { useLlm: boolean; entityTypeFilter: string[] };
}

export type RunEvent =
  | { kind: "system"; message: string; sessionId?: string }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; ok: boolean; preview?: string }
  | { kind: "assistant_text"; delta: string; isReasoning?: boolean }
  | { kind: "assistant_replace"; text: string }
  | { kind: "info_text"; icon: string; summary: string; details?: string[] }
  | { kind: "result"; durationMs: number; text: string; outputTokens?: number }
  | {
      kind: "llm_call_stats";
      inputTokens?: number;
      outputTokens: number;
      ttftMs: number;
      llmDurationMs: number;
      inTokPerSec: number;
      outTokPerSec: number;
    }
  | {
      kind: "prompt_budget";
      callSite: StructuredCallSite;
      configuredInputBudget: number;
      effectiveInputBudget: number;
      estimatedInputTokens: number;
      actualInputTokens?: number;
      outputBudget?: number;
      compressionProfile: CompressionProfile;
      contextUnits: number;
      sourceChunks?: number;
      reductionDepth?: number;
      retryReason?: string;
    }
  | {
      kind: "query_stats";
      crossDomain: boolean;
      pagesScanned: number;        // pages read/analyzed
      pagesSelected: number;       // pages handed to the LLM
      chunksSelected?: number;     // chunks handed to the LLM
      candidatePages?: number;     // article pool before final chunk selection
      domainName?: string;         // Ask Domain only
      seedCount?: number;          // Ask Domain only -- vector seeds in the selected set
      graphCount?: number;         // Ask Domain only -- graph-expanded pages in the selected set
      domainsStudied?: number;     // Ask Wiki only -- domains that yielded candidates
      domainsTotal?: number;       // Ask Wiki only -- domains configured
      fromDomains?: string[];      // Ask Wiki only -- domain names in the final set
      rerankerEnabled?: boolean;
      rerankerTopN?: number;
      contextTopN?: number;
      chunkDupsDropped?: number;   // exact-duplicate chunks removed before rerank
      reranker?: {
        enabled: boolean;
        candidates: number;
        selected: number;
        durationMs: number;
        fallbackReason?: import("./reranker").RerankerFallbackReason;
      };
    }
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number }
  | { kind: "ask_user"; question: string; options: string[]; toolUseId: string }
  | { kind: "domain_created"; entry: DomainEntry }
  | { kind: "source_path_added"; domainId: string; path: string }
  | { kind: "source_path_removed"; domainId: string; path: string }
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string; wiki_folder?: string; analyzed_sources?: Record<string, string> } }
  | DeleteStateCommitEvent
  | { kind: "rule_fired"; ruleId: string; count: number }
  | { kind: "eval_meta"; fields: EvalMetaFields }
  | { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
  | { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
  | { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
  | { kind: "format_preview"; tempPath: string; report: string; missingTokens: { token: string; context: string }[]; runId?: string; visionCount?: number }
  | { kind: "format_applied"; path: string }
  | { kind: "format_cancelled" }
  | { kind: "structural_error";
      callSite: StructuredCallSite;
      errorType: "json_parse" | "schema_validate" | "empty_output" | "response_format_fallback" | "frame_parse" | "idle_abort";
      retryAttempt: number;
      succeeded: boolean | null;
      message: string;
    }
  | {
      kind: "graph_stats";
      seeds: string[];
      expanded: number;
      total: number;
      fromCache: boolean;
      seedScores: Record<string, number>;
      expandedPages: string[];
      expandedScores: Record<string, number>;
      expandedDense?: Record<string, number>;
      expandedByHop?: Record<number, string[]>;
      seedFallback?: "none" | "jaccard" | "llm";
      retrievalMode?: import("./retrieval-diag").RetrievalMode;
      denseMax?: number;
      seedFallbackReason?: import("./retrieval-diag").SeedFallbackReason;
      floorApplied?: boolean;
      floorRef?: number;
      floorLoRef?: number;
      floorBar?: number;
      prunedCount?: number;
      floorSkippedReason?: string;
    };

export interface RunHistoryEntry {
  id: string;
  operation: WikiOperation;
  args: string[];
  domainId?: string;
  startedAt: number;
  finishedAt: number;
  status: "done" | "error" | "cancelled";
  finalText: string;
  steps: Array<{ kind: "tool_use" | "tool_result"; label: string }>;
}

export type CompressionProfile = "maximum" | "balanced" | "minimum";
export type CompressionOperation = "ingest" | "query" | "lint" | "vision";

export interface SemanticCompression {
  profile: CompressionProfile;
  operation: CompressionOperation;
}

export interface ModelCallPolicy {
  inputBudgetTokens: number;
  outputBudgetTokens?: number;
  compression: CompressionProfile;
}

export interface LlmCallOptions {
  temperature?: number;
  inputBudgetTokens?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  outputLanguage?: OutputLanguage;
  reasoningLanguage?: OutputLanguage;
  jsonMode?: "json_object" | "json_schema" | false;
  jsonSchema?: { name: string; schema: object };
  structuredRetries?: number;
  thinkingBudgetTokens?: number;
  mergeDeleteWarnThreshold?: number;
  dedupOnIngest?: boolean;
  dedupThreshold?: number;
  lintNearDuplicate?: boolean;
  nearDupThreshold?: number;
  semanticCompression?: SemanticCompression;
}

/** Минимальный интерфейс OpenAI-клиента, используемый фазами. */
export type LlmClient = {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>;
      create(
        params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        opts?: { signal?: AbortSignal },
      ): Promise<OpenAI.Chat.ChatCompletion>;
    };
  };
};

export type OutputLanguage = "auto" | "ru" | "en" | "es";

export type OpKey = "ingest" | "query" | "lint" | "init" | "format";
export type OpMap<T> = Record<OpKey, T>;

export interface ClaudeOperationConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  inputBudgetTokens: number;
  compressionProfile?: CompressionProfile;
}

export interface NativeOperationConfig {
  model: string;
  inputBudgetTokens: number;
  maxTokens: number;
  temperature: number;
  thinkingBudgetTokens?: number;
  compressionProfile?: CompressionProfile;
}

export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  outputLanguage: OutputLanguage;
  reasoningLanguage: OutputLanguage;
  agentLogEnabled: boolean;
  historyLimit: number;
  graphDepth: number;
  bfsTopK: number;
  wikiLinkValidationRetries: number;
  seedTopK: number;
  seedMinScore: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    init: number;
    format: number;
  };
  history: RunHistoryEntry[];
  claudeAgent: {
    model: string;
    inputBudgetTokens: number;
    compressionProfile: CompressionProfile;
    allowedTools: string;
    perOperation: boolean;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    operations: OpMap<ClaudeOperationConfig>;
  };
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    inputBudgetTokens: number;
    maxTokens: number;
    compressionProfile: CompressionProfile;
    temperature: number;
    topP: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
    thinkingBudgetTokens?: number;
    embeddingModel?: string;
    embeddingDimensions?: number;
    relevantPagesTopK?: number;
    rerankerEnabled?: boolean;
    rerankerModel?: string;
    rerankerTopN?: number;
    contextTopN?: number;
    rerankerTimeoutMs?: number;
    mergeDeleteWarnThreshold?: number;
    chunkMaxChars?: number;
    chunkOverlapChars?: number;
    chunkMinChars?: number;
    chunkMaxCount?: number;
    hybridRetrieval?: boolean;
    rrfK?: number;
    bfsFusion?: boolean;
    bfsMinScoreRatio?: number;
    seedSimilarityThreshold?: number;
    dedupOnIngest?: boolean;
    dedupThreshold?: number;
    lintNearDuplicate?: boolean;
    nearDupThreshold?: number;
  };
  proxy: {
    enabled: boolean;
    url: string;
    username?: string;
    noProxy?: string;
  };
  devMode: {
    enabled: boolean;
  };
  lintOptions: {
    useLlm: boolean;
  };
  vision: {
    enabled: boolean;
    model: string;
  };
  llmIdleTimeoutSec: number;
  llmIdleRetries: number;
}

export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "native-agent",
  systemPrompt: "",
  outputLanguage: "auto",
  reasoningLanguage: "en",
  agentLogEnabled: false,
  historyLimit: 20,
  graphDepth: 1,
  bfsTopK: 10,
  wikiLinkValidationRetries: 3,
  seedTopK: 5,
  seedMinScore: 0.1,
  timeouts: { ingest: 300, query: 300, lint: 900, init: 3600, format: 600 },
  history: [],
  claudeAgent: {
    model: "sonnet",
    inputBudgetTokens: 16384,
    compressionProfile: "balanced",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku", inputBudgetTokens: 16384 },
      query:  { model: "sonnet", inputBudgetTokens: 16384 },
      lint:   { model: "sonnet", inputBudgetTokens: 16384 },
      init:   { model: "sonnet", inputBudgetTokens: 16384 },
      format: { model: "sonnet", inputBudgetTokens: 16384 },
    },
  },
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    inputBudgetTokens: 16384,
    maxTokens: 4096,
    compressionProfile: "balanced",
    temperature: 0.2,
    topP: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", inputBudgetTokens: 16384, maxTokens: 4096, temperature: 0.2 },
      query:  { model: "llama3.2", inputBudgetTokens: 16384, maxTokens: 4096, temperature: 0.2 },
      lint:   { model: "llama3.2", inputBudgetTokens: 16384, maxTokens: 8192, temperature: 0.2 },
      init:   { model: "llama3.2", inputBudgetTokens: 16384, maxTokens: 8192, temperature: 0.2 },
      format: { model: "llama3.2", inputBudgetTokens: 16384, maxTokens: 32768, temperature: 0.2 },
    },
    structuredRetries: 1,
    rerankerEnabled: false,
    rerankerModel: "",
    rerankerTopN: 30,
    contextTopN: 8,
    rerankerTimeoutMs: 800,
    hybridRetrieval: false,
    rrfK: 60,
    bfsFusion: false,
    bfsMinScoreRatio: 0.6, // position of the floor bar within the domain's cosine range [loRef..denseMax]; 0 = floor off
    seedSimilarityThreshold: 0,
    dedupOnIngest: false,
    dedupThreshold: 0.85,
    lintNearDuplicate: false,
    nearDupThreshold: 0.80,
  },
  proxy: { enabled: false, url: "" },
  devMode: {
    enabled: false,
  },
  lintOptions: {
    useLlm: true,
  },
  vision: {
    enabled: false,
    model: "",
  },
  llmIdleTimeoutSec: 300,
  llmIdleRetries: 3,
};
