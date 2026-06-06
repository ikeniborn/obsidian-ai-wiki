---
review:
  plan_hash: 7d2e0a69ccca594d
  spec_hash: 145818d2ad3646d0
  last_run: 2026-06-06
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-06-06-index-annotation-quality-intent.md
  spec:   docs/superpowers/specs/2026-06-06-index-annotation-quality-design.md
---
# Index Annotation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-page `_index.md` annotations rich and structured so query seed-selection (embedding cosine + Jaccard) stops missing relevant wiki pages, while preserving the single-line storage format.

**Architecture:** No new components. Three generation prompts emit a richer, structured annotation (summary + `Затрагивает:` + `Тип:` + `Термины:`) on a single logical line. One write-time normalization guard in `upsertIndexAnnotation` collapses any LLM-emitted whitespace/newlines to single spaces, protecting the parser's `(.+)$` regex from silent truncation. Storage format, parser, zod schema, Jaccard scorer, and embedding cache are untouched; the embedding cache re-embeds changed pages automatically via `annotationHash` mismatch.

**Tech Stack:** TypeScript, vitest, esbuild, lat.md knowledge graph. Russian-language prompts.

---

## Context for the implementer

You are editing an Obsidian plugin that builds a wiki from source documents. The flow:

```
ingest / lint / lint-chat
  → LLM emits page.annotation  (the ONLY text used to match a page at query time)
  → upsertIndexAnnotation()  writes  "- [[pid]] relPath — {annotation}"  into _index.md
  → refreshCache() re-embeds a page when its annotationHash changes
query
  → parseIndexAnnotations()  reads each line with regex  /^- \[\[([^\]]+)\]\] [^ ]+ — (.+)$/
  → embedding cosine / Jaccard rank pages by annotation text → seed selection
```

The problem: annotations today are one sparse sentence ("одно предложение"), so retrieval misses pages whose title doesn't contain the query's words. The fix is richer annotation **content** plus a guard so the richer text never breaks the single-line parser.

**Read before starting:**
- Spec: `docs/superpowers/specs/2026-06-06-index-annotation-quality-design.md`
- `src/wiki-index.ts` — `upsertIndexAnnotation` (line 57), `parseIndexAnnotations` (line 4)
- `tests/wiki-index.test.ts` — **already exists**; has `makeVt(initial)` helper at line 46 and existing describe blocks. You ADD cases, you do NOT create the file.
- `src/page-similarity.ts:485-512` — `refreshCache` re-embeds when `existing.hash !== hash`. No change needed here; confirm you understand why migration is automatic.

**Hard constraints (from spec):**
- No truncation of annotation content — only whitespace collapse. Cutting key terms would hurt recall.
- Do NOT touch `parseIndexAnnotations`, `src/page-similarity.ts`, `src/wiki-seeds.ts`, `src/zod-schemas.ts`, the file format, or the embedding cache structure.
- Coverage is gradual: existing pages keep sparse annotations until re-ingested/re-linted. No bulk regeneration.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/wiki-index.ts` | Single-line normalization guard inside `upsertIndexAnnotation` | Modify (line 73) |
| `tests/wiki-index.test.ts` | Guard + round-trip + backward-compat unit tests | Modify (add cases to existing describe blocks) |
| `prompts/ingest.md` | Rich annotation instruction | Modify (line 31) |
| `prompts/lint.md` | Rich annotation instruction | Modify (line 9) |
| `prompts/lint-chat.md` | Rich annotation instruction | Modify (lines 4-5) |
| `lat.md/operations.md` | Document that annotations are now rich/structured | Modify (`## Query` → `### Seed Selection`) |

---

## Task 1: Single-line normalization guard in `upsertIndexAnnotation`

The guard collapses any whitespace run (including newlines) in the annotation to a single space before the entry line is built. This enforces the single-line invariant: an LLM-emitted `\n` would otherwise make the parser's `(.+)$` capture only the text up to the newline and silently drop the rest.

**Files:**
- Modify: `src/wiki-index.ts:73`
- Test: `tests/wiki-index.test.ts` (add cases to existing `describe("upsertIndexAnnotation", ...)` and `describe("parseIndexAnnotations", ...)`)

- [ ] **Step 1: Write the failing tests**

Add these two cases inside the existing `describe("upsertIndexAnnotation", () => { ... })` block in `tests/wiki-index.test.ts` (e.g. after the `"uses 'general' when fullPath absent"` test at line 155, before the closing `});` at line 156). `parseIndexAnnotations` is already imported at the top of the file.

```ts
  it("collapses newlines in annotation to a single line", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "first line\nsecond line",
      "!Wiki/work/ops/p.md");
    const entry = written().split("\n").find((l) => l.includes("[[P]]")) ?? "";
    expect(entry).toBe("- [[P]] ops/p.md — first line second line");
    // parser reads the whole annotation back — nothing dropped at the newline
    expect(parseIndexAnnotations(written()).get("P")).toBe("first line second line");
  });

  it("collapses whitespace runs to a single space", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "foo   bar\t baz",
      "!Wiki/work/ops/p.md");
    expect(parseIndexAnnotations(written()).get("P")).toBe("foo bar baz");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wiki-index.test.ts -t "collapses"`
Expected: FAIL.
- "collapses newlines …" fails because the written entry is `- [[P]] ops/p.md — first line` with `second line` on the next physical line, so `parseIndexAnnotations` returns `"first line"` (rest dropped).
- "collapses whitespace runs …" fails because the annotation is written verbatim as `foo   bar\t baz`, so the parser returns `"foo   bar\t baz"`, not `"foo bar baz"`.

- [ ] **Step 3: Write the minimal implementation**

In `src/wiki-index.ts`, replace the single line 73:

```ts
  const entryLine = `- [[${pid}]] ${relPath} — ${annotation}`;
```

with:

```ts
  // collapse newlines / whitespace runs → single space; enforce single-line invariant
  // (not truncation — all content is preserved, only whitespace is normalized)
  const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
  const entryLine = `- [[${pid}]] ${relPath} — ${oneLineAnnotation}`;
```

- [ ] **Step 4: Run the failing tests to verify they pass**

Run: `npx vitest run tests/wiki-index.test.ts -t "collapses"`
Expected: PASS (2 passed).

- [ ] **Step 5: Add the round-trip and backward-compatibility characterization tests**

These two lock in invariants that must keep holding. Both pass against the implementation from Step 3.

Add the round-trip case inside `describe("upsertIndexAnnotation", ...)`, next to the cases from Step 1:

```ts
  it("round-trips a rich ~500-char structured annotation", async () => {
    const rich =
      "Задача Jira DG-49: доработка Excel-шаблона для экспорта и импорта " +
      "спецификаций в S3. Затрагивает: Excel-шаблон, спецификации, S3-экспорт, " +
      "маппинг колонок. Тип: доработка шаблона выгрузки/загрузки. " +
      "Термины: выгрузка, импорт, экспорт, признак исключения из представления, спецификация.";
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "dg-49", rich,
      "!Wiki/work/задачи/dg-49.md");
    // regex (.+)$ holds the full rich line with ':' and ',' intact
    expect(parseIndexAnnotations(written()).get("dg-49")).toBe(rich);
  });
```

Add the backward-compat case inside `describe("parseIndexAnnotations", ...)` (e.g. after the `"handles annotation containing em-dash within text"` test at line 41):

```ts
  it("still parses an old short single-sentence entry", () => {
    const content = "## entities\n- [[Alpha]] entities/Alpha.md — Краткое описание сущности.\n";
    expect(parseIndexAnnotations(content).get("Alpha")).toBe("Краткое описание сущности.");
  });
```

- [ ] **Step 6: Run the full wiki-index suite to verify nothing regressed**

Run: `npx vitest run tests/wiki-index.test.ts`
Expected: PASS — all existing tests plus the 4 new ones green. The existing em-dash test (`"foo — bar"`) still passes because its annotation already has only single spaces.

- [ ] **Step 7: Commit**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(wiki-index): collapse annotation whitespace to enforce single-line invariant

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite the annotation instruction in the 3 generation prompts

All three prompts currently ask for "одно предложение" (one sentence). Replace with the same rich, structured instruction in each so embedding/Jaccard see a uniform format. Prompt output is LLM-generated and not unit-tested for quality (verified later via Outcome Verification); these edits are verified by review + the full suite staying green.

**Files:**
- Modify: `prompts/ingest.md:31`
- Modify: `prompts/lint.md:9`
- Modify: `prompts/lint-chat.md:4-5`

- [ ] **Step 1: Edit `prompts/ingest.md`**

Replace line 31, currently:

```
- Для каждой страницы добавь поле "annotation" в JSON: одно предложение — описание сущности для поиска по смыслу
```

with:

```
- Для каждой страницы добавь поле "annotation" в JSON: богатое описание для семантического поиска (embedding + Jaccard). На ОДНОЙ строке, без переносов. Ориентир ~500 символов. Структура: <summary 1-2 предложения сути> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <синонимы и ключевые слова, которых может не быть в заголовке>. Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate — общие фразы поднимают шум в поиске.
```

Leave line 32 (`- Поле \`annotation\` — ТОЛЬКО в JSON-ответе…`) unchanged.

- [ ] **Step 2: Edit `prompts/lint.md`**

Replace line 9, currently:

```
- "annotation": одно предложение — описание сущности для поиска по смыслу
```

with:

```
- "annotation": богатое описание для семантического поиска (embedding + Jaccard). На ОДНОЙ строке, без переносов. Ориентир ~500 символов. Структура: <summary 1-2 предложения сути> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <синонимы и ключевые слова, которых может не быть в заголовке>. Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate — общие фразы поднимают шум в поиске.
```

Leave line 10 unchanged.

- [ ] **Step 3: Edit `prompts/lint-chat.md`**

This prompt embeds the annotation guidance inside the JSON return example. Add the shared instruction as a bullet before the JSON block, and shorten the inline value to a pointer.

Currently lines 4-5 read:

```
Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"...","annotation":"одно предложение — описание сущности для поиска по смыслу"}]}
```

Replace those two lines with:

```
Для каждой страницы поле "annotation" — богатое описание для семантического поиска (embedding + Jaccard). На ОДНОЙ строке, без переносов. Ориентир ~500 символов. Структура: <summary 1-2 предложения сути> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <синонимы и ключевые слова, которых может не быть в заголовке>. Конкретика, без воды и boilerplate.

Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"...","annotation":"<богатое однострочное описание: summary + Затрагивает + Тип + Термины>"}]}
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Run the prompt tests to confirm no regression**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS. `tests/prompts.test.ts` asserts on JSON structure keywords (`Верни ТОЛЬКО JSON`, `"reasoning"`, `"report"`, `"fixes"`, merge/collision/prefix rules) — none of which reference the annotation wording, so the edits do not break it.

- [ ] **Step 5: Review the diff for consistency**

Run: `git diff prompts/`
Confirm the three files use the same structured wording (`Затрагивает:`, `Тип:`, `Термины:`, `~500 символов`, "На ОДНОЙ строке") so embedding/Jaccard see a uniform annotation format.

- [ ] **Step 6: Commit**

```bash
git add prompts/ingest.md prompts/lint.md prompts/lint-chat.md
git commit -m "feat(prompts): emit rich structured single-line annotations for retrieval

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Document the change in lat.md and validate

The annotation is now a rich structured string, not a single sentence. Record this where seed selection is documented, then validate all wiki links and code refs. No tests.md spec section is added — the existing `wiki-index.test.ts` tests carry no `@lat:` reference, and `require-code-mention` only flags spec sections lacking a code ref (not code lacking a spec), so adding tests alone keeps `lat check` green.

**Files:**
- Modify: `lat.md/operations.md` (`## Query` → `### Seed Selection`, around line 84-88)

- [ ] **Step 1: Add a paragraph to `### Seed Selection`**

In `lat.md/operations.md`, the `### Seed Selection` section currently is:

```
### Seed Selection

Seeds are wiki page IDs most relevant to the question. Both embedding and Jaccard paths capture `seedScores: Record<string, number>` for tracing.

If seed selection yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs. See [[src/wiki-seeds.ts#selectSeeds]], [[src/phases/query.ts#llmSelectSeeds]], [[src/page-similarity.ts#PageSimilarityService]].
```

Insert a new paragraph between the leading paragraph and the `If seed selection yields nothing` paragraph, so the section reads:

```
### Seed Selection

Seeds are wiki page IDs most relevant to the question. Both embedding and Jaccard paths capture `seedScores: Record<string, number>` for tracing.

Each page's match text is its `_index.md` annotation, which is now a rich single-line structured string (summary + `Затрагивает:` entities + `Тип:` + `Термины:` synonyms), not a single sentence. `upsertIndexAnnotation` collapses any whitespace/newlines to single spaces so the richer text stays one line and `parseIndexAnnotations` reads it whole. Richer text gives embedding cosine and Jaccard more terms to match, improving recall for queries phrased with synonyms absent from the page title. Coverage is gradual — existing pages upgrade only on re-ingest/re-lint; a changed annotation triggers a per-page re-embed via `annotationHash`. See [[src/wiki-index.ts#upsertIndexAnnotation]], [[src/wiki-index.ts#parseIndexAnnotations]].

If seed selection yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs. See [[src/wiki-seeds.ts#selectSeeds]], [[src/phases/query.ts#llmSelectSeeds]], [[src/page-similarity.ts#PageSimilarityService]].
```

(The leading paragraph stays ≤250 chars; the new detail goes in a secondary paragraph, which has no length limit.)

- [ ] **Step 2: Run `lat check`**

Run: `lat check`
Expected: PASS — all wiki links and code refs resolve, all leading-paragraph rules hold. In particular, the new `[[src/wiki-index.ts#upsertIndexAnnotation]]` and `[[src/wiki-index.ts#parseIndexAnnotations]]` code refs resolve to the existing exported functions.

If `lat check` reports a broken code ref, verify the symbol path matches the export in `src/wiki-index.ts` (both are top-level `export function`s) and fix the link, then re-run.

- [ ] **Step 3: Commit**

```bash
git add lat.md/operations.md
git commit -m "docs(lat): annotations are now rich structured single-line strings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions across the suite (the only code change is the whitespace guard).

- [ ] **Run the linter**

Run: `npm run lint`
Expected: PASS — `eslint "src/**/*.ts"` clean. (`npm run lint` mirrors the Obsidian reviewer; the guard adds no node builtins, so no desktop-guard concerns.)

- [ ] **Confirm `lat check` is green**

Run: `lat check`
Expected: PASS.

---

## Outcome Verification (post-merge, manual — not part of the code tasks)

The measurable acceptance thresholds in the spec concern LLM output quality and cannot be unit-tested. Verify them against a real vault after re-ingesting the target sources (coverage is gradual — existing pages must be re-ingested/re-linted to gain rich annotations):

- **Recall / coverage** — on the benchmark query set that previously gave incomplete answers, top-K seed selection now covers the needed pages; answers are complete.
- **Precision@K ≥ baseline** — every page in the pre-change top-K remains in top-K; no previously-irrelevant page displaces a relevant one.
- **Latency** — seed-selection time increases ≤ 10% vs the pre-change baseline on the same query set.
- **Cost** — annotation length stays ≲ 500 chars (~150 embedding tokens/page); the format change re-embeds only changed pages, not the whole vault.

Per the spec Stop Rules: escalate if annotations bloat well past ~500 chars or if precision/latency degrade on the test query set.
