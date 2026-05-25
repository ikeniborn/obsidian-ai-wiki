# Fix evaluator + base.md Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale correction note from `docs/prompt-architecture.md` and add proper architecture section to `lat.md/llm-pipeline.md` documenting the evaluator's unique prompt pattern.

**Architecture:** Two targeted doc-only edits. No code changes. Both changes clean up existing documentation — one removes redundant/misleading content, one adds missing architectural context.

**Tech Stack:** Markdown, lat.md

---

## File Map

| File | Action |
|------|--------|
| `docs/prompt-architecture.md` | Remove section `### evaluator + base.md — не изолирован` from `## Замечания для архитектурного анализа` |
| `lat.md/llm-pipeline.md` | Add section `## Evaluator Prompt Pattern` after `## buildChatParams` |

---

### Task 1: Remove stale correction note from prompt-architecture.md

**Files:**
- Modify: `docs/prompt-architecture.md` — section `### evaluator + base.md — не изолирован` (lines 318–320)

- [ ] **Step 1: Verify section to remove**

Open `docs/prompt-architecture.md` and confirm the section looks like:

```markdown
### evaluator + base.md — не изолирован

Старый комментарий "base.md не применяется к evaluator" — неверен. `buildChatParams` вызывается в `evaluator.ts` с messages без system-сообщения, поэтому `prependBaseContract` создаёт `system = base.md`. `evaluator.md` при этом идёт в `user` роль — это уникально, но base.md всё равно присутствует в запросе.
```

- [ ] **Step 2: Remove the section**

Delete the entire `### evaluator + base.md — не изолирован` subsection (heading + body paragraph). Leave the next subsection `### wrapWithJsonFallback` intact.

Result after edit — `## Замечания для архитектурного анализа` should start directly with:

```markdown
## Замечания для архитектурного анализа

### wrapWithJsonFallback — прозрачный retry без json_object
```

- [ ] **Step 3: Commit**

```bash
git add docs/prompt-architecture.md
git commit -m "docs: remove stale evaluator+base.md correction note from prompt-architecture"
```

---

### Task 2: Add Evaluator Prompt Pattern section to lat.md/llm-pipeline.md

**Files:**
- Modify: `lat.md/llm-pipeline.md` — insert new section after `## buildChatParams`

- [ ] **Step 1: Add new section after `## buildChatParams`**

In `lat.md/llm-pipeline.md`, after the `## buildChatParams` section (after the `See [[src/phases/llm-utils.ts#buildChatParams]].` line), insert:

```markdown
## Evaluator Prompt Pattern

Only phase that sends no system message to `buildChatParams`. `prependBaseContract`
creates `system = base.md` from scratch. The evaluator prompt (`evaluator.md`) renders
into user role — unlike all other phases where the phase prompt is the system message.

See [[src/phases/evaluator.ts#runEvaluator]].
```

The file should now have sections in this order:
1. `## buildChatParams`
2. `## Evaluator Prompt Pattern`  ← new
3. `## parseWithRetry`
4. `### Call Sites`
5. `## wrapWithJsonFallback`
6. `## Structural Error Counter`
7. `## Streaming`

- [ ] **Step 2: Commit**

```bash
git add lat.md/llm-pipeline.md
git commit -m "docs(lat): add Evaluator Prompt Pattern section to llm-pipeline"
```

---

### Task 3: Verify with lat check

**Files:** none (verification only)

- [ ] **Step 1: Run lat check**

```bash
lat check
```

Expected: all checks pass, including the new `[[src/phases/evaluator.ts#runEvaluator]]` wiki link.

If `lat check` reports an error on the new wiki link, verify the exact function name:

```bash
grep -n "runEvaluator" src/phases/evaluator.ts
```

Fix the wiki link to match the actual export name if needed.

- [ ] **Step 2: Final commit if any fixes were needed**

```bash
git add lat.md/llm-pipeline.md
git commit -m "docs(lat): fix wiki link in Evaluator Prompt Pattern section"
```
