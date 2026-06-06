# Design: excalidraw-vision-diagram-description

**Date:** 2026-06-06
**Status:** approved
**Follows:** [2026-06-06-excalidraw-vision-render-fix-design.md](2026-06-06-excalidraw-vision-render-fix-design.md)

## Problem

After the render fix, Excalidraw embeds are rendered to PNG and analyzed by Vision,
but the description is wrong. `analyzeExcalidraw` reuses `imageSystem` →
`STRUCTURE_RULES`, whose diagram rule says "Diagram / flow / architecture → mermaid
code block" plus "Output ONLY the structured content" (no prose). So the model sees a
diagram PNG and emits a **bare mermaid block with no description**. The user wants the
diagram re-expressed *and* described: a text description is mandatory, the mermaid
recreation is kept.

Scope confirmed with the user: this applies to **Excalidraw and image diagrams**
(both flow through `STRUCTURE_RULES`), not only Excalidraw.

## Live vs. dead path (important)

There are two integration paths for Vision descriptions:

- **Live path** — `src/phases/format.ts:152-157`. Descriptions are passed to the
  formatting LLM as a `visionBlock`; the LLM integrates each one under its
  `![[path]]` embed. This is what production uses.
- **Dead path** — `insertDescriptions` in `src/phases/attachment-analyzer.ts:13`.
  Defined and unit-tested, but **never called from `src/`**. It deterministically
  wraps a description in a single-line `> *[Vision] ...*` blockquote, which breaks for
  multi-line content (mermaid/tables). The user asked to fix it anyway for
  future/fallback use; it is fixed here but changes no production output.

## Approach

Three independent levers, each small and isolated.

### 1. `STRUCTURE_RULES` diagram rule — `src/phases/attachment-analyzer.ts:86-98`

This constant is shared by `imageSystem` and `pdfSystem`, so a single edit covers
Excalidraw (via `imageSystem`), image diagrams, and diagrams inside PDFs.

- Change the diagram bullet to require a short prose description FIRST, then the
  mermaid block:

  ```
  - Diagram / flow / architecture (boxes + arrows) → FIRST a short prose
    description (what it depicts, the key nodes and how they connect), THEN a
    ```mermaid``` block recreating it.
  ```

- Relax the no-prose constraint so it bans only boilerplate intros, not the diagram
  description:

  ```
  Do NOT add boilerplate intros ("Here is...", "This image shows...").
  Output ONLY the requested content (diagrams: the description + mermaid;
  other types: the single structured form).
  ```

No dedicated Excalidraw prompt is added — `analyzeExcalidraw` keeps using
`imageSystem`. Non-diagram content (tables, photos, code) is unaffected: those
branches still emit a single structured form.

### 2. `visionBlock` integration instruction — `src/phases/format.ts:157`

The current instruction says to integrate "по форме исходника" (per source form),
which for a diagram may collapse to mermaid only and drop the prose. Tighten it so the
formatting LLM preserves **both** the text description and the mermaid block for
diagrams. The "do NOT wrap in blockquote / do NOT add [Vision] marker" guidance stays.

### 3. `insertDescriptions` multi-line fix — `src/phases/attachment-analyzer.ts:13`

- Single-line description → unchanged: `> *[Vision] <desc>*`.
- Multi-line description (contains `\n`, e.g. prose + mermaid) → emit a marker line
  `> *[Vision]*`, a blank line, then the description verbatim at **top level** (not
  inside the blockquote) so the mermaid fence / table renders.
- Idempotency is preserved: the existing "next non-empty line starts with
  `> *[Vision]`" check matches both shapes, so a re-run skips an already-described
  embed.

## Components

| File | Change |
|------|--------|
| `src/phases/attachment-analyzer.ts` | Edit `STRUCTURE_RULES` diagram rule + no-prose line; rewrite `insertDescriptions` for multi-line. |
| `src/phases/format.ts` | Tighten the `visionBlock` instruction to keep description + mermaid for diagrams. |
| `tests/attachment-analyzer.test.ts` | Add: Excalidraw → description + mermaid in Vision output; `insertDescriptions` multi-line mermaid inserts correctly + is idempotent. |
| `lat.md/operations.md` | Update the vision paragraph to note diagrams produce description + mermaid. |

## Error handling

- No change to the existing per-attachment `try/catch` in `analyzeAttachments` or the
  `null` → "Vision skipped" path. A prompt change cannot introduce new failure modes.
- `insertDescriptions` multi-line branch is pure string manipulation; empty/malformed
  descriptions fall back to the single-line shape.

## Testing

`tests/attachment-analyzer.test.ts`:

- Excalidraw render path: mock `renderExcalidrawPng` → base64; mock the LLM to return
  a "description + ```mermaid```" string; assert the result map contains both the prose
  and the mermaid fence. (Asserts wiring + that the analyzer returns the model output
  verbatim; the prompt wording itself is not unit-assertable.)
- `insertDescriptions` with a multi-line description containing a mermaid block:
  assert the marker line `> *[Vision]*` precedes the top-level mermaid fence, and a
  second call is idempotent (no duplicate insertion).
- Keep all existing image/PDF/routing/traversal/idempotency tests green.

## Docs

- Update the `lat.md/operations.md` vision paragraph: diagrams (Excalidraw + image
  diagrams) yield a text description plus a mermaid recreation.
- Run `lat check`.

## Out of scope

- Generating `.canvas` files (Vision never creates files; large separate feature).
- A dedicated Excalidraw system prompt.
- Any change to `controller.ts` / host-plugin render wiring.

## Done when

- `npm run lint`, tests, and `lat check` are green.
- A diagram embed produces a Vision block with a prose description followed by a
  mermaid recreation (manual Obsidian check, outside autonomy).
- Image / PDF / non-diagram / no-vision behavior unchanged.
