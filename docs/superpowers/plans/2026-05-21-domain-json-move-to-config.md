# Move _domain.json to !Wiki/.config/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `_domain.json` from `!Wiki/_domain.json` to `!Wiki/.config/_domain.json` to consolidate config files under `.config/`.

**Architecture:** Path constants in `domain-store.ts` change; `save()` gains a second `createFolder` guard for `!Wiki/.config`; one hardcoded path in `main.ts` updates. Tests update to match new paths and new `calls` sequence.

**Tech Stack:** TypeScript, Vitest, Obsidian Vault API

---

### Task 1: Update domain-store.test.ts — make save tests fail

**Files:**
- Modify: `tests/domain-store.test.ts:85-141`

- [ ] **Step 1: Update "creates !Wiki dir if missing" test**

Replace lines 101–115 of `tests/domain-store.test.ts`:

```typescript
      expect(adapter.write).toHaveBeenCalledWith(
        "!Wiki/.config/_domain.json.tmp",
        JSON.stringify([sampleDomain], null, 2),
      );
      expect(adapter.rename).toHaveBeenCalledWith(
        "!Wiki/.config/_domain.json.tmp",
        "!Wiki/.config/_domain.json",
      );
      expect(calls).toEqual([
        "exists:!Wiki",
        "createFolder:!Wiki",
        "exists:!Wiki/.config",
        "createFolder:!Wiki/.config",
        "write:!Wiki/.config/_domain.json.tmp",
        "exists:!Wiki/.config/_domain.json",
        "rename:!Wiki/.config/_domain.json.tmp->!Wiki/.config/_domain.json",
      ]);
```

- [ ] **Step 2: Update "removes existing target before rename" test**

Replace lines 133–139 of `tests/domain-store.test.ts`:

```typescript
      expect(vault.createFolder).not.toHaveBeenCalled();
      expect(calls).toEqual([
        "exists:!Wiki",
        "exists:!Wiki/.config",
        "write:!Wiki/.config/_domain.json.tmp",
        "exists:!Wiki/.config/_domain.json",
        "remove:!Wiki/.config/_domain.json",
        "rename:!Wiki/.config/_domain.json.tmp->!Wiki/.config/_domain.json",
      ]);
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `npx vitest run tests/domain-store.test.ts`

Expected: 2 failures in `save` describe block; `load` tests still pass.

---

### Task 2: Update src/domain-store.ts — make domain-store tests pass

**Files:**
- Modify: `src/domain-store.ts:5-44`

- [ ] **Step 1: Update constants and save()**

Replace lines 5–7 of `src/domain-store.ts`:

```typescript
const FILE_PATH = "!Wiki/.config/_domain.json";
const TMP_PATH = `${FILE_PATH}.tmp`;
const WIKI_DIR = "!Wiki";
const CONFIG_DIR = "!Wiki/.config";
```

Replace the `save()` method body (lines 38–45):

```typescript
  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_DIR))) await this.vault.createFolder(WIKI_DIR).catch(() => {});
    if (!(await adapter.exists(CONFIG_DIR))) await this.vault.createFolder(CONFIG_DIR).catch(() => {});
    const body = JSON.stringify(domains, null, 2);
    await adapter.write(TMP_PATH, body);
    if (await adapter.exists(FILE_PATH)) await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
```

- [ ] **Step 2: Run domain-store tests — verify pass**

Run: `npx vitest run tests/domain-store.test.ts`

Expected: all 7 tests pass.

---

### Task 3: Update tests/main-migration.test.ts

**Files:**
- Modify: `tests/main-migration.test.ts:42-64`

- [ ] **Step 1: Update path assertions in two tests**

Line 42 — change:
```typescript
    expect(vaultFiles.has("!Wiki/_domain.json")).toBe(true);
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual([sampleDomain]);
```
To:
```typescript
    expect(vaultFiles.has("!Wiki/.config/_domain.json")).toBe(true);
    expect(JSON.parse(vaultFiles.get("!Wiki/.config/_domain.json")!)).toEqual([sampleDomain]);
```

Lines 49–50 — change:
```typescript
    const vaultFiles = new Map<string, string>([
      ["!Wiki/_domain.json", JSON.stringify(existing)],
    ]);
```
To:
```typescript
    const vaultFiles = new Map<string, string>([
      ["!Wiki/.config/_domain.json", JSON.stringify(existing)],
    ]);
```

Line 53 — change:
```typescript
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p) || p === "!Wiki"),
```
To:
```typescript
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p) || p === "!Wiki" || p === "!Wiki/.config"),
```

Line 64 — change:
```typescript
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual(existing);
```
To:
```typescript
    expect(JSON.parse(vaultFiles.get("!Wiki/.config/_domain.json")!)).toEqual(existing);
```

- [ ] **Step 2: Run main-migration tests — verify pass**

Run: `npx vitest run tests/main-migration.test.ts`

Expected: all tests pass.

---

### Task 4: Update src/main.ts hardcoded path

**Files:**
- Modify: `src/main.ts:284`

- [ ] **Step 1: Change hardcoded path**

Line 284 — change:
```typescript
      const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/_domain.json");
```
To:
```typescript
      const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/.config/_domain.json");
```

- [ ] **Step 2: Run full test suite — verify all pass**

Run: `npx vitest run`

Expected: all tests pass, no regressions.

---

### Task 5: Commit

- [ ] **Step 1: Bump patch version**

Read `package.json`, increment patch in `package.json` and `src/manifest.json`.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: no build errors.

- [ ] **Step 3: Commit**

```bash
git add src/domain-store.ts src/main.ts tests/domain-store.test.ts tests/main-migration.test.ts package.json src/manifest.json main.js
git commit -m "feat: move _domain.json to !Wiki/.config/_domain.json"
```
