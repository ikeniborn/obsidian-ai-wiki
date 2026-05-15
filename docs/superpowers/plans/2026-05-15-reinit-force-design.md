---
title: Re-init force — wipe + rebuild Implementation Plan
date: 2026-05-15
status: draft
review:
  plan_hash: f36c415e0a49593d
  spec_hash: e4c0ed2b775c3372
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Task 4: Controller `init()` accepts `force` parameter"
      section_hash: afc85608526ff46e
      text: "Plan расширял условие `onFileError`: `(sourcePaths?.length || force)` вместо спецификационного `sourcePaths?.length`. Возвращено к спецификации."
      verdict: fixed
      verdict_at: 2026-05-15
---

# Re-init force — wipe + rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить кнопку re-init в полную переинициализацию домена: wipe wiki-папки + сброс entity_types/analyzed_sources/language_notes + повторный bootstrap+delta+ingest для всех source_paths. Иконка меняется на Lucide `recycle`.

**Architecture:** Фаза `init` получает флаг `--force`: новая ветка `runInitWithForce` сначала удаляет файлы внутри `domainWikiFolder(wiki_folder)`, шлёт `domain_updated` со сброшенными полями, затем делегирует в `runInitWithSources(force=true)`. При `force=true` `runInitWithSources` обходит гард «already initialised», игнорирует `analyzed_sources` (isResuming=false) и стартует bootstrap независимо от существующего домена. Controller прокидывает `force` через CLI args. View переиспользует `controller.init()` с новым параметром, удаляет ветку no-sources (заменяет Notice'ом), меняет глиф `⟳` на `setIcon("recycle")`.

**Tech Stack:** TypeScript, Obsidian API (`setIcon`, `Notice`, `TFile`), vitest, esbuild.

---

## File Structure

- **Modify** `src/phases/init.ts` — добавляется `wipeDomainFolder`, разбор `--force`, валидация (dry-run+force, domain not found, no sources), force-ветка в `runInit`, параметр `force` в `runInitWithSources`, override `isResuming/analyzed_sources/entity_types`, пропуск гарда `already initialised`.
- **Modify** `src/controller.ts` — параметр `force?: boolean` в `init()`, передача `--force` в `args`.
- **Modify** `src/view.ts` — fix `entry.source_paths` (snake_case), удаление ветки `reinitConfirmBodyNoSources`, Notice при пустых source_paths, `setIcon(this.reinitBtn, "recycle")`, `force=true` в вызове `controller.init`.
- **Modify** `src/i18n.ts` — обновление `reinitTitle`, `reinitConfirmBody`, добавление `reinitNoSources`, удаление `reinitConfirmBodyNoSources` (en/ru/es).
- **Create** `tests/phases/init.force.test.ts` — unit-тесты для force-ветки.

---

## Task 1: Add `wipeDomainFolder` helper

**Files:**
- Modify: `src/phases/init.ts` (add helper near `appendLog`)
- Test: `tests/phases/init.force.test.ts` (new file)

- [ ] **Step 1: Create failing test for wipeDomainFolder**

Create `tests/phases/init.force.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import { wipeDomainFolder } from "../../src/phases/init";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("wipeDomainFolder", () => {
  it("removes every file under !Wiki/<folder>/ and returns them", async () => {
    const files = [
      "!Wiki/ai/_index.md",
      "!Wiki/ai/concepts/foo.md",
      "!Wiki/ai/concepts/bar.md",
    ];
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (p: string) => {
        if (p === "!Wiki/ai") return { files: ["!Wiki/ai/_index.md"], folders: ["!Wiki/ai/concepts"] };
        if (p === "!Wiki/ai/concepts") return { files: ["!Wiki/ai/concepts/foo.md", "!Wiki/ai/concepts/bar.md"], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, "");
    const removed = await wipeDomainFolder(vt, "ai");
    expect(removed.sort()).toEqual(files.sort());
    for (const f of files) expect(adapter.remove).toHaveBeenCalledWith(f);
  });

  it("does not touch files outside !Wiki/<folder>/", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "");
    await wipeDomainFolder(vt, "ai");
    expect(adapter.remove).not.toHaveBeenCalledWith("!Wiki/_wiki_schema.md");
    expect(adapter.remove).not.toHaveBeenCalledWith("!Wiki/_log.md");
  });

  it("skips files that fail to remove and continues", async () => {
    let calls = 0;
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/ai/a.md", "!Wiki/ai/b.md"], folders: [] }),
      remove: vi.fn().mockImplementation(async (p: string) => {
        calls++;
        if (p === "!Wiki/ai/a.md") throw new Error("locked");
      }),
    });
    const vt = new VaultTools(adapter, "");
    const removed = await wipeDomainFolder(vt, "ai");
    expect(calls).toBe(2);
    expect(removed.sort()).toEqual(["!Wiki/ai/a.md", "!Wiki/ai/b.md"].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: FAIL — `wipeDomainFolder` is not exported.

- [ ] **Step 3: Implement `wipeDomainFolder` in `src/phases/init.ts`**

Add near `appendLog`:

```ts
export async function wipeDomainFolder(vaultTools: VaultTools, wikiFolder: string): Promise<string[]> {
  const root = domainWikiFolder(wikiFolder);
  const files = await vaultTools.listFiles(root);
  for (const f of files) {
    try { await vaultTools.remove(f); } catch { /* skip locked */ }
  }
  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.force.test.ts
git commit -m "feat(init): add wipeDomainFolder helper for force re-init"
```

---

## Task 2: Add `force` param to `runInitWithSources` with override semantics

**Files:**
- Modify: `src/phases/init.ts:170-452` (signature + body of `runInitWithSources`)
- Test: `tests/phases/init.force.test.ts`

- [ ] **Step 1: Add failing test for force overrides**

Append to `tests/phases/init.force.test.ts`:

```ts
import { runInitWithSources, runInit } from "../../src/phases/init";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

function makeMultiLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: { completions: { create: vi.fn().mockImplementation(() => {
      const json = responses[i] ?? responses[responses.length - 1];
      i++;
      return Promise.resolve({ [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: json } }] };
      }});
    })}},
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function adapterWithSourceFiles(files: string[]): VaultAdapter {
  return mockAdapter({
    list: vi.fn().mockImplementation(async (p: string) => {
      if (p === "docs") return { files, folders: [] };
      return { files: [], folders: [] };
    }),
    read: vi.fn().mockResolvedValue("content"),
  });
}

describe("runInitWithSources force", () => {
  it("force=true ignores analyzed_sources and re-bootstraps from first file", async () => {
    const files = ["docs/a.md", "docs/b.md"];
    const adapter = adapterWithSourceFiles(files);
    const vt = new VaultTools(adapter, "");
    const existing: DomainEntry = {
      id: "ai", name: "AI", wiki_folder: "ai",
      source_paths: ["docs"],
      analyzed_sources: ["docs/a.md", "docs/b.md"],
      entity_types: [{ type: "stale", description: "old", examples: [] }],
      language_notes: "old notes",
    };
    const llm = makeMultiLlm([
      JSON.stringify({ id: "ai", name: "AI", wiki_folder: "ai", entity_types: [{ type: "concept", description: "c", examples: [] }], language_notes: "fresh" }),
      JSON.stringify({ entity_types: [{ type: "concept2", description: "c2", examples: [] }], language_notes: "fresh" }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInitWithSources("ai", ["docs"], false, vt, llm, "x", [existing], "vault", signal, {}, undefined, true));
    const initStart = events.find((e) => e.kind === "init_start");
    expect(initStart).toEqual({ kind: "init_start", totalFiles: 2 });
    const firstUpdate = events.find((e) => e.kind === "domain_updated") as { patch: Record<string, unknown> } | undefined;
    expect(firstUpdate?.patch.analyzed_sources).toEqual([]);
  });

  it("force=true without existing domain falls through to bootstrap path", async () => {
    const files = ["docs/a.md"];
    const adapter = adapterWithSourceFiles(files);
    const vt = new VaultTools(adapter, "");
    const llm = makeMultiLlm([
      JSON.stringify({ id: "new", name: "New", wiki_folder: "new", entity_types: [], language_notes: "" }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInitWithSources("new", ["docs"], false, vt, llm, "x", [], "vault", signal, {}, undefined, true));
    const created = events.find((e) => e.kind === "domain_created");
    expect(created).toBeDefined();
  });
});
```

(Note: tests pass `true` as the trailing `force` arg — that param is added in this step.)

- [ ] **Step 2: Run tests, expect failure (signature mismatch)**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: FAIL — `runInitWithSources` takes 11 args, test passes 12.

- [ ] **Step 3: Add `force` param and override logic**

In `src/phases/init.ts`:

- Export `runInitWithSources` (add `export`).
- Append `force: boolean = false` parameter at the end of the signature.
- Replace the `isResuming` block:

```ts
const existing = domains.find((d) => d.id === domainId);
const isResuming = !force && existing?.analyzed_sources !== undefined;
const alreadyAnalyzed = new Set(force ? [] : (existing?.analyzed_sources ?? []));
const toAnalyze = isResuming
  ? sourceFiles.filter((f) => !alreadyAnalyzed.has(f))
  : sourceFiles;
```

- In the bootstrap-branch `currentDomain = { ... }` keep `analyzed_sources: []` (already correct).
- Where bootstrap emits `domain_updated`, ensure the patch includes the reset fields when `force=true`:

```ts
if (existing) {
  yield {
    kind: "domain_updated", domainId,
    patch: {
      entity_types: currentDomain.entity_types,
      language_notes: currentDomain.language_notes,
      wiki_folder: currentDomain.wiki_folder,
      analyzed_sources: [],
    },
  };
}
```

(No code change needed if it already matches — verify.)

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.force.test.ts
git commit -m "feat(init): add force param to runInitWithSources to override resume"
```

---

## Task 3: Add `--force` parsing + validation + wipe orchestration in `runInit`

**Files:**
- Modify: `src/phases/init.ts:20-168` (runInit dispatch logic)
- Test: `tests/phases/init.force.test.ts`

- [ ] **Step 1: Add failing tests for --force dispatch**

Append to `tests/phases/init.force.test.ts`:

```ts
describe("runInit --force dispatch", () => {
  function mkArgs(...a: string[]) { return a; }

  it("--force without existing domain → error 'force: domain not found'", async () => {
    const vt = new VaultTools(mockAdapter(), "");
    const llm = makeMultiLlm(["{}"]);
    const signal = new AbortController().signal;
    const events = await collect(runInit(mkArgs("ghost", "--force"), vt, llm, "x", [], "vault", signal));
    expect(events.some((e) => e.kind === "error" && /force: domain not found/.test(e.message))).toBe(true);
  });

  it("--force + --dry-run → error 'force: dry-run not supported'", async () => {
    const existing: DomainEntry = { id: "ai", name: "AI", wiki_folder: "ai", source_paths: ["docs"] };
    const vt = new VaultTools(mockAdapter(), "");
    const llm = makeMultiLlm(["{}"]);
    const signal = new AbortController().signal;
    const events = await collect(runInit(mkArgs("ai", "--force", "--dry-run"), vt, llm, "x", [existing], "vault", signal));
    expect(events.some((e) => e.kind === "error" && /force: dry-run not supported/.test(e.message))).toBe(true);
  });

  it("--force without --sources, source_paths empty → error 'force: no sources'", async () => {
    const existing: DomainEntry = { id: "ai", name: "AI", wiki_folder: "ai", source_paths: [] };
    const vt = new VaultTools(mockAdapter(), "");
    const llm = makeMultiLlm(["{}"]);
    const signal = new AbortController().signal;
    const events = await collect(runInit(mkArgs("ai", "--force"), vt, llm, "x", [existing], "vault", signal));
    expect(events.some((e) => e.kind === "error" && /force: no sources to re-analyze/.test(e.message))).toBe(true);
  });

  it("--force calls wipe and resets entity_types/analyzed_sources/language_notes in first domain_updated", async () => {
    const files = ["docs/a.md", "!Wiki/ai/old.md"];
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (p: string) => {
        if (p === "docs") return { files: ["docs/a.md"], folders: [] };
        if (p === "!Wiki/ai") return { files: ["!Wiki/ai/old.md"], folders: [] };
        return { files: [], folders: [] };
      }),
      read: vi.fn().mockResolvedValue("body"),
    });
    const vt = new VaultTools(adapter, "");
    const existing: DomainEntry = {
      id: "ai", name: "AI", wiki_folder: "ai",
      source_paths: ["docs"],
      analyzed_sources: ["docs/a.md"],
      entity_types: [{ type: "stale", description: "x", examples: [] }],
      language_notes: "stale",
    };
    const llm = makeMultiLlm([
      JSON.stringify({ id: "ai", name: "AI", wiki_folder: "ai", entity_types: [{ type: "fresh", description: "f", examples: [] }], language_notes: "fresh" }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInit(["ai", "--force"], vt, llm, "x", [existing], "vault", signal));
    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/ai/old.md");
    const resetEvent = events.find((e) => e.kind === "domain_updated"
      && (e as { patch: { entity_types?: unknown[] } }).patch.entity_types?.length === 0
      && (e as { patch: { analyzed_sources?: unknown[] } }).patch.analyzed_sources?.length === 0,
    );
    expect(resetEvent).toBeDefined();
  });

  it("--force with explicit --sources uses passed paths, not entry.source_paths", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (p: string) => {
        if (p === "alt") return { files: ["alt/x.md"], folders: [] };
        return { files: [], folders: [] };
      }),
      read: vi.fn().mockResolvedValue("body"),
    });
    const vt = new VaultTools(adapter, "");
    const existing: DomainEntry = {
      id: "ai", name: "AI", wiki_folder: "ai", source_paths: ["docs"],
    };
    const llm = makeMultiLlm([
      JSON.stringify({ id: "ai", name: "AI", wiki_folder: "ai", entity_types: [], language_notes: "" }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInit(["ai", "--force", "--sources", "alt"], vt, llm, "x", [existing], "vault", signal));
    expect(events.some((e) => e.kind === "init_start" && (e as { totalFiles: number }).totalFiles === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: FAIL — `--force` is not parsed; domain-not-found / dry-run / no-sources errors are missing; wipe is never called.

- [ ] **Step 3: Implement --force handling in `runInit`**

Replace the top of `runInit` in `src/phases/init.ts` (after `const sourcePaths = …` line):

```ts
const force = args.includes("--force");

if (!domainId) {
  yield { kind: "error", message: "init: domain id required" };
  return;
}

const existing = domains.find((d) => d.id === domainId);

if (force) {
  if (!existing) {
    yield { kind: "error", message: `force: domain "${domainId}" not found` };
    return;
  }
  if (dryRun) {
    yield { kind: "error", message: "force: dry-run not supported" };
    return;
  }
  const effectiveSources = sourcePaths.length ? sourcePaths : (existing.source_paths ?? []);
  if (!effectiveSources.length) {
    yield { kind: "error", message: "force: no sources to re-analyze" };
    return;
  }

  yield { kind: "assistant_text", delta: `Re-init: wiping ${domainWikiFolder(existing.wiki_folder)}...\n` };
  yield { kind: "tool_use", name: "WipeDomain", input: { folder: existing.wiki_folder } };
  const wiped = await wipeDomainFolder(vaultTools, existing.wiki_folder);
  yield { kind: "tool_result", ok: true };
  yield { kind: "assistant_text", delta: `removed ${wiped.length} files\n` };

  yield {
    kind: "domain_updated", domainId,
    patch: { entity_types: [], analyzed_sources: [], language_notes: "" },
  };

  if (signal.aborted) return;

  yield* runInitWithSources(
    domainId, effectiveSources, false, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, true,
  );
  return;
}

if (sourcePaths.length) {
  yield* runInitWithSources(
    domainId, sourcePaths, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError,
  );
  return;
}

if (existing?.entity_types?.length) {
  yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
  return;
}
```

Important: the test for "first domain_updated reset" expects the `domains` array passed into `runInitWithSources` to still contain the old domain object. Because we pass `[existing]` (the original) but the in-memory state was reset by the prior `domain_updated`, controller's `applyDomainEvent` updates the persisted store — but inside the generator, `domains.find((d) => d.id === domainId)` still returns the original `existing`. To make `runInitWithSources` see the reset state at the start of bootstrap, mutate before the call:

```ts
existing.entity_types = [];
existing.analyzed_sources = [];
existing.language_notes = "";
```

Place these three assignments immediately before the `yield* runInitWithSources(...)` call.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/phases/init.force.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Verify existing init tests still pass**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/phases/init.ts tests/phases/init.force.test.ts
git commit -m "feat(init): wire --force flag — wipe + reset + re-bootstrap"
```

---

## Task 4: Controller `init()` accepts `force` parameter

**Files:**
- Modify: `src/controller.ts:308-319`

- [ ] **Step 1: Update `WikiController.init` signature and body**

Replace lines 308–319 of `src/controller.ts`:

```ts
async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean): Promise<void> {
  const args: string[] = [domain];
  if (dryRun) args.push("--dry-run");
  if (force) args.push("--force");
  if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
  const onFileError: OnFileError | undefined = sourcePaths?.length
    ? (file, err, canRetry) => {
        const modal = new FileErrorModal(this.app, file, err, canRetry);
        modal.open();
        return modal.result;
      }
    : undefined;
  await this.dispatch("init", args, undefined, undefined, undefined, onFileError);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): pass force flag to init phase"
```

---

## Task 5: View — fix snake_case, drop no-sources branch, recycle icon

**Files:**
- Modify: `src/view.ts:123-128` (icon)
- Modify: `src/view.ts:279-317` (runReinit)

- [ ] **Step 1: Replace `text: "⟳"` with Lucide `recycle`**

Edit `src/view.ts` lines 121–128. Replace:

```ts
this.reinitBtn = domainRow.createEl("button", {
  text: "⟳",
  attr: { title: T.view.reinitTitle },
});
this.reinitBtn.disabled = true;
this.reinitBtn.addEventListener("click", () => void this.runReinit());
```

with:

```ts
this.reinitBtn = domainRow.createEl("button", {
  attr: { title: T.view.reinitTitle },
});
setIcon(this.reinitBtn, "recycle");
this.reinitBtn.disabled = true;
this.reinitBtn.addEventListener("click", () => void this.runReinit());
```

Ensure `setIcon` is imported. Check the existing import line at the top of `src/view.ts` — if `setIcon` is missing, extend the obsidian import:

```ts
import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
```

(Adjust to match the file's current import list — do not duplicate existing identifiers.)

- [ ] **Step 2: Rewrite `runReinit`**

Replace lines 279–317 of `src/view.ts` with:

```ts
private async runReinit(): Promise<void> {
  if (!this.domainSelect) return;
  const domainId = this.domainSelect.value;
  if (!domainId) return;

  let entry: DomainEntry | undefined;
  try {
    const domains = await this.plugin.controller.loadDomains();
    entry = domains.find((d) => d.id === domainId);
  } catch {
    return;
  }
  if (!entry) return;

  const sourcePaths = entry.source_paths ?? [];
  if (sourcePaths.length === 0) {
    new Notice(i18n().view.reinitNoSources);
    return;
  }

  const T = i18n().modal;
  const mdFiles = this.app.vault.getFiles().filter(
    (f) => f.extension === "md" && sourcePaths.some((p) => f.path.startsWith(p)),
  );
  const body = T.reinitConfirmBody(entry.id, mdFiles.length, sourcePaths.length);

  new ConfirmModal(
    this.app,
    T.reinitConfirmTitle,
    [body],
    () => void this.plugin.controller.init(entry!.id, false, sourcePaths, true),
  ).open();
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors will point to missing `reinitNoSources` and unused `reinitConfirmBodyNoSources` — they get resolved in Task 6.

- [ ] **Step 4: Commit (deferred)**

Hold this commit until Task 6 is done so the tree stays building. (No commit in this task.)

---

## Task 6: i18n updates (en, ru, es)

**Files:**
- Modify: `src/i18n.ts` (lines 86–87, 178–182, 291–292, 383–387, 494–495, 586–590; check exact line numbers before editing)

- [ ] **Step 1: Update English block**

Around line 87, replace:

```ts
reinitTitle: "Re-init selected domain",
```

with:

```ts
reinitTitle: "Re-init domain (wipe + rebuild)",
reinitNoSources: "Domain has no source_paths — re-init not possible",
```

Around lines 178–182, replace the `reinitConfirmBody` and `reinitConfirmBodyNoSources` entries with:

```ts
reinitConfirmTitle: "Re-init — confirm",
reinitConfirmBody: (id: string, files: number, srcCount: number) =>
  `Domain «${id}»: entire wiki folder will be deleted and rebuilt from ${files} md-files (${srcCount} source paths). Continue?`,
```

Delete the `reinitConfirmBodyNoSources` line entirely.

- [ ] **Step 2: Update Russian block**

Around line 292, replace `reinitTitle: "Повторный init выбранного домена",` with:

```ts
reinitTitle: "Переинициализация домена (wipe + заново)",
reinitNoSources: "У домена нет source_paths — re-init невозможен",
```

Around lines 383–387, replace `reinitConfirmBody` and delete `reinitConfirmBodyNoSources`:

```ts
reinitConfirmTitle: "Re-init — подтвердите",
reinitConfirmBody: (id: string, files: number, srcCount: number) =>
  `Домен «${id}»: будет удалена вся вики-папка домена и пересобрана из ${files} md-файлов (${srcCount} sourcePaths). Продолжить?`,
```

- [ ] **Step 3: Update Spanish block**

Around line 495, replace `reinitTitle: "Re-init del dominio seleccionado",` with:

```ts
reinitTitle: "Re-init del dominio (borrar + reconstruir)",
reinitNoSources: "El dominio no tiene source_paths — re-init imposible",
```

Around lines 586–590, replace `reinitConfirmBody` and delete `reinitConfirmBodyNoSources`:

```ts
reinitConfirmTitle: "Re-init — confirmar",
reinitConfirmBody: (id: string, files: number, srcCount: number) =>
  `Dominio «${id}»: se borrará toda la carpeta wiki del dominio y se reconstruirá desde ${files} archivos md (${srcCount} rutas fuente). ¿Continuar?`,
```

- [ ] **Step 4: Type-check entire project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS — no regressions, new `init.force.test.ts` green.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 7: Commit view + i18n together**

```bash
git add src/view.ts src/i18n.ts
git commit -m "feat(view,i18n): re-init uses recycle icon, drops no-sources branch"
```

---

## Task 7: Manual verification

**Files:** none (manual smoke test in Obsidian)

- [ ] **Step 1: Install build**

```bash
npm run build
```

Verify symlink `~/.config/obsidian/Plugins/obsidian-llm-wiki` points to `dist/`. Reload Obsidian.

- [ ] **Step 2: Existing domain with source_paths**

1. Select a domain with non-empty `source_paths` and a populated wiki folder.
2. Click the recycle button (was `⟳`).
3. Expected: ConfirmModal with body matching `reinitConfirmBody`. Confirm.
4. Expected: assistant text "Re-init: wiping !Wiki/<folder>/...", then "removed N files", then bootstrap + delta + ingest progress for every file. Wiki folder repopulates with fresh entries.

- [ ] **Step 3: Domain without source_paths**

1. Add a domain with empty `source_paths` (e.g. via AddDomainModal).
2. Click recycle.
3. Expected: Notice "У домена нет source_paths — re-init невозможен". Modal does not open.

- [ ] **Step 4: Icon visual check**

Compare refresh button (`↻`) and re-init button — re-init should now show the Lucide recycle glyph (three rotating arrows in a triangle), visually distinct.

- [ ] **Step 5: Abort mid-run**

1. Trigger re-init on a domain with many files.
2. During ingest of a file, click the cancel button.
3. Expected: status switches to "cancelled". Re-launching re-init starts from scratch (wipe again).

- [ ] **Step 6: Commit manual-test notes if needed**

No commit if all checks pass. If a regression surfaces, file it as a follow-up issue — do NOT silently patch.

---

## Self-review notes

- Spec §Design Flow steps 1–8 → covered by Task 3 Step 3 (parse, validate, wipe yields, domain_updated reset, runInitWithSources call with `force=true`).
- Spec §Wipe-функция → Task 1.
- Spec §Controller → Task 4.
- Spec §View → Task 5.
- Spec §i18n table → Task 6.
- Spec §Testing unit list (7 items) → covered by tests in Task 1 (wipe×3), Task 2 (force×2), Task 3 (dispatch×5). Item 6 ("Wipe не трогает `_wiki_schema.md`") → Task 1 Step 1 test "does not touch files outside".
- Edge cases: abort after wipe → guarded by `if (signal.aborted) return;` between wipe and `runInitWithSources` (Task 3 Step 3); locked file → Task 1 Step 1 test "skips files that fail to remove"; mobile (no domainRow) → reinitBtn never created, branch untouched (no change needed).
