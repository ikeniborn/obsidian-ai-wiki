import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { LlmClient } from "../src/types";
import type { PageSimilarityService } from "../src/page-similarity";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { VaultTools } = await import("../src/vault-tools");
const { runIngest } = await import("../src/phases/ingest");
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

async function drain(generator: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of generator) { /* drain */ }
}

test("first ingest retrieval reconciles on-disk pages into a chunk-only index", async () => {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/d/concept/wiki_d_alpha.md";
  const indexPath = "!Wiki/d/index.jsonl";
  const pageContent = [
    "---",
    "type: concept",
    "description: Alpha existing description.",
    "resource: [source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    "Existing alpha facts.",
  ].join("\n");
  const chunkOnly = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_d_alpha",
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
    [sourcePath, "# Source\n\nAlpha is described here."],
    [pagePath, pageContent],
    [indexPath, JSON.stringify(chunkOnly) + "\n"],
  ]));
  const prompts: unknown[] = [];
  const outputs = [
    JSON.stringify({ reasoning: "", entities: [{ name: "Alpha", type: "concept", context_snippet: "Alpha" }] }),
    "<<<REPORT>>>\nNo changes.\n<<<END>>>",
  ];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      prompts.push(params);
      const output = outputs.shift();
      if (output === undefined) throw new Error("unexpected LLM call");
      return (async function* () { yield contentChunk(output); yield usageChunk(); })();
    } } },
  } as unknown as LlmClient;
  const seenDescriptions: Map<string, string>[] = [];
  const similarity = {
    config: { mode: "jaccard", topK: 5 },
    loadCache: async () => {},
    selectByEntities: async (_entities: unknown, descriptions: Map<string, string>) => {
      seenDescriptions.push(new Map(descriptions));
      const matches = descriptions.has("wiki_d_alpha") ? [pagePath] : [];
      return { results: new Map([["Alpha::concept", matches]]), allFailed: false };
    },
  } as unknown as PageSimilarityService;
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

  for await (const _ of runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [domain],
    "/vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    similarity,
  )) { /* drain */ }

  assert.equal(seenDescriptions[0]?.get("wiki_d_alpha"), "Alpha existing description.");
  assert.equal(JSON.stringify(prompts[1]).includes("Existing alpha facts."), true);
  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "wiki_d_alpha"), true);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "wiki_d_alpha"), true);
});

test("ingest reconciliation propagates page read errors without rewriting the index", async () => {
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
    chat: { completions: { create: async () => { throw new Error("LLM must not be called"); } } },
  } as unknown as LlmClient;
  const domain = {
    id: "d",
    name: "Domain",
    wiki_folder: "d",
    source_paths: ["src"],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["Alpha"], wiki_subfolder: "concept" }],
    pageNameVersion: 1,
  };

  await assert.rejects(
    drain(runIngest(
      [sourcePath], new VaultTools(adapter, "/vault"), llm, "m", [domain], "/vault",
      new AbortController().signal, { structuredRetries: 0 }, undefined,
    )),
    (error) => error === readError,
  );
  assert.equal(adapter.files.get(indexPath), original);
});
