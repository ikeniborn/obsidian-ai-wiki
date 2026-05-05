# Vault-relative Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `repoRoot`-relative path storage in `DomainEntry` with vault-relative paths, eliminating the `repoRoot` concept from the codebase.

**Architecture:** `vaultRoot = app.vault.adapter.getBasePath()` becomes the single anchor for all path resolution. `wiki_folder` and `source_paths` are stored as vault-relative strings (e.g. `"!Wiki/ии"`, `"notes/ai/"`). All phase functions receive `vaultRoot` instead of `repoRoot`. Phase path resolution changes from `join(repoRoot, path)` to `join(vaultRoot, path)`.

**Tech Stack:** TypeScript, Node.js `node:path`, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/source-paths.ts` | rename param `repoRoot` → `vaultRoot` |
| `src/phases/ingest.ts` | `extractParentSourcePath` new sig; `detectDomain` vaultRoot; `runIngest` vaultRoot |
| `src/phases/query.ts` | `runQuery` vaultRoot |
| `src/phases/lint.ts` | `runLint` vaultRoot |
| `src/phases/fix.ts` | `runFix` vaultRoot |
| `src/phases/init.ts` | remove `repoRoot` param; normalize `wiki_folder` after JSON parse |
| `src/agent-runner.ts` | `runOperation` vaultRoot; `run()` vaultRoot |
| `src/controller.ts` | `registerDomain` drop vaultPrefix; `dispatch`/`dispatchChat` drop repoRoot |
| `src/view.ts` | `wikiRoot` computation drop vaultPrefix stripping |
| `src/domain-map.ts` | update comment in `AddDomainInput` |
| `tests/source-paths.test.ts` | rename ROOT → VAULT_ROOT, rename call params |
| `tests/ingest.test.ts` | replace `extractParentSourcePath` tests; rename `detectDomain` call params |
| `tests/phases/ingest.test.ts` | update domain fixture; update runIngest calls and expected values |
| `tests/phases/query.test.ts` | update domain fixture and `runQuery` calls |
| `tests/phases/lint.test.ts` | update domain fixture and `runLint` calls |
| `tests/phases/init.test.ts` | remove `repoRoot` from `runInit` calls; update wiki_folder expectation |

---

## Task 1: `consolidateSourcePaths` — rename parameter

**Files:**
- Modify: `src/source-paths.ts`
- Modify: `tests/source-paths.test.ts`

- [ ] **Step 1: Run existing tests to confirm they pass**

```bash
npx vitest run tests/source-paths.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 2: Rename parameter in `src/source-paths.ts`**

Replace entire file content:

```typescript
import { isAbsolute, join } from "node:path";

/**
 * Returns updated source_paths after adding newPath with consolidation:
 * - If newPath is already covered by an existing ancestor → returns existing unchanged
 * - Removes entries that are descendants of newPath (they become redundant)
 * - Adds newPath
 */
export function consolidateSourcePaths(
  existing: string[],
  newPath: string,
  vaultRoot: string,
): string[] {
  const toAbs = (p: string): string => (isAbsolute(p) ? p : join(vaultRoot, p));
  const normed = (p: string): string => {
    const a = toAbs(p);
    return a.endsWith("/") ? a : a + "/";
  };

  const newNormed = normed(newPath);

  // Already covered by an existing ancestor?
  if (existing.some((sp) => newNormed.startsWith(normed(sp)))) {
    return existing;
  }

  // Remove descendants (paths that start with newNormed)
  const filtered = existing.filter((sp) => !normed(sp).startsWith(newNormed));

  return [...filtered, newPath];
}
```

- [ ] **Step 3: Update `tests/source-paths.test.ts`** — rename ROOT → VAULT_ROOT

```typescript
import { describe, it, expect } from "vitest";
import { consolidateSourcePaths } from "../src/source-paths";

const VAULT_ROOT = "/project";

describe("consolidateSourcePaths", () => {
  it("adds path to empty list", () => {
    expect(consolidateSourcePaths([], "notes/", VAULT_ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when new path is already covered by ancestor", () => {
    expect(consolidateSourcePaths(["notes/"], "notes/sub/", VAULT_ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when identical path already exists", () => {
    expect(consolidateSourcePaths(["notes/"], "notes/", VAULT_ROOT))
      .toEqual(["notes/"]);
  });

  it("replaces deeper descendants when ancestor is added", () => {
    const result = consolidateSourcePaths(["notes/sub/", "docs/"], "notes/", VAULT_ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("docs/");
    expect(result).not.toContain("notes/sub/");
  });

  it("replaces multiple descendants", () => {
    const result = consolidateSourcePaths(["notes/a/", "notes/b/", "other/"], "notes/", VAULT_ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("other/");
    expect(result).not.toContain("notes/a/");
    expect(result).not.toContain("notes/b/");
  });

  it("no overlap — both paths kept", () => {
    const result = consolidateSourcePaths(["docs/"], "notes/", VAULT_ROOT);
    expect(result).toContain("docs/");
    expect(result).toContain("notes/");
  });

  it("handles absolute existing paths mixed with relative new path", () => {
    const result = consolidateSourcePaths(["/project/notes/sub/"], "notes/", VAULT_ROOT);
    expect(result).toContain("notes/");
    expect(result).not.toContain("/project/notes/sub/");
  });

  it("handles absolute new path with relative existing", () => {
    const result = consolidateSourcePaths(["notes/sub/"], "/project/notes/", VAULT_ROOT);
    expect(result).toContain("/project/notes/");
    expect(result).not.toContain("notes/sub/");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/source-paths.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/source-paths.ts tests/source-paths.test.ts
git commit -m "refactor(source-paths): rename repoRoot param to vaultRoot"
```

---

## Task 2: `extractParentSourcePath` — vault-relative output

**Files:**
- Modify: `src/phases/ingest.ts` (lines 205–216 only)
- Modify: `tests/ingest.test.ts` (extractParentSourcePath section)

- [ ] **Step 1: Write new failing tests for `extractParentSourcePath` in `tests/ingest.test.ts`**

Replace the `describe("extractParentSourcePath", ...)` block (lines 5–53) with:

```typescript
describe("extractParentSourcePath", () => {
  const VAULT = "/vaults/Work";

  it("returns vault-relative parent from deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/ai/article.md", VAULT))
      .toBe("notes/ai/");
  });

  it("returns vault-relative parent from one-level deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/file.md", VAULT))
      .toBe("notes/");
  });

  it("clamps to vault root when file is directly in vault", () => {
    expect(extractParentSourcePath("/vaults/Work/file.md", VAULT))
      .toBe("./");
  });

  it("clamps to vault root when parent is above vault", () => {
    expect(extractParentSourcePath("/outside/file.md", VAULT))
      .toBe("./");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/ingest.test.ts
```
Expected: the 4 new `extractParentSourcePath` tests FAIL (wrong arg count or wrong return value).

- [ ] **Step 3: Update `extractParentSourcePath` in `src/phases/ingest.ts`**

Replace lines 205–216:

```typescript
export function extractParentSourcePath(
  absSource: string,
  vaultRoot: string,
): string {
  const parentAbs = dirname(absSource);
  // Clamp: не выходить выше vault root
  const normedVault = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const clamped = (parentAbs + "/").startsWith(normedVault) ? parentAbs : vaultRoot;
  const rel = relative(vaultRoot, clamped);
  return (rel || ".") + "/";
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/ingest.test.ts
```
Expected: all `extractParentSourcePath` tests PASS (detectDomain tests may still use old repoRoot call — that's OK for now).

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/ingest.test.ts
git commit -m "refactor(ingest): extractParentSourcePath returns vault-relative path"
```

---

## Task 3: `detectDomain` — vaultRoot parameter

**Files:**
- Modify: `src/phases/ingest.ts` (line 141 and 144 only)
- Modify: `tests/ingest.test.ts` (`detectDomain` section)

- [ ] **Step 1: Update `detectDomain` call sites in tests first — confirm old tests still run**

```bash
npx vitest run tests/ingest.test.ts
```
Expected: detectDomain tests PASS with 3-arg call.

- [ ] **Step 2: Update `detectDomain` in `src/phases/ingest.ts`**

Replace lines 141–150:

```typescript
export function detectDomain(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = isAbsolute(sp) ? sp : join(vaultRoot, sp);
      return absFilePath.startsWith(abs);
    });
    if (matched) return d;
  }
  return domains[0] ?? null;
}
```

- [ ] **Step 3: Update `detectDomain` tests in `tests/ingest.test.ts`**

Replace the `describe("detectDomain", ...)` block (lines 56–76) with:

```typescript
describe("detectDomain", () => {
  const VAULT = "/project";
  const makeD = (id: string, paths: string[]): DomainEntry => ({
    id, name: id, wiki_folder: `!Wiki/${id}`, source_paths: paths,
  });

  it("matches by source_paths prefix", () => {
    const domains = [makeD("d1", ["notes/"]), makeD("d2", ["docs/"])];
    const result = detectDomain("/project/notes/sub/file.md", domains, VAULT);
    expect(result?.id).toBe("d1");
  });

  it("falls back to first domain if no match", () => {
    const domains = [makeD("fallback", []), makeD("other", ["docs/"])];
    const result = detectDomain("/project/unknown/file.md", domains, VAULT);
    expect(result?.id).toBe("fallback");
  });

  it("returns null if domains empty", () => {
    expect(detectDomain("/project/file.md", [], VAULT)).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/ingest.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/ingest.test.ts
git commit -m "refactor(ingest): detectDomain uses vaultRoot instead of repoRoot"
```

---

## Task 4: `runIngest` — vaultRoot parameter and vault-relative paths

**Files:**
- Modify: `src/phases/ingest.ts` (lines 10–126)
- Modify: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Update domain fixture and tests in `tests/phases/ingest.test.ts`**

Replace the entire file:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runIngest, extractParentSourcePath } from "../../src/phases/ingest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain-map";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(responseText: string): LlmClient {
  const fakeStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseText } }] };
    },
  };
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue(fakeStream) } },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "!Wiki/work",
  source_paths: ["Sources/"],
};

describe("runIngest", () => {
  it("yields error when args is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest([], vt, makeLlm("[]"), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when source file is outside vault", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest(["/external/file.md"], vt, makeLlm("[]"), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("writes pages returned by LLM", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity\n\nFact." },
    ]);
    const events = await collect(
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
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/Entity.md", "# Entity\n\nFact.");
  });

  it("yields source_path_added when new parent folder encountered", async () => {
    const domainWithoutPath: DomainEntry = { ...domain, source_paths: [] };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity" },
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/ИИ/subfolder/file.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domainWithoutPath],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("ИИ/subfolder/");
    expect(ev.domainId).toBe("work");
  });

  it("yields source_path_added with direct parent path", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity" },
    ]);
    const events = await collect(
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
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("Sources/");
    expect(ev.domainId).toBe("work");
  });

  it("yields result with count=0 when LLM returns empty array", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("content") });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm("[]"),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toMatch(/новых или изменённых страниц нет/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/phases/ingest.test.ts
```
Expected: tests FAIL (old repoRoot signature, old path format).

- [ ] **Step 3: Fix pre-existing bug in `updateIndex()` at line 190**

Line 190 contains `PIIp((p) => {` which is undefined — replace with `written.map((p) => {`:

```typescript
const newLinks = written.map((p) => {
  const name = p.split("/").pop()?.replace(/\.md$/, "") ?? p;
  return `- [[${name}]]`;
}).join("\n");
```

- [ ] **Step 4: Update `runIngest` in `src/phases/ingest.ts`**

Change the function signature (line 10–19) and internal lines 26, 43, 49, 121:

```typescript
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "ingest: file path required" };
    return;
  }

  const absSource = isAbsolute(filePath) ? filePath : join(vaultRoot, filePath);
  // ... rest of function unchanged until line 43:
  const domain = detectDomain(absSource, domains, vaultRoot);
  // ... line 49:
  const absWiki = join(vaultRoot, domain.wiki_folder);
  // ... line 121:
  const parentPath = extractParentSourcePath(absSource, vaultRoot);
```

Full replacement for lines 10–55 (the opening section of `runIngest`):

```typescript
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "ingest: file path required" };
    return;
  }

  const absSource = isAbsolute(filePath) ? filePath : join(vaultRoot, filePath);
  const sourceVaultPath = vaultTools.toVaultPath(absSource);
  if (!sourceVaultPath) {
    yield { kind: "error", message: `Source file ${filePath} is outside the vault.` };
    return;
  }

  yield { kind: "tool_use", name: "Read", input: { path: sourceVaultPath } };
  let sourceContent: string;
  try {
    sourceContent = await vaultTools.read(sourceVaultPath);
  } catch (e) {
    yield { kind: "error", message: `Cannot read ${sourceVaultPath}: ${(e as Error).message}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: sourceContent.slice(0, 100) };

  const domain = detectDomain(absSource, domains, vaultRoot);
  if (!domain) {
    yield { kind: "error", message: "No domain found for this file. Configure domain-map." };
    return;
  }

  const absWiki = join(vaultRoot, domain.wiki_folder);
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
    return;
  }
```

Also update line 121:

```typescript
    const parentPath = extractParentSourcePath(absSource, vaultRoot);
```

Also remove unused `isAbsolute` import if it becomes unused — but it's still used in `detectDomain`, so keep it.

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/phases/ingest.test.ts
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "refactor(ingest): runIngest uses vaultRoot, vault-relative paths; fix updateIndex bug"
```

---

## Task 5: `runQuery` — vaultRoot parameter

**Files:**
- Modify: `src/phases/query.ts` (lines 13–22 and line 36)
- Modify: `tests/phases/query.test.ts`

- [ ] **Step 1: Update domain fixture and test calls in `tests/phases/query.test.ts`**

Replace the domain and all `runQuery` calls:

```typescript
const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "!Wiki/work",
  source_paths: [],
};

const VAULT_ROOT = "/vaults/Work";
```

Change all `runQuery(..., "/vault", ...)` to `runQuery(..., VAULT_ROOT, ...)`.

Change `wiki_folder: "vaults/Work/!Wiki/work"` reference in list mock: `files: ["!Wiki/work/Page.md"]`.

Full updated `tests/phases/query.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../../src/phases/query";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain-map";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(answer: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: answer } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "!Wiki/work",
  source_paths: [],
};

describe("runQuery", () => {
  it("yields error when question is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery([], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields result with LLM answer", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("# Page\n\nSome fact."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(
        ["What is the answer?"],
        false,
        vt,
        makeLlm("The answer is 42."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("42");
  });

  it("saves answer page when save=true", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      read: vi.fn().mockResolvedValue(""),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runQuery(
        ["What is X?"],
        true,
        vt,
        makeLlm("X is Y."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(adapter.write).toHaveBeenCalled();
    const [savedPath] = (adapter.write as any).mock.calls[0];
    expect(savedPath).toMatch(/\.md$/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/phases/query.test.ts
```
Expected: tests FAIL (old repoRoot signature).

- [ ] **Step 3: Update `runQuery` in `src/phases/query.ts`**

Change signature (line 13) and path resolution (line 36):

```typescript
export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
```

Line 36 (absWiki resolution):
```typescript
  const absWiki = join(vaultRoot, domain.wiki_folder);
```

Remove unused `isAbsolute` from import on line 1 if it's no longer used (it's not used anywhere in query.ts after this change):
```typescript
import { join } from "node:path";
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/phases/query.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "refactor(query): runQuery uses vaultRoot, vault-relative paths"
```

---

## Task 6: `runLint` — vaultRoot parameter

**Files:**
- Modify: `src/phases/lint.ts` (signature line 13, path line 39)
- Modify: `tests/phases/lint.test.ts`

- [ ] **Step 1: Update `tests/phases/lint.test.ts`**

Replace domain fixture, VAULT_ROOT constant, and all `runLint` calls:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runLint } from "../../src/phases/lint";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain-map";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(report: string, configJson = "{}"): LlmClient {
  const streamResponse = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: report } }] };
    },
  };
  const nonStreamResponse = { choices: [{ message: { content: configJson } }] };
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params: any) =>
          Promise.resolve(params.stream ? streamResponse : nonStreamResponse)
        ),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "!Wiki/work",
  source_paths: [],
};

describe("runLint", () => {
  it("yields error when domains is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm(""), "model", [], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when specified domain not found", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runLint(["unknown-domain"], vt, makeLlm(""), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields result with report for existing domain", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(["work"], vt, makeLlm("No issues found."), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
  });

  it("yields domain_updated with entity_types from second LLM call", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const configJson = JSON.stringify({
      entity_types: [{ type: "концепция", description: "updated", extraction_cues: ["тест"], min_mentions_for_page: 1, wiki_subfolder: "work/концепции" }],
      language_notes: "Updated notes.",
    });
    const events = await collect(
      runLint(["work"], vt, makeLlm("Report.", configJson), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const ev = events.find((e: any) => e.kind === "domain_updated") as any;
    expect(ev).toBeDefined();
    expect(ev.domainId).toBe("work");
    expect(ev.patch.entity_types).toHaveLength(1);
    expect(ev.patch.language_notes).toBe("Updated notes.");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/phases/lint.test.ts
```
Expected: tests FAIL.

- [ ] **Step 3: Update `runLint` in `src/phases/lint.ts`**

Change signature (line 13) `repoRoot: string` → `vaultRoot: string`.

Change line 39:
```typescript
    const absWiki = join(vaultRoot, domain.wiki_folder);
```

Remove `isAbsolute` from import on line 1:
```typescript
import { join } from "node:path";
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/phases/lint.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "refactor(lint): runLint uses vaultRoot, vault-relative paths"
```

---

## Task 7: `runFix` — vaultRoot parameter

**Files:**
- Modify: `src/phases/fix.ts` (signature line 14, path line 36)

No dedicated test file for `runFix`. Coverage comes through `runLint` (which calls `runFix` internals) and the integration test.

- [ ] **Step 1: Update `runFix` in `src/phases/fix.ts`**

Change signature (line 14) `repoRoot: string` → `vaultRoot: string`.

Change line 36:
```typescript
  const absWiki = join(vaultRoot, domain.wiki_folder);
```

Remove `isAbsolute` from import on line 1:
```typescript
import { join } from "node:path";
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npx vitest run
```
Expected: all tests that currently pass still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/phases/fix.ts
git commit -m "refactor(fix): runFix uses vaultRoot, vault-relative paths"
```

---

## Task 8: `runInit` — remove repoRoot, normalize wiki_folder

**Files:**
- Modify: `src/phases/init.ts` (line 16 and lines 96–104)
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Update `tests/phases/init.test.ts`**

Three changes:
1. Remove `repoRoot` arg (`"/vault"`) from all `runInit` calls — shift `"TestVault"` to position 6.
2. Update `validDomainJson` fixture: LLM still returns old format; normalization in code will strip prefix.
3. Update line 123 expectation: `wiki_folder` becomes vault-relative after normalization.

Full updated `tests/phases/init.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain-map";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(json: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: json } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const existingDomain: DomainEntry = {
  id: "existing",
  name: "Existing",
  wiki_folder: "!Wiki/existing",
  source_paths: [],
};

// LLM may return old-format wiki_folder — normalization should strip prefix
const validDomainJson = JSON.stringify({
  id: "newdomain",
  name: "New Domain",
  wiki_folder: "vaults/TestVault/!Wiki/newdomain",
  source_paths: [],
  entity_types: [],
  language_notes: "",
});

describe("runInit", () => {
  it("yields error when domainId is empty", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit([], vt, makeLlm("{}"), "model", [], "TestVault", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when domain already exists", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(
        ["existing"],
        vt,
        makeLlm("{}"),
        "model",
        [existingDomain],
        "TestVault",
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("dry-run returns JSON preview without domain_created event", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain", "--dry-run"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("Dry run");
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });

  it("yields domain_created with vault-relative wiki_folder (normalization applied)", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const domainCreated = events.find((e: any) => e.kind === "domain_created") as any;
    expect(domainCreated).toBeDefined();
    expect(domainCreated.entry.id).toBe("newdomain");
    expect(domainCreated.entry.wiki_folder).toBe("!Wiki/newdomain");
  });

  it("yields result event after domain_created", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("newdomain");
  });
});

describe("runInit — ensureRootFiles", () => {
  it("создаёт _schema.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaCall = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    expect(schemaCall).toBeDefined();
    expect(schemaCall![1]).toContain("# Wiki Schema");
  });

  it("создаёт _index.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const indexCall = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(indexCall).toBeDefined();
    expect(indexCall![1]).toContain("# Wiki Index");
  });

  it("создаёт _log.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const logCall = writeCalls.find(([path]) => path.endsWith("_log.md"));
    expect(logCall).toBeDefined();
    expect(logCall![1]).toContain("# Wiki Log");
  });

  it("не перезаписывает существующие корневые файлы", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(true) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaWrite = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    const indexWrite = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(schemaWrite).toBeUndefined();
    expect(indexWrite).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/phases/init.test.ts
```
Expected: tests FAIL (wrong arg count, wrong wiki_folder value).

- [ ] **Step 3: Update `runInit` in `src/phases/init.ts`**

Remove `repoRoot: string` parameter (line 16). Add normalization after JSON parse (after line 100 in original, after `entry = JSON.parse(...)`):

New signature (lines 10–20):
```typescript
export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
```

After line `entry = JSON.parse(match[0]) as DomainEntry;` and before `if (!entry.id || !entry.wiki_folder)`, add:

```typescript
    // Normalize wiki_folder to vault-relative (strip vaults/<vaultName>/ prefix if LLM used old format)
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/phases/init.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "refactor(init): remove repoRoot param, normalize wiki_folder to vault-relative"
```

---

## Task 9: `AgentRunner` — propagate vaultRoot

**Files:**
- Modify: `src/agent-runner.ts` (lines 56–65, 101)

- [ ] **Step 1: Run integration tests to confirm baseline**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 2: Update `runOperation` signature and all phase calls in `src/agent-runner.ts`**

Change `runOperation` signature (line 60): `repoRoot: string` → `vaultRoot: string`.

Update all phase calls inside `runOperation` (lines 65–86):

```typescript
private async *runOperation(
  req: RunRequest,
  model: string,
  opts: LlmCallOptions,
  vaultRoot: string,
  domains: DomainEntry[],
): AsyncGenerator<RunEvent, void, void> {
  switch (req.operation) {
    case "ingest":
      yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
      break;
    case "query":
      yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
      break;
    case "query-save":
      yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
      break;
    case "lint":
      yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
      break;
    case "fix":
      yield* runFix(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, req.context, req.instruction);
      break;
    case "chat": {
      const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
      yield* runLintChat(this.llm, model, domain, req.signal, opts, req.context ?? "", req.chatMessages ?? []);
      break;
    }
    case "init":
      yield* runInit(req.args, this.vaultTools, this.llm, model, domains, this.vaultName, req.signal, opts);
      break;
    default: {
      const start = Date.now();
      yield { kind: "error", message: `Unknown operation: ${req.operation as string}` };
      yield { kind: "result", durationMs: Date.now() - start, text: "" };
    }
  }
}
```

Change `run()` (line 101): `const repoRoot = req.cwd ?? "";` → `const vaultRoot = req.cwd ?? "";`

Change call on line 109: `this.runOperation(req, model, opts, repoRoot, domains)` → `this.runOperation(req, model, opts, vaultRoot, domains)`

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```
Expected: all tests PASS.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "refactor(agent-runner): propagate vaultRoot to all phase functions"
```

---

## Task 10: `controller.ts` — drop repoRoot computation

**Files:**
- Modify: `src/controller.ts`

No unit tests for controller (depends on Obsidian API). Verify via build.

- [ ] **Step 1: Update `registerDomain()` — drop vaultPrefix**

In `registerDomain()` (around lines 133–158), replace:

```typescript
const vaultName = this.app.vault.getName();
const vaultPrefix = `vaults/${vaultName}`;
const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
s.domains.push({
  id,
  name: input.name.trim() || id,
  wiki_folder: `${vaultPrefix}/${wikiRelative}`,
```

With:

```typescript
const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
s.domains.push({
  id,
  name: input.name.trim() || id,
  wiki_folder: wikiRelative,
```

- [ ] **Step 2: Update `buildAgentRunner` signature**

Line 169 — rename unused parameter:

```typescript
private buildAgentRunner(vaultRoot: string): AgentRunner {
```

(Parameter is passed but not used in the body — rename keeps the call sites consistent.)

- [ ] **Step 3: Update `dispatch()` — drop repoRoot computation**

In `dispatch()` (around lines 220–226), replace:

```typescript
const vaultBasePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
const vaultName = this.app.vault.getName();
const vaultSuffix = `/vaults/${vaultName}`;
const repoRoot = vaultBasePath.endsWith(vaultSuffix)
  ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
  : vaultBasePath;

const agentRunner = this.buildAgentRunner(repoRoot);
```

With:

```typescript
const vaultRoot = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";

const agentRunner = this.buildAgentRunner(vaultRoot);
```

Change `cwd: repoRoot` → `cwd: vaultRoot` in `agentRunner.run(...)`.

Change `consolidateSourcePaths(existing, ev.path, repoRoot)` → `consolidateSourcePaths(existing, ev.path, vaultRoot)`.

- [ ] **Step 4: Update `dispatchChat()` — drop repoRoot computation**

In `dispatchChat()` (around lines 65–70), apply the same substitution:

```typescript
const vaultRoot = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";

const agentRunner = this.buildAgentRunner(vaultRoot);
```

Change `cwd: repoRoot` → `cwd: vaultRoot` in `agentRunner.run(...)`.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "refactor(controller): drop repoRoot computation, use vaultRoot = vaultBasePath"
```

---

## Task 11: `view.ts` and `domain-map.ts` cleanup

**Files:**
- Modify: `src/view.ts` (lines 196–201)
- Modify: `src/domain-map.ts` (line 21 comment)

- [ ] **Step 1: Update `wikiRoot` computation in `src/view.ts`**

Replace lines 196–201 (the wikiRoot closure body):

```typescript
// Было:
const vaultPrefix = `vaults/${vaultName}/`;
const sample = domains[0]?.wiki_folder ?? `${vaultPrefix}!Wiki/x`;
const rel = sample.startsWith(vaultPrefix) ? sample.slice(vaultPrefix.length) : sample;
return rel.replace(/\/[^/]+$/, "") || "!Wiki";

// Стало:
const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
return sample.replace(/\/[^/]+$/, "") || "!Wiki";
```

Also remove the `const vaultName = this.plugin.app.vault.getName();` line (line 197) if it's only used for `vaultPrefix`.

- [ ] **Step 2: Update comment in `src/domain-map.ts`**

Line 21: change

```typescript
  wikiFolder: string;  // vault-relative, e.g. "!Wiki/os" (without "vaults/VaultName/")
```

to:

```typescript
  wikiFolder: string;  // vault-relative, e.g. "!Wiki/os"
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts src/domain-map.ts
git commit -m "refactor(view): simplify wikiRoot extraction for vault-relative wiki_folder"
```

---

## Task 12: Build and full verification

**Files:** `dist/main.js`, `dist/manifest.json`

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: **ALL tests PASS**, zero failures.

- [ ] **Step 2: Bump patch version and build**

Read current version from `package.json`, increment patch. Example if current is `1.2.3`:

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const man = JSON.parse(fs.readFileSync('manifest.json','utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = [maj, min, pat+1].join('.');
pkg.version = next; man.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
fs.writeFileSync('manifest.json', JSON.stringify(man, null, '\t') + '\n');
console.log('Version bumped to', next);
"
npm run build
```

Expected: `dist/main.js` generated without errors.

- [ ] **Step 3: Verify no `repoRoot` remains in src/**

```bash
grep -r "repoRoot" src/
```
Expected: **no output** (zero matches).

- [ ] **Step 4: Commit final build**

```bash
git add src/ dist/main.js dist/manifest.json manifest.json package.json
git commit -m "feat: vault-relative path storage for domain wiki_folder and source_paths"
```

---

## Self-Review Checklist

**Spec section → task mapping:**

| Spec section | Task |
|---|---|
| `consolidateSourcePaths` rename | Task 1 |
| `extractParentSourcePath` vault-relative | Task 2 |
| `detectDomain` vaultRoot | Task 3 |
| `runIngest` vaultRoot | Task 4 |
| `runQuery` vaultRoot | Task 5 |
| `runLint` vaultRoot | Task 6 |
| `runFix` vaultRoot | Task 7 |
| `runInit` remove repoRoot + normalize | Task 8 |
| `AgentRunner` propagate vaultRoot | Task 9 |
| `controller.ts` registerDomain + dispatch | Task 10 |
| `view.ts` wikiRoot + domain-map.ts comment | Task 11 |
| Build + invariant verification | Task 12 |
