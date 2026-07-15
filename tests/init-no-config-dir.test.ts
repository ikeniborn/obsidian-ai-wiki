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
// Bootstrap returns non-JSON so init fails fast right after ensureRootFiles ran.
function brokenBootstrapLlm(): LlmClient {
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk("not json"); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
function recordingAdapter(mkdirCalls: string[]) {
  const files = new Map<string, string>();
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => (dir === "src" ? { files: ["src/a.md"], folders: [] } : { files: [], folders: [] }),
    exists: async (p: string) => files.has(p) || p === "src",
    mkdir: async (p: string) => { mkdirCalls.push(p); },
    remove: async (p: string) => { files.delete(p); },
    rename: async () => {},
  };
}

test("init does not create the legacy !Wiki/_config directory", async () => {
  const mkdirCalls: string[] = [];
  const vt = new VaultTools(recordingAdapter(mkdirCalls), "/vault");
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, brokenBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }
  assert.equal(
    mkdirCalls.includes("!Wiki/_config"),
    false,
    `init created the legacy config dir; mkdir calls: ${mkdirCalls.join(", ")}`,
  );
});
