import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { DomainEntry } from "../src/domain";
import type { LlmClient, RunEvent } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";
import type { ChunkIndexRecord, PageIndexRecord } from "../src/wiki-index-jsonl";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { cleanupInvalidPages } = await import("../src/phases/lint");
const { runDelete } = await import("../src/phases/delete");
const { VaultTools } = await import("../src/vault-tools");
const { parseWikiIndexJsonl } = await import("../src/wiki-index-jsonl");

const DOMAIN_ROOT = "!Wiki/d";
const PAGE_PATH = `${DOMAIN_ROOT}/concept/invalid.md`;
const INDEX_PATH = `${DOMAIN_ROOT}/index.jsonl`;
const SOURCE_PATH = "sources/source.md";

class MemoryAdapter implements VaultAdapter {
  writeError?: Error;
  readonly removeErrors = new Map<string, Error>();
  readonly timeline: string[] = [];

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    if (path === INDEX_PATH && this.writeError) throw this.writeError;
    this.files.set(path, data);
    this.timeline.push(`write:${path}`);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async mkdir(): Promise<void> {}

  async remove(path: string): Promise<void> {
    const removeError = this.removeErrors.get(path);
    if (removeError) throw removeError;
    this.files.delete(path);
    this.timeline.push(`remove:${path}`);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
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
  assert.equal(adapter.files.has(PAGE_PATH), false, "physical page deletion cannot be rolled back");
  assert.equal(adapter.files.has(SOURCE_PATH), true, "terminal failure stops source deletion");
  assert.equal(adapter.files.get(INDEX_PATH), original);
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
  const sourcePathEvent = events.find((event) => event.kind === "source_path_removed");
  const analyzedSourcesEvent = events.find((event) => event.kind === "domain_updated");
  assert.deepEqual(sourcePathEvent, { kind: "source_path_removed", domainId: "d", path: SOURCE_PATH });
  assert.deepEqual(analyzedSourcesEvent, {
    kind: "domain_updated",
    domainId: "d",
    patch: { analyzed_sources: { "sources/other.md": "other-hash" } },
  });
  const indexWrite = adapter.timeline.indexOf(`write:${INDEX_PATH}`);
  const sourcePathEventIndex = adapter.timeline.indexOf("event:source_path_removed");
  const analyzedSourcesEventIndex = adapter.timeline.indexOf("event:domain_updated");
  assert.ok(indexWrite >= 0);
  assert.ok(sourcePathEventIndex > indexWrite);
  assert.ok(analyzedSourcesEventIndex > sourcePathEventIndex);
  assert.equal(adapter.files.has(PAGE_PATH), false);
  assert.equal(adapter.files.has(SOURCE_PATH), false);
  const remaining = parseWikiIndexJsonl(adapter.files.get(INDEX_PATH)!, INDEX_PATH);
  assert.equal(remaining.some((record) => record.articleId === "invalid"), false);
  assert.deepEqual(remaining, [{ kind: "future", value: 1 }]);
});
