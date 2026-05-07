# Fixed Log Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-form log path fields with toggles; fix log paths to `<vault>/!Logs/agent.jsonl` and `<vault>/!Logs/dev.jsonl`; hide dev sub-settings when dev mode is off.

**Architecture:** Remove `agentLogPath` and `devMode.logDir` from settings type and UI. Paths computed at runtime from vault root. Folder `!Logs` created automatically via `mkdirSync(..., { recursive: true })` on first write. Dev mode toggle triggers `display()` re-render to show/hide sub-settings.

**Tech Stack:** TypeScript, Obsidian Plugin API, Node.js `fs` / `path`

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | `agentLogPath→agentLogEnabled`; remove `devMode.logDir`; update `DEFAULT_SETTINGS` |
| `src/main.ts` | Migration: `agentLogPath→agentLogEnabled`, clean `devMode.logDir` |
| `src/i18n.ts` | Update `agentLog_desc` (3 locales); remove `devMode_logDir_*` keys |
| `src/settings.ts` | `agentLog`: text→toggle; dev mode: add `display()`, hide `evaluatorModel` when off, remove `logDir` |
| `src/controller.ts` | `logEvent()`: add `vaultRoot` param, new path logic, remove `statSync` import |
| `src/agent-runner.ts` | `writeDevLog(vaultRoot)` / `updateDevLogEval(vaultRoot)`: add param, new path logic, add `mkdirSync` import |

---

### Task 1: Update types and defaults

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `LlmWikiPluginSettings` interface**

Replace in `src/types.ts` lines 107–143:

```ts
export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  domains: DomainEntry[];
  maxTokens: number;
  agentLogEnabled: boolean;
  historyLimit: number;
  timeouts: {
    ingest: number;
    query: number;
    lint: number;
    fix: number;
    init: number;
  };
  history: RunHistoryEntry[];
  claudeAgent: {
    iclaudePath: string;
    model: string;
    allowedTools: string;
    perOperation: boolean;
    operations: OpMap<ClaudeOperationConfig>;
  };
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
  };
  devMode: {
    enabled: boolean;
    evaluatorModel: string;
  };
}
```

- [ ] **Step 2: Update `DEFAULT_SETTINGS`**

Replace `agentLogPath: "",` with `agentLogEnabled: false,` and update `devMode`:

```ts
export const DEFAULT_SETTINGS: LlmWikiPluginSettings = {
  backend: "claude-agent",
  systemPrompt: "",
  domains: [],
  maxTokens: 4096,
  agentLogEnabled: false,
  historyLimit: 20,
  timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600 },
  history: [],
  claudeAgent: {
    iclaudePath: "",
    model: "sonnet",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku",  maxTokens: 4096 },
      query:  { model: "sonnet", maxTokens: 4096 },
      lint:   { model: "sonnet", maxTokens: 8192 },
      init:   { model: "sonnet", maxTokens: 8192 },
    },
  },
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    temperature: 0.2,
    topP: null,
    numCtx: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      query:  { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      lint:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      init:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
    },
  },
  devMode: {
    enabled: false,
    evaluatorModel: "sonnet",
  },
};
```

- [ ] **Step 3: Build to verify no type errors**

```bash
npm run build 2>&1 | head -40
```

Expected: build proceeds (TypeScript errors will show — that's OK at this stage; they tell us what to fix next).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "refactor(types): agentLogPath→agentLogEnabled, remove devMode.logDir"
```

---

### Task 2: Add migration in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add migration block after existing devMode.logPath migration (line ~153)**

After the block `// Миграция: devMode.logPath → devMode.logDir`, add:

```ts
    // Миграция: agentLogPath → agentLogEnabled
    if (typeof (data as Record<string, unknown> | null)?.agentLogPath === "string") {
      this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
    }

    // Миграция: devMode.logDir → удалён (путь фиксирован в коде)
    this.settings.devMode = {
      enabled: this.settings.devMode.enabled,
      evaluatorModel: this.settings.devMode.evaluatorModel,
    };
```

The devMode reconstruction drops any stale `logDir` key that came in via object spread.

- [ ] **Step 2: Remove stale devMode.logPath migration (now superseded)**

The old block (lines ~153–159) migrated `logPath→logDir`. That field (`logDir`) is now also gone, so the old block writes to a field that no longer exists. Remove it:

```ts
    // DELETE these lines:
    // Миграция: devMode.logPath → devMode.logDir
    // const devData = data?.devMode as Record<string, unknown> | undefined;
    // if (devData?.logPath !== undefined && devData?.logDir === undefined) {
    //   this.settings.devMode.logDir = devData.logPath
    //     ? dirname(devData.logPath as string)
    //     : "";
    // }
```

Also remove the `dirname` import if it becomes unused. Check:

```bash
grep -n "dirname" src/main.ts
```

If only used in that migration block, remove `dirname` from the import on line 1.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): migrate agentLogPath→agentLogEnabled, drop devMode.logDir"
```

---

### Task 3: Update i18n strings

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Update `agentLog_desc` and remove `devMode_logDir_*` in `en` (lines ~22–23, 60–61)**

```ts
    agentLog_name: "Agent log (JSONL)",
    agentLog_desc: "Log agent events to <vault>/!Logs/agent.jsonl. Folder is created automatically.",
    // ...
    // DELETE these two lines:
    // devMode_logDir_name: "Dev log directory",
    // devMode_logDir_desc: "Directory for dev logs. File name: dev.jsonl",
```

- [ ] **Step 2: Update `ru` locale (lines ~184–185, 222–223)**

```ts
    agentLog_name: "Лог агента (JSONL)",
    agentLog_desc: "Записывает события агента в <vault>/!Logs/agent.jsonl. Папка создаётся автоматически.",
    // ...
    // DELETE these two lines:
    // devMode_logDir_name: "Директория dev-логов",
    // devMode_logDir_desc: "Директория для dev-логов. Имя файла: dev.jsonl",
```

- [ ] **Step 3: Update `es` locale (lines ~344–345, 382–383)**

```ts
    agentLog_name: "Log del agente (JSONL)",
    agentLog_desc: "Registra eventos del agente en <vault>/!Logs/agent.jsonl. La carpeta se crea automáticamente.",
    // ...
    // DELETE these two lines:
    // devMode_logDir_name: "Directorio de log dev",
    // devMode_logDir_desc: "Directorio para logs dev. Nombre del archivo: dev.jsonl",
```

- [ ] **Step 4: Build to confirm TypeScript happy**

```bash
npm run build 2>&1 | grep -E "error TS|i18n"
```

Expected: no errors about i18n.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "refactor(i18n): update agentLog_desc, remove devMode_logDir keys (3 locales)"
```

---

### Task 4: Update settings UI

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Replace agent log text field with toggle (lines ~79–86)**

Replace:

```ts
    new Setting(containerEl)
      .setName(T.settings.agentLog_name)
      .setDesc(T.settings.agentLog_desc)
      .addText((t) =>
        t.setPlaceholder("/tmp/llm-wiki-agent.jsonl")
          .setValue(s.agentLogPath)
          .onChange(async (v) => { s.agentLogPath = v.trim(); await this.plugin.saveSettings(); }),
      );
```

With:

```ts
    new Setting(containerEl)
      .setName(T.settings.agentLog_name)
      .setDesc(T.settings.agentLog_desc)
      .addToggle((t) =>
        t.setValue(s.agentLogEnabled)
          .onChange(async (v) => { s.agentLogEnabled = v; await this.plugin.saveSettings(); }),
      );
```

- [ ] **Step 2: Add `this.display()` to dev mode toggle onChange (lines ~310–316)**

Replace:

```ts
    new Setting(containerEl)
      .setName(T.settings.devMode_enabled_name)
      .setDesc(T.settings.devMode_enabled_desc)
      .addToggle((t) =>
        t.setValue(s.devMode.enabled)
          .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); }),
      );
```

With:

```ts
    new Setting(containerEl)
      .setName(T.settings.devMode_enabled_name)
      .setDesc(T.settings.devMode_enabled_desc)
      .addToggle((t) =>
        t.setValue(s.devMode.enabled)
          .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); this.display(); }),
      );
```

- [ ] **Step 3: Remove logDir setting and guard evaluatorModel behind `s.devMode.enabled` (lines ~318–334)**

Replace:

```ts
    new Setting(containerEl)
      .setName(T.settings.devMode_logDir_name)
      .setDesc(T.settings.devMode_logDir_desc)
      .addText((t) =>
        t.setPlaceholder("/tmp")
          .setValue(s.devMode.logDir)
          .onChange(async (v) => { s.devMode.logDir = v.trim(); await this.plugin.saveSettings(); }),
      );

    new Setting(containerEl)
      .setName(T.settings.devMode_evaluatorModel_name)
      .setDesc(T.settings.devMode_evaluatorModel_desc)
      .addText((t) =>
        t.setPlaceholder("")
          .setValue(s.devMode.evaluatorModel)
          .onChange(async (v) => { s.devMode.evaluatorModel = v.trim(); await this.plugin.saveSettings(); }),
      );
```

With:

```ts
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
```

- [ ] **Step 4: Build and verify**

```bash
npm run build 2>&1 | head -30
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): agentLog toggle, dev mode hides sub-items when disabled"
```

---

### Task 5: Update controller.ts logEvent()

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Remove `statSync` from imports (line 2)**

Change:

```ts
import { existsSync, appendFileSync, statSync, mkdirSync } from "node:fs";
```

To:

```ts
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
```

- [ ] **Step 2: Rewrite `logEvent` method (lines ~236–247)**

Replace:

```ts
  private logEvent(sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): void {
    let logPath = this.plugin.settings.agentLogPath;
    if (!logPath) return;
    try {
      const stat = existsSync(logPath) ? statSync(logPath) : null;
      if (stat?.isDirectory() || (!logPath.includes(".") && !logPath.endsWith("/"))) {
        logPath = join(logPath, "agent.jsonl");
      }
      const line = JSON.stringify({ ts: new Date().toISOString(), session: sessionId, op, domainId, event: ev }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

With:

```ts
  private logEvent(vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): void {
    if (!this.plugin.settings.agentLogEnabled) return;
    try {
      const logDir = join(vaultRoot, "!Logs");
      mkdirSync(logDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), session: sessionId, op, domainId, event: ev }) + "\n";
      appendFileSync(join(logDir, "agent.jsonl"), line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

- [ ] **Step 3: Update ALL 8 call sites of `logEvent()` to pass `vaultRoot` as first argument**

`logEvent()` is called in two methods. Both have `vaultRoot` computed at the top of the method.

**In `dispatchChat()` — `vaultRoot` is at line 72: `const vaultRoot = (...).getBasePath?.() ?? ""`**

Line 85:
```ts
    this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
    });
```

Line 108:
```ts
        this.logEvent(vaultRoot, sessionId, "chat", domainId, ev);
```

Line 123:
```ts
      this.logEvent(vaultRoot, sessionId, "chat", domainId, { kind: "error", message: finalText });
```

Line 139:
```ts
    this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });
```

**In `dispatch()` — `vaultRoot` is at line 264: `const vaultRoot = (...).getBasePath?.() ?? ""`**

Line 279:
```ts
    this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
```

Line 288 (inside `for await` loop):
```ts
        this.logEvent(vaultRoot, sessionId, op, domainId, ev);
```

Line 323 (catch block):
```ts
      this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
```

Line 329 (after finally):
```ts
    this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `finish status=${status} durationMs=${Date.now() - startedAt}` });
```

- [ ] **Step 4: Build and verify**

```bash
npm run build 2>&1 | head -30
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): logEvent uses fixed !Logs/agent.jsonl path"
```

---

### Task 6: Update agent-runner.ts dev log

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add `mkdirSync` to imports (line 1)**

Change:

```ts
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
```

To:

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
```

- [ ] **Step 2: Rewrite `writeDevLog` to accept `vaultRoot` and use fixed path (lines ~39–53)**

Replace:

```ts
  private writeDevLog(entry: {
    operation: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    result: string;
    durationMs: number;
  }): void {
    const logDir = this.settings.devMode?.logDir;
    if (!logDir) return;
    const logPath = join(logDir, "dev.jsonl");
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(logPath, line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

With:

```ts
  private writeDevLog(vaultRoot: string, entry: {
    operation: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    result: string;
    durationMs: number;
  }): void {
    if (!this.settings.devMode?.enabled) return;
    try {
      const logDir = join(vaultRoot, "!Logs");
      mkdirSync(logDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
      appendFileSync(join(logDir, "dev.jsonl"), line, "utf-8");
    } catch { /* не блокируем операцию */ }
  }
```

- [ ] **Step 3: Rewrite `updateDevLogEval` to accept `vaultRoot` (lines ~142–155)**

Replace:

```ts
  private updateDevLogEval(score: number, reasoning: string): void {
    const logDir = this.settings.devMode?.logDir;
    if (!logDir) return;
    const logPath = join(logDir, "dev.jsonl");
    try {
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

With:

```ts
  private updateDevLogEval(vaultRoot: string, score: number, reasoning: string): void {
    if (!this.settings.devMode?.enabled) return;
    try {
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

- [ ] **Step 4: Update call sites in `run()` to pass `vaultRoot` (lines ~119–138)**

The `run()` method has `const vaultRoot = req.cwd ?? "";` on line 106. Update calls:

```ts
      this.writeDevLog(vaultRoot, {
        operation: req.operation,
        model,
        systemPrompt: opts.systemPrompt ?? "",
        userMessage: taskInput,
        result: finalResultText,
        durationMs: Date.now() - startMs,
      });
```

And the eval callback:

```ts
          if (ev.kind === "eval_result") {
            this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
          }
```

- [ ] **Step 5: Build — expect clean**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Run tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all pass (agent-runner tests use mock, no I/O).

- [ ] **Step 7: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): dev log uses fixed !Logs/dev.jsonl path"
```

---

### Task 7: Final build and version bump

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 1: Bump patch version**

Read current version from `package.json`, increment patch. E.g. if `0.1.54` → set `0.1.55` in both `package.json` and `src/manifest.json`.

- [ ] **Step 2: Build production**

```bash
npm run build 2>&1
```

Expected: clean, produces `main.js`.

- [ ] **Step 3: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore(release): bump version to 0.1.55"
```
