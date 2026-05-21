# Move JSONL Logs to !Wiki/.config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `!Logs/agent.jsonl` → `!Wiki/.config/_agent.jsonl` and `!Logs/dev.jsonl` → `!Wiki/.config/_dev.jsonl`, adding `_` prefix to match `_domain.json` convention.

**Architecture:** Three surgical find-and-replace edits across `controller.ts`, `agent-runner.ts`, and `i18n.ts`. No new files, no migration logic, no refactoring. Old `!Logs` files remain untouched.

**Tech Stack:** TypeScript, Obsidian plugin API (`vault.createFolder`, `adapter.mkdir`)

---

### Task 1: Update `controller.ts` — agent log path

**Files:**
- Modify: `src/controller.ts` (method `logEvent`, lines ~512–515)

- [ ] **Step 1: Open `src/controller.ts` and locate `logEvent()`**

Find this block (around line 511–515):

```ts
const adapter = this.app.vault.adapter;
const dir = "!Logs";
const path = `${dir}/agent.jsonl`;
try {
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
```

- [ ] **Step 2: Replace the dir/path/mkdir block**

Replace those lines with:

```ts
const adapter = this.app.vault.adapter;
const path = "!Wiki/.config/_agent.jsonl";
try {
  if (!(await adapter.exists("!Wiki"))) await this.app.vault.createFolder("!Wiki").catch(() => {});
  if (!(await adapter.exists("!Wiki/.config"))) await this.app.vault.createFolder("!Wiki/.config").catch(() => {});
```

Note: use `vault.createFolder()` (not `adapter.mkdir()`) so Obsidian's internal file model stays in sync. This matches the pattern in `domain-store.ts`.

- [ ] **Step 3: Verify the final method looks correct**

The full `logEvent()` body should now read:

```ts
private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
  if (!this.plugin.settings.agentLogEnabled) return;
  if (ev.kind === "assistant_text") return;
  const adapter = this.app.vault.adapter;
  const path = "!Wiki/.config/_agent.jsonl";
  try {
    if (!(await adapter.exists("!Wiki"))) await this.app.vault.createFolder("!Wiki").catch(() => {});
    if (!(await adapter.exists("!Wiki/.config"))) await this.app.vault.createFolder("!Wiki/.config").catch(() => {});
    const extra = ev.kind === "result" && ev.outputTokens !== undefined && ev.durationMs > 0
      ? { tokPerSec: Math.round(ev.outputTokens / (ev.durationMs / 1000)) }
      : {};
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session: sessionId, op, domainId,
      backend: this._currentLogMeta?.backend,
      model: this._currentLogMeta?.model,
      event: ev,
      ...extra,
    }) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* не блокируем операцию */ }
}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): move agent.jsonl to !Wiki/.config/_agent.jsonl"
```

---

### Task 2: Update `agent-runner.ts` — dev log path (write)

**Files:**
- Modify: `src/agent-runner.ts` (method `writeDevLog`, lines ~55–63)

- [ ] **Step 1: Locate `writeDevLog()` in `src/agent-runner.ts`**

Find this block (around line 55–63):

```ts
const adapter = this.vaultTools.adapter;
const dir = "!Logs";
const path = `${dir}/dev.jsonl`;
try {
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
  if (await adapter.exists(path)) await adapter.append(path, line);
  else await adapter.write(path, line);
} catch { /* не блокируем операцию */ }
```

- [ ] **Step 2: Replace the dir/path/mkdir block**

`agent-runner.ts` only has `this.vaultTools.adapter`, not `vault.createFolder`, so use `adapter.mkdir()` here. In normal usage `.config` already exists after init; this mkdir is just a safety net.

```ts
const adapter = this.vaultTools.adapter;
const path = "!Wiki/.config/_dev.jsonl";
try {
  if (!(await adapter.exists("!Wiki"))) await adapter.mkdir("!Wiki");
  if (!(await adapter.exists("!Wiki/.config"))) await adapter.mkdir("!Wiki/.config");
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
  if (await adapter.exists(path)) await adapter.append(path, line);
  else await adapter.write(path, line);
} catch { /* не блокируем операцию */ }
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): move dev.jsonl write path to !Wiki/.config/_dev.jsonl"
```

---

### Task 3: Update `agent-runner.ts` — dev log path (eval update)

**Files:**
- Modify: `src/agent-runner.ts` (method `updateDevLogEval`, line ~165)

- [ ] **Step 1: Locate `updateDevLogEval()` in `src/agent-runner.ts`**

Find this line (around line 165):

```ts
const path = "!Logs/dev.jsonl";
```

- [ ] **Step 2: Replace the path**

```ts
const path = "!Wiki/.config/_dev.jsonl";
```

The full method should now read:

```ts
private async updateDevLogEval(_vaultRoot: string, score: number, reasoning: string): Promise<void> {
  if (!this.settings.devMode?.enabled) return;
  const adapter = this.vaultTools.adapter;
  const path = "!Wiki/.config/_dev.jsonl";
  try {
    if (!(await adapter.exists(path))) return;
    const content = await adapter.read(path);
    const lines = content.trimEnd().split("\n");
    const lastIdx = lines.length - 1;
    const last: Record<string, unknown> = JSON.parse(lines[lastIdx]) as Record<string, unknown>;
    last["eval"] = { score, reasoning };
    lines[lastIdx] = JSON.stringify(last);
    await adapter.write(path, lines.join("\n") + "\n");
  } catch { /* не блокируем */ }
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): move dev.jsonl eval-update path to !Wiki/.config/_dev.jsonl"
```

---

### Task 4: Update `i18n.ts` — all 3 locales

**Files:**
- Modify: `src/i18n.ts` (lines ~23, ~238, ~451)

- [ ] **Step 1: Update English locale (line ~23)**

Find:
```ts
agentLog_desc: "Log agent events to <vault>/!Logs/agent.jsonl. Folder is created automatically.",
```

Replace with:
```ts
agentLog_desc: "Log agent events to <vault>/!Wiki/.config/_agent.jsonl.",
```

- [ ] **Step 2: Update Russian locale (line ~238)**

Find:
```ts
agentLog_desc: "Записывает события агента в <vault>/!Logs/agent.jsonl. Папка создаётся автоматически.",
```

Replace with:
```ts
agentLog_desc: "Записывает события агента в <vault>/!Wiki/.config/_agent.jsonl.",
```

- [ ] **Step 3: Update Spanish locale (line ~451)**

Find:
```ts
agentLog_desc: "Registra eventos del agente en <vault>/!Logs/agent.jsonl. La carpeta se crea automáticamente.",
```

Replace with:
```ts
agentLog_desc: "Registra eventos del agente en <vault>/!Wiki/.config/_agent.jsonl.",
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): update agentLog_desc path to !Wiki/.config/_agent.jsonl (all locales)"
```
