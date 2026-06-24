---
state: plan
date: 2026-06-24
branch: dev/query-link-resolver
review:
  plan_hash: 4541a8a362fd086c
  spec_hash: 0f090b960dde808f
  last_run: 2026-06-24
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
      section: "### Task 1: link-resolver.ts — deterministic broken-link resolver"
      section_hash: 82512fd2c5aeb84c
      text: "Strings rendered as REDACTEDringify / REDACTEDnd / REDACTEDswer inside code blocks (Tasks 1, 2, 5) are a harness session-filter display artifact masking substrings; the on-disk source text is correct. Not placeholders or broken references — display readability only."
      verdict: accepted
      verdict_at: 2026-06-24
    - id: F-002
      phase: coverage
      severity: INFO
      section: "### Task 2: Wire resolver + structured diagnostics into query.ts"
      section_hash: ae9e7b43bd6df384
      text: "Spec §Diagnostics lists four outcome labels (resolved / llm-fixed / stripped / annotated); the plan emits three, collapsing ambiguous+unresolved into a single 'annotated' label with no separate 'stripped'. Spec §Verification step 3 treats stripped/annotated as interchangeable acceptable outcomes, so this is a label simplification, not a missing requirement."
      verdict: accepted
      verdict_at: 2026-06-24
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-24-query-link-resolver-design.md
result_check:
  verdict: OK
  plan_hash: 4541a8a362fd086c
  last_run: 2026-06-24
---

# Query Link Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the query pipeline from paying an extra LLM rewrite pass on every request to fix abbreviated WikiLinks, by resolving broken links deterministically and only falling back to an LLM under a zod contract.

**Architecture:** A new pure module `link-resolver.ts` maps a broken WikiLink stem to its canonical `wiki_*` page by id fragment (grouping a source note and its generated wiki page as one entity). `query.ts` calls it in place of the current LLM rewrite; a structured `QueryAnswerSchema` + `parseWithRetry` remain only as a rare fallback. The answer prompt is hardened with an explicit list of valid stems so the model rarely emits a broken link in the first place. Streaming stays hybrid (reasoning streamed live, final answer replaced after validation).

**Tech Stack:** TypeScript, esbuild (`npm run build` → `dist/main.js`), eslint, zod + zod-to-json-schema (existing `parse-with-retry.ts` engine), Obsidian plugin runtime, native-agent backend (deepseek-v4-flash via litellm).

---

## Global Constraints

**Read before any task:**

- **No test suites.** This project removed vitest/pytest on 2026-06-16 (see project memory). **Do NOT add test files or a test framework.** Verify pure functions with a throwaway `npx tsx -e '...'` snippet (run, observe, discard — never commit it). Verify integration with `npx tsc --noEmit`, `npm run build`, eslint, and a real `query` run on the `rtk-task` domain.
- **Branch:** all work on `dev/query-link-resolver` (already checked out). Never commit to `master`.
- **Surgical changes:** touch only the files named per task. Do not reformat or refactor adjacent code.
- **Build check after every code task:** `npx tsc --noEmit 2>&1 | grep "phases/<file>.ts" || echo "no new errors"`.
- **Reference log** for the real run: `/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl` (query session `1782282897749` is the baseline that showed `ValidateLinks 2 broken → FixingLinks fixed`).
- **Docs:** after the final task, update `docs/wiki/` via `iwiki:iwiki-ingest` for the changed sources and run `/iwiki-lint` (project post-task checklist).

---

### Task 1: `link-resolver.ts` — deterministic broken-link resolver

**Files:**
- Create: `src/phases/link-resolver.ts`

Pure module, no LLM, no imports from the rest of the pipeline. Implements spec §Components item 1 (entity grouping; `wiki_*` preference applied after grouping).

- [ ] **Step 1: Write the module**

Create `src/phases/link-resolver.ts` with exactly this content:

```ts
// Deterministic resolver for broken WikiLink stems emitted by the query answer.
// No LLM. Maps an abbreviated / mis-formatted stem (e.g. "DWM-88393") to its
// canonical wiki page stem (e.g. "wiki_rtk-task_dwm_88393") by id fragment.
//
// Entity grouping: a source note ("DWM-88393 ...") and its generated wiki page
// ("wiki_rtk-task_dwm_88393") share the same id and are ONE entity, not an
// ambiguity. Two DIFFERENT ids that share a digit substring are distinct
// entities -> ambiguous (we never guess).

export type ResolveResult =
  | { kind: "resolved"; stem: string }
  | { kind: "ambiguous" }
  | { kind: "unresolved" };

interface IdParts {
  prefix: string; // letters before the number, lowercased ("dwm", "dg", "" )
  digits: string; // the numeric run ("88393")
}

/** Extract the first id-like token: optional letter prefix + a run of >=2 digits. */
export function extractId(stem: string): IdParts | null {
  const m = stem.match(/([a-z]{1,8})?[-_ ]?(\d{2,})/i);
  if (!m) return null;
  return { prefix: (m[1] ?? "").toLowerCase(), digits: m[2] };
}

/** Canonical entity key for grouping: prefix + digits ("dwm88393", "88393"). */
function entityKey(p: IdParts): string {
  return `${p.prefix}${p.digits}`;
}

/**
 * Resolve a broken stem against candidate stems.
 * - candidates whose digits CONTAIN the broken digits and whose prefix is
 *   compatible (broken prefix empty, or equal) are matches.
 * - matches grouped by entityKey:
 *     1 distinct entity   -> resolved (prefer a `wiki_` candidate)
 *     >=2 distinct entity -> ambiguous
 *     0                   -> unresolved
 */
export function resolveLink(brokenStem: string, candidates: string[]): ResolveResult {
  const broken = extractId(brokenStem);
  if (!broken) return { kind: "unresolved" };

  const matches: { stem: string; key: string }[] = [];
  for (const cand of candidates) {
    const id = extractId(cand);
    if (!id) continue;
    const digitsOk = id.digits.includes(broken.digits);
    const prefixOk = broken.prefix === "" || broken.prefix === id.prefix;
    if (digitsOk && prefixOk) matches.push({ stem: cand, key: entityKey(id) });
  }

  if (matches.length === 0) return { kind: "unresolved" };

  const distinctKeys = new Set(matches.map((m) => m.key));
  if (distinctKeys.size > 1) return { kind: "ambiguous" };

  // Single entity: prefer the wiki_* representation, else the first match.
  const wiki = matches.find((m) => m.stem.startsWith("wiki_"));
  return { kind: "resolved", stem: (wiki ?? matches[0]).stem };
}
```

- [ ] **Step 2: Verify behavior with a throwaway snippet (do NOT commit it)**

Run:

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx tsx -e '
import { resolveLink } from "./src/phases/link-resolver";
const cands = ["wiki_rtk-task_dwm_88393", "DWM-88393 Реализация проверки", "wiki_rtk-task_dg_43", "wiki_x_88393", "wiki_y_188393"];
console.log("resolved:", JSON.stringify(resolveLink("DWM-88393", ["wiki_rtk-task_dwm_88393", "DWM-88393 Реализация проверки", "wiki_rtk-task_dg_43"])));
console.log("ambiguous:", JSON.stringify(resolveLink("88393", ["wiki_x_88393", "wiki_y_188393"])));
console.log("unresolved:", JSON.stringify(resolveLink("DWM-99999", cands)));
'
```

Expected output:

```
resolved: {"kind":"resolved","stem":"wiki_rtk-task_dwm_88393"}
ambiguous: {"kind":"ambiguous"}
unresolved: {"kind":"unresolved"}
```

If `npx tsx` is unavailable, compile-check instead: `npx tsc --noEmit 2>&1 | grep "link-resolver.ts" || echo "no errors"` and trace the three cases by hand.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "link-resolver.ts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 4: Lint**

Run: `npx eslint src/phases/link-resolver.ts`
Expected: clean (no output / exit 0)

- [ ] **Step 5: Commit**

```bash
git add src/phases/link-resolver.ts
git commit -m "feat(query): deterministic WikiLink resolver (no LLM)"
```

---

### Task 2: Wire resolver + structured diagnostics into `query.ts`

**Files:**
- Modify: `src/phases/query.ts` (imports line 21; the `ValidateLinks` / `FixingLinks` block, lines 214–264)

Implements spec §Components item 3 (orchestration) and §Diagnostics (structured `FixingLinks` preview). The deterministic resolver replaces `rewriteWithValidLinks` as the **primary** mechanism. The LLM fallback is added in Task 5 — here, anything the resolver cannot fix is stripped/annotated.

**Depends on:** Task 1.

- [ ] **Step 1: Add the resolver import**

In `src/phases/query.ts`, change line 21 from:

```ts
import { extractAnswerLinks, findBrokenLinks, annotateBroken, rewriteWithValidLinks } from "./query-link-validator";
```

to:

```ts
import { extractAnswerLinks, findBrokenLinks, annotateBroken } from "./query-link-validator";
import { resolveLink } from "./link-resolver";
```

(`rewriteWithValidLinks` is re-added to the import in Task 5.)

- [ ] **Step 2: Replace the validation block**

Replace the whole block at lines 229–263 (everything inside `if (!skipValidation) { ... }`, starting at `const links = extractAnswerLinks(answer);` and ending at the closing `}` before the `}` that closes `if (!skipValidation)`) with:

```ts
    if (!skipValidation) {
      const links = extractAnswerLinks(answer);
      const broken = findBrokenLinks(links, knownStems);
      yield {
        kind: "tool_result",
        ok: broken.length === 0,
        preview: broken.length === 0 ? "all valid" : `${broken.length} broken`,
      };

      if (broken.length > 0) {
        yield { kind: "tool_use", name: "FixingLinks", input: { broken: broken.length } };

        // Deterministic resolve first — no LLM.
        const candidates = [...new Set([...selectedIds, ...knownStems])];
        const resolvedPairs: string[] = [];
        const stripped: string[] = [];
        for (const b of broken) {
          const r = resolveLink(b, candidates);
          if (r.kind === "resolved" && r.stem !== b) {
            answer = answer.split(`[[${b}]]`).join(`[[${r.stem}]]`);
            resolvedPairs.push(`${b}→${r.stem}`);
          } else {
            stripped.push(b);
          }
        }

        // Anything not deterministically resolved is annotated (LLM fallback: Task 5).
        if (stripped.length > 0) answer = annotateBroken(answer, new Set(stripped));

        const parts: string[] = [];
        if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
        if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
        yield { kind: "tool_result", ok: stripped.length === 0, preview: parts.join("; ") };
        yield { kind: "assistant_replace", text: answer };
      }
    }
```

The surrounding `if (answer && !signal.aborted) { yield ValidateLinks; ... listFiles ... }` scaffold (lines 214–228) stays unchanged. `selectedIds` and `knownStems` are already in scope.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "phases/query.ts" || echo "no new errors"`
Expected: `no new errors` (note: `wikiLinkValidationRetries` param is now unused in this block — that is fine; it is reused in Task 5. `rewriteWithValidLinks` is no longer imported, so no unused-import error.)

- [ ] **Step 4: Lint**

Run: `npx eslint src/phases/query.ts`
Expected: clean. If eslint flags `wikiLinkValidationRetries` as unused, leave it — Task 5 consumes it; do not delete the parameter (it is positional in `runQuery`'s signature).

- [ ] **Step 5: Build + real run on `rtk-task`**

```bash
npm run build 2>&1 | tail -3
```

Then in Obsidian (or via the plugin's runner) ask the `rtk-task` domain the baseline question `Задачи в бэклоге и ожидании?`. Inspect the tail of the agent log:

```bash
grep '"FixingLinks"' "/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl" | tail -1
grep '"kind":"tool_result"' "/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl" | tail -3
```

Expected: a `tool_result` whose `preview` reads `resolved N (det): DWM-88393→wiki_rtk-task_dwm_88393, ...`, and **no** separate LLM call after it. Final `assistant_replace` text has no `*(not in wiki)*`.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts
git commit -m "feat(query): resolve broken links deterministically + structured FixingLinks log"
```

---

### Task 3: Prompt hardening — list valid stems in the answer prompt

**Files:**
- Modify: `prompts/query.md` (line 2 area)
- Modify: `src/phases/query.ts` (the `render(queryTemplate, {...})` call, lines 171–175)

Implements spec §Prompt hardening. Gives the model the exact valid stems so it copies instead of abbreviating, driving resolver frequency toward zero.

**Depends on:** Task 2.

- [ ] **Step 1: Add the placeholder to `prompts/query.md`**

In `prompts/query.md`, after line 2 (`Answer strictly based on the provided wiki pages. When referring to pages, use WikiLinks [[name]].`) insert a blank line and:

```text
{{available_links_block}}
```

So the head of the file becomes:

```text
You are an assistant for the wiki knowledge base of the domain "{{domain_name}}".
Answer strictly based on the provided wiki pages. When referring to pages, use WikiLinks [[name]].

{{available_links_block}}
{{entity_types_block}}
{{index_block}}
```

- [ ] **Step 2: Render the block in `query.ts`**

In `src/phases/query.ts`, immediately before the `const systemPrompt = render(queryTemplate, {` call (line 171), add:

```ts
  const wikiFirst = [...selectedIds].sort((a, b) =>
    Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
  const availableLinksBlock = wikiFirst.length === 0 ? "" : [
    "Valid WikiLink targets (use EXACTLY these, copy verbatim):",
    ...wikiFirst.map((s) => `- ${s}`),
    "ONLY link to a target from this list. Never invent or abbreviate stems.",
  ].join("\n");
```

Then add the key to the `render` call so it reads:

```ts
  const systemPrompt = render(queryTemplate, {
    domain_name: domain.name,
    available_links_block: availableLinksBlock,
    entity_types_block: entityTypesBlock,
    index_block: indexContent ? `\nWiki index (_index.md):\n${indexContent}` : "",
  });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "phases/query.ts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 4: Lint**

Run: `npx eslint src/phases/query.ts`
Expected: clean

- [ ] **Step 5: Build + real run**

```bash
npm run build 2>&1 | tail -3
```

Re-ask `Задачи в бэклоге и ожидании?` on `rtk-task`. Inspect:

```bash
grep '"ValidateLinks"' "/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl" | tail -1
grep '"tool_result"' "/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl" | tail -2
```

Expected: `ValidateLinks` now frequently reports `all valid` (0 broken) — the model copied valid stems. If still broken, the resolver from Task 2 still fixes them; either is acceptable.

- [ ] **Step 6: Commit**

```bash
git add prompts/query.md src/phases/query.ts
git commit -m "feat(query): list valid WikiLink stems in answer prompt"
```

---

### Task 4: `QueryAnswerSchema` in `zod-schemas.ts`

**Files:**
- Modify: `src/phases/zod-schemas.ts` (append a new schema)

Implements spec §Components item 2. The schema is consumed by the fallback in Task 5. Defining it as its own task keeps the type contract reviewable before wiring.

**Depends on:** Task 1.

- [ ] **Step 1: Append the schema**

At the end of `src/phases/zod-schemas.ts`, add:

```ts
/**
 * Structured fallback contract for the query answer when deterministic link
 * resolution leaves unresolved stems. `citations` must all be known vault stems;
 * the closure-checked refinement is applied by the caller (parseWithRetry feeds
 * `knownStems` via a factory, mirroring existing WikiLink refinements).
 */
export function makeQueryAnswerSchema(knownStems: Set<string>) {
  return z.object({
    reasoning: z.string(),
    answer_markdown: z.string().min(1),
    citations: z.array(z.string()).default([]),
  }).superRefine((val, ctx) => {
    for (const c of val.citations) {
      if (!knownStems.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["citations"],
          message: `citation "${c}" is not a known wiki page stem`,
        });
      }
    }
  });
}

export type QueryAnswer = z.infer<ReturnType<typeof makeQueryAnswerSchema>>;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "zod-schemas.ts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 3: Lint**

Run: `npx eslint src/phases/zod-schemas.ts`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/phases/zod-schemas.ts
git commit -m "feat(query): QueryAnswerSchema for structured fallback"
```

---

### Task 5: Structured LLM fallback for unresolved links

**Files:**
- Modify: `src/phases/parse-with-retry.ts` (add `"query.answer"` to the `CallSite` union, line ~15-22)
- Modify: `src/phases/query.ts` (imports; the `stripped.length > 0` branch from Task 2)

Implements spec §Components item 3 fallback path. When the deterministic resolver cannot fix a stem and `wikiLinkValidationRetries > 0`, route through `parseWithRetry(makeQueryAnswerSchema(...))` — one LLM call with a zod feedback loop — before falling back to annotation.

**Depends on:** Task 2, Task 4.

- [ ] **Step 1: Add the CallSite**

In `src/phases/parse-with-retry.ts`, extend the `CallSite` union (line ~15) so the `"query.seeds"` line becomes:

```ts
  | "query.seeds" | "query.answer"
```

- [ ] **Step 2: Add imports to `query.ts`**

In `src/phases/query.ts`, add to the existing `parse-with-retry` and `zod-schemas` imports (lines 6–7):

```ts
import { parseWithRetry } from "./parse-with-retry";
import { SeedsSchema, makeQueryAnswerSchema } from "./zod-schemas";
```

and re-add `rewriteWithValidLinks` is **not** needed — the fallback uses `parseWithRetry`, not the old rewrite. Leave the Task 2 import line as-is.

- [ ] **Step 3: Replace the annotation branch with the structured fallback**

In the block from Task 2, replace this part:

```ts
        // Anything not deterministically resolved is annotated (LLM fallback: Task 5).
        if (stripped.length > 0) answer = annotateBroken(answer, new Set(stripped));
```

with:

```ts
        // Unresolved stems → one structured LLM repair pass (zod-validated), then annotate.
        let llmFixed = 0;
        if (stripped.length > 0 && wikiLinkValidationRetries > 0) {
          const validList = [...new Set([...selectedIds, ...knownStems])]
            .filter((s) => s.startsWith("wiki_")).join(", ");
          const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content:
              `Rewrite the answer so every WikiLink points to a valid stem. ` +
              `Broken stems: ${stripped.join(", ")}. Valid stems: ${validList}. ` +
              `Return JSON {reasoning, answer_markdown, citations}.` },
            { role: "user", content: `Question: ${question}\n\nAnswer to fix:\n${answer}` },
          ];
          try {
            const r = await parseWithRetry({
              llm, model, baseMessages,
              opts: { ...opts, jsonMode: "json_object", thinkingBudgetTokens: undefined },
              schema: makeQueryAnswerSchema(knownStems),
              maxRetries: wikiLinkValidationRetries,
              callSite: "query.answer",
              signal,
              onEvent: () => {},
            });
            outputTokens += r.outputTokens;
            const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
            if (stillBroken.length === 0) {
              answer = r.value.answer_markdown;
              llmFixed = stripped.length;
              stripped.length = 0;
            }
          } catch (e) {
            if (signal.aborted || (e as Error).name === "AbortError") return;
            // fall through to annotation
          }
        }
        if (stripped.length > 0) answer = annotateBroken(answer, new Set(stripped));
```

Then extend the diagnostics `parts` assembly (added in Task 2) to report the LLM outcome — change:

```ts
        const parts: string[] = [];
        if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
        if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
```

to:

```ts
        const parts: string[] = [];
        if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
        if (llmFixed) parts.push(`llm-fixed ${llmFixed}`);
        if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
```

(`llmFixed` is declared inside the `if (broken.length > 0)` block before `parts`, so it is in scope. If the type-checker reports `llmFixed` used before assignment, move its `let llmFixed = 0;` declaration to the top of the `if (broken.length > 0)` block.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "phases/(query|parse-with-retry).ts" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 5: Lint**

Run: `npx eslint src/phases/query.ts src/phases/parse-with-retry.ts`
Expected: clean

- [ ] **Step 6: Build + negative real run**

```bash
npm run build 2>&1 | tail -3
```

Ask `rtk-task` a question that forces a reference to a non-existent page (e.g. `Расскажи про задачу DWM-00000`). Inspect:

```bash
grep '"tool_result"' "/home/altuser/Документы/Project/notes/vaults/Work/!Wiki/_config/_agent.jsonl" | tail -2
```

Expected: preview shows `llm-fixed N` or `annotated N`; the final answer contains no raw broken `[[DWM-00000]]` — either repaired or marked `*(not in wiki)*`. Set the domain's `wikiLinkValidationRetries` to `0` and confirm the same question now yields `annotated N` with **no** extra LLM call.

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts src/phases/parse-with-retry.ts
git commit -m "feat(query): zod-validated LLM fallback for unresolved links"
```

---

### Task 6: Final verification + docs

**Files:**
- No code changes. Build artifact `dist/main.js`, `docs/wiki/`.

**Depends on:** Tasks 1–5.

- [ ] **Step 1: Full type-check + lint**

```bash
npx tsc --noEmit 2>&1 | tail -5
npx eslint src/phases/link-resolver.ts src/phases/query.ts src/phases/zod-schemas.ts src/phases/parse-with-retry.ts
```

Expected: no new errors; eslint clean.

- [ ] **Step 2: Full build**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds, `dist/main.js` regenerated.

- [ ] **Step 3: End-to-end on `rtk-task`**

Re-run the baseline question `Задачи в бэклоге и ожидании?`. Confirm in the agent log:
- `ValidateLinks` → `all valid` OR `resolved N (det)` with no `llm-fixed`,
- final answer links all valid, no `*(not in wiki)*`,
- compared to the baseline session `1782282897749`, **no** per-query LLM rewrite round-trip in the common case.

- [ ] **Step 4: Update wiki docs**

```bash
# from the project root, via the iwiki skill (not a raw CLI guess)
```

Invoke `iwiki:iwiki-ingest` for `src/phases/query.ts` and `src/phases/link-resolver.ts` (operations/architecture pages), then run `/iwiki-lint`. Expected: no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 5: Commit the rebuilt dist + docs**

```bash
git add dist/main.js docs/wiki/
git commit -m "build: rebuild dist + wiki docs for query link resolver"
```

---

## Notes / deviations from spec

- **No TDD test files.** The spec's verification section and project policy (memory: tests removed 2026-06-16) mean correctness is checked via `tsc`/eslint/build/real runs and a throwaway `npx tsx` snippet for the pure resolver — not committed test suites. This deviates from the writing-plans default TDD template, intentionally.
- **Spec Phase 0 (diagnostics) is merged into Task 2, not a standalone first task.** The spec wanted diagnostics to land first to confirm the broken-form pattern on real data. In practice the structured `FixingLinks` preview and the resolver live in the *same* `query.ts` block (lines 229–263): the broken form is surfaced precisely as `b` in the `b→stem` pairs the resolver emits, so a diagnostics-only pre-edit would be thrown away when Task 2 rewrites the block. The pattern is instead confirmed at **Task 2 Step 5** (the real `rtk-task` run) *before* Tasks 3 and 5 build on it — if the run shows `annotated` instead of `resolved N (det)`, `extractId`'s normalization is adjusted then, preserving the spec's risk-reduction intent without a discarded phase. The pure resolver module (Task 1) has no behavioral dependency on diagnostics, so creating it first is safe.
- **`extractId` matching is substring-on-digits.** Spec §Verification step 4 frames ambiguity as a digit fragment "contained in" two pages; the implementation matches when the broken digits are a substring of a candidate's digits, then groups by `prefix+digits`. This makes `88393` vs `188393` two distinct entities → `ambiguous`, while a source note + its `wiki_*` page collapse to one → `resolved`, exactly as the spec requires.
- **Resolver candidate pool** = `selectedIds ∪ knownStems` (context first, whole vault as backstop), matching spec §Components ("context stems ∪ knownStems, with `wiki_*` preferred"). `wiki_*` preference is applied after entity grouping (Task 1 Step 1), never collapsing distinct entities.
- **`rewriteWithValidLinks` is retired** as the primary mechanism (Task 2 drops its import) and is **not** reused by the fallback (Task 5 uses `parseWithRetry` instead). The function may remain in `query-link-validator.ts` as dead code; per project rules we do not delete pre-existing code beyond our own orphans — flagged here for the reviewer.
