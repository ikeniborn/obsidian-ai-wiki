import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { DomainEntry } from "../src/domain";
import type { LlmClient, RunEvent } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { runInit, wipeDomainFolder } = await import("../src/phases/init");
const { VaultTools } = await import("../src/vault-tools");

type RmdirMode = "normal" | "throw-after-delete" | "false-success";

class DirectoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly binaryFiles = new Map<string, Uint8Array>();
  readonly binaryPaths = new Set<string>();
  readonly folders = new Set<string>([""]);
  readonly reads: string[] = [];
  readonly removes: string[] = [];
  readonly rmdirs: string[] = [];
  failRemovePath?: string;
  rmdirMode: RmdirMode = "normal";
  afterRmdir?: () => void;

  constructor(
    files: Record<string, string> = {},
    folders: string[] = [],
    binaryFiles: Record<string, Uint8Array> = {},
  ) {
    for (const folder of folders) this.addFolder(folder);
    for (const [path, bytes] of Object.entries(files)) {
      this.addFolder(path.split("/").slice(0, -1).join("/"));
      this.files.set(path, bytes);
    }
    for (const [path, bytes] of Object.entries(binaryFiles)) {
      this.addFolder(path.split("/").slice(0, -1).join("/"));
      this.binaryPaths.add(path);
      this.binaryFiles.set(path, bytes.slice());
    }
  }

  private addFolder(path: string): void {
    const segments = path.split("/").filter(Boolean);
    this.folders.add("");
    for (let index = 1; index <= segments.length; index++) {
      this.folders.add(segments.slice(0, index).join("/"));
    }
  }

  async read(path: string): Promise<string> {
    this.reads.push(path);
    const binary = this.binaryFiles.get(path);
    if (binary !== undefined) return new TextDecoder().decode(binary);
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error(`ENOENT: ${path}`);
    return bytes;
  }

  async write(path: string, data: string): Promise<void> {
    this.addFolder(path.split("/").slice(0, -1).join("/"));
    if (this.binaryPaths.has(path)) {
      this.binaryFiles.set(path, new TextEncoder().encode(data));
      return;
    }
    this.files.set(path, data);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const binary = this.binaryFiles.get(path);
    if (binary !== undefined) return binary.slice().buffer;
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return new TextEncoder().encode(text).buffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.addFolder(path.split("/").slice(0, -1).join("/"));
    const bytes = new Uint8Array(data.slice(0));
    if (this.binaryPaths.has(path)) {
      this.binaryFiles.set(path, bytes);
      return;
    }
    this.files.set(path, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async append(path: string, data: string): Promise<void> {
    await this.write(path, (this.files.get(path) ?? "") + data);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path ? `${path}/` : "";
    const files = [...new Set([...this.files.keys(), ...this.binaryFiles.keys()])]
      .filter((candidate) => candidate.startsWith(prefix)
        && !candidate.slice(prefix.length).includes("/"))
      .sort();
    const folders = [...this.folders]
      .filter((candidate) => candidate.startsWith(prefix)
        && candidate !== path
        && !candidate.slice(prefix.length).includes("/"))
      .sort();
    return { files, folders };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.binaryFiles.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.addFolder(path);
  }

  async remove(path: string): Promise<void> {
    this.removes.push(path);
    if (path === this.failRemovePath) throw new Error(`synthetic remove failure: ${path}`);
    this.files.delete(path);
    this.binaryFiles.delete(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    this.rmdirs.push(path);
    assert.equal(recursive, true);
    if (this.rmdirMode === "false-success") return;
    for (const file of [...this.files.keys()]) {
      if (file === path || file.startsWith(`${path}/`)) this.files.delete(file);
    }
    for (const file of [...this.binaryFiles.keys()]) {
      if (file === path || file.startsWith(`${path}/`)) this.binaryFiles.delete(file);
    }
    for (const folder of [...this.folders]) {
      if (folder === path || folder.startsWith(`${path}/`)) this.folders.delete(folder);
    }
    if (this.rmdirMode === "throw-after-delete") {
      throw new Error("synthetic recursive rmdir failure");
    }
    this.afterRmdir?.();
  }
}

function targetSnapshot(adapter: DirectoryAdapter, root = "!Wiki/demo") {
  return {
    files: [...adapter.files]
      .filter(([path]) => path.startsWith(`${root}/`))
      .sort(([left], [right]) => left.localeCompare(right)),
    folders: [...adapter.folders]
      .filter((path) => path === root || path.startsWith(`${root}/`))
      .sort(),
  };
}

function seededAdapter(): DirectoryAdapter {
  return new DirectoryAdapter({
    "src/a.md": "# Source\n\nAlpha.",
    "!Wiki/demo/metadata.jsonl": "META\0BYTES\n",
    "!Wiki/demo/index.jsonl": "INDEX\r\nBYTES",
    "!Wiki/demo/log.jsonl": "LOG\n",
    "!Wiki/demo/concept/old.md": "# Old\n",
    "!Wiki/demo/tmp/deep/zz-fail.txt": "FAIL AFTER BINARY\n",
    "!Wiki/other/metadata.jsonl": "OTHER META\n",
    "!Wiki/other/pages/keep.md": "# Keep\n",
  }, [
    "src",
    "!Wiki/demo/pages/empty/deeper",
    "!Wiki/demo/obsolete/empty",
    "!Wiki/other/empty",
  ], {
    "!Wiki/demo/tmp/deep/state.bin": new Uint8Array([0x00, 0xff, 0xc3, 0x28]),
  });
}

function otherSnapshot(adapter: DirectoryAdapter) {
  return {
    files: [...adapter.files]
      .filter(([path]) => path.startsWith("!Wiki/other/"))
      .sort(([left], [right]) => left.localeCompare(right)),
    folders: [...adapter.folders]
      .filter((path) => path === "!Wiki/other" || path.startsWith("!Wiki/other/"))
      .sort(),
  };
}

test("force wipe removes the complete target tree and returns every removed file", async () => {
  const adapter = seededAdapter();
  const unrelatedBefore = otherSnapshot(adapter);

  const removed = await wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo");

  assert.deepEqual(removed, [
    "!Wiki/demo/concept/old.md",
    "!Wiki/demo/index.jsonl",
    "!Wiki/demo/log.jsonl",
    "!Wiki/demo/metadata.jsonl",
    "!Wiki/demo/tmp/deep/state.bin",
    "!Wiki/demo/tmp/deep/zz-fail.txt",
  ]);
  assert.equal(await adapter.exists("!Wiki/demo"), false);
  assert.deepEqual(targetSnapshot(adapter), { files: [], folders: [] });
  assert.deepEqual(otherSnapshot(adapter), unrelatedBefore);
  assert.deepEqual(adapter.rmdirs, ["!Wiki/demo"]);
});

for (const failure of ["remove", "rmdir", "false-success"] as const) {
  test(`force wipe restores exact files and empty folders after ${failure} failure`, async () => {
    const adapter = seededAdapter();
    const targetBefore = targetSnapshot(adapter);
    const unrelatedBefore = otherSnapshot(adapter);
    if (failure === "remove") adapter.failRemovePath = "!Wiki/demo/log.jsonl";
    if (failure === "rmdir") adapter.rmdirMode = "throw-after-delete";
    if (failure === "false-success") adapter.rmdirMode = "false-success";

    await assert.rejects(
      wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
      failure === "remove"
        ? /synthetic remove failure/
        : failure === "rmdir"
          ? /synthetic recursive rmdir failure/
          : /still exists|did not remove/i,
    );

    assert.deepEqual(targetSnapshot(adapter), targetBefore);
    assert.deepEqual(otherSnapshot(adapter), unrelatedBefore);
  });
}

test("force wipe surfaces rollback failure instead of hiding an untrusted restore", async () => {
  const adapter = seededAdapter();
  adapter.rmdirMode = "throw-after-delete";
  const originalWriteBinary = adapter.writeBinary.bind(adapter);
  adapter.writeBinary = async (path, data) => {
    if (path === "!Wiki/demo/metadata.jsonl") throw new Error("synthetic rollback write failure");
    await originalWriteBinary(path, data);
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /rollback|synthetic rollback write failure/i,
  );
});

test("force wipe rollback restores arbitrary binary and text files byte exactly", async () => {
  const adapter = seededAdapter();
  const binaryPath = "!Wiki/demo/tmp/deep/state.bin";
  const textPath = "!Wiki/demo/metadata.jsonl";
  const binaryBefore = new Uint8Array(await adapter.readBinary(binaryPath));
  const textBefore = new Uint8Array(await adapter.readBinary(textPath));
  adapter.failRemovePath = "!Wiki/demo/tmp/deep/zz-fail.txt";

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /synthetic remove failure/,
  );

  assert.deepEqual(new Uint8Array(await adapter.readBinary(binaryPath)), binaryBefore);
  assert.deepEqual(new Uint8Array(await adapter.readBinary(textPath)), textBefore);
});

test("force wipe rejects a traversal entry in adapter inventory before removal", async () => {
  const adapter = seededAdapter();
  const originalList = adapter.list.bind(adapter);
  adapter.list = async (path) => {
    const listed = await originalList(path);
    return path === "!Wiki/demo"
      ? { ...listed, folders: [...listed.folders, "!Wiki/demo/../other"] }
      : listed;
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /untrusted domain inventory path/i,
  );

  assert.deepEqual(adapter.removes, []);
  assert.deepEqual(adapter.rmdirs, []);
});

test("force wipe rolls back when cancellation arrives during recursive rmdir", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  const controller = new AbortController();
  adapter.afterRmdir = () => controller.abort();

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo", controller.signal),
    /cancelled/i,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
});

for (const unsafe of [
  "",
  ".",
  "..",
  "../demo",
  "demo/child",
  "demo\\child",
  "!Wiki",
  "!Wiki/demo",
  "/foreign/demo",
  "foreign/root",
]) {
  test(`force wipe rejects unsafe wiki folder ${JSON.stringify(unsafe)} before vault access`, async () => {
    const adapter = seededAdapter();

    await assert.rejects(
      wipeDomainFolder(new VaultTools(adapter, "/vault"), unsafe),
      /unsafe|invalid/i,
    );

    assert.deepEqual(adapter.reads, []);
    assert.deepEqual(adapter.removes, []);
    assert.deepEqual(adapter.rmdirs, []);
  });
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
    yield {
      id: "c",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
    yield {
      id: "u",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  })();
}

function bootstrapLlm(): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      const prompt = JSON.stringify(params);
      const chunkId = prompt.match(/CHUNK_ID ([^\s\\"]+)/)?.[1];
      const content = chunkId
        ? JSON.stringify({ packets: [], noEvidence: [{ chunkId, reason: "No evidence." }] })
        : JSON.stringify({
          reasoning: "",
          id: "demo",
          name: "Demo",
          wiki_folder: "ignored-by-force",
          entity_types: [{
            type: "concept",
            description: "Concept",
            extraction_cues: ["concept"],
            wiki_subfolder: "concept",
          }],
          language_notes: "",
        });
      return mockResponse(params, content);
    } } },
  } as unknown as LlmClient;
}

function domain(wikiFolder = "demo"): DomainEntry {
  return {
    id: "demo",
    name: "Demo",
    wiki_folder: wikiFolder,
    source_paths: ["src"],
    entity_types: [{
      type: "concept",
      description: "Concept",
      extraction_cues: ["concept"],
      wiki_subfolder: "concept",
    }],
    analyzed_sources: { "src/a.md": "old" },
  };
}

test("force init rejects unsafe persisted wiki folder before source or domain reads", async () => {
  const adapter = seededAdapter();
  let llmCalls = 0;
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async () => {
      llmCalls++;
      throw new Error("must not call LLM");
    } } },
  } as unknown as LlmClient;

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [domain("../other")],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(llmCalls, 0);
  assert.deepEqual(adapter.reads, []);
  assert.deepEqual(adapter.removes, []);
  assert.deepEqual(adapter.rmdirs, []);
  assert.equal(events.some((event) => event.kind === "error" && /unsafe|invalid/i.test(event.message)), true);
});

test("force init emits one wipe, proves absence, then creates a fresh domain before source ingest", async () => {
  const adapter = seededAdapter();
  const controller = new AbortController();
  const events: RunEvent[] = [];
  let absentAtDomainCreate = false;
  let freshStorageAtSource = false;

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(adapter, "/vault"),
    bootstrapLlm(),
    "m",
    [domain()],
    "Vault",
    controller.signal,
    { structuredRetries: 0 },
  )) {
    events.push(event);
    if (event.kind === "domain_created") {
      absentAtDomainCreate = !await adapter.exists("!Wiki/demo");
      await adapter.write("!Wiki/demo/metadata.jsonl", "FRESH META\n");
    }
    if (event.kind === "file_start") {
      freshStorageAtSource = adapter.files.get("!Wiki/demo/metadata.jsonl") === "FRESH META\n"
        && adapter.files.get("!Wiki/demo/index.jsonl") === ""
        && !adapter.files.has("!Wiki/demo/concept/old.md")
        && !adapter.files.has("!Wiki/demo/log.jsonl")
        && !adapter.files.has("!Wiki/demo/tmp/deep/state.bin");
      controller.abort();
    }
  }

  const wipeIndexes = events.flatMap((event, index) =>
    event.kind === "tool_use" && event.name === "WipeDomain" ? [index] : []);
  const wipeEvent = events[wipeIndexes[0]];
  const createdIndex = events.findIndex((event) => event.kind === "domain_created");
  const firstSourceIndex = events.findIndex((event) => event.kind === "file_start");
  assert.equal(wipeIndexes.length, 1);
  assert.deepEqual(
    wipeEvent && wipeEvent.kind === "tool_use" ? wipeEvent.input : undefined,
    { folder: "!Wiki/demo" },
  );
  assert.equal(absentAtDomainCreate, true);
  assert.equal(freshStorageAtSource, true);
  assert.ok(createdIndex > wipeIndexes[0]);
  assert.ok(firstSourceIndex > createdIndex);
  assert.equal(events.slice(wipeIndexes[0], createdIndex).some((event) => event.kind === "domain_updated"), false);
});

test("force init reports terminal wipe failure and starts zero source ingestion", async () => {
  const adapter = seededAdapter();
  adapter.failRemovePath = "!Wiki/demo/log.jsonl";
  const events: RunEvent[] = [];

  for await (const event of runInit(
    ["demo", "--force"],
    new VaultTools(adapter, "/vault"),
    bootstrapLlm(),
    "m",
    [domain()],
    "Vault",
    new AbortController().signal,
    { structuredRetries: 0 },
  )) events.push(event);

  assert.equal(events.filter((event) => event.kind === "tool_use" && event.name === "WipeDomain").length, 1);
  assert.equal(events.some((event) => event.kind === "error" && /wipe failed/i.test(event.message)), true);
  assert.equal(events.some((event) => event.kind === "file_start"), false);
  assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
});
