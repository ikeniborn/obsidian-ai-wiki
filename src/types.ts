import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "./domain";

export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "lint-chat"
  | "chat"
  | "init"
  | "format";

export type OnFileError = (
  file: string,
  err: Error,
  canRetry: boolean,
) => Promise<"skip" | "retry" | "stop">;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type WikiDomain = string;

export interface RunRequest {
  operation: WikiOperation;
  args: string[];
  cwd: string | undefined;
  signal: AbortSignal;
  timeoutMs: number;
  domainId?: string;
  context?: string;
  instruction?: string;
  onFileError?: OnFileError;
  chatMessages?: ChatMessage[];
  operationHeader?: string;
}

export type RunEvent =
  | { kind: "system"; message: string; sessionId?: string }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; ok: boolean; preview?: string }
  | { kind: "assistant_text"; delta: string; isReasoning?: boolean }
  | { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number }
  | { kind: "ask_user"; question: string; options: string[]; toolUseId: string }
  | { kind: "domain_created"; entry: DomainEntry }
  | { kind: "source_path_added"; domainId: string; path: string }
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string; wiki_folder?: string; analyzed_sources?: string[] } }
  | { kind: "eval_result"; score: number; reasoning: string }
  | { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
  | { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
  | { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
  | { kind: "format_preview"; tempPath: string; report: string; missingTokens: { token: string; context: string }[] }
  | { kind: "format_applied"; path: string }
  | { kind: "format_cancelled" }
  | { kind: "structural_error";
      callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "lint-chat.fix" | "query.seeds";
      errorType: "json_parse" | "schema_validate";
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

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
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

export type OpKey = "ingest" | "query" | "lint" | "init" | "format";
export type OpMap<T> = Record<OpKey, T>;

export interface ClaudeOperationConfig {
  model: string;
}

export interface NativeOperationConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  agentLogEnabled: boolean;
  historyLimit: number;
  graphDepth: number;
  hubThreshold: number;
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
    allowedTools: string;
    perOperation: boolean;
    operations: OpMap<ClaudeOperationConfig>;
  };
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
    topP: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
  };
  devMode: {
    enabled: boolean;
    evaluatorModel: string;
  };
}

export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "claude-agent",
  systemPrompt: "",
  agentLogEnabled: false,
  historyLimit: 20,
  graphDepth: 1,
  hubThreshold: 20,
  seedTopK: 5,
  seedMinScore: 0.1,
  timeouts: { ingest: 300, query: 300, lint: 900, init: 3600, format: 600 },
  history: [],
  claudeAgent: {
    model: "sonnet",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku" },
      query:  { model: "sonnet" },
      lint:   { model: "sonnet" },
      init:   { model: "sonnet" },
      format: { model: "sonnet" },
    },
  },
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    maxTokens: 4096,
    temperature: 0.2,
    topP: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      query:  { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      lint:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      init:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      format: { model: "llama3.2", maxTokens: 32768, temperature: 0.2 },
    },
    structuredRetries: 1,
  },
  devMode: {
    enabled: false,
    evaluatorModel: "sonnet",
  },
};
