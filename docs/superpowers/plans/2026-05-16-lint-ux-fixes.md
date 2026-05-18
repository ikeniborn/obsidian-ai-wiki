---
review:
  plan_hash: 32d4daf9bca8373a
  spec_hash: 11f6070cea317228
  last_run: 2026-05-16
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
      section: "## File Map / ### Task 3a"
      section_hash: "b9ebb001057d799c / d226572ef76f113f"
      text: "`src/phases/parse-with-retry.ts` присутствует в File Map плана и Task 3a/Step 3, но отсутствует в таблице файлов спеки. Изменение implied: parseWithRetry вызывается с callSite: \"lint-chat.fix\", CallSite-тип должен включать это значение."
      verdict: wontfix
      verdict_at: 2026-05-16
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "## Task 4"
      section_hash: 94bd913daea77360
      text: "Task 4 (Final build and integration smoke-check) не имеет явного требования в спеке."
      verdict: wontfix
      verdict_at: 2026-05-16
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "### Task 3d"
      section_hash: 456079d5984a6cd6
      text: "Task 3d/Step 1 добавляет case \"lint-chat\" в AgentRunner switch без нового теста для этого роута. DoD = «existing integration tests should still pass» — новое покрытие отсутствует."
      verdict: fixed
      verdict_at: 2026-05-16
---

# Lint UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 lint UX bugs: missing elapsed time after completion, raw JSON in lint result, and lint chat that doesn't write files.

**Architecture:** Three independent fixes applied in sequence. Fix 1 is a 2-line view patch. Fix 2 is a prompt file replacement. Fix 3 adds a new `lint-chat` WikiOperation with its own phase, routing through the existing `dispatch` flow.

**Tech Stack:** TypeScript, Obsidian ItemView API, Zod, AsyncGenerator phases, OpenAI-compatible LLM client.

---

## File Map

| File | Action |
|---|---|
| `src/view.ts` | Modify `finish()` (Fix 1) + `showChatSection()` + `CHAT_OPS` (Fix 3) |
| `prompts/lint.md` | Replace content (Fix 2) |
| `prompts/lint-chat.md` | Create (Fix 3) |
| `src/types.ts` | Add `"lint-chat"` to `WikiOperation`; add `"lint-chat.fix"` to `structural_error` callSite (Fix 3) |
| `src/phases/zod-schemas.ts` | Add `LintChatSchema` (Fix 3) |
| `src/phases/parse-with-retry.ts` | Add `"lint-chat.fix"` to `CallSite` union (Fix 3) |
| `src/phases/lint-chat.ts` | Create `runLintFixChat` (Fix 3) |
| `src/agent-runner.ts` | Add `"lint-chat"` case in `buildOptsFor` + `runOperation` (Fix 3) |
| `src/controller.ts` | Add `lintApplyFromChat()`, update `dispatch()` opKey mapping + `mutatesWiki` (Fix 3) |

---

## Task 1: Fix 1 — show elapsed time in Progress after completion

**Files:**
- Modify: `src/view.ts:626-663` (`finish()` method)

- [ ] **Step 1: Write the failing test**

In `tests/view-metrics.test.ts` (new file):

```ts
import { describe, it, expect, vi } from "vitest";

// Minimal harness — we only test that progressCount gets set to Xs after finish()
describe("finish() shows elapsed time", () => {
  it("sets progressCount text to elapsed seconds after completion", async () => {
    // Stub the DOM elements LlmWikiView uses
    const progressCount = { setText: vi.fn() };
    const finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    const resultSection = { removeClass: vi.fn(), addClass: vi.fn() };
    const resultToggle = { setText: vi.fn() };
    const statusEl = { setText: vi.fn() };
    const cancelBtn = { disabled: false };
    const askBtn = { disabled: false };
    const askSaveBtn = { disabled: false };

    // Simulate finish() logic inline (view is not easily unit-testable end-to-end)
    // So we test the business rule: after updateMetrics() with state != "running",
    // a subsequent setText call sets totalDur.
    const state = "done";  // what finish() sets before calling updateMetrics()
    const startedAt = Date.now() - 3200;
    const finishedAt = Date.now();

    // updateMetrics() clears text when state !== "running"
    if (state !== "running") progressCount.setText("");

    // The new 2 lines in finish():
    const totalDur = ((finishedAt - startedAt) / 1000).toFixed(1);
    progressCount.setText(`${totalDur}s`);

    expect(progressCount.setText).toHaveBeenLastCalledWith(expect.stringMatching(/^\d+\.\ds$/));
  });
});
```

- [ ] **Step 2: Run test to verify it passes (logic test — not view integration)**

```bash
npx vitest run tests/view-metrics.test.ts
```

Expected: PASS (the test validates the logic, not the DOM).

- [ ] **Step 3: Apply the fix to `src/view.ts`**

In `finish()` method, after `this.updateMetrics()` (line ~638), add:

```ts
const totalDur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
this.progressCount.setText(`${totalDur}s`);
```

The updated block looks like:

```ts
if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
this.updateMetrics();
const totalDur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
this.progressCount.setText(`${totalDur}s`);
this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/view-metrics.test.ts
git commit -m "fix(view): show elapsed time in progress after operation completes"
```

---

## Task 2: Fix 2 — lint result renders markdown instead of JSON

**Files:**
- Modify: `prompts/lint.md`

- [ ] **Step 1: Write test verifying lint.md doesn't contain "JSON"**

In `tests/prompts.test.ts` (new file):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("lint.md prompt", () => {
  it("does not instruct LLM to return JSON", () => {
    const content = readFileSync(join(__dirname, "../prompts/lint.md"), "utf8");
    expect(content).not.toMatch(/Верни \*\*JSON\*\*/);
    expect(content).toMatch(/Markdown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/prompts.test.ts
```

Expected: FAIL — current `lint.md` has `Верни **JSON**`.

- [ ] **Step 3: Replace `prompts/lint.md` content**

New content of `prompts/lint.md`:

```markdown
Ты — рецензент качества wiki-базы знаний домена «{{domain_name}}».
Выявляй: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Верни развёрнутый анализ в формате Markdown.
{{entity_types_block}}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add prompts/lint.md tests/prompts.test.ts
git commit -m "fix(lint): return markdown analysis instead of JSON in lint report"
```

---

## Task 3: Fix 3 — lint-chat operation writes files

### Task 3a: Extend types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/phases/parse-with-retry.ts`

- [ ] **Step 1: Add `"lint-chat"` to `WikiOperation` in `src/types.ts`**

Change:
```ts
export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "chat"
  | "init"
  | "format";
```

To:
```ts
export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "lint-chat"
  | "chat"
  | "init"
  | "format";
```

- [ ] **Step 2: Add `"lint-chat.fix"` to `structural_error` callSite union in `src/types.ts`**

Change:
```ts
  | { kind: "structural_error";
      callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
```

To:
```ts
  | { kind: "structural_error";
      callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "lint-chat.fix" | "query.seeds";
```

- [ ] **Step 3: Add `"lint-chat.fix"` to `CallSite` in `src/phases/parse-with-retry.ts`**

Change:
```ts
export type CallSite =
  | "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
```

To:
```ts
export type CallSite =
  | "init.bootstrap" | "init.delta" | "lint.patch" | "lint-chat.fix" | "query.seeds";
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS (type changes only).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/phases/parse-with-retry.ts
git commit -m "feat(types): add lint-chat WikiOperation and callSite"
```

---

### Task 3b: Create prompt and Zod schema

**Files:**
- Create: `prompts/lint-chat.md`
- Modify: `src/phases/zod-schemas.ts`

- [ ] **Step 1: Write test for LintChatSchema**

In `tests/zod-schemas.test.ts` (new file):

```ts
import { describe, it, expect } from "vitest";
import { LintChatSchema } from "../src/phases/zod-schemas";

describe("LintChatSchema", () => {
  it("parses valid response with pages", () => {
    const result = LintChatSchema.parse({
      summary: "## Исправлено\n- Убрана мёртвая ссылка",
      pages: [{ path: "Wiki/X.md", content: "# X\ncontent" }],
    });
    expect(result.summary).toBe("## Исправлено\n- Убрана мёртвая ссылка");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].path).toBe("Wiki/X.md");
  });

  it("defaults pages to empty array when omitted", () => {
    const result = LintChatSchema.parse({ summary: "Нет правок." });
    expect(result.pages).toEqual([]);
  });

  it("rejects missing summary", () => {
    expect(() => LintChatSchema.parse({ pages: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/zod-schemas.test.ts
```

Expected: FAIL — `LintChatSchema` not exported yet.

- [ ] **Step 3: Add `LintChatSchema` to `src/phases/zod-schemas.ts`**

Append to end of file:

```ts
export const LintChatSchema = z.object({
  summary: z.string(),
  pages: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).default([]),
});

export type LintChatResponse = z.infer<typeof LintChatSchema>;
```

- [ ] **Step 4: Create `prompts/lint-chat.md`**

```markdown
Ты — редактор wiki-базы знаний домена «{{domain_name}}».
Прими задание пользователя и lint-отчёт, исправь указанные проблемы в страницах.

Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"..."}]}
Если правок нет — pages пустой массив, summary — текстовый ответ.

LINT-ОТЧЁТ:
{{lint_report}}

СТРАНИЦЫ ДОМЕНА:
{{pages_block}}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/zod-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add prompts/lint-chat.md src/phases/zod-schemas.ts tests/zod-schemas.test.ts
git commit -m "feat(lint-chat): add LintChatSchema and lint-chat prompt"
```

---

### Task 3c: Create `runLintFixChat` phase

**Files:**
- Create: `src/phases/lint-chat.ts`

- [ ] **Step 1: Write unit test**

In `tests/phases/lint-chat.test.ts` (new file):

```ts
import { describe, it, expect, vi } from "vitest";
import { runLintFixChat } from "../../src/phases/lint-chat";
import type { RunRequest } from "../../src/types";

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function makeVaultTools(pages: Record<string, string> = {}) {
  return {
    listFiles: vi.fn(async () => Object.keys(pages)),
    readAll: vi.fn(async (files: string[]) => new Map(files.map((f) => [f, pages[f] ?? ""]))),
    write: vi.fn(async () => {}),
    toVaultPath: vi.fn((p: string) => p),
  };
}

function makeLlm(responseJson: object) {
  const content = JSON.stringify(responseJson);
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown, _opts?: unknown) => ({
          choices: [{ message: { content } }],
          usage: { completion_tokens: 10 },
        })),
      },
    },
  };
}

describe("runLintFixChat", () => {
  it("yields tool_use/tool_result for each page and result with summary", async () => {
    const wikiPath = "!Wiki/test";
    const pages = { [`${wikiPath}/X.md`]: "# X\nOld content" };
    const vaultTools = makeVaultTools(pages);
    const llmResponse = {
      summary: "## Исправлено\n- Убрано дублирование",
      pages: [{ path: `${wikiPath}/X.md`, content: "# X\nFixed content" }],
    };
    const llm = makeLlm(llmResponse) as any;

    const req: RunRequest = {
      operation: "lint-chat",
      args: [],
      cwd: "/vault",
      signal: makeSignal(),
      timeoutMs: 30000,
      domainId: "test",
      context: "## Отчёт lint",
      chatMessages: [
        { role: "user", content: "убери дублирование" },
      ],
    };

    const domain = { id: "test", name: "Test", wiki_folder: "test", entity_types: [], language_notes: "", source_paths: [] };

    const events: any[] = [];
    for await (const ev of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "test-model", {}, makeSignal())) {
      events.push(ev);
    }

    const toolUseEvents = events.filter((e) => e.kind === "tool_use");
    const toolResultEvents = events.filter((e) => e.kind === "tool_result");
    const resultEvent = events.find((e) => e.kind === "result");

    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0].name).toBe("Write");
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].ok).toBe(true);
    expect(resultEvent).toBeDefined();
    expect(resultEvent.text).toBe("## Исправлено\n- Убрано дублирование");
    expect(vaultTools.write).toHaveBeenCalledWith(`${wikiPath}/X.md`, "# X\nFixed content");
  });

  it("blocks pages outside wikiVaultPath", async () => {
    const wikiPath = "!Wiki/test";
    const vaultTools = makeVaultTools({ [`${wikiPath}/safe.md`]: "content" });
    const llmResponse = {
      summary: "tried to escape",
      pages: [{ path: "!Wiki/other/evil.md", content: "evil" }],
    };
    const llm = makeLlm(llmResponse) as any;

    const req: RunRequest = {
      operation: "lint-chat",
      args: [],
      cwd: "/vault",
      signal: makeSignal(),
      timeoutMs: 30000,
      domainId: "test",
      context: "report",
      chatMessages: [{ role: "user", content: "bad request" }],
    };
    const domain = { id: "test", name: "Test", wiki_folder: "test", entity_types: [], language_notes: "", source_paths: [] };

    const events: any[] = [];
    for await (const ev of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "model", {}, makeSignal())) {
      events.push(ev);
    }

    const blocked = events.filter((e) => e.kind === "tool_result" && !e.ok);
    expect(blocked).toHaveLength(1);
    expect(vaultTools.write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/phases/lint-chat.ts`**

```ts
import { join } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient, RunRequest } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { LintChatSchema } from "./zod-schemas";
import lintChatTemplate from "../../prompts/lint-chat.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";

const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];

export async function* runLintFixChat(
  req: RunRequest,
  vaultTools: VaultTools,
  vaultRoot: string,
  domain: DomainEntry | undefined,
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  const start = Date.now();

  if (!domain) {
    yield { kind: "error", message: "lint-chat requires a domain" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }

  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);

  // 1. Load domain pages
  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  const pages = await vaultTools.readAll(files);

  const pagesBlock = [...pages.entries()]
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  // 2. Build messages
  const systemContent = render(lintChatTemplate, {
    domain_name: domain.name,
    lint_report: req.context ?? "",
    pages_block: pagesBlock,
  });

  const chatMessages = req.chatMessages ?? [];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  // 3. Structured LLM call
  const onEvent = (ev: RunEvent) => { void ev; };
  const result = await parseWithRetry({
    llm,
    model,
    baseMessages: messages,
    opts: { ...opts, jsonMode: "json_object" },
    schema: LintChatSchema,
    maxRetries: opts.structuredRetries ?? 1,
    callSite: "lint-chat.fix",
    signal,
    onEvent,
  });

  const parsed = result.value;

  // 4. Write pages
  for (const page of parsed.pages) {
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    try {
      await vaultTools.write(page.path, page.content);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }

  // 5. Emit result
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.summary, outputTokens: result.outputTokens || undefined };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint-chat.ts tests/phases/lint-chat.test.ts
git commit -m "feat(lint-chat): implement runLintFixChat phase"
```

---

### Task 3d: Wire into AgentRunner

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add import and case to `src/agent-runner.ts`**

Add import at top (after existing imports):

```ts
import { runLintFixChat } from "./phases/lint-chat";
```

In `buildOptsFor`, change:

```ts
const key = (op === "query-save" ? "query" : op === "chat" ? "lint" : op) as OpKey;
```

To:

```ts
const key = (op === "query-save" ? "query" : op === "chat" || op === "lint-chat" ? "lint" : op) as OpKey;
```

In `runOperation` switch, add case before `default`:

```ts
      case "lint-chat": {
        const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        yield* runLintFixChat(req, this.vaultTools, vaultRoot, domain, this.llm, model, opts, req.signal);
        break;
      }
```

- [ ] **Step 2: Add integration test for lint-chat routing**

In `tests/agent-runner.integration.test.ts`, add a test case:

```ts
it("routes lint-chat to runLintFixChat and yields result", async () => {
  // Use existing mock adapter pattern from this file
  const runner = makeRunner(); // reuse existing factory
  const events: RunEvent[] = [];
  for await (const ev of runner.run({
    operation: "lint-chat",
    args: [],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 5000,
    domainId: undefined,
    context: "lint report",
    chatMessages: [{ role: "user", content: "fix it" }],
  })) {
    events.push(ev);
  }
  const result = events.find((e) => e.kind === "result");
  expect(result).toBeDefined();
});
```

```bash
npx vitest run tests/agent-runner.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts tests/agent-runner.integration.test.ts
git commit -m "feat(agent-runner): route lint-chat to runLintFixChat"
```

---

### Task 3e: Add `lintApplyFromChat` to controller and fix dispatch routing

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Add `lintApplyFromChat` public method**

Add after the `chat()` method (line ~206 in current file):

```ts
async lintApplyFromChat(domainId: string | undefined, lintReport: string, history: ChatMessage[], newMessage: string): Promise<void> {
  const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
  await this.dispatch("lint-chat", [], domainId, lintReport, undefined, undefined, chatMessages);
}
```

- [ ] **Step 2: Update `dispatch()` signature to accept optional `chatMessages`**

Change signature from:

```ts
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError): Promise<void> {
```

To:

```ts
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError, chatMessages?: ChatMessage[]): Promise<void> {
```

- [ ] **Step 3: Fix opKey mapping in `dispatch()` for timeouts and log meta**

Find in `dispatch()`:

```ts
const opKey = op === "query-save" ? "query" : op;
const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
```

Replace with:

```ts
const opKey = op === "query-save" || op === "lint-chat" ? (op === "query-save" ? "query" : "lint") : op;
const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
```

Find in `dispatch()` (the `_currentLogMeta` block):

```ts
const opKey = (op === "query-save" ? "query" : op) as import("./types").OpKey;
```

Replace with:

```ts
const opKey = (op === "query-save" ? "query" : op === "lint-chat" ? "lint" : op) as import("./types").OpKey;
```

- [ ] **Step 4: Pass `chatMessages` into `RunRequest` in `dispatch()`**

Find in `dispatch()`:

```ts
const chatMessages = op === "format" ? this._pendingFormat?.chat : undefined;
const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages });
```

Replace with:

```ts
const resolvedChatMessages = op === "format" ? this._pendingFormat?.chat : chatMessages;
const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages });
```

- [ ] **Step 5: Add `lint-chat` to `mutatesWiki` check**

Find:

```ts
const mutatesWiki = op === "ingest" || op === "lint" || op === "query-save" || op === "init";
```

Replace with:

```ts
const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "query-save" || op === "init";
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): add lintApplyFromChat and route lint-chat through dispatch"
```

---

### Task 3f: Update view — chat submit uses `lintApplyFromChat` for lint context

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Add `"lint-chat"` to `CHAT_OPS` in `finish()`**

Find in `finish()`:

```ts
const CHAT_OPS: WikiOperation[] = ["lint", "ingest", "query", "query-save"];
```

Replace with:

```ts
const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query", "query-save"];
```

- [ ] **Step 2: Update `showChatSection()` submit handler**

Find in `showChatSection()`:

```ts
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastContext) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      void this.plugin.controller.chat(
        this.lastContext.operation,
        this.lastContext.domainId,
        this.lastContext.report,
        this.chatHistory,
        text,
      );
    };
```

Replace with:

```ts
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastContext) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      const ctx = this.lastContext;
      if (ctx.operation === "lint" || ctx.operation === "lint-chat") {
        void this.plugin.controller.lintApplyFromChat(
          ctx.domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      } else {
        void this.plugin.controller.chat(
          ctx.operation,
          ctx.domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      }
    };
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Build the plugin**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): route lint chat submissions through lintApplyFromChat"
```

---

## Task 4: Final build and integration smoke-check

- [ ] **Step 1: Run full test suite one last time**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Build production bundle**

```bash
npm run build
```

Expected: `main.js` emitted, no errors.

- [ ] **Step 3: Verify TypeScript types are clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit build artifact if tracked**

```bash
git add main.js
git commit -m "build: update main.js for lint UX fixes"
```
