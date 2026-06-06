---
chain:
  intent: docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md
  spec: docs/superpowers/specs/2026-06-06-excalidraw-vision-render-fix-design.md
review:
  plan_hash: 2ffa9cef8cee8526
  spec_hash: 7875098e007096df
  last_run: 2026-06-06
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Excalidraw Vision Render Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Excalidraw embeds for Vision by delegating to the host `obsidian-excalidraw-plugin` instead of importing the unresolvable `@excalidraw/utils` module.

**Architecture:** The analyzer stays decoupled from the Obsidian `app` — it asks `VaultTools.renderExcalidrawPng(resolvedPath)` for a base64 PNG, mirroring the existing `resolveLink` pattern. The real implementation lives in `controller.ts`, where it looks up the host plugin's `ExcalidrawAutomate` instance and calls `createPNGBase64` / `createPNG`. Missing plugin, mobile, or any render error → `null` → Vision skipped, never crashes.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, vitest.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/vault-tools.ts` | Modify | Add `renderExcalidrawPng` to `VaultAdapter` (optional) + `VaultTools` (passthrough). |
| `src/phases/attachment-analyzer.ts` | Modify | `analyzeExcalidraw` takes base64 PNG; excalidraw branch calls `renderExcalidrawPng`; remove `extractExcalidrawJson` + `@excalidraw/utils` import. |
| `src/controller.ts` | Modify | Wire `adapter.renderExcalidrawPng` to the host plugin's `ExcalidrawAutomate`. |
| `esbuild.config.mjs` | Modify | Drop `@excalidraw/utils` from `external`. |
| `package.json` | Modify | Drop `@excalidraw/utils` dependency. |
| `tests/vault-tools.test.ts` | Modify | Test `renderExcalidrawPng` passthrough + null fallback. |
| `tests/attachment-analyzer.test.ts` | Modify | Drop `extractExcalidrawJson` block; add render-via-mock tests. |
| `lat.md/operations.md` | Modify | Document host-plugin render path. |
| `docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md` | Modify | Update health-metric line naming `extractExcalidrawJson`. |

---

## Task 1: `VaultTools.renderExcalidrawPng` passthrough

Add the optional adapter hook and the thin passthrough, mirroring `resolveLink` (`src/vault-tools.ts:103-105`).

**Files:**
- Modify: `src/vault-tools.ts:12` (adapter interface) and `src/vault-tools.ts:103-105` (passthrough method)
- Test: `tests/vault-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/vault-tools.test.ts`, inside the existing `describe("VaultTools", ...)` block (before its closing `});`):

```ts
  it("renderExcalidrawPng delegates to adapter and returns base64", async () => {
    const adapter = mockAdapter({
      renderExcalidrawPng: vi.fn().mockResolvedValue("BASE64PNG"),
    });
    const vt = new VaultTools(adapter, "/vault");
    expect(await vt.renderExcalidrawPng("draw.excalidraw")).toBe("BASE64PNG");
    expect(adapter.renderExcalidrawPng).toHaveBeenCalledWith("draw.excalidraw");
  });

  it("renderExcalidrawPng returns null when adapter lacks the hook", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    expect(await vt.renderExcalidrawPng("draw.excalidraw")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/vault-tools.test.ts -t renderExcalidrawPng`
Expected: FAIL — `vt.renderExcalidrawPng is not a function`.

- [ ] **Step 3: Add the adapter interface field**

In `src/vault-tools.ts`, add to the `VaultAdapter` interface immediately after the `resolveLink?` line (currently line 12):

```ts
  /** Render an Excalidraw file (by resolved vault path) to a base64 PNG; null if unavailable. */
  renderExcalidrawPng?(resolvedPath: string): Promise<string | null>;
```

- [ ] **Step 4: Add the passthrough method**

In `src/vault-tools.ts`, add immediately after the `resolveLink` method (after line 105):

```ts
  /**
   * Render an Excalidraw file to a base64 PNG via the host plugin (wired in
   * controller). Returns null when no renderer is available (no host plugin,
   * mobile, or render error) — callers treat null as "Vision skipped".
   */
  async renderExcalidrawPng(resolvedPath: string): Promise<string | null> {
    return (await this.adapter.renderExcalidrawPng?.(resolvedPath)) ?? null;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/vault-tools.test.ts -t renderExcalidrawPng`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/vault-tools.ts tests/vault-tools.test.ts
git commit -m "feat(vault-tools): add renderExcalidrawPng passthrough"
```

---

## Task 2: Analyzer renders via `renderExcalidrawPng`

Change `analyzeExcalidraw` to take a base64 PNG string, route the excalidraw branch through `vaultTools.renderExcalidrawPng`, and remove `extractExcalidrawJson` plus the `@excalidraw/utils` import.

**Files:**
- Modify: `src/phases/attachment-analyzer.ts:157-192` (rewrite `analyzeExcalidraw`, delete `extractExcalidrawJson`), `src/phases/attachment-analyzer.ts:211-216` (branch)
- Test: `tests/attachment-analyzer.test.ts`

- [ ] **Step 1: Update the test file imports and mock**

In `tests/attachment-analyzer.test.ts`, remove `extractExcalidrawJson` from the import block (lines 2-9) so it reads:

```ts
import {
  extractObsidianEmbedPaths,
  insertDescriptions,
  analyzeImage,
  analyzeAttachments,
  getMimeType,
} from "../src/phases/attachment-analyzer";
```

In `makeVaultTools`, add a `renderExcalidrawPng` mock to the adapter object (after the `resolveLink` line, currently line 101):

```ts
    // Default: no excalidraw renderer wired (host plugin absent).
    renderExcalidrawPng: vi.fn().mockResolvedValue(null),
```

- [ ] **Step 2: Replace the `extractExcalidrawJson` describe block with render tests**

In `tests/attachment-analyzer.test.ts`, delete the entire `describe("extractExcalidrawJson", ...)` block (lines 188-213) and replace it with:

```ts
describe("analyzeAttachments — excalidraw", () => {
  it("renders excalidraw via host plugin and returns Vision description", async () => {
    const vaultTools = makeVaultTools();
    (vaultTools.adapter.renderExcalidrawPng as ReturnType<typeof vi.fn>)
      .mockResolvedValue("RENDEREDB64");
    const llm = makeLlm("A flowchart.");
    const result = await analyzeAttachments(["draw.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("draw.excalidraw")).toBe("A flowchart.");
    const call = (llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userContent = call.messages[1].content[0];
    expect(userContent.type).toBe("image_url");
    expect(userContent.image_url.url).toBe("data:image/png;base64,RENDEREDB64");
  });

  it("skips excalidraw when renderer returns null (no host plugin)", async () => {
    const vaultTools = makeVaultTools();  // renderExcalidrawPng defaults to null
    const llm = makeLlm("should not be called");
    const result = await analyzeAttachments(["draw.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("draw.excalidraw")).toBe(false);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: FAIL — `analyzeExcalidraw` still calls `@excalidraw/utils`/parses JSON, so the excalidraw render test's Vision call assertions fail (or the analyzer reads file text instead of calling `renderExcalidrawPng`).

- [ ] **Step 4: Rewrite `analyzeExcalidraw` to take base64 PNG**

In `src/phases/attachment-analyzer.ts`, replace the whole `analyzeExcalidraw` function (lines 157-182) with:

```ts
export async function analyzeExcalidraw(
  b64: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: VisionLanguage = "auto",
): Promise<string> {
  return callVisionLlm(llm, model, imageSystem(language), [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
  ], signal);
}
```

- [ ] **Step 5: Delete `extractExcalidrawJson`**

In `src/phases/attachment-analyzer.ts`, delete the entire `extractExcalidrawJson` function (lines 184-192, including the preceding blank line).

- [ ] **Step 6: Rewrite the excalidraw branch**

In `src/phases/attachment-analyzer.ts`, replace the excalidraw branch (lines 211-216):

```ts
  if (isExcalidraw) {
    const text = await vaultTools.read(resolved);
    const jsonText = extractExcalidrawJson(text);
    if (!jsonText) return null;
    return analyzeExcalidraw(jsonText, llm, model, signal, language);
  }
```

with:

```ts
  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;            // no host plugin / render failed → skip
    return analyzeExcalidraw(b64, llm, model, signal, language);
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: PASS (all blocks, including the two new excalidraw tests).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — no remaining references to `extractExcalidrawJson` or `@excalidraw/utils` anywhere in tests.

- [ ] **Step 9: Commit**

```bash
git add src/phases/attachment-analyzer.ts tests/attachment-analyzer.test.ts
git commit -m "feat(vision): render excalidraw via renderExcalidrawPng, drop JSON parse"
```

---

## Task 3: Wire `renderExcalidrawPng` to the host plugin in controller

Add `adapter.renderExcalidrawPng` next to `adapter.resolveLink` in `buildAgentRunner`. This is integration code against the live Obsidian `app` and the host plugin — not unit-testable here; verified by `npm run lint`, `npm run build`, and manual Obsidian check.

**Files:**
- Modify: `src/controller.ts:431-433` (add after the `resolveLink` assignment)
- Modify: `src/controller.ts:9` (import `arrayBufferToBase64`)

- [ ] **Step 1: Import `arrayBufferToBase64`**

In `src/controller.ts`, add this import after the existing `VaultTools` import (line 9):

```ts
import { arrayBufferToBase64 } from "./phases/attachment-analyzer";
```

- [ ] **Step 2: Add the local EA interface above the class or near the top of the file**

In `src/controller.ts`, add this interface immediately after the imports block (after line 26, before `function patchWikiFields`):

```ts
/** Minimal surface of the host obsidian-excalidraw-plugin's ExcalidrawAutomate. */
interface ExcalidrawAutomateLike {
  reset(): void;
  createPNGBase64?(templatePath: string): Promise<string>;
  createPNG?(templatePath: string): Promise<Blob>;
}
interface ExcalidrawHostPlugin {
  ea?: ExcalidrawAutomateLike;
}
```

- [ ] **Step 3: Add the `renderExcalidrawPng` adapter assignment**

In `src/controller.ts`, add immediately after the `adapter.resolveLink = ...` block (after line 433):

```ts
    adapter.renderExcalidrawPng = async (resolvedPath: string): Promise<string | null> => {
      // Desktop-only: host plugin renders via DOM/canvas, unavailable on mobile.
      if (Platform.isMobile) return null;
      try {
        const host = (this.app as unknown as {
          plugins?: { plugins?: Record<string, ExcalidrawHostPlugin | undefined> };
        }).plugins?.plugins?.["obsidian-excalidraw-plugin"];
        const ea = host?.ea;
        if (!ea) return null;
        ea.reset();  // isolate from any prior template state
        if (ea.createPNGBase64) {
          return await ea.createPNGBase64(resolvedPath);
        }
        if (ea.createPNG) {
          const blob = await ea.createPNG(resolvedPath);
          return arrayBufferToBase64(await blob.arrayBuffer());
        }
        return null;
      } catch {
        return null;  // any render error → Vision skipped
      }
    };
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS — no `no-explicit-any` / unused-var errors (the `as unknown as {...}` cast and `ExcalidrawAutomateLike` types satisfy the local eslint pipeline; see `lint-before-release` memory — node builtins stay lazy, but no node builtins are added here).

- [ ] **Step 5: Build to confirm bundle does not regress**

Run: `npm run build`
Expected: PASS. `dist/main.js` stays ~2M (no `@excalidraw/utils` library inflation — that removal happens in Task 4; this step just confirms the controller change compiles and bundles).

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): wire renderExcalidrawPng to host excalidraw plugin"
```

---

## Task 4: Remove the `@excalidraw/utils` dependency

Drop the now-unused external module from the build config and package manifest.

**Files:**
- Modify: `esbuild.config.mjs:9`
- Modify: `package.json:27`

- [ ] **Step 1: Remove from esbuild externals**

In `esbuild.config.mjs`, change line 9 from:

```js
  external: ["obsidian", "electron", "child_process", "node:readline", "@excalidraw/utils"],
```

to:

```js
  external: ["obsidian", "electron", "child_process", "node:readline"],
```

- [ ] **Step 2: Remove from package.json dependencies**

In `package.json`, delete the line (currently line 27):

```json
    "@excalidraw/utils": "^0.1.3-test32",
```

Ensure the preceding dependency line's trailing comma is still valid JSON (no dangling comma if it was the last entry — check the surrounding object).

- [ ] **Step 3: Reinstall to update the lockfile**

Run: `npm install`
Expected: completes; `package-lock.json` updates to drop `@excalidraw/utils`.

- [ ] **Step 4: Verify no source references remain**

Run: `grep -rn "@excalidraw/utils\|exportToBlob\|extractExcalidrawJson" src/ tests/`
Expected: no output (empty).

- [ ] **Step 5: Build and test**

Run: `npm run build && npm test`
Expected: PASS. `dist/main.js` stays ~2M.

- [ ] **Step 6: Commit**

```bash
git add esbuild.config.mjs package.json package-lock.json
git commit -m "chore: drop @excalidraw/utils dependency"
```

---

## Task 5: Update docs and intent, run `lat check`

Update the lat.md vision section and the intent's health-metric line, then validate links.

**Files:**
- Modify: `lat.md/operations.md:200` (Format section vision paragraph)
- Modify: `docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md:22`

- [ ] **Step 1: Update the lat.md vision paragraph**

In `lat.md/operations.md`, replace the vision paragraph (line 200, the one starting `When \`vision.enabled\``) — append a sentence describing the render path. New paragraph:

```markdown
When `vision.enabled` and `vision.model` are set, a pre-step analyzes embedded images, PDFs, and Excalidraw files. Excalidraw embeds are rendered to PNG by the host `obsidian-excalidraw-plugin` via `ExcalidrawAutomate` (no `@excalidraw/utils` dependency); when the host plugin is absent or on mobile, the embed is skipped. Each attachment emits `tool_use`/`tool_result` events for sidebar progress. Descriptions are inserted into the formatted output only — the source file is never modified. Language is controlled by `vision.language` (`auto`/`ru`/`en`/`es`). Vision events are logged to `_agent.jsonl`. See [[src/phases/attachment-analyzer.ts]].
```

- [ ] **Step 2: Update the intent health-metric line**

In `docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md`, change line 22 from:

```
- Existing tests stay green (`extractExcalidrawJson`, attachment routing,
```

to (drop the now-removed `extractExcalidrawJson`):

```
- Existing tests stay green (attachment routing,
```

Verify the rest of that bullet still reads correctly after the edit; adjust wording only if the sentence is now broken.

- [ ] **Step 3: Run lat check**

Run: `lat check`
Expected: PASS — all wiki links and code refs resolve (`[[src/phases/attachment-analyzer.ts]]` still valid; no dangling reference to the removed `extractExcalidrawJson`).

- [ ] **Step 4: Commit**

```bash
git add lat.md/operations.md docs/superpowers/intents/2026-06-06-excalidraw-vision-render-fix-intent.md
git commit -m "docs: render excalidraw via host plugin; drop extractExcalidrawJson refs"
```

---

## Final Verification

- [ ] **Step 1: Full green gate**

Run: `npm run lint && npm test && lat check`
Expected: all three PASS.

- [ ] **Step 2: Bundle size sanity**

Run: `npm run build && ls -la dist/main.js`
Expected: build succeeds, `dist/main.js` ~2M (no library inflation).

- [ ] **Step 3: Manual Obsidian check (human, outside autonomy)**

In a live Obsidian vault with `obsidian-excalidraw-plugin` installed and a real `.excalidraw` / `.excalidraw.md` file embedded via `![[draw.excalidraw]]`, run Format with vision enabled. Expect a Vision `tool_result ok` and a `> *[Vision] ...*` description for the drawing. Confirm image/PDF embeds and no-host-plugin behavior are unchanged.
