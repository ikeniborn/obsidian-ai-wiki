import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { contentHash } from "../src/content-hash";
import type { DomainEntry } from "../src/domain";
import type { LlmClient, RunEvent } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";
import type { ChunkIndexRecord, PageIndexRecord } from "../src/wiki-index-jsonl";
import { mockChatResponse } from "./openai-mock-response";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { cleanupInvalidPages } = await import("../src/phases/lint");
const { DomainStore } = await import("../src/domain-store");
const {
  domainEntryToMetadataRecords,
  stringifyDomainMetadata,
} = await import("../src/domain-metadata");
const { PageSimilarityService } = await import("../src/page-similarity");
const {
  applyDeleteStateCommitEvent,
  persistDeleteStateCommitEvent,
  runDelete: runDeletePhase,
  verifyDeleteStateCommitEvent,
  deleteJournalDigest,
} = await import("../src/phases/delete");
const { VaultTools } = await import("../src/vault-tools");
const { parseWikiIndexJsonl } = await import("../src/wiki-index-jsonl");

const DOMAIN_ROOT = "!Wiki/d";
const PAGE_PATH = `${DOMAIN_ROOT}/concept/invalid.md`;
const INDEX_PATH = `${DOMAIN_ROOT}/index.jsonl`;
const SOURCE_PATH = "sources/source.md";
const DELETE_JOURNAL_PATH = `${DOMAIN_ROOT}/delete-journal.json`;
const LOG_PATH = `${DOMAIN_ROOT}/log.jsonl`;

class MemoryAdapter implements VaultAdapter {
  writeError?: Error;
  readonly writeErrors = new Map<string, Error>();
  readonly readErrors = new Map<string, Error>();
  readonly listErrors = new Map<string, Error>();
  readonly removeErrors = new Map<string, Error>();
  readonly blackholeWrites = new Set<string>();
  readonly writePaths: string[] = [];
  readonly timeline: string[] = [];
  readonly existsCounts = new Map<string, number>();
  onExists?: (path: string, count: number) => void;
  journalWriteTransform?: (attempt: number, data: string) => string | null;
  journalWriteCount = 0;
  beforeWrite?: (path: string, data: string) => void | Promise<void>;
  afterWrite?: (path: string, data: string) => void | Promise<void>;
  afterRead?: (path: string, data: string) => void | Promise<void>;
  afterRemove?: (path: string) => void | Promise<void>;

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const readError = this.readErrors.get(path);
    if (readError) throw readError;
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    await this.afterRead?.(path, value);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    await this.beforeWrite?.(path, data);
    this.writePaths.push(path);
    if (this.blackholeWrites.has(path)) return;
    const pathError = this.writeErrors.get(path);
    if (pathError) throw pathError;
    if (path === INDEX_PATH && this.writeError) throw this.writeError;
    if (path === DELETE_JOURNAL_PATH && this.journalWriteTransform) {
      const transformed = this.journalWriteTransform(++this.journalWriteCount, data);
      if (transformed === null) return;
      data = transformed;
    }
    this.files.set(path, data);
    this.timeline.push(`write:${path}`);
    await this.afterWrite?.(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async exists(path: string): Promise<boolean> {
    const count = (this.existsCounts.get(path) ?? 0) + 1;
    this.existsCounts.set(path, count);
    this.onExists?.(path, count);
    return this.files.has(path) || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async mkdir(): Promise<void> {}

  async remove(path: string): Promise<void> {
    const removeError = this.removeErrors.get(path);
    if (removeError) throw removeError;
    this.files.delete(path);
    this.timeline.push(`remove:${path}`);
    await this.afterRemove?.(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const listError = this.listErrors.get(path);
    if (listError) throw listError;
    const prefix = `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash < 0) files.push(file);
      else folders.add(`${path}/${remainder.slice(0, slash)}`);
    }
    return { files, folders: [...folders] };
  }
}

function records(): Array<PageIndexRecord | ChunkIndexRecord | { kind: string; value: number }> {
  const page: PageIndexRecord = {
    kind: "page",
    schemaVersion: 1,
    articleId: "invalid",
    path: PAGE_PATH,
    type: "concept",
    description: "Invalid page",
    resource: ["source"],
    bodyHash: "body",
    descriptionHash: "description",
  };
  const chunk: ChunkIndexRecord = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "invalid",
    path: PAGE_PATH,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "m",
    dimensions: 2,
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  return [page, chunk, { kind: "future", value: 1 }];
}

function setup(): { adapter: MemoryAdapter; vaultTools: InstanceType<typeof VaultTools>; original: string } {
  const original = records().map((record) => JSON.stringify(record)).join("\r\n") + "\r\n";
  const adapter = new MemoryAdapter(new Map([
    [PAGE_PATH, "---\nresource: [source]\n---\n# Invalid"],
    [INDEX_PATH, original],
    [SOURCE_PATH, "# Source"],
  ]));
  return { adapter, vaultTools: new VaultTools(adapter, ""), original };
}

function metadataRaw(entry: DomainEntry): string {
  return stringifyDomainMetadata(domainEntryToMetadataRecords(entry));
}

function domainStore(adapter: MemoryAdapter): InstanceType<typeof DomainStore> {
  return new DomainStore({
    adapter,
    createFolder: async () => {},
  } as never);
}

function runDelete(
  ...args: Parameters<typeof runDeletePhase>
): ReturnType<typeof runDeletePhase> {
  return (async function* () {
    const generator = runDeletePhase(...args);
    while (true) {
      const next = await generator.next();
      if (next.done) return;
      if (next.value.kind === "delete_state_commit") {
        const adapter = args[1].adapter as MemoryAdapter;
        const domain = args[4].find((entry) => entry.id === next.value.domainId);
        assert.ok(domain);
        if (!adapter.files.has(next.value.metadataPath)) {
          adapter.files.set(next.value.metadataPath, metadataRaw(domain));
        }
        const receipt = await persistDeleteStateCommitEvent(
          domainStore(adapter),
          args[1],
          next.value,
          args[5],
        );
        next.value.receiptHash = receipt.journalHash;
      }
      yield next.value;
    }
  })();
}

test("invalid-page cleanup surfaces index removal failure after physical deletion", async () => {
  const { adapter, vaultTools, original } = setup();
  const writeError = new Error("index write failed");
  adapter.writeError = writeError;

  await assert.rejects(
    cleanupInvalidPages(vaultTools, DOMAIN_ROOT, "d"),
    (error) => error === writeError,
  );

  assert.equal(adapter.files.has(PAGE_PATH), false, "physical deletion cannot be rolled back");
  assert.equal(adapter.files.get(INDEX_PATH), original, "failed index write must not alter existing bytes");
});

test("successful invalid-page cleanup removes both page and chunk records", async () => {
  const { adapter, vaultTools } = setup();

  assert.deepEqual(await cleanupInvalidPages(vaultTools, DOMAIN_ROOT, "d"), { deleted: 1 });

  assert.equal(adapter.files.has(PAGE_PATH), false);
  const remaining = parseWikiIndexJsonl(adapter.files.get(INDEX_PATH)!, INDEX_PATH);
  assert.equal(remaining.some((record) => record.articleId === "invalid"), false);
  assert.deepEqual(remaining, [{ kind: "future", value: 1 }]);
});

const domain: DomainEntry = {
  id: "d",
  name: "D",
  wiki_folder: "d",
  source_paths: [SOURCE_PATH],
  analyzed_sources: {
    [SOURCE_PATH]: "source-hash",
    "sources/other.md": "other-hash",
  },
};
const unusedLlm = {} as LlmClient;

function streamText(content: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "content", object: "chat.completion.chunk", created: 0, model: "mock",
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}

function messageText(params: unknown): string {
  const messages = (params as { messages: Array<{ content?: unknown }> }).messages;
  return messages.map((message) =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
}

async function collectDelete(
  vaultTools: InstanceType<typeof VaultTools>,
  timeline?: string[],
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    new AbortController().signal,
  )) {
    events.push(event);
    timeline?.push(`event:${event.kind}`);
  }
  return events;
}

test("delete phase rejects terminally when article index removal fails", async () => {
  const { adapter, vaultTools, original } = setup();
  const writeError = new Error("index write failed");
  adapter.writeError = writeError;
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, (error) => error === writeError);

  assert.equal(events.some((event) => event.kind === "result"), false);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
  assert.deepEqual(domain.source_paths, [SOURCE_PATH]);
  assert.deepEqual(domain.analyzed_sources, {
    [SOURCE_PATH]: "source-hash",
    "sources/other.md": "other-hash",
  });
  assert.equal(adapter.files.has(PAGE_PATH), true, "durable delete must restore the page");
  assert.equal(adapter.files.has(SOURCE_PATH), true, "terminal failure stops source deletion");
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

test("delete phase rejects terminally when governed page removal fails", async () => {
  const { adapter, vaultTools, original } = setup();
  const removeError = new Error("EIO: governed page remove failed");
  adapter.removeErrors.set(PAGE_PATH, removeError);
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, (error) => error === removeError);

  assert.equal(events.some((event) => event.kind === "result"), false);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
  assert.equal(adapter.files.has(PAGE_PATH), true);
  assert.equal(adapter.files.has(SOURCE_PATH), true);
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.deepEqual(domain.source_paths, [SOURCE_PATH]);
  assert.deepEqual(domain.analyzed_sources, {
    [SOURCE_PATH]: "source-hash",
    "sources/other.md": "other-hash",
  });
});

test("successful delete phase leaves no page or chunk record for deleted article", async () => {
  const { adapter, vaultTools } = setup();

  const events = await collectDelete(vaultTools, adapter.timeline);

  assert.equal(events.some((event) => event.kind === "result"), true);
  const publication = events.find((event) => event.kind === "delete_state_commit");
  assert.deepEqual(publication, {
    kind: "delete_state_commit",
    domainId: "d",
    journalPath: DELETE_JOURNAL_PATH,
    journalHash: publication?.kind === "delete_state_commit" ? publication.journalHash : "",
    receiptHash: publication?.kind === "delete_state_commit" ? publication.receiptHash : "",
    metadataPath: `${DOMAIN_ROOT}/metadata.jsonl`,
    sourcePathAdds: [],
    sourcePathRemoved: SOURCE_PATH,
    analyzedRemoval: { path: SOURCE_PATH, beforeHash: "source-hash" },
    entityTypeDeltas: [],
  });
  assert.deepEqual(
    applyDeleteStateCommitEvent([domain], publication!, "")[0].analyzed_sources,
    { "sources/other.md": "other-hash" },
  );
  const indexWrite = adapter.timeline.indexOf(`write:${INDEX_PATH}`);
  const publicationIndex = adapter.timeline.indexOf("event:delete_state_commit");
  assert.ok(indexWrite >= 0);
  assert.ok(publicationIndex > indexWrite);
  assert.equal(adapter.files.has(PAGE_PATH), false);
  assert.equal(adapter.files.has(SOURCE_PATH), false);
  const remaining = parseWikiIndexJsonl(adapter.files.get(INDEX_PATH)!, INDEX_PATH);
  assert.equal(remaining.some((record) => record.articleId === "invalid"), false);
  assert.deepEqual(remaining, [{ kind: "future", value: 1 }]);
});

test("failed multi-source rebuild rolls back durable state and a second run can rebuild safely", async () => {
  const rebuildPage = `${DOMAIN_ROOT}/concept/wiki_d_shared.md`;
  const otherSource = "sources/other.md";
  const originalPage = [
    "---",
    "type: concept",
    "description: Shared page.",
    "resource: [source, other]",
    "---",
    "# Shared",
    "",
    "## Facts",
    "Shared fact.",
    "",
  ].join("\n");
  const originalIndex = JSON.stringify({
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_d_shared",
    path: rebuildPage,
    type: "concept",
    description: "Shared page.",
    resource: ["source", "other"],
    bodyHash: "body",
    descriptionHash: "description",
  }) + "\n";
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, "Deleted source fact."],
    [otherSource, "Shared fact."],
    [rebuildPage, originalPage],
    [INDEX_PATH, originalIndex],
  ]));
  const rebuildDomain: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: ["sources"],
    analyzed_sources: {
      [SOURCE_PATH]: "source-hash",
      [otherSource]: "other-hash",
    },
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["Shared"],
      wiki_subfolder: "concept",
    }],
  };
  let failMapper = true;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        if (failMapper) throw new Error("synthetic rebuild failure");
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${chunkId}`,
            chunkId,
            entityKey: "shared",
            entityType: "concept",
            facts: ["Shared fact."],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `${otherSource}:1`,
          }],
          noEvidence: [],
        }));
      }
      if (prompt.includes("Entity bundle: entity-shared")) {
        return mockChatResponse(params, JSON.stringify({
          reasoning: "Rebuild shared page from remaining source.",
          actions: [{
            kind: "create",
            entityKey: "shared",
            path: rebuildPage,
            annotation: "Shared page.",
            content: [
              "---",
              "type: concept",
              "description: Shared page.",
              "resource: [other]",
              "---",
              "# Shared",
              "",
              "## Facts",
              "Shared fact.",
              "",
            ].join("\n"),
          }],
          skips: [],
          entity_types_delta: [],
        }));
      }
      throw new Error("unexpected rebuild prompt");
    } } },
  } as unknown as LlmClient;
  const opts = {
    inputBudgetTokens: 20_000,
    maxTokens: 1_000,
    semanticCompression: { profile: "balanced" as const, operation: "ingest" as const },
    structuredRetries: 0,
  };

  const firstEvents: RunEvent[] = [];
  for await (const event of runDelete(
    [SOURCE_PATH, rebuildDomain.id],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [rebuildDomain],
    "/vault",
    new AbortController().signal,
    opts,
  )) firstEvents.push(event);

  assert.equal(firstEvents.some((event) => event.kind === "source_path_removed"), false);
  assert.equal(firstEvents.some((event) => event.kind === "domain_updated"), false);
  assert.equal(adapter.files.get(rebuildPage), originalPage);
  assert.equal(adapter.files.get(INDEX_PATH), originalIndex);
  assert.equal(adapter.files.has(SOURCE_PATH), true);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);

  failMapper = false;
  const secondEvents: RunEvent[] = [];
  for await (const event of runDelete(
    [SOURCE_PATH, rebuildDomain.id],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [rebuildDomain],
    "/vault",
    new AbortController().signal,
    opts,
  )) secondEvents.push(event);

  assert.equal(
    secondEvents.some((event) => event.kind === "delete_state_commit"),
    true,
    JSON.stringify(secondEvents),
  );
  assert.equal(adapter.files.has(SOURCE_PATH), false);
  assert.equal(adapter.files.has(rebuildPage), true);
  assert.deepEqual(
    (await import("../src/utils/raw-frontmatter")).parseResourceFromFm(adapter.files.get(rebuildPage)!),
    ["sources/other.md"],
  );
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

function journalImage(content?: string): { exists: false } | {
  exists: true;
  content: string;
  hash: string;
} {
  return content === undefined
    ? { exists: false }
    : { exists: true, content, hash: contentHash(content) };
}

test("prepared delete journal recovery preserves all current files because no mutation was recorded", async () => {
  const rebuildPage = `${DOMAIN_ROOT}/concept/wiki_d_interrupted.md`;
  const source = "sources/interrupted.md";
  const currentSource = "# Concurrent source edit\n";
  const currentIndex = "{\"kind\":\"future\",\"value\":\"concurrent\"}\n";
  const concurrentPage = `${DOMAIN_ROOT}/concept/wiki_d_created_during_interruption.md`;
  const adapter = new MemoryAdapter(new Map([
    [source, currentSource],
    [concurrentPage, "# Concurrent page"],
    [INDEX_PATH, currentIndex],
    [DELETE_JOURNAL_PATH, JSON.stringify({
      version: 3,
      status: "prepared",
      domainId: "d",
      sourcePath: source,
      manifestComplete: true,
      mutations: [],
      analyzedRemoval: { path: source, beforeHash: "hash" },
      entityTypeDeltas: [],
      deleted: 0,
      rebuilt: 1,
    })],
  ]));
  const controller = new AbortController();
  controller.abort();
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [source, "d"],
    new VaultTools(adapter, ""),
    unusedLlm,
    "m",
    [{
      id: "d",
      name: "D",
      wiki_folder: "d",
      source_paths: [source],
      analyzed_sources: { [source]: "hash" },
    }],
    "",
    controller.signal,
  )) events.push(event);

  assert.equal(adapter.files.has(rebuildPage), false);
  assert.equal(adapter.files.get(INDEX_PATH), currentIndex);
  assert.equal(adapter.files.get(source), currentSource);
  assert.equal(adapter.files.get(concurrentPage), "# Concurrent page");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
  assert.equal(events.some((event) => event.kind === "source_path_removed"), false);
});

test("active delete rollback preserves concurrent edits and retains journal on manifest conflict", async () => {
  const source = "sources/interrupted.md";
  const transactionPage = `${DOMAIN_ROOT}/concept/wiki_d_transaction_page.md`;
  const unknownPage = `${DOMAIN_ROOT}/concept/wiki_d_unknown_page.md`;
  const originalSource = "# Original source\n";
  const transactionSource = "# Transaction source\n";
  const concurrentSource = "# Concurrent source\n";
  const originalIndex = "{\"kind\":\"future\",\"value\":\"original\"}\n";
  const transactionIndex = "{\"kind\":\"future\",\"value\":\"transaction\"}\n";
  const concurrentIndex = "{\"kind\":\"future\",\"value\":\"concurrent\"}\n";
  const transactionPageContent = "# Transaction page\n";
  const concurrentPageContent = "# Concurrent page edit\n";
  const journal = {
    version: 3,
    status: "active",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [
      {
        path: transactionPage,
        before: journalImage(),
        after: journalImage(transactionPageContent),
      },
      {
        path: INDEX_PATH,
        before: journalImage(originalIndex),
        after: journalImage(transactionIndex),
      },
      {
        path: source,
        before: journalImage(originalSource),
        after: journalImage(transactionSource),
      },
    ],
    analyzedRemoval: { path: source, beforeHash: "hash" },
    entityTypeDeltas: [],
    deleted: 0,
    rebuilt: 1,
  };
  const adapter = new MemoryAdapter(new Map([
    [source, concurrentSource],
    [transactionPage, concurrentPageContent],
    [unknownPage, "# Unknown concurrent page\n"],
    [INDEX_PATH, concurrentIndex],
    [DELETE_JOURNAL_PATH, JSON.stringify(journal)],
  ]));
  const before = new Map(adapter.files);
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [{
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: [source],
        analyzed_sources: { [source]: "hash" },
      }],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /rollback conflict/i);

  assert.deepEqual(adapter.files, before);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("delete journal rejects an existing image whose content hash is forged", async () => {
  const source = "sources/interrupted.md";
  const transactionPage = `${DOMAIN_ROOT}/concept/wiki_d_transaction_page.md`;
  const adapter = new MemoryAdapter(new Map([
    [source, "# Source"],
    [transactionPage, "# After"],
    [DELETE_JOURNAL_PATH, JSON.stringify({
      version: 3,
      status: "active",
      domainId: "d",
      sourcePath: source,
      manifestComplete: true,
      mutations: [{
        path: transactionPage,
        before: journalImage("# Before"),
        after: { exists: true, content: "# After", hash: "forged" },
      }],
      analyzedRemoval: { path: source, beforeHash: "hash" },
      entityTypeDeltas: [],
      deleted: 0,
      rebuilt: 0,
    })],
  ]));
  const before = new Map(adapter.files);

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [{
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: [source],
        analyzed_sources: { [source]: "hash" },
      }],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /invalid.*journal/i);

  assert.deepEqual(adapter.files, before);
});

test("prepared journal transition rejects a stale but valid persisted payload before mutation", async () => {
  const { adapter, vaultTools, original } = setup();
  adapter.journalWriteTransform = (attempt, data) => {
    if (attempt !== 1) return data;
    const stale = JSON.parse(data) as { rebuilt: number };
    stale.rebuilt = 999;
    return JSON.stringify(stale);
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /journal.*verification|committed pre-publication/i);

  assert.equal(adapter.files.get(PAGE_PATH), "---\nresource: [source]\n---\n# Invalid");
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("active journal no-op stops before mutation and prepared recovery remains authoritative", async () => {
  const { adapter, vaultTools, original } = setup();
  adapter.journalWriteTransform = (attempt, data) => attempt === 2 ? null : data;
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /journal.*verification|committed pre-publication/i);

  assert.equal(adapter.files.get(PAGE_PATH), "---\nresource: [source]\n---\n# Invalid");
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.equal(
    (JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as { status: string }).status,
    "prepared",
  );
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );

  adapter.journalWriteTransform = undefined;
  const controller = new AbortController();
  controller.abort();
  for await (const _event of runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    controller.signal,
  )) {
    // drain recovery
  }
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
  assert.equal(adapter.files.get(PAGE_PATH), "---\nresource: [source]\n---\n# Invalid");
});

test("committed journal no-op rolls back governed mutations and emits no state", async () => {
  const { adapter, vaultTools, original } = setup();
  adapter.journalWriteTransform = (_attempt, data) =>
    (JSON.parse(data) as { status?: string }).status === "committed" ? null : data;
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /journal.*verification|committed pre-publication/i);

  assert.equal(adapter.files.get(PAGE_PATH), "---\nresource: [source]\n---\n# Invalid");
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("journal parser rejects prepared mutations and incomplete committed manifests", async () => {
  const preparedSource = "sources/prepared.md";
  const invalidJournals = [{
    version: 3,
    status: "prepared",
    domainId: "d",
    sourcePath: preparedSource,
    manifestComplete: true,
    mutations: [{
      path: preparedSource,
      before: journalImage("# Before"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: preparedSource, beforeHash: "hash" },
    entityTypeDeltas: [],
    deleted: 0,
    rebuilt: 0,
  }, {
    version: 3,
    status: "committed",
    domainId: "d",
    sourcePath: preparedSource,
    manifestComplete: false,
    mutations: [],
    analyzedRemoval: { path: preparedSource, beforeHash: "hash" },
    entityTypeDeltas: [],
    deleted: 0,
    rebuilt: 0,
  }];

  for (const journal of invalidJournals) {
    const adapter = new MemoryAdapter(new Map([
      [preparedSource, "# Before"],
      [DELETE_JOURNAL_PATH, JSON.stringify(journal)],
    ]));
    await assert.rejects(async () => {
      for await (const _event of runDelete(
        [preparedSource, "d"],
        new VaultTools(adapter, ""),
        unusedLlm,
        "m",
        [{
          id: "d",
          name: "D",
          wiki_folder: "d",
          source_paths: [preparedSource],
          analyzed_sources: { [preparedSource]: "hash" },
        }],
        "",
        new AbortController().signal,
      )) {
        // drain
      }
    }, /invalid.*journal/i);
    assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
    assert.equal(adapter.files.get(preparedSource), "# Before");
  }
});

test("delete journal is write-ahead durable before the first page removal and restart restores bytes", async () => {
  const { adapter, vaultTools, original } = setup();
  const pageBefore = adapter.files.get(PAGE_PATH)!;
  let observedAuthority = false;
  adapter.afterRemove = async (path) => {
    if (path !== PAGE_PATH || observedAuthority) return;
    observedAuthority = true;
    const journal = JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as {
      status: string;
      preparedMutation?: { path: string; before: { content?: string }; after: { exists: boolean } };
    };
    const authority = journal.preparedMutation;
    assert.equal(journal.status, "active");
    assert.equal(authority?.path, PAGE_PATH);
    assert.equal(authority?.before.content, pageBefore);
    assert.equal(authority?.after.exists, false);
    adapter.writeErrors.set(PAGE_PATH, new Error("synthetic crash blocks immediate rollback"));
    throw new Error("synthetic crash after page removal");
  };

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) {
      // drain interrupted run
    }
  });

  assert.equal(observedAuthority, true);
  assert.equal(adapter.files.has(PAGE_PATH), false);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);

  adapter.afterRemove = undefined;
  adapter.writeErrors.delete(PAGE_PATH);
  const aborted = new AbortController();
  aborted.abort();
  for await (const _event of runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    aborted.signal,
  )) {
    // recovery only
  }
  assert.equal(adapter.files.get(PAGE_PATH), pageBefore);
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

test("delete journal is write-ahead durable before index mutation and restart restores bytes", async () => {
  const { adapter, vaultTools, original } = setup();
  const pageBefore = adapter.files.get(PAGE_PATH)!;
  let observedAuthority = false;
  adapter.afterWrite = async (path, data) => {
    if (path !== INDEX_PATH
      || data.includes('"articleId":"invalid"')
      || observedAuthority) return;
    observedAuthority = true;
    const journal = JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as {
      preparedMutation?: { path: string; before: { content?: string }; after: { content?: string } };
    };
    const authority = journal.preparedMutation;
    assert.equal(authority?.path, INDEX_PATH);
    assert.equal(authority?.before.content, original);
    assert.equal(authority?.after.content, data);
    adapter.writeErrors.set(INDEX_PATH, new Error("synthetic crash blocks index rollback"));
    throw new Error("synthetic crash after index mutation");
  };

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) {
      // drain interrupted run
    }
  });

  assert.equal(observedAuthority, true);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  adapter.afterWrite = undefined;
  adapter.writeErrors.delete(INDEX_PATH);
  const aborted = new AbortController();
  aborted.abort();
  for await (const _event of runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    aborted.signal,
  )) {
    // recovery only
  }
  assert.equal(adapter.files.get(PAGE_PATH), pageBefore);
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

test("delete rolls back prior trusted mutations after a later third-state and retains journal", async () => {
  const { adapter, vaultTools } = setup();
  const pageBefore = adapter.files.get(PAGE_PATH)!;
  const thirdState = `${adapter.files.get(INDEX_PATH)!}THIRD_STATE\n`;
  let injected = false;
  adapter.afterWrite = async (path, data) => {
    if (path !== INDEX_PATH || data.includes('"articleId":"invalid"') || injected) return;
    injected = true;
    adapter.files.set(INDEX_PATH, thirdState);
    throw new Error("synthetic third-state index write");
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /rollback|third-state|untrustworthy|incomplete/i);

  assert.equal(adapter.files.get(PAGE_PATH), pageBefore);
  assert.equal(adapter.files.get(INDEX_PATH), thirdState);
  assert.equal(adapter.files.get(SOURCE_PATH), "# Source");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("committed delete verifies final manifest images before events and retains journal on recreation", async () => {
  const { adapter, vaultTools } = setup();
  const concurrentSource = "# Concurrent recreation\n";
  let recreated = false;
  adapter.afterWrite = async (path, data) => {
    if (path !== DELETE_JOURNAL_PATH || recreated) return;
    const journal = JSON.parse(data) as { status?: string };
    if (journal.status !== "committed") return;
    recreated = true;
    adapter.files.set(SOURCE_PATH, concurrentSource);
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /manifest|committed|conflict/i);

  assert.equal(recreated, true);
  assert.equal(adapter.files.get(SOURCE_PATH), concurrentSource);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(
    events.filter((event) =>
      event.kind === "source_path_removed"
      || event.kind === "source_path_added"
      || event.kind === "domain_updated"
      || event.kind === "result"),
    [],
  );

  adapter.afterWrite = undefined;
  const recoveryEvents: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) recoveryEvents.push(event);
  }, /manifest|committed|conflict/i);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(recoveryEvents, []);
});

test("delete source removal rechecks target after WAL persistence", async () => {
  const { adapter, vaultTools } = setup();
  const concurrentSource = "# Concurrent source edit during WAL\n";
  let injected = false;
  adapter.afterWrite = async (path, data) => {
    if (path !== DELETE_JOURNAL_PATH || injected) return;
    const parsed = JSON.parse(data) as {
      status?: string;
      preparedMutation?: { path?: string; after?: { exists?: boolean } };
    };
    const last = parsed.preparedMutation;
    if (parsed.status !== "active"
      || last?.path !== SOURCE_PATH
      || last.after?.exists !== false) return;
    injected = true;
    adapter.files.set(SOURCE_PATH, concurrentSource);
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /transaction conflict|rollback conflict|rollback manifest is incomplete/i);

  assert.equal(injected, true);
  assert.equal(adapter.files.get(SOURCE_PATH), concurrentSource);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.equal(events.some((event) => event.kind === "result"), false);
});

test("exact external source removal after WAL stays unowned and rolls back only prior mutations", async () => {
  const { adapter, vaultTools, original } = setup();
  const pageBefore = adapter.files.get(PAGE_PATH)!;
  let injected = false;
  adapter.afterWrite = async (path, data) => {
    if (path !== DELETE_JOURNAL_PATH || injected) return;
    const parsed = JSON.parse(data) as {
      status?: string;
      preparedMutation?: { path?: string; after?: { exists?: boolean } };
    };
    const last = parsed.preparedMutation;
    if (parsed.status !== "active"
      || last?.path !== SOURCE_PATH
      || last.after?.exists !== false) return;
    injected = true;
    adapter.files.delete(SOURCE_PATH);
  };

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /ambiguous|external|conflict|rollback/i);

  assert.equal(injected, true);
  assert.equal(adapter.files.has(SOURCE_PATH), false, "external removal must be preserved");
  assert.equal(adapter.files.get(PAGE_PATH), pageBefore);
  assert.equal(adapter.files.get(INDEX_PATH), original);
  assert.equal(
    adapter.timeline.filter((entry) => entry === `remove:${SOURCE_PATH}`).length,
    0,
  );
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
});

test("successful delete publishes one composite state commit", async () => {
  const { vaultTools } = setup();
  const events = await collectDelete(vaultTools);
  const publication = events.filter((event) =>
    (event as { kind: string }).kind === "delete_state_commit");

  assert.equal(publication.length, 1);
  assert.deepEqual(
    events.filter((event) =>
      event.kind === "source_path_added"
      || event.kind === "source_path_removed"
      || event.kind === "domain_updated"),
    [],
  );
});

test("live publication suspension cannot publish partial legacy state", async () => {
  const { adapter, vaultTools } = setup();
  const generator = runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    new AbortController().signal,
  );
  const observed: RunEvent[] = [];
  let publication: RunEvent | undefined;
  while (publication === undefined) {
    const next = await generator.next();
    assert.equal(next.done, false);
    publication = next.value.kind === "delete_state_commit" ? next.value : undefined;
    observed.push(next.value);
  }

  adapter.files.set(SOURCE_PATH, "# Recreated after publication yield\n");
  await assert.rejects(generator.next(), /manifest|conflict/i);

  assert.equal(adapter.files.get(SOURCE_PATH), "# Recreated after publication yield\n");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
  assert.deepEqual(
    observed.filter((event) =>
      event.kind === "source_path_added"
      || event.kind === "source_path_removed"
      || event.kind === "domain_updated"),
    [],
  );
});

test("controller publication precondition rejects recreation before one atomic domain transform", async () => {
  const source = "sources/publication.md";
  const sourceBefore = "# Publication source\n";
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage(sourceBefore),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: ["sources/new.md"],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, raw],
    [source, "# Concurrent recreation\n"],
  ]));
  const publication = {
    kind: "delete_state_commit" as const,
    domainId: "d",
    journalPath: DELETE_JOURNAL_PATH,
    journalHash: await deleteJournalDigest(raw),
    metadataPath: `${DOMAIN_ROOT}/metadata.jsonl`,
    sourcePathAdds: ["sources/new.md"],
    sourcePathRemoved: source,
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
  };
  const current: DomainEntry[] = [{
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash", "sources/other.md": "other-hash" },
  }];
  const saves: DomainEntry[][] = [];
  const store = {
    async readExactMetadata(path: string): Promise<{
      path: string;
      raw: string;
      entry: DomainEntry;
    }> {
      return { path, raw: metadataRaw(current[0]), entry: current[0] };
    },
    async writeExactMetadata(
      _snapshot: unknown,
      entry: DomainEntry,
    ): Promise<string> {
      saves.push([entry]);
      return metadataRaw(entry);
    },
  };

  await assert.rejects(
    persistDeleteStateCommitEvent(
      store,
      new VaultTools(adapter, ""),
      publication,
      "",
    ),
    /manifest|conflict/i,
  );
  assert.equal(saves.length, 0);
  assert.deepEqual(current[0].source_paths, [source]);
  assert.deepEqual(current[0].analyzed_sources, {
    [source]: "old-hash",
    "sources/other.md": "other-hash",
  });

  adapter.files.delete(source);
  await persistDeleteStateCommitEvent(
    store,
    new VaultTools(adapter, ""),
    publication,
    "",
  );
  assert.equal(saves.length, 1);
  assert.equal(
    (JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as { status?: string }).status,
    "published",
    "controller persistence must durably receipt publication before returning",
  );
  const next = saves[0];
  assert.deepEqual(next[0].source_paths, ["sources/new.md"]);
  assert.deepEqual(next[0].analyzed_sources, { "sources/other.md": "other-hash" });
  assert.deepEqual(current[0].source_paths, [source], "transform is atomic and non-mutating");
});

test("source recreation during publication receipt retains journal and fails closed", async () => {
  const source = "sources/receipt-race.md";
  const sourceBefore = "# Receipt source\n";
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage(sourceBefore),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, raw]]));
  adapter.afterWrite = async (path, data) => {
    if (path !== DELETE_JOURNAL_PATH) return;
    if ((JSON.parse(data) as { status?: string }).status === "published") {
      adapter.files.set(source, "# Recreated inside receipt transition\n");
    }
  };
  const current: DomainEntry[] = [{
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
  }];
  const event = {
    kind: "delete_state_commit" as const,
    domainId: "d",
    journalPath: DELETE_JOURNAL_PATH,
    journalHash: await deleteJournalDigest(raw),
    metadataPath: `${DOMAIN_ROOT}/metadata.jsonl`,
    sourcePathAdds: [],
    sourcePathRemoved: source,
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
  };

  await assert.rejects(
    persistDeleteStateCommitEvent({
      async readExactMetadata(path) {
        return { path, raw: metadataRaw(current[0]), entry: current[0] };
      },
      async writeExactMetadata(_snapshot, entry) {
        return metadataRaw(entry);
      },
    }, new VaultTools(adapter, ""), event, ""),
    /manifest|receipt|conflict/i,
  );

  assert.equal(adapter.files.get(source), "# Recreated inside receipt transition\n");
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
});

test("crash after metadata save but before receipt leaves publishing journal ambiguous", async () => {
  const source = "sources/receipt-crash.md";
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Receipt crash\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, raw]]));
  adapter.journalWriteTransform = (_attempt, data) =>
    (JSON.parse(data) as { status?: string }).status === "published" ? null : data;
  let saves = 0;
  const event = {
    kind: "delete_state_commit" as const,
    domainId: "d",
    journalPath: DELETE_JOURNAL_PATH,
    journalHash: await deleteJournalDigest(raw),
    metadataPath: `${DOMAIN_ROOT}/metadata.jsonl`,
    sourcePathAdds: [],
    sourcePathRemoved: source,
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
  };

  await assert.rejects(
    persistDeleteStateCommitEvent({
      async readExactMetadata(path) {
        const entry: DomainEntry = {
          id: "d",
          name: "D",
          wiki_folder: "d",
          source_paths: [source],
          analyzed_sources: { [source]: "old-hash" },
        };
        return { path, raw: metadataRaw(entry), entry };
      },
      async writeExactMetadata(_snapshot, entry) {
        saves++;
        return metadataRaw(entry);
      },
    }, new VaultTools(adapter, ""), event, ""),
    /journal.*verification|receipt/i,
  );

  assert.equal(saves, 1, "metadata reached its linearization write");
  assert.equal(adapter.files.get(DELETE_JOURNAL_PATH), raw);
});

test("delete publication rejects an existing target metadata blackhole write", async () => {
  const source = "sources/metadata.md";
  const target: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
  };
  const metaPath = `${DOMAIN_ROOT}/metadata.jsonl`;
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Metadata source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, raw],
    [metaPath, metadataRaw(target)],
  ]));
  adapter.blackholeWrites.add(metaPath);

  await assert.rejects(
    persistDeleteStateCommitEvent(
      domainStore(adapter),
      new VaultTools(adapter, ""),
      {
        kind: "delete_state_commit",
        domainId: "d",
        journalPath: DELETE_JOURNAL_PATH,
        journalHash: await deleteJournalDigest(raw),
        metadataPath: metaPath,
        sourcePathAdds: [],
        sourcePathRemoved: source,
        analyzedRemoval: { path: source, beforeHash: "old-hash" },
        entityTypeDeltas: [],
      },
      "",
    ),
    /metadata.*write|readback|verification/i,
  );

  assert.equal(adapter.files.get(metaPath), metadataRaw(target));
  assert.equal(
    (JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as { status?: string }).status,
    "publishing",
  );
});

test("delete publication preserves unrelated metadata and rejects a concurrent target edit", async () => {
  const source = "sources/metadata-race.md";
  const target: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
  };
  const concurrent = metadataRaw({ ...target, name: "Concurrent target edit" });
  const unrelatedPath = "!Wiki/other/metadata.jsonl";
  const unrelatedRaw = metadataRaw({
    id: "other",
    name: "Other",
    wiki_folder: "other",
    source_paths: ["sources/other.md"],
  });
  const metaPath = `${DOMAIN_ROOT}/metadata.jsonl`;
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Metadata race\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, raw],
    [metaPath, metadataRaw(target)],
    [unrelatedPath, unrelatedRaw],
  ]));
  let injected = false;
  adapter.afterRead = async (path) => {
    if (path !== metaPath || injected) return;
    injected = true;
    adapter.files.set(metaPath, concurrent);
  };

  await assert.rejects(
    persistDeleteStateCommitEvent(
      domainStore(adapter),
      new VaultTools(adapter, ""),
      {
        kind: "delete_state_commit",
        domainId: "d",
        journalPath: DELETE_JOURNAL_PATH,
        journalHash: await deleteJournalDigest(raw),
        metadataPath: metaPath,
        sourcePathAdds: [],
        sourcePathRemoved: source,
        analyzedRemoval: { path: source, beforeHash: "old-hash" },
        entityTypeDeltas: [],
      },
      "",
    ),
    /metadata.*conflict|expected-before/i,
  );

  assert.equal(adapter.files.get(metaPath), concurrent);
  assert.equal(adapter.files.get(unrelatedPath), unrelatedRaw);
  assert.equal(adapter.writePaths.includes(unrelatedPath), false);
});

test("delete publication writes only exact target metadata and preserves unrelated domain bytes", async () => {
  const source = "sources/metadata-success.md";
  const target: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
  };
  const metaPath = `${DOMAIN_ROOT}/metadata.jsonl`;
  const unrelatedPath = "!Wiki/other/metadata.jsonl";
  const unrelatedRaw = "{\"kind\":\"domain\",\"schemaVersion\":1,\"id\":\"other\",\"name\":\"Other\",\"wiki_folder\":\"other\",\"source_paths\":[]}\r\n";
  const raw = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Metadata success\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, raw],
    [metaPath, metadataRaw(target)],
    [unrelatedPath, unrelatedRaw],
  ]));

  await persistDeleteStateCommitEvent(
    domainStore(adapter),
    new VaultTools(adapter, ""),
    {
      kind: "delete_state_commit",
      domainId: "d",
      journalPath: DELETE_JOURNAL_PATH,
      journalHash: await deleteJournalDigest(raw),
      metadataPath: metaPath,
      sourcePathAdds: [],
      sourcePathRemoved: source,
      analyzedRemoval: { path: source, beforeHash: "old-hash" },
      entityTypeDeltas: [],
    },
    "",
  );

  assert.deepEqual((await domainStore(adapter).readExactMetadata(metaPath, "d")).entry.source_paths, []);
  assert.deepEqual((await domainStore(adapter).readExactMetadata(metaPath, "d")).entry.analyzed_sources, {});
  assert.equal(adapter.files.get(unrelatedPath), unrelatedRaw);
  assert.equal(adapter.writePaths.includes(unrelatedPath), false);
  assert.equal(
    (JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as { status?: string }).status,
    "published",
  );
});

test("delete publication cannot erase entity metadata through a malicious runtime kind", async () => {
  const source = "sources/entity-kind.md";
  const beforeType = {
    type: "concept",
    description: "Original concept",
    extraction_cues: ["original"],
  };
  const maliciousAfter = {
    type: "concept",
    description: "Updated concept",
    extraction_cues: ["updated"],
    kind: "vendor_opaque",
  };
  const target: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
    entity_types: [beforeType],
  };
  const metaPath = `${DOMAIN_ROOT}/metadata.jsonl`;
  const journal = {
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Entity kind source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [{
      type: "concept",
      before: beforeType,
      after: maliciousAfter,
    }],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  };
  const raw = JSON.stringify(journal);
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, raw],
    [metaPath, metadataRaw(target)],
  ]));

  await persistDeleteStateCommitEvent(
    domainStore(adapter),
    new VaultTools(adapter, ""),
    {
      kind: "delete_state_commit",
      domainId: "d",
      journalPath: DELETE_JOURNAL_PATH,
      journalHash: await deleteJournalDigest(raw),
      metadataPath: metaPath,
      sourcePathAdds: [],
      sourcePathRemoved: source,
      analyzedRemoval: { path: source, beforeHash: "old-hash" },
      entityTypeDeltas: journal.entityTypeDeltas,
    },
    "",
  );

  const stored = await domainStore(adapter).readExactMetadata(metaPath, "d");
  assert.deepEqual(stored.entry.entity_types, [{
    type: "concept",
    description: "Updated concept",
    extraction_cues: ["updated"],
  }]);
  assert.equal(stored.records.some((record) => record.kind === "vendor_opaque"), false);
  assert.equal(
    (JSON.parse(adapter.files.get(DELETE_JOURNAL_PATH)!) as { status?: string }).status,
    "published",
  );
});

test("publishing-journal recovery is ambiguous and never replays state", async () => {
  const source = "sources/replay.md";
  const sourceBefore = "# Replay source\n";
  const journal = JSON.stringify({
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage(sourceBefore),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, journal]]));
  const recoveryDomain: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
  };
  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [recoveryDomain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /publishing.*ambiguous|manual recovery/i);

  assert.deepEqual(events, []);
  assert.equal(adapter.files.get(DELETE_JOURNAL_PATH), journal);
});

test("published recovery never replays over a post-save ABA metadata edit", async () => {
  const source = "sources/aba.md";
  const publishing = {
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# ABA source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  };
  const publishingRaw = JSON.stringify(publishing);
  const publicationHash = await deleteJournalDigest(publishingRaw);
  const publishedRaw = JSON.stringify({
    ...publishing,
    status: "published",
    publicationHash,
  });
  const abaDomain: DomainEntry = {
    id: "d",
    name: "Concurrent ABA edit",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "new-concurrent-hash" },
  };
  const metadataPath = `${DOMAIN_ROOT}/metadata.jsonl`;
  const abaRaw = metadataRaw(abaDomain);
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, publishedRaw],
    [metadataPath, abaRaw],
  ]));
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [source, "d"],
    new VaultTools(adapter, ""),
    unusedLlm,
    "m",
    [abaDomain],
    "",
    new AbortController().signal,
  )) events.push(event);

  assert.equal(adapter.files.get(metadataPath), abaRaw);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
  assert.equal(events.some((event) => event.kind === "delete_state_commit"), false);
});

test("published cleanup rechecks manifest after its exact journal read", async () => {
  const source = "sources/cleanup-race.md";
  const publishing = {
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Original source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  };
  const publishingRaw = JSON.stringify(publishing);
  const publicationHash = await deleteJournalDigest(publishingRaw);
  const publishedRaw = JSON.stringify({
    ...publishing,
    status: "published",
    publicationHash,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, publishedRaw]]));
  let journalReads = 0;
  adapter.afterRead = (path) => {
    if (path === DELETE_JOURNAL_PATH && ++journalReads === 2) {
      adapter.files.set(source, "# Concurrent recreation during cleanup\n");
    }
  };
  const events: RunEvent[] = [];
  const recoveryDomain: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [],
    analyzed_sources: {},
  };

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [recoveryDomain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /manifest conflict/i);

  assert.equal(adapter.files.get(source), "# Concurrent recreation during cleanup\n");
  assert.equal(adapter.files.get(DELETE_JOURNAL_PATH), publishedRaw);
  assert.equal(events.some((event) => event.kind === "result"), false);
});

test("published recovery rejects receipt whose publishing predecessor was tampered", async () => {
  const source = "sources/tampered-receipt.md";
  const publishing = {
    version: 3,
    status: "publishing",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Tampered source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  };
  const publicationHash = await deleteJournalDigest(JSON.stringify(publishing));
  const publishedRaw = JSON.stringify({
    ...publishing,
    rebuilt: 99,
    status: "published",
    publicationHash,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, publishedRaw]]));
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [{
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: [],
        analyzed_sources: {},
      }],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /publication.*predecessor|receipt.*integrity|publication hash/i);

  assert.equal(adapter.files.get(DELETE_JOURNAL_PATH), publishedRaw);
  assert.equal(events.some((event) => event.kind === "result"), false);
});

test("FNV-colliding journal bytes cannot satisfy publication binding", async () => {
  const first = "{\"version\":3,\"status\":\"publishing\",\"domainId\":\"d\",\"sourcePath\":\"sources/x.md\",\"manifestComplete\":true,\"mutations\":[{\"path\":\"sources/x.md\",\"before\":{\"exists\":true,\"content\":\"# x\",\"hash\":\"fnv1a:3ebd874a\"},\"after\":{\"exists\":false}}],\"analyzedRemoval\":{\"path\":\"sources/x.md\"},\"entityTypeDeltas\":[],\"sourcePathAdds\":[],\"deleted\":0,\"rebuilt\":0,\"nonce\":\"1ncncws1ojk6ob\"}";
  const second = "{\"version\":3,\"status\":\"publishing\",\"domainId\":\"d\",\"sourcePath\":\"sources/x.md\",\"manifestComplete\":true,\"mutations\":[{\"path\":\"sources/x.md\",\"before\":{\"exists\":true,\"content\":\"# x\",\"hash\":\"fnv1a:3ebd874a\"},\"after\":{\"exists\":false}}],\"analyzedRemoval\":{\"path\":\"sources/x.md\"},\"entityTypeDeltas\":[],\"sourcePathAdds\":[],\"deleted\":0,\"rebuilt\":0,\"nonce\":\"9swo9e1ad8rux\"}";
  assert.notEqual(first, second);
  assert.equal(contentHash(first), contentHash(second));
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, second]]));

  await assert.rejects(
    verifyDeleteStateCommitEvent(
      new VaultTools(adapter, ""),
      {
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: ["sources/x.md"],
      },
      {
        kind: "delete_state_commit",
        domainId: "d",
        journalPath: DELETE_JOURNAL_PATH,
        journalHash: await deleteJournalDigest(first),
        metadataPath: `${DOMAIN_ROOT}/metadata.jsonl`,
        sourcePathAdds: [],
        sourcePathRemoved: "sources/x.md",
        analyzedRemoval: { path: "sources/x.md" },
        entityTypeDeltas: [],
      },
    ),
    /precondition|digest|hash/i,
  );
});

test("committed journal with no target-source mutation is structurally invalid", async () => {
  const source = "sources/impossible.md";
  const raw = JSON.stringify({
    version: 3,
    status: "committed",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 0,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, raw]]));

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [{
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: [source],
        analyzed_sources: { [source]: "old-hash" },
      }],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /invalid.*journal/i);

  assert.equal(adapter.files.get(DELETE_JOURNAL_PATH), raw);
});

test("committed recovery rolls back trusted pages while preserving recreated source", async () => {
  const source = "sources/recreated.md";
  const page = `${DOMAIN_ROOT}/concept/recovery.md`;
  const pageBefore = "# Recovery page\n";
  const sourceBefore = "# Original source\n";
  const sourceConcurrent = "# Recreated source\n";
  const journal = JSON.stringify({
    version: 3,
    status: "committed",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: page,
      before: journalImage(pageBefore),
      after: journalImage(),
    }, {
      path: source,
      before: journalImage(sourceBefore),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [],
    sourcePathAdds: [],
    deleted: 1,
    rebuilt: 0,
  });
  const adapter = new MemoryAdapter(new Map([
    [source, sourceConcurrent],
    [DELETE_JOURNAL_PATH, journal],
  ]));

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [source, "d"],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [{
        id: "d",
        name: "D",
        wiki_folder: "d",
        source_paths: [source],
        analyzed_sources: { [source]: "old-hash" },
      }],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /rollback|conflict/i);

  assert.equal(adapter.files.get(page), pageBefore);
  assert.equal(adapter.files.get(source), sourceConcurrent);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
});

test("committed delete journal applies domain deltas without overwriting unrelated additions", async () => {
  const source = "sources/interrupted.md";
  const beforeType = {
    type: "concept",
    description: "Before",
    extraction_cues: ["before"],
    wiki_subfolder: "concept",
  };
  const afterType = {
    ...beforeType,
    description: "After",
    extraction_cues: ["after"],
  };
  const unrelatedType = {
    type: "concurrent",
    description: "Concurrent",
    extraction_cues: ["concurrent"],
    wiki_subfolder: "concurrent",
  };
  const adapter = new MemoryAdapter(new Map([
    [DELETE_JOURNAL_PATH, JSON.stringify({
      version: 3,
      status: "committed",
      domainId: "d",
      sourcePath: source,
      manifestComplete: true,
      mutations: [{
        path: source,
        before: journalImage("# Interrupted source\n"),
        after: journalImage(),
      }],
      analyzedRemoval: { path: source, beforeHash: "old-hash" },
      entityTypeDeltas: [{ type: "concept", before: beforeType, after: afterType }],
      sourcePathAdds: [],
      deleted: 1,
      rebuilt: 1,
    })],
  ]));
  const recoveryDomain: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: {
      [source]: "old-hash",
      "sources/concurrent.md": "concurrent-hash",
    },
    entity_types: [beforeType, unrelatedType],
  };
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [source, "d"],
    new VaultTools(adapter, ""),
    unusedLlm,
    "m",
    [recoveryDomain],
    "",
    new AbortController().signal,
  )) events.push(event);

  const publication = events.find((event) => event.kind === "delete_state_commit");
  assert.ok(publication);
  const nextDomain = applyDeleteStateCommitEvent([recoveryDomain], publication, "")[0];
  assert.deepEqual(nextDomain.entity_types, [afterType, unrelatedType]);
  assert.deepEqual(nextDomain.analyzed_sources, {
    "sources/concurrent.md": "concurrent-hash",
  });
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

test("committed delete journal retains durable state on same-key domain conflicts", async () => {
  const source = "sources/interrupted.md";
  const beforeType = {
    type: "concept",
    description: "Before",
    extraction_cues: ["before"],
    wiki_subfolder: "concept",
  };
  const afterType = { ...beforeType, description: "After" };
  const journal = JSON.stringify({
    version: 3,
    status: "committed",
    domainId: "d",
    sourcePath: source,
    manifestComplete: true,
    mutations: [{
      path: source,
      before: journalImage("# Interrupted source\n"),
      after: journalImage(),
    }],
    analyzedRemoval: { path: source, beforeHash: "old-hash" },
    entityTypeDeltas: [{ type: "concept", before: beforeType, after: afterType }],
    deleted: 1,
    rebuilt: 1,
  });
  const cases: DomainEntry[] = [{
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "concurrent-hash" },
    entity_types: [beforeType],
  }, {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: [source],
    analyzed_sources: { [source]: "old-hash" },
    entity_types: [{ ...beforeType, description: "Concurrent type edit" }],
  }];

  for (const recoveryDomain of cases) {
    const adapter = new MemoryAdapter(new Map([[DELETE_JOURNAL_PATH, journal]]));
    const events: RunEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of runDelete(
        [source, "d"],
        new VaultTools(adapter, ""),
        unusedLlm,
        "m",
        [recoveryDomain],
        "",
        new AbortController().signal,
      )) events.push(event);
    }, /domain (?:analyzed source|entity type) conflict/i);
    assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), true);
    assert.deepEqual(
      events.filter((event) =>
        event.kind === "source_path_removed" || event.kind === "domain_updated"),
      [],
    );
  }
});

test("delete aborts before journal or writes when a governed page cannot be read", async () => {
  const { adapter, vaultTools } = setup();
  const readError = new Error("EACCES: governed page");
  adapter.readErrors.set(PAGE_PATH, readError);
  const before = new Map(adapter.files);

  await assert.rejects(collectDelete(vaultTools), (error) => error === readError);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

test("delete aborts before journal or writes when source inventory cannot be listed", async () => {
  const { adapter } = setup();
  const inventoryDomain: DomainEntry = {
    ...domain,
    source_paths: ["sources"],
  };
  const listError = new Error("EACCES: sources");
  adapter.listErrors.set("sources", listError);
  const before = new Map(adapter.files);

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, inventoryDomain.id],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [inventoryDomain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, (error) => error === listError);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

test("delete rejects a readable target outside the authoritative source inventory", async () => {
  const { adapter } = setup();
  const ungoverned = "archive/source.md";
  adapter.files.set(ungoverned, "# Ungoverned source");
  adapter.files.set("sources/governed.md", "# Governed source");
  const before = new Map(adapter.files);
  const inventoryDomain: DomainEntry = {
    ...domain,
    source_paths: ["sources/governed.md"],
  };

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [ungoverned, inventoryDomain.id],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [inventoryDomain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /not (?:an exact member|governed)/i);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

test("delete rejects a target stem that is ambiguous across governed sources", async () => {
  const { adapter } = setup();
  const duplicate = "archive/source.md";
  adapter.files.set(duplicate, "# Other source with the same stem");
  const before = new Map(adapter.files);
  const inventoryDomain: DomainEntry = {
    ...domain,
    source_paths: ["sources", "archive"],
  };

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, inventoryDomain.id],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [inventoryDomain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /target stem source.*found 2/i);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

test("delete prunes analyzed_sources by exact target path only", async () => {
  const { adapter } = setup();
  const sameStemPath = "archive/source.md";
  const exactDomain: DomainEntry = {
    ...domain,
    analyzed_sources: {
      [SOURCE_PATH]: "source-hash",
      [sameStemPath]: "same-stem-hash",
      "sources/other.md": "other-hash",
    },
  };
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [SOURCE_PATH, exactDomain.id],
    new VaultTools(adapter, ""),
    unusedLlm,
    "m",
    [exactDomain],
    "",
    new AbortController().signal,
  )) events.push(event);

  const publication = events.find((event) => event.kind === "delete_state_commit");
  assert.ok(publication);
  assert.deepEqual(
    applyDeleteStateCommitEvent([exactDomain], publication, "")[0].analyzed_sources,
    {
      [sameStemPath]: "same-stem-hash",
      "sources/other.md": "other-hash",
    },
  );
});

test("delete forward CAS preserves a page changed after the deletion plan event", async () => {
  const { adapter, vaultTools } = setup();
  const generator = runDelete(
    [SOURCE_PATH, domain.id],
    vaultTools,
    unusedLlm,
    "m",
    [domain],
    "",
    new AbortController().signal,
  );
  const events: RunEvent[] = [];
  let mutated = false;

  await assert.rejects(async () => {
    while (true) {
      const next = await generator.next();
      if (next.done) break;
      events.push(next.value);
      if (!mutated && next.value.kind === "info_text" && next.value.icon === "trash") {
        mutated = true;
        adapter.files.set(PAGE_PATH, "# Concurrent governed page edit\n");
      }
    }
  }, /planned page changed/i);

  assert.equal(adapter.files.get(PAGE_PATH), "# Concurrent governed page edit\n");
  assert.equal(adapter.files.has(SOURCE_PATH), true);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("delete conditional remove rejects a page changed after the external guard", async () => {
  const { adapter, vaultTools } = setup();
  const concurrent = "# Concurrent change inside the guard gap\n";
  adapter.onExists = (path, count) => {
    if (path === PAGE_PATH && count === 2) adapter.files.set(PAGE_PATH, concurrent);
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, domain.id],
      vaultTools,
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) events.push(event);
  }, /transaction conflict|planned page changed/i);

  assert.equal(adapter.files.get(PAGE_PATH), concurrent);
  assert.equal(adapter.files.has(SOURCE_PATH), true);
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("delete forward CAS preserves a target source changed during rebuild", async () => {
  const { adapter, rebuildDomain, llm, opts } = transactionalRebuildSetup(false);
  const create = (llm as unknown as {
    chat: { completions: { create: (params: unknown) => Promise<unknown> } };
  }).chat.completions.create;
  let mutated = false;
  (llm as unknown as {
    chat: { completions: { create: (params: unknown) => Promise<unknown> } };
  }).chat.completions.create = async (params: unknown) => {
    if (!mutated && messageText(params).includes("CHUNK_ID ")) {
      mutated = true;
      adapter.files.set(SOURCE_PATH, "CONCURRENT_TARGET_EDIT");
    }
    return create(params);
  };
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runDelete(
      [SOURCE_PATH, rebuildDomain.id],
      new VaultTools(adapter, "/vault"),
      llm,
      "mock",
      [rebuildDomain],
      "/vault",
      new AbortController().signal,
      opts,
    )) events.push(event);
  }, /target source changed/i);

  assert.equal(adapter.files.get(SOURCE_PATH), "CONCURRENT_TARGET_EDIT");
  assert.deepEqual(
    events.filter((event) => event.kind === "source_path_removed" || event.kind === "domain_updated"),
    [],
  );
});

test("delete aborts unchanged when a rebuild resource has no unique remaining source", async () => {
  const rebuildPage = `${DOMAIN_ROOT}/concept/wiki_d_unresolved.md`;
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, "# Source"],
    [rebuildPage, "---\nresource: [source, missing]\n---\n# Shared\n"],
    [INDEX_PATH, records().map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const before = new Map(adapter.files);

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, domain.id],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [domain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /resource missing.*resolve uniquely/i);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

test("delete aborts unchanged when a rebuild resource stem is ambiguous", async () => {
  const rebuildPage = `${DOMAIN_ROOT}/concept/wiki_d_ambiguous.md`;
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, "# Source"],
    ["sources-a/shared.md", "# Shared A"],
    ["sources-b/shared.md", "# Shared B"],
    [rebuildPage, "---\nresource: [source, shared]\n---\n# Shared\n"],
    [INDEX_PATH, records().map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const ambiguousDomain: DomainEntry = {
    ...domain,
    source_paths: ["sources", "sources-a", "sources-b"],
  };
  const before = new Map(adapter.files);

  await assert.rejects(async () => {
    for await (const _event of runDelete(
      [SOURCE_PATH, ambiguousDomain.id],
      new VaultTools(adapter, ""),
      unusedLlm,
      "m",
      [ambiguousDomain],
      "",
      new AbortController().signal,
    )) {
      // drain
    }
  }, /resource shared.*found 2/i);

  assert.deepEqual(adapter.files, before);
  assert.deepEqual(adapter.timeline, []);
});

function transactionalRebuildSetup(failSecond: boolean): {
  adapter: MemoryAdapter;
  rebuildDomain: DomainEntry;
  llm: LlmClient;
  opts: {
    inputBudgetTokens: number;
    maxTokens: number;
    semanticCompression: { profile: "balanced"; operation: "ingest" };
    structuredRetries: number;
  };
} {
  const sharedPath = `${DOMAIN_ROOT}/concept/wiki_d_shared_transaction.md`;
  const firstPath = `${DOMAIN_ROOT}/concept/wiki_d_first.md`;
  const secondPath = `${DOMAIN_ROOT}/concept/wiki_d_second.md`;
  const firstSource = "sources/a.md";
  const secondSource = "sources/b.md";
  const sharedPage = [
    "---",
    "type: concept",
    "description: Shared transaction page.",
    "resource: [source, a, b]",
    "---",
    "# Shared",
    "",
    "## Facts",
    "Original shared fact.",
    "",
  ].join("\n");
  const adapter = new MemoryAdapter(new Map([
    [SOURCE_PATH, "TARGET_ONLY"],
    [firstSource, "A_UNIQUE_FACT"],
    [secondSource, "B_UNIQUE_FACT"],
    [sharedPath, sharedPage],
    [INDEX_PATH, JSON.stringify({
      kind: "page",
      schemaVersion: 1,
      articleId: "wiki_d_shared_transaction",
      path: sharedPath,
      type: "concept",
      description: "Shared transaction page.",
      resource: ["source", "a", "b"],
      bodyHash: contentHash(sharedPage),
      descriptionHash: contentHash("Shared transaction page."),
    }) + "\n"],
  ]));
  const rebuildDomain: DomainEntry = {
    id: "d",
    name: "D",
    wiki_folder: "d",
    source_paths: ["sources"],
    analyzed_sources: {
      [SOURCE_PATH]: "target-hash",
      [firstSource]: "a-hash",
      [secondSource]: "b-hash",
    },
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["fact"],
      wiki_subfolder: "concept",
    }],
  };
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = messageText(params);
      if (prompt.includes("CHUNK_ID ")) {
        const isFirst = prompt.includes("A_UNIQUE_FACT");
        if (!isFirst && failSecond) throw new Error("second rebuild failed");
        const key = isFirst ? "first" : "second";
        const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
          packets: [{
            id: `packet-${key}`,
            chunkId,
            entityKey: key,
            entityType: "concept",
            facts: [`${key} fact`],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: `sources/${isFirst ? "a" : "b"}.md:1`,
          }],
          noEvidence: [],
        }));
      }
      const isFirst = prompt.includes("Entity bundle: entity-first");
      const isSecond = prompt.includes("Entity bundle: entity-second");
      if (isFirst || isSecond) {
        const key = isFirst ? "first" : "second";
        const path = isFirst ? firstPath : secondPath;
        const resource = isFirst ? "a" : "b";
        return mockChatResponse(params, JSON.stringify({
          reasoning: `Create ${key}.`,
          actions: [{
            kind: "create",
            entityKey: key,
            path,
            annotation: `${key} concept.`,
            content: [
              "---",
              "type: concept",
              `description: ${key} concept.`,
              `resource: [${resource}]`,
              "---",
              `# ${key}`,
              "",
              "## Facts",
              `${key} fact`,
              "",
            ].join("\n"),
          }],
          skips: [],
          entity_types_delta: [{
            type: `delta_${key}`,
            description: `${key} delta.`,
            extraction_cues: [key],
            wiki_subfolder: `delta_${key}`,
          }],
        }));
      }
      throw new Error(`unexpected transactional rebuild prompt: ${prompt.slice(0, 120)}`);
    } } },
  } as unknown as LlmClient;
  return {
    adapter,
    rebuildDomain,
    llm,
    opts: {
      inputBudgetTokens: 20_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
  };
}

test("later rebuild failure discards earlier domain, source-path, final, eval, and log effects", async () => {
  const { adapter, rebuildDomain, llm, opts } = transactionalRebuildSetup(true);
  const before = new Map(adapter.files);
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [SOURCE_PATH, rebuildDomain.id],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [rebuildDomain],
    "/vault",
    new AbortController().signal,
    opts,
  )) events.push(event);

  assert.deepEqual(adapter.files, before);
  assert.equal(adapter.timeline.includes(`write:${LOG_PATH}`), false);
  assert.equal(events.some((event) => event.kind === "source_path_added"), false);
  assert.equal(events.some((event) =>
    event.kind === "domain_updated" && event.patch.entity_types !== undefined), false);
  assert.equal(events.some((event) => event.kind === "eval_meta"), false);
  assert.equal(events.some((event) =>
    event.kind === "assistant_text" && /Ingested|created/i.test(event.delta)), false);
});

test("delete rollback reloads embedding cache from restored index before later similarity access", async () => {
  const { adapter, rebuildDomain, llm, opts } = transactionalRebuildSetup(true);
  const sharedPath = `${DOMAIN_ROOT}/concept/wiki_d_shared_transaction.md`;
  const sharedPage = adapter.files.get(sharedPath)!;
  const currentIndex = adapter.files.get(INDEX_PATH)!;
  const restoredChunk: ChunkIndexRecord = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_d_shared_transaction",
    path: sharedPath,
    heading: "",
    ordinal: 0,
    bodyHash: contentHash(sharedPage),
    embedTextHash: "restored-shared-vector",
    vector: [1, 0],
    vectorModel: "mock-embedding",
    dimensions: 2,
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  adapter.files.set(INDEX_PATH, `${currentIndex}${JSON.stringify(restoredChunk)}\n`);
  const originalIndex = adapter.files.get(INDEX_PATH)!;
  const service = new PageSimilarityService({
    mode: "embedding",
    topK: 5,
    model: "mock-embedding",
    dimensions: 2,
    baseUrl: "http://embedding.test",
    apiKey: "test",
  });
  const vaultTools = new VaultTools(adapter, "/vault");
  await service.loadCache(DOMAIN_ROOT, vaultTools);
  const globalWithRequest = globalThis as typeof globalThis & {
    __obsidianRequestUrlForTest?: (options: { body?: string }) => Promise<{ status: number; text: string }>;
  };
  const previousRequest = globalWithRequest.__obsidianRequestUrlForTest;
  let embeddingCalls = 0;
  globalWithRequest.__obsidianRequestUrlForTest = async (options) => {
    embeddingCalls++;
    const body = JSON.parse(options.body ?? "{}") as { input?: string[] };
    return {
      status: 200,
      text: JSON.stringify({
        data: (body.input ?? []).map(() => ({ embedding: [0, 1] })),
      }),
    };
  };
  try {
    for await (const _event of runDelete(
      [SOURCE_PATH, rebuildDomain.id],
      vaultTools,
      llm,
      "mock",
      [rebuildDomain],
      "/vault",
      new AbortController().signal,
      opts,
      service,
    )) {
      // drain controlled rebuild failure
    }

    assert.ok(embeddingCalls > 0);
    assert.equal(adapter.files.get(INDEX_PATH), originalIndex);
    await service.loadCache(DOMAIN_ROOT, vaultTools);
    const match = await service.maxSimilarityToExisting("STALE_QUERY", new Set());
    assert.deepEqual(match, { pid: "", score: 0 });
  } finally {
    globalWithRequest.__obsidianRequestUrlForTest = previousRequest;
  }
});

test("successful transactional rebuilds publish one deterministic union of entity deltas", async () => {
  const { adapter, rebuildDomain, llm, opts } = transactionalRebuildSetup(false);
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [SOURCE_PATH, rebuildDomain.id],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [rebuildDomain],
    "/vault",
    new AbortController().signal,
    opts,
  )) events.push(event);

  const publications = events.filter((event) => event.kind === "delete_state_commit");
  assert.equal(publications.length, 1, JSON.stringify(publications));
  assert.deepEqual(
    applyDeleteStateCommitEvent([rebuildDomain], publications[0], "/vault")[0]
      .entity_types?.map((entityType) => entityType.type),
    ["concept", "delta_first", "delta_second"],
  );
  assert.equal(
    adapter.timeline.filter((entry) => entry === `write:${LOG_PATH}`).length,
    2,
  );
  const logRecords = adapter.files.get(LOG_PATH)!.trim().split("\n")
    .map((line) => JSON.parse(line) as { sourcePath?: string });
  assert.deepEqual(logRecords.map((record) => record.sourcePath), [
    "sources/a.md",
    "sources/b.md",
  ]);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});

test("delete rebuild transaction accepts exact legacy index and log migration paths", async () => {
  const { adapter, rebuildDomain, llm, opts } = transactionalRebuildSetup(false);
  const legacyIndex = `${DOMAIN_ROOT}/_config/_index.md`;
  const legacyLog = `${DOMAIN_ROOT}/_config/_log.md`;
  adapter.files.set(legacyIndex, adapter.files.get(INDEX_PATH)!);
  adapter.files.delete(INDEX_PATH);
  adapter.files.set(legacyLog, "");
  const events: RunEvent[] = [];

  for await (const event of runDelete(
    [SOURCE_PATH, rebuildDomain.id],
    new VaultTools(adapter, "/vault"),
    llm,
    "mock",
    [rebuildDomain],
    "/vault",
    new AbortController().signal,
    opts,
  )) events.push(event);

  assert.equal(events.some((event) => event.kind === "result"), true, JSON.stringify(events));
  assert.equal(adapter.files.has(legacyIndex), false);
  assert.equal(adapter.files.has(legacyLog), false);
  assert.equal(adapter.files.has(INDEX_PATH), true);
  assert.equal(adapter.files.has(LOG_PATH), true);
  assert.equal(adapter.files.has(DELETE_JOURNAL_PATH), false);
});
