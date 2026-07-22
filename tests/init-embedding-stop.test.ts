import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { LlmClient, RunEvent } from "../src/types";
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
const { runInitWithSources } = await import("../src/phases/init");

function usageChunk() {
  return { id: "u", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}
function chunk(content: string) {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}
// The bounded mapper succeeds; configured retrieval then fails before synthesis.
function entitiesLlm(): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (!chunkId) throw new Error("unexpected synthesis call");
      const body = JSON.stringify({
        packets: [{
          id: `packet-${chunkId}`,
          chunkId,
          entityKey: "x",
          entityType: "Concept",
          facts: ["X"],
          exactSourceRanges: [{ startLine: 1, endLine: 1 }],
          links: [],
          sourceAnchor: "src:1",
        }],
        noEvidence: [],
      });
      return mockChatResponse(params, body, { promptTokens: 1, completionTokens: 1 });
    } } },
  } as unknown as LlmClient;
}
function adapter() {
  const files = new Map<string, string>([
    ["src/a.md", "X source A."],
    ["src/b.md", "X source B."],
  ]);
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => {
      if (dir === "src") return { files: ["src/a.md", "src/b.md"], folders: [] };
      if (dir.startsWith("!Wiki")) return { files: ["!Wiki/demo/entities/p.md"], folders: [] };
      return { files: [], folders: [] };
    },
    exists: async (p: string) => files.has(p) || p === "src" || p.startsWith("!Wiki"),
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    rename: async () => {},
  };
}

const stubSimilarity = {
  loadCache: async () => {},
  selectByEntities: async () => ({ results: new Map(), allFailed: true, failReason: "Embedding API error: 400 — model not found" }),
} as unknown as import("../src/page-similarity").PageSimilarityService;

test("embedding failure stops the whole init run once and does not mark files analyzed", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const domain = {
    id: "demo", name: "Demo", wiki_folder: "demo", source_paths: ["src"],
    entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
    analyzed_sources: {},
  };
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, entitiesLlm(), "m",
    [domain], "Vault", new AbortController().signal, {}, undefined, false, stubSimilarity,
  )) {
    events.push(ev);
  }

  assert.ok(
    events.some((e) => e.kind === "error" && /embedding endpoint failed/i.test(e.message)),
    JSON.stringify(events),
  );
  assert.equal(events.filter((e) => e.kind === "file_start").length, 1); // stopped before file b
  const analyzedPatch = events.some(
    (e) => e.kind === "domain_updated" && (e.patch as { analyzed_sources?: Record<string, string> }).analyzed_sources
      && Object.keys((e.patch as { analyzed_sources: Record<string, string> }).analyzed_sources).length > 0,
  );
  assert.equal(analyzedPatch, false);
});
