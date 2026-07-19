import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import type { DomainEntry } from "../src/domain";
import { EmbeddingUnavailableError } from "../src/embedding-error";
import { hashSource } from "../src/incremental-sources";
import type { PageSimilarityService } from "../src/page-similarity";
import type { LlmClient, RunEvent } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";
import { mockChatResponse } from "./openai-mock-response";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { runIncrementalReinit, runInitWithSources } = await import("../src/phases/init");
const { VaultTools } = await import("../src/vault-tools");

const SOURCE_PATH = "src/a.md";
const SOURCE = "Alpha source fact.";
const EXISTING_PATH = "!Wiki/demo/concept/wiki_demo_alpha.md";
const CREATE_PATH = "!Wiki/demo/concept/wiki_demo_created.md";
const INDEX_PATH = "!Wiki/demo/index.jsonl";

type FailureCase = "llm" | "coverage" | "patch" | "write" | "index" | "embedding" | "success";

class MemoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>([[SOURCE_PATH, SOURCE]]);
  failPageWrite = false;
  failIndexAfterPageWrite = false;
  pageWritten = false;
  afterWrite?: (path: string, data: string) => void | Promise<void>;

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> {
    if (path === CREATE_PATH && this.failPageWrite) throw new Error("synthetic page write failure");
    if (path === CREATE_PATH) this.pageWritten = true;
    if (path === INDEX_PATH && this.failIndexAfterPageWrite && this.pageWritten) {
      throw new Error("synthetic index write failure");
    }
    this.files.set(path, data);
    await this.afterWrite?.(path, data);
  }
  async append(path: string, data: string): Promise<void> { this.files.set(path, (this.files.get(path) ?? "") + data); }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || path === "src"
      || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }
  async mkdir(): Promise<void> {}
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path ? `${path}/` : "";
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash < 0) files.push(file);
      else folders.add(`${prefix}${remainder.slice(0, slash)}`);
    }
    return { files, folders: [...folders] };
  }
}

function streamText(content: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "content", object: "chat.completion.chunk", created: 0, model: "mock",
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
    yield {
      id: "usage", object: "chat.completion.chunk", created: 0, model: "mock", choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}

function promptText(params: unknown): string {
  return (params as { messages: Array<{ content?: unknown }> }).messages
    .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))
    .join("\n");
}

function mapperOutput(prompt: string, mode: FailureCase): string {
  const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
  assert.ok(chunkId);
  if (mode === "coverage") return JSON.stringify({ packets: [], noEvidence: [] });
  return JSON.stringify({
    packets: [{
      id: `packet-${chunkId}`,
      chunkId,
      entityKey: mode === "patch" ? "alpha" : "created",
      entityType: "concept",
      facts: ["Alpha source fact."],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      links: [],
      sourceAnchor: `${SOURCE_PATH}:1`,
    }],
    noEvidence: [],
  });
}

function synthesisOutput(prompt: string, mode: FailureCase, adapter: MemoryAdapter): string {
  if (mode === "patch") {
    const pageHash = prompt.match(/"pageHash":\s*"([^"]+)"/)?.[1];
    const sectionHash = prompt.match(/"sectionHash":\s*"([^"]+)"/)?.[1];
    const ordinal = Number(prompt.match(/"sectionOrdinal":\s*(\d+)/)?.[1]);
    assert.ok(pageHash && sectionHash && Number.isInteger(ordinal));
    adapter.files.set(EXISTING_PATH, adapter.files.get(EXISTING_PATH)!.replace("Old fact.", "Concurrent fact."));
    return JSON.stringify({
      reasoning: "Patch.",
      actions: [{
        kind: "patch",
        entityKey: "alpha",
        path: EXISTING_PATH,
        expectedPageHash: pageHash,
        sections: [{
          heading: "## Facts",
          operation: "replace",
          expectedSectionHash: sectionHash,
          expectedSectionOrdinal: ordinal,
          content: "New fact.",
        }],
      }],
      skips: [],
      entity_types_delta: [],
    });
  }
  return JSON.stringify({
    reasoning: "Create.",
    actions: [{
      kind: "create",
      entityKey: "created",
      path: CREATE_PATH,
      annotation: "Created concept.",
      content: "# Created\n\n## Facts\nAlpha source fact.\n",
    }],
    skips: [],
    entity_types_delta: [],
  });
}

function llmFor(mode: FailureCase, adapter: MemoryAdapter): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = promptText(params);
      if (prompt.includes("CHUNK_ID ")) {
        if (mode === "llm") throw new Error("synthetic mapper transport failure");
        return mockChatResponse(params, mapperOutput(prompt, mode));
      }
      if (prompt.includes("Regenerate exactly one guarded patch")) {
        throw new Error("synthetic conflict regeneration failure");
      }
      if (prompt.includes("Entity bundle:")) {
        return streamText(synthesisOutput(prompt, mode, adapter));
      }
      throw new Error("unexpected unbounded ingest call");
    } } },
  } as unknown as LlmClient;
}

function domain(): DomainEntry {
  return {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    analyzed_sources: {},
    pageNameVersion: 1,
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["Alpha"],
      wiki_subfolder: "concept",
    }],
  };
}

function similarityFor(mode: FailureCase): PageSimilarityService {
  return {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [
        `${entity.name}::${entity.type ?? ""}`,
        mode === "patch" ? [EXISTING_PATH] : [],
      ])),
      allFailed: false,
    }),
    refreshCache: async () => {
      if (mode === "embedding") throw new EmbeddingUnavailableError("synthetic embedding failure");
      return { updated: 1, failed: 0 };
    },
    setJaccardCorpus: () => {},
    maxSimilarityToExisting: async () => ({ pid: "", score: 0 }),
  } as unknown as PageSimilarityService;
}

async function runCase(mode: FailureCase): Promise<RunEvent[]> {
  const adapter = new MemoryAdapter();
  adapter.failPageWrite = mode === "write";
  adapter.failIndexAfterPageWrite = mode === "index";
  if (mode === "patch") {
    adapter.files.set(EXISTING_PATH, [
      "---",
      "type: concept",
      "description: Alpha.",
      "resource: [a]",
      "---",
      "# Alpha",
      "",
      "## Facts",
      "Old fact.",
      "",
    ].join("\n"));
  }
  const events: RunEvent[] = [];
  for await (const event of runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    llmFor(mode, adapter),
    "mock",
    [domain()],
    "Vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    false,
    similarityFor(mode),
  )) {
    events.push(event);
  }
  return events;
}

function analyzedPatches(events: RunEvent[]): Record<string, string>[] {
  return events.flatMap((event) =>
    event.kind === "domain_updated" && event.patch.analyzed_sources
      ? [event.patch.analyzed_sources]
      : []);
}

for (const mode of ["llm", "coverage", "patch", "write", "index", "embedding"] as const) {
  test(`init keeps source resumable after ${mode} failure`, async () => {
    const events = await runCase(mode);
    const patches = analyzedPatches(events);
    assert.equal(patches.some((patch) => SOURCE_PATH in patch), false);
    assert.equal(events.some((event) => event.kind === "file_done" && event.file === SOURCE_PATH), false);
  });
}

test("init summary counts only successful source outcomes", async () => {
  const events = await runCase("write");
  const result = events.findLast((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.match(result.text, /0 of 1 source/i);
});

test("init records a successful source hash exactly once", async () => {
  const events = await runCase("success");
  const patches = analyzedPatches(events).filter((patch) => SOURCE_PATH in patch);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][SOURCE_PATH], hashSource(SOURCE));
  assert.equal(events.filter((event) => event.kind === "file_done" && event.file === SOURCE_PATH).length, 1);
});

test("incremental re-init replaces an existing source hash after successful ingest", async () => {
  const adapter = new MemoryAdapter();
  const currentDomain = {
    ...domain(),
    analyzed_sources: { [SOURCE_PATH]: "stale-hash" },
  };
  const events: RunEvent[] = [];
  for await (const event of runIncrementalReinit(
    "demo",
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llmFor("success", adapter),
    "mock",
    [currentDomain],
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    similarityFor("success"),
  )) {
    events.push(event);
  }

  const patches = analyzedPatches(events).filter((patch) => SOURCE_PATH in patch);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][SOURCE_PATH], hashSource(adapter.files.get(SOURCE_PATH)!));
  assert.notEqual(patches[0][SOURCE_PATH], "stale-hash");
  assert.equal(events.filter((event) => event.kind === "file_done").length, 1);
});

test("incremental re-init preserves an existing source hash after failed ingest", async () => {
  const adapter = new MemoryAdapter();
  const currentDomain = {
    ...domain(),
    analyzed_sources: { [SOURCE_PATH]: "stale-hash" },
  };
  const events: RunEvent[] = [];
  for await (const event of runIncrementalReinit(
    "demo",
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llmFor("embedding", adapter),
    "mock",
    [currentDomain],
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    similarityFor("embedding"),
  )) {
    events.push(event);
  }

  assert.equal(analyzedPatches(events).some((patch) => patch[SOURCE_PATH] !== "stale-hash"), false);
  assert.equal(events.some((event) => event.kind === "file_done"), false);
});

test("full init records the processed outcome hash when source changes after backlink write", async () => {
  const adapter = new MemoryAdapter();
  const concurrentSource = "Concurrent edit after backlink.";
  adapter.afterWrite = (path) => {
    if (path === SOURCE_PATH) {
      adapter.files.set(SOURCE_PATH, concurrentSource);
    }
  };
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    llmFor("success", adapter),
    "mock",
    [domain()],
    "Vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    false,
    similarityFor("success"),
  )) events.push(event);

  const patches = analyzedPatches(events).filter((patch) => SOURCE_PATH in patch);
  assert.equal(adapter.files.get(SOURCE_PATH), concurrentSource);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][SOURCE_PATH], hashSource(SOURCE));
  assert.notEqual(patches[0][SOURCE_PATH], hashSource(concurrentSource));
});

test("incremental eval metadata counts completed sources instead of requested changes", async () => {
  const adapter = new MemoryAdapter();
  const currentDomain = {
    ...domain(),
    analyzed_sources: {},
  };
  const events: RunEvent[] = [];
  for await (const event of runIncrementalReinit(
    "demo",
    [SOURCE_PATH, "src/missing.md"],
    new VaultTools(adapter, "/vault"),
    llmFor("success", adapter),
    "mock",
    [currentDomain],
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    async () => "skip",
    similarityFor("success"),
  )) events.push(event);

  const evalEvent = events.findLast((event) => event.kind === "eval_meta");
  assert.ok(evalEvent && evalEvent.kind === "eval_meta");
  assert.equal(evalEvent.fields.files_processed, 1);
});

test("incremental init records the processed outcome hash when source changes after backlink write", async () => {
  const adapter = new MemoryAdapter();
  const concurrentSource = "Concurrent incremental edit after backlink.";
  adapter.afterWrite = (path) => {
    if (path === SOURCE_PATH) {
      adapter.files.set(SOURCE_PATH, concurrentSource);
    }
  };
  const currentDomain = {
    ...domain(),
    analyzed_sources: { [SOURCE_PATH]: "stale-hash" },
  };
  const events: RunEvent[] = [];

  for await (const event of runIncrementalReinit(
    "demo",
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llmFor("success", adapter),
    "mock",
    [currentDomain],
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    similarityFor("success"),
  )) events.push(event);

  const patches = analyzedPatches(events).filter((patch) => SOURCE_PATH in patch);
  assert.equal(adapter.files.get(SOURCE_PATH), concurrentSource);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][SOURCE_PATH], hashSource(SOURCE));
  assert.notEqual(patches[0][SOURCE_PATH], hashSource(concurrentSource));
});

async function captureRetryability(
  operation: "full" | "incremental",
  failure: "deterministic" | "transport",
): Promise<boolean[]> {
  const adapter = new MemoryAdapter();
  const currentDomain = failure === "deterministic"
    ? { ...domain(), source_paths: ["src", "inventory"] }
    : domain();
  const ingestMode: FailureCase = failure === "deterministic" ? "success" : "llm";
  if (failure === "deterministic") {
    adapter.files.set("inventory/wiki_demo_created.md", "Reserved source stem.");
  }
  const seen: boolean[] = [];
  const onFileError = async (_file: string, _error: Error, canRetry: boolean) => {
    seen.push(canRetry);
    return "retry" as const;
  };
  const generator = operation === "full"
    ? runInitWithSources(
      "demo",
      ["src"],
      false,
      new VaultTools(adapter, "/vault"),
      llmFor(ingestMode, adapter),
      "mock",
      [currentDomain],
      "Vault",
      new AbortController().signal,
      { structuredRetries: 0 },
      onFileError,
      false,
      similarityFor(ingestMode),
    )
    : runIncrementalReinit(
      "demo",
      [SOURCE_PATH],
      new VaultTools(adapter, "/vault"),
      llmFor(ingestMode, adapter),
      "mock",
      [currentDomain],
      new AbortController().signal,
      { structuredRetries: 0 },
      onFileError,
      similarityFor(ingestMode),
    );
  for await (const _ of generator) { /* drain */ }
  return seen;
}

for (const operation of ["full", "incremental"] as const) {
  test(`${operation} init does not offer retry for retryable:false ingest outcome`, async () => {
    assert.deepEqual(await captureRetryability(operation, "deterministic"), [false]);
  });

  test(`${operation} init retains one retry for mapper transport failure`, async () => {
    assert.deepEqual(await captureRetryability(operation, "transport"), [true, false]);
  });
}
