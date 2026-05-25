# timeout=0 No-Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow per-operation timeout values of `0` to mean "no time limit" across all three enforcement layers.

**Architecture:** Three independent layers must each handle `0` correctly: (1) `parseTimeoutString` validation in `settings.ts`, (2) subprocess kill guard in `claude-cli-client.ts`, (3) `buildAgentRunner` HTTP timeout in `controller.ts`. The `runOp` abort layer (`timeoutMs > 0`) already handles `0` correctly — no change there.

**Tech Stack:** TypeScript, Vitest, OpenAI SDK, ClaudeCliClient

---

## File Map

| File | Change |
|------|--------|
| `src/settings.ts` | `n > 0` → `n >= 0` at line 41 |
| `src/claude-cli-client.ts` | Guard subprocess kill at lines 149–153, 219 |
| `src/controller.ts` | Add `timeoutSec=0` param to `buildAgentRunner`, remove `maxTimeoutSec`, pass per-op timeout from `runOp` |
| `src/i18n.ts` | Add `(0 = no limit)` hint to `timeouts_desc` in en/ru/es |
| `tests/settings.test.ts` | Update "zero value → null" test, add "zero is valid" test |
| `tests/claude-cli-client.test.ts` | Add test: `timeoutSec=0` does not schedule kill |
| `tests/controller-per-op-timeout.test.ts` | New test: `buildAgentRunner` receives per-op `timeoutSec` |

---

### Task 1: Fix `parseTimeoutString` to accept `0`

**Files:**
- Modify: `src/settings.ts:41`
- Modify: `tests/settings.test.ts:18-20`

- [ ] **Step 1: Update "zero value → null" test to expect zero to be valid**

Open `tests/settings.test.ts`. Replace the existing `it("zero value → null", ...)` block with two tests:

```ts
  it("zero in one field → valid (0 = no limit)", () => {
    const r = parseTimeoutString("300/300/900/0/600");
    expect(r).toEqual({ ingest: 300, query: 300, lint: 900, init: 0, format: 600 });
  });

  it("all zeros → valid", () => {
    const r = parseTimeoutString("0/0/0/0/0");
    expect(r).toEqual({ ingest: 0, query: 0, lint: 0, init: 0, format: 0 });
  });

  it("negative value → null", () => {
    expect(parseTimeoutString("-1/300/900/3600/600")).toBeNull();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx vitest run tests/settings.test.ts
```

Expected: `zero in one field → valid` FAILS with "expected null to equal {...}"

- [ ] **Step 3: Fix validation in `src/settings.ts:41`**

```ts
// BEFORE (line 41):
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n > 0)) {
// AFTER:
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/settings.test.ts
```

Expected: all 6 tests PASS (3 original + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "fix(settings): allow 0 in parseTimeoutString — means no limit"
```

---

### Task 2: Fix subprocess kill guard in `claude-cli-client.ts`

**Files:**
- Modify: `src/claude-cli-client.ts:149-153` (setTimeout block)
- Modify: `src/claude-cli-client.ts:219` (clearTimeout)
- Modify: `tests/claude-cli-client.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Add to `tests/claude-cli-client.test.ts`, inside the `describe("ClaudeCliClient", ...)` block:

```ts
  it("timeoutSec=0 does not schedule a kill timer", async () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }),
      JSON.stringify({ type: "result", duration_ms: 10, total_cost_usd: 0, result: "ok", is_error: false }),
    ];
    (spawn as any).mockReturnValue(makeMockProcess(lines));

    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    const client = new ClaudeCliClient({ ...cfg, requestTimeoutSec: 0 });
    await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: false } as any,
    );

    // No kill timer should have been scheduled
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Expected: FAIL — `setTimeout` IS called (current code has no guard)

- [ ] **Step 3: Guard the kill timer in `src/claude-cli-client.ts:149-153`**

Current code (lines 149–153):
```ts
    const timeoutHandle = window.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
    }, timeoutSec * 1000);
```

Replace with:
```ts
    const timeoutHandle = timeoutSec > 0
      ? window.setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
        }, timeoutSec * 1000)
      : null;
```

- [ ] **Step 4: Guard clearTimeout in `src/claude-cli-client.ts:219`**

Current (line 219):
```ts
      window.clearTimeout(timeoutHandle);
```

Replace with:
```ts
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/claude-cli-client.ts tests/claude-cli-client.test.ts
git commit -m "fix(claude-cli-client): skip kill timer when timeoutSec=0"
```

---

### Task 3: Fix `buildAgentRunner` — per-op timeout param

**Files:**
- Modify: `src/controller.ts:434` (signature)
- Modify: `src/controller.ts:448` (remove maxTimeoutSec)
- Modify: `src/controller.ts:482` (requestTimeoutSec)
- Modify: `src/controller.ts:525` (OpenAI timeout)
- Create: `tests/controller-per-op-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/controller-per-op-timeout.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WikiController } from "../src/controller";
import type { AgentRunner } from "../src/agent-runner";
import type { RunEvent } from "../src/types";
import type { LlmWikiView } from "../src/view";

function makeApp() {
  return {
    vault: {
      adapter: {
        getBasePath: () => "/tmp/vault",
        getFullPath: (p: string) => `/tmp/vault/${p}`,
        read: vi.fn().mockResolvedValue(""),
        write: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        mkdir: vi.fn().mockResolvedValue(undefined),
        append: vi.fn().mockResolvedValue(undefined),
      },
      configDir: ".obsidian",
      getName: () => "vault",
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      modify: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: vi.fn().mockResolvedValue(undefined) }),
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue({ path: "notes/x.md", extension: "md", name: "x.md" }),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makeStubRunner(): AgentRunner {
  const resultEvent: RunEvent = { kind: "result", text: "ok", durationMs: 10, inputTokens: 1, outputTokens: 1 };
  return { run: vi.fn(async function* () { yield resultEvent; }) } as unknown as AgentRunner;
}

function makeStubView(): LlmWikiView {
  return {
    setRunning: vi.fn(),
    appendEvent: vi.fn(),
    finish: vi.fn().mockResolvedValue(undefined),
  } as unknown as LlmWikiView;
}

type PrivateCtrl = {
  buildAgentRunner: (vaultRoot: string, resumeId?: string, opKey?: string, timeoutSec?: number) => Promise<AgentRunner>;
  ensureView: () => Promise<void>;
  activeView: () => LlmWikiView | null;
  dispatch: (op: string, args: string[], domainId?: string) => Promise<void>;
};

describe("WikiController — per-op timeout forwarded to buildAgentRunner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes ingest timeout (60s) to buildAgentRunner, not query timeout (300s)", async () => {
    const app = makeApp();
    const plugin = {
      settings: {
        backend: "native-agent",
        nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
        timeouts: { ingest: 60, query: 300, lint: 900, init: 3600, format: 600 },
        agentLogEnabled: false,
        history: [],
        historyLimit: 20,
        devMode: { enabled: false, evaluatorModel: "sonnet" },
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
      app,
    } as unknown as Parameters<typeof WikiController>[1];

    const domainStore = { load: vi.fn().mockResolvedValue([]), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
    const localConfigStore = { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];

    const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
    const priv = ctrl as unknown as PrivateCtrl;

    const stubRunner = makeStubRunner();
    const buildSpy = vi.spyOn(priv, "buildAgentRunner").mockResolvedValue(stubRunner);
    vi.spyOn(priv, "ensureView").mockResolvedValue(undefined);
    vi.spyOn(priv, "activeView").mockReturnValue(makeStubView());

    await priv.dispatch("ingest", ["/tmp/vault/notes/x.md"]);

    expect(buildSpy).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      "ingest",
      60,
    );
  });

  it("passes 0 (unlimited) when ingest timeout is 0", async () => {
    const app = makeApp();
    const plugin = {
      settings: {
        backend: "native-agent",
        nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
        timeouts: { ingest: 0, query: 300, lint: 900, init: 3600, format: 600 },
        agentLogEnabled: false,
        history: [],
        historyLimit: 20,
        devMode: { enabled: false, evaluatorModel: "sonnet" },
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
      app,
    } as unknown as Parameters<typeof WikiController>[1];

    const domainStore = { load: vi.fn().mockResolvedValue([]), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
    const localConfigStore = { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];

    const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
    const priv = ctrl as unknown as PrivateCtrl;

    const stubRunner = makeStubRunner();
    const buildSpy = vi.spyOn(priv, "buildAgentRunner").mockResolvedValue(stubRunner);
    vi.spyOn(priv, "ensureView").mockResolvedValue(undefined);
    vi.spyOn(priv, "activeView").mockReturnValue(makeStubView());

    await priv.dispatch("ingest", ["/tmp/vault/notes/x.md"]);

    expect(buildSpy).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      "ingest",
      0,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/controller-per-op-timeout.test.ts
```

Expected: FAIL — `buildAgentRunner` called with 3 args, not 4 (current signature doesn't have `timeoutSec`)

- [ ] **Step 3: Update `buildAgentRunner` signature in `src/controller.ts:434`**

```ts
// BEFORE (line 434):
  private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string, opKey?: string): Promise<AgentRunner> {
// AFTER:
  private async buildAgentRunner(vaultRoot: string, resumeSessionId?: string, opKey?: string, timeoutSec = 0): Promise<AgentRunner> {
```

- [ ] **Step 4: Remove `maxTimeoutSec` and use `timeoutSec` in `src/controller.ts:448`**

Remove line 448:
```ts
    const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
```

- [ ] **Step 5: Replace `maxTimeoutSec` with `timeoutSec` at ClaudeCliClient construction (line ~482)**

```ts
// BEFORE:
        requestTimeoutSec: maxTimeoutSec,
// AFTER:
        requestTimeoutSec: timeoutSec,
```

- [ ] **Step 6: Replace `maxTimeoutSec` with guarded value at OpenAI construction (line ~525)**

```ts
// BEFORE:
        timeout: maxTimeoutSec * 1000,
// AFTER:
        timeout: timeoutSec > 0 ? timeoutSec * 1000 : undefined,
```

- [ ] **Step 7: Run TypeScript build to verify no compile errors**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Run new tests — still fail (runOp hasn't passed timeoutSec yet)**

```bash
npx vitest run tests/controller-per-op-timeout.test.ts
```

Expected: FAIL — `buildAgentRunner` still called with `timeoutSec=undefined` (default 0, not the 60 from settings)

---

### Task 4: Fix `runOp` to pass per-op `timeoutSec`

**Files:**
- Modify: `src/controller.ts:599-623`

- [ ] **Step 1: Extract `opTimeoutSec` before `buildAgentRunner` call and pass it**

Current code (lines 599–603):
```ts
    const opKey = op === "lint-chat" ? "lint" : op;

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey);
```

Replace with:
```ts
    const opKey = op === "lint-chat" ? "lint" : op;
    const opTimeoutSec = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts];

    let agentRunner: AgentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey, opTimeoutSec);
```

- [ ] **Step 2: Simplify `timeoutMs` computation at line 623**

```ts
// BEFORE (line 623):
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
// AFTER:
    const timeoutMs = opTimeoutSec * 1000;
```

- [ ] **Step 3: Run new tests to verify they pass**

```bash
npx vitest run tests/controller-per-op-timeout.test.ts
```

Expected: both tests PASS

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts tests/controller-per-op-timeout.test.ts
git commit -m "fix(controller): pass per-op timeoutSec to buildAgentRunner, remove maxTimeoutSec"
```

---

### Task 5: Update i18n timeout descriptions

**Files:**
- Modify: `src/i18n.ts:19` (en)
- Modify: `src/i18n.ts:240` (ru)
- Modify: `src/i18n.ts:459` (es)

- [ ] **Step 1: Update English description at line 19**

```ts
// BEFORE:
    timeouts_desc: "ingest / query / lint / init / format",
// AFTER:
    timeouts_desc: "ingest / query / lint / init / format (0 = no limit)",
```

- [ ] **Step 2: Update Russian description at line 240**

```ts
// BEFORE:
    timeouts_desc: "ingest / query / lint / init / format",
// AFTER:
    timeouts_desc: "ingest / query / lint / init / format (0 = без лимита)",
```

- [ ] **Step 3: Update Spanish description at line 459**

```ts
// BEFORE:
    timeouts_desc: "ingest / query / lint / init / format",
// AFTER:
    timeouts_desc: "ingest / query / lint / init / format (0 = sin límite)",
```

- [ ] **Step 4: Build to verify no errors**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): document 0=no limit in timeout field descriptions"
```

---

### Task 6: Final verification and lat.md update

**Files:**
- Modify: `lat.md/architecture.md` (update Backends section)

- [ ] **Step 1: Run full test suite one more time**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 2: Run lat check**

```bash
lat check
```

Expected: no errors

- [ ] **Step 3: Update lat.md/architecture.md — Backends section**

Find the `### Claude Agent` subsection (currently ends with "Per-operation effort levels map to Claude's extended thinking."). Append to the paragraph or add a note:

In the **Native Agent** section, update to mention per-op timeout:

```markdown
### Native Agent

OpenAI-compatible HTTP client (`openai` SDK). Works with Ollama, OpenAI, or any compatible server. Supports streaming, `json_object` response format, thinking budget, and per-operation model overrides.

HTTP `timeout` is set per-operation from `settings.timeouts[opKey]`. A value of `0` passes `undefined` to the SDK (no HTTP timeout). See [[src/controller.ts#WikiController#buildAgentRunner]].

On mobile, streaming is disabled via `wrapMobileNoStream`. See [[src/controller.ts#WikiController#buildAgentRunner]].
```

In the **Claude Agent** section, add per-op timeout note:

```markdown
### Claude Agent

Wraps `ClaudeCliClient` — spawns `iclaude.sh` / `claude` CLI as a subprocess. Shell consent is required on first run. Not available on mobile.

Per-operation effort levels map to Claude's extended thinking. The subprocess kill timer is skipped when `requestTimeoutSec=0` (no-limit mode). See [[src/claude-cli-client.ts#ClaudeCliClient]].
```

- [ ] **Step 4: Run lat check again**

```bash
lat check
```

Expected: PASS

- [ ] **Step 5: Final commit**

```bash
git add lat.md/
git commit -m "docs(lat): document per-op timeout and 0=no-limit behavior in architecture"
```
