import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

const {
  FORCE_WIPE_FILE_BYTE_LIMIT,
  FORCE_WIPE_PEAK_BYTE_LIMIT,
  FORCE_WIPE_SNAPSHOT_BYTE_LIMIT,
  runInit,
  wipeDomainFolder,
  wipeDomainFolderWithManifest,
  wipeManifestEvents,
} = await import("../src/phases/init");
const { VaultTools } = await import("../src/vault-tools");

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("wipe manifest producer chunks thousands of paths into bounded log events", async () => {
  const removedPaths = Array.from(
    { length: 5_000 },
    (_, index) => `nested/path-${index.toString().padStart(5, "0")}.md`,
  );
  const removedFileHashes = Object.fromEntries(
    removedPaths.map((path) => [path, sha256(path)]),
  );
  const events = await wipeManifestEvents("domain", {
    transactionId: "transaction",
    removedPaths,
    removedFileHashes,
    manifestHash: `sha256:${"0".repeat(64)}`,
  }, 123) as RunEvent[];
  const chunks = events.filter((event) => event.kind === "wipe_manifest_chunk");
  const complete = events.at(-1);

  assert.equal(chunks.length, 50);
  assert.ok(chunks.every((event) =>
    event.entries.length <= 100
    && event.hashAlgorithm === "sha256-v2"
    && /^sha256:[0-9a-f]{64}$/.test(event.chunkHash)
    && Buffer.byteLength(JSON.stringify(event), "utf8") <= 256 * 1024
    && Buffer.byteLength(JSON.stringify({
      ts: "2026-07-20T00:00:00.000Z",
      session: "session-id",
      op: "init",
      domainId: "domain",
      backend: "openai-compatible",
      model: "provider/model",
      event,
    }), "utf8") <= 1_048_576));
  assert.ok(complete?.kind === "wipe_complete");
  assert.equal(complete.totalCount, 5_000);
  assert.equal(complete.hashAlgorithm, "sha256-v2");
  assert.notEqual(complete.manifestHash, `sha256:${"0".repeat(64)}`);
  assert.equal(Object.hasOwn(complete, "removedPaths"), false);
});

test("wipe manifest chunking adapts to near-boundary Unicode paths with logger envelope reserve", async () => {
  const removedPaths = Array.from(
    { length: 240 },
    (_, index) => `深い/${"界".repeat(4_000)}-${index}.md`,
  );
  const removedFileHashes = Object.fromEntries(
    removedPaths.map((path) => [path, sha256(path)]),
  );
  const events = await wipeManifestEvents("domain", {
    transactionId: "unicode-transaction",
    removedPaths,
    removedFileHashes,
    manifestHash: `sha256:${"0".repeat(64)}`,
  }, 123) as RunEvent[];
  const chunks = events.filter((event) => event.kind === "wipe_manifest_chunk");

  assert.ok(
    chunks.length >= 3 && chunks[0].entries.length < 100,
    "byte-aware chunking must split before the 100-path cap",
  );
  for (const event of events) {
    const line = JSON.stringify({
      ts: "2026-07-20T00:00:00.000Z",
      session: "session-id",
      op: "init",
      domainId: "domain",
      backend: "openai-compatible",
      model: "provider/model",
      event,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(event), "utf8") <= 256 * 1024);
    assert.ok(Buffer.byteLength(line, "utf8") <= 1_048_576);
  }
});

test("wipe identifiers reject pathological values before vault I/O", async () => {
  const huge = "d".repeat(1_100_000);
  for (const [wikiFolder, telemetryDomainId] of [
    [huge, "domain"],
    ["demo", huge],
  ]) {
    const adapter = seededAdapter();
    await assert.rejects(
      wipeDomainFolderWithManifest(
        new VaultTools(adapter, "/vault"),
        wikiFolder,
        undefined,
        { telemetryDomainId },
      ),
      /identifier.*255 UTF-8 bytes/i,
    );
    assert.equal(adapter.renames.length, 0);
    assert.equal(adapter.stats.length, 0);
  }
});

test("maximal valid domain and empty manifest complete event stay prevalidated and bounded", async () => {
  const domainId = "d".repeat(255);
  const adapter = new DirectoryAdapter();
  const manifest = await wipeDomainFolderWithManifest(
    new VaultTools(adapter, "/vault"),
    "demo",
    undefined,
    { telemetryDomainId: domainId },
  );
  const plan = manifest as typeof manifest & { telemetryComplete?: RunEvent };
  assert.ok(plan.telemetryComplete?.kind === "wipe_complete");
  assert.equal(plan.telemetryComplete.hashAlgorithm, "sha256-v2");
  assert.ok(Buffer.byteLength(JSON.stringify(plan.telemetryComplete), "utf8") <= 256 * 1024);
  const events = await wipeManifestEvents(domainId, manifest, 123);
  assert.equal(events.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(events[0]), "utf8") <= 256 * 1024);
});

test("wipe proof rejects lone surrogates and preserves valid surrogate pairs exactly", async () => {
  const module = await import("../src/wipe-proof");
  const validate = (module as unknown as {
    assertWellFormedWipeString?: (value: string, label: string) => void;
  }).assertWellFormedWipeString;
  assert.equal(typeof validate, "function");
  for (const invalid of ["\uD800", "\uD801", "\uDC00"]) {
    assert.throws(() => validate!(invalid, "manifest path"), /ill-formed UTF-16/i);
    await assert.rejects(
      wipeManifestEvents("domain", {
        transactionId: "transaction",
        removedPaths: [`bad-${invalid}.md`],
        removedFileHashes: {},
        manifestHash: `sha256:${"0".repeat(64)}`,
      }),
      /manifest path.*ill-formed UTF-16/i,
    );
  }
  assert.doesNotThrow(() => validate!("\uD83D\uDE00", "manifest path"));
  const validEvents = await wipeManifestEvents("domain", {
    transactionId: "transaction",
    removedPaths: ["valid-\uD83D\uDE00.md"],
    removedFileHashes: {},
    manifestHash: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(
    validEvents[0]?.kind === "wipe_manifest_chunk"
      ? validEvents[0].entries[0]?.path
      : undefined,
    "valid-\uD83D\uDE00.md",
  );
});

test("wipe SHA-256 proof distinguishes a known FNV-1a collision", async () => {
  const module = await import("../src/wipe-proof");
  const wipeProofHash = (module as unknown as {
    wipeProofHash?: (bytes: Uint8Array) => Promise<string>;
  }).wipeProofHash;
  assert.equal(typeof wipeProofHash, "function");
  const left = await wipeProofHash!(new TextEncoder().encode("costarring"));
  const right = await wipeProofHash!(new TextEncoder().encode("liquid"));
  assert.notEqual(left, right);
  assert.match(left, /^sha256:[0-9a-f]{64}$/);
});

type RmdirMode = "normal" | "throw-after-delete" | "throw-after-root-delete" | "false-success";
type RenameMode = "normal" | "copy-source";
type AdapterStat = { type: "file" | "folder"; ctime: number; mtime: number; size: number };

class DirectoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly binaryFiles = new Map<string, Uint8Array>();
  readonly binaryPaths = new Set<string>();
  readonly folders = new Set<string>([""]);
  readonly reads: string[] = [];
  readonly removes: string[] = [];
  readonly rmdirs: string[] = [];
  readonly rmdirRecursive: boolean[] = [];
  readonly renames: Array<[string, string]> = [];
  readonly mkdirs: string[] = [];
  readonly binaryReads: string[] = [];
  readonly stats: string[] = [];
  failRemovePath?: string;
  failRename?: (from: string, to: string) => Error | undefined;
  statOverride?: (path: string, stat: AdapterStat | null) => AdapterStat | null;
  renameMode: RenameMode = "normal";
  rmdirMode: RmdirMode = "normal";
  afterReadBinary?: (path: string) => void;
  afterRemove?: (path: string) => void;
  beforeRmdir?: (path: string) => void;
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
    this.binaryReads.push(path);
    const binary = this.binaryFiles.get(path);
    if (binary !== undefined) {
      const result = binary.slice().buffer;
      this.afterReadBinary?.(path);
      return result;
    }
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    const result = new TextEncoder().encode(text).buffer;
    this.afterReadBinary?.(path);
    return result;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.addFolder(path.split("/").slice(0, -1).join("/"));
    const bytes = new Uint8Array(data.slice(0));
    if (this.binaryPaths.has(path)) {
      this.binaryFiles.set(path, bytes);
      return;
    }
    try {
      this.files.set(path, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      this.binaryPaths.add(path);
      this.binaryFiles.set(path, bytes);
    }
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

  async stat(path: string): Promise<AdapterStat | null> {
    this.stats.push(path);
    let result: AdapterStat | null = null;
    const binary = this.binaryFiles.get(path);
    const text = this.files.get(path);
    if (binary !== undefined) {
      result = { type: "file", ctime: 0, mtime: 0, size: binary.byteLength };
    } else if (text !== undefined) {
      result = {
        type: "file",
        ctime: 0,
        mtime: 0,
        size: new TextEncoder().encode(text).byteLength,
      };
    } else if (this.folders.has(path)) {
      result = { type: "folder", ctime: 0, mtime: 0, size: 0 };
    }
    return this.statOverride ? this.statOverride(path, result) : result;
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirs.push(path);
    this.addFolder(path);
  }

  async remove(path: string): Promise<void> {
    this.removes.push(path);
    if (path === this.failRemovePath) throw new Error(`synthetic remove failure: ${path}`);
    this.files.delete(path);
    this.binaryFiles.delete(path);
    this.afterRemove?.(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    this.rmdirs.push(path);
    this.rmdirRecursive.push(recursive);
    this.beforeRmdir?.(path);
    if (this.rmdirMode === "false-success") return;
    if (!recursive) {
      const hasChild = [...this.files.keys(), ...this.binaryFiles.keys(), ...this.folders]
        .some((candidate) => candidate.startsWith(`${path}/`));
      if (hasChild) throw new Error(`ENOTEMPTY: ${path}`);
      this.folders.delete(path);
      if (
        this.rmdirMode === "throw-after-delete"
        || (this.rmdirMode === "throw-after-root-delete" && path.endsWith("/domain"))
      ) {
        throw new Error("synthetic non-recursive rmdir failure");
      }
      this.afterRmdir?.();
      return;
    }
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

  async rename(from: string, to: string): Promise<void> {
    this.renames.push([from, to]);
    const failure = this.failRename?.(from, to);
    if (failure) throw failure;
    if (await this.exists(to)) throw new Error(`EEXIST: ${to}`);
    if (!await this.exists(from)) throw new Error(`ENOENT: ${from}`);
    const move = (path: string): string => path === from
      ? to
      : path.startsWith(`${from}/`)
        ? `${to}${path.slice(from.length)}`
        : path;
    for (const [path, value] of [...this.files]) {
      const moved = move(path);
      if (moved === path) continue;
      if (this.renameMode !== "copy-source") this.files.delete(path);
      this.files.set(moved, value);
    }
    for (const [path, value] of [...this.binaryFiles]) {
      const moved = move(path);
      if (moved === path) continue;
      if (this.renameMode !== "copy-source") this.binaryFiles.delete(path);
      this.binaryFiles.set(moved, value);
    }
    for (const path of [...this.binaryPaths]) {
      const moved = move(path);
      if (moved === path) continue;
      if (this.renameMode !== "copy-source") this.binaryPaths.delete(path);
      this.binaryPaths.add(moved);
    }
    for (const path of [...this.folders]) {
      const moved = move(path);
      if (moved === path) continue;
      if (this.renameMode !== "copy-source") this.folders.delete(path);
      this.folders.add(moved);
    }
    if (this.failRemovePath) this.failRemovePath = move(this.failRemovePath);
  }
}

function targetSnapshot(adapter: DirectoryAdapter, root = "!Wiki/demo") {
  return {
    files: [...adapter.files]
      .filter(([path]) => path.startsWith(`${root}/`))
      .sort(([left], [right]) => left.localeCompare(right)),
    binaryFiles: [...adapter.binaryFiles]
      .filter(([path]) => path.startsWith(`${root}/`))
      .map(([path, bytes]) => [path, [...bytes]] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    folders: [...adapter.folders]
      .filter((path) => path === root || path.startsWith(`${root}/`))
      .sort(),
  };
}

function relativeTreeSnapshot(adapter: DirectoryAdapter, root = "!Wiki/demo") {
  const snapshot = targetSnapshot(adapter, root);
  return {
    files: snapshot.files.map(([path, value]) => [path.slice(root.length), value]),
    binaryFiles: snapshot.binaryFiles.map(([path, value]) => [path.slice(root.length), value]),
    folders: snapshot.folders.map((path) => path.slice(root.length)),
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

test("force wipe defines a 128 MiB snapshot plus one 32 MiB comparison buffer peak", () => {
  assert.equal(FORCE_WIPE_SNAPSHOT_BYTE_LIMIT, 128 * 1024 * 1024);
  assert.equal(FORCE_WIPE_FILE_BYTE_LIMIT, 32 * 1024 * 1024);
  assert.equal(
    FORCE_WIPE_PEAK_BYTE_LIMIT,
    FORCE_WIPE_SNAPSHOT_BYTE_LIMIT + FORCE_WIPE_FILE_BYTE_LIMIT,
  );
});

test("unencodable telemetry is rejected and rolled back before any file deletion", async () => {
  const longPath = `!Wiki/demo/${"界".repeat(360_000)}.md`;
  const adapter = new DirectoryAdapter({ [longPath]: "content" });

  await assert.rejects(
    wipeDomainFolderWithManifest(
      new VaultTools(adapter, "/vault"),
      "demo",
      undefined,
      { telemetryDomainId: "demo" },
    ),
    /wipe manifest entry exceeds telemetry payload limit/i,
  );
  assert.equal(await adapter.exists(longPath), true);
  assert.equal(adapter.removes.length, 0);
});

test("wipe snapshot hashing is sequential and manifest proof never joins all entries", () => {
  const source = readFileSync(new URL("../src/phases/init.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Promise\.all\(\[\.\.\.snapshot\.files\]/);
  assert.doesNotMatch(source, /canonicalWipeEntries|JSON\.stringify\(entries\)/);
  assert.match(source, /advanceWipeManifestRoot/);
});

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
  assert.deepEqual(targetSnapshot(adapter), { files: [], binaryFiles: [], folders: [] });
  assert.deepEqual(otherSnapshot(adapter), unrelatedBefore);
  assert.equal(adapter.renames[0]?.[0], "!Wiki/demo");
  assert.match(adapter.renames[0]?.[1] ?? "", /^!Wiki\/\.ai-wiki-reinit-txn-[^/]+\/domain$/);
  const transaction = (adapter.renames[0]?.[1] ?? "").slice(0, -"/domain".length);
  assert.equal(adapter.renames.length, 1);
  assert.equal(
    adapter.removes.every((path) => path.startsWith(`${transaction}/domain/`)),
    true,
  );
  assert.equal(adapter.removes.some((path) => path.includes("/trash/")), false);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
  assert.equal(adapter.rmdirs.at(-1), transaction);
  assert.equal(await adapter.exists(transaction), false);
  assert.equal(await adapter.exists(`${transaction}/recovery`), false);
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
          ? /synthetic .*rmdir failure/
          : /still exists|did not remove/i,
    );

    assert.deepEqual(targetSnapshot(adapter), targetBefore);
    assert.deepEqual(otherSnapshot(adapter), unrelatedBefore);
    assert.deepEqual(adapter.renames.at(-1), [adapter.renames[0]?.[1], "!Wiki/demo"]);
  });
}

test("force wipe rebuilds and restores the tree when quarantined root rmdir throws after deletion", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  adapter.rmdirMode = "throw-after-root-delete";

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /synthetic non-recursive rmdir failure/,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
});

test("force wipe preflights stat sizes before any binary read or file destruction", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  adapter.statOverride = (path, stat) => path.endsWith("/metadata.jsonl") && stat
    ? { ...stat, size: 1024 }
    : stat;

  await assert.rejects(
    wipeDomainFolder(
      new VaultTools(adapter, "/vault"),
      "demo",
      undefined,
      { snapshotByteLimit: 100 },
    ),
    /snapshot.*limit|stat.*size/i,
  );

  assert.deepEqual(adapter.binaryReads, []);
  assert.deepEqual(adapter.removes, []);
  assert.equal(
    adapter.renames.some(([from]) => from.includes("/domain/")),
    false,
  );
  assert.deepEqual(targetSnapshot(adapter), before);
});

test("force wipe rejects a file above the per-file cap before any binary read or deletion", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  adapter.statOverride = (path, stat) => path.endsWith("/metadata.jsonl") && stat
    ? { ...stat, size: 17 }
    : stat;

  await assert.rejects(
    wipeDomainFolder(
      new VaultTools(adapter, "/vault"),
      "demo",
      undefined,
      { snapshotByteLimit: 100, fileByteLimit: 16 },
    ),
    /file.*limit|per-file.*limit/i,
  );

  assert.deepEqual(adapter.binaryReads, []);
  assert.deepEqual(adapter.removes, []);
  assert.deepEqual(targetSnapshot(adapter), before);
});

for (const invalidSize of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`force wipe rejects invalid file stat size ${String(invalidSize)} before binary reads`, async () => {
    const adapter = seededAdapter();
    adapter.statOverride = (path, stat) => {
      if (!path.endsWith("/metadata.jsonl")) return stat;
      if (invalidSize === null) return null;
      return stat ? { ...stat, size: invalidSize } : stat;
    };

    await assert.rejects(
      wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
      /stat|size/i,
    );

    assert.deepEqual(adapter.binaryReads, []);
    assert.deepEqual(adapter.removes, []);
  });
}

test("force wipe rejects a post-stat byte-size change before file destruction", async () => {
  const adapter = seededAdapter();
  adapter.statOverride = (path, stat) => path.endsWith("/metadata.jsonl") && stat
    ? { ...stat, size: stat.size - 1 }
    : stat;

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /changed|stat|size/i,
  );

  assert.deepEqual(adapter.removes, []);
  assert.equal(
    adapter.renames.some(([from]) => from.includes("/domain/")),
    false,
  );
});

test("force wipe rejects non-atomic rename behavior before destructive actions", async () => {
  const adapter = seededAdapter();
  adapter.renameMode = "copy-source";

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /rename|atomic|trust/i,
  );

  assert.equal(await adapter.exists("!Wiki/demo"), true);
  assert.deepEqual(adapter.removes, []);
});

test("force wipe skips a colliding transaction parent and preserves it", async () => {
  const adapter = seededAdapter();
  const originalExists = adapter.exists.bind(adapter);
  let collisionPath = "";
  adapter.exists = async (path) => {
    if (!collisionPath && /^!Wiki\/\.ai-wiki-reinit-txn-/.test(path)) {
      collisionPath = path;
      await adapter.mkdir(path);
      await adapter.write(`${path}/owner.txt`, "OTHER TRANSACTION");
      return true;
    }
    return originalExists(path);
  };

  await wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo");

  const chosenTransaction = (adapter.renames[0]?.[1] ?? "").slice(0, -"/domain".length);
  assert.notEqual(chosenTransaction, collisionPath);
  assert.equal(adapter.files.get(`${collisionPath}/owner.txt`), "OTHER TRANSACTION");
  assert.equal(await adapter.exists(chosenTransaction), false);
});

test("force wipe retries mkdir EEXIST and preserves the foreign empty transaction directory", async () => {
  const adapter = seededAdapter();
  const originalMkdir = adapter.mkdir.bind(adapter);
  let foreignPath = "";
  adapter.mkdir = async (path) => {
    if (!foreignPath && /^!Wiki\/\.ai-wiki-reinit-txn-/.test(path)) {
      foreignPath = path;
      await originalMkdir(path);
      throw new Error(`EEXIST: ${path}`);
    }
    await originalMkdir(path);
  };

  await wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo");

  assert.equal(await adapter.exists(foreignPath), true);
  assert.equal(adapter.rmdirs.includes(foreignPath), false);
  assert.notEqual((adapter.renames[0]?.[1] ?? "").slice(0, -"/domain".length), foreignPath);
});

test("force wipe serializes concurrent runs for the same original root and releases the lock", async () => {
  const firstAdapter = seededAdapter();
  const secondAdapter = seededAdapter();
  let releaseRead!: () => void;
  let enteredRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readEntered = new Promise<void>((resolve) => { enteredRead = resolve; });
  const originalReadBinary = firstAdapter.readBinary.bind(firstAdapter);
  let blocked = false;
  firstAdapter.readBinary = async (path) => {
    if (!blocked) {
      blocked = true;
      enteredRead();
      await readGate;
    }
    return originalReadBinary(path);
  };

  const first = wipeDomainFolder(new VaultTools(firstAdapter, "/vault"), "demo");
  await readEntered;
  let secondError: unknown;
  try {
    await wipeDomainFolder(new VaultTools(secondAdapter, "/vault"), "demo");
  } catch (error) {
    secondError = error;
  } finally {
    releaseRead();
  }
  await first;

  assert.match(String((secondError as Error | undefined)?.message ?? ""), /already.*progress|locked/i);
  await wipeDomainFolder(new VaultTools(secondAdapter, "/vault"), "demo");
});

test("force wipe rejects an adapter without rename before vault access", async () => {
  const adapter = seededAdapter();
  const withoutRename = adapter as VaultAdapter;
  withoutRename.rename = undefined;

  await assert.rejects(
    wipeDomainFolder(new VaultTools(withoutRename, "/vault"), "demo"),
    /rename/i,
  );

  assert.deepEqual(adapter.reads, []);
  assert.deepEqual(adapter.removes, []);
  assert.deepEqual(adapter.rmdirs, []);
});

test("force wipe preserves the original tree when quarantine rename fails", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  adapter.failRename = (from) => from === "!Wiki/demo"
    ? new Error("synthetic quarantine rename failure")
    : undefined;

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /synthetic quarantine rename failure/,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
  assert.deepEqual(adapter.removes, []);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
  assert.equal(
    [...adapter.folders].some((path) => /^!Wiki\/\.ai-wiki-reinit-txn-/.test(path)),
    false,
  );
});

test("force wipe rolls transaction back when post-rename verification fails", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);
  const originalRename = adapter.rename.bind(adapter);
  const originalExists = adapter.exists.bind(adapter);
  let renamed = false;
  let verificationFailed = false;
  adapter.rename = async (from, to) => {
    await originalRename(from, to);
    renamed = true;
  };
  adapter.exists = async (path) => {
    if (renamed && !verificationFailed && path === "!Wiki/demo") {
      verificationFailed = true;
      throw new Error("synthetic post-rename verification failure");
    }
    return originalExists(path);
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /synthetic post-rename verification failure/,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
  assert.equal(
    [...adapter.folders].some((path) => /^!Wiki\/\.ai-wiki-reinit-txn-/.test(path)),
    false,
  );
  assert.deepEqual(adapter.removes, []);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
});

test("force wipe preserves a new original-root file created during transaction deletion", async () => {
  const adapter = seededAdapter();
  const originalBefore = relativeTreeSnapshot(adapter);
  adapter.afterRemove = () => {
    adapter.afterRemove = undefined;
    void adapter.write("!Wiki/demo/concurrent.md", "NEW DURING REMOVE");
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /trust|original root|unexpectedly exists/i,
  );

  assert.equal(adapter.files.get("!Wiki/demo/concurrent.md"), "NEW DURING REMOVE");
  const quarantinedRoot = adapter.renames[0]?.[1] ?? "";
  assert.equal(await adapter.exists(quarantinedRoot), true);
  assert.deepEqual(relativeTreeSnapshot(adapter, quarantinedRoot), originalBefore);
});

test("force wipe never recursively deletes a new original root created before directory removal", async () => {
  const adapter = seededAdapter();
  const originalBefore = relativeTreeSnapshot(adapter);
  adapter.beforeRmdir = () => {
    adapter.beforeRmdir = undefined;
    void adapter.write("!Wiki/demo/concurrent.md", "NEW BEFORE RMDIR");
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /trust|original root|unexpectedly exists/i,
  );

  assert.equal(adapter.files.get("!Wiki/demo/concurrent.md"), "NEW BEFORE RMDIR");
  const quarantinedRoot = adapter.renames[0]?.[1] ?? "";
  assert.match(quarantinedRoot, /^!Wiki\/\.ai-wiki-reinit-txn-[^/]+\/domain$/);
  assert.notEqual(adapter.rmdirs[0], "!Wiki/demo");
  assert.deepEqual(relativeTreeSnapshot(adapter, quarantinedRoot), originalBefore);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
});

test("force wipe surfaces rollback rename failure and preserves the transaction", async () => {
  const adapter = seededAdapter();
  adapter.failRemovePath = "!Wiki/demo/log.jsonl";
  adapter.failRename = (_from, to) => to === "!Wiki/demo"
    ? new Error("synthetic rollback rename failure")
    : undefined;

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /rollback.*synthetic rollback rename failure/i,
  );

  const quarantinedRoot = adapter.renames[0]?.[1] ?? "";
  assert.equal(await adapter.exists("!Wiki/demo"), false);
  assert.equal(await adapter.exists(quarantinedRoot), true);
});

test("force wipe aborts during snapshot read and renames the untouched transaction back", async () => {
  const adapter = seededAdapter();
  adapter.binaryFiles.set(
    "!Wiki/demo/tmp/deep/state.bin",
    new Uint8Array(64 * 1024).fill(0xa5),
  );
  const before = targetSnapshot(adapter);
  const controller = new AbortController();
  adapter.afterReadBinary = () => {
    adapter.afterReadBinary = undefined;
    controller.abort();
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo", controller.signal),
    /cancelled/i,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
  assert.deepEqual(adapter.removes, []);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
  assert.equal(adapter.renames.length, 2);
});

test("force wipe rolls transaction back before deletion when snapshot byte limit is exceeded", async () => {
  const adapter = seededAdapter();
  const before = targetSnapshot(adapter);

  await assert.rejects(
    wipeDomainFolder(
      new VaultTools(adapter, "/vault"),
      "demo",
      undefined,
      { snapshotByteLimit: 4 },
    ),
    /snapshot.*limit/i,
  );

  assert.deepEqual(targetSnapshot(adapter), before);
  assert.deepEqual(adapter.removes, []);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
  assert.equal(adapter.renames.length, 2);
});

test("force wipe surfaces rollback failure instead of hiding an untrusted restore", async () => {
  const adapter = seededAdapter();
  adapter.rmdirMode = "throw-after-delete";
  const originalWriteBinary = adapter.writeBinary.bind(adapter);
  adapter.writeBinary = async (path, data) => {
    if (path.endsWith("/metadata.jsonl")) throw new Error("synthetic rollback write failure");
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
    return /^!Wiki\/\.ai-wiki-reinit-txn-[^/]+\/domain(?:\/|$)/.test(path)
      ? { ...listed, folders: [...listed.folders, `${path}/../other`] }
      : listed;
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    /untrusted domain inventory path/i,
  );

  assert.deepEqual(adapter.removes, []);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
});

test("force wipe rolls back when cancellation arrives during non-recursive rmdir", async () => {
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

test("force wipe preserves and reports an old-root recreation during final transaction rmdir", async () => {
  const adapter = seededAdapter();
  const originalBefore = relativeTreeSnapshot(adapter);
  let transaction = "";
  adapter.beforeRmdir = (path) => {
    if (!transaction) {
      transaction = (adapter.renames[0]?.[1] ?? "").slice(0, -"/domain".length);
    }
    if (path === transaction) {
      void adapter.write("!Wiki/demo/concurrent.md", "NEW DURING FINAL RMDIR");
    }
  };

  await assert.rejects(
    wipeDomainFolder(new VaultTools(adapter, "/vault"), "demo"),
    (error: Error) => {
      assert.match(error.message, /trust|original root|unexpectedly exists/i);
      assert.match(error.message, new RegExp(`${transaction}/recovery`));
      return true;
    },
  );

  assert.equal(adapter.files.get("!Wiki/demo/concurrent.md"), "NEW DURING FINAL RMDIR");
  assert.deepEqual(relativeTreeSnapshot(adapter, `${transaction}/recovery`), originalBefore);
  assert.equal(await adapter.exists(transaction), true);
  assert.equal(adapter.rmdirRecursive.every((recursive) => recursive === false), true);
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
  const wipeCompleteIndex = events.findIndex((event) => event.kind === "wipe_complete");
  const wipeComplete = events[wipeCompleteIndex];
  const createdIndex = events.findIndex((event) => event.kind === "domain_created");
  const firstSourceIndex = events.findIndex((event) => event.kind === "file_start");
  assert.equal(wipeIndexes.length, 1);
  assert.deepEqual(
    wipeEvent && wipeEvent.kind === "tool_use" ? wipeEvent.input : undefined,
    { folder: "!Wiki/demo" },
  );
  assert.equal(absentAtDomainCreate, true);
  assert.equal(freshStorageAtSource, true);
  assert.ok(wipeCompleteIndex > wipeIndexes[0]);
  assert.ok(wipeCompleteIndex < createdIndex);
  assert.equal(
    wipeComplete?.kind === "wipe_complete" ? wipeComplete.domainId : undefined,
    "demo",
  );
  assert.equal(
    events.some((event) =>
      event.kind === "wipe_manifest_chunk"
      && event.entries.some((entry) => entry.path === "concept/old.md")),
    true,
  );
  const wipeChunks = events.filter((event) => event.kind === "wipe_manifest_chunk");
  assert.ok(wipeChunks.every((event) =>
    event.entries.length <= 100
    && Buffer.byteLength(JSON.stringify(event), "utf8") <= 1_048_576));
  assert.equal(
    wipeComplete?.kind === "wipe_complete" ? wipeComplete.totalCount : undefined,
    wipeChunks.flatMap((event) => event.entries).length,
  );
  assert.equal(
    wipeComplete?.kind === "wipe_complete"
      ? Object.hasOwn(wipeComplete, "removedPaths")
      : false,
    false,
  );
  assert.match(
    wipeComplete?.kind === "wipe_complete" ? wipeComplete.manifestHash : "",
    /^sha256:[0-9a-f]{64}$/,
  );
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

test("force init preserves the old snapshot in recovery after a final teardown conflict", async () => {
  const adapter = seededAdapter();
  const originalBefore = relativeTreeSnapshot(adapter);
  const events: RunEvent[] = [];
  let transaction = "";
  adapter.beforeRmdir = (path) => {
    if (!transaction) {
      transaction = (adapter.renames[0]?.[1] ?? "").slice(0, -"/domain".length);
    }
    if (path === transaction) {
      void adapter.write("!Wiki/demo/concurrent.md", "NEW DURING FINAL RMDIR");
    }
  };

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

  const recovery = `${transaction}/recovery`;
  assert.equal(adapter.files.get("!Wiki/demo/concurrent.md"), "NEW DURING FINAL RMDIR");
  assert.deepEqual(relativeTreeSnapshot(adapter, recovery), originalBefore);
  assert.equal(events.filter((event) => event.kind === "tool_use" && event.name === "WipeDomain").length, 1);
  assert.equal(
    events.some((event) =>
      event.kind === "tool_result"
      && !event.ok
      && event.preview.includes(recovery)),
    true,
  );
  assert.equal(events.some((event) => event.kind === "file_start"), false);
  assert.equal(events.some((event) => event.kind === "domain_created" || event.kind === "domain_updated"), false);
});
