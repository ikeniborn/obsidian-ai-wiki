import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { LlmClient, RunEvent } from "../src/types";

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
// Bootstrap always returns non-JSON so structured parse fails on every retry.
function brokenBootstrapLlm(): LlmClient {
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk("not json at all"); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
// Bootstrap returns a valid domain with an empty entity_types list (allowed).
function emptyTypesBootstrapLlm(): LlmClient {
  const body = JSON.stringify({ reasoning: "", id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [], language_notes: "" });
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk(body); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
function adapter() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => (dir === "src" ? { files: ["src/a.md"], folders: [] } : { files: [], folders: [] }),
    exists: async (p: string) => files.has(p) || p === "src",
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    rename: async () => {},
  };
}

test("init bootstrap prompt never includes a large raw structured index", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nAlpha source content.");
  const vector = Array.from({ length: 2000 }, (_, index) => index + 0.125);
  const sentinel = String(vector.at(-1));
  rawAdapter.files.set("!Wiki/demo/index.jsonl", JSON.stringify({
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: "!Wiki/demo/concept/wiki_demo_alpha.md",
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector,
    vectorModel: "m",
    dimensions: vector.length,
    updatedAt: "2026-07-17T00:00:00.000Z",
  }) + "\n");
  const prompts: unknown[] = [];
  const body = JSON.stringify({ reasoning: "", id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [], language_notes: "" });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      prompts.push(params);
      return (async function* () { yield chunk(body); yield usageChunk(); })();
    } } },
  } as unknown as LlmClient;
  const existing = {
    id: "demo", name: "Demo", wiki_folder: "demo", source_paths: ["src"],
    entity_types: [], analyzed_sources: {}, analyzed_sources_v2: true, analyzed_sources_v3: true,
  };

  for await (const _ of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [existing], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) { /* drain */ }

  assert.equal(prompts.length, 1);
  const captured = JSON.stringify(prompts[0]);
  assert.equal(captured.includes(sentinel), false);
  assert.equal(captured.includes("index.jsonl"), false);
});

test("bootstrap failure stops init with a loud error and creates no domain", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, brokenBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }

  assert.ok(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)));
  assert.equal(events.some((e) => e.kind === "domain_created" || e.kind === "domain_updated"), false);
});

test("init runs bootstrap for a registered domain with empty entity_types (analyzed_sources defined)", async () => {
  // A domain added via the wizard and reloaded has analyzed_sources:{} (defined)
  // but no entity_types yet. Bootstrap MUST still run to derive the types — the
  // resume decision keys on entity_types, not on analyzed_sources being present.
  const vt = new VaultTools(adapter(), "/vault");
  const existing = {
    id: "demo", name: "Demo", wiki_folder: "demo", source_paths: ["src"],
    entity_types: [], analyzed_sources: {}, analyzed_sources_v2: true, analyzed_sources_v3: true,
  };
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, brokenBootstrapLlm(), "m",
    [existing], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }
  // Bootstrap ran and failed loud (proves it was NOT skipped as "resuming").
  assert.ok(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)));
});

test("successful bootstrap with empty entity_types does not stop init", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const events: RunEvent[] = [];
  // dryRun=true → after a successful bootstrap the run yields the dry-run entry and
  // returns before ingest, so an empty-but-valid types list must NOT fail loud.
  for await (const ev of runInitWithSources(
    "demo", ["src"], true, vt, emptyTypesBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }

  assert.equal(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)), false);
  assert.ok(events.some((e) => e.kind === "result" && /Dry run/i.test(e.text)));
});
