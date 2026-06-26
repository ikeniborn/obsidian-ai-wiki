---
review:
  plan_hash: c9bc83346d26cff3
  spec_hash: 1d28ac7a1791836a
  last_run: 2026-06-26
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
      section: "Task 4: ingest provenance"
      section_hash: 2fd3130777fad1fe
      fragment: "source_paths: [sourceVaultPath], created_pages: createdPages, updated_pages: updatedPages, promptVersion: promptVersionOf(ingestTemplate)"
      text: "Spec §2 provenance table lists `found_pages` among the fields `ingest` must emit (`source_paths`, `created_pages`/`updated_pages`, `found_pages`, `promptVersion`), but Task 4 Step 2 emits only source_paths/created_pages/updated_pages/promptVersion — `found_pages` is dropped. The field is optional so the build still passes, but a downstream analyst expecting `found_pages` on ingest records per the spec will not get it. (Note: ingest currently emits NO eval_meta, so found_pages is not provided elsewhere.)"
      fix: "Either add `found_pages: written` (or the appropriate retrieved-pages list) to Task 4 Step 2's emitted fields to match the spec table, or amend the spec table to drop `found_pages` from the ingest row. Decide which is authoritative."
      verdict: fixed
      verdict_at: 2026-06-26
      resolution: "Fixed in plan: Task 4 now hoists a function-scoped `foundPages` array from the retrieval `union` Set and emits `found_pages: foundPages`. Matches spec §2 ingest row."
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "Task 5: init provenance"
      section_hash: ca53fc11d14e567e
      fragment: "files_processed: toAnalyze.length, domain: domainId, promptVersion: promptVersionOf(initTemplate)"
      text: "Spec §2 provenance table lists `created_pages` among the fields `init` must emit (`files_processed`, `created_pages`, `domain`, `promptVersion`), and the Task 3 Step 3 EvalMetaFields comment tags `created_pages` for `ingest / init / lint-chat`. But Task 5 (both the full-init and incremental emissions) emits only files_processed/domain/promptVersion — `created_pages` is never emitted for init. Plan under-delivers init provenance relative to the spec."
      fix: "Either add `created_pages` to Task 5's emitted fields (init does not currently expose a written-pages list at the summary yield — confirm a source exists before promising it), or amend the spec §2 table + the EvalMetaFields comment to drop init from the `created_pages` set."
      verdict: wontfix
      verdict_at: 2026-06-26
      resolution: "Wontfix (documented): init delegates page writes to a per-file loop and exposes no written-pages list at the summary yield; harvesting tool_use Create events is deferred to a follow-up. Task 5 Interfaces now documents the omission; EvalMetaFields comment narrowed to `// ingest` (F-003). Consistent with spec §2 prose 'each emits only the fields it already holds'."
    - id: F-003
      phase: consistency
      severity: INFO
      section: "Task 1 Step 3: EvalMetaFields fields"
      section_hash: 3136db2db8d12457
      fragment: "created_pages?: string[];   // ingest / init / lint-chat"
      text: "The doc-comment on `created_pages` claims it is used by `ingest / init / lint-chat`, but the plan only ever emits `created_pages` for ingest (Task 4). Task 5 (init) emits no created_pages and Task 7 (lint-chat) emits `articles`/`instruction`, not created_pages. The comment over-promises consumers. Harmless (comment only), but inconsistent with the emission tasks."
      fix: "Narrow the comment to `// ingest` (the only emitter), or align Tasks 5/7 to actually emit created_pages."
      verdict: fixed
      verdict_at: 2026-06-26
      resolution: "Fixed: comment narrowed to `// ingest`."
    - id: F-004
      phase: consistency
      severity: INFO
      section: "Task 7 Step 2: lint-chat provenance"
      section_hash: e4c4ea9ddf82db2f
      fragment: "const lastUserMsg = [...(req.chatMessages ?? [])].reverse().find((m) => m.role === \"user\")?.content ?? \"\";"
      text: "lint-chat.ts already binds `const chatMessages = req.chatMessages ?? []` at line 64; Task 7 Step 2 re-derives the same list from `req.chatMessages` instead of reusing the existing local. Compiles and works (ChatMessage has role/content per types.ts), just a minor duplication."
      fix: "Optionally reuse the existing `chatMessages` local: `[...chatMessages].reverse().find(...)`. Cosmetic; not blocking."
      verdict: accepted
      verdict_at: 2026-06-26
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-26-all-operations-eval-and-rating-reset-design.md
---

# Dev-mode eval for all operations + rating-button reset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dev-mode LLM operation ratable with per-operation 👍/👎 axes, write per-operation provenance to `eval.jsonl`, and fix the rating row leaking across runs.

**Architecture:** A `ratings: Record<axisId, Rating>` map replaces the scalar `rating`/`recognitionRating` on the eval record. A central `OPERATION_AXES` registry (in `eval-log.ts`) drives which axes each operation shows; `view.ts` reads it to render rating rows into a dedicated, reset-cleared `ratingSection`. Each phase emits an `eval_meta` event with operation-specific provenance.

**Tech Stack:** TypeScript (strict), esbuild bundle for an Obsidian plugin, ESLint. No unit-test framework in this repo — the per-task verification cycle is `npx tsc --noEmit` + `npm run lint` + `npm run build`, plus manual checks in Obsidian for UI tasks.

## Global Constraints

- Everything gated on `devMode.enabled`; the non-dev query/chat/format/vision path is untouched.
- Telemetry/labeling triggers **zero** LLM calls and no mid-run I/O: per run one append at run end, per rating click one read-modify-write.
- Mobile-safe: pure DOM, no new top-level (module-load) node-builtin import.
- Prompt text stays in `prompts/*.md`; provenance is emitted via the typed `eval_meta` event (no `info_text` text-parsing).
- `eval.jsonl` is per-device dev data (plugin dir, not synced) — no record migration is performed.
- Branch workflow: all work on `dev-all-ops-eval` (already created from `master`); merge to `master` via PR only.
- Verification commands: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

### Task 1: Rating schema, axis registry, and writer

**Files:**
- Modify: `src/eval-log.ts` (record schema, `RatingAxis`, `AxisDef`, `OPERATION_AXES`, `EvalMetaFields`, `updateEvalRating`)
- Modify: `src/agent-runner.ts:231-242` (record construction)

**Interfaces:**
- Produces: `OPERATION_AXES: Record<WikiOperation, AxisDef[]>`, `interface AxisDef { id: string; labelKey: string; gate?: "vision" }`, `EvalRecord.ratings: Record<string, Rating>`, `RatingAxis = string`, and the new optional `EvalMetaFields` keys. Consumed by Tasks 3–8.

- [ ] **Step 1: Replace the scalar rating fields and widen `RatingAxis` in `src/eval-log.ts`**

In `EvalRecord` (currently lines 40–49) replace:

```ts
  rating: Rating;
  recognitionRating?: Rating;
```

with:

```ts
  ratings: Record<string, Rating>;
```

Replace the `RatingAxis` type (currently line 52):

```ts
/** Rating axes a click can set. "answer"/"formatting" → `rating`; "recognition" → `recognitionRating`. */
export type RatingAxis = "answer" | "formatting" | "recognition";
```

with:

```ts
/** Canonical axis id (see OPERATION_AXES): answer | retrieval | formatting |
 *  recognition | page | links | coverage | fix | rebuild. */
export type RatingAxis = string;
```

- [ ] **Step 2: Add the axis registry to `src/eval-log.ts`**

Add a type-only import at the top of the file (after the existing `VaultAdapter` import):

```ts
import type { WikiOperation } from "./types";
```

Add, directly below the `RatingAxis` type:

```ts
/** A rating axis shown for an operation. `labelKey` indexes `i18n().view`;
 *  `gate: "vision"` means render only when the run actually ran vision. */
export interface AxisDef { id: string; labelKey: string; gate?: "vision"; }

/** Single source of truth for which 👍/👎 axes each operation exposes.
 *  Consumed by view.ts (render) and, later, eval.ts / dspy. */
export const OPERATION_AXES: Record<WikiOperation, AxisDef[]> = {
  query:       [{ id: "answer", labelKey: "ratingAnswer" }, { id: "retrieval", labelKey: "ratingRetrieval" }],
  chat:        [{ id: "answer", labelKey: "ratingAnswer" }],
  format:      [{ id: "formatting", labelKey: "ratingFormatting" }, { id: "recognition", labelKey: "ratingRecognition", gate: "vision" }],
  ingest:      [{ id: "page", labelKey: "ratingPage" }, { id: "links", labelKey: "ratingLinks" }],
  init:        [{ id: "coverage", labelKey: "ratingCoverage" }, { id: "page", labelKey: "ratingPage" }],
  lint:        [{ id: "fix", labelKey: "ratingFix" }],
  "lint-chat": [{ id: "fix", labelKey: "ratingFix" }],
  delete:      [{ id: "rebuild", labelKey: "ratingRebuild" }],
};
```

- [ ] **Step 3: Add per-operation provenance fields to `EvalMetaFields` in `src/eval-log.ts`**

Inside `interface EvalMetaFields` (currently lines 27–38), add these optional fields below the existing ones:

```ts
  created_pages?: string[];   // ingest
  updated_pages?: string[];   // ingest
  source_paths?: string[];    // ingest (sources fed to the run)
  files_processed?: number;   // init
  domain?: string;            // init
  articles?: string[];        // lint / lint-chat (article paths touched)
  instruction?: string;       // lint-chat (user message)
  deleted_source?: string;    // delete
  rebuilt_pages?: string[];   // delete
```

- [ ] **Step 4: Key `updateEvalRating` into the `ratings` map**

Replace the body loop of `updateEvalRating` (currently lines 90–103) — the field-selection and flip — with map keying:

```ts
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      if (!rec.ratings) rec.ratings = {}; // tolerate legacy lines
      const next: Rating = rec.ratings[axis] === rating ? null : rating; // flip / toggle off
      rec.ratings[axis] = next;
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return next;
    }
    return undefined; // no record matched runId
```

(The signature, the `axis: RatingAxis` parameter, the surrounding `try`/`catch`, and the doc-comment contract are unchanged.)

- [ ] **Step 5: Initialize `ratings: {}` in the writer (`src/agent-runner.ts`)**

Replace the record literal (currently lines 231–242):

```ts
          const record: EvalRecord = {
            runId: req.runId,
            ts: new Date().toISOString(),
            operation: req.operation,
            model,
            ...evalMeta,
            answer: evalMeta.answer ?? (req.operation === "format" ? undefined : finalResultText),
            llmErrors,
            ruleFirings,
            rating: null,
            ...(evalMeta.vision === "on" ? { recognitionRating: null } : {}),
          };
```

with:

```ts
          const record: EvalRecord = {
            runId: req.runId,
            ts: new Date().toISOString(),
            operation: req.operation,
            model,
            ...evalMeta,
            answer: evalMeta.answer ?? (req.operation === "format" ? undefined : finalResultText),
            llmErrors,
            ruleFirings,
            ratings: {},
          };
```

- [ ] **Step 6: Typecheck, lint**

Run: `npx tsc --noEmit`
Expected: PASS. (Type errors will appear in `view.ts` only if Task 3 is done out of order — `eval-log.ts` and `agent-runner.ts` themselves compile clean here because `view.ts` still references the now-removed `rating`/`recognitionRating`. If you implement tasks in order, run tsc here scoped: it is acceptable for `view.ts` to error until Task 3; confirm no error originates in `eval-log.ts` or `agent-runner.ts`.)

Run: `npm run lint`
Expected: no new errors in `src/eval-log.ts` / `src/agent-runner.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/eval-log.ts src/agent-runner.ts
git commit -m "feat(eval): ratings map + OPERATION_AXES registry + per-op provenance fields"
```

---

### Task 2: i18n axis labels (en / ru / es)

**Files:**
- Modify: `src/i18n.ts` (the `view` block in each of the en, ru, es locales)

**Interfaces:**
- Produces: `view.ratingRetrieval`, `view.ratingPage`, `view.ratingLinks`, `view.ratingCoverage`, `view.ratingFix`, `view.ratingRebuild` in every locale. Consumed by Task 3 via `OPERATION_AXES[*].labelKey`.

- [ ] **Step 1: Add the six new labels to the English `view` block**

After the existing `ratingRecognition: "Rate recognition:",` line (~line 187), add:

```ts
    ratingRetrieval: "Rate retrieval:",
    ratingPage: "Rate page quality:",
    ratingLinks: "Rate links:",
    ratingCoverage: "Rate coverage:",
    ratingFix: "Rate fixes:",
    ratingRebuild: "Rate rebuild:",
```

- [ ] **Step 2: Add the same six keys to the Russian `view` block**

After the Russian `ratingRecognition` line (~line 523 region), add:

```ts
    ratingRetrieval: "Оцените поиск:",
    ratingPage: "Оцените качество страницы:",
    ratingLinks: "Оцените связи:",
    ratingCoverage: "Оцените покрытие:",
    ratingFix: "Оцените правки:",
    ratingRebuild: "Оцените перестройку:",
```

- [ ] **Step 3: Add the same six keys to the Spanish `view` block**

Locate the `es` locale `view` block (search for the third occurrence of `ratingRecognition:` in the file) and add after its `ratingRecognition` line:

```ts
    ratingRetrieval: "Evaluar recuperación:",
    ratingPage: "Evaluar calidad de página:",
    ratingLinks: "Evaluar enlaces:",
    ratingCoverage: "Evaluar cobertura:",
    ratingFix: "Evaluar correcciones:",
    ratingRebuild: "Evaluar reconstrucción:",
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no error in `src/i18n.ts` (the `I18n = typeof en` shape now includes the new keys for every locale — if a locale is missing a key, tsc reports the mismatch here).

Run: `npm run lint`
Expected: clean for `src/i18n.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): rating axis labels for retrieval/page/links/coverage/fix/rebuild (en/ru/es)"
```

---

### Task 3: Render rating rows for every operation + fix reset/binding (`src/view.ts`)

**Files:**
- Modify: `src/view.ts` (new `ratingSection` field, `reset()` cleanup, registry-driven `finish()`, registry-driven `renderFormatPreview()`, `renderRatingRow` axis type)

**Interfaces:**
- Consumes: `OPERATION_AXES`, `AxisDef` from `./eval-log` (Task 1); `view.rating*` labels (Task 2).

- [ ] **Step 1: Import the registry**

Add to the existing import from `./eval-log` (or add a new import line near the top of `src/view.ts`):

```ts
import { OPERATION_AXES } from "./eval-log";
```

- [ ] **Step 2: Add the `ratingSection` field**

Next to `private lastRunId: string | null = null;` (line 122), add:

```ts
  private ratingSection: HTMLElement | null = null;
```

- [ ] **Step 3: Clear stale rating row + format preview on run start (`reset()`)**

In `reset()`, immediately after the existing lines (590–591):

```ts
    this.chatSection?.remove();
    this.chatSection = null;
```

add:

```ts
    this.ratingSection?.remove();
    this.ratingSection = null;
    this.formatPreviewSection?.remove();
    this.formatPreviewSection = null;
```

- [ ] **Step 4: Make `renderRatingRow` accept a string axis**

Change the signature of `renderRatingRow` (line 822–827) from:

```ts
  private renderRatingRow(
    parent: HTMLElement,
    runId: string,
    axis: import("./eval-log").RatingAxis,
    label: string,
  ): void {
```

to:

```ts
  private renderRatingRow(
    parent: HTMLElement,
    runId: string,
    axis: string,
    label: string,
  ): void {
```

(The body is unchanged — it already calls `controller.rateRun(runId, axis, rating)` and renders write-then-render.)

- [ ] **Step 5: Replace the hard-coded `answer`-only block in `finish()` with a registry loop**

In `finish()` replace the current block (lines 945–949):

```ts
      this.lastRunId = entry.id;
      const QC_OPS: WikiOperation[] = ["query", "chat", "lint-chat"];
      if (QC_OPS.includes(entry.operation) && entry.status === "done") {
        this.renderRatingRow(this.resultSection, entry.id, "answer", i18n().view.ratingAnswer);
      }
```

with:

```ts
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
```

- [ ] **Step 6: Make `renderFormatPreview` read the registry**

In `renderFormatPreview`, replace the trailing block (lines 913–919):

```ts
    if (runId) {
      const section = this.formatPreviewSection;
      this.renderRatingRow(section, runId, "formatting", i18n().view.ratingFormatting);
      if ((visionCount ?? 0) > 0) {
        this.renderRatingRow(section, runId, "recognition", i18n().view.ratingRecognition);
      }
    }
```

with:

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

- [ ] **Step 7: Typecheck, lint, build**

Run: `npx tsc --noEmit`
Expected: PASS (all references to the removed `rating`/`recognitionRating` are now gone).

Run: `npm run lint`
Expected: clean for `src/view.ts`.

Run: `npm run build`
Expected: build succeeds, writes `dist/main.js`.

- [ ] **Step 8: Manual smoke check (Obsidian)**

Copy `dist/main.js`, `dist/styles.css`, `dist/manifest.json` to `<vault>/.obsidian/plugins/ai-wiki/`, reload the plugin (dev mode enabled). Run a `query`, confirm two rows appear: "Rate this answer:" and "Rate retrieval:". Start an `ingest`: the query rows disappear; after it finishes, "Rate page quality:" and "Rate links:" appear. Click 👍 on `page` — it shows the green selected state.

- [ ] **Step 9: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): registry-driven per-op rating rows; clear ratingSection + format preview on reset"
```

---

### Task 4: `ingest` provenance (`src/phases/ingest.ts`)

**Files:**
- Modify: `src/phases/ingest.ts` (import `promptVersionOf`; emit `eval_meta` before the final `result`)

**Interfaces:**
- Consumes: `EvalMetaFields` keys `source_paths`, `created_pages`, `updated_pages`, `promptVersion` (Task 1).

- [ ] **Step 1: Import `promptVersionOf`**

Add near the other `src/phases/ingest.ts` imports:

```ts
import { promptVersionOf } from "../prompt-version";
```

- [ ] **Step 2: Hoist the retrieved-pages set so `found_pages` survives to the end**

The retrieved page ids live in a `union` Set scoped inside the `if (similarity)` block (declared at line 166), so they are not visible at the terminal yield. Hoist them into a function-scoped array.

Before line 152 (`let existingPages: Map<string, string>;`) add:

```ts
  const foundPages: string[] = [];
```

Inside the `if (similarity)` block, immediately after the `union`-building loop ends (after line 176, before the `info_text` yield at line 178), add:

```ts
    foundPages.push(...union);
```

- [ ] **Step 3: Emit `eval_meta` before the terminal `result`**

Immediately before the final result yield (line 582):

```ts
  yield { kind: "result", durationMs: Date.now() - start, text: resultText, outputTokens: outputTokens || undefined };
```

insert:

```ts
  const createdPages = written.filter((p) => createdThisRun.has(pageId(p)));
  const updatedPages = written.filter((p) => !createdThisRun.has(pageId(p)));
  yield {
    kind: "eval_meta",
    fields: {
      source_paths: [sourceVaultPath],
      created_pages: createdPages,
      updated_pages: updatedPages,
      found_pages: foundPages,
      promptVersion: promptVersionOf(ingestTemplate),
    },
  };
```

(`written`, `createdThisRun`, `sourceVaultPath`, `pageId`, `ingestTemplate`, and the hoisted `foundPages` are all in scope/imported in this file. `foundPages` is empty when retrieval is disabled — `found_pages: []` is fine.)

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean for `src/phases/ingest.ts`
Run: `npm run build` → succeeds

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "feat(ingest): emit eval_meta provenance (sources + created/updated/found pages + promptVersion)"
```

---

### Task 5: `init` provenance (`src/phases/init.ts`)

**Files:**
- Modify: `src/phases/init.ts` (import `promptVersionOf`; emit `eval_meta` before each terminal summary `result`)

**Interfaces:**
- Consumes: `EvalMetaFields` keys `files_processed`, `domain`, `promptVersion` (Task 1).
- Note: `created_pages` is intentionally **not** emitted for init. init delegates page writes to a per-file loop and exposes no written-pages list at the summary yield; harvesting `tool_use` Create events into a list is deferred to a follow-up. `files_processed` + `domain` identify the run for analysis. (This is the documented resolution of check-plan finding F-002.)

- [ ] **Step 1: Import `promptVersionOf`**

Add near the other `src/phases/init.ts` imports:

```ts
import { promptVersionOf } from "../prompt-version";
```

- [ ] **Step 2: Emit `eval_meta` before the full-init terminal `result`**

Immediately before the result yield whose text is ``Domain "${domainId}" initialised from ${toAnalyze.length} source files.`` (line ~384), insert:

```ts
  yield {
    kind: "eval_meta",
    fields: {
      files_processed: toAnalyze.length,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
```

- [ ] **Step 3: Emit `eval_meta` before the incremental terminal `result`**

Immediately before the result yield whose text is ``Domain "${domainId}": re-ingested ${doneCount} of ${changedFiles.length} changed source(s).`` (line ~465), insert:

```ts
  yield {
    kind: "eval_meta",
    fields: {
      files_processed: changedFiles.length,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
```

(`toAnalyze`, `changedFiles`, `domainId`, and `initTemplate` are already in scope/imported.)

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean for `src/phases/init.ts`
Run: `npm run build` → succeeds

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts
git commit -m "feat(init): emit eval_meta provenance (files_processed + domain + promptVersion)"
```

---

### Task 6: `lint` provenance (`src/phases/lint.ts`)

**Files:**
- Modify: `src/phases/lint.ts` (import `promptVersionOf`; emit `eval_meta` before the final `result`)

**Interfaces:**
- Consumes: `EvalMetaFields` keys `articles`, `promptVersion` (Task 1).

- [ ] **Step 1: Import `promptVersionOf`**

Add near the other `src/phases/lint.ts` imports:

```ts
import { promptVersionOf } from "../prompt-version";
```

- [ ] **Step 2: Emit `eval_meta` before the terminal `result`**

Immediately before the final result yield (line 674):

```ts
  yield { kind: "result", durationMs: Date.now() - start, text: reportParts.join("\n\n---\n\n"), outputTokens: outputTokens || undefined };
```

insert:

```ts
  yield {
    kind: "eval_meta",
    fields: {
      articles: filteredArticlePaths,
      promptVersion: promptVersionOf(lintTemplate),
    },
  };
```

(`filteredArticlePaths` and `lintTemplate` are already in scope/imported.)

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean for `src/phases/lint.ts`
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): emit eval_meta provenance (articles + promptVersion)"
```

---

### Task 7: `lint-chat` provenance (`src/phases/lint-chat.ts`)

**Files:**
- Modify: `src/phases/lint-chat.ts` (import `promptVersionOf`; emit `eval_meta` before the final `result`)

**Interfaces:**
- Consumes: `EvalMetaFields` keys `articles`, `instruction`, `promptVersion` (Task 1).

- [ ] **Step 1: Import `promptVersionOf`**

Add near the other `src/phases/lint-chat.ts` imports:

```ts
import { promptVersionOf } from "../prompt-version";
```

- [ ] **Step 2: Emit `eval_meta` before the terminal `result`**

Immediately before the final result yield (line 120):

```ts
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.summary, outputTokens: result.outputTokens || undefined };
```

insert:

```ts
  const lastUserMsg = [...(req.chatMessages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
  yield {
    kind: "eval_meta",
    fields: {
      articles: (parsed.pages ?? []).map((p) => p.path),
      instruction: lastUserMsg,
      promptVersion: promptVersionOf(lintChatTemplate),
    },
  };
```

(`req`, `parsed`, and `lintChatTemplate` are already in scope/imported; `req.chatMessages` is `ChatMessage[]` with `role`/`content`.)

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean for `src/phases/lint-chat.ts`
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint-chat.ts
git commit -m "feat(lint-chat): emit eval_meta provenance (articles + instruction + promptVersion)"
```

---

### Task 8: `delete` provenance + isolate inner ingest meta (`src/phases/delete.ts`)

**Files:**
- Modify: `src/phases/delete.ts` (imports; suppress inner ingest `eval_meta`; emit `delete` `eval_meta` before the final `result`)

**Interfaces:**
- Consumes: `EvalMetaFields` keys `deleted_source`, `rebuilt_pages`, `promptVersion` (Task 1).

- [ ] **Step 1: Add imports**

Add near the existing `src/phases/delete.ts` imports (it already imports `runIngest` from `./ingest`):

```ts
import ingestTemplate from "../../prompts/ingest.md";
import { promptVersionOf } from "../prompt-version";
```

- [ ] **Step 2: Stop forwarding the inner ingest `eval_meta`**

`delete` re-ingests each remaining source and already suppresses the inner `result` event. Suppress the inner `eval_meta` too, so the delete record carries delete's own provenance rather than the last rebuilt source's ingest provenance. In the rebuild loop, change (line 110):

```ts
        if (ev.kind === "result") continue;
```

to:

```ts
        if (ev.kind === "result" || ev.kind === "eval_meta") continue;
```

- [ ] **Step 3: Emit `eval_meta` before the terminal `result`**

Immediately before the final result yield (line 167):

```ts
  yield { kind: "result", durationMs: Date.now() - start, text };
```

insert:

```ts
  yield {
    kind: "eval_meta",
    fields: {
      deleted_source: sourcePath,
      rebuilt_pages: plan.toRebuild,
      promptVersion: promptVersionOf(ingestTemplate),
    },
  };
```

(`sourcePath` and `plan` are already in scope.)

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean for `src/phases/delete.ts`
Run: `npm run build` → succeeds

- [ ] **Step 5: Commit**

```bash
git add src/phases/delete.ts
git commit -m "feat(delete): emit eval_meta provenance (deleted_source + rebuilt_pages); isolate inner ingest meta"
```

---

### Task 9: End-to-end verification + docs/wiki update

**Files:**
- Modify: `docs/wiki/llm-pipeline.md`, `docs/wiki/operations.md` (regenerated via iwiki)

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Full build + lint + typecheck**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → clean (whole `src/`)
Run: `npm run build` → succeeds

- [ ] **Step 2: Deploy to the test vault**

Copy `dist/main.js`, `dist/styles.css`, `dist/manifest.json` to
`/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/` and reload the plugin (dev mode enabled).

- [ ] **Step 3: Reset/binding check**

Run a `query`, click 👍 on "Rate this answer:". Start an `ingest`. Confirm the query rating rows are **gone** and the ingest result shows `page` / `links` rows bound to the new run. Open `eval.jsonl` in the plugin dir: the query record has `ratings.answer = "up"`; the ingest record is a separate line with a different `runId` and its own provenance (`source_paths`, `created_pages`, `updated_pages`, `promptVersion`).

- [ ] **Step 4: Per-operation sweep**

Exercise `init`, `lint`, `lint-chat`, `delete`, `chat`, `format`. For each, confirm: a record line is appended with the operation's provenance fields; the rendered axes match `OPERATION_AXES`; clicking an axis sets `ratings.<axis>`; a re-click toggles it back to `null`. For `format` with vision on, confirm both `formatting` and `recognition` rows appear; with vision off, only `formatting`.

- [ ] **Step 5: Update docs/wiki via iwiki**

Run `iwiki:iwiki-ingest` for the changed sources so the wiki reflects the new behavior:
- `docs/wiki/llm-pipeline.md` — per-run record now carries a `ratings` map keyed by per-operation axis ids (from `OPERATION_AXES`) plus per-operation `eval_meta` provenance; drop any scalar-`rating` description.
- `docs/wiki/operations.md` — every LLM operation now writes an `eval.jsonl` record with operation-specific provenance and renders dev-mode rating rows.

Then run `/iwiki-lint` — no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 6: Commit docs**

```bash
git add docs/wiki/llm-pipeline.md docs/wiki/operations.md
git commit -m "docs(wiki): all-operations eval ratings map + per-op provenance"
```

---

## Notes for the implementer

- **Why no unit tests:** this repo has no test runner (`package.json` exposes only `build`, `dev`, `lint`, `eval`). The TDD loop is replaced by `tsc --noEmit` + `lint` + `build` per task, plus the manual Obsidian checks in Tasks 3 and 9. Do not introduce a test framework.
- **Records already exist for all ops:** the writer at `agent-runner.ts:230` is generic, so `ingest`/`init`/`lint`/`delete` records are already written; Tasks 4–8 only add provenance, and Tasks 1–3 add the rating map + UI.
- **`format` is the one render exception:** its axes live in `renderFormatPreview` (next to the preview the user reviews), not in `finish()`. Both read `OPERATION_AXES["format"]`.
- **delete's record** intentionally reflects the delete orchestration (`deleted_source`, `rebuilt_pages`) — inner ingest meta is suppressed (Task 8 Step 2).
