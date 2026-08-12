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
const { runInit, runInitWithSources, mergeBootstrapEntries, MAX_BOOTSTRAP_REQUESTS } =
  await import("../src/phases/init");

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
  const folders = new Set<string>(["", "src", "!Wiki", "!Wiki/demo", "!Wiki/demo/concept"]);
  const renames: Array<[string, string]> = [];
  const addFolder = (path: string) => {
    const segments = path.split("/").filter(Boolean);
    for (let index = 1; index <= segments.length; index++) {
      folders.add(segments.slice(0, index).join("/"));
    }
  };
  return {
    files,
    folders,
    renames,
    removed: [] as string[],
    read: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) throw new Error(`ENOENT: ${p}`);
      return value;
    },
    write: async (p: string, v: string) => {
      addFolder(p.split("/").slice(0, -1).join("/"));
      files.set(p, v);
    },
    readBinary: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) throw new Error(`ENOENT: ${p}`);
      return new TextEncoder().encode(value).buffer;
    },
    writeBinary: async (p: string, data: ArrayBuffer) => {
      addFolder(p.split("/").slice(0, -1).join("/"));
      files.set(p, new TextDecoder("utf-8", { fatal: true }).decode(data));
    },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => {
      const prefix = `${dir}/`;
      const directFiles: string[] = [];
      const directFolders = new Set<string>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) directFiles.push(path);
        else directFolders.add(`${dir}/${rest.slice(0, slash)}`);
      }
      for (const path of folders) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest && !rest.includes("/")) directFolders.add(path);
      }
      return { files: directFiles, folders: [...directFolders] };
    },
    exists: async (p: string) => files.has(p) || folders.has(p),
    stat: async (p: string) => {
      const value = files.get(p);
      if (value !== undefined) {
        return {
          type: "file" as const,
          ctime: 0,
          mtime: 0,
          size: new TextEncoder().encode(value).byteLength,
        };
      }
      return folders.has(p)
        ? { type: "folder" as const, ctime: 0, mtime: 0, size: 0 }
        : null;
    },
    mkdir: async (p: string) => { addFolder(p); },
    remove: async (p: string) => {
      files.delete(p);
      const original = renames.find(([, destination]) => destination === p)?.[0] ?? p;
      onRemove?.(original);
    },
    rmdir: async (p: string, recursive: boolean) => {
      assert.equal(recursive, false);
      if (
        [...files.keys()].some((path) => path.startsWith(`${p}/`))
        || [...folders].some((path) => path.startsWith(`${p}/`))
      ) {
        throw new Error(`ENOTEMPTY: ${p}`);
      }
      folders.delete(p);
    },
    rename: async (from: string, to: string) => {
      renames.push([from, to]);
      if ([...files.keys()].some((path) => path === to || path.startsWith(`${to}/`))) {
        throw new Error(`EEXIST: ${to}`);
      }
      const entries = [...files].filter(([path]) => path === from || path.startsWith(`${from}/`));
      if (entries.length === 0) throw new Error(`ENOENT: ${from}`);
      for (const [path, value] of entries) {
        files.delete(path);
        files.set(`${to}${path.slice(from.length)}`, value);
      }
      const movedFolders = [...folders].filter((path) => path === from || path.startsWith(`${from}/`));
      for (const path of movedFolders) {
        folders.delete(path);
        folders.add(`${to}${path.slice(from.length)}`);
      }
    },
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
    { structuredRetries: 1 },
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
    { structuredRetries: 1 },
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
    if (path.endsWith("/concept/existing.md")) {
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
    const original = rawAdapter.renames.find(([, destination]) => destination === path)?.[0] ?? path;
    if (original.endsWith("/log.jsonl")) throw new Error("EACCES: locked log");
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
    const original = rawAdapter.renames.find(([, destination]) => destination === path)?.[0] ?? path;
    if (original.endsWith("/index.jsonl")) return;
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
    event.kind === "tool_result" && event.ok === false && /did not remove/i.test(event.preview ?? "")), true);
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
  }, 2_000);
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (!next.done
      && next.value.kind === "llm_lifecycle"
      && next.value.action === "extract_source_facts"
      && next.value.phase === "preparing") {
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

test("a bootstrap rejected for context reports the rejection even though Init cannot repack", async () => {
  // Init plans its splits from the window up front and has no repack loop, so a
  // provider context rejection reaches the terminal catch. It must still be
  // reported: this is the one operation the configured-window setting exists for,
  // and agent.jsonl is where a user would look for the disagreement.
  const vt = new VaultTools(adapter(), "/vault");
  const seen: Array<{ promptTokens?: number; maxContextTokens?: number }> = [];
  const rejectingLlm = {
    chat: { completions: { create: async () => {
      throw new Error(
        "This model's maximum context length is 8192 tokens, however you requested 20000 tokens",
      );
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, rejectingLlm, "m",
    [], "Vault", new AbortController().signal,
    { structuredRetries: 0, onContextError: (details) => seen.push(details) },
    undefined, false, undefined,
  )) {
    events.push(ev);
  }

  assert.ok(seen.length >= 1, "the provider's context rejection must reach onContextError");
  assert.deepEqual(seen[0], { promptTokens: 20_000, maxContextTokens: 8_192 });
  assert.ok(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)));
});

test("a bootstrap failure that is not a context rejection reports nothing", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const seen: unknown[] = [];

  for await (const _ of runInitWithSources(
    "demo", ["src"], false, vt, brokenBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal,
    { structuredRetries: 0, onContextError: (details) => seen.push(details) },
    undefined, false, undefined,
  )) { /* drained */ }

  assert.deepEqual(seen, [], "a schema failure is not an overflow signal");
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

test("bootstrap repairs collapsed taxonomy from source evidence without hardcoded domain types", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nChromium flag, systemd service, Debian package, and fstab notes.");
  const collapsedBootstrapBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [{
      type: "configuration",
      description: "Model collapsed every source item into configuration.",
      extraction_cues: ["everything"],
      wiki_subfolder: "configurations",
    }],
    language_notes: "",
  });
  const repairedBootstrapBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [{
      type: "software",
      description: "Reusable software packages and applications.",
      extraction_cues: ["Chromium", "package"],
      wiki_subfolder: "software",
    }, {
      type: "service",
      description: "Managed services and daemons.",
      extraction_cues: ["systemd", "service"],
      wiki_subfolder: "services",
    }, {
      type: "configuration",
      description: "Configuration files and flags.",
      extraction_cues: ["flag", "fstab"],
      wiki_subfolder: "configuration",
    }],
    language_notes: "",
  });
  let bootstrapCalls = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const messages = (params as {
        messages?: Array<{ content?: unknown }>;
      }).messages ?? [];
      const messageText = messages
        .map((message) => typeof message.content === "string" ? message.content : "")
        .join("\n");
      if (messageText.includes("EVIDENCE_TYPE_UNITS ")) {
        const marker = "EVIDENCE_TYPE_UNITS ";
        const encoded = messageText.slice(messageText.lastIndexOf(marker) + marker.length).split("\n", 1)[0];
        const units = JSON.parse(encoded) as Array<{ entityKey: string }>;
        const types: Record<string, string> = {
          chromium: "software",
          systemd: "service",
          fstab: "configuration",
        };
        return mockResponse(params, JSON.stringify({
          assignments: units.map(({ entityKey }) => {
            const entityType = types[entityKey];
            assert.ok(entityType, `unexpected evidence type unit ${entityKey}`);
            return { entityKey, entityType };
          }),
        }));
      }
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
          packets: [
            {
              id: `${chunkId}:chromium`,
              chunkId,
              entityKey: "chromium",
              facts: ["Chromium is a browser package with flags."],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: "src/a.md:1",
            },
            {
              id: `${chunkId}:systemd`,
              chunkId,
              entityKey: "systemd",
              facts: ["systemd manages services."],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: "src/a.md:1",
            },
            {
              id: `${chunkId}:fstab`,
              chunkId,
              entityKey: "fstab",
              facts: ["fstab stores filesystem mount configuration."],
              exactSourceRanges: [{ startLine: 1, endLine: 1 }],
              links: [],
              sourceAnchor: "src/a.md:1",
            },
          ],
          noEvidence: [],
        }));
      }
      bootstrapCalls++;
      return mockResponse(
        params,
        prompt.includes("taxonomy too collapsed") ? repairedBootstrapBody : collapsedBootstrapBody,
      );
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
    { structuredRetries: 1 },
    undefined,
    false,
    undefined,
  )) {
    events.push(event);
  }

  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.equal(bootstrapCalls, 2);
  assert.match(result.text, /"type": "software"/);
  assert.match(result.text, /"type": "service"/);
  assert.match(result.text, /"type": "configuration"/);
  assert.doesNotMatch(result.text, /"wiki_subfolder": "configurations"/);
  assert.equal(events.some((event) =>
    event.kind === "llm_lifecycle" && event.action === "bootstrap_domain" && event.phase === "failed"), true);
});

test("force bootstrap reuses existing entity types and adds source-supported new types", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nExisting service notes plus new config notes.");
  const existing = {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    entity_types: [{
      type: "service",
      description: "Existing service definition.",
      extraction_cues: ["daemon"],
      wiki_subfolder: "services",
    }],
    analyzed_sources: {},
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  };
  const bootstrapBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [{
      type: "configuration",
      description: "Configuration files.",
      extraction_cues: ["config"],
      wiki_subfolder: "configuration",
    }],
    language_notes: "",
  });
  const prompts: string[] = [];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      prompts.push(prompt);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
          packets: [],
          noEvidence: [{ chunkId, reason: "No bootstrap evidence." }],
        }));
      }
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
    [existing],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
    undefined,
    true,
    undefined,
  )) {
    events.push(event);
  }

  assert.equal(prompts.some((prompt) => prompt.includes("Existing service definition.")), true);
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.match(result.text, /"type": "service"/);
  assert.match(result.text, /Existing service definition\./);
  assert.match(result.text, /"type": "configuration"/);
});

test("successful init bootstrap uses one direct non-stream request", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nAlpha source content.");
  const bootstrapRequests: Array<{ stream?: boolean; nativeFreshConnection?: boolean }> = [];
  const bootstrapBody = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [],
    language_notes: "",
  });
  const llm = {
    chat: { completions: { create: async (params: unknown, options?: { retry?: { nativeFreshConnection?: boolean } }) => {
      const request = params as { stream?: boolean };
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        return mockResponse(params, JSON.stringify({
          packets: [],
          noEvidence: [{ chunkId, reason: "No bootstrap evidence." }],
        }));
      }
      bootstrapRequests.push({ ...request, nativeFreshConnection: options?.retry?.nativeFreshConnection });
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
  assert.deepEqual(bootstrapRequests.map((request) => request.nativeFreshConnection), [true]);
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

interface CapturedBootstrapPayload {
  candidates: Array<{
    entityKey: string;
    facts: string[];
    exactSource: Array<{ text: string }>;
  }>;
  domainThemes: string[];
  languageEvidence: string[];
}

/** The bootstrap payload of a request, or undefined for a mapper request. */
function capturedBootstrapPayload(params: unknown): CapturedBootstrapPayload | undefined {
  const messages = (params as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  for (const message of messages) {
    if (typeof message.content !== "string") continue;
    if (!message.content.includes("\"bootstrapEvidence\"")) continue;
    return (JSON.parse(message.content) as { bootstrapEvidence: CapturedBootstrapPayload })
      .bootstrapEvidence;
  }
  return undefined;
}

function bootstrapDomainBody(entityType: string, languageNotes: string, id = "demo"): string {
  return JSON.stringify({
    reasoning: "",
    id,
    name: "Demo",
    wiki_folder: "demo",
    entity_types: [{
      type: entityType,
      description: `Derived ${entityType}.`,
      extraction_cues: [entityType],
      wiki_subfolder: entityType,
    }],
    language_notes: languageNotes,
  });
}

/**
 * Mapper that answers every source chunk with `packetsPerChunk` distinct
 * candidates, each carrying one fact of `factChars` characters. The fact text is
 * recorded so a test can prove every mapped fact reaches some bootstrap group.
 */
function splittingBootstrapLlm(options: {
  packetsPerChunk: number;
  factChars: number;
  assignedType: string;
  bootstrapBody: (call: number) => string;
}): {
  llm: LlmClient;
  mappedFacts: Map<string, string>;
  bootstrapPayloads: CapturedBootstrapPayload[];
  bootstrapRequests: Array<{ messages: OpenAI.Chat.ChatCompletionMessageParam[] }>;
} {
  const mappedFacts = new Map<string, string>();
  const bootstrapPayloads: CapturedBootstrapPayload[] = [];
  const bootstrapRequests: Array<{ messages: OpenAI.Chat.ChatCompletionMessageParam[] }> = [];
  let entityOrdinal = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const payload = capturedBootstrapPayload(params);
      if (payload) {
        bootstrapPayloads.push(payload);
        bootstrapRequests.push(params as { messages: OpenAI.Chat.ChatCompletionMessageParam[] });
        return mockResponse(params, options.bootstrapBody(bootstrapPayloads.length - 1));
      }
      const messageText = ((params as { messages?: Array<{ content?: unknown }> }).messages ?? [])
        .map((message) => typeof message.content === "string" ? message.content : "")
        .join("\n");
      if (messageText.includes("EVIDENCE_TYPE_UNITS ")) {
        const marker = "EVIDENCE_TYPE_UNITS ";
        const encoded = messageText.slice(messageText.lastIndexOf(marker) + marker.length).split("\n", 1)[0];
        const units = JSON.parse(encoded) as Array<{ entityKey: string }>;
        return mockResponse(params, JSON.stringify({
          assignments: units.map(({ entityKey }) => ({ entityKey, entityType: options.assignedType })),
        }));
      }
      const chunkId = JSON.stringify(params).match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      assert.ok(chunkId, "expected a mapper or bootstrap request");
      const packets = Array.from({ length: options.packetsPerChunk }, () => {
        const entityKey = `e${entityOrdinal++}`;
        const fact = `${entityKey} ${"bootstrap evidence fact ".repeat(Math.ceil(options.factChars / 24))}`;
        mappedFacts.set(entityKey, fact);
        return {
          id: `${chunkId}-${entityKey}`,
          chunkId,
          entityKey,
          facts: [fact],
          exactSourceRanges: [{ startLine: 1, endLine: 1 }],
          links: [],
          sourceAnchor: "src/a.md:1",
        };
      });
      return mockResponse(params, JSON.stringify({ packets, noEvidence: [] }));
    } } },
  } as unknown as LlmClient;
  return { llm, mappedFacts, bootstrapPayloads, bootstrapRequests };
}

function evidenceSourceLines(lines: number): string {
  return Array.from(
    { length: lines },
    (_, index) => `line ${index + 1}: ${"alpha beta gamma delta ".repeat(15)}`,
  ).join("\n");
}

test("mergeBootstrapEntries keeps group 0 identity and unions every entity type", () => {
  const entityType = (type: string) => ({
    type,
    description: `${type} description`,
    extraction_cues: [type],
    wiki_subfolder: type,
  });
  const merged = mergeBootstrapEntries([
    { id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [entityType("service")], language_notes: "" },
    { id: "other", name: "Other", wiki_folder: "other", entity_types: [entityType("concept")], language_notes: "mixed ru/en" },
    { id: "third", name: "Third", wiki_folder: "third", entity_types: [entityType("service")], language_notes: "ignored" },
  ]);

  assert.equal(merged.id, "demo");
  assert.equal(merged.name, "Demo");
  assert.equal(merged.wiki_folder, "demo");
  assert.deepEqual((merged.entity_types ?? []).map((type) => type.type), ["service", "concept"]);
  assert.equal(merged.language_notes, "mixed ru/en");
  assert.throws(() => mergeBootstrapEntries([]), /empty bootstrap group result/);
});

test("a bootstrap payload above twice the budget completes as merged groups", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(200));
  // 12_000 fact characters, doubled from 6_000: the character-class rules price
  // plain letters near half the old flat rate, so the payload needs twice the
  // text to stay above twice the per-request budget.
  const mock = splittingBootstrapLlm({
    packetsPerChunk: 3,
    factChars: 12_000,
    assignedType: "type-0",
    bootstrapBody: (call) => bootstrapDomainBody(`type-${call}`, call === 0 ? "" : `notes ${call}`),
  });
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), mock.llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 8_000,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  const split = events.find((event) => event.kind === "evidence_split");
  assert.ok(split && split.kind === "evidence_split", JSON.stringify(events.slice(-3)));
  assert.equal(split.callSite, "init.bootstrap");
  assert.ok(split.groups > 1, `expected more than one group, got ${split.groups}`);
  assert.equal(split.groups, mock.bootstrapPayloads.length);

  // The whole payload really is above twice the per-request budget.
  const union: CapturedBootstrapPayload = {
    candidates: mock.bootstrapPayloads.flatMap((payload) => payload.candidates),
    domainThemes: mock.bootstrapPayloads[0].domainThemes,
    languageEvidence: mock.bootstrapPayloads[0].languageEvidence,
  };
  const unionTokens = estimatePreparedMessages([{ role: "user", content: JSON.stringify(union) }]);
  assert.ok(
    unionTokens > 2 * split.payloadBudget,
    `payload ${unionTokens} is not above twice the budget ${split.payloadBudget}`,
  );

  // Complete source coverage: every mapped fact reaches exactly one group, whole.
  const deliveredFacts = union.candidates.flatMap((candidate) => candidate.facts);
  assert.deepEqual(
    [...deliveredFacts].sort(),
    [...mock.mappedFacts.values()].sort(),
  );
  assert.equal(union.candidates.length, split.candidates);
  assert.equal(new Set(union.candidates.map((candidate) => candidate.entityKey)).size, union.candidates.length);
  assert.equal(deliveredFacts.some((fact) => fact.includes("truncated")), false);
  for (const request of mock.bootstrapRequests) {
    assert.ok(estimatePreparedMessages(request.messages) <= 8_000);
  }

  // The merged entry keeps every group's entity types and the first notes.
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result", JSON.stringify(events.slice(-3)));
  for (let call = 0; call < split.groups; call++) {
    assert.match(result.text, new RegExp(`"type": "type-${call}"`));
  }
  assert.match(result.text, /"language_notes": "notes 1"/);
  assert.equal(events.some((event) => event.kind === "error"), false);
});

test("bootstrap group identity conflicts keep group 0 and report the conflict", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(200));
  const mock = splittingBootstrapLlm({
    packetsPerChunk: 3,
    factChars: 6_000,
    assignedType: "type-0",
    bootstrapBody: (call) =>
      bootstrapDomainBody(`type-${call}`, "", call === 0 ? "demo" : `other-${call}`),
  });
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), mock.llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 8_000,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  assert.ok(mock.bootstrapPayloads.length > 1);
  assert.equal(events.some((event) =>
    event.kind === "system" && event.message === "bootstrap group conflict on id; group 0 wins"), true);
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.match(result.text, /"id": "demo"/);
  assert.doesNotMatch(result.text, /"id": "other-/);
});

test("an evidence unit larger than the model context fails explicitly without truncating", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(20));
  // A long existing taxonomy inflates the fixed part of the Init prompt, so the
  // payload budget is far below the input budget the mapper and reducer use.
  // That is what leaves room for one evidence unit no split can divide.
  const existing = {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    entity_types: Array.from({ length: 150 }, (_, index) => ({
      type: `existing-type-${index}`,
      description: `Existing type ${index} ${"described at length ".repeat(8)}`,
      extraction_cues: [`cue-${index}`],
      wiki_subfolder: `folder-${index}`,
    })),
    analyzed_sources: {},
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  };
  // Doubled from 1_300 repeats: the character-class rules price plain letters
  // near half the old flat rate, so the unit needs twice the text to stay
  // larger than the model context.
  const atomicFact = `atomic ${"indivisible evidence unit ".repeat(2_600)}`;
  let bootstrapRequests = 0;
  const requests: string[] = [];
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const serialized = JSON.stringify(params);
      requests.push(serialized);
      const chunkId = serialized.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (!chunkId) {
        bootstrapRequests++;
        return mockResponse(params, bootstrapDomainBody("concept", ""));
      }
      return mockResponse(params, JSON.stringify({
        packets: [{
          id: `${chunkId}-atomic`,
          chunkId,
          entityKey: "atomic",
          facts: [atomicFact],
          exactSourceRanges: [{ startLine: 1, endLine: 1 }],
          links: [],
          sourceAnchor: "src/a.md:1",
        }],
        noEvidence: [],
      }));
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [existing], "Vault", new AbortController().signal, {
      inputBudgetTokens: 16_384,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, true, undefined,
  )) {
    events.push(event);
  }

  assert.equal(bootstrapRequests, 0);
  const failure = events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(events.slice(-3)));
  assert.match(failure.message, /one indivisible evidence unit needs \d+ payload token/);
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /configuration error/i);
  assert.doesNotMatch(failure.message, /domain was not created/i);
  // The unit reached the split whole and was never cut to fit.
  assert.equal(requests.some((request) => request.includes("truncated")), false);
  assert.equal(events.some((event) =>
    event.kind === "domain_created" || event.kind === "domain_updated"), false);
});

test("evidence needing more groups than the request ceiling fails instead of flooding the provider", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(20));
  // 25 candidates of ~12k tokens each, against a 13_832-token packing budget:
  // one candidate per group, above the ceiling the 16_384 budget allows.
  const mock = splittingBootstrapLlm({
    packetsPerChunk: 25,
    factChars: 50_000,
    assignedType: "concept",
    bootstrapBody: () => bootstrapDomainBody("concept", ""),
  });
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), mock.llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 16_384,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  const split = events.find((event) => event.kind === "evidence_split");
  assert.ok(split && split.kind === "evidence_split", JSON.stringify(events.slice(-3)));
  const failure = events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(events.slice(-3)));
  const ceiling = Number(/allows at most (\d+)/.exec(failure.message)?.[1]);
  assert.ok(Number.isInteger(ceiling) && ceiling > 0, failure.message);
  assert.ok(split.groups > ceiling, `expected more than the ceiling ${ceiling}, got ${split.groups}`);
  // The ceiling scales with the payload budget instead of being a fixed count.
  assert.ok(ceiling < MAX_BOOTSTRAP_REQUESTS, `${ceiling} should scale below the hard request ceiling`);
  // Exceeding it costs zero provider requests.
  assert.equal(mock.bootstrapPayloads.length, 0);
  assert.match(failure.message, /tokens of evidence/);
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.equal(events.some((event) =>
    event.kind === "domain_created" || event.kind === "domain_updated"), false);
});

/**
 * Drives a real budget overflow through evidence preparation. A calibration
 * below 1 (the model-context clamp reaches 0.5) makes the planning estimates
 * smaller than the uncalibrated check inside the request telemetry, so a request
 * that passed planning overflows at dispatch — inside the mapper and reducer
 * try/catch that rewrap `PromptBudgetExceededError` into their own error class.
 */
async function budgetOverflowInit(options: {
  sourceLines: number;
  packetsPerChunk: number;
  sameEntity: boolean;
  factRepeat: number;
  maxTokens: number;
}): Promise<{ events: RunEvent[]; mapperRequests: number; reducerRequests: number }> {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(options.sourceLines));
  let ordinal = 0;
  let mapperRequests = 0;
  let reducerRequests = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const serialized = JSON.stringify((params as { messages: unknown }).messages);
      if (serialized.includes("REDUCE_INPUT ")) {
        reducerRequests++;
        return mockResponse(params, "{}");
      }
      const chunkId = serialized.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (!chunkId) return mockResponse(params, bootstrapDomainBody("concept", ""));
      mapperRequests++;
      return mockResponse(params, JSON.stringify({
        packets: Array.from({ length: options.packetsPerChunk }, () => {
          const entityKey = options.sameEntity ? "shared" : `e${ordinal}`;
          const id = `${chunkId}-${ordinal++}`;
          return {
            id,
            chunkId,
            entityKey,
            facts: [`${id} ${"evidence fact text ".repeat(options.factRepeat)}`],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: "src/a.md:1",
          };
        }),
        noEvidence: [],
      }));
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];
  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 16_384,
      maxTokens: options.maxTokens,
      structuredRetries: 0,
      tokenCalibration: 0.5,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }
  return { events, mapperRequests, reducerRequests };
}

test("a wrapped mapper budget overflow reports the model context, not a bare wrapper message", async () => {
  const run = await budgetOverflowInit({
    sourceLines: 400,
    packetsPerChunk: 1,
    sameEntity: false,
    factRepeat: 400,
    maxTokens: 2_000,
  });

  // The very first mapper request overflows, so none is dispatched.
  assert.equal(run.mapperRequests, 0);
  const failure = run.events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(run.events.slice(-3)));
  assert.match(failure.message, /a bounded evidence request needs \d+ tokens against a \d+-token budget/);
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /bounded evidence preparation failed/);
  assert.doesNotMatch(failure.message, /Evidence mapper failed for chunk/);
});

test("a wrapped reducer budget overflow reports the model context, not a bare wrapper message", async () => {
  const run = await budgetOverflowInit({
    sourceLines: 20,
    packetsPerChunk: 8,
    sameEntity: true,
    // Doubled from 1_400 repeats for the character-class rules, which price
    // plain letters near half the old flat rate.
    factRepeat: 2_800,
    maxTokens: 400_000,
  });

  // Every mapper request fits and is dispatched; the reducer request is the one
  // that overflows, so the failure comes from the reducer catch.
  assert.ok(run.mapperRequests > 0);
  assert.equal(run.reducerRequests, 0);
  const failure = run.events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(run.events.slice(-3)));
  assert.match(failure.message, /a bounded evidence request needs \d+ tokens against a \d+-token budget/);
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /bounded evidence preparation failed/);
  assert.doesNotMatch(failure.message, /Evidence reducer failed at depth/);
});

test("a narrow window keeps the wiki conventions block when the evidence fits with it", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", "# Source\n\nAlpha source content for a narrow window.");
  // The input budget an 8_192-token context window resolves to.
  const mock = splittingBootstrapLlm({
    packetsPerChunk: 1,
    factChars: 200,
    assignedType: "concept",
    bootstrapBody: () => bootstrapDomainBody("concept", ""),
  });
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), mock.llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 3_686,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  assert.equal(mock.bootstrapRequests.length, 1);
  const prompt = JSON.stringify(mock.bootstrapRequests[0].messages);
  assert.match(prompt, /Wiki conventions/);
  assert.equal(events.some((event) =>
    event.kind === "system" && /wiki conventions omitted/.test(event.message)), false);
  assert.equal(events.some((event) => event.kind === "error"), false);
});

test("the wiki conventions block is dropped only when the evidence does not fit with it", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(20));
  // ~1_500 tokens per candidate: above the 1_134-token packing budget the
  // schema block leaves at this window, below the 2_439 it leaves without.
  const mock = splittingBootstrapLlm({
    packetsPerChunk: 1,
    factChars: 6_300,
    assignedType: "type-0",
    bootstrapBody: (call) => bootstrapDomainBody(`type-${call}`, ""),
  });
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), mock.llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 3_686,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  assert.ok(mock.bootstrapRequests.length >= 1, JSON.stringify(events.slice(-3)));
  assert.equal(events.some((event) =>
    event.kind === "system"
    && event.message === "init: wiki conventions omitted from the Init prompt to fit the model context"), true);
  for (const request of mock.bootstrapRequests) {
    assert.doesNotMatch(JSON.stringify(request.messages), /Wiki conventions/);
    assert.ok(estimatePreparedMessages(request.messages) <= 3_686);
  }
  assert.equal(events.some((event) => event.kind === "error"), false);
});

test("a taxonomy repair across K groups stays inside the input budget", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(200));
  const repaired = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: ["software", "service", "configuration"].map((type) => ({
      type,
      description: `Derived ${type}.`,
      extraction_cues: [type],
      wiki_subfolder: type,
    })),
    language_notes: "",
  });
  const requests: Array<{ messages: OpenAI.Chat.ChatCompletionMessageParam[] }> = [];
  let entityOrdinal = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const request = params as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };
      const serialized = JSON.stringify(request.messages);
      if (serialized.includes("EVIDENCE_TYPE_UNITS ")) {
        const marker = "EVIDENCE_TYPE_UNITS ";
        const text = request.messages
          .map((message) => typeof message.content === "string" ? message.content : "")
          .join("\n");
        const units = JSON.parse(
          text.slice(text.lastIndexOf(marker) + marker.length).split("\n", 1)[0],
        ) as Array<{ entityKey: string }>;
        return mockResponse(params, JSON.stringify({
          assignments: units.map(({ entityKey }) => ({ entityKey, entityType: "software" })),
        }));
      }
      const chunkId = serialized.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (chunkId) {
        const packets = Array.from({ length: 3 }, () => {
          const entityKey = `e${entityOrdinal++}`;
          return {
            id: `${chunkId}-${entityKey}`,
            chunkId,
            entityKey,
            // Doubled from 900 repeats for the character-class rules, which
            // price plain letters near half the old flat rate.
            facts: [`${entityKey} ${"collapsed taxonomy evidence ".repeat(1_800)}`],
            exactSourceRanges: [{ startLine: 1, endLine: 1 }],
            links: [],
            sourceAnchor: "src/a.md:1",
          };
        });
        return mockResponse(params, JSON.stringify({ packets, noEvidence: [] }));
      }
      requests.push(request);
      return mockResponse(
        params,
        serialized.includes("taxonomy too collapsed")
          ? repaired
          : bootstrapDomainBody("configuration", ""),
      );
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runInitWithSources(
    "demo", ["src"], true, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 16_384,
      maxTokens: 2_000,
      structuredRetries: 1,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  const split = events.find((event) => event.kind === "evidence_split");
  assert.ok(split && split.kind === "evidence_split");
  assert.ok(split.groups > 1, `expected more than one group, got ${split.groups}`);
  const repairRequests = requests.filter((request) =>
    JSON.stringify(request.messages).includes("taxonomy too collapsed"));
  assert.equal(repairRequests.length, split.groups, "every group is repaired");
  for (const request of requests) {
    assert.ok(
      estimatePreparedMessages(request.messages) <= 16_384,
      `request of ${estimatePreparedMessages(request.messages)} tokens exceeds the budget`,
    );
  }
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.match(result.text, /"type": "software"/);
  assert.match(result.text, /"type": "service"/);
  assert.equal(events.some((event) => event.kind === "error"), false);
});

test("fixed bootstrap prompt overflow reports an unsupported model context, not a configuration error", async () => {
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
  const failure = events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(events));
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /configuration error/i);
  assert.doesNotMatch(failure.message, /domain was not created/i);
});

test("a bootstrap prompt that cannot host one evidence unit reports an unsupported model context", async () => {
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

  // Rescaled from a byte-era budget of 9_000 for the token estimator
  // (task-3 prompt-budget-automation): at 2_143 the Init prompt plus the capped
  // per-group evidence overhead leaves no room for source evidence even after
  // the schema block is dropped, so the model context itself is too small.
  for await (const event of runInitWithSources(
    "demo", ["src"], false, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 2_143,
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
  const failure = events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(events));
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /configuration error/i);
  assert.doesNotMatch(failure.message, /domain was not created/i);
  assert.equal(events.some((event) =>
    event.kind === "domain_created" || event.kind === "domain_updated"), false);
});

test("an evidence type enrichment overflow reports an unsupported model context, not a bare wrapper message", async () => {
  const rawAdapter = adapter();
  rawAdapter.files.set("src/a.md", evidenceSourceLines(10));
  // The bootstrap RESPONSE carries the taxonomy, so a large one costs the bootstrap
  // request nothing and is paid for entirely by the enrichment request, which sends
  // every allowed type name alongside one {entityKey, facts} unit. That is the one
  // phase after a successful bootstrap that still runs on the configured budget with
  // no split of its own, so it is where a single oversized unit surfaces.
  const bigTaxonomy = JSON.stringify({
    reasoning: "",
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    entity_types: Array.from({ length: 3_000 }, (_, index) => ({
      type: `derived-entity-type-number-${index}-with-a-long-descriptive-suffix`,
      description: `Derived entity type ${index}.`,
      extraction_cues: [`cue-${index}`],
      wiki_subfolder: `folder-${index}`,
    })),
    language_notes: "",
  });
  let bootstrapRequests = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      const serialized = JSON.stringify(params);
      const chunkId = serialized.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      if (!chunkId) {
        bootstrapRequests++;
        return mockResponse(params, bigTaxonomy);
      }
      return mockResponse(params, JSON.stringify({
        packets: [{
          id: `${chunkId}-alpha`,
          chunkId,
          entityKey: "alpha",
          facts: ["alpha is a small piece of evidence"],
          exactSourceRanges: [{ startLine: 1, endLine: 1 }],
          links: [],
          sourceAnchor: "src/a.md:1",
        }],
        noEvidence: [],
      }));
    } } },
  } as unknown as LlmClient;

  const events: RunEvent[] = [];
  for await (const event of runInitWithSources(
    "demo", ["src"], false, new VaultTools(rawAdapter, "/vault"), llm, "m",
    [], "Vault", new AbortController().signal, {
      inputBudgetTokens: 16_384,
      maxTokens: 2_000,
      structuredRetries: 0,
    }, undefined, false, undefined,
  )) {
    events.push(event);
  }

  // The bootstrap itself succeeded; only the enrichment that follows overflowed.
  assert.ok(bootstrapRequests > 0);
  const failure = events.find((event) => event.kind === "error");
  assert.ok(failure && failure.kind === "error", JSON.stringify(events.slice(-3)));
  assert.match(failure.message, /a bounded evidence request needs \d+ tokens against a \d+-token budget/);
  assert.match(failure.message, /model m allows \d+ input token\(s\)/);
  assert.match(failure.message, /Choose a model with a larger context window\./);
  assert.doesNotMatch(failure.message, /evidence type enrichment failed/);
  assert.doesNotMatch(failure.message, /configuration error/i);
  assert.doesNotMatch(failure.message, /domain was not created/i);
  assert.equal(events.some((event) =>
    event.kind === "domain_created" || event.kind === "domain_updated"), false);
});
