# Fix: sanitizeLinks null crash after chat query

## Problem

`sanitizeLinks(this.currentChatBubble!)` called in async `.then()` callback.
By the time the Promise resolves, `this.currentChatBubble` is already `null` (set on line 905).
Runtime error: `TypeError: Cannot read properties of null (reading 'querySelectorAll')`.

Location: `src/view.ts:902`

## Fix

Capture element reference in a local variable before the async call so the closure
holds a stable reference independent of the class field.

```ts
const bubble = this.currentChatBubble;
void MarkdownRenderer.render(this.app, msg.content, bubble, "", comp)
  .then(() => sanitizeLinks(bubble));
```

## Scope

- One file: `src/view.ts`
- One site: the chat bubble render in `onChatChunkEnd` (or equivalent handler)
- No tests needed — bug is runtime/DOM-only, not unit-testable
