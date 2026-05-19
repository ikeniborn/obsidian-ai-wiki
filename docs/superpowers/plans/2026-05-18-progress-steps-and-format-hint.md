---
title: Progress step labels + backend-specific format hint
date: 2026-05-18
review:
  plan_hash: a8fd630994b3c6b1
  spec_hash: 20842b94da0549ea
  last_run: "2026-05-18"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    task1: cad8ee1eb95dd23b
    task2: 2b647c6177d60b43
    task3: 0d126cf678033266
    task4: eb1790132f68b87d
    task5: faef99ee103a2603
    task6: 16c605dec16d1e8c
  findings:
    - id: F-001
      severity: WARNING
      verdict: fixed
      section: task4
      section_hash: eb1790132f68b87d
      text: "Step 4 expected output corrected — now says 'may fail... proceed to Step 5'"
    - id: F-002
      severity: WARNING
      verdict: fixed
      section: task6
      section_hash: 16c605dec16d1e8c
      text: "Step 1 now has concrete node command for version bump with expected output"
---

# Progress Step Labels + Backend Format Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two UX fixes — show backend-specific truncation hint in format errors, and add named headers to reasoning/assistant blocks in the progress panel.

**Architecture:** Fix 1 touches only `format.ts` + `agent-runner.ts` (pass `backend` param, replace 2 error strings). Fix 2 touches only `view.ts` + `i18n.ts` (wrap icon+text in `ai-wiki-step-head` div, add 2 i18n keys). Fixes are independent; each gets its own commit.

**Tech Stack:** TypeScript, Vitest, Obsidian API (DOM), esbuild

---

## File Map

| File | Changes |
|---|---|
| `src/phases/format.ts` | Add `backend` param + `truncationHint()` helper + replace 2 error strings |
| `src/agent-runner.ts` | Pass `this.settings.backend` as last arg to `runFormat` |
| `src/i18n.ts` | Add `analysing` + `formingResponse` to EN, RU, ES `view` sections |
| `src/view.ts` | Wrap reasoning + assistant blocks in `ai-wiki-step-head` div |
| `tests/phases/format.test.ts` | Add 2 tests: backend-specific hint in truncation error |

---

## Task 1: Write failing tests for backend-specific truncation hint

**Files:**
- Modify: `tests/phases/format.test.ts`

- [ ] **Step 1: Add `makeLlmTruncated` helper after existing `makeLlmSequence`**

```typescript
function makeLlmTruncated(): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "not json {" }, finish_reason: "length" }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}
```

- [ ] **Step 2: Add two new test cases inside `describe("runFormat", ...)`**

```typescript
it("truncation error — claude-agent hint", async () => {
  const adapter = mockAdapter({ [FILE]: SAMPLE });
  const vt = new VaultTools(adapter, VAULT);
  const events = await collect(
    runFormat([FILE], vt, makeLlmTruncated(), "model", false, [], new AbortController().signal, {}, "claude-agent"),
  );
  const err = events.find((e: unknown) => (e as { kind: string }).kind === "error") as { message: string } | undefined;
  expect(err).toBeDefined();
  expect(err!.message).toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
  expect(err!.message).not.toContain("Settings →");
});

it("truncation error — native-agent hint", async () => {
  const adapter = mockAdapter({ [FILE]: SAMPLE });
  const vt = new VaultTools(adapter, VAULT);
  const events = await collect(
    runFormat([FILE], vt, makeLlmTruncated(), "model", false, [], new AbortController().signal, {}, "native-agent"),
  );
  const err = events.find((e: unknown) => (e as { kind: string }).kind === "error") as { message: string } | undefined;
  expect(err).toBeDefined();
  expect(err!.message).toContain("Settings →");
  expect(err!.message).not.toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: FAIL — `runFormat` doesn't accept 9th argument yet, TypeScript error or wrong message content.

---

## Task 2: Implement `backend` param in `format.ts`

**Files:**
- Modify: `src/phases/format.ts:20-29` (signature), `src/phases/format.ts:122` (first error), `src/phases/format.ts:141` (second error)

- [ ] **Step 1: Add `truncationHint` helper and `backend` param to signature**

Find the existing signature at line 20:
```typescript
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
```

Replace with:
```typescript
function truncationHint(backend: "claude-agent" | "native-agent"): string {
  return backend === "claude-agent"
    ? "увеличьте лимит: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh"
    : "увеличьте лимит: Settings → per-operation → format → maxTokens";
}

export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Replace first error string (line ~122)**

Find:
```typescript
yield { kind: "error", message: "Format: ответ обрезан по лимиту вывода модели — сократите страницу или увеличьте лимит (claude-agent: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh; native-agent: Settings → per-operation → format → maxTokens)" };
```

Replace with:
```typescript
yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };
```

- [ ] **Step 3: Replace second error string (line ~141)**

Find:
```typescript
      ? "Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или увеличьте лимит (claude-agent: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh; native-agent: Settings → per-operation → format → maxTokens)"
```

Replace with:
```typescript
      ? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
```

- [ ] **Step 4: Run tests — verify truncation tests pass, existing tests unbroken**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: All PASS. Existing tests work because `backend` defaults to `"native-agent"`.

---

## Task 3: Pass `backend` in `agent-runner.ts`

**Files:**
- Modify: `src/agent-runner.ts:106`

- [ ] **Step 1: Update the `runFormat` call**

Find (line 106):
```typescript
        yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts);
```

Replace with:
```typescript
        yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend);
```

- [ ] **Step 2: Run all tests — verify no regressions**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 3: Commit Fix 1**

```bash
git add src/phases/format.ts src/agent-runner.ts tests/phases/format.test.ts
git commit -m "fix(format): backend-specific truncation hint in error message"
```

---

## Task 4: Add `analysing` + `formingResponse` to i18n

**Files:**
- Modify: `src/i18n.ts`

The `view` section in EN locale starts around line 87. Add after `mobileWaiting` key in each locale.

- [ ] **Step 1: Add keys to EN locale `view` section**

Find in EN locale (after `mobileWaiting: "⏳ Waiting for LLM response…",`):
```typescript
    mobileWaiting: "⏳ Waiting for LLM response…",
```

Replace with:
```typescript
    mobileWaiting: "⏳ Waiting for LLM response…",
    analysing: "Analysing…",
    formingResponse: "Forming response…",
```

- [ ] **Step 2: Add keys to RU locale `view` section**

Find in RU locale (after `mobileWaiting: "⏳ Ожидание ответа от LLM…",`):
```typescript
    mobileWaiting: "⏳ Ожидание ответа от LLM…",
```

Replace with:
```typescript
    mobileWaiting: "⏳ Ожидание ответа от LLM…",
    analysing: "Анализирует…",
    formingResponse: "Формирует ответ…",
```

- [ ] **Step 3: Add keys to ES locale `view` section**

Find in ES locale (after `mobileWaiting: "⏳ Esperando respuesta del LLM…",`):
```typescript
    mobileWaiting: "⏳ Esperando respuesta del LLM…",
```

Replace with:
```typescript
    mobileWaiting: "⏳ Esperando respuesta del LLM…",
    analysing: "Analizando…",
    formingResponse: "Formando respuesta…",
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: may fail with `Property 'analysing' does not exist` if the `I18n` interface lacks the new keys — that is expected here, proceed to Step 5 to fix it. If it passes already, skip Step 5.

- [ ] **Step 5: Check if `I18n` interface declares `view` keys — update if needed**

```bash
grep -n "analysing\|formingResponse\|view\s*{" src/i18n.ts | head -20
```

If the `view` section in the `I18n` type/interface does NOT include `analysing`/`formingResponse`, add them there too:
```typescript
    analysing: string;
    formingResponse: string;
```

- [ ] **Step 6: Re-run tsc to confirm no errors**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

## Task 5: Add step labels in `view.ts`

**Files:**
- Modify: `src/view.ts:524-529` (reasoning block), `src/view.ts:542-544` (assistant block)

- [ ] **Step 1: Restructure reasoning block creation**

Find (lines 524-529):
```typescript
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          this.reasoningBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
          this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
```

Replace with:
```typescript
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
          rHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
          rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.analysing);
          this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
```

- [ ] **Step 2: Restructure assistant block creation**

Find (lines 542-544):
```typescript
          this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
          this.assistantBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
          this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
```

Replace with:
```typescript
          this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
          const aHead = this.assistantBlock.createDiv("ai-wiki-step-head");
          aHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
          aHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.formingResponse);
          this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 5: Commit Fix 2**

```bash
git add src/view.ts src/i18n.ts
git commit -m "feat(view): add step labels for reasoning and assistant blocks"
```

---

## Task 6: Build and verify

- [ ] **Step 1: Bump patch version**

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const [maj,min,pat] = pkg.version.split('.').map(Number);
const next = \`\${maj}.\${min}.\${pat+1}\`;
pkg.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
const mf = JSON.parse(fs.readFileSync('src/manifest.json','utf8'));
mf.version = next;
fs.writeFileSync('src/manifest.json', JSON.stringify(mf, null, '\t') + '\n');
console.log('version:', next);
"
```

Expected: prints `version: X.Y.(Z+1)`, both files updated.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Build succeeds, `dist/main.js` updated, no errors.

- [ ] **Step 3: Commit build**

```bash
git add dist/main.js dist/styles.css package.json src/manifest.json
git commit -m "chore: build v<new-version>"
```
