---
state: draft
date: 2026-05-16
review:
  plan_hash: 851902b385c321cc
  spec_hash: e977842b57acbe29
  last_run: 2026-05-16
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Mobile Query Streaming + Reinit Nested Folder Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two independent mobile/reinit bugs — mobile native-agent query now returns a result instead of hanging on SSE, and reinit no longer nests an existing domain inside itself.

**Architecture:**
- Introduce isolated mobile shim `wrapMobileNoStream` that converts streaming `chat.completions.create` calls into non-stream calls and re-emits result as a single-shot `AsyncIterable<ChatCompletionChunk>`, so phase code stays unchanged. Apply in `controller.ts` before `AgentRunner` constructor (which wraps with `wrapWithJsonFallback`).
- In `phases/init.ts` bootstrap path, when `force=true && existing`, overwrite `entry.wiki_folder` with `existing.wiki_folder` so LLM-suggested folder cannot replace the locked path.
- In `view.ts setRunning()`, on mobile inject a placeholder "waiting" step that disappears on first real event, so UI doesn't look frozen during non-stream wait.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Platform.isMobile`), OpenAI Node SDK (`OpenAI.Chat.ChatCompletion`, `ChatCompletionChunk`), vitest.

**Spec:** `docs/superpowers/specs/2026-05-16-mobile-query-and-reinit-fix-design.md`

---

## File Map

| File | Role |
|---|---|
| `src/mobile-llm-wrap.ts` (new) | `wrapMobileNoStream(inner)` — coerces stream:true → stream:false and re-emits as 1–3-chunk async iterable |
| `src/controller.ts` (modify ~line 467) | Apply `wrapMobileNoStream` to OpenAI client on `Platform.isMobile` before passing to `AgentRunner` |
| `src/phases/init.ts` (modify ~line 322–333) | On force+existing, force `entry.wiki_folder = existing.wiki_folder` before normalization/usage |
| `src/view.ts` (modify `setRunning`, ~line 331) | Mobile-only placeholder step using `i18n().view.mobileWaiting`; clear on first real event |
| `src/i18n.ts` (modify 3 locales) | Add `view.mobileWaiting` to ru/en/es blocks |
| `tests/mobile-llm-wrap.test.ts` (new) | Unit test for `wrapMobileNoStream` (3 cases) |
| `tests/phases/init.force.test.ts` (extend) | Test reinit preserves `existing.wiki_folder` even when LLM returns different path |

---

## Task 1: Create `src/mobile-llm-wrap.ts`

**Files:**
- Create: `src/mobile-llm-wrap.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mobile-llm-wrap.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { wrapMobileNoStream } from "../src/mobile-llm-wrap";
import type { LlmClient } from "../src/types";
import type OpenAI from "openai";

function makeCompletion(content: string, reasoning?: string): OpenAI.Chat.ChatCompletion {
  return {
    id: "cmpl-1",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(reasoning ? { reasoning } : {}),
      } as OpenAI.Chat.ChatCompletionMessage,
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function makeInner(completion: OpenAI.Chat.ChatCompletion): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(completion),
      },
    },
  } as unknown as LlmClient;
}

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("wrapMobileNoStream", () => {
  it("rewrites stream:true to stream:false and yields content + final chunk", async () => {
    const inner = makeInner(makeCompletion("hello world"));
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "hi" }], stream: true } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    );
    const chunks = await drain(result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello world");
    expect(chunks[1].choices[0].finish_reason).toBe("stop");
    expect(chunks[1].usage?.total_tokens).toBe(30);
    const createMock = inner.chat.completions.create as ReturnType<typeof vi.fn>;
    const callArgs = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.stream).toBe(false);
    expect(callArgs.stream_options).toBeUndefined();
  });

  it("yields reasoning chunk before content when reasoning present", async () => {
    const inner = makeInner(makeCompletion("answer", "thinking..."));
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [], stream: true } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    );
    const chunks = await drain(result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>);
    expect(chunks).toHaveLength(3);
    expect((chunks[0].choices[0].delta as { reasoning?: string }).reasoning).toBe("thinking...");
    expect(chunks[1].choices[0].delta.content).toBe("answer");
    expect(chunks[2].choices[0].finish_reason).toBe("stop");
  });

  it("passes non-stream calls through unchanged", async () => {
    const completion = makeCompletion("plain");
    const inner = makeInner(completion);
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [], stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    expect(result).toBe(completion);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-llm-wrap.test.ts`
Expected: FAIL with "Cannot find module '../src/mobile-llm-wrap'".

- [ ] **Step 3: Implement `src/mobile-llm-wrap.ts`**

```ts
import type { LlmClient } from "./types";
import type OpenAI from "openai";

/**
 * Mobile-only wrapper: forces stream:false (requestUrl/mobileFetch не поддерживает
 * incremental SSE). Эмулирует AsyncIterable из non-stream completion для совместимости
 * с phase-кодом, который ожидает chunk-stream.
 */
export function wrapMobileNoStream(inner: LlmClient): LlmClient {
  const create = (async (
    params: Record<string, unknown>,
    callOpts?: { signal?: AbortSignal },
  ) => {
    if (params.stream !== true) {
      return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
    }
    const noStreamParams = { ...params, stream: false } as Record<string, unknown>;
    delete noStreamParams.stream_options;
    const resp = (await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<OpenAI.Chat.ChatCompletion>)(
      noStreamParams,
      callOpts,
    )) as OpenAI.Chat.ChatCompletion;
    return completionToAsyncIterable(resp);
  }) as unknown as LlmClient["chat"]["completions"]["create"];
  return { chat: { completions: { create } } };
}

async function* completionToAsyncIterable(
  c: OpenAI.Chat.ChatCompletion,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const choice = c.choices[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const reasoning = (choice?.message as { reasoning?: string } | undefined)?.reasoning;

  if (reasoning) {
    yield mkChunk(c, { reasoning } as Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>);
  }
  if (content) {
    yield mkChunk(c, { content });
  }
  yield mkChunk(c, {}, choice?.finish_reason ?? "stop", c.usage ?? null);
}

function mkChunk(
  base: OpenAI.Chat.ChatCompletion,
  delta: Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>,
  finish_reason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"] | null = null,
  usage: OpenAI.CompletionUsage | null = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: base.id,
    object: "chat.completion.chunk",
    created: base.created,
    model: base.model,
    choices: [{
      index: 0,
      delta: delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta,
      finish_reason,
      logprobs: null,
    }],
    usage: usage ?? undefined,
  } as OpenAI.Chat.ChatCompletionChunk;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mobile-llm-wrap.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mobile-llm-wrap.ts tests/mobile-llm-wrap.test.ts
git commit -m "feat(mobile): add wrapMobileNoStream shim coercing SSE to single-shot"
```

---

## Task 2: Apply `wrapMobileNoStream` in controller

**Files:**
- Modify: `src/controller.ts` (import section + lines ~467–473)

- [ ] **Step 1: Add import**

At top of `src/controller.ts`, near other local imports (after `import { mobileFetch } from "./mobile-fetch";`), add:

```ts
import { wrapMobileNoStream } from "./mobile-llm-wrap";
```

- [ ] **Step 2: Wrap llm on mobile before AgentRunner construction**

Find the block at `src/controller.ts:467-473`:

```ts
      llm = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: maxTimeoutSec * 1000,
        dangerouslyAllowBrowser: true,
        fetch: Platform.isMobile ? mobileFetch : (proxyFetch ?? undefined),
      });
    }
```

Replace with:

```ts
      const openaiClient = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: maxTimeoutSec * 1000,
        dangerouslyAllowBrowser: true,
        fetch: Platform.isMobile ? mobileFetch : (proxyFetch ?? undefined),
      });
      llm = (Platform.isMobile
        ? wrapMobileNoStream(openaiClient as unknown as import("./types").LlmClient)
        : openaiClient) as unknown as import("./types").LlmClient;
    }
```

Rationale: `llm` is declared as `import("./types").LlmClient` at line 402; `OpenAI` is structurally compatible. The wrapping must happen here (before line 476 `new AgentRunner(llm, ...)`), so that `AgentRunner` constructor's `wrapWithJsonFallback` wraps the already-coerced non-stream client.

- [ ] **Step 3: Build to verify TypeScript compiles**

Run: `npm run build`
Expected: clean build, `main.js` produced.

- [ ] **Step 4: Run full test suite to confirm no regression**

Run: `npm test`
Expected: all existing tests pass; `mobile-llm-wrap.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(mobile): apply wrapMobileNoStream to native-agent OpenAI client"
```

---

## Task 3: Preserve `existing.wiki_folder` on reinit (force)

**Files:**
- Modify: `src/phases/init.ts` (bootstrap block, after line 326 `wiki_folder: parsed.wiki_folder`)
- Test: `tests/phases/init.force.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/phases/init.force.test.ts` (inside the existing `describe("runInitWithSources force", ...)` block, before its closing `})`):

```ts
  it("preserves existing.wiki_folder when force=true even if LLM returns a different path", async () => {
    const files = ["docs/a.md"];
    const adapter = adapterWithSourceFiles(files);
    const vt = new VaultTools(adapter, "");
    const existing: DomainEntry = {
      id: "adm",
      name: "ADM",
      wiki_folder: "adm",
      source_paths: ["docs"],
      analyzed_sources: [],
      entity_types: [],
      language_notes: "",
    };
    // LLM returns nested path "adm/adm" — must be overridden by existing.wiki_folder.
    const llm = makeMultiLlm([validBootstrapResponse("adm", "adm/adm")]);
    const events = await collect(runInitWithSources(
      llm, "m", { maxTokens: 1024 } as never,
      vt, "Vault", "adm", ["docs"], [existing],
      new AbortController().signal,
      false,
      true, // force
    ));
    const updated = events.find((e) => e.kind === "domain_updated") as { kind: "domain_updated"; patch: { wiki_folder?: string } } | undefined;
    expect(updated).toBeDefined();
    expect(updated!.patch.wiki_folder).toBe("adm");
  });
```

Note: confirm `runInitWithSources` parameter order against current source — if the actual signature differs, adjust positional args to match (other tests in the file demonstrate the canonical call shape; copy from them).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phases/init.force.test.ts -t "preserves existing.wiki_folder"`
Expected: FAIL — actual `wiki_folder` is `"adm/adm"` (LLM-supplied) instead of `"adm"`.

- [ ] **Step 3: Implement fix in `src/phases/init.ts`**

In the bootstrap block, locate the `entry = { ... }` assignment ending at line ~333 with `if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");`. Immediately after that line, add:

```ts
        // На reinit (force=true) wiki_folder уже зафиксирован — LLM не должен его менять.
        if (force && existing) {
          entry.wiki_folder = existing.wiki_folder;
        }
```

The insertion sits inside the `try { ... } catch` block, after normalization (strip `vaults/...` and `!Wiki/` prefixes) and validation, before the value flows into `currentDomain.wiki_folder` at line ~352.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phases/init.force.test.ts -t "preserves existing.wiki_folder"`
Expected: PASS.

- [ ] **Step 5: Run full init test files to confirm no regression**

Run: `npx vitest run tests/phases/init.test.ts tests/phases/init.force.test.ts tests/phases/init-thinking.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/init.ts tests/phases/init.force.test.ts
git commit -m "fix(init): preserve existing.wiki_folder on force reinit"
```

---

## Task 4: Add `view.mobileWaiting` i18n key (ru/en/es)

**Files:**
- Modify: `src/i18n.ts` (3 `view:` blocks at lines ~87 (en), ~294 (ru), ~499 (es))

- [ ] **Step 1: Add key to English `view:` block (line ~87)**

Inside the en `view: { ... }` object, add (place near top of the block, e.g. right after `refreshTitle`):

```ts
    mobileWaiting: "⏳ Waiting for LLM response…",
```

- [ ] **Step 2: Add key to Russian `view:` block (line ~294)**

```ts
    mobileWaiting: "⏳ Ожидание ответа от LLM…",
```

- [ ] **Step 3: Add key to Spanish `view:` block (line ~499)**

```ts
    mobileWaiting: "⏳ Esperando respuesta del LLM…",
```

- [ ] **Step 4: Build to verify TypeScript shape consistency across locales**

Run: `npm run build`
Expected: clean build (i18n types are inferred from `en`; ru/es must include the key or TS errors).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "i18n: add view.mobileWaiting (en/ru/es)"
```

---

## Task 5: Mobile placeholder step in `setRunning`

**Files:**
- Modify: `src/view.ts` (`setRunning` method ~line 331; `appendEvent` clear logic)

- [ ] **Step 1: Verify `Platform` import in view.ts**

Run: `grep -n "from \"obsidian\"" src/view.ts`
If `Platform` is not in the imported names, add it to the existing `import { ... } from "obsidian";` line.

- [ ] **Step 2: Inject placeholder in `setRunning`**

At the end of `setRunning` (just before the closing `}` of the method, after `this.scheduleMetricsTick();` line ~380), add:

```ts
    if (Platform.isMobile) {
      // Streaming недоступен на mobile — показываем спиннер, чтобы UI не выглядел замёрзшим.
      const placeholder = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step-pending");
      placeholder.setText(i18n().view.mobileWaiting);
      this.mobileWaitingEl = placeholder;
    }
```

- [ ] **Step 3: Add field declaration**

Near the other private field declarations at the top of the `LlmWikiView` class, add:

```ts
  private mobileWaitingEl: HTMLElement | null = null;
```

Also reset it in `setRunning` near the other `null` resets (e.g. alongside `this.progressEl = null;`):

```ts
    this.mobileWaitingEl = null;
```

(Place this reset **before** the `if (Platform.isMobile)` block that creates the new placeholder.)

- [ ] **Step 4: Clear placeholder on first real event**

In `appendEvent(ev: RunEvent)` (line ~383), at the very top of the method body, add:

```ts
    if (this.mobileWaitingEl) {
      this.mobileWaitingEl.remove();
      this.mobileWaitingEl = null;
    }
```

This fires on the first event of any kind after `setRunning` — matches spec ("Удаляется при первом реальном событии").

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Run test suite (sanity check — view has no direct tests but other tests may import it)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): mobile waiting placeholder during non-stream query"
```

---

## Task 6: Bump patch version and final build

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 1: Read current version**

Run: `grep '"version"' package.json src/manifest.json`

- [ ] **Step 2: Bump patch in both files**

Increment patch (`X.Y.Z` → `X.Y.(Z+1)`) in both `package.json` and `src/manifest.json`. Use Edit tool with exact old/new strings.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `main.js` produced cleanly.

- [ ] **Step 4: Run full test suite final time**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add package.json src/manifest.json
git commit -m "chore: bump patch version for mobile query + reinit fix"
```

---

## Manual Verification (post-implementation, mobile required)

These steps cannot be automated — perform on a real mobile Obsidian after installing the new build:

- [ ] Open vault on mobile, run Ask query against native-agent backend. Observe:
  - `▶ query` status appears.
  - Placeholder "⏳ Ожидание ответа от LLM…" visible during wait.
  - Placeholder disappears on first event; result renders before `timeouts.query`.
- [ ] Reinit existing domain `adm` (with `wiki_folder: "adm"`). Confirm:
  - After completion, `wiki_folder` is still `"adm"` (not `"adm/adm"`).
  - No nested folder `!Wiki/adm/adm` was created in vault.

---

## Out of Scope (per spec)

- True streaming on mobile via native `fetch` (CORS-blocked, separate effort).
- Changes to `claude-agent` backend (mobile force-converts to native-agent in `main.ts:208`).
- Pre-validation for non-force `init` path.
