# Mobile Query Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `query` and `query-save` commands on Obsidian Mobile (iOS/Android) using the existing `native-agent` cloud HTTP backend; gate all desktop-only ops and `node:*` calls behind `Platform.isMobile` checks.

**Architecture:** Single bundle. Runtime branching via Obsidian `Platform.isMobile`. On mobile: backend forced to `native-agent`, only query/query-save/open-panel/cancel commands registered, all `node:fs`/`node:path`/`child_process` calls gated or replaced with vault-relative ops. `ClaudeCliClient` lazily imported only on desktop.

**Tech Stack:** TypeScript, Obsidian Plugin API, OpenAI SDK (HTTPS), esbuild, vitest.

**Spec:** `docs/superpowers/specs/2026-05-07-mobile-query-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `manifest.json` (root) | Plugin manifest seen by Obsidian | Modify |
| `src/manifest.json` | Source manifest mirrored into dist | Modify |
| `vitest.mock.ts` | Test mock for `obsidian` module | Modify (add `Platform` toggle helper) |
| `src/main.ts` | Plugin entry. Mobile backend migration + command gating | Modify |
| `src/controller.ts` | Operation dispatch, runner build, native-agent precheck | Modify |
| `src/agent-runner.ts` | Phase routing, dev-log fs guards | Modify |
| `src/phases/query.ts` | Query phase, drop `node:path` | Modify |
| `src/settings.ts` | Settings UI, hide claude-agent on mobile | Modify |
| `tests/main-mobile.test.ts` | Mobile loadSettings backend migration | Create |
| `tests/controller-mobile.test.ts` | Mobile dispatch guard + native-agent precheck | Create |
| `tests/no-fs-imports.test.ts` | Static check: query.ts has no `node:*` imports | Create |
| `docs/mobile-cloud-ollama.md` | User guide for cloud LLM setup on mobile | Create |
| `package.json` + `src/manifest.json` | Patch version bump | Modify (final task) |

---

## Task 1: Flip manifest desktop-only flag

**Files:**
- Modify: `manifest.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Edit root manifest**

Change `"isDesktopOnly": true` → `"isDesktopOnly": false` in `manifest.json`.

- [ ] **Step 2: Edit src manifest**

Same change in `src/manifest.json`.

- [ ] **Step 3: Verify identical**

Run: `diff manifest.json src/manifest.json`
Expected: no output (files identical).

- [ ] **Step 4: Commit**

```bash
git add manifest.json src/manifest.json
git commit -m "chore(manifest): allow mobile install (isDesktopOnly=false)"
```

---

## Task 2: Add Platform toggle to test mock

**Files:**
- Modify: `vitest.mock.ts`

- [ ] **Step 1: Make Platform mutable**

In `vitest.mock.ts`, replace:

```ts
export const Platform = {
  isMobile: false,
};
```

with:

```ts
export const Platform = {
  isMobile: false,
  isDesktop: true,
};

/** Test helper — flip isMobile/isDesktop atomically. */
export function __setPlatformMobile(isMobile: boolean): void {
  Platform.isMobile = isMobile;
  Platform.isDesktop = !isMobile;
}
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add vitest.mock.ts
git commit -m "test(mock): expose __setPlatformMobile helper for mobile tests"
```

---

## Task 3: Mobile backend migration in loadSettings (TDD)

**Files:**
- Create: `tests/main-mobile.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing test**

Create `tests/main-mobile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setPlatformMobile } from "obsidian";
import LlmWikiPlugin from "../src/main";

function makePlugin(stored: any) {
  const adapter = {
    exists: vi.fn().mockResolvedValue(false),
    read: vi.fn(), write: vi.fn(), mkdir: vi.fn(),
    rename: vi.fn(), remove: vi.fn(),
  };
  const plugin: any = Object.create(LlmWikiPlugin.prototype);
  plugin.app = { vault: { adapter } };
  plugin.manifest = { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" };
  plugin.loadData = vi.fn().mockResolvedValue(stored);
  plugin.saveData = vi.fn().mockImplementation(async (d: any) => { stored = d; });
  return plugin;
}

describe("loadSettings — mobile backend migration", () => {
  beforeEach(() => __setPlatformMobile(false));

  it("forces backend to native-agent on mobile when stored backend is claude-agent", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "claude-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("native-agent");
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("leaves backend untouched on desktop", async () => {
    __setPlatformMobile(false);
    const plugin = makePlugin({ backend: "claude-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("claude-agent");
  });

  it("leaves native-agent backend untouched on mobile", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "native-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("native-agent");
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run tests/main-mobile.test.ts`
Expected: FAIL — backend stays `claude-agent` on mobile.

- [ ] **Step 3: Add migration to loadSettings**

In `src/main.ts`, add `Platform` import:

```ts
import { Plugin, WorkspaceLeaf, Platform } from "obsidian";
```

Inside `loadSettings()`, **after** the existing `claude-code` migration block (around line 156-160), **before** the `agentLogPath` migration, insert:

```ts
    // Mobile: force native-agent backend (claude-agent unsupported on mobile).
    if (Platform.isMobile && this.settings.backend === "claude-agent") {
      this.settings.backend = "native-agent";
      await this.saveData(this.settings);
    }
```

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run tests/main-mobile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/main-mobile.test.ts src/main.ts
git commit -m "feat(main): force native-agent backend on mobile in loadSettings"
```

---

## Task 4: Gate desktop-only commands in onload (TDD)

**Files:**
- Modify: `tests/main-mobile.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/main-mobile.test.ts`:

```ts
describe("onload — command registration gating", () => {
  beforeEach(() => __setPlatformMobile(false));

  function setupPlugin() {
    const plugin = makePlugin({});
    const registered: string[] = [];
    plugin.addCommand = vi.fn((cmd: { id: string }) => { registered.push(cmd.id); });
    plugin.addRibbonIcon = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.registerView = vi.fn();
    plugin.app.workspace = { getLeavesOfType: () => [], getRightLeaf: () => null };
    return { plugin, registered };
  }

  it("desktop: registers all commands", async () => {
    __setPlatformMobile(false);
    const { plugin, registered } = setupPlugin();
    await plugin.onload();
    expect(registered).toEqual(
      expect.arrayContaining(["open-panel", "ingest-current", "query", "query-save", "lint", "init", "cancel"]),
    );
  });

  it("mobile: registers only query/query-save/open-panel/cancel", async () => {
    __setPlatformMobile(true);
    const { plugin, registered } = setupPlugin();
    await plugin.onload();
    expect(registered).toEqual(
      expect.arrayContaining(["open-panel", "query", "query-save", "cancel"]),
    );
    expect(registered).not.toContain("ingest-current");
    expect(registered).not.toContain("lint");
    expect(registered).not.toContain("init");
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run tests/main-mobile.test.ts -t "command registration"`
Expected: FAIL — mobile registers all commands.

- [ ] **Step 3: Wrap desktop-only commands**

In `src/main.ts`, in `onload()`, wrap the three desktop-only `addCommand` blocks (`ingest-current`, `lint`, `init`) inside an `if (!Platform.isMobile)` block:

```ts
    if (!Platform.isMobile) {
      this.addCommand({
        id: "ingest-current",
        name: T.cmd.ingestActive,
        callback: () => void this.controller.ingestActive(),
      });

      this.addCommand({
        id: "lint",
        name: T.cmd.lint,
        callback: () => {
          void (async () => {
            let domains: DomainEntry[];
            try { domains = await this.controller.loadDomains(); } catch { return; }
            new DomainModal(this.app, T.cmd.lint, true, null, domains,
              (d) => void this.controller.lint(d)).open();
          })();
        },
      });

      this.addCommand({
        id: "init",
        name: T.cmd.init,
        callback: () => {
          void (async () => {
            let domains: DomainEntry[];
            try { domains = await this.controller.loadDomains(); } catch { return; }
            new DomainModal(this.app, T.cmd.init, false, { dryRun: true }, domains,
              (d, f) => void this.controller.init(d, f.dryRun ?? false)).open();
          })();
        },
      });
    }
```

Leave `open-panel`, `query`, `query-save`, `cancel` outside the guard.

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run tests/main-mobile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/main-mobile.test.ts src/main.ts
git commit -m "feat(main): gate ingest/lint/init commands behind Platform.isDesktop"
```

---

## Task 5: Native-agent precheck + mobile dispatch guard (TDD)

**Files:**
- Create: `tests/controller-mobile.test.ts`
- Modify: `src/controller.ts`

- [ ] **Step 1: Write failing test**

Create `tests/controller-mobile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setPlatformMobile, Notice } from "obsidian";
import { WikiController } from "../src/controller";

function makeApp() {
  return {
    vault: {
      adapter: { getBasePath: () => "/tmp/vault", getFullPath: (p: string) => `/tmp/vault/${p}` },
      configDir: ".obsidian",
      getName: () => "vault",
    },
    workspace: { getLeavesOfType: () => [], getRightLeaf: () => null, revealLeaf: vi.fn() },
  } as any;
}

function makePlugin(settings: any) {
  return {
    settings,
    saveSettings: vi.fn(),
    manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
    app: makeApp(),
  } as any;
}

describe("controller — mobile guards", () => {
  beforeEach(() => {
    __setPlatformMobile(false);
    vi.spyOn(Notice.prototype as any, "constructor").mockImplementation(() => {});
  });

  it("mobile: rejects ingest dispatch with Notice", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "native-agent", nativeAgent: { baseUrl: "x", apiKey: "y" } });
    const ctrl = new WikiController(makeApp(), plugin, {} as any, {} as any);
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.ingestActive();
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it("mobile: rejects native-agent query when baseUrl empty", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "native-agent", nativeAgent: { baseUrl: "", apiKey: "y" } });
    const ctrl = new WikiController(makeApp(), plugin, {} as any, {} as any);
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.query("test", false);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it("mobile: rejects native-agent query when apiKey empty", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "native-agent", nativeAgent: { baseUrl: "https://api.x", apiKey: "" } });
    const ctrl = new WikiController(makeApp(), plugin, {} as any, {} as any);
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.query("test", false);
    expect(buildSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run tests/controller-mobile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `requireNativeAgent` and dispatch guard**

In `src/controller.ts`:

Add `Platform` import:

```ts
import { App, Notice, Platform } from "obsidian";
```

Add method below `requireClaudeAgent`:

```ts
  private requireNativeAgent(): boolean {
    const na = this.plugin.settings.nativeAgent;
    if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
      new Notice("Configure cloud LLM (baseUrl + apiKey) in settings");
      return false;
    }
    return true;
  }
```

In `dispatch()`, **before** the `requireClaudeAgent` line, add mobile gate:

```ts
    if (Platform.isMobile && op !== "query" && op !== "query-save") {
      new Notice("Operation not available on mobile");
      return;
    }
    if (this.plugin.settings.backend === "native-agent" && !this.requireNativeAgent()) return;
    if (this.plugin.settings.backend === "claude-agent" && !await this.requireClaudeAgent()) return;
```

Replace the existing single `if (this.plugin.settings.backend === "claude-agent" ...)` line with the three lines above. Apply the same `requireNativeAgent` precheck in `dispatchChat()` (replace the existing `requireClaudeAgent`-only check).

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run tests/controller-mobile.test.ts`
Expected: PASS (3 tests). Existing tests still pass: `npm test`.

- [ ] **Step 5: Commit**

```bash
git add tests/controller-mobile.test.ts src/controller.ts
git commit -m "feat(controller): mobile dispatch guard + native-agent precheck"
```

---

## Task 6: Lazy fs imports in controller.ts

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Move fs imports inside functions**

Top of `src/controller.ts` currently:

```ts
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
```

Replace with: delete these top-level imports.

In `requireClaudeAgent()`, add inline:

```ts
  private async requireClaudeAgent(): Promise<string | null> {
    const { existsSync } = await import("node:fs");
    const { iclaudePath } = await this.localConfigStore.load();
    if (!iclaudePath || !existsSync(iclaudePath)) {
      new Notice(i18n().ctrl.setClaudeCodePath);
      return null;
    }
    return iclaudePath;
  }
```

In `buildAgentRunner()`, replace `mkdirSync(tmpDir, { recursive: true })` and `join` with:

```ts
    const { join } = await import("node:path");
    const { mkdirSync } = await import("node:fs");
    const manifestDir = this.plugin.manifest.dir
      ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
    const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
      .getFullPath(manifestDir);
    const tmpDir = join(pluginDir, "tmp");
    mkdirSync(tmpDir, { recursive: true });
```

Note: this whole block runs only on the desktop branch (`backend === "claude-agent"`). Wrap entire fs/path logic + `ClaudeCliClient` creation inside the existing `if (s.backend === "claude-agent")` so mobile path skips it. Convert `ClaudeCliClient` import to dynamic too:

```ts
    if (s.backend === "claude-agent") {
      const { join } = await import("node:path");
      const { mkdirSync } = await import("node:fs");
      const { ClaudeCliClient } = await import("./claude-cli-client");
      const manifestDir = this.plugin.manifest.dir
        ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
      const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
        .getFullPath(manifestDir);
      const tmpDir = join(pluginDir, "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const client = new ClaudeCliClient({
        ...s.claudeAgent,
        iclaudePath: local.iclaudePath,
        requestTimeoutSec: maxTimeoutSec,
        cwd: vaultRoot,
        tmpDir,
        resumeSessionId,
      });
      this._currentClaudeClient = client;
      llm = client;
    } else {
      this._currentClaudeClient = null;
      llm = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: maxTimeoutSec * 1000,
        dangerouslyAllowBrowser: true,
      });
    }
```

Remove top-level `import { ClaudeCliClient } from "./claude-cli-client";`.

In `logEvent()`, gate fs import behind `agentLogEnabled` (already there) AND mobile:

```ts
  private async logEvent(vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!this.plugin.settings.agentLogEnabled) return;
    if (Platform.isMobile) return;
    try {
      const { join } = await import("node:path");
      const { appendFileSync, mkdirSync } = await import("node:fs");
      const logDir = join(vaultRoot, "!Logs");
      mkdirSync(logDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), session: sessionId, op, domainId, event: ev }) + "\n";
      appendFileSync(join(logDir, "agent.jsonl"), line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

Note: `logEvent` becomes async. Update all call sites — replace `this.logEvent(...)` with `await this.logEvent(...)` in the 6 call sites within `controller.ts`.

In `toVaultPath()`, replace `relative`/`isAbsolute`/`join` with dynamic import:

```ts
  private async toVaultPath(vaultDir: string, savedPath: string): Promise<string | null> {
    const { relative, isAbsolute, join } = await import("node:path");
    const abs = isAbsolute(savedPath) ? savedPath : join(vaultDir, savedPath);
    const rel = relative(vaultDir, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel;
  }
```

Update call site at end of `dispatch()`:

```ts
        const pathInVault = await this.toVaultPath(vaultRoot, m[1]);
```

Note: `toVaultPath` only used in `query-save` post-processing. On mobile, `query-save` opens a vault link — safer to gate this whole block behind `!Platform.isMobile`:

```ts
    if (op === "query-save" && status === "done" && !Platform.isMobile) {
      const m = finalText.match(/Создана\s+страница:\s*([^\s`'"]+)/i);
      if (m) {
        const pathInVault = await this.toVaultPath(vaultRoot, m[1]);
        if (pathInVault) await this.app.workspace.openLinkText(pathInVault, "");
      }
    }
```

(Mobile `query-save` still saves the page — the `runQuery` write happens via `vaultTools`. The post-write open is desktop-only convenience.)

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Build to confirm no compile errors**

Run: `npm run build`
Expected: build succeeds, `main.js` produced.

- [ ] **Step 4: Verify no top-level node:* imports in controller**

Run: `grep -E '^import.*"node:' src/controller.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "refactor(controller): lazy-load node:fs/path/claude-cli for mobile compat"
```

---

## Task 7: Lazy fs imports in agent-runner.ts

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Remove top-level fs/path imports**

Top of `src/agent-runner.ts`:

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
```

Delete both lines.

- [ ] **Step 2: Add Platform import + inline imports in dev-log methods**

Add at top:

```ts
import { Platform } from "obsidian";
```

Replace `writeDevLog`:

```ts
  private async writeDevLog(vaultRoot: string, entry: {
    operation: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    result: string;
    durationMs: number;
  }): Promise<void> {
    if (!this.settings.devMode?.enabled) return;
    if (Platform.isMobile) return;
    try {
      const { appendFileSync, mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const logDir = join(vaultRoot, "!Logs");
      mkdirSync(logDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(join(logDir, "dev.jsonl"), line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

Replace `updateDevLogEval`:

```ts
  private async updateDevLogEval(vaultRoot: string, score: number, reasoning: string): Promise<void> {
    if (!this.settings.devMode?.enabled) return;
    if (Platform.isMobile) return;
    try {
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const logPath = join(vaultRoot, "!Logs", "dev.jsonl");
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trimEnd().split("\n");
      const lastIdx = lines.length - 1;
      const last = JSON.parse(lines[lastIdx]);
      last.eval = { score, reasoning };
      lines[lastIdx] = JSON.stringify(last);
      writeFileSync(logPath, lines.join("\n") + "\n", "utf-8");
    } catch { /* не блокируем */ }
  }
```

Update call sites — both methods are now async. Find:

```ts
this.writeDevLog(vaultRoot, { ... });
```
Replace with:
```ts
await this.writeDevLog(vaultRoot, { ... });
```

Find:
```ts
this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
```
Replace with:
```ts
await this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
```

- [ ] **Step 3: Verify no top-level node:* imports**

Run: `grep -E '^import.*"node:' src/agent-runner.ts`
Expected: no output.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass (existing `agent-runner.integration.test.ts` should still pass with `devMode.enabled=false` default).

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "refactor(agent-runner): lazy-load node:fs/path for mobile compat"
```

---

## Task 8: Drop node:path from phases/query.ts

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Remove node:path import**

Top of `src/phases/query.ts`:

```ts
import { join } from "node:path";
```

Delete.

- [ ] **Step 2: Replace `join(vaultRoot, ...)` with vault-relative resolution**

Current (line 37):

```ts
const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
const wikiVaultPath = vaultTools.toVaultPath(absWiki);
```

The `vaultTools.toVaultPath(absWiki)` strips `vaultRoot` back off. Replace with direct vault-relative path:

```ts
const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
```

Then the existing check:

```ts
if (!wikiVaultPath) {
  yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
  return;
}
```

Tighten — `domainWikiFolder` returns a string. Check it isn't empty and doesn't escape:

```ts
if (!wikiVaultPath || wikiVaultPath.startsWith("..") || wikiVaultPath.startsWith("/")) {
  yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
  return;
}
```

- [ ] **Step 3: Run query phase tests**

Run: `npx vitest run tests/phases/`
Expected: pass. If query phase has tests, they may need updating to match new behavior — but `wikiVaultPath` value is unchanged.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts
git commit -m "refactor(query): drop node:path, use vault-relative path directly"
```

---

## Task 9: Static no-fs-imports test

**Files:**
- Create: `tests/no-fs-imports.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/no-fs-imports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MOBILE_HOT_PATH_FILES = [
  "src/phases/query.ts",
  "src/main.ts",
];

describe("mobile hot path: no top-level node:* imports", () => {
  for (const f of MOBILE_HOT_PATH_FILES) {
    it(`${f} has no top-level node:* import`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf-8");
      const lines = src.split("\n");
      const offending = lines.filter((l) => /^import\s.*from\s+["']node:/.test(l));
      expect(offending, `Found node:* top-level import in ${f}: ${offending.join(", ")}`).toEqual([]);
    });
  }
});

describe("mobile hot path: controller/agent-runner have no top-level node:* imports", () => {
  // controller and agent-runner may use dynamic imports inside methods;
  // this test catches regressions where someone re-adds a top-level import.
  for (const f of ["src/controller.ts", "src/agent-runner.ts"]) {
    it(`${f} has no top-level node:* import`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf-8");
      const lines = src.split("\n");
      const offending = lines.filter((l) => /^import\s.*from\s+["']node:/.test(l));
      expect(offending).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run — verify PASS**

Run: `npx vitest run tests/no-fs-imports.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/no-fs-imports.test.ts
git commit -m "test(mobile): static guard against node:* top-level imports in hot path"
```

---

## Task 10: Hide claude-agent UI on mobile

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Import Platform**

Top of `src/settings.ts`:

```ts
import { App, Notice, PluginSettingTab, Setting, Platform } from "obsidian";
```

- [ ] **Step 2: Replace backend dropdown with mobile-aware version**

Find the backend dropdown block (around line 152-164):

```ts
new Setting(containerEl)
  .setName(T.settings.backend_name)
  .setDesc(T.settings.backend_desc)
  .addDropdown((d) =>
    d.addOption("claude-agent", T.settings.claudeCodeAgent)
      .addOption("native-agent", T.settings.nativeAgent)
      .setValue(s.backend)
      .onChange(async (v) => {
        s.backend = v as LlmWikiPluginSettings["backend"];
        await this.plugin.saveSettings();
        this.display();
      }),
  );
```

Replace with:

```ts
if (!Platform.isMobile) {
  new Setting(containerEl)
    .setName(T.settings.backend_name)
    .setDesc(T.settings.backend_desc)
    .addDropdown((d) =>
      d.addOption("claude-agent", T.settings.claudeCodeAgent)
        .addOption("native-agent", T.settings.nativeAgent)
        .setValue(s.backend)
        .onChange(async (v) => {
          s.backend = v as LlmWikiPluginSettings["backend"];
          await this.plugin.saveSettings();
          this.display();
        }),
    );
} else {
  containerEl.createEl("p", {
    text: "Mobile: cloud LLM (native-agent) only. See docs/mobile-cloud-ollama.md.",
    cls: "setting-item-description",
  });
}
```

- [ ] **Step 3: Force native branch render on mobile**

Find:

```ts
if (s.backend === "claude-agent") {
```

Replace with:

```ts
if (s.backend === "claude-agent" && !Platform.isMobile) {
```

This ensures mobile always renders the native-agent settings even if some race left `backend === "claude-agent"` momentarily.

- [ ] **Step 4: Skip agentLog toggle on mobile**

Find the `agentLog` Setting block (around line 99-104):

```ts
new Setting(containerEl)
  .setName(T.settings.agentLog_name)
  .setDesc(T.settings.agentLog_desc)
  .addToggle((t) =>
    t.setValue(s.agentLogEnabled)
      .onChange(async (v) => { s.agentLogEnabled = v; await this.plugin.saveSettings(); }),
  );
```

Wrap:

```ts
if (!Platform.isMobile) {
  new Setting(containerEl)
    .setName(T.settings.agentLog_name)
    .setDesc(T.settings.agentLog_desc)
    .addToggle((t) =>
      t.setValue(s.agentLogEnabled)
        .onChange(async (v) => { s.agentLogEnabled = v; await this.plugin.saveSettings(); }),
    );
}
```

- [ ] **Step 5: Run tests + build**

Run: `npm test && npm run build`
Expected: pass + build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): hide claude-agent + agentLog UI on mobile"
```

---

## Task 11: User documentation

**Files:**
- Create: `docs/mobile-cloud-ollama.md`

- [ ] **Step 1: Write the guide**

Create `docs/mobile-cloud-ollama.md`:

```markdown
# Mobile setup — cloud LLM (Obsidian Mobile, iOS/Android)

LLM Wiki on mobile supports `query` and `query-save` commands only. Other operations (`ingest`, `lint`, `init`, `fix`, `chat`) require Obsidian Desktop.

This guide shows how to point the plugin at a cloud-hosted LLM via the OpenAI-compatible HTTP API.

## Quick start

1. Install the plugin on mobile (via Obsidian Sync or BRAT — `manifest.json` now allows mobile).
2. Open **Settings → LLM Wiki**.
3. Backend is forced to `native-agent` on mobile (no toggle shown).
4. Fill in three fields:
   - **Base URL** — provider's OpenAI-compatible endpoint
   - **API key** — provider key (or any non-empty string for self-hosted Ollama)
   - **Model** — model name as expected by the provider
5. Pick a domain in the right-side panel.
6. Run command **LLM Wiki: Query**, type a question.

## Provider examples

### OpenRouter

| Field | Value |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| API key | `sk-or-...` (from openrouter.ai → Keys) |
| Model | `anthropic/claude-3.5-sonnet` (or any OpenRouter model) |

### Ollama Cloud

| Field | Value |
|---|---|
| Base URL | `https://ollama.com/v1` |
| API key | Your Ollama Cloud API key |
| Model | `llama3.2` (or any pulled model) |

### together.ai

| Field | Value |
|---|---|
| Base URL | `https://api.together.xyz/v1` |
| API key | `...` (from api.together.ai) |
| Model | e.g. `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo` |

### Self-hosted Ollama via Tailscale

Run Ollama on a desktop / home server. Reach it from the phone via Tailscale.

| Field | Value |
|---|---|
| Base URL | `https://<your-tailnet-name>.ts.net:11434/v1` |
| API key | `ollama` (any non-empty value) |
| Model | `llama3.2` (or whichever you have pulled) |

Required server-side env var so Ollama accepts requests from a mobile WebView origin:

```
OLLAMA_ORIGINS=*
OLLAMA_HOST=0.0.0.0
```

Trust the Tailscale-issued certificate on the phone (Settings → Tailscale → MagicDNS).

## API key security

- Keys are stored in plain JSON in Obsidian's `data.json` for this plugin.
- If you sync via Obsidian Sync, the key is end-to-end encrypted in transit but readable on every synced device.
- Use provider-scoped keys with low rate limits and the cheapest model tier you tolerate.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` / `403` | Wrong key, expired key | Regenerate key, paste again |
| `CORS` error in console | Self-hosted Ollama without `OLLAMA_ORIGINS=*` | Set env var, restart |
| `timeout` | Slow model / network | Increase **Settings → LLM Wiki → Timeouts** value for `query` |
| `No domain configured` | Domain map empty | Create a domain on Desktop first; sync the vault |
| Empty answer | Wiki folder missing or empty | Verify `_Wiki/<domain>` exists in vault |

## Limits

- Context truncated at 80 000 characters of wiki content.
- New domain creation, ingest, lint require Obsidian Desktop.
- Logging (agent.jsonl, dev.jsonl) is disabled on mobile (no fs access).
```

- [ ] **Step 2: Commit**

```bash
git add docs/mobile-cloud-ollama.md
git commit -m "docs: mobile cloud-LLM setup guide (OpenRouter / Ollama / together.ai)"
```

---

## Task 12: Version bump + final build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Read current version**

Run: `node -p "require('./package.json').version"`
Expected: e.g. `0.1.58`.

- [ ] **Step 2: Bump patch**

Increment patch in both files. Example: `0.1.58` → `0.1.59`.

Edit `package.json`:
```json
"version": "0.1.59"
```

Edit `src/manifest.json`:
```json
"version": "0.1.59"
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Build production bundle**

Run: `npm run build`
Expected: `main.js` produced. Verify size:

```bash
ls -lh main.js
```

- [ ] **Step 5: Sanity-check bundle has no node:* require leakage**

Run: `grep -c 'require("node:' main.js || echo 0`
Expected: a small count (only behind dynamic-import wrappers — esbuild keeps them as `require("node:fs")` calls inside async wrappers, that's OK because Obsidian Mobile sandbox skips those branches at runtime via `Platform.isMobile` guards). Document the count for the manual test step.

- [ ] **Step 6: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: 0.1.59 — mobile query support"
```

---

## Task 13: Manual mobile smoke test

**Files:** none — manual verification only.

- [ ] **Step 1: Install on Obsidian Mobile**

Sync the vault (with built `dist/`) to mobile via Obsidian Sync, OR copy `manifest.json` + `main.js` + `styles.css` (if any) to `<vault>/.obsidian/plugins/llm-wiki/` via iCloud / SyncThing / adb push.

- [ ] **Step 2: Enable plugin**

Open Obsidian Mobile → Community plugins → enable "LLM Wiki".

- [ ] **Step 3: Configure cloud provider**

Settings → LLM Wiki → fill `baseUrl`, `apiKey`, `model` per `docs/mobile-cloud-ollama.md`.

- [ ] **Step 4: Run query**

Open command palette → **LLM Wiki: Query** → type question against an existing domain. Expected: streaming answer in side panel.

- [ ] **Step 5: Cancel during streaming**

Start a query, then run **LLM Wiki: Cancel**. Expected: stream stops, no orphan state.

- [ ] **Step 6: Verify desktop-only commands hidden**

Command palette: search for "ingest", "lint", "init". Expected: not found.

- [ ] **Step 7: Verify history persists**

Force-quit Obsidian, reopen. Expected: previous query in history.

- [ ] **Step 8: Document any failures**

If any step fails, file an issue with: device OS, Obsidian version, plugin version, error from Obsidian dev console (`Settings → About → toggle Debugging`).

---

## Self-Review Checklist

- **Spec coverage:** All 8 sections of spec covered — manifest (T1), settings backend force (T3), command gating (T4), dispatch guard (T5), node:fs gating (T6, T7, T8), settings UI (T10), tests (T3, T4, T5, T9), docs (T11). ✅
- **Placeholder scan:** No TBD/TODO/"add error handling"-style placeholders. All code blocks complete. ✅
- **Type consistency:** `requireNativeAgent()` returns boolean (not `Promise<string|null>` like `requireClaudeAgent`); `logEvent` becomes async — call sites updated. `writeDevLog`/`updateDevLogEval` become async — call sites updated. `toVaultPath` becomes async — single call site updated. ✅

---

## Execution

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with two-stage review.
2. **Inline Execution** — execute in this session via `executing-plans` with checkpoints.

Which approach?
