---
review:
  spec_hash: 2f5327e3900e63fe
  last_run: 2026-05-23
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "### Desired behavior"
      section_hash: 4d38a1d35c5ae8b1
      text: "Дублирующийся заголовок `### Desired behavior` — встречается под Task 29 и Task 31. Без контекстной иерархии в навигации/ToC неразличимы."
      verdict: fixed
      verdict_at: 2026-05-23
    - id: F-002
      phase: structure
      severity: WARNING
      section: "### Change"
      section_hash: 01b2a265146a3dad
      text: "Дублирующийся заголовок `### Change` — встречается под Task 29 и Task 31."
      verdict: fixed
      verdict_at: 2026-05-23
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "### Invariant"
      section_hash: 4987bb02f9921300
      text: "«it may be useful later» — размытое обоснование без критерия. Нет DoD для удаления `save` param в будущем."
      verdict: fixed
      verdict_at: 2026-05-23
    - id: F-004
      phase: clarity
      severity: WARNING
      section: "## Tasks"
      section_hash: 98478c5d4b7bd6c3
      text: "Несогласованный термин: «native→claude-agent» (Tasks) vs «native→claude» (Task 29 Problem/Desired behavior). Одна сущность — два названия."
      verdict: fixed
      verdict_at: 2026-05-23
---

# UX Cleanup: consent per-switch, remove query-save, collapse progress

## Tasks

- **#29** — ShellConsentModal on every native→claude-agent switch
- **#30+** — Remove "Ask and save" button and `query-save` operation entirely
- **#31** — Auto-collapse Progress on finish; auto-expand on start

---

## Task 29 — Consent on every switch

### Problem
`settings.ts` guards `ShellConsentModal` with `!this.localCache.shellConsentGiven`. After first acceptance the modal never appears again, even though the user switches native→claude-agent each session.

### Desired behavior
- ShellConsentModal fires on **every** native→claude-agent switch in settings dropdown
- `shellConsentGiven` stays in LocalConfig (controller still uses it to avoid modal during ops)
- Backend choice is still persisted to `local.json`

### Change
**`src/settings.ts`** — remove `&& !this.localCache.shellConsentGiven` from the condition (one-line change).

---

## Task 30+ — Remove query-save completely

### Scope
Remove the "Ask and save" UI button AND the `query-save` operation type from the entire codebase.

### Changes per file

| File | What |
|------|------|
| `src/types.ts` | Remove `\| "query-save"` from `WikiOperation` |
| `src/main.ts` | Remove query-save `addCommand` block; simplify query command (drop `false` arg) |
| `src/modals.ts` | `QueryModal`: remove `save: boolean` param; title always `T.modal.query` |
| `src/controller.ts` | `query()`: remove `save` param, always `"query"` op; remove all `query-save` branches; remove auto-open block (lines ~713-719) |
| `src/agent-runner.ts` | `buildOptsFor`: remove `query-save→query` remap; switch: remove `case "query-save"` |
| `src/view.ts` | Remove `askSaveBtn` field + creation + event + disable/enable; remove `"query-save"` from `CHAT_OPS`; `submitQuery()`: remove `save` param |
| `src/i18n.ts` | Remove `querySave` key from all three locales' `cmd` objects |

### Invariant
`runQuery(args, save=false, ...)` in the query phase — keep `save` param; always called with `false` now. Remove only when `query-save` is confirmed dead across all call sites.

---

## Task 31 — Progress collapse/expand

### Collapse behavior
- **On start** (`setRunning()`): Progress opens (already implemented — no change needed)
- **On finish** (`finish()`): Progress collapses

### Implementation
**`src/view.ts`** — in `finish()`, after `renderHistory()`:
```typescript
this.stepsOpen = false;
this.stepsEl.addClass("ai-wiki-hidden");
this.progressToggle.setText("▶");
```

---

## Tests to update

`tests/controller-cache-invalidation.test.ts:150` — replace `"query-save"` with `"query"`.

`tests/main-mobile.test.ts:98,102,107` — remove `"query-save"` from expected command lists.

---

## Out of scope
- `runQuery` phase function signature — keep `save` param, always called with `false`
- `shellConsentGiven` in controller.ts — keep as guard for operation-time consent
