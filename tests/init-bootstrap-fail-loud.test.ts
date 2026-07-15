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
