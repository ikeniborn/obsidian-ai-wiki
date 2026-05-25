---
review:
  plan_hash: 0523d4cc229647d0
  spec_hash: 2efdd5e4582230d2
  last_run: 2026-05-25
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      severity: CRITICAL
      phase: coverage
      section: "Task 7 (new)"
      section_hash: a4cdadb2be91d9bd
      text: "view.ts not covered — spec §'Sidebar buttons: open log and index' requires replacing vault.adapter open calls with workspace.openLinkText(); no task in plan"
      verdict: fixed
    - id: F-002
      severity: WARNING
      phase: coverage
      section: "Task 5"
      section_hash: 3e2c5f691c535399
      text: "Edge case 'no per-domain schema' — spec says copy bundled template from prompts/templates/; plan falls back to old !Wiki/.config/ global copy instead"
      verdict: fixed
    - id: F-003
      severity: WARNING
      phase: coverage
      section: "Task 6"
      section_hash: c7cfce8ba0c2a44a
      text: "I/O error handling incomplete — spec: 'halt, leave old structure intact, log error'; plan throws non-conflict errors uncaught (plugin load crash instead of logged notice)"
      verdict: fixed
    - id: F-004
      severity: WARNING
      phase: verifiability
      section: "Task 4"
      section_hash: b48e2927161ab83c
      text: "Step 6 test command omits lint.test.ts and lint-chat.test.ts despite Task 4 modifying lint.ts and lint-chat.ts"
      verdict: fixed
---

# Storage Layout Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `.config/` → `_config/`, move schemas/logs to global `!Wiki/_config/`, auto-migrate existing vaults on startup.

**Architecture:** All path constants centralised in `wiki-path.ts`. New `storage-migration.ts` handles one-time vault migration. Phase functions switch from per-domain schema paths to global constants. Migration is called from `main.ts` `onload` before any other vault operation.

**Tech Stack:** TypeScript, Obsidian Vault API, Vitest

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/wiki-path.ts` | Modify | Add global constants; update per-domain functions; fix `validateArticlePath` |
| `src/domain-store.ts` | Modify | Use `GLOBAL_DOMAIN_PATH`, `GLOBAL_CONFIG_DIR` from wiki-path |
| `src/agent-runner.ts` | Modify | `_dev.jsonl` → `GLOBAL_DEV_LOG_PATH` |
| `src/controller.ts` | Modify | `_agent.jsonl` → `GLOBAL_AGENT_LOG_PATH` |
| `src/phases/init.ts` | Modify | Write schemas to global config dir |
| `src/phases/ingest.ts` | Modify | Read `_wiki_schema.md` from `GLOBAL_WIKI_SCHEMA_PATH` |
| `src/phases/lint.ts` | Modify | Same + shrink `META_FILES` |
| `src/phases/lint-chat.ts` | Modify | Same + shrink `META_FILES` |
| `src/phases/format.ts` | Modify | Read `_format_schema.md` from `GLOBAL_FORMAT_SCHEMA_PATH` |
| `src/storage-migration.ts` | Create | Migration logic |
| `src/main.ts` | Modify | Call `runStorageMigration`; fix hardcoded path |
| `src/view.ts` | Modify | Sidebar buttons use `workspace.openLinkText()` instead of `vault.adapter` path |
| `tests/wiki-path.test.ts` | Modify | Update path assertions to `_config/` |
| `tests/storage-migration.test.ts` | Create | Tests for migration |
| `tests/main-migration.test.ts` | Modify | Update hardcoded `!Wiki/.config/` path |
| `docs/prompt-architecture.md` | Modify | Update vault path labels in Mermaid |
| `lat.md/domain.md` | Modify | Update Wiki Folder Layout section |

---

### Task 1: Update `wiki-path.ts` and its tests

**Files:**
- Modify: `src/wiki-path.ts`
- Modify: `tests/wiki-path.test.ts`

- [ ] **Step 1: Write failing tests for new constants and updated functions**

Replace the full contents of `tests/wiki-path.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  WIKI_ROOT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOMAIN_PATH,
  GLOBAL_WIKI_SCHEMA_PATH,
  GLOBAL_FORMAT_SCHEMA_PATH,
  GLOBAL_AGENT_LOG_PATH,
  GLOBAL_DEV_LOG_PATH,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
  validateArticlePath,
  domainConfigDir,
  domainIndexPath,
  domainLogPath,
} from "../src/wiki-path";

describe("WIKI_ROOT", () => {
  it("equals !Wiki", () => expect(WIKI_ROOT).toBe("!Wiki"));
});

describe("global constants", () => {
  it("GLOBAL_CONFIG_DIR", () => expect(GLOBAL_CONFIG_DIR).toBe("!Wiki/_config"));
  it("GLOBAL_DOMAIN_PATH", () => expect(GLOBAL_DOMAIN_PATH).toBe("!Wiki/_config/_domain.json"));
  it("GLOBAL_WIKI_SCHEMA_PATH", () => expect(GLOBAL_WIKI_SCHEMA_PATH).toBe("!Wiki/_config/_wiki_schema.md"));
  it("GLOBAL_FORMAT_SCHEMA_PATH", () => expect(GLOBAL_FORMAT_SCHEMA_PATH).toBe("!Wiki/_config/_format_schema.md"));
  it("GLOBAL_AGENT_LOG_PATH", () => expect(GLOBAL_AGENT_LOG_PATH).toBe("!Wiki/_config/_agent.jsonl"));
  it("GLOBAL_DEV_LOG_PATH", () => expect(GLOBAL_DEV_LOG_PATH).toBe("!Wiki/_config/_dev.jsonl"));
});

describe("domainWikiFolder", () => {
  it("prepends !Wiki/ to subfolder", () => expect(domainWikiFolder("os")).toBe("!Wiki/os"));
  it("handles cyrillic subfolder", () => expect(domainWikiFolder("базы-данных")).toBe("!Wiki/базы-данных"));
  it("handles nested subfolder", () => expect(domainWikiFolder("work/archive")).toBe("!Wiki/work/archive"));
});

describe("sanitizeWikiFolder", () => {
  it("strips vaults/<name>/ prefix", () => expect(sanitizeWikiFolder("vaults/Work/os")).toBe("os"));
  it("strips vaults/<name>/!Wiki/ prefix", () => expect(sanitizeWikiFolder("vaults/Work/!Wiki/os")).toBe("os"));
  it("strips !Wiki/ prefix", () => expect(sanitizeWikiFolder("!Wiki/os")).toBe("os"));
  it("takes last segment when slash remains", () => expect(sanitizeWikiFolder("os/network")).toBe("network"));
  it("returns single-segment as-is", () => expect(sanitizeWikiFolder("os")).toBe("os"));
});

describe("sanitizeWikiSubfolder", () => {
  it("strips domain prefix (os/network → network)", () => expect(sanitizeWikiSubfolder("os/network")).toBe("network"));
  it("returns single word unchanged", () => expect(sanitizeWikiSubfolder("network")).toBe("network"));
  it("takes last segment for multi-level (a/b/c → c)", () => expect(sanitizeWikiSubfolder("a/b/c")).toBe("c"));
});

describe("validateArticlePath", () => {
  const wiki = "!Wiki/os";

  it("valid: exactly 2 segments after domain", () =>
    expect(validateArticlePath("!Wiki/os/network/NFS.md", wiki)).toBe(true));
  it("invalid: domain appears twice (5 segments total)", () =>
    expect(validateArticlePath("!Wiki/os/os/network/NFS.md", wiki)).toBe(false));
  it("invalid: 3 segments after domain (too deep)", () =>
    expect(validateArticlePath("!Wiki/os/network/nfs/NFS.md", wiki)).toBe(false));
  it("valid: _index.md in _config exempt", () =>
    expect(validateArticlePath("!Wiki/os/_config/_index.md", wiki)).toBe(true));
  it("valid: _log.md in _config exempt", () =>
    expect(validateArticlePath("!Wiki/os/_config/_log.md", wiki)).toBe(true));
  it("invalid: _index.md at domain root not exempt", () =>
    expect(validateArticlePath("!Wiki/os/_index.md", wiki)).toBe(false));
  it("invalid: old .config path no longer accepted", () =>
    expect(validateArticlePath("!Wiki/os/.config/_index.md", wiki)).toBe(false));
  it("invalid: wrong domain prefix", () =>
    expect(validateArticlePath("!Wiki/other/network/NFS.md", wiki)).toBe(false));
  it("invalid: only 1 segment after domain (no subfolder)", () =>
    expect(validateArticlePath("!Wiki/os/NFS.md", wiki)).toBe(false));
});

describe("domainConfigDir", () => {
  it("appends /_config to domain folder", () =>
    expect(domainConfigDir("!Wiki/os")).toBe("!Wiki/os/_config"));
});

describe("domainIndexPath", () => {
  it("returns _config/_index.md path", () =>
    expect(domainIndexPath("!Wiki/os")).toBe("!Wiki/os/_config/_index.md"));
});

describe("domainLogPath", () => {
  it("returns _config/_log.md path", () =>
    expect(domainLogPath("!Wiki/os")).toBe("!Wiki/os/_config/_log.md"));
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/wiki-path.test.ts
```

Expected: FAIL — `GLOBAL_CONFIG_DIR` not exported, `domainConfigDir` returns `.config/` not `_config/`

- [ ] **Step 3: Replace `src/wiki-path.ts`**

```typescript
export const WIKI_ROOT = "!Wiki";

export const GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
export const GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
export const GLOBAL_WIKI_SCHEMA_PATH = `${GLOBAL_CONFIG_DIR}/_wiki_schema.md`;
export const GLOBAL_FORMAT_SCHEMA_PATH = `${GLOBAL_CONFIG_DIR}/_format_schema.md`;
export const GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
export const GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}

export function sanitizeWikiFolder(raw: string): string {
  let s = raw;
  const vaultMatch = s.match(/^vaults\/[^/]+\//);
  if (vaultMatch) s = s.slice(vaultMatch[0].length);
  if (s.startsWith("!Wiki/")) s = s.slice("!Wiki/".length);
  if (s.includes("/")) return s.split("/").pop()!;
  return s;
}

export function sanitizeWikiSubfolder(raw: string): string {
  if (!raw.includes("/")) return raw;
  return raw.split("/").pop()!;
}

export function validateArticlePath(path: string, wikiVaultPath: string): boolean {
  if (
    path === `${wikiVaultPath}/_config/_index.md` ||
    path === `${wikiVaultPath}/_config/_log.md`
  ) return true;
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  const segments = remainder.split("/");
  return segments.length === 2 && segments[1].endsWith(".md");
}

export function domainConfigDir(domainFolder: string): string {
  return `${domainFolder}/_config`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_index.md`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_log.md`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-path.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/wiki-path.ts tests/wiki-path.test.ts
git commit -m "refactor(wiki-path): rename .config/ to _config/, add global constants"
```

---

### Task 2: Update `domain-store.ts`

**Files:**
- Modify: `src/domain-store.ts`
- Modify: `tests/domain-store.test.ts` (if it has hardcoded paths)

- [ ] **Step 1: Check existing domain-store tests for hardcoded paths**

```bash
grep -n "\.config\|_domain\|CONFIG_DIR\|FILE_PATH" tests/domain-store.test.ts tests/domain-store-migration.test.ts
```

Note any `.config` occurrences that need updating.

- [ ] **Step 2: Update `src/domain-store.ts`**

Replace the top of the file:

```typescript
import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { migrateDomainsV2 } from "./domain";
import { WIKI_ROOT, GLOBAL_DOMAIN_PATH, GLOBAL_CONFIG_DIR } from "./wiki-path";

const FILE_PATH = GLOBAL_DOMAIN_PATH;
const TMP_PATH = `${FILE_PATH}.tmp`;
const WIKI_DIR = WIKI_ROOT;
const CONFIG_DIR = GLOBAL_CONFIG_DIR;
```

Keep the rest of the file (`DomainCorruptError`, `DomainStore` class) unchanged.

- [ ] **Step 3: Update hardcoded path in `tests/domain-store-migration.test.ts` and `tests/main-migration.test.ts`**

In `tests/main-migration.test.ts`, replace every occurrence of `"!Wiki/.config/_domain.json"` with `"!Wiki/_config/_domain.json"`.

In `tests/domain-store.test.ts` (if it exists and has hardcoded paths), replace `"!Wiki/.config/"` with `"!Wiki/_config/"`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/domain-store.test.ts tests/domain-store-migration.test.ts tests/main-migration.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain-store.ts tests/domain-store.test.ts tests/domain-store-migration.test.ts tests/main-migration.test.ts
git commit -m "refactor(domain-store): use GLOBAL_DOMAIN_PATH from wiki-path"
```

---

### Task 3: Update `agent-runner.ts` and `controller.ts`

**Files:**
- Modify: `src/agent-runner.ts`
- Modify: `src/controller.ts`
- Modify: `tests/agent-runner-dev-log.test.ts`

- [ ] **Step 1: Update hardcoded path assertions in tests**

In `tests/agent-runner-dev-log.test.ts`, replace every `"!Wiki/.config/_dev.jsonl"` with `"!Wiki/_config/_dev.jsonl"`.

Run to confirm they now fail (implementation not changed yet):

```bash
npx vitest run tests/agent-runner-dev-log.test.ts
```

Expected: some tests FAIL because source still writes to old path.

- [ ] **Step 2: Update `src/agent-runner.ts`**

Add import at top of file:

```typescript
import { GLOBAL_DEV_LOG_PATH } from "./wiki-path";
```

Find both occurrences of `"!Wiki/.config/_dev.jsonl"` (lines ~56 and ~162) and replace each with `GLOBAL_DEV_LOG_PATH`.

- [ ] **Step 3: Update `src/controller.ts`**

Add import at top of file:

```typescript
import { GLOBAL_AGENT_LOG_PATH } from "./wiki-path";
```

Find `"!Wiki/.config/_agent.jsonl"` (~line 541) and replace with `GLOBAL_AGENT_LOG_PATH`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/agent-runner-dev-log.test.ts tests/controller-log-adapter.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts src/controller.ts tests/agent-runner-dev-log.test.ts
git commit -m "refactor(agent-runner,controller): use GLOBAL_DEV_LOG_PATH / GLOBAL_AGENT_LOG_PATH"
```

---

### Task 4: Update phase functions

**Files:**
- Modify: `src/phases/init.ts`
- Modify: `src/phases/ingest.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/lint-chat.ts`
- Modify: `src/phases/format.ts`

- [ ] **Step 1: Update `src/phases/init.ts`**

Add/update imports at top of file:

```typescript
import { GLOBAL_CONFIG_DIR, GLOBAL_WIKI_SCHEMA_PATH, GLOBAL_FORMAT_SCHEMA_PATH, WIKI_ROOT } from "../wiki-path";
```

Around line 148, replace per-domain schema read:
```typescript
// Before:
tryRead(vaultTools, `${wikiRootGuess}/.config/_wiki_schema.md`),
// After:
tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH),
```

Around lines 359-371, replace the config dir block:
```typescript
// Before:
const configDir    = `${wikiRoot}/.config`;
const wikiSchema   = `${configDir}/_wiki_schema.md`;
const formatSchema = `${configDir}/_format_schema.md`;
// ...
try { await vaultTools.mkdir(configDir); } catch { /* already exists */ }
// After:
const wikiSchema   = GLOBAL_WIKI_SCHEMA_PATH;
const formatSchema = GLOBAL_FORMAT_SCHEMA_PATH;
// ...
try { await vaultTools.mkdir(GLOBAL_CONFIG_DIR); } catch { /* already exists */ }
```

- [ ] **Step 2: Update `src/phases/ingest.ts`**

Add import:
```typescript
import { GLOBAL_WIKI_SCHEMA_PATH, domainWikiFolder, validateArticlePath, domainIndexPath } from "../wiki-path";
```

Find the `schemaRoot` derivation block (~line 73) and the schema read (~line 78):
```typescript
// Before:
const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
// ...
tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`),
// After:
// (delete schemaRoot line — no longer needed)
// ...
tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH),
```

- [ ] **Step 3: Update `src/phases/lint.ts`**

Add import:
```typescript
import { GLOBAL_WIKI_SCHEMA_PATH } from "../wiki-path";
```

Update `META_FILES` — schemas are now global, only index and log are per-domain:
```typescript
// Before:
const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];
// After:
const META_FILES = ["_index.md", "_log.md"];
```

Update schema read (~line 62):
```typescript
// Before:
const schemaContent = await tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`);
// After:
const schemaContent = await tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH);
```

Remove the `schemaRoot` derivation line if present.

- [ ] **Step 4: Update `src/phases/lint-chat.ts`**

Add import:
```typescript
import { GLOBAL_WIKI_SCHEMA_PATH } from "../wiki-path";
```

Update `META_FILES`:
```typescript
// Before:
const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];
// After:
const META_FILES = ["_index.md", "_log.md"];
```

Update schema read (~line 38):
```typescript
// Before:
const schemaContent = await tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`);
// After:
const schemaContent = await tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH);
```

- [ ] **Step 5: Update `src/phases/format.ts`**

Add import:
```typescript
import { GLOBAL_FORMAT_SCHEMA_PATH, WIKI_ROOT } from "../wiki-path";
```

Update schema path (~line 71):
```typescript
// Before:
const formatSchemaPath = `${WIKI_ROOT}/.config/_format_schema.md`;
// After:
const formatSchemaPath = GLOBAL_FORMAT_SCHEMA_PATH;
```

- [ ] **Step 6: Run phase tests**

```bash
npx vitest run tests/ingest.test.ts tests/init-args.test.ts tests/controller-format.test.ts tests/lint.test.ts tests/lint-chat.test.ts
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/phases/init.ts src/phases/ingest.ts src/phases/lint.ts src/phases/lint-chat.ts src/phases/format.ts
git commit -m "refactor(phases): read schemas from global _config/, shrink META_FILES"
```

---

### Task 5: Create `storage-migration.ts` and tests

**Files:**
- Create: `src/storage-migration.ts`
- Create: `tests/storage-migration.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `tests/storage-migration.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runStorageMigration, StorageMigrationConflictError } from "../src/storage-migration";

function makeVault(files: Map<string, string>, mtimes: Map<string, number> = new Map()) {
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p)),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    append: vi.fn(async (p: string, c: string) => {
      files.set(p, (files.get(p) ?? "") + c);
    }),
    remove: vi.fn(async (p: string) => { files.delete(p); }),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a)!); files.delete(a);
    }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn(async (p: string) => ({ mtime: mtimes.get(p) ?? 0 })),
    list: vi.fn(async (p: string) => ({
      files: [...files.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
      folders: [],
    })),
  };
  return {
    adapter,
    createFolder: vi.fn().mockResolvedValue(undefined),
  } as any;
}

const DOMAIN_JSON = JSON.stringify([{ id: "os", wiki_folder: "os" }]);

describe("runStorageMigration", () => {
  it("skips when !Wiki/.config/ absent", async () => {
    const files = new Map<string, string>();
    const vault = makeVault(files);
    await runStorageMigration(vault);
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("moves _domain.json to !Wiki/_config/", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "schema"],
      ["!Wiki/.config/_format_schema.md", "format"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.has("!Wiki/_config/_domain.json")).toBe(true);
    expect(JSON.parse(files.get("!Wiki/_config/_domain.json")!)).toEqual([{ id: "os", wiki_folder: "os" }]);
    expect(files.has("!Wiki/.config/_domain.json")).toBe(false);
  });

  it("moves per-domain _index.md and _log.md to _config/", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "schema"],
      ["!Wiki/.config/_format_schema.md", "format"],
      ["!Wiki/os/.config/_index.md", "index content"],
      ["!Wiki/os/.config/_log.md", "log content"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.get("!Wiki/os/_config/_index.md")).toBe("index content");
    expect(files.get("!Wiki/os/_config/_log.md")).toBe("log content");
    expect(files.has("!Wiki/os/.config/_index.md")).toBe(false);
    expect(files.has("!Wiki/os/.config/_log.md")).toBe(false);
  });

  it("picks schema with latest mtime across domains", async () => {
    const domainJson = JSON.stringify([
      { id: "a", wiki_folder: "a" },
      { id: "b", wiki_folder: "b" },
    ]);
    const files = new Map([
      ["!Wiki/.config/_domain.json", domainJson],
      ["!Wiki/.config/_wiki_schema.md", "old schema"],
      ["!Wiki/.config/_format_schema.md", "old format"],
      ["!Wiki/a/.config/_wiki_schema.md", "schema from a"],
      ["!Wiki/b/.config/_wiki_schema.md", "schema from b"],
    ]);
    const mtimes = new Map([
      ["!Wiki/a/.config/_wiki_schema.md", 1000],
      ["!Wiki/b/.config/_wiki_schema.md", 2000],
    ]);
    await runStorageMigration(makeVault(files, mtimes));
    expect(files.get("!Wiki/_config/_wiki_schema.md")).toBe("schema from b");
  });

  it("falls back to old global schema when no per-domain copy exists", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "bundled schema"],
      ["!Wiki/.config/_format_schema.md", "bundled format"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.get("!Wiki/_config/_wiki_schema.md")).toBe("bundled schema");
  });

  it("merges _agent.jsonl lines to global path", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "s"],
      ["!Wiki/.config/_format_schema.md", "f"],
      ["!Wiki/os/.config/_agent.jsonl", '{"op":"ingest"}\n'],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.get("!Wiki/_config/_agent.jsonl")).toContain('"op":"ingest"');
  });

  it("throws StorageMigrationConflictError when both .config and _config exist", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/_config/_domain.json", DOMAIN_JSON],
    ]);
    await expect(runStorageMigration(makeVault(files))).rejects.toThrow(StorageMigrationConflictError);
  });

  it("removes old .config directories after migration", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "s"],
      ["!Wiki/.config/_format_schema.md", "f"],
      ["!Wiki/os/.config/_index.md", "idx"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.has("!Wiki/.config/_domain.json")).toBe(false);
    expect(files.has("!Wiki/os/.config/_index.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/storage-migration.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/storage-migration.ts`**

```typescript
import type { Vault } from "obsidian";
import {
  WIKI_ROOT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOMAIN_PATH,
  GLOBAL_WIKI_SCHEMA_PATH,
  GLOBAL_FORMAT_SCHEMA_PATH,
  GLOBAL_AGENT_LOG_PATH,
  GLOBAL_DEV_LOG_PATH,
} from "./wiki-path";

const OLD_GLOBAL_CONFIG = `${WIKI_ROOT}/.config`;
const OLD_DOMAIN_PATH = `${OLD_GLOBAL_CONFIG}/_domain.json`;

export class StorageMigrationConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "StorageMigrationConflictError";
  }
}

export async function runStorageMigration(vault: Vault): Promise<void> {
  const adapter = vault.adapter;

  if (!(await adapter.exists(OLD_GLOBAL_CONFIG))) return;

  if (await adapter.exists(GLOBAL_CONFIG_DIR)) {
    throw new StorageMigrationConflictError(
      `Both ${OLD_GLOBAL_CONFIG} and ${GLOBAL_CONFIG_DIR} exist — interrupted migration. Remove one manually.`
    );
  }

  await vault.createFolder(GLOBAL_CONFIG_DIR).catch(() => {});

  // Move domain registry
  if (await adapter.exists(OLD_DOMAIN_PATH)) {
    const content = await adapter.read(OLD_DOMAIN_PATH);
    await adapter.write(GLOBAL_DOMAIN_PATH, content);
  }

  // Load domain list
  let domains: Array<{ wiki_folder: string }> = [];
  if (await adapter.exists(GLOBAL_DOMAIN_PATH)) {
    try { domains = JSON.parse(await adapter.read(GLOBAL_DOMAIN_PATH)); } catch { /* ignore */ }
  }

  // Pick best schema from per-domain copies (latest mtime wins)
  await pickAndWriteSchema(adapter, domains, "_wiki_schema.md", GLOBAL_WIKI_SCHEMA_PATH);
  await pickAndWriteSchema(adapter, domains, "_format_schema.md", GLOBAL_FORMAT_SCHEMA_PATH);

  // Migrate per-domain files
  for (const domain of domains) {
    const oldConfig = `${WIKI_ROOT}/${domain.wiki_folder}/.config`;
    const newConfig = `${WIKI_ROOT}/${domain.wiki_folder}/_config`;
    if (!(await adapter.exists(oldConfig))) continue;

    await vault.createFolder(newConfig).catch(() => {});

    for (const file of ["_index.md", "_log.md"]) {
      const src = `${oldConfig}/${file}`;
      if (await adapter.exists(src)) {
        await adapter.write(`${newConfig}/${file}`, await adapter.read(src));
      }
    }

    for (const [file, globalPath] of [
      ["_agent.jsonl", GLOBAL_AGENT_LOG_PATH],
      ["_dev.jsonl", GLOBAL_DEV_LOG_PATH],
    ] as const) {
      const src = `${oldConfig}/${file}`;
      if (await adapter.exists(src)) {
        await adapter.append(globalPath, await adapter.read(src));
      }
    }

    await cleanDir(adapter, oldConfig, ["_index.md", "_log.md", "_agent.jsonl", "_dev.jsonl",
      "_wiki_schema.md", "_format_schema.md"]);
  }

  // Clean global old config
  await cleanDir(adapter, OLD_GLOBAL_CONFIG, ["_domain.json", "_wiki_schema.md",
    "_format_schema.md", "_agent.jsonl", "_dev.jsonl"]);
}

async function pickAndWriteSchema(
  adapter: Vault["adapter"],
  domains: Array<{ wiki_folder: string }>,
  filename: string,
  dest: string,
): Promise<void> {
  // Collect candidates from per-domain copies
  let bestContent: string | null = null;
  let bestMtime = -1;

  for (const domain of domains) {
    const p = `${WIKI_ROOT}/${domain.wiki_folder}/.config/${filename}`;
    if (!(await adapter.exists(p))) continue;
    const stat = await (adapter as any).stat?.(p);
    const mtime = (stat?.mtime as number | undefined) ?? 0;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      bestContent = await adapter.read(p);
    }
  }

  // Fall back to old global copy
  if (bestContent === null) {
    const globalOld = `${OLD_GLOBAL_CONFIG}/${filename}`;
    if (await adapter.exists(globalOld)) {
      bestContent = await adapter.read(globalOld);
    }
  }

  // Fall back to bundled template when no vault copy exists at all
  if (bestContent === null) {
    const bundled = `prompts/templates/${filename}`;
    if (await adapter.exists(bundled)) {
      bestContent = await adapter.read(bundled);
    }
  }

  if (bestContent !== null) {
    await adapter.write(dest, bestContent);
  }
}

async function cleanDir(
  adapter: Vault["adapter"],
  dir: string,
  knownFiles: string[],
): Promise<void> {
  for (const f of knownFiles) {
    const p = `${dir}/${f}`;
    if (await adapter.exists(p)) await adapter.remove(p);
  }
  // Remove dir itself if now empty (best-effort)
  try {
    const listing = await adapter.list(dir);
    if (listing.files.length === 0 && listing.folders.length === 0) {
      await adapter.rmdir?.(dir, false).catch?.(() => {});
    }
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/storage-migration.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage-migration.ts tests/storage-migration.test.ts
git commit -m "feat(storage-migration): auto-migrate .config/ to _config/ on startup"
```

---

### Task 6: Wire migration into `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add import and call in `onload`**

Add import near top of `src/main.ts`:

```typescript
import { runStorageMigration, StorageMigrationConflictError } from "./storage-migration";
import { GLOBAL_DOMAIN_PATH } from "./wiki-path";
```

In `onload`, add migration call as the first vault operation (before `migrateLegacyData`):

```typescript
async onload(): Promise<void> {
  this.domainStore = new DomainStore(this.app.vault);
  this.localConfigStore = new LocalConfigStore(this);

  try {
    await runStorageMigration(this.app.vault);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    new Notice(`AI Wiki: storage migration failed — ${msg}`, 0);
    console.error("[AI Wiki] storage migration error:", e);
  }

  await migrateLegacyData(this, this.domainStore, this.localConfigStore);
  // ... rest of onload unchanged
```

- [ ] **Step 2: Fix hardcoded path in `main.ts`**

Find and replace `"!Wiki/.config/_domain.json"` with `GLOBAL_DOMAIN_PATH` (~line 278, inside `migrateLegacyData`).

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all PASS. Fix any failures before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): call runStorageMigration on startup before other vault ops"
```

---

### Task 7: Update `view.ts` sidebar buttons

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Replace vault.adapter open calls with workspace.openLinkText**

In `src/view.ts`, find the sidebar button handlers that open `_log.md` and `_index.md`. Replace each direct `vault.adapter` path open with:

```typescript
// Before (example):
await this.app.vault.adapter.open(`${domainFolder}/_config/_log.md`);

// After:
await this.app.workspace.openLinkText("_log.md", domainFolder, false);
```

Apply the same replacement for `_index.md`.

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/view.test.ts
```

Expected: all PASS (or no view tests — verify no TypeScript errors via build).

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "refactor(view): sidebar buttons use workspace.openLinkText for correct tab behaviour"
```

---

### Task 8: Update docs

**Files:**
- Modify: `docs/prompt-architecture.md`
- Modify: `lat.md/domain.md`

- [ ] **Step 1: Update `docs/prompt-architecture.md`**

In the "Промты по фазам" Mermaid diagram, find the `vault` subgraph and update node labels:

```
// Before:
V_WIKI[".config/_wiki_schema.md"]
V_FMT[".config/_format_schema.md"]
V_IDX["_index.md"]

// After:
V_WIKI["!Wiki/_config/_wiki_schema.md (global)"]
V_FMT["!Wiki/_config/_format_schema.md (global)"]
V_IDX["<domain>/_config/_index.md"]
```

Update subgraph title from `vault runtime read` to `vault runtime read (global + per-domain)`.

In the operations table, update `init` row "Produces" column:
```
// Before: `DomainEntry`, `entity_types`, `_wiki_schema.md`, `_format_schema.md`
// After:  `DomainEntry`, `entity_types`, `!Wiki/_config/_wiki_schema.md`, `!Wiki/_config/_format_schema.md`
```

In the "Сравнительная таблица промтов", update both schema rows to show global path:
- `_wiki_schema.md`: path note → `!Wiki/_config/_wiki_schema.md` (shared by all domains)
- `_format_schema.md`: path note → `!Wiki/_config/_format_schema.md` (shared by all domains)

- [ ] **Step 2: Update `lat.md/domain.md`**

Find the "Wiki Folder Layout" section and replace the code block:

```markdown
```
!Wiki/
  _config/                       — global config (all domains)
    _domain.json                 — domain entries list
    _wiki_schema.md              — LLM wiki conventions (shared)
    _format_schema.md            — format conventions (shared)
    _agent.jsonl                 — global operation log
    _dev.jsonl                   — dev mode eval log
  <domain>/
    _config/                     — per-domain config
      _index.md                  — page annotations index
      _log.md                    — ingest/lint operation log
    <EntityType>/
      PageName.md                — wiki page
```
```

Update the DomainEntry section body: replace `!Wiki/.config/_domain.json` with `!Wiki/_config/_domain.json`.

- [ ] **Step 3: Run lat check**

```bash
lat check
```

Expected: PASS. Fix any broken refs before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/prompt-architecture.md lat.md/domain.md
git commit -m "docs: update paths to _config/ layout in prompt-architecture and lat.md"
```

---

### Task 9: Build and final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all PASS.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/main.js` updated.

- [ ] **Step 3: Verify no old `.config` paths remain in source**

```bash
grep -rn '\.config\b' src/ --include="*.ts" | grep -v "\.config\." | grep -v "node_modules"
```

Expected: zero matches (excluding file extensions like `.configDir` or property access chains that happen to end in `.config`).

- [ ] **Step 4: Commit build**

```bash
git add dist/
git commit -m "chore: build after storage layout migration"
```
