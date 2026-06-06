---
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-06-excalidraw-vision-diagram-description-design.md
review:
  plan_hash: 3c3bce76b95ab514
  spec_hash: b3054455d764fd25
  last_run: 2026-06-06
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Excalidraw Vision Diagram Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vision emit a prose description *plus* a mermaid recreation for diagram embeds (Excalidraw and image diagrams), instead of a bare mermaid block with no description.

**Architecture:** Three independent, isolated levers. (1) The shared `STRUCTURE_RULES` diagram rule is rewritten to require prose-then-mermaid, and its "no prose" constraint is relaxed to ban only boilerplate intros. (2) The `visionBlock` integration instruction in the formatter is tightened so the formatting LLM preserves both the description and the mermaid for diagrams. (3) The dead-path `insertDescriptions` helper is fixed to render multi-line descriptions at top level (it changes no production output, but is unit-tested for future/fallback use).

**Tech Stack:** TypeScript, esbuild, vitest, lat.md.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/phases/attachment-analyzer.ts` | Modify | Rewrite the `STRUCTURE_RULES` diagram bullet + no-prose line (lever 1); rewrite `insertDescriptions` for multi-line descriptions (lever 3). |
| `src/phases/format.ts` | Modify | Tighten the `visionBlock` instruction so the formatting LLM keeps description + mermaid for diagrams (lever 2). |
| `tests/attachment-analyzer.test.ts` | Modify | Add a diagram passthrough test (description + mermaid) and two `insertDescriptions` multi-line tests (insert shape + idempotency). |
| `lat.md/operations.md` | Modify | Note that diagram embeds yield a description + mermaid recreation. |

**Why no test for lever 2:** `visionBlock` is a prompt string consumed only by the live formatting LLM. `grep` confirms it is referenced nowhere in `tests/` — its wording is not unit-assertable. It is verified by `npm run lint`, `npm run build`, and the manual Obsidian check in the final task. This is called out so the executor does not invent a brittle "assert the prompt text" test, which the spec explicitly discourages.

---

## Task 1: `STRUCTURE_RULES` diagram rule — prose then mermaid

Rewrite the shared diagram rule so diagrams get a prose description first, then the mermaid block. This constant feeds both `imageSystem` (used by Excalidraw and image analysis) and `pdfSystem`, so one edit covers all three. Add a regression test asserting the analyzer returns the model's prose + mermaid verbatim.

**Files:**
- Modify: `src/phases/attachment-analyzer.ts:91` (diagram bullet) and `src/phases/attachment-analyzer.ts:95` (no-prose line)
- Test: `tests/attachment-analyzer.test.ts` (inside the existing `describe("analyzeAttachments — excalidraw", ...)` block)

- [ ] **Step 1: Edit the diagram bullet**

In `src/phases/attachment-analyzer.ts`, replace the diagram bullet line (currently line 91):

```
- Diagram / flow / architecture (boxes + arrows) → mermaid code block (\`\`\`mermaid ... \`\`\`).
```

with:

```
- Diagram / flow / architecture (boxes + arrows) → FIRST a short prose description (what it depicts, the key nodes and how they connect), THEN a mermaid code block (\`\`\`mermaid ... \`\`\`) recreating it.
```

(The `\`\`\`mermaid ... \`\`\`` escaping is unchanged — this constant is a backtick-delimited template literal, so the inner fence backticks stay escaped exactly as before.)

- [ ] **Step 2: Edit the no-prose line**

In `src/phases/attachment-analyzer.ts`, replace the no-prose line (currently line 95):

```
Do NOT wrap output in additional prose ("Here is...", "This image shows..."). Output ONLY the structured content.
```

with:

```
Do NOT add boilerplate intros ("Here is...", "This image shows..."). Output ONLY the requested content (diagrams: the description + mermaid; other types: the single structured form).
```

- [ ] **Step 3: Add the diagram passthrough regression test**

In `tests/attachment-analyzer.test.ts`, add this test inside the `describe("analyzeAttachments — excalidraw", ...)` block, immediately before that block's closing `});` (currently line 223):

````ts
  it("returns both prose description and mermaid for a diagram", async () => {
    const vaultTools = makeVaultTools();
    (vaultTools.adapter.renderExcalidrawPng as ReturnType<typeof vi.fn>)
      .mockResolvedValue("RENDEREDB64");
    const visionOut = "A login flow: user → auth service → database.\n\n```mermaid\nflowchart LR\n  user --> auth --> db\n```";
    const llm = makeLlm(visionOut);
    const result = await analyzeAttachments(["flow.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    const desc = result.get("flow.excalidraw")!;
    expect(desc).toContain("A login flow");
    expect(desc).toContain("```mermaid");
  });
````

This asserts the wiring + that the analyzer returns the model output verbatim (both prose and the mermaid fence survive). It does **not** assert the prompt wording — that is verified manually.

- [ ] **Step 4: Run the analyzer tests**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: PASS — all existing tests plus the new diagram passthrough test. (The mock makes this test pass regardless of the prompt edit; it guards the passthrough contract against future regressions.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS — no errors (string-only edits; see `lint-before-release` memory).

- [ ] **Step 6: Commit**

```bash
git add src/phases/attachment-analyzer.ts tests/attachment-analyzer.test.ts
git commit -m "feat(vision): diagram rule emits prose description then mermaid"
```

---

## Task 2: `visionBlock` integration instruction — keep description + mermaid

Tighten the formatter's `visionBlock` so the formatting LLM preserves **both** the prose description and the mermaid block for diagrams, instead of collapsing to mermaid-only via the looser "по форме исходника" wording. The "do NOT wrap in blockquote / do NOT add [Vision] marker / do NOT quote paths" guidance stays. No unit test (see File Structure note) — verified by lint, build, and `grep`.

**Files:**
- Modify: `src/phases/format.ts:157`

- [ ] **Step 1: Replace the `visionBlock` instruction string**

In `src/phases/format.ts`, replace the assignment on line 157:

````ts
    visionBlock = `\n---\nОПИСАНИЯ ВЛОЖЕНИЙ (vision-распознавание; интегрируй СРАЗУ ПОД соответствующей вставкой \`![[путь]]\` как структурированный markdown — таблица/список/mermaid/код по форме исходника; НЕ оборачивай в blockquote, НЕ добавляй маркер [Vision], НЕ цитируй пути):\n${items.join("\n\n")}`;
````

with:

````ts
    visionBlock = `\n---\nОПИСАНИЯ ВЛОЖЕНИЙ (vision-распознавание; интегрируй СРАЗУ ПОД соответствующей вставкой \`![[путь]]\` как структурированный markdown — таблица/список/код по форме исходника; для ДИАГРАММ сохрани оба элемента: сначала текстовое описание, затем блок \`\`\`mermaid\`\`\` — не выбрасывай ни описание, ни mermaid; НЕ оборачивай в blockquote, НЕ добавляй маркер [Vision], НЕ цитируй пути):\n${items.join("\n\n")}`;
````

(`mermaid` is removed from the `таблица/список/...` enumeration because diagrams are now handled by the explicit clause that demands description + mermaid together. The fence backticks are escaped as `\`\`\`mermaid\`\`\`` because this is a backtick-delimited template literal.)

- [ ] **Step 2: Build to confirm the template literal compiles**

Run: `npm run build`
Expected: PASS — `dist/main.js` builds (the change is a single string literal; a mismatched/unescaped backtick would fail the build here).

- [ ] **Step 3: Confirm no test depends on the old wording**

Run: `grep -rn "по форме исходника\|ОПИСАНИЯ ВЛОЖЕНИЙ" tests/`
Expected: no output (empty) — no test asserts the prompt string, so no test breaks.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts
git commit -m "feat(format): vision block keeps description + mermaid for diagrams"
```

---

## Task 3: `insertDescriptions` multi-line fix (dead path)

Fix the deterministic `insertDescriptions` helper so a multi-line description (prose + mermaid/table) is emitted with a `> *[Vision]*` marker line, a blank line, then the description at top level — so the fence/table renders instead of being trapped in a single-line blockquote. Single-line descriptions are unchanged. Idempotency is preserved because both shapes start with `> *[Vision]`. This path is never called from `src/`, so production output does not change; it is fixed and tested for future/fallback use.

**Files:**
- Modify: `src/phases/attachment-analyzer.ts:13-31` (`insertDescriptions`)
- Test: `tests/attachment-analyzer.test.ts` (inside the existing `describe("insertDescriptions", ...)` block)

- [ ] **Step 1: Write the failing tests**

In `tests/attachment-analyzer.test.ts`, add these two tests inside the `describe("insertDescriptions", ...)` block, immediately before that block's closing `});` (currently line 74):

````ts
  it("inserts multi-line description (prose + mermaid) at top level with marker line", () => {
    const md = "![[flow.excalidraw]]\nNext line";
    const desc = "A login flow.\n\n```mermaid\nflowchart LR\n  a --> b\n```";
    const descriptions = new Map([["flow.excalidraw", desc]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(
      "![[flow.excalidraw]]\n> *[Vision]*\n\nA login flow.\n\n```mermaid\nflowchart LR\n  a --> b\n```\nNext line",
    );
  });

  it("is idempotent for multi-line descriptions", () => {
    const md = "![[flow.excalidraw]]\nNext line";
    const desc = "A login flow.\n\n```mermaid\nflowchart LR\n  a --> b\n```";
    const descriptions = new Map([["flow.excalidraw", desc]]);
    const once = insertDescriptions(md, descriptions);
    const twice = insertDescriptions(once, descriptions);
    expect(twice).toBe(once);
  });
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/attachment-analyzer.test.ts -t insertDescriptions`
Expected: FAIL on the first new test — the current code wraps the whole multi-line string as `> *[Vision] A login flow.\n\n```mermaid...````*`, so the result will not equal the expected top-level shape. (The idempotency test may pass already, but the insert-shape test fails.)

- [ ] **Step 3: Rewrite `insertDescriptions`**

In `src/phases/attachment-analyzer.ts`, replace the whole `insertDescriptions` function (currently lines 13-31):

```ts
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
```

with:

```ts
export function insertDescriptions(md: string, descriptions: Map<string, string>): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const embedMatch = lines[i].match(/^!\[\[([^\]]+)\]\]/);
    if (!embedMatch) continue;
    const path = embedMatch[1].trim();
    if (!descriptions.has(path)) continue;
    // Check if next non-empty line already has [Vision] marker (matches both the
    // single-line `> *[Vision] ...*` and the multi-line `> *[Vision]*` shapes).
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "") { nextNonEmpty = lines[j]; break; }
    }
    if (nextNonEmpty.startsWith("> *[Vision]")) continue;
    const desc = descriptions.get(path)!;
    if (desc.includes("\n")) {
      // Multi-line (prose + mermaid/table): a marker line, a blank line, then the
      // description verbatim at top level so the fence/table renders.
      out.push("> *[Vision]*");
      out.push("");
      out.push(desc);
    } else {
      out.push(`> *[Vision] ${desc}*`);
    }
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/attachment-analyzer.test.ts -t insertDescriptions`
Expected: PASS — all five `insertDescriptions` tests (the three existing single-line tests stay green, the two new multi-line tests pass).

- [ ] **Step 5: Run the full analyzer test file**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: PASS — every block green (routing, traversal, image, excalidraw, idempotency, multi-line).

- [ ] **Step 6: Commit**

```bash
git add src/phases/attachment-analyzer.ts tests/attachment-analyzer.test.ts
git commit -m "fix(vision): insertDescriptions renders multi-line descriptions at top level"
```

---

## Task 4: Docs — operations.md + `lat check`

Note in the lat.md operations doc that diagram embeds yield a prose description plus a mermaid recreation, then validate all links and code refs.

**Files:**
- Modify: `lat.md/operations.md:200` (Format section vision paragraph)

- [ ] **Step 1: Append the diagram sentence to the vision paragraph**

In `lat.md/operations.md`, in the vision paragraph (line 200), find the sentence:

```
Descriptions are inserted into the formatted output only — the source file is never modified.
```

and replace it with:

```
Descriptions are inserted into the formatted output only — the source file is never modified. Diagram embeds (Excalidraw and image diagrams) yield a short prose description followed by a `mermaid` recreation, integrated together under the embed.
```

- [ ] **Step 2: Run lat check**

Run: `lat check`
Expected: PASS — all wiki links and code refs resolve (`[[src/phases/attachment-analyzer.ts]]` still valid; no new refs introduced; leading-paragraph rules unaffected — the edit only lengthens an existing paragraph).

- [ ] **Step 3: Commit**

```bash
git add lat.md/operations.md
git commit -m "docs: vision diagrams yield description + mermaid recreation"
```

---

## Task 5: Final verification

Run the full green gate, then hand off the manual Obsidian check (outside autonomy).

- [ ] **Step 1: Full green gate**

Run: `npm run lint && npm test && lat check`
Expected: all three PASS.

- [ ] **Step 2: Confirm non-diagram behavior is untouched**

Run: `npx vitest run tests/attachment-analyzer.test.ts`
Expected: PASS — the image, PDF-routing, unknown-extension, traversal, and single-line `insertDescriptions` tests are all still green, confirming tables/photos/code and single-line descriptions are unaffected.

- [ ] **Step 3: Manual Obsidian check (human, outside autonomy)**

In a live Obsidian vault with `obsidian-excalidraw-plugin` installed, embed a real diagram via `![[draw.excalidraw]]` (or an image diagram via `![[diagram.png]]`) and run Format with vision enabled. Expect the integrated output under the embed to contain a short prose description **followed by** a ` ```mermaid ` block — not a bare mermaid block, and not wrapped in a `> *[Vision]*` blockquote. Confirm a table/photo/code embed still produces a single structured form (no spurious prose).
