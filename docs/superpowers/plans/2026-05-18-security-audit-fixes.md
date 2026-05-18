---
review:
  plan_hash: bddcf88467d481b0
  spec_hash: 7d2a9978dcc7e2ff
  last_run: "2026-05-18"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    task1:       4a6ef5a6e951c0f0
    task2:       3dc2a865c21eb5f6
    task3:       f9ac55a3de832f72
    task4:       289af1badf082aa8
    task5:       b18f3458fc44dae8
    self_review: 9c3ec0710d1a9203
  findings:
    - id: F-001
      phase: consistency
      severity: WARNING
      section: task4
      section_hash: 289af1badf082aa8
      text: "backend value: план использует \"claude-agent\" (план §Notes #1 говорит «в спеке опечатка»), спека использует \"claude-cli\" в main.ts-чеке и guard-комментарии. Спека не обновлена, check-spec прошёл без этого finding."
      verdict: fixed
      verdict_at: "2026-05-18"
    - id: F-002
      phase: consistency
      severity: WARNING
      section: task4
      section_hash: 289af1badf082aa8
      text: "guard location: спека требует guard в private run() — «all public methods funnel through it». План добавляет guard в dispatch() и dispatchChat() отдельно. Если есть третий путь через run(), он останется без защиты."
      verdict: fixed
      verdict_at: "2026-05-18"
    - id: F-003
      phase: consistency
      severity: WARNING
      section: task4
      section_hash: 289af1badf082aa8
      text: "i18n namespace: спека использует i18n().notices.shellConsentRequired, план использует i18n().ctrl.shellConsentRequired. Секции notices и ctrl — разные объекты в i18n."
      verdict: fixed
      verdict_at: "2026-05-18"
---

# Security Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two Obsidian community review bot findings — vault enumeration via `getFiles()` and excessive spawn surface — to pass community review.

**Architecture:** Replace full-vault `getFiles()` calls with folder-scoped helpers (`getFolderByPath` + recursive walk); remove the probe-spawn from settings.ts replacing it with `fs.access`; add `validateIclaudePath()` before every spawn in claude-cli-client; gate all operations behind a first-run shell-consent modal stored in settings.

**Tech Stack:** TypeScript, Obsidian API (`TFile`, `TFolder`, `Vault`, `Modal`), `node:fs/promises`, `path-browserify`.

---

## File Map

| File | Change |
|---|---|
| `src/view.ts` | Export `collectMdInPaths` + `walkFolder` helpers; replace 2 `getFiles()` call sites; add `TFile`, `TFolder`, `Vault` imports |
| `src/settings.ts` | Replace `checkClaudeAvailability` spawn with `fs.access`; remove `child_process` import |
| `src/claude-cli-client.ts` | Export `validateIclaudePath`; call it before `spawn()` in `_generate()`; add `isAbsolute` import |
| `src/types.ts` | Add `shellConsentGiven: boolean` to `LlmWikiPluginSettings`; add to `DEFAULT_SETTINGS` |
| `src/i18n.ts` | Add `shellConsentRequired` to `ctrl` section (en + ru); add `ShellConsentModal` strings to `modal` section |
| `src/modals.ts` | Add `ShellConsentModal` class |
| `src/main.ts` | Add `onLayoutReady` consent check |
| `src/controller.ts` | Add consent guard in `dispatch()` and `dispatchChat()`; add `ShellConsentModal` import |
| `tests/collect-md-in-paths.test.ts` | Unit tests for `collectMdInPaths` / `walkFolder` |
| `tests/no-fs-imports.test.ts` | Add check: `settings.ts` has no `child_process` import |
| `tests/claude-cli-client.test.ts` | Add tests for `validateIclaudePath` |
| `tests/shell-consent.test.ts` | Tests for `ShellConsentModal` and controller consent guard |
| `README.md` | Add `## Security` section |

---

### Task 1: Vault enumeration — replace `getFiles()` with folder-scoped helpers

**Files:**
- Modify: `src/view.ts:1` (add imports), `src/view.ts:269-273` (runInit call site), `src/view.ts:311` (runReinit call site)
- Create: `tests/collect-md-in-paths.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/collect-md-in-paths.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { collectMdInPaths, walkFolder } from "../src/view";

function makeFile(path: string, extension: string) {
  return { path, extension } as any;
}

function makeFolder(path: string, children: unknown[]) {
  return { path, children } as any;
}

describe("walkFolder", () => {
  it("collects .md files from a flat folder", () => {
    const f1 = makeFile("Notes/a.md", "md");
    const f2 = makeFile("Notes/b.txt", "txt");
    const folder = makeFolder("Notes", [f1, f2]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([f1]);
  });

  it("recurses into subfolders", () => {
    const f1 = makeFile("Notes/sub/deep.md", "md");
    const sub = makeFolder("Notes/sub", [f1]);
    const folder = makeFolder("Notes", [sub]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([f1]);
  });

  it("ignores non-.md files at all depths", () => {
    const f1 = makeFile("Notes/img.png", "png");
    const folder = makeFolder("Notes", [f1]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([]);
  });
});

describe("collectMdInPaths", () => {
  it("returns files only from configured source paths", () => {
    const f1 = makeFile("Notes/AI/a.md", "md");
    const folder = makeFolder("Notes/AI", [f1]);
    const vault = {
      getFolderByPath: (p: string) => (p === "Notes/AI" ? folder : null),
    } as any;
    const result = collectMdInPaths(vault, ["Notes/AI", "Notes/Missing"]);
    expect(result).toEqual([f1]);
  });

  it("returns empty array when source path folder does not exist", () => {
    const vault = { getFolderByPath: () => null } as any;
    const result = collectMdInPaths(vault, ["Notes/Nonexistent"]);
    expect(result).toEqual([]);
  });

  it("returns empty array when sourcePaths is empty", () => {
    const vault = { getFolderByPath: () => null } as any;
    const result = collectMdInPaths(vault, []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/collect-md-in-paths.test.ts
```

Expected: FAIL — `collectMdInPaths` is not exported from `src/view.ts`

- [ ] **Step 3: Add TFile/TFolder/Vault imports to view.ts**

In `src/view.ts:1`, change:
```typescript
import { App, ItemView, Modal, WorkspaceLeaf, MarkdownRenderer, Component, Notice, Platform, setIcon } from "obsidian";
```
to:
```typescript
import { App, ItemView, Modal, TFile, TFolder, Vault, WorkspaceLeaf, MarkdownRenderer, Component, Notice, Platform, setIcon } from "obsidian";
```

- [ ] **Step 4: Add helpers after imports in view.ts**

After the imports block (before line 8 `export const AI_WIKI_VIEW_TYPE`), insert:

```typescript
export function collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[] {
  const result: TFile[] = [];
  for (const p of sourcePaths) {
    const folder = vault.getFolderByPath(p);
    if (folder) walkFolder(folder, result);
  }
  return result;
}

export function walkFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") out.push(child);
    else if (child instanceof TFolder) walkFolder(child, out);
  }
}
```

- [ ] **Step 5: Replace runInit call site (view.ts:269–273)**

Replace:
```typescript
        const allFiles = this.app.vault.getFiles();
        const mdFiles = allFiles.filter(
          (f) => f.extension === "md" &&
            input.sourcePaths.some((p) => f.path.startsWith(p)),
        );
```
with:
```typescript
        const mdFiles = collectMdInPaths(this.app.vault, input.sourcePaths);
```

- [ ] **Step 6: Replace runReinit call site (view.ts:311)**

Replace:
```typescript
    const mdFiles = this.app.vault.getFiles().filter(
      (f) => f.extension === "md" && sourcePaths.some((p) => f.path.startsWith(p)),
    );
```
with:
```typescript
    const mdFiles = collectMdInPaths(this.app.vault, sourcePaths);
```

- [ ] **Step 7: Run tests — verify pass**

```bash
npx vitest run tests/collect-md-in-paths.test.ts
```

Expected: all 6 tests PASS

- [ ] **Step 8: Run full test suite to catch regressions**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/view.ts tests/collect-md-in-paths.test.ts
git commit -m "fix(security): replace vault.getFiles() with folder-scoped collectMdInPaths (F-1)"
```

---

### Task 2: Remove spawn probe from settings.ts (F-2a)

**Files:**
- Modify: `src/settings.ts:1-31` (replace `checkClaudeAvailability`, remove `spawn` import)
- Modify: `tests/no-fs-imports.test.ts` (add spawn-in-settings check)

- [ ] **Step 1: Write failing test**

In `tests/no-fs-imports.test.ts`, add a new `describe` block at the end of the file:

```typescript
describe("settings.ts: no child_process spawn", () => {
  it("settings.ts does not import from child_process", () => {
    const src = readFileSync(join(process.cwd(), "src/settings.ts"), "utf-8");
    const lines = src.split("\n");
    const offending = lines.filter((l) => /^import\s.*from\s+["']child_process["']/.test(l));
    expect(offending, `settings.ts imports from child_process: ${offending.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/no-fs-imports.test.ts
```

Expected: FAIL — `settings.ts imports from child_process: import { spawn } from "child_process"`

- [ ] **Step 3: Replace checkClaudeAvailability in settings.ts**

Replace the entire `checkClaudeAvailability` function (`src/settings.ts:1-31`) with:

```typescript
import { access, constants } from "node:fs/promises";
import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
// ... rest of existing imports unchanged ...

async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  await access(iclaudePath, constants.X_OK);
}
```

Concretely — in `src/settings.ts`:

Line 1: change `import { spawn } from "child_process";` to `import { access, constants } from "node:fs/promises";`

Lines 11–31: replace the entire `checkClaudeAvailability` function body with:

```typescript
async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  await access(iclaudePath, constants.X_OK);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/no-fs-imports.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts tests/no-fs-imports.test.ts
git commit -m "fix(security): replace spawn probe in settings.ts with fs.access (F-2a)"
```

---

### Task 3: Path validation before spawn in claude-cli-client.ts (F-2b)

**Files:**
- Modify: `src/claude-cli-client.ts:2` (add `isAbsolute` import), add `validateIclaudePath` function, call it in `_generate()`
- Modify: `tests/claude-cli-client.test.ts` (add tests)

- [ ] **Step 1: Write failing tests**

In `tests/claude-cli-client.test.ts`, add after existing imports:

```typescript
import { validateIclaudePath } from "../src/claude-cli-client";
```

Add at the end of the file, after existing `describe` blocks:

```typescript
describe("validateIclaudePath", () => {
  it("throws when path is empty string", () => {
    expect(() => validateIclaudePath("")).toThrow("iclaudePath is empty");
  });

  it("throws when path is relative", () => {
    expect(() => validateIclaudePath("bin/claude")).toThrow(
      'iclaudePath must be absolute: "bin/claude"',
    );
  });

  it("throws when path contains ..", () => {
    expect(() => validateIclaudePath("/home/user/../claude")).toThrow(
      'iclaudePath contains path traversal: "/home/user/../claude"',
    );
  });

  it("does not throw for valid absolute path", () => {
    expect(() => validateIclaudePath("/usr/bin/claude")).not.toThrow();
  });

  it("does not throw for path with home directory", () => {
    expect(() => validateIclaudePath("/home/user/iclaude.sh")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Expected: FAIL — `validateIclaudePath` is not exported from `src/claude-cli-client`

- [ ] **Step 3: Add isAbsolute import and validateIclaudePath to claude-cli-client.ts**

Change line 2 from:
```typescript
import { join } from "path-browserify";
```
to:
```typescript
import { join, isAbsolute } from "path-browserify";
```

After the `SIGTERM_GRACE_MS` constant (after line 20), add:

```typescript
export function validateIclaudePath(p: string): void {
  if (!p) throw new Error("iclaudePath is empty");
  if (!isAbsolute(p)) throw new Error(`iclaudePath must be absolute: "${p}"`);
  if (p.includes("..")) throw new Error(`iclaudePath contains path traversal: "${p}"`);
}
```

- [ ] **Step 4: Call validateIclaudePath in _generate()**

In `_generate()`, the `spawn()` call is at line 130. Add the validation call immediately before it:

```typescript
  private async *_generate(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
    tmpFiles: string[],
  ): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
    validateIclaudePath(this.cfg.iclaudePath);
    const child = spawn(this.cfg.iclaudePath, args, { stdio: ["ignore", "pipe", "pipe"], cwd: this.cfg.cwd || undefined });
```

- [ ] **Step 5: Run tests — verify pass**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Expected: all tests PASS including the 5 new `validateIclaudePath` tests

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/claude-cli-client.ts tests/claude-cli-client.test.ts
git commit -m "fix(security): add validateIclaudePath before spawn in ClaudeCliClient (F-2b)"
```

---

### Task 4: Shell consent modal and operation guard (F-2c)

**Files:**
- Modify: `src/types.ts` (add `shellConsentGiven`)
- Modify: `src/i18n.ts` (add strings)
- Modify: `src/modals.ts` (add `ShellConsentModal`)
- Modify: `src/main.ts` (add `onLayoutReady` check)
- Modify: `src/controller.ts` (add consent guard in `dispatch` and `dispatchChat`)
- Create: `tests/shell-consent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/shell-consent.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ShellConsentModal } from "../src/modals";
import { DEFAULT_SETTINGS } from "../src/types";

describe("DEFAULT_SETTINGS.shellConsentGiven", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.shellConsentGiven).toBe(false);
  });
});

describe("ShellConsentModal", () => {
  it("is exported from modals.ts", () => {
    expect(ShellConsentModal).toBeDefined();
  });

  it("sets shellConsentGiven=true and saves when enable() is called", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      settings: { shellConsentGiven: false },
      saveSettings,
    } as any;
    const modal = new ShellConsentModal({} as any, plugin);
    await (modal as any).enable();
    expect(plugin.settings.shellConsentGiven).toBe(true);
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it("does not change shellConsentGiven when cancel() is called", () => {
    const plugin = {
      settings: { shellConsentGiven: false },
      saveSettings: vi.fn(),
    } as any;
    const modal = new ShellConsentModal({} as any, plugin);
    (modal as any).close = vi.fn();
    (modal as any).cancel();
    expect(plugin.settings.shellConsentGiven).toBe(false);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/shell-consent.test.ts
```

Expected: FAIL — `shellConsentGiven` not in `DEFAULT_SETTINGS`; `ShellConsentModal` not exported

- [ ] **Step 3: Add shellConsentGiven to types.ts**

In `src/types.ts`, in the `LlmWikiPluginSettings` interface (after `devMode` block), add:

```typescript
  shellConsentGiven: boolean;
```

In `DEFAULT_SETTINGS` (after `devMode` block), add:

```typescript
  shellConsentGiven: false,
```

- [ ] **Step 4: Add i18n strings**

In `src/i18n.ts`, in the `en.ctrl` object, add after `configureCloudLlm`:

```typescript
    shellConsentRequired: "Shell execution consent required — see plugin settings",
```

In `en.modal` object, add after `busyCloseLeave`:

```typescript
    shellConsentTitle: "⚠ Shell Execution Notice",
    shellConsentBody: (iclaudePath: string) =>
      `This plugin runs an external process:\n  ${iclaudePath}\nwith your operating system user's permissions. This is required for AI Wiki to function. Review the path above, then confirm to enable.`,
    shellConsentEnable: "I understand, enable",
```

In the `ru: I18n` object, replicate in `ctrl` (after `configureCloudLlm`):

```typescript
    shellConsentRequired: "Требуется согласие на запуск внешнего процесса — откройте настройки плагина",
```

In `ru.modal` (after `busyCloseLeave`):

```typescript
    shellConsentTitle: "⚠ Запуск внешнего процесса",
    shellConsentBody: (iclaudePath: string) =>
      `Плагин запускает внешний процесс:\n  ${iclaudePath}\nс правами вашего системного пользователя. Это необходимо для работы AI Wiki. Проверьте путь выше, затем подтвердите включение.`,
    shellConsentEnable: "Понимаю, включить",
```

- [ ] **Step 5: Add ShellConsentModal to modals.ts**

In `src/modals.ts`, at the end of the file (before the final blank line), add:

```typescript
export class ShellConsentModal extends Modal {
  constructor(app: App, private plugin: import("./main").default) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const iclaudePath = (this.plugin as any).localConfigStore
      ? "(configure path in settings)"
      : "";
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.shellConsentTitle });
    contentEl.createEl("p", { text: T.shellConsentBody(iclaudePath), cls: "ai-wiki-consent-body" });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(i18n().modal.cancel).onClick(() => this.cancel()))
      .addButton((b) =>
        b.setButtonText(T.shellConsentEnable).setCta().onClick(() => void this.enable()),
      );
  }

  cancel(): void {
    this.close();
  }

  async enable(): Promise<void> {
    this.plugin.settings.shellConsentGiven = true;
    await this.plugin.saveSettings();
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 6: Add onLayoutReady consent check to main.ts**

In `src/main.ts`, add `ShellConsentModal` to the modals import line:

```typescript
import { QueryModal, DomainModal, ShellConsentModal } from "./modals";
```

After `this.settingTab = new LlmWikiSettingTab(this.app, this);` (the last line before `console.debug("[ai-wiki] loaded")`), add:

```typescript
    this.app.workspace.onLayoutReady(() => {
      if (
        this.settings.backend === "claude-agent" &&
        !this.settings.shellConsentGiven
      ) {
        new ShellConsentModal(this.app, this).open();
      }
    });
```

- [ ] **Step 7: Add consent guard to controller.ts**

In `src/controller.ts`, add `ShellConsentModal` to the modals import:

```typescript
import { FileErrorModal, ConfirmModal, ShellConsentModal } from "./modals";
```

In `dispatch()` method, after the existing platform guard block that ends with `this._currentLogMeta = {...}` (approximately after line 546), add the consent guard:

```typescript
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
        new Notice(i18n().ctrl.shellConsentRequired);
        return;
      }
    }
```

Add this block immediately after the existing backend guard block (the block that calls `requireNativeAgent`/`requireClaudeAgent`).

In `dispatchChat()` method, after the existing backend guard block (the block that calls `requireNativeAgent`/`requireClaudeAgent`, around line 225–226), add the same consent guard:

```typescript
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
        new Notice(i18n().ctrl.shellConsentRequired);
        return;
      }
    }
```

Note: both `dispatch()` and `dispatchChat()` already load `local` config in their respective guard blocks. Rather than loading it twice, integrate the consent check into the existing `const local = ...` block. The existing blocks in both methods look like:

```typescript
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
      if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
      // ADD HERE:
      if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
        new Notice(i18n().ctrl.shellConsentRequired);
        return;
      }
      ...
    }
```

- [ ] **Step 8: Run tests — verify pass**

```bash
npx vitest run tests/shell-consent.test.ts
```

Expected: all 4 tests PASS

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/i18n.ts src/modals.ts src/main.ts src/controller.ts tests/shell-consent.test.ts
git commit -m "feat(security): add shell consent modal and operation guard (F-2c)"
```

---

### Task 5: README Security section (F-2d)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Security section to README.md**

Find the `---` separator at the top of the "Quick start" section (after line 31 in current README). Insert a new section before it:

```markdown
---

## Security

### Shell Execution

AI Wiki spawns an external process to run the Claude CLI backend:

- **What is executed:** the absolute path you configure in Settings → Backend → "Path to Claude Code" (e.g. `/home/user/iclaude.sh`). The path is validated to be absolute and contain no traversal sequences before each spawn.
- **Why it's required:** the Claude Agent backend works by calling `claude` / `iclaude.sh` as a subprocess. There is no alternative to `child_process.spawn` for this architecture.
- **Your permissions:** the subprocess inherits your OS user's permissions — the same as running the Claude CLI manually in a terminal.
- **How to review / change the path:** Settings → Backend Settings → "Path to Claude Code".
- **First-run consent:** on first launch with `claude-agent` backend selected, a modal asks for explicit confirmation before any operation runs. You can revoke consent by removing `shellConsentGiven` from the plugin's `data.json`.

### Vault Access

The plugin reads only the folders you configure as "Source paths" for each domain. It does not enumerate your entire vault.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Security section to README (F-2d)"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| `vault.getFiles()` zero occurrences in `view.ts` | Task 1 |
| `child_process` import only in `claude-cli-client.ts` | Task 2 |
| Path validation throws on empty / relative / traversal | Task 3 |
| First run with `claude-agent` shows consent modal | Task 4 |
| Operations without consent return early with Notice | Task 4 |
| README has Security section | Task 5 |

All spec requirements covered.

### Type consistency

- `shellConsentGiven: boolean` defined in Task 4 Step 3 → used in Task 4 Steps 6, 7 ✓
- `collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[]` defined in Task 1 Step 4 → called in Steps 5, 6 with `this.app.vault` (type `Vault`) and `input.sourcePaths`/`sourcePaths` (type `string[]`) ✓
- `validateIclaudePath(p: string): void` defined in Task 3 Step 3 → called in Step 4 with `this.cfg.iclaudePath` (type `string`) ✓
- `ShellConsentModal` defined in Task 4 Step 5 → imported in Task 4 Steps 6, 7 ✓
- `i18n().ctrl.shellConsentRequired` added in Task 4 Step 4 → used in Task 4 Step 7 ✓
- `i18n().modal.shellConsentTitle/Body/Enable` added in Task 4 Step 4 → used in Task 4 Step 5 ✓

### Notes for implementor

1. **`backend` value is `"claude-agent"`, not `"claude-cli"`** — the spec had a typo. All consent guards use `=== "claude-agent"`.
2. **`ShellConsentModal.onOpen` iclaudePath display** — to show the actual configured path, `this.plugin.localConfigStore.load()` returns a promise. For simplicity, the modal fetches the path asynchronously and updates the body element. The plan shows a synchronous fallback; if async display is needed, use `void this.plugin.localConfigStore.load().then(local => ...)` to update the `<p>` text after the modal opens.
3. **`loadSettings()` spread behavior** — new `shellConsentGiven` field in `DEFAULT_SETTINGS` is automatically picked up by `main.ts:loadSettings()` via `{ ...DEFAULT_SETTINGS, ...(data ?? {}) }`. No migration step needed.
4. **`no-fs-imports.test.ts` for `settings.ts`** — the test checks top-level `node:*` imports in `controller.ts` / `agent-runner.ts` (mobile hot paths). The new test for `settings.ts` checks `child_process` specifically (different concern: spawn surface). Both coexist cleanly.
