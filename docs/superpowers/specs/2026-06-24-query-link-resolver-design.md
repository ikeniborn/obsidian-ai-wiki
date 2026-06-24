---
state: design
date: 2026-06-24
topic: query-link-resolver
branch: dev/query-link-resolver
---

# Query Link Resolver — Design Spec

## Problem

Every `query` run "works on broken links" and `lint` "fixes nothing". Root cause traced
from `_agent.jsonl` (query session `1782282897749`, lint session `1782282886112`):

- The query answer is generated as **free-form streamed text**. The prompt (`prompts/query.md`)
  only asks the model to "use WikiLinks `[[name]]`" plus an `index_block`; it gives no
  hard list of valid targets.
- The model repeatedly emits a couple of links in the wrong form (e.g. an abbreviation
  `[[DWM-88393]]` instead of the real page stem `[[wiki_rtk-task_dwm_88393]]`).
- `findBrokenLinks` catches them, then `FixingLinks` fires a **separate LLM call**
  (`rewriteWithValidLinks` in `query-link-validator.ts`) that rewrites the answer with valid
  stems → logged as `fixed`.
- The mechanism works, but it pays one extra LLM round-trip + latency on **every** query.
  That is the "every time" the user observes.

`lint` is unrelated: it repairs **vault files** (backlink index, dead links inside pages).
The broken links here live in the **runtime chat answer**, which lint never sees. Two
different spaces — the lint session correctly `Update`d 61 pages, but that has nothing to do
with answer links.

Two spaces of stems coexist in the vault and both land in `knownStems`
(`pageId(f) = basename(f, ".md")`):
- source notes — `Ростелеком/Задачи/ММД/DWM-88393 ….md` → stem `DWM-88393 …`
- generated wiki pages — `wiki_rtk-task_dwm_88393.md` → stem `wiki_rtk-task_dwm_88393`

### Diagnostic gap

The streamed `assistant_text` deltas are **not** logged (only reasoning / `assistant_replace`).
So the original broken form and the fix action are invisible in `_agent.jsonl`. That is part of
why the situation reads as "unclear what is happening". The design closes this gap first.

## Goals

1. **Reasoning quality** — structured output (`zod`) contract for the answer, as the user proposed.
2. **Remove the extra pass** — the model should yield valid links directly; the per-query
   rewrite LLM call should approach zero.
3. **Zero broken links** in the final answer (no leftover `*(not in wiki)*` annotations in the
   common case).
4. **Diagnosability** — make it visible in the log what was broken and how it was resolved.

Non-goals: touching `lint` / `ingest` / `init` pipelines; adding new user settings; changing the
vault file format.

## Approach A (chosen)

Deterministic resolver first (no LLM), structured `zod` layer as a typed fallback, prompt hardening
to attack the root cause. Hybrid streaming preserved.

### Components

1. **`src/phases/link-resolver.ts`** (new, ~60 lines) — deterministic, no LLM. Pure functions:
   - `resolveLink(brokenStem: string, candidates: string[]): { kind: "resolved"; stem: string } | { kind: "ambiguous" } | { kind: "unresolved" }`
   - `candidates` = context stems (`selectedIds`) ∪ `knownStems`, with `wiki_*` pages preferred.
   - Normalization: lowercase; strip a leading `wiki_<domain>_` prefix; drop spaces/hyphens; extract
     the id fragment (e.g. `88393`). Match candidates by that fragment, then **group matches by
     entity** (their normalized id fragment). A source note and its generated `wiki_*` page share
     the same fragment and are the **same entity**, not two candidates:
     - matches resolve to exactly 1 entity → `resolved`; pick its canonical stem, preferring the
       `wiki_*` representation over the source-note stem.
     - matches span ≥2 **distinct** entities (different id fragments that both contain the query
       fragment) → `ambiguous` (do **not** guess).
     - 0 matches → `unresolved`.
   - The `wiki_*` preference selects the canonical representation *within* a single entity; it is
     applied **after** entity grouping, so it never collapses two distinct entities into one
     `resolved` match.

2. **`QueryAnswerSchema`** (in `src/phases/zod-schemas.ts`):
   ```
   { reasoning: string, answer_markdown: string, citations: string[] }
   ```
   `superRefine`: every `citation` must be in `knownStems` (passed via closure, like existing
   WikiLink refinements). Used only on the fallback path.

3. **`src/phases/query.ts`** orchestration (block ~214–264) — replace the current
   `ValidateLinks` / `FixingLinks` LLM rewrite with:
   ```
   draft (stream reasoning live, as today)
     → extractAnswerLinks
     → findBrokenLinks vs knownStems
     → for each broken: link-resolver (0 LLM)
          resolved   → substitute stem in the answer text
          ambiguous  → strip / annotate *(not in wiki)*
          unresolved → collect into remainder
     → if remainder non-empty AND wikiLinkValidationRetries > 0:
          parseWithRetry(QueryAnswerSchema)  // 1 LLM, same role as today's rewrite,
                                             // now with a zod contract + feedback loop
     → assistant_replace(final)
   ```
   In the common case (format/abbreviation), the resolver fixes everything with **0 LLM calls**,
   so the extra pass disappears. The LLM fallback stays but rarely fires.

4. **`src/phases/query-link-validator.ts`** — keep `extractAnswerLinks`, `findBrokenLinks`,
   `annotateBroken`. The `rewriteWithValidLinks` LLM call is demoted to the fallback path (or
   folded into the `parseWithRetry` call); it is no longer the primary mechanism.

### Prompt hardening — `prompts/query.md`

Add a `{{available_links_block}}` placeholder; `query.ts` renders a numbered list of valid
context stems (`selectedIds`, `wiki_*` preferred):

```
Valid WikiLink targets (use EXACTLY these, copy verbatim):
- wiki_rtk-task_dwm_88393
- wiki_rtk-task_dwm_89729
...
ONLY link to a target from this list. Never invent or abbreviate stems.
```

This attacks the root cause — the model copies instead of abbreviating — driving resolver/fallback
frequency toward zero.

### Diagnostics

The `FixingLinks` `tool_result.preview` becomes structured so the outcome is legible in
`_agent.jsonl`:

```
resolved 2 (det): DWM-88393→wiki_rtk-task_dwm_88393, DWM-89729→wiki_rtk-task_dwm_89729
```

Distinguish outcomes: `resolved N (det)` / `llm-fixed N` / `stripped N` / `annotated N`. Now the
log shows both the broken form and the action taken — no guessing.

### Hybrid streaming

- Reasoning + draft stream live (`assistant_text`), unchanged.
- After resolver/validation, emit `assistant_replace` with the final, link-verified text
  (mechanism already exists).
- The `parseWithRetry` fallback has no answer streaming — stream reasoning, then show the final.

### Settings

Reuse the existing `wikiLinkValidationRetries` (default 3). `0` = resolver + strip only, no LLM
fallback at all. No new settings.

## Verification

No automated test suites in this project (removed 2026-06-16) — verify by running real code.

1. `npm run build` succeeds; eslint clean.
2. Re-run the same query on domain `rtk-task` ("Задачи в бэклоге и ожидании?"). Expect in the log:
   `resolved N (det)`, **no** separate `llm-fixed`, final answer with no `*(not in wiki)*`.
3. Negative case: a question that provokes a link to a non-existent page → expect
   `stripped` / `annotated`, never a raw broken link in the final answer.
4. Ambiguity case: a broken stem whose fragment matches **two distinct entities** (e.g. `88393`
   contained in both `wiki_x_88393` and `wiki_y_188393`) yields `ambiguous` → annotated, not a
   wrong guess. Conversely, a source note plus its `wiki_*` page (same entity) must `resolve` to
   the `wiki_*` stem, never be flagged ambiguous.
5. `iwiki:iwiki-ingest` the changed sources + `/iwiki-lint` (project post-task checklist).

## Risks / tradeoffs

- **Resolver heuristic** can mis-map on ambiguity. Mitigation: only auto-fix a unique match;
  ambiguous/unresolved → strip or annotate, never guess.
- **Unconfirmed broken form.** The exact original broken stem is not in the current log (deltas
  not logged). Phase 0 (diagnostics) lands first and confirms the pattern on real data before the
  resolver normalization rules are finalized.
- **structured output ≠ better prose.** JSON mode can distract the model from prose quality; the
  reasoning gain comes mainly from the explicit `reasoning` field. The structured layer is isolated
  to the fallback path, so the risk is contained.

## Implementation phases

- **Phase 0 — diagnostics:** structured `FixingLinks` preview; log the original broken stem.
  Confirms the broken-form pattern on real runs.
- **Phase 1 — resolver:** `link-resolver.ts` + wire into `query.ts`, replacing the primary LLM
  rewrite. Strip/annotate for ambiguous/unresolved.
- **Phase 2 — prompt hardening:** `{{available_links_block}}` in `query.md` + render in `query.ts`.
- **Phase 3 — structured fallback:** `QueryAnswerSchema` + `parseWithRetry` on the remainder path.
