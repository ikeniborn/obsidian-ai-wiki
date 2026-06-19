---
review:
  spec_hash: 1d70686d65f09008
  last_run: 2026-06-19
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Design"
      section_hash: 8dd614e31b5915a2
      text: "query listed as status-localization target but query.ts has no hardcoded status literal; query status lives in view.ts (step 3)"
      verdict: fixed
      verdict_at: 2026-06-19
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "Language resolution model"
      section_hash: 8c61369f44c44bc8
      text: "resolveProgressLang (old) and resolveLang (new) both appear; intentional rename, documented in step 4"
      verdict: accepted
      verdict_at: 2026-06-19
chain:
  intent: null
---

# Progress & Reasoning Language Design

## Problem

Progress-bar status strings (e.g. "Analysing file…", "Synthesizing wiki pages…")
appear in English even when the plugin's `outputLanguage` setting is `ru`. Separately,
there is no way to control the language the model *reasons* in, and the `auto` branch of
the content-language directive follows the **source note** language rather than the user's
setting or the Obsidian UI language.

## Root cause

Language output is split across three independent layers, and only one of them is wired
to the `outputLanguage` setting:

| Layer | What it is | Source of language today |
|-------|------------|--------------------------|
| **A. Status strings** | Fixed UI labels shown in the progress bar | Mostly hardcoded English. Only the FORMAT phase routes through an i18n bundle (`agent-runner.ts:150` → `i18nFor(resolveProgressLang(outputLanguage)).formatProgress`). |
| **B. Model reasoning** | The model's thinking stream shown as it works | Uncontrolled; no directive. |
| **C. Final content** | The generated wiki pages | `langInstruction(outputLanguage)` in the system prompt. `auto` → "reply in the source/article language". |

Hardcoded English status literals that bypass i18n:

- `src/phases/ingest.ts:114` — `Synthesizing wiki pages for domain "…"...`
- `src/phases/lint.ts:281` — `Evaluating domain "…" quality...`
- `src/phases/lint.ts:489` — `Actualizing domain config for "…"...`
- `src/phases/init.ts:57` — `Re-init: wiping …...`
- `src/phases/init.ts:61` — `removed N files`
- `src/phases/init.ts:175` — `ℹ <file>: N chars`
- `src/view.ts:633` — `Ingesting files…`
- `src/view.ts:639` — `Analysing files…`
- `src/view.ts:759` — `Analysing...`
- `src/view.ts:762` — `Forming response...`

These are emitted as `{ kind: "assistant_text", delta }` events (or set directly on the
view) and rendered verbatim — there is no translation layer.

## Language resolution model

Three resolver functions, one shared fallback chain. All concrete languages are one of
`ru | en | es`.

```
resolveLang(outputLanguage):                 // layers A (status) and C (content)
  ru | en | es explicit  → that
  auto                   → moment.locale() → ru | es, else en   (Obsidian UI language)

resolveReasoningLang(reasoningLanguage, outputLanguage):   // layer B
  ru | en | es explicit  → that
  auto                   → resolveLang(outputLanguage)          // setting → Obsidian
  (setting default value = "en")
```

Decisions captured from brainstorming:

- **Layer A** — localize by setting. All phases resolve their status bundle from
  `resolveLang(outputLanguage)`. No quality impact (these are not model output).
- **Layer B** — new explicit setting "Reasoning language". Default **English** (models
  reason best in English). `auto` chains down: plugin output language, then Obsidian.
- **Layer C** — `auto` now means **Obsidian UI language**, not source-note language.

## Design

### Layer A — fix status localization

1. `src/i18n.ts`: add per-phase progress key groups for `ingest`, `lint`, `init`
   (mirroring the existing `formatProgress` shape) to the `en`, `ru`, and `es` bundles.
   Pin `en.<phase>Progress` to its TypeScript type so the bundles can't drift (same
   technique already used for `en.formatProgress`). The query/chat flow has no hardcoded
   status literals in `query.ts` (it yields only model reasoning/content); its visible
   status labels are the `view.ts` ones handled in step 3.
2. Replace the hardcoded literals listed above with bundle lookups, resolving the bundle
   via `i18nFor(resolveLang(opts.outputLanguage))` inside each phase (phases already
   receive `opts.outputLanguage`).
3. `src/view.ts`: replace the four hardcoded labels with
   `i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.*` — keyed to the
   **setting**, not raw `i18n()` (Obsidian locale). Add the needed keys to the `view`
   bundle group.
4. Rename `resolveProgressLang` → `resolveLang` (it is now shared by layers A and C);
   update all call sites.

### Layer B — reasoning language setting

5. `src/types.ts`: add `reasoningLanguage: OutputLanguage` to `LlmWikiPluginSettings`,
   default `"en"`. Add to `LlmCallOptions` so phases can pass it through.
6. `src/settings.ts`: add a "Reasoning language" dropdown next to "Output language"
   (`auto` / `en` / `ru` / `es`); add i18n labels (`reasoningLanguage_name`,
   `reasoningLanguage_desc`) to all bundles.
7. `src/i18n.ts`: add `resolveReasoningLang(reasoningLanguage, outputLanguage)` per the
   model above.
8. `src/phases/llm-utils.ts`: inject a reasoning directive into the system prompt
   alongside the existing `## Language` block, e.g.
   `## Reasoning language\nThink and reason in <lang>.`, using
   `resolveReasoningLang(...)`. This is **best-effort**: the actual thinking-stream
   language depends on the provider/model and cannot be hard-guaranteed.

### Layer C — content auto → Obsidian

9. `src/phases/llm-utils.ts`: `langInstruction` accepts only a concrete `ru | en | es`;
   remove the `auto → follow source` branch. Resolve before calling:
   `langInstruction(resolveLang(opts.outputLanguage))`.
10. As a result, `auto` content language follows the Obsidian UI language.

## Tradeoff (layer C)

Removing the `auto → follow source` branch drops the "wiki page matches the source note's
language" behavior. A French note with Obsidian set to English now yields an English wiki
page. This is the explicit choice made during brainstorming (bind to Obsidian/setting,
not source).

## Files touched

- `src/i18n.ts` — resolvers, new bundle groups, type pinning
- `src/types.ts` — `reasoningLanguage` on settings + call options
- `src/settings.ts` — reasoning-language dropdown + labels
- `src/phases/llm-utils.ts` — concrete `langInstruction`, reasoning directive
- `src/view.ts` — localize the four hardcoded labels by setting
- `src/phases/ingest.ts`, `lint.ts`, `init.ts` — localize status strings
- `lat.md/` — update knowledge graph for the new resolution model + setting

## Verification

No automated test suite in this project (removed 2026-06-16; verify via lint/build/run).

- `tsc` / lint: clean build, type pinning catches bundle drift.
- Manual: with `outputLanguage = ru`, run ingest / lint / format → status strings Russian.
- Manual: `outputLanguage = auto` with Obsidian set to Russian → status strings Russian.
- Manual: reasoning default → English directive present; `reasoningLanguage = auto` →
  matches resolved content language.
- Manual: `outputLanguage = auto` with Obsidian English → content generated in English.
- `lat check` passes (links + code refs).
