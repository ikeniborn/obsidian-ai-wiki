---
review:
  plan_hash: 73216f921d92a4a2
  spec_hash: 1d70686d65f09008
  last_run: 2026-06-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: dependencies
      severity: WARNING
      section: "Task 4"
      section_hash: 6bc0e8724a3ab816
      text: "Task 4 Step 6 phrasing could be misread as duplicating injectLanguageDirective; clarified to explicit replace + single-call note"
      verdict: fixed
      verdict_at: 2026-06-19
    - id: F-002
      phase: dependencies
      severity: WARNING
      section: "Task 6"
      section_hash: 6b332002b5fd4b7a
      text: "i18n.ts line anchors in Task 6 are pre-Task-5 estimates and may shift; mitigated by content-described anchors (after formatProgress block)"
      verdict: accepted
      verdict_at: 2026-06-19
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "Task 9"
      section_hash: d1b8fadd5c1a9b52
      text: "Task 9 Step 2 (docs content) has no deterministic DoD beyond Step 3 lat check; acceptable for a docs task"
      verdict: accepted
      verdict_at: 2026-06-19
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-19-progress-reasoning-language-design.md
---

# Progress & Reasoning Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize progress-bar status strings by the `outputLanguage` setting, add a separate "Reasoning language" setting for the model's thinking, and make the content-language `auto` branch follow the Obsidian UI language instead of the source note.

**Architecture:** One shared resolver `resolveLang` (rename of `resolveProgressLang`) drives status strings (layer A) and content language (layer C); a new `resolveReasoningLang` drives the model reasoning directive (layer B). Phases resolve their i18n bundle from `opts.outputLanguage`; `buildChatParams` centrally injects both the content-language and reasoning-language directives into the system prompt.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, `moment.locale()` for Obsidian UI locale. No automated test suite (removed 2026-06-16) — every task verifies with `npx tsc --noEmit`, `npm run lint`, and a manual check; docs validated with `lat check`.

> **Note on verification:** This repo has no unit tests. Each task's "verify" step runs the type-checker and linter (which catch i18n bundle drift via the `: I18n` annotation on the `ru`/`es` bundles) plus a targeted manual check. Do not add a test framework.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/i18n.ts` | Locale bundles + resolvers | Rename resolver, add `resolveReasoningLang`, add status-string groups (`ingestProgress`/`lintProgress`/`initProgress`) + two `view` keys, add reasoning-setting labels |
| `src/types.ts` | Settings + call-option types | Add `reasoningLanguage` to `LlmWikiPluginSettings`, `DEFAULT_SETTINGS`, `LlmCallOptions` |
| `src/settings.ts` | Settings UI | Add "Reasoning language" dropdown |
| `src/phases/llm-utils.ts` | Prompt assembly | `langInstruction` → concrete lang; resolve content lang; inject reasoning directive |
| `src/phases/attachment-analyzer.ts` | Vision prompts | Resolve lang before `langInstruction` |
| `src/agent-runner.ts` | Builds `opts`, runs phases | Plumb `reasoningLanguage`; rename resolver call |
| `src/phases/ingest.ts`, `lint.ts`, `init.ts` | Phase status strings | Replace hardcoded English with bundle lookups |
| `src/view.ts` | Progress UI | Localize four labels by setting |
| `lat.md/` | Knowledge graph | Document the resolution model + reasoning setting |

---

## Task 1: Rename `resolveProgressLang` → `resolveLang`

It becomes the shared resolver for both status (A) and content (C). Pure rename + call-site update.

**Files:**
- Modify: `src/i18n.ts:887` (definition + doc comment)
- Modify: `src/agent-runner.ts:150` (call site)

- [ ] **Step 1: Rename the definition in `src/i18n.ts`**

Replace lines 883–895:

```ts
/**
 * Resolves a concrete language for status strings (layer A) and generated content (layer C).
 * Explicit outputLanguage wins; `auto`/undefined falls back to the Obsidian UI locale.
 */
export function resolveLang(outputLanguage: OutputLanguage | undefined): "ru" | "en" | "es" {
  if (outputLanguage === "ru" || outputLanguage === "en" || outputLanguage === "es") {
    return outputLanguage;
  }
  const loc = moment.locale();
  if (loc.startsWith("ru")) return "ru";
  if (loc.startsWith("es")) return "es";
  return "en";
}
```

- [ ] **Step 2: Update the call site in `src/agent-runner.ts`**

Line 16 import:

```ts
import { resolveLang, i18nFor } from "./i18n";
```

Line 150:

```ts
        const progress = i18nFor(resolveLang(this.settings.outputLanguage)).formatProgress;
```

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rn "resolveProgressLang" src/`
Expected: no output.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts src/agent-runner.ts
git commit -m "refactor(i18n): rename resolveProgressLang to resolveLang (shared A+C)"
```

---

## Task 2: Add `resolveReasoningLang`

Resolves the reasoning-directive language (layer B). Explicit wins; `auto` chains to the content resolver; undefined defaults to English.

**Files:**
- Modify: `src/i18n.ts` (add after `resolveLang`, ~line 896)

- [ ] **Step 1: Add the resolver in `src/i18n.ts`**

Insert immediately after the `resolveLang` function:

```ts
/**
 * Resolves the language for the model's reasoning directive (layer B).
 * Explicit reasoningLanguage wins; `auto` chains to the content resolver
 * (setting → Obsidian); undefined defaults to English.
 */
export function resolveReasoningLang(
  reasoningLanguage: OutputLanguage | undefined,
  outputLanguage: OutputLanguage | undefined,
): "ru" | "en" | "es" {
  if (reasoningLanguage === "ru" || reasoningLanguage === "en" || reasoningLanguage === "es") {
    return reasoningLanguage;
  }
  if (reasoningLanguage === "auto") {
    return resolveLang(outputLanguage);
  }
  return "en";
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add resolveReasoningLang resolver"
```

---

## Task 3: Layer C — content `auto` → Obsidian

Make `langInstruction` take a concrete language and drop the `auto → follow source` branch; resolve at the call sites.

**Files:**
- Modify: `src/phases/llm-utils.ts:7-14` (`langInstruction`), `:140` (buildChatParams), `:181-184` (directive param type)
- Modify: `src/phases/attachment-analyzer.ts:94-104` (vision system prompts)

- [ ] **Step 1: Make `langInstruction` concrete-only in `src/phases/llm-utils.ts`**

Replace lines 6–14:

```ts
/** Maps a concrete output language to a one-line reply directive for the system prompt. */
export function langInstruction(lang: "ru" | "en" | "es"): string {
  switch (lang) {
    case "ru": return "Always reply in Russian, regardless of the source language.";
    case "en": return "Always reply in English, regardless of the source language.";
    case "es": return "Always reply in Spanish, regardless of the source language.";
  }
}
```

- [ ] **Step 2: Add the resolver import to `src/phases/llm-utils.ts`**

After the existing imports at the top of the file, add:

```ts
import { resolveLang, resolveReasoningLang } from "../i18n";
```

(`resolveReasoningLang` is used in Task 4 — importing both now avoids a second edit.)

- [ ] **Step 3: Resolve content language in `buildChatParams`**

Replace line 140:

```ts
  if (opts.outputLanguage) msgs = injectLanguageDirective(msgs, resolveLang(opts.outputLanguage));
```

- [ ] **Step 4: Narrow the `injectLanguageDirective` parameter type**

Replace lines 181–184 (the function signature):

```ts
function injectLanguageDirective(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lang: "ru" | "en" | "es",
): OpenAI.Chat.ChatCompletionMessageParam[] {
```

- [ ] **Step 5: Resolve language in the vision prompts**

In `src/phases/attachment-analyzer.ts`, add to the imports (the file already imports `langInstruction` from `./llm-utils`):

```ts
import { resolveLang } from "../i18n";
```

Replace lines 94–104:

```ts
function imageSystem(language: OutputLanguage): string {
  return render(visionImage, { structure_rules: visionStructure, lang: langInstruction(resolveLang(language)) });
}

function pdfSystem(language: OutputLanguage): string {
  return render(visionPdf, { structure_rules: visionStructure, lang: langInstruction(resolveLang(language)) });
}

function excalidrawSystem(language: OutputLanguage): string {
  return render(visionExcalidraw, { lang: langInstruction(resolveLang(language)) });
}
```

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (tsc will flag any remaining `langInstruction(auto)` caller — there should be none after steps 3 and 5.)

- [ ] **Step 7: Commit**

```bash
git add src/phases/llm-utils.ts src/phases/attachment-analyzer.ts
git commit -m "feat(lang): content auto-language follows Obsidian locale, drop follow-source"
```

---

## Task 4: Layer B — reasoning language plumbing + directive

Add `reasoningLanguage` to settings and call options, plumb it from `agent-runner`, and inject a reasoning directive in `buildChatParams`.

**Files:**
- Modify: `src/types.ts:156` (settings), `:231` (default), `:108` (call options)
- Modify: `src/agent-runner.ts:48,52` (native-agent opts)
- Modify: `src/phases/llm-utils.ts` (reasoning directive + buildChatParams)

- [ ] **Step 1: Add `reasoningLanguage` to the settings interface in `src/types.ts`**

Replace line 156:

```ts
  outputLanguage: OutputLanguage;
  reasoningLanguage: OutputLanguage;
```

- [ ] **Step 2: Add the default in `src/types.ts`**

Replace line 231:

```ts
  outputLanguage: "auto",
  reasoningLanguage: "en",
```

- [ ] **Step 3: Add `reasoningLanguage` to `LlmCallOptions` in `src/types.ts`**

Replace line 108:

```ts
  outputLanguage?: OutputLanguage;
  reasoningLanguage?: OutputLanguage;
```

- [ ] **Step 4: Plumb it from `agent-runner.ts` (native-agent paths)**

In the `c` branch, line 48, add `reasoningLanguage: s.reasoningLanguage,` next to `outputLanguage: s.outputLanguage,`:

```ts
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, outputLanguage: s.outputLanguage, reasoningLanguage: s.reasoningLanguage, jsonMode: "json_object", structuredRetries, mergeDeleteWarnThreshold,
```

In the fallback branch, line 52, the same insertion:

```ts
    return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, outputLanguage: s.outputLanguage, reasoningLanguage: s.reasoningLanguage, jsonMode: "json_object", structuredRetries, mergeDeleteWarnThreshold,
```

(The claude-agent path at line 42 does not flow through `buildChatParams`, so it needs no change.)

- [ ] **Step 5: Add the reasoning directive injector in `src/phases/llm-utils.ts`**

Add this constant and function next to `injectLanguageDirective` (after its closing brace, ~line 196):

```ts
const REASONING_LANG_NAME: Record<"ru" | "en" | "es", string> = {
  ru: "Russian",
  en: "English",
  es: "Spanish",
};

/** Appends `## Reasoning language\n<directive>` to the first system message. */
function injectReasoningDirective(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lang: "ru" | "en" | "es",
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const directive = `## Reasoning language\nThink and reason in ${REASONING_LANG_NAME[lang]}.`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${directive}` };
    return updated;
  }
  return [{ role: "system", content: directive }, ...messages];
}
```

- [ ] **Step 6: Inject the reasoning directive in `buildChatParams`**

Replace the single content-language line (the line edited in Task 3 Step 3, at `src/phases/llm-utils.ts:140`) with these two lines — the first is unchanged, the second is new:

```ts
  if (opts.outputLanguage) msgs = injectLanguageDirective(msgs, resolveLang(opts.outputLanguage));
  msgs = injectReasoningDirective(msgs, resolveReasoningLang(opts.reasoningLanguage, opts.outputLanguage));
```

Do not duplicate the `injectLanguageDirective` call — there must be exactly one after this edit.

- [ ] **Step 7: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Manual check — directive present**

Add a temporary `console.log(JSON.stringify(msgs[0].content))` after Step 6's lines, run a native-agent query in Obsidian (or a `tsx` scratch call), confirm the system prompt contains `## Reasoning language\nThink and reason in English.` with `reasoningLanguage` unset, then remove the log.
Expected: directive present; defaults to English.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/agent-runner.ts src/phases/llm-utils.ts
git commit -m "feat(lang): add reasoningLanguage setting and reasoning-directive injection"
```

---

## Task 5: Layer B — settings UI + labels

Add the "Reasoning language" dropdown and its i18n labels; fix the now-inaccurate `outputLanguage_desc` (auto = Obsidian, not source).

**Files:**
- Modify: `src/i18n.ts:10-11`, `:313-314`, `:594-595` (labels in en/ru/es)
- Modify: `src/settings.ts:219-229` (add dropdown after the output-language one)

- [ ] **Step 1: Update + add labels in the `en` bundle (`src/i18n.ts:10-11`)**

Replace lines 10–11:

```ts
    outputLanguage_name: "Response language",
    outputLanguage_desc: "Language for all generated content. Auto = match the Obsidian UI language. Technical and domain terms are never translated.",
    reasoningLanguage_name: "Reasoning language",
    reasoningLanguage_desc: "Language the model reasons in. Default English (models reason best in English). Auto = follow the response language, then the Obsidian UI language. Best-effort — actual support depends on the model.",
```

- [ ] **Step 2: Update + add labels in the `ru` bundle (`src/i18n.ts:313-314`)**

Replace lines 313–314:

```ts
    outputLanguage_name: "Response language",
    outputLanguage_desc: "Язык всего генерируемого контента. Auto = язык интерфейса Obsidian. Технические и доменные термины не переводятся.",
    reasoningLanguage_name: "Reasoning language",
    reasoningLanguage_desc: "Язык, на котором рассуждает модель. По умолчанию English (модели рассуждают лучше на английском). Auto = язык ответа, затем язык интерфейса Obsidian. Best-effort — фактическая поддержка зависит от модели.",
```

- [ ] **Step 3: Update + add labels in the `es` bundle (`src/i18n.ts:594-595`)**

Replace lines 594–595:

```ts
    outputLanguage_name: "Response language",
    outputLanguage_desc: "Idioma de todo el contenido generado. Auto = idioma de la interfaz de Obsidian. Los términos técnicos y de dominio no se traducen.",
    reasoningLanguage_name: "Reasoning language",
    reasoningLanguage_desc: "Idioma en el que razona el modelo. Por defecto English (los modelos razonan mejor en inglés). Auto = sigue el idioma de respuesta y luego el de la interfaz de Obsidian. Best-effort — el soporte real depende del modelo.",
```

- [ ] **Step 4: Add the dropdown in `src/settings.ts`**

After the output-language `Setting` block (ends at line 229, the closing `);`), insert:

```ts
    new Setting(containerEl)
      .setName(T.settings.reasoningLanguage_name)
      .setDesc(T.settings.reasoningLanguage_desc)
      .addDropdown((d) =>
        d.addOptions({ auto: "Auto (match response)", en: "English", ru: "Russian", es: "Spanish" })
          .setValue(s.reasoningLanguage ?? "en")
          .onChange(async (v) => {
            s.reasoningLanguage = v as "auto" | "ru" | "en" | "es";
            await this.plugin.saveSettings();
          }),
      );
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (tsc enforces that `ru`/`es` bundles gained the same two label keys as `en` via the `: I18n` annotation.)

- [ ] **Step 6: Manual check — dropdown renders**

Build (`npm run build`), reload the plugin in Obsidian, open Settings → confirm a "Reasoning language" dropdown appears below "Response language" defaulting to English.
Expected: dropdown present, persists on change.

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts src/settings.ts
git commit -m "feat(settings): reasoning-language dropdown + labels; fix auto-language description"
```

---

## Task 6: Layer A — add status-string bundle groups

Add per-phase progress groups and two `view` keys to all three bundles. The `: I18n` annotation on `ru`/`es` forces parity at compile time.

**Files:**
- Modify: `src/i18n.ts` — `en` (after `formatProgress`, ~line 194), `ru` (~line 497), `es` (~line 778); `view` group in all three (`:128`, `:431`, `:712`)

- [ ] **Step 1: Add the three progress groups to the `en` bundle**

In `en`, immediately after the `formatProgress: { ... },` block (closes at line 194), insert:

```ts
  ingestProgress: {
    synthesizing: (domainId: string) => `Synthesizing wiki pages for domain "${domainId}"...\n`,
  },
  lintProgress: {
    evaluating: (domainId: string) => `Evaluating domain "${domainId}" quality...\n`,
    actualizing: (domainId: string) => `\nActualizing domain config for "${domainId}"...\n`,
  },
  initProgress: {
    reinitWiping: (folder: string) => `Re-init: wiping ${folder}...\n`,
    removedFiles: (n: number) => `removed ${n} files\n`,
    fileChars: (file: string, n: number) => `ℹ ${file}: ${n} chars\n`,
  },
```

- [ ] **Step 2: Add the same three groups to the `ru` bundle**

After `ru`'s `formatProgress` block, insert:

```ts
  ingestProgress: {
    synthesizing: (domainId: string) => `Синтез вики-страниц для домена «${domainId}»...\n`,
  },
  lintProgress: {
    evaluating: (domainId: string) => `Оценка качества домена «${domainId}»...\n`,
    actualizing: (domainId: string) => `\nАктуализация конфигурации домена «${domainId}»...\n`,
  },
  initProgress: {
    reinitWiping: (folder: string) => `Re-init: очистка ${folder}...\n`,
    removedFiles: (n: number) => `удалено файлов: ${n}\n`,
    fileChars: (file: string, n: number) => `ℹ ${file}: символов ${n}\n`,
  },
```

- [ ] **Step 3: Add the same three groups to the `es` bundle**

After `es`'s `formatProgress` block, insert:

```ts
  ingestProgress: {
    synthesizing: (domainId: string) => `Sintetizando páginas wiki para el dominio "${domainId}"...\n`,
  },
  lintProgress: {
    evaluating: (domainId: string) => `Evaluando la calidad del dominio "${domainId}"...\n`,
    actualizing: (domainId: string) => `\nActualizando la configuración del dominio "${domainId}"...\n`,
  },
  initProgress: {
    reinitWiping: (folder: string) => `Re-init: limpiando ${folder}...\n`,
    removedFiles: (n: number) => `archivos eliminados: ${n}\n`,
    fileChars: (file: string, n: number) => `ℹ ${file}: ${n} caracteres\n`,
  },
```

- [ ] **Step 4: Add two keys to the `en` `view` group**

In `en.view` (after line 132, `formingResponse: "Forming response…",`), add:

```ts
    ingestingFiles: "Ingesting files…",
    analysingFiles: "Analysing files…",
```

- [ ] **Step 5: Add the two keys to the `ru` `view` group**

In `ru.view` (next to its `formingResponse` key, ~line 431+), add:

```ts
    ingestingFiles: "Загрузка файлов…",
    analysingFiles: "Анализ файлов…",
```

- [ ] **Step 6: Add the two keys to the `es` `view` group**

In `es.view` (next to its `formingResponse` key, ~line 712+), add:

```ts
    ingestingFiles: "Ingiriendo archivos…",
    analysingFiles: "Analizando archivos…",
```

- [ ] **Step 7: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If a key is missing from `ru`/`es`, tsc reports `Property '...' is missing in type` — add it.

- [ ] **Step 8: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add ingest/lint/init progress groups + view file labels (en/ru/es)"
```

---

## Task 7: Layer A — wire phases to the bundle

Replace hardcoded English status literals in `ingest.ts`, `lint.ts`, `init.ts` with bundle lookups resolved from `opts.outputLanguage`.

**Files:**
- Modify: `src/phases/ingest.ts:7` (import), `:114`
- Modify: `src/phases/lint.ts` (import), `:281`, `:489`
- Modify: `src/phases/init.ts` (import), `:57`, `:61`, `:175`

- [ ] **Step 1: Update `src/phases/ingest.ts`**

Add to the import block (line 7 already imports from `./llm-utils`); add a new import line:

```ts
import { i18nFor, resolveLang } from "../i18n";
```

Replace line 114:

```ts
  yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).ingestProgress.synthesizing(domain.id) };
```

- [ ] **Step 2: Update `src/phases/lint.ts`**

Add the import:

```ts
import { i18nFor, resolveLang } from "../i18n";
```

Replace line 281:

```ts
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).lintProgress.evaluating(domain.id) };
```

Replace line 489:

```ts
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).lintProgress.actualizing(domain.id) };
```

- [ ] **Step 3: Update `src/phases/init.ts`**

Add the import:

```ts
import { i18nFor, resolveLang } from "../i18n";
```

Replace line 57:

```ts
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.reinitWiping(domainWikiFolder(existing.wiki_folder)) };
```

Replace line 61:

```ts
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.removedFiles(wiped.length) };
```

Replace line 175:

```ts
    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.fileChars(file, fileContent.length) };
```

- [ ] **Step 4: Verify `opts` is in scope at each site**

Run: `grep -n "opts" src/phases/init.ts | head -3`
Expected: `opts` is a parameter of the phase function (init.ts uses `opts.outputLanguage` at line 153; lint.ts at 201; ingest.ts at 108) — confirm each replaced line sits inside that function.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Confirm no hardcoded literals remain:
Run: `grep -rn "Synthesizing wiki\|Evaluating domain\|Actualizing domain\|Re-init: wiping\|removed \${\|chars\\\\n" src/phases/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts src/phases/lint.ts src/phases/init.ts
git commit -m "fix(progress): localize ingest/lint/init status strings by outputLanguage"
```

---

## Task 8: Layer A — wire `view.ts` labels

Localize the four hardcoded progress labels in `view.ts` by the setting.

**Files:**
- Modify: `src/view.ts` (import), `:633`, `:639`, `:759`, `:762`

- [ ] **Step 1: Add the import to `src/view.ts`**

The file already imports `i18n` from `./i18n`. Extend that import to include `i18nFor` and `resolveLang`:

```ts
import { i18n, i18nFor, resolveLang } from "./i18n";
```

(If the existing import names differ, add `i18nFor` and `resolveLang` to the same `from "./i18n"` statement.)

- [ ] **Step 2: Localize the `init_start` phase labels (lines 633 and 639)**

Replace line 633:

```ts
          const label = ev.phase === "ingest"
            ? i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.ingestingFiles
            : i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.analysingFiles;
```

Replace line 639:

```ts
        const label = ev.phase === "ingest"
          ? i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.ingestingFiles
          : i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.analysingFiles;
```

- [ ] **Step 3: Localize the live-status labels (lines 759 and 762)**

Replace line 759:

```ts
        this.liveStatusTextEl?.setText(i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.analysing);
```

Replace line 762:

```ts
        this.liveStatusTextEl?.setText(i18nFor(resolveLang(this.plugin.settings.outputLanguage)).view.formingResponse);
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Confirm the literals are gone:
Run: `grep -n "Ingesting files\|Analysing files\|\"Analysing...\"\|\"Forming response...\"" src/view.ts`
Expected: no output.

- [ ] **Step 5: Manual check — labels follow the setting**

Build (`npm run build`), set Output language = Russian (Obsidian UI in English), run an ingest/init from the panel.
Expected: progress phase label shows "Загрузка файлов…" / "Анализ файлов…"; live status shows "Анализ…" / "Формирование ответа…".

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "fix(progress): localize view.ts progress labels by outputLanguage"
```

---

## Task 9: Update the lat.md knowledge graph

Document the three-layer resolution model and the new reasoning setting; validate links.

**Files:**
- Modify: relevant `lat.md/` section(s) describing language/output behavior (locate first)

- [ ] **Step 1: Locate the relevant section**

Run: `lat search "output language resolution"` and `lat locate "Output language"`
Read the matching section(s) to find where language behavior is documented.

- [ ] **Step 2: Update the documentation**

In the located section, document: `resolveLang` (status + content, `auto` → Obsidian UI), `resolveReasoningLang` (reasoning, default English, `auto` chains), the new `reasoningLanguage` setting, and the tradeoff that `auto` content no longer follows the source note. Add source-code refs where the section style uses them, e.g. `[[src/i18n.ts#resolveLang]]`, `[[src/i18n.ts#resolveReasoningLang]]`, `[[src/phases/llm-utils.ts#langInstruction]]`. Every section must keep its ≤250-char leading paragraph.

- [ ] **Step 3: Validate**

Run: `lat check`
Expected: all wiki links and code refs pass. Fix any broken `[[ref]]` (e.g. a renamed `resolveProgressLang` reference must become `resolveLang`).

- [ ] **Step 4: Commit**

```bash
git add lat.md
git commit -m "docs(lat): document three-layer language resolution + reasoning setting"
```

---

## Task 10: Final verification

End-to-end build + manual matrix from the spec's Success Criteria.

- [ ] **Step 1: Full type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 2: Manual matrix (Obsidian, native-agent backend)**

Verify each row:

| Setting | Obsidian UI | Expected |
|---------|-------------|----------|
| `outputLanguage = ru` | en | ingest/lint/format status strings in Russian |
| `outputLanguage = auto` | ru | status strings in Russian |
| `outputLanguage = auto` | en | generated content in English |
| `reasoningLanguage = en` (default) | any | system prompt contains "Think and reason in English." |
| `reasoningLanguage = auto`, `outputLanguage = ru` | any | "Think and reason in Russian." |

- [ ] **Step 3: Validate docs once more**

Run: `lat check`
Expected: pass.

- [ ] **Step 4: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore: finalize progress & reasoning language feature" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** A1 → Task 6; A2 → Task 7; A3 → Task 8; A4 → Task 1; B1 → Task 4 (steps 1–3); B2 → Task 5; B3 → Task 2; B4 → Task 4 (steps 5–6); C1 → Task 3 (steps 1,3,4); C2 → Task 3 + the `resolveLang` `auto`→Obsidian behavior. Tradeoff (drop follow-source) is realized in Task 3.
- **Type consistency:** `resolveLang`, `resolveReasoningLang`, `i18nFor`, `langInstruction(lang: "ru"|"en"|"es")`, bundle groups `ingestProgress`/`lintProgress`/`initProgress`, view keys `ingestingFiles`/`analysingFiles` — names used identically across Tasks 1–8.
- **Placeholder scan:** none — every code step shows full code.
- **Out of scope (left untouched):** the `"0 / N файлов"` Russian literal in `view.ts:631/643` is not in the spec's finding list; do not change it.
