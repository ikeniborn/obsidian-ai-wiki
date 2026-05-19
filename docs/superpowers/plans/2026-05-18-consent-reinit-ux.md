---
title: Consent lazy-trigger + reinit confirm wiki count
date: 2026-05-18
review:
  plan_hash: 2005a23c4953179c
  spec_hash: eae8c6606a000284
  last_run: 2026-05-18
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    FileMap: 809fe838bcf16580
    Task1:   0eaed583aafd228a
    Task2:   ee10445101884320
    Task3:   7e5b9678d71fcc2a
    Task4:   c8af549f9aa0d23c
    Task5:   8a31be44e47f8039
  findings:
    - id: F-001
      severity: WARNING
      section: Task5/i18n
      section_hash: dc919da3eee5f14f
      text: "param name `files` in plan vs `srcFiles` in spec — cosmetic, string template identical"
      verdict: fixed
---

# Consent Lazy-Trigger + Reinit Wiki Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move shellConsentGiven to local.json with lazy modal trigger, and show wiki file count in reinit confirm dialog.

**Architecture:** Two independent issues. Issue 1 migrates consent storage from synced data.json to per-device local.json and replaces the eager onLayoutReady modal with a lazy gate in dispatch/dispatchChat. Issue 2 adds a wikiFiles count to the runReinit confirm body by calling collectMdInPaths on the domain wiki folder.

**Tech Stack:** TypeScript, Obsidian API (Modal, Notice), Vitest

---

## File Map

| File | Change |
|---|---|
| `src/local-config.ts` | Add `shellConsentGiven?: boolean` to `LocalConfig` |
| `src/types.ts` | Remove `shellConsentGiven` from `LlmWikiPluginSettings` + `DEFAULT_SETTINGS` |
| `src/modals.ts` | `ShellConsentModal`: replace `plugin` param with `onEnable: () => Promise<void>` |
| `src/main.ts` | Remove `onLayoutReady` block; add consent migration in `migrateLegacyData` |
| `src/controller.ts` | 2 dispatch points: Notice → lazy ShellConsentModal; add import |
| `src/view.ts` | Import `domainWikiFolder`; count wiki files in `runReinit()` |
| `src/i18n.ts` | Update `reinitConfirmBody` signature + strings (EN/RU/ES, lines 186, 400, 612) |
| `tests/shell-consent.test.ts` | Rewrite for new `ShellConsentModal(app, path, onEnable)` constructor |

---

### Task 1: Data model — types.ts + local-config.ts

**Files:**
- Modify: `src/types.ts:168-169,215-216`
- Modify: `src/local-config.ts:11-29`

- [ ] **Step 1: Update shell-consent.test.ts — remove stale DEFAULT_SETTINGS test**

Replace `tests/shell-consent.test.ts` line 5-9 (the `DEFAULT_SETTINGS.shellConsentGiven` describe block) so it no longer references that field. The test will fail to compile once we remove it from types.

```typescript
// tests/shell-consent.test.ts — remove this entire block:
// describe("DEFAULT_SETTINGS.shellConsentGiven", () => {
//   it("defaults to false", () => {
//     expect(DEFAULT_SETTINGS.shellConsentGiven).toBe(false);
//   });
// });
```

New file header (keep imports, drop that describe block):

```typescript
import { describe, it, expect, vi } from "vitest";
import { ShellConsentModal } from "../src/modals";

describe("ShellConsentModal", () => {
  it("is exported from modals.ts", () => {
    expect(ShellConsentModal).toBeDefined();
  });

  it("calls onEnable callback and closes when enable() is called", async () => {
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const modal = new ShellConsentModal({} as any, "/usr/bin/claude", onEnable);
    (modal as any).close = vi.fn();
    await (modal as any).enable();
    expect(onEnable).toHaveBeenCalledOnce();
    expect((modal as any).close).toHaveBeenCalled();
  });

  it("does not call onEnable when cancel() is called", () => {
    const onEnable = vi.fn();
    const modal = new ShellConsentModal({} as any, "/usr/bin/claude", onEnable);
    (modal as any).close = vi.fn();
    (modal as any).cancel();
    expect(onEnable).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (new constructor not yet implemented)**

```bash
npx vitest run tests/shell-consent.test.ts
```

Expected: FAIL — `ShellConsentModal` constructor expects old signature

- [ ] **Step 3: Remove `shellConsentGiven` from `src/types.ts`**

In `src/types.ts` line 168, delete:
```typescript
  shellConsentGiven: boolean;
```

In `src/types.ts` line 215, delete:
```typescript
  shellConsentGiven: false,
```

After edit, `LlmWikiPluginSettings` has no `shellConsentGiven` field and `DEFAULT_SETTINGS` has no such key.

- [ ] **Step 4: Add `shellConsentGiven` to `src/local-config.ts`**

In `src/local-config.ts` add field to `LocalConfig` interface (after `migrated_v1?: boolean`):

```typescript
export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
  };
  proxy?: ProxyConfig;
  migrated_v1?: boolean;
  shellConsentGiven?: boolean;
}
```

- [ ] **Step 5: Build to verify TypeScript compiles (type errors expected from modals.ts/main.ts/controller.ts — that's OK at this stage, just check no other unexpected errors)**

```bash
npm run build 2>&1 | head -40
```

Expected: type errors mentioning `shellConsentGiven` in modals.ts, main.ts, controller.ts — those will be fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/local-config.ts tests/shell-consent.test.ts
git commit -m "refactor(consent): move shellConsentGiven from settings to LocalConfig"
```

---

### Task 2: Refactor ShellConsentModal (modals.ts)

**Files:**
- Modify: `src/modals.ts:512-544`

- [ ] **Step 1: Rewrite `ShellConsentModal` in `src/modals.ts`**

Replace lines 512–544 (the entire `ShellConsentModal` class) with:

```typescript
export class ShellConsentModal extends Modal {
  constructor(
    app: App,
    private iclaudePath: string,
    private onEnable: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.shellConsentTitle });
    contentEl.createEl("p", { text: T.shellConsentBody(this.iclaudePath), cls: "ai-wiki-consent-body" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.cancel()))
      .addButton((b) =>
        b.setButtonText(T.shellConsentEnable).setCta().onClick(() => void this.enable()),
      );
  }

  cancel(): void {
    this.close();
  }

  async enable(): Promise<void> {
    await this.onEnable();
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}
```

Note: remove the `import("./main").default` plugin reference from the constructor. The `Setting` import is already present at line 1 of modals.ts.

- [ ] **Step 2: Run shell-consent tests to verify they pass**

```bash
npx vitest run tests/shell-consent.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 3: Commit**

```bash
git add src/modals.ts
git commit -m "refactor(consent): ShellConsentModal uses onEnable callback, drops plugin dep"
```

---

### Task 3: main.ts — remove onLayoutReady block + add consent migration

**Files:**
- Modify: `src/main.ts:124-133` (remove onLayoutReady block)
- Modify: `src/main.ts:283-314` (migrateLegacyData — add consent migration)
- Modify: `src/main.ts:7` (remove ShellConsentModal from import)

- [ ] **Step 1: Remove the `onLayoutReady` block from `onload()` in `src/main.ts`**

Delete lines 124–133:

```typescript
// DELETE this block:
this.app.workspace.onLayoutReady?.(() => {
  if (
    this.settings.backend === "claude-agent" &&
    !this.settings.shellConsentGiven
  ) {
    void this.localConfigStore.load().then((local) => {
      new ShellConsentModal(this.app, this, local.iclaudePath ?? "").open();
    });
  }
});
```

- [ ] **Step 2: Add consent migration to `migrateLegacyData` in `src/main.ts`**

In `migrateLegacyData` (around line 295, after the `claudeAgent.iclaudePath` migration block), add:

```typescript
// Migrate shellConsentGiven from data.json → local.json (one-shot)
if (data.shellConsentGiven === true) {
  const localCur = await localConfigStore.load();
  if (!localCur.shellConsentGiven) {
    await localConfigStore.save({ shellConsentGiven: true });
  }
  delete data.shellConsentGiven;
  dirty = true;
}
```

- [ ] **Step 3: Update import in `src/main.ts` line 7**

Remove `ShellConsentModal` from the import (it's no longer used in main.ts):

```typescript
import { QueryModal, DomainModal } from "./modals";
```

- [ ] **Step 4: Build to verify no type errors in main.ts**

```bash
npm run build 2>&1 | grep "main.ts"
```

Expected: no errors from main.ts (controller.ts may still have errors — next task)

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(consent): remove eager onLayoutReady modal, add migration from data.json to local.json"
```

---

### Task 4: controller.ts — lazy ShellConsentModal at 2 dispatch points

**Files:**
- Modify: `src/controller.ts:22` (add ShellConsentModal to import)
- Modify: `src/controller.ts:227-230` (dispatchChat consent check)
- Modify: `src/controller.ts:543-546` (dispatch consent check)

- [ ] **Step 1: Add `ShellConsentModal` to controller.ts import**

Line 22 currently:
```typescript
import { FileErrorModal, ConfirmModal } from "./modals";
```

Change to:
```typescript
import { FileErrorModal, ConfirmModal, ShellConsentModal } from "./modals";
```

- [ ] **Step 2: Replace consent check at dispatchChat L227**

Current (lines 227–230):
```typescript
      if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
        new Notice(i18n().ctrl.shellConsentRequired);
        return;
      }
```

Replace with:
```typescript
      if (eff.backend === "claude-agent" && !local.shellConsentGiven) {
        new ShellConsentModal(this.app, local.iclaudePath ?? "", async () => {
          await this.localConfigStore.save({ shellConsentGiven: true });
        }).open();
        return;
      }
```

- [ ] **Step 3: Replace consent check at dispatch L543**

Current (lines 543–546):
```typescript
      if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
        new Notice(i18n().ctrl.shellConsentRequired);
        return;
      }
```

Replace with:
```typescript
      if (eff.backend === "claude-agent" && !local.shellConsentGiven) {
        new ShellConsentModal(this.app, local.iclaudePath ?? "", async () => {
          await this.localConfigStore.save({ shellConsentGiven: true });
        }).open();
        return;
      }
```

- [ ] **Step 4: Build to verify clean compile**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts
git commit -m "feat(consent): lazy ShellConsentModal in dispatch/dispatchChat, read from local.shellConsentGiven"
```

---

### Task 5: Reinit wiki file count — view.ts + i18n.ts

**Files:**
- Modify: `src/view.ts:1-6` (add domainWikiFolder import)
- Modify: `src/view.ts:326-327` (runReinit — count wiki files)
- Modify: `src/i18n.ts:186-187` (EN reinitConfirmBody)
- Modify: `src/i18n.ts:400-401` (RU reinitConfirmBody)
- Modify: `src/i18n.ts:612-613` (ES reinitConfirmBody)

- [ ] **Step 1: Update `reinitConfirmBody` signature in `src/i18n.ts` — all 3 locales**

**EN (line 186–187):**
```typescript
    reinitConfirmBody: (id: string, wikiFiles: number, srcFiles: number, srcCount: number) =>
      `Domain «${id}»: ${wikiFiles} wiki files will be deleted and rebuilt from ${srcFiles} md-files (${srcCount} source paths). Continue?`,
```

**RU (line 400–401):**
```typescript
    reinitConfirmBody: (id: string, wikiFiles: number, srcFiles: number, srcCount: number) =>
      `Домен «${id}»: будет удалено ${wikiFiles} wiki-файлов и пересобрано из ${srcFiles} md-файлов (${srcCount} sourcePaths). Продолжить?`,
```

**ES (line 612–613):**
```typescript
    reinitConfirmBody: (id: string, wikiFiles: number, srcFiles: number, srcCount: number) =>
      `Dominio «${id}»: se borrarán ${wikiFiles} archivos wiki y se reconstruirán desde ${srcFiles} archivos md (${srcCount} rutas fuente). ¿Continuar?`,
```

- [ ] **Step 2: Build to verify i18n change causes type error in view.ts (call site still passes 3 args)**

```bash
npm run build 2>&1 | grep "view.ts"
```

Expected: type error at `view.ts:327` — `reinitConfirmBody` called with wrong arg count

- [ ] **Step 3: Add `domainWikiFolder` import to `src/view.ts`**

Add to line 6 (after `import { i18n } from "./i18n";`):

```typescript
import { domainWikiFolder } from "./wiki-path";
```

- [ ] **Step 4: Update `runReinit()` in `src/view.ts` to count wiki files**

Current (lines 326–327):
```typescript
    const mdFiles = collectMdInPaths(this.app.vault, sourcePaths);
    const body = T.reinitConfirmBody(entry.id, mdFiles.length, sourcePaths.length);
```

Replace with:
```typescript
    const mdFiles = collectMdInPaths(this.app.vault, sourcePaths);
    const wikiFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)]);
    const body = T.reinitConfirmBody(entry.id, wikiFiles.length, mdFiles.length, sourcePaths.length);
```

- [ ] **Step 5: Build to verify clean compile**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/view.ts src/i18n.ts
git commit -m "feat(reinit): show wiki file count in reinit confirm dialog"
```
