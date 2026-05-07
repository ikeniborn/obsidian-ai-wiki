# Clickable Internal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `[[WikiLink]]` links in the results panel, chat bubbles, and history panel clickable — opening the linked note in Obsidian.

**Architecture:** Add a single delegated click handler utility `registerLinkHandler(el, app)` in `src/view.ts`. Call it after each `MarkdownRenderer.render()`. Fix the `sourcePath` arg (`cwdOrEmpty()` → `""`) in all three render sites.

**Tech Stack:** TypeScript, Obsidian Plugin API (`app.workspace.openLinkText`, `MarkdownRenderer`)

---

## File Map

| File | Change |
|---|---|
| `src/view.ts` | Add `registerLinkHandler` function; fix sourcePath in 3 places; call handler after each render |

No new files. No test files — DOM interaction is not covered by existing test suite; manual verification is the gate.

---

### Task 1: Add `registerLinkHandler` utility and fix `finish()`

**Files:**
- Modify: `src/view.ts:1-10` (after imports, add helper function)
- Modify: `src/view.ts:405` (fix sourcePath + call handler)

- [ ] **Step 1: Add helper function after imports**

In `src/view.ts`, after line 9 (`type ViewState = ...`), insert:

```typescript
function registerLinkHandler(el: HTMLElement, app: App): void {
    el.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest("a.internal-link");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
        if (href) void app.workspace.openLinkText(href, "", false);
    });
}
```

- [ ] **Step 2: Fix `finish()` — line 405**

Replace:
```typescript
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, "", comp);
      registerLinkHandler(this.finalEl, this.app);
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: no errors, `main.js` updated.

- [ ] **Step 4: Manual verify — result block**

In Obsidian: run a query operation, wait for result. Click a `[[WikiLink]]` in the result block. Expected: linked note opens in current leaf.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): clickable internal links in result block"
```

---

### Task 2: Fix `addChatBubble()` and `finishChat()`

**Files:**
- Modify: `src/view.ts:466` (`addChatBubble`)
- Modify: `src/view.ts:519` (`finishChat` streaming bubble)

- [ ] **Step 1: Fix `addChatBubble()` — line 466**

Replace:
```typescript
      void MarkdownRenderer.render(this.app, text, el, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
      void MarkdownRenderer.render(this.app, text, el, "", comp);
      registerLinkHandler(el, this.app);
```

- [ ] **Step 2: Fix `finishChat()` streaming bubble — line 519**

Replace:
```typescript
        void MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
        void MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, "", comp);
        registerLinkHandler(this.currentChatBubble, this.app);
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Manual verify — chat bubbles**

In Obsidian: run a query, send a follow-up chat message. Click a `[[WikiLink]]` in assistant chat bubble. Expected: note opens.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): clickable internal links in chat bubbles"
```

---

### Task 3: Fix `renderHistory()` click handler

**Files:**
- Modify: `src/view.ts:607` (`renderHistory`)

- [ ] **Step 1: Fix `renderHistory()` — line 607**

Replace:
```typescript
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp);
        registerLinkHandler(this.finalEl, this.app);
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Manual verify — history panel**

In Obsidian: click a past result in the history panel. Click a `[[WikiLink]]` in the rendered result. Expected: note opens.

- [ ] **Step 5: Verify no remaining `cwdOrEmpty()` calls in MarkdownRenderer.render()**

```bash
grep -n "cwdOrEmpty" src/view.ts
```

Expected: no output (all occurrences removed from view.ts).

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): clickable internal links in history panel"
```
