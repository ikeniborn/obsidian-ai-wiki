---
review:
  plan_hash: 38da339d4ce3dca7
  spec_hash: 0e1982c63a690c7d
  last_run: 2026-06-28
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: verifiability
      severity: INFO
      section: "Task 4: view.ts"
      section_hash: 827e2ff987f9fc02
      fragment: "Manual dev-mode verification"
      text: "Task 4's UI behaviour (R1/R2) is gated only by manual dev-mode checks — no automated JS test runner exists in this repo."
      fix: "Accepted: repo has no JS test runner; pure logic is covered by the eval/eval-comment harness (Task 1); manual steps list concrete observable assertions."
      verdict: accepted
      verdict_at: 2026-06-28
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-28-historical-rating-comment-dspy-design.md
result_check:
  verdict: OK
  plan_hash: 38da339d4ce3dca7
  last_run: 2026-06-28
---
# Historical rating + per-run comment → DSPy opinion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rate any run (fresh or historical) bound to its `runId`, fix the stale-rating leak, add one free-form comment per run persisted to `eval.jsonl`, and consume that comment in the DSPy optimizer as a per-operation "opinion" while migrating the dataset readers from the legacy scalar `rating` to the per-axis `ratings` map.

**Architecture:** Plugin side — `eval.jsonl` (keyed by `runId`) stays the single source of truth; a shared `view.ts#renderResultFor(entry)` tears down and rebuilds the rating/comment UI per displayed `runId`, reading persisted state via new `eval-log.ts` helpers. DSPy side — `loader.py`/`optimizer.py` resolve the up/down signal from `ratings[primary_axis]` with a scalar fallback, and aggregate comments into a "Human reviewer feedback" block prepended to the optimizer seed.

**Tech Stack:** TypeScript (Obsidian plugin, esbuild + eslint), Node out-of-vault eval harness, Python 3.11 + DSPy 3.2 (uv + pytest).

## Global Constraints

- Branch: `dev-historical-rating-comment` (already created from `master`). Never commit to `master`; PR-only.
- All rating/comment UI is gated on `this.plugin.settings.devMode?.enabled`.
- `eval.jsonl` lives in the plugin dir, keyed by `runId` (= `RunHistoryEntry.id` = `${startedAt}`). Per-device, not synced.
- All `eval-log.ts` I/O swallows errors and returns `undefined`/no-op — never block a run or the UI.
- Plugin verification gates (this repo has pre-existing `tsc` errors, so `tsc --noEmit` is NOT a clean gate): `npm run lint` and `npm run build` must pass; pure logic via the `eval/eval-comment` harness; UI via manual dev-mode checks.
- DSPy verification gate: `cd scripts/dspy && make test` (pytest) green. Existing tests use the scalar `rating` and MUST stay green (scalar fallback preserves them).
- Docs language English; comments English; conversation Russian.
- Comment dataset rule (carry verbatim): signal precedence `ratings[PRIMARY_AXIS]` (valid up/down) → else scalar `rating` → else skip. Comment is independent of the rating and only feeds the feedback block. Per-comment char cap ~200 (closes spec finding F-001).
- `PRIMARY_AXIS` (verbatim, both TS and Python): `query→answer, chat→answer, format→formatting, ingest→page, init→coverage, lint→fix, lint-chat→fix, delete→rebuild`.

---

## Task 1: `eval-log.ts` — `comment` field + `readEvalRecord` + `updateEvalComment`

**Files:**
- Modify: `src/eval-log.ts`
- Create: `eval/eval-comment/run.ts` (out-of-vault harness)

**Interfaces:**
- Consumes: existing `EvalRecord`, `Rating`, `evalLogPath`, `VaultAdapter` (`src/vault-tools.ts`: `read`, `write`, `append`, `exists`).
- Produces:
  - `EvalRecord.comment?: string`
  - `readEvalRecord(adapter: VaultAdapter, pluginDir: string, runId: string): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined>`
  - `updateEvalComment(adapter: VaultAdapter, pluginDir: string, runId: string, comment: string): Promise<string | undefined>`

- [ ] **Step 1: Write the failing harness test**

Create `eval/eval-comment/run.ts`:

```ts
/**
 * Out-of-vault eval for the eval-log read/comment helpers. Exercises the REAL
 * pure functions from src/eval-log.ts against an in-memory VaultAdapter. No
 * vault, no LLM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/eval-comment/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/eval-comment/run.cjs
 *   node eval/eval-comment/run.cjs
 */
import { readEvalRecord, updateEvalComment, type EvalRecord } from "../../src/eval-log";
import type { VaultAdapter } from "../../src/vault-tools";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// Minimal in-memory adapter (only the methods the helpers touch).
function memAdapter(seed: Record<string, string> = {}): VaultAdapter {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, d: string) => { files.set(p, d); },
    append: async (p: string, d: string) => { files.set(p, (files.get(p) ?? "") + d); },
    exists: async (p: string) => files.has(p),
  } as VaultAdapter;
}

const DIR = "/plugin";
const PATH = `${DIR}/eval.jsonl`;
function rec(partial: Partial<EvalRecord>): string {
  return JSON.stringify({ runId: "r1", ts: "t", operation: "query", model: "m",
    llmErrors: [], ruleFirings: {}, ratings: {}, ...partial });
}

section("readEvalRecord");
{
  const log = rec({ runId: "r1", ratings: { answer: "up" }, comment: "good" }) + "\n" +
              rec({ runId: "r2", ratings: { answer: "down" } }) + "\n";
  const ad = memAdapter({ [PATH]: log });
  void (async () => {
    const a = await readEvalRecord(ad, DIR, "r1");
    check("returns ratings+comment for runId", a?.ratings.answer === "up" && a?.comment === "good", JSON.stringify(a));
    const b = await readEvalRecord(ad, DIR, "r2");
    check("defaults comment to empty string", b?.comment === "" && b?.ratings.answer === "down", JSON.stringify(b));
    const c = await readEvalRecord(ad, DIR, "missing");
    check("undefined on miss", c === undefined);
    const d = await readEvalRecord(memAdapter(), DIR, "r1");
    check("undefined when file absent", d === undefined);

    section("updateEvalComment");
    const saved = await updateEvalComment(ad, DIR, "r1", "edited");
    check("returns persisted comment", saved === "edited", String(saved));
    const reread = await readEvalRecord(ad, DIR, "r1");
    check("comment persisted in place", reread?.comment === "edited" && reread?.ratings.answer === "up", JSON.stringify(reread));
    const r2still = await readEvalRecord(ad, DIR, "r2");
    check("other record untouched", r2still?.ratings.answer === "down" && r2still?.comment === "", JSON.stringify(r2still));
    const none = await updateEvalComment(ad, DIR, "nope", "x");
    check("undefined when runId absent", none === undefined);

    console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
    if (fail > 0) { console.log(failures.join("\n")); process.exit(1); }
  })();
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run:
```bash
node_modules/.bin/esbuild eval/eval-comment/run.ts --bundle --platform=node --format=cjs --outfile=eval/eval-comment/run.cjs && node eval/eval-comment/run.cjs
```
Expected: esbuild error — `readEvalRecord` / `updateEvalComment` are not exported from `src/eval-log.ts` (build fails before running).

- [ ] **Step 3: Add the `comment` field to `EvalRecord`**

In `src/eval-log.ts`, extend the interface (after the `ratings` line):

```ts
export interface EvalRecord extends EvalMetaFields {
  runId: string;
  ts: string;
  operation: string;
  model: string;
  llmErrors: LlmError[];
  ruleFirings: Record<string, number>;
  ratings: Record<string, Rating>;
  comment?: string;
}
```

- [ ] **Step 4: Add `readEvalRecord` and `updateEvalComment`**

Append to `src/eval-log.ts` (after `updateEvalRating`):

```ts
/**
 * Read one record's ratings + comment, matched by runId (last match wins, like
 * updateEvalRating). Returns undefined when the file/record is absent or on any
 * failure, so the caller renders no rating/comment rows. Tolerates legacy lines.
 */
export async function readEvalRecord(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      return { ratings: rec.ratings ?? {}, comment: rec.comment ?? "" };
    }
    return undefined;
  } catch { return undefined; }
}

/**
 * Set one record's comment in place, matched by runId. Returns the persisted
 * comment, or undefined when no record matched / the write failed (so the caller
 * can avoid showing a state that was not persisted). Never throws.
 */
export async function updateEvalComment(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
  comment: string,
): Promise<string | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      rec.comment = comment;
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return comment;
    }
    return undefined;
  } catch { return undefined; }
}
```

- [ ] **Step 5: Run the harness to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/eval-comment/run.ts --bundle --platform=node --format=cjs --outfile=eval/eval-comment/run.cjs && node eval/eval-comment/run.cjs
```
Expected: `OK — 9 passed, 0 failed`.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no new errors in `src/eval-log.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/eval-log.ts eval/eval-comment/run.ts eval/eval-comment/run.cjs
git commit -m "feat(eval): comment field + readEvalRecord/updateEvalComment by runId"
```

---

## Task 2: `controller.ts` — `readRun` / `commentRun` wrappers

**Files:**
- Modify: `src/controller.ts:30` (import) and after `rateRun` (~`src/controller.ts:198`)

**Interfaces:**
- Consumes: `readEvalRecord`, `updateEvalComment` (Task 1), existing `this.pluginDir()`, `this.app.vault.adapter`, `this.plugin.settings.devMode`.
- Produces:
  - `WikiController.readRun(runId: string): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined>`
  - `WikiController.commentRun(runId: string, comment: string): Promise<string | undefined>`

- [ ] **Step 1: Extend the eval-log import**

In `src/controller.ts`, replace line 30:

```ts
import { updateEvalRating, type RatingAxis, type Rating } from "./eval-log";
```
with:
```ts
import { updateEvalRating, readEvalRecord, updateEvalComment, type RatingAxis, type Rating } from "./eval-log";
```

- [ ] **Step 2: Add the two wrappers after `rateRun`**

Insert directly after the `rateRun` method (before `private pluginDir()`):

```ts
  /** Read a finished run's persisted ratings + comment from eval.jsonl (dev mode only). */
  async readRun(runId: string): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return readEvalRecord(this.app.vault.adapter, this.pluginDir(), runId);
  }

  /** Set a finished run's free-form comment in eval.jsonl (dev mode only). Returns the persisted comment. */
  async commentRun(runId: string, comment: string): Promise<string | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return updateEvalComment(this.app.vault.adapter, this.pluginDir(), runId, comment);
  }
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): readRun/commentRun wrappers (dev-mode gated)"
```

---

## Task 3: `i18n.ts` — comment labels (en/ru/es)

**Files:**
- Modify: `src/i18n.ts` (en `view` block near line 185, ru near line 529, es near line 850)

**Interfaces:**
- Produces: `i18n().view.commentPlaceholder`, `.commentSave`, `.commentSaved` in all three languages.

- [ ] **Step 1: Add the en keys**

In `src/i18n.ts`, immediately after the en `ratingDown: "Bad output",` line (~185), add:

```ts
    commentPlaceholder: "Comment (optional) — reused as an opinion in optimization…",
    commentSave: "Save comment",
    commentSaved: "saved",
```

- [ ] **Step 2: Add the ru keys**

Immediately after the ru `ratingDown: "Плохой вывод",` line (~528), add:

```ts
    commentPlaceholder: "Комментарий (необязательно) — учитывается как мнение при оптимизации…",
    commentSave: "Сохранить комментарий",
    commentSaved: "сохранено",
```

- [ ] **Step 3: Add the es keys**

Immediately after the es `ratingDown: "Mal resultado",` line (~850), add:

```ts
    commentPlaceholder: "Comentario (opcional) — se reutiliza como opinión en la optimización…",
    commentSave: "Guardar comentario",
    commentSaved: "guardado",
```

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds (the `View` i18n type now carries the three keys in all langs), no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): comment box labels (en/ru/es)"
```

---

## Task 4: `view.ts` — shared `renderResultFor` + `renderCommentBox` + initial rating state (R1 + R2)

**Files:**
- Modify: `src/view.ts` — import (line 13), `renderRatingRow` (828), `renderFormatPreview` (852), `finish` (929), `renderHistory` click handler (1259-1268). Add `renderResultFor` and `renderCommentBox`.

**Interfaces:**
- Consumes: `controller.readRun` / `commentRun` (Task 2), `controller.rateRun`, `i18n().view.comment*` (Task 3), `OPERATION_AXES`, `Rating`.
- Produces:
  - `renderRatingRow(parent, runId, axis, label, initial: Rating)` — new 5th param.
  - `private renderResultFor(entry: RunHistoryEntry): Promise<void>`
  - `private renderCommentBox(parent: HTMLElement, runId: string, initial: string): void`

- [ ] **Step 1: Import the `Rating` type**

In `src/view.ts`, replace line 13:
```ts
import { OPERATION_AXES } from "./eval-log";
```
with:
```ts
import { OPERATION_AXES, type Rating } from "./eval-log";
```

- [ ] **Step 2: Give `renderRatingRow` an initial state**

Replace the whole `renderRatingRow` method (828-850) with:

```ts
  private renderRatingRow(
    parent: HTMLElement,
    runId: string,
    axis: string,
    label: string,
    initial: Rating,
  ): void {
    if (!this.plugin.settings.devMode?.enabled) return;
    const T = i18n();
    const row = parent.createDiv("ai-wiki-rating-row");
    row.createSpan({ text: label, cls: "ai-wiki-rating-label" });
    const up = row.createEl("button", { text: "👍", cls: "ai-wiki-rating-btn is-up", attr: { "aria-label": T.view.ratingUp } });
    const down = row.createEl("button", { text: "👎", cls: "ai-wiki-rating-btn is-down", attr: { "aria-label": T.view.ratingDown } });
    const render = (rating: "up" | "down" | null) => {
      up.toggleClass("is-active", rating === "up");
      down.toggleClass("is-active", rating === "down");
    };
    render(initial); // reflect persisted state on first paint
    const handle = (rating: "up" | "down") => async () => {
      const result = await this.plugin.controller.rateRun(runId, axis, rating);
      if (result !== undefined) render(result); // reflect what was actually persisted
    };
    up.addEventListener("click", () => void handle("up")());
    down.addEventListener("click", () => void handle("down")());
  }
```

- [ ] **Step 3: Add `renderResultFor` and `renderCommentBox`**

Insert these two methods directly after `renderRatingRow` (before `renderFormatPreview`):

```ts
  /** Render an entry's result body + (dev-mode) rating rows and comment box, bound
   *  to entry.id. Used by both finish() and the history-row click so the rating UI is
   *  always torn down and rebuilt for the displayed runId — never leaked across runs. */
  private async renderResultFor(entry: RunHistoryEntry): Promise<void> {
    this.ratingSection?.remove();
    this.ratingSection = null;

    this.finalEl.empty();
    const comp = new Component();
    comp.load();
    await MarkdownRenderer.render(this.app, entry.finalText || "(empty)", this.finalEl, "", comp);
    sanitizeLinks(this.finalEl);
    this.resultSection.removeClass("ai-wiki-hidden");
    this.finalEl.removeClass("ai-wiki-hidden");
    this.resultOpen = true;
    this.resultToggle.setText("▼");

    // format renders its axes in the preview (vision-gated, preview-bound); a past
    // format entry shows its report but no rating/comment rows.
    if (!this.plugin.settings.devMode?.enabled) return;
    if (entry.status !== "done" || entry.operation === "format") return;
    const axes = (OPERATION_AXES[entry.operation] ?? []).filter((a) => a.gate !== "vision");
    if (axes.length === 0) return;

    const persisted = await this.plugin.controller.readRun(entry.id);
    this.ratingSection = this.resultSection.createDiv("ai-wiki-rating-section");
    const view = i18n().view as unknown as Record<string, string>;
    for (const ax of axes) {
      this.renderRatingRow(this.ratingSection, entry.id, ax.id, view[ax.labelKey], persisted?.ratings[ax.id] ?? null);
    }
    this.renderCommentBox(this.ratingSection, entry.id, persisted?.comment ?? "");
  }

  /** One free-form comment per run, persisted to eval.jsonl via commentRun. Dev mode only. */
  private renderCommentBox(parent: HTMLElement, runId: string, initial: string): void {
    if (!this.plugin.settings.devMode?.enabled) return;
    const T = i18n();
    const box = parent.createDiv("ai-wiki-comment-box");
    const ta = box.createEl("textarea", {
      cls: "ai-wiki-comment-input",
      attr: { placeholder: T.view.commentPlaceholder, rows: "2" },
    });
    ta.value = initial;
    const actions = box.createDiv("ai-wiki-comment-actions");
    const saveBtn = actions.createEl("button", { text: T.view.commentSave });
    const status = actions.createSpan({ cls: "ai-wiki-comment-status" });
    saveBtn.addEventListener("click", () => void (async () => {
      const saved = await this.plugin.controller.commentRun(runId, ta.value);
      if (saved !== undefined) status.setText(T.view.commentSaved);
    })());
  }
```

- [ ] **Step 4: Route `finish()` through `renderResultFor`**

In `finish` (929), replace the block from `this.finalEl.empty();` (941) through the end of the rating-section `if` (964) — i.e. the original lines:

```ts
    this.finalEl.empty();
    if (entry.finalText) {
      const comp = new Component();
      comp.load();
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, "", comp);
      sanitizeLinks(this.finalEl);
      this.resultSection.removeClass("ai-wiki-hidden");
      this.finalEl.removeClass("ai-wiki-hidden");
      this.resultOpen = true;
      this.resultToggle.setText("▼");

      this.lastRunId = entry.id;
      // format renders its own axes in renderFormatPreview (near the preview);
      // every other operation gets a registry-driven rating row here.
      if (entry.status === "done" && entry.operation !== "format") {
        const axes = (OPERATION_AXES[entry.operation] ?? []).filter((a) => a.gate !== "vision");
        if (axes.length > 0) {
          this.ratingSection = this.resultSection.createDiv("ai-wiki-rating-section");
          const view = i18n().view as unknown as Record<string, string>;
          for (const ax of axes) {
            this.renderRatingRow(this.ratingSection, entry.id, ax.id, view[ax.labelKey]);
          }
        }
      }

      const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query"];
```

with (the rating/markdown block collapses into the shared call; the chat block is preserved):

```ts
    this.finalEl.empty();
    if (entry.finalText) {
      await this.renderResultFor(entry);
      this.lastRunId = entry.id;

      const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query"];
```

Leave the rest of `finish` (the `CHAT_OPS.includes(...)` block, `renderHistory()`, etc.) unchanged.

- [ ] **Step 5: Route the history-row click through `renderResultFor`**

In `renderHistory` (1259), replace the click handler body:

```ts
      row.addEventListener("click", () => {
        this.finalEl.empty();
        const comp = new Component();
        comp.load();
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp).then(() => sanitizeLinks(this.finalEl));
        this.resultSection.removeClass("ai-wiki-hidden");
        this.finalEl.removeClass("ai-wiki-hidden");
        this.resultOpen = true;
        this.resultToggle.setText("▼");
      });
```

with:

```ts
      row.addEventListener("click", () => void this.renderResultFor(it));
```

- [ ] **Step 6: Load persisted ratings + comment in the format preview**

In `renderFormatPreview` (852), replace the trailing `if (runId) { … }` block (919-926):

```ts
    if (runId) {
      const section = this.formatPreviewSection;
      const view = i18n().view as unknown as Record<string, string>;
      for (const ax of OPERATION_AXES["format"]) {
        if (ax.gate === "vision" && (visionCount ?? 0) === 0) continue;
        this.renderRatingRow(section, runId, ax.id, view[ax.labelKey]);
      }
    }
```

with:

```ts
    if (runId) {
      const section = this.formatPreviewSection;
      const view = i18n().view as unknown as Record<string, string>;
      const rid = runId;
      void (async () => {
        const persisted = await this.plugin.controller.readRun(rid);
        for (const ax of OPERATION_AXES["format"]) {
          if (ax.gate === "vision" && (visionCount ?? 0) === 0) continue;
          this.renderRatingRow(section, rid, ax.id, view[ax.labelKey], persisted?.ratings[ax.id] ?? null);
        }
        this.renderCommentBox(section, rid, persisted?.comment ?? "");
      })();
    }
```

- [ ] **Step 7: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no new lint errors. (If lint flags an unused `WikiOperation` or `Component` import, it is still used by the preserved chat block / other methods — do not remove.)

- [ ] **Step 8: Manual dev-mode verification**

With `devMode.enabled` true in plugin settings, in Obsidian:
1. Run a `query` → rate `answer` 👍, type a comment, click Save → "saved" appears.
2. Re-open the same result (click its history row) → the 👍 and the comment text are restored.
3. Click an **older** history entry of a different operation → its own (likely empty) rating/comment load; the previous entry's rating rows are gone (no leak).
4. Rate + comment that historical entry → reflected; confirm `eval.jsonl` got the `ratings`/`comment` for that `runId`.

- [ ] **Step 9: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): shared renderResultFor + comment box; historical rating, no cross-run leak"
```

---

## Task 5: DSPy `loader.py` — primary-axis signal + comment passthrough

**Files:**
- Modify: `scripts/dspy/lib/loader.py`, `scripts/dspy/CLAUDE.md` (Input Format)
- Test: `scripts/dspy/tests/test_loader.py`

**Interfaces:**
- Produces:
  - `PRIMARY_AXIS: dict[str, str]`
  - `resolve_signal(entry: dict, axis_override: str | None = None) -> str | None`
  - `load_examples` keeps a record iff `resolve_signal(entry) is not None`; the comment is left on the entry dict.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/dspy/tests/test_loader.py`:

```python
def test_keeps_record_by_ratings_map():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "ratings": {"answer": "up", "retrieval": "down"}},
        {"operation": "ingest", "question": "q2", "answer": "a2", "ratings": {"page": "down"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["query"]) == 1
    assert len(result["ingest"]) == 1


def test_scalar_fallback_when_no_ratings_map():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "rating": "up"},  # legacy
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["query"]) == 1


def test_ratings_map_takes_precedence_over_scalar():
    from lib.loader import resolve_signal
    entry = {"operation": "query", "ratings": {"answer": "down"}, "rating": "up"}
    assert resolve_signal(entry) == "down"  # primary axis wins over legacy scalar


def test_skips_when_primary_axis_unlabeled():
    path = _jsonl([
        # ratings map present but primary axis (answer) is null → no scalar → skip
        {"operation": "query", "question": "q1", "answer": "a1", "ratings": {"retrieval": "up"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert "query" not in result


def test_comment_passthrough():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "ratings": {"answer": "up"}, "comment": "more code examples"},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert result["query"][0]["comment"] == "more code examples"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd scripts/dspy && uv run pytest tests/test_loader.py -q`
Expected: the new tests fail (`resolve_signal` not importable; ratings-map records dropped because the old guard requires scalar `rating`).

- [ ] **Step 3: Implement `PRIMARY_AXIS` + `resolve_signal` and rewire the filter**

Replace the body of `scripts/dspy/lib/loader.py` with:

```python
from __future__ import annotations
import json
from collections import defaultdict

# Primary 👍/👎 axis per operation — the axis whose rating reflects output-prompt
# quality (mirrors src/eval-log.ts OPERATION_AXES + the spec PRIMARY_AXIS table).
PRIMARY_AXIS: dict[str, str] = {
    "query": "answer",
    "chat": "answer",
    "format": "formatting",
    "ingest": "page",
    "init": "coverage",
    "lint": "fix",
    "lint-chat": "fix",
    "delete": "rebuild",
}


def resolve_signal(entry: dict, axis_override: str | None = None) -> str | None:
    """Resolve the up/down training signal. Precedence: ratings[primary axis]
    (valid up/down) → legacy scalar `rating` → None. `axis_override` selects a
    non-primary axis (e.g. "recognition" for the deferred recognition pass)."""
    op = entry.get("operation")
    axis = axis_override or PRIMARY_AXIS.get(op)
    ratings = entry.get("ratings")
    if isinstance(ratings, dict) and axis and ratings.get(axis) in ("up", "down"):
        return ratings[axis]
    scalar = entry.get("recognitionRating") if axis_override == "recognition" else entry.get("rating")
    if scalar in ("up", "down"):
        return scalar
    return None


def _bucket(entry: dict) -> str:
    """Group key: format runs split by vision on/off; others by operation."""
    op = entry.get("operation")
    if op == "format":
        return "format:vision-on" if entry.get("vision") == "on" else "format:vision-off"
    return str(op)


def load_examples(
    log_path: str,
    operations: list[str] | None,
    min_examples: int,
) -> dict[str, list[dict]]:
    """
    Read the eval.jsonl dataset, group by bucket (operation, with format split by
    vision on/off), keep only records carrying a resolvable up/down signal (per-axis
    ratings map, or legacy scalar `rating`). Skips legacy judge-score lines and
    unlabeled rows. The free-form `comment` is carried through untouched.
    """
    grouped: dict[str, list[dict]] = defaultdict(list)

    with open(log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            op = entry.get("operation")
            if not op:
                continue
            if operations and op not in operations:
                continue
            # require a resolvable human label (per-axis or legacy scalar)
            if resolve_signal(entry) is None:
                continue

            grouped[_bucket(entry)].append(entry)

    return {
        b: entries
        for b, entries in grouped.items()
        if len(entries) >= min_examples
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd scripts/dspy && uv run pytest tests/test_loader.py -q`
Expected: all loader tests pass (the original scalar-based tests still green via fallback).

- [ ] **Step 5: Update the DSPy Input Format doc**

In `scripts/dspy/CLAUDE.md`, under `## Input Format`, replace the "Key fields" `rating` bullet and add two bullets so the section reads:

```markdown
- `ratings` — `{ "<axis>": "up" | "down" | null }` per-axis human labels (e.g. query → `answer`/`retrieval`). The optimizer uses the **primary axis** per operation (`query→answer, chat→answer, format→formatting, ingest→page, init→coverage, lint→fix, lint-chat→fix, delete→rebuild`).
- `rating` — legacy scalar `"up"|"down"|null`; used only as a fallback when `ratings` is absent.
- `comment` — optional free-form human note (one per run); aggregated into a seed "Human reviewer feedback" block by the optimizer.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/dspy/lib/loader.py scripts/dspy/tests/test_loader.py scripts/dspy/CLAUDE.md
git commit -m "feat(dspy/loader): primary-axis signal with scalar fallback + comment passthrough"
```

---

## Task 6: DSPy `optimizer.py` — primary-axis `up` + comment seed-feedback

**Files:**
- Modify: `scripts/dspy/lib/optimizer.py`
- Test: `scripts/dspy/tests/test_optimizer.py`

**Interfaces:**
- Consumes: `resolve_signal` (Task 5).
- Produces:
  - `build_feedback_block(trainset: list[dict], axis_override: str | None = None) -> str`
  - `run_mipro` derives `up` from `resolve_signal` and prepends the feedback block to the seed `template_content`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/dspy/tests/test_optimizer.py`:

```python
def test_build_feedback_block_groups_by_signal():
    from lib.optimizer import build_feedback_block
    trainset = [
        {"operation": "query", "ratings": {"answer": "down"}, "comment": "too vague"},
        {"operation": "query", "ratings": {"answer": "up"}, "comment": "great, keep examples"},
        {"operation": "query", "ratings": {"answer": "up"}, "comment": "great, keep examples"},  # dup → deduped
        {"operation": "query", "ratings": {}, "comment": "unrated note"},  # no signal → Notes
        {"operation": "query", "ratings": {"answer": "up"}},  # no comment → ignored
    ]
    block = build_feedback_block(trainset)
    assert "Problems to fix" in block and "too vague" in block
    assert "What to keep" in block and "great, keep examples" in block
    assert block.count("great, keep examples") == 1  # deduped
    assert "Notes" in block and "unrated note" in block


def test_build_feedback_block_empty_when_no_comments():
    from lib.optimizer import build_feedback_block
    assert build_feedback_block([{"operation": "query", "ratings": {"answer": "up"}}]) == ""


def test_build_feedback_block_caps_comment_length():
    from lib.optimizer import build_feedback_block
    long = "x" * 500
    block = build_feedback_block([{"operation": "query", "ratings": {"answer": "down"}, "comment": long}])
    assert "x" * 200 in block and "x" * 201 not in block  # trimmed to ~200 chars
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd scripts/dspy && uv run pytest tests/test_optimizer.py -q`
Expected: the three new tests fail (`build_feedback_block` does not exist). The existing `test_run_mipro_*` tests still pass.

- [ ] **Step 3: Implement `build_feedback_block` and wire it into `run_mipro`**

In `scripts/dspy/lib/optimizer.py`, add the import and helper, and update `run_mipro`.

Add at the top (after `from lib.signature import make_signature`):

```python
from lib.loader import resolve_signal

_COMMENT_CHAR_CAP = 200  # spec finding F-001: bound per-comment length
_BULLETS_PER_GROUP = 20


def build_feedback_block(trainset: list[dict], axis_override: str | None = None) -> str:
    """Aggregate human comments into a seed "Human reviewer feedback" block, grouped
    by the resolved up/down signal. Empty string when no comments — then the seed is
    byte-identical to today's behaviour."""
    fix: list[str] = []
    keep: list[str] = []
    notes: list[str] = []
    seen: set[str] = set()
    for e in trainset:
        c = (e.get("comment") or "").strip()
        if not c:
            continue
        c = c[:_COMMENT_CHAR_CAP]
        if c in seen:
            continue
        seen.add(c)
        sig = resolve_signal(e, axis_override)
        (fix if sig == "down" else keep if sig == "up" else notes).append(c)

    lines: list[str] = []

    def add(title: str, items: list[str]) -> None:
        if items:
            lines.append(f"## {title}")
            lines.extend(f"- {x}" for x in items[:_BULLETS_PER_GROUP])

    add("Problems to fix (human reviewer feedback)", fix)
    add("What to keep (human reviewer feedback)", keep)
    add("Notes (human reviewer feedback)", notes)
    return "\n".join(lines)
```

Then in `run_mipro`, replace the example-building block:

```python
    # recognition bucket uses recognitionRating; ":recognition" is reserved for the
    # deferred vision-recognition pass (not produced by optimize.py yet — Task 18).
    field = "recognitionRating" if operation.endswith(":recognition") else "rating"

    examples = [
        dspy.Example(
            user_message=entry.get("question", ""),
            reference=entry.get("answer", ""),
            up=(entry.get(field) == "up"),
        ).with_inputs("user_message")
        for entry in trainset
    ]
```

with:

```python
    axis_override = "recognition" if operation.endswith(":recognition") else None

    examples = [
        dspy.Example(
            user_message=entry.get("question", ""),
            reference=entry.get("answer", ""),
            up=(resolve_signal(entry, axis_override) == "up"),
        ).with_inputs("user_message")
        for entry in trainset
    ]

    # Seed-augmentation: fold human comments into the seed the optimizer rewrites.
    feedback = build_feedback_block(trainset, axis_override)
    seed = f"{feedback}\n\n{template_content}" if feedback else template_content
```

Then change the two later uses of `template_content` to `seed`:
- `sig = make_signature(template_content)` → `sig = make_signature(seed)`
- `return restore_placeholders(lm, template_content, compiled.signature.instructions)` → `return restore_placeholders(lm, seed, compiled.signature.instructions)`

- [ ] **Step 4: Run the full DSPy suite to verify it passes**

Run: `cd scripts/dspy && make test`
Expected: all tests pass — new `build_feedback_block` tests plus the unchanged `test_run_mipro_returns_string` / `test_run_mipro_rejects_regression` (their scalar `rating` resolves via fallback; no comments → empty block → seed unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/dspy/lib/optimizer.py scripts/dspy/tests/test_optimizer.py
git commit -m "feat(dspy/optimizer): primary-axis up signal + comment seed-feedback block"
```

---

## Task 7: `scripts/eval.ts` — migrate report reader to primary-axis + comment count

**Files:**
- Modify: `scripts/eval.ts`

**Interfaces:**
- Consumes: the same `eval.jsonl`. Normalizes `r.rating` / `r.recognitionRating` from the per-axis `ratings` map at parse time, so the existing report functions are unchanged.

- [ ] **Step 1: Extend the `Rec` interface**

In `scripts/eval.ts`, add two fields to `interface Rec` (after `recognitionRating?: Rating;`):

```ts
  ratings?: Record<string, Rating>;
  comment?: string;
```

- [ ] **Step 2: Add `PRIMARY_AXIS` + `resolveSignal` and normalize in `parseLog`**

Add above `parseLog`:

```ts
const PRIMARY_AXIS: Record<string, string> = {
  query: "answer", chat: "answer", format: "formatting", ingest: "page",
  init: "coverage", lint: "fix", "lint-chat": "fix", delete: "rebuild",
};

function resolveSignal(r: Rec, recognition = false): Rating {
  const axis = recognition ? "recognition" : PRIMARY_AXIS[r.operation];
  const m = r.ratings;
  if (m && axis && (m[axis] === "up" || m[axis] === "down")) return m[axis];
  const scalar = recognition ? r.recognitionRating : r.rating;
  return scalar === "up" || scalar === "down" ? scalar : null;
}
```

Replace `parseLog`:

```ts
function parseLog(text: string): Rec[] {
  const out: Rec[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as Rec;
      // keep human-labelled lines (per-axis ratings map OR legacy scalar); skip judge lines
      if (r && typeof r.operation === "string" && ("rating" in r || "ratings" in r)) {
        r.rating = resolveSignal(r, false);            // normalize for the report fns
        r.recognitionRating = resolveSignal(r, true);
        out.push(r);
      }
    } catch { /* skip malformed */ }
  }
  return out;
}
```

- [ ] **Step 3: Add a comment-count line to the report**

In `main`, after the `lines.push(\`eval.jsonl — ${recs.length} records (${logPath})\`);` line, add:

```ts
    const withComment = recs.filter((r) => (r.comment ?? "").trim().length > 0).length;
    lines.push(`comments: ${withComment}/${recs.length} records`);
```

- [ ] **Step 4: Run the report**

Run: `npm run eval -- --log scripts/dspy/tests/_smoke.jsonl` after creating a tiny mixed-format fixture:
```bash
printf '%s\n' \
  '{"operation":"query","question":"q","answer":"a","ratings":{"answer":"up"},"comment":"nice"}' \
  '{"operation":"query","question":"q2","answer":"a2","rating":"down"}' \
  > scripts/dspy/tests/_smoke.jsonl
npm run eval -- --log scripts/dspy/tests/_smoke.jsonl
```
Expected: prints `2 records`, `comments: 1/2 records`, and `Answer quality (query/chat): 50% 👍 (1/2)` (the new ratings-map line counted as `up`, the legacy scalar as `down`). Then remove the fixture: `rm scripts/dspy/tests/_smoke.jsonl`.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add scripts/eval.ts
git commit -m "feat(eval-report): read per-axis ratings map (scalar fallback) + comment count"
```

---

## Task 8: Update wiki docs via iwiki (mandatory per CLAUDE.md)

**Files:**
- Modify (via iwiki): `docs/wiki/operations.md#Dev-Mode Eval Dataset`, `docs/wiki/llm-pipeline.md#Dev-Mode Eval Record`

- [ ] **Step 1: Regenerate the two affected wiki pages**

Invoke the `iwiki:iwiki-ingest` skill for `src/eval-log.ts` and `src/view.ts` (rating/comment flow) and for `scripts/dspy/lib/loader.py` + `scripts/dspy/lib/optimizer.py` (DSPy reads ratings map + comment as seed feedback). The pages must now state: per-run `comment` field; historical rating + per-`runId` binding (no cross-run leak); format rating stays preview-only; DSPy primary-axis signal with scalar fallback and the comment seed-feedback block.

- [ ] **Step 2: Lint the docs graph**

Invoke the `iwiki:iwiki-lint` skill.
Expected: no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 3: Commit**

```bash
git add docs/wiki
git commit -m "docs(wiki): per-run comment, historical rating, DSPy ratings-map + seed feedback"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §3 → Task 1 (comment field) · §4 → Tasks 1–2 · §5/§5.1/§5.2/§5.3 → Task 4 · §5.4 → Task 3 · §6.1 → Task 5 · §6.2 → Task 6 · §6.3 → Task 7 · §6.4 → Task 5 step 5 · §7 (error handling) → Tasks 1/5/6 (undefined paths, empty block) · §8 → harness (T1), manual (T4), pytest (T5/T6), `npm run eval` (T7) · §9 → Task 8 · §10 → all tasks (`eval/eval-comment/run.ts` added in T1). Format historical-rating limitation (spec §5) honored by `entry.operation === "format"` guard in Task 4. F-001 (per-comment char cap) closed in Task 6 (`_COMMENT_CHAR_CAP = 200`).
- **Placeholder scan:** none — every code step shows full code; no TODO/TBD.
- **Type consistency:** `readEvalRecord`/`updateEvalComment` signatures identical across eval-log (T1) → controller (T2) → view (T4); `renderRatingRow`'s 5th param `initial: Rating` matches all three call sites (renderResultFor, renderFormatPreview); `resolve_signal` signature identical across loader (T5) and optimizer (T6); `PRIMARY_AXIS` keys identical in loader.py, optimizer (via loader), and eval.ts.
