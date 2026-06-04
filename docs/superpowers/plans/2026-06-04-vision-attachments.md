---
review:
  plan_hash: 019bdc3a03f266cf
  spec_hash: 56973777a9ed0eed
  last_run: 2026-06-04
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Task 3"
      section_hash: b7112a398ddd25be
      text: >
        Plan omits warning event for unknown extension. Spec §Unknown extension:
        "log a warning event: { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] }".
        Plan line 423: `// Unknown extension — skip silently` — no event yielded.
        Self-Review table maps this to Task 4 (tests only), but neither task implements event emission.
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Task 1"
      section_hash: cd13884cc2d4d691
      text: >
        Spec §Files Changed: `src/settings.ts | Add vision type and defaults`.
        Plan File Map and Task 1 use `src/types.ts` instead. File mismatch.
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "Task 7"
      section_hash: a8ce634cad312252
      text: >
        Plan Task 7 wraps entire Vision UI in `if (eff.backend === "native-agent")` (line 701).
        Spec §Settings has no backend restriction — "Uses the same baseUrl and apiKey as the currently selected backend."
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-004
      phase: consistency
      severity: INFO
      section: "Task 3"
      section_hash: b7112a398ddd25be
      text: >
        Spec §PDF says `toDataURL("image/jpeg", 0.85)` for OffscreenCanvas rendering.
        Plan line 355 uses `canvas.convertToBlob(...)`. OffscreenCanvas lacks toDataURL —
        convertToBlob is the correct API, but plan deviates from spec text.
      verdict: fixed
      verdict_at: 2026-06-04
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-04-vision-attachments-design.md
---

# Vision Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vision-LLM analysis of embedded attachments (PNG/JPEG/WebP, PDF, Excalidraw) as an opt-in pre-step in the Format operation.

**Architecture:** A new `attachment-analyzer.ts` module handles all attachment logic. `VaultTools` gets `readBinary`. `runFormat` receives `visionSettings` and runs the pre-step before building the LLM prompt. Settings UI adds a toggle + model field.

**Tech Stack:** TypeScript, `@excalidraw/utils`, global `pdfjsLib` (Obsidian/Electron), OpenAI-compatible chat completions API (non-streaming), Vitest for tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `vision` field to `LlmWikiPluginSettings` and `DEFAULT_SETTINGS` |
| `src/vault-tools.ts` | Modify | Add `readBinary` to `VaultAdapter` interface and `VaultTools` class |
| `src/phases/attachment-analyzer.ts` | Create | All attachment analysis logic |
| `src/phases/format.ts` | Modify | Call vision pre-step when `visionSettings.enabled` |
| `src/agent-runner.ts` | Modify | Pass `this.settings.vision` to `runFormat` |
| `src/settings.ts` | Modify | Add Vision section UI (toggle + model field) |
| `package.json` | Modify | Add `@excalidraw/utils` dependency |
| `tests/attachment-analyzer.test.ts` | Create | Unit tests for all analyzer functions |
| `tests/vault-tools-binary.test.ts` | Create | Unit tests for `readBinary` |

---

### Task 1: Add `vision` settings type and defaults

**Files:**
- Modify: `src/types.ts:144-200` (LlmWikiPluginSettings + DEFAULT_SETTINGS)

- [ ] **Step 1: Add `vision` to `LlmWikiPluginSettings` interface**

In `src/types.ts`, add inside `LlmWikiPluginSettings` after the `lintOptions` block:

```typescript
  vision: {
    enabled: boolean;
    model: string;
  };
```

- [ ] **Step 2: Add default value to `DEFAULT_SETTINGS`**

In `src/types.ts`, add inside `DEFAULT_SETTINGS` after `lintOptions`:

```typescript
  vision: {
    enabled: false,
    model: "",
  },
```

- [ ] **Step 3: Build to verify TypeScript compiles**

Run: `npm run build 2>&1 | head -30`
Expected: no errors about `vision`

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(vision): add vision settings type and defaults"
```

---

### Task 2: Add `readBinary` to `VaultTools`

**Files:**
- Modify: `src/vault-tools.ts`
- Create: `tests/vault-tools-binary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/vault-tools-binary.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

function makeAdapter(withBinary = true): VaultAdapter {
  const base: VaultAdapter = {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
  if (withBinary) {
    (base as VaultAdapter & { readBinary: unknown }).readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(4));
  }
  return base;
}

describe("VaultTools.readBinary", () => {
  it("delegates to adapter.readBinary", async () => {
    const buf = new ArrayBuffer(4);
    const adapter = makeAdapter(true);
    (adapter as VaultAdapter & { readBinary: ReturnType<typeof vi.fn> }).readBinary.mockResolvedValue(buf);
    const tools = new VaultTools(adapter, "/vault");
    const result = await tools.readBinary("img.png");
    expect((adapter as VaultAdapter & { readBinary: ReturnType<typeof vi.fn> }).readBinary).toHaveBeenCalledWith("img.png");
    expect(result).toBe(buf);
  });

  it("throws when adapter has no readBinary", async () => {
    const adapter = makeAdapter(false);
    const tools = new VaultTools(adapter, "/vault");
    await expect(tools.readBinary("img.png")).rejects.toThrow("readBinary not supported");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run tests/vault-tools-binary.test.ts 2>&1 | tail -20`
Expected: FAIL — `tools.readBinary is not a function` or similar

- [ ] **Step 3: Add `readBinary` to `VaultAdapter` interface**

In `src/vault-tools.ts`, add to the `VaultAdapter` interface after `rmdir?`:

```typescript
  readBinary?(path: string): Promise<ArrayBuffer>;
```

- [ ] **Step 4: Add `readBinary` to `VaultTools` class**

In `src/vault-tools.ts`, add after the `exists` method:

```typescript
  async readBinary(vaultPath: string): Promise<ArrayBuffer> {
    if (!this.adapter.readBinary) throw new Error("readBinary not supported by this adapter");
    return this.adapter.readBinary(vaultPath);
  }
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npx vitest run tests/vault-tools-binary.test.ts 2>&1 | tail -10`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/vault-tools.ts tests/vault-tools-binary.test.ts
git commit -m "feat(vision): add readBinary to VaultAdapter and VaultTools"
```

---

### Task 3: Create `attachment-analyzer.ts` — pure functions

**Files:**
- Create: `src/phases/attachment-analyzer.ts`
- Create: `tests/attachment-analyzer.test.ts`

- [ ] **Step 1: Write failing tests for `extractObsidianEmbedPaths` and `insertDescriptions`**

Create `tests/attachment-analyzer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  extractObsidianEmbedPaths,
  insertDescriptions,
} from "../src/phases/attachment-analyzer";

describe("extractObsidianEmbedPaths", () => {
  it("returns empty array for plain text", () => {
    expect(extractObsidianEmbedPaths("no embeds here")).toEqual([]);
  });

  it("extracts single PNG embed", () => {
    expect(extractObsidianEmbedPaths("![[image.png]]")).toEqual(["image.png"]);
  });

  it("extracts multiple embeds", () => {
    const md = "# Title\n![[a.png]]\nText\n![[b.pdf]]\n![[c.excalidraw]]";
    expect(extractObsidianEmbedPaths(md)).toEqual(["a.png", "b.pdf", "c.excalidraw"]);
  });

  it("ignores standard markdown images", () => {
    expect(extractObsidianEmbedPaths("![alt](image.png)")).toEqual([]);
  });

  it("ignores wiki links without !", () => {
    expect(extractObsidianEmbedPaths("[[note.md]]")).toEqual([]);
  });

  it("trims whitespace in embed path", () => {
    expect(extractObsidianEmbedPaths("![[ image.png ]]")).toEqual(["image.png"]);
  });
});

describe("insertDescriptions", () => {
  it("inserts description immediately after embed line", () => {
    const md = "![[img.png]]\nNext line";
    const descriptions = new Map([["img.png", "A red circle."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("![[img.png]]\n> *[Vision] A red circle.*\nNext line");
  });

  it("is idempotent — skips embed that already has [Vision] marker", () => {
    const md = "![[img.png]]\n> *[Vision] Already described.*\nNext line";
    const descriptions = new Map([["img.png", "New description."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });

  it("skips embed with no matching description", () => {
    const md = "![[unknown.png]]";
    const result = insertDescriptions(md, new Map());
    expect(result).toBe(md);
  });

  it("handles embed at end of file with no trailing newline", () => {
    const md = "Text\n![[img.png]]";
    const descriptions = new Map([["img.png", "A square."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("Text\n![[img.png]]\n> *[Vision] A square.*");
  });

  it("skips empty-line separator before [Vision] marker", () => {
    const md = "![[img.png]]\n\n> *[Vision] Already here.*";
    const descriptions = new Map([["img.png", "New."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `npx vitest run tests/attachment-analyzer.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `extractObsidianEmbedPaths` and `insertDescriptions`**

Create `src/phases/attachment-analyzer.ts`:

```typescript
import type { VaultTools } from "../vault-tools";
import type { LlmClient } from "../types";
import type OpenAI from "openai";

export function extractObsidianEmbedPaths(md: string): string[] {
  const paths: string[] = [];
  for (const m of md.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    paths.push(m[1].trim());
  }
  return paths;
}

export function insertDescriptions(md: string, descriptions: Map<string, string>): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const embedMatch = lines[i].match(/^!\[\[([^\]]+)\]\]/);
    if (!embedMatch) continue;
    const path = embedMatch[1].trim();
    if (!descriptions.has(path)) continue;
    // Check if next non-empty line already has [Vision] marker
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "") { nextNonEmpty = lines[j]; break; }
    }
    if (nextNonEmpty.startsWith("> *[Vision]")) continue;
    out.push(`> *[Vision] ${descriptions.get(path)!}*`);
  }
  return out.join("\n");
}

// Internal helpers — exported for testing
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function getMimeType(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return null;
  }
}

async function callVisionLlm(
  llm: LlmClient,
  model: string,
  systemPrompt: string,
  contentParts: OpenAI.Chat.ChatCompletionContentPart[],
  signal: AbortSignal,
): Promise<string> {
  const resp = await llm.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts },
    ],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
  return (resp as OpenAI.Chat.ChatCompletion).choices[0]?.message?.content ?? "";
}

const IMAGE_SYSTEM = "You are a precise image analyst. Describe the visual content in 1-3 sentences.\nFocus on: structure, key elements, relationships, any text visible in the image.\nReply in Russian if the note is in Russian, otherwise in English.";

const PDF_SYSTEM = "You are a precise document analyst. Summarize this multi-page document.\nCover: main topic, key sections, structure, important data or conclusions.\nBe comprehensive but concise — up to 10 sentences.\nReply in Russian if the note is in Russian, otherwise in English.";

export async function analyzeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const b64 = arrayBufferToBase64(buffer);
  return callVisionLlm(llm, model, IMAGE_SYSTEM, [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
  ], signal);
}

interface PdfjsLib {
  getDocument(opts: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getViewport(opts: { scale: number }): { width: number; height: number }; render(ctx: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } }> }> };
}

export async function analyzePdf(
  buffer: ArrayBuffer,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const pdfjs = (globalThis as unknown as { pdfjsLib?: PdfjsLib }).pdfjsLib;
  if (!pdfjs) throw new Error("pdfjsLib unavailable");

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const pageBuf = await blob.arrayBuffer();
    const b64 = arrayBufferToBase64(pageBuf);
    parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }

  return callVisionLlm(llm, model, PDF_SYSTEM, parts, signal);
}

export async function analyzeExcalidraw(
  text: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const { exportToBlob } = await import("@excalidraw/utils");
  const { elements, appState, files } = JSON.parse(text) as {
    elements: unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };
  const blob = await exportToBlob({
    elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
    appState,
    files: files as Parameters<typeof exportToBlob>[0]["files"],
    mimeType: "image/png",
    exportPadding: 10,
  });
  const buf = await blob.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  return callVisionLlm(llm, model, IMAGE_SYSTEM, [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
  ], signal);
}

export async function analyzeAttachments(
  embedPaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (const path of embedPaths) {
    if (signal.aborted) break;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    try {
      if (ext === "excalidraw") {
        const text = await vaultTools.read(path);
        result.set(path, await analyzeExcalidraw(text, llm, model, signal));
        continue;
      }

      if (ext === "pdf") {
        const buf = await vaultTools.readBinary(path);
        result.set(path, await analyzePdf(buf, llm, model, signal));
        continue;
      }

      const mimeType = getMimeType(path);
      if (mimeType) {
        const buf = await vaultTools.readBinary(path);
        result.set(path, await analyzeImage(buf, mimeType, llm, model, signal));
        continue;
      }

      // Unknown extension — skip; caller (runFormat) emits warning event
    } catch {
      // Per-attachment failure — skip, don't block format
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run tests/attachment-analyzer.test.ts 2>&1 | tail -15`
Expected: PASS (all tests for pure functions)

- [ ] **Step 5: Commit**

```bash
git add src/phases/attachment-analyzer.ts tests/attachment-analyzer.test.ts
git commit -m "feat(vision): add attachment-analyzer with extract/insert/analyze"
```

---

### Task 4: Add `analyzeImage` and unknown-extension tests

**Files:**
- Modify: `tests/attachment-analyzer.test.ts`

- [ ] **Step 1: Add `analyzeImage` and `analyzeAttachments` tests to the test file**

Append to `tests/attachment-analyzer.test.ts`:

```typescript
import { analyzeImage, analyzeAttachments, getMimeType } from "../src/phases/attachment-analyzer";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient } from "../src/types";

function makeLlm(content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeVaultTools(binaryData: Record<string, ArrayBuffer> = {}, textData: Record<string, string> = {}): VaultTools {
  const adapter: VaultAdapter & { readBinary: ReturnType<typeof vi.fn> } = {
    read: vi.fn().mockImplementation(async (p: string) => textData[p] ?? ""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readBinary: vi.fn().mockImplementation(async (p: string) => {
      if (p in binaryData) return binaryData[p];
      throw new Error(`not found: ${p}`);
    }),
  };
  return new VaultTools(adapter, "/vault");
}

describe("getMimeType", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.webp", "image/webp"],
    ["doc.pdf", null],
    ["draw.excalidraw", null],
    ["note.md", null],
  ])("%s → %s", (path, expected) => {
    expect(getMimeType(path)).toBe(expected);
  });
});

describe("analyzeImage", () => {
  it("calls LLM with base64 data URL and returns description", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const llm = makeLlm("A blue rectangle.");
    const result = await analyzeImage(buf, "image/png", llm, "gpt-4o-mini", new AbortController().signal);
    expect(result).toBe("A blue rectangle.");
    const call = (llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.stream).toBe(false);
    const userContent = call.messages[1].content[0];
    expect(userContent.type).toBe("image_url");
    expect(userContent.image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("analyzeAttachments", () => {
  it("returns description for PNG embed", async () => {
    const buf = new Uint8Array([1]).buffer;
    const vaultTools = makeVaultTools({ "photo.png": buf });
    const llm = makeLlm("A circle.");
    const result = await analyzeAttachments(["photo.png"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("photo.png")).toBe("A circle.");
  });

  it("skips unknown extension, emits no entry", async () => {
    const vaultTools = makeVaultTools();
    const llm = makeLlm("unused");
    const result = await analyzeAttachments(["video.mp4"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("video.mp4")).toBe(false);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("skips attachment when readBinary throws (file not found)", async () => {
    const vaultTools = makeVaultTools({});  // empty — readBinary throws for any path
    const llm = makeLlm("should not be called");
    const result = await analyzeAttachments(["missing.png"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("missing.png")).toBe(false);
  });

  it("processes multiple embeds sequentially", async () => {
    const buf = new Uint8Array([1]).buffer;
    const vaultTools = makeVaultTools({ "a.png": buf, "b.jpg": buf });
    const llm = {
      chat: {
        completions: {
          create: vi.fn()
            .mockResolvedValueOnce({ choices: [{ message: { content: "First." } }] })
            .mockResolvedValueOnce({ choices: [{ message: { content: "Second." } }] }),
        },
      },
    } as unknown as LlmClient;
    const result = await analyzeAttachments(["a.png", "b.jpg"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("a.png")).toBe("First.");
    expect(result.get("b.jpg")).toBe("Second.");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/attachment-analyzer.test.ts 2>&1 | tail -20`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add tests/attachment-analyzer.test.ts
git commit -m "test(vision): add analyzeImage and analyzeAttachments unit tests"
```

---

### Task 5: Integrate vision pre-step into `runFormat`

**Files:**
- Modify: `src/phases/format.ts:50-62` (function signature and body)

- [ ] **Step 1: Add `visionSettings` parameter to `runFormat`**

In `src/phases/format.ts`, change the `runFormat` signature — add the parameter after `wikiLinkValidationRetries`:

```typescript
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
  wikiVaultPath?: string,
  wikiLinkValidationRetries: number = 3,
  visionSettings: { enabled: boolean; model: string } = { enabled: false, model: "" },
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Add import for attachment-analyzer at top of `format.ts`**

Add after the existing imports in `src/phases/format.ts`:

```typescript
import { extractObsidianEmbedPaths, analyzeAttachments, insertDescriptions } from "./attachment-analyzer";
```

- [ ] **Step 3: Add vision pre-step in `runFormat` body**

In `src/phases/format.ts`, after `original` is set (after the `yield { kind: "tool_result", ok: true, preview: ... }` line at ~line 95) and before `const systemContent = render(...)`, insert:

```typescript
  if (visionSettings.enabled && visionSettings.model) {
    const embedPaths = extractObsidianEmbedPaths(original);
    if (embedPaths.length > 0) {
      yield { kind: "assistant_text", delta: `Анализ вложений (${embedPaths.length})...\n` };
      try {
        const descriptions = await analyzeAttachments(embedPaths, vaultTools, llm, visionSettings.model, signal);
        for (const path of embedPaths) {
          if (!descriptions.has(path)) {
            yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
          }
        }
        const enriched = insertDescriptions(original, descriptions);
        if (enriched !== original) {
          await vaultTools.write(filePath, enriched);
          original = enriched;
        }
      } catch {
        // Vision pre-step failure must not block format
      }
    }
  }
```

- [ ] **Step 4: Build to verify no TypeScript errors**

Run: `npm run build 2>&1 | head -30`
Expected: no errors

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/phases/format.ts
git commit -m "feat(vision): add vision pre-step to runFormat"
```

---

### Task 6: Pass `visionSettings` from `AgentRunner` to `runFormat`

**Files:**
- Modify: `src/agent-runner.ts:118-123`

- [ ] **Step 1: Update the format case in `runOperation`**

In `src/agent-runner.ts`, find the `case "format":` block (lines ~118-123) and replace with:

```typescript
      case "format": {
        const hasVision = this.settings.backend === "claude-agent";
        const formatDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
        const visionSettings = this.settings.vision ?? { enabled: false, model: "" };
        yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, this.settings.wikiLinkValidationRetries, visionSettings);
        break;
      }
```

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Run tests**

Run: `npx vitest run 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(vision): pass visionSettings from AgentRunner to runFormat"
```

---

### Task 7: Add Vision section to Settings UI

**Files:**
- Modify: `src/settings.ts` (add Vision section after the backend block, before Graph settings at line ~651)

- [ ] **Step 1: Add Vision UI section in `render()`**

In `src/settings.ts`, after the backend block ends (around line 650, before `// ── Graph settings ──`) and before the Graph heading, insert:

```typescript
    // ── Vision settings ─────────────────────────────────────────────────────
    new Setting(containerEl).setName("Vision").setHeading();

    new Setting(containerEl)
      .setName("Enable vision analysis")
      .setDesc("Analyse embedded images, PDFs, and Excalidraw files before formatting. Uses the same baseUrl and API key as the main backend.")
      .addToggle((t) =>
        t.setValue(s.vision.enabled)
          .onChange(async (v) => {
            s.vision.enabled = v;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (s.vision.enabled) {
      this.addModelControl(
        new Setting(containerEl)
          .setName("Vision model")
          .setDesc("Model name for vision calls, e.g. gpt-4o-mini or claude-3-haiku-20240307"),
        this._chatModels,
        s.vision.model,
        async (v) => { s.vision.model = v; await this.plugin.saveSettings(); },
      );
    }
```

- [ ] **Step 2: Build and run tests**

Run: `npm run build 2>&1 | head -20 && npx vitest run 2>&1 | tail -10`
Expected: no errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat(vision): add Vision section to settings UI"
```

---

### Task 8: Add `@excalidraw/utils` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `npm install @excalidraw/utils 2>&1 | tail -5`
Expected: package added to `node_modules` and `package.json`

- [ ] **Step 2: Verify `@excalidraw/utils` exports `exportToBlob`**

Run: `node -e "const { exportToBlob } = require('@excalidraw/utils'); console.log(typeof exportToBlob)" 2>&1`
Expected: `function`

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run 2>&1 | tail -15`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(vision): add @excalidraw/utils dependency"
```

---

### Task 9: Update lat.md docs

**Files:**
- Modify: `lat.md/operations.md` (Format section)
- Run: `lat check` to validate

- [ ] **Step 1: Update Format section in `lat.md/operations.md`**

Find the Format section (around line with "Reformats a non-wiki markdown page") and append:

```markdown
When `vision.enabled` is true and `vision.model` is set, a pre-step runs before the LLM prompt: detects `![[...]]` embeds, calls the vision model for each (PNG/JPEG/WebP/PDF/Excalidraw), and inserts `> *[Vision] description*` markers under each embed. The enriched text is written back before format proceeds. See [[src/phases/attachment-analyzer.ts]].
```

- [ ] **Step 2: Run `lat check`**

Run: `lat check 2>&1 | tail -20`
Expected: no errors (or fix any broken refs)

- [ ] **Step 3: Commit**

```bash
git add lat.md/
git commit -m "docs(lat): update Format section with vision pre-step description"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `vision: { enabled, model }` settings type | Task 1 |
| Toggle + model field UI | Task 7 |
| `readBinary` on VaultTools | Task 2 |
| `extractObsidianEmbedPaths` | Task 3 |
| `insertDescriptions` idempotent | Task 3 |
| `analyzeAttachments` dispatcher | Task 3 |
| PNG/JPEG/WebP → base64 → LLM | Task 3 |
| PDF → pdfjsLib → pages → LLM | Task 3 |
| Excalidraw → `@excalidraw/utils` → LLM | Task 3 |
| Unknown extension → skip | Task 4 |
| Vision pre-step in `runFormat` | Task 5 |
| `visionSettings` passed from `AgentRunner` | Task 6 |
| `@excalidraw/utils` in package.json | Task 8 |
| Sequential LLM calls (not parallel) | Task 3 — loop is sequential |
| Error per attachment → skip, don't block | Task 3 + Task 5 |

All spec requirements covered. ✓

### Placeholder scan

No TBD/TODO/placeholder patterns in above tasks. All code blocks complete. ✓

### Type consistency check

- `visionSettings: { enabled: boolean; model: string }` — consistent across Tasks 1, 5, 6.
- `analyzeAttachments` signature matches imports in format.ts. ✓
- `readBinary` method name consistent between VaultAdapter, VaultTools, and tests. ✓
