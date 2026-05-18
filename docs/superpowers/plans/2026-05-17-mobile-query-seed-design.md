---
review:
  plan_hash: d6f0a5745ec7ad80
  spec_hash: f6152796d498fe2a
  last_run: 2026-05-17
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    "## File Structure": d2c09e807a4d0b6a
    "### Task 1": b2e519f78c0a7782
    "### Task 2": 36509b21a2b2ee87
    "### Task 3": 7373f3b732e485b1
    "### Task 4": 7c8daae7f02ed210
    "### Task 5": 168b06c45d7d0f8d
    "### Task 6": 750b95dfaef075ea
    "### Task 7": 6fa3ad132a9469a3
    "### Task 8": 5804314c47a42a43
    "## Self-Review": 5170edeaad905a02
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Scope (спеки)"
      section_hash: a1f6bb6a6e8146a4
      text: "init.ts явно в Scope спеки (upsertIndexAnnotation для каждой страницы), но в плане нет задачи для него — только непроверенное утверждение в Self-Review о делегировании к runIngest без теста и commit."
      verdict: accepted
      verdict_at: 2026-05-17
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "### Task 4"
      section_hash: 7c8daae7f02ed210
      text: "Step 1: тест 'calls write on _index.md with annotation after page write' имеет пустое тело (// adapt accordingly) — нет assert, нет ожидаемого вывода, тест пройдёт вакуально."
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "### Task 5"
      section_hash: 168b06c45d7d0f8d
      text: "Step 2: тест 'does not rewrite _index.md with flat links' имеет пустое тело (// Exact implementation depends...) — нет реализации, нет критерия готовности."
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-004
      phase: verifiability
      severity: WARNING
      section: "### Task 6"
      section_hash: 750b95dfaef075ea
      text: "Step 1 — шаг-исследование ('Read lint-chat.ts lines 60 onwards') без артефакта и DoD: не создаёт верифицируемого результата."
      verdict: fixed
      verdict_at: 2026-05-17
---

# Mobile Query Seed Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix mobile query timeouts by improving Jaccard seed selection (skip frontmatter, add wiki_keywords support, annotated index) so LLM seed call is skipped on ≥80% of queries.

**Architecture:** Two-layer fix — (1) `wiki-seeds.ts` now reads body text (not frontmatter) and `wiki_keywords` for Jaccard; (2) `wiki-index.ts` maintains annotated `_index.md` (`PageId: one-line description`), which all write operations upsert into and query uses to shrink the LLM fallback prompt.

**Tech Stack:** TypeScript, Vitest, `VaultTools` vault abstraction, existing `parseJsonPages` / `LintChatSchema` / `zod-schemas.ts`.

---

## File Structure

**Created:**
- `src/wiki-index.ts` — `parseIndexAnnotations`, `upsertIndexAnnotation`
- `tests/wiki-index.test.ts` — unit tests for both functions

**Modified:**
- `src/wiki-seeds.ts` — `bodyContent`, `parseFmKeywords`, updated `scoreSeed`/`selectSeeds` signatures
- `src/phases/zod-schemas.ts` — `annotation?` in `LintChatSchema.pages`
- `src/phases/ingest.ts` — `parseJsonPages` returns `annotation?`; call `upsertIndexAnnotation` per page
- `src/phases/lint.ts` — call `upsertIndexAnnotation` per fixed page; remove the full flat-link index rewrite at line 211-217
- `src/phases/lint-chat.ts` — call `upsertIndexAnnotation` per written page
- `src/phases/query.ts` — pass `indexAnnotations` to `selectSeeds`; simplify LLM seed prompt
- `prompts/ingest.md` — add `wiki_keywords` frontmatter rule + `annotation` output field
- `prompts/lint.md` — same
- `prompts/init.md` — document `wiki_keywords`/`annotation` convention for wiki pages
- `prompts/init-incremental.md` — same

**Test files modified:**
- `tests/wiki-seeds.test.ts` — new tests for frontmatter skip, wiki_keywords, annotation, updated signature tests
- `tests/phases/query.test.ts` — update call sites for new `selectSeeds` arity
- `tests/phases/ingest.test.ts` — `parseJsonPages` returns `annotation?`
- `tests/phases/lint-chat.test.ts` — `upsertIndexAnnotation` called per written page

---

### Task 1: `src/wiki-seeds.ts` — skip frontmatter + wiki_keywords + annotation

**Files:**
- Modify: `src/wiki-seeds.ts`
- Test: `tests/wiki-seeds.test.ts`

- [ ] **Step 1: Write failing tests for the new helpers and updated signatures**

Add these tests to `tests/wiki-seeds.test.ts` (after the existing `describe` blocks):

```typescript
describe("bodyContent (internal via scoreSeed)", () => {
  it("skips YAML frontmatter and reads body", () => {
    const q = tokenize("deepseek модель");
    // keyword only in body, not frontmatter
    const content = "---\nwiki_sources: []\nwiki_updated: 2026-05-01\n---\nDeepSeek языковая модель.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when keyword is only in frontmatter YAML", () => {
    const q = tokenize("wiki_sources");
    const content = "---\nwiki_sources: [note.md]\n---\nBody text here.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBe(0);
  });
});

describe("parseFmKeywords (internal via scoreSeed)", () => {
  it("boosts score via wiki_keywords in frontmatter", () => {
    const q = tokenize("deepseek инференс");
    const content = "---\nwiki_keywords: [deepseek, инференс, облако]\n---\n# Page\nКонтент.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });

  it("is case-insensitive for wiki_keywords", () => {
    const q = tokenize("DeepSeek");
    const content = "---\nwiki_keywords: [deepseek]\n---\n# Page";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });
});

describe("scoreSeed with annotation", () => {
  it("uses annotation text for scoring", () => {
    const q = tokenize("кластеризация данных");
    const content = "---\n---\n# Clustering\nAlgorithm.";
    const score = scoreSeed(q, "Clustering", content, "алгоритм кластеризации данных без учителя");
    expect(score).toBeGreaterThan(0);
  });

  it("without annotation behaves same as before for non-frontmatter content", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "alpha", "beta")).toBeCloseTo(1, 5);
  });
});

describe("selectSeeds with indexAnnotations", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "# Alpha\nalpha content here"],
    ["wiki/Beta.md", "# Beta\nbeta unrelated"],
  ]);

  it("uses annotation from indexAnnotations map", () => {
    const annotations = new Map([["Alpha", "альфа-частица физика ядро"]]);
    // question matches annotation but not body
    const r = selectSeeds("альфа физика", pages, 10, 0.1, annotations);
    expect(r).toContain("Alpha");
  });

  it("works without indexAnnotations (backward compat)", () => {
    const r = selectSeeds("alpha content", pages, 10, 0);
    expect(r).toContain("Alpha");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/wiki-seeds.test.ts
```

Expected: FAIL — `scoreSeed` doesn't accept 4th param yet, `selectSeeds` doesn't accept 5th param.

- [ ] **Step 3: Implement the updated `src/wiki-seeds.ts`**

Replace the entire file:

```typescript
import { pageId } from "./wiki-graph";

const STOP_WORDS = new Set([
  // EN
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  // RU
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще",
]);

const BODY_CAP = 500;

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const raw of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function bodyContent(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
  return (m ? m[1] : content).slice(0, BODY_CAP);
}

function parseFmKeywords(content: string): Set<string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return new Set();
  const kw = m[1].match(/wiki_keywords:\s*\[(.*?)\]/);
  if (!kw) return new Set();
  return new Set(kw[1].split(",").map((s) => s.trim().replace(/['"]/g, "").toLowerCase()));
}

export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,
): number {
  if (questionTokens.size === 0) return 0;
  const p = tokenize(pageIdValue);
  for (const t of parseFmKeywords(content)) p.add(t);
  for (const t of tokenize(bodyContent(content))) p.add(t);
  if (annotation) for (const t of tokenize(annotation)) p.add(t);
  if (p.size === 0) return 0;
  let inter = 0;
  for (const t of questionTokens) if (p.has(t)) inter++;
  return inter / questionTokens.size;
}

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>,
): string[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const annotation = indexAnnotations?.get(id);
    const score = scoreSeed(q, id, content, annotation);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/wiki-seeds.test.ts
```

Expected: all tests pass, including the existing "caps content tokenization" test (needle at char 550 > 500 cap — still not found).

- [ ] **Step 5: Commit**

```bash
git add src/wiki-seeds.ts tests/wiki-seeds.test.ts
git commit -m "feat(seeds): skip frontmatter, add wiki_keywords + annotation scoring"
```

---

### Task 2: `src/wiki-index.ts` — parseIndexAnnotations + upsertIndexAnnotation

**Files:**
- Create: `src/wiki-index.ts`
- Create: `tests/wiki-index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/wiki-index.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseIndexAnnotations, upsertIndexAnnotation } from "../src/wiki-index";
import type { VaultTools } from "../src/vault-tools";

describe("parseIndexAnnotations", () => {
  it("parses PageId: annotation lines", () => {
    const content = "DeepSeek: языковая модель для инференса в облаке\nКластеризация: алгоритм группировки";
    const map = parseIndexAnnotations(content);
    expect(map.get("DeepSeek")).toBe("языковая модель для инференса в облаке");
    expect(map.get("Кластеризация")).toBe("алгоритм группировки");
  });

  it("ignores lines without colon", () => {
    const content = "# Wiki Index\n- [[PageA]]\nPageB: annotation";
    const map = parseIndexAnnotations(content);
    expect(map.size).toBe(1);
    expect(map.get("PageB")).toBe("annotation");
  });

  it("returns empty map for empty content", () => {
    expect(parseIndexAnnotations("").size).toBe(0);
  });

  it("ignores blank lines and headers", () => {
    const content = "\n## Section\nPage: info\n\n";
    const map = parseIndexAnnotations(content);
    expect(map.get("Page")).toBe("info");
    expect(map.size).toBe(1);
  });

  it("handles annotation with colons", () => {
    const content = "Model: fast: low-latency model";
    const map = parseIndexAnnotations(content);
    expect(map.get("Model")).toBe("fast: low-latency model");
  });
});

describe("upsertIndexAnnotation", () => {
  function makeVaultTools(initial: string): {
    vt: Pick<VaultTools, "read" | "write">;
    written: string[];
  } {
    const written: string[] = [];
    const vt = {
      read: vi.fn(async () => initial),
      write: vi.fn(async (_path: string, content: string) => { written.push(content); }),
    } as unknown as Pick<VaultTools, "read" | "write">;
    return { vt, written };
  }

  it("appends new annotation when pageId absent", async () => {
    const { vt, written } = makeVaultTools("Existing: existing annotation");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "NewPage", "новая страница");
    expect(written[0]).toContain("NewPage: новая страница");
    expect(written[0]).toContain("Existing: existing annotation");
  });

  it("replaces existing annotation for same pageId", async () => {
    const { vt, written } = makeVaultTools("OldPage: старое описание");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "OldPage", "новое описание");
    expect(written[0]).toBe("OldPage: новое описание");
  });

  it("creates fresh index when file does not exist", async () => {
    const vt = {
      read: vi.fn(async () => { throw new Error("not found"); }),
      write: vi.fn(async () => {}),
    } as unknown as VaultTools;
    await upsertIndexAnnotation(vt, "!Wiki/work", "Page", "описание");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Page: описание");
  });

  it("writes to correct path", async () => {
    const { vt } = makeVaultTools("");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "P", "desc");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/_index.md");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: FAIL — module `src/wiki-index.ts` does not exist.

- [ ] **Step 3: Implement `src/wiki-index.ts`**

```typescript
import type { VaultTools } from "./vault-tools";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
  annotation: string,
): Promise<void> {
  const indexPath = `${wikiFolder}/_index.md`;
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { /* first write */ }
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  const newLine = `${pid}: ${annotation}`;
  if (pattern.test(content)) {
    content = content.replace(pattern, newLine);
  } else {
    content = content ? `${content}\n${newLine}` : newLine;
  }
  await vaultTools.write(indexPath, content);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/wiki-index.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(index): parseIndexAnnotations + upsertIndexAnnotation"
```

---

### Task 3: `src/phases/zod-schemas.ts` — add annotation field

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Test: `tests/phases/zod-schemas.test.ts` (check existing, add if needed)

- [ ] **Step 1: Check existing zod-schemas test**

```bash
npx vitest run tests/phases/zod-schemas.test.ts
```

Expected: passes (baseline).

- [ ] **Step 2: Write failing test for annotation in LintChatSchema**

Check `tests/phases/zod-schemas.test.ts` for a `LintChatSchema` test. If none, add to `tests/zod-schemas.test.ts`:

```typescript
import { LintChatSchema } from "../src/phases/zod-schemas";

describe("LintChatSchema", () => {
  it("accepts pages with annotation field", () => {
    const input = {
      summary: "done",
      pages: [{ path: "a/B.md", content: "# B", annotation: "описание страницы" }],
    };
    const result = LintChatSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.pages[0].annotation).toBe("описание страницы");
  });

  it("accepts pages without annotation (optional)", () => {
    const input = { summary: "done", pages: [{ path: "a/B.md", content: "# B" }] };
    expect(LintChatSchema.safeParse(input).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/zod-schemas.test.ts
```

Expected: FAIL — `annotation` not in schema, `result.data?.pages[0].annotation` is undefined.

- [ ] **Step 4: Update `src/phases/zod-schemas.ts`**

Change the `LintChatSchema` pages array to include optional `annotation`:

```typescript
export const LintChatSchema = z.object({
  summary: z.string(),
  pages: z.array(z.object({
    path: z.string(),
    content: z.string(),
    annotation: z.string().optional(),
  })).default([]),
});
```

Also update the `LintChatResponse` type (it's inferred so it updates automatically).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/zod-schemas.test.ts tests/phases/zod-schemas.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/zod-schemas.ts tests/zod-schemas.test.ts
git commit -m "feat(schemas): add optional annotation field to LintChatSchema pages"
```

---

### Task 4: `src/phases/ingest.ts` — parseJsonPages with annotation + upsertIndexAnnotation

**Files:**
- Modify: `src/phases/ingest.ts`
- Test: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Write failing tests**

Open `tests/phases/ingest.test.ts`. Add these tests:

```typescript
import { parseJsonPages } from "../../src/phases/ingest";

describe("parseJsonPages with annotation", () => {
  it("extracts annotation field when present", () => {
    const json = JSON.stringify([
      { path: "wiki/A.md", content: "# A", annotation: "описание A" },
    ]);
    const pages = parseJsonPages(json);
    expect(pages[0].annotation).toBe("описание A");
  });

  it("annotation is undefined when absent", () => {
    const json = JSON.stringify([{ path: "wiki/A.md", content: "# A" }]);
    expect(parseJsonPages(json)[0].annotation).toBeUndefined();
  });
});
```

Also add an integration-style check that `upsertIndexAnnotation` is called. In `tests/phases/ingest.test.ts`, add inside `describe("runIngest")`:

```typescript
it("calls write on _index.md with annotation after page write", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockResolvedValue("source text"),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify([
    { path: "!Wiki/work/Entity.md", content: "# Entity\n\nFact.", annotation: "описание сущности" },
  ]);
  await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`],
      vt,
      makeLlm(llmResponse),
      "llama3.2",
      [domain],
      VAULT_ROOT,
      new AbortController().signal,
    ),
  );
  const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls;
  const indexWrite = writeCalls.find((c: [string, string]) => c[0].endsWith("_index.md"));
  expect(indexWrite).toBeDefined();
  expect(indexWrite![1]).toContain("Entity: описание сущности");
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: FAIL on annotation tests (type doesn't include annotation yet).

- [ ] **Step 3: Update `parseJsonPages` in `src/phases/ingest.ts`**

Change the return type and type guard (lines 177-193):

```typescript
export function parseJsonPages(text: string): Array<{ path: string; content: string; annotation?: string }> {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[]).filter(
      (x): x is { path: string; content: string; annotation?: string } =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as { path?: unknown }).path === "string" &&
        typeof (x as { content?: unknown }).content === "string",
    );
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Add `upsertIndexAnnotation` call in `runIngest` after each successful write**

In `src/phases/ingest.ts`, add import at top:

```typescript
import { upsertIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
```

In the page-write loop (currently lines 105-119), after `written.push(page.path)` add:

```typescript
written.push(page.path);
yield { kind: "tool_result", ok: true };
// Upsert annotation into _index.md (non-blocking best-effort)
if (page.annotation) {
  try {
    await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
  } catch { /* non-critical */ }
}
```

Note: `pageId` is already imported indirectly; add explicit import if not present.

> **init.ts coverage:** `src/phases/init.ts` calls `runIngest` per source file via `for await (const ev of runIngest(...))` (init.ts line ~450). No direct change to init.ts is needed — this Task 4 change automatically covers the spec requirement `init.ts → upsertIndexAnnotation для каждой страницы`.

- [ ] **Step 5: Remove the old `updateIndex` call from `runIngest`**

Find this block in `runIngest` (currently around line 126):

```typescript
await appendLog(vaultTools, domainRoot, sourceVaultPath, domain.id, written);
await updateIndex(vaultTools, domainRoot, written);
```

Change to (remove `updateIndex` call, keep `appendLog`):

```typescript
await appendLog(vaultTools, domainRoot, sourceVaultPath, domain.id, written);
```

The `updateIndex` function at lines 211-224 can remain in the file (it's used by nothing now but keep for one more commit; remove in a cleanup PR).

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all pass.

- [ ] **Step 7: Run full suite to check no regressions**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/ingest.ts src/wiki-index.ts
git commit -m "feat(ingest): upsertIndexAnnotation per page, parseJsonPages includes annotation"
```

---

### Task 5: `src/phases/lint.ts` — upsertIndexAnnotation + remove flat index rewrite

**Files:**
- Modify: `src/phases/lint.ts`
- Test: `tests/phases/lint.test.ts`

- [ ] **Step 1: Verify baseline lint tests pass**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: all pass.

- [ ] **Step 2: Write failing test — index rewrite no longer overwrites annotations**

In `tests/phases/lint.test.ts`, add:

```typescript
it("does not rewrite _index.md with flat links after fix phase", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  await collect(
    runLint(["work"], vt, makeLlm("No issues found."), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls;
  const flatIndexWrite = writeCalls.find(
    (c: [string, string]) => c[0].endsWith("_index.md") && c[1].includes("- [["),
  );
  expect(flatIndexWrite).toBeUndefined();
});
```

- [ ] **Step 3: Add import + `upsertIndexAnnotation` calls in `src/phases/lint.ts`**

Add import:

```typescript
import { upsertIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
```

In the fix-write loop (currently around lines 150-165), after `writtenPaths.push(page.path)` add:

```typescript
writtenPaths.push(page.path);
yield { kind: "tool_result", ok: true };
if (page.annotation) {
  try {
    await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
  } catch { /* non-critical */ }
}
```

- [ ] **Step 4: Remove the flat index rewrite block from `src/phases/lint.ts`**

Remove these lines (currently around 210-217):

```typescript
const indexPath = `${wikiVaultPath}/_index.md`;
const indexLinks = files
  .map((f) => `- [[${basename(f, ".md")}]]`)
  .join("\n");
try {
  await vaultTools.write(indexPath, `# Wiki Index\n\n${indexLinks}\n`);
} catch { /* не критично */ }
```

Also remove the unused `basename` import if it becomes unused (check if it's used elsewhere in the file).

- [ ] **Step 5: Run lint tests**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: all pass.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): upsertIndexAnnotation per fixed page, remove flat index rewrite"
```

---

### Task 6: `src/phases/lint-chat.ts` — upsertIndexAnnotation per written page

**Files:**
- Modify: `src/phases/lint-chat.ts`
- Test: `tests/phases/lint-chat.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/phases/lint-chat.test.ts`, add to the existing test or add new test:

```typescript
it("calls upsertIndexAnnotation for pages that have annotation", async () => {
  const wikiPath = "!Wiki/test";
  const pages = { [`${wikiPath}/X.md`]: "# X" };
  const vaultTools = makeVaultTools(pages);
  const llmResponse = {
    summary: "done",
    pages: [{ path: `${wikiPath}/X.md`, content: "# X\nFixed", annotation: "описание X" }],
  };
  const llm = makeLlm(llmResponse) as any;
  const req: RunRequest = {
    operation: "lint-chat", args: [], cwd: "/vault", signal: makeSignal(),
    timeoutMs: 30000, domainId: "test", context: "",
  };

  const events: RunEvent[] = [];
  for await (const e of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "model", {}, makeSignal())) {
    events.push(e);
  }

  // _index.md should have been written with annotation
  const writeCalls = (vaultTools.write as ReturnType<typeof vi.fn>).mock.calls;
  const indexWrite = writeCalls.find((c: string[]) => c[0].endsWith("_index.md"));
  expect(indexWrite).toBeDefined();
  expect(indexWrite![1]).toContain("X: описание X");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: FAIL — no `_index.md` write currently.

- [ ] **Step 3: Read and update `src/phases/lint-chat.ts`**

Read the full file to find where pages from `LintChatSchema` are written. Then add:

```typescript
import { upsertIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
```

After each successful `vaultTools.write(page.path, page.content)` call, add:

```typescript
if (page.annotation) {
  try {
    await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation);
  } catch { /* non-critical */ }
}
```

(`wikiVaultPath` is already computed as `domainWikiFolder(domain.wiki_folder)` in the function.)

- [ ] **Step 4: Run lint-chat tests**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint-chat.ts tests/phases/lint-chat.test.ts
git commit -m "feat(lint-chat): upsertIndexAnnotation per written page"
```

---

### Task 7: `src/phases/query.ts` — indexAnnotations + simplified seed prompt

**Files:**
- Modify: `src/phases/query.ts`
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Run existing query tests to verify baseline**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: all pass.

- [ ] **Step 2: Write failing tests for new selectSeeds call and simplified seed prompt**

Add to `tests/phases/query.test.ts`:

```typescript
it("parses _index.md annotations and passes them to selectSeeds (Jaccard finds seed, no LLM call)", async () => {
  // Setup: one page "DeepSeek.md" with body text that matches the question
  // _index.md: "DeepSeek: быстрая языковая модель"
  // Question: "deepseek модель"
  // Expected: LLM.chat.completions.create called exactly once (main answer), NOT twice (not for seeds)
  const indexContent = "DeepSeek: быстрая языковая модель";
  const adapter = mockAdapter({
    list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/DeepSeek.md"], folders: [] }),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith("_index.md")) return indexContent;
      return "---\nwiki_keywords: [deepseek]\n---\n# DeepSeek\nЯзыковая модель.";
    }),
  });
  const llm = makeLlm("Ответ о DeepSeek");
  const vt = new VaultTools(adapter, VAULT_ROOT);
  await collect(
    runQuery(["deepseek модель"], false, vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  // LLM called once (main answer), not twice (seed call skipped)
  expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: FAIL — currently `selectSeeds` called without indexAnnotations, so LLM seed call fires.

- [ ] **Step 4: Update `runQuery` in `src/phases/query.ts`**

Add import:

```typescript
import { parseIndexAnnotations } from "../wiki-index";
```

After the `indexContent` is read (around line 58), parse annotations:

```typescript
const indexAnnotations = parseIndexAnnotations(indexContent);
```

Update the `selectSeeds` call (around line 74):

```typescript
let seeds = selectSeeds(question, pages, topK, minScore, indexAnnotations);
```

- [ ] **Step 5: Simplify `llmSelectSeeds` prompt in `src/phases/query.ts`**

Replace the current `llmSelectSeeds` function body's `prompt` construction (lines 181-188) with:

```typescript
const annotatedLines: string[] = [];
const unindexedIds: string[] = [];
for (const id of allPageIds) {
  const ann = indexAnnotations?.get(id);
  if (ann) annotatedLines.push(`${id}: ${ann}`);
  else unindexedIds.push(id);
}

const prompt = [
  `Question: "${question}"`,
  `Wiki index with annotations:\n${annotatedLines.join("\n")}`,
  unindexedIds.length ? `Pages not yet indexed: ${unindexedIds.join(", ")}` : "",
  `\nReturn JSON only matching this shape (most relevant page names — bare names, no path, no .md):`,
  `\n## Output JSON Example`,
  example,
].filter(Boolean).join("\n");
```

Pass `indexAnnotations` to `llmSelectSeeds` — update its signature:

```typescript
async function llmSelectSeeds(
  question: string,
  indexAnnotations: Map<string, string>,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ seeds: string[]; outputTokens: number }>
```

Update the call site (around line 79):

```typescript
const seedRes = await llmSelectSeeds(question, indexAnnotations, allPageIds, llm, model, seedOpts, signal);
```

Remove `indexContent` from the call site — it's no longer passed as a string; the function uses the parsed `indexAnnotations` map.

- [ ] **Step 6: Run query tests**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: all pass, including the new Jaccard-skips-LLM test.

- [ ] **Step 7: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "feat(query): pass indexAnnotations to selectSeeds, simplify LLM seed prompt"
```

---

### Task 8: Update prompts — wiki_keywords + annotation

**Files:**
- Modify: `prompts/ingest.md`
- Modify: `prompts/lint.md`
- Modify: `prompts/init.md`
- Modify: `prompts/init-incremental.md`
- Test: `tests/prompts.test.ts` (snapshot or contains check)

- [ ] **Step 1: Run existing prompts tests baseline**

```bash
npx vitest run tests/prompts.test.ts
```

Expected: all pass.

- [ ] **Step 2: Update `prompts/ingest.md`**

In the ПРАВИЛА section, add after `wiki_status: stub|developing|mature`:

```
- wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]
```

Change the output example line from:

```
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [\"[[{{source_path}}]]\"]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент..."}]
```

To:

```
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [\"[[{{source_path}}]]\"]\nwiki_updated: {{today}}\nwiki_status: stub\nwiki_keywords: [токен1, токен2]\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент...","annotation":"Краткое описание сущности для контекстного поиска"}]
```

Also add in the ПРАВИЛА section an instruction about `annotation`:

```
- Для каждой страницы добавь поле "annotation" в JSON: одно предложение — описание сущности для поиска по смыслу
```

- [ ] **Step 3: Update `prompts/lint.md`**

After the last line, add:

```

При возврате исправленных страниц используй JSON-массив с полями path, content, annotation:
- wiki_keywords: добавь или обнови в frontmatter (5-10 ключевых токенов, строчные, дефис-вместо-пробела)
- "annotation": одно предложение — описание сущности для поиска по смыслу
```

- [ ] **Step 4: Update `prompts/init.md`**

After `"language_notes": ""` line in the JSON structure, add a note about wiki conventions:

```

## Wiki Page Conventions

Страницы wiki должны иметь frontmatter с полями:
- wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]
```

- [ ] **Step 5: Update `prompts/init-incremental.md`**

After the last line of the existing content, add:

```

## Wiki Page Conventions

Wiki-страницы используют поле `wiki_keywords` во frontmatter (5-10 токенов, строчные, дефис-вместо-пробела). Учитывай это при определении extraction_cues в entity_types.
```

- [ ] **Step 6: Run prompts tests**

```bash
npx vitest run tests/prompts.test.ts
```

Expected: pass (prompts tests typically check file exists / basic content, not exact output — if snapshot tests fail, update snapshots with `npx vitest run tests/prompts.test.ts -u`).

- [ ] **Step 7: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add prompts/ingest.md prompts/lint.md prompts/init.md prompts/init-incremental.md
git commit -m "feat(prompts): add wiki_keywords + annotation to ingest/lint/init prompts"
```

---

## Self-Review

### 1. Spec Coverage

| Spec requirement | Covered by |
|---|---|
| `bodyContent` skips frontmatter, reads 500 chars | Task 1 |
| `parseFmKeywords` extracts wiki_keywords | Task 1 |
| `scoreSeed(q, id, content, annotation?)` signature | Task 1 |
| `selectSeeds(q, pages, topK, minScore, indexAnnotations?)` | Task 1 |
| `parseIndexAnnotations(content)` → Map | Task 2 |
| `upsertIndexAnnotation(vaultTools, folder, id, annotation)` | Task 2 |
| `annotation?` in `LintChatSchema.pages` | Task 3 |
| `parseJsonPages` returns `annotation?` | Task 4 |
| `ingest.ts` calls `upsertIndexAnnotation` after write | Task 4 |
| `ingest.ts` removes old `updateIndex` call | Task 4 |
| `lint.ts` calls `upsertIndexAnnotation` per fixed page | Task 5 |
| `lint.ts` removes flat `- [[...]]` index rewrite | Task 5 |
| `lint-chat.ts` calls `upsertIndexAnnotation` | Task 6 |
| `query.ts` passes `indexAnnotations` to `selectSeeds` | Task 7 |
| `query.ts` simplified LLM seed prompt (annotated index) | Task 7 |
| `prompts/ingest.md` — wiki_keywords + annotation | Task 8 |
| `prompts/lint.md` — wiki_keywords + annotation | Task 8 |
| `prompts/init.md` — wiki_keywords note | Task 8 |
| `prompts/init-incremental.md` — wiki_keywords note | Task 8 |
| DoD: LLM seed call skipped on ≥80% queries (Jaccard finds ≥1 seed) | Task 7 test |

**Gap check:** `init.ts` → spec says `upsertIndexAnnotation for each page`. Since `init.ts` delegates page writes to `runIngest` (via `yield* runIngest(...)`), Task 4 covers this automatically. No direct `init.ts` change needed.

**`src/phases/zod-schemas.ts`** — listed in spec scope. Covered by Task 3.

### 2. Placeholder scan

No TBD, TODO, or "similar to Task N" references. All code steps show complete implementations.

### 3. Type consistency

- `scoreSeed` signature in Task 1 Step 3: `(questionTokens: Set<string>, pageIdValue: string, content: string, annotation?: string): number` — matches usage in Task 7 Step 4.
- `selectSeeds` signature in Task 1: `(..., indexAnnotations?: Map<string, string>): string[]` — matches call in Task 7 Step 4.
- `upsertIndexAnnotation(vaultTools: VaultTools, wikiFolder: string, pid: string, annotation: string)` — consistent across Tasks 2, 4, 5, 6.
- `parseIndexAnnotations(content: string): Map<string, string>` — consistent Task 2 → Task 7.
- `parseJsonPages` return type `{ path, content, annotation? }[]` — used in Task 4 write loop and Task 5 fix loop.
