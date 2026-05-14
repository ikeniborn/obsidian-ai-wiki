---
title: Format timeout UI + appendMissingLines abort fix + fix legacy removal
date: 2026-05-14
status: approved
---

## Problem

Three independent issues, one task:

1. **Format timeout not in settings UI.** `timeouts.format` (600s default) exists in `LlmWikiPluginSettings` and is read by `controller.ts:545` via `timeouts[opKey]`, but `settings.ts` only shows 4 values (`ingest/query/lint/init`). User cannot change format timeout.

2. **appendMissingLines skipped on abort.** In `src/phases/format.ts`, the token-retry block wraps both `parsed2` update AND `appendMissingLines` in a single `if (!signal.aborted)` guard. If the retry call is interrupted (e.g., `NaN` timeout from Bug 1 causing `ClaudeCliClient` to fire `setTimeout(fn, NaN=0)` → immediate SIGTERM → `timedOut=true` → exception not caught as AbortError), `signal.aborted` may be true and the entire block is skipped. The temp file is still written and `format_preview` still emitted (no abort check after the token-retry block), so the user sees the missing-tokens warning without the restored-lines block in the `.formatted.md` file.

3. **`fix` operation is dead code.** `controller.fix()` exists but is never called. No command registered in `main.ts`, no button in `view.ts`. `fixChatEl` in `view.ts` is always `null`. `src/phases/fix.ts` and its imports in `agent-runner.ts` are unreachable from UI.

## Scope

| File | Change |
|---|---|
| `src/settings.ts` | Expand timeout field: 4 → 5 values |
| `src/i18n.ts` | Update `timeouts_desc` in EN/RU/ES locales |
| `src/phases/format.ts` | Move `missing2` check outside `if (!signal.aborted)` |
| `tests/phases/format.test.ts` | Add test: abort during retry still produces restored-block |
| `src/types.ts` | Remove `"fix"` from `WikiOperation`; remove `fix` from `timeouts` type and `DEFAULT_SETTINGS` |
| `src/agent-runner.ts` | Remove `runFix` import and `case "fix":` branch; update `buildOptsFor` |
| `src/controller.ts` | Remove `async fix()` method |
| `src/phases/fix.ts` | Delete file |
| `src/view.ts` | Remove `fixChatEl` field and its two `.remove()` calls |

## Design

### 1. `src/settings.ts` — timeout field

**Current (4 parts, destructive save):**
```typescript
t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}`)
  .onChange(async (v) => {
    const parts = v.split("/").map((x) => Number(x.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n > 0)) {
      s.timeouts = { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3] };
```

**After:** extract parsing into an exported pure function (placed before the settings class), then use it in `onChange`:

```typescript
export function parseTimeoutString(v: string): { ingest: number; query: number; lint: number; init: number; format: number } | null {
  const parts = v.split("/").map((x) => Number(x.trim()));
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3], format: parts[4] };
  }
  return null;
}
```

```typescript
t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}/${s.timeouts.format}`)
  .onChange(async (v) => {
    const parsed = parseTimeoutString(v);
    if (parsed) { s.timeouts = { ...s.timeouts, ...parsed }; await this.plugin.saveSettings(); }
  }),
```

Order: `ingest(300) / query(300) / lint(900) / init(3600) / format(600)` — matches DEFAULT_SETTINGS, skips `fix` since it has no UI entry point.

Backward compatibility: `loadSettings` already does `{ ...DEFAULT_SETTINGS.timeouts, ...savedTimeouts }`, so existing 4-key saved settings get `format` from defaults on next load.

### 2. `src/i18n.ts` — timeouts_desc

Update in all three locales (EN line 19, RU line 216, ES line 411):

```
"ingest / query / lint / init / format"
```

### 3. `src/phases/format.ts` — appendMissingLines robustness

**Current:**
```typescript
const fullText2 = yield* callOnce(restoreParams);
if (!signal.aborted) {
  const parsed2 = extractJsonObject(fullText2);
  if (parsed2) { finalFormatted = parsed2.formatted; finalReport = parsed2.report; }
  const missing2 = missingTokensWithContext(original, finalFormatted);
  if (missing2.length > 0) { finalFormatted = appendMissingLines(finalFormatted, missing2); }
}
```

**After:**
```typescript
const fullText2 = yield* callOnce(restoreParams);
if (!signal.aborted) {
  const parsed2 = extractJsonObject(fullText2);
  if (parsed2) { finalFormatted = parsed2.formatted; finalReport = parsed2.report; }
}
// Append missing lines regardless of abort — vaultTools.write runs after this block
// regardless of abort state, so finalFormatted must be complete.
// Note: if callOnce throws (rather than completing with signal.aborted=true), the
// exception propagates and neither this block nor vaultTools.write is reached — that
// scenario is out of scope for this fix.
const missing2 = missingTokensWithContext(original, finalFormatted);
if (missing2.length > 0) { finalFormatted = appendMissingLines(finalFormatted, missing2); }
```

Invariant: if `vaultTools.write(tempPath, ...)` runs, `finalFormatted` must already have the restored-lines block if tokens are missing. This fix covers only the case where `callOnce` completes normally while `signal.aborted` is true; if `callOnce` throws, neither the write nor the restored-block logic runs, and that is acceptable.

### 4. `tests/phases/format.test.ts` — new test

```typescript
it("token-retry: abort во время retry не ломает restored-block", async () => {
  const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
  const json1 = JSON.stringify({ report: "r", formatted: formatted1 });

  const ctrl = new AbortController();
  let callCount = 0;
  const llm: LlmClient = {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) ctrl.abort(); // abort during retry
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              if (ctrl.signal.aborted) return;
              yield { choices: [{ delta: { content: json1 }, finish_reason: null }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;

  const adapter = mockAdapter({ [FILE]: SAMPLE });
  const vt = new VaultTools(adapter, VAULT);
  await collect(runFormat([FILE], vt, llm, "model", false, [], ctrl.signal));

  const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string | undefined;
  if (written) {
    expect(written).toContain("<!-- restored-lines: token loss after retry -->");
  }
});
```

Note: if abort fires before `vaultTools.write`, write may not be called at all — the `if (written)` guard handles that. The test verifies that IF the file is written, it contains the restored block.

### 5. `src/types.ts` — remove fix

- Remove `| "fix"` from `WikiOperation` union
- Remove `fix: number` from `timeouts` interface
- Remove `fix: 900` from `DEFAULT_SETTINGS.timeouts`

### 6. `src/agent-runner.ts` — remove fix

- Remove `import { runFix } from "./phases/fix"`
- Remove `op === "fix" ||` from `buildOptsFor` key computation
- Remove `case "fix":` block

### 7. `src/controller.ts` — remove fix method

Remove entire `async fix(domainId: string, lintReport: string, instruction: string): Promise<void>` method.

### 8. `src/phases/fix.ts` — delete

File deleted entirely.

### 9. `src/view.ts` — remove fixChatEl

Remove:
- `private fixChatEl: HTMLElement | null = null;` field
- Two `this.fixChatEl?.remove(); this.fixChatEl = null;` call pairs

## Testing

### Automated

1. `tests/settings.test.ts` — add unit test for 5-part timeout string parsing:
   - Valid `"300/300/900/3600/600"` → all five values parsed correctly
   - 4-part string → rejected (no mutation)
   - Non-numeric part → rejected
2. `tests/phases/format.test.ts` — new test (§Design §4): abort during retry still produces restored-block if write runs.
3. Run full test suite → all pass.

### Manual

4. Open Settings → timeout field shows `300/300/900/3600/600`
5. Change format value → save → reopen → verify persisted.
6. Run format on a file that triggers token-retry (dev log shows `token loss after first pass`; force it by using a file whose formatted output is significantly shorter than the original) → verify `.formatted.md` contains `<!-- restored-lines: token loss after retry -->`.
