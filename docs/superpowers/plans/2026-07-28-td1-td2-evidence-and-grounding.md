---
review:
  plan_hash: 1bd12a773809b861
  last_run: 2026-07-29
  phases:
    structure: {status: passed}
    coverage: {status: passed}
    dependencies: {status: passed}
    verifiability: {status: passed}
    consistency: {status: passed}
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: "Task 3: Wire audit-domain-quality.mjs to the new module and make sourceRoot a CLI arg"
      fragment: "plus a manual dry run in Step 3"
      text: "Task 3's no-automated-test paragraph (Interfaces block) says the task's correctness is covered by Task 2's unit tests 'plus a manual dry run in Step 3', but the manual dry run is actually Step 4 ('Dry-run the script to confirm it still executes against the live snapshot'). Task 3's Step 3 is 'Use `stripTrailingContinuation` when comparing preserved snippets', an implementation edit with no Run/Expected of its own. A reader looking for the task's stated verification in Step 3 finds only code, not the dry-run command."
      fix: "Change 'plus a manual dry run in Step 3' to 'plus a manual dry run in Step 4' in Task 3's Interfaces/no-test paragraph."
      verdict: fixed
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Task 10 Step 1: TD-1 replacement text in tech-debt.md"
      fragment: "in the audit's own snippet-vs-corpus comparison (`scripts/loen-dynamic-budget-routing/audit-snippets.mjs`)"
      text: "The corrected TD-1 second bullet now matches the spec's group decomposition, but its file attribution for the continuation fix is imprecise: it locates 'the audit's own snippet-vs-corpus comparison' at `audit-snippets.mjs`, while the actual comparison line (`technicalSnippets.filter((snippet) => corpus.includes(stripTrailingContinuation(snippet)))`) lives in `audit-domain-quality.mjs`, wired there by Task 3. `audit-snippets.mjs` (Task 2) only exports the `stripTrailingContinuation` helper the comparison calls. The substance is correct — both tasks are needed and both files matter — but citing `audit-snippets.mjs` as the site of 'the comparison' points a reader at the wrong file if they go looking for the filter itself."
      fix: "Reword to name both files precisely, e.g. '... and in the audit's own snippet-vs-corpus comparison in `audit-domain-quality.mjs`, using the shared `stripTrailingContinuation` helper exported from `scripts/loen-dynamic-budget-routing/audit-snippets.mjs`.'"
      verdict: fixed
chain:
  spec: docs/superpowers/specs/2026-07-27-td1-td2-evidence-and-grounding-design.md
result_check:
  verdict: OK
  plan_hash: 1bd12a773809b861
  last_run: 2026-07-29
---

# TD-1/TD-2 Evidence Reconciliation and Query Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close TD-1 (exact technical evidence classification/reconciliation) and TD-2 (query context coverage and grounding sanitation) from `docs/loen/dynamic-llm-budget-routing/tech-debt.md`, matching every acceptance criterion in `docs/superpowers/specs/2026-07-27-td1-td2-evidence-and-grounding-design.md`.

**Architecture:** Seven independent, surgical fixes across the synthesis-evidence and query-grounding pipelines, each isolated behind its own exported function so it can be TDD'd and reverted independently: (1) evidence carry-over across cross-source page rewrites and trailing shell-continuation tolerance in `synthesis-evidence-ledger.ts`; (2) a mechanical split of `audit-domain-quality.mjs`'s snippet extractor into a standalone, testable module with a case-sensitivity fix; (3) question-facet reservation in the query context budget; (4) a trailing-period fix in path extraction; (5) a Markdown-repair pass for sanitizer residue; (6) title-derived-id support for query grounding; (7) a second (os-mac) diagnostic query-quality corpus. A dedicated Phase-0 test file first proves all reproducible failure classes are red against `HEAD`.

**Tech Stack:** TypeScript (ESM, Obsidian plugin), Node test runner (`node:test` + `node:assert/strict`) via `node --import tsx --test`, plain Node ESM scripts (`.mjs`) for offline audit tooling.

## Global Constraints

- Do not add OS-specific entity types, paths, commands, aliases, headings, prompt exceptions, larger token ceilings, or extra model retries (register Scope constraint).
- Do not increase the 65,536 ingest input ceiling or the synthesis batch size above `1` (Non-Actions).
- Do not weaken schema, canonical path, alias, page-hash, section-authority, WikiLink, or exact-grounding validation (Non-Actions).
- Do not encode the os-unix (or os-mac) benchmark vocabulary into production logic (Non-Actions).
- No additional LLM request, retry, or token-ceiling increase from any TD-1 or TD-2 fix (Phase 1 / Phase 2 acceptance).
- Query input/output ceilings and final context size stay unchanged (Phase 2 acceptance).
- Answer compression, carrying page titles into rendered context, `technicalValuePreservation`/`declaredEntityCoverage`/the ledger-selection gap, TD-3, TD-4, and all existing Non-Actions are out of scope for this plan.
- `docs/TODO.md` is maintained exclusively by the `/check-chain` skill — no task in this plan touches it.

---

## File Structure

- `tests/td1-td2-phase0-repro.test.ts` (new) — dedicated red-test file proving 5 of the 7 Phase-0 failure classes fail against `HEAD` (classes 1, 4, 5, 6, 7). Classes 2 and 3 are proven red by the new `tests/audit-snippets.test.ts` instead (see below), since they exercise code that doesn't exist as an importable module yet.
- `scripts/loen-dynamic-budget-routing/audit-snippets.mjs` (new) — snippet-extraction logic split out of `audit-domain-quality.mjs` so it is unit-testable; carries the §1.3 case-sensitivity fix and exports `stripTrailingContinuation` for §1.4's audit-side symmetry.
- `tests/audit-snippets.test.ts` (new) — unit tests for the new module; also proves Phase-0 classes 2 and 3 red-then-green.
- `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs` (modify) — imports from `audit-snippets.mjs` instead of defining snippet logic inline; `sourceRoot` becomes a CLI arg; uses `stripTrailingContinuation` when comparing preserved snippets.
- `src/phases/synthesis-evidence-ledger.ts` (modify) — §1.1 evidence carry-over, §1.4 continuation tolerance.
- `tests/synthesis-evidence-ledger.test.ts` (modify) — 3 new tests for the above.
- `src/phases/query-budget.ts` (modify) — §2.1 facet coverage in `selectQueryContextChunks`.
- `src/phases/query.ts` (modify) — pass `question` through to `selectQueryContextChunks`.
- `src/phases/query-cross-domain.ts` (modify) — pass `q` through to `selectQueryContextChunks`.
- `tests/query-budget.test.ts` (modify) — 1 new facet test.
- `src/phases/query-grounding-validator.ts` (modify) — §2.2 path trailing-period fix, §2.3 Markdown repair pass, §2.4 title-only support.
- `tests/query-grounding-validator.test.ts` (modify) — 2 new tests for §2.3, 3 new tests for §2.4.
- `src/phases/query-answer.ts` (modify) — 4 call sites pass `[...knownStems]` as the new `articleIds` argument.
- `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json` (new) — 16-case diagnostic corpus for the os-mac domain.
- `docs/loen/dynamic-llm-budget-routing/tech-debt.md` (modify) — TD-1 and TD-2 sections rewritten to reflect closure.

---

### Task 1: Phase 0 — prove reproducible failure classes are red

**Files:**
- Create: `tests/td1-td2-phase0-repro.test.ts`

**Interfaces:**
- Consumes: `selectQueryContextChunks(rankedChunks, contextLimit, question?)` from `src/phases/query-budget.ts` (existing 2-arg baseline signature — the 3rd arg is added in Task 5); `reconcileSynthesisEvidence(content, existing, ledger, language)` from `src/phases/synthesis-evidence-ledger.ts` (existing signature, unchanged by this plan); `findUnsupportedTechnicalUnits(answer, selectedContext, articleIds?)` and `sanitizeUnsupportedTechnicalLines(answer, unsupported)` from `src/phases/query-grounding-validator.ts` (existing 2-arg baseline signature — the 3rd arg is added in Task 8).
- Produces: nothing consumed by later tasks — this file only asserts current (pre-fix) behavior is broken. It is re-run at the end of Task 11 to confirm all 5 classes now pass.

- [ ] **Step 1: Write the Phase-0 reproduction test file**

```typescript
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { SelectedChunk } from "../src/page-similarity";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { selectQueryContextChunks } = await import("../src/phases/query-budget");
const { reconcileSynthesisEvidence } = await import("../src/phases/synthesis-evidence-ledger");
const {
  findUnsupportedTechnicalUnits,
  sanitizeUnsupportedTechnicalLines,
} = await import("../src/phases/query-grounding-validator");

function selectedChunk(index: number, score: number): SelectedChunk {
  return {
    articleId: `wiki_d_${index}`,
    path: `!Wiki/d/concept/wiki_d_${index}.md`,
    heading: `## Section ${index}`,
    body: `COMPLETE_CHUNK_${index}_START\n${String(index).repeat(180)}\nCOMPLETE_CHUNK_${index}_END`,
    score,
    source: index % 2 === 0 ? "seed" : "graph",
    ordinal: index,
  };
}

test("Phase 0 class 1: evidence erosion on cross-source page update", () => {
  const existing = [
    "# Article",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "# Article",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");

  assert.match(reconciled.content, /sudo earlier-command/);
});

test("Phase 0 class 4: facet omission in context selection", () => {
  const anchors = Array.from({ length: 3 }, (_, index) => selectedChunk(index, 100 - index));
  const filler = { ...selectedChunk(3, 97), body: "No relevant keyword here." };
  const facetChunk = { ...selectedChunk(4, 90), body: "Ask about the storage quota limit." };
  const ranked = [...anchors, filler, facetChunk];

  const selected = selectQueryContextChunks(ranked, 4, "What is the storage quota limit?");

  assert.ok(selected.includes(facetChunk));
});

test("Phase 0 class 5: false unsupported path with trailing sentence period", () => {
  const context = "Edit /etc/modprobe.d/amdgpu.conf to disable the driver.";
  const answer = "See /etc/modprobe.d/amdgpu.conf.";

  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);

  assert.deepEqual(unsupported, []);
});

test("Phase 0 class 6: malformed sanitation leaves an empty emphasis span", () => {
  const context = "sysctl controls memory pressure settings.";
  const answer = "- **`vm.dirty_expire_centisecs`** – максимальное время жизни грязных страниц.";

  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);
  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.doesNotMatch(sanitized.answer, /\*\*\*\*/);
});

test("Phase 0 class 7: title-only support for a page's own H1", () => {
  const context = ["Раздел объясняет настройку параметров ядра памяти без упоминания точного имени параметра."];
  const answer = "Параметр `vm.dirty_expire_centisecs` управляет временем жизни грязных страниц.";
  const articleIds = ["wiki_linux_vm_dirty_expire_centisecs"];

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, context, articleIds), []);
});
```

- [ ] **Step 2: Run the file and confirm all 5 tests fail**

Run: `node --import tsx --test tests/td1-td2-phase0-repro.test.ts`
Expected: `# tests 5`, `# pass 0`, `# fail 5`, with these exact failures:
- class 1: `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /sudo earlier-command/. Input: '# Article\n\n## Sources\n\n- [[Source A]]\n- [[Source B]]'`
- class 4: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: assert.ok(selected.includes(facetChunk))`
- class 5: `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` with actual `[ { kind: 'path', text: '/etc/modprobe.d/amdgpu.conf.' } ]` vs expected `[]`
- class 6: `AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /\*\*\*\*/. Input: '- **** – максимальное время жизни грязных страниц.'`
- class 7: `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` with actual `[ { kind: 'inline_code', text: 'vm.dirty_expire_centisecs' } ]` vs expected `[]`

- [ ] **Step 3: Commit**

```bash
git add tests/td1-td2-phase0-repro.test.ts
git commit -m "test: add Phase 0 red tests for TD-1/TD-2 reproducible failure classes"
```

---

### Task 2: Split snippet extraction into `audit-snippets.mjs` with the §1.3/§1.4 audit-side fixes

**Files:**
- Create: `scripts/loen-dynamic-budget-routing/audit-snippets.mjs`
- Create: `tests/audit-snippets.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no repo imports).
- Produces: `stripTrailingContinuation(value: string): string`, `normalizedText(value: string): string`, `unique(values: string[]): string[]`, `commandStart: RegExp` (case-sensitive — no `/i` flag), `extractTechnicalSnippets(markdown: string): string[]`. Task 3 imports all five from this module.

- [ ] **Step 1: Write the failing tests**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  commandStart,
  extractTechnicalSnippets,
  stripTrailingContinuation,
} from "../scripts/loen-dynamic-budget-routing/audit-snippets.mjs";

test("extractTechnicalSnippets does not emit a capitalized prose sentence with no code span as a whole-line snippet", () => {
  const markdown = "Mount the NFS share from the server.";

  assert.deepEqual(extractTechnicalSnippets(markdown), []);
});

test("extractTechnicalSnippets keeps only the inline-code snippet of a capitalized prose sentence, not the whole line", () => {
  const markdown = "Mount all filesystems listed in `/etc/fstab`.";

  assert.deepEqual(extractTechnicalSnippets(markdown), ["/etc/fstab"]);
});

test("extractTechnicalSnippets keeps the inline-code snippet of a prose sentence with a code span", () => {
  const markdown = "Save the `/etc/fstab` file.";

  assert.deepEqual(extractTechnicalSnippets(markdown), ["/etc/fstab"]);
});

test("extractTechnicalSnippets still emits a real lowercase command line", () => {
  const markdown = [
    "mount -a",
    "systemctl daemon-reload",
  ].join("\n");

  assert.deepEqual(extractTechnicalSnippets(markdown), ["mount -a", "systemctl daemon-reload"]);
});

test("commandStart matches a lowercase command head and rejects a capitalized sentence head", () => {
  assert.equal(commandStart.test("mount -a"), true);
  assert.equal(commandStart.test("Mount the NFS share from the server."), false);
});

test("stripTrailingContinuation matches a page line lacking the trailing continuation", () => {
  const snippet = "systemctl daemon-reload && \\";
  const corpus = "See wiki_os-unix_systemd_mount_unit.md: systemctl daemon-reload restarts the unit.";

  assert.ok(corpus.includes(stripTrailingContinuation(snippet)));
  assert.equal(stripTrailingContinuation("systemctl daemon-reload"), "systemctl daemon-reload");
});
```

- [ ] **Step 2: Run the test file and confirm it fails on module resolution**

Run: `node --import tsx --test tests/audit-snippets.test.ts`
Expected: FAIL — `Cannot find module '.../scripts/loen-dynamic-budget-routing/audit-snippets.mjs'` (`ERR_MODULE_NOT_FOUND`), `# fail` for all 6 subtests (the import error aborts the whole file, reported as a single top-level failure).

- [ ] **Step 3: Create `audit-snippets.mjs` with the case-sensitivity fix already applied**

This is a mechanical extraction of the snippet-extraction functions previously inlined in `audit-domain-quality.mjs`, plus two fixes required by Phase 1 (§1.3: drop the `/i` flag from `commandStart` so a capitalized English sentence like "Mount the NFS share..." no longer matches as a command; §1.4: add `stripTrailingContinuation` so a shell line-continuation artifact doesn't register as a mismatch — this function is also imported by `audit-domain-quality.mjs` in Task 3 to keep the continuation rule identical on both the extraction and comparison sides, per the spec's requirement that "the rule must apply identically in both `findMissingSynthesisEvidence` and `audit-domain-quality.mjs`").

```javascript
const TRAILING_CONTINUATION_RE = /[ \t]*(?:&&[ \t]*)?\\[ \t]*$/;

export function stripTrailingContinuation(value) {
  return value.replace(TRAILING_CONTINUATION_RE, "").trimEnd();
}

export function normalizedText(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export const commandStart = /^(?:\$\s*)?(?:sudo\b|apt(?:-get)?\b|dnf\b|yum\b|curl\b|wget\b|git\b|systemctl\b|journalctl\b|ufw\b|iptables\b|nft\b|ss\b|nstat\b|netstat\b|nmcli\b|ip\b|mount\b|umount\b|lsblk\b|fdisk\b|du\b|cp\b|mv\b|rm\b|mkdir\b|chmod\b|chown\b|nano\b|vim\b|echo\b|export\b|source\b|nvm\b|npm\b|grub-mkconfig\b|update-grub\b|sysctl\b|swapoff\b|swapon\b|mkswap\b|ssh(?:-keygen|-copy-id|-add)?\b|scp\b|useradd\b|usermod\b|passwd\b|groupadd\b|modprobe\b|lspci\b|lsusb\b|cat\b|grep\b|sed\b|awk\b|find\b|dd\b|tee\b)/;

export function extractTechnicalSnippets(markdown) {
  const snippets = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line && !line.startsWith("#")) snippets.push(normalizedText(line));
    if (!inFence && commandStart.test(line)) snippets.push(normalizedText(line.replace(/^\$\s*/, "")));
    if (!inFence && /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_.-]*)=\S/.test(line)) {
      snippets.push(normalizedText(line));
    }
    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const value = normalizedText(match[1]);
      if (value.length >= 4 && (/[\s=|]/.test(value) || value.includes("/") || value.includes("--"))) {
        snippets.push(value);
      }
    }
  }
  return unique(snippets);
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `node --import tsx --test tests/audit-snippets.test.ts`
Expected: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/loen-dynamic-budget-routing/audit-snippets.mjs tests/audit-snippets.test.ts
git commit -m "feat: extract audit snippet extraction into a testable module, fix prose false positives"
```

---

### Task 3: Wire `audit-domain-quality.mjs` to the new module and make `sourceRoot` a CLI arg

**Files:**
- Modify: `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs`

**Interfaces:**
- Consumes: `extractTechnicalSnippets`, `normalizedText`, `stripTrailingContinuation`, `unique` from `./audit-snippets.mjs` (Task 2).
- Produces: `sourceRoot` resolution now reads `process.argv[7]` (falls back to `path.join(beforeRoot, "ОС", "Unix")`) — consumed by Task 7's os-mac invocation instructions.

This task has no independent automated test (it is a Node CLI script invoked against a live vault, exercised by the Live Verification Protocol) — its correctness is covered by Task 2's unit tests (same extraction logic, now imported) plus a manual dry run in Step 4.

- [ ] **Step 1: Add the import and CLI-arg `sourceRoot`**

In `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs`, add the import after the existing `yaml` import:

```javascript
import { parse as yamlParse } from "yaml";
import { extractTechnicalSnippets, normalizedText, stripTrailingContinuation, unique } from "./audit-snippets.mjs";
```

Replace:

```javascript
const sourceRoot = path.join(beforeRoot, "ОС", "Unix");
```

with:

```javascript
const sourceRoot = process.argv[7]
  ? path.resolve(process.argv[7])
  : path.join(beforeRoot, "ОС", "Unix");
```

- [ ] **Step 2: Remove the now-duplicated inline functions**

Delete the inline `normalizedText` and `unique` function definitions (originally between `normalizeIdentity` and `markdownH1Count`):

```javascript
function normalizedText(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}
```

Delete the inline `commandStart` and `extractTechnicalSnippets` definitions (originally between `h2At` and `extractUrls`):

```javascript
const commandStart = /^(?:\$\s*)?(?:sudo\b|apt(?:-get)?\b|dnf\b|yum\b|curl\b|wget\b|git\b|systemctl\b|journalctl\b|ufw\b|iptables\b|nft\b|ss\b|nstat\b|netstat\b|nmcli\b|ip\b|mount\b|umount\b|lsblk\b|fdisk\b|du\b|cp\b|mv\b|rm\b|mkdir\b|chmod\b|chown\b|nano\b|vim\b|echo\b|export\b|source\b|nvm\b|npm\b|grub-mkconfig\b|update-grub\b|sysctl\b|swapoff\b|swapon\b|mkswap\b|ssh(?:-keygen|-copy-id|-add)?\b|scp\b|useradd\b|usermod\b|passwd\b|groupadd\b|modprobe\b|lspci\b|lsusb\b|cat\b|grep\b|sed\b|awk\b|find\b|dd\b|tee\b)/i;

function extractTechnicalSnippets(markdown) {
  const snippets = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line && !line.startsWith("#")) snippets.push(normalizedText(line));
    if (!inFence && commandStart.test(line)) snippets.push(normalizedText(line.replace(/^\$\s*/, "")));
    if (!inFence && /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_.-]*)=\S/.test(line)) {
      snippets.push(normalizedText(line));
    }
    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const value = normalizedText(match[1]);
      if (value.length >= 4 && (/[\s=|]/.test(value) || value.includes("/") || value.includes("--"))) {
        snippets.push(value);
      }
    }
  }
  return unique(snippets);
}
```

(`markdownH1Count` and `h2At`, which sit between these two removed blocks, stay in place unchanged.)

- [ ] **Step 3: Use `stripTrailingContinuation` when comparing preserved snippets**

Replace:

```javascript
  const preservedTechnicalSnippets = technicalSnippets.filter((snippet) => corpus.includes(snippet));
```

with:

```javascript
  const preservedTechnicalSnippets = technicalSnippets.filter((snippet) =>
    corpus.includes(stripTrailingContinuation(snippet)));
```

- [ ] **Step 4: Dry-run the script to confirm it still executes against the live snapshot**

Run: `node scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs os-unix /tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`
Expected: script runs to completion and prints its JSON report to stdout (no `ReferenceError`/`SyntaxError`; this only smoke-tests wiring, the live corpus's exact numbers are validated later by the Live Verification Protocol, not by this plan).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs
git commit -m "refactor: wire audit-domain-quality.mjs to the shared audit-snippets module, add sourceRoot CLI arg"
```

---

### Task 4: §1.1 evidence carry-over and §1.4 continuation tolerance in `synthesis-evidence-ledger.ts`

**Files:**
- Modify: `src/phases/synthesis-evidence-ledger.ts`
- Test: `tests/synthesis-evidence-ledger.test.ts`

**Interfaces:**
- Consumes: existing exports `extractSynthesisEvidenceLedger`, `SynthesisEvidenceLedgerItem`, `SynthesisEvidenceReconciliation` (all unchanged).
- Produces: `reconcileSynthesisEvidence(content: string, existing: string | null, ledger: readonly SynthesisEvidenceLedgerItem[], language: OutputLanguage | undefined): SynthesisEvidenceReconciliation` — same signature, now also carries over evidence from `existing`'s own evidence section that the new `content` dropped. `findMissingSynthesisEvidence(ledger, contents)` — same signature, now tolerant of a trailing shell continuation (`&&` / `\`) on either side of the comparison.

- [ ] **Step 1: Write the failing tests**

Append to `tests/synthesis-evidence-ledger.test.ts`, immediately after the existing test `"ledger reconciliation removes unsupported code and URLs, appends missing evidence"` (before `"ledger reconciliation preserves an allowed existing URL while removing a new unsupported URL"`):

```typescript
test("reconcileSynthesisEvidence carries over an earlier source's evidence block dropped by a rewrite", () => {
  const existing = [
    "# Article",
    "",
    "## Examples",
    "",
    "prior content",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "---",
    "type: concept",
    "---",
    "# Article",
    "",
    "## Examples",
    "",
    "rewritten content with no mention of the earlier command",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");

  assert.equal(reconciled.appendedItems, 1);
  assert.match(reconciled.content, /sudo earlier-command/);
  assert.ok(reconciled.content.indexOf("sudo earlier-command") < reconciled.content.indexOf("## Sources"));
});

test("reconcileSynthesisEvidence does not duplicate a carried-over item on repeated reconciliation", () => {
  const existing = [
    "# Article",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "# Article",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");
  const repeated = reconcileSynthesisEvidence(reconciled.content, existing, [], "ru");

  assert.equal(reconciled.appendedItems, 1);
  assert.equal(repeated.appendedItems, 0);
  assert.equal(repeated.content, reconciled.content);
  assert.equal((reconciled.content.match(/sudo earlier-command/g) ?? []).length, 1);
});

test("findMissingSynthesisEvidence tolerates a trailing shell line continuation", () => {
  const ledger = extractSynthesisEvidenceLedger([
    "```bash",
    "systemctl daemon-reload && \\",
    "```",
  ].join("\n"));

  assert.equal(findMissingSynthesisEvidence(ledger, ["systemctl daemon-reload"]).length, 0);
  assert.equal(findMissingSynthesisEvidence(ledger, ["systemctl daemon-reload && \\"]).length, 0);
  assert.equal(findMissingSynthesisEvidence(ledger, ["unrelated content"]).length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/synthesis-evidence-ledger.test.ts`
Expected: FAIL — `reconcileSynthesisEvidence carries over...`: `appendedItems` is `0`, not `1` (existing evidence section is currently ignored). `does not duplicate...`: same root cause. `tolerates a trailing shell line continuation`: `findMissingSynthesisEvidence(ledger, ["systemctl daemon-reload"])` returns length `1`, not `0` (raw ledger text still has the trailing `&& \`).

- [ ] **Step 3: Implement the fix**

In `src/phases/synthesis-evidence-ledger.ts`, replace `findMissingSynthesisEvidence`:

```typescript
export function findMissingSynthesisEvidence(
  ledger: readonly SynthesisEvidenceLedgerItem[],
  contents: readonly string[],
): SynthesisEvidenceLedgerItem[] {
  const corpus = normalizedCoverage(contents.join("\n"));
  return ledger.filter((item) => {
    const required = item.kind === "code"
      ? normalizedCoverage(item.coverageUnits.join("\n"))
      : normalizedCoverage(item.coverageUnits[0] ?? "");
    return required.length > 0 && !corpus.includes(required);
  });
}
```

with:

```typescript
const TRAILING_CONTINUATION_RE = /[ \t]*(?:&&[ \t]*)?\\[ \t]*$/;

function stripTrailingContinuation(value: string): string {
  return value.replace(TRAILING_CONTINUATION_RE, "").trimEnd();
}

export function findMissingSynthesisEvidence(
  ledger: readonly SynthesisEvidenceLedgerItem[],
  contents: readonly string[],
): SynthesisEvidenceLedgerItem[] {
  const corpus = normalizedCoverage(contents.join("\n"));
  return ledger.filter((item) => {
    const raw = item.kind === "code"
      ? normalizedCoverage(item.coverageUnits.join("\n"))
      : normalizedCoverage(item.coverageUnits[0] ?? "");
    const required = stripTrailingContinuation(raw);
    return required.length > 0 && !corpus.includes(required);
  });
}
```

Then, immediately after the `headingIndexes` function (just above `appendEvidenceSection`), add:

```typescript
const EVIDENCE_HEADINGS = new Set([
  "## Точные технические данные",
  "## Evidencia técnica exacta",
  "## Exact technical evidence",
]);

function existingEvidenceSection(existing: string): string {
  const lines = normalizedMarkdown(existing).split("\n");
  const headings = headingIndexes(lines);
  const start = headings.find((candidate) => EVIDENCE_HEADINGS.has(candidate.heading));
  if (start === undefined) return "";
  const end = headings.find((candidate) => candidate.index > start.index)?.index ?? lines.length;
  return lines.slice(start.index + 1, end).join("\n");
}
```

Finally, replace `reconcileSynthesisEvidence`:

```typescript
export function reconcileSynthesisEvidence(
  content: string,
  existing: string | null,
  ledger: readonly SynthesisEvidenceLedgerItem[],
  language: OutputLanguage | undefined,
): SynthesisEvidenceReconciliation {
  const sanitized = sanitizeUnsupportedEvidence(content, allowedEvidence(ledger, existing ?? ""));
  const missing = findMissingSynthesisEvidence(ledger, [sanitized.content]);
  const reconciled = appendEvidenceSection(sanitized.content, missing, language);
  const unresolved = findMissingSynthesisEvidence(ledger, [reconciled]);
  if (unresolved.length > 0) {
    throw new TypeError(`source technical evidence reconciliation left ${unresolved.length} item(s) unresolved`);
  }
  return {
    content: reconciled,
    removedUnits: sanitized.removedUnits,
    appendedItems: missing.length,
  };
}
```

with:

```typescript
export function reconcileSynthesisEvidence(
  content: string,
  existing: string | null,
  ledger: readonly SynthesisEvidenceLedgerItem[],
  language: OutputLanguage | undefined,
): SynthesisEvidenceReconciliation {
  const sanitized = sanitizeUnsupportedEvidence(content, allowedEvidence(ledger, existing ?? ""));
  const carryOver = existing === null
    ? []
    : findMissingSynthesisEvidence(extractLedger(existingEvidenceSection(existing), false), [sanitized.content]);
  const missing = findMissingSynthesisEvidence(ledger, [sanitized.content]);
  const appended = [...carryOver, ...missing];
  const reconciled = appendEvidenceSection(sanitized.content, appended, language);
  const unresolved = findMissingSynthesisEvidence(ledger, [reconciled]);
  if (unresolved.length > 0) {
    throw new TypeError(`source technical evidence reconciliation left ${unresolved.length} item(s) unresolved`);
  }
  return {
    content: reconciled,
    removedUnits: sanitized.removedUnits,
    appendedItems: appended.length,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/synthesis-evidence-ledger.test.ts`
Expected: all tests pass, including the 3 new ones.

- [ ] **Step 5: Run the full regression suite for this file's consumer**

Run: `node --import tsx --test tests/ingest-synthesis.test.ts`
Expected: all tests pass (no behavior change for the synthesis pipeline's happy path).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/phases/synthesis-evidence-ledger.ts tests/synthesis-evidence-ledger.test.ts
git commit -m "fix: carry over evidence across cross-source page rewrites, tolerate shell line continuations"
```

---

### Task 5: §2.1 facet coverage in `selectQueryContextChunks`

**Files:**
- Modify: `src/phases/query-budget.ts`
- Modify: `src/phases/query.ts:372`
- Modify: `src/phases/query-cross-domain.ts:165`
- Test: `tests/query-budget.test.ts`

**Interfaces:**
- Consumes: `tokenizeLexical(text: string): Set<string>` from `src/lexical-retrieval.ts` (existing export, unchanged).
- Produces: `selectQueryContextChunks(rankedChunks: readonly SelectedChunk[], contextLimit: number, question = ""): SelectedChunk[]` — new optional 3rd parameter, defaults to `""` so all 5 pre-existing 2-arg call sites in `tests/query-budget.test.ts` keep working unedited.

- [ ] **Step 1: Write the failing test**

Append to `tests/query-budget.test.ts`, immediately after the existing test `"selectQueryContextChunks falls back to global rank when anchors have no siblings"`:

```typescript
test("selectQueryContextChunks reserves a sibling slot for an uncovered question facet", () => {
  const anchors = Array.from({ length: 3 }, (_, index) => selectedChunk(index, 100 - index));
  const filler = { ...selectedChunk(3, 97), body: "No relevant keyword here." };
  const facetChunk = { ...selectedChunk(4, 90), body: "Ask about the storage quota limit." };
  const ranked = [...anchors, filler, facetChunk];

  assert.deepEqual(selectQueryContextChunks(ranked, 4), [...anchors, filler]);
  assert.deepEqual(
    selectQueryContextChunks(ranked, 4, "What is the storage quota limit?"),
    [...anchors, facetChunk],
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import tsx --test tests/query-budget.test.ts`
Expected: FAIL on the new test — the 3-argument call selects `filler` (rank order) instead of `facetChunk`, since the facet parameter does not exist yet and is silently ignored by JS; `assert.deepEqual` reports a mismatch on the chunk list (`facetChunk` missing, `filler` present in its place).

- [ ] **Step 3: Implement the fix**

In `src/phases/query-budget.ts`, add the import:

```typescript
import { tokenizeLexical } from "../lexical-retrieval";
```

Add a helper right after `chunkUnitId`:

```typescript
function chunkFacets(chunk: SelectedChunk): Set<string> {
  return tokenizeLexical(`${chunk.heading}\n${chunk.body}`);
}
```

Change the `selectQueryContextChunks` signature:

```typescript
export function selectQueryContextChunks(
  rankedChunks: readonly SelectedChunk[],
  contextLimit: number,
  question = "",
): SelectedChunk[] {
```

After the line `const orderedIndexes = [...selectedIndexes].sort((left, right) => left - right);` and before the final `for (let index = 0; index < rankedChunks.length; index += 1) {` sibling-fill loop, insert:

```typescript
  let facetSlots = 0;
  for (const facet of tokenizeLexical(question)) {
    if (selectedIndexes.size >= limit || facetSlots >= siblingSlots) break;
    const covered = orderedIndexes.some((index) => chunkFacets(rankedChunks[index]).has(facet));
    if (covered) continue;
    const index = rankedChunks.findIndex((chunk, idx) =>
      !selectedIndexes.has(idx) && chunkFacets(chunk).has(facet));
    if (index < 0) continue;
    selectedIndexes.add(index);
    orderedIndexes.push(index);
    facetSlots += 1;
  }
```

In `src/phases/query.ts`, at line 372, replace:

```typescript
  const contextChunks = selectQueryContextChunks(reranked.chunks, contextLimit);
```

with:

```typescript
  const contextChunks = selectQueryContextChunks(reranked.chunks, contextLimit, question);
```

In `src/phases/query-cross-domain.ts`, at line 165, replace:

```typescript
  const contextChunks = selectQueryContextChunks(reranked.chunks, contextLimit);
```

with:

```typescript
  const contextChunks = selectQueryContextChunks(reranked.chunks, contextLimit, q);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --import tsx --test tests/query-budget.test.ts`
Expected: all tests pass, including the new one and the 5 pre-existing 2-arg calls (unaffected by the default parameter).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query-budget.ts src/phases/query.ts src/phases/query-cross-domain.ts tests/query-budget.test.ts
git commit -m "feat: reserve a context slot for an uncovered question facet in query budgeting"
```

---

### Task 6: §2.2 path trailing-period fix

**Files:**
- Modify: `src/phases/query-grounding-validator.ts:157`

**Interfaces:**
- Consumes: none new.
- Produces: no signature change — `extractTechnicalUnits(markdown: string): QueryTechnicalUnit[]` keeps its existing shape; only the `path` pattern's cleaner changes.

- [ ] **Step 1: Write the failing test**

Add to `tests/query-grounding-validator.test.ts`, immediately after the existing test `"technical grounding does not classify slash-separated prose as a path"`:

```typescript
test("technical grounding strips a trailing sentence period from an extracted path", () => {
  const answer = "See /etc/modprobe.d/amdgpu.conf.";

  assert.deepEqual(extractTechnicalUnits(answer), [{
    kind: "path",
    text: "/etc/modprobe.d/amdgpu.conf",
  }]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: FAIL — actual `text` is `"/etc/modprobe.d/amdgpu.conf."` (trailing period included), not `"/etc/modprobe.d/amdgpu.conf"`.

- [ ] **Step 3: Implement the fix**

In `src/phases/query-grounding-validator.ts`, inside `extractTechnicalUnits`'s pattern list (line 157), replace:

```typescript
    [/(?<![\p{L}\p{N}])(?:~|\.{1,2})?\/(?:[A-Za-z0-9._~+@%=-]+\/)*[A-Za-z0-9._~+@%=-]+/gu, "path"],
```

with:

```typescript
    [/(?<![\p{L}\p{N}])(?:~|\.{1,2})?\/(?:[A-Za-z0-9._~+@%=-]+\/)*[A-Za-z0-9._~+@%=-]+/gu, "path",
      (value) => value.replace(/\.+$/, "")],
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: all tests pass, including the new one.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query-grounding-validator.ts tests/query-grounding-validator.test.ts
git commit -m "fix: strip trailing sentence period from extracted technical paths"
```

---

### Task 7: §2.3 Markdown repair pass in `cleanSanitizedProseLine`

**Files:**
- Modify: `src/phases/query-grounding-validator.ts:237-248`

**Interfaces:**
- Consumes: none new.
- Produces: no exported signature change — `cleanSanitizedProseLine` stays internal; `sanitizeUnsupportedTechnicalLines`'s exported signature is unchanged by this task (its `articleIds` parameter is added separately in Task 8).

- [ ] **Step 1: Write the failing tests**

Add to `tests/query-grounding-validator.test.ts`, immediately after the existing test `"technical grounding sanitizer removes only unsupported technical lines"`:

```typescript
test("technical grounding sanitizer repairs empty emphasis and parenthesis residue left by inline-code removal", () => {
  const context = "sysctl controls memory pressure settings.";
  const answer = "- **`vm.dirty_expire_centisecs`** – максимальное время жизни грязных страниц (`vm.dirty_expire_centisecs`) в памяти.";
  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);

  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.equal(sanitized.answer, "- – максимальное время жизни грязных страниц в памяти.");
});

test("technical grounding sanitizer preserves real emphasis, glob patterns, and snake_case identifiers", () => {
  const context = "docs/**/*.ts и vm_dirty_expire_centisecs описаны в документации.";
  const answer = "**Важно:** `docs/**/*.ts` и `vm_dirty_expire_centisecs` используют порт 9999.";
  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);

  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.match(sanitized.answer, /\*\*Важно:\*\*/);
  assert.match(sanitized.answer, /`docs\/\*\*\/\*\.ts`/);
  assert.match(sanitized.answer, /`vm_dirty_expire_centisecs`/);
  assert.doesNotMatch(sanitized.answer, /9999/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: FAIL on the first new test — actual `sanitized.answer` is `"- **** – максимальное время жизни грязных страниц () в памяти."` (empty `****` emphasis and empty `()` both survive), not the expected repaired string. The second new test currently passes already (real emphasis/glob/snake_case are not touched by removal in this fixture) — it exists as a guard so Step 3 cannot regress it.

- [ ] **Step 3: Implement the fix**

In `src/phases/query-grounding-validator.ts`, replace `cleanSanitizedProseLine`:

```typescript
function cleanSanitizedProseLine(line: string): string {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  const body = line.slice(leading.length)
    .replace(/\[([^\]]+)]\([ \t]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([([])[ \t]+/g, "$1")
    .replace(/[ \t]+([)\]])/g, "$1")
    .trim();
  if (!/[\p{L}\p{N}`\]]/u.test(body)) return "";
  return `${leading}${body}`;
}
```

with:

```typescript
function cleanSanitizedProseLine(line: string): string {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  const body = line.slice(leading.length)
    .replace(/\[([^\]]+)]\([ \t]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([([])[ \t]+/g, "$1")
    .replace(/[ \t]+([)\]])/g, "$1")
    .replace(/\*\*\*\*/g, "")
    .replace(/____/g, "")
    .replace(/(^|[ \t])(\*\*|__|\*|_)(?=[ \t]|$)/g, "$1")
    .replace(/(?<!`)``(?!`)/g, "")
    .replace(/\([ \t]*\)/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (body.length === 0 || /^\d{1,9}[.)]$/.test(body)) return "";
  if (!/[\p{L}\p{N}`\]]/u.test(body)) return "";
  return `${leading}${body}`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: all tests pass, including both new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query-grounding-validator.ts tests/query-grounding-validator.test.ts
git commit -m "fix: repair empty emphasis, parenthesis, and code-label residue after grounding sanitation"
```

---

### Task 8: §2.4 title-only support in `findUnsupportedTechnicalUnits`

**Files:**
- Modify: `src/phases/query-grounding-validator.ts:187-207`
- Modify: `src/phases/query-answer.ts` (4 call sites)
- Test: `tests/query-grounding-validator.test.ts`

**Interfaces:**
- Consumes: `knownStems: Set<string>` already declared in `src/phases/query-answer.ts` (`const knownStems = new Set(selectedChunks.map((chunk) => chunk.articleId));`, unchanged by this task).
- Produces: `findUnsupportedTechnicalUnits(answer: string, selectedContext: readonly string[], articleIds: readonly string[] = []): QueryTechnicalUnit[]` — new optional 3rd parameter, defaults to `[]` so existing 2-arg calls (including this file's own Task 6/7 tests) keep working unedited.

- [ ] **Step 1: Write the failing tests**

Add to `tests/query-grounding-validator.test.ts`, immediately after the existing test `"technical grounding does not classify slash-separated prose as a path"` (before the Task 6 test added in this plan, or after it — both insertion points are equally valid; place these 3 tests as a contiguous block):

```typescript
test("technical grounding treats a unit as supported when it matches a selected article's title-derived id", () => {
  const context = ["Раздел объясняет настройку параметров ядра памяти без упоминания точного имени параметра."];
  const answer = "Параметр `vm.dirty_expire_centisecs` управляет временем жизни грязных страниц.";
  const articleIds = ["wiki_linux_vm_dirty_expire_centisecs"];

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, context), [{
    kind: "inline_code",
    text: "vm.dirty_expire_centisecs",
  }]);
  assert.deepEqual(findUnsupportedTechnicalUnits(answer, context, articleIds), []);
});

test("technical grounding does not apply title support to a single-segment unit", () => {
  const answer = "See `restart` for details.";
  const articleIds = ["wiki_linux_restart"];

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, ["unrelated context"], articleIds), [{
    kind: "inline_code",
    text: "restart",
  }]);
});

test("technical grounding never applies title support to numeric units", () => {
  const answer = "Значение равно 1.5.";
  const articleIds = ["wiki_topic_1_5"];

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, ["другой текст"], articleIds), [{
    kind: "number",
    text: "1.5",
  }]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: FAIL on all 3 new tests — the 3rd (`articleIds`) argument is currently silently ignored, so `findUnsupportedTechnicalUnits(answer, context, articleIds)` still returns the unit as unsupported instead of `[]` in the first test; the other two tests' 2-argument-equivalent assertions already pass but the 3-argument calls behave identically to the 2-argument ones (no guard exists yet) — this is fine, since the meaningful assertion in each is the first `deepEqual`, which fails identically to the guard being absent (there is no differing "supported" branch to test against yet).

- [ ] **Step 3: Implement the fix**

In `src/phases/query-grounding-validator.ts`, immediately before `export function findUnsupportedTechnicalUnits`, add:

```typescript
function idForm(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleSupported(unit: QueryTechnicalUnit, articleIds: readonly string[]): boolean {
  if (unit.kind === "number") return false;
  const unitForm = idForm(unit.text);
  if (!unitForm.includes("_")) return false;
  return articleIds.some((articleId) => {
    const articleForm = idForm(articleId);
    return articleForm === unitForm || articleForm.endsWith(`_${unitForm}`);
  });
}
```

Replace `findUnsupportedTechnicalUnits`:

```typescript
export function findUnsupportedTechnicalUnits(
  answer: string,
  selectedContext: readonly string[],
): QueryTechnicalUnit[] {
  const context = normalizeText(selectedContext.join("\n"));
  return extractTechnicalUnits(answer).filter((unit) => {
    const value = normalizeText(unit.text);
    return unit.kind === "number"
      ? !containsExactNumber(context, value)
      : !context.includes(value);
  });
}
```

with:

```typescript
export function findUnsupportedTechnicalUnits(
  answer: string,
  selectedContext: readonly string[],
  articleIds: readonly string[] = [],
): QueryTechnicalUnit[] {
  const context = normalizeText(selectedContext.join("\n"));
  return extractTechnicalUnits(answer).filter((unit) => {
    const value = normalizeText(unit.text);
    const supported = unit.kind === "number"
      ? containsExactNumber(context, value)
      : context.includes(value);
    return !supported && !titleSupported(unit, articleIds);
  });
}
```

In `src/phases/query-answer.ts`, update all 4 call sites. First, at line 456, replace:

```typescript
    const unsupported = findUnsupportedTechnicalUnits(answer, selectedContext);
```

with:

```typescript
    const unsupported = findUnsupportedTechnicalUnits(answer, selectedContext, [...knownStems]);
```

Second, at line 475, replace:

```typescript
        sanitizedUnsupported = findUnsupportedTechnicalUnits(sanitizedAnswer, selectedContext);
```

with:

```typescript
        sanitizedUnsupported = findUnsupportedTechnicalUnits(sanitizedAnswer, selectedContext, [...knownStems]);
```

Third, at line 522, replace:

```typescript
          const repairUnsupported = findUnsupportedTechnicalUnits(
            repair.value.answer_markdown,
            selectedContext,
          );
```

with:

```typescript
          const repairUnsupported = findUnsupportedTechnicalUnits(
            repair.value.answer_markdown,
            selectedContext,
            [...knownStems],
          );
```

Fourth, at line 611, replace:

```typescript
          const stillUnsupported = findUnsupportedTechnicalUnits(
            r.value.answer_markdown,
            selectedContext,
          );
```

with:

```typescript
          const stillUnsupported = findUnsupportedTechnicalUnits(
            r.value.answer_markdown,
            selectedContext,
            [...knownStems],
          );
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/query-grounding-validator.test.ts`
Expected: all tests pass, including all 3 new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query-grounding-validator.ts src/phases/query-answer.ts tests/query-grounding-validator.test.ts
git commit -m "feat: support technical units that only match a selected article's own title"
```

---

### Task 9: os-mac diagnostic query-quality corpus

**Files:**
- Create: `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json`

**Interfaces:**
- Consumes: none (static data file, same shape as the existing `os-unix-query-quality-cases.json`: array of `{id, question, expectedPages, requiredFacts}`, `requiredFacts` an array of OR-groups).
- Produces: a 16-case corpus consumed by the Live Verification Protocol's audit scripts when invoked with the `os-mac` domain — per the spec, os-mac gates are diagnostic, not blocking, and os-unix remains sole coverage for cross-source attribution.

This is a static data file with no code logic — there is no red/green cycle. Its correctness is validated by JSON syntax and by manual review against the real 16-page os-mac snapshot at `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/!Wiki/os-mac/`.

- [ ] **Step 1: Create the file**

```json
[
  {
    "id": "terminal-proxy-scripting",
    "question": "Как Терминал в macOS используется для автоматизации переключения прокси-серверов и какая команда для этого упоминается?",
    "expectedPages": ["wiki_os-mac_terminal", "wiki_os-mac_macos", "wiki_os-mac_proxy_server"],
    "requiredFacts": [["networksetup"], ["скриптов"], ["командную строку"]]
  },
  {
    "id": "anonymity-socks5-check",
    "question": "Почему SOCKS5 обеспечивает более высокую анонимность, чем HTTP/HTTPS прокси, и на каких сайтах проверяют IP-адрес после настройки?",
    "expectedPages": ["wiki_os-mac_anonymity", "wiki_os-mac_socks5", "wiki_os-mac_proxy_server"],
    "requiredFacts": [["2ip.ru"], ["whatismyip.com"], ["не изменяет заголовки"], ["SOCKS5"]]
  },
  {
    "id": "bypass-blocking-pac",
    "question": "Как в macOS обойти блокировку конкретных сайтов через SOCKS5 и PAC-файл, и где выполняется такая настройка?",
    "expectedPages": ["wiki_os-mac_bypass_blocking", "wiki_os-mac_socks5", "wiki_os-mac_pac_file"],
    "requiredFacts": [["SOCKS5"], ["PAC-файл"], ["вкладке «Прокси»"], ["глубокой инспекцией пакетов"]]
  },
  {
    "id": "caching-http-proxy",
    "question": "Какой тип прокси поддерживает кэширование веб-страниц в macOS и почему SOCKS5 для этого не подходит?",
    "expectedPages": ["wiki_os-mac_caching", "wiki_os-mac_http", "wiki_os-mac_socks5"],
    "requiredFacts": [["не анализирует HTTP-заголовки"], ["Ускорение повторных запросов"], ["HTTPS (частично)"]]
  },
  {
    "id": "network-tab-to-proxies",
    "question": "Какие сетевые подключения показывает раздел «Сеть» в Системных настройках macOS и как из него попасть на вкладку «Прокси»?",
    "expectedPages": ["wiki_os-mac_network", "wiki_os-mac_system_settings", "wiki_os-mac_proxies"],
    "requiredFacts": [["Ethernet"], ["USB"], ["Подробнее"], ["SOCKS прокси"]]
  },
  {
    "id": "proxies-tab-auth-and-pac",
    "question": "Что можно настроить на вкладке «Прокси» в macOS: типы прокси, автонастройку через PAC-файл и авторизацию?",
    "expectedPages": ["wiki_os-mac_proxies", "wiki_os-mac_pac_file", "wiki_os-mac_proxy_authorization"],
    "requiredFacts": [["Автонастройка прокси"], ["Proxy server requires password"], ["localhost, 127.0.0.1, *.local"], ["Веб-прокси (HTTP)"]]
  },
  {
    "id": "proxy-authorization-pac-limits",
    "question": "Почему PAC-файл не подходит для хранения логина и пароля прокси-сервера и как в macOS всё же включить авторизацию?",
    "expectedPages": ["wiki_os-mac_proxy_authorization", "wiki_os-mac_pac_file", "wiki_os-mac_proxy_server"],
    "requiredFacts": [["нельзя встроить логин/пароль в код"], ["Proxy server requires password"], ["Username"], ["Password"]]
  },
  {
    "id": "proxy-server-ports-and-check",
    "question": "Какие протоколы поддерживает прокси-сервер в macOS, какие у них типичные порты и на каких сайтах проверить, что прокси реально применяется?",
    "expectedPages": ["wiki_os-mac_proxy_server", "wiki_os-mac_http", "wiki_os-mac_https", "wiki_os-mac_socks5"],
    "requiredFacts": [["8080"], ["443"], ["1080"], ["2ip.ru"]]
  },
  {
    "id": "pac-file-directives",
    "question": "Какая функция обязательна в PAC-файле для Safari на macOS и какие директивы возврата она может использовать?",
    "expectedPages": ["wiki_os-mac_pac_file", "wiki_os-mac_socks5", "wiki_os-mac_https"],
    "requiredFacts": [["FindProxyForURL"], ["DIRECT"], ["SOCKS5 host:port"], ["PROXY"]]
  },
  {
    "id": "system-settings-entry-point",
    "question": "С чего начинается настройка прокси в macOS через Системные настройки и на какой вкладке она завершается?",
    "expectedPages": ["wiki_os-mac_system_settings", "wiki_os-mac_network", "wiki_os-mac_proxies"],
    "requiredFacts": [["Apple"], ["Сеть"], ["Подробнее"], ["Прокси"]]
  },
  {
    "id": "macos-proxy-mechanism",
    "question": "К какому семейству ОС относится macOS, кто её разработчик и какие протоколы прокси она поддерживает через системные настройки?",
    "expectedPages": ["wiki_os-mac_macos", "wiki_os-mac_system_settings", "wiki_os-mac_proxies"],
    "requiredFacts": [["Apple"], ["Darwin"], ["PAC-файл"], ["SOCKS5"]]
  },
  {
    "id": "ftp-socks5-only",
    "question": "Какой протокол проксирует передачу файлов по FTP в macOS, а через какие прокси FTP вообще не работает?",
    "expectedPages": ["wiki_os-mac_ftp", "wiki_os-mac_socks5", "wiki_os-mac_http"],
    "requiredFacts": [["File Transfer Protocol"], ["SOCKS5"], ["не работает через HTTP/HTTPS прокси"]]
  },
  {
    "id": "http-proxy-ports",
    "question": "Какие типичные порты использует HTTP-прокси в macOS и как называется соответствующая опция в системных настройках?",
    "expectedPages": ["wiki_os-mac_http", "wiki_os-mac_proxies", "wiki_os-mac_caching"],
    "requiredFacts": [["8080"], ["3128"], ["Веб-прокси (HTTP)"], ["Ускорение повторных запросов"]]
  },
  {
    "id": "https-proxy-pac-caveat",
    "question": "Как называется опция HTTPS-прокси в Системных настройках macOS и какую директиву PAC-файла стоит использовать вместо HTTPS?",
    "expectedPages": ["wiki_os-mac_https", "wiki_os-mac_pac_file", "wiki_os-mac_http"],
    "requiredFacts": [["Защищённый веб-прокси (HTTPS)"], ["443"], ["PROXY"], ["TLS", "SSL"]]
  },
  {
    "id": "socks5-universal-proxy",
    "question": "Почему SOCKS5 считается универсальным протоколом для прокси в macOS и какой у него типичный порт?",
    "expectedPages": ["wiki_os-mac_socks5", "wiki_os-mac_udp", "wiki_os-mac_ftp"],
    "requiredFacts": [["1080"], ["UDP"], ["TCP"], ["File Transfer Protocol"]]
  },
  {
    "id": "udp-realtime-through-socks5",
    "question": "Какие приложения используют UDP-трафик через SOCKS5-прокси в macOS и для чего это нужно?",
    "expectedPages": ["wiki_os-mac_udp", "wiki_os-mac_socks5"],
    "requiredFacts": [["FaceTime"], ["Zoom"], ["User Datagram Protocol"], ["SOCKS5"]]
  }
]
```

- [ ] **Step 2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json', 'utf8')); console.log('valid, ' + JSON.parse(require('fs').readFileSync('scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json', 'utf8')).length + ' cases')"`
Expected: `valid, 16 cases`

- [ ] **Step 3: Commit**

```bash
git add scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json
git commit -m "test: add os-mac diagnostic query-quality corpus"
```

---

### Task 10: Register reconciliation — rewrite TD-1 and TD-2 in `tech-debt.md`

**Files:**
- Modify: `docs/loen/dynamic-llm-budget-routing/tech-debt.md`

**Interfaces:**
- Consumes: none (documentation only).
- Produces: none (documentation only) — this is the final, human-facing record that TD-1 and TD-2 are closed pending the Live Verification Protocol.

- [ ] **Step 1: Replace the TD-1 section**

Replace the entire `## TD-1: Exact Technical Evidence Classification and Reconciliation` section (from that heading through the line before `## TD-2: Query Context Coverage and Grounding Sanitation`) with:

```markdown
## TD-1: Exact Technical Evidence Classification and Reconciliation

Status: fixed, pending live verification.

Live source audit reported 12 missing snippets out of 537 candidates (323 ledger items, 3 unrepresented), decomposed into four groups:

- 6 snippets / 3 ledger items (`NFS Server.md` `code:203-203`, `code:217-217`, `storage.md` `code:33-37`) absent from the final domain due to evidence erosion on a cross-source page rewrite: `reconcileSynthesisEvidence` only reconciled against the live ledger, not against an existing page's own already-published evidence section, so a later source's rewrite of a shared page silently dropped an earlier source's evidence block. Fixed by carrying over any evidence block from `existing` that the ledger no longer covers, deduplicated against what the new content already contains (`src/phases/synthesis-evidence-ledger.ts`).
- 1 snippet (`systemctl daemon-reload && \`) represented with equivalent content but without its trailing shell line continuation — fixed by tolerating a trailing continuation (`&&`/`\`) symmetrically in `findMissingSynthesisEvidence` (`src/phases/synthesis-evidence-ledger.ts`) and in the audit's own snippet-vs-corpus comparison in `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs` (via the shared `stripTrailingContinuation` helper exported by `scripts/loen-dynamic-budget-routing/audit-snippets.mjs`).
- 2 English explanatory sentences incorrectly classified as exact technical content by the audit's case-insensitive `commandStart` command-head match — fixed by making that match case-sensitive, so a capitalized prose sentence no longer registers as a shell command.
- 3 snippets (`~/.local/share/applications/obsidian.desktop`, `sudo apt install network-manager`, `sudo nmcli dev show`) never accepted into any ledger in the first place — a ledger-*selection* gap, not a reconciliation defect, explicitly out of scope for this fix and recorded under Discovered Debt.

Acceptance (met against the fixed 22-source corpus prior to live verification):

- zero unrepresented accepted ledger items;
- zero prose false positives in the exact-evidence audit;
- 100% source URL preservation;
- no additional LLM request, retry, or token-ceiling increase.

Evidence: `evidence/conflict-validation-split-live-domain-quality-1785096684125.json` (baseline); live re-run pending per the Live Verification Protocol.

## TD-2: Query Context Coverage and Grounding Sanitation

Status: fixed, pending live verification.

The fixed ten-query replay completed 10/10 with zero retries and zero invalid WikiLinks, but macro required-fact coverage was 91.809%, below the accepted 92.904% gate. All five omitted fact groups existed in generated pages — the gaps were downstream of synthesis:

- the final context could select the correct article but omit the section containing an exact path or command — fixed by reserving a sibling context slot for each question facet (tokenized from the query) not already covered by the selected chunks, in `selectQueryContextChunks` (`src/phases/query-budget.ts`);
- a supported path unit could be wrongly flagged as unsupported solely because it captured a trailing sentence period — fixed by stripping the trailing period in the `path` pattern's value cleaner in `extractTechnicalUnits` (`src/phases/query-grounding-validator.ts`);
- after a correct removal, deterministic grounding sanitation could leave malformed Markdown residue behind, such as an empty emphasis span `****` — fixed by extending `cleanSanitizedProseLine` (`src/phases/query-grounding-validator.ts`) to repair empty emphasis spans, empty parenthesis pairs, empty code labels, and now-empty/numeral-only residue lines;
- a technical unit could legitimately be supported only by a selected article's own title (not its body) — fixed by adding title-derived-id support (`findUnsupportedTechnicalUnits`'s new `articleIds` parameter), gated to multi-segment, non-numeric units matched by suffix against the selected articles' id forms.

Acceptance (met against the fixed 10-query replay prior to live verification):

- 10/10 fixed cases complete with zero model repair and zero invalid WikiLinks;
- macro required-fact coverage at or above 92.904%;
- no malformed Markdown after sanitation;
- unchanged Query input/output ceilings and final context size.

Evidence: `evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json` and `evidence/os-unix-query-grounding-conflict-validation-split-live-1785096684125.json` (baseline); live re-run pending per the Live Verification Protocol. A second, diagnostic-only corpus for the os-mac domain (`scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json`, 16 cases) now exists alongside the os-unix corpus; os-unix remains the sole domain used for cross-source attribution acceptance.
```

- [ ] **Step 2: Diff-review the file**

Run: `git diff docs/loen/dynamic-llm-budget-routing/tech-debt.md`
Expected: only the TD-1 and TD-2 sections changed; `TD-3`, `TD-4`, `Non-Actions`, `Scope`, and the header are byte-identical to before.

- [ ] **Step 3: Commit**

```bash
git add docs/loen/dynamic-llm-budget-routing/tech-debt.md
git commit -m "docs: close TD-1 and TD-2 register entries pending live verification"
```

---

### Task 11: Full regression pass and Phase-0 confirmation

**Files:**
- None modified — this task only runs existing tests.

**Interfaces:**
- Consumes: `tests/td1-td2-phase0-repro.test.ts` (Task 1), `tests/audit-snippets.test.ts` (Task 2), `tests/synthesis-evidence-ledger.test.ts` (Task 4), `tests/query-budget.test.ts` (Task 5), `tests/query-grounding-validator.test.ts` (Tasks 6-8), `tests/ingest-synthesis.test.ts`, `tests/query-parity.test.ts`.
- Produces: nothing — this is the plan's closing verification gate.

- [ ] **Step 1: Re-run the Phase 0 file and confirm all 5 classes now pass**

Run: `node --import tsx --test tests/td1-td2-phase0-repro.test.ts`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 2: Run every touched or dependent test file**

```bash
node --import tsx --test tests/audit-snippets.test.ts
node --import tsx --test tests/synthesis-evidence-ledger.test.ts
node --import tsx --test tests/query-budget.test.ts
node --import tsx --test tests/query-grounding-validator.test.ts
node --import tsx --test tests/ingest-synthesis.test.ts
node --import tsx --test tests/query-parity.test.ts
```

Expected: `# fail 0` on every file.

- [ ] **Step 3: Full project typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Confirm no unrelated files changed**

Run: `git status --short`
Expected: clean working tree (everything already committed by Tasks 1-10; only untracked files, if any, are pre-existing and unrelated to this plan).

No commit for this task — it is a verification gate over work already committed in Tasks 1-10.

---

## Live Verification Protocol (manual, not part of the checkbox tasks above)

Per the spec, closing TD-1/TD-2 in the register as `fixed` (not just `fixed, pending live verification` as written by Task 10) requires a live Obsidian re-run that this plan cannot automate:

1. Build the plugin (`npm run build`) and record its output SHA256.
2. Copy the built artifact into the user's real Obsidian vault and have them restart Obsidian.
3. User runs two force-reinits (os-unix, then os-mac) inside Obsidian.
4. User signals completion.
5. Run the 4 audit scripts (including `audit-domain-quality.mjs` for both domains, using the new `sourceRoot` CLI arg for os-mac) and compare against the Phase 1/Phase 2 acceptance lists above.
6. Pass condition: 22/22 sources done, zero page-integrity failures, both acceptance lists hold. A failed run does not close the register item — Task 10's `tech-debt.md` text stays at "pending live verification" until this protocol passes.

This step is inherently user-driven (requires a real Obsidian instance and vault) and is intentionally excluded from the automated task list above.

---

## Self-Review

**1. Spec coverage:**
- Phase 0 (7 classes, done criterion) → Task 1 (5 classes via dedicated file) + Task 2 (classes 2, 3 via `audit-snippets.test.ts`); classes 2 (shared-page attribution) and 3... — correction: the spec's "class 2" and "class 3" retired items (shared-page/cross-source attribution, per-line coverage) are explicitly out of scope per the spec ("Two originally-considered classes... formally RETIRED as unreproducible"); the 7 in-scope classes (evidence erosion, prose false positive, continuation artifact, facet omission, false unsupported path, malformed sanitation, title-only support) are covered by Task 1 (1, 4, 5, 6, 7) and Task 2 (prose false positive, continuation artifact — via `audit-snippets.test.ts`'s tests 1-3 and 6). ✓
- Phase 1 §1.1 (evidence preservation across cross-source updates) → Task 4. ✓
- Phase 1 §1.3 (prose false positives, case-sensitive `commandStart`) → Task 2. ✓
- Phase 1 §1.4 (line-continuation tolerance, both `findMissingSynthesisEvidence` and the audit script) → Task 4 (product) + Task 2/Task 3 (audit script, symmetric via shared `stripTrailingContinuation`). ✓
- Phase 2 §2.1 (facet coverage, sibling-only budget, optional `question` param) → Task 5. ✓
- Phase 2 §2.2 (path trailing-period fix in the collector, not the comparator) → Task 6. ✓
- Phase 2 §2.3 (Markdown repair closed list, explicitly not covering dangling-clause prose damage) → Task 7. ✓
- Phase 2 §2.4 (title-only support, `idForm`, suffix match, multi-segment + non-numeric guards, optional `articleIds` param, 4 call sites) → Task 8. ✓
- Scope and Boundaries file list → every listed file (`synthesis-evidence-ledger.ts`, `audit-domain-quality.mjs`, `query-grounding-validator.ts` + its 4 call sites, `query-budget.ts`, `query.ts:372`, `query-cross-domain.ts:165`, `os-mac-query-quality-cases.json`) has a task. ✓
- Register reconciliation paragraph → Task 10. ✓
- Second Domain: os-mac (`sourceRoot` CLI arg, new 16-case file, diagnostic-not-blocking) → Task 3 (CLI arg) + Task 9 (corpus file); "diagnostic not blocking" and "os-unix remains sole coverage for cross-source attribution" are stated in Task 10's rewritten TD-2 text. ✓
- Testing section's 6 bullets → bullet 1 (Phase 0 dedicated file) = Task 1; bullet 2 (ledger carry-over/no-dup/continuation) = Task 4; bullet 3 (`ingest-synthesis.test.ts` stays green) = Task 4 Step 5 and Task 11 Step 2; bullet 4 (audit-snippet-extractor coverage) = Task 2; bullet 5 (facet test, 5 existing calls unedited) = Task 5; bullet 6 (grounding validator coverage: false-path guard, Markdown repair + preservation guard, §2.4's 4 cases, 2-arg backward compat) = Tasks 6, 7, 8. ✓
- Live Verification Protocol → documented as a non-automatable manual section after Task 11, not as a checkbox task (per its inherently user-driven nature). ✓
- Discovered Debt / Non-Actions / Risks → intentionally not implemented; reflected in Global Constraints and in Task 10's TD-1/TD-2 text scope boundaries. ✓

**2. Placeholder scan:** searched for "TBD", "TODO", "implement later", "add appropriate", "similar to Task N", unfilled code blocks — none found. Every step has literal code, exact commands, and exact expected output (including exact `AssertionError` text for Phase 0's red-state confirmations, captured from an actual test run against current `HEAD`).

**3. Type consistency:** `selectQueryContextChunks(rankedChunks, contextLimit, question = "")` — same name/shape used in Task 1, Task 5, and the Task 1 Step-2 expected-failure description. `findUnsupportedTechnicalUnits(answer, selectedContext, articleIds = [])` — same name/shape used in Task 1, Task 6 (2-arg calls, unaffected), Task 7 (2-arg calls, unaffected), Task 8 (3-arg calls) and the 4 `query-answer.ts` call sites. `sanitizeUnsupportedTechnicalLines(answer, unsupported)` — unchanged signature, used identically in Task 1, Task 7, Task 8. `stripTrailingContinuation` — same implementation duplicated intentionally in two modules (`synthesis-evidence-ledger.ts` internal, `audit-snippets.mjs` exported) per the spec's explicit requirement that the rule apply identically in both places; not a naming inconsistency, a deliberate parallel implementation across a TS/JS boundary that cannot share a module. No mismatches found.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-td1-td2-evidence-and-grounding.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
