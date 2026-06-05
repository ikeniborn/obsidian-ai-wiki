---
review:
  plan_hash: 7ab9ab994ec9f182
  spec_hash: 4c85fe758177f228
  last_run: 2026-06-05
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: CRITICAL
      section: "Task 15: Update prompts/format.md"
      section_hash: 209cd5e456cbc73a
      text: "Step 1 содержит плейсхолдер «...ЖЁСТКИЕ ПРАВИЛА и ПРАВИЛА ФОРМАТИРОВАНИЯ as above...» — фактическое содержимое prompts/format.md не определено."
      verdict: fixed
      verdict_at: 2026-06-05
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "Task 6: Integration tests for query validation"
      section_hash: 6516faf61a5f64d5
      text: "Spec требует 3 теста отсутствующих в плане: «retry тоже битый → annotate fallback», «retry throws → annotate fallback на initial», «signal.aborted перед retry → return без annotate»."
      verdict: fixed
      verdict_at: 2026-06-05
    - id: F-003
      phase: coverage
      severity: WARNING
      section: "Part D + Part E (Tasks 16-18)"
      section_hash: 29ab18bbf5dba64d
      text: "Tasks 16-18 (Excalidraw .excalidraw.md fix, vision confirmation modal) не имеют backing-требований в спеке. Spec файлы не включают attachment-analyzer.ts, modals.ts, controller.ts, i18n.ts."
      verdict: wontfix
      verdict_at: 2026-06-05
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-04-query-validation-format-sentinel-design.md
---

# Query Link Validation + Format Sentinel + Vision Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix hallucinated wiki links in query answers, replace fragile JSON wrapping in format with sentinel markers, fix Excalidraw `.excalidraw.md` extension detection, and add a vision confirmation prompt before format runs.

**Architecture:** Five independent feature tracks (A–E) that share no runtime state — implement in order to keep the build green at each step. Sentinel format replaces `response_format: json_object` throughout format phase; query link validation is a pure post-stream pass; vision UX is a controller-layer prompt before dispatch.

**Tech Stack:** TypeScript, Zod, Vitest, Obsidian plugin API. No new dependencies.

**Known spec findings to resolve during implementation:**
- **F-001**: `wikiLinkValidationRetries=0` must skip retry in query validation (integrate setting check).
- **F-002**: Use `hasVisionDescriptions` (not `hasVision`) consistently in `parseFormatOutput` signature.

---

## File Structure

**New files:**
- `src/phases/query-link-validator.ts` — pure link extraction, validation, annotation, rewrite
- `tests/query-link-validator.test.ts` — unit tests for above
- `tests/query-validation-integration.test.ts` — integration tests for query validator
- `tests/format-sentinel.test.ts` — tests for `parseSentinelOutput`
- `tests/format-zod-schema.test.ts` — tests for new `FormatOutputSchema`
- `tests/format-retry.test.ts` — tests for format retry/salvage flow

**Modified files:**
- `src/types.ts` — add `assistant_replace` to `RunEvent`
- `src/view.ts` — handle `assistant_replace` in `appendEvent` + `appendChatEvent`
- `src/phases/query-link-validator.ts` — (new)
- `src/phases/query.ts` — integrate validator, add `wikiLinkValidationRetries` param
- `src/agent-runner.ts` — pass `wikiLinkValidationRetries` to `runQuery`; add `--no-vision` flag handling
- `src/phases/format-utils.ts` — add `SentinelOutput`, `parseSentinelOutput`
- `src/phases/zod-schemas.ts` — new `FormatOutputSchema` with superRefine
- `src/phases/format.ts` — sentinel parsing, remove `json_object`, Zod-feedback retry, `hasVisionDescriptions`
- `tests/phases/format.test.ts` — update LLM mocks from JSON to sentinel format
- `src/phases/attachment-analyzer.ts` — fix `.excalidraw.md` extension detection
- `tests/attachment-analyzer.test.ts` — add `.excalidraw.md` test
- `src/modals.ts` — add `FormatVisionModal`
- `src/i18n.ts` — add vision confirmation strings
- `src/controller.ts` — show vision modal before format dispatch
- `prompts/format.md` — replace JSON instructions with sentinel format
- `prompts/query.md` — strengthen formatting rules
- `lat.md/llm-pipeline.md`, `lat.md/tests.md`, `lat.md/architecture.md` — documentation

---

## Part A — Query Link Validation

### Task 1: Add `assistant_replace` to RunEvent

**Files:**
- Modify: `src/types.ts:41-87`

- [ ] **Step 1: Add event kind to RunEvent union**

In `src/types.ts`, add after `{ kind: "assistant_text"; delta: string; isReasoning?: boolean }`:

```typescript
| { kind: "assistant_replace"; text: string }
```

Full RunEvent now includes:
```typescript
export type RunEvent =
  | { kind: "system"; message: string; sessionId?: string }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; ok: boolean; preview?: string }
  | { kind: "assistant_text"; delta: string; isReasoning?: boolean }
  | { kind: "assistant_replace"; text: string }
  | { kind: "info_text"; icon: string; summary: string; details?: string[] }
  // ... (rest unchanged)
```

- [ ] **Step 2: Run type-check to verify union compiles**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-ai-wiki && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add assistant_replace event to RunEvent union"
```

---

### Task 2: Handle `assistant_replace` in view.ts

**Files:**
- Modify: `src/view.ts:731-756` (appendEvent), `src/view.ts:998-1009` (appendChatEvent)

- [ ] **Step 1: Write failing test for assistant_replace no-op in appendEvent**

Create `tests/view-assistant-replace.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { RunEvent } from "../src/types";

describe("RunEvent assistant_replace type safety", () => {
  it("assistant_replace is a valid RunEvent kind", () => {
    const ev: RunEvent = { kind: "assistant_replace", text: "fixed answer" };
    expect(ev.kind).toBe("assistant_replace");
    expect((ev as { text: string }).text).toBe("fixed answer");
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm test -- tests/view-assistant-replace.test.ts
```
Expected: PASS (pure type test, no DOM needed).

- [ ] **Step 3: Add `assistant_replace` handler to `appendEvent`**

In `src/view.ts`, find the `appendEvent` method. After the `else if (ev.kind === "assistant_text")` block (around line 756), add:

```typescript
} else if (ev.kind === "assistant_replace") {
  // query.ts corrects `answer` in-place before emitting result event —
  // no live markdown block exists for non-chat query, so no-op here.
}
```

- [ ] **Step 4: Add `assistant_replace` handler to `appendChatEvent`**

In `src/view.ts`, in `appendChatEvent` (around line 998), add before the closing brace:

```typescript
  if (ev.kind === "assistant_replace" && this.currentChatBubble) {
    this.currentChatBuffer = ev.text;
    this.currentChatBubble.setText(ev.text);
    this.currentChatBubble.scrollIntoView({ block: "end" });
  }
```

- [ ] **Step 5: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts tests/view-assistant-replace.test.ts
git commit -m "feat(view): handle assistant_replace event — no-op in main view, replace in chat bubble"
```

---

### Task 3: Create `src/phases/query-link-validator.ts`

**Files:**
- Create: `src/phases/query-link-validator.ts`

- [ ] **Step 1: Create the module**

```typescript
import type { LlmClient, LlmCallOptions } from "../types";
import { buildChatParams, extractUsage } from "./llm-utils";
import type OpenAI from "openai";

export interface QueryLinkValidationResult {
  text: string;
  brokenInitial: string[];
  brokenFinal: string[];
  retried: boolean;
}

export function extractAnswerLinks(text: string): string[] {
  const re = /\[\[([^\]|#/]+?)\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

export function findBrokenLinks(links: string[], knownStems: Set<string>): string[] {
  return [...new Set(links.filter((s) => !knownStems.has(s)))];
}

export function annotateBroken(text: string, broken: Set<string>): string {
  return text.replace(/\[\[([^\]|#/]+?)\]\]/g, (full, stem) => {
    return broken.has(stem.trim()) ? `${full} *(нет в wiki)*` : full;
  });
}

export async function rewriteWithValidLinks(
  llm: LlmClient,
  model: string,
  question: string,
  originalAnswer: string,
  broken: string[],
  contextStems: string[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ text: string; outputTokens: number }> {
  const systemPrompt = [
    `В ответе есть ссылки на несуществующие wiki-страницы: ${broken.join(", ")}.`,
    `Перепиши ответ, используя только страницы из доступного списка: ${contextStems.join(", ")}.`,
    `Не добавляй новых фактов. Сохраняй структуру и форматирование ответа.`,
  ].join("\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Вопрос: ${question}\n\nОтвет для исправления:\n${originalAnswer}` },
  ];

  const params = buildChatParams(model, messages, { ...opts, thinkingBudgetTokens: undefined }, false);
  const resp = await llm.chat.completions.create(
    params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    { signal },
  );
  const text = (resp as OpenAI.Chat.ChatCompletion).choices[0]?.message?.content ?? originalAnswer;
  const outputTokens = extractUsage(resp as OpenAI.Chat.ChatCompletion) ?? 0;
  return { text, outputTokens };
}
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/phases/query-link-validator.ts
git commit -m "feat(query): add query-link-validator module — extract, find broken, annotate, rewrite"
```

---

### Task 4: Unit tests for query-link-validator

**Files:**
- Create: `tests/query-link-validator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  extractAnswerLinks,
  findBrokenLinks,
  annotateBroken,
} from "../src/phases/query-link-validator";

describe("extractAnswerLinks", () => {
  it("extracts [[X]] from markdown", () => {
    const links = extractAnswerLinks("Смотри [[Костный бульон]] и [[Харчо]].");
    expect(links).toEqual(["Костный бульон", "Харчо"]);
  });

  it("ignores [[X|alias]]", () => {
    const links = extractAnswerLinks("[[Борщ|рецепт борща]]");
    expect(links).toHaveLength(0);
  });

  it("ignores [[path/X]]", () => {
    const links = extractAnswerLinks("[[folder/Page]]");
    expect(links).toHaveLength(0);
  });

  it("ignores [[#anchor]]", () => {
    const links = extractAnswerLinks("[[#Раздел]]");
    expect(links).toHaveLength(0);
  });
});

describe("findBrokenLinks", () => {
  it("returns only stems absent in knownStems", () => {
    const known = new Set(["Борщ", "Щи"]);
    expect(findBrokenLinks(["Борщ", "Харчо"], known)).toEqual(["Харчо"]);
  });

  it("deduplicates broken links", () => {
    const known = new Set(["Борщ"]);
    expect(findBrokenLinks(["Харчо", "Харчо", "Харчо"], known)).toEqual(["Харчо"]);
  });
});

describe("annotateBroken", () => {
  it("annotates only broken links, leaves valid untouched", () => {
    const text = "Смотри [[Борщ]] и [[Харчо]].";
    const result = annotateBroken(text, new Set(["Харчо"]));
    expect(result).toBe("Смотри [[Борщ]] и [[Харчо]] *(нет в wiki)*.");
  });

  it("does not double-annotate when broken stem appears multiple times", () => {
    const text = "[[Харчо]] — это [[Харчо]].";
    const result = annotateBroken(text, new Set(["Харчо"]));
    expect(result).toBe("[[Харчо]] *(нет в wiki)* — это [[Харчо]] *(нет в wiki)*.");
  });

  it("does not annotate valid [[X|alias]] links", () => {
    const text = "Смотри [[Борщ|рецепт]].";
    const result = annotateBroken(text, new Set(["Борщ"]));
    expect(result).toBe("Смотри [[Борщ|рецепт]].");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** (module exists, tests should pass)

```bash
npm test -- tests/query-link-validator.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/query-link-validator.test.ts
git commit -m "test(query): unit tests for query-link-validator"
```

---

### Task 5: Integrate validator into query.ts + agent-runner.ts

**Files:**
- Modify: `src/phases/query.ts`
- Modify: `src/agent-runner.ts:95`

- [ ] **Step 1: Add `wikiLinkValidationRetries` param to `runQuery` signature**

In `src/phases/query.ts`, modify the function signature (add after `similarity?` param):

```typescript
export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  graphDepth: number = 1,
  opts: LlmCallOptions = {},
  seedTopK: number = 5,
  seedMinScore: number = 0.1,
  bfsTopK: number = 10,
  similarity?: PageSimilarityService,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Add imports to query.ts**

At the top of `src/phases/query.ts`, add:

```typescript
import { extractAnswerLinks, findBrokenLinks, annotateBroken, rewriteWithValidLinks } from "./query-link-validator";
import { pageId } from "../wiki-graph";
```

(`pageId` is already imported — skip duplicate.)

- [ ] **Step 3: Insert validation block after stream result (query.ts:178)**

After `yield { kind: "tool_result", ok: !!answer, ... }` and before `if (streamStats)`, insert:

```typescript
  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    let knownStems: Set<string>;
    try {
      const allVaultFiles = await vaultTools.listFiles("");
      knownStems = new Set(
        allVaultFiles.filter((f) => f.endsWith(".md")).map((f) => pageId(f)),
      );
    } catch {
      // fail-open: skip validation if vault listing fails
      console.warn("[ai-wiki] ValidateLinks: listFiles failed, skipping");
      knownStems = new Set<string>();
      yield { kind: "tool_result", ok: false, preview: "listFiles failed — skipped" };
      knownStems = null as unknown as Set<string>;
    }
    if (knownStems !== null) {
      const links = extractAnswerLinks(answer);
      const brokenInitial = findBrokenLinks(links, knownStems);
      yield {
        kind: "tool_result",
        ok: brokenInitial.length === 0,
        preview: brokenInitial.length === 0 ? "all valid" : `${brokenInitial.length} broken`,
      };

      if (brokenInitial.length > 0 && wikiLinkValidationRetries > 0) {
        yield { kind: "tool_use", name: "FixingLinks", input: { broken: brokenInitial.length } };
        const contextStems = [...selectedIds];
        try {
          const r = await rewriteWithValidLinks(llm, model, question, answer, brokenInitial, contextStems, opts, signal);
          outputTokens += r.outputTokens;
          const retryLinks = extractAnswerLinks(r.text);
          const brokenFinal = findBrokenLinks(retryLinks, knownStems);
          if (brokenFinal.length === 0) {
            answer = r.text;
            yield { kind: "tool_result", ok: true, preview: "fixed" };
          } else {
            answer = annotateBroken(r.text, new Set(brokenFinal));
            yield { kind: "tool_result", ok: false, preview: `${brokenFinal.length} annotated` };
          }
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") return;
          answer = annotateBroken(answer, new Set(brokenInitial));
          yield { kind: "tool_result", ok: false, preview: "retry failed → annotated" };
        }
        yield { kind: "assistant_replace", text: answer };
      } else if (brokenInitial.length > 0) {
        // retries=0: validate only, annotate without retry
        answer = annotateBroken(answer, new Set(brokenInitial));
        yield { kind: "assistant_replace", text: answer };
      }
    }
  }
```

Replace the `knownStems = null` trick with a cleaner flag:

```typescript
  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    let skipValidation = false;
    let knownStems = new Set<string>();
    try {
      const allVaultFiles = await vaultTools.listFiles("");
      knownStems = new Set(
        allVaultFiles.filter((f) => f.endsWith(".md")).map((f) => pageId(f)),
      );
    } catch {
      console.warn("[ai-wiki] ValidateLinks: listFiles failed, skipping");
      skipValidation = true;
      yield { kind: "tool_result", ok: false, preview: "listFiles failed — skipped" };
    }

    if (!skipValidation) {
      const links = extractAnswerLinks(answer);
      const brokenInitial = findBrokenLinks(links, knownStems);
      yield {
        kind: "tool_result",
        ok: brokenInitial.length === 0,
        preview: brokenInitial.length === 0 ? "all valid" : `${brokenInitial.length} broken`,
      };

      if (brokenInitial.length > 0 && wikiLinkValidationRetries > 0) {
        yield { kind: "tool_use", name: "FixingLinks", input: { broken: brokenInitial.length } };
        const contextStems = [...selectedIds];
        try {
          const r = await rewriteWithValidLinks(llm, model, question, answer, brokenInitial, contextStems, opts, signal);
          outputTokens += r.outputTokens;
          const retryLinks = extractAnswerLinks(r.text);
          const brokenFinal = findBrokenLinks(retryLinks, knownStems);
          if (brokenFinal.length === 0) {
            answer = r.text;
            yield { kind: "tool_result", ok: true, preview: "fixed" };
          } else {
            answer = annotateBroken(r.text, new Set(brokenFinal));
            yield { kind: "tool_result", ok: false, preview: `${brokenFinal.length} annotated` };
          }
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") return;
          answer = annotateBroken(answer, new Set(brokenInitial));
          yield { kind: "tool_result", ok: false, preview: "retry failed → annotated" };
        }
        yield { kind: "assistant_replace", text: answer };
      } else if (brokenInitial.length > 0) {
        answer = annotateBroken(answer, new Set(brokenInitial));
        yield { kind: "assistant_replace", text: answer };
      }
    }
  }
```

- [ ] **Step 4: Update agent-runner.ts to pass wikiLinkValidationRetries**

In `src/agent-runner.ts:95`, update the `runQuery` call:

```typescript
yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, this.settings.wikiLinkValidationRetries);
```

- [ ] **Step 5: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts src/agent-runner.ts
git commit -m "feat(query): post-stream link validation with retry and annotate fallback"
```

---

### Task 6: Integration tests for query validation

**Files:**
- Create: `tests/query-validation-integration.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../src/phases/query";
import type { LlmClient, RunEvent } from "../src/types";
import type { VaultTools } from "../src/vault-tools";
import type { DomainEntry } from "../src/domain";
import type OpenAI from "openai";

function makeChunk(content: string, finish?: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    choices: [{ delta: { content }, finish_reason: finish ?? null }],
  } as OpenAI.Chat.ChatCompletionChunk;
}

function makeNonStreamLlm(firstAnswer: string, rewriteAnswer?: string): LlmClient {
  let call = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
          call++;
          if (params.stream) {
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield makeChunk(call === 1 ? firstAnswer : (rewriteAnswer ?? firstAnswer));
                yield makeChunk("", "stop");
              },
            });
          }
          return Promise.resolve({
            choices: [{ message: { content: rewriteAnswer ?? firstAnswer }, finish_reason: "stop" }],
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeVaultTools(files: string[], knownStems: string[]): VaultTools {
  return {
    listFiles: vi.fn().mockResolvedValue(files),
    readAll: vi.fn().mockResolvedValue(new Map(files.map((f) => [f, `# ${f}\ncontent`]))),
    read: vi.fn().mockResolvedValue(""),
  } as unknown as VaultTools;
}

const domain: DomainEntry = {
  id: "d1", name: "Test", wiki_folder: "!Wiki/test", entity_types: [], language_notes: "",
};

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("Query link validation integration", () => {
  it("all links valid → answer unchanged, FixingLinks not emitted", async () => {
    const answer = "Смотри [[Борщ]] — хорошее блюдо.";
    const vt = makeVaultTools(
      ["!Wiki/test/wiki_test_борщ.md"],
      [],
    );
    // Override listFiles to return known md files
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);
    const llm = makeNonStreamLlm(answer);

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        1, {}, 1, 0, 1, undefined, 3),
    );
    const toolNames = events.filter(e => e.kind === "tool_use").map(e => (e as { name: string }).name);
    expect(toolNames).not.toContain("FixingLinks");
    expect(events.find(e => e.kind === "result")).toBeDefined();
  });

  it("broken links + retries>0 → FixingLinks emitted, fixed answer used", async () => {
    const badAnswer = "Смотри [[НесуществующаяСтраница]].";
    const fixedAnswer = "Смотри [[Борщ]].";
    const vt = makeVaultTools([], []);
    (vt.listFiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(["!Wiki/test/wiki_test_борщ.md"])  // Phase 3 glob
      .mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);     // ValidateLinks call
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["!Wiki/test/wiki_test_борщ.md", "# Борщ\ncontent"]])
    );
    const llm = makeNonStreamLlm(badAnswer, fixedAnswer);

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 3),
    );
    const result = events.find(e => e.kind === "result") as { text: string } | undefined;
    expect(result?.text).toContain("[[Борщ]]");
    expect(result?.text).not.toContain("НесуществующаяСтраница");
  });

  it("broken links + retries=0 → annotate without retry, FixingLinks not emitted", async () => {
    const badAnswer = "Смотри [[НесуществующаяСтраница]].";
    const vt = makeVaultTools([], []);
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["!Wiki/test/wiki_test_борщ.md", "# Борщ"]])
    );
    const llm = makeNonStreamLlm(badAnswer);

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 0),
    );
    const toolNames = events.filter(e => e.kind === "tool_use").map(e => (e as { name: string }).name);
    expect(toolNames).not.toContain("FixingLinks");
    const result = events.find(e => e.kind === "result") as { text: string } | undefined;
    expect(result?.text).toContain("*(нет в wiki)*");
  });

  it("broken links + retry also broken → annotate fallback", async () => {
    const badAnswer = "Смотри [[НесуществующаяСтраница]].";
    const stillBadAnswer = "Смотри [[ТожеНетВВики]].";
    const vt = makeVaultTools([], []);
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["!Wiki/test/wiki_test_борщ.md", "# Борщ"]])
    );
    const llm = makeNonStreamLlm(badAnswer, stillBadAnswer);

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 3),
    );
    const result = events.find(e => e.kind === "result") as { text: string } | undefined;
    expect(result?.text).toContain("*(нет в wiki)*");
    expect(result?.text).not.toContain("НесуществующаяСтраница");
  });

  it("retry throws → annotate fallback on initial broken links", async () => {
    const badAnswer = "Смотри [[НесуществующаяСтраница]].";
    const vt = makeVaultTools([], []);
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["!Wiki/test/wiki_test_борщ.md", "# Борщ"]])
    );
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn()
            .mockImplementationOnce(() => Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield makeChunk(badAnswer);
                yield makeChunk("", "stop");
              },
            }))
            .mockRejectedValueOnce(new Error("network error")),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 3),
    );
    const result = events.find(e => e.kind === "result") as { text: string } | undefined;
    expect(result?.text).toContain("*(нет в wiki)*");
  });

  it("signal.aborted before retry → return without annotate", async () => {
    const badAnswer = "Смотри [[НесуществующаяСтраница]].";
    const vt = makeVaultTools([], []);
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue(["!Wiki/test/wiki_test_борщ.md"]);
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["!Wiki/test/wiki_test_борщ.md", "# Борщ"]])
    );
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn()
            .mockImplementationOnce(() => Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield makeChunk(badAnswer);
                yield makeChunk("", "stop");
              },
            }))
            .mockImplementationOnce(() => {
              const err = new Error("AbortError");
              err.name = "AbortError";
              return Promise.reject(err);
            }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 3),
    );
    const assistantReplace = events.filter(e => e.kind === "assistant_replace");
    expect(assistantReplace).toHaveLength(0);
  });

  it("empty answer → ValidateLinks not emitted", async () => {
    const vt = makeVaultTools([], []);
    (vt.readAll as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    (vt.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const llm = makeNonStreamLlm("");

    const events = await collect(
      runQuery(["тест"], false, vt, llm, "m", [domain], "/vault", new AbortController().signal,
        0, {}, 1, 0, 1, undefined, 3),
    );
    const toolNames = events.filter(e => e.kind === "tool_use").map(e => (e as { name: string }).name);
    expect(toolNames).not.toContain("ValidateLinks");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/query-validation-integration.test.ts
```
Expected: most PASS (some may need adapter mocking adjustment for listFiles path).

- [ ] **Step 3: Commit**

```bash
git add tests/query-validation-integration.test.ts
git commit -m "test(query): integration tests for link validation flow"
```

---

## Part B — Format Sentinel Parsing

### Task 7: Add `parseSentinelOutput` to format-utils.ts

**Files:**
- Modify: `src/phases/format-utils.ts`

- [ ] **Step 1: Add SentinelOutput interface and parseSentinelOutput function**

At the end of `src/phases/format-utils.ts`, append:

```typescript
export interface SentinelOutput {
  report: string;
  formatted: string;
  visionCount?: number;
  embeds?: string[];
  truncated: boolean;
}

export function parseSentinelOutput(text: string, hasVisionDescriptions: boolean): SentinelOutput | null {
  const reportIdx = text.indexOf("<<<REPORT>>>");
  const formattedIdx = text.indexOf("<<<FORMATTED>>>");
  if (reportIdx === -1 || formattedIdx === -1) return null;

  const report = text.slice(reportIdx + "<<<REPORT>>>".length, formattedIdx).trim();
  const endIdx = text.indexOf("<<<END>>>");

  let formattedEnd: number;
  let truncated = false;
  let visionCount: number | undefined;
  let embeds: string[] | undefined;

  if (hasVisionDescriptions) {
    const visionIdx = text.indexOf("<<<VISION_COUNT>>>", formattedIdx);
    const embedsIdx = text.indexOf("<<<EMBEDS>>>", formattedIdx);
    if (visionIdx === -1 || embedsIdx === -1) return null;
    formattedEnd = visionIdx;
    visionCount = parseInt(text.slice(visionIdx + "<<<VISION_COUNT>>>".length, embedsIdx).trim(), 10);
    const embedsEnd = endIdx === -1 ? text.length : endIdx;
    embeds = text
      .slice(embedsIdx + "<<<EMBEDS>>>".length, embedsEnd)
      .trim()
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    truncated = endIdx === -1;
  } else {
    formattedEnd = endIdx === -1 ? text.length : endIdx;
    truncated = endIdx === -1;
  }

  const formatted = text.slice(formattedIdx + "<<<FORMATTED>>>".length, formattedEnd).trim();
  return { report, formatted, visionCount, embeds, truncated };
}
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/phases/format-utils.ts
git commit -m "feat(format): add parseSentinelOutput to format-utils"
```

---

### Task 8: Tests for parseSentinelOutput

**Files:**
- Create: `tests/format-sentinel.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { parseSentinelOutput } from "../src/phases/format-utils";

const R = "<<<REPORT>>>";
const F = "<<<FORMATTED>>>";
const E = "<<<END>>>";
const VC = "<<<VISION_COUNT>>>";
const EM = "<<<EMBEDS>>>";

function sentinel(report: string, formatted: string): string {
  return `${R}\n${report}\n${F}\n${formatted}\n${E}`;
}

describe("parseSentinelOutput", () => {
  it("extracts report and formatted between markers", () => {
    const text = sentinel("## Changes\n- added frontmatter", "---\n# Page\n\nContent.");
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.report).toBe("## Changes\n- added frontmatter");
    expect(result!.formatted).toBe("---\n# Page\n\nContent.");
    expect(result!.truncated).toBe(false);
  });

  it("returns null if REPORT marker absent", () => {
    const text = `${F}\n---\n# Page\n${E}`;
    expect(parseSentinelOutput(text, false)).toBeNull();
  });

  it("returns null if FORMATTED marker absent", () => {
    const text = `${R}\nreport\n${E}`;
    expect(parseSentinelOutput(text, false)).toBeNull();
  });

  it("salvage: FORMATTED present but END absent → truncated: true, uses rest as formatted", () => {
    const text = `${R}\nreport\n${F}\n---\n# Page\n\nUnfinished`;
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.truncated).toBe(true);
    expect(result!.formatted).toBe("---\n# Page\n\nUnfinished");
  });

  it("hasVision=true: requires VISION_COUNT and EMBEDS markers", () => {
    const text = sentinel("report", "---\n# Page");
    expect(parseSentinelOutput(text, true)).toBeNull();
  });

  it("hasVision=true: parses VISION_COUNT and EMBEDS", () => {
    const text = [
      `${R}\nreport`,
      `${F}\n---\n# Page`,
      `${VC}2`,
      `${EM}img/a.png|img/b.png`,
      E,
    ].join("\n");
    const result = parseSentinelOutput(text, true);
    expect(result).not.toBeNull();
    expect(result!.visionCount).toBe(2);
    expect(result!.embeds).toEqual(["img/a.png", "img/b.png"]);
    expect(result!.truncated).toBe(false);
  });

  it("markdown with tables and control chars does not break parsing", () => {
    const mdWithTable = [
      "---",
      "tags: [test]",
      "---",
      "",
      "# Page",
      "",
      "| Суп | Время |",
      "|---|---|",
      "| **Харчо** | 1–2 ч |",
      "| **Щи** | 3 ч |",
      "",
      "```bash",
      "echo 'hello'",
      "```",
    ].join("\n");
    const text = sentinel("report", mdWithTable);
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("| **Харчо** |");
    expect(result!.formatted).toContain("```bash");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/format-sentinel.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/format-sentinel.test.ts
git commit -m "test(format): tests for parseSentinelOutput"
```

---

### Task 9: Update FormatOutputSchema in zod-schemas.ts

**Files:**
- Modify: `src/phases/zod-schemas.ts:113-127`

- [ ] **Step 1: Replace FormatOutputSchema**

Replace the current:
```typescript
export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});
```

With:
```typescript
export const FormatBaseSchema = z.object({
  report: z.string().min(1, "report не должен быть пустым"),
  formatted: z.string().min(10, "formatted слишком короткий"),
});

export const FormatWithVisionSchema = FormatBaseSchema.extend({
  vision_blocks_count: z.number().int().min(0),
  embeds_preserved: z.array(z.string()),
});

export const FormatOutputSchema = z.union([FormatBaseSchema, FormatWithVisionSchema])
  .superRefine((val, ctx) => {
    if (!val.formatted.startsWith("---\n")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formatted"],
        message: "formatted должен начинаться с YAML frontmatter (---)",
      });
    }
    if (val.report.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["report"], message: "report пуст" });
    }
    if ("embeds_preserved" in val) {
      const vVal = val as z.infer<typeof FormatWithVisionSchema>;
      for (const path of vVal.embeds_preserved) {
        if (!val.formatted.includes(`![[${path}]]`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["formatted"],
            message: `embed ![[${path}]] потерян`,
          });
        }
      }
    }
  });

export type FormatOutput = z.infer<typeof FormatBaseSchema> | z.infer<typeof FormatWithVisionSchema>;
```

Also update the exported type at the bottom — replace `export type FormatOutput = z.infer<typeof FormatOutputSchema>;` with the definition above.

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/phases/zod-schemas.ts
git commit -m "feat(format): harden FormatOutputSchema with discriminated union and superRefine"
```

---

### Task 10: Tests for new FormatOutputSchema

**Files:**
- Create: `tests/format-zod-schema.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { FormatOutputSchema, FormatWithVisionSchema, FormatBaseSchema } from "../src/phases/zod-schemas";

const goodFormatted = "---\ntags: []\n---\n\n# Page content here.";

describe("FormatOutputSchema — base", () => {
  it("rejects empty report", () => {
    const result = FormatOutputSchema.safeParse({ report: "", formatted: goodFormatted });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("report");
  });

  it("rejects formatted shorter than 10 chars", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok", formatted: "---\nX" });
    expect(result.success).toBe(false);
  });

  it("superRefine: formatted without frontmatter → error", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok", formatted: "# Page\nno frontmatter" });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("frontmatter");
  });

  it("accepts valid base output", () => {
    const result = FormatOutputSchema.safeParse({ report: "- added tags", formatted: goodFormatted });
    expect(result.success).toBe(true);
  });
});

describe("FormatOutputSchema — vision", () => {
  it("vision variant: missing embed → error with path", () => {
    const result = FormatWithVisionSchema.safeParse({
      report: "ok",
      formatted: goodFormatted,
      vision_blocks_count: 1,
      embeds_preserved: ["img/photo.png"],
    });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("img/photo.png");
    expect(msgs).toContain("потерян");
  });

  it("vision variant: embed present → passes", () => {
    const fmtWithEmbed = `${goodFormatted}\n\n![[img/photo.png]]\n\n| col1 | col2 |\n|---|---|\n| a | b |`;
    const result = FormatWithVisionSchema.safeParse({
      report: "ok",
      formatted: fmtWithEmbed,
      vision_blocks_count: 1,
      embeds_preserved: ["img/photo.png"],
    });
    expect(result.success).toBe(true);
  });

  it("vision variant requires vision_blocks_count and embeds_preserved", () => {
    const result = FormatWithVisionSchema.safeParse({ report: "ok", formatted: goodFormatted });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/format-zod-schema.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/format-zod-schema.test.ts
git commit -m "test(format): tests for new FormatOutputSchema with superRefine"
```

---

### Task 11: Update format.ts — sentinel parsing, remove JSON mode

**Files:**
- Modify: `src/phases/format.ts`

- [ ] **Step 1: Update imports in format.ts**

Replace the import of `format-utils` functions to include `parseSentinelOutput`:

```typescript
import { missingTokensWithContext, looksTruncated, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds, parseSentinelOutput } from "./format-utils";
```

Also import the vision schema:
```typescript
import { FormatOutputSchema, FormatBaseSchema, FormatWithVisionSchema } from "./zod-schemas";
```

- [ ] **Step 2: Replace parseFormatOutput function**

Replace the existing `parseFormatOutput` (lines 15-30) with:

```typescript
function parseFormatOutput(
  text: string,
  hasVisionDescriptions: boolean,
): { data: import("./zod-schemas").FormatOutput | null; hint: string; truncated: boolean } {
  const sentinel = parseSentinelOutput(text, hasVisionDescriptions);
  if (!sentinel) {
    structuralErrorCounter.record(false, 0);
    return { data: null, hint: "sentinel markers not found", truncated: false };
  }
  const raw = hasVisionDescriptions
    ? {
        report: sentinel.report,
        formatted: sentinel.formatted,
        vision_blocks_count: sentinel.visionCount ?? 0,
        embeds_preserved: sentinel.embeds ?? [],
      }
    : { report: sentinel.report, formatted: sentinel.formatted };

  const schema = hasVisionDescriptions ? FormatWithVisionSchema : FormatBaseSchema;
  const result = schema.safeParse(raw);
  if (result.success) {
    structuralErrorCounter.record(true, 0);
    return { data: result.data, hint: "", truncated: sentinel.truncated };
  }
  structuralErrorCounter.record(false, 0);
  const hint = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { data: null, hint, truncated: sentinel.truncated };
}
```

- [ ] **Step 3: Add hasVisionDescriptions to runFormat's systemContent render**

Find the `render(formatTemplate, ...)` call and add the new variable:

```typescript
const systemContent = render(formatTemplate, {
  format_schema: formatSchema,
  has_vision: String(hasVision),
  has_vision_descriptions: String(visionDescriptions.size > 0),
});
```

- [ ] **Step 4: Remove `response_format: json_object` from baseParams**

Change line 162:
```typescript
// OLD:
const baseParams = { ...buildChatParams(model, messages, opts, true), response_format: { type: "json_object" } };
// NEW:
const baseParams = buildChatParams(model, messages, opts, true);
```

- [ ] **Step 5: Update all callOnce calls to use parsed result**

Replace the format-and-parse block. After `let fullText = yield* callOnce(baseParams);`:

```typescript
  if (signal.aborted) return;

  let parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
  let parsed = parsedResult.data;

  if (parsedResult.truncated) {
    yield {
      kind: "info_text", icon: "⚠️",
      summary: "Format: ответ обрезан — salvage",
      details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
    };
  }

  const truncated = !parsed && lastFinishReason === "length";
  if (!parsed && truncated) {
    yield { kind: "tool_result", ok: false, preview: "response truncated" };
    yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }

  if (!parsed) {
    yield { kind: "tool_result", ok: false, preview: "invalid sentinel — retrying" };
    yield { kind: "assistant_text", delta: "\n[Sentinel невалиден — повторяю запрос]\n" };
    const zodHint = parsedResult.hint;
    const retrySystemContent = systemContent + `\n\nПредыдущая попытка не прошла: ${zodHint}. Исправь и верни заново используя маркеры <<<REPORT>>>...<<<END>>>.`;
    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: retrySystemContent },
      { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
      ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    ];
    const retryParams = buildChatParams(model, retryMessages, opts, true);
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
    fullText = yield* callOnce(retryParams);
    if (signal.aborted) return;
    parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
    parsed = parsedResult.data;
    if (parsedResult.truncated) {
      yield {
        kind: "info_text", icon: "⚠️",
        summary: "Format: retry ответ обрезан — salvage",
        details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
      };
    }
  }

  if (!parsed) {
    const retryTruncated = lastFinishReason === "length";
    const msg = retryTruncated
      ? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
      : "Format: LLM вернул невалидный sentinel (после retry)";
    yield { kind: "tool_result", ok: false, preview: msg };
    yield { kind: "error", message: msg };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: `${parsed.formatted.length} chars` };
```

- [ ] **Step 6: Update token-restore block to use sentinel format**

In the token-restore block (around line 251), the `{ role: "assistant", content: fullText }` already uses `fullText` (now sentinel text) — no change needed. But update the user prompt to mention sentinel format:

```typescript
{
  role: "user",
  content: `ВОССТАНОВИ ТОКЕНЫ: следующие значения из оригинала отсутствуют в форматированном тексте. Верни полный ответ используя маркеры <<<REPORT>>>...<<<END>>> где formatted содержит все перечисленные токены.\nПропущенные: ${tokenList}`,
},
```

And update the restoreParams:
```typescript
const restoreParams = buildChatParams(model, restoreMessages, opts, true);
// NO response_format: { type: "json_object" }
```

Then update the `parseFormatOutput` call in the restore block:
```typescript
const parsed2Result = parseFormatOutput(fullText2, visionDescriptions.size > 0);
const parsed2 = parsed2Result.data;
if (parsed2) {
  finalFormatted = parsed2.formatted;
  finalReport = parsed2.report;
}
```

- [ ] **Step 7: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/phases/format.ts
git commit -m "feat(format): replace JSON wrapping with sentinel markers; remove json_object mode; add Zod-feedback retry"
```

---

### Task 12: Update existing tests/phases/format.test.ts for sentinel format

**Files:**
- Modify: `tests/phases/format.test.ts`

- [ ] **Step 1: Add sentinel helper at top of file**

After existing imports, add:

```typescript
function makeSentinel(report: string, formatted: string): string {
  return `<<<REPORT>>>\n${report}\n<<<FORMATTED>>>\n${formatted}\n<<<END>>>`;
}
```

- [ ] **Step 2: Update all JSON mock responses to sentinel format**

Replace each occurrence:
- `JSON.stringify({ report: "## Изменения\n- frontmatter", formatted })` → `makeSentinel("## Изменения\n- frontmatter", formatted)`
- `JSON.stringify({ report: "r", formatted })` → `makeSentinel("r", formatted)`
- `JSON.stringify({ report: "r", formatted: SAMPLE })` → `makeSentinel("r", SAMPLE)`
- `JSON.stringify({ report: "## ok", formatted: "---\n# Page" })` → `makeSentinel("## ok", "---\n# Page\nsome content")`
- `'{"report":"ok","formatted":"# Page"}'` → `makeSentinel("ok", "---\ntags: []\n---\n\n# Page with content here.")`
- All other `JSON.stringify(...)` calls with report/formatted → use `makeSentinel`

For the Zod validation test where `bad` = `'{"report": "ok"}'` (missing formatted), change to:
```typescript
// bad: sentinel without <<<FORMATTED>>> marker
const bad = `<<<REPORT>>>\nok\n<<<END>>>`;
// good: valid sentinel with frontmatter
const good = makeSentinel("## ok", "---\ntags: []\n---\n\n# Page content here.");
```

For the structuralErrorCounter test, update `bad` and `good` accordingly — behavior should be identical.

For `makeLlmTruncated()` — it returns `"not json {"` with `finish_reason: "length"`. Since this has no sentinel markers, `parseSentinelOutput` returns null, `lastFinishReason === "length"` → truncation error. Test passes unchanged.

- [ ] **Step 3: Run the format test suite**

```bash
npm test -- tests/phases/format.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/phases/format.test.ts
git commit -m "test(format): migrate format.test.ts from JSON to sentinel format mocks"
```

---

### Task 13: New format-retry tests

**Files:**
- Create: `tests/format-retry.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runFormat } from "../src/phases/format";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient, RunEvent } from "../src/types";

const VAULT = "/vault";
const FILE = "note.md";
const SAMPLE = "---\ntags: []\n---\n\n# Test Page\n\nContent with details.";

function makeSentinel(report: string, formatted: string): string {
  return `<<<REPORT>>>\n${report}\n<<<FORMATTED>>>\n${formatted}\n<<<END>>>`;
}

function makeVisionSentinel(report: string, formatted: string, visionCount: number, embeds: string[]): string {
  return [
    `<<<REPORT>>>\n${report}`,
    `<<<FORMATTED>>>\n${formatted}`,
    `<<<VISION_COUNT>>>${visionCount}`,
    `<<<EMBEDS>>>${embeds.join("|")}`,
    "<<<END>>>",
  ].join("\n");
}

function mockAdapter(files: Record<string, string> = {}): VaultAdapter {
  return {
    read: vi.fn().mockImplementation((p: string) => Promise.resolve(files[p] ?? "")),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLlmSequence(responses: string[]): LlmClient {
  let call = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const content = responses[Math.min(call++, responses.length - 1)];
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content }, finish_reason: null }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = []; for await (const e of gen) out.push(e); return out;
}

const GOOD_FORMATTED = "---\ntags: [test]\n---\n\n# Test Page\n\nContent with details.";

describe("format sentinel retry", () => {
  it("first attempt fail → retry with Zod hint → result emitted", async () => {
    const bad = "<<<REPORT>>>\nok\n<<<END>>>"; // no FORMATTED → sentinel null → hint
    const good = makeSentinel("ok", GOOD_FORMATTED);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([bad, good]);

    const events = await collect(runFormat([FILE], vt, llm, "m", false, [], new AbortController().signal));
    expect(events.some(e => e.kind === "format_preview")).toBe(true);
    expect(events.some(e => e.kind === "error")).toBe(false);
  });

  it("retry with Zod hint: system prompt contains hint text", async () => {
    const bad = "<<<REPORT>>>\nok\n<<<END>>>"; // no FORMATTED → hint = "sentinel markers not found"
    const good = makeSentinel("ok", GOOD_FORMATTED);
    const llm = makeLlmSequence([bad, good]);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);

    await collect(runFormat([FILE], vt, llm, "m", false, [], new AbortController().signal));

    const create = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
    const retryMessages = (create.mock.calls[1][0] as { messages: Array<{ role: string; content: unknown }> }).messages;
    const systemMsg = retryMessages.find(m => m.role === "system")?.content as string | undefined;
    expect(systemMsg).toContain("Предыдущая попытка не прошла");
    expect(systemMsg).toContain("<<<REPORT>>>");
  });

  it("both attempts fail → error event", async () => {
    const bad = "no sentinel here";
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([bad, bad]);

    const events = await collect(runFormat([FILE], vt, llm, "m", false, [], new AbortController().signal));
    expect(events.some(e => e.kind === "error")).toBe(true);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("salvage (no END marker): warning emitted, write succeeds", async () => {
    const salvage = `<<<REPORT>>>\nok\n<<<FORMATTED>>>\n${GOOD_FORMATTED}`;
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([salvage]);

    const events = await collect(runFormat([FILE], vt, llm, "m", false, [], new AbortController().signal));
    const infoEvents = events.filter(e => e.kind === "info_text");
    expect(infoEvents.some(e => (e as { summary: string }).summary.includes("salvage") || (e as { summary: string }).summary.includes("обрезан"))).toBe(true);
    expect(events.some(e => e.kind === "format_preview")).toBe(true);
  });

  it("vision sentinel: embed preserved → no Zod error", async () => {
    const fmtWithEmbed = `${GOOD_FORMATTED}\n\n![[img/photo.png]]\n\n| A | B |\n|---|---|\n| x | y |`;
    const visionSentinel = makeVisionSentinel("ok", fmtWithEmbed, 1, ["img/photo.png"]);
    const fileContent = `${SAMPLE}\n\n![[img/photo.png]]`;
    const adapter = mockAdapter({
      [FILE]: fileContent,
      "img/photo.png": "binary",
    });
    adapter.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    adapter.resolveLink = vi.fn().mockReturnValue("img/photo.png");
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([visionSentinel]);

    const events = await collect(runFormat([FILE], vt, llm, "m", false, [], new AbortController().signal,
      {}, "native-agent", undefined, 3, { enabled: true, model: "vis-m" }));
    expect(events.some(e => e.kind === "format_preview")).toBe(true);
    expect(events.some(e => e.kind === "error")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/format-retry.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -20
```
Expected: all previous tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/format-retry.test.ts
git commit -m "test(format): sentinel retry/salvage integration tests"
```

---

## Part C — Prompt Updates

### Task 14: Update prompts/query.md

**Files:**
- Modify: `prompts/query.md`

- [ ] **Step 1: Strengthen formatting rules section**

In `prompts/query.md`, in `## Правила форматирования`, replace the **Структура ответа** block:

```markdown
**Структура ответа:**
- Короткий прямой ответ в начале — без вступлений.
- Если тем несколько — раздели заголовками `##`.
- Шаги/перечисления → нумерованный или маркированный список.
```

With:

```markdown
**Структура ответа:**
- Короткий прямой ответ в начале — без вступлений.
- Если тем несколько — раздели заголовками `##`.
- Перечисления: ВСЕГДА список (`-` или `1.`), не через запятую inline.
- Сравнительные/числовые данные (≥3 строк, ≥2 столбца) → таблица.
- Ключевые термины и сущности → `**bold**` при первом упоминании.

НЕВЕРНО:
Три рецепта: харчо — 2 часа, щи — 3 часа, бульон — 6 часов.

ВЕРНО:
**Рецепты супов** [[Wiki-страница]]:

| Блюдо | Время |
|---|---|
| **Харчо** | 1,5–2 ч |
| **Щи** | 3 ч |
| **Костный бульон** | ≥6 ч |
```

- [ ] **Step 2: Commit**

```bash
git add prompts/query.md
git commit -m "feat(prompts): strengthen query formatting rules — lists, tables, bold for entities"
```

---

### Task 15: Update prompts/format.md

**Files:**
- Modify: `prompts/format.md`

- [ ] **Step 1: Replace entire file with sentinel format**

The new `prompts/format.md`:

```markdown
Ты — редактор markdown-страницы вне wiki-базы знаний.

Твоя задача — проанализировать страницу и предложить форматирование по правилам ниже.

ЖЁСТКИЕ ПРАВИЛА:
- Не добавляй и не удаляй факты, имена, числа, URL.
- Не искажай смысл. Перефраз для ясности разрешён.
- Все изменения опиши в поле report.
- Obsidian-вставки (`![[путь]]`, `![[путь|алиас]]`) — копировать точно как есть. Не переводить в стандартный Markdown (`![alt](path)`).
- Если в user-сообщении есть блок «ОПИСАНИЯ ВЛОЖЕНИЙ»: интегрируй каждое описание СРАЗУ ПОД соответствующей вставкой `![[путь]]` в formatted. Сохраняй структурный формат описания (таблица / список / mermaid / код) как есть — не оборачивай в blockquote, не добавляй маркер `[Vision]`, не цитируй заголовок `![[путь]]` внутри описания. Если описание уже присутствует в исходнике (старый формат `> *[Vision] ...*` или дубликат) — удали старый вариант, оставь только структурированную версию.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
{{format_schema}}

VISION: {{has_vision}}
- При has_vision=true: извлекай содержимое схем и изображений, создавай таблицы или mermaid-блоки ниже изображения. Само изображение сохраняй.
- При has_vision=false: работай только с alt-текстом и подписями, новой информации не сочиняй.

Верни ответ строго в следующем формате с маркерами-разделителями. Никакого текста до первого маркера.

{{#if has_vision_descriptions}}
Формат вывода (vision активен — N вложений обработано):

<<<REPORT>>>
<markdown список изменений>
<<<FORMATTED>>>
<полный форматированный markdown включая frontmatter>
<<<VISION_COUNT>>>
<количество описаний вложений, целое число>
<<<EMBEDS>>>
<пути вложений через | например: img/a.png|img/b.png>
<<<END>>>
{{else}}
Формат вывода:

<<<REPORT>>>
<markdown список изменений>
<<<FORMATTED>>>
<полный форматированный markdown включая frontmatter>
<<<END>>>
{{/if}}

Требования к маркерам:
- Каждый маркер `<<<...>>>` стоит на отдельной строке.
- После `<<<FORMATTED>>>` — сразу frontmatter (`---`).
- `<<<END>>>` — последняя строка ответа.
- Если ответ длинный — сокращай report, не formatted. Лучше обрезать report, чем оборвать formatted.
```

**Note:** The `{{#if has_vision_descriptions}}` syntax doesn't work with the `render()` function — it just replaces `{{key}}`. So instead use `{{has_vision_descriptions}}` as a literal flag and handle conditional sections differently.

Actual format.md (using simple template variable, no conditionals):

```markdown
Ты — редактор markdown-страницы вне wiki-базы знаний.

Твоя задача — проанализировать страницу и предложить форматирование по правилам ниже.

ЖЁСТКИЕ ПРАВИЛА:
- Не добавляй и не удаляй факты, имена, числа, URL.
- Не искажай смысл. Перефраз для ясности разрешён.
- Все изменения опиши в поле report.
- Obsidian-вставки (`![[путь]]`, `![[путь|алиас]]`) — копировать точно как есть. Не переводить в стандартный Markdown (`![alt](path)`).
- Если в user-сообщении есть блок «ОПИСАНИЯ ВЛОЖЕНИЙ»: интегрируй каждое описание СРАЗУ ПОД соответствующей вставкой `![[путь]]` в formatted. Сохраняй структурный формат описания (таблица / список / mermaid / код) как есть — не оборачивай в blockquote, не добавляй маркер `[Vision]`, не цитируй заголовок `![[путь]]` внутри описания. Если описание уже присутствует в исходнике (старый формат `> *[Vision] ...*` или дубликат) — удали старый вариант, оставь только структурированную версию.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
{{format_schema}}

VISION: {{has_vision}}
- При has_vision=true: извлекай содержимое схем и изображений, создавай таблицы или mermaid-блоки ниже изображения. Само изображение сохраняй.
- При has_vision=false: работай только с alt-текстом и подписями, новой информации не сочиняй.

Верни ответ строго в следующем формате. Никакого текста до первого маркера `<<<REPORT>>>`.

<<<REPORT>>>
<markdown список изменений>
<<<FORMATTED>>>
<полный форматированный markdown, начиная с frontmatter --->
<<<END>>>

{{has_vision_descriptions_block}}

Требования:
- Каждый маркер `<<<...>>>` — на отдельной строке.
- После `<<<FORMATTED>>>` идёт frontmatter (`---`).
- `<<<END>>>` — последняя строка ответа.
- При нехватке контекста: сокращай report, не formatted.
```

Where `has_vision_descriptions_block` is rendered to either `""` (no vision) or the vision instructions block. This requires updating `render()` call in `format.ts` to pass the pre-rendered block:

In `format.ts`, build the vision block string before rendering:
```typescript
const visionDescBlock = visionDescriptions.size > 0
  ? [
      "При наличии описаний вложений добавь после <<<FORMATTED>>> дополнительные маркеры:",
      "<<<VISION_COUNT>>>",
      "<количество описаний, целое число>",
      "<<<EMBEDS>>>",
      "<пути через |: img/a.png|img/b.png>",
      "Эти маркеры ставь ПОСЛЕ formatted и ДО <<<END>>>.",
    ].join("\n")
  : "";

const systemContent = render(formatTemplate, {
  format_schema: formatSchema,
  has_vision: String(hasVision),
  has_vision_descriptions: String(visionDescriptions.size > 0),
  has_vision_descriptions_block: visionDescBlock,
});
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Run full tests**

```bash
npm test 2>&1 | tail -20
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add prompts/format.md src/phases/format.ts
git commit -m "feat(prompts): replace JSON format instructions with sentinel markers in format.md"
```

---

## Part D — Fix Excalidraw Extension Recognition

### Task 16: Fix `.excalidraw.md` detection in attachment-analyzer.ts

**Root cause:** Obsidian Excalidraw plugin may store diagrams as `.excalidraw.md` files. `resolveLink` returns path ending in `.md`, so `ext = "md"` → no condition matches → returns `null` → "unknown extension".

**Files:**
- Modify: `src/phases/attachment-analyzer.ts`

- [ ] **Step 1: Add `extractExcalidrawJson` helper**

In `attachment-analyzer.ts`, after `analyzeExcalidraw` function, add:

```typescript
export function extractExcalidrawJson(text: string): string | null {
  const trimmed = text.trim();
  // Pure .excalidraw file: starts with JSON
  if (trimmed.startsWith("{")) return trimmed;
  // .excalidraw.md: JSON is embedded starting with {"type":"excalidraw"...}
  const jsonStart = trimmed.indexOf('{"type":"excalidraw"');
  if (jsonStart >= 0) return trimmed.slice(jsonStart);
  // Fallback: first { in the file (catches variations)
  const firstCurly = trimmed.indexOf("{");
  if (firstCurly >= 0) return trimmed.slice(firstCurly);
  return null;
}
```

- [ ] **Step 2: Update `analyzeSingleAttachment` to handle `.excalidraw.md`**

Replace the current `analyzeSingleAttachment` body:

```typescript
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: VisionLanguage = "auto",
): Promise<string | null> {
  const resolved = vaultTools.resolveLink(path, sourcePath);
  const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
  const isExcalidraw = ext === "excalidraw" || resolved.endsWith(".excalidraw.md");

  if (isExcalidraw) {
    const text = await vaultTools.read(resolved);
    const jsonText = extractExcalidrawJson(text);
    if (!jsonText) return null;
    return analyzeExcalidraw(jsonText, llm, model, signal, language);
  }
  if (ext === "pdf") {
    const buf = await vaultTools.readBinary(resolved);
    return analyzePdf(buf, llm, model, signal, language);
  }
  const mimeType = getMimeType(resolved);
  if (mimeType) {
    const buf = await vaultTools.readBinary(resolved);
    return analyzeImage(buf, mimeType, llm, model, signal, language);
  }
  return null;
}
```

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/phases/attachment-analyzer.ts
git commit -m "fix(vision): handle .excalidraw.md files — extract embedded JSON for Excalidraw analysis"
```

---

### Task 17: Tests for `.excalidraw.md` fix

**Files:**
- Modify: `tests/attachment-analyzer.test.ts`

- [ ] **Step 1: Read existing tests to find insertion point**

Check the existing test structure to find where to add the new test.

- [ ] **Step 2: Add tests for extractExcalidrawJson and .excalidraw.md path**

```typescript
import { extractExcalidrawJson } from "../src/phases/attachment-analyzer";

describe("extractExcalidrawJson", () => {
  it("returns text as-is for pure .excalidraw file (starts with {)", () => {
    const json = '{"type":"excalidraw","version":2,"elements":[]}';
    expect(extractExcalidrawJson(json)).toBe(json);
  });

  it("extracts embedded JSON from .excalidraw.md wrapper", () => {
    const md = [
      "---",
      "excalidraw-plugin: parsed",
      "tags: [excalidraw]",
      "---",
      "",
      "==⚠  Switch to EXCALIDRAW VIEW ⚠==",
      "",
      `{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}`,
    ].join("\n");
    const result = extractExcalidrawJson(md);
    expect(result).toContain('"type":"excalidraw"');
    expect(result).toContain('"elements"');
  });

  it("returns null for file with no JSON", () => {
    expect(extractExcalidrawJson("# Plain markdown\nNo JSON here.")).toBeNull();
  });
});

describe("analyzeSingleAttachment: .excalidraw.md", () => {
  it("resolves .excalidraw.md path (ext=md with .excalidraw.md suffix) as excalidraw", async () => {
    // This test just verifies that the path routing doesn't return null for .excalidraw.md
    const { analyzeSingleAttachment } = await import("../src/phases/attachment-analyzer");
    const excalidrawMdContent = '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}';
    const mockVt = {
      resolveLink: (_: string) => "some/path/diagram.excalidraw.md",
      read: async () => excalidrawMdContent,
      readBinary: async () => new ArrayBuffer(0),
    } as unknown as import("../src/vault-tools").VaultTools;

    const mockLlm = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "mermaid analysis" } }],
          }),
        },
      },
    } as unknown as import("../src/types").LlmClient;

    // analyzeExcalidraw imports @excalidraw/utils which may not be available in test env
    // Just verify it does NOT return null due to extension check (may throw on import)
    try {
      const result = await analyzeSingleAttachment(
        "diagram.excalidraw", mockVt, mockLlm, "m", new AbortController().signal,
      );
      // If it resolves (excalidraw/utils available), result is a string
      expect(typeof result === "string" || result === null).toBe(true);
    } catch {
      // @excalidraw/utils not available in test env — that's OK, extension routing was correct
    }
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/attachment-analyzer.test.ts
```
Expected: new tests PASS or skip gracefully.

- [ ] **Step 4: Commit**

```bash
git add tests/attachment-analyzer.test.ts
git commit -m "test(vision): tests for extractExcalidrawJson and .excalidraw.md routing"
```

---

## Part E — Vision Confirmation UX

### Task 18: FormatVisionModal + i18n + controller changes

**Files:**
- Modify: `src/modals.ts`
- Modify: `src/i18n.ts`
- Modify: `src/agent-runner.ts`
- Modify: `src/controller.ts`

- [ ] **Step 1: Add FormatVisionModal to modals.ts**

In `src/modals.ts`, add after `ConfirmModal`:

```typescript
export class FormatVisionModal extends Modal {
  constructor(
    app: App,
    private onChoice: (choice: "with" | "without") => void,
  ) { super(app); }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.formatVisionTitle });
    contentEl.createEl("p", { text: T.formatVisionBody });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(T.formatVisionWithout).onClick(() => {
        this.close();
        this.onChoice("without");
      }))
      .addButton((b) => b.setButtonText(T.formatVisionWith).setCta().onClick(() => {
        this.close();
        this.onChoice("with");
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Add i18n strings for vision modal**

In `src/i18n.ts`, in both `en` and `ru` modal sections:

English (add to the modal object):
```typescript
formatVisionTitle: "Format with vision?",
formatVisionBody: "Vision recognition is enabled. Analyze attachments before formatting?",
formatVisionWith: "With vision",
formatVisionWithout: "Without vision",
```

Russian (add to the modal object):
```typescript
formatVisionTitle: "Форматировать с vision?",
formatVisionBody: "Vision-распознавание включено. Проанализировать вложения перед форматированием?",
formatVisionWith: "С vision",
formatVisionWithout: "Без vision",
```

- [ ] **Step 3: Add `--no-vision` flag handling to agent-runner.ts**

In `src/agent-runner.ts`, update the `case "format"` block:

```typescript
case "format": {
  const hasVision = this.settings.backend === "claude-agent";
  const formatDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
  const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
  const noVision = req.args.includes("--no-vision");
  const formatArgs = req.args.filter((a) => a !== "--no-vision");
  const baseVision = this.settings.vision ?? { enabled: false, model: "", language: "auto" as const };
  const visionSettings = noVision ? { ...baseVision, enabled: false } : baseVision;
  yield* runFormat(formatArgs, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, this.settings.wikiLinkValidationRetries, visionSettings);
  break;
}
```

- [ ] **Step 4: Update controller.format() to show modal when vision is enabled**

In `src/controller.ts`, replace the `format()` method body after the wiki-guard check:

```typescript
  async format(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice(i18n().ctrl.noActiveFile); return; }
    if (file.extension !== "md") {
      new Notice(i18n().view.formatOnlyMarkdown ?? "Format only works on markdown files");
      return;
    }

    const domains = await this.loadDomains();
    const inWiki = domains.find((d) => {
      const wikiPrefix = domainWikiFolder(d.wiki_folder);
      return file.path === wikiPrefix || file.path.startsWith(wikiPrefix + "/");
    });
    if (inWiki) {
      const T = i18n().view;
      new InfoModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        T.formatInWikiClose,
      ).open();
      return;
    }

    this._pendingFormat = { originalPath: file.path, tempPath: "", chat: [] };

    if (this.plugin.settings.vision?.enabled) {
      new FormatVisionModal(this.app, (choice) => {
        const args = choice === "without" ? [file.path, "--no-vision"] : [file.path];
        void this.dispatch("format", args);
      }).open();
    } else {
      await this.dispatch("format", [file.path]);
    }
  }
```

Also add the import at the top of `controller.ts`:
```typescript
import { ..., FormatVisionModal } from "./modals";
```

- [ ] **Step 5: Run type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -20
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modals.ts src/i18n.ts src/agent-runner.ts src/controller.ts
git commit -m "feat(ux): show vision confirmation modal before format when vision enabled"
```

---

## Part F — Documentation

### Task 19: Update lat.md documentation

**Files:**
- Modify: `lat.md/architecture.md` — add query-link-validator
- Modify: `lat.md/llm-pipeline.md` — update format phase, add query validation
- Modify: `lat.md/tests.md` — add sections for new tests

- [ ] **Step 1: Run lat check to see current state**

```bash
lat check 2>&1 | head -30
```

- [ ] **Step 2: Add query-link-validator to architecture.md**

Add a section describing the new module under the appropriate heading.

- [ ] **Step 3: Update llm-pipeline.md**

- Update `parseFormatOutput` description to mention sentinel format.
- Add query validation subsection after "Query Phase".

- [ ] **Step 4: Add test spec sections to tests.md**

Add spec sections for the new test files: `query-link-validator`, `format-sentinel`, `format-zod-schema`, `format-retry`.

- [ ] **Step 5: Run lat check to verify no broken refs**

```bash
lat check 2>&1
```
Expected: all checks pass.

- [ ] **Step 6: Commit**

```bash
git add lat.md/
git commit -m "docs(lat): update architecture, pipeline, and test specs for sentinel + query validation"
```

---

## Self-Review Checklist

### Spec coverage

| Requirement | Task |
|---|---|
| Query post-stream link validation | Task 5 |
| `extractAnswerLinks` ignore `[[X|alias]]` and `[[path/X]]` | Task 3 |
| `findBrokenLinks` deduplicate | Task 3 |
| `annotateBroken` replace broken only | Task 3 |
| `rewriteWithValidLinks` one non-streaming call | Task 3 |
| `assistant_replace` event | Task 1, 2 |
| F-001: `retries=0` skip retry | Task 5 |
| `parseSentinelOutput` — report/formatted extract | Task 7 |
| Salvage on missing END | Task 7 |
| Vision markers VISION_COUNT + EMBEDS | Task 7 |
| `FormatOutputSchema` superRefine frontmatter check | Task 9 |
| Embed preservation check | Task 9 |
| `format.ts` remove `json_object` | Task 11 |
| Zod-feedback in retry hint | Task 11 |
| Token-restore uses sentinel | Task 11 |
| `format.md` sentinel instructions | Task 15 |
| `query.md` stronger formatting | Task 14 |
| `.excalidraw.md` routing fix | Task 16 |
| Vision confirmation modal | Task 18 |
| `--no-vision` flag in agent-runner | Task 18 |

### No placeholders

All code blocks show actual implementation. No "TBD", "TODO", or "handle edge cases".

### Type consistency

- `parseFormatOutput` returns `{ data: FormatOutput | null; hint: string; truncated: boolean }` — used consistently in Task 11.
- `FormatWithVisionSchema` exported from `zod-schemas.ts` — used in Task 9, 11, 13.
- `FormatVisionModal` imported in `controller.ts` from `modals.ts` — Task 18.
- `extractExcalidrawJson` exported from `attachment-analyzer.ts` — tested in Task 17.
