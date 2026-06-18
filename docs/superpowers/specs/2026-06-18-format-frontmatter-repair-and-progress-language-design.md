---
review:
  spec_hash: e88cb6ebb62065b7
  last_run: 2026-06-18
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Out of scope (Bug 1 / Bug 2)"
      section_hash: dup-heading
      text: "Дублирующийся заголовок '### Out of scope' встречается дважды (стр. 90 под Bug 1, стр. 145 под Bug 2). Семантически валидно — разные H2-родители, но закрытый чек-лист structure это помечает."
      verdict: wontfix
      verdict_at: 2026-06-18
chain:
  intent: null
---
# Format: frontmatter repair in preview + progress language follows settings

Design spec. Date: 2026-06-18.

Three frontmatter/language regressions, two surfaced after the prompt/template i18n
work (commit `de2e79e`, "translate all prompts/templates to English") and the move to
settings-driven output language, plus a related source-frontmatter corruption in
ingest:

1. **Broken frontmatter is not restored in the format preview.** The wiki-field
   restoration and YAML normalization run only at apply time, behind a guard, so
   the `.formatted.md` preview shows a frontmatter that lost its `wiki_*` tracking
   fields and is not deterministically repaired.
2. **Progress text language is inconsistent.** Hardcoded Russian strings in the
   format flow precede LLM output that follows `outputLanguage`, producing a
   RU → EN switch mid-progress.
3. **Re-ingest loses the source's `wiki_*` backlink fields** (`wiki_added`,
   `wiki_updated`, `wiki_articles`) when the existing source frontmatter is broken
   (unfenced) — the upstream origin of the corruption in (1).

## Background

The format operation runs on non-wiki markdown pages. Flow:

- `runFormat` (`src/phases/format.ts`) reads the source, calls the LLM, writes the
  result to a sibling `*.formatted.md` temp file, and emits a `format_preview` event.
- On accept, `WikiController.formatApply` (`src/controller.ts:119`) reads the temp
  file, calls `patchWikiFields` (`src/controller.ts:39`), and writes the original path.

`patchWikiFields`:

```ts
function patchWikiFields(originalContent, formattedContent) {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;          // <-- guard
  // ... re-inject wiki_added / wiki_updated / wiki_articles
  const patched = upsertRawFrontmatter(formattedContent, { ... });
  const { content } = validateAndRepairSourceFrontmatter(patched);
  return content;
}
```

`validateAndRepairSourceFrontmatter` / `validateAndRepairFrontmatter`
(`src/utils/raw-frontmatter.ts`) are pure (only `yaml` + `wiki-stem` deps),
so they are importable from `src/phases/`.

### Concrete reproduction (from user logs)

Source `Шакшука с мясом и овощами.md` had a broken frontmatter — no `---` fences,
two bare `wiki_updated: 2026-06-16` lines. The LLM rebuilt a clean `---` block but,
per `_format_schema.md` rule ("`wiki_*` fields — do not include them in the output …
restored automatically"), dropped `wiki_updated`. The preview therefore showed no
`wiki_updated`; it would only reappear on apply via `patchWikiFields`. Output
language was `ru` here, so the language bug was not visible in that run.

## Bug 1 — restore broken frontmatter in the preview (Approach C)

Move frontmatter restoration onto the LLM output inside `runFormat`, before the
temp file is written, so the preview is already correct and deterministic.

### Behavior

In `src/phases/format.ts`, after the final formatted text is assembled
(after wiki-link fixing, around `format.ts:323`) and before `vaultTools.write(tempPath, …)`:

1. **Preserve wiki tracking fields.** If `original` contains a `wiki_updated`
   value (same detection as today), re-inject `wiki_added` / `wiki_updated` /
   `wiki_articles` from `original` into `finalFormatted` via `upsertRawFrontmatter`.
   When `original` has no `wiki_updated`, skip wiki injection (non-wiki page).
2. **Always normalize.** Run `validateAndRepairSourceFrontmatter(finalFormatted)`
   unconditionally on the result — deduplicate keys, drop invalid field values,
   normalize the YAML block. This is the deterministic safety net over the LLM
   output (invalid YAML / duplicate keys), independent of `wiki_updated` presence.
3. Use the normalized content as `finalFormatted` for the temp write and the
   `format_preview` event.

### Reuse, not duplication

Extract the body of `patchWikiFields` into a shared pure function (e.g.
`restoreSourceFrontmatter(original, formatted): string` in
`src/utils/raw-frontmatter.ts`) so both `runFormat` and `formatApply` call the
same logic. `WikiController.formatApply` keeps calling it (idempotent: a second
pass over an already-restored page is a no-op), or is simplified to trust the
already-restored temp content. Decision at implementation time; no behavior change
either way because the function is idempotent.

### Prompt reinforcement (secondary)

Add one explicit line to `_format_schema.md` / `prompts/format.md`: when the source
frontmatter is broken (missing/duplicated `---` fences, invalid YAML, fields out of
place), rebuild it into a single valid YAML frontmatter block, preserving real field
values. The LLM already does this well in observed cases; this hardens it.

### Out of scope

Deep YAML repair of genuinely unparseable blocks in `validateAndRepairFrontmatter`
(it currently returns the input unchanged on a parse error). The LLM regeneration
plus key-dedup safety net covers the observed failures; a full YAML-repair pass is
heavier and deferred.

## Bug 2 — progress language follows settings (resolveProgressLang + i18n section)

Localize the hardcoded Russian progress strings in `runFormat` so the whole
progress stream matches the configured language. Per decision: follow
`outputLanguage`; when it is `auto`, fall back to the Obsidian UI locale.

### Language resolution

Add a helper `resolveProgressLang(outputLanguage): "ru" | "en" | "es"`:

- `outputLanguage` is `ru` / `en` / `es` → use it verbatim.
- `outputLanguage` is `auto` (or undefined) → derive from `moment.locale()`:
  `ru*` → `ru`, `es*` → `es`, otherwise `en`.

`moment` is only available in the Obsidian runtime, so the resolution happens at
the call site (`src/agent-runner.ts`, the `format` case around line 149) where both
`settings.outputLanguage` and `moment` are reachable. The resolved
`progressLang` is passed into `runFormat` as a new parameter. The `phases/` layer
stays free of any `obsidian` import.

### i18n section

Add a `formatProgress` section to each language bundle in `src/i18n.ts` (en / ru / es)
covering every currently hardcoded string in `format.ts`:

| key | source line | shape |
|-----|-------------|-------|
| `analysing(path)` | 183 | fn(path) |
| `truncatedSalvageSummary` | 233 | string |
| `truncatedSalvageDetail` | 234, 265 | string |
| `truncatedSalvageRetrySummary` | 264 | string |
| `outputTruncated(hint)` | 241 | fn(hint) |
| `outputTruncatedAfterRetry(hint)` | 273 | fn(hint) |
| `sentinelInvalidRetry` | 248 | string |
| `sentinelInvalidAfterRetry` | 274 | string |
| `writeFailed(err)` | 329 | fn(err) |
| `truncationHintEnv` | 56 | string |
| `truncationHintSettings` | 57 | string |

Provide an explicit-language accessor: `i18n(lang?)` overload (or a sibling
`i18nFor(lang)`) that returns the bundle for an explicit language instead of
reading `moment.locale()`. `runFormat` resolves its progress strings through this
accessor with `progressLang`. The existing `moment.locale()`-driven `i18n()`
behavior for the rest of the plugin UI is unchanged.

`truncationHint(backend)` (lines 56-57) is included in this scope — same RU
hardcode in the same flow.

### Out of scope

The LLM-generated `report` and reasoning already follow `outputLanguage` via the
`## Language` directive — unchanged. UI strings elsewhere in the plugin keep
following `moment.locale()` — unchanged.

## Bug 3 — re-ingest restores source wiki_* backlink fields (broken-frontmatter tolerant)

On re-ingest, the source file's `wiki_*` backlink fields (`wiki_added`, `wiki_updated`,
`wiki_articles`) are lost when the existing source frontmatter is broken (no `---`
fences). Same corruption class as Bug 1, but on the **source-backlink write path** in
`runIngest` (`src/phases/ingest.ts:474-510`).

### Root cause

The source-backlink block reads the existing source state with helpers that require a
valid fenced block:

- `hasFrontmatterField(sourceContent, "wiki_added")` uses `FM_RE` → on an unfenced
  source it returns `false`, so `isFirstTime` becomes `true` and the original
  `wiki_added` date is overwritten with today.
- `parseWikiArticlesFromFm(sourceContent)` uses `FM_RE` → returns `[]`, so previously
  accumulated `wiki_articles` are dropped from the union.
- `upsertRawFrontmatter` then prepends a fresh fenced block but leaves the orphaned
  `wiki_updated:` lines in the body — producing the unfenced/duplicate state seen in
  the Bug 1 reproduction file.

This is the upstream origin of the broken frontmatter Bug 1 makes the formatter
tolerant of.

### Behavior

> **Revision 2026-06-18 (post-eval).** The original design below proposed
> `repairSourceFence`, which only wrapped a leading run of scalar key lines. The
> out-of-vault eval (`docs/superpowers/evals/2026-06-18-format-frontmatter-repair-eval.md`)
> proved it failed every realistic broken shape: duplicate keys crashed
> `upsertRawFrontmatter`'s `yaml.parse` (losing `wiki_added`), block-list `wiki_articles`
> items were stranded outside the fence, and a valid leading fence made `FM_RE.test`
> short-circuit recovery of body-stranded `wiki_*`. It was replaced by
> `recoverSourceFrontmatter` (below).

Add a pure helper `recoverSourceFrontmatter(content): string` to
`src/utils/raw-frontmatter.ts` that recovers a single valid fenced block, tolerant of:

- fully unfenced frontmatter (keys at the top, no `---`);
- duplicate keys (e.g. two `wiki_updated:` lines) — last occurrence wins;
- block-list values (`wiki_articles:` followed by indented `- "[[…]]"` items);
- `wiki_*` keys stranded in the body directly after an otherwise-valid leading fence.

Algorithm: take the leading fenced YAML (if any) as a seed; peel the leading run of
frontmatter-key lines from the body (skipping leading blanks, including indented list
items / continuations); merge seed + stray run and `yaml.parse(..., { uniqueKeys: false })`
(last-wins dedup); re-serialise a single `---` block and strip the stray lines from the
body. A page that already has a valid leading fence with no stray frontmatter, or one
with no frontmatter at all, is returned unchanged (idempotent). An unparseable collection
is returned unchanged for the downstream validator to handle.

In `runIngest`, before computing `isFirstTime` / `existingArticles` and before
`upsertRawFrontmatter` (line 474+), normalize the source once:
`const normalizedSource = recoverSourceFrontmatter(sourceContent)` and use
`normalizedSource` for all three reads and the upsert. Because the recovered block is
already deduped and single-fenced, `upsertRawFrontmatter` parses it cleanly (preserving
`wiki_added`), and `wiki_articles` becomes the correct union of the recovered existing
links and the newly written links. The downstream `validateAndRepairSourceFrontmatter`
pass (line 487) still runs as a final normalization.

### Field / merge policy (per decision)

- Restore/preserve: `wiki_added` (creation date never regresses — taken from the
  recovered existing frontmatter), `wiki_updated` (set to today), `wiki_articles`.
- `wiki_articles` = union(existing recovered, written this run) — already the code's
  intent; the fix makes "existing recovered" non-empty on broken sources.
- List-field union rule: keep the LLM/computed value when present; recover from the
  existing source only when it was dropped due to the broken fence.

### Out of scope

The no-op guard `if (written.length > 0 || deletedPaths.length > 0)` (line 462) is
left as-is: a re-ingest that writes nothing still does not touch the source. Repair
applies whenever the block runs (the normal re-ingest case, which writes ≥1 page).

## Files touched

- `src/phases/format.ts` — restore frontmatter on output; localize progress strings;
  new `progressLang` parameter.
- `src/utils/raw-frontmatter.ts` — extract shared `restoreSourceFrontmatter`; add `recoverSourceFrontmatter`.
- `src/phases/ingest.ts` — normalize source frontmatter via `recoverSourceFrontmatter` before the backlink reads/upsert (Bug 3).
- `src/controller.ts` — `patchWikiFields` reuses/aliases the shared function.
- `src/agent-runner.ts` — resolve `progressLang`, pass into `runFormat`.
- `src/i18n.ts` — `formatProgress` section (en/ru/es) + explicit-language accessor.
- `templates/_format_schema.md`, `prompts/format.md` — one repair line (secondary).

## Verification

No functional test suites in this repo (see memory `no-functional-tests`); verify by
build + lint + a real run:

- `npm run build` (or the project's typecheck) passes.
- Re-run format on the reproduction file `Шакшука с мясом и овощами.md`:
  - the `.formatted.md` preview contains a valid `---` block **including the
    preserved `wiki_updated`**;
  - with `outputLanguage = en`, the progress stream ("Analysing file …", salvage /
    retry notices) is fully English — no RU → EN switch;
  - with `outputLanguage = ru`, progress stays Russian;
  - with `outputLanguage = auto`, progress matches the Obsidian UI locale.
- Re-ingest a source whose frontmatter is broken (unfenced/duplicate `wiki_updated`,
  e.g. the Bug 1 reproduction file): after ingest the **source** file has a single
  valid `---` block with `wiki_added` preserved (not reset to today), `wiki_updated`
  = today, and `wiki_articles` = union of previously-recorded and newly-written links;
  no orphaned `wiki_*` lines remain in the body.
- `lat check` passes; `lat.md/` updated if behavior docs reference the format/ingest flow.
