# manage-sources removal reinit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user removes a source in ManageSourcesModal and remaining sources exist, show a ConfirmModal before saving — on confirm: save, cleanup, and force-reinit from remaining sources; on cancel: do nothing.

**Architecture:** Single function `handleManageSourcesResult` in `src/view.ts` is restructured into three mutually exclusive branches: (1) remove+remaining → ConfirmModal guard; (2) remove all → immediate save+cleanup, no reinit; (3) add-only → unchanged IngestScopeModal path.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin API (mocked via `vitest.mock.ts`)

---

### Task 1: Write failing tests

**Files:**
- Create: `tests/view-manage-sources-result.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/view-manage-sources-result.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";
import type { DomainEntry } from "../src/domain";
import { __clearNotices } from "obsidian";
import { ConfirmModal, IngestScopeModal } from "../src/modals";

// Captured onConfirm from the most-recently opened ConfirmModal
let lastOnConfirm: (() => Promise<void>) | null = null;

vi.mock("../src/modals", () => ({
  ConfirmModal: vi.fn().mockImplementation(
    (_app: any, _title: string, _lines: string[], onConfirm: () => Promise<void>) => ({
      open: vi.fn(() => { lastOnConfirm = onConfirm; }),
    }),
  ),
  IngestScopeModal: vi.fn().mockImplementation(
    (_app: any, _added: number, _total: number, _onChoice: (s: string) => void) => ({
      open: vi.fn(),
    }),
  ),
  ManageSourcesModal: vi.fn(),
  AddDomainModal: vi.fn(),
  BusyCloseModal: vi.fn(),
}));

vi.mock("../src/utils/vault-walk", () => ({
  collectMdInPaths: vi.fn().mockReturnValue([]),
  walkFolder: vi.fn().mockReturnValue([]),
}));

const BASE_DOMAIN: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/src1", "/home/src2"],
  entity_types: [],
  language_notes: "",
};

function makeController() {
  return {
    updateDomainSources: vi.fn().mockResolvedValue(undefined),
    cleanupRemovedSources: vi.fn().mockResolvedValue(0),
    init: vi.fn().mockResolvedValue(undefined),
    cwdOrEmpty: vi.fn().mockReturnValue(""),
    loadDomains: vi.fn().mockResolvedValue([BASE_DOMAIN]),
    isBusy: vi.fn().mockReturnValue(false),
    currentOp: null,
  };
}

function makeView(ctrl: ReturnType<typeof makeController>) {
  const plugin = {
    controller: ctrl,
    settings: { history: [], historyLimit: 20 },
    app: { vault: { getFolderByPath: vi.fn().mockReturnValue(null) } },
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null } as any;
  return new LlmWikiView(leaf, plugin);
}

describe("handleManageSourcesResult", () => {
  let ctrl: ReturnType<typeof makeController>;
  let view: LlmWikiView;

  beforeEach(() => {
    vi.clearAllMocks();
    lastOnConfirm = null;
    __clearNotices();
    ctrl = makeController();
    view = makeView(ctrl);
  });

  it("Branch 1 — shows ConfirmModal when source removed and paths remain", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).toHaveBeenCalledTimes(1);
    expect(ctrl.updateDomainSources).not.toHaveBeenCalled();
  });

  it("Branch 1 confirm — saves, cleans up, reinits with remaining paths in order", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    ctrl.cleanupRemovedSources.mockResolvedValue(1);
    await (view as any).handleManageSourcesResult(original, result);
    expect(lastOnConfirm).not.toBeNull();
    await lastOnConfirm!();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", ["/home/src1"]);
    expect(ctrl.cleanupRemovedSources).toHaveBeenCalledWith("ai", ["/home/src2"]);
    expect(ctrl.init).toHaveBeenCalledWith("ai", false, ["/home/src1"], true);
    // updateDomainSources must be called before cleanupRemovedSources
    const updateOrder = ctrl.updateDomainSources.mock.invocationCallOrder[0];
    const cleanupOrder = ctrl.cleanupRemovedSources.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(cleanupOrder);
  });

  it("Branch 1 cancel — nothing saved when user dismisses", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    // don't invoke lastOnConfirm — simulates cancel
    expect(ctrl.updateDomainSources).not.toHaveBeenCalled();
    expect(ctrl.cleanupRemovedSources).not.toHaveBeenCalled();
    expect(ctrl.init).not.toHaveBeenCalled();
  });

  it("Branch 2 — removes all sources: saves + cleans immediately, no confirm, no init", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: [] }; // both removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).not.toHaveBeenCalled();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", []);
    expect(ctrl.cleanupRemovedSources).toHaveBeenCalledWith("ai", ["/home/src1", "/home/src2"]);
    expect(ctrl.init).not.toHaveBeenCalled();
  });

  it("Branch 3 — add only: saves + shows IngestScopeModal, no confirm", async () => {
    const original = { ...BASE_DOMAIN, source_paths: ["/home/src1"] };
    const result = { sourcePaths: ["/home/src1", "/home/src3"] }; // src3 added
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).not.toHaveBeenCalled();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", ["/home/src1", "/home/src3"]);
    expect(IngestScopeModal).toHaveBeenCalledTimes(1);
  });

  it("Branch 1 — add+remove simultaneously: confirm path, not IngestScopeModal", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1", "/home/src3"] }; // src3 added, src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).toHaveBeenCalledTimes(1);
    expect(IngestScopeModal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
npx vitest run tests/view-manage-sources-result.test.ts --reporter=verbose
```

Expected: Branch 1 confirm and Branch 1 cancel tests FAIL (current code calls `updateDomainSources` unconditionally and never calls `init`). Branch 2 and 3 may pass — that's expected.

---

### Task 2: Implement `handleManageSourcesResult`

**Files:**
- Modify: `src/view.ts:427-450`

- [ ] **Step 1: Replace `handleManageSourcesResult`**

Replace lines 427–450 (the entire `handleManageSourcesResult` method):

```typescript
  private async handleManageSourcesResult(
    original: DomainEntry,
    result: { sourcePaths: string[] },
  ): Promise<void> {
    const oldPaths = original.source_paths ?? [];
    const newPaths = result.sourcePaths;
    const added = newPaths.filter((p) => !oldPaths.includes(p));
    const removed = oldPaths.filter((p) => !newPaths.includes(p));

    if (removed.length > 0 && newPaths.length > 0) {
      const T = i18n().modal;
      const base = this.plugin.controller.cwdOrEmpty();
      const toVaultRel = (p: string): string => {
        if (!base || !isAbsolute(p)) return p;
        const rel = relative(base, p);
        return rel.startsWith("..") ? p : rel;
      };
      const mdFiles = collectMdInPaths(this.app.vault, newPaths.map(toVaultRel));
      const wikiFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(original.wiki_folder)]);
      const body = T.reinitConfirmBody(original.id, wikiFiles.length, mdFiles.length, newPaths.length);
      new ConfirmModal(
        this.app,
        T.reinitConfirmTitle,
        [body],
        async () => {
          await this.plugin.controller.updateDomainSources(original.id, newPaths);
          const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed);
          if (deleted > 0) new Notice(`Удалено статей: ${deleted}`);
          void this.plugin.controller.init(original.id, false, newPaths, true);
        },
      ).open();
      return;
    }

    if (removed.length > 0) {
      await this.plugin.controller.updateDomainSources(original.id, newPaths);
      const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed);
      if (deleted > 0) new Notice(`Удалено статей: ${deleted}`);
      return;
    }

    if (added.length > 0) {
      await this.plugin.controller.updateDomainSources(original.id, newPaths);
      new IngestScopeModal(this.app, added.length, newPaths.length, (scope) => {
        if (scope === "skip") return;
        const paths = scope === "new" ? added : newPaths;
        void this.plugin.controller.init(original.id, false, paths);
      }).open();
    }
  }
```

- [ ] **Step 2: Run new tests to confirm all pass**

```bash
npx vitest run tests/view-manage-sources-result.test.ts --reporter=verbose
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: `Test Files  79 passed`, `Tests  840 passed` (6 new tests added).

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/view-manage-sources-result.test.ts
git commit -m "feat(view): force reinit on source removal in handleManageSourcesResult"
```
