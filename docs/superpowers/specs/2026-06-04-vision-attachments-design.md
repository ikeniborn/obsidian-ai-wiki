---
review:
  spec_hash: f3db47d2d4d7a951
  last_run: 2026-06-04
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Files Changed"
      section_hash: e961edb53c018e59
      text: >
        "Settings UI component" — не указан конкретный файл.
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "PDF"
      section_hash: 2065d03c0df9d96f
      text: >
        §PDF "unified summary" противоречил §LLM Vision Call "1-3 sentences".
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-003
      phase: clarity
      severity: INFO
      section: "Excalidraw (.excalidraw)"
      section_hash: d4be7c156cbf3991
      text: >
        §Excalidraw "render SVG to canvas" без типа canvas. Секция переписана — companion-подход удалён,
        заменён на @excalidraw/utils.exportToBlob (OffscreenCanvas внутри).
      verdict: fixed
      verdict_at: 2026-06-04
chain:
  intent: null
---

# Vision Attachments in Format — Design Spec

**Date:** 2026-06-04  
**Status:** Draft  
**Scope:** Add image/PDF/Excalidraw analysis to the Format operation via a configurable vision model.

---

## Goal

When Format runs on a note that contains Obsidian embeds (`![[...]]`), the plugin should:
1. Detect embedded attachments (PNG, JPEG, PDF, Excalidraw).
2. Convert each to an image representation and call a vision LLM.
3. Write the generated description under each embed in the note.
4. Continue with standard Format using the enriched text (descriptions visible as plain text).

Feature is opt-in: disabled by default, enabled via a toggle in Settings.

---

## Settings

Add a `vision` block to plugin settings (after the backend section in UI):

```typescript
vision: {
  enabled: boolean   // default: false
  model: string      // e.g. "gpt-4o-mini", "claude-3-haiku-20240307"
}
```

Uses the same `baseUrl` and `apiKey` as the currently selected backend. No separate endpoint.

UI: toggle "Enable vision analysis" + text field "Vision model" (shown only when enabled).

---

## Architecture

### New file: `src/phases/attachment-analyzer.ts`

Exported functions:

```typescript
/** Extract ![[path]] embed inner paths from markdown text. */
export function extractObsidianEmbedPaths(md: string): string[]

/** Analyze all detected attachments; return map of innerPath → description. */
export async function analyzeAttachments(
  embedPaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<Map<string, string>>

/** Insert descriptions under ![[...]] embeds that don't already have one. */
export function insertDescriptions(md: string, descriptions: Map<string, string>): string
```

### VaultTools extension

Add to `VaultTools` interface and implementation:

```typescript
readBinary(vaultPath: string): Promise<ArrayBuffer>
```

Used by attachment analyzer to read image and PDF bytes.

### Format integration (`src/phases/format.ts`)

After reading the original file and before building the LLM prompt:

```
if (visionSettings.enabled && visionSettings.model) {
  const embedPaths = extractObsidianEmbedPaths(original)
  if (embedPaths.length > 0) {
    yield { kind: "assistant_text", delta: `Анализ вложений (${embedPaths.length})...\n` }
    const descriptions = await analyzeAttachments(embedPaths, vaultTools, llm, visionSettings.model, signal)
    const enriched = insertDescriptions(original, descriptions)
    if (enriched !== original) {
      await vaultTools.write(filePath, enriched)
      original = enriched
    }
  }
}
// continue with standard format prompt using `original`
```

`visionSettings: { enabled: boolean; model: string }` passed as a new parameter to `runFormat`.

---

## Attachment Type Handling

### PNG / JPEG / WebP

1. `readBinary(resolvedVaultPath)` → `ArrayBuffer`
2. Convert to base64 in 8 KB chunks (spread operator fails on large buffers):
   ```typescript
   const bytes = new Uint8Array(buffer);
   let binary = '';
   for (let i = 0; i < bytes.length; i += 8192)
     binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
   const b64 = btoa(binary);
   ```
3. Determine MIME type from extension (`image/png`, `image/jpeg`, `image/webp`).
4. Call vision LLM with single `image_url` content part: `"data:image/png;base64,..."`

### PDF

1. `readBinary(resolvedVaultPath)` → `ArrayBuffer`
2. Load with `pdfjsLib.getDocument({ data: arrayBuffer })` (global in Obsidian/Electron).
3. Iterate all pages: render each to `OffscreenCanvas` → `toDataURL("image/jpeg", 0.85)` → strip prefix → collect base64 strings.
4. One LLM call with all page images as sequential `image_url` content parts.
5. Ask LLM to produce a unified summary across all pages.

### Excalidraw (`.excalidraw`)

No companion file expected — the vault contains only the raw `.excalidraw` JSON.

**Dependency:** add `@excalidraw/utils` to `package.json`. It is ~40 KB gzipped, React-free, and works in Electron's browser context via Canvas API.

Steps:
1. `read(vaultPath)` → string → `JSON.parse()` → `{ elements, appState, files }`.
2. Call `exportToBlob({ elements, appState, files, mimeType: "image/png", exportPadding: 10 })` from `@excalidraw/utils`.
3. `blob.arrayBuffer()` → base64 → `image_url: "data:image/png;base64,..."` content part.
4. One LLM call with the resulting PNG image.

`exportToBlob` internally uses `OffscreenCanvas` (Electron-compatible). No React component required.

### Unknown extension

Skip silently; log a warning event: `{ kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] }`.

---

## Description Output Format

Descriptions are inserted immediately after the embed line:

```markdown
![[diagram.excalidraw]]
> *[Vision] Блок-схема с пятью узлами: Start, Validate, Process, Error, End. Стрелки показывают основной поток слева направо и петлю ошибки обратно к Validate.*
```

Marker `[Vision]` allows idempotent re-runs: `insertDescriptions` skips an embed if the very next non-empty line already starts with `> *[Vision]`.

---

## LLM Vision Call

One non-streaming call per attachment. Not parallel — sequential to avoid token bursts.

**Single-image call** (PNG, JPEG, Excalidraw):
```
System: You are a precise image analyst. Describe the visual content in 1-3 sentences.
Focus on: structure, key elements, relationships, any text visible in the image.
Reply in Russian if the note is in Russian, otherwise in English.

User: [image_url content part]
```

**Multi-image call** (PDF — all pages in one request):
```
System: You are a precise document analyst. Summarize this multi-page document.
Cover: main topic, key sections, structure, important data or conclusions.
Be comprehensive but concise — up to 10 sentences.
Reply in Russian if the note is in Russian, otherwise in English.

User: [image_url part page 1, image_url part page 2, ...]
```

Response is plain text. Unused streaming path — `stream: false`.

---

## Error Handling

- If vision LLM call fails for one attachment: log warning, skip that embed (don't block format).
- If `readBinary` fails (file not found in vault): log warning, skip.
- If `pdfjsLib` unavailable: log warning, skip PDF processing.
- Format continues regardless of vision pre-step failures.

---

## Files Changed

| File | Change |
|------|--------|
| `src/settings.ts` | Add `vision: { enabled, model }` to settings type and defaults |
| `src/phases/attachment-analyzer.ts` | New file |
| `src/vault-tools.ts` | Add `readBinary()` to interface and impl |
| `src/phases/format.ts` | Call vision pre-step when enabled |
| `src/agent-runner.ts` | Pass `visionSettings` to `runFormat` |
| `src/settings.ts` (`LlmWikiSettingTab`) | Add Vision section: toggle + model field |
| `package.json` | Add `@excalidraw/utils` dependency |

---

## Out of Scope

- Caching of descriptions across runs (future: check if `[Vision]` already present — handled by idempotent insert).
- Separate API endpoint for vision model.
- GIF / video attachments.
- Automatic re-analysis when attachment file changes.
