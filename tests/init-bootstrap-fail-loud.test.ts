import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { estimatePreparedMessages } from "../src/prompt-budget";
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
const { runInit, runInitWithSources } = await import("../src/phases/init");

function usageChunk() {
  return { id: "u", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}
function chunk(content: string) {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}
function mockResponse(params: unknown, content: string) {
  if ((params as { stream?: boolean }).stream === false) {
    return {
      id: "completion",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content, refusal: null },
        logprobs: null,
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }
  return (async function* () {
    yield chunk(content);
    yield usageChunk();
  })();
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
// Bootstrap always returns non-JSON so structured parse fails on every retry.
function brokenBootstrapLlm(): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => mockResponse(params, "not json at all") } },
  } as unknown as LlmClient;
}
// Bootstrap returns a valid domain with an empty entity_types list (allowed).
function emptyTypesBootstrapLlm(): LlmClient {
  const body = JSON.stringify({ reasoning: "", id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [], language_notes: "" });
  return {
    chat: { completions: { create: async (params: unknown) => mockResponse(params, body) } },
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

function forceAdapter(onRemove?: (path: string) => void) {
  const files = new Map<string, string>([
    ["src/a.md", "# Source\n\nAlpha source content."],
    ["!Wiki/demo/concept/existing.md", "# Existing\n\nMust survive failed preflight."],
  ]);
  return {
    files,
    removed: [] as string[],
    read: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) throw new Error(`ENOENT: ${p}`);
      return value;
    },
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => {
      const prefix = `${dir}/`;
      const directFiles: string[] = [];
      const folders = new Set<string>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) directFiles.push(path);
        else folders.add(`${dir}/${rest.slice(0, slash)}`);
      }
      return { files: directFiles, folders: [...folders] };
    },
    exists: async (p: string) => files.has(p) || [...files.keys()].some((path) => path.startsWith(`${p}/`)),
    mkdir: async () => {},
    remove: async (p: string) => {
      files.delete(p);
      onRemove?.(p);
    },
    rename: async () => {},
  };
}

function forceBootstrapLlm(
  bootstrapBody: string,
  onBootstrap?: () => void,
): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
            packets: [],
            noEvidence: [{ chunkId, reason: "No domain evidence." }],
          }));
      }
      onBootstrap?.();
      return mockResponse(params, bootstrapBody);
    } } },
  } as unknown as LlmClient;
}

const forceDomain = {
  id: "demo",
  name: "Demo",
  wiki_folder: "demo",
  source_paths: ["src"],
  entity_types: [{
    type: "concept",
    description: "Concept",
    extraction_cues: ["concept"],
    wiki_subfolder: "concept",
  }],
  analyzed_sources: { "src/a.md": "old" },
};

function validForceBootstrapBody(): string {
  return JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "ignored-by-force",
    entity_types: forceDomain.entity_types,
    language_notes: "",
  });
}

test("force init rejects fixed bootstrap overflow before wiping domain state", async () => {
  const rawAdapter = forceAdapter();
  let calls = 0;
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    {
      chat: { completions: { create: async () => {
        calls++;
        throw new Error("transport must not run");
      } } },
    } as unknown as LlmClient,
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { inputBudgetTokens: 32, maxTokens: 16, structuredRetries: 0 },
  )) {
    events.push(event);
  }

  assert.equal(calls, 0);
  assert.equal(rawAdapter.files.has("!Wiki/demo/concept/existing.md"), true);
  assert.deepEqual(rawAdapter.removed, []);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "WipeDomain"), false);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
});

test("force init rejects invalid bootstrap before wiping domain state", async () => {
  const rawAdapter = forceAdapter();
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm("not valid structured output"),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) {
    events.push(event);
  }

  assert.equal(rawAdapter.files.has("!Wiki/demo/concept/existing.md"), true);
  assert.deepEqual(rawAdapter.removed, []);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "WipeDomain"), false);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) => event.kind === "error" && /bootstrap failed/i.test(event.message)), true);
});

test("force bootstrap validation is read-only for seeded global legacy files", async () => {
  const rawAdapter = forceAdapter();
  const legacyIndex = "!Wiki/_index.md";
  const legacyLog = "!Wiki/_log.md";
  rawAdapter.files.set(legacyIndex, "LEGACY INDEX BYTES\n");
  rawAdapter.files.set(legacyLog, "LEGACY LOG BYTES\n");
  const before = new Map(rawAdapter.files);

  for await (const _event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm("invalid bootstrap"),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) {
    // drain
  }

  assert.deepEqual(rawAdapter.files, before);
  assert.deepEqual(rawAdapter.removed, []);
});

test("force init performs one validated bootstrap call before wipe", async () => {
  const controller = new AbortController();
  const order: string[] = [];
  const rawAdapter = forceAdapter((path) => {
    if (path === "!Wiki/demo/concept/existing.md") {
      order.push("wipe");
      controller.abort();
    }
  });
  let bootstrapCalls = 0;
  const valid = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "ignored-by-force",
    entity_types: forceDomain.entity_types,
    language_notes: "",
  });

  for await (const _ of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(valid, () => {
      bootstrapCalls++;
      order.push("bootstrap");
    }),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    controller.signal,
    { structuredRetries: 0 },
  )) { /* drain */ }

  assert.equal(bootstrapCalls, 1);
  assert.deepEqual(order, ["bootstrap", "wipe"]);
});

test("force init rechecks abort and every prepared source after WipeDomain tool event", async () => {
  const rawAdapter = forceAdapter();
  rawAdapter.files.set("src/b.md", "# Second source\n");
  const controller = new AbortController();
  const valid = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "ignored-by-force",
    entity_types: forceDomain.entity_types,
    language_notes: "",
  });
  const events: RunEvent[] = [];
  const generator = runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(valid),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    controller.signal,
    { structuredRetries: 0 },
  );
  while (true) {
    const next = await generator.next();
    if (next.done) break;
    events.push(next.value);
    if (next.value.kind === "tool_use" && next.value.name === "WipeDomain") {
      rawAdapter.files.set("src/b.md", "# Concurrent second-source edit\n");
      controller.abort();
    }
  }

  assert.equal(rawAdapter.files.has("!Wiki/demo/concept/existing.md"), true);
  assert.deepEqual(rawAdapter.removed, []);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
});

test("force init checks cancellation after each prepared source reread and before wipe", async () => {
  const rawAdapter = forceAdapter();
  rawAdapter.files.set("src/b.md", "# Second source\n");
  const controller = new AbortController();
  const originalRead = rawAdapter.read;
  let sourceBReads = 0;
  rawAdapter.read = async (path: string) => {
    const content = await originalRead(path);
    if (path === "src/b.md" && ++sourceBReads === 2) controller.abort();
    return content;
  };
  const events: RunEvent[] = [];
  const valid = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "ignored-by-force",
    entity_types: forceDomain.entity_types,
    language_notes: "",
  });

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(valid),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    controller.signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(rawAdapter.files.has("!Wiki/demo/concept/existing.md"), true);
  assert.deepEqual(rawAdapter.removed, []);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /cancelled/i.test(event.preview ?? "")), true);
});

test("force wipe rolls back exact bytes when a service-file removal fails", async () => {
  const rawAdapter = forceAdapter();
  const indexPath = "!Wiki/demo/index.jsonl";
  const logPath = "!Wiki/demo/log.jsonl";
  rawAdapter.files.set(indexPath, "INDEX BYTES\n");
  rawAdapter.files.set(logPath, "LOG BYTES\n");
  const before = new Map(rawAdapter.files);
  const originalRemove = rawAdapter.remove;
  rawAdapter.remove = async (path: string) => {
    if (path === logPath) throw new Error("EACCES: locked log");
    await originalRemove(path);
  };
  const events: RunEvent[] = [];
  const valid = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "ignored-by-force",
    entity_types: forceDomain.entity_types,
    language_notes: "",
  });

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(valid),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.deepEqual(rawAdapter.files, before);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /locked log/i.test(event.preview ?? "")), true);
});

test("force wipe restores prior trusted removals when a later removal is a no-op", async () => {
  const rawAdapter = forceAdapter();
  const indexPath = "!Wiki/demo/index.jsonl";
  rawAdapter.files.set(indexPath, "INDEX BYTES\n");
  const before = new Map(rawAdapter.files);
  const originalRemove = rawAdapter.remove;
  rawAdapter.remove = async (path: string) => {
    if (path === indexPath) return;
    await originalRemove(path);
  };
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(validForceBootstrapBody()),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.deepEqual(rawAdapter.files, before);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /verification/i.test(event.preview ?? "")), true);
});

test("force wipe restores prior trusted removals but never guesses a third-state rollback", async () => {
  const rawAdapter = forceAdapter();
  const indexPath = "!Wiki/demo/index.jsonl";
  rawAdapter.files.set(indexPath, "INDEX BEFORE\n");
  const originalRemove = rawAdapter.remove;
  rawAdapter.remove = async (path: string) => {
    if (path === indexPath) {
      rawAdapter.files.set(path, "INDEX THIRD STATE\n");
      throw new Error("synthetic partial index remove");
    }
    await originalRemove(path);
  };
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(validForceBootstrapBody()),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(
    rawAdapter.files.get("!Wiki/demo/concept/existing.md"),
    "# Existing\n\nMust survive failed preflight.",
  );
  assert.equal(rawAdapter.files.get(indexPath), "INDEX THIRD STATE\n");
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
});

test("force conditional remove preserves a file changed after its external guard", async () => {
  const rawAdapter = forceAdapter();
  const pagePath = "!Wiki/demo/concept/existing.md";
  const concurrent = "# Concurrent guarded page\n";
  const originalExists = rawAdapter.exists;
  let pageExistsCalls = 0;
  rawAdapter.exists = async (path: string) => {
    if (path === pagePath && ++pageExistsCalls === 2) {
      rawAdapter.files.set(pagePath, concurrent);
    }
    return originalExists(path);
  };
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(validForceBootstrapBody()),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(rawAdapter.files.get(pagePath), concurrent);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /transaction conflict/i.test(event.preview ?? "")), true);
});

test("force wipe rolls back planned removals when final inventory finds a concurrent file", async () => {
  let rawAdapter!: ReturnType<typeof forceAdapter>;
  const concurrentPath = "!Wiki/demo/concept/concurrent.md";
  let created = false;
  rawAdapter = forceAdapter((path) => {
    if (!created && path === "!Wiki/demo/concept/existing.md") {
      created = true;
      rawAdapter.files.set(concurrentPath, "# Concurrent file\n");
    }
  });
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(validForceBootstrapBody()),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(
    rawAdapter.files.get("!Wiki/demo/concept/existing.md"),
    "# Existing\n\nMust survive failed preflight.",
  );
  assert.equal(rawAdapter.files.get(concurrentPath), "# Concurrent file\n");
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /final inventory/i.test(event.preview ?? "")), true);
});

test("force cancellation after the first removal rolls back exact bytes before domain reset", async () => {
  const controller = new AbortController();
  let removals = 0;
  const rawAdapter = forceAdapter(() => {
    if (++removals === 1) controller.abort();
  });
  rawAdapter.files.set("!Wiki/demo/index.jsonl", "INDEX BYTES\n");
  const before = new Map(rawAdapter.files);
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm(validForceBootstrapBody()),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    controller.signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(removals, 1);
  assert.deepEqual(rawAdapter.files, before);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
  assert.equal(events.some((event) =>
    event.kind === "tool_result" && event.ok === false && /cancel/i.test(event.preview ?? "")), true);
});

test("force init reads every mandatory source before bootstrap or wipe", async () => {
  const rawAdapter = forceAdapter();
  rawAdapter.files.set("src/b.md", "# Unreadable source\n");
  const originalRead = rawAdapter.read;
  rawAdapter.read = async (path: string) => {
    if (path === "src/b.md") throw new Error("EACCES: src/b.md");
    return originalRead(path);
  };
  let bootstrapCalls = 0;
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(rawAdapter, "/vault"),
    forceBootstrapLlm("{}", () => { bootstrapCalls++; }),
    "m",
    [structuredClone(forceDomain)],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(bootstrapCalls, 0);
  assert.equal(rawAdapter.files.has("!Wiki/demo/concept/existing.md"), true);
  assert.deepEqual(rawAdapter.removed, []);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "WipeDomain"), false);
  assert.equal(events.some((event) => event.kind === "domain_updated"), false);
});

test("bootstrap mapper events are yielded while delayed evidence preparation is running", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "Delayed bootstrap evidence.");
  const gate = deferred();
  let mapperComplete = false;
  const validBootstrap = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [],
    language_notes: "",
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (!chunkId) {
        return mockResponse(params, validBootstrap);
      }
      await gate.promise;
      const response = mockResponse(params, JSON.stringify({
          packets: [],
          noEvidence: [{ chunkId, reason: "No domain evidence." }],
        }));
      mapperComplete = true;
      return response;
    } } },
  } as unknown as LlmClient;
  const generator = runInitWithSources(
    "demo",
    ["src"],
    false,
    new VaultTools(rawAdapter, "/vault"),
    llm,
    "m",
    [{
      id: "demo",
      name: "Demo",
      wiki_folder: "demo",
      source_paths: ["src"],
      entity_types: [],
      analyzed_sources: {},
    }],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    undefined,
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    gate.resolve();
  }, 40);
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (!next.done
      && next.value.kind === "tool_use"
      && next.value.name === "Evidence mapping"
      && (next.value.input as { callSite?: string }).callSite === "init.bootstrap-map") {
      clearTimeout(timer);
      assert.equal(timedOut, false, "bootstrap mapper event was buffered until helper completion");
      assert.equal(mapperComplete, false);
      gate.resolve();
      await generator.return(undefined);
      break;
    }
  }
});

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
  let mapperRequests = 0;
  let bootstrapRequests = 0;
  const body = JSON.stringify({ reasoning: "", id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [], language_notes: "" });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      prompts.push(params);
      const prompt = JSON.stringify(params);
      if (prompt.includes("CHUNK_ID ")) {
        mapperRequests++;
        const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
        assert.ok(chunkId);
        return mockResponse(params, JSON.stringify({
            packets: [],
            noEvidence: [{ chunkId, reason: "No bootstrap evidence." }],
          }));
      }
      bootstrapRequests++;
      assert.match(prompt, /bootstrapEvidence/);
      return mockResponse(params, body);
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

  assert.equal(mapperRequests > 0, true);
  assert.equal(bootstrapRequests, 1);
  for (const prompt of prompts) {
    const captured = JSON.stringify(prompt);
    assert.equal(captured.includes(sentinel), false);
    assert.equal(captured.includes("index.jsonl"), false);
  }
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

test("successful init bootstrap uses one direct non-stream request", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nAlpha source content.");
  const bootstrapRequests: Array<{ stream?: boolean }> = [];
  const bootstrapBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [],
    language_notes: "",
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const request = params as { stream?: boolean };
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
          packets: [],
          noEvidence: [{ chunkId, reason: "No bootstrap evidence." }],
        }));
      }
      bootstrapRequests.push(request);
      return mockResponse(params, bootstrapBody);
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo",
    ["src"],
    true,
    new VaultTools(rawAdapter, "/vault"),
    llm,
    "m",
    [],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    undefined,
    false,
    undefined,
  )) {
    events.push(event);
  }

  assert.equal(events.some((event) => event.kind === "result" && /Dry run/i.test(event.text)), true);
  assert.equal(bootstrapRequests.length, 1);
  assert.deepEqual(bootstrapRequests.map((request) => request.stream), [false]);
  assert.equal(bootstrapRequests.some((request) => request.stream === true), false);
});

test("oversized first source maps every bootstrap chunk and keeps every request in budget", async () => {
  const rawAdapter = adapter();
  const source = Array.from(
    { length: 1_000 },
    (_, index) => `line ${index + 1}: ${"bootstrap evidence ".repeat(5)}`,
  ).join("\n");
  rawAdapter.files.set("src/a.md", source);
  const requests: Array<{ messages: OpenAI.Chat.ChatCompletionMessageParam[] }> = [];
  const domainBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [],
    language_notes: "",
  });
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const request = params as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };
      requests.push(request);
      const text = JSON.stringify(request.messages);
      const chunkId = text.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      const body = chunkId
        ? JSON.stringify({ packets: [], noEvidence: [{ chunkId, reason: "No domain evidence." }] })
        : domainBody;
      return mockResponse(params, body);
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];
  const opts = {
    inputBudgetTokens: 16_000,
    maxTokens: 2_000,
    semanticCompression: { profile: "balanced" as const, operation: "ingest" as const },
    structuredRetries: 0,
  };

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, opts, undefined, false, undefined,
  )) {
    events.push(event);
  }

  const mapperPrompts = requests.flatMap((request) =>
    request.messages.flatMap((message) =>
      typeof message.content === "string" && message.content.includes("CHUNK_ID ")
        ? [message.content]
        : []));
  const sourceLines = source.split("\n");
  const coveredLines = new Set<number>();
  for (const prompt of mapperPrompts) {
    const range = prompt.match(/CHUNK_ID [^\s]+ START (\d+) END (\d+)/);
    assert.ok(range);
    const start = Number(range[1]);
    const end = Number(range[2]);
    const numbered = [...prompt.matchAll(/^CHUNK_LINE (\d+) \| (.*)$/gm)];
    assert.equal(numbered.length, end - start + 1);
    for (const match of numbered) {
      const localLine = Number(match[1]);
      const globalLine = start + localLine - 1;
      assert.equal(match[2], sourceLines[globalLine - 1]);
      coveredLines.add(globalLine);
    }
  }
  assert.deepEqual(
    [...coveredLines].sort((a, b) => a - b),
    sourceLines.map((_, index) => index + 1),
  );
  assert.equal(
    requests.filter((request) => !JSON.stringify(request.messages).includes("CHUNK_ID ")).length,
    1,
  );
  assert.equal(requests.every((request) => estimatePreparedMessages(request.messages) <= 16_000), true);
  assert.equal(events
    .filter((event) => event.kind === "prompt_budget")
    .every((event) => event.estimatedInputTokens <= event.effectiveInputBudget), true);
});

test("fixed bootstrap prompt overflow is a configuration error before domain creation", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "Alpha.");
  let calls = 0;
  const llm = {
    chat: { completions: { create: async () => {
      calls++;
      throw new Error("transport must not run");
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], false, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 32,
      maxTokens: 16,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  assert.equal(calls, 0);
  assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
  assert.equal(
    events.some((event) => event.kind === "error" && /configuration error/i.test(event.message)),
    true,
    JSON.stringify(events),
  );
});

test("bootstrap evidence packing reserves system and schema overhead from the same budget", async () => {
  const rawAdapter = adapter();
  const source = `Alpha ${"bounded bootstrap evidence ".repeat(32)}`;
  rawAdapter.files.set("src/a.md", source);
  let bootstrapRequests = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
            packets: [{
              id: `packet-${chunkId}`,
              chunkId,
              entityKey: "alpha",
              facts: [source],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: "src/a.md:1",
            }],
            noEvidence: [],
          }));
      }
      bootstrapRequests++;
      return mockResponse(params, JSON.stringify({
          reasoning: "",
          id: "demo",
          name: "Demo",
          wiki_folder: "demo",
          entity_types: [],
          language_notes: "",
        }));
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], false, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 9_000,
      maxTokens: 1_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  assert.equal(bootstrapRequests, 0);
  assert.equal(events.some((event) =>
    event.kind === "prompt_budget" && event.callSite === "init.bootstrap"), false);
  assert.equal(events.some((event) =>
    event.kind === "error" && /configuration error/i.test(event.message)), true);
  assert.equal(events.some((event) =>
    event.kind === "domain_created" || event.kind === "domain_updated"), false);
});
