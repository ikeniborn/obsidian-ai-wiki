import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "./domain-map";

export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "fix"
  | "chat"
  | "init";

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
  chatMessages?: ChatMessage[];
  operationHeader?: string;
}

export type RunEvent =
  | { kind: "system"; message: string }
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
  | { kind: "eval_result"; score: number; reasoning: string };

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

export type OpKey = "ingest" | "query" | "lint" | "init";
export type OpMap<T> = Record<OpKey, T>;

export interface ClaudeOperationConfig {
  model: string;
  maxTokens: number;
}

export interface NativeOperationConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  domains: DomainEntry[];
  maxTokens: number;
  agentLogPath: string;
  historyLimit: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    fix: number;
    init: number;
  };
  history: RunHistoryEntry[];
  claudeAgent: {
    iclaudePath: string;
    model: string;
    spawnCwd: string;
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
    logDir: string;
    evaluatorModel: string;
  };
}

export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "claude-agent",
  systemPrompt: "",
  domains: [],
  maxTokens: 4096,
  agentLogPath: "",
  historyLimit: 20,
  timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600 },
  history: [],
  claudeAgent: {
    iclaudePath: "",
    model: "sonnet",
    spawnCwd: "/tmp",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku",  maxTokens: 4096 },
      query:  { model: "sonnet", maxTokens: 4096 },
      lint:   { model: "sonnet", maxTokens: 8192 },
      init:   { model: "sonnet", maxTokens: 8192 },
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
    },
  },
  devMode: {
    enabled: false,
    logDir: "",
    evaluatorModel: "sonnet",
  },
};
