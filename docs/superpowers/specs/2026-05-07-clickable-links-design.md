# Clickable Internal Links in Results Panel

## Problem

`MarkdownRenderer.render()` converts `[[WikiLink]]` to `<a class="internal-link">` elements, but clicks do nothing. In Obsidian plugin `ItemView`, the global click interceptor does not fire automatically for plugin-rendered content.

Secondary issue: `sourcePath` passed to `MarkdownRenderer.render()` is an absolute filesystem path (`cwdOrEmpty()` → `getBasePath()`), but Obsidian expects a vault-relative path. This causes incorrect `data-href` values on rendered links.

## Solution

**Approach B**: utility helper + sourcePath fix.

### 1. Utility function `registerLinkHandler`

Add to `src/view.ts`:

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

Single delegated handler per container. Intercepts only `a.internal-link` — external links unaffected.

### 2. Fix sourcePath

Replace `this.plugin.controller.cwdOrEmpty()` → `""` in all three `MarkdownRenderer.render()` calls:

| Method | File | Line (approx) |
|---|---|---|
| `finish()` | src/view.ts | ~405 |
| `addChatBubble()` | src/view.ts | ~466 |
| `renderHistory()` click handler | src/view.ts | ~607 |

### 3. Register handler after each render

```typescript
await MarkdownRenderer.render(this.app, text, el, "", comp);
registerLinkHandler(el, this.app);
```

## Behavior

- Regular click → opens file in current Obsidian leaf via `app.workspace.openLinkText(href, "", false)`
- External links (`https://...`) → not intercepted (no `internal-link` class), open in browser normally

## Scope

Only `src/view.ts`. No changes to controller, types, or settings.

## Tests

- Existing stream/view tests unaffected (no DOM interaction)
- Manual verification: run plugin, execute query, click `[[WikiLink]]` in result block
