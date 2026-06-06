---
chain:
  intent: docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md
review:
  spec_hash: 7875098e007096df
  last_run: 2026-06-06
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Components / 1. controller.ts"
      text: "\"export-settings/loader helpers as needed\" — точный набор аргументов createPNG уточняется на этапе реализации"
      verdict: accepted
      verdict_at: 2026-06-06
---

# Design: excalidraw-vision-render-fix

**Date:** 2026-06-06
**Status:** approved
**Intent:** [2026-06-06-excalidraw-vision-render-fix-intent.md](../intents/2026-06-06-excalidraw-vision-render-fix-intent.md)

## Problem

`analyzeExcalidraw` in `src/phases/attachment-analyzer.ts` renders Excalidraw
drawings by calling `await import("@excalidraw/utils")` and `exportToBlob`. In the
Obsidian runtime this fails with `Failed to resolve module specifier
'@excalidraw/utils'` — the module is marked `external` in the esbuild config but no
module loader resolves it at runtime. Result: notes containing `![[draw.excalidraw]]`
get no Vision description; the attachment is skipped or the format step errors.

## Approach

Render the drawing through the **host plugin** (`obsidian-excalidraw-plugin`) instead
of bundling/importing the Excalidraw library. The host plugin's
`ExcalidrawAutomate.createPNG(templatePath, ...)` reads the `.excalidraw` /
`.excalidraw.md` file by path and returns a PNG — including native handling of
compressed `.excalidraw.md` wrappers. This removes the need to parse the drawing JSON
ourselves and removes the `@excalidraw/utils` dependency entirely.

Access to the host plugin stays out of the analyzer: the analyzer talks only to
`VaultTools`, mirroring the existing `resolveLink` decoupling.

## Components

### 1. `controller.ts` — `buildAgentRunner`

Next to the existing `adapter.resolveLink` assignment, add
`adapter.renderExcalidrawPng`:

- Lazy, desktop-guarded access (no host plugin / mobile → return `null`).
- Look up the host plugin: `app.plugins.plugins["obsidian-excalidraw-plugin"]`.
- Obtain the `ExcalidrawAutomate` instance from the plugin; if absent → `null`.
- `ea.reset()` before rendering (isolate prior template state).
- Render: prefer `ea.createPNGBase64(resolvedPath, ...)` (LLM-oriented wrapper,
  returns base64 directly); if that method is absent, fall back to
  `ea.createPNG(resolvedPath, ...)` (returns a Blob) → `arrayBuffer()` →
  `arrayBufferToBase64`.
- Any thrown error → return `null` (caller treats as "Vision skipped").
- Returns: base64-encoded PNG string, or `null`.

A minimal local TypeScript interface describes the EA methods used
(`reset`, `createPNGBase64?`, `createPNG`, and the export-settings/loader helpers as
needed). No `app` reference leaks into the analyzer.

### 2. `vault-tools.ts`

- `VaultAdapter`: add optional `renderExcalidrawPng?(resolvedPath: string): Promise<string | null>`.
- `VaultTools`: add a thin passthrough method `renderExcalidrawPng(resolvedPath)`
  returning `this.adapter.renderExcalidrawPng?.(resolvedPath) ?? null` (same shape as
  `resolveLink`).

### 3. `attachment-analyzer.ts`

- `analyzeExcalidraw(b64, llm, model, signal, language)` — now takes a base64 PNG
  string and calls `callVisionLlm(imageSystem(language), [image_url data:image/png])`.
- `analyzeSingleAttachment` excalidraw branch:
  ```ts
  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;            // no host plugin / render failed → skip
    return analyzeExcalidraw(b64, llm, model, signal, language);
  }
  ```
  No longer reads the file text or parses JSON for the render path.
- Remove `extractExcalidrawJson` (and its export) and the dynamic
  `import("@excalidraw/utils")`.

### 4. `esbuild.config.mjs`

Remove `"@excalidraw/utils"` from the `external` array.

### 5. `package.json`

Remove the `@excalidraw/utils` dependency.

## Error handling

- Host plugin missing, mobile platform, or any render exception →
  `renderExcalidrawPng` returns `null` → analyzer returns `null` for that embed →
  existing per-attachment `try/catch` in `analyzeAttachments` records no entry →
  "Vision skipped". Never crashes the format step.
- Image and PDF branches are untouched.
- The source `.excalidraw` file is never modified (render is read-only by path).

## Testing

`tests/attachment-analyzer.test.ts`:

- Remove the `describe("extractExcalidrawJson")` block and its import.
- Mock `vaultTools` gains a `renderExcalidrawPng` mock.
- New test: excalidraw embed → `renderExcalidrawPng` resolves base64 → expect a
  Vision LLM call and the returned description in the result map.
- New test: `renderExcalidrawPng` resolves `null` (no host plugin) → no Vision call,
  no entry in the result map.
- Keep existing image/PDF/routing/traversal tests green.

## Docs

- Update the relevant `lat.md/` vision/attachment section: render via host plugin
  `ExcalidrawAutomate`, no `@excalidraw/utils`; drop any `extractExcalidrawJson`
  references.
- Update the intent's health-metric line that names `extractExcalidrawJson`.
- Run `lat check`.

## Done when

- `npm run lint`, tests, and `lat check` are green.
- `dist/main.js` stays ~2M (no library inflation).
- Image / PDF / no-vision / no-excalidraw behavior unchanged.
- Manual check in a live Obsidian with a real Excalidraw file produces a Vision
  `tool_result ok` (outside autonomy — human verification).
