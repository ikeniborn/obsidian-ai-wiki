# sanitizeLinks null crash fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `TypeError: Cannot read properties of null (reading 'querySelectorAll')` in chat bubble render path.

**Architecture:** Capture `this.currentChatBubble` in a local `const bubble` before the `void MarkdownRenderer.render(...)` call so the `.then()` closure holds a stable reference; `this.currentChatBubble` is nulled synchronously on line 905 before the Promise resolves.

**Tech Stack:** TypeScript, Obsidian API (`MarkdownRenderer`), esbuild

---

### Task 1: Patch src/view.ts

**Files:**
- Modify: `src/view.ts:900-902`

- [ ] **Step 1: Open file and locate the chat bubble render block**

In `src/view.ts`, find this block (around line 899–905):

```ts
      } else {
        const comp = new Component();
        comp.load();
        void MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, "", comp).then(() => sanitizeLinks(this.currentChatBubble!));
        registerLinkHandler(this.currentChatBubble, this.app);
      }
      this.currentChatBubble = null;
```

- [ ] **Step 2: Apply the fix**

Replace lines 900–903 with:

```ts
      } else {
        const comp = new Component();
        comp.load();
        const bubble = this.currentChatBubble;
        void MarkdownRenderer.render(this.app, msg.content, bubble, "", comp).then(() => sanitizeLinks(bubble));
        registerLinkHandler(bubble, this.app);
      }
      this.currentChatBubble = null;
```

- [ ] **Step 3: Bump patch version**

Read current version from `package.json` (currently `0.1.135`), increment patch → `0.1.136`.

In `package.json`, change:
```json
"version": "0.1.135",
```
to:
```json
"version": "0.1.136",
```

In `src/manifest.json`, change the `version` field to `"0.1.136"` as well.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: exits 0, no TypeScript errors, `main.js` updated.

- [ ] **Step 5: Manual smoke test**

1. Reload plugin in Obsidian (Ctrl+R or disable/enable).
2. Run any `query` operation.
3. Send a chat message.
4. Open DevTools console — no `TypeError: Cannot read properties of null (reading 'querySelectorAll')`.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts src/manifest.json package.json main.js
git commit -m "fix(view): capture chatBubble ref before async render to avoid null crash"
```
