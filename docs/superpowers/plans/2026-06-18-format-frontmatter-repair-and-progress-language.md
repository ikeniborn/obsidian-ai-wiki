---
review:
  plan_hash: ac9c66362d322a72
  spec_hash: eaa0961ceaa62c13
  last_run: 2026-06-18
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: INFO
      section: "per-task Step titles"
      section_hash: repeated-step-titles
      text: "Заголовки шагов повторяются между тасками (Step 5: Commit и т.п.) — намеренная per-task структура шаблона writing-plans, не дефект."
      verdict: accepted
      verdict_at: 2026-06-18
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-18-format-frontmatter-repair-and-progress-language-design.md
---
# Format Frontmatter Repair + Progress Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the format operation restore broken frontmatter in the preview, and make the format progress stream follow the configured language.

**Architecture:** Extract the existing apply-time frontmatter restoration (`patchWikiFields`) into a shared pure function `restoreSourceFrontmatter` in `raw-frontmatter.ts`, and call it inside `runFormat` on the LLM output before writing the temp preview — so the preview already shows preserved `wiki_*` fields and normalized YAML. For language, resolve a `progressLang` at the `agent-runner` call site (`outputLanguage`, falling back to the Obsidian UI locale when `auto`), pass the matching `formatProgress` string bundle into `runFormat`, and replace every hardcoded Russian progress string with a bundle lookup.

**Tech Stack:** TypeScript, esbuild bundle, ESLint, Obsidian plugin runtime, `yaml`.

---

## Project Conventions (read before starting)

- **No test suites.** This repo has no vitest/pytest. Do NOT add test files. Verify every task with `npm run lint` and `npm run build`.
- **Do NOT use `tsc --noEmit` as a gate.** It currently fails on a pre-existing, unrelated error in `src/claude-cli-client.ts` (TS2416). The project gate is ESLint + esbuild build.
- **Docs language: English. Conversation: Russian.**
- **Branch:** work happens on `dev/format-fm-repair-progress-lang` (already created). Commit per task.
- After functional changes: update `lat.md/` and run `lat check` (final task).

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/utils/raw-frontmatter.ts` | Add `restoreSourceFrontmatter`, `repairSourceFence` | Shared pure restore + re-fence broken source frontmatter |
| `src/controller.ts` | Replace `patchWikiFields` with shared fn; fix imports | Apply-time path reuses the shared restore |
| `src/phases/ingest.ts` | Normalize source via `repairSourceFence` before backlink write | Re-ingest restores source `wiki_*` backlinks (Bug 3) |
| `src/phases/format.ts` | Call restore on output; add `progress` param; localize strings; thread `truncationHint` | Preview shows restored frontmatter; progress follows language |
| `src/i18n.ts` | Add `formatProgress` to en/ru/es; add `i18nFor`, `resolveProgressLang` | Localized progress strings + language resolution |
| `src/agent-runner.ts` | Resolve `progressLang`, pass bundle into `runFormat` | Wire language from settings |
| `templates/_format_schema.md`, `prompts/format.md` | One repair line | LLM-side hardening (secondary) |
| `lat.md/...` | Doc update | Keep knowledge graph current |

---

## Task 1: Extract `restoreSourceFrontmatter` and rewire controller

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (add function near the existing `validateAndRepairSourceFrontmatter`, around line 315-319)
- Modify: `src/controller.ts:25` (imports), `src/controller.ts:39-53` (remove `patchWikiFields`), `src/controller.ts:135`, `src/controller.ts:149` (call sites)

- [ ] **Step 1: Add the shared function in `raw-frontmatter.ts`**

Add immediately after the existing `validateAndRepairSourceFrontmatter` function (after line 319):

```ts
/**
 * Restores a source page's frontmatter onto formatted output.
 * - Preserves the wiki tracking fields (wiki_added / wiki_updated / wiki_articles)
 *   from `original` when it carries a wiki_updated value.
 * - ALWAYS normalizes the result (dedupe keys, drop invalid values, re-serialize YAML),
 *   independent of wiki_updated presence.
 * Idempotent: re-running on already-restored content yields the same content.
 */
export function restoreSourceFrontmatter(original: string, formatted: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(original);
  if (wikiUpdatedMatch) {
    const wiki_updated = wikiUpdatedMatch[1].trim();
    const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(original);
    const wiki_added = wikiAddedMatch?.[1].trim();
    const wiki_articles = parseWikiArticlesFromFm(original);
    formatted = upsertRawFrontmatter(formatted, { wiki_added, wiki_updated, wiki_articles });
  }
  const { content } = validateAndRepairSourceFrontmatter(formatted);
  return content;
}
```

All three helpers (`parseWikiArticlesFromFm`, `upsertRawFrontmatter`, `validateAndRepairSourceFrontmatter`) already live in this file — no new imports needed here.

- [ ] **Step 2: Replace the `patchWikiFields` import in controller**

In `src/controller.ts`, change line 25 from:

```ts
import { upsertRawFrontmatter, parseWikiArticlesFromFm, validateAndRepairSourceFrontmatter } from "./utils/raw-frontmatter";
```

to:

```ts
import { restoreSourceFrontmatter } from "./utils/raw-frontmatter";
```

(Those three names are only used inside `patchWikiFields`, which is being removed — so this is the full replacement. If `lint` later reports any of them still used elsewhere, re-add that single name.)

- [ ] **Step 3: Delete the `patchWikiFields` function**

Remove the whole block at `src/controller.ts:39-53`:

```ts
function patchWikiFields(originalContent: string, formattedContent: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;
  const wikiUpdated = wikiUpdatedMatch[1].trim();
  const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(originalContent);
  const wikiAdded = wikiAddedMatch?.[1].trim();
  const wikiArticles = parseWikiArticlesFromFm(originalContent);
  const patched = upsertRawFrontmatter(formattedContent, {
    wiki_added: wikiAdded,
    wiki_updated: wikiUpdated,
    wiki_articles: wikiArticles,
  });
  const { content } = validateAndRepairSourceFrontmatter(patched);
  return content;
}
```

- [ ] **Step 4: Update the two call sites**

At `src/controller.ts:135` change:

```ts
        const patched = patchWikiFields(originalContent, formattedContent);
```
to:
```ts
        const patched = restoreSourceFrontmatter(originalContent, formattedContent);
```

At `src/controller.ts:149` change:

```ts
        const patched = patchWikiFields(originalContent, content);
```
to:
```ts
        const patched = restoreSourceFrontmatter(originalContent, content);
```

- [ ] **Step 5: Verify lint + build**

Run: `npm run lint`
Expected: PASS (no `no-unused-vars` for the removed imports; no undefined `patchWikiFields`).

Run: `npm run build`
Expected: PASS — esbuild writes `main.js` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts src/controller.ts
git commit -m "refactor(format): extract restoreSourceFrontmatter, always normalize on apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Restore frontmatter on the format preview

**Files:**
- Modify: `src/phases/format.ts:9` (import), `src/phases/format.ts:324` (insert restore before temp write)

- [ ] **Step 1: Import the shared function in `format.ts`**

`src/phases/format.ts` line 9 currently imports from `./format-utils`. Add a new import line after it (after line 13, alongside the other `../` imports):

```ts
import { restoreSourceFrontmatter } from "../utils/raw-frontmatter";
```

- [ ] **Step 2: Apply restore to the final formatted text**

In `runFormat`, the final text is assembled around lines 320-324:

```ts
  finalFormatted = restoreObsidianEmbeds(original, finalFormatted);
  const embedWarnings = missingObsidianEmbeds(original, finalFormatted);

  const wlFix = fixWikiLinks(new Map([[filePath, finalFormatted]]), wikiLinkValidationRetries);
  finalFormatted = wlFix.fixed.get(filePath) ?? finalFormatted;
```

Immediately after the `wlFix` line (after current line 324) and before the `try { await vaultTools.write(tempPath, finalFormatted); }` block, add:

```ts
  finalFormatted = restoreSourceFrontmatter(original, finalFormatted);
```

This guarantees the temp preview file and the `format_preview` event (which uses `finalFormatted` and `missingTokensWithContext(original, finalFormatted)` at line 340-341) reflect the restored, normalized frontmatter — including the preserved `wiki_updated`.

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/format.ts
git commit -m "fix(format): restore broken frontmatter in the preview, not only on apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Add `formatProgress` strings + language helpers to i18n

**Files:**
- Modify: `src/i18n.ts:1` (import type), `src/i18n.ts` (add `formatProgress` to `en`, `ru`, `es` bundles), end of file (add `i18nFor`, `resolveProgressLang`)

- [ ] **Step 1: Import the `OutputLanguage` type**

`src/i18n.ts` line 1 is currently:

```ts
import { moment } from "obsidian";
```

Add below it:

```ts
import type { OutputLanguage } from "./types";
```

(`types.ts` does not import `i18n.ts`, so there is no import cycle. The build will confirm.)

- [ ] **Step 2: Add `formatProgress` to the `en` bundle**

`const en = { ... }` begins at line 3. Inside it, after the closing `}` of the `view:` section (and before `ctrl:` — placement inside `en` is what matters, the exact sibling order is free), add:

```ts
  formatProgress: {
    analysing: (path: string) => `Analysing file ${path}...\n`,
    truncatedSalvageSummary: "Format: response truncated — salvage",
    truncatedSalvageRetrySummary: "Format: retry response truncated — salvage",
    truncatedSalvageDetail: "Marker <<<END>>> missing; partial output used.",
    outputTruncated: (hint: string) =>
      `Format: response truncated by the model output limit — shorten the page or ${hint}`,
    outputTruncatedAfterRetry: (hint: string) =>
      `Format: response truncated by the model output limit (after retry) — shorten the page or ${hint}`,
    sentinelInvalidRetry: "\n[Sentinel invalid — retrying]\n",
    sentinelInvalidAfterRetry: "Format: LLM returned an invalid sentinel (after retry)",
    writeFailed: (err: string) => `Format: writing the formatted file failed — ${err}`,
    truncationHintEnv: "raise the limit: env CLAUDE_CODE_MAX_OUTPUT_TOKENS in iclaude.sh",
    truncationHintSettings: "raise the limit: Settings → per-operation → format → maxTokens",
  },
```

Because `type I18n = typeof en` (line 269), this defines the shape; `ru` and `es` must now provide the same keys or the build fails.

- [ ] **Step 3: Add `formatProgress` to the `ru` bundle (verbatim original strings)**

`const ru: I18n = { ... }` begins at line 271. Add this member inside it:

```ts
  formatProgress: {
    analysing: (path: string) => `Анализ файла ${path}...\n`,
    truncatedSalvageSummary: "Format: ответ обрезан — salvage",
    truncatedSalvageRetrySummary: "Format: retry ответ обрезан — salvage",
    truncatedSalvageDetail: "Маркер <<<END>>> отсутствует; использован частичный вывод.",
    outputTruncated: (hint: string) =>
      `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${hint}`,
    outputTruncatedAfterRetry: (hint: string) =>
      `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${hint}`,
    sentinelInvalidRetry: "\n[Sentinel невалиден — повторяю запрос]\n",
    sentinelInvalidAfterRetry: "Format: LLM вернул невалидный sentinel (после retry)",
    writeFailed: (err: string) => `Format: запись формата не удалась — ${err}`,
    truncationHintEnv: "увеличьте лимит: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh",
    truncationHintSettings: "увеличьте лимит: Settings → per-operation → format → maxTokens",
  },
```

- [ ] **Step 4: Add `formatProgress` to the `es` bundle**

`const es: I18n = { ... }` begins at line 537. Add this member inside it:

```ts
  formatProgress: {
    analysing: (path: string) => `Analizando archivo ${path}...\n`,
    truncatedSalvageSummary: "Format: respuesta truncada — recuperación",
    truncatedSalvageRetrySummary: "Format: reintento truncado — recuperación",
    truncatedSalvageDetail: "Falta el marcador <<<END>>>; se usó la salida parcial.",
    outputTruncated: (hint: string) =>
      `Format: respuesta truncada por el límite de salida del modelo — acorta la página o ${hint}`,
    outputTruncatedAfterRetry: (hint: string) =>
      `Format: respuesta truncada por el límite de salida del modelo (tras reintento) — acorta la página o ${hint}`,
    sentinelInvalidRetry: "\n[Sentinel inválido — reintentando]\n",
    sentinelInvalidAfterRetry: "Format: el LLM devolvió un sentinel inválido (tras reintento)",
    writeFailed: (err: string) => `Format: falló la escritura del archivo formateado — ${err}`,
    truncationHintEnv: "aumenta el límite: env CLAUDE_CODE_MAX_OUTPUT_TOKENS en iclaude.sh",
    truncationHintSettings: "aumenta el límite: Settings → per-operation → format → maxTokens",
  },
```

- [ ] **Step 5: Add `i18nFor` and `resolveProgressLang` at the end of the file**

The file ends with the existing `i18n()` (lines 805-808). After it, append:

```ts
const langBundles: Record<"ru" | "en" | "es", I18n> = { ru, en, es };

/** Returns the bundle for an explicit language, bypassing moment.locale(). */
export function i18nFor(lang: "ru" | "en" | "es"): I18n {
  return langBundles[lang];
}

/**
 * Resolves the language for operation progress strings.
 * Explicit outputLanguage wins; `auto`/undefined falls back to the Obsidian UI locale.
 */
export function resolveProgressLang(outputLanguage: OutputLanguage | undefined): "ru" | "en" | "es" {
  if (outputLanguage === "ru" || outputLanguage === "en" || outputLanguage === "es") {
    return outputLanguage;
  }
  const loc = moment.locale();
  if (loc.startsWith("ru")) return "ru";
  if (loc.startsWith("es")) return "es";
  return "en";
}
```

- [ ] **Step 6: Verify lint + build**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS — confirms `ru`/`es` satisfy the `I18n` shape (formatProgress present in all three).

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts
git commit -m "i18n(format): add formatProgress bundle (en/ru/es), i18nFor, resolveProgressLang

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Localize the format progress stream

**Files:**
- Modify: `src/phases/format.ts` (import type, `truncationHint`, `runFormat` signature + new param, 9 string sites)
- Modify: `src/agent-runner.ts` (import + resolve `progressLang`, pass bundle into `runFormat`)

- [ ] **Step 1: Import the bundle type into `format.ts`**

Add to `src/phases/format.ts` (type-only import — erased at build, keeps `phases/` free of an obsidian runtime dependency). Place near the top imports:

```ts
import type { I18n } from "../i18n";
```

Define a local alias type right below the imports (before `parseFormatOutput`):

```ts
type FormatProgress = I18n["formatProgress"];
```

- [ ] **Step 2: Make `truncationHint` take the progress bundle**

Replace the existing function at `src/phases/format.ts:54-58`:

```ts
function truncationHint(backend: "claude-agent" | "native-agent"): string {
  return backend === "claude-agent"
    ? "увеличьте лимит: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh"
    : "увеличьте лимит: Settings → per-operation → format → maxTokens";
}
```

with:

```ts
function truncationHint(backend: "claude-agent" | "native-agent", p: FormatProgress): string {
  return backend === "claude-agent" ? p.truncationHintEnv : p.truncationHintSettings;
}
```

- [ ] **Step 3: Add the `progress` parameter to `runFormat`**

The signature ends at `src/phases/format.ts:73` with `visionTempStore?: VisionTempStore,`. Add a new final parameter:

```ts
  visionTempStore?: VisionTempStore,
  progress: FormatProgress = enFormatProgressFallback,
): AsyncGenerator<RunEvent> {
```

To give the default a value without importing the runtime bundle, add this constant just above `runFormat` (after `truncationHint`):

```ts
// English fallback so runFormat is usable without an explicit bundle.
const enFormatProgressFallback: FormatProgress = {
  analysing: (path: string) => `Analysing file ${path}...\n`,
  truncatedSalvageSummary: "Format: response truncated — salvage",
  truncatedSalvageRetrySummary: "Format: retry response truncated — salvage",
  truncatedSalvageDetail: "Marker <<<END>>> missing; partial output used.",
  outputTruncated: (hint: string) =>
    `Format: response truncated by the model output limit — shorten the page or ${hint}`,
  outputTruncatedAfterRetry: (hint: string) =>
    `Format: response truncated by the model output limit (after retry) — shorten the page or ${hint}`,
  sentinelInvalidRetry: "\n[Sentinel invalid — retrying]\n",
  sentinelInvalidAfterRetry: "Format: LLM returned an invalid sentinel (after retry)",
  writeFailed: (err: string) => `Format: writing the formatted file failed — ${err}`,
  truncationHintEnv: "raise the limit: env CLAUDE_CODE_MAX_OUTPUT_TOKENS in iclaude.sh",
  truncationHintSettings: "raise the limit: Settings → per-operation → format → maxTokens",
};
```

- [ ] **Step 4: Replace the analysing line (current line 183)**

```ts
  yield { kind: "assistant_text", delta: `Анализ файла ${filePath}...\n` };
```
becomes:
```ts
  yield { kind: "assistant_text", delta: progress.analysing(filePath) };
```

- [ ] **Step 5: Replace the first salvage notice (current lines 231-235)**

```ts
    yield {
      kind: "info_text", icon: "⚠️",
      summary: "Format: ответ обрезан — salvage",
      details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
    };
```
becomes:
```ts
    yield {
      kind: "info_text", icon: "⚠️",
      summary: progress.truncatedSalvageSummary,
      details: [progress.truncatedSalvageDetail],
    };
```

- [ ] **Step 6: Replace the truncation error (current line 241)**

```ts
    yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };
```
becomes:
```ts
    yield { kind: "error", message: progress.outputTruncated(truncationHint(backend, progress)) };
```

- [ ] **Step 7: Replace the sentinel-retry notice (current line 248)**

```ts
    yield { kind: "assistant_text", delta: "\n[Sentinel невалиден — повторяю запрос]\n" };
```
becomes:
```ts
    yield { kind: "assistant_text", delta: progress.sentinelInvalidRetry };
```

- [ ] **Step 8: Replace the retry salvage notice (current lines 261-267)**

```ts
      yield {
        kind: "info_text", icon: "⚠️",
        summary: "Format: retry ответ обрезан — salvage",
        details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
      };
```
becomes:
```ts
      yield {
        kind: "info_text", icon: "⚠️",
        summary: progress.truncatedSalvageRetrySummary,
        details: [progress.truncatedSalvageDetail],
      };
```

- [ ] **Step 9: Replace the post-retry failure messages (current lines 271-274)**

```ts
    const retryTruncated = lastFinishReason === "length";
    const msg = retryTruncated
      ? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
      : "Format: LLM вернул невалидный sentinel (после retry)";
```
becomes:
```ts
    const retryTruncated = lastFinishReason === "length";
    const msg = retryTruncated
      ? progress.outputTruncatedAfterRetry(truncationHint(backend, progress))
      : progress.sentinelInvalidAfterRetry;
```

- [ ] **Step 10: Replace the write-failure error (current line 329)**

```ts
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
```
becomes:
```ts
    yield { kind: "error", message: progress.writeFailed((e as Error).message) };
```

- [ ] **Step 11: Resolve and pass `progress` from `agent-runner.ts`**

In `src/agent-runner.ts`, find the existing imports and add `resolveProgressLang, i18nFor`. If there is no import from `./i18n` yet, add:

```ts
import { resolveProgressLang, i18nFor } from "./i18n";
```

In the `case "format":` block, just before the `yield* runFormat(...)` call at line 149, add:

```ts
        const progress = i18nFor(resolveProgressLang(this.settings.outputLanguage)).formatProgress;
```

Then extend the call (currently ending `..., visionSettings, visionTempStore);`) to pass it as the last argument:

```ts
        yield* runFormat(formatArgs, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, wikiLinkValidationRetries, visionSettings, visionTempStore, progress);
```

(Keep the existing `wikiLinkValidationRetries` argument exactly as the current call spells it.)

- [ ] **Step 12: Verify no Russian progress strings remain in `format.ts`**

Run: `grep -nP '[А-Яа-яЁё]' src/phases/format.ts`
Expected: NO output (all hardcoded Russian moved to i18n).

- [ ] **Step 13: Verify lint + build**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/phases/format.ts src/agent-runner.ts
git commit -m "fix(format): progress stream follows outputLanguage (fallback UI locale)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Re-ingest restores source `wiki_*` backlink fields (Bug 3)

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (add `repairSourceFence` near the top, after `FM_RE`/regex consts around line 9)
- Modify: `src/phases/ingest.ts:19` (import), `src/phases/ingest.ts:474-486` (normalize source before reads/upsert)

- [ ] **Step 1: Add `repairSourceFence` to `raw-frontmatter.ts`**

After the regex constants near the top (after line 9, the `TAG_RE` line), add:

```ts
const FM_KEY_LINE = /^(wiki_[\w]+|tags|aliases|created|updated|external_links|related):/;

/**
 * Re-fences a source page whose frontmatter lost its `---` delimiters.
 * If the content already has a valid fenced frontmatter, returns it unchanged.
 * Otherwise wraps the leading run of frontmatter-key lines in a `---` block so the
 * standard FM_RE-based readers/repairers work. A page with no leading FM-key lines
 * is returned unchanged.
 */
export function repairSourceFence(content: string): string {
  if (FM_RE.test(content)) return content;
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && FM_KEY_LINE.test(lines[i])) i++;
  if (i === 0) return content;
  const fm = lines.slice(0, i).join("\n");
  const body = lines.slice(i).join("\n");
  return `---\n${fm}\n---\n${body}`;
}
```

(`FM_RE` is the module-level const at line 4; it has no global flag, so `.test()` is safe.)

- [ ] **Step 2: Import `repairSourceFence` in `ingest.ts`**

`src/phases/ingest.ts` line 19 imports from `../utils/raw-frontmatter`. Add `repairSourceFence` to that existing import list:

```ts
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField, validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, filterStaleWikiLinks, ensureWikiSources, stripInvalidWikiArticles, repairSourceFence } from "../utils/raw-frontmatter";
```

- [ ] **Step 3: Normalize the source before the backlink reads/upsert**

The current block at `src/phases/ingest.ts:474-486`:

```ts
    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(sourceContent).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !deletedStems.has(stem);
    });
    const writtenLinks = written.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
```

becomes (introduce `normalizedSource` and use it for all three reads + the upsert):

```ts
    const backlinkToday = new Date().toISOString().slice(0, 10);
    const normalizedSource = repairSourceFence(sourceContent);
    const isFirstTime = !hasFrontmatterField(normalizedSource, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(normalizedSource).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !deletedStems.has(stem);
    });
    const writtenLinks = written.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(normalizedSource, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
```

The downstream `validateAndRepairSourceFrontmatter(updatedSource)` (line 487-488) then deduplicates the now-fenced duplicate `wiki_updated` keys via its existing duplicate-key pre-merge logic. The wiki-page UPDATE path and the no-op guard at line 462 are intentionally left unchanged (out of scope per the spec).

- [ ] **Step 4: Verify lint + build**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts src/phases/ingest.ts
git commit -m "fix(ingest): re-fence broken source frontmatter so wiki_* backlinks are restored

Co-Authored-By: Claude Opus 4.8 <REDACTED>"
```

---

## Task 6: Prompt reinforcement for broken frontmatter (secondary)

**Files:**
- Modify: `templates/_format_schema.md:14` (Frontmatter section)
- Modify: `prompts/format.md` (HARD RULES list)

- [ ] **Step 1: Add a repair line to `_format_schema.md`**

`templates/_format_schema.md` line 14 currently reads:

```markdown
The `wiki_*` fields — do not include them in the output. They are managed programmatically and will be restored automatically.
```

Add a new paragraph directly after it:

```markdown
If the source frontmatter is broken — missing or duplicated `---` fences, invalid YAML, or fields placed outside a fenced block — rebuild it into a single valid YAML frontmatter block, preserving the real field values. Never emit two `---` fences in a row or leave frontmatter keys in the body.
```

- [ ] **Step 2: Add a matching HARD RULE to `prompts/format.md`**

In `prompts/format.md`, the `HARD RULES:` list ends just before `FORMATTING RULES:`. Add one bullet at the end of the HARD RULES list:

```markdown
- If the source frontmatter is broken (missing/duplicated `---` fences, invalid YAML, keys outside a fenced block), reconstruct a single valid YAML frontmatter block, preserving real values. Do not drop existing field values.
```

- [ ] **Step 3: Verify build (templates are bundled)**

Run: `npm run build`
Expected: PASS — `formatTemplate` / `formatSchemaDefault` imports still resolve.

- [ ] **Step 4: Commit**

```bash
git add templates/_format_schema.md prompts/format.md
git commit -m "docs(prompt): instruct format to rebuild broken frontmatter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Docs (lat.md) + final verification

**Files:**
- Modify: relevant `lat.md/` section(s) describing the format flow (locate first)
- Verify: full build, lint, lat check, real run

- [ ] **Step 1: Locate the format-flow doc section**

Run: `lat search "format frontmatter preview restore"`
Then: `lat locate "Format"` (or the section name search surfaces).
Read the matching section(s) under `lat.md/` that describe the format operation / frontmatter handling.

- [ ] **Step 2: Update the doc to reflect the new behavior**

In the located section, add/adjust prose to state: frontmatter restoration (preserve `wiki_*` + normalize) now runs inside `runFormat` on the LLM output before the preview is written (not only at apply), via the shared `restoreSourceFrontmatter`; and the format progress stream is localized via `resolveProgressLang` + `i18nFor`. Keep wiki links valid (`[[src/utils/raw-frontmatter.ts#restoreSourceFrontmatter]]`, `[[src/phases/format.ts#runFormat]]` if such refs are used in that file's style).

- [ ] **Step 3: Run lat check**

Run: `lat check`
Expected: PASS — no broken wiki links or code refs.

- [ ] **Step 4: Full lint + build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 5: Manual verification in the vault**

Reload the plugin in Obsidian (or rebuild + reload). On the reproduction file:
`ОКСАНА/Питание/Рецепты/Завтраки и полдники/Шакшука с мясом и овощами.md`

- Run Format. Open the generated `*.formatted.md` preview.
  - Expected: a single valid `---` frontmatter block that **includes `wiki_updated: 2026-06-16`**.
- Set Settings → Response language = English, run Format on a Russian source.
  - Expected: the progress stream ("Analysing file …", any salvage/retry notices) is fully English — no Russian preamble before English output.
- Set Response language = Russian → progress is Russian.
- Set Response language = Auto → progress matches the Obsidian UI locale.

Re-ingest check (Bug 3): run Ingest on a source whose frontmatter is broken
(unfenced/duplicate `wiki_updated`, e.g. `Шакшука с мясом и овощами.md`). After ingest,
open the **source** file:
- Expected: a single valid `---` block; `wiki_added` preserved if it existed (not reset
  to today); `wiki_updated` = today; `wiki_articles` = union of previously-recorded and
  newly-written links; no stray `wiki_*` lines left in the body.

If any expectation fails, fix in the relevant task's file before final commit.

- [ ] **Step 6: Commit docs**

```bash
git add lat.md
git commit -m "docs(lat): format restores frontmatter in preview; progress follows language

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Bug 1 Behavior (a preserve wiki_*, b always normalize, c preview reflects) → Task 1 (function) + Task 2 (call in runFormat). ✓
- Bug 1 Reuse (shared `restoreSourceFrontmatter`, formatApply idempotent) → Task 1. ✓
- Bug 1 Prompt (secondary) → Task 6. ✓
- Bug 1 Out of scope (no deep YAML repair) → respected; no task attempts it. ✓
- Bug 2 Language resolution (`resolveProgressLang`, auto→moment, resolve at agent-runner, progressLang into runFormat, phases obsidian-free via type-only import) → Task 3 + Task 4. ✓
- Bug 2 i18n (`formatProgress` en/ru/es, `i18nFor`, truncationHint included) → Task 3 + Task 4. ✓
- Bug 3 re-ingest source backlinks (`repairSourceFence`, normalize before reads/upsert, wiki_added/wiki_updated/wiki_articles preserved) → Task 5. ✓
- Bug 3 Out of scope (no-op guard, wiki-page UPDATE path) → respected; no task touches them. ✓
- Verification criteria → Task 7 Step 5 (format) + the re-ingest check there. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `restoreSourceFrontmatter(original, formatted)` signature identical across Task 1/2; `FormatProgress = I18n["formatProgress"]` keys identical in the en/ru/es bundles (Task 3) and the `format.ts` fallback + call sites (Task 4); `resolveProgressLang`/`i18nFor` names consistent between Task 3 definition and Task 4 usage. ✓
