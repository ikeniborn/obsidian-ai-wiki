---
chain:
  intent: n/a
  spec: docs/superpowers/specs/2026-07-15-domain-metadata-and-live-stream-design.md
review:
  plan_hash: 20449c1d7a6501a3
  last_run: 2026-07-15
  phases:
    - name: structure
      status: passed
    - name: coverage
      status: passed
    - name: dependencies
      status: passed
    - name: verifiability
      status: passed
    - name: consistency
      status: passed
  findings:
    - id: F-001
      phase: consistency
      severity: WARNING
      section: "Task 5: Switch init + ingest callsites to live streaming (F4c)"
      section_hash: e6d1405136c55a54
      fragment: "the reasoning now streams live via the framed profile's reasoning deltas"
      text: >-
        Dropping the ingest.ts:273 post-parse reasoning emit was wrong for
        framed-zod: wikiPagesProfile reasoning comes from the <<<REPORT>>> frame
        in the content stream (emitted as non-isReasoning → 💬 status), not a
        native 🧠 stream. Models without a native reasoning channel would lose
        the synthesise reasoning block.
      fix: >-
        Keep the :273 emit; corrected the rationale in the plan and the spec F4
        per-callsite DoD.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Task 5: Switch init + ingest callsites to live streaming (F4c)"
      section_hash: e6d1405136c55a54
      fragment: "Keep the parseWithRetry import — it is still used elsewhere is NOT the case here"
      text: >-
        Garbled import note and a wrong step reference ("Verify in Step 7" —
        the lint check is Step 8). After Task 5 parseWithRetry/runStructuredWithRetry
        are unused in init.ts/ingest.ts and must be removed.
      fix: >-
        Reworded the import steps to remove the now-unused imports; corrected the
        step reference to Step 8.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "Task 5: Switch init + ingest callsites to live streaming (F4c)"
      section_hash: e6d1405136c55a54
      fragment: "currently lines 132-153 / 248-273 / 417-437"
      text: >-
        Off-by-1/2 "currently lines X-Y" citations for the ingest extract,
        synthesise, and merge blocks (content matched, ranges were short).
      fix: >-
        Corrected to 132-154, 248-274, 417-439.
      verdict: fixed
      verdict_at: 2026-07-15
result_check:
  verdict: OK
  plan_hash: 20449c1d7a6501a3
  last_run: 2026-07-15
---
# Robust Domain Metadata & Live LLM Stream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make domain-creation persistence robust (a created domain is always selectable) and stream the LLM's reasoning/tokens live during the init + ingest structured steps.

**Architecture:** Two independent fixes. (1) `DomainStore.save` writes `metadata.jsonl` in place with a post-write existence check instead of the flaky tmp+rename; `registerDomain` surfaces a save failure; `DomainStore.load` self-heals a domain folder that has content but no metadata. (2) The structured-output layer emits per-chunk `assistant_text` deltas via `onEvent`, and a new `runStructuredStreaming` async-generator bridge lets init/ingest `yield` those events live instead of buffering them until after the call.

**Tech Stack:** TypeScript, Obsidian plugin API (`Vault.adapter`), OpenAI streaming chat completions, `node:test` + `tsx` for tests.

## Global Constraints

- Tests run with: `npx tsx --test tests/<file>.test.ts` (no `package.json` test script). Full suite: `npx tsx --test tests/*.test.ts`.
- Build: `npm run build` (esbuild). Lint: `npm run lint` (eslint over `src/**/*.ts`).
- Docs language: English (code comments, commit messages).
- Do NOT change the domain-discovery contract: a domain is a subfolder of `!Wiki/` containing `metadata.jsonl` at `!Wiki/<folder>/metadata.jsonl`.
- Out of scope (do NOT touch): `DomainCorruptError` fatal-on-one-bad-file behavior; streaming for `lint` / `format` / `query` callsites.
- Reuse existing i18n keys `ctrl.domainAddFailed` and `ctrl.domainAdded` — do not add new ones.

---

### Task 1: Robust `DomainStore.save` + surfaced `registerDomain` failure (F1/F2)

**Files:**
- Modify: `src/domain-store.ts:77-85` (the per-domain write loop in `save`)
- Modify: `src/controller.ts:459-481` (`registerDomain`)
- Test: `tests/domain-store-robust-save.test.ts` (create)

**Interfaces:**
- Consumes: `stringifyDomainMetadata`, `domainEntryToMetadataRecords` (already imported in `domain-store.ts`); `domainMetadataPath`, `domainWikiFolder` (already imported).
- Produces: `DomainStore.save(domains)` throws `Error("domain metadata write failed: <path>")` when the file is not on disk after writing; `registerDomain(input)` resolves to `{ ok: false, error }` (never rejects) when `save` throws.

- [ ] **Step 1: Write the failing test**

Create `tests/domain-store-robust-save.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

// Adapter whose rename ALWAYS throws — reproduces the Obsidian failure that
// left folders with content but no metadata.jsonl. `write` behaves normally.
class RenameHostileAdapter {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/"));
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(): Promise<void> { throw new Error("rename not supported"); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}

// Adapter whose write is a no-op — the file never lands, so save must throw.
class WriteBlackholeAdapter extends RenameHostileAdapter {
  async write(): Promise<void> { /* swallow */ }
}

function vault(adapter: unknown): any {
  return { adapter, createFolder: async (path: string) => { (adapter as any).files.set(`${path}/.keep`, ""); } };
}

test("save persists metadata even when adapter.rename throws", async () => {
  const adapter = new RenameHostileAdapter();
  const store = new DomainStore(vault(adapter));
  await store.save([{ id: "foo", name: "Foo", wiki_folder: "foo", source_paths: ["src"], entity_types: [] }]);
  assert.equal(await adapter.exists("!Wiki/foo/metadata.jsonl"), true);
  assert.deepEqual((await store.load()).map((d) => d.id), ["foo"]);
});

test("save throws when the metadata file is not on disk after writing", async () => {
  const adapter = new WriteBlackholeAdapter();
  const store = new DomainStore(vault(adapter));
  await assert.rejects(
    store.save([{ id: "foo", name: "Foo", wiki_folder: "foo", source_paths: [], entity_types: [] }]),
    /domain metadata write failed/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/domain-store-robust-save.test.ts`
Expected: FAIL — the first test throws `rename not supported` (old code calls `adapter.rename`).

- [ ] **Step 3: Rewrite the `save` write loop**

In `src/domain-store.ts`, replace the per-domain loop (currently lines 77-85):

```ts
    for (const domain of domains) {
      const folder = domainWikiFolder(domain.wiki_folder);
      if (!(await adapter.exists(folder))) await this.vault.createFolder(folder).catch(() => {});
      const path = domainMetadataPath(folder);
      const tmpPath = `${path}.tmp`;
      await adapter.write(tmpPath, stringifyDomainMetadata(domainEntryToMetadataRecords(domain)));
      if (await adapter.exists(path)) await adapter.remove(path);
      await adapter.rename(tmpPath, path);
    }
```

with:

```ts
    for (const domain of domains) {
      const folder = domainWikiFolder(domain.wiki_folder);
      if (!(await adapter.exists(folder))) await this.vault.createFolder(folder).catch(() => {});
      const path = domainMetadataPath(folder);
      const tmpPath = `${path}.tmp`;
      // Clean up a leftover tmp from a previously-interrupted write.
      if (await adapter.exists(tmpPath)) await adapter.remove(tmpPath).catch(() => {});
      // Direct in-place write. Obsidian's adapter.rename is the flaky step that
      // left domain folders with content but no metadata.jsonl; a small local
      // file does not need the tmp+rename dance. Verify the file landed.
      await adapter.write(path, stringifyDomainMetadata(domainEntryToMetadataRecords(domain)));
      if (!(await adapter.exists(path))) {
        throw new Error(`domain metadata write failed: ${path}`);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/domain-store-robust-save.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression-check the existing store test**

Run: `npx tsx --test tests/domain-store-jsonl.test.ts`
Expected: PASS (3 tests) — unchanged.

- [ ] **Step 6: Surface the failure in `registerDomain`**

In `src/controller.ts`, replace the tail of `registerDomain` (currently lines 478-480):

```ts
    await this.domainStore.save(next);
    new Notice(i18n().ctrl.domainAdded(id));
    return { ok: true };
```

with:

```ts
    try {
      await this.domainStore.save(next);
    } catch (e) {
      const msg = (e as Error).message;
      new Notice(i18n().ctrl.domainAddFailed(msg));
      return { ok: false, error: msg };
    }
    new Notice(i18n().ctrl.domainAdded(id));
    return { ok: true };
```

- [ ] **Step 7: Build + lint (verifies the controller wiring compiles)**

Run: `npm run build && npm run lint`
Expected: build succeeds, no eslint errors. (The `openAddDomain` flow at `src/view.ts:484-490` already checks `if (!r.ok) return;`, so a failed persist now stops before `init`.)

- [ ] **Step 8: Commit**

```bash
git add src/domain-store.ts src/controller.ts tests/domain-store-robust-save.test.ts
git commit -m "fix(domain-store): direct metadata write + verify; surface registerDomain save failure"
```

---

### Task 2: Self-heal missing metadata on `load` via tmp-promotion (F3)

**Files:**
- Modify: `src/domain-store.ts:19-54` (`load`) — add tmp-promotion recovery; add private helper `promoteTmpMetadata`
- Test: `tests/domain-store-selfheal.test.ts` (create)

**Interfaces:**
- Consumes: `parseDomainMetadata` (imported); `domainMetadataPath` (imported). No new wiki-path imports.
- Produces: `DomainStore.load()` promotes a leftover `metadata.jsonl.tmp` to `metadata.jsonl` and returns that domain; a folder missing `metadata.jsonl` with **no** `.tmp` is left untouched (never resurrected).

**Design note:** self-heal recovers ONLY from a leftover `metadata.jsonl.tmp` — the unambiguous signature of the old `save`'s interrupted `write(tmp)`→`rename` failure. It deliberately does NOT reconstruct a domain from bare folder content: Delete-domain (`settings.ts:398-402`) does `save(filter)`, which removes `metadata.jsonl` but leaves `index.jsonl`+pages, so content-based recovery would resurrect deleted domains (zombies). Delete never leaves a `.tmp`, so tmp-promotion has no such collision.

- [ ] **Step 1: Write the failing test**

Create `tests/domain-store-selfheal.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

class MemoryAdapter {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/"));
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from); this.files.delete(from); this.files.set(to, v);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}
function vault(adapter: MemoryAdapter): any {
  return { adapter, createFolder: async (path: string) => { adapter.files.set(`${path}/.keep`, ""); } };
}

test("load promotes a leftover metadata.jsonl.tmp to metadata.jsonl", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "!Wiki/bar/metadata.jsonl.tmp",
    '{"kind":"domain","schemaVersion":1,"id":"bar","name":"Bar","wiki_folder":"bar","source_paths":[]}\n',
  );
  const store = new DomainStore(vault(adapter));
  const domains = await store.load();
  assert.deepEqual(domains.map((d) => d.id), ["bar"]);
  assert.equal(await adapter.exists("!Wiki/bar/metadata.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/bar/metadata.jsonl.tmp"), false);
});

test("load leaves a content-only folder with no tmp untouched (deleted-domain safety)", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/foo/index.jsonl", "");
  adapter.files.set("!Wiki/foo/concepts/x.md", "# X\n");
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), []);
  assert.equal(await adapter.exists("!Wiki/foo/metadata.jsonl"), false);
  // content is left in place — self-heal never removes pages/index
  assert.equal(await adapter.exists("!Wiki/foo/index.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/foo/concepts/x.md"), true);
});

test("load leaves a corrupt metadata.jsonl.tmp intact (does not promote or delete it)", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/bad/metadata.jsonl.tmp", "not valid jsonl {{{");
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), []);
  // corrupt tmp must NOT be promoted into a corrupt metadata.jsonl, and must be preserved
  assert.equal(await adapter.exists("!Wiki/bad/metadata.jsonl"), false);
  assert.equal(await adapter.exists("!Wiki/bad/metadata.jsonl.tmp"), true);
});

test("load ignores an empty folder", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/empty/.keep", "");
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/domain-store-selfheal.test.ts`
Expected: FAIL — the tmp-promotion test returns `[]` (old `load` skips a folder whose `metadata.jsonl` is absent). The three negative tests (content-only, corrupt-tmp, empty) already pass.

- [ ] **Step 3: Add tmp-promotion to the `load` scan loop**

In `src/domain-store.ts`, inside `load`, replace the folder loop (currently lines 22-35):

```ts
    if (await adapter.exists(WIKI_DIR)) {
      const listed = await adapter.list(WIKI_DIR);
      for (const folder of [...listed.folders].sort()) {
        const name = folder.split("/").pop() ?? folder;
        if (name.startsWith(".") || name.startsWith("_")) continue;
        const path = domainMetadataPath(folder);
        if (!(await adapter.exists(path))) continue;
        try {
          domains.push(parseDomainMetadata(await adapter.read(path), path, name));
        } catch (e) {
          throw new DomainCorruptError(`${path}: ${(e as Error).message}`);
        }
      }
    }
```

with:

```ts
    let healed = false;
    if (await adapter.exists(WIKI_DIR)) {
      const listed = await adapter.list(WIKI_DIR);
      for (const folder of [...listed.folders].sort()) {
        const name = folder.split("/").pop() ?? folder;
        if (name.startsWith(".") || name.startsWith("_")) continue;
        const path = domainMetadataPath(folder);
        if (!(await adapter.exists(path))) {
          const recovered = await this.promoteTmpMetadata(adapter, folder, name);
          if (!recovered) continue;
          domains.push(recovered);
          healed = true;
          continue;
        }
        try {
          domains.push(parseDomainMetadata(await adapter.read(path), path, name));
        } catch (e) {
          throw new DomainCorruptError(`${path}: ${(e as Error).message}`);
        }
      }
    }
```

- [ ] **Step 4: Persist promoted domains**

In the same `load`, change the migration-save line (currently line 52):

```ts
    if (m2 || m3) await this.save(domains);
```

to:

```ts
    if (m2 || m3 || healed) await this.save(domains);
```

- [ ] **Step 5: Add the tmp-promotion helper**

In `src/domain-store.ts`, add this private method to the `DomainStore` class (e.g. after `save`). `DomainEntry` is already imported at line 2.

```ts
  /**
   * Recover a domain whose metadata write was interrupted: the old tmp+rename
   * save left a `metadata.jsonl.tmp` with no `metadata.jsonl`. Promote the tmp
   * to the final path so the domain is selectable again. Returns null when
   * there is no tmp — a folder with content but no tmp is left alone, because
   * that is indistinguishable from an intentionally deleted domain (Delete
   * removes metadata.jsonl but leaves the folder; it never leaves a tmp).
   *
   * Parse BEFORE mutating: a corrupt tmp must be left intact (never written to
   * the final path, never deleted), so it can be inspected manually instead of
   * becoming a corrupt metadata.jsonl that throws DomainCorruptError on every
   * future load.
   */
  private async promoteTmpMetadata(
    adapter: Vault["adapter"],
    folder: string,
    name: string,
  ): Promise<DomainEntry | null> {
    const path = domainMetadataPath(folder);
    const tmpPath = `${path}.tmp`;
    if (!(await adapter.exists(tmpPath))) return null;
    let entry: DomainEntry;
    try {
      const raw = await adapter.read(tmpPath);
      entry = parseDomainMetadata(raw, path, name); // throws first — nothing mutated yet
      await adapter.write(path, raw);
    } catch {
      // Corrupt/unreadable tmp — leave it (and any partial state) for manual inspection.
      return null;
    }
    await adapter.remove(tmpPath).catch(() => {});
    return entry;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test tests/domain-store-selfheal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Regression-check + build + lint**

Run: `npx tsx --test tests/domain-store-jsonl.test.ts tests/domain-store-robust-save.test.ts && npm run build && npm run lint`
Expected: all tests PASS (incl. the existing "removes metadata for domains omitted from save"), build succeeds, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/domain-store.ts tests/domain-store-selfheal.test.ts
git commit -m "fix(domain-store): recover a domain from a leftover metadata.jsonl.tmp on load"
```

---

### Task 3: Emit live stream deltas from `streamOnce` (F4a)

**Files:**
- Modify: `src/phases/structured-output.ts:171-212` (`streamOnce`) and `:229-254` (`callWithFormatFallback`)
- Test: `tests/structured-output.test.ts` (append)

**Interfaces:**
- Consumes: `extractStreamDeltas` (already imported, returns `{ reasoning, content, outputTokens, inputTokens }`); `RunEvent` (already imported).
- Produces: during a streaming structured call, `onEvent` receives `{ kind: "assistant_text", delta: <reasoning>, isReasoning: true }` per reasoning chunk and `{ kind: "assistant_text", delta: <content> }` per content chunk.

- [ ] **Step 1: Write the failing test**

Append to `tests/structured-output.test.ts`:

```ts
function reasoningChunk(reasoning: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "r", object: "chat.completion.chunk", created: 0, model: "m",
    choices: [{ index: 0, delta: { reasoning } as unknown as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: null }],
  };
}

test("streaming structured call emits reasoning and content deltas live", async () => {
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async () => (async function* () {
      yield reasoningChunk("thinking hard");
      yield chunk('{"value":"ok"}');
      yield usageChunk();
    })() } },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }],
    opts: {}, profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1, callSite: "query.seeds",
    signal: new AbortController().signal, onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "ok");
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && ev.isReasoning === true && ev.delta === "thinking hard"),
    true,
  );
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && !ev.isReasoning && ev.delta.includes('"value"')),
    true,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/structured-output.test.ts`
Expected: FAIL on the new test — no `assistant_text` events are emitted today.

- [ ] **Step 3: Thread `onEvent` into `streamOnce`**

In `src/phases/structured-output.ts`, change the `streamOnce` signature (currently line 171-177):

```ts
async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<CallResult> {
```

to add `onEvent`:

```ts
async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
  onEvent: (ev: RunEvent) => void,
): Promise<CallResult> {
```

- [ ] **Step 4: Emit deltas in the chunk loop**

In `streamOnce`, replace the stream loop (currently lines 189-193):

```ts
    for await (const chunk of stream) {
      const { content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (content) fullText += content;
      if (tok !== undefined) outputTokens = tok;
    }
```

with:

```ts
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) onEvent({ kind: "assistant_text", delta: reasoning, isReasoning: true });
      if (content) {
        fullText += content;
        onEvent({ kind: "assistant_text", delta: content });
      }
      if (tok !== undefined) outputTokens = tok;
    }
```

- [ ] **Step 5: Pass `onEvent` from `callWithFormatFallback`**

In `src/phases/structured-output.ts`, update the `streamOnce` call inside `callWithFormatFallback` (currently line 243):

```ts
        result: await streamOnce(args.llm, args.model, messages, callOpts, args.signal),
```

to:

```ts
        result: await streamOnce(args.llm, args.model, messages, callOpts, args.signal, args.onEvent),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test tests/structured-output.test.ts`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 7: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/phases/structured-output.ts tests/structured-output.test.ts
git commit -m "feat(structured-output): emit live reasoning/content deltas during streaming calls"
```

---

### Task 4: `runStructuredStreaming` bridge helper (F4b)

**Files:**
- Modify: `src/phases/structured-output.ts` (add `StructuredSink` interface + `runStructuredStreaming` export, after `runStructuredWithRetry`)
- Test: `tests/structured-output.test.ts` (append)

**Interfaces:**
- Consumes: `runStructuredWithRetry` (same file); `RunEvent`, `RunStructuredArgs<T>` (same file).
- Produces:
  - `export interface StructuredSink<T> { value?: T; outputTokens?: number; fullText?: string }`
  - `export async function* runStructuredStreaming<T>(args: RunStructuredArgs<T>, sink: StructuredSink<T>): AsyncGenerator<RunEvent>` — yields every `RunEvent` (including live deltas) as it is produced, fills `sink` on success, and re-throws a structured failure out of the generator.

- [ ] **Step 1: Write the failing test**

Append to `tests/structured-output.test.ts` (add `runStructuredStreaming` to the destructured import from `../src/phases/structured-output` at the top of the file):

```ts
test("runStructuredStreaming yields events live and fills the sink", async () => {
  const seen: RunEvent[] = [];
  const sink: { value?: { value: string }; outputTokens?: number; fullText?: string } = {};
  const llm = {
    chat: { completions: { create: async () => (async function* () {
      yield reasoningChunk("live reasoning");
      yield chunk('{"value":"ok"}');
      yield usageChunk();
    })() } },
  } as unknown as LlmClient;

  for await (const ev of runStructuredStreaming({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }],
    opts: {}, profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1, callSite: "query.seeds",
    signal: new AbortController().signal, onEvent: () => {},
  }, sink)) {
    seen.push(ev);
  }

  assert.equal(sink.value?.value, "ok");
  assert.equal(seen.some((ev) => ev.kind === "assistant_text" && ev.isReasoning === true), true);
});

test("runStructuredStreaming propagates a structured failure", async () => {
  const sink: { value?: unknown } = {};
  await assert.rejects(async () => {
    for await (const _ev of runStructuredStreaming({
      llm: llmFromAttempts(["bad", "still bad"]),
      model: "m", baseMessages: [{ role: "user", content: "x" }],
      opts: {}, profile: { kind: "framed-zod", schema: AnswerSchema, parse: parseAnswerFrames, repairInstruction: "x" },
      maxRetries: 1, callSite: "query.answer",
      signal: new AbortController().signal, onEvent: () => {},
    }, sink)) { /* drain */ }
  }, StructuredValidationError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/structured-output.test.ts`
Expected: FAIL — `runStructuredStreaming` is not exported / not defined.

- [ ] **Step 3: Implement the bridge helper**

In `src/phases/structured-output.ts`, add after `runStructuredWithRetry` (after line 320):

```ts
export interface StructuredSink<T> {
  value?: T;
  outputTokens?: number;
  fullText?: string;
}

/**
 * Streaming wrapper over `runStructuredWithRetry`. Yields every RunEvent —
 * including the live reasoning/content deltas from streamOnce — as it is
 * produced, so a generator consumer can `yield*` them to the UI instead of
 * buffering until the call resolves. The parsed result lands in `sink`; a
 * structured failure is re-thrown out of the generator. `args.onEvent` is
 * ignored — the bridge installs its own.
 */
export async function* runStructuredStreaming<T>(
  args: RunStructuredArgs<T>,
  sink: StructuredSink<T>,
): AsyncGenerator<RunEvent> {
  const queue: RunEvent[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let error: unknown = null;
  const onEvent = (ev: RunEvent) => { queue.push(ev); wake?.(); };

  const p = runStructuredWithRetry({ ...args, onEvent })
    .then((r) => { sink.value = r.value; sink.outputTokens = r.outputTokens; sink.fullText = r.fullText; })
    .catch((e) => { error = e; })
    .finally(() => { settled = true; wake?.(); });

  while (!settled || queue.length) {
    while (queue.length) yield queue.shift()!;
    if (!settled) await new Promise<void>((res) => { wake = () => { wake = null; res(); }; });
  }
  await p;
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/structured-output.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/structured-output.ts tests/structured-output.test.ts
git commit -m "feat(structured-output): add runStructuredStreaming live-bridge helper"
```

---

### Task 5: Switch init + ingest callsites to live streaming (F4c)

**Files:**
- Modify: `src/phases/init.ts:222-249` (bootstrap) + imports
- Modify: `src/phases/ingest.ts:132-154` (extract), `:248-274` (synthesise), `:417-439` (merge) + imports
- Verify via: existing `tests/init-*.test.ts` + full suite + build + lint (the generators are already covered by these; no new unit test — a full end-to-end streaming test would need a whole vault + LLM mock that these existing tests already stand in for).

**Interfaces:**
- Consumes: `runStructuredStreaming`, `StructuredSink` from `./structured-output`; existing profiles `EntitiesOutputSchema`, `wikiPagesProfile()`, `mergedPageProfile()`, `DomainEntrySchema`.
- Produces: no new exports — the four callsites now `yield` structured events live instead of buffering them.

- [ ] **Step 1: Update `init.ts` imports**

In `src/phases/init.ts`, add a new import line for the streaming bridge:

```ts
import { runStructuredStreaming, type StructuredSink } from "./structured-output";
```

After this task `parseWithRetry` is no longer used in `init.ts` (its only use was the bootstrap call at line 226). Remove the now-unused `import { parseWithRetry } from "./parse-with-retry";` line. The lint check in Step 8 confirms no unused import remains.

- [ ] **Step 2: Rewrite the bootstrap structured call**

In `src/phases/init.ts`, replace the bootstrap block (currently lines 222-249):

```ts
      yield { kind: "tool_use", name: "Initialising domain", input: {} };
      const collected: RunEvent[] = [];
      let parsed: { id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: DomainEntrySchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.bootstrap",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
        yield { kind: "tool_result", ok: true, preview: `domain: ${parsed.id}` };
        if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield {
          kind: "error",
          message: `init: domain bootstrap failed — could not derive entity types (structured-output error: ${(e as Error).message}). Fix model/prompt and re-run.`,
        };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }
      for (const ev of collected) yield ev;
```

with:

```ts
      yield { kind: "tool_use", name: "Initialising domain", input: {} };
      const sink: StructuredSink<{ id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string }> = {};
      let parsed: { id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string };
      try {
        for await (const ev of runStructuredStreaming({
          llm, model, baseMessages: messages, opts,
          profile: { kind: "json-zod", schema: DomainEntrySchema },
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.bootstrap",
          signal,
          onEvent: () => {},
        }, sink)) {
          yield ev;
        }
        parsed = sink.value!;
        outputTokens += sink.outputTokens ?? 0;
        yield { kind: "tool_result", ok: true, preview: `domain: ${parsed.id}` };
        if (sink.fullText) yield { kind: "assistant_text", delta: sink.fullText };
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield {
          kind: "error",
          message: `init: domain bootstrap failed — could not derive entity types (structured-output error: ${(e as Error).message}). Fix model/prompt and re-run.`,
        };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }
```

- [ ] **Step 3: Verify init tests still pass**

Run: `npx tsx --test tests/init-bootstrap-fail-loud.test.ts tests/init-force-retry.test.ts tests/init-embedding-stop.test.ts`
Expected: PASS. (These assert on the presence of a `domain bootstrap failed` error and of `domain_created`/`result` events, not on event ordering, so live streaming does not break them.)

- [ ] **Step 4: Update `ingest.ts` imports**

In `src/phases/ingest.ts`, add:

```ts
import { runStructuredStreaming, type StructuredSink } from "./structured-output";
```

After Steps 5-7, `parseWithRetry` (only used by extract) and `runStructuredWithRetry` (only used by synthesise/merge) are both unused in `ingest.ts`. Remove whichever import lines become unused; the lint check in Step 8 confirms.

- [ ] **Step 5: Rewrite the ingest extract call**

In `src/phases/ingest.ts`, replace the extract block (currently lines 132-154):

```ts
  yield { kind: "tool_use", name: "Extracting entities", input: {} };
  const extractEvents: RunEvent[] = [];
  let entitiesResult: { value: EntitiesOutput; outputTokens: number };
  try {
    entitiesResult = await parseWithRetry({
      llm, model, baseMessages: messages_extract, opts,
      schema: EntitiesOutputSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.entities",
      signal,
      onEvent: (ev) => extractEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${entitiesResult.value.entities.length} entities` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of extractEvents) yield ev;
    yield { kind: "error", message: `ingest: entity extraction failed — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of extractEvents) yield ev;
  if (signal.aborted) return;
```

with:

```ts
  yield { kind: "tool_use", name: "Extracting entities", input: {} };
  const extractSink: StructuredSink<EntitiesOutput> = {};
  let entitiesResult: { value: EntitiesOutput; outputTokens: number };
  try {
    for await (const ev of runStructuredStreaming({
      llm, model, baseMessages: messages_extract, opts,
      profile: { kind: "json-zod", schema: EntitiesOutputSchema },
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.entities",
      signal,
      onEvent: () => {},
    }, extractSink)) {
      yield ev;
    }
    entitiesResult = { value: extractSink.value!, outputTokens: extractSink.outputTokens ?? 0 };
    yield { kind: "tool_result", ok: true, preview: `${entitiesResult.value.entities.length} entities` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    yield { kind: "error", message: `ingest: entity extraction failed — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  if (signal.aborted) return;
```

- [ ] **Step 6: Rewrite the ingest synthesise call**

In `src/phases/ingest.ts`, replace the synthesise block (currently lines 248-274):

```ts
  yield { kind: "tool_use", name: "Synthesising pages", input: {} };
  const pwtEvents: RunEvent[] = [];
  let parseResult: { value: WikiPagesOutput; outputTokens: number };
  try {
    parseResult = await runStructuredWithRetry({
      llm, model, baseMessages: messages, opts: { ...opts, jsonMode: false },
      profile: wikiPagesProfile(),
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.pages",
      signal,
      onEvent: (ev) => pwtEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${existingPages.size} pages · ${inputTokFmt} tokens sent` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of pwtEvents) yield ev;
    yield { kind: "error", message: `ingest: LLM output failed validation — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of pwtEvents) yield ev;
  if (signal.aborted) return;

  const outputTokens = parseResult.outputTokens;
  yield { kind: "assistant_text", delta: parseResult.value.reasoning, isReasoning: true };
  let pages = parseResult.value.pages;
```

with (KEEP the post-parse `assistant_text{ reasoning }` emit — `wikiPagesProfile()` is framed-zod, so its `reasoning` is parsed from the `<<<REPORT>>>` frame carried in the **content** stream, which `streamOnce` emits as non-`isReasoning` deltas (💬 status only). Only a model's native `delta.reasoning` tokens stream as a 🧠 block. Dropping this emit would remove the visible reasoning block for models that carry reasoning solely in the frame — so it stays):

```ts
  yield { kind: "tool_use", name: "Synthesising pages", input: {} };
  const pwtSink: StructuredSink<WikiPagesOutput> = {};
  let parseResult: { value: WikiPagesOutput; outputTokens: number };
  try {
    for await (const ev of runStructuredStreaming({
      llm, model, baseMessages: messages, opts: { ...opts, jsonMode: false },
      profile: wikiPagesProfile(),
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.pages",
      signal,
      onEvent: () => {},
    }, pwtSink)) {
      yield ev;
    }
    parseResult = { value: pwtSink.value!, outputTokens: pwtSink.outputTokens ?? 0 };
    yield { kind: "tool_result", ok: true, preview: `${existingPages.size} pages · ${inputTokFmt} tokens sent` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    yield { kind: "error", message: `ingest: LLM output failed validation — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  if (signal.aborted) return;

  const outputTokens = parseResult.outputTokens;
  yield { kind: "assistant_text", delta: parseResult.value.reasoning, isReasoning: true };
  let pages = parseResult.value.pages;
```

- [ ] **Step 7: Rewrite the ingest merge call**

In `src/phases/ingest.ts`, replace the merge block (currently lines 417-439):

```ts
          const mergeEvents: RunEvent[] = [];
          try {
            const merged = await runStructuredWithRetry({
              llm, model, baseMessages: mergeMsgs, opts: { ...opts, jsonMode: false },
              profile: mergedPageProfile(),
              maxRetries: opts.structuredRetries ?? 1,
              callSite: "ingest.merge", signal, onEvent: (ev) => mergeEvents.push(ev),
            });
            for (const ev of mergeEvents) yield ev;
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            await vaultTools.write(targetPath, merged.value.content);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
            const relTarget = targetPath.slice(wikiVaultPath.length + 1);
            logEntries.push({ path: relTarget, action: "MERGED" });
            if (merged.value.annotation) {
              try { await upsertIndexAnnotation(vaultTools, wikiVaultPath, hit.pid, merged.value.annotation, targetPath); } catch { /* non-critical */ }
            }
            continue; // skip the normal create
          } catch (e) {
            for (const ev of mergeEvents) yield ev;
            // merge failed — fall through to a normal create rather than lose the new content
            yield { kind: "info_text", icon: "⚠️", summary: `merge не удался, создаю отдельно: ${(e as Error).message}` };
```

with:

```ts
          const mergeSink: StructuredSink<{ content: string; annotation?: unknown }> = {};
          try {
            for await (const ev of runStructuredStreaming({
              llm, model, baseMessages: mergeMsgs, opts: { ...opts, jsonMode: false },
              profile: mergedPageProfile(),
              maxRetries: opts.structuredRetries ?? 1,
              callSite: "ingest.merge", signal, onEvent: () => {},
            }, mergeSink)) {
              yield ev;
            }
            const merged = { value: mergeSink.value! };
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            await vaultTools.write(targetPath, merged.value.content);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
            const relTarget = targetPath.slice(wikiVaultPath.length + 1);
            logEntries.push({ path: relTarget, action: "MERGED" });
            if (merged.value.annotation) {
              try { await upsertIndexAnnotation(vaultTools, wikiVaultPath, hit.pid, merged.value.annotation, targetPath); } catch { /* non-critical */ }
            }
            continue; // skip the normal create
          } catch (e) {
            // merge failed — fall through to a normal create rather than lose the new content
            yield { kind: "info_text", icon: "⚠️", summary: `merge не удался, создаю отдельно: ${(e as Error).message}` };
```

Note: keep the type of `mergeSink`'s value aligned with `mergedPageProfile()`'s schema output. If `merged.value.annotation`/`content` typing fails to compile, replace `{ content: string; annotation?: unknown }` with the exact inferred type — check `mergedPageProfile`'s schema (search `mergedPageProfile` in `src/phases/ingest.ts`) and use `z.infer` of that schema, mirroring how `WikiPagesOutput` is used above.

- [ ] **Step 8: Build + lint (catches unused imports and type mismatches)**

Run: `npm run build && npm run lint`
Expected: build succeeds; no lint errors. If eslint flags `parseWithRetry` / `runStructuredWithRetry` / `RunEvent` as unused in `init.ts` or `ingest.ts`, remove the now-unused import.

- [ ] **Step 9: Run the full test suite**

Run: `npx tsx --test tests/*.test.ts`
Expected: all tests PASS (no regressions).

- [ ] **Step 10: Commit**

```bash
git add src/phases/init.ts src/phases/ingest.ts
git commit -m "feat(init,ingest): stream LLM reasoning/tokens live on structured domain-creation steps"
```

---

## Self-Review

**Spec coverage:**
- F1 (metadata missing → not selectable) → Task 1 (direct write + verify).
- F2 (save failure swallowed) → Task 1 (registerDomain try/catch + Notice).
- F3 (already-broken domain invisible) → Task 2 (tmp-promotion self-heal; no content-based reconstruction, to avoid resurrecting deleted domains).
- F4 (no live stream) → Task 3 (emit deltas) + Task 4 (bridge) + Task 5 (switch the four init/ingest callsites to live `yield`; the synthesise `ingest.ts:273` post-parse reasoning block is kept, since framed reasoning is not a native 🧠 stream).
- F5 (`DomainCorruptError`), lint/format/query streaming → explicitly out of scope per spec Decisions; no task, by design.

**Placeholder scan:** No TODO/TBD/FIXME. Every code step shows full code. Task 5 Step 7 leaves one typed fallback instruction (`z.infer` of `mergedPageProfile`'s schema) — this is a concrete, bounded resolution the build will force, not an open placeholder.

**Type consistency:** `StructuredSink<T>` / `runStructuredStreaming` (defined Task 4) are consumed with matching generics in Task 5 (`EntitiesOutput`, `WikiPagesOutput`, bootstrap tuple, merged-page type). `sink.value!` / `sink.outputTokens ?? 0` reconstruct the exact `{ value, outputTokens }` shape the old `parseWithRetry`/`runStructuredWithRetry` returned. `onEvent` deltas emitted in Task 3 are rendered by the existing `view.ts:799-824` handler (no view change needed).

## Execution Handoff

Choose an execution approach after review.
