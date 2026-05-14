# Generation Speed Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show LLM generation speed (tok/s) in the sidebar progress header and result section header after each operation completes.

**Architecture:** Extract `output_tokens` from the `result` stream-json event, propagate it through `RunEvent`, store computed `tok/s` in `LlmWikiView`, and display it in two DOM locations after `finish()`. Also enrich `controller.ts` log lines with `backend`, `model`, and `tokPerSec`.

**Tech Stack:** TypeScript, Obsidian ItemView DOM API, vitest

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `outputTokens?: number` to `result` variant of `RunEvent` |
| `src/stream.ts` | Extract `usage.output_tokens` in `mapResult()` |
| `src/view.ts` | New fields `lastTokPerSec`, `resultSpeedEl`; update `onOpen()`, `appendEvent()`, `finish()`, `setRunning()` |
| `src/controller.ts` | Add `_currentLogMeta` field; extend `dispatch()` settings block; update `logEvent()`; reset in `finally` |
| `tests/stream.test.ts` | Two new test cases for `outputTokens` |
| `tests/fixtures/stream-ingest.jsonl` | Add `usage` to final result line |

---

### Task 1: Add `outputTokens` to `RunEvent` type

**Files:**
- Modify: `src/types.ts:45`

- [ ] **Step 1: Edit `types.ts`**

Change line 45 from:
```ts
| { kind: "result"; durationMs: number; usdCost?: number; text: string }
```
to:
```ts
| { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | head -20`
Expected: no errors about `outputTokens`

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add outputTokens to RunEvent result variant"
```

---

### Task 2: Extract `outputTokens` in `stream.ts`

**Files:**
- Modify: `src/stream.ts:85-98` (`mapResult` function)

- [ ] **Step 1: Write failing test**

In `tests/stream.test.ts`, add two tests after the existing `"handles error result subtype"` test:

```ts
it("parses outputTokens from result event with usage", () => {
  const line = JSON.stringify({
    type: "result",
    subtype: "success",
    duration_ms: 42000,
    is_error: false,
    result: "done",
    total_cost_usd: 0.012,
    usage: { output_tokens: 580 },
  });
  const ev = parseStreamLine(line);
  expect(ev?.kind).toBe("result");
  expect((ev as Extract<RunEvent, { kind: "result" }>).outputTokens).toBe(580);
});

it("leaves outputTokens undefined when usage absent", () => {
  const line = JSON.stringify({
    type: "result",
    subtype: "success",
    duration_ms: 42000,
    is_error: false,
    result: "done",
    total_cost_usd: 0.012,
  });
  const ev = parseStreamLine(line);
  expect(ev?.kind).toBe("result");
  expect((ev as Extract<RunEvent, { kind: "result" }>).outputTokens).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stream.test.ts 2>&1 | tail -20`
Expected: 2 failures about `outputTokens`

- [ ] **Step 3: Replace the entire `mapResult()` function in `src/stream.ts`**

Find function `mapResult` starting at line 85 and replace the whole function (lines 85–98) with:
```ts
function mapResult(obj: Record<string, unknown>): RunEvent {
  if (obj.is_error || obj.subtype === "error") {
    const errMsg = typeof obj.result === "string" ? obj.result
      : typeof obj.error === "string" ? obj.error
      : "claude error";
    return { kind: "error", message: errMsg };
  }
  const usage = isRecord(obj.usage) ? obj.usage : null;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  return {
    kind: "result",
    durationMs: Number(obj.duration_ms ?? 0),
    usdCost: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
    text: typeof obj.result === "string" ? obj.result : "",
    outputTokens,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stream.test.ts 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stream.ts tests/stream.test.ts
git commit -m "feat(stream): extract outputTokens from usage in mapResult"
```

---

### Task 3: Update stream fixture to include `usage`

**Files:**
- Modify: `tests/fixtures/stream-ingest.jsonl` (last line)

- [ ] **Step 1: Update fixture last line**

Replace the last line of `tests/fixtures/stream-ingest.jsonl`:

Old:
```
{"type":"result","subtype":"success","duration_ms":42000,"is_error":false,"result":"Создано 1 страница, обновлено 0","total_cost_usd":0.012}
```

New:
```
{"type":"result","subtype":"success","duration_ms":42000,"is_error":false,"result":"Создано 1 страница, обновлено 0","total_cost_usd":0.012,"usage":{"output_tokens":580}}
```

- [ ] **Step 2: Update the existing fixture-based test in `tests/stream.test.ts`**

The test `"maps full ingest fixture in order"` checks `result.outputTokens` — add assertion after the existing result checks:

```ts
expect(result.outputTokens).toBe(580);
```

Full updated assertion block (within the existing test):
```ts
const result = events[5] as Extract<RunEvent, { kind: "result" }>;
expect(result.text).toBe("Создано 1 страница, обновлено 0");
expect(result.durationMs).toBe(42000);
expect(result.usdCost).toBe(0.012);
expect(result.outputTokens).toBe(580);
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/stream.test.ts 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/stream-ingest.jsonl tests/stream.test.ts
git commit -m "test(fixtures): add usage.output_tokens to stream-ingest fixture"
```

---

### Task 4: Add tok/s display to `view.ts`

**Files:**
- Modify: `src/view.ts`

This task has four sub-changes: (a) new fields, (b) `onOpen()`, (c) `appendEvent()`, (d) `setRunning()` + `finish()`.

- [ ] **Step 1: Add two new private fields**

After the existing field `private startTs = 0;` (line 65 area), add:

```ts
private lastTokPerSec: number | undefined;
private resultSpeedEl: HTMLElement | null = null;
```

- [ ] **Step 2: Create `resultSpeedEl` span in `onOpen()`**

In `onOpen()`, find line 174: `resultH4.appendText(` ${T.view.result}`)`. Add the following line **immediately after** it (do not replace the existing line):

```ts
this.resultSpeedEl = resultH4.createSpan({ cls: "muted ai-wiki-result-speed" });
```

- [ ] **Step 3: Calculate `lastTokPerSec` in `appendEvent()` for `result` events**

In `appendEvent()`, find the `ev.kind === "result"` branch (around line 425):

```ts
} else if (ev.kind === "result") {
  // финальный result рендерим в finish(), здесь — отметка
  this.assistantBlock = null;
```

Extend it to store tok/s:

```ts
} else if (ev.kind === "result") {
  this.assistantBlock = null;
  if (ev.outputTokens !== undefined && ev.durationMs > 0) {
    this.lastTokPerSec = Math.round(ev.outputTokens / (ev.durationMs / 1000));
  }
```

- [ ] **Step 4: Reset in `setRunning()`**

In `setRunning()`, after `this.reasoningBuffer = "";` (around line 295), add:

```ts
this.lastTokPerSec = undefined;
this.resultSpeedEl?.setText("");
```

- [ ] **Step 5: Display tok/s in `finish()`**

In `finish()`, find the existing `this.updateMetrics();` call (line 514). Add the following lines **immediately after** it (do not replace the existing line):

```ts
if (this.lastTokPerSec !== undefined) {
  const dur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
  this.progressCount.setText(
    i18n().view.stepsCount(this.stepCount, dur) + ` · ${this.lastTokPerSec} tok/s`
  );
}
this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
```

- [ ] **Step 6: Build**

Run: `npm run build 2>&1 | head -20`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): display tok/s in progress header and result header"
```

---

### Task 5: Enrich log lines in `controller.ts`

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Add `_currentLogMeta` field**

After the existing `private _pendingFormat` field (line 51), add:

```ts
private _currentLogMeta: { backend: string; model: string } | null = null;
```

- [ ] **Step 2: Compute and store `_currentLogMeta` in `dispatch()`**

In `dispatch()`, find the settings validation block (lines 504–509):

```ts
{
  const local = await this.localConfigStore.load();
  const eff = resolveEffective(this.plugin.settings, local);
  if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
  if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
}
```

Replace with:

```ts
{
  const local = await this.localConfigStore.load();
  const eff = resolveEffective(this.plugin.settings, local);
  if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
  if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
  const opKey = (op === "query-save" ? "query" : op) as import("./types").OpKey;
  this._currentLogMeta = {
    backend: eff.backend,
    model: eff.backend === "claude-agent"
      ? (eff.claudeAgent.perOperation ? eff.claudeAgent.operations[opKey].model : eff.claudeAgent.model)
      : (eff.nativeAgent.perOperation ? eff.nativeAgent.operations[opKey].model : eff.nativeAgent.model),
  };
}
```

- [ ] **Step 3: Reset `_currentLogMeta` in `finally` of `dispatch()`**

In the `finally {}` block of `dispatch()` (around line 581), add:

```ts
finally {
  this.current = null;
  this.onBusyChange?.();
  this.currentOp = null;
  this._currentLogMeta = null;
}
```

- [ ] **Step 4: Update `logEvent()` to include backend, model, tokPerSec**

Replace the body of `logEvent()` (lines 475–489):

```ts
private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
  if (!this.plugin.settings.agentLogEnabled) return;
  const adapter = this.app.vault.adapter;
  const dir = "!Logs";
  const path = `${dir}/agent.jsonl`;
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
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

- [ ] **Step 5: Build**

Run: `npm run build 2>&1 | head -20`
Expected: no errors

- [ ] **Step 6: Run all tests**

Run: `npm test 2>&1 | tail -30`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): add backend/model/tokPerSec to agent log lines"
```

---

### Task 6: Final build and version bump

**Files:**
- Modify: `package.json`, `src/manifest.json`, build output

- [ ] **Step 1: Read current version**

Run: `node -e "const p=require('./package.json'); console.log(p.version)"`

- [ ] **Step 2: Bump patch version in `package.json` and `src/manifest.json`**

Increment `X.Y.Z` → `X.Y.(Z+1)` in both files.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds, `main.js` updated

- [ ] **Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump version for generation speed feature"
```
