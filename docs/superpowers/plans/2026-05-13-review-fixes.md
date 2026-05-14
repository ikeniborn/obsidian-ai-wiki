# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить 5 категорий замечаний Obsidian Community plugin review и выпустить новую patch-версию.

**Architecture:** Пять независимых изменений в разных файлах — импорт, TypeScript-каст, таймеры в view.ts, CI workflow, README. Без новых модулей. Каждый таск самодостаточен и безопасно коммитится отдельно.

**Tech Stack:** TypeScript, esbuild, GitHub Actions, Obsidian Plugin API

---

### Task 1: Fix `node:child_process` import prefix

**Files:**
- Modify: `src/claude-cli-client.ts:1`
- Modify: `esbuild.config.mjs:9`

- [ ] **Step 1: Edit `src/claude-cli-client.ts`**

Replace line 1:
```ts
// было
import { spawn } from "node:child_process";
// стало
import { spawn } from "child_process";
```

- [ ] **Step 2: Edit `esbuild.config.mjs`**

Replace in `external` array on line 9:
```js
// было
external: ["obsidian", "electron", "node:child_process", "node:readline"],
// стало
external: ["obsidian", "electron", "child_process", "node:readline"],
```

- [ ] **Step 3: Build and verify no errors**

```bash
npm run build
```
Expected: build completes without errors, `dist/main.js` updated.

- [ ] **Step 4: Commit**

```bash
git add src/claude-cli-client.ts esbuild.config.mjs
git commit -m "fix: replace node:-prefixed import with bare specifier for Obsidian validator"
```

---

### Task 2: Fix TypeScript cast in `modals.ts`

**Files:**
- Modify: `src/modals.ts:138`

- [ ] **Step 1: Edit `src/modals.ts` line 138**

```ts
// было
dropEl = activeDocument.body.createDiv({ cls: "ai-wiki-folder-dropdown" });
// стало
dropEl = (activeDocument.body as HTMLElement).createDiv({ cls: "ai-wiki-folder-dropdown" });
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npm run build
```
Expected: no TypeScript errors. If ESLint runs in CI, the 3 unsafe-assignment warnings on this line must be gone.

- [ ] **Step 3: Commit**

```bash
git add src/modals.ts
git commit -m "fix: cast activeDocument.body to HTMLElement to resolve ESLint unsafe-member-access warnings"
```

---

### Task 3: Replace `setInterval` with recursive `setTimeout` in `view.ts`

**Files:**
- Modify: `src/view.ts`

This task has two sub-parts: the metrics timer (`tickHandle`) and the chat-bubble timer (`chatTickHandle`). Do them in one commit.

- [ ] **Step 1: Update field declaration for `tickHandle`**

Find the field declaration of `tickHandle` (near line 55–70, look for `private tickHandle`). Change its type:

```ts
// было
private tickHandle: number | null = null;
// стало
private tickHandle: ReturnType<typeof window.setTimeout> | null = null;
```

- [ ] **Step 2: Add `scheduleMetricsTick()` method**

Add this private method to the class, immediately after the `updateMetrics()` method definition:

```ts
private scheduleMetricsTick(): void {
  this.tickHandle = window.setTimeout(() => {
    this.updateMetrics();
    if (this.state === "running") this.scheduleMetricsTick();
  }, 500);
}
```

- [ ] **Step 3: Replace `setInterval` call for metrics timer (line ~302)**

```ts
// было
if (this.tickHandle !== null) window.clearInterval(this.tickHandle);
this.tickHandle = window.setInterval(() => this.updateMetrics(), 500);
// стало
if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
this.scheduleMetricsTick();
```

- [ ] **Step 4: Update field declaration for `chatTickHandle`**

Find `private chatTickHandle` field declaration. Change its type:

```ts
// было
private chatTickHandle: number | null = null;
// стало
private chatTickHandle: ReturnType<typeof window.setTimeout> | null = null;
```

- [ ] **Step 5: Add `scheduleChatTick()` method**

Add this private method to the class, near the chat-related methods:

```ts
private scheduleChatTick(): void {
  this.chatTickHandle = window.setTimeout(() => {
    if (this.currentChatBubble) {
      const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
      this.currentChatBubble.setText(`⏳ ${s}s…`);
      this.scheduleChatTick();
    } else {
      this.chatTickHandle = null;
    }
  }, 500);
}
```

- [ ] **Step 6: Replace `setInterval` call for chat timer (line ~589)**

```ts
// было
this.chatTickHandle = window.setInterval(() => {
  if (this.currentChatBubble) {
    const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
    this.currentChatBubble.setText(`⏳ ${s}s…`);
  }
}, 500);
// стало
this.scheduleChatTick();
```

- [ ] **Step 7: Replace all `clearInterval` → `clearTimeout` in `view.ts`**

Make these replacements (5 occurrences). Note: `setRunning()` ~line 301 is already handled in Step 3 above — do NOT touch it here.

| Location | Old | New |
|----------|-----|-----|
| `onClose()` ~line 195 | `window.clearInterval(this.tickHandle)` | `window.clearTimeout(this.tickHandle)` |
| `onClose()` ~line 196 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |
| `setDone()` ~line 504 | `window.clearInterval(this.tickHandle)` | `window.clearTimeout(this.tickHandle)` |
| `appendChatEvent()` ~line 600 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |
| `finishChat()` ~line 611 | `window.clearInterval(this.chatTickHandle)` | `window.clearTimeout(this.chatTickHandle)` |

- [ ] **Step 8: Verify no `setInterval` or `clearInterval` remain in `view.ts`**

```bash
grep -n "setInterval\|clearInterval" src/view.ts
```
Expected: no output.

- [ ] **Step 9: Build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/view.ts
git commit -m "refactor: replace setInterval with recursive setTimeout in view.ts timers"
```

---

### Task 4: Add GitHub Artifact Attestations to CI

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update `permissions` block**

Replace the existing permissions block:
```yaml
# было
    permissions:
      contents: write
# стало
    permissions:
      contents: write
      attestations: write
      id-token: write
```

- [ ] **Step 2: Add attestation step after Build, before "Read version"**

Insert new step between `- name: Build` and `- name: Read version`:
```yaml
      - name: Attest build provenance
        uses: actions/attest-build-provenance@v2
        with:
          subject-path: |
            dist/main.js
            dist/styles.css
```

- [ ] **Step 3: Verify YAML syntax**

```bash
cat .github/workflows/release.yml
```
Check that indentation is consistent (2 spaces per level) and no orphan keys.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add artifact attestations for build provenance"
```

---

### Task 5: Add English section to README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Prepend English section to `README.md`**

Insert the following block at the very top of `README.md`, before the existing Russian heading `# AI Wiki — плагин Obsidian`:

```markdown
# AI Wiki — Obsidian Plugin

Automatically builds and maintains a knowledge-base wiki from your notes using an LLM backend.

**Key features:**
- **Offline-first** — works with Ollama or any OpenAI-compatible server; data never leaves your machine
- **Compounding knowledge** — each Ingest enriches the wiki; links and pages accumulate automatically
- **Real-time transparency** — agent step progress visible live in the sidebar panel
- **Dual backends** — Native Agent (Ollama / OpenAI) and Claude Agent; switchable in settings

**Operations:** Ingest · Query · Lint · Fix · Init · Format · Chat

**Requirements:** Obsidian 1.4+, desktop (mobile: Query only). For Claude Agent: [iclaude](https://github.com/ikeniborn/iclaude) CLI.

---

```

- [ ] **Step 2: Verify README renders correctly**

```bash
head -20 README.md
```
Expected: English section at top, then `---`, then original Russian heading.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add English section to README for Obsidian Community submission"
```

---

### Task 6: Bump version and publish

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Read current version**

```bash
node -p "require('./package.json').version"
```
Note the current version (e.g. `0.1.89`).

- [ ] **Step 2: Use publish-version skill**

```
/publish-version
```

This skill bumps patch in `package.json` + `src/manifest.json`, runs `npm run build`, and commits. Follow it exactly.
