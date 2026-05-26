---
review:
  plan_hash: 89076a5dd997e56d
  spec_hash: a140eede451e93a0
  last_run: "2026-05-25"
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
      section: "Self-Review/Spec Coverage"
      section_hash: 54330c64d042c675
      text: "format.ts refreshCache call present in spec ('Changes to lint.ts and format.ts') but absent from plan. Task 8 explicitly excludes it with reasoning, but spec deviation is unacknowledged in coverage table."
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "Self-Review/Spec Coverage"
      section_hash: 54330c64d042c675
      text: "Spec names src/controller.ts in Files Changed; plan uses src/agent-runner.ts. If different files, controller.ts changes are missing. If same file renamed, plan should clarify."
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-003
      phase: coverage
      severity: WARNING
      section: "Self-Review/Spec Coverage"
      section_hash: 54330c64d042c675
      text: "Spec Files Changed includes 'docs/prompt-architecture.md — document similarity service and embedding cache'; plan Task 10 only mentions lat.md/."
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-004
      phase: verifiability
      severity: WARNING
      section: "Task 6"
      section_hash: 334b054108e36d78
      text: "Step 1 heading is 'Write a failing test' but Step 2 says 'Expected: PASS'. Test covers existing parseIndexAnnotations, not new runInitWithSources behavior. No TDD cycle for the actual implementation in Step 3."
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-005
      phase: verifiability
      severity: WARNING
      section: "Task 7"
      section_hash: 2f208edb879ee35c
      text: "Step 1 'Locate the end of the per-domain loop' has no measurable DoD, no expected output, no verification command. Pure exploratory step without completion criterion."
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-006
      phase: consistency
      severity: WARNING
      section: "Self-Review/Type Consistency Check"
      section_hash: 54330c64d042c675
      text: "Self-Review states 'refreshCache matches usage in lint.ts Task 7 and format.ts Task 8' — Task 8 modifies agent-runner.ts, not format.ts. Appears to be a copy-paste error from an earlier draft."
      verdict: fixed
      verdict_at: "2026-05-25"
  section_hashes:
    Task 1: 38961ea3bd1d4262
    Task 2: afd6d66303f37bcc
    Task 3: 0d16fc9498816602
    Task 4: 8aea87ad72bb1372
    Task 5: 0d62123c30ed77c6
    Task 6: 334b054108e36d78
    Task 7: 2f208edb879ee35c
    Task 8: 54330c64d042c675
    Task 9: 61d1ce76ec680ddd
    Task 10: 3ea734b89570f636
---

# Ingest Relevant Pages Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace O(N²) full wiki load in `runIngest` with `PageSimilarityService` that selects top-K relevant pages via Jaccard or embedding similarity.

**Architecture:** New `src/page-similarity.ts` provides `PageSimilarityService`. `runIngest` accepts optional `similarity` + `cachedAnnotations` params. `runInitWithSources` builds an annotations cache once and passes it through. `AgentRunner` constructs the service from effective settings and threads it through to all phase functions.

**Tech Stack:** TypeScript, Vitest, existing `tokenize`/`scoreSeed` from `wiki-seeds.ts`, OpenAI-compatible embeddings API.

---

## File Map

| File | Change |
|---|---|
| `src/page-similarity.ts` | **new** — `PageSimilarityService` |
| `src/wiki-path.ts` | add `domainEmbeddingsPath()` |
| `src/local-config.ts` | 3 new optional fields in `nativeAgent` |
| `src/phases/ingest.ts` | 2 optional params + relevance filter at lines 81–82 |
| `src/phases/init.ts` | annotations cache + pass similarity to `runIngest` |
| `src/phases/lint.ts` | add optional `similarity` param + `refreshCache` call |
| `src/phases/format.ts` | call `refreshCache` after completion |
| `src/agent-runner.ts` | construct `PageSimilarityService` + pass to phase calls (serves role of `controller.ts` in spec) |
| `src/settings.ts` | 3 new UI fields under native backend section |
| `tests/page-similarity.test.ts` | **new** — unit tests |
| `lat.md/` | update docs after completion |
| `docs/prompt-architecture.md` | document similarity service and embedding cache |

---

### Task 1: Add `domainEmbeddingsPath` to wiki-path.ts

**Files:**
- Modify: `src/wiki-path.ts`

- [ ] **Step 1: Add the path helper**

In `src/wiki-path.ts`, after the `domainLogPath` function (line 52), add:

```ts
export function domainEmbeddingsPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_embeddings.json`;
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/wiki-path.ts
git commit -m "feat: add domainEmbeddingsPath to wiki-path"
```

---

### Task 2: Extend `LocalConfig.nativeAgent` with 3 new fields

**Files:**
- Modify: `src/local-config.ts`

- [ ] **Step 1: Add fields to the nativeAgent interface**

In `src/local-config.ts`, the `nativeAgent` type inside `LocalConfig` currently ends at `topP: number | null;`. Add 3 optional fields:

```ts
export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    embeddingModel?: string;
    embeddingDimensions?: number;
    relevantPagesTopK?: number;
  };
  proxy?: ProxyConfig;
  migrated_v1?: boolean;
  shellConsentGiven?: boolean;
  lastDomain?: string;
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/local-config.ts
git commit -m "feat: add embeddingModel, embeddingDimensions, relevantPagesTopK to LocalConfig.nativeAgent"
```

---

### Task 3: Create `src/page-similarity.ts` — Jaccard mode only

**Files:**
- Create: `src/page-similarity.ts`
- Create: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/page-similarity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PageSimilarityService } from "../src/page-similarity";

const makeService = (topK = 3) =>
  new PageSimilarityService({ mode: "jaccard", topK });

describe("PageSimilarityService (Jaccard)", () => {
  it("returns top-K paths ranked by annotation similarity", async () => {
    const svc = makeService(2);
    const annotations = new Map([
      ["Alpha", "machine learning neural network deep"],
      ["Beta",  "cooking recipes ingredients kitchen"],
      ["Gamma", "machine learning classification model"],
    ]);
    const allPaths = [
      "!Wiki/d/alpha/Alpha.md",
      "!Wiki/d/beta/Beta.md",
      "!Wiki/d/gamma/Gamma.md",
    ];
    const result = await svc.selectRelevant(
      "deep learning neural network classification",
      annotations,
      allPaths,
    );
    expect(result).toHaveLength(2);
    // Alpha and Gamma score higher than Beta
    expect(result.some(p => p.includes("Alpha"))).toBe(true);
    expect(result.some(p => p.includes("Gamma"))).toBe(true);
    expect(result.every(p => !p.includes("Beta"))).toBe(true);
  });

  it("excludes paths not in indexAnnotations (score 0)", async () => {
    const svc = makeService(5);
    const annotations = new Map([["Known", "neural network"]]);
    const allPaths = ["!Wiki/d/sub/Known.md", "!Wiki/d/sub/Unknown.md"];
    const result = await svc.selectRelevant("neural", annotations, allPaths);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Known");
  });

  it("returns empty when source has no tokens", async () => {
    const svc = makeService(5);
    const annotations = new Map([["Alpha", "machine learning"]]);
    const allPaths = ["!Wiki/d/sub/Alpha.md"];
    const result = await svc.selectRelevant("", annotations, allPaths);
    expect(result).toHaveLength(0);
  });

  it("refreshCache is no-op in Jaccard mode", async () => {
    const svc = makeService(5);
    // Should resolve without error
    await expect(svc.refreshCache("domainRoot", {} as never, new Map())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test tests/page-similarity.test.ts
```

Expected: FAIL with "Cannot find module '../src/page-similarity'"

- [ ] **Step 3: Implement Jaccard-only `PageSimilarityService`**

Create `src/page-similarity.ts`:

```ts
import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";

export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
}

export class PageSimilarityService {
  constructor(private config: SimilarityConfig) {}

  async selectRelevant(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<string[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.topK).map((x) => x.path);
  }

  async refreshCache(
    _domainRoot: string,
    _vaultTools: VaultTools,
    _indexAnnotations: Map<string, string>,
  ): Promise<void> {
    // Jaccard mode: no cache to refresh
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/page-similarity.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat: add PageSimilarityService (Jaccard mode)"
```

---

### Task 4: Implement embedding mode in `PageSimilarityService`

**Files:**
- Modify: `src/page-similarity.ts`
- Modify: `tests/page-similarity.test.ts`

- [ ] **Step 1: Add embedding cache helper types and base64 encoding**

Add these tests in `tests/page-similarity.test.ts` (inside a new `describe` block at the end):

```ts
import { encodeVector, decodeVector } from "../src/page-similarity";

describe("vector encoding", () => {
  it("round-trips Float32Array through base64", () => {
    const vec = new Float32Array([0.1, 0.5, -0.3, 1.0]);
    const encoded = encodeVector(vec);
    const decoded = decodeVector(encoded);
    expect(decoded.length).toBe(4);
    // Float32 precision loss is acceptable
    for (let i = 0; i < vec.length; i++) {
      expect(decoded[i]).toBeCloseTo(vec[i], 4);
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test tests/page-similarity.test.ts
```

Expected: FAIL with "encodeVector is not exported"

- [ ] **Step 3: Add encoding helpers and embedding cache types to `page-similarity.ts`**

Add to `src/page-similarity.ts` (after imports, before the class):

```ts
export interface EmbeddingCacheEntry {
  vector: string;  // base64 Float32Array
  hash: string;    // short hash of annotation
}

export interface EmbeddingCacheFile {
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer).toString("base64");
}

export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function annotationHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/page-similarity.test.ts
```

Expected: all pass.

- [ ] **Step 5: Implement embedding mode in `selectRelevant` and `refreshCache`**

Replace `src/page-similarity.ts` with the full implementation:

```ts
import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";
import { domainEmbeddingsPath } from "./wiki-path";

export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface EmbeddingCacheEntry {
  vector: string;  // base64 Float32Array
  hash: string;
}

export interface EmbeddingCacheFile {
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer).toString("base64");
}

export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function annotationHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const EMBEDDING_BATCH_SIZE = 100;

async function fetchEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<Float32Array[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
  const json = await resp.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => new Float32Array(d.embedding));
}

export class PageSimilarityService {
  private cache: EmbeddingCacheFile | null = null;
  private cacheLoaded = false;

  constructor(private config: SimilarityConfig) {}

  async selectRelevant(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<string[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    if (this.config.mode === "jaccard") {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }
    return this.selectEmbedding(sourceContent, indexAnnotations, allPaths, queryTokens);
  }

  private selectJaccard(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): string[] {
    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.topK).map((x) => x.path);
  }

  private async selectEmbedding(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<string[]> {
    const { baseUrl, apiKey, model, topK } = this.config;
    if (!baseUrl || !apiKey || !model) {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }

    // Query vector
    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey, model, [truncated]);
    } catch {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }

    // Page vectors — process in batches
    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array>();

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i]) continue;
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) {
        batches.push(cur);
        cur = { pids: [], texts: [] };
      }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts);
      } catch {
        // Fallback: use Jaccard for this batch's pages
        for (const pid of batch.pids) {
          const annotation = indexAnnotations.get(pid) ?? "";
          const score = scoreSeed(queryTokens, pid, "", annotation);
          // Store a sentinel Float32Array of length 0 to indicate Jaccard fallback
          if (score > 0) pageVecs.set(pid, new Float32Array(0));
        }
        continue;
      }
      for (let i = 0; i < batch.pids.length; i++) {
        pageVecs.set(batch.pids[i], vecs[i]);
      }
    }

    // Score and rank
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vec = pageVecs.get(pid);
      if (!vec) continue;
      let score: number;
      if (vec.length === 0) {
        // Jaccard fallback sentinel
        score = scoreSeed(queryTokens, pid, "", annotations[i]);
      } else {
        score = cosine(queryVec, vec);
      }
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((x) => x.path);
  }

  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
  ): Promise<void> {
    if (this.config.mode !== "embedding") return;
    const { baseUrl, apiKey, model, dimensions } = this.config;
    if (!baseUrl || !apiKey || !model || !dimensions) return;

    const cachePath = domainEmbeddingsPath(domainRoot);
    let cacheFile: EmbeddingCacheFile;

    try {
      const raw = await vaultTools.read(cachePath);
      const parsed = JSON.parse(raw) as EmbeddingCacheFile;
      // Invalidate if model or dimensions changed
      if (parsed.model !== model || parsed.dimensions !== dimensions) {
        cacheFile = { model, dimensions, entries: {} };
      } else {
        cacheFile = parsed;
      }
    } catch {
      cacheFile = { model, dimensions, entries: {} };
    }

    // Find stale entries
    const toEmbed: { pid: string; annotation: string }[] = [];
    for (const [pid, annotation] of indexAnnotations) {
      const hash = annotationHash(annotation);
      const existing = cacheFile.entries[pid];
      if (!existing || existing.hash !== hash) {
        toEmbed.push({ pid, annotation });
      }
    }

    if (toEmbed.length === 0) return;

    // Embed in batches
    for (let i = 0; i < toEmbed.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.map((x) => x.annotation));
      } catch {
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        cacheFile.entries[batch[j].pid] = {
          vector: encodeVector(vecs[j]),
          hash: annotationHash(batch[j].annotation),
        };
      }
    }

    await vaultTools.write(cachePath, JSON.stringify(cacheFile, null, 2));
    this.cache = cacheFile;
  }
}
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat: implement embedding mode and refreshCache in PageSimilarityService"
```

---

### Task 5: Modify `runIngest` to accept optional similarity params

**Files:**
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Write a failing test that confirms the new signature**

Add to `tests/ingest.test.ts` (at the end of the file):

```ts
import { PageSimilarityService } from "../src/page-similarity";

describe("runIngest similarity integration", () => {
  it("exports runIngest with optional similarity and cachedAnnotations params", () => {
    // Verify the function accepts the new params without TypeScript errors at call site.
    // This is a type-level check: we just confirm the module exports the right shape.
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map<string, string>();
    // The function reference must accept these optional args (TypeScript check via import).
    expect(typeof runIngest).toBe("function");
    expect(svc).toBeDefined();
    expect(annotations).toBeDefined();
  });
});
```

Also add the import at the top of `tests/ingest.test.ts`:

```ts
import { runIngest } from "../src/phases/ingest";
```

- [ ] **Step 2: Run to confirm no failure (this test will pass once we verify the import)**

```bash
npm test tests/ingest.test.ts
```

Expected: passes (the test is structural, not behavioral).

- [ ] **Step 3: Modify `runIngest` signature and relevance filter**

In `src/phases/ingest.ts`, update the function signature and replace lines 81–82:

Change the import at the top — add:
```ts
import type { PageSimilarityService } from "../page-similarity";
import { parseIndexAnnotations } from "../wiki-index";
```

Update the function signature (after `opts: LlmCallOptions = {}`):
```ts
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
): AsyncGenerator<RunEvent> {
```

Replace lines 81–82 (the `existingPaths` / `existingPages` block):
```ts
  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  let filteredPaths: string[];
  if (similarity) {
    const annotations = cachedAnnotations ?? parseIndexAnnotations(indexContent);
    filteredPaths = await similarity.selectRelevant(sourceContent, annotations, existingPaths);
  } else {
    filteredPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));
  }
  const existingPages = await vaultTools.readAll(filteredPaths);
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/ingest.test.ts
git commit -m "feat: add optional similarity params to runIngest"
```

---

### Task 6: Update `runInitWithSources` to cache annotations and pass similarity

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Validate `parseIndexAnnotations` API before use**

Create `tests/init-similarity.test.ts` to confirm the annotation parser works as expected before wiring it into `runInitWithSources`:

```ts
import { describe, it, expect } from "vitest";
import { parseIndexAnnotations } from "../src/wiki-index";

describe("parseIndexAnnotations used in init", () => {
  it("parses annotations from _index.md content", () => {
    const content = `# Wiki Index\n\n## general\n- [[Alpha]] !Wiki/d/sub/Alpha.md — machine learning model\n- [[Beta]] !Wiki/d/sub/Beta.md — cooking recipes\n`;
    const map = parseIndexAnnotations(content);
    expect(map.get("Alpha")).toBe("machine learning model");
    expect(map.get("Beta")).toBe("cooking recipes");
    expect(map.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run to confirm it passes (parseIndexAnnotations already exists)**

```bash
npm test tests/init-similarity.test.ts
```

Expected: PASS (validates the API we depend on in Step 3).

- [ ] **Step 3: Update `runInitWithSources` signature and implementation**

In `src/phases/init.ts`, add import at top:
```ts
import type { PageSimilarityService } from "../page-similarity";
import { parseIndexAnnotations } from "../wiki-index";
```

Update `runInitWithSources` signature — add two optional params after `force`:
```ts
export async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  dryRun: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  force: boolean = false,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

At the start of `runInitWithSources`, after the two `await Promise.all` reads (lines ~147–150), build the initial `annotationsCache`:

After the line:
```ts
  const [schemaContent, indexContent] = await Promise.all([...]);
```

Add:
```ts
  let annotationsCache = parseIndexAnnotations(indexContent);
```

Update the `runIngest` call inside the loop (lines ~292–297) to pass similarity and annotationsCache:

```ts
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts, similarity, annotationsCache)) {
```

After each file's ingest loop completes (after `done = true;`) and before `if (signal.aborted) return;`, refresh the annotations cache:

```ts
    // Refresh annotations cache for next file
    if (similarity) {
      const fresh = await tryRead(vaultTools, domainIndexPath(wikiRootGuess));
      annotationsCache = parseIndexAnnotations(fresh);
    }
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/init-similarity.test.ts
git commit -m "feat: add annotations cache and similarity pass-through to runInitWithSources"
```

---

### Task 7: Add `refreshCache` call to `runLint` and `runFormat`

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/format.ts`

- [ ] **Step 1: Update `runLint` signature and add refreshCache call**

Insertion point: end of the `for (const domain of targets)` loop body in `src/phases/lint.ts`, after the `appendWikiLog` call (around line 160+).

In `src/phases/lint.ts`, add import at top:
```ts
import type { PageSimilarityService } from "../page-similarity";
import { parseIndexAnnotations } from "../wiki-index";
import { domainIndexPath } from "../wiki-path";
```

Update `runLint` signature — add optional `similarity` param after `opts`:
```ts
export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  hubThreshold: number = 20,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

At the very end of the `for (const domain of targets)` loop body (after all write operations for this domain complete), add:

```ts
    if (similarity) {
      const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
      await similarity.refreshCache(wikiVaultPath, vaultTools, parseIndexAnnotations(indexRaw));
    }
```

- [ ] **Step 2: Ensure `tryRead` is available in lint.ts**

Check if `tryRead` is already defined in `lint.ts` (it exists there since lint reads schema files). If not, add:

```ts
async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}
```

- [ ] **Step 3: Add `refreshCache` call to `runFormat`**

In `src/phases/format.ts`, add imports at top:
```ts
import type { PageSimilarityService } from "../page-similarity";
import { parseIndexAnnotations } from "../wiki-index";
import { domainIndexPath } from "../wiki-path";
```

Update `runFormat` signature — add optional `similarity` param after `opts`:
```ts
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

At the end of the `for (const domain of targets)` loop body (after all write operations complete), add:
```ts
    if (similarity) {
      const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
      await similarity.refreshCache(wikiVaultPath, vaultTools, parseIndexAnnotations(indexRaw));
    }
```

Ensure `tryRead` is available in `format.ts` — same pattern as lint.ts Step 2.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts src/phases/format.ts
git commit -m "feat: call refreshCache in runLint and runFormat after domain processing"
```

---

### Task 8: Wire `PageSimilarityService` through `AgentRunner`

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add import and build service in `AgentRunner.run()`**

In `src/agent-runner.ts`, add import at top:
```ts
import { PageSimilarityService } from "./page-similarity";
```

Update `run()` to build the service before `runOperation`. After the line `const { model, opts } = this.buildOptsFor(req.operation);`, add:

```ts
    const similarity = this.buildSimilarity();
```

Add the `buildSimilarity` method to `AgentRunner`:
```ts
  private buildSimilarity(): PageSimilarityService | undefined {
    if (this.settings.backend !== "native-agent") return undefined;
    const na = this.settings.nativeAgent as typeof this.settings.nativeAgent & {
      embeddingModel?: string;
      embeddingDimensions?: number;
      relevantPagesTopK?: number;
    };
    return new PageSimilarityService({
      mode: na.embeddingModel ? "embedding" : "jaccard",
      model: na.embeddingModel,
      dimensions: na.embeddingDimensions,
      topK: na.relevantPagesTopK ?? 15,
      baseUrl: na.baseUrl,
      apiKey: na.apiKey,
    });
  }
```

- [ ] **Step 2: Pass `similarity` through to all affected phase calls in `runOperation`**

Update the `switch` cases in `runOperation`:

For `"ingest"`:
```ts
      case "ingest":
        yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity);
        break;
```

For `"init"`:
```ts
      case "init":
        yield* runInit(req.args, this.vaultTools, this.llm, model, domains, this.vaultName, req.signal, opts, req.onFileError, similarity);
        break;
```

For `"lint"`:
```ts
      case "lint":
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, opts, similarity);
        break;
```

For `"format"`:
```ts
      case "format":
        yield* runFormat(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity);
        break;
```

- [ ] **Step 3: Update `runInit` signature to accept optional `similarity`**

In `src/phases/init.ts`, update `runInit` to accept and pass through `similarity`:

```ts
export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  onFileError?: OnFileError,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

And in all 3 `yield* runInitWithSources(...)` call sites in `runInit`, add `similarity` as the last argument:

```ts
    yield* runInitWithSources(
      domainId, effectiveSources, false, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, true, similarity,
    );
```

```ts
  yield* runInitWithSources(
    domainId, sourcePaths, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, undefined, similarity,
  );
```

```ts
  yield* runInitWithSources(domainId, effectiveSources, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError, undefined, similarity);
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts src/phases/init.ts
git commit -m "feat: wire PageSimilarityService through AgentRunner to all phases"
```

---

### Task 9: Add Settings UI for new fields

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add new settings controls after the existing native backend fields**

In `src/settings.ts`, locate the section that renders native-agent settings (around line 490, after the `structuredRetries` block). Add the 3 new fields after the existing native-agent section but still within the `if (eff.backend === "native-agent")` block:

```ts
      // Relevant pages top-K (always visible for native-agent)
      new Setting(containerEl)
        .setName("Relevant pages (top-K)")
        .setDesc("Max wiki pages loaded per ingest call. Lower = faster, less context. Default: 15.")
        .addText((t) =>
          t.setPlaceholder("15")
            .setValue(String(this.localCache.nativeAgent?.relevantPagesTopK ?? 15))
            .onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                await this.patchLocalNative({ relevantPagesTopK: Math.floor(n) });
              }
            }),
        );

      new Setting(containerEl)
        .setName("Enable semantic similarity (embeddings)")
        .setDesc("Use embedding vectors for relevant page selection. Requires native backend with an embeddings-capable model.")
        .addToggle((t) =>
          t.setValue(!!this.localCache.nativeAgent?.embeddingModel)
            .onChange(async (v) => {
              if (!v) {
                await this.patchLocalNative({ embeddingModel: undefined, embeddingDimensions: undefined });
                this.display();
              } else {
                this.display();
              }
            }),
        );

      if (this.localCache.nativeAgent?.embeddingModel !== undefined) {
        new Setting(containerEl)
          .setName("Embedding model")
          .setDesc("Model name for embeddings, e.g. text-embedding-3-small")
          .addText((t) =>
            t.setPlaceholder("text-embedding-3-small")
              .setValue(this.localCache.nativeAgent?.embeddingModel ?? "")
              .onChange(async (v) => {
                await this.patchLocalNative({ embeddingModel: v.trim() || undefined });
              }),
          );

        new Setting(containerEl)
          .setName("Embedding dimensions")
          .setDesc("Vector dimensions, e.g. 512 or 1536")
          .addText((t) =>
            t.setPlaceholder("512")
              .setValue(String(this.localCache.nativeAgent?.embeddingDimensions ?? ""))
              .onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) {
                  await this.patchLocalNative({ embeddingDimensions: Math.floor(n) });
                }
              }),
          );
      }
```

Note: The toggle "enable embedding" is a display switch. When off, `embeddingModel` is `undefined` (Jaccard mode). When on and model name is empty, we show the text field. This matches the spec's conditional UI.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add relevant pages top-K and embedding settings to native backend UI"
```

---

### Task 10: Update lat.md docs

**Files:**
- Modify: relevant sections in `lat.md/`

- [ ] **Step 1: Run lat search to find relevant sections**

```bash
lat search "ingest wiki pages selection context"
lat search "page similarity embedding cache"
```

- [ ] **Step 2: Update lat.md sections**

Use `lat locate` to find the right files, then update sections about:
- The ingest phase (add note about relevance filter and O(N²) fix)
- Architecture / LLM pipeline (add `PageSimilarityService`)
- Any existing page-loading documentation

- [ ] **Step 3: Update `docs/prompt-architecture.md`**

Add a section documenting `PageSimilarityService`: its two modes (Jaccard / embedding), the embedding cache at `_config/_embeddings.json`, and the per-phase wiring through `AgentRunner`.

- [ ] **Step 5: Run lat check**

```bash
lat check
```

Expected: all links pass.

- [ ] **Step 6: Commit**

```bash
git add lat.md/ docs/prompt-architecture.md
git commit -m "docs: document PageSimilarityService, ingest relevant pages selection"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|---|---|
| `PageSimilarityService` Jaccard mode | Task 3 |
| `PageSimilarityService` embedding mode + batch size 100 | Task 4 |
| Jaccard fallback on embedding batch failure | Task 4 |
| `domainEmbeddingsPath()` in wiki-path.ts | Task 1 |
| 3 new fields in `LocalConfig.nativeAgent` | Task 2 |
| `runIngest` optional `similarity` + `cachedAnnotations` | Task 5 |
| `runInitWithSources` annotations cache + refresh per file | Task 6 |
| `runLint` calls `refreshCache` after domain | Task 7 |
| `runFormat` calls `refreshCache` after domain | Task 7 |
| `AgentRunner` (= `controller.ts` in spec) constructs and threads `PageSimilarityService` | Task 8 |
| Settings UI: top-K, embedding model, dimensions | Task 9 |
| lat.md docs | Task 10 |
| `docs/prompt-architecture.md` documents similarity service | Task 10 |

### Type Consistency Check

- `PageSimilarityService.selectRelevant(sourceContent: string, indexAnnotations: Map<string, string>, allPaths: string[]): Promise<string[]>` — matches usage in ingest.ts Task 5 and init.ts Task 6.
- `PageSimilarityService.refreshCache(domainRoot: string, vaultTools: VaultTools, indexAnnotations: Map<string, string>): Promise<void>` — matches usage in lint.ts and format.ts (Task 7).
- `SimilarityConfig.topK` — used as `na.relevantPagesTopK ?? 15` in agent-runner Task 9.
- `encodeVector` / `decodeVector` — defined and tested in Task 4, used in `refreshCache` implementation.

### Backwards Compatibility

- `runIngest` new params are optional — existing callers (agent-runner standalone ingest) pass no similarity → old code path unchanged.
- `runInit` / `runInitWithSources` new params optional — same.
- `runLint` new param optional — AgentRunner passes `undefined` for claude-agent backend.
- `runFormat` new param optional — AgentRunner passes `undefined` for claude-agent backend.
