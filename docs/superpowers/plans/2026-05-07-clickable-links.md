# Clickable Internal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `[[WikiLink]]` links in the results panel, chat bubbles, and history panel clickable — opening the linked note in Obsidian.

**Architecture:** Add `registerLinkHandler(el, app)` utility in `src/view.ts`. For `this.finalEl` (permanent element) register once in `onOpen()`. For chat bubbles (new elements per message) register after each render. Fix `sourcePath` arg from `cwdOrEmpty()` → `""` in all 4 render sites.

**Tech Stack:** TypeScript, Obsidian Plugin API (`app.workspace.openLinkText`, `MarkdownRenderer`)

---

## File Map

| File | Change |
|---|---|
| `src/view.ts` | Add `registerLinkHandler` function; fix sourcePath in 4 places; register handler once in `onOpen()` for `finalEl`; register per-element for chat bubbles |

No new files. No test files — DOM interaction not covered by existing test suite; manual verification is the gate.

---

### Task 1: Add `registerLinkHandler` utility

**Files:**
- Modify: `src/view.ts:9` (after `type ViewState` declaration)

- [ ] **Step 1: Add helper function after line 9**

In `src/view.ts`, after the line `type ViewState = "idle" | "running" | "done" | "error" | "cancelled";`, insert:

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

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors, `main.js` updated.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add registerLinkHandler utility"
```

---

### Task 2: Register handler on `finalEl` once in `onOpen()`, fix sourcePath in `finish()` and `renderHistory()`

`this.finalEl` is a permanent DOM element created once at `onOpen():155`. The handler must be registered there — not in `finish()` or `renderHistory()` where it would accumulate on repeated calls.

**Files:**
- Modify: `src/view.ts:155` (`onOpen` — after finalEl creation)
- Modify: `src/view.ts:405` (`finish()` — fix sourcePath)
- Modify: `src/view.ts:607` (`renderHistory()` — fix sourcePath)

- [ ] **Step 1: Register handler in `onOpen()` — after line 155**

Line 155 currently reads:
```typescript
    this.finalEl = this.resultSection.createDiv("llm-wiki-final llm-wiki-hidden");
```

Add after it:
```typescript
    registerLinkHandler(this.finalEl, this.app);
```

- [ ] **Step 2: Fix sourcePath in `finish()` — line 405**

Replace:
```typescript
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
      await MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, "", comp);
```

- [ ] **Step 3: Fix sourcePath in `renderHistory()` — line 607**

Replace:
```typescript
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, this.plugin.controller.cwdOrEmpty(), comp);
```

With:
```typescript
        void MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp);
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 5: Manual verify — result block and history**

In Obsidian:
1. Run a query operation, wait for result. Click a `[[WikiLink]]` in the result block → linked note opens in current leaf.
2. Click a past result in the history panel. Click a `[[WikiLink]]` → note opens.
3. Run a second query (to confirm no listener accumulation — handler fires exactly once per click).

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): clickable links in result block and history panel"
```

---

### Task 3: Fix chat bubbles — `addChatBubble()` and `finishChat()`

Each chat bubble is a new DOM element, so registering per-element here is correct (no accumulation).

**Files:**
- Modify: `src/view.ts:466` (`addChatBubble`)
- Modify: `src/view.ts:519` (`finishChat` — streaming bubble render)

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

The code is inside `if (this.currentChatBubble) { ... }` with `this.currentChatBubble = null` at line 521. Register handler before the null assignment.

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

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all tests pass (DOM handlers not covered by unit tests — no change expected).

- [ ] **Step 5: Verify no remaining cwdOrEmpty() in MarkdownRenderer.render() calls**

```bash
grep -n "cwdOrEmpty" src/view.ts
```

Expected: no output (all 4 occurrences removed from render calls).

- [ ] **Step 6: Manual verify — chat bubbles**

In Obsidian: run a query, send a follow-up chat message. Click a `[[WikiLink]]` in the assistant bubble → note opens.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): clickable links in chat bubbles"
```
