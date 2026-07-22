import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { IngestOutcome, LlmClient, RunEvent } from "../src/types";
import { mockChatResponse } from "./openai-mock-response";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { VaultTools } = await import("../src/vault-tools");
const { PageSimilarityService } = await import("../src/page-similarity");
const { runIngest } = await import("../src/phases/ingest");
const { inspectPatchablePage } = await import("../src/section-patches");
const { parseWikiIndexJsonl } = await import("../src/wiki-index-jsonl");

function contentChunk(content: string) {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}

function usageChunk() {
  return { id: "u", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}

class MemoryAdapter {
  readonly readErrors = new Map<string, Error>();

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const readError = this.readErrors.get(path);
    if (readError) throw readError;
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async append(path: string, data: string): Promise<void> { this.files.set(path, (this.files.get(path) ?? "") + data); }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files].some(([file]) => file.startsWith(`${path}/`));
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
      else folders.add(prefix + remainder.slice(0, slash));
    }
    return { files, folders: [...folders] };
  }
}

async function drain(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
): Promise<IngestOutcome> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
  }
}

function mapperOutput(prompt: string, entityKey = "alpha"): string {
  const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
  assert.ok(chunkId);
  return JSON.stringify({
    packets: [{
      id: `packet-${chunkId}`,
      chunkId,
      entityKey,
      entityType: "concept",
      facts: ["Alpha is described here."],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      links: [],
      sourceAnchor: "src/source.md:1",
    }],
    noEvidence: [],
  });
}

test("chunk-only renamed page gets a typed description before real Jaccard candidate retrieval", async () => {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/d/concept/wiki_d_legacy_alias.md";
  const duplicatePath = "!Wiki/d/concept/wiki_d_renamed_alpha.md";
  const indexPath = "!Wiki/d/index.jsonl";
  const pageContent = [
    "---",
    "type: concept",
    "description: Renamed Alpha canonical concept.",
    "resource: [source]",
    "---",
    "# Legacy Alias",
    "",
    "## Facts",
    "Existing renamed alias facts.",
  ].join("\n");
  const chunkOnly = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_d_legacy_alias",
    path: pagePath,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "m",
    dimensions: 2,
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, "# Source\n\nRenamed Alpha canonical concept."],
    [pagePath, pageContent],
    [indexPath, JSON.stringify(chunkOnly) + "\n"],
  ]));
  const prompts: unknown[] = [];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      prompts.push(params);
      const prompt = JSON.stringify(params);
      const output = prompt.includes("CHUNK_ID ")
        ? mapperOutput(prompt, "renamed-alpha")
        : prompt.includes("Existing renamed alias facts.")
          ? JSON.stringify({
            reasoning: "No changes.",
            actions: [],
            skips: [{ entityKey: "renamed-alpha", reason: "Already covered by renamed page." }],
            entity_types_delta: [],
          })
          : JSON.stringify({
            reasoning: "Create a duplicate because no candidate was supplied.",
            actions: [{
              kind: "create",
              entityKey: "renamed-alpha",
              path: duplicatePath,
              annotation: "Renamed Alpha duplicate.",
              content: "# Renamed Alpha\n\n## Facts\nRenamed Alpha canonical concept.\n",
            }],
            skips: [],
            entity_types_delta: [],
          });
      return mockChatResponse(params, output, { promptTokens: 1, completionTokens: 1 });
    } } },
  } as unknown as LlmClient;
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: 5 });
  const domain = {
    id: "d",
    name: "Domain",
    wiki_folder: "d",
    source_paths: ["src"],
    entity_types: [{
      type: "concept",
      description: "Concept",
      extraction_cues: ["Alpha"],
      min_mentions_for_page: 1,
      wiki_subfolder: "concept",
    }],
    pageNameVersion: 1,
  };

  const outcome = await drain(runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [domain],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    similarity,
  ));

  assert.equal(outcome.ok, true);
  assert.equal(adapter.files.has(duplicatePath), false);
  assert.equal(JSON.stringify(prompts.at(-1)).includes("Existing renamed alias facts."), true);
  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "wiki_d_legacy_alias"), true);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "wiki_d_legacy_alias"), true);
});

test("stale valid page description is reconciled from Markdown before candidate retrieval", async () => {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/d/concept/wiki_d_legacy_alias.md";
  const duplicatePath = "!Wiki/d/concept/wiki_d_renamed_alpha.md";
  const indexPath = "!Wiki/d/index.jsonl";
  const pageContent = [
    "---",
    "type: concept",
    "description: Renamed Alpha canonical concept.",
    "resource: [source]",
    "---",
    "# Legacy Alias",
    "",
    "## Facts",
    "Existing renamed alias facts.",
  ].join("\n");
  const stalePage = {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_d_legacy_alias",
    path: pagePath,
    type: "concept",
    description: "Unrelated stale description with no matching terms.",
    resource: ["source"],
    bodyHash: "stale-body",
    descriptionHash: "stale-description",
  };
  const chunkOnly = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_d_legacy_alias",
    path: pagePath,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "m",
    dimensions: 2,
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, "# Source\n\nRenamed Alpha canonical concept."],
    [pagePath, pageContent],
    [indexPath, `${JSON.stringify(stalePage)}\n${JSON.stringify(chunkOnly)}\n`],
  ]));
  const prompts: unknown[] = [];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      prompts.push(params);
      const prompt = JSON.stringify(params);
      const output = prompt.includes("CHUNK_ID ")
        ? mapperOutput(prompt, "renamed-alpha")
        : prompt.includes("Existing renamed alias facts.")
          ? JSON.stringify({
            reasoning: "No changes.",
            actions: [],
            skips: [{ entityKey: "renamed-alpha", reason: "Already covered." }],
            entity_types_delta: [],
          })
          : JSON.stringify({
            reasoning: "No fresh candidate was supplied.",
            actions: [{
              kind: "create",
              entityKey: "renamed-alpha",
              path: duplicatePath,
              annotation: "Renamed Alpha duplicate.",
              content: "# Renamed Alpha\n\n## Facts\nRenamed Alpha canonical concept.\n",
            }],
            skips: [],
            entity_types_delta: [],
          });
      return mockChatResponse(params, output, { promptTokens: 1, completionTokens: 1 });
    } } },
  } as unknown as LlmClient;
  const domain = {
    id: "d",
    name: "Domain",
    wiki_folder: "d",
    source_paths: ["src"],
    entity_types: [{
      type: "concept",
      description: "Concept",
      extraction_cues: ["Alpha"],
      min_mentions_for_page: 1,
      wiki_subfolder: "concept",
    }],
    pageNameVersion: 1,
  };

  const outcome = await drain(runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [domain],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));

  assert.equal(outcome.ok, true);
  assert.equal(adapter.files.has(duplicatePath), false);
  assert.equal(JSON.stringify(prompts.at(-1)).includes("Existing renamed alias facts."), true);
  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  const pageRecord = records.find((record) =>
    record.kind === "page" && record.articleId === "wiki_d_legacy_alias");
  assert.equal(pageRecord?.description, "Renamed Alpha canonical concept.");
  assert.equal(records.some((record) =>
    record.kind === "chunk" && record.articleId === "wiki_d_legacy_alias"), true);
});

test("renamed existing page patch keeps authoritative path and fresh page-record type", async () => {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/d/concept/wiki_d_legacy_alias.md";
  const duplicatePath = "!Wiki/d/topic/wiki_d_renamed_alpha.md";
  const pageContent = [
    "---",
    "type: concept",
    "description: Renamed Alpha canonical concept.",
    "resource: [old-source]",
    "---",
    "# Legacy Alias",
    "",
    "## Facts",
    "Existing renamed alias facts.",
    "",
  ].join("\n");
  const inspected = inspectPatchablePage(pageContent);
  const facts = inspected.sections.find((section) => section.heading === "## Facts");
  assert.ok(facts);
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, "# Source\n\nRenamed Alpha has a newly processed fact."],
    ["src/old-source.md", "Old source."],
    [pagePath, pageContent],
  ]));
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      if (prompt.includes("CHUNK_ID ")) {
        const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
        assert.ok(chunkId);
        return mockChatResponse(params, JSON.stringify({
            packets: [{
              id: `packet-${chunkId}`,
              chunkId,
              entityKey: "renamed-alpha",
              entityType: "topic",
              facts: ["Renamed Alpha has a newly processed fact."],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: `${sourcePath}:1`,
            }],
            noEvidence: [],
          }), { promptTokens: 1, completionTokens: 1 });
      }
      assert.match(prompt, /Existing renamed alias facts/);
      return mockChatResponse(params, JSON.stringify({
          reasoning: "Patch the authoritative renamed page.",
          actions: [{
            kind: "patch",
            entityKey: "renamed-alpha",
            path: pagePath,
            expectedPageHash: inspected.pageHash,
            sections: [{
              operation: "replace",
              heading: "## Facts",
              expectedSectionOrdinal: facts.ordinal,
              expectedSectionHash: facts.hash,
              content: "Existing renamed alias facts.\n\nRenamed Alpha has a newly processed fact.",
            }],
          }],
          skips: [],
          entity_types_delta: [],
        }), { promptTokens: 1, completionTokens: 1 });
    } } },
  } as unknown as LlmClient;
  const domain = {
    id: "d",
    name: "Domain",
    wiki_folder: "d",
    source_paths: ["src"],
    entity_types: [
      {
        type: "concept",
        description: "Concept",
        extraction_cues: ["Alpha"],
        wiki_subfolder: "concept",
      },
      {
        type: "topic",
        description: "Topic",
        extraction_cues: ["Topic"],
        wiki_subfolder: "topic",
      },
    ],
    pageNameVersion: 1,
  };

  const outcome = await drain(runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [domain],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (outcome.ok) assert.deepEqual(outcome.updated, [pagePath]);
  assert.equal(adapter.files.has(duplicatePath), false);
  assert.match(adapter.files.get(pagePath)!, /newly processed fact/);
  assert.match(adapter.files.get(pagePath)!, /^type: concept$/m);
});

test("ingest returns a context failure for an unreadable exact target without rewriting the index", async () => {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/d/concept/wiki_d_alpha.md";
  const indexPath = "!Wiki/d/index.jsonl";
  const page = {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_d_alpha",
    path: pagePath,
    type: "concept",
    description: "Alpha existing description.",
    resource: ["source"],
    bodyHash: "body",
    descriptionHash: "description",
  };
  const original = JSON.stringify(page) + "\r\n";
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, "# Source\n\nAlpha is described here."],
    [pagePath, "# Alpha"],
    [indexPath, original],
  ]));
  const readError = new Error(`EACCES: ${pagePath}`);
  adapter.readErrors.set(pagePath, readError);
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      assert.match(prompt, /CHUNK_ID /);
      return mockChatResponse(params, mapperOutput(prompt), { promptTokens: 1, completionTokens: 1 });
    } } },
  } as unknown as LlmClient;
  const domain = {
    id: "d",
    name: "Domain",
    wiki_folder: "d",
    source_paths: ["src"],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["Alpha"], wiki_subfolder: "concept" }],
    pageNameVersion: 1,
  };

  const outcome = await drain(runIngest(
    [sourcePath], new VaultTools(adapter, "/vault"), llm, "m", [domain], "/vault",
    new AbortController().signal, { structuredRetries: 0 }, undefined,
  ));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.stage, "context");
    assert.match(outcome.message, /EACCES/);
  }
  assert.equal(adapter.files.get(indexPath), original);
});
