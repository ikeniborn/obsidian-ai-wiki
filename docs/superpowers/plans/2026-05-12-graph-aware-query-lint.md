# Graph-Aware Query & Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-memory wiki graph from `[[links]]` at runtime; use it to filter query context via BFS and add graph-structural checks to lint.

**Architecture:** Four pure functions in `src/wiki-graph.ts` (no I/O, no state). `runQuery` uses BFS-filtered context instead of flat dump. `runLint` adds `checkGraphStructure` output to all three LLM calls.

**Tech Stack:** TypeScript, path-browserify (already bundled), vitest

---

## File Map

| File | Change |
|---|---|
| `src/wiki-graph.ts` | **New** — `pageId`, `buildWikiGraph`, `bfsExpand`, `checkGraphStructure` |
| `tests/wiki-graph.test.ts` | **New** — unit tests for all four functions |
| `src/types.ts` | Extend `LlmWikiPluginSettings` + `DEFAULT_SETTINGS` with `graphDepth`, `hubThreshold` |
| `src/i18n.ts` | Add Graph section keys to all three locales (en, ru, es) |
| `src/settings.ts` | Add Graph section UI |
| `src/phases/query.ts` | Add `graphDepth` param; replace flat context with BFS-filtered context |
| `src/phases/lint.ts` | Add `hubThreshold` param; add `checkGraphStructure` to `allIssues` |
| `src/agent-runner.ts` | Pass `settings.graphDepth` to `runQuery`, `settings.hubThreshold` to `runLint` |
| `tests/phases/query.test.ts` | Add BFS integration test (keyword seeds filter context) |
| `tests/phases/lint.test.ts` | Add graph-issues integration test (isolated node in LLM prompt) |

---

### Task 1: Extend settings types

**Files:**
- Modify: `src/types.ts`

- [x] **Step 1: Add fields to `LlmWikiPluginSettings`**

In `src/types.ts`, inside `LlmWikiPluginSettings` interface, after `historyLimit: number;` add:

```typescript
  graphDepth: number;
  hubThreshold: number;
```

- [x] **Step 2: Add defaults to `DEFAULT_SETTINGS`**

In `src/types.ts`, inside `DEFAULT_SETTINGS`, after `historyLimit: 20,` add:

```typescript
  graphDepth: 1,
  hubThreshold: 20,
```

- [x] **Step 3: Run TypeScript check**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors about `graphDepth` or `hubThreshold`.

- [x] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add graphDepth and hubThreshold settings"
```

---

### Task 2: Create `src/wiki-graph.ts` (TDD)

**Files:**
- Create: `tests/wiki-graph.test.ts`
- Create: `src/wiki-graph.ts`

- [x] **Step 1: Write failing tests**

Create `tests/wiki-graph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pageId, buildWikiGraph, bfsExpand, checkGraphStructure } from "../src/wiki-graph";

describe("pageId", () => {
  it("strips path prefix and .md suffix", () => {
    expect(pageId("!Wiki/ai/ИИ-агент.md")).toBe("ИИ-агент");
  });
  it("handles bare filename", () => {
    expect(pageId("Page.md")).toBe("Page");
  });
  it("handles no extension", () => {
    expect(pageId("NoExt")).toBe("NoExt");
  });
});

describe("buildWikiGraph", () => {
  it("builds edges from [[links]]", () => {
    const pages = new Map([
      ["!Wiki/A.md", "# A\n[[B]] and [[C]]"],
      ["!Wiki/B.md", "# B\n[[A]]"],
      ["!Wiki/C.md", "# C\nNo links."],
    ]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("A")).toEqual(new Set(["B", "C"]));
    expect(graph.get("B")).toEqual(new Set(["A"]));
    expect(graph.get("C")).toEqual(new Set());
  });

  it("ignores aliases and headings in links: [[Page|alias]] → Page, [[Page#heading]] → Page", () => {
    const pages = new Map([
      ["!Wiki/X.md", "[[Y|alias]] [[Z#section]]"],
      ["!Wiki/Y.md", ""],
      ["!Wiki/Z.md", ""],
    ]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("X")).toEqual(new Set(["Y", "Z"]));
  });

  it("dangling links (target not in pages) are stored as targets", () => {
    const pages = new Map([["!Wiki/A.md", "[[Ghost]]"]]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("A")).toEqual(new Set(["Ghost"]));
    expect(graph.has("Ghost")).toBe(false);
  });
});

describe("bfsExpand", () => {
  // Graph: A → B → C → D, E isolated
  const graph = new Map([
    ["A", new Set(["B"])],
    ["B", new Set(["C"])],
    ["C", new Set(["D"])],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  it("depth=0 returns only seeds", () => {
    expect(bfsExpand(["A"], graph, 0)).toEqual(new Set(["A"]));
  });

  it("depth=1 returns seeds + direct neighbors (both directions)", () => {
    // undirected: B→A (reverse) and B→C (forward)
    const result = bfsExpand(["B"], graph, 1);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("depth=2 expands two hops", () => {
    const result = bfsExpand(["B"], graph, 2);
    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("does not include isolated nodes not reachable from seeds", () => {
    const result = bfsExpand(["A"], graph, 3);
    expect(result.has("E")).toBe(false);
  });

  it("handles empty seeds", () => {
    expect(bfsExpand([], graph, 2)).toEqual(new Set());
  });

  it("handles seed not in graph", () => {
    expect(bfsExpand(["Unknown"], graph, 1)).toEqual(new Set(["Unknown"]));
  });
});

describe("checkGraphStructure", () => {
  it("detects isolated node (no in or out)", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
      ["Orphan", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).toContain("Orphan: isolated node");
    expect(result).not.toContain("A: isolated");
  });

  it("detects hub node (outDegree > threshold)", () => {
    const targets = new Set(["B","C","D","E","F"]);
    const graph = new Map([
      ["Hub", targets],
      ...([...targets].map((t) => [t, new Set<string>()] as [string, Set<string>])),
    ]);
    const result = checkGraphStructure(graph, 4);
    expect(result).toContain("Hub: hub node (5 outgoing links)");
  });

  it("detects unidirectional link A→B where B exists but has no edge to A", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).toContain("A → [[B]] not reciprocated");
  });

  it("does NOT flag bidirectional link as unidirectional", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).not.toContain("not reciprocated");
  });

  it("does NOT flag dangling link (target not in graph) as unidirectional", () => {
    const graph = new Map([["A", new Set(["Ghost"])]]);
    const result = checkGraphStructure(graph, 20);
    expect(result).not.toContain("not reciprocated");
  });

  it("returns empty string when no issues", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(checkGraphStructure(graph, 20)).toBe("");
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/wiki-graph.test.ts 2>&1 | tail -10
```

Expected: FAIL — module `../src/wiki-graph` not found.

- [x] **Step 3: Implement `src/wiki-graph.ts`**

Create `src/wiki-graph.ts`:

```typescript
import { basename } from "path-browserify";

export type WikiGraph = Map<string, Set<string>>;

export function pageId(vaultPath: string): string {
  return basename(vaultPath, ".md");
}

export function buildWikiGraph(pages: Map<string, string>): WikiGraph {
  const graph: WikiGraph = new Map();
  for (const vaultPath of pages.keys()) {
    graph.set(pageId(vaultPath), new Set());
  }
  for (const [vaultPath, content] of pages) {
    const src = pageId(vaultPath);
    for (const match of content.matchAll(/\[\[([^\]|#]+)/g)) {
      const tgt = match[1].trim();
      if (tgt) graph.get(src)!.add(tgt);
    }
  }
  return graph;
}

export function bfsExpand(seeds: string[], graph: WikiGraph, depth: number): Set<string> {
  if (seeds.length === 0) return new Set();

  // Pre-compute reverse index
  const reverse = new Map<string, Set<string>>();
  for (const [src, targets] of graph) {
    for (const tgt of targets) {
      if (!reverse.has(tgt)) reverse.set(tgt, new Set());
      reverse.get(tgt)!.add(src);
    }
  }

  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
      for (const neighbor of reverse.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  return visited;
}

export function checkGraphStructure(graph: WikiGraph, hubThreshold: number): string {
  const inDegree = new Map<string, number>();
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    for (const tgt of graph.get(node)!) {
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
    }
  }

  const issues: string[] = [];
  for (const [node, neighbors] of graph) {
    const outDeg = neighbors.size;
    const inDeg = inDegree.get(node) ?? 0;

    if (inDeg === 0 && outDeg === 0) {
      issues.push(`- ${node}: isolated node (no links in or out)`);
    }
    if (outDeg > hubThreshold) {
      issues.push(`- ${node}: hub node (${outDeg} outgoing links)`);
    }
    for (const tgt of neighbors) {
      if (graph.has(tgt) && !graph.get(tgt)!.has(node)) {
        issues.push(`- ${node} → [[${tgt}]] not reciprocated`);
      }
    }
  }
  return issues.join("\n");
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/wiki-graph.test.ts 2>&1 | tail -15
```

Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "feat(wiki-graph): add pageId, buildWikiGraph, bfsExpand, checkGraphStructure"
```

---

### Task 3: Update `src/phases/query.ts`

**Files:**
- Modify: `src/phases/query.ts`
- Modify: `tests/phases/query.test.ts`

- [x] **Step 1: Add BFS integration test to `tests/phases/query.test.ts`**

Append to `tests/phases/query.test.ts` inside the `describe("runQuery", ...)` block:

```typescript
  it("excludes pages not reached by BFS when keyword seed found (graphDepth=0)", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/Neural-network.md", "!Wiki/work/Unrelated.md"],
        folders: [],
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith("Neural-network.md"))
          return Promise.resolve("# Neural network\nA learning system.");
        if (path.endsWith("Unrelated.md"))
          return Promise.resolve("# Unrelated\nSomething else entirely.");
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("answer");
    await collect(
      runQuery(
        ["neural network question"],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        0, // graphDepth=0: seeds only, no BFS expansion
      ),
    );
    // Find the streaming LLM call (main query call)
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    // "neural" keyword matches "Neural-network" page; "Unrelated" excluded at depth=0
    expect(userContent).toContain("Neural-network");
    expect(userContent).not.toContain("Unrelated");
  });
```

- [x] **Step 2: Run test to confirm it fails**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/phases/query.test.ts 2>&1 | tail -15
```

Expected: new test FAILS — old `runQuery` includes all pages in context so "Unrelated" appears in the LLM call. Existing 3 tests still PASS (new `graphDepth` param has a default, old calls work unchanged).

- [x] **Step 3: Rewrite `src/phases/query.ts`**

Replace the entire file content with:

```typescript
import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import queryTemplate from "../../prompts/query.md";
import { render } from "./template";
import { domainWikiFolder } from "../wiki-path";
import { pageId, buildWikiGraph, bfsExpand } from "../wiki-graph";

const MAX_CONTEXT_CHARS = 80_000;
const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];

export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  graphDepth: number = 1,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const question = args[0]?.trim();
  if (!question) {
    yield { kind: "error", message: "query: question required" };
    return;
  }

  const domain = domains[0];
  if (!domain) {
    yield { kind: "error", message: "No domain configured. Add a domain in settings." };
    return;
  }

  if (!domain.wiki_folder || domain.wiki_folder.includes("..")) {
    yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
    return;
  }
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
  const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

  const [indexContent, schemaContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRoot}/_index.md`),
    tryRead(vaultTools, `${wikiRoot}/_wiki_schema.md`),
  ]);

  const pages = await vaultTools.readAll(files);

  const start = Date.now();

  // Graph-filtered context
  const graph = buildWikiGraph(pages);
  const allPageIds = [...pages.keys()].map(pageId);
  let seeds = keywordSeeds(question, pages);
  if (seeds.length === 0) {
    seeds = await llmSelectSeeds(question, indexContent, allPageIds, llm, model, signal);
  }
  if (seeds.length === 0) {
    seeds = allPageIds;
  }
  const seedSet = new Set(seeds);
  const selectedIds = bfsExpand(seeds, graph, graphDepth);
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds, MAX_CONTEXT_CHARS);

  const entityTypesBlock = buildEntityTypesBlock(domain);

  const systemPrompt = render(queryTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock,
    schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent.slice(0, 2000)}` : "",
    index_block: indexContent ? `\nВики-индекс (_index.md):\n${indexContent.slice(0, 3000)}` : "",
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Вопрос: ${question}\n\nWiki-страницы:\n${contextBlock}` },
  ];

  const params = buildChatParams(model, messages, opts);
  let answer = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    if (answer) yield { kind: "assistant_text", delta: answer };
  }

  if (signal.aborted) return;

  if (save && answer) {
    const slug = question.slice(0, 40).replace(/[^a-zA-Z0-9а-яёА-ЯЁ\s]/g, "").trim().replace(/\s+/g, "-");
    const savePath = `${wikiVaultPath}/Q-${slug}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const pageContent = [
      `---`,
      `wiki_sources: []`,
      `wiki_updated: ${today}`,
      `wiki_status: mature`,
      `tags: []`,
      `---`,
      ``,
      `# ${question}`,
      ``,
      answer,
    ].join("\n");
    yield { kind: "tool_use", name: "Write", input: { path: savePath } };
    try {
      await vaultTools.write(savePath, pageContent);
      yield { kind: "tool_result", ok: true };
      yield { kind: "result", durationMs: Date.now() - start, text: `Создана страница: ${savePath}\n\n${answer}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      yield { kind: "result", durationMs: Date.now() - start, text: answer };
    }
  } else {
    yield { kind: "result", durationMs: Date.now() - start, text: answer };
  }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

function keywordSeeds(question: string, pages: Map<string, string>): string[] {
  const words = question.split(/\W+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
  if (words.length === 0) return [];
  const seeds: string[] = [];
  for (const path of pages.keys()) {
    const id = pageId(path);
    if (words.some((w) => id.toLowerCase().includes(w))) {
      seeds.push(id);
    }
  }
  return seeds;
}

async function llmSelectSeeds(
  question: string,
  indexContent: string,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string[]> {
  const prompt = [
    `Question: "${question}"`,
    `Available wiki pages: ${allPageIds.join(", ")}`,
    indexContent ? `\nIndex:\n${indexContent.slice(0, 3000)}` : "",
    `\nReturn JSON only: {"seeds": ["PageA", "PageB"]} — most relevant page names (bare names, no path, no .md).`,
  ].filter(Boolean).join("\n");

  try {
    const resp = await llm.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    const text = resp.choices[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { seeds?: unknown };
    if (!Array.isArray(parsed.seeds)) return [];
    return parsed.seeds.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
  maxChars: number,
): string {
  const seedPages: [string, string][] = [];
  const bfsPages: [string, string][] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    if (!selectedIds.has(id)) continue;
    if (seeds.has(id)) seedPages.push([path, content]);
    else bfsPages.push([path, content]);
  }
  const ordered = [...seedPages, ...bfsPages];
  let block = "";
  for (const [p, c] of ordered) {
    const chunk = `--- ${p} ---\n${c}\n\n`;
    if (block.length + chunk.length > maxChars) break;
    block += chunk;
  }
  if (block.length === 0 && ordered.length > 0) {
    const [p, c] = ordered[0];
    block = `--- ${p} ---\n${c}`.slice(0, maxChars) + "\n[...truncated]";
  }
  return block;
}

function buildEntityTypesBlock(domain: DomainEntry): string {
  if (!domain.entity_types?.length) return "";
  const types = domain.entity_types
    .map((et) => `  - ${et.type}: ${et.description}`)
    .join("\n");
  const notes = domain.language_notes ? `\nЯзыковые правила: ${domain.language_notes}` : "";
  return `Типы сущностей домена «${domain.name}»:\n${types}${notes}`;
}
```

- [x] **Step 4: Run query tests to confirm all pass**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/phases/query.test.ts 2>&1 | tail -15
```

Expected: all 4 tests PASS (3 existing + new BFS test).

- [x] **Step 5: Run full test suite**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm test 2>&1 | tail -20
```

Expected: no regressions.

- [x] **Step 6: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "feat(query): graph-filtered context via BFS seed expansion"
```

---

### Task 4: Update `src/phases/lint.ts`

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `tests/phases/lint.test.ts`

- [x] **Step 1: Add graph-issues integration test to `tests/phases/lint.test.ts`**

Append inside the `describe("runLint", ...)` block:

```typescript
  it("includes isolated node graph issue in LLM prompt", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Orphan.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Orphan\nNo links."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("no issues");
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    // Orphan has no links in or out → checkGraphStructure adds "isolated node" to allIssues
    expect(userContent).toContain("isolated node");
  });
```

- [x] **Step 2: Run test to confirm it fails**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/phases/lint.test.ts 2>&1 | tail -15
```

Expected: new test FAILS — old `runLint` doesn't call `checkGraphStructure`, so "isolated node" is absent from the LLM prompt. Existing 9 tests still PASS.

- [x] **Step 3: Add `import` and update `runLint` signature in `src/phases/lint.ts`**

At top of `src/phases/lint.ts`, after existing imports, add:

```typescript
import { buildWikiGraph, checkGraphStructure } from "../wiki-graph";
```

Change `runLint` signature — add `hubThreshold: number = 20` before `opts`:

```typescript
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
): AsyncGenerator<RunEvent> {
```

- [x] **Step 4: Integrate `checkGraphStructure` into `runLint`**

In the per-domain loop, find this existing block (around line 53–55):

```typescript
    const pages = await vaultTools.readAll(files);

    const structuralIssues = checkStructure(pages);
```

Replace with:

```typescript
    const pages = await vaultTools.readAll(files);

    const graph = buildWikiGraph(pages);
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph, hubThreshold);
    const allIssues = [structuralIssues, graphIssues].filter(Boolean).join("\n");
```

- [x] **Step 5: Replace `structuralIssues` with `allIssues` in the lint report LLM call**

Find the `messages` array construction for the lint LLM call (around line 65–76):

```typescript
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Автоматические проблемы:\n${structuralIssues || "Нет."}`,
```

Replace `structuralIssues` with `allIssues`:

```typescript
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Автоматические проблемы:\n${allIssues || "Нет."}`,
```

- [x] **Step 6: Replace `structuralIssues` in `reportParts.push` and `buildFixMessages`**

Find (around line 99):
```typescript
    reportParts.push(`## ${domain.id}\n${structuralIssues ? `**Структурные проблемы:**\n${structuralIssues}\n\n` : ""}${llmReport}`);
```

Replace:
```typescript
    reportParts.push(`## ${domain.id}\n${allIssues ? `**Структурные проблемы:**\n${allIssues}\n\n` : ""}${llmReport}`);
```

Find `buildFixMessages` call (around line 112):
```typescript
    const fixMessages = buildFixMessages(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, llmReport);
```

Replace:
```typescript
    const fixMessages = buildFixMessages(domain, wikiVaultPath, pages, allIssues, entityTypesBlock, llmReport);
```

- [x] **Step 7: Run lint tests to confirm all pass**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx vitest run tests/phases/lint.test.ts 2>&1 | tail -15
```

Expected: all 10 tests PASS (9 existing + new graph-issues test).

- [x] **Step 8: Run full test suite**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm test 2>&1 | tail -20
```

Expected: no regressions.

- [x] **Step 9: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add graph-structural checks (isolated, hub, unidirectional)"
```

---

### Task 5: Update `src/agent-runner.ts`

**Files:**
- Modify: `src/agent-runner.ts`

- [x] **Step 1: Pass `graphDepth` to `runQuery` calls**

Find both `runQuery` calls (lines ~72 and ~75):

```typescript
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
```

Replace with:

```typescript
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts);
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts);
```

- [x] **Step 2: Pass `hubThreshold` to `runLint` call**

Find (line ~78):
```typescript
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
```

Replace:
```typescript
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, opts);
```

- [x] **Step 3: TypeScript check**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [x] **Step 4: Run full test suite**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm test 2>&1 | tail -20
```

Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): pass graphDepth and hubThreshold to phases"
```

---

### Task 6: Add Graph settings UI

**Files:**
- Modify: `src/i18n.ts`
- Modify: `src/settings.ts`

- [x] **Step 1: Add i18n keys to `src/i18n.ts`**

`type I18n = typeof en` — adding keys to `en` auto-extends the type, requiring matching keys in `ru` and `es`. Add to all three locales in this step.

In the `en` object, after `proxy_invalid: (m: string) => \`Proxy config invalid: ${m}\`,` (last key before `},` closing `settings`):

```typescript
    h3_graph: "Graph",
    graphDepth_name: "BFS depth",
    graphDepth_desc: "Query: hops from seed pages. 0 = seeds only, max sensible: 3.",
    hubThreshold_name: "Hub threshold",
    hubThreshold_desc: "Lint: pages with more outgoing links than this are flagged as hub nodes.",
```

In the `ru` object, after `proxy_invalid: (m: string) => \`Некорректная конфигурация прокси: ${m}\`,`:

```typescript
    h3_graph: "Граф",
    graphDepth_name: "Глубина BFS",
    graphDepth_desc: "Query: шагов от seed-страниц. 0 = только seeds, разумный максимум: 3.",
    hubThreshold_name: "Порог хаба",
    hubThreshold_desc: "Lint: страницы с бо́льшим числом исходящих ссылок помечаются как hub.",
```

In the `es` object, after `proxy_invalid: (m: string) => \`Configuración de proxy inválida: ${m}\`,`:

```typescript
    h3_graph: "Grafo",
    graphDepth_name: "Profundidad BFS",
    graphDepth_desc: "Query: saltos desde páginas semilla. 0 = solo semillas, máx recomendado: 3.",
    hubThreshold_name: "Umbral de hub",
    hubThreshold_desc: "Lint: páginas con más enlaces salientes que este valor se marcan como hub.",
```

- [x] **Step 2: Add Graph section to `src/settings.ts`**

Find the dev mode section opener (around line 428):

```typescript
    // ── Dev mode ──────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
```

Insert before it:

```typescript
    // ── Graph settings ────────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_graph).setHeading();

    new Setting(containerEl)
      .setName(T.settings.graphDepth_name)
      .setDesc(T.settings.graphDepth_desc)
      .addText((t) =>
        t.setPlaceholder("1")
          .setValue(String(s.graphDepth))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0 && n <= 3) {
              s.graphDepth = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.hubThreshold_name)
      .setDesc(T.settings.hubThreshold_desc)
      .addText((t) =>
        t.setPlaceholder("20")
          .setValue(String(s.hubThreshold))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n > 0) {
              s.hubThreshold = n;
              await this.plugin.saveSettings();
            }
          }),
      );

```

- [x] **Step 3: TypeScript check**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. `type I18n = typeof en` auto-includes the new keys — no separate type edit needed. If errors appear, verify all three locales have the 5 new keys from Step 1.

- [x] **Step 4: Run full test suite**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm test 2>&1 | tail -20
```

Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add src/i18n.ts src/settings.ts
git commit -m "feat(settings): add Graph section with graphDepth and hubThreshold"
```

---

### Task 7: Version bump and build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

> Note: root `manifest.json` and `dist/manifest.json` are **auto-synced by the build** via `copyFileSync("src/manifest.json", "manifest.json")` in `esbuild.config.mjs`. Do NOT edit them manually.

- [x] **Step 1: Bump patch version**

Current version: `0.1.80`. New version: `0.1.81`.

In `package.json`, change:
```json
"version": "0.1.80",
```
to:
```json
"version": "0.1.81",
```

In `src/manifest.json`, change the `version` field to `"0.1.81"`.

- [x] **Step 2: Build**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm run build 2>&1 | tail -10
```

Expected: build succeeds, `main.js` updated.

- [x] **Step 3: Run full test suite one final time**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-llm-wiki
npm test 2>&1 | tail -20
```

Expected: all PASS.

- [x] **Step 4: Commit**

```bash
git add package.json src/manifest.json manifest.json dist/manifest.json main.js
git commit -m "chore: bump version to 0.1.81, build — graph-aware query and lint"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `src/wiki-graph.ts` with 4 pure functions | Task 2 |
| `pageId(vaultPath)` strips path + `.md` | Task 2 |
| `buildWikiGraph` extracts `[[links]]` via regex | Task 2 |
| `bfsExpand` undirected BFS | Task 2 |
| `checkGraphStructure` three checks | Task 2 |
| Query: replace flat context with BFS-filtered | Task 3 |
| `keywordSeeds` keyword matching | Task 3 |
| `llmSelectSeeds` pre-pass fallback | Task 3 |
| Fallback chain: keyword → LLM → all pages | Task 3 |
| Context priority: seeds first | Task 3 |
| Lint: `buildWikiGraph` + `checkGraphStructure` | Task 4 |
| Lint report LLM call uses `allIssues` | Task 4 |
| `buildFixMessages` uses `allIssues` | Task 4 |
| `graphDepth` and `hubThreshold` in settings | Tasks 1 + 6 |
| Settings tab Graph section | Task 6 |
| `actualizeDomainConfig` unchanged | ✓ not touched |
| No persisted graph cache | ✓ build at runtime |

**Placeholder scan:** None found. All code steps contain complete implementations.

**Type consistency:**
- `WikiGraph = Map<string, Set<string>>` used consistently across Tasks 2–4.
- `pageId` imported in `query.ts` from `../wiki-graph` — matches export in Task 2.
- `buildWikiGraph`, `bfsExpand`, `checkGraphStructure` — all imported by name matching exports.
- `runQuery` new param `graphDepth: number = 1` at position 9 — matches `agent-runner.ts` Task 5 call.
- `runLint` new param `hubThreshold: number = 20` at position 8 — matches `agent-runner.ts` Task 5 call.
