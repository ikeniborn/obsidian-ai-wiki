---
review:
  plan_hash: 7dbc3269e7bc9fa5
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-10-jsonl-domain-storage-intent.md
  spec: docs/superpowers/specs/2026-07-10-jsonl-domain-storage-design.md
result_check:
  verdict: needs_work
  plan_hash: 7dbc3269e7bc9fa5
  last_run: 2026-07-11
  reviewed: true
  docs_checked: true
---
# JSONL Domain Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy wiki service files with self-contained per-domain `metadata.jsonl`, `index.jsonl`, and `log.jsonl` storage while preserving domain management, retrieval, migration safety, and eval evidence.

**Architecture:** Add focused JSONL codecs and path helpers, then route `DomainStore`, index, log, embeddings, query, settings, and sidebar through those contracts. Migration creates a verified backup, writes new JSONL files, validates them, then deletes legacy `_config` service files only after the new runtime files are readable.

**Tech Stack:** TypeScript, Obsidian Vault adapter APIs, JSONL, YAML frontmatter parsing, existing retrieval modules, `node --import tsx --test` focused tests, `npm run lint`, `npm run build`.

---

## File Structure

- Create `src/jsonl.ts`: shared JSONL parse/stringify helpers with path-aware errors and unknown-record preservation support.
- Create `src/domain-metadata.ts`: `metadata.jsonl` record types, conversion between JSONL records and `DomainEntry`, parser/serializer, metadata merge helpers.
- Modify `src/wiki-path.ts`: new service paths for `metadata.jsonl`, `index.jsonl`, `log.jsonl`; legacy path helpers for migration only; remove normal `domainEmbeddingsPath` usage.
- Modify `src/domain-store.ts`: scan per-domain metadata, read/write domain-local metadata, keep public `load()` and compatibility `save()` semantics.
- Create `src/wiki-index-jsonl.ts`: `page` and `chunk` index record types, parse/write helpers, page/chunk record builders.
- Modify `src/wiki-index.ts`: move `_index.md` parsing into legacy helper role and use JSONL index helpers for runtime paths.
- Modify `src/page-similarity.ts`: store/read chunk vectors from `index.jsonl` chunk records and preserve Jaccard fallback.
- Modify `src/wiki-log.ts`: append structured operation JSONL records and convert legacy markdown log blocks.
- Create `src/migrate-jsonl-domain-storage.ts`: verified backup, conversion, validation, deletion, and fallback report.
- Modify `src/main.ts`: run JSONL migration before normal domain load and before older per-domain migrations that depend on service paths.
- Modify `src/controller.ts`, `src/view.ts`, `src/settings.ts`, and `src/modals.ts`: keep UI using `DomainStore`; update open-index/open-log targets and edit-domain save behavior.
- Create `scripts/eval-jsonl-domain-storage.ts`: isolated HLD eval harness that builds/migrates an eval domain and writes evidence.
- Create focused tests under `tests/`: JSONL helpers, metadata records, index records, log conversion, migration fixture, domain-store scan, retrieval fallback, UI path smoke, and eval harness dry-run.
- Update iwiki page for storage architecture after implementation through iwiki MCP tools.

## Task 1: JSONL Helpers And Path Contract

**Files:**
- Create: `src/jsonl.ts`
- Modify: `src/wiki-path.ts`
- Test: `tests/jsonl.test.ts`
- Test: `tests/wiki-path-jsonl.test.ts`

- [ ] **Step 1: Write JSONL helper tests**

Create `tests/jsonl.test.ts` with node:test cases for parse, stringify, blank lines, malformed line errors, and path-aware diagnostics:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonl, stringifyJsonl } from "../src/jsonl";

test("parseJsonl returns one object per non-empty line", () => {
  assert.deepEqual(parseJsonl('{"a":1}\n\n{"b":2}\n', "sample.jsonl"), [{ a: 1 }, { b: 2 }]);
});

test("parseJsonl reports path and line for malformed JSON", () => {
  assert.throws(
    () => parseJsonl('{"a":1}\n{bad}\n', "sample.jsonl"),
    /sample\.jsonl:2:/
  );
});

test("stringifyJsonl writes one complete JSON record per line", () => {
  assert.equal(stringifyJsonl([{ a: 1 }, { b: "x" }]), '{"a":1}\n{"b":"x"}\n');
});
```

- [ ] **Step 2: Write path helper tests**

Create `tests/wiki-path-jsonl.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  domainMetadataPath,
  domainIndexPath,
  domainLogPath,
  legacyDomainIndexPath,
  legacyDomainLogPath,
  legacyDomainEmbeddingsPath,
  LEGACY_GLOBAL_DOMAIN_PATH,
} from "../src/wiki-path";

test("jsonl service paths live directly in the domain folder", () => {
  assert.equal(domainMetadataPath("!Wiki/hld"), "!Wiki/hld/metadata.jsonl");
  assert.equal(domainIndexPath("!Wiki/hld"), "!Wiki/hld/index.jsonl");
  assert.equal(domainLogPath("!Wiki/hld"), "!Wiki/hld/log.jsonl");
});

test("legacy service paths remain explicit for migration", () => {
  assert.equal(LEGACY_GLOBAL_DOMAIN_PATH, "!Wiki/_config/_domain.json");
  assert.equal(legacyDomainIndexPath("!Wiki/hld"), "!Wiki/hld/_config/_index.md");
  assert.equal(legacyDomainLogPath("!Wiki/hld"), "!Wiki/hld/_config/_log.md");
  assert.equal(legacyDomainEmbeddingsPath("!Wiki/hld"), "!Wiki/hld/_config/_embeddings.json");
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
node --import tsx --test tests/jsonl.test.ts tests/wiki-path-jsonl.test.ts
```

Expected: fail because `src/jsonl.ts` and new path exports do not exist.

- [ ] **Step 4: Implement `src/jsonl.ts`**

Create `src/jsonl.ts`:

```ts
export class JsonlParseError extends Error {
  constructor(path: string, line: number, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`${path}:${line}: ${msg}`);
    this.name = "JsonlParseError";
  }
}

export function parseJsonl<T = unknown>(text: string, path: string): T[] {
  const out: T[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as T);
    } catch (e) {
      throw new JsonlParseError(path, i + 1, e);
    }
  }
  return out;
}

export function stringifyJsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}
```

- [ ] **Step 5: Update path helpers**

Modify `src/wiki-path.ts`:

```ts
export const WIKI_ROOT = "!Wiki";

export const LEGACY_GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
export const LEGACY_GLOBAL_DOMAIN_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_domain.json`;
export const GLOBAL_AGENT_LOG_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_agent.jsonl`;
export const GLOBAL_DEV_LOG_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_dev.jsonl`;

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}

export function domainMetadataPath(domainFolder: string): string {
  return `${domainFolder}/metadata.jsonl`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainFolder}/index.jsonl`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainFolder}/log.jsonl`;
}

export function legacyDomainConfigDir(domainFolder: string): string {
  return `${domainFolder}/_config`;
}

export function legacyDomainIndexPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_index.md`;
}

export function legacyDomainLogPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_log.md`;
}

export function legacyDomainEmbeddingsPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_embeddings.json`;
}
```

Keep the existing non-service helpers in `src/wiki-path.ts` unchanged.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --import tsx --test tests/jsonl.test.ts tests/wiki-path-jsonl.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/jsonl.ts src/wiki-path.ts tests/jsonl.test.ts tests/wiki-path-jsonl.test.ts
git commit -m "feat(storage): add jsonl helpers and service paths"
```

## Task 2: Domain Metadata JSONL And DomainStore

**Files:**
- Create: `src/domain-metadata.ts`
- Modify: `src/domain-store.ts`
- Test: `tests/domain-metadata.test.ts`
- Test: `tests/domain-store-jsonl.test.ts`

- [ ] **Step 1: Write metadata conversion tests**

Create `tests/domain-metadata.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  domainEntryToMetadataRecords,
  metadataRecordsToDomainEntry,
  parseDomainMetadata,
  stringifyDomainMetadata,
} from "../src/domain-metadata";
import type { DomainEntry } from "../src/domain";

const entry: DomainEntry = {
  id: "hld",
  name: "HLD",
  wiki_folder: "hld",
  source_paths: ["Ростелеком/HLD"],
  entity_types: [{
    type: "system",
    description: "Architecture system",
    extraction_cues: ["system name"],
    min_mentions_for_page: 2,
    wiki_subfolder: "systems",
  }],
  analyzed_sources: { "Ростелеком/HLD/СКИТ.md": "abc" },
  analyzed_sources_v2: true,
  analyzed_sources_v3: true,
  pageNameVersion: 2,
  max_tag_categories: 12,
};

test("DomainEntry round-trips through metadata records", () => {
  const records = domainEntryToMetadataRecords(entry);
  const roundTrip = metadataRecordsToDomainEntry(records, "hld");
  assert.deepEqual(roundTrip, entry);
});

test("metadata JSONL preserves managed entity types and source states", () => {
  const text = stringifyDomainMetadata(domainEntryToMetadataRecords(entry));
  const parsed = parseDomainMetadata(text, "!Wiki/hld/metadata.jsonl", "hld");
  assert.equal(parsed.entity_types?.[0].type, "system");
  assert.equal(parsed.analyzed_sources?.["Ростелеком/HLD/СКИТ.md"], "abc");
});
```

- [ ] **Step 2: Write DomainStore scan tests**

Create `tests/domain-store-jsonl.test.ts` with a memory vault adapter:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

class MemoryAdapter {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> { return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/")); }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from);
    this.files.delete(from);
    this.files.set(to, v);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}

function vault(adapter: MemoryAdapter): any {
  return { adapter, createFolder: async (path: string) => { adapter.files.set(`${path}/.keep`, ""); } };
}

test("DomainStore loads domains from per-domain metadata", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/hld/metadata.jsonl", '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":["src"]}\n');
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), [{ id: "hld", name: "HLD", wiki_folder: "hld", source_paths: ["src"], entity_types: [], analyzed_sources: {}, analyzed_sources_v2: true, analyzed_sources_v3: true }]);
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
node --import tsx --test tests/domain-metadata.test.ts tests/domain-store-jsonl.test.ts
```

Expected: fail because `src/domain-metadata.ts` and JSONL `DomainStore` behavior do not exist.

- [ ] **Step 4: Implement metadata records**

Create `src/domain-metadata.ts` with exported types and functions:

```ts
import type { DomainEntry, EntityType } from "./domain";
import { parseJsonl, stringifyJsonl } from "./jsonl";

export interface DomainMetadataRecord {
  kind: "domain";
  schemaVersion: 1;
  id: string;
  name: string;
  wiki_folder: string;
  source_paths: string[];
  language_notes?: string;
  max_tag_categories?: number;
  pageNameVersion?: number;
}

export interface EntityTypeMetadataRecord extends EntityType {
  kind: "entity_type";
}

export interface SourceStateMetadataRecord {
  kind: "source_state";
  path: string;
  hash: string;
}

export type MetadataRecord = DomainMetadataRecord | EntityTypeMetadataRecord | SourceStateMetadataRecord | Record<string, unknown>;

export function domainEntryToMetadataRecords(entry: DomainEntry): MetadataRecord[] {
  const domain: DomainMetadataRecord = {
    kind: "domain",
    schemaVersion: 1,
    id: entry.id,
    name: entry.name,
    wiki_folder: entry.wiki_folder,
    source_paths: entry.source_paths ?? [],
    language_notes: entry.language_notes,
    max_tag_categories: entry.max_tag_categories,
    pageNameVersion: entry.pageNameVersion,
  };
  const types = (entry.entity_types ?? []).map((type) => ({ kind: "entity_type" as const, ...type }));
  const sources = Object.entries(entry.analyzed_sources ?? {}).map(([path, hash]) => ({ kind: "source_state" as const, path, hash }));
  return [domain, ...types, ...sources];
}

export function metadataRecordsToDomainEntry(records: MetadataRecord[], fallbackFolder: string): DomainEntry {
  const domain = records.find((r): r is DomainMetadataRecord => r.kind === "domain");
  if (!domain) throw new Error(`${fallbackFolder}: missing domain record`);
  const entity_types = records.filter((r): r is EntityTypeMetadataRecord => r.kind === "entity_type")
    .map(({ kind, ...type }) => type);
  const analyzed_sources: Record<string, string> = {};
  for (const r of records) {
    if (r.kind === "source_state" && typeof r.path === "string" && typeof r.hash === "string") {
      analyzed_sources[r.path] = r.hash;
    }
  }
  return {
    id: domain.id,
    name: domain.name,
    wiki_folder: domain.wiki_folder || fallbackFolder,
    source_paths: domain.source_paths ?? [],
    entity_types,
    language_notes: domain.language_notes,
    analyzed_sources,
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
    pageNameVersion: domain.pageNameVersion,
    max_tag_categories: domain.max_tag_categories,
  };
}

export function parseDomainMetadata(text: string, path: string, fallbackFolder: string): DomainEntry {
  return metadataRecordsToDomainEntry(parseJsonl<MetadataRecord>(text, path), fallbackFolder);
}

export function stringifyDomainMetadata(records: MetadataRecord[]): string {
  return stringifyJsonl(records);
}
```

- [ ] **Step 5: Update DomainStore**

Modify `src/domain-store.ts` so `load()` scans `!Wiki` folders and `save()` writes per-domain metadata:

```ts
import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { migrateDomainsV2, migrateDomainsV3 } from "./domain";
import { WIKI_ROOT, domainMetadataPath, domainWikiFolder } from "./wiki-path";
import { domainEntryToMetadataRecords, parseDomainMetadata, stringifyDomainMetadata } from "./domain-metadata";

export class DomainCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainCorruptError";
  }
}

export class DomainStore {
  constructor(private vault: Vault) {}

  async load(): Promise<DomainEntry[]> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_ROOT))) return [];
    const listed = await adapter.list(WIKI_ROOT);
    const domains: DomainEntry[] = [];
    for (const folder of listed.folders) {
      const name = folder.split("/").pop() ?? folder;
      if (name.startsWith(".")) continue;
      const path = domainMetadataPath(folder);
      if (!(await adapter.exists(path))) continue;
      try {
        const entry = parseDomainMetadata(await adapter.read(path), path, name);
        if (entry.wiki_folder?.startsWith("!Wiki/")) entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
        domains.push(entry);
      } catch (e) {
        throw new DomainCorruptError(`${path}: ${(e as Error).message}`);
      }
    }
    const { migrated: m2 } = migrateDomainsV2(domains);
    const { migrated: m3 } = migrateDomainsV3(domains);
    if (m2 || m3) await this.save(domains);
    return domains;
  }

  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_ROOT))) await this.vault.createFolder(WIKI_ROOT).catch(() => {});
    for (const entry of domains) {
      const folder = domainWikiFolder(entry.wiki_folder);
      if (!(await adapter.exists(folder))) await this.vault.createFolder(folder).catch(() => {});
      const path = domainMetadataPath(folder);
      const tmp = `${path}.tmp`;
      await adapter.write(tmp, stringifyDomainMetadata(domainEntryToMetadataRecords(entry)));
      if (await adapter.exists(path)) await adapter.remove(path);
      await adapter.rename(tmp, path);
    }
  }
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --import tsx --test tests/domain-metadata.test.ts tests/domain-store-jsonl.test.ts
```

Expected: pass.

- [ ] **Step 7: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/domain-metadata.ts src/domain-store.ts tests/domain-metadata.test.ts tests/domain-store-jsonl.test.ts
git commit -m "feat(storage): store domains in metadata jsonl"
```

## Task 3: Index JSONL And Vector Cache Migration Boundary

**Files:**
- Create: `src/wiki-index-jsonl.ts`
- Modify: `src/wiki-index.ts`
- Modify: `src/page-similarity.ts`
- Test: `tests/wiki-index-jsonl.test.ts`
- Test: `tests/page-similarity-jsonl.test.ts`

- [ ] **Step 1: Write index JSONL tests**

Create `tests/wiki-index-jsonl.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseWikiIndexJsonl, stringifyWikiIndexJsonl, pageRecordId, chunkRecordId } from "../src/wiki-index-jsonl";

test("index JSONL parses page and chunk records", () => {
  const text = [
    '{"kind":"page","schemaVersion":1,"articleId":"hld_system","path":"!Wiki/hld/systems/hld_system.md","type":"system","description":"System description","resource":["СКИТ"],"bodyHash":"b","descriptionHash":"d"}',
    '{"kind":"chunk","schemaVersion":1,"articleId":"hld_system","path":"!Wiki/hld/systems/hld_system.md","heading":"## Scope","ordinal":0,"bodyHash":"b","embedTextHash":"e","vector":[0.1,0.2],"vectorModel":"m","dimensions":2,"updatedAt":"2026-07-11T00:00:00.000Z"}',
  ].join("\n") + "\n";
  const records = parseWikiIndexJsonl(text, "!Wiki/hld/index.jsonl");
  assert.equal(records.length, 2);
  assert.equal(pageRecordId(records[0] as any), "page:hld_system");
  assert.equal(chunkRecordId(records[1] as any), "chunk:hld_system:0");
});

test("stringifyWikiIndexJsonl keeps complete records per line", () => {
  assert.match(stringifyWikiIndexJsonl([{ kind: "page", schemaVersion: 1, articleId: "a", path: "p", type: "concept", description: "d", resource: [], bodyHash: "b", descriptionHash: "h" }]), /\n$/);
});
```

- [ ] **Step 2: Write page-similarity storage boundary test**

Create `tests/page-similarity-jsonl.test.ts` with a narrow test for JSONL cache read/write helpers exported from `page-similarity.ts` or delegated to `wiki-index-jsonl.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { chunkRecordToEmbeddingChunk, embeddingChunkToChunkRecord } from "../src/wiki-index-jsonl";

test("embedding chunks convert to index chunk records with vector metadata", () => {
  const record = embeddingChunkToChunkRecord({
    articleId: "a",
    path: "!Wiki/hld/concept/a.md",
    heading: "## Detail",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "nomic",
    dimensions: 2,
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.deepEqual(chunkRecordToEmbeddingChunk(record).vector, [0.1, 0.2]);
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
node --import tsx --test tests/wiki-index-jsonl.test.ts tests/page-similarity-jsonl.test.ts
```

Expected: fail because `wiki-index-jsonl` helpers do not exist.

- [ ] **Step 4: Implement `src/wiki-index-jsonl.ts`**

Create exported `PageIndexRecord`, `ChunkIndexRecord`, parse/stringify helpers, ID helpers, and chunk conversion helpers exactly matching the spec record fields. Use `parseJsonl` and `stringifyJsonl`.

- [ ] **Step 5: Update runtime index paths**

Modify `src/wiki-index.ts`:
- Keep `parseIndexAnnotations` for migration.
- Add functions that read/write `index.jsonl` through `wiki-index-jsonl`.
- Stop writing `_index.md` from normal `upsertIndexAnnotation` paths; replace normal callers with JSONL page record rebuild in later tasks.

- [ ] **Step 6: Update `page-similarity.ts` storage calls**

Replace runtime reads/writes of `domainEmbeddingsPath(domainRoot)` with JSONL chunk record reads/writes through `domainIndexPath(domainRoot)`. Keep legacy embeddings reads behind migration-only code.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --import tsx --test tests/wiki-index-jsonl.test.ts tests/page-similarity-jsonl.test.ts
```

Expected: pass.

- [ ] **Step 8: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add src/wiki-index-jsonl.ts src/wiki-index.ts src/page-similarity.ts tests/wiki-index-jsonl.test.ts tests/page-similarity-jsonl.test.ts
git commit -m "feat(retrieval): store page and chunk records in index jsonl"
```

## Task 4: Structured Log JSONL

**Files:**
- Modify: `src/wiki-log.ts`
- Test: `tests/wiki-log-jsonl.test.ts`

- [ ] **Step 1: Write log tests**

Create `tests/wiki-log-jsonl.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildLogRecord, parseLegacyLogBlocks } from "../src/wiki-log";

test("buildLogRecord emits structured ingest operation", () => {
  const record = buildLogRecord("hld", {
    op: "ingest",
    sourcePath: "src.md",
    entries: [{ path: "!Wiki/hld/system/a.md", action: "CREATED", statusTo: "developing" }],
    outputTokens: 42,
  }, "2026-07-11T00:00:00.000Z");
  assert.equal(record.kind, "operation");
  assert.equal(record.op, "ingest");
  assert.equal(record.entries?.[0].action, "CREATED");
});

test("parseLegacyLogBlocks preserves unparsed markdown blocks", () => {
  const blocks = parseLegacyLogBlocks("## 2026-07-10 — ingest — hld\n**Tokens:** 10\n\n---\n", "hld");
  assert.equal(blocks[0].kind, "legacy_log_block");
  assert.match(blocks[0].text, /Tokens/);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
node --import tsx --test tests/wiki-log-jsonl.test.ts
```

Expected: fail because JSONL log helpers are not exported.

- [ ] **Step 3: Implement JSONL log helpers and append**

Modify `src/wiki-log.ts`:
- Export `OperationLogRecord`, `LegacyLogBlockRecord`, and `buildLogRecord`.
- Make `appendWikiLog` append `JSON.stringify(buildLogRecord(...)) + "\n"` to `domainLogPath(domainFolder)`.
- Export `parseLegacyLogBlocks(markdown, domainId)` for migration.

- [ ] **Step 4: Run focused test**

Run:

```bash
node --import tsx --test tests/wiki-log-jsonl.test.ts
```

Expected: pass.

- [ ] **Step 5: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/wiki-log.ts tests/wiki-log-jsonl.test.ts
git commit -m "feat(storage): write wiki logs as jsonl"
```

## Task 5: Verified Legacy Migration With Backup And Deletion

**Files:**
- Create: `src/migrate-jsonl-domain-storage.ts`
- Modify: `src/main.ts`
- Test: `tests/migrate-jsonl-domain-storage.test.ts`

- [ ] **Step 1: Write migration fixture test**

Create `tests/migrate-jsonl-domain-storage.test.ts` with a memory adapter fixture containing:
- `!Wiki/_config/_domain.json`
- `!Wiki/hld/_config/_index.md`
- `!Wiki/hld/_config/_log.md`
- `!Wiki/hld/_config/_embeddings.json`
- one wiki page with OKF frontmatter description.

Assert after migration:
- `!Wiki/hld/metadata.jsonl` exists;
- `!Wiki/hld/index.jsonl` exists;
- `!Wiki/hld/log.jsonl` exists;
- backup manifest exists;
- legacy `_config` paths are removed;
- entity type and source state are preserved.

- [ ] **Step 2: Run migration test and confirm failure**

Run:

```bash
node --import tsx --test tests/migrate-jsonl-domain-storage.test.ts
```

Expected: fail because migration module does not exist.

- [ ] **Step 3: Implement migration module**

Create `src/migrate-jsonl-domain-storage.ts` with:
- `detectLegacyJsonlStorageState(vault): Promise<boolean>`
- `migrateJsonlDomainStorage(vault): Promise<JsonlMigrationReport>`
- backup copy with `manifest.json`;
- conversion from `_domain.json` to per-domain `metadata.jsonl`;
- conversion from `_index.md` and pages to page records;
- best-effort `_embeddings.json` to chunk records when hashes/dimensions match;
- conversion from `_log.md` to JSONL log records;
- validation gate;
- legacy deletion after validation.

- [ ] **Step 4: Wire migration into startup**

Modify `src/main.ts`:
- import `migrateJsonlDomainStorage`;
- run it before `this.domainStore.load()` calls in `onload`;
- emit a Notice on failed validation and keep legacy fallback for that launch.

- [ ] **Step 5: Run migration test**

Run:

```bash
node --import tsx --test tests/migrate-jsonl-domain-storage.test.ts
```

Expected: pass.

- [ ] **Step 6: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add src/migrate-jsonl-domain-storage.ts src/main.ts tests/migrate-jsonl-domain-storage.test.ts
git commit -m "feat(storage): migrate legacy wiki service files to jsonl"
```

## Task 6: UI, Controller, And Query Integration

**Files:**
- Modify: `src/controller.ts`
- Modify: `src/view.ts`
- Modify: `src/settings.ts`
- Modify: `src/modals.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/init.ts`
- Test: `tests/ui-jsonl-paths.test.ts`
- Test: `tests/query-jsonl-index.test.ts`

- [ ] **Step 1: Write UI path smoke test**

Create `tests/ui-jsonl-paths.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { domainIndexPath, domainLogPath, domainWikiFolder } from "../src/wiki-path";

test("sidebar opens JSONL service files for a domain", () => {
  const folder = domainWikiFolder("hld");
  assert.equal(domainIndexPath(folder), "!Wiki/hld/index.jsonl");
  assert.equal(domainLogPath(folder), "!Wiki/hld/log.jsonl");
});
```

- [ ] **Step 2: Write query JSONL index smoke test**

Create `tests/query-jsonl-index.test.ts` around the narrow helper introduced in Task 3 that loads `page` and `chunk` records from `index.jsonl`. Assert missing vectors produce a Jaccard fallback result rather than an exception.

- [ ] **Step 3: Run tests and confirm failures**

Run:

```bash
node --import tsx --test tests/ui-jsonl-paths.test.ts tests/query-jsonl-index.test.ts
```

Expected: UI path test passes after Task 1; query smoke fails until query reads JSONL records.

- [ ] **Step 4: Update controller and sidebar links**

Modify `src/controller.ts` and `src/view.ts`:
- replace log/index read previews with `domainLogPath` and `domainIndexPath` JSONL paths;
- render log preview from JSONL lines instead of markdown sections;
- leave `DomainStore.load()` as the domain source.

- [ ] **Step 5: Update settings and edit domain modal**

Modify `src/settings.ts` and `src/modals.ts`:
- keep editing `entity_types`;
- save through `DomainStore.save()` or targeted domain update helper;
- remove references to root `_domain.json` from user-facing errors.

- [ ] **Step 6: Update init/query phases**

Modify `src/phases/init.ts` and `src/phases/query.ts`:
- init writes `metadata.jsonl` through domain events and DomainStore;
- query reads page/chunk records from `index.jsonl`;
- query diagnostics include `indexFormat: "jsonl"`;
- Jaccard fallback remains active when index vectors are missing or malformed.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --import tsx --test tests/ui-jsonl-paths.test.ts tests/query-jsonl-index.test.ts
```

Expected: pass.

- [ ] **Step 8: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: both pass.

- [ ] **Step 9: Commit Task 6**

Run:

```bash
git add src/controller.ts src/view.ts src/settings.ts src/modals.ts src/phases/query.ts src/phases/init.ts tests/ui-jsonl-paths.test.ts tests/query-jsonl-index.test.ts
git commit -m "feat(storage): connect ui and query to jsonl domain files"
```

## Task 7: HLD Eval Harness

**Files:**
- Create: `scripts/eval-jsonl-domain-storage.ts`
- Test: `tests/eval-jsonl-domain-storage.test.ts`
- Output when run manually: `docs/superpowers/evals/jsonl-domain-storage-hld-YYYY-MM-DD.md`

- [ ] **Step 1: Write eval harness dry-run test**

Create `tests/eval-jsonl-domain-storage.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildHldQueries, classifyAggregateVerdict } from "../scripts/eval-jsonl-domain-storage";

test("HLD eval defines five fixed query themes", () => {
  assert.equal(buildHldQueries().length, 5);
});

test("aggregate verdict cannot be accepted without baseline", () => {
  assert.equal(classifyAggregateVerdict({ baselineAvailable: false, regressions: [], formatWorked: true }), "needs_tuning");
});
```

- [ ] **Step 2: Run eval test and confirm failure**

Run:

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: fail because script exports do not exist.

- [ ] **Step 3: Implement eval harness**

Create `scripts/eval-jsonl-domain-storage.ts`:
- export `buildHldQueries()` returning five fixed query objects for data export/S3/ClickHouse, Airflow HA/balancing, integrations/data marts, GitFlame/source migration, and ownership/components;
- export `classifyAggregateVerdict(input)` with `accepted`, `needs_tuning`, `rejected`;
- CLI reads HLD source path, builds isolated eval domain, runs retrieval, captures pages/chunks/latency/rebuild time/service sizes/fallback mode, writes markdown report under `docs/superpowers/evals/`.

- [ ] **Step 4: Run eval dry-run test**

Run:

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: pass.

- [ ] **Step 5: Run eval harness**

Run:

```bash
npx tsx scripts/eval-jsonl-domain-storage.ts --source "/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD" --out docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
```

Expected: report exists and contains five query sections plus aggregate verdict. If embeddings or LLM credentials are unavailable, report records blocked evidence and aggregate verdict is not `accepted`.

- [ ] **Step 6: Commit Task 7**

Run:

```bash
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
git commit -m "test(eval): add hld jsonl storage harness"
```

## Task 8: Documentation, Wiki, And Final Verification

**Files:**
- Modify: `docs/README.ru.md`
- Modify: `docs/rag-quality-recommendations.md`
- Update iwiki domain page through MCP tools
- Modify: project task log through the chain result validator

- [ ] **Step 1: Update repository docs**

Update docs that describe service files, retrieval index, and eval workflow:
- `docs/README.ru.md`: mention `metadata.jsonl`, `index.jsonl`, `log.jsonl`, no `_config`.
- `docs/rag-quality-recommendations.md`: mention JSONL page/chunk index and HLD eval evidence.

- [ ] **Step 2: Update iwiki**

Use iwiki MCP tools:
- `wiki_status`
- `wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")`
- update or create a storage architecture page that documents `metadata.jsonl`, `index.jsonl`, `log.jsonl`, migration backup/deletion, and HLD eval.
- `wiki_lint(domain="obsidian-ai-wiki")`

Expected: lint has no broken refs, stale pages, or missing source entries for this change.

- [ ] **Step 3: Run full verification**

Run:

```bash
node --import tsx --test tests/jsonl.test.ts tests/wiki-path-jsonl.test.ts tests/domain-metadata.test.ts tests/domain-store-jsonl.test.ts tests/wiki-index-jsonl.test.ts tests/page-similarity-jsonl.test.ts tests/wiki-log-jsonl.test.ts tests/migrate-jsonl-domain-storage.test.ts tests/ui-jsonl-paths.test.ts tests/query-jsonl-index.test.ts tests/eval-jsonl-domain-storage.test.ts
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 4: Run chain result check in Codex**

Ask Codex to run `check-chain result` for `docs/superpowers/plans/2026-07-11-jsonl-domain-storage.md`.

Expected: `OK`; project task log row for `jsonl-domain-storage` closes with `Result: OK`.

- [ ] **Step 5: Commit docs and result artifacts**

Run:

```bash
git add docs/README.ru.md docs/rag-quality-recommendations.md docs/superpowers/reports/jsonl-domain-storage-results.html
git commit -m "docs(storage): document jsonl domain storage"
```
