---
review:
  plan_hash: 891a49580d721c58
  spec_hash: 61c8f31eaa420b97
  last_run: 2026-06-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-19-format-vision-sentinel-sweep-design.md
result_check:
  verdict: OK
  plan_hash: 891a49580d721c58
  last_run: 2026-06-19
---
# Format Vision Sentinel-Marker Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop technical sentinel markers (`<<<END>>>`, `<<<FORMATTED>>>`, etc.) from leaking into formatted notes by making the parser order-robust and adding a final defensive sweep before write.

**Architecture:** Two-layer fix in the format/vision flow. Layer 1 — `parseSentinelOutput` slices the formatted body up to the *earliest* trailing marker instead of assuming a fixed marker order, so an out-of-order `<<<END>>>` can no longer fall inside the body. Layer 2 — a new pure `stripSentinelMarkers` runs at the single write choke point in `format.ts`, removing any residual marker and emitting a warning if anything was removed.

**Tech Stack:** TypeScript, esbuild (bundling + the out-of-vault eval harness), Obsidian plugin runtime (production), iwiki (`docs/wiki/`) for documentation.

---

## Context for the implementer (read first)

- **Spec:** `docs/superpowers/specs/2026-06-19-format-vision-sentinel-sweep-design.md` (approved design — implement it faithfully, do not redesign).
- **Branch:** you are already on `dev/format-sentinel-sweep` (the current branch). Do NOT commit to `master`. The branch merges back to `master` via PR (project rule).
- **No unit-test runner exists** in this project. The established verification convention is an *out-of-vault eval harness*: a standalone `eval/<name>/run.ts` that imports the **real** pure functions from `src/`, is bundled with esbuild to a `.cjs`, and run with `node`. The template is `eval/format-frontmatter/` (+ its doc `docs/superpowers/evals/2026-06-18-format-frontmatter-repair-eval.md`). This plan uses that harness as its "tests" — TDD applies (write the failing assertion first, watch it fail, implement, watch it pass).
- **`src/phases/format-utils.ts` has zero imports** — it is dependency-free, so the eval harness bundles WITHOUT the `--alias:obsidian=...` shim the frontmatter eval needed.
- **`lat` CLI / `lat.md/` directory do NOT exist** in this repo (despite `CLAUDE.md` mentioning them). The real docs are the iwiki graph under `docs/wiki/`. Wherever the spec says "run `lat check`", use the iwiki skills instead (`iwiki:iwiki-ingest`, `iwiki:iwiki-lint`). This matches the prior format-frontmatter branch.
- **`info_text` event shape** (from `src/types.ts:47`): `{ kind: "info_text"; icon: string; summary: string; details?: string[] }`. Nearby warnings at the write choke point (`"Embed warnings"`, `"WikiLink warnings"`) use hardcoded English summaries — match that style (no i18n bundle changes).

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/phases/format-utils.ts` | Pure parse/transform helpers for format output | Modify `parseSentinelOutput` (order-robust body slice); add `stripSentinelMarkers` |
| `src/phases/format.ts` | The `runFormat` generator pipeline | Add `stripSentinelMarkers` import + the single sweep gate before `vaultTools.write` |
| `eval/format-sentinel-sweep/run.ts` | Out-of-vault eval harness exercising the two pure functions | Create |
| `eval/format-sentinel-sweep/.gitignore` | Ignore the built `.cjs` | Create |
| `docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md` | How to run the eval + fixture table + results | Create |
| `docs/wiki/llm-pipeline.md` (+ others iwiki touches) | Architecture docs for the format flow | Regenerate via iwiki-ingest |

---

## Task 1: Order-robust `parseSentinelOutput` (+ eval harness scaffold)

Make the vision branch slice the formatted body up to the earliest trailing marker, so a stray `<<<END>>>` emitted before `<<<VISION_COUNT>>>` is excluded from `formatted`. The eval harness is created here and proves the fix with a real failing case first.

**Files:**
- Create: `eval/format-sentinel-sweep/.gitignore`
- Create: `eval/format-sentinel-sweep/run.ts`
- Modify: `src/phases/format-utils.ts:248-252` (the `if (hasVisionDescriptions) {` block)

- [ ] **Step 1: Create the harness `.gitignore`**

Create `eval/format-sentinel-sweep/.gitignore` with exactly:

```gitignore
*.cjs
```

- [ ] **Step 2: Write the failing eval harness**

Create `eval/format-sentinel-sweep/run.ts`:

```typescript
/**
 * Out-of-vault eval harness for the "format vision sentinel-marker sweep" branch.
 *
 * Exercises the REAL pure functions from src/phases/format-utils.ts against
 * synthetic LLM-output fixtures derived from the spec's reproduction case. It does
 * NOT touch an Obsidian vault and does NOT call an LLM — it validates the
 * deterministic parse/sweep logic the fix depends on.
 *
 * Run: see docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md
 */
import {
  parseSentinelOutput,
  stripSentinelMarkers,
} from "../../src/phases/format-utils";

// ---------- tiny assert framework ----------
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

// =====================================================================
// Component 1 — parseSentinelOutput is order-robust
// =====================================================================
section("Component 1 — parseSentinelOutput");

{
  // PARSE-1 (the spec's named reproduction): a stray <<<END>>> emitted BEFORE
  // <<<VISION_COUNT>>>. The old code (formattedEnd = visionIdx) swallowed it into
  // the formatted body; the fix slices up to the earliest trailing marker.
  const malformed = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "body content",
    "<<<END>>>",
    "<<<VISION_COUNT>>>",
    "2",
    "<<<EMBEDS>>>",
    "![[a.png]] | ![[b.png]]",
  ].join("\n");
  const r = parseSentinelOutput(malformed, true);
  check("parse-1 result not null", r !== null);
  check("parse-1 formatted has no <<<END>>>", r !== null && !r.formatted.includes("<<<END>>>"), r?.formatted);
  check("parse-1 formatted body intact", r?.formatted === "# Title\nbody content", JSON.stringify(r?.formatted));
}

{
  // PARSE-2 positive control: well-formed vision output (FORMATTED < VISION_COUNT
  // < EMBEDS < END). Must parse identically before and after the fix.
  const normal = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "body content",
    "<<<VISION_COUNT>>>",
    "2",
    "<<<EMBEDS>>>",
    "![[a.png]] | ![[b.png]]",
    "<<<END>>>",
  ].join("\n");
  const r = parseSentinelOutput(normal, true);
  check("parse-2 formatted body", r?.formatted === "# Title\nbody content", JSON.stringify(r?.formatted));
  check("parse-2 visionCount", r?.visionCount === 2, String(r?.visionCount));
  check("parse-2 embeds", JSON.stringify(r?.embeds) === JSON.stringify(["![[a.png]]", "![[b.png]]"]), JSON.stringify(r?.embeds));
  check("parse-2 not truncated", r?.truncated === false, String(r?.truncated));
}

{
  // PARSE-3 positive control: truncated vision output (no <<<END>>> at all) still
  // sets truncated = true and slices the body up to <<<VISION_COUNT>>>.
  const truncated = [
    "<<<REPORT>>>",
    "ok",
    "<<<FORMATTED>>>",
    "# Title",
    "partial",
    "<<<VISION_COUNT>>>",
    "1",
    "<<<EMBEDS>>>",
    "![[a.png]]",
  ].join("\n");
  const r = parseSentinelOutput(truncated, true);
  check("parse-3 truncated flag", r?.truncated === true, String(r?.truncated));
  check("parse-3 formatted body", r?.formatted === "# Title\npartial", JSON.stringify(r?.formatted));
}

// ---------- summary ----------
console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
```

- [ ] **Step 3: Bundle and run to verify PARSE-1 fails**

Run:

```bash
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
```

Expected: bundle succeeds (`stripSentinelMarkers` is imported but unused so far — that's fine), then the run FAILS with `parse-1 formatted has no <<<END>>>` and `parse-1 formatted body intact` failing (the old code leaves `# Title\nbody content\n<<<END>>>` in the body). PARSE-2 and PARSE-3 pass.

- [ ] **Step 4: Make the vision branch order-robust**

In `src/phases/format-utils.ts`, inside the `if (hasVisionDescriptions) {` block, replace the hardcoded `formattedEnd`. Find:

```typescript
    const visionIdx = text.indexOf("<<<VISION_COUNT>>>", formattedIdx);
    const embedsIdx = text.indexOf("<<<EMBEDS>>>", formattedIdx);
    if (visionIdx === -1 || embedsIdx === -1) return null;
    formattedEnd = visionIdx;
```

Replace with:

```typescript
    const visionIdx = text.indexOf("<<<VISION_COUNT>>>", formattedIdx);
    const embedsIdx = text.indexOf("<<<EMBEDS>>>", formattedIdx);
    if (visionIdx === -1 || embedsIdx === -1) return null;
    // Order-robust: end the formatted body at the EARLIEST trailing marker after
    // <<<FORMATTED>>>, so a stray <<<END>>> placed before <<<VISION_COUNT>>> can no
    // longer be swallowed into `formatted`. visionCount/embeds parsing is unchanged.
    const tail = [visionIdx, embedsIdx, endIdx].filter((i) => i > formattedIdx);
    formattedEnd = tail.length ? Math.min(...tail) : text.length;
```

(`endIdx` and `formattedIdx` are already in scope from earlier in the function.)

- [ ] **Step 5: Re-run the eval to verify it passes**

Run:

```bash
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
```

Expected: `TOTAL: 9 passed, 0 failed` (PARSE-1 now passes; PARSE-2/PARSE-3 still pass).

- [ ] **Step 6: Commit**

```bash
git add eval/format-sentinel-sweep/.gitignore eval/format-sentinel-sweep/run.ts src/phases/format-utils.ts
git commit -m "fix(format): order-robust parseSentinelOutput vision body slice

Slice the formatted body up to the earliest trailing marker instead of
assuming FORMATTED < VISION_COUNT order, so a stray <<<END>>> emitted
before <<<VISION_COUNT>>> is no longer swallowed into the body.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `stripSentinelMarkers` final-sweep pure function

Add the defensive pure function that removes any residual `<<<NAME>>>` sentinel marker from text — dropping whole marker lines, splicing inline residues, collapsing orphaned blank-line runs, and `trimEnd`-ing — and returns the cleaned text plus the list of removed markers.

**Files:**
- Modify: `src/phases/format-utils.ts` (append the new function near the other exported helpers)
- Modify: `eval/format-sentinel-sweep/run.ts` (append a Component 2 section)

- [ ] **Step 1: Append the failing strip assertions to the harness**

In `eval/format-sentinel-sweep/run.ts`, insert this block immediately BEFORE the `// ---------- summary ----------` line:

```typescript
// =====================================================================
// Component 2 — stripSentinelMarkers final sweep
// =====================================================================
section("Component 2 — stripSentinelMarkers");

{
  // STRIP-1 (the on-disk repro): text ending in a stray <<<END>>> line.
  const s = stripSentinelMarkers("# Doc\n\nfinal paragraph\n\n<<<END>>>");
  check("strip-1 marker removed", !s.clean.includes("<<<END>>>"), s.clean);
  check("strip-1 content intact", s.clean === "# Doc\n\nfinal paragraph", JSON.stringify(s.clean));
  check("strip-1 removed list", JSON.stringify(s.removed) === JSON.stringify(["<<<END>>>"]), JSON.stringify(s.removed));
}

{
  // STRIP-2: inline residue — the marker is spliced out, the rest of the line
  // stays (inline whitespace is NOT collapsed by design — only blank lines are).
  const s = stripSentinelMarkers("alpha <<<END>>> beta");
  check("strip-2 inline spliced", s.clean === "alpha  beta", JSON.stringify(s.clean));
  check("strip-2 removed list", JSON.stringify(s.removed) === JSON.stringify(["<<<END>>>"]), JSON.stringify(s.removed));
}

{
  // STRIP-3: several distinct markers on their own lines all removed.
  const s = stripSentinelMarkers("# T\n<<<FORMATTED>>>\nbody\n<<<VISION_COUNT>>>\n<<<END>>>");
  check("strip-3 no markers left", !/<<<[A-Z_]+>>>/.test(s.clean), s.clean);
  check("strip-3 body intact", s.clean === "# T\nbody", JSON.stringify(s.clean));
  check("strip-3 removed count", s.removed.length === 3, JSON.stringify(s.removed));
}

{
  // STRIP-4: no markers → exact-bytes no-op, nothing removed.
  const input = "# Clean\n\nNo markers here.";
  const s = stripSentinelMarkers(input);
  check("strip-4 unchanged", s.clean === input, JSON.stringify(s.clean));
  check("strip-4 nothing removed", s.removed.length === 0, JSON.stringify(s.removed));
}

{
  // STRIP-5: dropping a marker line collapses the orphaned blank-line run.
  const s = stripSentinelMarkers("a\n\n<<<END>>>\n\nb");
  check("strip-5 blank run collapsed", s.clean === "a\n\nb", JSON.stringify(s.clean));
}
```

- [ ] **Step 2: Bundle and run to verify the bundle fails (red)**

Run:

```bash
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
```

Expected: esbuild FAILS with an error like `No matching export in "src/phases/format-utils.ts" for import "stripSentinelMarkers"` — the function does not exist yet. (This is the red state for a new function.)

- [ ] **Step 3: Implement `stripSentinelMarkers`**

In `src/phases/format-utils.ts`, add the following immediately AFTER the `parseSentinelOutput` function (after its closing brace at the end of the file):

```typescript

const SENTINEL_RE = /<<<[A-Z_]+>>>/g;

/**
 * Final defensive gate: removes any residual sentinel marker (`<<<NAME>>>`) that
 * survived parsing. Whole marker lines are dropped, inline residues are spliced
 * out, blank-line runs orphaned by a dropped line are collapsed, and the result is
 * `trimEnd`-ed. Returns the cleaned text plus the list of removed marker strings
 * (for the caller's warning). The pattern is narrow (uppercase sentinel shape
 * only), so legitimate markdown is untouched.
 */
export function stripSentinelMarkers(text: string): { clean: string; removed: string[] } {
  const removed = text.match(SENTINEL_RE) ?? [];
  if (removed.length === 0) return { clean: text, removed };

  const out: string[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.replace(SENTINEL_RE, "");
    if (stripped === line) { out.push(line); continue; } // no marker on this line
    if (stripped.trim() === "") continue;                // line was only marker(s) → drop
    out.push(stripped);                                  // inline residue → keep remainder
  }
  const clean = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return { clean, removed };
}
```

(`SENTINEL_RE` is global; `String.prototype.match` and `String.prototype.replace` both reset `lastIndex` internally, so reusing the one object is safe — no `.test()`/`.exec()` is used on it.)

- [ ] **Step 4: Bundle and run to verify all assertions pass**

Run:

```bash
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
```

Expected: `TOTAL: 18 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/phases/format-utils.ts eval/format-sentinel-sweep/run.ts
git commit -m "feat(format): add stripSentinelMarkers final-sweep helper

Pure function removing residual <<<NAME>>> sentinel markers (whole lines,
inline residues, orphaned blank runs) and returning the removed list for
a warning.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the sweep into the `format.ts` write choke point

Add the single sweep gate just before the note is written, so every path that produces `finalFormatted` (base, vision, token-restore) is covered by one call. Emit a warning event if anything was stripped.

**Files:**
- Modify: `src/phases/format.ts:10` (import)
- Modify: `src/phases/format.ts:346-347` (insert the gate after `restoreSourceFrontmatter`, before the `try`/`vaultTools.write`)

- [ ] **Step 1: Add `stripSentinelMarkers` to the import**

In `src/phases/format.ts`, find line 10:

```typescript
import { missingTokensWithContext, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds, parseSentinelOutput } from "./format-utils";
```

Replace with:

```typescript
import { missingTokensWithContext, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds, parseSentinelOutput, stripSentinelMarkers } from "./format-utils";
```

- [ ] **Step 2: Insert the sweep gate before the write**

In `src/phases/format.ts`, find this region (around lines 346–349):

```typescript
  finalFormatted = restoreSourceFrontmatter(original, finalFormatted);

  try {
    await vaultTools.write(tempPath, finalFormatted);
```

Replace with:

```typescript
  finalFormatted = restoreSourceFrontmatter(original, finalFormatted);

  // Final defensive sweep: no sentinel marker may reach the written note.
  const swept = stripSentinelMarkers(finalFormatted);
  finalFormatted = swept.clean;
  if (swept.removed.length > 0) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: "Sentinel markers stripped",
      details: swept.removed,
    };
  }

  try {
    await vaultTools.write(tempPath, finalFormatted);
```

- [ ] **Step 3: Build to verify it compiles**

Run:

```bash
npm run build
```

Expected: esbuild production build completes with no errors (exit 0). The new import resolves and the `info_text` event matches `src/types.ts:47`.

- [ ] **Step 4: Lint the touched files**

Run:

```bash
npm run lint
```

Expected: no NEW eslint errors in `src/phases/format.ts` or `src/phases/format-utils.ts`. (The repo has a known non-clean tsc baseline; gate only on errors introduced by these two files.)

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts
git commit -m "fix(format): sweep residual sentinel markers before write

Run stripSentinelMarkers at the single write choke point (after frontmatter
restore, before vaultTools.write) so base/vision/token-restore paths all pass
through it; warn when markers are removed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Eval doc + iwiki sync + final verification

Document the eval harness (mirroring the frontmatter eval doc), regenerate the affected iwiki pages, and run the full build/lint as the final gate.

**Files:**
- Create: `docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md`
- Regenerate (via iwiki-ingest): `docs/wiki/llm-pipeline.md` and any other page iwiki updates for `format.ts` / `format-utils.ts`

- [ ] **Step 1: Write the eval doc**

Create `docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md`:

```markdown
# Eval — Format Vision Sentinel-Marker Sweep

**Date:** 2026-06-19
**Branch:** `dev/format-sentinel-sweep`
**Spec:** `docs/superpowers/specs/2026-06-19-format-vision-sentinel-sweep-design.md`
**Plan:** `docs/superpowers/plans/2026-06-19-format-vision-sentinel-sweep.md`

## Purpose & scope

Validate the sentinel-marker fix **outside any Obsidian vault** and **without an LLM**, by
exercising the real pure functions from `src/phases/format-utils.ts` against synthetic
LLM-output fixtures that reproduce the spec's leak.

Covers the **deterministic logic** the fix depends on:
- Component 1 — `parseSentinelOutput` order-robust body slice (stray `<<<END>>>` before `<<<VISION_COUNT>>>`).
- Component 2 — `stripSentinelMarkers` final sweep (line drop, inline splice, blank-run collapse, no-op).

**Out of scope** (requires the Obsidian runtime / a live LLM, checked via `npm run build`):
the `format.ts` integration gate firing inside the `runFormat` generator and the actual
`vaultTools.write`.

## How to run

\`\`\`bash
# from repo root
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
\`\`\`

`src/phases/format-utils.ts` is dependency-free, so no `obsidian` stub/alias is needed
(unlike the frontmatter eval). The harness imports the real `parseSentinelOutput` and
`stripSentinelMarkers`.

## Fixtures

| Case | Input shape | What it models |
|------|-------------|----------------|
| PARSE-1 | vision output with `<<<END>>>` before `<<<VISION_COUNT>>>` | Spec's named reproduction — body must not contain `<<<END>>>` |
| PARSE-2 | well-formed vision output (FORMATTED<VISION_COUNT<EMBEDS<END) | Positive control — body/visionCount/embeds/truncated intact |
| PARSE-3 | vision output with no `<<<END>>>` | Positive control — `truncated === true`, body sliced at `<<<VISION_COUNT>>>` |
| STRIP-1 | text ending in a stray `<<<END>>>` line | The on-disk repro — marker removed, content intact |
| STRIP-2 | `<<<END>>>` inline mid-line | Inline residue spliced; inline whitespace not collapsed |
| STRIP-3 | several distinct markers on own lines | All removed, body intact, removed.length === 3 |
| STRIP-4 | no markers | Exact-bytes no-op, nothing removed |
| STRIP-5 | marker line between blank lines | Orphaned blank-line run collapsed |

## Results (current)

`TOTAL: 18 passed, 0 failed`
```

- [ ] **Step 2: Run the eval once more and confirm it matches the doc**

Run:

```bash
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
```

Expected: `TOTAL: 18 passed, 0 failed` (matches the "Results" line in the doc; correct it if the count differs).

- [ ] **Step 3: Regenerate the iwiki docs for the changed sources**

The project's mandatory doc-currency rule uses iwiki (there is no `lat` CLI here). Invoke the ingest skill for each changed source:

```
iwiki:iwiki-ingest src/phases/format-utils.ts
iwiki:iwiki-ingest src/phases/format.ts
```

This updates the affected `docs/wiki/` page(s) (notably `docs/wiki/llm-pipeline.md`, which already documents the sentinel/`<<<FORMATTED>>>` flow).

- [ ] **Step 4: Lint the docs graph**

Invoke:

```
iwiki:iwiki-lint
```

Expected: no broken `[[refs]]`, no orphan or stale pages introduced by the ingest.

- [ ] **Step 5: Final build + lint gate**

Run:

```bash
npm run build && npm run lint
```

Expected: build exits 0; lint reports no NEW errors in the two touched `src/` files.

- [ ] **Step 6: Commit the docs**

```bash
git add docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md docs/wiki/
git commit -m "docs: sentinel-sweep eval + iwiki sync for format flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Spec coverage check

- **Component 1** (order-robust `parseSentinelOutput`) → Task 1.
- **Component 2** (`stripSentinelMarkers`) → Task 2.
- **Integration** (single choke point in `format.ts` before write, with warning) → Task 3.
- **Verification** (inline run of `stripSentinelMarkers` on trailing-`<<<END>>>`, inline run of `parseSentinelOutput` on out-of-order output, `npm run build`, docs lint) → Tasks 1–4 (the "inline runs" are the eval harness assertions, the project's established mechanism).
- **Out of scope, NOT touched** (Zod schemas, `format.md` prompt, the already-corrupted example file, other phases) → no task modifies these; confirm during review.
