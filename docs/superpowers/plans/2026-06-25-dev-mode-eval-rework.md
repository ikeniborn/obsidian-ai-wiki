---
review:
  plan_hash: 68ae4b40e2720e9c
  spec_hash: 09ead92eba32b2fa
  last_run: 2026-06-25
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: consistency
      severity: CRITICAL
      section: "Task 18: dspy orchestration — format/vision prompts + 👍-guard gate"
      section_hash: 37fb7fcdf3d781f4
      fragment: "evaluator_template = Path(prompts_dir, \"evaluator.md\").read_text(...)"
      text: "optimize.py still loads evaluator.md, which Task 13 deletes → FileNotFoundError at runtime; Task 18 never removed that line."
      fix: "Added explicit Step 1 to delete the evaluator.md read line."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Task 6: AgentRunner — telemetry accumulation + record assembly"
      section_hash: 48c7aa046ed500b2
      fragment: "writeEvalRecord(this.vaultTools.adapter, this.visionTempBaseDir, record)"
      text: "writeEvalRecord's pluginDir param was passed visionTempBaseDir — implicit coupling inviting regression."
      fix: "Named local `pluginDir = this.visionTempBaseDir` with a comment asserting it is the plugin base dir (Task 5 sets it)."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "Task 2: eval-log module (record types, path, write, rate)"
      section_hash: fcf974d986666661
      fragment: "foundPages?: string[]; ... sourcePath?: string;"
      text: "Plan used camelCase foundPages/sourcePath; spec/intent §4 schema uses snake_case found_pages/source_path → on-disk mismatch."
      fix: "Renamed to found_pages/source_path in EvalMetaFields and the query/format emit sites."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-004
      phase: consistency
      severity: INFO
      section: "Task 17: dspy optimizer — binary metric + 👍-guard"
      section_hash: 3277ae322a6dedbf
      fragment: "operation.endswith(\":recognition\")"
      text: "The :recognition metric branch is unreachable (recognition optimization deferred)."
      fix: "Kept as forward-compat; added a comment that :recognition is reserved for the deferred vision pass."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-005
      phase: coverage
      severity: WARNING
      section: "Task 18: dspy orchestration — format/vision prompts + 👍-guard gate"
      section_hash: 37fb7fcdf3d781f4
      fragment: "the optimized prompt must not regress (measured downstream by re-running eval)"
      text: "Spec §8 mandates an in-pipeline reject gate (candidate 👍-set mean < baseline → reject); plan only computed a trainset 👍-share and always wrote."
      fix: "Implemented the gate in run_mipro: reference-similarity metric + reject (return None) when candidate mean on the held-out 👍 set < baseline; optimize.py skips the write on None."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-006
      phase: coverage
      severity: INFO
      section: "Task 9: structured-retry telemetry"
      section_hash: 649c26701e3f7d64
      fragment: "mark `wrapWithJsonFallback` firings as out-of-scope and log that decision"
      text: "Spec §5 lists wrapWithJsonFallback as instrumented; plan allows dropping it when no event sink reaches that layer."
      fix: "Accepted best-effort deviation: parseWithRetry firing is required (has a sink); wrapWithJsonFallback is best-effort with a logged note. eval/dspy do not depend on it."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-007
      phase: dependencies
      severity: WARNING
      section: "Task 2: eval-log module (record types, path, write, rate)"
      section_hash: fcf974d986666661
      fragment: "types.ts imports EvalMetaFields from eval-log.ts"
      text: "Risk of an import cycle if eval-log.ts ever imports ./types."
      fix: "Added an explicit dependency rule to Task 2: eval-log.ts must not import ./types."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-008
      phase: verifiability
      severity: WARNING
      section: "Task 7: query/chat phases — emit eval_meta + rule_fired"
      section_hash: 4f89e2af5d6e9818
      fragment: "Use the actual local variable names present in `query.ts`"
      text: "DoD verified non-dev output unchanged but did not verify the rule_fired/eval_meta emissions actually fire with correct counts."
      fix: "Added a dev-mode DoD step: run a broken-link query and assert ruleFirings has the expected non-zero ruleIds."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-009
      phase: verifiability
      severity: WARNING
      section: "Task 8: format phase — visionCount, eval_meta, rule_fired"
      section_hash: 320b50384f514f25
      fragment: "OR (simpler, sufficient for provenance) hash the static set"
      text: "usedVisionTemplates source left undecided; DoD did not verify visionPromptVersion is populated for a vision run."
      fix: "Committed to returning usedTemplates from analyzeAttachments; added a dev-mode DoD asserting non-empty visionPromptVersion + visionCount>0 for a vision format run."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-010
      phase: dependencies
      severity: WARNING
      section: "Task 10: view — 👍/👎 rows, drop eval_result render"
      section_hash: 114b0c76e8ba7c44
      fragment: "renderRatingRow references i18n().view.ratingAnswer (added in Task 11)"
      text: "Self-found: Task 10 (view) uses i18n rating keys created in Task 11 — linting Task 10 before Task 11 fails (property does not exist). Order/artifact-availability violation the clean-context review missed."
      fix: "Added a Prerequisite note to Task 10: apply Task 11's i18n keys first (or lint both together)."
      verdict: fixed
      verdict_at: 2026-06-25
chain:
  intent: docs/superpowers/intents/2026-06-24-dev-mode-eval-rework-intent.md
  spec: docs/superpowers/specs/2026-06-25-dev-mode-eval-rework-design.md
---

# dev-mode eval rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dev-mode LLM-judge auto-score with human 👍/👎 quality labels persisted (with harness telemetry) to a plugin-dir `eval.jsonl`, and rework `scripts/eval.ts` + `scripts/dspy` to consume that dataset.

**Architecture:** Each dev-mode query/chat/format run appends one record to `.obsidian/plugins/ai-wiki/eval.jsonl` at run end (`rating: null`); a 👍/👎 click updates that record by `runId`. `AgentRunner` accumulates telemetry (`llmErrors[]`, `ruleFirings{}`) in-memory from a new `rule_fired` event + existing `error`/`structural_error` events, and assembles each record from a new `eval_meta` event the phases emit. `eval.ts` and `dspy` read `eval.jsonl`.

**Tech Stack:** TypeScript (Obsidian plugin, esbuild, no test runner — verify via `npm run lint` + `npm run build` + manual dev-mode run), Python (DSPy/MIPROv2, `uv`).

**Verification note:** This repo has **no functional test suite** (removed 2026-06-16 — do NOT re-add vitest/pytest). Every task verifies via `npm run lint`, `npm run build`, the dspy `make test`/`uv run pytest` that already exist for Python, and manual behavior checks in Obsidian dev mode.

**Branch:** all work on `dev/dev-mode-eval-rework`; merge to `master` via PR. Commit after every task.

**HUMAN CHECKPOINTS** (from the spec's Autonomy Zones — pause for human confirmation before executing): Task 13 (delete evaluator), Task 14 (delete retrieval harness), Tasks 16–19 (dspy pipeline design), and any step flagged `[GUARDED — non-dev path]` (Tasks 7, 8, 9, 12) must be reviewed to confirm the non-dev behavior is unchanged.

---

## File Structure

**New files:**
- `src/prompt-version.ts` — `hash8()` + memoized `promptVersionOf()` (content-hash of a prompt string).
- `src/eval-log.ts` — record types, plugin-dir path resolver, `writeEvalRecord()`, `updateEvalRating()`.

**Modified (plugin):**
- `src/types.ts` — `RunRequest.runId`; `RunEvent`: add `rule_fired` + `eval_meta`, remove `eval_result`; `DevMode`: drop `evaluatorModel`.
- `src/wiki-path.ts` — keep `GLOBAL_DEV_LOG_PATH`/`GLOBAL_AGENT_LOG_PATH` as migration sources only.
- `src/storage-migration.ts` — add idempotent vault→plugin-dir migration of `_dev.jsonl`/`_agent.jsonl`.
- `src/controller.ts` — pass resolved plugin dir to `AgentRunner`; thread `runId`; add `rateRun()`.
- `src/agent-runner.ts` — telemetry accumulation + `eval_meta` collection + `writeEvalRecord`; inject `runId` into `format_preview`; reuse `runId` for vision temp; remove `runEvaluator`/`writeDevLog`/`updateDevLogEval`.
- `src/phases/query.ts` — emit `eval_meta` + `rule_fired` at link rule sites. `[GUARDED]`
- `src/phases/format.ts` — add `visionCount` to `format_preview`; emit `eval_meta` + `rule_fired`. `[GUARDED]`
- `src/phases/chat.ts` — emit `eval_meta` for chat runs. `[GUARDED]`
- `src/phases/parse-with-retry.ts` + `src/phases/llm-utils.ts` — emit `rule_fired` for retries / json fallback. `[GUARDED]`
- `src/view.ts` — store `lastRunId`; render 👍/👎 rows (query/chat + format two axes); remove `eval_result` render.
- `src/i18n.ts` — rating labels (en/ru/es); update `devMode_enabled_desc`; drop evaluator keys.
- `src/settings.ts` — remove `evaluatorModel` UI. `[GUARDED]`

**Removed:**
- `src/phases/evaluator.ts`, `prompts/evaluator.md`.
- `scripts/eval-config.ts`, `eval-gold.ts`, `eval-metrics.ts`, `eval-report.ts`, `eval-retrieval.ts`, `eval-vault.ts`, `scripts/eval/`, and `scripts/obsidian-shim.ts` (only if no non-harness importer remains).

**Reworked harness:**
- `scripts/eval.ts` — read `eval.jsonl` → answer/format/recognition metrics + telemetry report.
- `scripts/dspy/lib/loader.py`, `lib/optimizer.py`, `optimize.py`, `.env.example`, `CLAUDE.md`.

---

# PHASE 1 — Foundation (plugin)

## Task 1: prompt-version content-hash util

**Files:**
- Create: `src/prompt-version.ts`

- [ ] **Step 1: Create the util**

```typescript
// src/prompt-version.ts
// Deterministic short content-hash of a prompt/template string, used as
// `promptVersion` provenance in eval.jsonl. FNV-1a → 8 hex chars. Pure JS,
// mobile-safe, captures the exact bytes that produced an LLM output.

const _cache = new Map<string, string>();

/** FNV-1a 32-bit hash of `s`, rendered as 8 lowercase hex chars. */
export function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Memoized hash8 of a prompt template string. */
export function promptVersionOf(template: string): string {
  let v = _cache.get(template);
  if (v === undefined) {
    v = hash8(template);
    _cache.set(template, v);
  }
  return v;
}

/**
 * Version of a set of vision templates the run invoked: sort the template
 * strings deterministically, hash each, join with "|", hash the join. The
 * per-template hash removes any concatenation-boundary ambiguity.
 */
export function visionPromptVersionOf(templates: string[]): string {
  if (templates.length === 0) return "";
  const joined = templates.map(hash8).sort().join("|");
  return hash8(joined);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no new errors referencing `src/prompt-version.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/prompt-version.ts
git commit -m "feat(dev-eval): add prompt content-hash util for provenance"
```

---

## Task 2: eval-log module (record types, path, write, rate)

**Files:**
- Create: `src/eval-log.ts`

The record writer and the rating updater both live here so `AgentRunner` (writer) and `WikiController` (rater) share one source of truth. Paths are resolved from the plugin dir passed in by the caller.

- [ ] **Step 1: Create the module**

> **Dependency rule:** `eval-log.ts` must NOT import from `./types` — `types.ts`
> imports `EvalMetaFields` from here (Task 3), so importing back would form a cycle.
> Keep this module's only import the `obsidian` `DataAdapter` type below.

On-disk field names follow the spec/intent §4 schema exactly: `found_pages` and
`source_path` are snake_case; every other field is camelCase (`runId`, `promptVersion`,
`visionModel`, `recognitionRating`, …).

```typescript
// src/eval-log.ts
// Per-run dev-mode eval dataset: one JSONL record per run in the plugin dir,
// updated in place by 👍/👎 clicks (matched by runId). Not synced (plugin dir
// is not vault content) — labels are per-device, by design.
import type { DataAdapter } from "obsidian";

export type Rating = "up" | "down" | null;

export interface LlmError {
  kind: "error" | "structural_error";
  callSite?: string;
  errorType?: string;
  retryAttempt?: number;
  message: string;
}

export interface RetrievalConfigSnapshot {
  mode: "embedding" | "jaccard" | "hybrid";
  seedTopK: number;
  bfsTopK: number;
  bfsFusion: boolean;
  seedSimilarityThreshold: number;
  hybridRetrieval: boolean;
}

/** Provenance the phases attach via the `eval_meta` event. All optional. */
export interface EvalMetaFields {
  question?: string;
  found_pages?: string[];   // snake_case per spec §4 schema
  answer?: string;
  promptVersion?: string;
  retrievalConfig?: RetrievalConfigSnapshot;
  source_path?: string;     // snake_case per spec §4 schema
  vision?: "on" | "off";
  visionCount?: number;
  visionModel?: string;
  visionPromptVersion?: string;
}

export interface EvalRecord extends EvalMetaFields {
  runId: string;
  ts: string;
  operation: string;
  model: string;
  llmErrors: LlmError[];
  ruleFirings: Record<string, number>;
  rating: Rating;
  recognitionRating?: Rating;
}

/** Rating axes a click can set. "answer"/"formatting" → `rating`; "recognition" → `recognitionRating`. */
export type RatingAxis = "answer" | "formatting" | "recognition";

export function evalLogPath(pluginDir: string): string {
  return `${pluginDir}/eval.jsonl`;
}

/** Append one record at run end. Never throws (logging must not break a run). */
export async function writeEvalRecord(
  adapter: DataAdapter,
  pluginDir: string,
  record: EvalRecord,
): Promise<void> {
  const path = evalLogPath(pluginDir);
  try {
    const line = JSON.stringify(record) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* never block the run */ }
}

/**
 * Update one record's rating in place, matched by runId. Re-clicking flips the
 * value (a second identical click clears it back to null). No duplicate rows.
 */
export async function updateEvalRating(
  adapter: DataAdapter,
  pluginDir: string,
  runId: string,
  axis: RatingAxis,
  rating: "up" | "down",
): Promise<void> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      const field = axis === "recognition" ? "recognitionRating" : "rating";
      rec[field] = rec[field] === rating ? null : rating; // flip / toggle off
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return;
    }
  } catch { /* never block the UI */ }
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: clean (no new errors in `src/eval-log.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/eval-log.ts
git commit -m "feat(dev-eval): add eval-log record schema + write/rate helpers"
```

---

## Task 3: types — runId, new events, drop evaluator

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `runId` to `RunRequest`**

In the `RunRequest` interface, add after `domainId?: string;`:

```typescript
  runId?: string;
```

- [ ] **Step 2: Add new RunEvent variants, remove `eval_result`**

In the `RunEvent` union: delete the line:

```typescript
  | { kind: "eval_result"; score: number; reasoning: string }
```

and add (import the meta type at top of file: `import type { EvalMetaFields } from "./eval-log";`):

```typescript
  | { kind: "rule_fired"; ruleId: string; count: number }
  | { kind: "eval_meta"; fields: EvalMetaFields }
```

- [ ] **Step 3: Add `runId` to `format_preview` + `visionCount`**

Replace the `format_preview` variant:

```typescript
  | { kind: "format_preview"; tempPath: string; report: string; missingTokens: { token: string; context: string }[]; runId?: string; visionCount?: number }
```

- [ ] **Step 4: Drop `evaluatorModel` from settings**

In `LlmWikiPluginSettings`, replace the `devMode` block with:

```typescript
  devMode: {
    enabled: boolean;
  };
```

and in `DEFAULT_SETTINGS`, replace with:

```typescript
  devMode: {
    enabled: false,
  },
```

- [ ] **Step 5: Verify (expect downstream errors to fix in later tasks)**

Run: `npm run lint`
Expected: errors ONLY in files that reference `eval_result` or `devMode.evaluatorModel` (`agent-runner.ts`, `view.ts`, `settings.ts`) — those are fixed in Tasks 6, 10, 12. No errors in `types.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(dev-eval): add runId/rule_fired/eval_meta events, drop evaluatorModel"
```

---

## Task 4: storage — keep old paths as migration source, add vault→plugin-dir migration

**Files:**
- Modify: `src/storage-migration.ts`
- Reference: `src/wiki-path.ts` (unchanged — `GLOBAL_DEV_LOG_PATH`/`GLOBAL_AGENT_LOG_PATH` stay as the migration sources)

The logs now live in the plugin dir. On load, move any existing vault copies into the plugin-dir files, then delete the vault copies. Idempotent: when the vault sources are absent the function is a no-op.

**This task plus its cross-references covers all three spec §3 requirements:**

1. **Runtime-resolved plugin-dir paths (not static consts).** The write/read paths are
   built at runtime from the plugin's `manifest.dir` — `evalLogPath(pluginDir) =
   ${pluginDir}/eval.jsonl` (Task 2), the controller resolves `manifest.dir` with a
   fallback and passes it as `AgentRunner`'s 6th arg (Task 5 Step 1), and `AgentRunner`
   uses it as `pluginDir` (Task 6 Step 5). `src/wiki-path.ts`'s `GLOBAL_DEV_LOG_PATH` /
   `GLOBAL_AGENT_LOG_PATH` constants remain ONLY as the migration sources below — they are
   never written to again.
2. **Idempotent auto-migration on update** — `migrateLogsToPluginDir` (Steps 1–2): moves
   `_dev.jsonl` → `eval.jsonl` and `_agent.jsonl` → `agent.jsonl`, then deletes the vault
   copy; a second load finds no vault source and is a no-op (Step 4 verifies).
3. **Legacy lines without `rating` are skipped by readers.** The migration appends the old
   `_dev.jsonl` content **verbatim** — those lines carry the old judge-score shape (no
   `runId`/`rating`). They are then ignored, not crashed on: `eval.ts` `parseLog` keeps a
   line only when it has a `rating` field (Task 15), the dspy loader keeps a record only
   when `rating ∈ {up,down}` (Task 16), and `updateEvalRating` matches by `runId` which
   legacy lines lack (Task 2). No reader fails on a legacy line.

- [ ] **Step 1: Add a new exported migration function**

Append to `src/storage-migration.ts` (it already imports `GLOBAL_AGENT_LOG_PATH`, `GLOBAL_DEV_LOG_PATH`, `WIKI_ROOT`):

```typescript
/**
 * Relocate the dev-mode logs out of the synced vault into the plugin dir.
 * `_dev.jsonl` → `<pluginDir>/eval.jsonl`, `_agent.jsonl` → `<pluginDir>/agent.jsonl`.
 * Appends vault content to the plugin-dir file, then removes the vault copy.
 * Idempotent — a no-op when no vault copies exist. Best-effort; never throws.
 */
export async function migrateLogsToPluginDir(vault: Vault, pluginDir: string): Promise<void> {
  const adapter = vault.adapter;
  const moves: Array<[string, string]> = [
    [GLOBAL_DEV_LOG_PATH, `${pluginDir}/eval.jsonl`],
    [GLOBAL_AGENT_LOG_PATH, `${pluginDir}/agent.jsonl`],
  ];
  for (const [src, dst] of moves) {
    try {
      if (!(await adapter.exists(src))) continue;
      const content = await adapter.read(src);
      if (content) {
        if (await adapter.exists(dst)) await adapter.append(dst, content);
        else await adapter.write(dst, content);
      }
      await adapter.remove(src);
    } catch { /* best-effort */ }
  }
}
```

- [ ] **Step 2: Call it on plugin load**

In `src/main.ts` (the plugin's `onload`), find where `cleanupBundledSchemaCopies` / `runStorageMigration` are awaited and add alongside (the plugin dir is `this.manifest.dir`):

```typescript
    await migrateLogsToPluginDir(this.app.vault, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
```

Add `migrateLogsToPluginDir` to the existing import from `./storage-migration`.

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: clean for `storage-migration.ts` and `main.ts`.

- [ ] **Step 4: Manual check (after a build later)**

With a vault that has `!Wiki/_config/_dev.jsonl`, load the plugin once → the file is gone and its content is in `.obsidian/plugins/ai-wiki/eval.jsonl`. Load again → unchanged (idempotent).

- [ ] **Step 5: Commit**

```bash
git add src/storage-migration.ts src/main.ts
git commit -m "feat(dev-eval): migrate dev/agent logs from vault to plugin dir on load"
```

---

## Task 5: controller — plugin-dir to AgentRunner, runId, rateRun()

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Always pass a resolved plugin dir to `AgentRunner`**

At the `new AgentRunner(...)` call (currently passes `this.plugin.manifest.dir ?? undefined`), replace the 6th argument with a guaranteed value:

```typescript
    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`, Platform.isMobile);
```

- [ ] **Step 2: Thread `runId` into the run request**

In `dispatch(...)`, the run already has `const sessionId = String(startedAt);`. Add `runId: sessionId` to the `agentRunner.run({...})` request object:

```typescript
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages, lintOpts, runId: sessionId });
```

Do the same in `dispatchChat(...)` (`runId: String(startedAt)` — use that path's own `startedAt`/sessionId variable).

- [ ] **Step 3: Add a private plugin-dir helper + public `rateRun`**

Add a helper (next to other private helpers) and a public method (next to `query`). Add the import at the top: `import { updateEvalRating, type RatingAxis } from "./eval-log";`

```typescript
  private pluginDir(): string {
    return this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
  }

  /** Set a 👍/👎 label on a finished run's eval.jsonl record (dev mode only). */
  async rateRun(runId: string, axis: RatingAxis, rating: "up" | "down"): Promise<void> {
    if (!this.plugin.settings.devMode?.enabled) return;
    await updateEvalRating(this.app.vault.adapter, this.pluginDir(), runId, axis, rating);
  }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: clean for `controller.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(dev-eval): thread runId + plugin dir; add controller.rateRun"
```

---

## Task 6: AgentRunner — telemetry accumulation + record assembly

**Files:**
- Modify: `src/agent-runner.ts`

This replaces `writeDevLog`/`updateDevLogEval`/`runEvaluator` with the new per-run record writer. The run loop accumulates telemetry from `error`/`structural_error`/`rule_fired` and the provenance from `eval_meta`, injects `runId` into `format_preview`, and writes one `EvalRecord` at run end.

- [ ] **Step 1: Update imports**

Remove `import { runEvaluator } from "./phases/evaluator";` and the `GLOBAL_DEV_LOG_PATH` import. Add:

```typescript
import { writeEvalRecord, type EvalRecord, type EvalMetaFields, type LlmError } from "./eval-log";
```

- [ ] **Step 2: Delete `writeDevLog` and `updateDevLogEval`**

Remove both private methods entirely (lines for `private async writeDevLog(...)` and `private async updateDevLogEval(...)`).

- [ ] **Step 3: Reuse the threaded `runId` for the vision temp dir**

Replace the vision-temp block:

```typescript
    let visionTempStore: VisionTempStore | undefined;
    if (req.operation === "format" && this.settings.vision?.enabled && this.visionTempBaseDir) {
      const runId = req.runId ?? Date.now().toString(36);
      visionTempStore = new VisionTempStore(this.vaultTools, `${this.visionTempBaseDir}/.vision-tmp/${runId}`);
    }
```

- [ ] **Step 4: Accumulate telemetry + meta in the event loop**

Just before the `while (true)` loop (after `let attempt = 0;`), add run-scoped accumulators:

```typescript
    const llmErrors: LlmError[] = [];
    const ruleFirings: Record<string, number> = {};
    let evalMeta: EvalMetaFields = {};
```

Inside the `for await (const ev of this.runOperation(...))` loop, before `yield ev;`, add:

```typescript
        if (ev.kind === "error") {
          llmErrors.push({ kind: "error", message: ev.message });
        } else if (ev.kind === "structural_error") {
          llmErrors.push({ kind: "structural_error", callSite: ev.callSite, errorType: ev.errorType, retryAttempt: ev.retryAttempt, message: ev.message });
        } else if (ev.kind === "rule_fired") {
          ruleFirings[ev.ruleId] = (ruleFirings[ev.ruleId] ?? 0) + ev.count;
        } else if (ev.kind === "eval_meta") {
          evalMeta = { ...evalMeta, ...ev.fields };
        } else if (ev.kind === "format_preview" && req.runId) {
          ev.runId = req.runId; // so the view's 👍/👎 buttons know which record to update
        }
```

(The `rule_fired`/`eval_meta` events are internal-only; the view ignores them.)

- [ ] **Step 5: Replace the devMode write block**

Replace the whole `if (this.settings.devMode?.enabled && finalResultText) { ... }` block (the one calling `writeDevLog` + `runEvaluator`) with:

```typescript
        if (this.settings.devMode?.enabled && finalResultText && req.runId && this.visionTempBaseDir) {
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
            ...(evalMeta.vision === "on" ? { recognitionRating: null as null } : {}),
          };
          // `visionTempBaseDir` IS the plugin base dir — the controller passes the
          // resolved `manifest.dir` as the 6th ctor arg (Task 5). eval.jsonl lives at
          // its root, not in the .vision-tmp subdir.
          const pluginDir = this.visionTempBaseDir;
          await writeEvalRecord(this.vaultTools.adapter, pluginDir, record);
        }
        return;
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: clean for `agent-runner.ts` (the `evaluator.ts` import is gone; `eval_result` is no longer referenced).

- [ ] **Step 7: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(dev-eval): accumulate telemetry + write per-run eval record"
```

---

## Task 7: query/chat phases — emit eval_meta + rule_fired `[GUARDED — non-dev path]`

**Files:**
- Modify: `src/phases/query.ts`
- Modify: `src/phases/chat.ts`

> **HUMAN CHECKPOINT:** these are additive event emissions only — they must NOT change retrieval, answers, or any non-dev behavior. Review the diff to confirm only `yield { kind: "rule_fired"/"eval_meta", ... }` lines were added.

- [ ] **Step 1: query.ts — capture retrieval config + found pages**

`runQuery` already has the settings-derived params in scope (`seedTopK`, `bfsTopK`, fusion flags) and emits `graph_stats` with `seeds`/`expandedPages`. Add imports:

```typescript
import { promptVersionOf } from "../prompt-version";
import queryTemplate from "../../prompts/query.md"; // if not already imported under another name
```

(If `query.md` is already imported as e.g. `queryPrompt`, reuse that variable instead of adding a second import.)

- [ ] **Step 2: query.ts — emit rule_fired at the deterministic link sites**

At the link-validation block (where `resolveLink` is called per broken stem and `annotateBroken` runs), tally and emit. Counts come from the structured returns / caller-side knowledge — no `info_text` parsing:

```typescript
        // after the resolveLink loop, where `resolvedPairs` / resolved count is known:
        if (resolvedCount > 0) yield { kind: "rule_fired", ruleId: "resolveLink", count: resolvedCount };
        // where annotateBroken(text, brokenSet) runs:
        if (brokenSet.size > 0) yield { kind: "rule_fired", ruleId: "annotateBroken", count: brokenSet.size };
```

For `fixWikiLinks` / `stripDeadLinks` invoked in query (if present in this phase), emit a firing when the rule changed the text — derive the count by comparing input vs output (structural, no parsing):

```typescript
        // fixWikiLinks: count = pages whose content changed
        const wlFixedCount = [...inputPages].filter(([id, before]) => fixed.get(id) !== before).length;
        if (wlFixedCount > 0) yield { kind: "rule_fired", ruleId: "fixWikiLinks", count: wlFixedCount };
        // stripDeadLinks(content): emit 1 when it changed the body
        if (afterStrip !== beforeStrip) yield { kind: "rule_fired", ruleId: "stripDeadLinks", count: 1 };
```

(Use the actual local variable names present in `query.ts`; the pattern is "compare the rule's input to its output, emit the count of changed units".)

- [ ] **Step 3: query.ts — emit eval_meta near the end (before/after the final `result`)**

```typescript
    yield {
      kind: "eval_meta",
      fields: {
        question,
        answer,
        found_pages: [...new Set([...seeds, ...expandedPages])],
        promptVersion: promptVersionOf(queryTemplate),
        retrievalConfig: {
          mode: similarity ? (hybrid ? "hybrid" : "embedding") : "jaccard",
          seedTopK, bfsTopK,
          bfsFusion: bfsFusion ?? false,
          seedSimilarityThreshold: seedSimilarityThreshold ?? 0,
          hybridRetrieval: hybrid ?? false,
        },
      },
    };
```

(Use the in-scope variable names; `question` = the query arg, `answer` = the final answer text, `seeds`/`expandedPages` from the graph_stats computation.)

- [ ] **Step 4: chat.ts — emit eval_meta**

In `runLintChat`, near the end, emit minimal provenance (chat reuses the query/chat schema):

```typescript
import { promptVersionOf } from "../prompt-version";
import chatTemplate from "../../prompts/chat.md"; // reuse existing import if present

    yield {
      kind: "eval_meta",
      fields: { question: lastUserMessage, answer: replyText, promptVersion: promptVersionOf(chatTemplate) },
    };
```

(`lastUserMessage` = the last `user` entry in `chatMessages`; `replyText` = the assistant reply.)

- [ ] **Step 5: Verify (non-dev behavior unchanged)**

Run: `npm run lint`
Then build (`npm run build`) and, in a non-dev vault, run a query → confirm the answer + retrieval are byte-identical to before (the new events are inert).

- [ ] **Step 6: Verify (dev-mode telemetry fires)**

Enable `devMode`. In a vault where a query produces a broken `[[WikiLink]]` (so `resolveLink`/`annotateBroken` run), run that query. Open `.obsidian/plugins/ai-wiki/eval.jsonl` → the new record has `ruleFirings` containing the expected ruleIds (e.g. `resolveLink` and/or `annotateBroken`) with non-zero counts, plus `question`, `answer`, `found_pages`, `promptVersion`, `retrievalConfig`. Expected: counts match what the run actually did (no zero/missing firing for a rule that visibly ran).

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts src/phases/chat.ts
git commit -m "feat(dev-eval): emit eval_meta + rule_fired from query/chat"
```

---

## Task 8: format phase — visionCount, eval_meta, rule_fired `[GUARDED — non-dev path]`

**Files:**
- Modify: `src/phases/format.ts`

> **HUMAN CHECKPOINT:** additive only — no change to formatting output, sentinel handling, or vision behavior.

- [ ] **Step 1: Add imports + track invoked vision templates**

```typescript
import { promptVersionOf, visionPromptVersionOf } from "../prompt-version";
import formatTemplate from "../../prompts/format.md"; // reuse existing import if present
```

`runFormat` receives `visionSettings` and builds `visionDescriptions` (a `Map`). To compute `visionPromptVersion`, collect the vision template strings that were actually used. **Decision (committed):** extend `analyzeAttachments` (`src/phases/attachment-analyzer.ts`) to also return the set of distinct vision template strings it invoked — `{ descriptions, usedTemplates }` where `usedTemplates: string[]` is the de-duplicated list of the `vision-*.md` module strings used for the attachments processed (`vision-structure.md` + the per-type prompt for each attachment kind seen). `runFormat` keeps this as `usedVisionTemplates` and passes it to `visionPromptVersionOf`. (Do NOT hash a static capability set — hash only what actually ran, so the provenance maps to the exact prompts that produced the recognitions.)

- [ ] **Step 2: Add `visionCount` to the `format_preview` event**

At the `yield { kind: "format_preview", ... }` line, add `visionCount`:

```typescript
  yield { kind: "format_preview", tempPath, report: finalReport, missingTokens: missingFinal, visionCount: visionDescriptions.size };
```

(`runId` is injected by `AgentRunner` as the event passes through — see Task 6 Step 4.)

- [ ] **Step 3: Emit `rule_fired` for the sentinel sweep + salvage**

At the `stripSentinelMarkers` sweep:

```typescript
  if (swept.removed.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "Sentinel markers stripped", details: swept.removed };
    yield { kind: "rule_fired", ruleId: "stripSentinelMarkers", count: swept.removed.length };
  }
```

At each truncation-salvage `info_text` (first pass and retry pass), add after it:

```typescript
    yield { kind: "rule_fired", ruleId: "formatSalvage", count: 1 };
```

- [ ] **Step 4: Emit `eval_meta` before the final `result`**

```typescript
  const visionOn = visionDescriptions.size > 0;
  yield {
    kind: "eval_meta",
    fields: {
      source_path: formatArgs[0] ?? "",
      vision: visionOn ? "on" : "off",
      visionCount: visionDescriptions.size,
      visionModel: visionOn ? (visionSettings.model || undefined) : undefined,
      promptVersion: promptVersionOf(formatTemplate),
      visionPromptVersion: visionOn ? visionPromptVersionOf(usedVisionTemplates) : undefined,
    },
  };
```

(`usedVisionTemplates` is the array returned by `analyzeAttachments` per Step 1.)

- [ ] **Step 5: Verify (non-dev unchanged)**

Run: `npm run lint` then `npm run build`. In a non-dev vault, format a file with and without an image → output identical to before; preview renders normally.

- [ ] **Step 6: Verify (dev-mode format provenance)**

Enable `devMode`. Format a file **with** an embedded image → the preview shows both a formatting and a recognition 👍/👎 row, and the `eval.jsonl` record has `vision: "on"`, `visionCount > 0`, a **non-empty** `visionPromptVersion`, and `source_path` set. Format a file **without** an image → only the formatting row; the record has `vision: "off"`, no `recognitionRating`, and `visionPromptVersion` absent.

- [ ] **Step 7: Commit**

```bash
git add src/phases/format.ts src/phases/attachment-analyzer.ts
git commit -m "feat(dev-eval): emit eval_meta + rule_fired + visionCount from format"
```

---

## Task 9: structured-retry telemetry `[GUARDED — non-dev path]`

**Files:**
- Modify: `src/phases/parse-with-retry.ts`
- Modify: `src/phases/llm-utils.ts`

> **HUMAN CHECKPOINT:** additive only.

`parseWithRetry` already emits `structural_error` per attempt (→ `AgentRunner` records those into `llmErrors`). Add a `rule_fired` for the retry firing so it also appears in `ruleFirings`, and one for the json fallback.

- [ ] **Step 1: parse-with-retry.ts — emit rule_fired on a retry**

Where a retry attempt happens (attempt index > 0), emit:

```typescript
      onEvent?.({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });
```

(Use the existing event-emit channel `parseWithRetry` already uses for `structural_error`.)

- [ ] **Step 2: llm-utils.ts — emit rule_fired when the json fallback engages**

In `wrapWithJsonFallback`, on the 400/422 retry-without-`response_format` branch, emit a `rule_fired` via whatever event sink is available at that layer. If no event sink is plumbed there, increment via the shared mechanism the caller can observe — otherwise record it through the same `onEvent` used by the active phase. If neither is available cheaply, mark `wrapWithJsonFallback` firings as out-of-scope and **log** that decision in the commit message (the spec's "no silent caps" — surface what was dropped).

- [ ] **Step 3: Verify**

Run: `npm run lint`. Confirm `structural_error` events still flow unchanged (status bar `schema: failed/total` still updates).

- [ ] **Step 4: Commit**

```bash
git add src/phases/parse-with-retry.ts src/phases/llm-utils.ts
git commit -m "feat(dev-eval): emit rule_fired for retries + json fallback"
```

---

## Task 10: view — 👍/👎 rows, drop eval_result render

**Files:**
- Modify: `src/view.ts`

> **Prerequisite (dependency):** apply **Task 11** (i18n rating keys) **before** this task — `renderRatingRow` references `i18n().view.ratingUp/ratingDown/ratingAnswer/ratingFormatting/ratingRecognition`, which are strongly-typed and added in Task 11. Linting Task 10 first fails with "property does not exist". Either do Task 11 first, or apply both Task 10 and Task 11 before running `npm run lint` on either.

- [ ] **Step 1: Add a `lastRunId` field**

In the class fields, add:

```typescript
  private lastRunId: string | null = null;
```

- [ ] **Step 2: Remove the `eval_result` render block**

Delete the `} else if (ev.kind === "eval_result") { ... }` block (the one rendering `**[eval: N/10]**` into `stepsEl`).

- [ ] **Step 3: Add a reusable rating-row helper**

Add a private method (uses `this.plugin.controller.rateRun` and `i18n()`):

```typescript
  private renderRatingRow(
    parent: HTMLElement,
    runId: string,
    axis: import("./eval-log").RatingAxis,
    label: string,
  ): void {
    if (!this.plugin.settings.devMode?.enabled) return;
    const T = i18n();
    const row = parent.createDiv("ai-wiki-rating-row");
    row.createSpan({ text: label, cls: "ai-wiki-rating-label" });
    const up = row.createEl("button", { text: "👍", cls: "ai-wiki-rating-btn", attr: { "aria-label": T.view.ratingUp } });
    const down = row.createEl("button", { text: "👎", cls: "ai-wiki-rating-btn", attr: { "aria-label": T.view.ratingDown } });
    const select = (btn: HTMLElement, other: HTMLElement, rating: "up" | "down") => {
      btn.addEventListener("click", () => {
        const active = btn.hasClass("is-active");
        btn.toggleClass("is-active", !active);
        other.removeClass("is-active");
        void this.plugin.controller.rateRun(runId, axis, rating);
      });
    };
    select(up, down, "up");
    select(down, up, "down");
  }
```

- [ ] **Step 4: Render the query/chat rating row in `finish()`**

In `finish(entry)`, after the answer markdown is rendered (inside the `if (entry.finalText)` block, after `this.resultToggle.setText("▼");`), add:

```typescript
      this.lastRunId = entry.id;
      const RATED_OPS: WikiOperation[] = ["query", "chat", "lint-chat", "ingest", "lint", "init", "delete", "format"];
      const QC_OPS: WikiOperation[] = ["query", "chat", "lint-chat"];
      if (QC_OPS.includes(entry.operation) && entry.status === "done") {
        this.renderRatingRow(this.resultSection, entry.id, "answer", i18n().view.ratingAnswer);
      }
      void RATED_OPS;
```

(Only query/chat get the answer row here; format gets its rows in the preview — Step 5.)

- [ ] **Step 5: Render format rating rows in `renderFormatPreview`**

Change the method signature to accept `runId` + `visionCount`:

```typescript
  private renderFormatPreview(tempPath: string, report: string, missing: { token: string; context: string }[], runId?: string, visionCount?: number): void {
```

Update the call site (the `format_preview` dispatch near the top of `appendEvent`):

```typescript
    if (ev.kind === "format_preview") {
      this.renderFormatPreview(ev.tempPath, ev.report, ev.missingTokens, ev.runId, ev.visionCount);
      return;
    }
```

At the end of `renderFormatPreview` (after `btnRow` actions), add:

```typescript
    if (runId) {
      this.renderRatingRow(this.formatPreviewSection, runId, "formatting", i18n().view.ratingFormatting);
      if ((visionCount ?? 0) > 0) {
        this.renderRatingRow(this.formatPreviewSection, runId, "recognition", i18n().view.ratingRecognition);
      }
    }
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: clean (no `eval_result` reference remains).

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(dev-eval): render 👍/👎 rating rows (query/chat + format axes)"
```

---

## Task 11: i18n — rating labels, drop evaluator desc

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add rating keys to each `view:` object (en/ru/es)**

In `en.view` add:

```typescript
    ratingUp: "Good output",
    ratingDown: "Bad output",
    ratingAnswer: "Rate this answer:",
    ratingFormatting: "Rate formatting:",
    ratingRecognition: "Rate recognition:",
```

In `ru.view`:

```typescript
    ratingUp: "Хороший вывод",
    ratingDown: "Плохой вывод",
    ratingAnswer: "Оцените ответ:",
    ratingFormatting: "Оцените форматирование:",
    ratingRecognition: "Оцените распознавание:",
```

In `es.view`:

```typescript
    ratingUp: "Buen resultado",
    ratingDown: "Mal resultado",
    ratingAnswer: "Evalúa la respuesta:",
    ratingFormatting: "Evalúa el formato:",
    ratingRecognition: "Evalúa el reconocimiento:",
```

- [ ] **Step 2: Update `devMode_enabled_desc` (no more evaluator) + drop evaluator keys**

In each language's `settings` object, replace `devMode_enabled_desc` and delete `devMode_evaluatorModel_name` / `devMode_evaluatorModel_desc`:

- en: `devMode_enabled_desc: "Record per-run quality labels (👍/👎) and harness telemetry to eval.jsonl.",`
- ru: `devMode_enabled_desc: "Записывать per-run метки качества (👍/👎) и телеметрию харнеса в eval.jsonl.",`
- es: `devMode_enabled_desc: "Registrar etiquetas de calidad por ejecución (👍/👎) y telemetría en eval.jsonl.",`

- [ ] **Step 3: Verify**

Run: `npm run lint` (catches any leftover reference to the removed keys).

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(dev-eval): add rating i18n strings; drop evaluator strings"
```

---

## Task 12: settings — remove evaluatorModel UI `[GUARDED]`

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Remove the evaluatorModel Setting block**

Delete the inner `if (s.devMode.enabled) { new Setting(...evaluatorModel...) }` block. Keep the dev-mode heading + the enabled toggle, but drop the `this.display()` re-render dependency on `evaluatorModel` (the toggle's `onChange` can keep `this.display()` or drop it — keep it for consistency):

```typescript
    // ── Dev mode ──────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
      new Setting(containerEl).setName(T.settings.h3_devmode).setHeading();

      new Setting(containerEl)
        .setName(T.settings.devMode_enabled_name)
        .setDesc(T.settings.devMode_enabled_desc)
        .addToggle((t) =>
          t.setValue(s.devMode.enabled)
            .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); }),
        );
    }
```

- [ ] **Step 2: Verify**

Run: `npm run lint` then `npm run build`
Expected: build succeeds; no reference to `evaluatorModel` anywhere (`grep -rn "evaluatorModel" src` returns nothing).

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat(dev-eval): remove evaluator model setting UI"
```

---

## Task 13: remove the LLM judge `[HUMAN CHECKPOINT — deletion]`

**Files:**
- Delete: `src/phases/evaluator.ts`, `prompts/evaluator.md`

> **HUMAN CHECKPOINT:** confirm with the user before deleting. All references must already be gone (Tasks 3, 6, 11, 12).

- [ ] **Step 1: Confirm no references**

Run: `grep -rn "evaluator\|eval_result\|runEvaluator" src prompts | grep -v eval-log | grep -v eval_meta`
Expected: no matches (other than unrelated words). If any remain, fix before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/phases/evaluator.ts prompts/evaluator.md
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(dev-eval): remove LLM judge (evaluator phase + prompt)"
```

---

# PHASE 2 — eval.ts harness

## Task 14: remove retrieval-eval harness `[HUMAN CHECKPOINT — deletion]`

**Files:**
- Delete: `scripts/eval-config.ts`, `scripts/eval-gold.ts`, `scripts/eval-metrics.ts`, `scripts/eval-report.ts`, `scripts/eval-retrieval.ts`, `scripts/eval-vault.ts`, `scripts/eval/`
- Conditionally delete: `scripts/obsidian-shim.ts`

> **HUMAN CHECKPOINT:** confirm before deleting.

- [ ] **Step 1: Check obsidian-shim usage**

Run: `grep -rn "obsidian-shim" scripts`
If the only importers are the eval-* files being deleted → delete it too. Otherwise keep it. **Log the decision in the commit message.**

- [ ] **Step 2: Delete (eval.ts itself is rewritten in Task 15, not deleted)**

```bash
git rm scripts/eval-config.ts scripts/eval-gold.ts scripts/eval-metrics.ts scripts/eval-report.ts scripts/eval-retrieval.ts scripts/eval-vault.ts
git rm -r scripts/eval
# git rm scripts/obsidian-shim.ts   # only if Step 1 confirmed no other importer
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: `eval.ts` will error (it imports the deleted files) — that is fixed in Task 15. No other file should error.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(dev-eval): remove retrieval Recall@k/MRR harness"
```

---

## Task 15: new eval.ts — quality + telemetry report over eval.jsonl

**Files:**
- Rewrite: `scripts/eval.ts`
- Modify: `package.json`

- [ ] **Step 1: Replace `scripts/eval.ts` entirely**

```typescript
#!/usr/bin/env node
// Dev-mode quality + telemetry report over eval.jsonl (human 👍/👎 labels).
//
// Usage:
//   tsx scripts/eval.ts [--log <eval.jsonl>]
//   default --log: .obsidian/plugins/ai-wiki/eval.jsonl under the current vault,
//   or pass an absolute path.
import { readFile } from "node:fs/promises";

type Rating = "up" | "down" | null;
interface Rec {
  operation: string;
  promptVersion?: string;
  visionPromptVersion?: string;
  vision?: "on" | "off";
  rating: Rating;
  recognitionRating?: Rating;
  llmErrors?: { kind: string }[];
  ruleFirings?: Record<string, number>;
}

function parseLog(text: string): Rec[] {
  const out: Rec[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as Rec;
      if (r && typeof r.operation === "string" && "rating" in r) out.push(r); // skip legacy lines
    } catch { /* skip malformed */ }
  }
  return out;
}

function upRate(recs: Rec[], field: "rating" | "recognitionRating"): string {
  const labeled = recs.filter((r) => r[field] === "up" || r[field] === "down");
  if (labeled.length === 0) return "n/a (0 labels)";
  const up = labeled.filter((r) => r[field] === "up").length;
  return `${((up / labeled.length) * 100).toFixed(0)}% 👍 (${up}/${labeled.length})`;
}

function byPrompt(recs: Rec[], field: "rating" | "recognitionRating", key: "promptVersion" | "visionPromptVersion"): string[] {
  const groups = new Map<string, Rec[]>();
  for (const r of recs) {
    const k = r[key] ?? "—";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([k, g]) => `    ${key}=${k}: ${upRate(g, field)}`);
}

function main(args: string[]): void {
  const logFlag = args.indexOf("--log");
  const logPath = logFlag !== -1 ? args[logFlag + 1] : ".obsidian/plugins/ai-wiki/eval.jsonl";

  void (async () => {
    const recs = parseLog(await readFile(logPath, "utf8"));
    const qc = recs.filter((r) => r.operation === "query" || r.operation === "chat" || r.operation === "lint-chat");
    const fmt = recs.filter((r) => r.operation === "format");
    const fmtOn = fmt.filter((r) => r.vision === "on");
    const fmtOff = fmt.filter((r) => r.vision === "off");

    const lines: string[] = [];
    lines.push(`eval.jsonl — ${recs.length} records (${logPath})`);
    lines.push("");
    lines.push(`Answer quality (query/chat): ${upRate(qc, "rating")}`);
    lines.push(...byPrompt(qc, "rating", "promptVersion"));
    lines.push("");
    lines.push(`Format quality — vision OFF: ${upRate(fmtOff, "rating")}`);
    lines.push(...byPrompt(fmtOff, "rating", "promptVersion"));
    lines.push(`Format quality — vision ON:  ${upRate(fmtOn, "rating")}`);
    lines.push(...byPrompt(fmtOn, "rating", "promptVersion"));
    lines.push(`Recognition quality (vision ON): ${upRate(fmtOn, "recognitionRating")}`);
    lines.push(...byPrompt(fmtOn, "recognitionRating", "visionPromptVersion"));
    lines.push("");

    // Telemetry report: error rate + rule firings per promptVersion.
    lines.push("Telemetry (per promptVersion):");
    const groups = new Map<string, Rec[]>();
    for (const r of recs) {
      const k = `${r.operation}/${r.promptVersion ?? "—"}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    for (const [k, g] of groups) {
      const errs = g.reduce((n, r) => n + (r.llmErrors?.length ?? 0), 0);
      const firings: Record<string, number> = {};
      for (const r of g) for (const [rid, c] of Object.entries(r.ruleFirings ?? {})) firings[rid] = (firings[rid] ?? 0) + c;
      const fireStr = Object.entries(firings).map(([rid, c]) => `${rid}=${c}`).join(", ") || "none";
      lines.push(`  ${k}: ${g.length} runs, ${errs} llmErrors, firings: ${fireStr}`);
    }

    console.log(lines.join("\n"));
  })().catch((err) => {
    console.error(`[eval] ${(err as Error).message}`);
    process.exit(1);
  });
}

main(process.argv.slice(2));
```

- [ ] **Step 2: Keep the `eval` npm script (drop the eval-specific tsconfig if now unused)**

In `package.json`, simplify the script (the new `eval.ts` only uses `node:fs` + JSON, no `obsidian` alias, so the special tsconfig may be unnecessary — keep it only if `tsx` needs it for path aliases):

```json
    "eval": "tsx scripts/eval.ts",
```

If `scripts/tsconfig.eval.json` is no longer referenced anywhere, delete it (`grep -rn "tsconfig.eval" .` first).

- [ ] **Step 3: Verify**

Run: `npx tsx scripts/eval.ts --log /tmp/nonexistent.jsonl`
Expected: prints `[eval] ENOENT...` and exits 1 (graceful). Create a 2-line sample `eval.jsonl` and run `npx tsx scripts/eval.ts --log sample.jsonl` → prints the report sections.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval.ts package.json
git commit -m "feat(dev-eval): rewrite eval.ts as quality + telemetry report over eval.jsonl"
```

---

# PHASE 3 — dspy rework `[HUMAN CHECKPOINT — pipeline design]`

> **HUMAN CHECKPOINT:** the dspy pipeline (what is optimized + how "did not regress 👍" is measured) is proposal-first. Confirm the design in Tasks 16–18 with the user before running an optimization.

## Task 16: dspy loader — read rating + vision bucket

**Files:**
- Modify: `scripts/dspy/lib/loader.py`

- [ ] **Step 1: Replace `load_examples`**

```python
from __future__ import annotations
import json
from collections import defaultdict


def _bucket(entry: dict) -> str:
    """Group key: format runs split by vision on/off; others by operation."""
    op = entry.get("operation")
    if op == "format":
        return "format:vision-on" if entry.get("vision") == "on" else "format:vision-off"
    return op


def load_examples(
    log_path: str,
    operations: list[str] | None,
    min_examples: int,
) -> dict[str, list[dict]]:
    """
    Read the eval.jsonl dataset, group by bucket (operation, with format split by
    vision on/off), keep only records carrying a 👍/👎 `rating`. Skips legacy
    judge-score lines (no `rating`). Fields: operation, question, answer, rating,
    recognitionRating?, vision?, promptVersion, visionPromptVersion?.
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
            # require a human label (👍/👎); skip legacy/unlabeled rows
            if entry.get("rating") not in ("up", "down"):
                continue

            grouped[_bucket(entry)].append(entry)

    return {
        b: entries
        for b, entries in grouped.items()
        if len(entries) >= min_examples
    }
```

- [ ] **Step 2: Verify**

Run: `cd scripts/dspy && uv run pytest tests/test_loader.py`
Expected: update the test fixtures to the new schema (records with `rating`) so the loader tests pass. (Tests already exist; adjust their sample lines to `{"operation":"query","question":"q","answer":"a","rating":"up"}`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/dspy/lib/loader.py scripts/dspy/tests/test_loader.py
git commit -m "feat(dev-eval): dspy loader reads 👍/👎 rating + vision buckets"
```

---

## Task 17: dspy optimizer — binary metric + 👍-guard

**Files:**
- Modify: `scripts/dspy/lib/optimizer.py`

- [ ] **Step 1: Replace the example build + metric + add the 👍-guard**

> **HUMAN CHECKPOINT (dspy design):** the candidate-scoring function below
> (`_jaccard` reference-similarity) and the 👍-guard gate are the proposal-first
> dspy design — confirm with the user before running an optimization. The metric is
> deliberately judge-free (no LLM scorer) because the dataset has only human binary
> labels on past outputs.

Replace `run_mipro` entirely. With binary human labels there is no judge, so the
metric scores a candidate prediction by token-overlap (`_jaccard`) against the
recorded answer: 👍 examples reward matching the known-good output, 👎 examples
reward diverging from the known-bad output. The 👍-guard (spec §8) then rejects any
optimized prompt whose mean metric on the held-out 👍 set is **strictly below** the
original prompt's baseline.

```python
def _jaccard(a: str, b: str) -> float:
    sa, sb = set(a.lower().split()), set(b.lower().split())
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / (len(sa | sb) or 1)


def run_mipro(
    lm,
    operation: str,
    trainset: list[dict],
    template_content: str,
    evaluator_template: str = "",  # unused with the rating metric; kept for signature compat
) -> str | None:
    """Returns the optimized template text, or None when the candidate regressed
    the held-out 👍 set (spec §8 reject condition)."""
    dspy.configure(lm=lm)

    sig = make_signature(template_content)
    program = dspy.Predict(sig)  # original (pre-optimization) prompt

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

    def metric(example, prediction, trace=None):
        sim = _jaccard(getattr(prediction, "result", "") or "", example.reference)
        return sim if example.up else (1.0 - sim)

    optimizer = dspy.MIPROv2(metric=metric, auto="light", num_threads=1)
    compiled = optimizer.compile(
        program,
        trainset=examples,
        max_bootstrapped_demos=0,
        max_labeled_demos=0,
    )

    # 👍-guard (spec §8): reject if the optimized prompt regresses the 👍 set.
    up_examples = [e for e in examples if e.up]
    if up_examples:
        def mean_on_up(prog) -> float:
            return sum(metric(e, prog(user_message=e.user_message)) for e in up_examples) / len(up_examples)
        baseline = mean_on_up(program)    # original prompt
        candidate = mean_on_up(compiled)  # optimized prompt
        if candidate < baseline:
            return None  # regressed the 👍 set — reject the candidate

    return restore_placeholders(lm, template_content, compiled.signature.instructions)
```

- [ ] **Step 2: Remove the now-unused `call_evaluator`**

Delete `call_evaluator` (the rating metric replaces the judge). Keep `restore_placeholders` and `_RESTORE_PROMPT`.

- [ ] **Step 3: Verify**

Run: `cd scripts/dspy && uv run pytest tests/test_optimizer.py`
Expected: adjust `test_optimizer.py` to the new `label`-based metric (the test's mock examples carry `rating`). Tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/dspy/lib/optimizer.py scripts/dspy/tests/test_optimizer.py
git commit -m "feat(dev-eval): dspy binary rating metric (replaces LLM judge)"
```

---

## Task 18: dspy orchestration — format/vision prompts + 👍-guard gate

**Files:**
- Modify: `scripts/dspy/optimize.py`

- [ ] **Step 1: Delete the now-dead `evaluator.md` read**

In `optimize.py`, **delete** the line that loads the judge template (it survives otherwise and crashes at runtime since `prompts/evaluator.md` was removed in Task 13):

```python
    evaluator_template = Path(prompts_dir, "evaluator.md").read_text(encoding="utf-8")  # DELETE THIS LINE
```

- [ ] **Step 2: Map buckets → template files, handle the reject gate**

Replace the per-bucket loop (the block from `lm = make_lm()` to the end of the `for` loop) so each bucket optimizes the right template and a `None` return (👍-set regression, from Task 17's gate) skips the write:

```python
    lm = make_lm()

    # bucket → which prompt template to optimize
    def template_for(bucket: str) -> str:
        if bucket.startswith("format:"):
            return "format"
        return bucket  # query / chat / lint-chat / ...

    for bucket, examples in grouped.items():
        print(f"[{bucket}] {len(examples)} примеров загружено")
        tpl_name = template_for(bucket)
        template_path = Path(prompts_dir) / f"{tpl_name}.md"
        if not template_path.exists():
            print(f"[{bucket}] WARNING: {template_path} не найден, пропускаю")
            continue

        template_content = template_path.read_text(encoding="utf-8")
        up_n = sum(1 for e in examples if e.get("rating") == "up")
        print(f"[{bucket}] MIPROv2 (auto=light) · 👍-guard over {up_n} cases")

        try:
            optimized = run_mipro(
                lm=lm,
                operation=bucket,
                trainset=examples,
                template_content=template_content,
            )
        except ValueError as e:
            print(f"[{bucket}] ERROR: {e}")
            continue

        if optimized is None:
            print(f"[{bucket}] REJECTED: candidate regressed the 👍 set — keeping current prompt")
            continue

        out_path = write_optimized(tpl_name, optimized, output_dir)
        print(f"[{bucket}] Записано: {out_path}")
```

(The `recognitionRating`-axis optimization of `vision-*.md` from the `format:vision-on` bucket is a follow-on: pass `operation="format:recognition"` and `template_for` returning a vision template — implement once the format axis is validated. The `:recognition` suffix is already wired in Task 17's `run_mipro`. Document this in `CLAUDE.md`, Step 3.)

- [ ] **Step 3: Update dspy docs**

Update `scripts/dspy/CLAUDE.md` Input Format + `.env.example`: the input is now `eval.jsonl` with `rating`/`recognitionRating`; `DEV_LOG_PATH` → point at the plugin-dir `eval.jsonl`; note `evaluator.md` is no longer used (the judge is gone — the metric is reference-similarity over recorded answers).

- [ ] **Step 4: Verify**

Run: `cd scripts/dspy && uv run pytest`
Expected: all dspy tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/dspy/optimize.py scripts/dspy/CLAUDE.md scripts/dspy/.env.example
git commit -m "feat(dev-eval): dspy optimizes from ratings with 👍 baseline guard"
```

---

# PHASE 4 — docs + final verification

## Task 19: update docs/wiki via iwiki

**Files:**
- Modify (regenerated): `docs/wiki/llm-pipeline.md`, `docs/wiki/operations.md`

- [ ] **Step 1: Regenerate affected pages**

Run `iwiki:iwiki-ingest src/agent-runner.ts` and `iwiki:iwiki-ingest scripts/eval.ts` (and any other changed source the skill flags) so the wiki reflects: the removed Evaluator Prompt Pattern, the new `rule_fired`/`eval_meta` telemetry + per-run record, and the new `eval.jsonl` quality harness replacing the Retrieval Eval Harness.

- [ ] **Step 2: Lint the wiki**

Run `/iwiki-lint`
Expected: no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 3: Commit**

```bash
git add docs/wiki
git commit -m "docs(dev-eval): update wiki for telemetry + eval.jsonl harness"
```

---

## Task 20: final verification

- [ ] **Step 1: Lint + build**

Run: `npm run lint && npm run build`
Expected: both clean. `grep -rn "evaluatorModel\|eval_result\|_dev.jsonl" src` → no matches.

- [ ] **Step 2: dspy tests**

Run: `cd scripts/dspy && uv run pytest`
Expected: all pass.

- [ ] **Step 3: Manual dev-mode smoke (desktop)**

Enable `devMode`. Run a query → a 👍/👎 row appears under the answer; click 👍 → `eval.jsonl` gets a record with `rating: "up"`, `ruleFirings`, `llmErrors`. Re-click 👍 → flips to `null`. Format a file with an image → preview shows formatting 👍/👎 + recognition 👍/👎; without an image → only formatting. Confirm exactly one record per run.

- [ ] **Step 4: Manual mobile check**

In the mobile build, confirm query/chat + format rating rows render and the build does not crash (no module-load node builtins introduced).

- [ ] **Step 5: Non-dev regression**

Disable `devMode`. Run query + format → no rating rows, no `eval.jsonl` writes, output identical to pre-change.

- [ ] **Step 6: Open the PR**

Use **@skill:git-workflow** to open a PR from `dev/dev-mode-eval-rework` into `master`. Do NOT merge to `master` directly (HUMAN CHECKPOINT).

---

## Spec coverage check (self-review)

- §2 runId → Task 5 (thread) + Task 6 (use) + Task 10 (view). ✓
- §3 storage + migration → Task 4 (enumerates all three §3 sub-reqs): runtime-resolved paths → Task 2/5/6; idempotent auto-migration → Task 4; legacy-line skip → Task 15/16/2. ✓
- §4 record schema + write/rate → Task 2 + Task 6 (assembly). ✓
- §4 promptVersion / visionPromptVersion → Task 1 + Tasks 7/8 (emit). ✓
- §5 rule_fired + telemetry accumulation → Task 3 (event) + Task 6 (accumulate) + Tasks 7/8/9 (emit). ✓
- §6 UI buttons (query/chat + format two axes, desktop+mobile) → Task 10 + Task 11 (i18n). ✓
- §7 eval.ts → Task 15. ✓
- §8 dspy → Tasks 16–18. ✓
- §9 removals → Task 3/11/12 (evaluatorModel), Task 13 (evaluator), Task 14 (retrieval harness), Task 4 (rename). ✓
- §10 health → Task 20 (lint/build/mobile/non-dev). ✓
- §12 docs/wiki → Task 19. ✓
