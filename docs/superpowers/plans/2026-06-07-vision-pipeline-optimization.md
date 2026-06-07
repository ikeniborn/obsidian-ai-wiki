# Vision Pipeline Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `format` operation from looping forever on pages with several attachments by resetting the idle-watchdog on per-attachment progress and resuming completed vision work from a per-run temp store in the plugin directory.

**Architecture:** A new optional `VisionTempStore` (under `<manifest.dir>/.vision-tmp/<runId>/`) caches each attachment's description and persists rendered excalidraw PNGs outside the vault. `AgentRunner` builds it once per `run()`, threads it into `runFormat`, and cleans it in a `finally`. The watchdog also resets on `tool_use`/`tool_result`. The store is optional everywhere — when absent, behavior is byte-for-byte today's, so all existing call sites and tests are untouched.

**Tech Stack:** TypeScript, Obsidian plugin API (vault adapter), Vitest, esbuild. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-07-vision-pipeline-optimization-design.md`

---

## File Structure

- **Create** `src/phases/vision-temp-store.ts` — `VisionTempStore` class + `base64ToArrayBuffer` helper. One responsibility: per-run temp persistence of vision results.
- **Create** `tests/vision-temp-store.test.ts` — unit tests for the store.
- **Modify** `src/vault-tools.ts` — add `writeBinary?` to `VaultAdapter`, add `VaultTools.writeBinary`.
- **Modify** `src/agent-runner.ts` — heartbeat reset on `tool_use`/`tool_result`; build store per run; `cleanup()` in `finally`; thread store into `runOperation`/`runFormat`.
- **Modify** `src/phases/format.ts` — cache-resume in the vision loop; pass store into `analyzeSingleAttachment`.
- **Modify** `src/phases/attachment-analyzer.ts` — persist excalidraw PNG via `store.putPng`.
- **Modify** `src/controller.ts` — pass `this.plugin.manifest.dir` into `new AgentRunner(...)`.
- **Modify** `tests/agent-runner.test.ts` — heartbeat test.
- **Modify** `tests/attachment-analyzer.test.ts` — `putPng` test.
- **Modify** `tests/format-retry.test.ts` — resume test.
- **Modify** `lat.md/operations.md`, `lat.md/tests.md` — document new behavior.

Build order keeps the codebase compiling after every task: new params are optional with `undefined` defaults, so existing callers stay valid until their task wires them.

---

## Task 1: Add binary write to the vault adapter

**Files:**
- Modify: `src/vault-tools.ts:1-15` (interface), `src/vault-tools.ts:94-97` (near `readBinary`)

No dedicated test — this thin delegating method mirrors the existing `readBinary` (also untested directly) and is exercised end-to-end by the `VisionTempStore.putPng` test in Task 2.

- [ ] **Step 1: Add `writeBinary` to the `VaultAdapter` interface**

In `src/vault-tools.ts`, inside `interface VaultAdapter`, right after the `readBinary?` line (currently line 10):

```typescript
  readBinary?(path: string): Promise<ArrayBuffer>;
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
```

- [ ] **Step 2: Add `VaultTools.writeBinary` (ensures parent dirs like `write` does)**

In `src/vault-tools.ts`, immediately after the `readBinary` method (currently ends at line 97), add:

```typescript
  async writeBinary(vaultPath: string, data: ArrayBuffer): Promise<void> {
    if (!this.adapter.writeBinary) throw new Error("writeBinary not supported by this adapter");
    const segments = vaultPath.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    await this.adapter.writeBinary(vaultPath, data);
  }
```

- [ ] **Step 3: Verify compile + existing tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/vault-tools 2>/dev/null; npx vitest run --silent 2>&1 | tail -5`
Expected: type-check clean; no new failures (this only adds an optional interface member + one method).

- [ ] **Step 4: Commit**

```bash
git add src/vault-tools.ts
git commit -m "feat(vault-tools): add writeBinary for binary attachment persistence"
```

---

## Task 2: VisionTempStore module

**Files:**
- Create: `src/phases/vision-temp-store.ts`
- Test: `tests/vision-temp-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vision-temp-store.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { VisionTempStore, base64ToArrayBuffer } from "../src/phases/vision-temp-store";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

/** In-memory adapter that actually persists, so put→get round-trips work. */
function memVault() {
  const text = new Map<string, string>();
  const bin = new Map<string, ArrayBuffer>();
  const removed: string[] = [];
  const adapter: VaultAdapter = {
    read: (p) => text.has(p) ? Promise.resolve(text.get(p)!) : Promise.reject(new Error("nf")),
    write: (p, d) => { text.set(p, d); return Promise.resolve(); },
    append: () => Promise.resolve(),
    list: () => Promise.resolve({ files: [], folders: [] }),
    exists: (p) => Promise.resolve(text.has(p) || bin.has(p)),
    mkdir: () => Promise.resolve(),
    writeBinary: (p, d) => { bin.set(p, d); return Promise.resolve(); },
    rmdir: (p) => { removed.push(p); return Promise.resolve(); },
  };
  return { vt: new VaultTools(adapter, "/vault"), text, bin, removed, adapter };
}

const DIR = ".obsidian/plugins/x/.vision-tmp/run1";

describe("base64ToArrayBuffer", () => {
  it("decodes raw base64 to bytes", () => {
    const buf = base64ToArrayBuffer(btoa("ABC"));
    expect(Array.from(new Uint8Array(buf))).toEqual([65, 66, 67]);
  });
});

describe("VisionTempStore", () => {
  it("round-trips a description by embed path", async () => {
    const { vt } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.putDescription("img/a.png", "A red circle.");
    expect(await store.getDescription("img/a.png")).toBe("A red circle.");
  });

  it("returns null on cache miss", async () => {
    const { vt } = memVault();
    const store = new VisionTempStore(vt, DIR);
    expect(await store.getDescription("img/missing.png")).toBeNull();
  });

  it("writes PNG under the plugin dir, not the vault content tree", async () => {
    const { vt, bin } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.putPng("draw.excalidraw", btoa("PNGBYTES"));
    const keys = [...bin.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(DIR + "/")).toBe(true);
    expect(keys[0].endsWith(".png")).toBe(true);
  });

  it("cleanup removes the run dir recursively", async () => {
    const { vt, removed } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.cleanup();
    expect(removed).toContain(DIR);
  });

  it("swallows adapter errors — never throws", async () => {
    const adapter: VaultAdapter = {
      read: () => Promise.reject(new Error("boom")),
      write: () => Promise.reject(new Error("boom")),
      append: () => Promise.resolve(),
      list: () => Promise.resolve({ files: [], folders: [] }),
      exists: () => Promise.resolve(true),
      mkdir: () => Promise.resolve(),
      writeBinary: () => Promise.reject(new Error("boom")),
      rmdir: () => Promise.reject(new Error("boom")),
    };
    const store = new VisionTempStore(new VaultTools(adapter, "/vault"), DIR);
    await expect(store.putDescription("a", "b")).resolves.toBeUndefined();
    await expect(store.getDescription("a")).resolves.toBeNull();
    await expect(store.putPng("a", btoa("x"))).resolves.toBeUndefined();
    await expect(store.cleanup()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vision-temp-store.test.ts`
Expected: FAIL — cannot find module `../src/phases/vision-temp-store`.

- [ ] **Step 3: Write the implementation**

Create `src/phases/vision-temp-store.ts`:

```typescript
import type { VaultTools } from "../vault-tools";

/** Convert raw base64 (no `data:` prefix) to an ArrayBuffer for binary writes. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Deterministic, collision-resistant filename stem from a vault-relative embed path. */
function keyFor(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/**
 * Per-run temporary store for vision results. Lives under the plugin directory
 * (`<manifest.dir>/.vision-tmp/<runId>`), NOT the vault content tree, so rendered
 * PNGs and cached descriptions never appear as notes. Enables resume across the
 * AgentRunner idle-retry loop: a re-entered runFormat reads completed
 * descriptions from here instead of re-calling the vision LLM.
 *
 * Every method swallows its own errors and degrades to a no-op / null — the
 * store must never block or fail a format run.
 */
export class VisionTempStore {
  constructor(private vaultTools: VaultTools, private dir: string) {}

  async getDescription(path: string): Promise<string | null> {
    try {
      const p = `${this.dir}/${keyFor(path)}.json`;
      if (!(await this.vaultTools.exists(p))) return null;
      const obj = JSON.parse(await this.vaultTools.read(p)) as { desc?: string };
      return typeof obj.desc === "string" ? obj.desc : null;
    } catch {
      return null;
    }
  }

  async putDescription(path: string, desc: string): Promise<void> {
    try {
      const p = `${this.dir}/${keyFor(path)}.json`;
      await this.vaultTools.write(p, JSON.stringify({ path, desc }));
    } catch { /* never block format */ }
  }

  async putPng(path: string, b64: string): Promise<void> {
    try {
      const p = `${this.dir}/${keyFor(path)}.png`;
      await this.vaultTools.writeBinary(p, base64ToArrayBuffer(b64));
    } catch { /* fire-and-forget */ }
  }

  async cleanup(): Promise<void> {
    try {
      await this.vaultTools.adapter.rmdir?.(this.dir, true);
    } catch { /* swallow */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vision-temp-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/phases/vision-temp-store.ts tests/vision-temp-store.test.ts
git commit -m "feat(vision): add VisionTempStore for per-run result caching"
```

---

## Task 3: Watchdog heartbeat on tool events

**Files:**
- Modify: `src/agent-runner.ts:176`
- Test: `tests/agent-runner.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/agent-runner.test.ts`, add inside the `describe("AgentRunner idle watchdog", ...)` block (after the "normal run" test, around line 90):

```typescript
  // @lat: [[tests#AgentRunner Idle Watchdog#Heartbeat on tool events]]
  it("heartbeat: tool_use/tool_result reset the idle timer — no retry, total > timeout", async () => {
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    vi.spyOn(runner as unknown as { runOperation: (...a: unknown[]) => AsyncGenerator<RunEvent, void, void> }, "runOperation")
      .mockImplementation(async function* (): AsyncGenerator<RunEvent, void, void> {
        yield { kind: "tool_use", name: "Vision", input: {} };
        await new Promise<void>((r) => setTimeout(r, 3000));
        yield { kind: "tool_result", ok: true };
        await new Promise<void>((r) => setTimeout(r, 3000));
        yield { kind: "result", durationMs: 1, text: "done" };
      });

    const runPromise = collect(runner.run(makeRequest()));
    await vi.advanceTimersByTimeAsync(3100);
    await vi.advanceTimersByTimeAsync(3100);
    const events = await runPromise;

    const retryEvents = events.filter(
      (e): e is { kind: "system"; message: string } =>
        e.kind === "system" && (e as { kind: "system"; message: string }).message.includes("retrying"),
    );
    expect(retryEvents).toHaveLength(0);
    expect(events.filter((e) => e.kind === "result")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-runner.test.ts -t "heartbeat"`
Expected: FAIL — a `retrying` system event is emitted (timer fires at 5s because tool events don't reset it yet), so `retryEvents` has length 1, not 0.

- [ ] **Step 3: Add tool events to the reset trigger**

In `src/agent-runner.ts`, line 176, change:

```typescript
          if (ev.kind === "llm_call_stats" || ev.kind === "assistant_text") resetTimer();
```

to:

```typescript
          if (
            ev.kind === "llm_call_stats" || ev.kind === "assistant_text" ||
            ev.kind === "tool_use" || ev.kind === "tool_result"
          ) resetTimer();
```

- [ ] **Step 4: Run test to verify it passes (and the existing watchdog tests still pass)**

Run: `npx vitest run tests/agent-runner.test.ts`
Expected: PASS — heartbeat test green; "normal run", "idle retry success", "idle exhausted" still green (their mocks emit no tool events, so a true hang still trips the timer).

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts tests/agent-runner.test.ts
git commit -m "fix(agent-runner): reset idle watchdog on tool_use/tool_result heartbeat"
```

---

## Task 4: Build + thread the store in AgentRunner

**Files:**
- Modify: `src/agent-runner.ts` — constructor (line 16-26), `runOperation` signature + `runFormat` call (line 82-128), `run()` store build + cleanup (line 137-229)

No new test in this task — the wiring is covered by the resume integration test in Task 8 and the existing watchdog tests (which pass `runOperation` mocks and so never construct a store). Keep the codebase compiling: the constructor param is optional.

- [ ] **Step 1: Add the constructor param**

In `src/agent-runner.ts`, change the constructor (lines 18-26) to add a 6th parameter:

```typescript
  constructor(
    llm: LlmClient,
    private settings: LlmWikiPluginSettings,
    private vaultTools: VaultTools,
    private vaultName: string,
    private domains: DomainEntry[],
    private visionTempBaseDir?: string,
  ) {
    this.llm = wrapWithJsonFallback(llm);
  }
```

- [ ] **Step 2: Import the store**

At the top of `src/agent-runner.ts`, after the existing phase imports (after line 9 `import { runFormat } from "./phases/format";`), add:

```typescript
import { VisionTempStore } from "./phases/vision-temp-store";
```

- [ ] **Step 3: Thread the store through `runOperation`**

In `src/agent-runner.ts`, change the `runOperation` signature (lines 82-89) to accept the store as a trailing param:

```typescript
  private async *runOperation(
    req: RunRequest,
    model: string,
    opts: LlmCallOptions,
    vaultRoot: string,
    domains: DomainEntry[],
    similarity: PageSimilarityService | undefined,
    visionTempStore?: VisionTempStore,
  ): AsyncGenerator<RunEvent, void, void> {
```

Then in the `case "format":` block, change the `runFormat(...)` call (line 126) to pass the store as the final argument:

```typescript
        yield* runFormat(formatArgs, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, this.settings.wikiLinkValidationRetries, visionSettings, visionTempStore);
```

- [ ] **Step 4: Build the store once per run and clean it up in a `finally`**

In `src/agent-runner.ts`, in `run()`, after the `let attempt = 0;` line (line 156) and before `while (true) {` (line 158), insert the store build:

```typescript
    let visionTempStore: VisionTempStore | undefined;
    if (req.operation === "format" && this.settings.vision?.enabled && this.visionTempBaseDir) {
      const runId = Date.now().toString(36);
      visionTempStore = new VisionTempStore(this.vaultTools, `${this.visionTempBaseDir}/.vision-tmp/${runId}`);
    }
```

Wrap the entire `while (true) { ... }` loop in a `try { ... } finally { ... }`. Concretely, change line 158 from:

```typescript
    while (true) {
```

to:

```typescript
    try {
    while (true) {
```

and after the loop's closing brace (the `}` on line 228 that closes `while (true)`), add the `finally`:

```typescript
    }
    } finally {
      await visionTempStore?.cleanup();
    }
```

Then update the single `runOperation` invocation inside the loop (line 175) to pass the store:

```typescript
        for await (const ev of this.runOperation({ ...req, signal: combined }, model, opts, vaultRoot, domains, similarity, visionTempStore)) {
```

(The `return;` at line 216 and any `throw` still run the `finally`, so cleanup happens on success, idle-exhaustion, and user cancel alike.)

- [ ] **Step 5: Verify compile + watchdog tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/agent-runner.test.ts`
Expected: type-check clean; all watchdog tests PASS (no store is built for the `init` operation used in those tests).

- [ ] **Step 6: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): build per-run VisionTempStore, thread it into format, cleanup in finally"
```

---

## Task 5: Cache-resume in the format vision loop

**Files:**
- Modify: `src/phases/format.ts:59-124`

The resume behavior is verified by the integration test in Task 8. This task wires it.

- [ ] **Step 1: Import the store type**

In `src/phases/format.ts`, change the import on line 13 to also bring in the type:

```typescript
import { extractObsidianEmbedPaths, analyzeSingleAttachment } from "./attachment-analyzer";
import type { VisionTempStore } from "./vision-temp-store";
```

- [ ] **Step 2: Add the trailing param to `runFormat`**

In `src/phases/format.ts`, change the `runFormat` signature — add a final optional param after `visionSettings` (currently lines 71-72):

```typescript
  visionSettings: { enabled: boolean; model: string; language?: "auto" | "ru" | "en" | "es" } = { enabled: false, model: "" },
  visionTempStore?: VisionTempStore,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 3: Add cache-resume + write-through in the vision loop**

In `src/phases/format.ts`, replace the per-path loop body (lines 105-122) with:

```typescript
      for (const path of embedPaths) {
        if (signal.aborted) break;
        const filename = path.split("/").pop() ?? path;
        yield { kind: "tool_use", name: "Vision", input: { file_path: filename, model: visionSettings.model } };
        const cached = await visionTempStore?.getDescription(path);
        if (cached != null) {
          visionDescriptions.set(path, cached);
          yield { kind: "tool_result", ok: true, preview: cached };
          continue;
        }
        try {
          const description = await analyzeSingleAttachment(path, vaultTools, llm, visionSettings.model, signal, filePath, lang, visionTempStore);
          if (description !== null) {
            visionDescriptions.set(path, description);
            await visionTempStore?.putDescription(path, description);
            yield { kind: "tool_result", ok: true, preview: description };
          } else {
            yield { kind: "tool_result", ok: false, preview: "unknown extension" };
            yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
          }
        } catch (e) {
          yield { kind: "tool_result", ok: false, preview: (e as Error)?.message ?? "failed" };
          yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
        }
      }
```

- [ ] **Step 4: Verify compile + existing format/vision tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/format-retry.test.ts tests/phases/format.test.ts`
Expected: type-check clean; all existing tests PASS (store is `undefined` at every existing call site → `?.` short-circuits, behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts
git commit -m "feat(format): resume vision descriptions from temp store, write-through on analyze"
```

---

## Task 6: Persist excalidraw PNG to the plugin dir

**Files:**
- Modify: `src/phases/attachment-analyzer.ts:180-212`
- Test: `tests/attachment-analyzer.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/attachment-analyzer.test.ts`, add `analyzeSingleAttachment` to the imports (line 2-9 import block):

```typescript
import {
  extractObsidianEmbedPaths,
  insertDescriptions,
  analyzeImage,
  analyzeAttachments,
  analyzeSingleAttachment,
  getMimeType,
  stripImageDataUriPrefix,
} from "../src/phases/attachment-analyzer";
```

Then add a new test at the end of the `describe("analyzeAttachments — excalidraw", ...)` block (after line 253):

```typescript
  it("persists the rendered PNG to the temp store via putPng", async () => {
    const vaultTools = makeVaultTools();
    (vaultTools.adapter.renderExcalidrawPng as ReturnType<typeof vi.fn>).mockResolvedValue("RENDEREDB64");
    const llm = makeLlm("A flowchart.");
    const store = {
      getDescription: vi.fn(),
      putDescription: vi.fn(),
      putPng: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    } as unknown as import("../src/phases/vision-temp-store").VisionTempStore;

    await analyzeSingleAttachment("draw.excalidraw", vaultTools, llm, "gpt-4o-mini", new AbortController().signal, "", "auto", store);

    expect(store.putPng).toHaveBeenCalledWith("draw.excalidraw", "RENDEREDB64");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/attachment-analyzer.test.ts -t "persists the rendered PNG"`
Expected: FAIL — `analyzeSingleAttachment` does not accept/use a store yet (TS arity error or `putPng` never called).

- [ ] **Step 3: Add the store param and the putPng call**

In `src/phases/attachment-analyzer.ts`, add the import near the top (after line 8 `import visionExcalidraw ...`):

```typescript
import type { VisionTempStore } from "./vision-temp-store";
```

Change the `analyzeSingleAttachment` signature (lines 181-189) to add a trailing optional param:

```typescript
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: VisionLanguage = "auto",
  visionTempStore?: VisionTempStore,
): Promise<string | null> {
```

In the excalidraw branch (lines 197-201), add the persist call after a successful render:

```typescript
  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;            // no host plugin / render failed → skip
    await visionTempStore?.putPng(path, b64);
    return analyzeExcalidraw(b64, llm, model, signal, language);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: PASS — new test green; existing analyzer tests unaffected (store `undefined` → `?.` short-circuits).

- [ ] **Step 5: Commit**

```bash
git add src/phases/attachment-analyzer.ts tests/attachment-analyzer.test.ts
git commit -m "feat(vision): persist rendered excalidraw PNG to plugin temp dir"
```

---

## Task 7: Wire the plugin dir from the controller

**Files:**
- Modify: `src/controller.ts:559`

- [ ] **Step 1: Pass `manifest.dir` into the AgentRunner**

In `src/controller.ts`, line 559, change:

```typescript
    return new AgentRunner(llm, s, vaultTools, vaultName, domains);
```

to:

```typescript
    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? undefined);
```

- [ ] **Step 2: Verify compile + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: type-check clean; entire suite PASS.

- [ ] **Step 3: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): wire plugin manifest dir into AgentRunner for vision temp store"
```

---

## Task 8: Resume integration test (no double analysis)

**Files:**
- Modify: `tests/format-retry.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/format-retry.test.ts`, add `analyzeSingleAttachment` and the store to the imports (top of file, after line 4):

```typescript
import { analyzeSingleAttachment } from "../src/phases/attachment-analyzer";
import { VisionTempStore } from "../src/phases/vision-temp-store";
```

Add a new test inside the existing `describe("format sentinel retry/salvage", ...)` block (after the vision test ending around line 175):

```typescript
  it("resume: second runFormat with same store does not re-analyze (cache hit)", async () => {
    const analyzeMock = vi.mocked(analyzeSingleAttachment);
    analyzeMock.mockClear();
    analyzeMock.mockResolvedValue("Cached diagram");

    const embed = "img/d.png";
    const src = `# Note\n\n![[${embed}]]\n`;
    const formatted = `---\ntags: []\n---\n\n# Note\n\n![[${embed}]]`;
    const sentinel = makeVisionSentinel("ok", formatted, 1, [embed]);

    // Persisting in-memory adapter so the store survives between the two runs.
    const text = new Map<string, string>([[FILE, src]]);
    const adapter: VaultAdapter = {
      read: (p: string) => Promise.resolve(text.get(p) ?? ""),
      write: (p: string, d: string) => { text.set(p, d); return Promise.resolve(); },
      append: () => Promise.resolve(),
      list: () => Promise.resolve({ files: [], folders: [] }),
      exists: (p: string) => Promise.resolve(text.has(p)),
      mkdir: () => Promise.resolve(),
      rmdir: () => Promise.resolve(),
    };
    const vt = new VaultTools(adapter, VAULT);
    const store = new VisionTempStore(vt, ".obsidian/plugins/x/.vision-tmp/run1");

    const run = () => collect(runFormat(
      [FILE], vt, makeLlmSequence([sentinel]), "model", false, [],
      new AbortController().signal, {}, "native-agent", undefined, 3,
      { enabled: true, model: "vm" }, store,
    ));

    const first = await run();
    expect(first.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    expect(analyzeMock).toHaveBeenCalledTimes(1);

    const second = await run();
    expect(second.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    expect(analyzeMock).toHaveBeenCalledTimes(1); // served from cache — no second LLM call
  });
```

- [ ] **Step 2: Run test to verify it fails (before Task 5 is present) or passes (after)**

Run: `npx vitest run tests/format-retry.test.ts -t "resume"`
Expected: PASS if Tasks 2 + 5 are already implemented. (If running this test in isolation before Task 5, it FAILS with `analyzeMock` called twice — that is the red state this test guards against.)

- [ ] **Step 3: Confirm the whole file is green**

Run: `npx vitest run tests/format-retry.test.ts`
Expected: PASS — all existing sentinel/vision tests plus the new resume test.

- [ ] **Step 4: Commit**

```bash
git add tests/format-retry.test.ts
git commit -m "test(format): verify vision resume from temp store skips re-analysis"
```

---

## Task 9: Update lat.md documentation

**Files:**
- Modify: `lat.md/operations.md` (the `## Format` section), `lat.md/tests.md`

- [ ] **Step 1: Document the temp-store + heartbeat behavior in operations.md**

In `lat.md/operations.md`, in the `## Format` section, append a paragraph describing the new behavior (keep the leading paragraph ≤250 chars rule for any new sub-section; this is an added paragraph to the existing section body, not a new heading):

```markdown
Vision results are cached per run in a `VisionTempStore` ([[src/phases/vision-temp-store.ts#VisionTempStore]]) under the plugin directory (`<manifest.dir>/.vision-tmp/<runId>/`), never the vault content tree. Each attachment is analyzed by one LLM call; the description is written through to the store and resumed from it if the idle-watchdog retries the operation, so completed attachments are never re-sent. Rendered excalidraw PNGs are persisted there too via [[src/vault-tools.ts#VaultTools#writeBinary]] and removed when the run finishes. The idle-watchdog ([[src/agent-runner.ts#AgentRunner#run]]) resets on `tool_use`/`tool_result` as well as stream events, so per-attachment progress prevents a cumulative-time abort while a genuinely hung single call is still caught.
```

- [ ] **Step 2: Add test specs in tests.md**

In `lat.md/tests.md`, under the `## AgentRunner Idle Watchdog` section, add a leaf with a description:

```markdown
### Heartbeat on tool events
When an operation emits `tool_use`/`tool_result` events spaced under the idle threshold but totalling more than it, the idle timer is reset on each event so no retry fires and the final `result` is yielded.
```

Add a new section for the temp store (with a leading paragraph):

```markdown
## Vision Temp Store

Unit tests for [[src/phases/vision-temp-store.ts#VisionTempStore]] — per-run caching of vision descriptions and excalidraw PNGs under the plugin directory.

### Description round-trip
`putDescription` then `getDescription` for the same embed path returns the stored description; a missing path returns `null`.

### PNG written to plugin dir
`putPng` writes the decoded bytes to a `.png` file under the run directory, not the vault content tree.

### Cleanup removes run dir
`cleanup` calls the adapter's recursive `rmdir` on the run directory.

### Methods swallow adapter errors
Every store method resolves without throwing when the underlying adapter rejects.
```

Add a resume spec under the Format sentinel section:

```markdown
### Vision resume from temp store
A second `runFormat` sharing the same `VisionTempStore` serves descriptions from the cache and does not call `analyzeSingleAttachment` again; both runs still emit `format_preview`.
```

- [ ] **Step 3: Add the `@lat:` code refs to the new tests**

Ensure each new spec leaf is referenced exactly once in test code (matching the project's `require-code-mention` rule). Add these comments:

- In `tests/agent-runner.test.ts` the heartbeat test already carries `// @lat: [[tests#AgentRunner Idle Watchdog#Heartbeat on tool events]]` (added in Task 3 Step 1).
- In `tests/vision-temp-store.test.ts`, add above the matching tests:
  - `// @lat: [[tests#Vision Temp Store#Description round-trip]]` above the round-trip test (cover the miss case in the same leaf).
  - `// @lat: [[tests#Vision Temp Store#PNG written to plugin dir]]` above the PNG test.
  - `// @lat: [[tests#Vision Temp Store#Cleanup removes run dir]]` above the cleanup test.
  - `// @lat: [[tests#Vision Temp Store#Methods swallow adapter errors]]` above the swallow test.
- In `tests/format-retry.test.ts`, add `// @lat: [[tests#Format Sentinel Retry#Vision resume from temp store]]` above the resume test.

(If a spec leaf name does not exactly match what `lat check` expects, run `lat locate "<name>"` to get the canonical id and adjust the comment.)

- [ ] **Step 4: Validate the graph**

Run: `lat check`
Expected: all wiki links + code refs pass; no missing leading paragraphs; no uncovered spec leaves.

- [ ] **Step 5: Commit**

```bash
git add lat.md/ tests/
git commit -m "docs(lat): document vision temp store, heartbeat, and resume specs"
```

---

## Task 10: Full regression + lint

**Files:** none (verification only)

- [ ] **Step 1: Lint (Obsidian reviewer parity)**

Run: `npm run lint`
Expected: clean. (Per project memory: node builtins must be lazy + desktop-guarded — this change adds none; `atob` is a browser/electron global, not a node builtin.)

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the 4 new/updated specs.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean compile and bundle.

- [ ] **Step 4: lat check**

Run: `lat check`
Expected: green.

- [ ] **Step 5: Commit (only if any fixups were needed)**

```bash
git add -A
git commit -m "chore: regression fixups for vision pipeline optimization" || echo "nothing to commit"
```

---

## Acceptance (from intent)

**Desired Outcomes:**
- Format of a page with 5 `.excalidraw` attachments completes to a `format_preview` — no "LLM idle … retrying" and no "Request was aborted" in the progress log.
- Each attachment is analyzed by exactly one LLM call per run, its description written to a temporary store keyed by the run.
- On an internal idle-retry, already-analyzed attachments are resumed from the temp store — never re-sent to the LLM.
- All vision descriptions are combined into a single formatting pass (existing `visionBlock` behavior preserved).
- Excalidraw PNG renders live in the plugin directory (`<pluginDir>/.vision-tmp/<runId>/`), never in the vault structure, and are deleted when the run finishes.

**Done when:** format of the real FFBI.md (5 `.excalidraw`) reaches `format_preview` with all 5 descriptions present, the progress log shows no "retrying"/"aborted", the plugin temp dir is empty after the run, and `npm run lint` + tests + `lat check` are green.

## Manual verification (the "Done when" scenario)

Automated tests cover the units; the headline outcome needs one manual run because it depends on the host excalidraw plugin and a real vision model:

1. Open the vault in Obsidian (desktop) with `obsidian-excalidraw-plugin` installed and `vision.enabled` on.
2. Run Format on `Проекты/KalinaSoft/FinFive/HLD FFBI.md` (5 `.excalidraw` embeds).
3. Confirm: progress reaches `format_preview`; no "retrying"/"aborted" lines; the `.formatted.md` preview contains all 5 diagram descriptions.
4. Confirm `<vault>/.obsidian/plugins/<id>/.vision-tmp/` has no leftover `<runId>` directory after the run completes.
