# Domain .config Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `_index.md` and `_log.md` from each domain root to `{domain}/.config/`, hiding them from Obsidian's file explorer, with auto-migration of existing files on first operation.

**Architecture:** Add three pure path helpers to `wiki-path.ts` as the single source of truth. Add `ensureDomainConfig()` in a new `src/domain-config.ts` that auto-migrates legacy files. Update all callers (wiki-index, wiki-log, ingest, lint, lint-chat, query) to use the new paths. Add "Open _log / _index" buttons in the sidebar view.

**Tech Stack:** TypeScript, Vitest, Obsidian API (`app.workspace.openLinkText`)

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `src/wiki-path.ts` | +3 path helpers, update `validateArticlePath` |
| Create | `src/domain-config.ts` | `ensureDomainConfig()` — mkdir + lazy migration |
| Modify | `src/wiki-log.ts` | `logPath: string` param → `domainFolder: string` |
| Modify | `src/wiki-index.ts` | use `domainIndexPath()` instead of hardcoded path |
| Modify | `src/phases/ingest.ts` | call `ensureDomainConfig`, use new path helpers |
| Modify | `src/phases/lint.ts` | call `ensureDomainConfig`, use new `appendWikiLog` sig |
| Modify | `src/phases/lint-chat.ts` | call `ensureDomainConfig` |
| Modify | `src/phases/query.ts` | call `ensureDomainConfig`, use `domainIndexPath` |
| Modify | `src/view.ts` | add `openLogBtn`/`openIndexBtn` buttons + `domains` field |
| Modify | `tests/wiki-path.test.ts` | add tests for new helpers, update `validateArticlePath` cases |
| Create | `tests/domain-config.test.ts` | `ensureDomainConfig` migration unit tests |
| Modify | `tests/wiki-log.test.ts` | update `appendWikiLog` call signature (LOG_PATH → domainFolder) |
| Modify | `tests/wiki-index.test.ts` | update path assertion (`_index.md` → `.config/_index.md`) |

---

### Task 1: Path helpers in `wiki-path.ts`

**Files:**
- Modify: `src/wiki-path.ts`
- Test: `tests/wiki-path.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/wiki-path.test.ts` after the existing `domainWikiFolder` describe block:

```ts
import {
  WIKI_ROOT,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
  validateArticlePath,
  domainConfigDir,
  domainIndexPath,
  domainLogPath,
} from "../src/wiki-path";

describe("domainConfigDir", () => {
  it("appends /.config to domain folder", () => {
    expect(domainConfigDir("!Wiki/ии")).toBe("!Wiki/ии/.config");
  });
});

describe("domainIndexPath", () => {
  it("returns .config/_index.md path", () => {
    expect(domainIndexPath("!Wiki/ии")).toBe("!Wiki/ии/.config/_index.md");
  });
});

describe("domainLogPath", () => {
  it("returns .config/_log.md path", () => {
    expect(domainLogPath("!Wiki/ии")).toBe("!Wiki/ии/.config/_log.md");
  });
});
```

Also replace the two existing `validateArticlePath` test cases for `_index.md` and `_log.md` (lines 70–75):

```ts
  it("valid: _index.md in .config exempt", () => {
    expect(validateArticlePath("!Wiki/os/.config/_index.md", wiki)).toBe(true);
  });
  it("valid: _log.md in .config exempt", () => {
    expect(validateArticlePath("!Wiki/os/.config/_log.md", wiki)).toBe(true);
  });
  it("invalid: _index.md at domain root no longer exempt", () => {
    expect(validateArticlePath("!Wiki/os/_index.md", wiki)).toBe(false);
  });
  it("invalid: _log.md at domain root no longer exempt", () => {
    expect(validateArticlePath("!Wiki/os/_log.md", wiki)).toBe(false);
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/wiki-path.test.ts
```

Expected: FAIL — `domainConfigDir is not a function`, and `validateArticlePath` cases fail.

- [ ] **Step 3: Add helpers and update `validateArticlePath`**

Append to `src/wiki-path.ts` (after the last export):

```ts
export function domainConfigDir(domainFolder: string): string {
  return `${domainFolder}/.config`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainFolder}/.config/_index.md`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainFolder}/.config/_log.md`;
}
```

Replace the two hardcoded lines in `validateArticlePath` (currently lines 23–24):

```ts
// Before:
    path === `${wikiVaultPath}/_index.md` ||
    path === `${wikiVaultPath}/_log.md` ||

// After:
    path === `${wikiVaultPath}/.config/_index.md` ||
    path === `${wikiVaultPath}/.config/_log.md` ||
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-path.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-path.ts tests/wiki-path.test.ts
git commit -m "feat: add domainConfigDir/domainIndexPath/domainLogPath helpers; update validateArticlePath"
```

---

### Task 2: `ensureDomainConfig` in new `src/domain-config.ts`

**Files:**
- Create: `src/domain-config.ts`
- Create: `tests/domain-config.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/domain-config.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ensureDomainConfig } from "../src/domain-config";
import type { VaultTools } from "../src/vault-tools";

function makeVt(opts: {
  existsMap?: Record<string, boolean>;
  readMap?: Record<string, string>;
} = {}): {
  vt: VaultTools;
  mkdirCalls: string[];
  writeCalls: Array<[string, string]>;
  removeCalls: string[];
} {
  const existsMap = opts.existsMap ?? {};
  const readMap = opts.readMap ?? {};
  const mkdirCalls: string[] = [];
  const writeCalls: Array<[string, string]> = [];
  const removeCalls: string[] = [];

  const vt = {
    exists: vi.fn(async (p: string) => existsMap[p] ?? false),
    mkdir: vi.fn(async (p: string) => { mkdirCalls.push(p); }),
    read: vi.fn(async (p: string) => {
      if (readMap[p] !== undefined) return readMap[p];
      throw new Error("not found");
    }),
    write: vi.fn(async (p: string, c: string) => { writeCalls.push([p, c]); }),
    remove: vi.fn(async (p: string) => { removeCalls.push(p); }),
  } as unknown as VaultTools;
  return { vt, mkdirCalls, writeCalls, removeCalls };
}

describe("ensureDomainConfig", () => {
  it("creates .config directory", async () => {
    const { vt, mkdirCalls } = makeVt();
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(mkdirCalls).toContain("!Wiki/ии/.config");
  });

  it("migrates _index.md when old exists and new does not", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_index.md": true,
        "!Wiki/ии/.config/_index.md": false,
      },
      readMap: { "!Wiki/ии/_index.md": "# Index content" },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toContainEqual(["!Wiki/ии/.config/_index.md", "# Index content"]);
    expect(removeCalls).toContain("!Wiki/ии/_index.md");
  });

  it("migrates _log.md when old exists and new does not", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_log.md": true,
        "!Wiki/ии/.config/_log.md": false,
      },
      readMap: { "!Wiki/ии/_log.md": "## log entry" },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toContainEqual(["!Wiki/ии/.config/_log.md", "## log entry"]);
    expect(removeCalls).toContain("!Wiki/ии/_log.md");
  });

  it("removes old file when new already exists (idempotent)", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_index.md": true,
        "!Wiki/ии/.config/_index.md": true,
      },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toHaveLength(0);
    expect(removeCalls).toContain("!Wiki/ии/_index.md");
  });

  it("does nothing when old files do not exist", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {},
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/domain-config.test.ts
```

Expected: FAIL — `Cannot find module '../src/domain-config'`.

- [ ] **Step 3: Create `src/domain-config.ts`**

```ts
import type { VaultTools } from "./vault-tools";
import { domainConfigDir, domainIndexPath, domainLogPath } from "./wiki-path";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  try { await vaultTools.mkdir(domainConfigDir(domainFolder)); } catch { /* already exists */ }
  await migrateLegacy(vaultTools, `${domainFolder}/_index.md`, domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, `${domainFolder}/_log.md`, domainLogPath(domainFolder));
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  if (!(await vaultTools.exists(oldPath))) return;
  if (await vaultTools.exists(newPath)) {
    await vaultTools.remove(newPath.replace("/.config/", "/").replace(".config/", ""));
    // oldPath removal only — new already exists
    await vaultTools.remove(oldPath);
    return;
  }
  const content = await vaultTools.read(oldPath);
  await vaultTools.write(newPath, content);
  await vaultTools.remove(oldPath);
}
```

```ts
import type { VaultTools } from "./vault-tools";
import { domainConfigDir, domainIndexPath, domainLogPath } from "./wiki-path";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  try { await vaultTools.mkdir(domainConfigDir(domainFolder)); } catch { /* already exists */ }
  await migrateLegacy(vaultTools, `${domainFolder}/_index.md`, domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, `${domainFolder}/_log.md`, domainLogPath(domainFolder));
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  if (!(await vaultTools.exists(oldPath))) return;
  if (!(await vaultTools.exists(newPath))) {
    const content = await vaultTools.read(oldPath);
    await vaultTools.write(newPath, content);
  }
  await vaultTools.remove(oldPath);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/domain-config.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain-config.ts tests/domain-config.test.ts
git commit -m "feat: add ensureDomainConfig — creates domain .config dir, migrates legacy index/log"
```

---

### Task 3: Update `wiki-log.ts` signature

**Files:**
- Modify: `src/wiki-log.ts`
- Modify: `tests/wiki-log.test.ts`

- [ ] **Step 1: Update test file first**

In `tests/wiki-log.test.ts`, replace:

```ts
const LOG_PATH = "!Wiki/work/_log.md";
```

with:

```ts
const DOMAIN_FOLDER = "!Wiki/work";
```

Then replace every call `appendWikiLog(vt, LOG_PATH, "work", {...})` with `appendWikiLog(vt, DOMAIN_FOLDER, "work", {...})`. There are 4 such calls (lines 23, 39, 49, 64, 81).

Also update the `makeVt` write mock to capture the path — verify it writes to `.config/_log.md`:

Add one assertion to the first test after `expect(written[0]).toContain("---");`:

```ts
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe("!Wiki/work/.config/_log.md");
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/wiki-log.test.ts
```

Expected: FAIL — argument type mismatch or path assertion fails.

- [ ] **Step 3: Update `src/wiki-log.ts`**

Add import at top:

```ts
import { domainLogPath } from "./wiki-path";
```

Change `appendWikiLog` signature and body — replace the second parameter name and add path derivation:

```ts
export async function appendWikiLog(
  vaultTools: VaultTools,
  domainFolder: string,
  domainId: string,
  event: LogOperation,
): Promise<void> {
  const logPath = domainLogPath(domainFolder);
  let existing = "";
  try { existing = await vaultTools.read(logPath); } catch { /* new file */ }
  await vaultTools.write(logPath, existing + buildEntry(domainId, event));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-log.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-log.ts tests/wiki-log.test.ts
git commit -m "refactor(wiki-log): replace logPath param with domainFolder; path derived internally"
```

---

### Task 4: Update `wiki-index.ts` to use `domainIndexPath`

**Files:**
- Modify: `src/wiki-index.ts`
- Modify: `tests/wiki-index.test.ts`

- [ ] **Step 1: Update the path assertion in tests**

In `tests/wiki-index.test.ts`, find the test "writes to correct path" (around line 91–95). Change the assertion:

```ts
// Before:
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/_index.md");

// After:
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/.config/_index.md");
```

- [ ] **Step 2: Run tests to confirm the assertion now fails**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: FAIL on "writes to correct path".

- [ ] **Step 3: Update `src/wiki-index.ts`**

Add import at the top of `src/wiki-index.ts`:

```ts
import { domainIndexPath } from "./wiki-path";
```

Replace line 63:

```ts
// Before:
  const indexPath = `${wikiFolder}/_index.md`;

// After:
  const indexPath = domainIndexPath(wikiFolder);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(wiki-index): use domainIndexPath — index written to domain .config folder"
```

---

### Task 5: Update `phases/ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Run existing ingest tests to establish baseline**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all PASS (baseline).

- [ ] **Step 2: Update imports**

In `src/phases/ingest.ts`, add to the existing imports from `"../wiki-path"`:

```ts
import { domainWikiFolder, validateArticlePath, domainIndexPath } from "../wiki-path";
```

Add a new import line:

```ts
import { ensureDomainConfig } from "../domain-config";
```

- [ ] **Step 3: Call `ensureDomainConfig` and update index read**

Find the block starting at line 70 (`const domainRoot = wikiVaultPath;`). Add `ensureDomainConfig` call and update `tryRead`:

```ts
  const domainRoot = wikiVaultPath;
  const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

  await ensureDomainConfig(vaultTools, domainRoot);

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`),
    tryRead(vaultTools, domainIndexPath(domainRoot)),
  ]);
```

- [ ] **Step 4: Update `appendWikiLog` call**

Find line ~185:

```ts
// Before:
      await appendWikiLog(vaultTools, `${domainRoot}/_log.md`, domain.id, {

// After:
      await appendWikiLog(vaultTools, domainRoot, domain.id, {
```

- [ ] **Step 5: Run ingest tests to confirm they still pass**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all PASS. (The mock adapter's `exists` defaults to `true` and `mkdir` is a no-op, so `ensureDomainConfig` is transparent in tests.)

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "feat(ingest): call ensureDomainConfig, read _index from .config, write _log via domainFolder"
```

---

### Task 6: Update `phases/lint.ts`

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Run existing lint tests to establish baseline**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Update imports**

In `src/phases/lint.ts`, add `ensureDomainConfig` import:

```ts
import { ensureDomainConfig } from "../domain-config";
```

- [ ] **Step 3: Call `ensureDomainConfig` per domain**

Find the loop `for (const domain of targets)`. Add `ensureDomainConfig` call at the top of the loop body, just after `wikiVaultPath` is resolved. Search for where `wikiVaultPath` is first used — add the call right after its definition:

```ts
  // (inside the for loop, after wikiVaultPath is computed)
  await ensureDomainConfig(vaultTools, wikiVaultPath);
```

- [ ] **Step 4: Update `appendWikiLog` call**

Find line ~165:

```ts
// Before:
      await appendWikiLog(vaultTools, `${wikiVaultPath}/_log.md`, domain.id, {

// After:
      await appendWikiLog(vaultTools, wikiVaultPath, domain.id, {
```

- [ ] **Step 5: Run lint tests**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): call ensureDomainConfig per domain, write _log via domainFolder"
```

---

### Task 7: Update `phases/query.ts`

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Run existing query tests to establish baseline**

```bash
npx vitest run tests/phases/query.test.ts tests/phases/query-thinking.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Update imports**

In `src/phases/query.ts`, extend the import from `"../wiki-path"`:

```ts
import { domainWikiFolder, domainIndexPath } from "../wiki-path";
```

Add:

```ts
import { ensureDomainConfig } from "../domain-config";
```

- [ ] **Step 3: Call `ensureDomainConfig` and update index read**

Find where `wikiVaultPath` is resolved and then `tryRead` is called. Add:

```ts
  await ensureDomainConfig(vaultTools, wikiVaultPath);
```

Replace:

```ts
// Before:
    tryRead(vaultTools, `${wikiVaultPath}/_index.md`),

// After:
    tryRead(vaultTools, domainIndexPath(wikiVaultPath)),
```

- [ ] **Step 4: Run query tests**

```bash
npx vitest run tests/phases/query.test.ts tests/phases/query-thinking.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts
git commit -m "feat(query): call ensureDomainConfig, read _index from .config"
```

---

### Task 8: Update `phases/lint-chat.ts`

**Files:**
- Modify: `src/phases/lint-chat.ts`

- [ ] **Step 1: Run existing lint-chat tests to establish baseline**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Add `ensureDomainConfig` call**

In `src/phases/lint-chat.ts`, add import:

```ts
import { ensureDomainConfig } from "../domain-config";
```

Add call after `wikiVaultPath` is computed (line 33):

```ts
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);

  await ensureDomainConfig(vaultTools, wikiVaultPath);
```

- [ ] **Step 3: Run lint-chat tests**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint-chat.ts
git commit -m "feat(lint-chat): call ensureDomainConfig to ensure .config exists and migration runs"
```

---

### Task 9: Add "Open _log / _index" buttons in `view.ts`

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Add private fields**

In `src/view.ts`, after the existing `private addSourceBtn?: HTMLButtonElement;` (line 53), add:

```ts
  private openLogBtn?: HTMLButtonElement;
  private openIndexBtn?: HTMLButtonElement;
  private domains: DomainEntry[] = [];
```

- [ ] **Step 2: Add imports**

At the top of `src/view.ts`, extend the import from `"./wiki-path"`:

```ts
import { domainWikiFolder, domainLogPath, domainIndexPath } from "./wiki-path";
```

- [ ] **Step 3: Add buttons in `buildDomainRow`**

Inside `buildDomainRow`, within `if (opts.withActions)`, after the `reinitBtn` block (after line 219), add:

```ts
      this.openLogBtn = domainRow.createEl("button", { attr: { title: "Open _log.md" } });
      setIcon(this.openLogBtn, "scroll-text");
      this.openLogBtn.disabled = true;
      this.openLogBtn.addEventListener("click", () => {
        const domainId = this.domainSelect!.value;
        const domain = this.domains.find((d) => d.id === domainId);
        if (!domain) return;
        void this.app.workspace.openLinkText(domainLogPath(domainWikiFolder(domain.wiki_folder)), "", false);
      });

      this.openIndexBtn = domainRow.createEl("button", { attr: { title: "Open _index.md" } });
      setIcon(this.openIndexBtn, "list");
      this.openIndexBtn.disabled = true;
      this.openIndexBtn.addEventListener("click", () => {
        const domainId = this.domainSelect!.value;
        const domain = this.domains.find((d) => d.id === domainId);
        if (!domain) return;
        void this.app.workspace.openLinkText(domainIndexPath(domainWikiFolder(domain.wiki_folder)), "", false);
      });
```

- [ ] **Step 4: Update `domainSelect.addEventListener("change")`**

In the existing change handler (around line 220), add:

```ts
      this.domainSelect.addEventListener("change", () => {
        if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect!.value;
        if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect!.value;
        if (this.openLogBtn) this.openLogBtn.disabled = !this.domainSelect!.value;
        if (this.openIndexBtn) this.openIndexBtn.disabled = !this.domainSelect!.value;
      });
```

- [ ] **Step 5: Update `refreshDomains` to store domains and update buttons**

In `refreshDomains()`, after setting `domains` from `loadDomains()`, store them:

```ts
  private async refreshDomains(): Promise<void> {
    if (!this.domainSelect) return;
    let domains: DomainEntry[];
    try { domains = await this.plugin.controller.loadDomains(); } catch { return; }
    this.domains = domains;          // ← add this line
    // ... rest of existing code ...
    if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect.value;
    if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect.value;
    if (this.openLogBtn) this.openLogBtn.disabled = !this.domainSelect.value;    // ← add
    if (this.openIndexBtn) this.openIndexBtn.disabled = !this.domainSelect.value; // ← add
  }
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Expected: exits 0, `main.js` updated.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add Open _log / Open _index buttons to domain row"
```

---

### Task 10: Full test suite + version bump

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all PASS, no failures.

- [ ] **Step 2: Bump patch version**

Read current version from `package.json`. Increment patch. Write to both `package.json` and `src/manifest.json`.

Example — if current is `0.1.120`, set to `0.1.121` in both files.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Final commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump version"
```
