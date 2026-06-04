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
2. Convert to base64: `btoa(String.fromCharCode(...new Uint8Array(buffer)))`
3. Determine MIME type from extension.
4. Call vision LLM with single `image_url` content part: `"data:image/png;base64,..."`

### PDF

1. `readBinary(resolvedVaultPath)` → `ArrayBuffer`
2. Load with `pdfjsLib.getDocument({ data: arrayBuffer })` (global in Obsidian/Electron).
3. Iterate all pages: render each to `OffscreenCanvas` → `toDataURL("image/jpeg", 0.85)` → strip prefix → collect base64 strings.
4. One LLM call with all page images as sequential `image_url` content parts.
5. Ask LLM to produce a unified summary across all pages.

### Excalidraw (`.excalidraw`)

1. Look for companion file: `path.replace(/\.excalidraw$/, ".excalidraw.png")`.
   - If found: treat as PNG (path 1 above).
2. Fallback: look for `path.replace(/\.excalidraw$/, ".excalidraw.svg")`.
   - If found: render SVG to canvas → JPEG → LLM call.
3. If neither companion found: emit warning, skip this embed.

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

Single call per attachment (or per PDF as one call with N images).

System prompt (short):
```
You are a precise image analyst. Describe the visual content concisely in 1-3 sentences.
Focus on: structure, key elements, relationships, text visible in the image.
Reply in Russian if the surrounding note is in Russian, otherwise in English.
```

User message: image content parts only (no extra text).

Not streamed — awaited as a single non-streaming call for simplicity.

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
| Settings UI component | Add Vision section |

---

## Out of Scope

- Caching of descriptions across runs (future: check if `[Vision]` already present — handled by idempotent insert).
- Separate API endpoint for vision model.
- GIF / video attachments.
- Automatic re-analysis when attachment file changes.
