---
review:
  plan_hash: c0e112bfad1f77b0
  spec_hash: eee1e2843b670d56
  last_run: 2026-06-24
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
      section: "Task 1 — eval harness + eval doc (Steps 1, 2, 5, 7)"
      section_hash: 60233dcd32e62bd8
      text: "Plan creates eval/reasoning-language/ (run.ts, obsidian-stub.ts, .gitignore) and docs/superpowers/evals/2026-06-24-reasoning-language-eval.md — artifacts not in the spec's 'Files touched' list. Spec Verification says only 'verify via build/lint/run' (no test suite). Justified by project TDD convention for pure functions, but it adds scope beyond the spec's declared files."
      verdict: wontfix
      verdict_at: 2026-06-24
      verdict_note: "Intentional. The spec's 'Files touched' lists SOURCE files; adding a headless eval + eval doc for the pure Part-B functions follows established project convention (eval/format-frontmatter + docs/superpowers/evals precedent) and the writing-plans TDD mandate. Low cost, locks the reasoningDirective contract that Part C reuses. Kept as-is."
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-24-reasoning-logging-and-language-rule-design.md
---

# Reasoning Logging + Stronger Reasoning/Answer Language Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model reasoning land in `_agent.jsonl` as one consolidated record per LLM call, and stop reasoning/answer language from drifting across every native-agent phase (format, query, lint, ingest, evaluator, chat, and vision).

**Architecture:** Three local edits. (A) `Controller.logEvent` buffers `isReasoning` deltas and flushes one `{kind:"reasoning"}` line when the next non-`assistant_text` event arrives. (B) `src/phases/llm-utils.ts` exports a strengthened `reasoningDirective(lang)` and a strengthened `langInstruction(lang)`. (C) The vision path (`attachment-analyzer.ts`) is plumbed with `reasoningLanguage` and appends the same shared `reasoningDirective`.

**Tech Stack:** TypeScript, esbuild (build + headless eval harness), Obsidian plugin runtime, OpenAI-compatible streaming client.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-reasoning-logging-and-language-rule-design.md`. This plan implements it verbatim.
- **Branch:** all work in a `dev/*` branch created from an up-to-date `master`; PR targets `master`. The spec header names `dev/query-link-resolver` but flags it as unconfirmed — confirm the branch name and worktree choice with the user before the first edit (global rule: creating a `dev/*` branch requires asking whether to make a `wk/<branch>` worktree).
- **Language:** code, comments, commit messages, docs in English. Conversation in Russian.
- **No new surface:** no new `RunEvent` kind, no `src/types.ts` change, no new settings/UI/toggles. Reasoning logging stays gated by the existing `agentLogEnabled` flag.
- **The reasoning log record is a plain inline object literal** (envelope shape reused), not a typed `RunEvent`.
- **Out of scope:** `claude-agent` backend (does not receive `reasoningLanguage`).
- **Verification gates:** `npm run build` (esbuild production) and `npm run lint` (ESLint, mirrors the Obsidian reviewer) must pass. There is **no unit-test runner** in this project — pure functions are verified via the out-of-vault esbuild eval harness; Obsidian-coupled code is verified via build/lint plus a manual runtime check. `tsc` has a known ~135-error pre-existing baseline in untouched files — gate on **no NEW `tsc` errors in files this plan touches**, not on a clean `tsc`.
- **Post-task (mandatory):** update `docs/wiki/` via `iwiki:iwiki-ingest <changed-source>` for every changed source, then run `/iwiki-lint` (no broken `[[refs]]`, no orphan/stale pages). This is Task 4.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/phases/llm-utils.ts` | Shared system-prompt directives | Export + strengthen `reasoningDirective(lang)`; strengthen `langInstruction(lang)`; route `injectReasoningDirective` through the new export. |
| `src/controller.ts` | Run orchestration + `_agent.jsonl` logging | Add `_reasoningBuf` field; reset it in `dispatch`; rewrite `logEvent` to buffer + consolidate reasoning. |
| `src/phases/attachment-analyzer.ts` | Vision attachment analysis | Plumb `reasoningLanguage`; append `reasoningDirective` in the three `*System()` builders. |
| `src/phases/format.ts` | Format phase (calls vision) | Pass `opts.reasoningLanguage` into `analyzeSingleAttachment`. |
| `eval/reasoning-language/run.ts` (+ `obsidian-stub.ts`, `.gitignore`) | Headless eval for the pure directive/resolver functions (Part B contract) | Create. |
| `docs/superpowers/evals/2026-06-24-reasoning-language-eval.md` | Eval doc (how to run + cases) | Create. |

**Testability split (read before starting):**
- **Part B** (`llm-utils.ts`) is pure — it is the TDD vehicle (Task 1, via the eval harness).
- **Part A** (`controller.ts`) is a private method tied to the Obsidian vault adapter — not unit-testable headlessly without instantiating the whole plugin. Per the spec's own Verification section and project convention, it is verified via build/lint + a manual runtime check. Do **not** invent a brittle Controller unit harness.
- **Part C** (vision plumbing) is compile-checked by `npm run build`; the directive text it appends is the shared `reasoningDirective` already covered by Task 1's eval. The behavioral outcome is verified via the runtime check.

---

### Task 1: Strengthen + export the directive helpers (Part B)

**Files:**
- Modify: `src/phases/llm-utils.ts` (`langInstruction` ~8-14; `injectReasoningDirective` ~196-209; `REASONING_LANG_NAME` ~189-193)
- Create: `eval/reasoning-language/run.ts`
- Create: `eval/reasoning-language/obsidian-stub.ts`
- Create: `eval/reasoning-language/.gitignore`
- Create: `docs/superpowers/evals/2026-06-24-reasoning-language-eval.md`

**Interfaces:**
- Consumes: `resolveLang`, `resolveReasoningLang` from `src/i18n.ts` (existing). `resolveReasoningLang(reasoningLanguage: OutputLanguage | undefined, outputLanguage: OutputLanguage | undefined): "ru" | "en" | "es"` — explicit wins; `"auto"` → `resolveLang(outputLanguage)`; `undefined` → `"en"`.
- Produces (relied on by Task 3):
  - `export function reasoningDirective(lang: "ru" | "en" | "es"): string` — returns the **full section** including the `## Reasoning language` heading.
  - `export function langInstruction(lang: "ru" | "en" | "es"): string` — already exported; text strengthened, signature unchanged.

- [ ] **Step 1: Write the eval harness (the failing test)**

Create `eval/reasoning-language/obsidian-stub.ts` (identical to the existing `format-frontmatter` stub — `i18n.ts` only touches `moment.locale()`):

```ts
// Minimal `obsidian` stub for the out-of-vault eval harness.
// i18n.ts only uses `moment.locale()`. The harness drives the returned UI
// locale via a global so resolveLang's `auto` fallback is testable.
export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
```

Create `eval/reasoning-language/.gitignore`:

```
*.cjs
```

Create `eval/reasoning-language/run.ts`:

```ts
/**
 * Out-of-vault eval for the reasoning/answer language directives (spec Part B).
 *
 * Exercises the REAL pure functions from src/ — no Obsidian vault, no LLM.
 * Locks the contract the vision path (Part C) reuses: the shared reasoning
 * directive text, the strengthened answer directive, and the reasoning-language
 * resolver fallback chain.
 *
 * Run: see docs/superpowers/evals/2026-06-24-reasoning-language-eval.md
 */
import { reasoningDirective, langInstruction } from "../../src/phases/llm-utils";
import { resolveReasoningLang } from "../../src/i18n";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

function setLocale(l: string): void {
  (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ = l;
}

// =====================================================================
section("reasoningDirective — language correctness");
// =====================================================================
check("R1 en names English", /English/.test(reasoningDirective("en")), reasoningDirective("en"));
check("R2 ru names Russian", /Russian/.test(reasoningDirective("ru")), reasoningDirective("ru"));
check("R3 es names Spanish", /Spanish/.test(reasoningDirective("es")), reasoningDirective("es"));

section("reasoningDirective — anti-drift + JSON clause");
check("R4 carries the section heading", reasoningDirective("en").includes("## Reasoning language"), reasoningDirective("en"));
check("R5 forbids switching language", /do not switch/i.test(reasoningDirective("en")), reasoningDirective("en"));
check("R6 governs the JSON reasoning field", /json/i.test(reasoningDirective("en")) && /reasoning.{0,3}field/i.test(reasoningDirective("en")), reasoningDirective("en"));

section("langInstruction — strengthened answer directive");
check("L1 en names English + no-switch", /English/.test(langInstruction("en")) && /do not switch/i.test(langInstruction("en")), langInstruction("en"));
check("L2 ru names Russian + no-switch", /Russian/.test(langInstruction("ru")) && /do not switch/i.test(langInstruction("ru")), langInstruction("ru"));
check("L3 es names Spanish + no-switch", /Spanish/.test(langInstruction("es")) && /do not switch/i.test(langInstruction("es")), langInstruction("es"));

section("resolveReasoningLang — fallback chain vision relies on");
check("RL1 explicit reasoning wins over output", resolveReasoningLang("en", "ru") === "en");
check("RL2 auto chains to output language", resolveReasoningLang("auto", "ru") === "ru");
setLocale("es-ES");
check("RL3 auto + auto output chains to UI locale", resolveReasoningLang("auto", "auto") === "es");
setLocale("en");
check("RL4 undefined defaults to en", resolveReasoningLang(undefined, "ru") === "en");

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Run the eval to verify it fails**

```bash
node_modules/.bin/esbuild eval/reasoning-language/run.ts \
  --bundle --platform=node --format=cjs \
  --loader:.md=text \
  --alias:obsidian=./eval/reasoning-language/obsidian-stub.ts \
  --outfile=eval/reasoning-language/run.cjs \
  && node eval/reasoning-language/run.cjs
```

Expected: the **esbuild bundle step fails** with an error resolving the import `reasoningDirective` from `src/phases/llm-utils.ts` (it is not exported yet). That is the red state. (The `--loader:.md=text` flag is required because `llm-utils.ts` imports `prompts/base.md`.)

- [ ] **Step 3: Strengthen `langInstruction`**

In `src/phases/llm-utils.ts`, replace the body of `langInstruction` (lines ~8-14):

```ts
/** Maps a concrete output language to a reply directive for the system prompt. */
export function langInstruction(lang: "ru" | "en" | "es"): string {
  switch (lang) {
    case "ru": return "Write the entire response in Russian. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "en": return "Write the entire response in English. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "es": return "Write the entire response in Spanish. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
  }
}
```

- [ ] **Step 4: Export + strengthen `reasoningDirective`, route `injectReasoningDirective` through it**

In `src/phases/llm-utils.ts`, replace the `injectReasoningDirective` block (lines ~195-209) with a new exported `reasoningDirective` plus a thin injector. `REASONING_LANG_NAME` (lines ~189-193) is unchanged and already declared above this block:

```ts
/**
 * The reasoning-language section, shared by `buildChatParams` (via
 * `injectReasoningDirective`) and the vision path. Returns the full section
 * including its heading so both call sites embed identical text.
 */
export function reasoningDirective(lang: "ru" | "en" | "es"): string {
  const name = REASONING_LANG_NAME[lang];
  return [
    "## Reasoning language",
    `Reason and think exclusively in ${name}.`,
    `Do not switch the reasoning language to match the source notes, user input, or quoted text, even when those are written in another language.`,
    `This rule also governs the \`reasoning\` field of any JSON output: write that field in ${name} as well.`,
  ].join("\n");
}

/** Appends the shared reasoning directive to the first system message. */
function injectReasoningDirective(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lang: "ru" | "en" | "es",
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const directive = reasoningDirective(lang);
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

- [ ] **Step 5: Run the eval to verify it passes**

```bash
node_modules/.bin/esbuild eval/reasoning-language/run.ts \
  --bundle --platform=node --format=cjs \
  --loader:.md=text \
  --alias:obsidian=./eval/reasoning-language/obsidian-stub.ts \
  --outfile=eval/reasoning-language/run.cjs \
  && node eval/reasoning-language/run.cjs
```

Expected: `TOTAL: 13 passed, 0 failed`.

- [ ] **Step 6: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both succeed. (`eval/**` is not linted — lint globs `src/**/*.ts` only.)

- [ ] **Step 7: Write the eval doc**

Create `docs/superpowers/evals/2026-06-24-reasoning-language-eval.md`:

```markdown
# Eval — Reasoning / Answer Language Directives

**Date:** 2026-06-24
**Spec:** `docs/superpowers/specs/2026-06-24-reasoning-logging-and-language-rule-design.md`
**Plan:** `docs/superpowers/plans/2026-06-24-reasoning-logging-and-language-rule.md`

## Purpose & scope

Validate spec Part B (strengthened directives) **outside any Obsidian vault** and **without an
LLM**, by exercising the real pure functions from `src/`. Covers the contract the vision path
(Part C) reuses.

In scope (deterministic):
- `reasoningDirective(lang)` — correct language name, anti-drift clause, JSON-`reasoning`-field clause.
- `langInstruction(lang)` — correct language name + no-switch clause.
- `resolveReasoningLang` — explicit / `auto` / `undefined` fallback chain.

Out of scope (needs the Obsidian runtime / a live LLM, checked manually):
- Reasoning logging consolidation in `Controller.logEvent` (spec Part A).
- The model actually obeying the directive (progress-bar reasoning language).

## How to run

\`\`\`bash
node_modules/.bin/esbuild eval/reasoning-language/run.ts \
  --bundle --platform=node --format=cjs \
  --loader:.md=text \
  --alias:obsidian=./eval/reasoning-language/obsidian-stub.ts \
  --outfile=eval/reasoning-language/run.cjs
node eval/reasoning-language/run.cjs
\`\`\`

`--loader:.md=text` is required because `llm-utils.ts` imports `prompts/base.md`. `obsidian-stub.ts`
provides the only `obsidian` symbol `i18n.ts` uses — `moment.locale()` — driven by
`globalThis.__MOMENT_LOCALE__`.

## Cases

| Case | Asserts |
|------|---------|
| R1–R3 | `reasoningDirective` names the correct language (en/ru/es) |
| R4 | section heading `## Reasoning language` present |
| R5 | anti-drift clause ("do not switch") present |
| R6 | JSON `reasoning` field clause present |
| L1–L3 | `langInstruction` names the language + carries the no-switch clause |
| RL1–RL4 | `resolveReasoningLang` fallback chain (explicit / auto→output / auto→locale / undefined→en) |

## Results (current)

`TOTAL: 13 passed, 0 failed`
```

- [ ] **Step 8: Commit**

```bash
git add src/phases/llm-utils.ts eval/reasoning-language/run.ts eval/reasoning-language/obsidian-stub.ts eval/reasoning-language/.gitignore docs/superpowers/evals/2026-06-24-reasoning-language-eval.md
git commit -m "feat(llm): export + strengthen reasoning/answer language directives"
```

---

### Task 2: Consolidated reasoning logging (Part A)

**Files:**
- Modify: `src/controller.ts` — field declaration (~48); buffer reset in `dispatch` (~663); `logEvent` rewrite (~584-604)

**Interfaces:**
- Consumes: existing `this._currentLogMeta`, `this._llmCallIndex`, `this.app.vault.adapter`, `GLOBAL_AGENT_LOG_PATH`, `RunEvent` (with `assistant_text` carrying optional `isReasoning: boolean`).
- Produces: a new `_agent.jsonl` record shape (consumed only by humans/diagnostics, not by code):
  ```jsonc
  { "ts": "...", "session": "...", "op": "...", "domainId": "...",
    "backend": "...", "model": "...",
    "event": { "kind": "reasoning", "text": "..." }, "callIndex": <n> }
  ```

- [ ] **Step 1: Add the buffer field**

In `src/controller.ts`, immediately after the `_llmCallIndex` field (line ~48):

```ts
  private _llmCallIndex = 0;
  private _reasoningBuf = "";
```

- [ ] **Step 2: Reset the buffer at operation start**

In `dispatch`, next to the existing `this._llmCallIndex = 0;` (line ~663):

```ts
    this._llmCallIndex = 0;
    this._reasoningBuf = "";
```

- [ ] **Step 3: Rewrite `logEvent` to buffer + consolidate**

Replace the entire `logEvent` method (lines ~584-604) with:

```ts
  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!(this._currentLogMeta?.agentLogEnabled ?? this.plugin.settings.agentLogEnabled)) return;

    // Reasoning chunks (assistant_text + isReasoning) accumulate into a buffer and
    // are flushed as ONE consolidated line when the next non-assistant_text event
    // arrives. Non-reasoning assistant_text (progress chatter) stays dropped — the
    // final answer is already captured by the `result` event.
    if (ev.kind === "assistant_text") {
      if (ev.isReasoning) this._reasoningBuf += ev.delta;
      return;
    }

    const adapter = this.app.vault.adapter;
    const path = GLOBAL_AGENT_LOG_PATH;
    try {
      await this.app.vault.createFolder("!Wiki").catch(() => {});
      await this.app.vault.createFolder("!Wiki/_config").catch(() => {});

      const appendLine = async (record: unknown): Promise<void> => {
        const line = JSON.stringify(record) + "\n";
        if (await adapter.exists(path)) await adapter.append(path, line);
        else await adapter.write(path, line);
      };
      const envelope = {
        session: sessionId, op, domainId,
        backend: this._currentLogMeta?.backend,
        model: this._currentLogMeta?.model,
      };

      // Flush accumulated reasoning as one line, stamped with the current call index,
      // before writing the event that triggered the flush.
      if (this._reasoningBuf) {
        await appendLine({
          ts: new Date().toISOString(),
          ...envelope,
          event: { kind: "reasoning", text: this._reasoningBuf },
          callIndex: this._llmCallIndex,
        });
        this._reasoningBuf = "";
      }

      const extra = ev.kind === "llm_call_stats" ? { callIndex: this._llmCallIndex++ } : {};
      await appendLine({
        ts: new Date().toISOString(),
        ...envelope,
        event: ev,
        ...extra,
      });
    } catch { /* не блокируем операцию */ }
  }
```

Notes for the implementer (do not add as code):
- The flush triggers on **any** non-`assistant_text` event, which is correct for both observed orderings (format: reasoning → `llm_call_stats`; ingest: `llm_call_stats` → reasoning → next structural event). The terminating `result`/`exit` event guarantees a final flush.
- `callIndex` stamps the reasoning line with the *current* `_llmCallIndex` (no increment). Minor stats/reasoning association imprecision is accepted by the spec.

- [ ] **Step 4: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both succeed.

- [ ] **Step 5: Verify no new `tsc` errors in `src/controller.ts`**

```bash
npx tsc --noEmit 2>&1 | grep "src/controller.ts" || echo "no controller.ts tsc errors"
```

Expected: `no controller.ts tsc errors` (the repo has a pre-existing baseline elsewhere; the gate is no **new** error in this file).

- [ ] **Step 6: Runtime check (manual — the spec's Part A acceptance)**

In a throwaway/dev vault with `agentLogEnabled = true` and backend `native-agent`, run one operation (e.g. ingest or format) on a note. Then inspect the log:

```bash
grep -c '"kind":"reasoning"' "<vault>/!Wiki/_config/_agent.jsonl"
```

Expected: a small count — **one `{"event":{"kind":"reasoning",...}}` record per LLM call**, not hundreds of per-delta lines, and no bare `assistant_text` chatter lines.

- [ ] **Step 7: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): log consolidated model reasoning to _agent.jsonl"
```

---

### Task 3: Vision parity — plumb `reasoningLanguage` (Part C)

**Files:**
- Modify: `src/phases/attachment-analyzer.ts` (imports ~1-5; `*System()` builders ~100-110; `analyzeImage`/`analyzePdf`/`analyzeExcalidraw` ~112-176; `analyzeSingleAttachment` ~179-214; `analyzeAttachments` ~216-236)
- Modify: `src/phases/format.ts` (call site ~138)

**Interfaces:**
- Consumes: `reasoningDirective` and (existing) `langInstruction` from `./llm-utils`; `resolveLang`, `resolveReasoningLang` from `../i18n`; `OutputLanguage` from `../types`; `opts.reasoningLanguage: OutputLanguage | undefined` already held by `runFormat` in `format.ts`.
- Produces: vision system prompts that carry both the answer directive (`{lang}` template) **and** the shared reasoning directive.

- [ ] **Step 1: Update imports in `attachment-analyzer.ts`**

Replace lines ~4-5:

```ts
import { langInstruction, reasoningDirective } from "./llm-utils";
import { resolveLang, resolveReasoningLang } from "../i18n";
```

- [ ] **Step 2: Append the reasoning directive in the three `*System()` builders**

Replace `imageSystem` / `pdfSystem` / `excalidrawSystem` (lines ~100-110):

```ts
function imageSystem(language: OutputLanguage, reasoningLanguage: OutputLanguage): string {
  const base = render(visionImage, { structure_rules: visionStructure, lang: langInstruction(resolveLang(language)) });
  return `${base}\n\n${reasoningDirective(resolveReasoningLang(reasoningLanguage, language))}`;
}

function pdfSystem(language: OutputLanguage, reasoningLanguage: OutputLanguage): string {
  const base = render(visionPdf, { structure_rules: visionStructure, lang: langInstruction(resolveLang(language)) });
  return `${base}\n\n${reasoningDirective(resolveReasoningLang(reasoningLanguage, language))}`;
}

function excalidrawSystem(language: OutputLanguage, reasoningLanguage: OutputLanguage): string {
  const base = render(visionExcalidraw, { lang: langInstruction(resolveLang(language)) });
  return `${base}\n\n${reasoningDirective(resolveReasoningLang(reasoningLanguage, language))}`;
}
```

- [ ] **Step 3: Thread `reasoningLanguage` through `analyzeImage`**

Replace `analyzeImage` (lines ~112-124):

```ts
export async function analyzeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
): Promise<string> {
  const b64 = arrayBufferToBase64(buffer);
  return callVisionLlm(llm, model, imageSystem(language, reasoningLanguage), [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
  ], signal);
}
```

- [ ] **Step 4: Thread `reasoningLanguage` through `analyzePdf`**

Update the `analyzePdf` signature (line ~138-144) and its `callVisionLlm` call (line ~163). Add the parameter after `language`:

```ts
export async function analyzePdf(
  buffer: ArrayBuffer,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
): Promise<string> {
```

and change the final return (line ~163) from `pdfSystem(language)` to:

```ts
  return callVisionLlm(llm, model, pdfSystem(language, reasoningLanguage), parts, signal);
```

- [ ] **Step 5: Thread `reasoningLanguage` through `analyzeExcalidraw`**

Replace `analyzeExcalidraw` (lines ~166-176):

```ts
export async function analyzeExcalidraw(
  b64: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
): Promise<string> {
  return callVisionLlm(llm, model, excalidrawSystem(language, reasoningLanguage), [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
  ], signal);
}
```

- [ ] **Step 6: Thread `reasoningLanguage` through `analyzeSingleAttachment`**

Update the signature (lines ~179-189) — add `reasoningLanguage` immediately after `language` — and forward it in the three analyzer calls (lines ~202, ~206, ~211):

```ts
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  visionTempStore?: VisionTempStore,
  imageOnly: boolean = false,
): Promise<string | null> {
  const resolved = vaultTools.resolveLink(path, sourcePath);
  if (resolved === null) return null;
  if (imageOnly && !isVisionSupportedOnMobile(resolved)) return null;
  const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
  const isExcalidraw = ext === "excalidraw" || resolved.endsWith(".excalidraw.md");

  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;
    await visionTempStore?.putPng(path, b64);
    return analyzeExcalidraw(b64, llm, model, signal, language, reasoningLanguage);
  }
  if (ext === "pdf") {
    const buf = await vaultTools.readBinary(resolved);
    return analyzePdf(buf, llm, model, signal, language, reasoningLanguage);
  }
  const mimeType = getMimeType(resolved);
  if (mimeType) {
    const buf = await vaultTools.readBinary(resolved);
    return analyzeImage(buf, mimeType, llm, model, signal, language, reasoningLanguage);
  }
  return null;
}
```

> **Note:** inserting `reasoningLanguage` before `visionTempStore`/`imageOnly` shifts those two positional args. The only external caller is `format.ts:138` (updated in Step 8) and the internal `analyzeAttachments` (Step 7). Verify with `grep -rn "analyzeSingleAttachment" src/` that exactly those two call sites exist.

- [ ] **Step 7: Thread `reasoningLanguage` through `analyzeAttachments`**

`analyzeAttachments` has no external callers today, but the spec keeps the full chain plumbed. Update its signature (lines ~216-224) and the internal call (line ~229):

```ts
export async function analyzeAttachments(
  embedPaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of [...new Set(embedPaths)]) {
    if (signal.aborted) break;
    try {
      const description = await analyzeSingleAttachment(path, vaultTools, llm, model, signal, sourcePath, language, reasoningLanguage);
      if (description !== null) result.set(path, description);
    } catch {
      // Per-attachment failure — skip, don't block format
    }
  }
  return result;
}
```

- [ ] **Step 8: Pass `opts.reasoningLanguage` at the format call site**

In `src/phases/format.ts`, line ~138, insert `opts.reasoningLanguage` after `lang` (the `language` arg) and before `visionTempStore`:

```ts
          const description = await analyzeSingleAttachment(path, vaultTools, llm, visionSettings.model, signal, filePath, lang, opts.reasoningLanguage, visionTempStore, visionSettings.imageOnly ?? false);
```

- [ ] **Step 9: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both succeed. A successful build confirms every shifted positional argument type-checks (`opts.reasoningLanguage: OutputLanguage | undefined` is accepted by the defaulted `reasoningLanguage` parameter).

- [ ] **Step 10: Verify no new `tsc` errors in the touched files**

```bash
npx tsc --noEmit 2>&1 | grep -E "src/phases/(attachment-analyzer|format)\.ts" || echo "no new tsc errors in touched vision files"
```

Expected: `no new tsc errors in touched vision files`.

- [ ] **Step 11: Runtime check (manual)**

In the dev vault with `reasoningLanguage = "en"` and a note embedding an image/PDF written in Russian, run `format`. Confirm the vision reasoning in the progress bar stays English with no Russian fragments.

- [ ] **Step 12: Commit**

```bash
git add src/phases/attachment-analyzer.ts src/phases/format.ts
git commit -m "feat(vision): honor reasoningLanguage in attachment analysis"
```

---

### Task 4: Update docs (iwiki) + final verification

**Files:**
- Modify: `docs/wiki/` pages for the changed sources (via iwiki engine)

**Interfaces:**
- Consumes: the completed Tasks 1-3 changes.
- Produces: an up-to-date `docs/wiki/` graph with no broken refs/orphans.

- [ ] **Step 1: Regenerate the affected wiki pages**

For each changed source, run the ingest skill (it performs the manual Edit + `iwiki_engine index`):

```
iwiki:iwiki-ingest src/controller.ts
iwiki:iwiki-ingest src/phases/llm-utils.ts
iwiki:iwiki-ingest src/phases/attachment-analyzer.ts
iwiki:iwiki-ingest src/phases/format.ts
```

(Run one ingest per source; the skill regenerates/updates the matching `docs/wiki/` page.)

- [ ] **Step 2: Lint the wiki graph**

```
/iwiki-lint
```

Expected: no broken `[[refs]]`, no orphan or stale pages.

- [ ] **Step 3: Final full build + lint**

```bash
npm run build && npm run lint
```

Expected: both succeed.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/wiki
git commit -m "docs(wiki): reflect reasoning logging + language-rule changes"
```

---

## Self-Review

**Spec coverage:**
- Part A (reasoning logging) → Task 2 (field, reset, `logEvent` buffer/flush, callIndex stamping, runtime check). ✓
- Part B (stronger directives) → Task 1 (`reasoningDirective` export+strengthen, `langInstruction` strengthen, eval). ✓
- Part C (vision parity) → Task 3 (imports, three `*System()` builders, `analyzeImage`/`analyzePdf`/`analyzeExcalidraw`/`analyzeSingleAttachment`/`analyzeAttachments`, `format.ts` call site). ✓
- Spec "Files touched" list (`controller.ts`, `llm-utils.ts`, `attachment-analyzer.ts`, `format.ts`) → all covered; no `types.ts` change (record is an inline object). ✓
- Spec Verification (build/lint pass; consolidated reasoning records; English reasoning across phases incl. vision; iwiki update) → Tasks 2.6, 3.11, 1.5, 4. ✓
- Spec INFO finding F-001 (answer/output terminology) is a non-blocking doc nitpick on the spec text — no code impact, intentionally not a task.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full code; every command shows expected output. ✓

**Type consistency:** `reasoningDirective(lang: "ru"|"en"|"es"): string` defined in Task 1 and consumed unchanged in Task 3. The `reasoningLanguage` parameter is `OutputLanguage` (default `"auto"`) everywhere it is threaded; `resolveReasoningLang(reasoningLanguage, language)` matches the i18n signature. The flush record fields match the spec's documented shape. ✓
