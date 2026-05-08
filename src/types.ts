import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "./domain";

export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "fix"
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
  | { kind: "result"; durationMs: number; usdCost?: number; text: string }
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number }
  | { kind: "ask_user"; question: string; options: string[]; toolUseId: string }
  | { kind: "domain_created"; entry: DomainEntry }
  | { kind: "source_path_added"; domainId: string; path: string }
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string } }
  | { kind: "eval_result"; score: number; reasoning: string }
  | { kind: "init_start"; totalFiles: number }
  | { kind: "file_start"; file: string; index: number; total: number }
  | { kind: "file_done"; file: string }
  | { kind: "format_preview"; tempPath: string; report: string; missingTokens: string[] }
  | { kind: "format_applied"; path: string }
  | { kind: "format_cancelled" };

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
  numCtx?: number | null;
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
  maxTokens: number;
  agentLogEnabled: boolean;
  historyLimit: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    fix: number;
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
    temperature: number;
    topP: number | null;
    numCtx: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
  };
  devMode: {
    enabled: boolean;
    evaluatorModel: string;
  };
}

export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "claude-agent",
  systemPrompt: "",
  maxTokens: 4096,
  agentLogEnabled: false,
  historyLimit: 20,
  timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600, format: 600 },
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
    temperature: 0.2,
    topP: null,
    numCtx: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      query:  { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      lint:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      init:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      format: { model: "llama3.2", maxTokens: 32768, temperature: 0.2 },
    },
  },
  devMode: {
    enabled: false,
    evaluatorModel: "sonnet",
  },
};
