import assert from "node:assert/strict";
import test from "node:test";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import {
  readPageDescriptions,
  readWikiIndexRecords,
  reconcilePageIndex,
  removeArticleIndex,
  removePageIndex,
  transformWikiIndexRecords,
  upsertPageIndex,
} from "../src/wiki-index-store";
import { parseWikiIndexJsonl, type PageIndexRecord, type WikiIndexRecord } from "../src/wiki-index-jsonl";

const INDEX_PATH = "!Wiki/d/index.jsonl";

class MemoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly readErrors = new Map<string, Error>();

  async read(path: string): Promise<string> {
    const readError = this.readErrors.get(path);
    if (readError) throw readError;
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    await Promise.resolve();
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [], folders: [] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(): Promise<void> {}
}

function page(id: string, description = id): PageIndexRecord {
  return {
    kind: "page",
    schemaVersion: 1,
    articleId: id,
    path: `!Wiki/d/concept/${id}.md`,
    type: "concept",
    description,
    resource: ["source"],
    bodyHash: `body-${id}`,
    descriptionHash: `desc-${id}`,
  };
}

const chunk: WikiIndexRecord = {
  kind: "chunk",
  schemaVersion: 1,
  articleId: "a",
  path: "!Wiki/d/concept/a.md",
  heading: "## Facts",
  ordinal: 0,
  bodyHash: "body-a",
  embedTextHash: "embed-a",
  vector: [0.1, 0.2],
  vectorModel: "m",
  dimensions: 2,
  updatedAt: "2026-07-16T00:00:00.000Z",
};

function setup(initial?: WikiIndexRecord[]): { adapter: MemoryAdapter; vaultTools: VaultTools } {
  const adapter = new MemoryAdapter();
  if (initial) adapter.files.set(INDEX_PATH, initial.map((record) => JSON.stringify(record)).join("\r\n") + "\r\n");
  return { adapter, vaultTools: new VaultTools(adapter, "") };
}

test("missing structured index reads as empty records and descriptions", async () => {
  const { vaultTools } = setup();
  assert.deepEqual(await readWikiIndexRecords(vaultTools, "!Wiki/d"), []);
  assert.deepEqual(await readPageDescriptions(vaultTools, "!Wiki/d"), new Map());
});

test("malformed structured index reports its path and line", async () => {
  const { adapter, vaultTools } = setup();
  adapter.files.set(INDEX_PATH, `${JSON.stringify(page("a"))}\r\n{bad}\r\n`);
  await assert.rejects(
    readWikiIndexRecords(vaultTools, "!Wiki/d"),
    (error: Error) => error.message.includes(`${INDEX_PATH}:2:`),
  );
});

test("structured index read errors propagate instead of becoming missing files", async () => {
  const { adapter, vaultTools } = setup([page("a")]);
  const original = adapter.files.get(INDEX_PATH)!;
  const readError = new Error(`EACCES: ${INDEX_PATH}`);
  adapter.readErrors.set(INDEX_PATH, readError);

  await assert.rejects(readWikiIndexRecords(vaultTools, "!Wiki/d"), (error) => error === readError);
  assert.equal(adapter.files.get(INDEX_PATH), original);
});

test("page transform rejects malformed JSONL without changing exact bytes", async () => {
  const { adapter, vaultTools } = setup();
  const original = `${JSON.stringify(page("a"))}\r\n{bad}\r\n`;
  adapter.files.set(INDEX_PATH, original);

  await assert.rejects(
    upsertPageIndex(vaultTools, "!Wiki/d", page("b")),
    (error: Error) => error.name === "JsonlParseError" && error.message.includes(`${INDEX_PATH}:2:`),
  );
  assert.equal(adapter.files.get(INDEX_PATH), original);
});

test("queued transform failure leaves exact index bytes unchanged", async () => {
  const { adapter, vaultTools } = setup([page("a"), chunk]);
  const original = adapter.files.get(INDEX_PATH)!;
  const transformError = new Error("transform failed");

  await assert.rejects(
    transformWikiIndexRecords(vaultTools, "!Wiki/d", () => { throw transformError; }),
    (error) => error === transformError,
  );
  assert.equal(adapter.files.get(INDEX_PATH), original);
});

test("page transforms preserve chunks and unknown future records", async () => {
  const unknown = { kind: "future", value: 1 };
  const { adapter, vaultTools } = setup([chunk, unknown]);

  await upsertPageIndex(vaultTools, "!Wiki/d", page("a", "new"));
  assert.equal((await readPageDescriptions(vaultTools, "!Wiki/d")).get("a"), "new");
  assert.deepEqual(parseWikiIndexJsonl(adapter.files.get(INDEX_PATH)!, INDEX_PATH).slice(0, 2), [chunk, unknown]);

  await removePageIndex(vaultTools, "!Wiki/d", "a");
  assert.deepEqual(await readWikiIndexRecords(vaultTools, "!Wiki/d"), [chunk, unknown]);

  await upsertPageIndex(vaultTools, "!Wiki/d", page("a"));
  await removeArticleIndex(vaultTools, "!Wiki/d", "a");
  assert.deepEqual(await readWikiIndexRecords(vaultTools, "!Wiki/d"), [unknown]);
});

test("page reconciliation builds sorted records and preserves chunks and unknown records", async () => {
  const unknown = { kind: "future", value: 1 };
  const { vaultTools } = setup([page("old"), chunk, unknown]);
  const markdown = (description: string) => [
    "---",
    `description: ${description}`,
    "resource: [source]",
    "timestamp: 2026-07-16",
    "tags: [storage/jsonl]",
    "---",
    "# Page",
  ].join("\n");

  await reconcilePageIndex(vaultTools, "!Wiki/d", [
    { path: "!Wiki/d/concept/z.md", content: markdown("Zed") },
    { path: "!Wiki/d/concept/a.md", content: markdown("Alpha") },
  ]);

  const records = await readWikiIndexRecords(vaultTools, "!Wiki/d");
  assert.deepEqual(records.slice(0, 2), [chunk, unknown]);
  assert.deepEqual(records.slice(2).map((record) => record.articleId), ["a", "z"]);
});

test("concurrent page upserts serialize read-transform-write operations", async () => {
  const { vaultTools } = setup([chunk]);
  await Promise.all([
    upsertPageIndex(vaultTools, "!Wiki/d", page("a")),
    upsertPageIndex(vaultTools, "!Wiki/d", page("b")),
  ]);
  assert.deepEqual([...await readPageDescriptions(vaultTools, "!Wiki/d")].map(([id]) => id).sort(), ["a", "b"]);
  assert.equal((await readWikiIndexRecords(vaultTools, "!Wiki/d")).some((record) => record.kind === "chunk"), true);
});
