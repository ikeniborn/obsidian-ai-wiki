---
review:
  plan_hash: "93c29255fe17a5a4"
  spec_hash: "f05cdcfe10d3a9bf"
  last_run: "2026-05-22"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: CRITICAL
      section: "Task 5: Add controller methods"
      section_hash: "896cc1aa6734c65a"
      text: "Spec §5 и Files Changed требуют расширить сигнатуру `init(domainId, reinit)` → `init(domainId, reinit, paths?)` и прокинуть `paths` через `AgentRunner.run()` в init-фазу. Task 5 добавляет только `updateDomainSources`/`cleanupRemovedSources` — шага для изменения `init` нет. Без этого 3-arg вызов `controller.init(original.id, false, paths)` в Task 6 Step 9 не скомпилируется (TypeScript)."
      verdict: fixed
      verdict_at: "2026-05-22"
    - id: F-002
      phase: coverage
      severity: CRITICAL
      section: "Task 6: View changes"
      section_hash: "16082b0a0dbf156c"
      text: "Spec §Error Handling: 'IngestScopeModal \"Skip\" option — no ingest, no notice'. Код в Task 6 Step 9: `const paths = scope === \"new\" ? added : newPaths; void this.plugin.controller.init(...)` — при scope='skip' always вызывает init с newPaths. Требуется guard: `if (scope === 'skip') return;`."
      verdict: fixed
      verdict_at: "2026-05-22"
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "Task 7: Version bump and build"
      section_hash: "a4afd258f5be3f34"
      text: "Task 7 Step 1 Expected output hardcoded: `0.1.115`. На момент выполнения версия может отличаться (другие коммиты/бампы между созданием плана и исполнением). DoD не валиден при несовпадении."
      verdict: fixed
      verdict_at: "2026-05-22"
---

# Manage Sources Button + Init Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Manage Sources" button (`⊕`) to domain rows in the sidebar, allowing users to add/remove source paths for a domain, with optional cleanup of orphaned wiki articles and ingest of new sources.

**Architecture:** Extract shared vault-walk utilities into `src/utils/vault-walk.ts` (avoids circular dep between controller and view), add two new modals (`ManageSourcesModal`, `IngestScopeModal`) to `src/modals.ts`, add two controller methods (`updateDomainSources`, `cleanupRemovedSources`), and wire the button in `src/view.ts`.

**Tech Stack:** TypeScript, Obsidian Plugin API (Modal, Setting, setIcon, TFile/TFolder), vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/vault-walk.ts` | CREATE | `collectMdInPaths`, `walkFolder`, `parseWikiSources` — shared vault utilities usable by controller without circular dep |
| `src/view.ts` | MODIFY | Re-export from vault-walk.ts; add `addSourceBtn`, `openManageSources`, `handleManageSourcesResult`; update `buildDomainRow`, `setRunning`, `finish` |
| `src/modals.ts` | MODIFY | Add `ManageSourcesModal` (edit source paths list), `IngestScopeModal` (3-choice ingest prompt) |
| `src/controller.ts` | MODIFY | Add `updateDomainSources(domainId, sourcePaths)`, `cleanupRemovedSources(domainId, removedPaths)` |
| `src/i18n.ts` | MODIFY | Rename `view.init` (3 locales); add `addSourceTitle`, `manageSourcesTitle`, `ingestScopeTitle`, `ingestScopeBody`, `ingestScopeNew`, `ingestScopeAll`, `ingestScopeSkip` (3 locales each) |
| `tests/utils/vault-walk.test.ts` | CREATE | Unit tests for `parseWikiSources` |
| `tests/collect-md-in-paths.test.ts` | MODIFY | Update import to new location (keep backward-compat re-export too) |
| `tests/manage-sources-modal.test.ts` | CREATE | `ManageSourcesModal` state tests |
| `tests/ingest-scope-modal.test.ts` | CREATE | `IngestScopeModal` state tests |
| `tests/controller-manage-sources.test.ts` | CREATE | `updateDomainSources` + `cleanupRemovedSources` tests |

---

## Task 1: Create `src/utils/vault-walk.ts`

**Files:**
- Create: `src/utils/vault-walk.ts`
- Modify: `src/view.ts` (lines 9–23 — replace with re-export)
- Modify: `tests/collect-md-in-paths.test.ts` (update import path)
- Create: `tests/utils/vault-walk.test.ts`

- [ ] **Step 1: Write failing test for `parseWikiSources`**

Create `tests/utils/vault-walk.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseWikiSources } from "../../src/utils/vault-walk";

describe("parseWikiSources", () => {
  it("extracts raw paths from wiki_sources list", () => {
    const content = `---
wiki_sources:
  - Notes/AI/doc1.md
  - Notes/Research/paper.md
---
body`;
    expect(parseWikiSources(content)).toEqual([
      "Notes/AI/doc1.md",
      "Notes/Research/paper.md",
    ]);
  });

  it("returns empty array when wiki_sources absent", () => {
    const content = `---
title: test
---
body`;
    expect(parseWikiSources(content)).toEqual([]);
  });

  it("returns empty array when no frontmatter", () => {
    expect(parseWikiSources("just body text")).toEqual([]);
  });

  it("trims whitespace from each path", () => {
    const content = `---
wiki_sources:
  -  Notes/AI/doc1.md  
---
`;
    expect(parseWikiSources(content)).toEqual(["Notes/AI/doc1.md"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils/vault-walk.test.ts
```
Expected: FAIL — `parseWikiSources` not found

- [ ] **Step 3: Create `src/utils/vault-walk.ts`**

```typescript
import type { TFile, TFolder, Vault } from "obsidian";

export function walkFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if ("children" in child) walkFolder(child as TFolder, out);
    else if ("extension" in child && (child as TFile).extension === "md") out.push(child as TFile);
  }
}

export function collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[] {
  const result: TFile[] = [];
  for (const p of sourcePaths) {
    const folder = vault.getFolderByPath(p);
    if (folder) walkFolder(folder, result);
  }
  return result;
}

export function parseWikiSources(content: string): string[] {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return [];
  const sourcesMatch = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!sourcesMatch) return [];
  return sourcesMatch[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/utils/vault-walk.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Update `src/view.ts` to re-export from vault-walk**

Replace lines 9–23 in `src/view.ts` (the `collectMdInPaths` and `walkFolder` function bodies) with re-exports:

```typescript
export { collectMdInPaths, walkFolder } from "./utils/vault-walk";
```

Remove the original function bodies. Keep the `import { ... TFolder, ... } from "obsidian"` only if TFolder is still used elsewhere in view.ts — it is used in `collectMdInPaths` which is now moved. Remove `TFolder` from the view.ts obsidian import if no longer needed there.

- [ ] **Step 6: Verify collect-md-in-paths tests still pass**

```bash
npx vitest run tests/collect-md-in-paths.test.ts
```
Expected: PASS (5 tests, unchanged import `"../src/view"` still works via re-export)

- [ ] **Step 7: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/utils/vault-walk.ts src/view.ts tests/utils/vault-walk.test.ts tests/collect-md-in-paths.test.ts
git commit -m "refactor: extract vault-walk utilities to src/utils/vault-walk.ts"
```

---

## Task 2: Update i18n strings

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/types.test.ts` (or create `tests/i18n-manage-sources.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { i18n } from "../src/i18n";

describe("i18n manage-sources strings", () => {
  it("view.init is renamed to 'Init' in en locale", () => {
    // Force en locale by temporarily overriding moment.locale mock
    // (moment is mocked in vitest.mock.ts to return 'en')
    expect(i18n().view.init).toBe("Init");
  });

  it("modal.manageSourcesTitle is a function returning domain id", () => {
    expect(i18n().modal.manageSourcesTitle("ai")).toBe("Sources: «ai»");
  });

  it("modal.ingestScopeNew returns count in label", () => {
    expect(i18n().modal.ingestScopeNew(2)).toContain("2");
  });

  it("modal.ingestScopeAll returns total count in label", () => {
    expect(i18n().modal.ingestScopeAll(5)).toContain("5");
  });

  it("view.addSourceTitle exists", () => {
    expect(typeof i18n().view.addSourceTitle).toBe("string");
  });
});
```

Create `tests/i18n-manage-sources.test.ts` with the above content.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/i18n-manage-sources.test.ts
```
Expected: FAIL — properties do not exist

- [ ] **Step 3: Update `src/i18n.ts`**

In the `en` object:

**In `view` section** — rename `init`:
```typescript
init: "Init",
```
(was `"Init new domain"`)

**In `view` section** — add after `reinitTitle`:
```typescript
addSourceTitle: "Manage sources for domain",
```

**In `modal` section** — add before the closing brace:
```typescript
manageSourcesTitle: (id: string) => `Sources: «${id}»`,
ingestScopeTitle: "Sources saved — run ingest?",
ingestScopeBody: (added: number, total: number) =>
  `Added ${added} new path(s). Ingest new only or all ${total} path(s)?`,
ingestScopeNew: (n: number) => `New only (${n})`,
ingestScopeAll: (n: number) => `All (${n})`,
ingestScopeSkip: "Skip",
```

In the `ru` object:

**In `view` section** — rename `init`:
```typescript
init: "Init",
```
(was `"Init — новый домен"`)

**In `view` section** — add `addSourceTitle`:
```typescript
addSourceTitle: "Управление источниками домена",
```

**In `modal` section** — add:
```typescript
manageSourcesTitle: (id: string) => `Источники: «${id}»`,
ingestScopeTitle: "Источники сохранены — запустить ingest?",
ingestScopeBody: (added: number, total: number) =>
  `Добавлено ${added} новых путей. Ingest только новых или всех ${total}?`,
ingestScopeNew: (n: number) => `Только новые (${n})`,
ingestScopeAll: (n: number) => `Все (${n})`,
ingestScopeSkip: "Пропустить",
```

In the `es` object:

**In `view` section** — rename `init`:
```typescript
init: "Init",
```
(was `"Init — nuevo dominio"`)

**In `view` section** — add `addSourceTitle`:
```typescript
addSourceTitle: "Gestionar fuentes del dominio",
```

**In `modal` section** — add:
```typescript
manageSourcesTitle: (id: string) => `Fuentes: «${id}»`,
ingestScopeTitle: "Fuentes guardadas — ¿ejecutar ingest?",
ingestScopeBody: (added: number, total: number) =>
  `Se añadieron ${added} ruta(s) nueva(s). ¿Ingest solo las nuevas o todas (${total})?`,
ingestScopeNew: (n: number) => `Solo nuevas (${n})`,
ingestScopeAll: (n: number) => `Todas (${n})`,
ingestScopeSkip: "Omitir",
```

**Important:** The TypeScript type `I18n` is inferred from `en`. Adding these fields to `en` will require them in `ru` and `es` too (both objects above must have them).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/i18n-manage-sources.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts tests/i18n-manage-sources.test.ts
git commit -m "feat: add manage-sources i18n strings and rename view.init to Init"
```

---

## Task 3: Add `ManageSourcesModal` to `modals.ts`

**Files:**
- Modify: `src/modals.ts`
- Create: `tests/manage-sources-modal.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/manage-sources-modal.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ManageSourcesModal } from "../src/modals";
import type { DomainEntry } from "../src/domain";

const domain: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/user/docs", "/home/user/notes"],
  entity_types: [],
  language_notes: "",
};

describe("ManageSourcesModal", () => {
  it("initialises sourcePathsList from domain.source_paths", () => {
    const m = new ManageSourcesModal({} as any, domain, vi.fn());
    expect((m as any).sourcePathsList).toEqual(["/home/user/docs", "/home/user/notes"]);
  });

  it("does not mutate original domain.source_paths (creates a copy)", () => {
    const m = new ManageSourcesModal({} as any, domain, vi.fn());
    (m as any).sourcePathsList.push("/extra");
    expect(domain.source_paths).toHaveLength(2);
  });

  it("calls onSave with filtered sourcePaths when handleSave is called", () => {
    const onSave = vi.fn();
    const m = new ManageSourcesModal({} as any, domain, onSave);
    (m as any).sourcePathsList = ["/home/user/docs", "", "/home/user/notes"];
    (m as any).handleSave();
    expect(onSave).toHaveBeenCalledWith({ sourcePaths: ["/home/user/docs", "/home/user/notes"] });
  });

  it("handles domain with no source_paths (undefined)", () => {
    const domainNoSrc: DomainEntry = { ...domain, source_paths: undefined };
    const m = new ManageSourcesModal({} as any, domainNoSrc, vi.fn());
    expect((m as any).sourcePathsList).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/manage-sources-modal.test.ts
```
Expected: FAIL — `ManageSourcesModal` not exported from `../src/modals`

- [ ] **Step 3: Add `ManageSourcesModal` to `src/modals.ts`**

Add at the end of `src/modals.ts` (before `ShellConsentModal`):

```typescript
export class ManageSourcesModal extends Modal {
  private sourcePathsList: string[];

  constructor(
    app: App,
    private domain: DomainEntry,
    private onSave: (result: { sourcePaths: string[] }) => void,
  ) {
    super(app);
    this.sourcePathsList = [...(domain.source_paths ?? [])];
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.manageSourcesTitle(this.domain.id) });
    const container = contentEl.createDiv();
    this.renderSourcePaths(container);
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }

  private handleSave(): void {
    this.close();
    this.onSave({ sourcePaths: this.sourcePathsList.filter(Boolean) });
  }

  private renderSourcePaths(container: HTMLElement): void {
    container.empty();
    const T = i18n().modal;

    const header = container.createDiv({ cls: "ai-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "ai-wiki-sp-label" });

    const listEl = container.createDiv({ cls: "ai-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "ai-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "ai-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "×", cls: "ai-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();

    const addRow = container.createDiv({ cls: "ai-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "ai-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder },
    });

    const addPath = (val?: string) => {
      const v = val ?? input.value.trim();
      if (!v || this.sourcePathsList.includes(v)) return;
      this.sourcePathsList.push(v);
      input.value = "";
      rerender();
    };

    new FolderInputSuggest(this.app, input, addPath);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); addPath(); }
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/manage-sources-modal.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modals.ts tests/manage-sources-modal.test.ts
git commit -m "feat: add ManageSourcesModal"
```

---

## Task 4: Add `IngestScopeModal` to `modals.ts`

**Files:**
- Modify: `src/modals.ts`
- Create: `tests/ingest-scope-modal.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/ingest-scope-modal.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { IngestScopeModal } from "../src/modals";

describe("IngestScopeModal", () => {
  it("calls onChoice('new') when pickNew is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("new");
    expect(onChoice).toHaveBeenCalledWith("new");
  });

  it("calls onChoice('all') when pickAll is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("all");
    expect(onChoice).toHaveBeenCalledWith("all");
  });

  it("calls onChoice('skip') when pickSkip is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("skip");
    expect(onChoice).toHaveBeenCalledWith("skip");
  });

  it("stores addedCount and totalCount", () => {
    const m = new IngestScopeModal({} as any, 3, 7, vi.fn());
    expect((m as any).addedCount).toBe(3);
    expect((m as any).totalCount).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ingest-scope-modal.test.ts
```
Expected: FAIL — `IngestScopeModal` not exported

- [ ] **Step 3: Add `IngestScopeModal` to `src/modals.ts`**

Add after `ManageSourcesModal`:

```typescript
export class IngestScopeModal extends Modal {
  constructor(
    app: App,
    private addedCount: number,
    private totalCount: number,
    private onChoice: (scope: "new" | "all" | "skip") => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.ingestScopeTitle });
    contentEl.createEl("p", { text: T.ingestScopeBody(this.addedCount, this.totalCount) });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(T.ingestScopeNew(this.addedCount)).setCta().onClick(() => this.pick("new")),
      )
      .addButton((b) =>
        b.setButtonText(T.ingestScopeAll(this.totalCount)).onClick(() => this.pick("all")),
      )
      .addButton((b) =>
        b.setButtonText(T.ingestScopeSkip).onClick(() => this.pick("skip")),
      );
  }

  private pick(scope: "new" | "all" | "skip"): void {
    this.close();
    this.onChoice(scope);
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/ingest-scope-modal.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modals.ts tests/ingest-scope-modal.test.ts
git commit -m "feat: add IngestScopeModal"
```

---

## Task 5: Add controller methods

**Files:**
- Modify: `src/controller.ts`
- Create: `tests/controller-manage-sources.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/controller-manage-sources.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WikiController } from "../src/controller";
import { graphCache } from "../src/wiki-graph-cache";
import type { DomainEntry } from "../src/domain";

function makeFile(path: string) {
  return { path, extension: "md" } as any;
}

function makeFolder(path: string, children: unknown[]) {
  return { path, children } as any;
}

const DOMAIN: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/docs", "/home/notes"],
  entity_types: [],
  language_notes: "",
};

function makeVault(files: { path: string; content: string }[]) {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  const fileObjs = files.map((f) => makeFile(f.path));
  const wikiFolder = makeFolder("!Wiki/ии", fileObjs);

  return {
    getFolderByPath: (p: string) => (p === "!Wiki/ии" ? wikiFolder : null),
    adapter: {
      read: vi.fn().mockImplementation((path: string) => Promise.resolve(fileMap.get(path) ?? "")),
      remove: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      write: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      getBasePath: () => "/tmp/vault",
      getFullPath: (p: string) => `/tmp/vault/${p}`,
    },
    configDir: ".obsidian",
    getName: () => "vault",
    getAbstractFileByPath: vi.fn().mockReturnValue(null),
    modify: vi.fn().mockResolvedValue(undefined),
    createFolder: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApp(vault: ReturnType<typeof makeVault>) {
  return {
    vault,
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: vi.fn().mockResolvedValue(undefined) }),
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue(null),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makePlugin(app: ReturnType<typeof makeApp>) {
  return {
    settings: {
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
      timeouts: { ingest: 30, query: 30, lint: 30, init: 30, format: 30 },
      agentLogEnabled: false,
      history: [],
      historyLimit: 20,
      devMode: { enabled: false, evaluatorModel: "sonnet" },
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app,
  } as unknown as Parameters<typeof WikiController>[1];
}

function build(domains: DomainEntry[] = [DOMAIN], vaultFiles: { path: string; content: string }[] = []) {
  const vault = makeVault(vaultFiles);
  const app = makeApp(vault);
  const plugin = makePlugin(app);
  const domainStore = {
    load: vi.fn().mockResolvedValue(domains),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof WikiController>[2];
  const localConfigStore = {
    load: vi.fn().mockResolvedValue({ iclaudePath: "" }),
  } as unknown as Parameters<typeof WikiController>[3];
  const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
  return { ctrl, vault, domainStore };
}

describe("WikiController.updateDomainSources", () => {
  it("saves updated source_paths to domainStore", async () => {
    const { ctrl, domainStore } = build();
    await ctrl.updateDomainSources("ai", ["/home/docs", "/home/new"]);
    expect(domainStore.save).toHaveBeenCalledWith([
      { ...DOMAIN, source_paths: ["/home/docs", "/home/new"] },
    ]);
  });

  it("is a no-op for unknown domainId (saves unchanged list)", async () => {
    const { ctrl, domainStore } = build();
    await ctrl.updateDomainSources("unknown", ["/home/docs"]);
    // domainStore.save called with original domains (no match, map returns same objects)
    expect(domainStore.save).toHaveBeenCalledOnce();
  });
});

describe("WikiController.cleanupRemovedSources", () => {
  beforeEach(() => { graphCache.clear(); });

  const orphanContent = `---
wiki_sources:
  - /home/notes/doc.md
---
body`;

  const crossRefContent = `---
wiki_sources:
  - /home/docs/other.md
  - /home/notes/doc.md
---
body`;

  it("deletes wiki files whose ALL wiki_sources are from removed paths", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/orphan.md", content: orphanContent },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(1);
    expect(vault.adapter.remove).toHaveBeenCalledWith("!Wiki/ии/Entities/orphan.md");
  });

  it("keeps files that have at least one source NOT in removedPaths", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/crossref.md", content: crossRefContent },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(0);
    expect(vault.adapter.remove).not.toHaveBeenCalled();
  });

  it("skips files with no wiki_sources frontmatter", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/no-sources.md", content: "---\ntitle: test\n---\nbody" },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(0);
    expect(vault.adapter.remove).not.toHaveBeenCalled();
  });

  it("returns 0 for unknown domainId", async () => {
    const { ctrl } = build([DOMAIN], []);
    const deleted = await ctrl.cleanupRemovedSources("unknown", ["/home/notes"]);
    expect(deleted).toBe(0);
  });

  it("invalidates graphCache when files are deleted", async () => {
    const { ctrl } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/orphan.md", content: orphanContent },
    ]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");
    await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(invalidateSpy).toHaveBeenCalledWith("ai");
  });

  it("does NOT invalidate graphCache when no files deleted", async () => {
    const { ctrl } = build([DOMAIN], []);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");
    await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
```

Add to `tests/controller-manage-sources.test.ts` — append after the existing `cleanupRemovedSources` suite:

```typescript
describe("WikiController.init — extended signature", () => {
  it("accepts optional paths argument without throwing", async () => {
    const { ctrl } = build();
    // init with paths must not throw a TypeError (wrong arity)
    await expect(ctrl.init("ai", false, ["/home/docs"])).resolves.not.toThrow();
  });

  it("init without paths still works (backward compat)", async () => {
    const { ctrl } = build();
    await expect(ctrl.init("ai", false)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/controller-manage-sources.test.ts
```
Expected: FAIL — methods not found on WikiController + `init` arity tests fail

- [ ] **Step 3: Add imports and methods to `src/controller.ts`**

Add import at the top of `src/controller.ts` (after existing imports):

```typescript
import { collectMdInPaths, parseWikiSources } from "./utils/vault-walk";
```

**Extend `init` signature** — find existing `async init(domainId: string, reinit: boolean)` and add optional `paths?`:

```typescript
async init(domainId: string, reinit: boolean, paths?: string[]): Promise<void>
```

Pass `paths` through to `AgentRunner.run()` — find the `AgentRunner.run()` call inside `init` and add `paths` to the options object it receives (the exact field name must match what `AgentRunner` / the init phase reads; check `src/agent-runner.ts` for the RunOptions type):

```typescript
await this.runner.run({ operation: "init", domainId, reinit, paths });
```

Add two new methods to `WikiController` class (after `registerDomain`):

```typescript
async updateDomainSources(domainId: string, sourcePaths: string[]): Promise<void> {
  const domains = await this.domainStore.load();
  const next = domains.map((d) => d.id === domainId ? { ...d, source_paths: sourcePaths } : d);
  await this.domainStore.save(next);
}

async cleanupRemovedSources(domainId: string, removedPaths: string[]): Promise<number> {
  const domains = await this.domainStore.load();
  const entry = domains.find((d) => d.id === domainId);
  if (!entry) return 0;

  const wikiFolder = domainWikiFolder(entry.wiki_folder);
  const files = collectMdInPaths(this.app.vault, [wikiFolder]);

  let deleted = 0;
  for (const file of files) {
    try {
      const content = await this.app.vault.adapter.read(file.path);
      const sources = parseWikiSources(content);
      if (sources.length > 0 && sources.every((s) => removedPaths.some((r) => s.includes(r) || r.includes(s)))) {
        await this.app.vault.adapter.remove(file.path);
        deleted++;
      }
    } catch (e) {
      console.error(`[ai-wiki] cleanupRemovedSources: error processing ${file.path}`, e);
    }
  }
  if (deleted > 0) graphCache.invalidate(domainId);
  return deleted;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/controller-manage-sources.test.ts
```
Expected: PASS (10 tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts tests/controller-manage-sources.test.ts
git commit -m "feat: add updateDomainSources, cleanupRemovedSources, extend init signature"
```

---

## Task 6: View changes — add `addSourceBtn` and wire `openManageSources`

**Files:**
- Modify: `src/view.ts`
- Create: `tests/view-add-source-btn.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/view-add-source-btn.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";

function makeView() {
  const plugin = {
    controller: {
      loadDomains: vi.fn().mockResolvedValue([]),
      isBusy: vi.fn().mockReturnValue(false),
      currentOp: null,
    },
    settings: { history: [], historyLimit: 20 },
    app: {},
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null } as any;
  const v = new LlmWikiView(leaf, plugin);
  return v;
}

describe("LlmWikiView addSourceBtn disabled state", () => {
  it("addSourceBtn is undefined initially (before buildDomainRow)", () => {
    const v = makeView();
    expect((v as any).addSourceBtn).toBeUndefined();
  });

  it("setRunning disables addSourceBtn when it exists", () => {
    const v = makeView();
    const btn = { disabled: false } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    // also set required fields that setRunning touches
    (v as any).state = "idle";
    (v as any).stepsEl = { empty: vi.fn(), removeClass: vi.fn(), addClass: vi.fn(), scrollTop: 0, scrollHeight: 0 };
    (v as any).finalEl = { empty: vi.fn() };
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: false };
    (v as any).askBtn = { disabled: false };
    (v as any).askSaveBtn = { disabled: false };
    (v as any).progressToggle = { setText: vi.fn() };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).liveStatusSection = { removeClass: vi.fn() };
    (v as any).liveStatusIconEl = { setText: vi.fn() };
    (v as any).liveStatusTextEl = { setText: vi.fn() };

    v.setRunning("ingest", []);
    expect(btn.disabled).toBe(true);
  });

  it("finish re-enables addSourceBtn when domainSelect has a value", async () => {
    const v = makeView();
    const btn = { disabled: true } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    const select = { value: "ai" } as HTMLSelectElement;
    (v as any).domainSelect = select;

    const entry = {
      id: "1", operation: "ingest" as const, args: [],
      startedAt: 0, finishedAt: 100, status: "done" as const, finalText: "",
      steps: [],
    };
    (v as any).state = "running";
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: true };
    (v as any).askBtn = { disabled: true };
    (v as any).askSaveBtn = { disabled: true };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn(), removeClass: vi.fn(), createDiv: vi.fn() };
    (v as any).resultToggle = { setText: vi.fn() };
    (v as any).historyEl = { empty: vi.fn() };
    (v as any).historySection = { addClass: vi.fn(), removeClass: vi.fn() };
    (v as any).liveStatusSection = { addClass: vi.fn() };
    (v as any).tickHandle = null;

    await v.finish(entry);
    expect(btn.disabled).toBe(false);
  });

  it("finish keeps addSourceBtn disabled when domainSelect has no value", async () => {
    const v = makeView();
    const btn = { disabled: true } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    const select = { value: "" } as HTMLSelectElement;
    (v as any).domainSelect = select;

    const entry = {
      id: "1", operation: "ingest" as const, args: [],
      startedAt: 0, finishedAt: 100, status: "done" as const, finalText: "",
      steps: [],
    };
    (v as any).state = "running";
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: true };
    (v as any).askBtn = { disabled: true };
    (v as any).askSaveBtn = { disabled: true };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn(), removeClass: vi.fn(), createDiv: vi.fn() };
    (v as any).resultToggle = { setText: vi.fn() };
    (v as any).historyEl = { empty: vi.fn() };
    (v as any).historySection = { addClass: vi.fn(), removeClass: vi.fn() };
    (v as any).liveStatusSection = { addClass: vi.fn() };
    (v as any).tickHandle = null;

    await v.finish(entry);
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/view-add-source-btn.test.ts
```
Expected: FAIL — `addSourceBtn` field not present on LlmWikiView / setRunning doesn't disable it

- [ ] **Step 3: Update `src/view.ts` — add field declaration**

Add `addSourceBtn` to the class field declarations (after `private reinitBtn?`):

```typescript
private addSourceBtn?: HTMLButtonElement;
```

- [ ] **Step 4: Update `src/view.ts` — add import**

Add `ManageSourcesModal` and `IngestScopeModal` to the modals import at the top of `view.ts`:

```typescript
import { AddDomainModal, BusyCloseModal, ConfirmModal, ManageSourcesModal, IngestScopeModal } from "./modals";
```

- [ ] **Step 5: Update `buildDomainRow` in `src/view.ts`**

Inside `if (opts.withActions)` block, insert `addSourceBtn` BEFORE `reinitBtn` creation:

```typescript
if (opts.withActions) {
  this.addSourceBtn = domainRow.createEl("button", { attr: { title: T.view.addSourceTitle } });
  setIcon(this.addSourceBtn, "folder-plus");
  this.addSourceBtn.disabled = true;
  this.addSourceBtn.addEventListener("click", () => void this.openManageSources());

  this.reinitBtn = domainRow.createEl("button", { attr: { title: T.view.reinitTitle } });
  setIcon(this.reinitBtn, "recycle");
  this.reinitBtn.disabled = true;
  this.reinitBtn.addEventListener("click", () => void this.runReinit());
  this.domainSelect.addEventListener("change", () => {
    if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect!.value;
    if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect!.value;
  });
  // ... rest of withActions block unchanged
```

- [ ] **Step 6: Update `setRunning` in `src/view.ts`**

Add after `if (this.reinitBtn) this.reinitBtn.disabled = true;`:

```typescript
if (this.addSourceBtn) this.addSourceBtn.disabled = true;
```

- [ ] **Step 7: Update `finish` in `src/view.ts`**

Add after `if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);`:

```typescript
if (this.addSourceBtn) this.addSourceBtn.disabled = !(this.domainSelect && this.domainSelect.value);
```

- [ ] **Step 8: Update `refreshDomains` in `src/view.ts`**

Add after `if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect.value;`:

```typescript
if (this.addSourceBtn) this.addSourceBtn.disabled = !this.domainSelect.value;
```

- [ ] **Step 9: Add `openManageSources` and `handleManageSourcesResult` to `src/view.ts`**

Add these private methods after `runReinit`:

```typescript
private async openManageSources(): Promise<void> {
  const domainId = this.domainSelect!.value;
  if (!domainId) return;
  const domains = await this.plugin.controller.loadDomains();
  const entry = domains.find((d) => d.id === domainId);
  if (!entry) return;
  new ManageSourcesModal(this.app, entry, (result) => {
    void this.handleManageSourcesResult(entry, result);
  }).open();
}

private async handleManageSourcesResult(
  original: DomainEntry,
  result: { sourcePaths: string[] },
): Promise<void> {
  const oldPaths = original.source_paths ?? [];
  const newPaths = result.sourcePaths;
  const added = newPaths.filter((p) => !oldPaths.includes(p));
  const removed = oldPaths.filter((p) => !newPaths.includes(p));

  await this.plugin.controller.updateDomainSources(original.id, newPaths);

  if (removed.length > 0) {
    const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed);
    if (deleted > 0) new Notice(`Удалено статей: ${deleted}`);
  }

  if (added.length > 0) {
    new IngestScopeModal(this.app, added.length, newPaths.length, (scope) => {
      if (scope === "skip") return;
      const paths = scope === "new" ? added : newPaths;
      void this.plugin.controller.init(original.id, false, paths);
    }).open();
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

```bash
npx vitest run tests/view-add-source-btn.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 11: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/view.ts tests/view-add-source-btn.test.ts
git commit -m "feat: add addSourceBtn and openManageSources to LlmWikiView"
```

---

## Task 7: Version bump and build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Read current version**

```bash
node -p "require('./package.json').version"
```
Expected output: current patch version (e.g. `X.Y.Z`)

- [ ] **Step 2: Update version in `package.json` and `src/manifest.json`**

Increment patch: `X.Y.Z` → `X.Y.(Z+1)`. Update `"version"` field in both `package.json` and `src/manifest.json`.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: clean build, no TypeScript errors, `main.js` updated

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump version to 0.1.116"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Task |
|---|---|
| `addSourceBtn` field + `buildDomainRow` placement | Task 6, Steps 3–5 |
| `addSourceBtn.disabled` mirrors `reinitBtn` gated on domain value | Task 6, Steps 5, 7, 8 |
| `setRunning` disables `addSourceBtn` | Task 6, Step 6 |
| `finish` restores `addSourceBtn` disabled state | Task 6, Step 7 |
| `openManageSources` loads DomainEntry, opens modal | Task 6, Step 9 |
| `handleManageSourcesResult` — updateDomainSources | Task 6, Step 9 |
| `handleManageSourcesResult` — cleanupRemovedSources if removed | Task 6, Step 9 |
| `handleManageSourcesResult` — IngestScopeModal if added | Task 6, Step 9 |
| `ManageSourcesModal` | Task 3 |
| `IngestScopeModal` | Task 4 |
| `updateDomainSources` | Task 5 |
| `cleanupRemovedSources` | Task 5 |
| `init` signature extended with optional `paths?` + wired through AgentRunner | Task 5, Step 3 |
| `parseWikiSources` in vault-walk.ts | Task 1 |
| `collectMdInPaths`/`walkFolder` extracted to vault-walk.ts | Task 1 |
| `view.init` renamed (all 3 locales) | Task 2 |
| 6 new i18n strings × 3 locales | Task 2 |
| Version bump + build | Task 7 |

### Placeholder Scan

No TBDs, TODOs, or "similar to Task N" patterns found.

### Type Consistency

- `ManageSourcesModal.onSave` callback type: `(result: { sourcePaths: string[] }) => void` — used consistently in Tasks 3 and 6
- `IngestScopeModal.onChoice` callback type: `(scope: "new" | "all" | "skip") => void` — consistent across Tasks 4 and 6
- `parseWikiSources(content: string): string[]` — used in Task 1 and Task 5
- `collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[]` — extracted in Task 1, used in Task 5
- `controller.init(domainId: string, reinit: boolean, paths?: string[])` — extended in Task 5, Step 3; `paths` wired through AgentRunner.run() to init phase
