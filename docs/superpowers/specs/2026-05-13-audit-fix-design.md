# Audit Fix Design — Obsidian Community Plugin Submission

**Date:** 2026-05-13  
**Goal:** Fix all errors and actionable warnings from the Obsidian plugin audit to unblock Community Plugins submission.

---

## 1. Manifest — minAppVersion

**Files:** `manifest.json`, `src/manifest.json`

Change `minAppVersion` from `"1.0.0"` to `"1.7.2"`.

This resolves three API errors in one change:
- `Workspace.revealLeaf` (requires 1.7.2)
- `Vault.getAllFolders` (requires 1.6.6)
- `ButtonComponent.setDisabled` (requires 1.2.3)

`isDesktopOnly` stays `false` — mobile is supported via native backend (query-only). Desktop uses `spawn` for `claude-agent` backend.

---

## 2. ESLint sentence-case

**Files:** `src/main.ts:30-31`, `src/view.ts:85`

Change display string `"AI Wiki"` → `"AIWiki"` in two places:
- Ribbon icon label (`main.ts:31`)
- `getDisplayText()` return value (`view.ts:85`)

Remove both `// eslint-disable-next-line obsidianmd/ui/sentence-case` comments.

Manifest `name` field is not touched — it is outside the lint rule's scope.

---

## 3. Window API replacements

**Files:** `src/claude-cli-client.ts`, `src/modals.ts`

Required for popout window compatibility.

| Location | Change |
|---|---|
| `claude-cli-client.ts:135` | `setTimeout(` → `window.setTimeout(` |
| `claude-cli-client.ts:140` | `setTimeout(` → `window.setTimeout(` |
| `claude-cli-client.ts:143` | `setTimeout(` → `window.setTimeout(` |
| `claude-cli-client.ts:210` | `clearTimeout(` → `window.clearTimeout(` |
| `claude-cli-client.ts:215` | `setTimeout(` → `window.setTimeout(` |
| `modals.ts:71` | `setTimeout(` → `window.setTimeout(` |
| `modals.ts:138` | `document.body` → `activeDocument.body` |

Add `activeDocument` to the `obsidian` import in `modals.ts`.

---

## 4. TypeScript `any` fixes

### 4a. JSON.parse → unknown

Pattern: `const x = JSON.parse(...)` → `const x: unknown = JSON.parse(...)`, then narrow explicitly.

**`src/phases/evaluator.ts` (parseEvalResponse):**
```ts
const parsed: unknown = JSON.parse(match[0]);
if (
  typeof parsed !== "object" || parsed === null ||
  typeof (parsed as Record<string, unknown>).score !== "number" ||
  typeof (parsed as Record<string, unknown>).reasoning !== "string"
) return null;
const p = parsed as { score: number; reasoning: string };
return { score: Math.min(10, Math.max(0, p.score)), reasoning: p.reasoning };
```

**`src/agent-runner.ts` (~line 160):**
```ts
const last: Record<string, unknown> = JSON.parse(lines[lastIdx]) as Record<string, unknown>;
last["eval"] = { score, reasoning };
```

**`src/phases/ingest.ts` (parseJsonPages):**
```ts
const arr: unknown = JSON.parse(match[0]);
if (!Array.isArray(arr)) return [];
return (arr as unknown[]).filter(
  (x): x is { path: string; content: string } => ...
);
```

**`src/modals.ts:414` and `src/modals.ts:504`:**
```ts
const parsed: unknown = JSON.parse(this.entityTypesVal.trim() || "[]");
// existing Array.isArray + .every guards unchanged
entityTypes = parsed as EntityType[];
```

### 4b. Array.isArray narrows to `any[]`

**`src/stream.ts` (~line 78):**

After `Array.isArray(content)` check, add cast:
```ts
const block = (content as unknown[])[0];
```

### 4c. Vault adapter internals (controller.ts)

Replace `this.app.vault.adapter as any` with typed interface:
```ts
interface InternalAdapter {
  getFullPath(p: string): string;
  remove(p: string): Promise<void>;
}
const fullAdapter = this.app.vault.adapter as unknown as InternalAdapter;
```

### 4d. Template literal type (llm-utils.ts:39, 55)

`existing` is already string via ternary — add explicit annotation:
```ts
const existing: string = typeof updated[firstSystem].content === "string"
  ? updated[firstSystem].content as string
  : "";
```

### 4e. Regex capture key (template.ts:2)

```ts
(_, key: string) => vars[key] ?? `{{${key}}}`
```

---

## 5. setInterval + network (no fix)

Both `setInterval` calls in `view.ts` are pure UI timers (metrics update, chat elapsed timer). Network calls are in `ClaudeCliClient`, architecturally separate. Static analysis false positive — no action required.

---

## 6. node:child_process (no fix)

Import is used only in the `claude-agent` desktop backend path. With `isDesktopOnly: false` (hybrid plugin), this warning is a false positive for the mobile path. Obsidian reviewers will see the conditional usage. No action required.

---

## 7. GitHub artifact attestation (out of scope)

CI/CD topic, separate from code audit. Not addressed in this task.

---

## Summary

| Section | Files changed | Errors closed | Warnings closed |
|---|---|---|---|
| minAppVersion | manifest.json ×2 | 3 | 0 |
| sentence-case | main.ts, view.ts | 1 | 0 |
| window APIs | claude-cli-client.ts, modals.ts | 0 | 6 |
| TypeScript any | evaluator.ts, agent-runner.ts, ingest.ts, stream.ts, controller.ts, llm-utils.ts, template.ts, modals.ts | 0 | ~14 |
| **Total** | **12 files** | **4** | **~20** |
