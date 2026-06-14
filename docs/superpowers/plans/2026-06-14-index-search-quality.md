---
review:
  plan_hash: d4d53d91126b1c01
  spec_hash: af58d6eb0fa3825e
  last_run: 2026-06-14
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "Self-Review"
      section_hash: 39a031e51ac874a1
      text: "Spec health metrics with measurable bounds — query seed-selection latency ≤ +15% (spec §Acceptance) and precision (no result flooding) — have no verification step in the plan. Spec defers them to manual Outcome Verification; the plan mirrors that, so no automated or manual gate is encoded as a plan step. Acceptable if check-result covers them post-build."
      verdict: fixed
      verdict_at: 2026-06-14
      resolution: "Added Task 10 (Outcome Verification manual gates): Step 1 latency ≤ +15% vs master baseline, Step 2 precision/no-flooding. Added both rows to Self-Review coverage table."
    - id: F-002
      phase: coverage
      severity: INFO
      section: "Task 6: Settings"
      section_hash: 90ed88bee1c07160
      text: "Spec testing-table row 'buildSimilarity threads chunking; UI fields persist' — only the threading half is unit-tested (config.chunking value). UI persistence (onChange → saveSettings) is not tested; the plan note explicitly scopes the test to config.chunking. Persistence verified manually only."
      verdict: fixed
      verdict_at: 2026-06-14
      resolution: "Added Task 10 Step 3 (manual gate): set all four chunk controls to non-default, reopen settings, confirm round-trip via saveSettings/settings.json. Split testing-table row 10 in Self-Review coverage (threading half → Task 6, persistence half → Task 10)."
chain:
  intent: docs/superpowers/intents/2026-06-14-index-search-quality-intent.md
  spec: docs/superpowers/specs/2026-06-14-index-search-quality-design.md
---
# Index-Search-Quality (multi-vector retrieval + section-aware annotations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise wiki retrieval recall so a query about a fact living in a page **body** (not just its summary) surfaces that page, on **both** the embedding and offline-Jaccard paths, without new sidecar files or schema-breaking changes.

**Architecture:** Hybrid. The embedding path stores **multiple vectors per page** in the existing `_embeddings.json` cache (one `summary` vector + one `section` vector per body section) and scores a page by the **max** cosine across its vectors. The offline Jaccard path keeps reading the **single-line** `_index.md` annotation, now enriched by the prompts to carry keywords from every body section. `src/wiki-index.ts` is untouched (still one line per page).

**Tech Stack:** TypeScript, Obsidian plugin runtime (`requestUrl`, no `Buffer`), Vitest. Embeddings via an OpenAI-compatible `/embeddings` endpoint (Ollama-compatible, API key optional).

**Spec:** `docs/superpowers/specs/2026-06-14-index-search-quality-design.md`

---

## File Structure

Files created or modified, each with one clear responsibility:

- **`src/page-similarity.ts`** (modify) — owns the cache schema, the `splitSections` chunker, `buildChunkInputs` (embed-text + per-chunk hash), `refreshCache` (now reads bodies, embeds per chunk incrementally), and max-pool scoring in the three `select*Embedding*` methods. This is the core of the change.
- **`src/types.ts`** (modify) — adds the four optional `nativeAgent.chunk*` settings (no defaults baked in here; defaults live in `buildSimilarity`).
- **`src/agent-runner.ts`** (modify) — `buildSimilarity` maps `nativeAgent.chunk*` → `SimilarityConfig.chunking`, applying defaults when absent.
- **`src/settings.ts`** (modify) — four chunking controls under the existing "Semantic Search" heading, shown only when embeddings are enabled.
- **`src/phases/ingest.ts`** (modify, ~line 483) — build a `pid → body` map from written pages and pass it to `refreshCache`.
- **`src/phases/lint.ts`** (modify, ~line 431) — build a `pid → body` map from the `pages` map and pass it to `refreshCache`.
- **`prompts/ingest.md`, `prompts/lint.md`, `prompts/lint-chat.md`** (modify) — annotation instruction now requires coverage of **all** body sections and section keywords; still one line. Identical wording across all three.
- **`tests/chunker.test.ts`** (create) — unit tests for `splitSections` and `buildChunkInputs`.
- **`tests/page-similarity.test.ts`** (modify) — update existing embedding tests to cache schema v2; add multi-vector round-trip, incrementality, max-pool recall, old-cache-null, offline-Jaccard-section-keyword tests.
- **`tests/settings-chunking.test.ts`** (create) — `buildSimilarity` threads chunking defaults.
- **`lat.md/architecture.md`, `lat.md/operations.md`, `lat.md/tests.md`** (modify) — document schema v2, chunker, max-pool query, and new spec sections with `// @lat:` refs.

---

## Shared definitions (used across tasks — read first)

These appear verbatim in the tasks below. Repeated here so any task read out of order has the canonical signature.

```ts
// src/page-similarity.ts — schema v2
interface EmbeddingChunk { vector: string; hash: string; kind: "summary" | "section"; }
interface EmbeddingCacheEntry { chunks: EmbeddingChunk[]; }
interface EmbeddingCacheFile {
  version: 2;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

// chunking config — threaded from settings via buildSimilarity
interface ChunkingConfig { maxChars: number; overlapChars: number; minChars: number; maxCount: number; }

const DEFAULT_CHUNKING: ChunkingConfig = { maxChars: 1200, overlapChars: 200, minChars: 200, maxCount: 12 };
```

`refreshCache` final signature (4th param is new):

```ts
async refreshCache(
  domainRoot: string,
  vaultTools: VaultTools,
  indexAnnotations: Map<string, string>,
  pageBodies: Map<string, string>,   // NEW: pid → page body markdown
): Promise<{ updated: number }>
```

---

## Task 1: Cache schema v2 + ChunkingConfig types + loadCache version guard

Introduce the multi-vector schema and the chunking config type. Bump `version` to 2 so old on-disk caches are detected and ignored. No behavior change to chunking yet — this task only lands the types, the `version` field, and the guard.

**Files:**
- Modify: `src/page-similarity.ts:7-25` (interfaces), `src/page-similarity.ts:447-459` (`loadCache`)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/page-similarity.test.ts` (inside the existing top-level, after the `vector encoding` describe block):

```ts
import { PageSimilarityService } from "../src/page-similarity";

describe("cache schema v2", () => {
  it("loadCache rejects an old { vector, hash } cache (no version: 2)", async () => {
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 3, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const oldCache = JSON.stringify({
      model: "m", dimensions: 3,
      entries: { Alpha: { vector: "AAAA", hash: "x" } },
    });
    const vaultTools = { read: async () => oldCache } as never;
    await svc.loadCache("domainRoot", vaultTools);
    // Old schema → cache stays null → no crash on subsequent select
    expect((svc as unknown as { cache: unknown }).cache).toBeNull();
  });

  it("loadCache accepts a version: 2 cache", async () => {
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 3, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const v2 = JSON.stringify({
      version: 2, model: "m", dimensions: 3,
      entries: { Alpha: { chunks: [{ vector: "AAAA", hash: "x", kind: "summary" }] } },
    });
    const vaultTools = { read: async () => v2 } as never;
    await svc.loadCache("domainRoot", vaultTools);
    expect((svc as unknown as { cache: unknown }).cache).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/page-similarity.test.ts -t "cache schema v2"`
Expected: FAIL — the v2 test fails because `loadCache` has no `version` guard yet (old cache would be accepted, or types mismatch).

- [ ] **Step 3: Update the interfaces**

In `src/page-similarity.ts`, replace lines 16-25:

```ts
export interface EmbeddingChunk {
  vector: string;  // base64 Float32Array
  hash: string;
  kind: "summary" | "section";
}

export interface EmbeddingCacheEntry {
  chunks: EmbeddingChunk[];
}

export interface EmbeddingCacheFile {
  version: 2;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}
```

Extend `SimilarityConfig` (lines 7-14) with the chunking field and add the config type + default just below it:

```ts
export interface ChunkingConfig {
  maxChars: number;
  overlapChars: number;
  minChars: number;
  maxCount: number;
}

export const DEFAULT_CHUNKING: ChunkingConfig = {
  maxChars: 1200,
  overlapChars: 200,
  minChars: 200,
  maxCount: 12,
};

export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
  chunking?: ChunkingConfig;
}
```

- [ ] **Step 4: Add the version guard to `loadCache`**

In `src/page-similarity.ts`, replace the parse-and-assign block in `loadCache` (lines 453-457):

```ts
      const raw = await vaultTools.read(domainEmbeddingsPath(domainRoot));
      const parsed = JSON.parse(raw) as EmbeddingCacheFile;
      if (parsed.version === 2 && parsed.model === model && parsed.dimensions === dimensions) {
        this.cache = parsed;
      }
```

> Note: the three `select*Embedding*` methods and `refreshCache` still reference the old `entry.vector` field and will not type-check yet. They are rewritten in Tasks 4 and 5. To keep the build green between tasks, this step is allowed to leave **type errors confined to those methods**; do not "fix" them with casts here — Tasks 4 and 5 replace those bodies wholesale. If your workflow requires a green `tsc` after every task, do Tasks 1, 4, and 5 as one commit. Otherwise commit here and proceed.

- [ ] **Step 5: Run the v2 loadCache tests**

Run: `npx vitest run tests/page-similarity.test.ts -t "cache schema v2"`
Expected: PASS for both `loadCache` tests.

- [ ] **Step 6: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(similarity): cache schema v2 + ChunkingConfig + loadCache version guard"
```

---

## Task 2: `splitSections` chunker

Pure function: split a page body into section windows. Strips frontmatter + the `# H1` title, units are H2 sections (H3+ folded into the parent H2), short units merge into a neighbour, long units window with overlap, and the total is capped at `maxCount` with the fold made visible in the final heading (no silent cap).

**Files:**
- Modify: `src/page-similarity.ts` (add `splitSections` near the other module-scope helpers, after `annotationHash`)
- Test: `tests/chunker.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/chunker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitSections, DEFAULT_CHUNKING } from "../src/page-similarity";

const body = (s: string) => s.replace(/^\n/, "");

describe("splitSections", () => {
  it("splits H2 sections and strips frontmatter + H1", () => {
    const md = body(`
---
wiki_status: stub
---
# Title

Lead paragraph.

## Alpha

Alpha body text here.

## Beta

Beta body text here.
`);
    const out = splitSections(md, DEFAULT_CHUNKING);
    const headings = out.map((c) => c.heading);
    expect(headings.some((h) => h.includes("Alpha"))).toBe(true);
    expect(headings.some((h) => h.includes("Beta"))).toBe(true);
    // frontmatter + H1 never appear in any window
    expect(out.every((c) => !c.window.includes("wiki_status"))).toBe(true);
    expect(out.every((c) => !c.window.includes("# Title"))).toBe(true);
  });

  it("folds H3 under its parent H2 (no split on H3)", () => {
    const md = body(`
# T

## Parent

Parent intro.

### Child

Child detail.
`);
    const out = splitSections(md, DEFAULT_CHUNKING);
    expect(out).toHaveLength(1);
    expect(out[0].heading).toContain("Parent");
    expect(out[0].window).toContain("Child detail");
  });

  it("merges a section shorter than minChars into a neighbour", () => {
    const md = body(`
# T

## Big

${"x ".repeat(300)}

## Tiny

short
`);
    const out = splitSections(md, { ...DEFAULT_CHUNKING, minChars: 50, maxChars: 5000 });
    // "Tiny" is < 50 chars and folds into "Big"
    expect(out).toHaveLength(1);
    expect(out[0].window).toContain("short");
  });

  it("windows a long section with overlap", () => {
    const long = "abcdefghij ".repeat(200); // ~2200 chars
    const md = body(`# T\n\n## Long\n\n${long}`);
    const out = splitSections(md, { maxChars: 600, overlapChars: 100, minChars: 50, maxCount: 50 });
    expect(out.length).toBeGreaterThan(1);
    // every window carries the same heading
    expect(out.every((c) => c.heading.includes("Long"))).toBe(true);
    // consecutive windows overlap: end of window i shares a tail with start of window i+1
    const tail = out[0].window.slice(-50);
    expect(out[1].window.includes(tail.trim().slice(0, 20))).toBe(true);
  });

  it("caps at maxCount and makes the fold visible (no silent cap)", () => {
    const sections = Array.from({ length: 8 }, (_, i) => `## S${i}\n\nbody ${i} ${"y ".repeat(150)}`).join("\n\n");
    const md = body(`# T\n\n${sections}`);
    const out = splitSections(md, { maxChars: 5000, overlapChars: 0, minChars: 10, maxCount: 4 });
    expect(out).toHaveLength(4);
    // last window's heading announces how many sections were folded in
    expect(out[3].heading.toLowerCase()).toContain("folded");
  });

  it("returns no sections for an empty body", () => {
    expect(splitSections("", DEFAULT_CHUNKING)).toEqual([]);
    expect(splitSections("---\nx: 1\n---\n# OnlyTitle\n", DEFAULT_CHUNKING)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chunker.test.ts`
Expected: FAIL — `splitSections` is not exported / not defined.

- [ ] **Step 3: Implement `splitSections`**

In `src/page-similarity.ts`, add after `annotationHash` (after line 48):

```ts
export interface SectionWindow { heading: string; window: string; }

function stripFrontmatterAndTitle(body: string): string {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n?/, "");
  // drop a single leading "# H1" title line
  return noFm.replace(/^#\s+[^\n]*\n?/, "");
}

interface RawUnit { heading: string; body: string; }

function toUnits(text: string): RawUnit[] {
  const lines = text.split("\n");
  const units: RawUnit[] = [];
  let cur: RawUnit | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {                 // new H2 — H3+ stays inside the current unit
      if (cur) units.push(cur);
      cur = { heading: line.trim(), body: "" };
    } else if (!cur) {
      // lead text before the first H2 — its own headless unit
      cur = { heading: "", body: line + "\n" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur) units.push(cur);
  // drop units that are entirely whitespace
  return units
    .map((u) => ({ heading: u.heading, body: u.body.trim() }))
    .filter((u) => u.heading.length > 0 || u.body.length > 0);
}

function unitLen(u: RawUnit): number { return u.heading.length + u.body.length; }

function mergeShort(units: RawUnit[], minChars: number): RawUnit[] {
  const out: RawUnit[] = [];
  for (const u of units) {
    if (unitLen(u) < minChars && out.length > 0) {
      const prev = out[out.length - 1];
      prev.body = `${prev.body}\n\n${u.heading} ${u.body}`.trim();
    } else if (unitLen(u) < minChars && units.length > 1) {
      // first unit is short: stash so it folds into the next one
      out.push({ heading: u.heading, body: u.body });
    } else {
      out.push({ heading: u.heading, body: u.body });
    }
  }
  return out;
}

function windowUnit(u: RawUnit, maxChars: number, overlapChars: number): SectionWindow[] {
  const text = u.body;
  if (text.length <= maxChars) return [{ heading: u.heading, window: text }];
  const windows: SectionWindow[] = [];
  const step = Math.max(1, maxChars - overlapChars);
  for (let i = 0; i < text.length; i += step) {
    windows.push({ heading: u.heading, window: text.slice(i, i + maxChars) });
    if (i + maxChars >= text.length) break;
  }
  return windows;
}

export function splitSections(body: string, chunking: ChunkingConfig): SectionWindow[] {
  const stripped = stripFrontmatterAndTitle(body).trim();
  if (!stripped) return [];
  const merged = mergeShort(toUnits(stripped), chunking.minChars);
  let windows: SectionWindow[] = [];
  for (const u of merged) {
    windows.push(...windowUnit(u, chunking.maxChars, chunking.overlapChars));
  }
  if (windows.length === 0) return [];
  if (windows.length > chunking.maxCount) {
    const kept = windows.slice(0, chunking.maxCount - 1);
    const foldedCount = windows.length - kept.length;
    const foldedBody = windows
      .slice(chunking.maxCount - 1)
      .map((w) => `${w.heading} ${w.window}`)
      .join("\n\n")
      .slice(0, chunking.maxChars);
    kept.push({ heading: `## (+${foldedCount} sections folded)`, window: foldedBody });
    windows = kept;
  }
  return windows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chunker.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/chunker.test.ts
git commit -m "feat(similarity): splitSections chunker (H2 split, H3 merge, window, maxCount fold)"
```

---

## Task 3: `buildChunkInputs` — embed text + per-chunk hash

Centralize the per-chunk embed text and hash so both `refreshCache` and the tests use one definition. The `summary` chunk's embed text is the annotation alone; each `section` chunk prepends the annotation and the H2 heading for whole-article grounding. Per-chunk hash = `annotationHash(embedText)`.

**Files:**
- Modify: `src/page-similarity.ts` (add `buildChunkInputs` after `splitSections`)
- Test: `tests/chunker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/chunker.test.ts`:

```ts
import { buildChunkInputs } from "../src/page-similarity";

describe("buildChunkInputs", () => {
  it("summary chunk embed text is the annotation alone", () => {
    const inputs = buildChunkInputs("ANNOT", "", DEFAULT_CHUNKING);
    expect(inputs[0].kind).toBe("summary");
    expect(inputs[0].embedText).toBe("ANNOT");
  });

  it("section chunk prepends annotation + heading + window", () => {
    const md = "# T\n\n## Alpha\n\nAlpha detail body.";
    const inputs = buildChunkInputs("ANNOT", md, DEFAULT_CHUNKING);
    const section = inputs.find((c) => c.kind === "section")!;
    expect(section.embedText.startsWith("ANNOT\n\n")).toBe(true);
    expect(section.embedText).toContain("Alpha");
    expect(section.embedText).toContain("Alpha detail body.");
  });

  it("changing the annotation changes every chunk hash", () => {
    const md = "# T\n\n## Alpha\n\nbody";
    const a = buildChunkInputs("ANNOT-A", md, DEFAULT_CHUNKING).map((c) => c.hash);
    const b = buildChunkInputs("ANNOT-B", md, DEFAULT_CHUNKING).map((c) => c.hash);
    expect(a.every((h, i) => h !== b[i])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chunker.test.ts -t buildChunkInputs`
Expected: FAIL — `buildChunkInputs` not exported.

- [ ] **Step 3: Implement `buildChunkInputs`**

In `src/page-similarity.ts`, add directly after `splitSections`:

```ts
export interface ChunkInput { kind: "summary" | "section"; embedText: string; hash: string; }

export function buildChunkInputs(
  annotation: string,
  body: string,
  chunking: ChunkingConfig,
): ChunkInput[] {
  const inputs: ChunkInput[] = [
    { kind: "summary", embedText: annotation, hash: annotationHash(annotation) },
  ];
  for (const { heading, window } of splitSections(body, chunking)) {
    const embedText = `${annotation}\n\n${heading}\n${window}`;
    inputs.push({ kind: "section", embedText, hash: annotationHash(embedText) });
  }
  return inputs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chunker.test.ts -t buildChunkInputs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/chunker.test.ts
git commit -m "feat(similarity): buildChunkInputs (annotation+heading grounding, per-chunk hash)"
```

---

## Task 4: `refreshCache` v2 — body access + per-chunk incremental embed

Rewrite `refreshCache` to take a `pid → body` map, build the desired chunk set per page via `buildChunkInputs`, reuse cached vectors by hash, and embed only the chunks whose hash is new. Writes the v2 schema; rebuilds from scratch on a version/model/dimensions mismatch. `updated` now counts **chunks** embedded.

**Files:**
- Modify: `src/page-similarity.ts:461-518` (whole `refreshCache` body)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/page-similarity.test.ts` (new describe block; uses the in-memory mock adapter from `vitest.mock`):

```ts
import {
  PageSimilarityService, encodeVector, DEFAULT_CHUNKING, buildChunkInputs,
} from "../src/page-similarity";
import { __setRequestUrlResponse, __requestUrlCalls, __clearRequestUrlCalls } from "../vitest.mock";

function makeVaultTools() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p: string) => {
      const v = files.get(p);
      if (v == null) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    write: async (p: string, c: string) => { files.set(p, c); },
  } as never;
}

// Mock /embeddings to echo N vectors matching the request's input length.
function respondWithVectors(dim = 3) {
  // overridden per-call below; placeholder
}

describe("refreshCache v2 (multi-vector, incremental)", () => {
  beforeEach(() => __clearRequestUrlCalls());

  const cfg = {
    mode: "embedding" as const, topK: 3, model: "m", dimensions: 3,
    baseUrl: "http://x", apiKey: "k", chunking: DEFAULT_CHUNKING,
  };

  it("embeds summary + one vector per section and round-trips the v2 cache", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.";
    const expectedChunks = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length; // summary + 2
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({
        data: Array.from({ length: expectedChunks }, () => ({ embedding: [1, 0, 0] })),
      }),
      headers: { "content-type": "application/json" },
    });

    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const { updated } = await svc.refreshCache(
      "domainRoot", vt,
      new Map([["Alpha", annotation]]),
      new Map([["Alpha", body]]),
    );
    expect(updated).toBe(expectedChunks);

    const written = JSON.parse(vt.files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.version).toBe(2);
    expect(written.entries.Alpha.chunks).toHaveLength(expectedChunks);
    expect(written.entries.Alpha.chunks[0].kind).toBe("summary");
    expect(written.entries.Alpha.chunks[1].kind).toBe("section");
  });

  it("re-embeds nothing when body and annotation are unchanged", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length;
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });

    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const anns = new Map([["Alpha", annotation]]);
    const bodies = new Map([["Alpha", body]]);
    await svc.refreshCache("domainRoot", vt, anns, bodies);

    __clearRequestUrlCalls();
    const second = await svc.refreshCache("domainRoot", vt, anns, bodies);
    expect(second.updated).toBe(0);
    expect(__requestUrlCalls).toHaveLength(0); // no HTTP — all hashes hit
  });

  it("re-embeds only the changed section (one chunk)", async () => {
    const annotation = "rich annotation";
    const body1 = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.";
    const n = buildChunkInputs(annotation, body1, DEFAULT_CHUNKING).length; // 3
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body1]]));

    // Change ONLY Beta's body. Summary + Alpha chunk hashes are unchanged.
    const body2 = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body CHANGED.";
    __clearRequestUrlCalls();
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0, 1, 0] }] }), // exactly one chunk re-embedded
      headers: { "content-type": "application/json" },
    });
    const r = await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body2]]));
    expect(r.updated).toBe(1);
    expect(__requestUrlCalls).toHaveLength(1);
    const reqBody = JSON.parse(__requestUrlCalls[0].body as string);
    expect(reqBody.input).toHaveLength(1);
    expect(reqBody.input[0]).toContain("CHANGED");
  });

  it("discards an old { vector, hash } cache and rebuilds as v2", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length;
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    vt.files.set("domainRoot/_config/_embeddings.json", JSON.stringify({
      model: "m", dimensions: 3, entries: { Alpha: { vector: "AAAA", hash: "old" } },
    }));
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body]]));
    const written = JSON.parse(vt.files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.version).toBe(2);
    expect(written.entries.Alpha.chunks).toBeDefined();
  });

  it("embeds only the summary chunk for a pid with no body", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const { updated } = await svc.refreshCache(
      "domainRoot", vt, new Map([["Alpha", "annot"]]), new Map(),
    );
    expect(updated).toBe(1);
    const written = JSON.parse(vt.files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.entries.Alpha.chunks).toHaveLength(1);
    expect(written.entries.Alpha.chunks[0].kind).toBe("summary");
  });
});
```

Also fix the **existing** Jaccard-mode arity test at `tests/page-similarity.test.ts:50-54` to pass the new 4th arg:

```ts
  it("refreshCache returns { updated: 0 } in Jaccard mode", async () => {
    const svc = makeService(5);
    const result = await svc.refreshCache("domainRoot", {} as never, new Map(), new Map());
    expect(result).toEqual({ updated: 0 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/page-similarity.test.ts -t "refreshCache v2"`
Expected: FAIL — `refreshCache` ignores bodies / writes old schema / wrong arity.

- [ ] **Step 3: Rewrite `refreshCache`**

Replace the entire `refreshCache` method (`src/page-similarity.ts:461-518`):

```ts
  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
    pageBodies: Map<string, string>,
  ): Promise<{ updated: number }> {
    if (this.config.mode !== "embedding") return { updated: 0 };
    const { baseUrl, apiKey, model, dimensions } = this.config;
    if (!baseUrl || !model || !dimensions) return { updated: 0 };
    const chunking = this.config.chunking ?? DEFAULT_CHUNKING;

    const cachePath = domainEmbeddingsPath(domainRoot);
    let cacheFile: EmbeddingCacheFile;
    try {
      const parsed = JSON.parse(await vaultTools.read(cachePath)) as EmbeddingCacheFile;
      cacheFile =
        parsed.version === 2 && parsed.model === model && parsed.dimensions === dimensions
          ? parsed
          : { version: 2, model, dimensions, entries: {} };
    } catch {
      cacheFile = { version: 2, model, dimensions, entries: {} };
    }

    // Build the desired chunk set per pid, reusing cached vectors whose hash matches.
    interface Pending { pid: string; idx: number; embedText: string; }
    const desired = new Map<string, EmbeddingChunk[]>();
    const pending: Pending[] = [];
    let changed = false;

    for (const [pid, annotation] of indexAnnotations) {
      const body = pageBodies.get(pid) ?? "";
      const inputs = buildChunkInputs(annotation, body, chunking);
      const oldByHash = new Map(
        (cacheFile.entries[pid]?.chunks ?? []).map((c) => [c.hash, c.vector]),
      );
      const chunks: EmbeddingChunk[] = [];
      for (const { kind, embedText, hash } of inputs) {
        const reuse = oldByHash.get(hash);
        if (reuse !== undefined) {
          chunks.push({ vector: reuse, hash, kind });
        } else {
          pending.push({ pid, idx: chunks.length, embedText });
          chunks.push({ vector: "", hash, kind });
        }
      }
      if ((cacheFile.entries[pid]?.chunks.length ?? 0) !== chunks.length) changed = true;
      desired.set(pid, chunks);
    }

    // Embed the new chunks in batches. A failed batch leaves those chunks empty;
    // they keep no entry and are retried next run (their hash is still absent).
    for (let i = 0; i < pending.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(i, i + EMBEDDING_BATCH_SIZE);
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.map((p) => p.embedText));
      } catch {
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        desired.get(batch[j].pid)![batch[j].idx].vector = encodeVector(vecs[j]);
      }
    }

    if (pending.length === 0 && !changed) return { updated: 0 };

    for (const [pid, chunks] of desired) {
      const filled = chunks.filter((c) => c.vector !== "");
      if (filled.length > 0) cacheFile.entries[pid] = { chunks: filled };
    }

    await vaultTools.write(cachePath, JSON.stringify(cacheFile, null, 2));
    this.cache = cacheFile;
    return { updated: pending.length };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/page-similarity.test.ts -t "refreshCache v2"`
Expected: PASS (all 5 new tests + the fixed Jaccard arity test).

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(similarity): refreshCache v2 — body access + per-chunk incremental embed"
```

---

## Task 5: Max-pool scoring across all three embedding select methods

Score a page by the **max** cosine across its chunk vectors. Refactor `selectEmbedding`, `selectEmbeddingScored`, and `selectByEntitiesEmbedding` so the per-page vector map holds a **list** of vectors. Cached pages contribute their decoded chunks; pages embedded on the fly contribute a one-element list; the Jaccard sentinel becomes an empty list. Also update the existing embedding-mode tests to the v2 cache schema.

**Files:**
- Modify: `src/page-similarity.ts` — add `maxCosine` helper; rewrite the cache-load + scoring in three methods (`selectByEntitiesEmbedding` ~184-261, `selectEmbedding` ~280-365, `selectEmbeddingScored` ~384-445)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing test (recall — body-section match)**

Add to `tests/page-similarity.test.ts`:

```ts
describe("max-pool scoring", () => {
  beforeEach(() => __clearRequestUrlCalls());

  it("surfaces a page whose only match is a body-section vector", async () => {
    // Query vector points along axis 2 (the body section), NOT the summary axis.
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0, 0, 1] }] }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    (svc as unknown as { cache: unknown }).cache = {
      version: 2, model: "m", dimensions: 3,
      entries: {
        Alpha: { chunks: [
          { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "s", kind: "summary" },
          { vector: encodeVector(new Float32Array([0, 0, 1])), hash: "b", kind: "section" }, // body match
        ] },
        Beta: { chunks: [
          { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "s", kind: "summary" },
        ] },
      },
    };
    const result = await svc.selectRelevant(
      "body section query",
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );
    expect(result).toEqual(["!Wiki/d/x/Alpha.md"]); // body-section vector wins via max-pool
  });

  it("falls back to Jaccard for a page whose vectors all failed", async () => {
    __setRequestUrlResponse({ status: 500, text: "err", headers: {} });
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const result = await svc.selectRelevant(
      "neural network",
      new Map([["Alpha", "neural network deep learning"]]),
      ["!Wiki/d/x/Alpha.md"],
    );
    // query embedding throws → whole call falls to Jaccard → Alpha matches on tokens
    expect(result).toEqual(["!Wiki/d/x/Alpha.md"]);
  });
});
```

- [ ] **Step 2: Update the existing embedding tests to schema v2**

In `tests/page-similarity.test.ts`, the `selectByEntities (embedding mode)` block injects the old cache shape at lines ~191-197 and ~221-227. Replace **both** injected caches with the v2 shape, e.g.:

```ts
    (svc as unknown as { cache: unknown }).cache = {
      version: 2, model: "m", dimensions: 3,
      entries: {
        Alpha: { chunks: [{ vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x", kind: "summary" }] },
        Beta:  { chunks: [{ vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x", kind: "summary" }] },
      },
    };
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/page-similarity.test.ts -t "max-pool"`
Expected: FAIL — scoring still reads `entry.vector` (undefined on v2 entries) and does not max-pool.

- [ ] **Step 4: Add the `maxCosine` helper**

In `src/page-similarity.ts`, add after the `cosine` function (after line 59):

```ts
function maxCosine(query: Float32Array, vecs: Float32Array[]): number {
  let best = 0;
  for (const v of vecs) {
    if (v.length === 0) continue;
    const c = cosine(query, v);
    if (c > best) best = c;
  }
  return best;
}
```

- [ ] **Step 5: Rewrite `selectEmbedding` cache-load + scoring**

In `selectEmbedding`, change the page-vector map to hold lists. Replace the declaration and the cache-load block (lines 303-313):

```ts
    const pageVecs = new Map<string, Float32Array[]>();

    // Load chunk vectors from in-memory cache (populated by refreshCache)
    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], entry.chunks.map((c) => decodeVector(c.vector)));
      }
    }
```

Replace the on-the-fly embed/sentinel writes (lines 333-345). The Jaccard sentinel becomes an empty list; freshly embedded annotations become a one-element list:

```ts
      } catch {
        // Fallback: mark this batch's pages for Jaccard (empty vector list)
        for (const pid of batch.pids) {
          const annotation = indexAnnotations.get(pid) ?? "";
          const score = scoreSeed(queryTokens, pid, "", annotation);
          if (score > 0) pageVecs.set(pid, []);
        }
        continue;
      }
      for (let i = 0; i < batch.pids.length; i++) {
        pageVecs.set(batch.pids[i], [vecs[i]]);
      }
```

Replace the scoring loop (lines 348-364):

```ts
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vecs = pageVecs.get(pid);
      if (!vecs) continue;
      const score = vecs.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[i])
        : maxCosine(queryVec, vecs);
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((x) => x.path);
```

- [ ] **Step 6: Rewrite `selectEmbeddingScored` cache-load + scoring**

In `selectEmbeddingScored`, replace the map declaration + cache-load (lines 405-412):

```ts
    const pageVecs = new Map<string, Float32Array[]>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], entry.chunks.map((c) => decodeVector(c.vector)));
      }
    }
```

Replace the batch fill + sentinel (lines 424-431):

```ts
    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey!, model, batch.texts);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], [vecs[i]]);
      } catch {
        for (const pid of batch.pids) pageVecs.set(pid, []);
      }
    }
```

Replace the scoring loop (lines 433-444):

```ts
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vecs = pageVecs.get(pid);
      if (!vecs) continue;
      const score = vecs.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[i])
        : maxCosine(queryVec, vecs);
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
```

- [ ] **Step 7: Rewrite `selectByEntitiesEmbedding` cache-load + scoring**

In `selectByEntitiesEmbedding`, replace the map declaration + cache-load (lines 205-212):

```ts
    const pageVecs = new Map<string, Float32Array[]>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], entry.chunks.map((c) => decodeVector(c.vector)));
      }
    }
```

Replace the batch fill + sentinel (lines 228-237):

```ts
    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], [vecs[i]]);
      } catch {
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], []);
      }
    }
```

Replace the per-entity scoring (lines 244-253):

```ts
      const scored: { path: string; score: number }[] = [];
      for (let pi = 0; pi < allPaths.length; pi++) {
        const pid = pids[pi];
        const vecs = pageVecs.get(pid);
        if (!vecs) continue;
        const score = vecs.length === 0
          ? scoreSeed(queryTokens, pid, "", annotations[pi])
          : maxCosine(queryVec, vecs);
        if (score > 0) scored.push({ path: allPaths[pi], score });
      }
```

- [ ] **Step 8: Run the full page-similarity suite**

Run: `npx vitest run tests/page-similarity.test.ts`
Expected: PASS — new max-pool tests, updated embedding-mode tests, all prior Jaccard tests.

- [ ] **Step 9: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(similarity): max-pool scoring over multi-vector pages (recall-first)"
```

---

## Task 6: Settings — `chunk*` fields, defaults, threading, UI

Add the four optional `nativeAgent.chunk*` settings, thread them through `buildSimilarity` into `SimilarityConfig.chunking` (applying defaults so old `settings.json` stays valid), and render four numeric controls under the "Semantic Search" heading. UI strings are hardcoded English to match that block.

**Files:**
- Modify: `src/types.ts:170-185` (interface) — no change to `DEFAULT_SETTINGS` (fields are optional, defaulted in `buildSimilarity`)
- Modify: `src/agent-runner.ts:51-62` (`buildSimilarity`)
- Modify: `src/settings.ts` (inside the `if (s.nativeAgent.embeddingModel !== undefined)` block)
- Test: `tests/settings-chunking.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/settings-chunking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { DEFAULT_SETTINGS } from "../src/types";
import { DEFAULT_CHUNKING } from "../src/page-similarity";

function similarityConfigOf(settings: typeof DEFAULT_SETTINGS) {
  const runner = new AgentRunner(
    { } as never, // vaultTools — unused by buildSimilarity
    settings,
    [], "vault",
  );
  const svc = (runner as unknown as { buildSimilarity: () => unknown }).buildSimilarity();
  return (svc as { config: { chunking?: typeof DEFAULT_CHUNKING } }).config;
}

describe("buildSimilarity chunking threading", () => {
  it("applies chunking defaults when chunk* settings are absent", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.nativeAgent.embeddingModel = "text-embedding-3-small";
    settings.nativeAgent.embeddingDimensions = 512;
    const cfg = similarityConfigOf(settings);
    expect(cfg.chunking).toEqual(DEFAULT_CHUNKING);
  });

  it("uses explicit chunk* values when present", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.nativeAgent.embeddingModel = "text-embedding-3-small";
    settings.nativeAgent.embeddingDimensions = 512;
    settings.nativeAgent.chunkMaxChars = 800;
    settings.nativeAgent.chunkOverlapChars = 100;
    settings.nativeAgent.chunkMinChars = 150;
    settings.nativeAgent.chunkMaxCount = 6;
    const cfg = similarityConfigOf(settings);
    expect(cfg.chunking).toEqual({ maxChars: 800, overlapChars: 100, minChars: 150, maxCount: 6 });
  });
});
```

> If `AgentRunner`'s constructor signature differs, adjust the call in `similarityConfigOf` to match. The point of the test is the value of `config.chunking`. Verify the constructor parameter order in `src/agent-runner.ts` before writing — match it exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings-chunking.test.ts`
Expected: FAIL — `chunk*` fields don't exist on the type; `config.chunking` is undefined.

- [ ] **Step 3: Add the optional fields to the `nativeAgent` type**

In `src/types.ts`, inside the `nativeAgent` interface block (after `mergeDeleteWarnThreshold?: number;`, line 184):

```ts
    chunkMaxChars?: number;
    chunkOverlapChars?: number;
    chunkMinChars?: number;
    chunkMaxCount?: number;
```

- [ ] **Step 4: Thread chunking through `buildSimilarity`**

In `src/agent-runner.ts`, import `DEFAULT_CHUNKING` from `./page-similarity` (add to the existing import of `PageSimilarityService`), then in `buildSimilarity` (lines 54-61) add the `chunking` mapping:

```ts
    return new PageSimilarityService({
      mode: na.embeddingModel !== undefined ? "embedding" : "jaccard",
      model: na.embeddingModel,
      dimensions: na.embeddingDimensions,
      topK: na.relevantPagesTopK ?? 15,
      baseUrl: na.baseUrl,
      apiKey: na.apiKey,
      chunking: {
        maxChars: na.chunkMaxChars ?? DEFAULT_CHUNKING.maxChars,
        overlapChars: na.chunkOverlapChars ?? DEFAULT_CHUNKING.overlapChars,
        minChars: na.chunkMinChars ?? DEFAULT_CHUNKING.minChars,
        maxCount: na.chunkMaxCount ?? DEFAULT_CHUNKING.maxCount,
      },
    });
```

- [ ] **Step 5: Run the threading test to verify it passes**

Run: `npx vitest run tests/settings-chunking.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Add the four UI controls**

In `src/settings.ts`, inside the `if (s.nativeAgent.embeddingModel !== undefined) {` block, after the "Embedding dimensions" control (after line 642) and before the `mergeDeleteWarnThreshold` slider (line 644). A small helper keeps the four numeric fields DRY:

```ts
        const chunkField = (
          name: string, desc: string, placeholder: string,
          get: () => number, set: (n: number) => void,
        ) =>
          new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
            t.setPlaceholder(placeholder)
              .setValue(String(get()))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) { set(Math.floor(n)); await this.plugin.saveSettings(); }
              }),
          );

        chunkField("Chunk size (chars)", "Max characters per section window. Default: 1200.",
          "1200", () => s.nativeAgent.chunkMaxChars ?? 1200, (n) => { s.nativeAgent.chunkMaxChars = n; });
        chunkField("Chunk overlap (chars)", "Overlap between consecutive windows of a long section. Default: 200.",
          "200", () => s.nativeAgent.chunkOverlapChars ?? 200, (n) => { s.nativeAgent.chunkOverlapChars = n; });
        chunkField("Min chunk size (merge)", "Sections shorter than this merge into a neighbour. Default: 200.",
          "200", () => s.nativeAgent.chunkMinChars ?? 200, (n) => { s.nativeAgent.chunkMinChars = n; });
        chunkField("Max chunks per page", "Cap on vectors per page (summary + sections). Default: 12.",
          "12", () => s.nativeAgent.chunkMaxCount ?? 12, (n) => { s.nativeAgent.chunkMaxCount = n; });
```

- [ ] **Step 7: Run lint + the settings test**

Run: `npm run lint && npx vitest run tests/settings-chunking.test.ts`
Expected: lint clean for touched files (see memory note: gate on NEW errors in touched files, not a globally clean `tsc`); settings test PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent-runner.ts src/settings.ts tests/settings-chunking.test.ts
git commit -m "feat(settings): chunking controls + buildSimilarity threading with defaults"
```

---

## Task 7: Call sites — pass page bodies to `refreshCache`

Both `refreshCache` callers already hold the page content. Build a `pid → body` map at each site and pass it as the new fourth argument.

**Files:**
- Modify: `src/phases/ingest.ts:479-485`
- Modify: `src/phases/lint.ts:430-431`
- Test: covered by existing phase tests (`tests/phases/lint.test.ts`) which mock `refreshCache` — they assert it is called, arity-agnostic.

- [ ] **Step 1: Update the ingest call site**

In `src/phases/ingest.ts`, replace the `refreshCache` block (lines 479-485):

```ts
  if (similarity && written.length > 0) {
    try {
      const updatedIndex = await vaultTools.read(domainIndexPath(wikiVaultPath)).catch(() => "");
      const updatedAnnotations = parseIndexAnnotations(updatedIndex);
      const writtenSet = new Set(written);
      const pageBodies = new Map<string, string>();
      for (const page of pages) {
        if (writtenSet.has(page.path)) pageBodies.set(pageId(page.path), page.content);
      }
      await similarity.refreshCache(domainRoot, vaultTools, updatedAnnotations, pageBodies);
    } catch { /* non-critical */ }
  }
```

- [ ] **Step 2: Update the lint call site**

In `src/phases/lint.ts`, replace the `refreshCache` call (line 431) and build the body map from the `pages` map:

```ts
      if (similarity) {
        const pageBodies = new Map<string, string>();
        for (const [path, content] of pages) pageBodies.set(pageId(path), content);
        const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, annotations, pageBodies);
        if (similarity.config.mode === "embedding" && updated > 0) {
          yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
        }
      }
```

> The surrounding `if (similarity) { ... }` already exists at lines 429-436 — replace its inner body, keeping the outer `if`. Verify you are not double-wrapping.

- [ ] **Step 3: Run the phase tests**

Run: `npx vitest run tests/phases/lint.test.ts`
Expected: PASS — the mocked `similarity.refreshCache` still records the call; extra arg is ignored by the mock.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS across all `.test.ts`. If any pre-existing `.test.js` duplicates fail, leave them — they are stale compiled output, out of scope (do not modify; mention to the user if they error).

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts src/phases/lint.ts
git commit -m "feat(phases): supply page bodies to refreshCache for section vectors"
```

---

## Task 8: Annotation prompts — cover every section

Require the one-line annotation to cover **all** body sections and harvest keywords from every section. Identical wording across all three prompts. Still one line (the whitespace-collapse guard in `upsertIndexAnnotation` enforces this). No code change — prompts only.

**Files:**
- Modify: `prompts/ingest.md:31`
- Modify: `prompts/lint.md:9`
- Modify: `prompts/lint-chat.md:4`

- [ ] **Step 1: Define the shared structure clause**

The replacement uses this exact structure clause (Russian, matching the existing prompt language). It changes the size target to ~600–800 chars and adds the two coverage requirements:

```
Структура: <summary 1-2 предложения, охватывает ОСНОВНЫЕ разделы тела, не только первый абзац> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <ключевые слова из КАЖДОГО раздела — синонимы, ID, термины, которых нет в заголовке>. Ориентир ~600–800 символов, всё на ОДНОЙ строке без переносов. Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate — общие фразы поднимают шум в поиске.
```

- [ ] **Step 2: Edit `prompts/ingest.md:31`**

Replace everything after `JSON: богатое описание для семантического поиска (embedding + Jaccard). ` on line 31 with the shared structure clause from Step 1, so the line reads:

```
- Для каждой страницы добавь поле "annotation" в JSON: богатое описание для семантического поиска (embedding + Jaccard). Структура: <summary 1-2 предложения, охватывает ОСНОВНЫЕ разделы тела, не только первый абзац> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <ключевые слова из КАЖДОГО раздела — синонимы, ID, термины, которых нет в заголовке>. Ориентир ~600–800 символов, всё на ОДНОЙ строке без переносов. Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate — общие фразы поднимают шум в поиске.
```

- [ ] **Step 3: Edit `prompts/lint.md:9`**

Replace line 9 so the structure clause matches Step 1:

```
- "annotation": богатое описание для семантического поиска (embedding + Jaccard). Структура: <summary 1-2 предложения, охватывает ОСНОВНЫЕ разделы тела, не только первый абзац> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <ключевые слова из КАЖДОГО раздела — синонимы, ID, термины, которых нет в заголовке>. Ориентир ~600–800 символов, всё на ОДНОЙ строке без переносов. Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate — общие фразы поднимают шум в поиске.
```

- [ ] **Step 4: Edit `prompts/lint-chat.md:4`**

Replace line 4 so the structure clause matches Step 1:

```
Для каждой страницы поле "annotation" — богатое описание для семантического поиска (embedding + Jaccard). Структура: <summary 1-2 предложения, охватывает ОСНОВНЫЕ разделы тела, не только первый абзац> Затрагивает: <сущности, таблицы, системы, Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <ключевые слова из КАЖДОГО раздела — синонимы, ID, термины, которых нет в заголовке>. Ориентир ~600–800 символов, всё на ОДНОЙ строке без переносов. Конкретика, без воды и boilerplate.
```

- [ ] **Step 5: Verify the three structure clauses are identical**

Run: `grep -n "Термины: <ключевые слова из КАЖДОГО раздела" prompts/ingest.md prompts/lint.md prompts/lint-chat.md`
Expected: one match in each of the three files.

- [ ] **Step 6: Commit**

```bash
git add prompts/ingest.md prompts/lint.md prompts/lint-chat.md
git commit -m "feat(prompts): annotation covers every body section + section keywords"
```

---

## Task 9: lat.md documentation + `lat check`

Update the knowledge graph: schema v2 + chunker in architecture, max-pool query in operations, and new test spec sections with matching `// @lat:` code refs (the file has `require-code-mention: true`, so every new leaf needs a ref).

**Files:**
- Modify: `lat.md/architecture.md#PageSimilarityService`
- Modify: `lat.md/operations.md#Query#Seed Selection`
- Modify: `lat.md/tests.md` (new `## Multi-Vector Retrieval` section)
- Modify: `tests/chunker.test.ts`, `tests/page-similarity.test.ts` (add `// @lat:` comments)

- [ ] **Step 1: Update `architecture.md#PageSimilarityService`**

Replace the paragraph describing the cache (the one starting "Two modes: `jaccard`...") to reflect multi-vector v2. Add after the existing `encodeVector`/`decodeVector` paragraph:

```markdown
Embedding vectors are cached per domain at `_config/_embeddings.json` as schema **v2**: each page entry holds a `chunks` array — one `summary` vector (the one-line annotation) plus one `section` vector per body section window. `splitSections` builds the windows (strip frontmatter + H1, H2 units with H3+ folded in, short units merged, long units windowed with overlap, capped at `chunkMaxCount` with the fold made visible in the final heading). `buildChunkInputs` prepends the annotation and H2 heading to each section window for whole-article grounding, and hashes that embed text per chunk. `refreshCache` reuses cached vectors whose hash matches and embeds only new chunks, so a single changed section re-embeds one vector. Page score is the **max** cosine across the page's chunk vectors — one matching body section surfaces the page. Old `{ vector, hash }` caches lack `version: 2`; `loadCache` returns null for them and `refreshCache` rebuilds. Chunking is tunable via `nativeAgent.chunk*` settings, defaulted in `buildSimilarity`.

See [[src/page-similarity.ts#splitSections]], [[src/page-similarity.ts#buildChunkInputs]], [[src/page-similarity.ts#PageSimilarityService#refreshCache]].
```

Update the `refreshCache returns { updated: number }` paragraph: `updated` now counts **chunks** embedded, not pages.

- [ ] **Step 2: Update `operations.md#Query#Seed Selection`**

Append to the "Seed Selection" section a paragraph on max-pool:

```markdown
On the embedding path, each page is represented by **multiple vectors** (a summary vector over the annotation plus one vector per body section). The seed score is the **max** cosine over those vectors, so a query matching a fact that lives only in the page body still surfaces the page. The offline Jaccard path is unchanged structurally but benefits from richer annotations: the one-line `_index.md` string now carries keywords harvested from every body section, so `scoreSeed` term mass covers body facts with no API. See [[src/page-similarity.ts#PageSimilarityService#selectEmbedding]].
```

- [ ] **Step 3: Add spec sections to `tests.md`**

Add a new top-level section to `lat.md/tests.md` (after "Per-Entity Retrieval"):

```markdown
## Multi-Vector Retrieval

Tests for section-aware chunking, the schema-v2 cache, incremental re-embedding, and max-pool scoring that lifts body-fact recall on both retrieval paths.

### Chunker splits H2 sections

`splitSections` strips frontmatter and the H1 title, emits one unit per H2 section, and folds H3+ content into the parent H2.

### Chunker merges short sections and windows long ones

Sections shorter than `minChars` merge into a neighbour; sections longer than `maxChars` are windowed with `overlapChars` overlap, each window carrying the section heading.

### Chunker caps at maxCount and makes the fold visible

When windows exceed `maxCount`, the first `maxCount - 1` are kept and the rest are folded into one final window whose heading announces the folded count — no silent cap.

### Chunk embed text prepends annotation and heading

`buildChunkInputs` produces a summary chunk equal to the annotation alone and section chunks that prepend the annotation and H2 heading to the window for whole-article grounding.

### Cache v2 round-trips multiple chunks

`refreshCache` writes a `version: 2` cache whose page entry holds one summary chunk plus one section chunk per body section, serialized and parsed without loss.

### Incremental re-embed touches only changed chunks

An unchanged body re-embeds nothing; changing a single section re-embeds exactly that one chunk while summary and other section vectors are reused by hash.

### Max-pool surfaces a body-section match

A page whose only matching vector is a body section outranks a page that matches only on its summary, because page score is the max cosine across the page's vectors.

### Old cache schema loads as null

A pre-v2 `{ vector, hash }` cache is rejected by `loadCache` (returns null, no crash); `refreshCache` discards it and rebuilds as v2.

### Offline Jaccard finds a section keyword

With no API key, the enriched one-line annotation lets `scoreSeed` match a query phrased with a keyword that lives in a body section.
```

- [ ] **Step 4: Add `// @lat:` refs to the tests**

In `tests/chunker.test.ts`, add one comment above the matching `it(...)`:

```ts
  // @lat: [[tests#Multi-Vector Retrieval#Chunker splits H2 sections]]
  it("splits H2 sections and strips frontmatter + H1", () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Chunker merges short sections and windows long ones]]
  it("windows a long section with overlap", () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Chunker caps at maxCount and makes the fold visible]]
  it("caps at maxCount and makes the fold visible (no silent cap)", () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Chunk embed text prepends annotation and heading]]
  it("section chunk prepends annotation + heading + window", () => {
```

In `tests/page-similarity.test.ts`:

```ts
  // @lat: [[tests#Multi-Vector Retrieval#Cache v2 round-trips multiple chunks]]
  it("embeds summary + one vector per section and round-trips the v2 cache", async () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Incremental re-embed touches only changed chunks]]
  it("re-embeds only the changed section (one chunk)", async () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Max-pool surfaces a body-section match]]
  it("surfaces a page whose only match is a body-section vector", async () => {
```
```ts
  // @lat: [[tests#Multi-Vector Retrieval#Old cache schema loads as null]]
  it("loadCache rejects an old { vector, hash } cache (no version: 2)", async () => {
```

For "Offline Jaccard finds a section keyword", add a small dedicated test in `tests/page-similarity.test.ts` (Jaccard mode, no API) and ref it:

```ts
  // @lat: [[tests#Multi-Vector Retrieval#Offline Jaccard finds a section keyword]]
  it("offline Jaccard matches a body-section keyword via the enriched annotation", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 1 });
    // annotation now carries a keyword that lives only in the body section
    const result = await svc.selectRelevant(
      "idempotency retry",
      new Map([["Orders", "Order processing. Термины: idempotency, retry, dedup, saga"]]),
      ["!Wiki/d/x/Orders.md"],
    );
    expect(result).toEqual(["!Wiki/d/x/Orders.md"]);
  });
```

- [ ] **Step 5: Run `lat check`**

Run: `lat check`
Expected: all wiki links and code refs pass; every new `tests.md` leaf is covered by exactly one `// @lat:` ref, and every ref points at an existing section.

> If `lat check` reports a section path mismatch, fix the `[[...]]` target to the exact heading text. If it reports an uncovered leaf, add the missing `// @lat:` on the corresponding test. Do not duplicate refs.

- [ ] **Step 6: Run the full test suite once more**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lat.md/architecture.md lat.md/operations.md lat.md/tests.md tests/chunker.test.ts tests/page-similarity.test.ts
git commit -m "docs(lat): multi-vector schema v2, chunker, max-pool query + test specs"
```

---

## Task 10: Outcome Verification (manual gates — run after the full build)

These spec health metrics carry **measurable bounds** but are not unit-testable: latency and precision depend on a live model + real corpus, and UI persistence depends on the Obsidian runtime. The spec (`§Acceptance`, `§Testing`) defers them to manual Outcome Verification. This task encodes them as explicit gates so they are not silently skipped. Run after Tasks 1–9 are merged and the plugin is reloaded against an already-embedded domain (vectors cached, no re-embed in the loop).

- [ ] **Step 1: Latency ≤ +15% (spec §Acceptance health metric)**

Pick a fixed set of ≥10 queries against an already-embedded domain. Measure query **seed-selection** wall-time on `master` (single-vector baseline) and on this branch — same queries, same domain, vectors already cached.
Expected (DoD): median seed-selection latency on this branch ≤ `1.15 ×` baseline median. Record both medians in the PR description.

- [ ] **Step 2: Precision — no result flooding (spec §Acceptance health metric)**

Run the same ≥10 queries. For each, inspect the returned seed set.
Expected (DoD): no query returns a seed set larger or noisier than baseline; the `seedTopK` cap and `seedMinScore` floor still bound the set (unchanged knobs). Record any query whose top results degraded vs baseline; zero degradations to pass.

- [ ] **Step 3: UI fields persist (spec testing-table row 10 — persistence half)**

In Obsidian → settings → "Semantic Search", set each of the four chunk controls (`Chunk size`, `Chunk overlap`, `Min chunk size`, `Max chunks per page`) to a non-default value. Close and reopen settings.
Expected (DoD): all four values persist across reopen (round-trip `onChange → saveSettings → settings.json`), and a subsequent ingest/lint run reflects them (chunk count changes, or value visible in a debug log).

- [ ] **Step 4: Record the verdict and escalate on failure**

Capture latency medians, precision notes, and the persistence result.
Expected (DoD): if latency > +15% or precision visibly degrades, escalate per spec **Stop rules** and apply the documented fallback lever (blended pool `0.7·max + 0.3·mean(top-3)` in the three select methods) before shipping. Otherwise mark the gate green in the PR.

---

## Self-Review

**1. Spec coverage** — every spec component maps to a task:

| Spec item | Task |
|-----------|------|
| Component 1 — Cache schema v2 (`version: 2`, `chunks[]`) | Task 1 |
| Component 2 — `splitSections` chunker (strip, H2/H3, merge, window, maxCount fold) | Task 2 |
| Component 2 — embed text prepend + per-chunk hash | Task 3 |
| Component 3 — Settings `chunk*` + defaults + UI | Task 6 |
| Component 4 — max-pool scoring in all three methods + Jaccard sentinel | Task 5 |
| Component 5 — annotation prompts cover all sections, one line | Task 8 |
| Component 6 — `refreshCache` body access (`pid → body` map) | Task 4 + Task 7 |
| Error handling — old cache → null; version rebuild; empty body → summary only; maxCount log; old settings → defaults | Tasks 1, 2, 4, 6 |
| Testing table (rows 1–9 + threading half of row 10) | Tasks 2, 4, 5, 6, 9 |
| Testing table row 10 — UI fields persist (persistence half) | Task 10 (manual gate) |
| Documentation (architecture/operations/tests + `lat check`) | Task 9 |
| Health metric — incrementality (only changed chunks re-embed) | Task 4 |
| Health metric — offline Jaccard with no API | Tasks 5, 9 (offline-keyword test) |
| Cost bound — ≤ `1 + chunkMaxCount` vectors per page | Enforced by `buildChunkInputs` (summary + ≤ `maxCount` sections); Task 2 maxCount cap |
| Health metric — query seed-selection latency ≤ +15% | Task 10 (manual gate, Step 1) |
| Health metric — precision (no result flooding) | Task 10 (manual gate, Step 2) |

**2. Placeholder scan** — no "TBD"/"add error handling"/"similar to Task N"; every code step shows full code; commands list exact `vitest`/`grep`/`lat` invocations with expected results.

**3. Type consistency** — names used consistently across tasks: `EmbeddingChunk` (`vector`/`hash`/`kind`), `EmbeddingCacheEntry.chunks`, `EmbeddingCacheFile.version`, `ChunkingConfig` (`maxChars`/`overlapChars`/`minChars`/`maxCount`), `DEFAULT_CHUNKING`, `splitSections` → `SectionWindow{heading,window}`, `buildChunkInputs` → `ChunkInput{kind,embedText,hash}`, `maxCosine`, `refreshCache(..., pageBodies)`. Settings fields `chunkMaxChars`/`chunkOverlapChars`/`chunkMinChars`/`chunkMaxCount` map 1:1 to `ChunkingConfig`. `updated` = chunk count (Tasks 4 & 7 agree).

**Open risk flagged in spec, carried here:** per-chunk hash includes the annotation, so editing the annotation re-embeds all of a page's chunks. Accepted trade-off (annotation and body change together in one ingest/lint pass). No action; documented in Task 3 / architecture.md.
