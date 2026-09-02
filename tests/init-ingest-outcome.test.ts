import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import type { DomainEntry } from "../src/domain";
import { EmbeddingUnavailableError } from "../src/embedding-error";
import { hashSource } from "../src/incremental-sources";
import type { PageSimilarityService } from "../src/page-similarity";
import type { LlmClient, OnFileError, RunEvent } from "../src/types";
import type { PreparedIngestEvidence } from "../src/phases/ingest";
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

const { runIncrementalReinit, runInit, runInitWithSources } = await import("../src/phases/init");
const { runIngest } = await import("../src/phases/ingest");
const { VaultTools } = await import("../src/vault-tools");

const SOURCE_PATH = "src/a.md";
const SOURCE = "Alpha source fact.";
const STALE_PREPARED_EVIDENCE = "STALE_PREPARED_EVIDENCE_SENTINEL";
const REMAPPED_EVIDENCE = "REMAPPED_EVIDENCE_SENTINEL";
const EXISTING_PATH = "!Wiki/demo/concept/wiki_demo_alpha.md";
const CREATE_PATH = "!Wiki/demo/concept/wiki_demo_created.md";
const INDEX_PATH = "!Wiki/demo/index.jsonl";

type FailureCase = "llm" | "coverage" | "patch" | "write" | "index" | "embedding" | "success";

class MemoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>([[SOURCE_PATH, SOURCE]]);
  failSourceRead = false;
  failPageWrite = false;
  failIndexAfterPageWrite = false;
  pageWritten = false;
  afterWrite?: (path: string, data: string) => void | Promise<void>;

  async read(path: string): Promise<string> {
    if (path === SOURCE_PATH && this.failSourceRead) throw new Error(`synthetic read failure: ${path}`);
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
  async rmdir(): Promise<void> {}
  async rename(from: string, to: string): Promise<void> {
    const matches = [...this.files].filter(([path]) => path === from || path.startsWith(`${from}/`));
    for (const [path, content] of matches) {
      this.files.delete(path);
      this.files.set(`${to}${path.slice(from.length)}`, content);
    }
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = await this.read(path);
    return new TextEncoder().encode(value).buffer;
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new TextDecoder().decode(data));
  }
  async stat(path: string): Promise<{ type: "file" | "folder"; ctime: number; mtime: number; size: number } | null> {
    const value = this.files.get(path);
    if (value !== undefined) {
      return { type: "file", ctime: 0, mtime: 0, size: new TextEncoder().encode(value).length };
    }
    if ([...this.files].some(([file]) => file.startsWith(`${path}/`))) {
      return { type: "folder", ctime: 0, mtime: 0, size: 0 };
    }
    return null;
  }
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

function llmFor(
  mode: FailureCase,
  adapter: MemoryAdapter,
  calls?: Array<{ model: unknown; maxTokens: unknown }>,
): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const request = params as { model?: unknown; max_completion_tokens?: unknown };
      calls?.push({ model: request.model, maxTokens: request.max_completion_tokens });
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

interface HandoffCalls {
  bootstrapMap: number;
  bootstrap: number;
  typeMap: number;
  ingestMap: number;
  synthesis: number;
}

function preparedEvidence(overrides: Partial<PreparedIngestEvidence> = {}): PreparedIngestEvidence {
  return {
    domainId: "demo",
    sourcePath: SOURCE_PATH,
    sourceBodyHash: hashSource(SOURCE),
    evidence: [{
      entityKey: "created",
      entityType: "concept",
      packetIds: ["prepared-packet"],
      facts: [SOURCE],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      exactSource: [{ startLine: 1, endLine: 1, text: SOURCE }],
      links: [],
    }],
    ...overrides,
  };
}

function stalePreparedEvidence(
  overrides: Partial<PreparedIngestEvidence["evidence"][number]> = {},
): PreparedIngestEvidence["evidence"][number] {
  return {
    ...preparedEvidence().evidence[0],
    entityKey: "stale",
    packetIds: ["stale-packet"],
    facts: [STALE_PREPARED_EVIDENCE],
    ...overrides,
  };
}

function handoffLlm(
  adapter: MemoryAdapter,
  calls: HandoffCalls,
  options: {
    failFirstSynthesis?: boolean;
    mutateSourceDuringBootstrap?: boolean;
    directIngest?: boolean;
  } = {},
  synthesisPrompts: string[] = [],
): LlmClient {
  let bootstrapComplete = options.directIngest ?? false;
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = promptText(params);
      if (prompt.includes("EVIDENCE_TYPE_UNITS ")) {
        calls.typeMap += 1;
        const marker = "EVIDENCE_TYPE_UNITS ";
        const encoded = prompt.slice(prompt.lastIndexOf(marker) + marker.length).split("\n", 1)[0];
        const units = JSON.parse(encoded) as Array<{ entityKey: string }>;
        return mockChatResponse(params, JSON.stringify({
          assignments: units.map((unit) => ({ entityKey: unit.entityKey, entityType: "concept" })),
        }));
      }
      if (prompt.includes("CHUNK_ID ")) {
        if (bootstrapComplete) calls.ingestMap += 1;
        else calls.bootstrapMap += 1;
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "created",
            ...(bootstrapComplete ? { entityType: "concept" } : {}),
            facts: [options.directIngest ? REMAPPED_EVIDENCE : SOURCE],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("\"bootstrapEvidence\"")) {
        calls.bootstrap += 1;
        bootstrapComplete = true;
        if (options.mutateSourceDuringBootstrap) {
          adapter.files.set(SOURCE_PATH, "Changed after bootstrap extraction.");
        }
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Derive one source-supported type.",
          id: "demo",
          name: "Demo",
          wiki_folder: "demo",
          entity_types: [{
            type: "concept",
            description: "A concept.",
            extraction_cues: ["Alpha"],
            wiki_subfolder: "concept",
          }],
          language_notes: "",
        }));
      }
      if (prompt.includes("Entity bundle:")) {
        calls.synthesis += 1;
        synthesisPrompts.push(prompt);
        if (options.failFirstSynthesis && calls.synthesis === 1) {
          return streamText(JSON.stringify({ reasoning: "invalid", actions: [] }));
        }
        return streamText(synthesisOutput(prompt, "success", adapter));
      }
      throw new Error("unexpected handoff call");
    } } },
  } as unknown as LlmClient;
}

function emptyHandoffCalls(): HandoffCalls {
  return { bootstrapMap: 0, bootstrap: 0, typeMap: 0, ingestMap: 0, synthesis: 0 };
}

const HANDOFF_OPTS = {
  inputBudgetTokens: 20_000,
  maxTokens: 1_000,
  semanticCompression: { profile: "balanced", operation: "ingest" } as const,
  structuredRetries: 0,
};

async function collect(generator: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

async function runDirectWithPreparedEvidence(
  value: PreparedIngestEvidence,
): Promise<{ events: RunEvent[]; calls: HandoffCalls; synthesisPrompts: string[] }> {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const synthesisPrompts: string[] = [];
  const events = await collect(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls, { directIngest: true }, synthesisPrompts),
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    similarityFor("success"),
    undefined,
    1,
    3,
    undefined,
    value,
  ));
  return { events, calls, synthesisPrompts };
}

test("fresh init enriches bootstrap evidence once and hands it to first-source ingest", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const events = await collect(runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls),
    "mock",
    [],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    undefined,
    false,
    similarityFor("success"),
  ));

  assert.deepEqual(calls, {
    bootstrapMap: 1,
    bootstrap: 1,
    typeMap: 1,
    ingestMap: 0,
    synthesis: 1,
  });
  assert.equal(events.some((event) => event.kind === "error"), false);
  assert.equal(events.filter((event) => event.kind === "domain_created").length, 1);
  assert.equal(events.filter((event) => event.kind === "file_done" && event.file === SOURCE_PATH).length, 1);
});

test("fresh init rejects a source changed during bootstrap enrichment before domain mutation", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const events = await collect(runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls, { mutateSourceDuringBootstrap: true }),
    "mock",
    [],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    undefined,
    false,
    similarityFor("success"),
  ));

  assert.equal(calls.bootstrapMap, 1);
  assert.equal(calls.typeMap, 1);
  assert.equal(calls.ingestMap, 0);
  assert.equal(calls.synthesis, 0);
  assert.equal(events.some((event) =>
    event.kind === "error" && event.message.includes("source changed during bootstrap preflight")), true);
  assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
});

for (const fixture of [
  {
    name: "SaveDomain",
    domains: [] as DomainEntry[],
  },
  {
    name: "UpdateDomain",
    domains: [{ ...domain(), entity_types: [] }],
  },
]) {
  test(`fresh init rechecks source after ${fixture.name} tool handoff before persistence`, async () => {
    const adapter = new MemoryAdapter();
    const calls = emptyHandoffCalls();
    const events: RunEvent[] = [];
    const generator = runInitWithSources(
      "demo",
      ["src"],
      false,
      new VaultTools(adapter, "/vault"),
      handoffLlm(adapter, calls),
      "mock",
      fixture.domains,
      "Vault",
      new AbortController().signal,
      HANDOFF_OPTS,
      undefined,
      false,
      similarityFor("success"),
    );

    for await (const event of generator) {
      events.push(event);
      if (event.kind === "tool_use" && event.name === fixture.name) {
        adapter.files.set(SOURCE_PATH, `Changed during ${fixture.name} controller handoff.`);
      }
    }

    assert.equal(events.filter((event) =>
      event.kind === "tool_use" && event.name === fixture.name).length, 1);
    const errorIndex = events.findIndex((event) =>
      event.kind === "error" && event.message.includes("source changed during bootstrap preflight"));
    assert.ok(errorIndex > 0);
    assert.deepEqual(events[errorIndex - 1], {
      kind: "tool_result",
      ok: false,
      preview: "bootstrap source preflight failed",
    });
    assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
    assert.equal(events.at(-1)?.kind, "error");
    assert.equal(calls.ingestMap, 0);
    assert.equal(calls.synthesis, 0);
  });
}

test("dry-run bootstrap output tokens include evidence map, domain bootstrap, and type enrichment", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const events = await collect(runInitWithSources(
    "demo",
    ["src"],
    true,
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls),
    "mock",
    [],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    undefined,
    false,
    similarityFor("success"),
  ));

  const measuredOutputTokens = events.reduce((sum, event) =>
    sum + (event.kind === "llm_call_stats" ? event.outputTokens : 0), 0);
  const result = events.findLast((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.deepEqual(calls, {
    bootstrapMap: 1,
    bootstrap: 1,
    typeMap: 1,
    ingestMap: 0,
    synthesis: 0,
  });
  assert.equal(measuredOutputTokens, 15);
  assert.equal(result.outputTokens, measuredOutputTokens);
});

test("force init enriches before wipe and reuses first-source bootstrap evidence", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const events = await collect(runInit(
    ["demo", "--force", "--sources", "src"],
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls),
    "mock",
    [domain()],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    undefined,
    similarityFor("success"),
  ));

  assert.deepEqual(calls, {
    bootstrapMap: 1,
    bootstrap: 1,
    typeMap: 1,
    ingestMap: 0,
    synthesis: 1,
  });
  const typeMapIndex = events.findIndex((event) =>
    event.kind === "llm_request_fingerprint" && event.callSite === "init.bootstrap-type-map");
  const wipeIndex = events.findIndex((event) => event.kind === "tool_use" && event.name === "WipeDomain");
  assert.ok(typeMapIndex >= 0 && wipeIndex > typeMapIndex);
  assert.equal(events.some((event) => event.kind === "error"), false);
  assert.equal(events.filter((event) => event.kind === "domain_created").length, 1);
});

test("force init rejects a source changed after bootstrap enrichment before domain mutation", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const events = await collect(runInit(
    ["demo", "--force", "--sources", "src"],
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls, { mutateSourceDuringBootstrap: true }),
    "mock",
    [domain()],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    undefined,
    similarityFor("success"),
  ));

  assert.equal(calls.typeMap, 1, "type enrichment must complete before force preflight mutation boundary");
  assert.equal(calls.ingestMap, 0);
  assert.equal(calls.synthesis, 0);
  assert.equal(events.some((event) =>
    event.kind === "error" && event.message.includes("source changed during bootstrap preflight")), true);
  assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
});

test("matching handoff accepts a normalized vault source path without remapping", async () => {
  const { events, calls } = await runDirectWithPreparedEvidence(preparedEvidence({
    sourcePath: "src/./a.md",
  }));

  assert.equal(calls.ingestMap, 0);
  assert.equal(calls.synthesis, 1);
  assert.equal(events.some((event) =>
    event.kind === "rule_fired" && event.ruleId === "preparedEvidenceFallback"), false);
});

for (const mismatch of [
  {
    name: "domain id",
    value: preparedEvidence({ domainId: "other", evidence: [stalePreparedEvidence()] }),
  },
  {
    name: "source path",
    value: preparedEvidence({ sourcePath: "src/other.md", evidence: [stalePreparedEvidence()] }),
  },
  {
    name: "source body hash",
    value: preparedEvidence({ sourceBodyHash: "stale", evidence: [stalePreparedEvidence()] }),
  },
  {
    name: "unknown entity type",
    value: preparedEvidence({
      evidence: [stalePreparedEvidence({ entityType: "unknown" })],
    }),
  },
  {
    name: "invalid evidence item",
    value: preparedEvidence({
      evidence: [stalePreparedEvidence({ facts: [] })],
    }),
  },
]) {
  test(`prepared evidence ${mismatch.name} mismatch emits metadata fallback and remaps`, async () => {
    const { events, calls, synthesisPrompts } = await runDirectWithPreparedEvidence(mismatch.value);
    assert.equal(calls.ingestMap, 1);
    assert.equal(calls.synthesis, 1);
    assert.equal(synthesisPrompts.length, 1);
    assert.equal(synthesisPrompts[0].includes(REMAPPED_EVIDENCE), true);
    assert.equal(synthesisPrompts[0].includes(STALE_PREPARED_EVIDENCE), false);
    assert.equal(events.filter((event) =>
      event.kind === "rule_fired" && event.ruleId === "preparedEvidenceFallback").length, 1);
  });
}

test("first-source Retry reuses matching prepared evidence without remapping", async () => {
  const adapter = new MemoryAdapter();
  const calls = emptyHandoffCalls();
  const decisions: boolean[] = [];
  const events = await collect(runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    handoffLlm(adapter, calls, { failFirstSynthesis: true }),
    "mock",
    [],
    "Vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    async (_file, _error, canRetry) => {
      decisions.push(canRetry);
      return "retry";
    },
    false,
    similarityFor("success"),
  ));

  assert.deepEqual(decisions, [true]);
  assert.equal(calls.bootstrapMap, 1);
  assert.equal(calls.typeMap, 1);
  assert.equal(calls.ingestMap, 0);
  assert.equal(calls.synthesis, 2);
  assert.equal(events.filter((event) => event.kind === "file_done" && event.file === SOURCE_PATH).length, 1);
});

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
  assert.equal(events.filter((event) =>
    event.kind === "tool_use" && event.name === "UpdateDomain").length, 1);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][SOURCE_PATH], hashSource(SOURCE));
  assert.equal(events.filter((event) => event.kind === "file_done" && event.file === SOURCE_PATH).length, 1);
});

test("full init applies the explicit ingest runtime to child source calls", async () => {
  const adapter = new MemoryAdapter();
  const calls: Array<{ model: unknown; maxTokens: unknown }> = [];
  const events: RunEvent[] = [];
  for await (const event of runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(adapter, "/vault"),
    llmFor("success", adapter, calls),
    "init-model",
    [domain()],
    "Vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 8_000,
      maxTokens: 111,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    undefined,
    false,
    similarityFor("success"),
    undefined,
    {
      model: "ingest-model",
      opts: {
        inputBudgetTokens: 20_000,
        maxTokens: 1_000,
        semanticCompression: { profile: "balanced", operation: "ingest" },
        structuredRetries: 0,
      },
    },
  )) events.push(event);

  assert.equal(events.some((event) => event.kind === "error"), false);
  assert.ok(calls.length >= 2);
  assert.equal(calls.every((call) => call.model === "ingest-model"), true);
  assert.equal(calls.every((call) => call.maxTokens === 1_000), true);
  const budgets = events.filter((event) => event.kind === "prompt_budget");
  assert.ok(budgets.length >= 2);
  assert.equal(budgets.every((event) => event.configuredInputBudget === 20_000), true);
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
): Promise<{ seen: boolean[]; events: RunEvent[] }> {
  const adapter = new MemoryAdapter();
  const currentDomain = failure === "deterministic"
    ? { ...domain(), source_paths: ["src", "inventory"] }
    : domain();
  const ingestMode: FailureCase = failure === "deterministic" ? "success" : "llm";
  if (failure === "deterministic") {
    adapter.files.set("inventory/wiki_demo_created.md", "Reserved source stem.");
  }
  const seen: boolean[] = [];
  const events: RunEvent[] = [];
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
  for await (const event of generator) events.push(event);
  return { seen, events };
}

for (const operation of ["full", "incremental"] as const) {
  test(`${operation} init does not offer retry for retryable:false ingest outcome`, async () => {
    const { seen, events } = await captureRetryability(operation, "deterministic");
    assert.deepEqual(seen, [false]);
    assert.equal(events.some((event) =>
      event.kind === "info_text" && event.summary.includes("Waiting for file error decision")), true);
    assert.equal(events.some((event) =>
      event.kind === "info_text" && event.summary.includes("File error decision: retry")), true);
  });

  test(`${operation} init retains one retry for mapper transport failure`, async () => {
    const { seen } = await captureRetryability(operation, "transport");
    assert.deepEqual(seen, [true, false]);
  });
}

async function runAttemptEventCase(
  operation: "full" | "incremental",
  options: {
    decision?: "skip" | "retry" | "stop";
    recover?: boolean;
    unreadable?: boolean;
    abortOnDecision?: boolean;
    errorMessage?: string;
  },
): Promise<RunEvent[]> {
  const adapter = new MemoryAdapter();
  adapter.failSourceRead = options.unreadable ?? false;
  const calls = emptyHandoffCalls();
  const controller = new AbortController();
  const onFileError: OnFileError = async () => {
    if (options.abortOnDecision) controller.abort();
    return options.decision ?? "skip";
  };
  const llm = options.errorMessage === undefined
    ? options.recover
      ? handoffLlm(adapter, calls, { directIngest: true, failFirstSynthesis: true })
      : llmFor("llm", adapter)
    : {
        chat: { completions: { create: async () => { throw new Error(options.errorMessage); } } },
      } as unknown as LlmClient;
  const currentDomain = domain();
  const generator = operation === "full"
    ? runInitWithSources(
      "demo",
      ["src"],
      false,
      new VaultTools(adapter, "/vault"),
      llm,
      "mock",
      [currentDomain],
      "Vault",
      controller.signal,
      HANDOFF_OPTS,
      onFileError,
      false,
      similarityFor("success"),
    )
    : runIncrementalReinit(
      "demo",
      [SOURCE_PATH],
      new VaultTools(adapter, "/vault"),
      llm,
      "mock",
      [currentDomain],
      controller.signal,
      HANDOFF_OPTS,
      onFileError,
      similarityFor("success"),
    );
  return collect(generator);
}

type FileEvent = Extract<RunEvent, { kind: "file_attempt" | "file_outcome" }>;

function fileEvents(events: RunEvent[]): FileEvent[] {
  return events.filter((event): event is FileEvent =>
    event.kind === "file_attempt" || event.kind === "file_outcome");
}

for (const operation of ["full", "incremental"] as const) {
  test(`${operation} init scopes a recovered Retry to file attempt events`, async () => {
    const events = await runAttemptEventCase(operation, { decision: "retry", recover: true });
    const attempts = fileEvents(events);

    assert.equal(events.some((event) => event.kind === "error"), false);
    assert.equal(events.some((event) => event.kind === "structural_error"), true);
    assert.ok(attempts[0]?.kind === "file_attempt");
    assert.equal(attempts[0].message, "class=IngestOutcomeError category=synthesis");
    assert.deepEqual(attempts.map((event) => {
      if (event.kind !== "file_attempt") return event;
      const { message: _message, ...metadata } = event;
      return metadata;
    }), [
      {
        kind: "file_attempt",
        file: SOURCE_PATH,
        attempt: 1,
        state: "failed",
        retryable: true,
      },
      {
        kind: "file_attempt",
        file: SOURCE_PATH,
        attempt: 2,
        state: "retry_scheduled",
        retryable: true,
      },
      {
        kind: "file_attempt",
        file: SOURCE_PATH,
        attempt: 2,
        state: "recovered",
        retryable: true,
      },
      { kind: "file_outcome", file: SOURCE_PATH, status: "done" },
    ]);
    assert.equal(events.filter((event) => event.kind === "file_done" && event.file === SOURCE_PATH).length, 1);
  });

  test(`${operation} init reports Skip as one skipped file outcome`, async () => {
    const events = await runAttemptEventCase(operation, { decision: "skip" });
    assert.equal(events.some((event) => event.kind === "error"), false);
    assert.deepEqual(fileEvents(events).map((event) =>
      event.kind === "file_attempt" ? [event.state, event.attempt] : [event.status]), [
      ["failed", 1],
      ["skipped"],
    ]);
  });

  test(`${operation} init reports Stop as one stopped file outcome`, async () => {
    const events = await runAttemptEventCase(operation, { decision: "stop" });
    assert.equal(events.some((event) => event.kind === "error"), false);
    assert.deepEqual(fileEvents(events).map((event) =>
      event.kind === "file_attempt" ? [event.state, event.attempt] : [event.status]), [
      ["failed", 1],
      ["stopped"],
    ]);
  });

  test(`${operation} init reports failure after Retry as one exhausted file outcome`, async () => {
    const events = await runAttemptEventCase(operation, { decision: "retry" });
    assert.equal(events.some((event) => event.kind === "error"), false);
    assert.deepEqual(fileEvents(events).map((event) =>
      event.kind === "file_attempt" ? [event.state, event.attempt] : [event.status]), [
      ["failed", 1],
      ["retry_scheduled", 2],
      ["failed", 2],
      ["exhausted"],
    ]);
  });

  test(`${operation} init resolves an unreadable file once as skipped`, async () => {
    const events = await runAttemptEventCase(operation, { unreadable: true });
    assert.deepEqual(fileEvents(events).filter((event) => event.kind === "file_outcome"), [
      { kind: "file_outcome", file: SOURCE_PATH, status: "skipped" },
    ]);
  });

  test(`${operation} init cancellation leaves the active file without an outcome`, async () => {
    const events = await runAttemptEventCase(operation, {
      decision: "retry",
      abortOnDecision: true,
    });
    assert.equal(fileEvents(events).filter((event) => event.kind === "file_outcome").length, 0);
  });

  test(`${operation} init bounds file attempt diagnostics without leaking child errors`, async () => {
    const secret = `SECRET_FILE_ATTEMPT_${operation.toUpperCase()}`;
    const events = await runAttemptEventCase(operation, {
      decision: "skip",
      errorMessage: `${secret}:${"payload".repeat(180_000)}`,
    });
    const relevant = fileEvents(events);
    const failed = relevant[0];

    assert.ok(failed?.kind === "file_attempt");
    assert.equal(failed.state, "failed");
    assert.equal(failed.message, "class=IngestOutcomeError category=evidence");
    assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
    assert.ok(new TextEncoder().encode(failed.message).byteLength <= 128);
    assert.ok(new TextEncoder().encode(JSON.stringify(failed)).byteLength < 1_048_576);
    assert.deepEqual(relevant.map((event) => event.kind === "file_attempt" ? event.state : event.status), [
      "failed",
      "skipped",
    ]);
  });
}

test("direct Ingest keeps an unrecovered child error global", async () => {
  const adapter = new MemoryAdapter();
  const events = await collect(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llmFor("llm", adapter),
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    HANDOFF_OPTS,
    similarityFor("success"),
  ));

  assert.equal(events.some((event) => event.kind === "error"), true);
  assert.equal(fileEvents(events).length, 0);
});
