# Design: ObsidianReviewBot Required Fixes (v2)

**Date:** 2026-05-12  
**PR:** https://github.com/obsidianmd/obsidian-releases/pull/12351  
**Goal:** Fix all Required items from the 2026-05-12 ObsidianReviewBot scan (against HEAD `31e3e9d`).

---

## Context

Previous spec (`2026-05-12-obsidian-review-bot-fixes-design.md`) proposed dropping the `node:` prefix from imports. That was wrong — the bot bans **both** `"node:fs"` and `"fs"`, `"node:path"` and `"path"`. Eight `fix(lint):` commits were applied but violations persisted because the root strategy was incorrect.

Latest scan returned 3 Required violation groups across the current HEAD.

---

## Section 1: `path` → `path-browserify`

**Rule violated:** `Do not import Node.js builtin module "path"` (and `"node:path"`)

**Strategy:** Install `path-browserify` (pure JS, no Node.js runtime needed). Bot no longer sees a Node.js builtin import. esbuild bundles it — safe on all platforms including mobile.

### Changes

```bash
npm install path-browserify
npm install --save-dev @types/path-browserify
```

**`esbuild.config.mjs`:** Remove `"node:path"` from `external` array (no longer needed).

**6 source files** — change `import { ... } from "path"` → `import { ... } from "path-browserify"`:

| File | Imported symbols |
|---|---|
| `src/claude-cli-client.ts` | `join` |
| `src/phases/fix.ts` | `join` |
| `src/phases/ingest.ts` | `isAbsolute, join, relative, dirname` |
| `src/phases/lint.ts` | `join` |
| `src/source-paths.ts` | `isAbsolute, join` |

**`src/controller.ts`:** Remove two `require("path")` lazy-load calls; replace with static import from `"path-browserify"` at top of file.

- `toVaultPath` (line ~26): `const { relative, isAbsolute, join } = require("path") as ...` → use statically imported symbols
- `buildAgentRunner` (line ~388): `const { join } = require("path") as ...` → use statically imported `join`

**Side effect:** `this: void` violations at `controller.ts:L26` and `L388` disappear — they were caused by destructuring from `require()`.

---

## Section 2: `fs` → vault adapter API

**Rule violated:** `Do not import Node.js builtin module "fs"` (and `"node:fs"`)

Three usage sites; each has a distinct replacement.

### 2a. `controller.ts` — `existsSync(iclaudePath)` in `requireClaudeAgent`

`iclaudePath` is an absolute filesystem path (e.g. `/usr/local/bin/iclaude.sh`). `vault.adapter.exists()` takes vault-relative paths — wrong tool here.

**Fix:** Remove the pre-flight check entirely. If the path is wrong, `spawn()` fails with ENOENT; the error flows through the existing stderr handler and surfaces to the user as a Notice. `requireClaudeAgent` stays synchronous.

### 2b. `controller.ts` — `mkdirSync(tmpDir, { recursive: true })` in `buildAgentRunner`

`tmpDir` is `join(pluginDir, "tmp")` where `pluginDir` is the absolute path of the plugin directory. `manifestDir` (`this.plugin.manifest.dir`) is already vault-relative.

**Fix:**
```typescript
const relTmpDir = normalizePath(join(manifestDir, "tmp"));
await this.app.vault.adapter.mkdir(relTmpDir);
const tmpDir = (this.app.vault.adapter as { getFullPath(p: string): string })
  .getFullPath(relTmpDir);
```

Remove `require("fs")` for `mkdirSync`. Also remove `"node:fs"` from esbuild external (no longer needed).

### 2c. `claude-cli-client.ts` — `writeFileSync` / `unlinkSync`

Temp files are written to `tmpDir` and passed as `--system-prompt-file` / `--append-system-prompt-file` CLI args (absolute paths required). `vault.adapter.write()` uses vault-relative paths.

**Fix:** Add two callbacks to `ClaudeCliConfig`:

```typescript
export interface ClaudeCliConfig {
  // ... existing fields ...
  tmpWrite: (absPath: string, content: string) => Promise<void>;
  tmpRemove: (absPath: string) => void;
}
```

`ClaudeCliClient` calls these instead of `writeFileSync`/`unlinkSync`. Remove `import { writeFileSync, unlinkSync } from "fs"`.

**Controller** provides the implementations using vault adapter:

```typescript
const relOf = (absPath: string) =>
  normalizePath(pathBrowserify.relative(vaultRoot, absPath));

tmpWrite: async (absPath, content) => {
  await this.app.vault.adapter.write(relOf(absPath), content);
},
tmpRemove: (absPath) => {
  void this.app.vault.adapter.remove(relOf(absPath));
},
```

`vaultRoot` = `(this.app.vault.adapter as { getFullPath(p: string): string }).getFullPath("")`

---

## Section 3: `node:child_process` → `/skip`

No Obsidian API equivalent for process spawning. Post on PR #12351:

> `/skip node:child_process — plugin spawns a desktop CLI binary (Claude Code). All spawn calls are guarded by !Platform.isMobile checks; mobile users receive a Notice instead.`

---

## Section 4: Sentence case

**Rule violated:** `Use sentence case for UI text`

| File | Location | Current text | Fix |
|---|---|---|---|
| `src/main.ts:30` | ribbon tooltip | `"LLM Wiki"` | `/skip` — plugin name (proper noun) |
| `src/view.ts:85` | `getDisplayText()` | `"LLM Wiki"` | `/skip` — plugin name |
| `src/view.ts:97` | h3 heading | `"LLM wiki"` | Verify after rescan; may already pass |
| `src/settings.ts:202` | description | `"... only. Setup guide: "` | `"Setup"` → `"setup"` |
| `src/settings.ts:~294` | unknown (scan truncated) | unknown | Identify after `/skip` re-triggers scan |

**`/skip` comment for product name:**
> `/skip obsidianmd/ui/sentence-case — "LLM Wiki" is the plugin's product name (proper noun); displayed in ribbon tooltip and panel header where it identifies the plugin`

---

## Files Changed

| File | Change type |
|---|---|
| `package.json` | add `path-browserify` dependency |
| `esbuild.config.mjs` | remove `node:path` and `node:fs` from external |
| `src/claude-cli-client.ts` | remove `fs`/`path` imports; add `tmpWrite`/`tmpRemove` to config |
| `src/controller.ts` | static import `path-browserify`; remove `require("fs"/"path")`; vault adapter for mkdir; remove existsSync; pass callbacks |
| `src/phases/fix.ts` | import from `path-browserify` |
| `src/phases/ingest.ts` | import from `path-browserify` |
| `src/phases/lint.ts` | import from `path-browserify` |
| `src/source-paths.ts` | import from `path-browserify` |
| `src/main.ts` | add `/skip` eslint comment |
| `src/view.ts` | add `/skip` eslint comment; verify h3 text |
| `src/settings.ts` | fix "Setup" → "setup"; fix remaining sentence case |
| PR #12351 comment | post `/skip node:child_process` |

---

## Success Criteria

- `npm run build` succeeds
- `npm test` passes (all existing tests)
- `vault.adapter.mkdir/write/remove` usage verified in integration path
- ObsidianReviewBot rescan returns 0 Required violations (child_process covered by `/skip`)
