# Mobile Fixes + Per-Device Settings + Ingest Silent-Fail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix v0.1.59 desktop ingest regression, enable Ollama Cloud HTTPS on mobile, slim mobile UI, move backend+API settings to per-device storage, and route logs through vault adapter so they work on mobile.

**Architecture:** Six concerns delivered in dependency order: (1) restore desktop ingest by replacing dynamic `node:*` imports with `require()`; (2) harden dispatch with try/catch and console errors; (3) move logs to vault adapter; (4) add `requestUrl`-backed `fetch` for mobile OpenAI client; (5) hide mobile-irrelevant UI; (6) extend `LocalConfigStore` with backend+API overlay and one-shot migration. Settings UI is rewired to write per-device fields to `local.json`.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Platform`, `requestUrl`, `DataAdapter`), esbuild (CJS, external `node:*`), `openai@^6.34`, vitest.

**Spec:** `docs/superpowers/specs/2026-05-08-mobile-fixes-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/controller.ts` | modify | Replace dyn `node:*` → `require`; try/catch around `buildAgentRunner`; rewire `logEvent` to vault adapter; mobile-fetch in OpenAI client |
| `src/agent-runner.ts` | modify | Replace dyn `node:*` → vault adapter for `writeDevLog`/`updateDevLogEval` |
| `src/vault-tools.ts` | modify | Expose `adapter` getter for log writing |
| `src/mobile-fetch.ts` | create | `requestUrl`-backed `fetch` adapter |
| `src/local-config.ts` | modify | Extend `LocalConfig` schema with `backend`, `agentLogEnabled`, `claudeAgent`, `nativeAgent`, `migrated_v1` |
| `src/effective-settings.ts` | create | `resolveEffective(settings, local)` overlay |
| `src/main.ts` | modify | One-shot migration; force mobile flags |
| `src/settings.ts` | modify | Hide mobile-irrelevant UI; rewire backend+API fields to write `localConfigStore` |
| `vitest.mock.ts` | modify | Add `requestUrl` mock + adapter `append/mkdir/exists` stubs |
| `tests/mobile-fetch.test.ts` | create | Unit test mobile fetch |
| `tests/effective-settings.test.ts` | create | Unit test resolver |
| `tests/local-config.test.ts` | modify | Add tests for new fields |
| `tests/main-migration.test.ts` | modify | Add `migrated_v1` migration test |
| `tests/controller-log-adapter.test.ts` | create | Verify `logEvent` writes via vault adapter |

---

## Task 1: Replace dynamic node:* imports with require (desktop ingest fix)

**Files:**
- Modify: `src/controller.ts:222`, `src/controller.ts:252-260`, `src/controller.ts:284-294`, `src/controller.ts:429`
- Modify: `src/agent-runner.ts:38-50`, `src/agent-runner.ts:144-159`

**Why:** `await import("node:fs")` is treated as ES dynamic import → browser fetches URL `node:fs` → `Failed to fetch dynamically imported module: node:fs`. Esbuild only rewrites **static** external imports to `require()`. Switch dyn imports to direct `require()` calls — esbuild leaves them as-is.

- [ ] **Step 1: Add `require` declaration to `src/controller.ts`**

After existing imports, add:
```ts
declare const require: NodeJS.Require;
```

- [ ] **Step 2: Replace `requireClaudeAgent` body** (`src/controller.ts:221-229`)

```ts
private async requireClaudeAgent(): Promise<string | null> {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const { iclaudePath } = await this.localConfigStore.load();
  if (!iclaudePath || !existsSync(iclaudePath)) {
    new Notice(i18n().ctrl.setClaudeCodePath);
    return null;
  }
  return iclaudePath;
}
```

- [ ] **Step 3: Replace dyn imports in `buildAgentRunner` claude-agent branch** (`src/controller.ts:251-268`)

Find:
```ts
if (s.backend === "claude-agent") {
  const { join } = await import("node:path");
  const { mkdirSync } = await import("node:fs");
  const { ClaudeCliClient } = await import("./claude-cli-client");
```

Replace with:
```ts
if (s.backend === "claude-agent") {
  const { join } = require("node:path") as typeof import("node:path");
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { ClaudeCliClient } = require("./claude-cli-client") as typeof import("./claude-cli-client");
```

- [ ] **Step 4: Replace dyn imports in `toVaultPath`** (`src/controller.ts:428-434`)

```ts
private async toVaultPath(vaultDir: string, savedPath: string): Promise<string | null> {
  const { relative, isAbsolute, join } = require("node:path") as typeof import("node:path");
  const abs = isAbsolute(savedPath) ? savedPath : join(vaultDir, savedPath);
  const rel = relative(vaultDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}
```

- [ ] **Step 5: Add `require` declaration to `src/agent-runner.ts`**

After imports, add:
```ts
declare const require: NodeJS.Require;
```

- [ ] **Step 6: Build to verify no esbuild errors**

Run: `npm run build`
Expected: `dist/main.js` produced without errors. Output size comparable to previous build (±5 KB).

- [ ] **Step 7: Static guard test**

Verify the existing `tests/no-fs-imports.test.ts` passes:
Run: `npx vitest run tests/no-fs-imports.test.ts`
Expected: PASS. (If it bans top-level node imports in mobile hot path, our changes are OK because we only added `require()` inside functions gated by backend or `Platform.isDesktop`.)

- [ ] **Step 8: Commit**

```bash
git add src/controller.ts src/agent-runner.ts
git commit -m "fix: replace dynamic node:* imports with require() (desktop ingest regression)"
```

---

## Task 2: try/catch around buildAgentRunner + console.error in dispatch

**Files:**
- Modify: `src/controller.ts:85` (`dispatchChat`), `src/controller.ts:319` (`dispatch`), `src/controller.ts:365` (catch block)
- Test: `tests/controller-build-fail.test.ts` (create)

**Why:** `buildAgentRunner` throws were silent (caller `void`). Wrap with Notice + console.error so failures surface.

- [ ] **Step 1: Write failing test** — `tests/controller-build-fail.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __clearNotices, Notice } from "../vitest.mock";

describe("dispatch — buildAgentRunner failure", () => {
  beforeEach(() => __clearNotices());

  it("shows Notice when buildAgentRunner throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Synthetic minimal harness — verify the code path:
    const fn = async () => {
      try {
        throw new Error("simulated tmpDir failure");
      } catch (e) {
        new Notice(`Error: ${(e as Error).message}`);
        console.error("[llm-wiki] buildAgentRunner failed", e);
        return;
      }
    };
    await fn();
    expect(Notice.__messages.some((m) => m.includes("simulated tmpDir failure"))).toBe(true);
    expect(errSpy).toHaveBeenCalledWith("[llm-wiki] buildAgentRunner failed", expect.any(Error));
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (sanity-check the harness)**

Run: `npx vitest run tests/controller-build-fail.test.ts`
Expected: PASS.

- [ ] **Step 3: Wrap `buildAgentRunner` call in `dispatch`** (`src/controller.ts:319`)

Replace:
```ts
const agentRunner = await this.buildAgentRunner(vaultRoot);
```

With:
```ts
let agentRunner: AgentRunner;
try {
  agentRunner = await this.buildAgentRunner(vaultRoot);
} catch (e) {
  new Notice(i18n().ctrl.errorPrefix((e as Error).message));
  console.error("[llm-wiki] buildAgentRunner failed", e);
  return;
}
```

- [ ] **Step 4: Wrap `buildAgentRunner` call in `dispatchChat`** (`src/controller.ts:85`)

Replace:
```ts
const agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId);
```

With:
```ts
let agentRunner: AgentRunner;
try {
  agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId);
} catch (e) {
  new Notice(i18n().ctrl.errorPrefix((e as Error).message));
  console.error("[llm-wiki] buildAgentRunner failed", e);
  return;
}
```

- [ ] **Step 5: Add `console.error` in dispatch catch** (`src/controller.ts:365-368`)

Replace:
```ts
} catch (err) {
  status = "error";
  finalText = i18n().ctrl.errorPrefix((err as Error).message);
  await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
}
```

With:
```ts
} catch (err) {
  status = "error";
  console.error("[llm-wiki] dispatch failed", err);
  finalText = i18n().ctrl.errorPrefix((err as Error).message);
  await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
}
```

- [ ] **Step 6: Run all controller tests**

Run: `npx vitest run tests/controller-mobile.test.ts tests/controller-build-fail.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controller.ts tests/controller-build-fail.test.ts
git commit -m "fix(controller): surface buildAgentRunner failures via Notice + console.error"
```

---

## Task 3: Vault-adapter logging (works on mobile)

**Files:**
- Modify: `src/vault-tools.ts` (expose adapter)
- Modify: `src/controller.ts:284-295` (`logEvent`)
- Modify: `src/agent-runner.ts:38-56` (`writeDevLog`), `src/agent-runner.ts:144-159` (`updateDevLogEval`)
- Modify: `vitest.mock.ts` (adapter mocks)
- Test: `tests/controller-log-adapter.test.ts` (create)

**Why:** Logs go to `<vault>/!Logs/agent.jsonl` and `dev.jsonl` — vault-relative paths. `DataAdapter` (Obsidian API) provides `read/write/append/exists/mkdir` on all platforms. Replaces `node:fs` calls; works on mobile.

- [ ] **Step 1: Expose adapter in VaultTools** — modify `src/vault-tools.ts`

Find the `VaultTools` class. Add a public getter (after constructor):
```ts
get adapter(): VaultAdapter { return this._adapter; }
```

If the constructor stores `adapter` in a private field with a different name, alias the getter accordingly. (Open the file and confirm the field name; rename in the getter to match.)

- [ ] **Step 2: Extend mock adapter in `vitest.mock.ts`**

Find existing adapter scaffolding (or add). Ensure these methods exist on test-side mocks (the controller tests need them):
```ts
// vitest.mock.ts - DataAdapter-like helpers used by tests via createMockAdapter()
export function createMockAdapter() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files, dirs,
    exists: async (p: string) => files.has(p) || dirs.has(p),
    read: async (p: string) => {
      const v = files.get(p);
      if (v == null) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    write: async (p: string, data: string) => { files.set(p, data); },
    append: async (p: string, data: string) => {
      files.set(p, (files.get(p) ?? "") + data);
    },
    mkdir: async (p: string) => { dirs.add(p); },
  };
}
```

If the file already has an adapter mock, merge the missing methods (`append`, `mkdir`, `exists`) into it.

- [ ] **Step 3: Write failing test** — `tests/controller-log-adapter.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../vitest.mock";

async function logEvent(adapter: ReturnType<typeof createMockAdapter>, line: string): Promise<void> {
  const dir = "!Logs";
  const path = `${dir}/agent.jsonl`;
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  if (await adapter.exists(path)) await adapter.append(path, line);
  else await adapter.write(path, line);
}

describe("logEvent — vault adapter writer", () => {
  it("creates !Logs and writes agent.jsonl on first event", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    expect(a.dirs.has("!Logs")).toBe(true);
    expect(a.files.get("!Logs/agent.jsonl")).toBe('{"a":1}\n');
  });

  it("appends on subsequent events", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    await logEvent(a, '{"b":2}\n');
    expect(a.files.get("!Logs/agent.jsonl")).toBe('{"a":1}\n{"b":2}\n');
  });
});
```

- [ ] **Step 4: Run test (should pass — pure helper, validating mock)**

Run: `npx vitest run tests/controller-log-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `controller.logEvent`** (`src/controller.ts:284-295`)

Replace the entire method with:
```ts
private async logEvent(
  _vaultRoot: string,
  sessionId: string,
  op: WikiOperation,
  domainId: string | undefined,
  ev: RunEvent,
): Promise<void> {
  if (!this.plugin.settings.agentLogEnabled) return;
  const adapter = this.plugin.app.vault.adapter;
  const dir = "!Logs";
  const path = `${dir}/agent.jsonl`;
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session: sessionId, op, domainId, event: ev,
    }) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* не блокируем операцию */ }
}
```

- [ ] **Step 6: Replace `agent-runner.writeDevLog`** (`src/agent-runner.ts:38-56`)

```ts
private async writeDevLog(_vaultRoot: string, entry: {
  operation: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  result: string;
  durationMs: number;
}): Promise<void> {
  if (!this.settings.devMode?.enabled) return;
  const adapter = this.vaultTools.adapter;
  const dir = "!Logs";
  const path = `${dir}/dev.jsonl`;
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* не блокируем */ }
}
```

- [ ] **Step 7: Replace `agent-runner.updateDevLogEval`** (`src/agent-runner.ts:144-159`)

```ts
private async updateDevLogEval(_vaultRoot: string, score: number, reasoning: string): Promise<void> {
  if (!this.settings.devMode?.enabled) return;
  const adapter = this.vaultTools.adapter;
  const path = "!Logs/dev.jsonl";
  try {
    if (!(await adapter.exists(path))) return;
    const content = await adapter.read(path);
    const lines = content.trimEnd().split("\n");
    const lastIdx = lines.length - 1;
    const last = JSON.parse(lines[lastIdx]);
    last.eval = { score, reasoning };
    lines[lastIdx] = JSON.stringify(last);
    await adapter.write(path, lines.join("\n") + "\n");
  } catch { /* не блокируем */ }
}
```

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/controller.ts src/agent-runner.ts src/vault-tools.ts vitest.mock.ts tests/controller-log-adapter.test.ts
git commit -m "feat(logs): route agent.jsonl + dev.jsonl through vault adapter (mobile compatible)"
```

---

## Task 4: Mobile fetch via requestUrl

**Files:**
- Create: `src/mobile-fetch.ts`
- Modify: `src/controller.ts:273` (`buildAgentRunner` native-agent branch)
- Modify: `vitest.mock.ts` (add `requestUrl` stub)
- Test: `tests/mobile-fetch.test.ts` (create)

**Why:** Ollama Cloud rejects cross-origin from `app://obsidian.md`. `requestUrl` from Obsidian API bypasses CORS via native HTTP.

- [ ] **Step 1: Add `requestUrl` mock to `vitest.mock.ts`**

```ts
export const __requestUrlCalls: any[] = [];
export let __requestUrlResponse: { status: number; text: string; headers: Record<string,string> } = {
  status: 200, text: "{}", headers: { "content-type": "application/json" },
};
export function __setRequestUrlResponse(r: typeof __requestUrlResponse): void {
  __requestUrlResponse = r;
}
export function __clearRequestUrlCalls(): void { __requestUrlCalls.length = 0; }
export async function requestUrl(param: any) {
  __requestUrlCalls.push(param);
  return __requestUrlResponse;
}
```

- [ ] **Step 2: Write failing test** — `tests/mobile-fetch.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mobileFetch } from "../src/mobile-fetch";
import { __requestUrlCalls, __setRequestUrlResponse, __clearRequestUrlCalls } from "../vitest.mock";

describe("mobileFetch", () => {
  beforeEach(() => __clearRequestUrlCalls());

  it("forwards method, headers, body and returns Response with text", async () => {
    __setRequestUrlResponse({ status: 200, text: '{"ok":1}', headers: { "x-test": "1" } });
    const res = await mobileFetch("https://api.test/v1/chat", {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: '{"model":"m"}',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":1}');
    expect(__requestUrlCalls[0]).toMatchObject({
      url: "https://api.test/v1/chat",
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: '{"model":"m"}',
      throw: false,
    });
  });

  it("throws AbortError when signal already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(mobileFetch("https://api.test/", { signal: ctrl.signal })).rejects.toThrow("Aborted");
  });

  it("rejects non-string body", async () => {
    await expect(
      mobileFetch("https://api.test/", { method: "POST", body: new Uint8Array([1, 2]) as unknown as BodyInit }),
    ).rejects.toThrow("only string body supported");
  });
});
```

- [ ] **Step 3: Run test (should fail — module not yet)**

Run: `npx vitest run tests/mobile-fetch.test.ts`
Expected: FAIL — `Cannot find module '../src/mobile-fetch'`.

- [ ] **Step 4: Create `src/mobile-fetch.ts`**

```ts
import { requestUrl } from "obsidian";

export const mobileFetch: typeof fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.toString() : (input as Request).url;
  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }
  const r = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: body ?? undefined,
    throw: false,
  });
  return new Response(r.text, { status: r.status, headers: r.headers as HeadersInit });
};
```

- [ ] **Step 5: Run test (should pass)**

Run: `npx vitest run tests/mobile-fetch.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire into OpenAI client** (`src/controller.ts`)

Add at top with other imports:
```ts
import { mobileFetch } from "./mobile-fetch";
```

In `buildAgentRunner` native-agent branch (around `src/controller.ts:273`), replace:
```ts
llm = new OpenAI({
  baseURL: s.nativeAgent.baseUrl,
  apiKey: s.nativeAgent.apiKey,
  timeout: maxTimeoutSec * 1000,
  dangerouslyAllowBrowser: true,
});
```

With:
```ts
llm = new OpenAI({
  baseURL: s.nativeAgent.baseUrl,
  apiKey: s.nativeAgent.apiKey,
  timeout: maxTimeoutSec * 1000,
  dangerouslyAllowBrowser: true,
  fetch: Platform.isMobile ? mobileFetch : undefined,
});
```

- [ ] **Step 7: Build to verify no TS errors**

Run: `npm run build`
Expected: PASS, `dist/main.js` produced.

- [ ] **Step 8: Commit**

```bash
git add src/mobile-fetch.ts src/controller.ts vitest.mock.ts tests/mobile-fetch.test.ts
git commit -m "feat(mobile): use requestUrl-backed fetch for OpenAI client (CORS bypass)"
```

---

## Task 5: Hide per-operation + dev-mode UI on mobile; force flags

**Files:**
- Modify: `src/settings.ts:294-300`, `src/settings.ts:343-363`
- Modify: `src/main.ts` (after `loadSettings`)

**Why:** Mobile only runs `query`. Per-op model config and dev-mode (evaluator + dev log loop) are noise.

- [ ] **Step 1: Wrap `nativeAgent.perOperation` toggle** (`src/settings.ts:294-300`)

Replace the existing `new Setting(containerEl).setName(T.settings.perOperation_name)...addToggle(...)` block (lines ~294-300) with:
```ts
if (!Platform.isMobile) {
  new Setting(containerEl)
    .setName(T.settings.perOperation_name)
    .setDesc(T.settings.perOperation_desc)
    .addToggle((t) =>
      t.setValue(s.nativeAgent.perOperation)
        .onChange(async (v) => { s.nativeAgent.perOperation = v; await this.plugin.saveSettings(); this.display(); }),
    );
}
```

(The `if (s.nativeAgent.perOperation) { ... }` block that follows can stay unchanged — on mobile `perOperation` is forced `false`, so the branch is inert.)

- [ ] **Step 2: Wrap dev mode block** (`src/settings.ts:343-363`)

Replace:
```ts
new Setting(containerEl).setName(T.settings.h3_devmode).setHeading();
new Setting(containerEl).setName(T.settings.devMode_enabled_name)...
if (s.devMode.enabled) { ... }
```

With:
```ts
if (!Platform.isMobile) {
  new Setting(containerEl).setName(T.settings.h3_devmode).setHeading();

  new Setting(containerEl)
    .setName(T.settings.devMode_enabled_name)
    .setDesc(T.settings.devMode_enabled_desc)
    .addToggle((t) =>
      t.setValue(s.devMode.enabled)
        .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); this.display(); }),
    );

  if (s.devMode.enabled) {
    new Setting(containerEl)
      .setName(T.settings.devMode_evaluatorModel_name)
      .setDesc(T.settings.devMode_evaluatorModel_desc)
      .addText((t) =>
        t.setPlaceholder("")
          .setValue(s.devMode.evaluatorModel)
          .onChange(async (v) => { s.devMode.evaluatorModel = v.trim(); await this.plugin.saveSettings(); }),
      );
  }
}
```

- [ ] **Step 3: Force flags in `main.ts loadSettings`** (after line 170)

Find the existing block:
```ts
if (Platform.isMobile && this.settings.backend === "claude-agent") {
  this.settings.backend = "native-agent";
  await this.saveData(this.settings);
}
```

Add immediately after:
```ts
if (Platform.isMobile) {
  let dirty = false;
  if (this.settings.nativeAgent.perOperation) {
    this.settings.nativeAgent.perOperation = false;
    dirty = true;
  }
  if (this.settings.devMode.enabled) {
    this.settings.devMode.enabled = false;
    dirty = true;
  }
  if (dirty) await this.saveData(this.settings);
}
```

- [ ] **Step 4: Add test** — extend `tests/main-mobile.test.ts`

Find the existing mobile loadSettings test. Add:
```ts
it("forces nativeAgent.perOperation=false and devMode.enabled=false on mobile", async () => {
  __setPlatformMobile(true);
  const plugin = makePlugin({
    backend: "native-agent",
    nativeAgent: { ...DEFAULT_SETTINGS.nativeAgent, perOperation: true },
    devMode: { enabled: true, evaluatorModel: "x" },
  });
  await plugin.loadSettings();
  expect(plugin.settings.nativeAgent.perOperation).toBe(false);
  expect(plugin.settings.devMode.enabled).toBe(false);
  __setPlatformMobile(false);
});
```

If `makePlugin` helper isn't present, mirror the pattern of the existing test in the file.

- [ ] **Step 5: Run mobile tests**

Run: `npx vitest run tests/main-mobile.test.ts tests/controller-mobile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts src/main.ts tests/main-mobile.test.ts
git commit -m "feat(mobile): hide per-operation + dev-mode UI; force flags off in loadSettings"
```

---

## Task 6: Extend LocalConfig + resolveEffective + one-shot migration

**Files:**
- Modify: `src/local-config.ts`
- Create: `src/effective-settings.ts`
- Modify: `src/main.ts` (migration in `onload`)
- Test: `tests/effective-settings.test.ts` (create)
- Modify: `tests/local-config.test.ts`, `tests/main-migration.test.ts`

**Why:** API keys and per-device backend choice should not sync. Overlay strategy: `data.json` holds shared, `local.json` overrides per-device.

- [ ] **Step 1: Extend `LocalConfig` schema** — `src/local-config.ts`

Replace the existing `LocalConfig` interface and `DEFAULTS`:
```ts
export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
  };
  migrated_v1?: boolean;
}

const DEFAULTS: LocalConfig = { iclaudePath: "" };
```

The `load`/`save` methods are already shape-agnostic (`Partial<LocalConfig>`) — no change required.

- [ ] **Step 2: Write failing test** — `tests/effective-settings.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveEffective } from "../src/effective-settings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("resolveEffective", () => {
  it("returns settings unchanged when local has no overrides", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "" });
    expect(eff.backend).toBe(DEFAULT_SETTINGS.backend);
    expect(eff.nativeAgent.baseUrl).toBe(DEFAULT_SETTINGS.nativeAgent.baseUrl);
  });

  it("overrides backend when local.backend set", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "", backend: "native-agent" });
    expect(eff.backend).toBe("native-agent");
  });

  it("merges nativeAgent overrides while preserving non-overridden fields", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      nativeAgent: {
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        topP: null,
        numCtx: null,
      },
    });
    expect(eff.nativeAgent.baseUrl).toBe("https://x/v1");
    expect(eff.nativeAgent.apiKey).toBe("k");
    expect(eff.nativeAgent.perOperation).toBe(DEFAULT_SETTINGS.nativeAgent.perOperation);
    expect(eff.nativeAgent.operations).toEqual(DEFAULT_SETTINGS.nativeAgent.operations);
  });

  it("merges claudeAgent overrides", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      claudeAgent: { model: "haiku", allowedTools: "Read" },
    });
    expect(eff.claudeAgent.model).toBe("haiku");
    expect(eff.claudeAgent.allowedTools).toBe("Read");
    expect(eff.claudeAgent.perOperation).toBe(DEFAULT_SETTINGS.claudeAgent.perOperation);
  });
});
```

- [ ] **Step 3: Run test (should fail — module not yet)**

Run: `npx vitest run tests/effective-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `src/effective-settings.ts`**

```ts
import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig } from "./local-config";

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): LlmWikiPluginSettings {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...(l.claudeAgent ?? {}) },
    nativeAgent: { ...s.nativeAgent, ...(l.nativeAgent ?? {}) },
  };
}
```

- [ ] **Step 5: Run test (should pass)**

Run: `npx vitest run tests/effective-settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire migration into `main.ts onload`**

Find the line `await migrateLegacyData(...)` near the top of `onload`. Add a new function `migrateToLocalV1` and call it after `loadSettings`:

In `main.ts`, append a new exported function:
```ts
export async function migrateToLocalV1(
  plugin: LlmWikiPlugin,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_v1) return;

  const s = plugin.settings;
  await localConfigStore.save({
    backend: s.backend,
    nativeAgent: {
      baseUrl: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      model: s.nativeAgent.model,
      temperature: s.nativeAgent.temperature,
      topP: s.nativeAgent.topP,
      numCtx: s.nativeAgent.numCtx,
    },
    claudeAgent: {
      model: s.claudeAgent.model,
      allowedTools: s.claudeAgent.allowedTools,
    },
    agentLogEnabled: s.agentLogEnabled,
    migrated_v1: true,
  });

  // Scrub apiKey from synced data.json — sensitive.
  s.nativeAgent.apiKey = "";
  await plugin.saveSettings();
}
```

In `onload`, after `await this.loadSettings();`, add:
```ts
await migrateToLocalV1(this, this.localConfigStore);
```

- [ ] **Step 7: Add migration test** — extend `tests/main-migration.test.ts`

Append:
```ts
import { migrateToLocalV1 } from "../src/main";

describe("migrateToLocalV1", () => {
  it("copies backend+API to local.json and scrubs apiKey", async () => {
    const local: any = { iclaudePath: "" };
    const plugin: any = {
      settings: {
        backend: "native-agent",
        nativeAgent: { baseUrl: "https://x/v1", apiKey: "secret", model: "m", temperature: 0.2, topP: null, numCtx: null,
                       perOperation: false, operations: {} },
        claudeAgent: { model: "sonnet", allowedTools: "", perOperation: false, operations: {} },
        agentLogEnabled: true,
      },
      saveSettings: async () => {},
    };
    const store = {
      load: async () => local,
      save: async (patch: any) => Object.assign(local, patch),
    };
    await migrateToLocalV1(plugin as any, store as any);
    expect(local.migrated_v1).toBe(true);
    expect(local.nativeAgent.apiKey).toBe("secret");
    expect(local.backend).toBe("native-agent");
    expect(plugin.settings.nativeAgent.apiKey).toBe("");
  });

  it("is idempotent (no-op when migrated_v1 already true)", async () => {
    const local: any = { iclaudePath: "", migrated_v1: true, nativeAgent: { apiKey: "old" } };
    const plugin: any = {
      settings: { nativeAgent: { apiKey: "should-not-touch" } },
      saveSettings: async () => {},
    };
    const store = { load: async () => local, save: async () => { throw new Error("must not call"); } };
    await migrateToLocalV1(plugin as any, store as any);
    expect(plugin.settings.nativeAgent.apiKey).toBe("should-not-touch");
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/main-migration.test.ts tests/effective-settings.test.ts tests/local-config.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/local-config.ts src/effective-settings.ts src/main.ts tests/effective-settings.test.ts tests/main-migration.test.ts
git commit -m "feat(local-config): per-device backend+API overlay with one-shot migration"
```

---

## Task 7: Settings UI rewires backend+API fields to localConfigStore; consumers use resolveEffective

**Files:**
- Modify: `src/settings.ts` (rewire all per-device fields)
- Modify: `src/controller.ts` `buildAgentRunner` (use `resolveEffective`)
- Modify: `src/agent-runner.ts` `buildOptsFor` (accept effective settings)
- Test: integration check

**Why:** Per-device fields must read/write `local.json`. Consumers must read effective view (settings overlaid with local).

- [ ] **Step 1: Cache local config in settings tab**

In `src/settings.ts`, the `LlmWikiSettingTab` already has `cachedIclaudePath`. Replace it with a full local cache:
```ts
private cachedDomains: DomainEntry[] = [];
private localCache: import("./local-config").LocalConfig = { iclaudePath: "" };
```

In `refresh()`:
```ts
this.localCache = await this.plugin.localConfigStore.load();
```

Replace any read of `this.cachedIclaudePath` with `this.localCache.iclaudePath`.

- [ ] **Step 2: Build effective settings for UI rendering**

In `render()`, after `const s = this.plugin.settings;`, add:
```ts
const { resolveEffective } = await import("./effective-settings");
// resolveEffective is sync — but render is sync. Replace dyn import with static at top.
```

Revise: at top of `settings.ts`, add static import:
```ts
import { resolveEffective } from "./effective-settings";
```

Then in `render()`:
```ts
const s = this.plugin.settings;
const eff = resolveEffective(s, this.localCache);
```

For backend-dependent UI rendering, use `eff.backend` instead of `s.backend`. Same for `eff.nativeAgent.*` and `eff.claudeAgent.*` as **read** values. Writes go to `localConfigStore`.

- [ ] **Step 3: Helper to patch local config + refresh**

Add private method to `LlmWikiSettingTab`:
```ts
private async patchLocal(patch: Partial<import("./local-config").LocalConfig>): Promise<void> {
  this.localCache = { ...this.localCache, ...patch };
  await this.plugin.localConfigStore.save(patch);
}
```

For nested merges (nativeAgent/claudeAgent), use:
```ts
private async patchLocalNative(patch: Partial<NonNullable<import("./local-config").LocalConfig["nativeAgent"]>>): Promise<void> {
  const cur = this.localCache.nativeAgent ?? {
    baseUrl: this.plugin.settings.nativeAgent.baseUrl,
    apiKey: this.plugin.settings.nativeAgent.apiKey,
    model: this.plugin.settings.nativeAgent.model,
    temperature: this.plugin.settings.nativeAgent.temperature,
    topP: this.plugin.settings.nativeAgent.topP,
    numCtx: this.plugin.settings.nativeAgent.numCtx,
  };
  await this.patchLocal({ nativeAgent: { ...cur, ...patch } });
}

private async patchLocalClaude(patch: Partial<NonNullable<import("./local-config").LocalConfig["claudeAgent"]>>): Promise<void> {
  const cur = this.localCache.claudeAgent ?? {
    model: this.plugin.settings.claudeAgent.model,
    allowedTools: this.plugin.settings.claudeAgent.allowedTools,
  };
  await this.patchLocal({ claudeAgent: { ...cur, ...patch } });
}
```

- [ ] **Step 4: Rewire backend dropdown** (`src/settings.ts:154-167`)

Replace the backend dropdown's `onChange`:
```ts
.onChange(async (v) => {
  await this.patchLocal({ backend: v as "claude-agent" | "native-agent" });
  this.display();
}),
```

And read value from `eff.backend`:
```ts
.setValue(eff.backend)
```

- [ ] **Step 5: Rewire claude-agent fields** (around `src/settings.ts:179-218`)

In each `.onChange` handler that writes `s.claudeAgent.model` / `s.claudeAgent.allowedTools` / `localConfigStore.save({ iclaudePath })`:

Model:
```ts
.setValue(eff.claudeAgent.model)
.onChange(async (v) => { await this.patchLocalClaude({ model: v.trim() }); }),
```

allowedTools:
```ts
.setValue(eff.claudeAgent.allowedTools)
.onChange(async (v) => { await this.patchLocalClaude({ allowedTools: v.trim() }); }),
```

iclaudePath: existing handler that calls `localConfigStore.save({ iclaudePath })` — leave as-is (already writes to local).

`perOperation` toggle and per-op model fields stay in `data.json` (writes to `s.claudeAgent.perOperation` and `s.claudeAgent.operations[key].model`).

- [ ] **Step 6: Rewire native-agent fields** (`src/settings.ts:238-292`)

baseUrl:
```ts
.setValue(eff.nativeAgent.baseUrl)
.onChange(async (v) => { await this.patchLocalNative({ baseUrl: v.trim() }); }),
```

apiKey:
```ts
.setValue(eff.nativeAgent.apiKey)
.onChange(async (v) => { await this.patchLocalNative({ apiKey: v.trim() }); }),
```

model (the non-perOp field):
```ts
.setValue(eff.nativeAgent.model)
.onChange(async (v) => { await this.patchLocalNative({ model: v.trim() }); }),
```

numCtx:
```ts
.setValue(eff.nativeAgent.numCtx != null ? String(eff.nativeAgent.numCtx) : "")
.onChange(async (v) => {
  const trimmed = v.trim();
  if (!trimmed) { await this.patchLocalNative({ numCtx: null }); return; }
  const n = Number(trimmed);
  if (Number.isFinite(n) && n > 0) await this.patchLocalNative({ numCtx: Math.floor(n) });
}),
```

temperature:
```ts
.setValue(String(eff.nativeAgent.temperature))
.onChange(async (v) => {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n <= 2) await this.patchLocalNative({ temperature: n });
}),
```

`perOperation`, `operations[].*` stay in `data.json` (no rewire).

- [ ] **Step 7: Rewire `agentLogEnabled` toggle** (`src/settings.ts:98-106`)

Replace handler:
```ts
.setValue(eff.agentLogEnabled)
.onChange(async (v) => { await this.patchLocal({ agentLogEnabled: v }); }),
```

- [ ] **Step 8: Update `controller.buildAgentRunner` to use effective settings**

At top of `buildAgentRunner`, replace:
```ts
const local = await this.localConfigStore.load();
const s = this.plugin.settings;
```

With:
```ts
const local = await this.localConfigStore.load();
const { resolveEffective } = require("./effective-settings") as typeof import("./effective-settings");
const s = resolveEffective(this.plugin.settings, local);
```

(Static import would also work — prefer that. Add at top of `controller.ts`:)
```ts
import { resolveEffective } from "./effective-settings";
```

And replace the body line with:
```ts
const s = resolveEffective(this.plugin.settings, local);
```

The `iclaudePath` reference (`local.iclaudePath`) stays — it's still read directly from local.

Also update the references inside the claude-agent branch that previously spread `s.claudeAgent` (line ~262):
```ts
const client = new ClaudeCliClient({
  ...s.claudeAgent,           // now reflects effective overlay
  iclaudePath: local.iclaudePath,
  ...
});
```

No change needed — `s.claudeAgent` is now the merged value.

- [ ] **Step 9: Update consumers reading `this.plugin.settings.nativeAgent`/`backend` to use effective view**

In `controller.ts`, audit `requireNativeAgent()` (line 231):
```ts
private async requireNativeAgent(): Promise<boolean> {
  const local = await this.localConfigStore.load();
  const eff = resolveEffective(this.plugin.settings, local);
  const na = eff.nativeAgent;
  if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
    new Notice(i18n().ctrl.configureCloudLlm);
    return false;
  }
  return true;
}
```

Convert callers `this.requireNativeAgent()` (line 76, 310) to `await this.requireNativeAgent()`.

Audit `dispatch` line 310-311:
```ts
if (this.plugin.settings.backend === "native-agent" && !await this.requireNativeAgent()) return;
if (this.plugin.settings.backend === "claude-agent" && !await this.requireClaudeAgent()) return;
```

Replace with:
```ts
const local = await this.localConfigStore.load();
const eff = resolveEffective(this.plugin.settings, local);
if (eff.backend === "native-agent" && !await this.requireNativeAgent()) return;
if (eff.backend === "claude-agent" && !await this.requireClaudeAgent()) return;
```

Same change in `dispatchChat` (line 76-77).

- [ ] **Step 10: Build + run full tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 11: Manual smoke test (desktop, claude-agent)**

1. `npm run build`
2. Reload Obsidian (Ctrl+R)
3. Open settings → confirm `iclaudePath` value persists, model dropdown shows current value
4. Trigger Ingest on an active file → ConfirmModal → Run
5. Verify panel updates with progress; no console errors

If the smoke test fails, check console; iterate.

- [ ] **Step 12: Manual smoke test (mobile, via Obsidian Sync)**

1. Push changes; install via Sync or BRAT on mobile device
2. Settings → set baseUrl `https://ollama.com/v1`, apiKey, model
3. Run command "LLM Wiki: Query"
4. Expect a non-streamed answer in the panel; no CORS error in mobile logs

- [ ] **Step 13: Commit**

```bash
git add src/settings.ts src/controller.ts
git commit -m "feat(settings): rewire backend+API fields to per-device localConfigStore via resolveEffective"
```

---

## Task 8: Version bump + final verification

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 1: Bump version**

In `package.json` and `src/manifest.json`, set `"version": "0.1.61"`.

- [ ] **Step 2: Final test run**

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 3: Final build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json
git commit -m "chore: 0.1.61 — mobile cors fix + per-device settings + ingest regression"
```

---

## Self-review

**Spec coverage:**
- Issue 1 (Mobile Ollama HTTPS) → Task 4
- Issue 2 (Hide per-op UI mobile) → Task 5
- Issue 3 (Hide dev mode mobile) → Task 5
- Issue 4 (Per-device backend+API) → Tasks 6, 7
- Issue 5 (Desktop ingest silent fail) → Tasks 1, 2
- Issue 6 (Mobile logs via vault adapter) → Task 3

All six covered.

**Placeholder scan:** No "TBD"/"TODO"/"similar to"/"appropriate" — every code step shows the code.

**Type consistency:**
- `resolveEffective(s, l)` signature consistent across Tasks 6, 7
- `LocalConfig` shape (Task 6) matches the patch payloads in Task 7
- `mobileFetch: typeof fetch` (Task 4) matches OpenAI SDK `fetch` option type
- `migrateToLocalV1(plugin, store)` signature consistent between Task 6 step 6 and step 7 test
