# Security Audit Fixes — Design Spec

**Date:** 2026-05-18  
**Trigger:** Obsidian Community Plugin review bot audit  
**Scope:** Two findings — Shell Execution (Warning) + Vault Enumeration (Recommendation)

---

## Context

The Obsidian plugin review bot flagged:

1. **Warning — Shell Execution:** Plugin uses `child_process.spawn` giving full OS control.
2. **Recommendation — Vault Enumeration:** Plugin calls `vault.getFiles()` giving access to every file path in the vault.

Goal: mitigate both findings to pass community review and reduce actual risk.

---

## Finding 1: Vault Enumeration

### Problem

`view.ts:269` and `view.ts:311` call `this.app.vault.getFiles()` — loads the entire vault file list — then filters by `sourcePaths`. The bot flags this as full vault enumeration.

### Solution: Folder-scoped iteration

Extract a helper that iterates only the user-configured source path folders. Never touches the full vault list.

```ts
// view.ts — module-level helpers
function collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[] {
  const result: TFile[] = [];
  for (const p of sourcePaths) {
    const folder = vault.getFolderByPath(p);
    if (folder) walkFolder(folder, result);
  }
  return result;
}

function walkFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") out.push(child);
    else if (child instanceof TFolder) walkFolder(child, out);
  }
}
```

**Call sites changed:**
- `view.ts:269–272` (`runInit`): `vault.getFiles()` + filter → `collectMdInPaths(this.app.vault, input.sourcePaths)`
- `view.ts:311` (`runReinit`): same replacement with `sourcePaths`

**Imports added to `view.ts`:** `TFile`, `TFolder`, `Vault` from `"obsidian"`.

**Trade-off:** If a source path doesn't exist as a folder yet, `getFolderByPath` returns null — graceful empty result, same behavior as before.

---

## Finding 2: Shell Execution

The plugin fundamentally requires `child_process.spawn` to call the Claude CLI. Cannot be removed. Mitigation: minimize spawn surface, validate paths, obtain explicit user consent.

### 2a. Remove probe-spawn from settings.ts

`settings.ts:checkClaudeAvailability` currently spawns `iclaudePath` with a real LLM prompt to verify availability. Replace with `fs.access(iclaudePath, fs.constants.X_OK)` — checks file exists and is executable, no subprocess.

```ts
import { access, constants } from "node:fs/promises";

async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  await access(iclaudePath, constants.X_OK);
}
```

Remove `import { spawn } from "child_process"` from `settings.ts`.

**Trade-off:** No longer verifies Claude actually responds. Errors surface on first real operation. Acceptable — reduces spawn surface from 2 files to 1.

### 2b. Path validation before spawn

Add `validateIclaudePath(p)` called at the top of `_generate()` in `claude-cli-client.ts` before `spawn()`.

```ts
import { isAbsolute } from "node:path";

function validateIclaudePath(p: string): void {
  if (!p) throw new Error("iclaudePath is empty");
  if (!isAbsolute(p)) throw new Error(`iclaudePath must be absolute: "${p}"`);
  if (p.includes("..")) throw new Error(`iclaudePath contains path traversal: "${p}"`);
}
```

Call: `validateIclaudePath(this.cfg.iclaudePath)` before the `spawn()` line in `_generate()`.

### 2c. Shell consent modal (first-run)

**Settings change** — add to `LlmWikiPluginSettings` and `DEFAULT_SETTINGS`:

```ts
shellConsentGiven: boolean;  // default: false
```

**New modal** — `ShellConsentModal` in `modals.ts`:

```
Title: ⚠ Shell Execution Notice
Body:  This plugin runs an external process:
         [iclaudePath]
       with your operating system user's permissions.
       This is required for AI Wiki to function.
       Review the path above, then confirm to enable.
Buttons: [Cancel]  [I understand, enable]
```

On "enable": sets `plugin.settings.shellConsentGiven = true`, calls `plugin.saveSettings()`, closes modal.  
On "cancel": closes modal, consent remains false.

**Trigger in `main.ts`** — inside `this.app.workspace.onLayoutReady()` callback, after `loadSettings()`:

```ts
this.app.workspace.onLayoutReady(() => {
  if (
    this.settings.backend === "claude-cli" &&
    !this.settings.shellConsentGiven
  ) {
    new ShellConsentModal(this.app, this).open();
  }
});
```

**Guard in `controller.ts`** — at the start of the private `run()` method (all public methods `ingest/query/lint/init/format` funnel through it), before any spawn:

```ts
if (this.plugin.settings.backend === "claude-cli" && !this.plugin.settings.shellConsentGiven) {
  new Notice(i18n().notices.shellConsentRequired);
  return;
}
```

Add `shellConsentRequired` string to i18n.

### 2d. README Security section

Add a `## Security` section to `README.md` covering:
- Why shell execution is required (Claude CLI must be spawned as subprocess)
- What exactly is executed (user-configured absolute path, validated before spawn)
- How to review/change the path (Settings tab)
- That explicit consent is required on first use

---

## Files Changed

| File | Change |
|---|---|
| `src/view.ts` | Replace `vault.getFiles()` calls with `collectMdInPaths` helper |
| `src/settings.ts` | Replace spawn probe with `fs.access`; remove `child_process` import |
| `src/claude-cli-client.ts` | Add `validateIclaudePath()` called before `spawn()` |
| `src/modals.ts` | Add `ShellConsentModal` |
| `src/main.ts` | Add `onLayoutReady` consent check |
| `src/controller.ts` | Add consent guard before operations |
| `src/types.ts` | Add `shellConsentGiven: boolean` to `LlmWikiPluginSettings` |
| `src/i18n.ts` | Add `shellConsentRequired` notice string |
| `README.md` | Add `## Security` section |

---

## Success Criteria

- `vault.getFiles()` / `getMarkdownFiles()` — zero occurrences in `view.ts`
- `child_process` import — only in `claude-cli-client.ts` (not in `settings.ts`)
- Path validation throws on empty / relative / traversal paths
- First run with `backend = "claude-cli"` shows consent modal
- Operations without consent return early with Notice
- README has Security section
