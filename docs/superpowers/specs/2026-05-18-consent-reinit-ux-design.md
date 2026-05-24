---
title: Consent lazy-trigger + reinit confirm wiki count
date: 2026-05-18
status: approved
review:
  spec_hash: eae8c6606a000284
  last_run: 2026-05-18
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  section_hashes:
    Problem:              01ba4719c80b6fe9
    Issue1_timing:        9cdc6ddb5488625d
    Issue2_reinit_missing: 82d3e9abcca66ad2
    Design:               01ba4719c80b6fe9
    Issue1_lazy:          6adf8b51fb0caa13
    Issue2_wiki_count:    199e7e4abc2257c0
    Files_changed:        327fd012aa897d17
    Out_of_scope:         212fcbf6543576b3
  findings: []
---

# Design: Lazy ShellConsentModal + Reinit confirm wiki count

## Problem

### Issue 1: ShellConsentModal timing
`ShellConsentModal` fires on `onLayoutReady` (plugin load), before user does anything.
If user dismisses without enabling — only a `Notice` appears on subsequent operations.
User can't give consent, so `dispatch` returns early → all operations silently fail.

Additionally, consent is stored in `data.json` (Obsidian-synced settings), but it must be
per-device (same as `iclaudePath` in `local.json`).

### Issue 2: Reinit confirm dialog missing wiki file count
`reinitConfirmBody` shows source file count and source path count, but NOT how many
wiki files will be deleted. User has no visibility into scope of destructive operation.

## Design

### Issue 1: Lazy ShellConsentModal + move consent to local.json

#### Data model

**`src/local-config.ts`** — add field:
```typescript
export interface LocalConfig {
  ...
  shellConsentGiven?: boolean;
}
```

**`src/types.ts`** — remove `shellConsentGiven` from `LlmWikiPluginSettings` and `DEFAULT_SETTINGS`.

#### ShellConsentModal decoupling

Replace `plugin: LlmWikiPlugin` param with `onEnable: () => Promise<void>` callback.
Modal no longer depends on plugin settings.

```typescript
// src/modals.ts
export class ShellConsentModal extends Modal {
  constructor(
    app: App,
    private iclaudePath: string,
    private onEnable: () => Promise<void>,
  ) { super(app); }

  async enable(): Promise<void> {
    await this.onEnable();
    this.close();
  }
}
```

#### main.ts

1. **Remove** the `onLayoutReady` block (lines 124–133).
2. **Add migration** in `onload()` after `loadSettings()`: if raw loaded data had
   `shellConsentGiven === true`, copy to `local.json` via
   `localConfigStore.save({ shellConsentGiven: true })`.
   `localConfigStore` is available at that point in `onload`.
   Migration is one-shot: skip if `local.shellConsentGiven` is already set.

#### controller.ts — 2 places (dispatch L543, dispatchChat L227)

Replace:
```typescript
if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
  new Notice(i18n().ctrl.shellConsentRequired);
  return;
}
```

With:
```typescript
if (eff.backend === "claude-agent" && !local.shellConsentGiven) {
  new ShellConsentModal(this.app, local.iclaudePath ?? "", async () => {
    await this.localConfigStore.save({ shellConsentGiven: true });
  }).open();
  return;
}
```

`local` is already loaded in both dispatch/dispatchChat at this point.
After consent is given and modal closes, user re-runs the operation. One extra click,
intentional for shell-exec authorization UX.

### Issue 2: Wiki file count in reinit confirm

#### view.ts — runReinit()

After counting source files, also count wiki files:
```typescript
const wikiFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)]);
const body = T.reinitConfirmBody(entry.id, wikiFiles.length, mdFiles.length, sourcePaths.length);
```

`domainWikiFolder` is already imported in `wiki-path.ts`, needs import in `view.ts`.

#### i18n.ts — reinitConfirmBody (all 3 locales: en, ru, es)

Updated signature: `(id: string, wikiFiles: number, srcFiles: number, srcCount: number)`

Example (ru):
```typescript
reinitConfirmBody: (id: string, wikiFiles: number, srcFiles: number, srcCount: number) =>
  `Домен «${id}»: будет удалено ${wikiFiles} wiki-файлов и пересобрано из ${srcFiles} md-файлов (${srcCount} sourcePaths). Продолжить?`,
```

## Files changed

| File | Change |
|---|---|
| `src/local-config.ts` | Add `shellConsentGiven?: boolean` |
| `src/types.ts` | Remove `shellConsentGiven` from settings + defaults |
| `src/modals.ts` | `ShellConsentModal`: replace `plugin` param with `onEnable` callback |
| `src/main.ts` | Remove `onLayoutReady` block; add migration for old consent value |
| `src/controller.ts` | 2 places: Notice → ShellConsentModal; check `local.shellConsentGiven` |
| `src/view.ts` | Count wiki files in `runReinit()`; pass to `reinitConfirmBody` |
| `src/i18n.ts` | Update `reinitConfirmBody` signature + strings in 3 locales |
| `tests/shell-consent.test.ts` | Update for new `ShellConsentModal` constructor |

## Out of scope

- Auto-retry operation after consent (Approach B) — not needed, one extra click is acceptable.
- Settings UI toggle for shellConsentGiven — consent lives in local.json, managed by modal only.
