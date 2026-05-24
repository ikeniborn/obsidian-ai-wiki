---
review:
  plan_hash: 37ad732e160bd333
  spec_hash: b5595e2a1d0f7183
  last_run: 2026-05-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    Task1: bab24ca8646f3405
    Task2: 57960daa58fe94ed
    Task3: 660f017ec20661c7
    Task4: e729822a211f140e
    SelfReview: 0afb58104a106149
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: Task2
      section_hash: 57960daa58fe94ed
      text: "Task 2 Step 1 shows `import` statement inside a `describe` block — invalid TypeScript syntax. Engineer must add the import at top of `tests/phases/init.test.ts`, not inside describe."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-002
      phase: consistency
      severity: WARNING
      section: Task3
      section_hash: 660f017ec20661c7
      text: "`retryInvalidPaths` signature includes `params: ReturnType<typeof buildChatParams>` but the body never uses it (creates `retryParams` internally). Dead parameter — remove from signature and call site."
      verdict: fixed
      verdict_at: 2026-05-19
---
# Wiki Path Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce strict 4-level wiki path hierarchy (`!Wiki/<domain>/<entity>/<Article>.md`) via sanitize functions in init, validate+retry in ingest, and prompt rules.

**Architecture:** New functions `sanitizeWikiFolder`, `sanitizeWikiSubfolder`, `validateArticlePath` in `src/wiki-path.ts`; init.ts applies sanitize after LLM parse; ingest.ts validates output and retries once with feedback; prompts gain explicit path rules.

**Tech Stack:** TypeScript, Vitest, path-browserify, existing LlmClient + RunEvent pattern.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/wiki-path.ts` | Add 3 new exported functions |
| Modify | `src/phases/init.ts` | Replace manual strip logic with `sanitizeWikiFolder`; add `sanitizeWikiSubfolder` per entity_type |
| Modify | `src/phases/ingest.ts` | Add validate+retry block after `parseJsonPages` |
| Modify | `prompts/ingest.md` | Add ПРАВИЛО ПУТЕЙ before JSON output instruction |
| Modify | `prompts/init.md` | Add ПРАВИЛО wiki_subfolder in entity_types section |
| Create | `tests/wiki-path.test.ts` | Unit tests for all 3 new functions |
| Modify | `tests/phases/ingest.test.ts` | Tests for path validation and retry behaviour |

---

## Task 1: Implement `sanitizeWikiFolder`, `sanitizeWikiSubfolder`, `validateArticlePath`

**Files:**
- Modify: `src/wiki-path.ts`
- Create: `tests/wiki-path.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/wiki-path.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
  validateArticlePath,
} from "../src/wiki-path";

describe("sanitizeWikiFolder", () => {
  it("strips vaults/<name>/ prefix", () => {
    expect(sanitizeWikiFolder("vaults/Work/os")).toBe("os");
  });
  it("strips vaults/<name>/!Wiki/ prefix", () => {
    expect(sanitizeWikiFolder("vaults/Work/!Wiki/os")).toBe("os");
  });
  it("strips !Wiki/ prefix", () => {
    expect(sanitizeWikiFolder("!Wiki/os")).toBe("os");
  });
  it("takes last segment when slash remains", () => {
    expect(sanitizeWikiFolder("os/network")).toBe("network");
  });
  it("returns single-segment as-is", () => {
    expect(sanitizeWikiFolder("os")).toBe("os");
  });
});

describe("sanitizeWikiSubfolder", () => {
  it("strips domain prefix (os/network → network)", () => {
    expect(sanitizeWikiSubfolder("os/network")).toBe("network");
  });
  it("returns single word unchanged", () => {
    expect(sanitizeWikiSubfolder("network")).toBe("network");
  });
  it("takes last segment for multi-level (a/b/c → c)", () => {
    expect(sanitizeWikiSubfolder("a/b/c")).toBe("c");
  });
});

describe("validateArticlePath", () => {
  const wiki = "!Wiki/os";

  it("valid: exactly 2 segments after domain", () => {
    expect(validateArticlePath("!Wiki/os/network/NFS.md", wiki)).toBe(true);
  });
  it("invalid: domain appears twice (5 segments total)", () => {
    expect(validateArticlePath("!Wiki/os/os/network/NFS.md", wiki)).toBe(false);
  });
  it("invalid: 3 segments after domain (too deep)", () => {
    expect(validateArticlePath("!Wiki/os/network/nfs/NFS.md", wiki)).toBe(false);
  });
  it("valid: _index.md exempt", () => {
    expect(validateArticlePath("!Wiki/os/_index.md", wiki)).toBe(true);
  });
  it("valid: _log.md exempt", () => {
    expect(validateArticlePath("!Wiki/os/_log.md", wiki)).toBe(true);
  });
  it("valid: _wiki_schema.md exempt", () => {
    expect(validateArticlePath("!Wiki/os/_wiki_schema.md", wiki)).toBe(true);
  });
  it("invalid: wrong domain prefix", () => {
    expect(validateArticlePath("!Wiki/other/network/NFS.md", wiki)).toBe(false);
  });
  it("invalid: only 1 segment after domain (no subfolder)", () => {
    expect(validateArticlePath("!Wiki/os/NFS.md", wiki)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run tests/wiki-path.test.ts
```
Expected: FAIL — `sanitizeWikiFolder is not exported from ../src/wiki-path`

- [ ] **Step 3: Implement the 3 functions in `src/wiki-path.ts`**

Replace full file content:

```typescript
export const WIKI_ROOT = "!Wiki";

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}

export function sanitizeWikiFolder(raw: string): string {
  let s = raw;
  const vaultMatch = s.match(/^vaults\/[^/]+\//);
  if (vaultMatch) s = s.slice(vaultMatch[0].length);
  if (s.startsWith("!Wiki/")) s = s.slice("!Wiki/".length);
  if (s.includes("/")) return s.split("/").pop()!;
  return s;
}

export function sanitizeWikiSubfolder(raw: string): string {
  if (!raw.includes("/")) return raw;
  return raw.split("/").pop()!;
}

export function validateArticlePath(path: string, wikiVaultPath: string): boolean {
  if (
    path === `${wikiVaultPath}/_index.md` ||
    path === `${wikiVaultPath}/_log.md` ||
    path === `${wikiVaultPath}/_wiki_schema.md`
  ) return true;
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  const segments = remainder.split("/");
  return segments.length === 2 && segments[1].endsWith(".md");
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx vitest run tests/wiki-path.test.ts
```
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/wiki-path.ts tests/wiki-path.test.ts
git commit -m "feat(wiki-path): add sanitizeWikiFolder, sanitizeWikiSubfolder, validateArticlePath"
```

---

## Task 2: Apply sanitize functions in `src/phases/init.ts`

**Files:**
- Modify: `src/phases/init.ts`
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Write failing tests**

Add the import at the **top** of `tests/phases/init.test.ts` (with existing imports), then add the describe block at the end of the file:

```typescript
// At the top of the file, with existing imports:
import { sanitizeWikiFolder, sanitizeWikiSubfolder } from "../../src/wiki-path";
```

```typescript
// At the bottom of the file:
describe("sanitizeWikiFolder applied in init bootstrap", () => {
  it("returns last segment when wiki_folder contains slash", () => {
    // Directly test the sanitize function that init now uses
    expect(sanitizeWikiFolder("os/network")).toBe("network");
    expect(sanitizeWikiFolder("vaults/MyVault/!Wiki/os")).toBe("os");
  });

  it("sanitizeWikiSubfolder strips domain prefix", () => {
    expect(sanitizeWikiSubfolder("os/network")).toBe("network");
    expect(sanitizeWikiSubfolder("processes")).toBe("processes");
  });
});
```

> Note: these tests import the functions directly. The integration test (LLM output flows through init) is harder to isolate; the unit tests above verify the sanitize contract. If you want a full integration test, see the existing `tests/phases/init.test.ts` patterns for building a mock LLM that returns a specific JSON entry.

- [ ] **Step 2: Run existing init tests to confirm current state passes**

```
npx vitest run tests/phases/init.test.ts
```
Expected: PASS (baseline)

- [ ] **Step 3: Replace manual strip logic with `sanitizeWikiFolder` in `src/phases/init.ts`**

In `runInit` (around line 162–175) and in `runInitWithSources` (around line 330–333), **both** bootstrap blocks have:

```typescript
const vaultPrefix = `vaults/${vaultName}/`;
if (entry.wiki_folder?.startsWith(vaultPrefix)) {
  entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
}
if (entry.wiki_folder?.startsWith("!Wiki/")) {
  entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
}
```

Replace each occurrence with:

```typescript
entry.wiki_folder = sanitizeWikiFolder(entry.wiki_folder ?? "");
```

Then, immediately after that line in each bootstrap block, add entity_type sanitization:

```typescript
for (const et of entry.entity_types ?? []) {
  if (et.wiki_subfolder) et.wiki_subfolder = sanitizeWikiSubfolder(et.wiki_subfolder);
}
```

Also add the import at the top of `src/phases/init.ts`:

```typescript
import { domainWikiFolder, sanitizeWikiFolder, sanitizeWikiSubfolder } from "../wiki-path";
```

(Replace the existing `import { domainWikiFolder } from "../wiki-path";` line.)

- [ ] **Step 4: Run tests**

```
npx vitest run tests/phases/init.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "feat(init): sanitize wiki_folder and wiki_subfolder after LLM parse"
```

---

## Task 3: Validate paths and retry in `src/phases/ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/phases/ingest.test.ts`:

```typescript
import { validateArticlePath } from "../../src/wiki-path";

describe("runIngest path validation", () => {
  it("skips invalid path and emits tool_result ok:false", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    // Domain wiki_folder "work" → wikiVaultPath = "!Wiki/work"
    // Invalid: domain appears twice in path
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/work/entity/Page.md", content: "# Page" },
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
    // Page must NOT be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/work/entity/Page.md",
    );
    expect(writeCall).toBeUndefined();
    // Must emit tool_result ok:false for that path
    const failResult = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false && (e.preview as string)?.includes("4-level"),
    );
    expect(failResult).toBeDefined();
  });

  it("retries with feedback when invalid paths returned first", async () => {
    // First call returns invalid path; second call (retry) returns corrected path
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const badResponse = JSON.stringify([
      { path: "!Wiki/work/work/entity/Page.md", content: "# Page bad" },
    ]);
    const goodResponse = JSON.stringify([
      { path: "!Wiki/work/entity/Page.md", content: "# Page good" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const text = callCount === 1 ? badResponse : goodResponse;
            const fakeStream = {
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: text } }] };
              },
            };
            return Promise.resolve(fakeStream);
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        llm,
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    // Corrected page must be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/entity/Page.md",
    );
    expect(writeCall).toBeDefined();
    // LLM called twice (original + retry)
    expect(callCount).toBe(2);
  });

  it("does not retry twice (retry flag prevents second retry)", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const badResponse = JSON.stringify([
      { path: "!Wiki/work/work/entity/Page.md", content: "# Page bad" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const fakeStream = {
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: badResponse } }] };
              },
            };
            return Promise.resolve(fakeStream);
          }),
        },
      },
    } as unknown as LlmClient;

    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        llm,
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    // Should call LLM at most twice (original + one retry)
    expect(callCount).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx vitest run tests/phases/ingest.test.ts
```
Expected: the 3 new tests FAIL (no validate logic yet)

- [ ] **Step 3: Implement validate + retry in `src/phases/ingest.ts`**

Add import at the top:

```typescript
import { validateArticlePath } from "../wiki-path";
```

Find the section after `const pages = parseJsonPages(fullText);` (around line 105). Replace the block from `const pages = ...` through `const written: string[] = [];` with:

```typescript
let pages = parseJsonPages(fullText);

// --- Path validation + one retry ---
const { valid, invalid } = splitByPathValidity(pages, wikiVaultPath);
if (invalid.length > 0) {
  yield {
    kind: "assistant_text",
    delta: `⚠ Пути нарушают правило 4 сегментов, запрашиваю исправление: ${invalid.map((p) => p.path).join(", ")}\n`,
  };
  const retryText = await retryInvalidPaths(llm, model, messages, invalid, signal, opts);
  if (retryText && !signal.aborted) {
    const retried = parseJsonPages(retryText);
    const { valid: retriedValid, invalid: retriedInvalid } = splitByPathValidity(retried, wikiVaultPath);
    // Emit ok:false for paths still invalid after retry
    for (const p of retriedInvalid) {
      yield { kind: "tool_use", name: "Write", input: { path: p.path } };
      yield { kind: "tool_result", ok: false, preview: `Path violates 4-level rule (!Wiki/<d>/<e>/<f>.md): ${p.path}` };
    }
    pages = [...valid, ...retriedValid];
  } else {
    // No retry text (aborted or error) — skip all invalid
    for (const p of invalid) {
      yield { kind: "tool_use", name: "Write", input: { path: p.path } };
      yield { kind: "tool_result", ok: false, preview: `Path violates 4-level rule (!Wiki/<d>/<e>/<f>.md): ${p.path}` };
    }
    pages = valid;
  }
} else {
  pages = valid;
}

const written: string[] = [];
```

Then add these two helper functions at the bottom of `src/phases/ingest.ts` (before or after `extractParentSourcePath`):

```typescript
function splitByPathValidity(
  pages: Array<{ path: string; content: string; annotation?: string }>,
  wikiVaultPath: string,
): {
  valid: Array<{ path: string; content: string; annotation?: string }>;
  invalid: Array<{ path: string; content: string; annotation?: string }>;
} {
  const valid: typeof pages = [];
  const invalid: typeof pages = [];
  for (const p of pages) {
    if (validateArticlePath(p.path, wikiVaultPath)) {
      valid.push(p);
    } else {
      invalid.push(p);
    }
  }
  return { valid, invalid };
}

async function retryInvalidPaths(
  llm: LlmClient,
  model: string,
  originalMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  invalidPages: Array<{ path: string; content: string; annotation?: string }>,
  signal: AbortSignal,
  opts: LlmCallOptions,
): Promise<string> {
  const invalidList = invalidPages.map((p) => p.path).join(", ");
  const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...originalMessages,
    {
      role: "user",
      content: `Пути нарушают правило 4 сегментов (!Wiki/<d>/<e>/<f>.md): ${invalidList}. Верни исправленный JSON-массив только для этих страниц.`,
    },
  ];
  const retryParams = buildChatParams(model, retryMessages, opts, false);
  try {
    let text = "";
    const stream = await llm.chat.completions.create(
      { ...retryParams, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { content } = extractStreamDeltas(chunk);
      if (content) text += content;
    }
    return text;
  } catch {
    return "";
  }
}
```

Note: `buildIngestMessages` already produces `messages`. The variable `messages` must be declared with `const` so it's accessible after the streaming block. Verify the variable is in scope before the validate block.

- [ ] **Step 4: Run tests**

```
npx vitest run tests/phases/ingest.test.ts
```
Expected: PASS — all existing + 3 new tests

- [ ] **Step 5: Run full test suite**

```
npm test
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): validate 4-level wiki paths, retry once with feedback"
```

---

## Task 4: Add path rules to prompts

**Files:**
- Modify: `prompts/ingest.md`
- Modify: `prompts/init.md`

- [ ] **Step 1: Add ПРАВИЛО ПУТЕЙ to `prompts/ingest.md`**

Find the line `Верни ТОЛЬКО JSON-массив, без другого текста:` and insert before it:

```
ПРАВИЛО ПУТЕЙ: путь каждой статьи = !Wiki/<domain>/<entity>/<Article>.md — ровно 4 сегмента.
Нельзя: !Wiki/os/os/network/NFS.md (домен дважды), !Wiki/os/network/nfs/NFS.md (5 сегментов).
Можно:  !Wiki/os/network/NFS.md

```

- [ ] **Step 2: Add ПРАВИЛО wiki_subfolder to `prompts/init.md`**

Find the `entity_types` example block (line with `"wiki_subfolder": "processes"`) and insert before the `## Wiki Page Conventions` section:

```
ПРАВИЛО wiki_subfolder: одно слово, без слэшей, без domain_id.
Нельзя: "os/network", "os_network". Можно: "network", "processes", "protocols".

```

- [ ] **Step 3: Verify prompts render correctly by running init test**

```
npx vitest run tests/phases/init.test.ts
```
Expected: PASS (prompts are strings, no type errors)

- [ ] **Step 4: Commit**

```bash
git add prompts/ingest.md prompts/init.md
git commit -m "feat(prompts): add 4-level path and wiki_subfolder rules"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|---|---|
| `sanitizeWikiFolder` strips vault/!Wiki prefix, takes last segment if slash remains | Task 1 |
| `sanitizeWikiSubfolder` takes last segment if slash present | Task 1 |
| `validateArticlePath` checks exactly 2 segments after domain, exempts system files | Task 1 |
| `src/phases/init.ts` uses sanitize after LLM parse for wiki_folder | Task 2 |
| `src/phases/init.ts` uses sanitize per entity_type.wiki_subfolder | Task 2 |
| `src/phases/ingest.ts` splits pages into valid/invalid | Task 3 |
| Emit `assistant_text` warning for invalid paths | Task 3 |
| Re-call LLM with feedback, merge with valid | Task 3 |
| After retry, still-invalid → `tool_result ok:false`, skip write | Task 3 |
| `prompts/ingest.md` ПРАВИЛО ПУТЕЙ | Task 4 |
| `prompts/init.md` ПРАВИЛО wiki_subfolder | Task 4 |

### Test Cases from Spec

All 5 test cases from the spec table are covered by `tests/wiki-path.test.ts`:

| Test | Covered by |
|---|---|
| `!Wiki/os/network/NFS.md` / `!Wiki/os` → valid | `validateArticlePath` "valid: exactly 2 segments" |
| `!Wiki/os/os/network/NFS.md` / `!Wiki/os` → invalid | `validateArticlePath` "invalid: domain appears twice" |
| `!Wiki/os/network/nfs/NFS.md` / `!Wiki/os` → invalid | `validateArticlePath` "invalid: 3 segments after domain" |
| `!Wiki/os/_index.md` / `!Wiki/os` → valid (exempt) | `validateArticlePath` "_index.md exempt" |
| `!Wiki/other/network/NFS.md` / `!Wiki/os` → invalid | `validateArticlePath` "invalid: wrong domain prefix" |

### Type Consistency Check

- `validateArticlePath` signature: `(path: string, wikiVaultPath: string): boolean` — matches all call sites in Task 3 where `wikiVaultPath` (vault-relative) is already in scope.
- `splitByPathValidity` and `retryInvalidPaths` are file-private (no export needed).
- `retryInvalidPaths` uses `LlmCallOptions` — must be in scope (already imported in ingest.ts as part of existing type imports).
- `buildChatParams` return type used as `params` — already imported, no new imports needed beyond `validateArticlePath`.
