# Sidebar Ask/Cancel Button Layout

Repositions the ask and cancel buttons in the sidebar panel so cancel sits on the far left and ask on the far right, separated by flex space.

## Problem

Current layout: `[ask] [cancel]` — both buttons on the left, no visual separation between primary and destructive actions.

## Goal

New layout: `[cancel]───────────[ask]` — cancel on the far left edge, ask on the far right edge, one line, no wrapping.

## Changes

### `src/view.ts` — swap DOM creation order (lines 179-180)

Create `cancelBtn` before `askBtn` so DOM order matches visual order.

```ts
this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
this.askBtn    = askRow.createEl("button", { text: T.view.ask });
```

### `src/styles.css` — update `.ai-wiki-ask-row` rule (line 27)

Replace `gap` and `flex-wrap: wrap` with `justify-content: space-between`.

```css
.ai-wiki-ask-row { display: flex; justify-content: space-between; }
```

The `.ai-wiki-ask-row button { flex: 0 0 auto; }` rule on line 28 is unchanged.

## Rationale

- `justify-content: space-between` is the canonical flex pattern for edge-pinned buttons.
- DOM order matches visual order — no CSS `order` hacks needed.
- `flex-wrap` removed: buttons are small, sidebar is always wide enough, no wrapping case exists.
