import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { contentHash } from "../src/content-hash";
import type { DomainEntry } from "../src/domain";
import { hashSource } from "../src/incremental-sources";
import type { PageSimilarityService } from "../src/page-similarity";
import type { IngestOutcome, LlmClient, RunEvent } from "../src/types";
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

const { PageSimilarityService } = await import("../src/page-similarity");
const { EmbeddingUnavailableError } = await import("../src/embedding-error");
const { TransactionVaultTools } = await import("../src/file-transaction");
const { runIngest } = await import("../src/phases/ingest");
const { parseResourceFromFm } = await import("../src/utils/raw-frontmatter");
const { VaultTools } = await import("../src/vault-tools");
const { upsertPageIndex } = await import("../src/wiki-index-store");

const SOURCE_PATH = "src/source.md";
const PAGE_PATH = "!Wiki/demo/concept/wiki_demo_alpha.md";
const INDEX_PATH = "!Wiki/demo/index.jsonl";
const VECTOR_SENTINEL = "987654321.125";

class MemoryAdapter implements VaultAdapter {
  readonly writes: string[] = [];

  constructor(
    readonly files: Map<string, string>,
    private readonly afterWrite?: (path: string, data: string) => void | Promise<void>,
    private readonly beforeList?: (path: string) => void | Promise<void>,
    private readonly beforeRead?: (path: string) => void | Promise<void>,
  ) {}

  async read(path: string): Promise<string> {
    await this.beforeRead?.(path);
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.writes.push(path);
    await this.afterWrite?.(path, data);
  }
  async append(path: string, data: string): Promise<void> { this.files.set(path, (this.files.get(path) ?? "") + data); }
  async exists(path: string): Promise<boolean> {
    return path === "" || this.files.has(path)
      || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }
  async mkdir(): Promise<void> {}
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    await this.beforeList?.(path);
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function messageText(params: unknown): string {
  const messages = (params as { messages: Array<{ content?: unknown }> }).messages;
  return messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
}

function capturingLlm(prompts: string[]): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      prompts.push(prompt);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "alpha",
            entityType: "concept",
            facts: ["Alpha is covered by the source."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Entity bundle: entity-alpha")) {
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Existing page already covers the evidence.",
          actions: [],
          skips: [{ entityKey: "alpha", reason: "No change required." }],
          entity_types_delta: [],
        }));
      }
      throw new Error("unexpected unbounded ingest call");
    } } },
  } as unknown as LlmClient;
}

async function drain(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
): Promise<{ events: RunEvent[]; outcome: IngestOutcome }> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, outcome: next.value };
    events.push(next.value);
  }
}

function domain(): DomainEntry {
  return {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    pageNameVersion: 1,
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["Alpha"],
      wiki_subfolder: "concept",
    }],
  };
}

async function runMultiBatchDeltaCase(
  conflicting: boolean,
  mismatchedRoute: boolean = false,
): Promise<{
  adapter: MemoryAdapter;
  events: RunEvent[];
  outcome: IngestOutcome;
  synthesisPrompts: string[];
}> {
  const sourcePath = "src/multi-batch.md";
  const source = [
    `ALPHA ${"a".repeat(18_000)}`,
    `BETA ${"b".repeat(18_000)}`,
  ].join("\n");
  const adapter = new MemoryAdapter(new Map([[sourcePath, source]]));
  const synthesisPrompts: string[] = [];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        const mappedLines = [...prompt.matchAll(/^CHUNK_LINE (\d+) \| (.*)$/gm)];
        const packets = mappedLines.flatMap((match) => {
          const entityKey = match[2].startsWith("ALPHA")
            ? "alpha"
            : match[2].startsWith("BETA")
              ? "beta"
              : undefined;
          if (entityKey === undefined) return [];
          return [{
            id: `packet-${entityKey}`,
            chunkId,
            entityKey,
            entityType: "concept",
            facts: [`${entityKey} fact`],
            exactSourceRanges: [{ startLine: Number(match[1]), endLine: Number(match[1]) }],
            links: [],
            sourceAnchor: `${sourcePath}:${match[1]}`,
          }];
        });
        return mockChatResponse(params, JSON.stringify({ packets, noEvidence: [] }));
      }
      const entityKeys = ["alpha", "beta"].filter((key) =>
        prompt.includes(`Entity bundle: entity-${key}`));
      if (entityKeys.length > 0) {
        synthesisPrompts.push(prompt);
        return mockChatResponse(params, JSON.stringify({
          reasoning: `Create ${entityKeys.join(", ")}.`,
          actions: entityKeys.map((entityKey) => ({
            kind: "create",
            entityKey,
            path: `!Wiki/demo/concept/wiki_demo_${mismatchedRoute ? `wrong_${entityKey}` : entityKey}.md`,
            annotation: `${entityKey} concept.`,
            content: [
              "---",
              "type: concept",
              `description: ${entityKey} concept.`,
              "resource: [multi-batch]",
              "---",
              `# ${entityKey}`,
              "",
              "## Facts",
              `${entityKey} fact`,
              "",
            ].join("\n"),
          })),
          skips: [],
          entity_types_delta: entityKeys.map((entityKey) => ({
            type: entityKey === "alpha" ? " Shared " : "shared",
            description: conflicting && entityKey === "beta" ? "Conflicting type." : "Shared type.",
            extraction_cues: [" cue "],
          })),
        }));
      }
      throw new Error("unexpected multi-batch call");
    } } },
  } as unknown as LlmClient;
  const result = await drain(runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 35_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));
  return { adapter, ...result, synthesisPrompts };
}

async function runPageWriteRace(kind: "create" | "patch"): Promise<{
  adapter: MemoryAdapter;
  outcome: IngestOutcome;
  events: RunEvent[];
  targetPath: string;
  concurrentContent: string;
  mutated: boolean;
}> {
  const targetPath = kind === "create"
    ? "!Wiki/demo/concept/wiki_demo_create_race.md"
    : PAGE_PATH;
  const source = `${kind} race source fact.`;
  const originalPage = [
    "---",
    "type: concept",
    "description: Race page.",
    "resource: [old-source]",
    "---",
    "# Race",
    "",
    "## Facts",
    "Old fact.",
    "",
  ].join("\n");
  const concurrentContent = kind === "create"
    ? "# Concurrent owner\n\n## Facts\nDo not overwrite.\n"
    : originalPage.replace("Old fact.", "Concurrent fact.");
  const files = new Map<string, string>([
    [SOURCE_PATH, source],
    ...(kind === "patch" ? [[targetPath, originalPage] as const] : []),
  ]);
  let mutated = false;
  const adapter = new MemoryAdapter(files, undefined, (path) => {
    if (path === "" && !mutated) {
      mutated = true;
      files.set(targetPath, concurrentContent);
    }
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: kind === "create" ? "create-race" : "alpha",
            entityType: "concept",
            facts: [source],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (kind === "patch") {
        const pageHash = prompt.match(/"pageHash":\s*"([^"]+)"/)?.[1];
        const sectionHash = prompt.match(/"sectionHash":\s*"([^"]+)"/)?.[1];
        assert.ok(pageHash && sectionHash);
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Patch prepared snapshot.",
          actions: [{
            kind: "patch",
            entityKey: "alpha",
            path: targetPath,
            expectedPageHash: pageHash,
            sections: [{
              heading: "## Facts",
              operation: "append",
              expectedSectionHash: sectionHash,
              content: "New race fact.",
            }],
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Create prepared path.",
        actions: [{
          kind: "create",
          entityKey: "create-race",
          path: targetPath,
          annotation: "Create race.",
          content: "# Create Race\n\n## Facts\nCreate race source fact.\n",
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [
        `${entity.name}::${entity.type ?? ""}`,
        kind === "patch" ? [targetPath] : [],
      ])),
      allFailed: false,
    }),
    refreshCache: async () => ({ updated: 0, failed: 0 }),
  } as unknown as PageSimilarityService;
  const result = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    similarity,
  ));
  return { adapter, ...result, targetPath, concurrentContent, mutated };
}

async function runInventoryFailure(failingPath: "src" | ""): Promise<{
  adapter: MemoryAdapter;
  outcome: IngestOutcome;
}> {
  const targetPath = "!Wiki/demo/concept/wiki_demo_inventory.md";
  const adapter = new MemoryAdapter(
    new Map([[SOURCE_PATH, "Inventory source fact."]]),
    undefined,
    (path) => {
      if (path === failingPath) throw new Error(`EACCES: inventory ${path || "vault"}`);
    },
  );
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "inventory",
            entityType: "concept",
            facts: ["Inventory source fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Create inventory page.",
        actions: [{
          kind: "create",
          entityKey: "inventory",
          path: targetPath,
          annotation: "Inventory concept.",
          content: [
            "---",
            "type: concept",
            "description: Inventory concept.",
            "resource: [source]",
            "---",
            "# Inventory",
            "",
            "## Facts",
            "Inventory source fact.",
            "",
          ].join("\n"),
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const { outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));
  assert.equal(adapter.files.has(targetPath), false);
  assert.equal(adapter.writes.includes(targetPath), false);
  return { adapter, outcome };
}

function mergePage(input: {
  resource: string;
  aliases?: string[];
  tags?: string[];
  preamble?: string;
  facts: string;
  links?: string;
  sources?: string;
}): string {
  return [
    "---",
    "type: concept",
    "description: Shared merge page.",
    `resource: [${input.resource}]`,
    ...(input.aliases ? [`aliases: [${input.aliases.join(", ")}]`] : []),
    ...(input.tags ? [`tags: [${input.tags.join(", ")}]`] : []),
    "---",
    "# Shared Merge",
    ...(input.preamble ? ["", input.preamble] : []),
    "",
    "## Facts",
    input.facts,
    ...(input.links ? ["", "## Related", input.links] : []),
    ...(input.sources ? ["", "## Sources", input.sources] : []),
    "",
  ].join("\n");
}

async function runCanonicalKnowledgeCase(
  canonical: string,
  duplicate: string,
  failDuplicateIndexRemoval = false,
  afterDuplicateIndexRemoval?: (files: Map<string, string>) => void,
  queueUnrelatedIndexTransform = false,
): Promise<{
  adapter: MemoryAdapter;
  duplicatePath: string;
  outcome: IngestOutcome;
  rerun: () => Promise<IngestOutcome>;
}> {
  const duplicatePath = "!Wiki/demo/concept/wiki_demo_knowledge_duplicate.md";
  const draftPath = "!Wiki/demo/concept/wiki_demo_knowledge.md";
  const source = "Incoming merge fact.";
  const index = [{
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: PAGE_PATH,
    type: "concept",
    description: "Shared merge page.",
    resource: ["old-source"],
    bodyHash: "canonical",
    descriptionHash: "canonical-description",
  }, {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_knowledge_duplicate",
    path: duplicatePath,
    type: "concept",
    description: "Shared merge page.",
    resource: ["duplicate-old"],
    bodyHash: "duplicate",
    descriptionHash: "duplicate-description",
  }, {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_demo_knowledge_duplicate",
    path: duplicatePath,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "duplicate",
    embedTextHash: "duplicate-embed",
    vector: [0.1],
    vectorModel: "mock",
    dimensions: 1,
    updatedAt: "2026-07-17T00:00:00.000Z",
  }].map((record) => JSON.stringify(record)).join("\n") + "\n";
  const files = new Map([
    [SOURCE_PATH, source],
    ["src/old-source.md", "Old source."],
    ["src/duplicate-old.md", "Duplicate old source."],
    [PAGE_PATH, canonical],
    [duplicatePath, duplicate],
    [INDEX_PATH, index],
  ]);
  let rejectIndexRemoval = failDuplicateIndexRemoval;
  let lastIndex = index;
  let queuedIndexTransform: Promise<void> | undefined;
  let pageRaceArmed = false;
  let adapter!: MemoryAdapter;
  adapter = new MemoryAdapter(files, (path, data) => {
    if (path !== INDEX_PATH) return;
    if (rejectIndexRemoval
      && !data.includes('"articleId":"wiki_demo_knowledge_duplicate"')
      && files.has(duplicatePath)) {
      rejectIndexRemoval = false;
      files.set(INDEX_PATH, lastIndex);
      throw new Error("synthetic duplicate index removal failure");
    }
    if (!data.includes('"articleId":"wiki_demo_knowledge_duplicate"')
      && files.has(duplicatePath)) {
      afterDuplicateIndexRemoval?.(files);
      if (queueUnrelatedIndexTransform && queuedIndexTransform === undefined) {
        pageRaceArmed = true;
        queuedIndexTransform = upsertPageIndex(
          new VaultTools(adapter, "/vault"),
          "!Wiki/demo",
          {
            kind: "page",
            schemaVersion: 1,
            articleId: "wiki_demo_concurrent",
            path: "!Wiki/demo/concept/wiki_demo_concurrent.md",
            type: "concept",
            description: "Concurrent unrelated page.",
            resource: ["concurrent-source"],
            bodyHash: "concurrent-body",
            descriptionHash: "concurrent-description",
          },
        );
      }
    }
    lastIndex = data;
  }, undefined, async (path) => {
    if (path !== duplicatePath || !pageRaceArmed || queuedIndexTransform === undefined) return;
    pageRaceArmed = false;
    await queuedIndexTransform;
    files.set(duplicatePath, `${files.get(duplicatePath)}Concurrent queued-index race.\n`);
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "knowledge",
            entityType: "concept",
            facts: [source],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Regenerate exactly one guarded patch")) {
        const pageHash = prompt.match(/Fresh page hash: ([^\s]+)/)?.[1];
        const sectionHash = prompt.match(/"sectionHash": "([^"]+)"/)?.[1];
        assert.ok(pageHash && sectionHash);
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Merge incoming evidence.",
          actions: [{
            kind: "patch",
            entityKey: "knowledge",
            path: PAGE_PATH,
            expectedPageHash: pageHash,
            sections: [{
              heading: "## Facts",
              operation: "append",
              expectedSectionHash: sectionHash,
              content: source,
            }],
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Draft merge candidate.",
        actions: [{
          kind: "create",
          entityKey: "knowledge",
          path: draftPath,
          annotation: "Shared merge page.",
          content: "# Draft\n\n## Facts\nIncoming merge fact.\n",
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const runOnce = async (): Promise<IngestOutcome> => {
    let hit = 0;
    const similarity = {
      config: { mode: "jaccard", topK: 5 },
      loadCache: async () => {},
      selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
        results: new Map(entities.map((entity) => [`${entity.name}::${entity.type ?? ""}`, []])),
        allFailed: false,
      }),
      setJaccardCorpus: () => {},
      maxSimilarityToExisting: async () => {
        hit++;
        if (hit === 1) return { pid: "wiki_demo_alpha", score: 0.99 };
        if (hit === 2) return { pid: "wiki_demo_knowledge_duplicate", score: 0.98 };
        return { pid: "", score: 0 };
      },
      refreshCache: async () => ({ updated: 0, failed: 0 }),
    } as unknown as PageSimilarityService;
    return (await drain(runIngest(
      [SOURCE_PATH],
      new VaultTools(adapter, "/vault"),
      llm,
      "mock",
      [domain()],
      "/vault",
      new AbortController().signal,
      {
        inputBudgetTokens: 20_000,
        maxTokens: 1_000,
        semanticCompression: { profile: "balanced", operation: "ingest" },
        structuredRetries: 0,
        dedupOnIngest: true,
        dedupThreshold: 0.85,
      },
      similarity,
    ))).outcome;
  };
  const outcome = await runOnce();
  return { adapter, duplicatePath, outcome, rerun: runOnce };
}

test("bounded ingest never exposes raw chunk vectors and emits in-budget telemetry", async () => {
  const source = "Alpha is covered by the source.";
  const page = [
    "---",
    "type: concept",
    "description: Alpha concept.",
    "resource: [source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Alpha is covered by the source.",
    "",
  ].join("\n");
  const pageRecord = {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: PAGE_PATH,
    type: "concept",
    description: "Alpha concept.",
    resource: ["source"],
    bodyHash: "stale-body",
    descriptionHash: "stale-description",
  };
  const vector = Array.from({ length: 230_000 }, (_, index) =>
    index === 229_999 ? Number(VECTOR_SENTINEL) : 0.125);
  const chunkRecord = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: PAGE_PATH,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector,
    vectorModel: "mock-embed",
    dimensions: vector.length,
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  const index = `${JSON.stringify(pageRecord)}\n${JSON.stringify(chunkRecord)}\n`;
  assert.ok(Buffer.byteLength(index) > 1.27 * 1024 * 1024);

  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, source],
    [PAGE_PATH, page],
    [INDEX_PATH, index],
  ]));
  const prompts: string[] = [];
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: 5 });
  const { events, outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    capturingLlm(prompts),
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    similarity,
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (outcome.ok) assert.ok(outcome.outputTokens > 0);
  assert.equal(prompts.some((prompt) => prompt.includes(VECTOR_SENTINEL)), false);
  assert.equal(prompts.some((prompt) => prompt.includes('"kind":"chunk"')), false);
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length > 0, true);
  assert.equal(budgetEvents.every((event) =>
    event.estimatedInputTokens <= event.effectiveInputBudget), true);
  const synthesisLifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages");
  assert.equal(new Set(synthesisLifecycle.map((event) => event.id)).size, 1);
  assert.deepEqual(synthesisLifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "applying", "completed",
  ]);
  const indexEffects = events.filter((event) => event.kind === "index_effect");
  assert.deepEqual(indexEffects, [
    {
      kind: "index_effect",
      domainId: "demo",
      sourcePath: SOURCE_PATH,
      stage: "page_reconcile",
    },
    {
      kind: "index_effect",
      domainId: "demo",
      sourcePath: SOURCE_PATH,
      stage: "final_reconcile",
    },
  ]);
});

test("Ingest abort after synthesis validation cancels once and performs no later write", async () => {
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, "Alpha source fact."]]));
  const controller = new AbortController();
  const generator = runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    capturingLlm([]),
    "mock",
    [domain()],
    "/vault",
    controller.signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  );
  const events: RunEvent[] = [];
  let writesAtAbort = 0;
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (next.done) break;
    events.push(next.value);
    if (next.value.kind === "llm_lifecycle"
      && next.value.action === "synthesize_wiki_pages"
      && next.value.phase === "validating") {
      writesAtAbort = adapter.writes.length;
      controller.abort();
      break;
    }
  }
  for await (const event of generator) events.push(event);

  assert.equal(adapter.writes.length, writesAtAbort);
  const lifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages");
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "cancelled",
  ], JSON.stringify(events));
  assert.equal(lifecycle.filter((event) =>
    ["completed", "failed", "cancelled"].includes(event.phase)).length, 1);
});

test("runIngest deterministically merges equivalent deltas from multiple top-level synthesis batches", async () => {
  const { adapter, events, outcome, synthesisPrompts } = await runMultiBatchDeltaCase(false);

  assert.equal(synthesisPrompts.length >= 2, true, `synthesis calls: ${synthesisPrompts.length}`);
  assert.equal(synthesisPrompts.every((prompt) =>
    Number(prompt.includes("Entity bundle: entity-alpha"))
      + Number(prompt.includes("Entity bundle: entity-beta")) === 1), true);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has("!Wiki/demo/concept/wiki_demo_alpha.md"), true);
  assert.equal(adapter.files.has("!Wiki/demo/concept/wiki_demo_beta.md"), true);
  const updates = events.filter((event) => event.kind === "domain_updated");
  assert.equal(updates.length, 1);
  if (updates[0]?.kind === "domain_updated") {
    const shared = updates[0].patch.entity_types?.filter((entityType) => entityType.type === "shared");
    assert.equal(shared?.length, 1);
    assert.equal(shared?.[0].description, "Shared type.");
    assert.deepEqual(shared?.[0].extraction_cues, ["cue"]);
  }
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length > 0, true);
  assert.equal(budgetEvents.every((event) =>
    event.estimatedInputTokens <= event.effectiveInputBudget), true);
  const lifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages");
  for (const id of new Set(lifecycle.map((event) => event.id))) {
    assert.deepEqual(
      lifecycle.filter((event) => event.id === id).map((event) => event.phase),
      ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
    );
  }
  const firstWriteUse = events.findIndex((event) =>
    event.kind === "tool_use" && (event.name === "Create" || event.name === "Update"));
  const firstApplying = events.findIndex((event) =>
    event.kind === "llm_lifecycle"
    && event.action === "synthesize_wiki_pages"
    && event.phase === "applying");
  assert.ok(firstApplying > firstWriteUse);
});

test("runIngest rejects conflicting normalized deltas across top-level batches before page writes", async () => {
  const { adapter, events, outcome, synthesisPrompts } = await runMultiBatchDeltaCase(true);

  assert.equal(synthesisPrompts.length >= 2, true, `synthesis calls: ${synthesisPrompts.length}`);
  assert.equal(synthesisPrompts.every((prompt) =>
    Number(prompt.includes("Entity bundle: entity-alpha"))
      + Number(prompt.includes("Entity bundle: entity-beta")) === 1), true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.stage, "synthesis");
    assert.match(outcome.message, /conflicting entity type delta: shared/);
  }
  assert.equal(adapter.files.has("!Wiki/demo/concept/wiki_demo_alpha.md"), false);
  assert.equal(adapter.files.has("!Wiki/demo/concept/wiki_demo_beta.md"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_use"
    && (event.input as { path?: string }).path?.match(/wiki_demo_(?:alpha|beta)\.md/)), false);
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length > 0, true);
  assert.equal(budgetEvents.every((event) =>
    event.estimatedInputTokens <= event.effectiveInputBudget), true);
  const lifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages");
  for (const id of new Set(lifecycle.map((event) => event.id))) {
    const phases = lifecycle.filter((event) => event.id === id).map((event) => event.phase);
    assert.deepEqual(phases, [
      "preparing", "sent", "waiting", "producing", "validating", "failed",
    ]);
    assert.equal(phases.filter((phase) => phase === "failed").length, 1);
  }
});

test("runIngest closes validated synthesis lifecycles on strict routing rejection", async () => {
  const { adapter, events, outcome } = await runMultiBatchDeltaCase(false, true);

  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.stage, "patch");
    assert.match(outcome.message, /strict type routing/);
  }
  assert.equal(adapter.writes.some((path) => path.match(/wiki_demo_wrong_/)), false);
  const lifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages");
  assert.ok(lifecycle.length > 0);
  for (const id of new Set(lifecycle.map((event) => event.id))) {
    const phases = lifecycle.filter((event) => event.id === id).map((event) => event.phase);
    assert.deepEqual(phases, [
      "preparing", "sent", "waiting", "producing", "validating", "failed",
    ]);
    assert.equal(phases.filter((phase) =>
      ["completed", "failed", "cancelled"].includes(phase)).length, 1);
  }
});

test("dedup retargets a new draft to a guarded canonical-page patch", async () => {
  const canonicalPath = PAGE_PATH;
  const duplicatePath = "!Wiki/demo/concept/wiki_demo_duplicate.md";
  const existingDuplicatePath = "!Wiki/demo/concept/wiki_demo_duplicate_existing.md";
  const traversalPath = "!Wiki/demo/concept/../outside.md";
  const source = "Duplicate source fact.";
  const canonical = [
    "---",
    "type: concept",
    "description: Canonical Alpha concept.",
    "resource: [old-source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Canonical fact.",
    "",
  ].join("\n");
  const existingDuplicate = [
    "---",
    "type: concept",
    "description: Canonical Alpha concept.",
    "resource: [duplicate-old]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Duplicate source fact.",
    "",
  ].join("\n");
  const index = [{
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: canonicalPath,
    type: "concept",
    description: "Canonical Alpha concept.",
    resource: ["source"],
    bodyHash: "body",
    descriptionHash: "description",
  }, {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_duplicate_existing",
    path: existingDuplicatePath,
    type: "concept",
    description: "Existing duplicate concept.",
    resource: ["duplicate-old"],
    bodyHash: "duplicate-body",
    descriptionHash: "duplicate-description",
  }, {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_demo_duplicate_existing",
    path: existingDuplicatePath,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "duplicate-chunk",
    embedTextHash: "duplicate-embed",
    vector: [0.1, 0.2],
    vectorModel: "mock",
    dimensions: 2,
    updatedAt: "2026-07-17T00:00:00.000Z",
  }].map((record) => JSON.stringify(record)).join("\n") + "\n";
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, source],
    ["src/old-source.md", "Old source."],
    ["src/duplicate-old.md", "Duplicate old source."],
    [canonicalPath, canonical],
    [existingDuplicatePath, existingDuplicate],
    [traversalPath, existingDuplicate],
    [INDEX_PATH, index],
  ]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "duplicate",
            entityType: "concept",
            facts: ["Duplicate source fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Regenerate exactly one guarded patch")) {
        const pageHash = prompt.match(/Fresh page hash: ([^\s]+)/)?.[1];
        const sectionHash = prompt.match(/"sectionHash": "([^"]+)"/)?.[1];
        const ordinal = Number(prompt.match(/"sectionOrdinal": (\d+)/)?.[1]);
        assert.ok(pageHash && sectionHash && Number.isInteger(ordinal));
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Merge into canonical page.",
          actions: [{
            kind: "patch",
            entityKey: "duplicate",
            path: canonicalPath,
            expectedPageHash: pageHash,
            sections: [{
              heading: "## Facts",
              operation: "append",
              expectedSectionHash: sectionHash,
              content: "Duplicate source fact.",
            }],
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      if (prompt.includes("Entity bundle: entity-duplicate")) {
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Draft a new page.",
          actions: [{
            kind: "create",
            entityKey: "duplicate",
            path: duplicatePath,
            annotation: "Duplicate draft.",
            content: "# Duplicate\n\n## Facts\nDuplicate source fact.\n",
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      throw new Error("unexpected call");
    } } },
  } as unknown as LlmClient;
  let similarityHits = 0;
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [`${entity.name}::${entity.type ?? ""}`, []])),
      allFailed: false,
    }),
    setJaccardCorpus: () => {},
    maxSimilarityToExisting: async () => {
      similarityHits++;
      if (similarityHits === 1) return { pid: "wiki_demo_alpha", score: 0.99 };
      if (similarityHits === 2) return { pid: "wiki_demo_duplicate_existing", score: 0.98 };
      return { pid: "", score: 0 };
    },
    refreshCache: async () => ({ updated: 1, failed: 0 }),
  } as unknown as PageSimilarityService;

  const { events, outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
      dedupOnIngest: true,
      dedupThreshold: 0.85,
      mergeDeleteWarnThreshold: 0,
    },
    similarity,
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (outcome.ok) {
    assert.deepEqual(outcome.created, []);
    assert.deepEqual(outcome.updated, [canonicalPath]);
    assert.deepEqual(outcome.deleted, [existingDuplicatePath]);
  }
  assert.equal(adapter.files.has(duplicatePath), false);
  assert.equal(adapter.files.has(existingDuplicatePath), false);
  assert.equal(adapter.files.has(traversalPath), true);
  const canonicalAfter = adapter.files.get(canonicalPath)!;
  assert.match(canonicalAfter, /Duplicate source fact\./);
  assert.deepEqual(parseResourceFromFm(canonicalAfter), ["duplicate-old", "old-source", "source"]);
  assert.match(canonicalAfter, /- \[\[duplicate-old\]\]/);
  assert.match(canonicalAfter, /- \[\[old-source\]\]/);
  assert.match(canonicalAfter, /- \[\[source\]\]/);
  assert.equal(adapter.files.get(INDEX_PATH)!.includes("wiki_demo_duplicate_existing"), false);
  assert.equal(events.some((event) =>
    event.kind === "info_text" && /Large merge: 1 deletion/.test(event.summary)), true);
});

test("canonical duplicate deletion fails closed when duplicate content changes after canonical write", async () => {
  const duplicatePath = "!Wiki/demo/concept/wiki_demo_racing_duplicate.md";
  const source = "Duplicate race fact.";
  const canonical = [
    "---",
    "type: concept",
    "description: Canonical Alpha concept.",
    "resource: [old-source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Canonical fact.",
    "",
  ].join("\n");
  const duplicate = [
    "---",
    "type: concept",
    "description: Canonical Alpha concept.",
    "resource: [duplicate-old]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Duplicate race fact.",
    "",
  ].join("\n");
  const index = [{
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: PAGE_PATH,
    type: "concept",
    description: "Canonical Alpha concept.",
    resource: ["old-source"],
    bodyHash: "canonical-body",
    descriptionHash: "canonical-description",
  }, {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_racing_duplicate",
    path: duplicatePath,
    type: "concept",
    description: "Racing duplicate.",
    resource: ["duplicate-old"],
    bodyHash: "duplicate-body",
    descriptionHash: "duplicate-description",
  }].map((record) => JSON.stringify(record)).join("\n") + "\n";
  let mutated = false;
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, source],
    ["src/old-source.md", "Old source."],
    ["src/duplicate-old.md", "Duplicate old source."],
    [PAGE_PATH, canonical],
    [duplicatePath, duplicate],
    [INDEX_PATH, index],
  ]), (path) => {
    if (path === PAGE_PATH && !mutated) {
      mutated = true;
      adapter.files.set(duplicatePath, `${adapter.files.get(duplicatePath)}Concurrent duplicate mutation.\n`);
    }
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "racing",
            entityType: "concept",
            facts: ["Duplicate race fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Regenerate exactly one guarded patch")) {
        const pageHash = prompt.match(/Fresh page hash: ([^\s]+)/)?.[1];
        const sectionHash = prompt.match(/"sectionHash": "([^"]+)"/)?.[1];
        assert.ok(pageHash && sectionHash);
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Merge into canonical page.",
          actions: [{
            kind: "patch",
            entityKey: "racing",
            path: PAGE_PATH,
            expectedPageHash: pageHash,
            sections: [{
              heading: "## Facts",
              operation: "append",
              expectedSectionHash: sectionHash,
              content: "Duplicate race fact.",
            }],
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Draft a duplicate page.",
        actions: [{
          kind: "create",
          entityKey: "racing",
          path: "!Wiki/demo/concept/wiki_demo_racing.md",
          annotation: "Racing duplicate.",
          content: "# Racing\n\n## Facts\nDuplicate race fact.\n",
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  let similarityHits = 0;
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [`${entity.name}::${entity.type ?? ""}`, []])),
      allFailed: false,
    }),
    setJaccardCorpus: () => {},
    maxSimilarityToExisting: async () => {
      similarityHits++;
      if (similarityHits === 1) return { pid: "wiki_demo_alpha", score: 0.99 };
      if (similarityHits === 2) return { pid: "wiki_demo_racing_duplicate", score: 0.98 };
      return { pid: "", score: 0 };
    },
  } as unknown as PageSimilarityService;

  const { events, outcome } = await drain(runIngest(
    [SOURCE_PATH], new VaultTools(adapter, "/vault"), llm, "mock", [domain()], "/vault",
    new AbortController().signal, {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
      dedupOnIngest: true,
      dedupThreshold: 0.85,
    }, similarity,
  ));

  assert.equal(mutated, true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) assert.equal(outcome.stage, "write");
  assert.equal(adapter.files.has(duplicatePath), true);
  assert.match(adapter.files.get(duplicatePath)!, /Concurrent duplicate mutation/);
  assert.equal(adapter.files.get(INDEX_PATH)!.includes("wiki_demo_racing_duplicate"), true);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && !event.ok && /stale canonical duplicate/.test(event.preview ?? "")), true);
});

test("canonical merge keeps a duplicate with unique preamble knowledge", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({
      resource: "duplicate-old",
      preamble: "Unique introductory knowledge.",
      facts: "Incoming merge fact.",
    }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  if (outcome.ok) assert.deepEqual(outcome.deleted, []);
});

test("canonical merge keeps a duplicate with unique aliases and tags", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({
      resource: "duplicate-old",
      aliases: ["Unique Alias"],
      tags: ["topic/unique"],
      facts: "Incoming merge fact.",
    }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  if (outcome.ok) assert.deepEqual(outcome.deleted, []);
});

test("canonical merge keeps a duplicate with unique Related links", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({
      resource: "duplicate-old",
      facts: "Incoming merge fact.",
      links: "- [[wiki_demo_unique_link]]",
    }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  if (outcome.ok) assert.deepEqual(outcome.deleted, []);
});

test("canonical merge keeps a duplicate with a unique Sources citation", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({
      resource: "duplicate-old",
      facts: "Incoming merge fact.",
      sources: "- [[citation-only]]",
    }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  if (outcome.ok) assert.deepEqual(outcome.deleted, []);
});

test("canonical merge rejects short-substring evidence as representation", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({ resource: "duplicate-old", facts: "fact" }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  if (outcome.ok) assert.deepEqual(outcome.deleted, []);
});

test("canonical merge deletes an exact normalized duplicate after evidence union", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({
      resource: "old-source",
      aliases: ["Shared Alias"],
      tags: ["topic/shared"],
      facts: "Canonical fact.",
    }),
    mergePage({
      resource: "duplicate-old",
      aliases: ["Shared Alias"],
      tags: ["topic/shared"],
      facts: "Incoming merge fact.",
    }),
  );

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), false);
  if (outcome.ok) assert.deepEqual(outcome.deleted, [duplicatePath]);
});

test("canonical merge removes index first and retry clears duplicate chunks safely", async () => {
  const { adapter, duplicatePath, outcome, rerun } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({ resource: "duplicate-old", facts: "Incoming merge fact." }),
    true,
  );

  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  assert.match(adapter.files.get(INDEX_PATH)!, /wiki_demo_knowledge_duplicate/);

  const retryOutcome = await rerun();
  assert.equal(retryOutcome.ok, true, JSON.stringify(retryOutcome));
  assert.equal(adapter.files.has(duplicatePath), false);
  assert.doesNotMatch(adapter.files.get(INDEX_PATH)!, /wiki_demo_knowledge_duplicate/);
});

test("canonical deletion revalidates after index removal and restores index on a page race", async () => {
  let raced = false;
  const racedDuplicatePath = "!Wiki/demo/concept/wiki_demo_knowledge_duplicate.md";
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({ resource: "duplicate-old", facts: "Incoming merge fact." }),
    false,
    (files) => {
      if (raced) return;
      raced = true;
      files.set(
        racedDuplicatePath,
        `${files.get(racedDuplicatePath)}Concurrent post-index fact.\n`,
      );
    },
  );

  assert.equal(raced, true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  assert.match(adapter.files.get(duplicatePath)!, /Concurrent post-index fact/);
  assert.match(adapter.files.get(INDEX_PATH)!, /wiki_demo_knowledge_duplicate/);
  assert.match(adapter.files.get(INDEX_PATH)!, /duplicate-embed/);
});

test("canonical index restoration preserves a concurrent unrelated queued transform", async () => {
  const { adapter, duplicatePath, outcome } = await runCanonicalKnowledgeCase(
    mergePage({ resource: "old-source", facts: "Canonical fact." }),
    mergePage({ resource: "duplicate-old", facts: "Incoming merge fact." }),
    false,
    undefined,
    true,
  );

  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(adapter.files.has(duplicatePath), true);
  assert.match(adapter.files.get(duplicatePath)!, /Concurrent queued-index race/);
  assert.match(adapter.files.get(INDEX_PATH)!, /wiki_demo_knowledge_duplicate/);
  assert.match(adapter.files.get(INDEX_PATH)!, /duplicate-embed/);
  assert.match(adapter.files.get(INDEX_PATH)!, /wiki_demo_concurrent/);
});

test("retry after a post-write embedding failure completes pending vectors and backlinks on a synthesis skip", async () => {
  const retryPath = "!Wiki/demo/concept/wiki_demo_retry.md";
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, "Retry source fact."]]));
  let synthesisCalls = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "retry",
            entityType: "concept",
            facts: ["Retry source fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Entity bundle: entity-retry")) {
        synthesisCalls++;
        return mockChatResponse(params, JSON.stringify(synthesisCalls === 1 ? {
          reasoning: "Create the retry page.",
          actions: [{
            kind: "create",
            entityKey: "retry",
            path: retryPath,
            annotation: "Retry concept.",
            content: [
              "---",
              "type: concept",
              "description: Retry concept.",
              "resource: [source]",
              "---",
              "# Retry",
              "",
              "## Facts",
              "Retry source fact.",
              "",
            ].join("\n"),
          }],
          skips: [],
          entity_types_delta: [],
        } : {
          reasoning: "The page already contains the evidence.",
          actions: [],
          skips: [{ entityKey: "retry", reason: "Already represented." }],
          entity_types_delta: [],
        }));
      }
      throw new Error("unexpected call");
    } } },
  } as unknown as LlmClient;
  let refreshCalls = 0;
  let vectorsComplete = false;
  const similarity = {
    config: { mode: "embedding", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>, _descriptions: Map<string, string>, paths: string[]) => ({
      results: new Map(entities.map((entity) => [
        `${entity.name}::${entity.type ?? ""}`,
        paths.filter((path) => path === retryPath),
      ])),
      allFailed: false,
    }),
    refreshCache: async () => {
      refreshCalls++;
      if (refreshCalls === 1) throw new EmbeddingUnavailableError("synthetic first-pass failure");
      vectorsComplete = true;
      return { updated: 1, failed: 0 };
    },
  } as unknown as PageSimilarityService;
  const opts = {
    inputBudgetTokens: 20_000,
    maxTokens: 1_000,
    semanticCompression: { profile: "balanced" as const, operation: "ingest" as const },
    structuredRetries: 0,
  };
  const vaultTools = new VaultTools(adapter, "/vault");

  const first = await drain(runIngest(
    [SOURCE_PATH], vaultTools, llm, "mock", [domain()], "/vault",
    new AbortController().signal, opts, similarity,
  ));
  assert.equal(first.outcome.ok, false);
  if (!first.outcome.ok) assert.equal(first.outcome.stage, "embedding");
  assert.equal(adapter.files.has(retryPath), true);
  assert.equal(parseResourceFromFm(adapter.files.get(retryPath)!).includes("source"), true);
  assert.equal(adapter.files.get(SOURCE_PATH), "Retry source fact.");

  const second = await drain(runIngest(
    [SOURCE_PATH], vaultTools, llm, "mock", [domain()], "/vault",
    new AbortController().signal, opts, similarity,
  ));
  assert.equal(second.outcome.ok, true, JSON.stringify(second.outcome));
  assert.equal(synthesisCalls, 2);
  assert.equal(refreshCalls, 2);
  assert.equal(vectorsComplete, true);
  assert.match(adapter.files.get(SOURCE_PATH)!, /wiki_articles:/);
  assert.match(adapter.files.get(SOURCE_PATH)!, /wiki_demo_retry/);
});

test("transactional ingest succeeds when backlink reconciliation is an exact no-op", async () => {
  const source = "Alpha is covered by the source.";
  const page = [
    "---",
    "type: concept",
    "description: Alpha concept.",
    "resource: [source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    source,
    "",
  ].join("\n");
  const index = `${JSON.stringify({
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: PAGE_PATH,
    type: "concept",
    description: "Alpha concept.",
    resource: ["source"],
    bodyHash: contentHash(page),
    descriptionHash: contentHash("Alpha concept."),
  })}\n`;
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, source],
    [PAGE_PATH, page],
    [INDEX_PATH, index],
  ]));
  const vaultTools = new VaultTools(adapter, "/vault");
  const llm = capturingLlm([]);
  const opts = {
    inputBudgetTokens: 20_000,
    maxTokens: 1_000,
    semanticCompression: { profile: "balanced" as const, operation: "ingest" as const },
    structuredRetries: 0,
  };

  const first = await drain(runIngest(
    [SOURCE_PATH], vaultTools, llm, "mock", [domain()], "/vault",
    new AbortController().signal, opts,
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));
  assert.equal(first.outcome.ok, true, JSON.stringify(first.outcome));
  const reconciledSource = adapter.files.get(SOURCE_PATH)!;

  const transaction = new TransactionVaultTools(vaultTools);
  const second = await drain(runIngest(
    [SOURCE_PATH], transaction, llm, "mock", [domain()], "/vault",
    new AbortController().signal, opts,
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
    undefined,
    1,
    3,
    { deferCommitEffects: true, transaction },
  ));

  assert.equal(second.outcome.ok, true, JSON.stringify(second.outcome));
  assert.equal(adapter.files.get(SOURCE_PATH), reconciledSource);
});

test("concurrent source body edit before backlink commit fails without overwriting fresh bytes", async () => {
  const concurrentPath = "!Wiki/demo/concept/wiki_demo_concurrent_source.md";
  const originalSource = "Original processed source fact.";
  const concurrentSource = "Concurrent source edit.";
  const files = new Map<string, string>([[SOURCE_PATH, originalSource]]);
  let mutated = false;
  const adapter = new MemoryAdapter(files, (path) => {
    if (path === INDEX_PATH && files.has(concurrentPath) && !mutated) {
      mutated = true;
      files.set(SOURCE_PATH, concurrentSource);
    }
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "concurrent-source",
            entityType: "concept",
            facts: [originalSource],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Create concurrent source page.",
        actions: [{
          kind: "create",
          entityKey: "concurrent-source",
          path: concurrentPath,
          annotation: "Concurrent source concept.",
          content: [
            "---",
            "type: concept",
            "description: Concurrent source concept.",
            "resource: [source]",
            "---",
            "# Concurrent Source",
            "",
            "## Facts",
            originalSource,
            "",
          ].join("\n"),
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;

  const { events, outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));

  assert.equal(mutated, true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.stage, "backlink");
    assert.equal(outcome.retryable, true);
  }
  assert.equal(files.get(SOURCE_PATH), concurrentSource);
  assert.equal(events.some((event) => event.kind === "source_path_added"), false);
});

test("source mutation after backlink tool event is detected before any source write", async () => {
  const originalSource = "Processed source body.";
  const concurrentSource = "Concurrent edit after tool event.";
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, originalSource]]));
  const generator = runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    capturingLlm([]),
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  );
  let sawBacklinkTool = false;
  let outcome: IngestOutcome | undefined;
  while (true) {
    const next = await generator.next();
    if (next.done) {
      outcome = next.value;
      break;
    }
    if (next.value.kind === "tool_use"
      && next.value.name === "Update"
      && (next.value.input as { path?: string }).path === SOURCE_PATH) {
      sawBacklinkTool = true;
      adapter.files.set(SOURCE_PATH, concurrentSource);
    }
  }

  assert.equal(sawBacklinkTool, true);
  assert.equal(outcome?.ok, false, JSON.stringify(outcome));
  if (outcome && !outcome.ok) assert.equal(outcome.stage, "backlink");
  assert.equal(adapter.files.get(SOURCE_PATH), concurrentSource);
  assert.equal(adapter.writes.includes(SOURCE_PATH), false);
});

test("post-embedding page provenance controls final source wiki_articles", async () => {
  const pagePath = "!Wiki/demo/concept/wiki_demo_provenance_race.md";
  const source = "Provenance race fact.";
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, source]]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "provenance-race",
            entityType: "concept",
            facts: [source],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Create provenance page.",
        actions: [{
          kind: "create",
          entityKey: "provenance-race",
          path: pagePath,
          annotation: "Provenance race.",
          content: [
            "---",
            "type: concept",
            "description: Provenance race.",
            "resource: [source]",
            "---",
            "# Provenance Race",
            "",
            "## Facts",
            source,
            "",
          ].join("\n"),
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const similarity = {
    config: { mode: "embedding", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async () => ({ results: new Map(), allFailed: false }),
    refreshCache: async () => {
      adapter.files.set(
        pagePath,
        adapter.files.get(pagePath)!.replace(
          /^resource:[^\n]*\n(?:[ \t]+-[^\n]*\n)*/m,
          "resource:\n  - other\n",
        ),
      );
      return { updated: 1, failed: 0 };
    },
  } as unknown as PageSimilarityService;

  const { outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    similarity,
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(parseResourceFromFm(adapter.files.get(pagePath)!), ["other"]);
  assert.doesNotMatch(adapter.files.get(SOURCE_PATH)!, /wiki_demo_provenance_race/);
});

test("successful ingest returns the authoritative processed source body hash", async () => {
  const source = "Authoritative source hash.";
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, source]]));
  const llm = capturingLlm([]);
  const { outcome } = await drain(runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (outcome.ok) assert.equal(outcome.sourceBodyHash, hashSource(source));
});

test("create CAS refuses a path created after action preparation", async () => {
  const { adapter, events, outcome, targetPath, concurrentContent, mutated } =
    await runPageWriteRace("create");

  assert.equal(mutated, true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) assert.equal(outcome.stage, "write");
  assert.equal(adapter.files.get(targetPath), concurrentContent);
  assert.equal(adapter.writes.includes(targetPath), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && !event.ok && /create conflict/.test(event.preview ?? "")), true);
});

test("update CAS refuses a page changed after patch preparation", async () => {
  const { adapter, events, outcome, targetPath, concurrentContent, mutated } =
    await runPageWriteRace("patch");

  assert.equal(mutated, true);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) assert.equal(outcome.stage, "write");
  assert.equal(adapter.files.get(targetPath), concurrentContent);
  assert.equal(adapter.writes.includes(targetPath), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && !event.ok && /update conflict/.test(event.preview ?? "")), true);
});

test("source-stem inventory failure returns typed context failure before page writes", async () => {
  const { outcome } = await runInventoryFailure("src");
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.stage, "context");
    assert.match(outcome.message, /EACCES: inventory src/);
  }
});

test("global link inventory failure returns typed context failure before page writes", async () => {
  const { outcome } = await runInventoryFailure("");
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) {
    assert.equal(outcome.stage, "context");
    assert.match(outcome.message, /EACCES: inventory vault/);
  }
});

test("mapper telemetry and synthesis content are yielded before delayed helpers complete", async () => {
  const mapperGate = deferred();
  const synthesisGate = deferred();
  let mapperComplete = false;
  let synthesisComplete = false;
  const adapter = new MemoryAdapter(new Map([[SOURCE_PATH, "Live event source fact."]]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        await mapperGate.promise;
        const response = mockChatResponse(params, JSON.stringify({
            packets: [{
              id: `packet-${chunkId}`,
              chunkId,
              entityKey: "live-events",
              entityType: "concept",
              facts: ["Live event source fact."],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: `${SOURCE_PATH}:1`,
            }],
            noEvidence: [],
          }));
        mapperComplete = true;
        return response;
      }
      await synthesisGate.promise;
      synthesisComplete = true;
      return mockChatResponse(params, JSON.stringify({
        reasoning: "No page needed.",
        actions: [],
        skips: [{ entityKey: "live-events", reason: "Fixture skip." }],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const generator = runIngest(
    [SOURCE_PATH],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [domain()],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  );

  async function expectLive(
    label: string,
    matches: (event: RunEvent) => boolean,
    release: () => void,
    completed: () => boolean,
  ) {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      release();
    }, 2_000);
    while (true) {
      const next = await generator.next();
      assert.equal(next.done, false);
      if (!next.done && matches(next.value)) {
        clearTimeout(timer);
        assert.equal(expired, false, `${label} event was buffered until idle deadline`);
        assert.equal(completed(), false);
        release();
        return;
      }
    }
  }

  await expectLive(
    "ingest.evidence-map",
    (event) => event.kind === "llm_lifecycle"
      && event.action === "extract_source_facts"
      && event.phase === "waiting",
    mapperGate.resolve,
    () => mapperComplete,
  );
  await expectLive(
    "ingest.synthesize",
    (event) => event.kind === "llm_lifecycle"
      && event.action === "synthesize_wiki_pages"
      && event.phase === "waiting",
    synthesisGate.resolve,
    () => synthesisComplete,
  );
  const { outcome } = await drain(generator);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
});

test("ordinary guarded patch unions old and current source provenance", async () => {
  const sourcePath = "src/new-source.md";
  const page = [
    "---",
    "type: concept",
    "description: Alpha concept.",
    "resource: [old-source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Old fact.",
    "",
    "## Sources",
    "- [[old-source]]",
    "",
  ].join("\n");
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, "New Alpha fact."],
    ["src/old-source.md", "Old Alpha source."],
    [PAGE_PATH, page],
  ]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "alpha",
            entityType: "concept",
            facts: ["New Alpha fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${sourcePath}:1`,
          }],
          noEvidence: [],
        }));
      }
      const pageHash = prompt.match(/"pageHash":\s*"([^"]+)"/)?.[1];
      const sectionHash = prompt.match(/"sectionHash":\s*"([^"]+)"/)?.[1];
      assert.ok(pageHash && sectionHash);
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Append the new fact.",
        actions: [{
          kind: "patch",
          entityKey: "alpha",
          path: PAGE_PATH,
          expectedPageHash: pageHash,
          sections: [{
            heading: "## Facts",
            operation: "append",
            expectedSectionHash: sectionHash,
            content: "New Alpha fact.",
          }],
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: 5 });

  const { outcome } = await drain(runIngest(
    [sourcePath], new VaultTools(adapter, "/vault"), llm, "mock", [domain()], "/vault",
    new AbortController().signal, {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    }, similarity,
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const updated = adapter.files.get(PAGE_PATH)!;
  assert.deepEqual(parseResourceFromFm(updated), ["new-source", "old-source"]);
  assert.match(updated, /- \[\[new-source\]\]/);
  assert.match(updated, /- \[\[old-source\]\]/);
});

test("failed canonical merge never deletes a duplicate candidate", async () => {
  const duplicatePath = "!Wiki/demo/concept/wiki_demo_existing_duplicate.md";
  const source = "Duplicate failure fact.";
  const canonical = [
    "---",
    "type: concept",
    "description: Canonical.",
    "resource: [old-source]",
    "---",
    "# Canonical",
    "",
    "## Facts",
    "Canonical fact.",
    "",
  ].join("\n");
  const duplicate = canonical.replace("# Canonical", "# Duplicate");
  const index = [
    {
      kind: "page", schemaVersion: 1, articleId: "wiki_demo_alpha", path: PAGE_PATH,
      type: "concept", description: "Canonical.", resource: ["old-source"],
      bodyHash: "canonical", descriptionHash: "canonical-description",
    },
    {
      kind: "page", schemaVersion: 1, articleId: "wiki_demo_existing_duplicate", path: duplicatePath,
      type: "concept", description: "Duplicate.", resource: ["old-source"],
      bodyHash: "duplicate", descriptionHash: "duplicate-description",
    },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n";
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, source],
    ["src/old-source.md", "Old source."],
    [PAGE_PATH, canonical],
    [duplicatePath, duplicate],
    [INDEX_PATH, index],
  ]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "incoming",
            entityType: "concept",
            facts: ["Duplicate failure fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${SOURCE_PATH}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Regenerate exactly one guarded patch")) {
        throw new Error("synthetic canonical merge failure");
      }
      return mockChatResponse(params, JSON.stringify({
        reasoning: "Draft incoming page.",
        actions: [{
          kind: "create",
          entityKey: "incoming",
          path: "!Wiki/demo/concept/wiki_demo_incoming.md",
          annotation: "Incoming duplicate.",
          content: "# Incoming\n\n## Facts\nDuplicate failure fact.\n",
        }],
        skips: [],
        entity_types_delta: [],
      }));
    } } },
  } as unknown as LlmClient;
  let hit = 0;
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (entities: Array<{ name: string; type?: string }>) => ({
      results: new Map(entities.map((entity) => [`${entity.name}::${entity.type ?? ""}`, []])),
      allFailed: false,
    }),
    setJaccardCorpus: () => {},
    maxSimilarityToExisting: async () => {
      hit++;
      return hit === 1
        ? { pid: "wiki_demo_alpha", score: 0.99 }
        : { pid: "wiki_demo_existing_duplicate", score: 0.98 };
    },
  } as unknown as PageSimilarityService;

  const { outcome } = await drain(runIngest(
    [SOURCE_PATH], new VaultTools(adapter, "/vault"), llm, "mock", [domain()], "/vault",
    new AbortController().signal, {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
      dedupOnIngest: true,
      dedupThreshold: 0.85,
    }, similarity,
  ));

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.stage, "patch");
  assert.equal(adapter.files.has(duplicatePath), true);
  assert.equal(adapter.files.get(INDEX_PATH)!.includes("wiki_demo_existing_duplicate"), true);
});
