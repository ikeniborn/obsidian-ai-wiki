---
review:
  plan_hash: 31482e69d6902d95
  spec_hash: 67573d3cd615d6e1
  last_run: 2026-05-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Index Path Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add path and Obsidian wikilink to `_index.md` entries so LLM can locate wiki pages directly without vault scan.

**Architecture:** Minimal patch to `src/wiki-index.ts` — add optional `fullPath` param to `upsertIndexAnnotation`, update `parseIndexAnnotations` to strip path from new-format entries, update 3 callers. Backward compatible: old entries (no `|`) continue to work.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `src/wiki-index.ts` | `upsertIndexAnnotation` + `parseIndexAnnotations` |
| Modify | `tests/wiki-index.test.ts` | Add new-format tests, update existing |
| Modify | `src/phases/ingest.ts:120` | Pass `page.path` to upsert |
| Modify | `src/phases/lint.ts:184` | Pass `page.path` to upsert |
| Modify | `src/phases/lint-chat.ts:89` | Pass `page.path` to upsert |

---

## Task 1: Tests for `parseIndexAnnotations` — new format

**Files:**
- Modify: `tests/wiki-index.test.ts`

- [ ] **Step 1: Add failing tests for new format**

Append inside `describe("parseIndexAnnotations", ...)` in `tests/wiki-index.test.ts`, after the existing `it("handles annotation with colons")` test:

```typescript
it("extracts annotation from new format (pid: [[pid]] path | annotation)", () => {
  const content =
    "metadata-driven-моделирование: [[metadata-driven-моделирование]] ии/концепции/metadata-driven-моделирование.md | Подход через YAML-модели";
  const map = parseIndexAnnotations(content);
  expect(map.get("metadata-driven-моделирование")).toBe("Подход через YAML-модели");
});

it("handles annotation containing pipe character after first ' | '", () => {
  const content = "Page: [[Page]] domain/cat/page.md | annotation | with | pipes";
  const map = parseIndexAnnotations(content);
  expect(map.get("Page")).toBe("annotation | with | pipes");
});

it("old format entries still work alongside new format entries", () => {
  const content = [
    "OldPage: старая аннотация",
    "NewPage: [[NewPage]] domain/cat/new-page.md | новая аннотация",
  ].join("\n");
  const map = parseIndexAnnotations(content);
  expect(map.get("OldPage")).toBe("старая аннотация");
  expect(map.get("NewPage")).toBe("новая аннотация");
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: `parseIndexAnnotations` new-format tests FAIL (`"[[metadata-driven-моделирование]] ии/...` returned instead of `"Подход через YAML-модели"`).

---

## Task 2: Implement `parseIndexAnnotations` — new format

**Files:**
- Modify: `src/wiki-index.ts`

- [ ] **Step 1: Update `parseIndexAnnotations`**

Replace the current `parseIndexAnnotations` function body (lines 3–13) in `src/wiki-index.ts`:

```typescript
export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key || !raw) continue;
    // new format: [[pid]] path/to/page.md | annotation
    const pipeIdx = raw.indexOf(" | ");
    const value = pipeIdx >= 0 ? raw.slice(pipeIdx + 3).trim() : raw;
    map.set(key, value);
  }
  return map;
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: all `parseIndexAnnotations` tests PASS (including old tests — backward compat preserved).

---

## Task 3: Tests for `upsertIndexAnnotation` — new format

**Files:**
- Modify: `tests/wiki-index.test.ts`

- [ ] **Step 1: Add failing tests for `upsertIndexAnnotation` with `fullPath`**

Append inside `describe("upsertIndexAnnotation", ...)` in `tests/wiki-index.test.ts`, after the existing `it("writes to correct path")` test:

```typescript
it("writes new format when fullPath provided", async () => {
  const { vt, written } = makeVaultTools("");
  await upsertIndexAnnotation(
    vt as unknown as VaultTools,
    "!Wiki/work",
    "NewPage",
    "описание страницы",
    "!Wiki/work/domain/cat/new-page.md",
  );
  expect(written[0]).toBe("NewPage: [[NewPage]] domain/cat/new-page.md | описание страницы");
});

it("writes old format when fullPath absent", async () => {
  const { vt, written } = makeVaultTools("");
  await upsertIndexAnnotation(
    vt as unknown as VaultTools,
    "!Wiki/work",
    "Page",
    "аннотация",
  );
  expect(written[0]).toBe("Page: аннотация");
});

it("replaces existing entry with new format", async () => {
  const { vt, written } = makeVaultTools("Page: старая аннотация");
  await upsertIndexAnnotation(
    vt as unknown as VaultTools,
    "!Wiki/work",
    "Page",
    "новая аннотация",
    "!Wiki/work/domain/cat/page.md",
  );
  expect(written[0]).toBe("Page: [[Page]] domain/cat/page.md | новая аннотация");
});

it("strips wikiFolder prefix from fullPath to produce relative path", async () => {
  const { vt, written } = makeVaultTools("");
  await upsertIndexAnnotation(
    vt as unknown as VaultTools,
    "/abs/vault",
    "MyPage",
    "desc",
    "/abs/vault/sub/folder/my-page.md",
  );
  expect(written[0]).toBe("MyPage: [[MyPage]] sub/folder/my-page.md | desc");
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: new `upsertIndexAnnotation` tests FAIL (function doesn't accept `fullPath` yet).

---

## Task 4: Implement `upsertIndexAnnotation` — new format

**Files:**
- Modify: `src/wiki-index.ts`

- [ ] **Step 1: Update `upsertIndexAnnotation`**

Replace the current `upsertIndexAnnotation` function (lines 15–33) in `src/wiki-index.ts`:

```typescript
export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
  annotation: string,
  fullPath?: string,
): Promise<void> {
  const indexPath = `${wikiFolder}/_index.md`;
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { /* first write */ }
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  let newLine: string;
  if (fullPath) {
    const prefix = wikiFolder + "/";
    const relativePath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
    newLine = `${pid}: [[${pid}]] ${relativePath} | ${annotation}`;
  } else {
    newLine = `${pid}: ${annotation}`;
  }
  if (pattern.test(content)) {
    content = content.replace(pattern, newLine);
  } else {
    content = content ? `${content}\n${newLine}` : newLine;
  }
  await vaultTools.write(indexPath, content);
}
```

- [ ] **Step 2: Run all tests — verify pass**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: all tests PASS (12+ tests, no failures).

- [ ] **Step 3: Commit `wiki-index.ts` and tests**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(wiki-index): add path and Obsidian wikilink to _index.md entries"
```

---

## Task 5: Update callers — pass `page.path`

Three callers of `upsertIndexAnnotation` need to pass `page.path` as the new `fullPath` argument. All three follow the same pattern.

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/lint-chat.ts`

- [ ] **Step 1: Update `src/phases/ingest.ts:120`**

Find the line (near line 120):
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
```

Replace with:
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
```

- [ ] **Step 2: Update `src/phases/lint.ts:184`**

Find the line (near line 184):
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
```

Replace with:
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
```

- [ ] **Step 3: Update `src/phases/lint-chat.ts:89`**

Find the line (near line 89):
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
```

Replace with:
```typescript
await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS. No TypeScript errors (signature is backward compatible — `fullPath` is optional).

- [ ] **Step 5: Build to verify no compile errors**

```bash
npm run build
```

Expected: build succeeds, `dist/main.js` updated.

- [ ] **Step 6: Commit callers**

```bash
git add src/phases/ingest.ts src/phases/lint.ts src/phases/lint-chat.ts
git commit -m "feat(phases): pass page.path to upsertIndexAnnotation for full index entries"
```

---

## Verification

After both commits, manually verify in vault:
1. Run ingest on any domain
2. Open `{wikiFolder}/_index.md`
3. Each entry should look like: `page-id: [[page-id]] domain/category/page-id.md | annotation text`
4. Click `[[page-id]]` in Obsidian — should navigate to the page
