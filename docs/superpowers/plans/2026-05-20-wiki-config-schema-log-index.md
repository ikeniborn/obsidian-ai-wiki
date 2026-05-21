---
review:
  plan_hash: 757e9f8cf83dd999
  spec_hash: 1cca5b79b94622ff
  last_run: 2026-05-20
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
      section: "## Task 5: Update `lint.ts` — `appendWikiLog`"
      section_hash: 6b24e29dec6a15c6
      text: "Спека §Affected Files включает `src/phases/fix.ts` (\"Call appendWikiLog with fix variant\"), Out of Scope этого не покрывает. План пропускает fix.ts со ссылкой на отсутствие файла — это корректно, но без явного spec-якоря."
      verdict: open
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "## Task 6: Version Bump and Build"
      section_hash: 90d35e31ddeddb1e
      text: "Task 6 (version bump + build) не имеет требования в спеке. Обоснован CLAUDE.md, но в спеке нет якоря."
      verdict: open
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "## Task 3: Schema Path Migration — `.config/` Layout"
      section_hash: 98dc46453d5a7b4f
      text: "Steps 6-7 изменяют init.ts (ensureRootFiles + runInitWithSources) без написания failing-теста перед реализацией. Верификация отложена до Step 8 (full suite). Нарушает TDD-паттерн, использованный в Steps 1 и 4."
      verdict: open
---
# Wiki Config: Schema Centralization, Grouped Index, Enriched Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move schema files to `.config/`, rewrite `_index.md` to grouped Markdown, and replace sparse log entries with enriched `appendWikiLog` shared module.

**Architecture:** Three independent changes unified in one plan: (1) `wiki-log.ts` new shared module replaces per-phase `appendLog` helpers; (2) `wiki-index.ts` full rewrite to grouped-section Markdown; (3) schema path references updated from `!Wiki/_*.md` to `!Wiki/.config/_*.md`.

**Tech Stack:** TypeScript, Vitest, existing `VaultTools` interface, `path-browserify`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/wiki-log.ts` | **Create** | `appendWikiLog` + per-operation log builders |
| `src/wiki-index.ts` | **Rewrite** | grouped Markdown parser + section-aware upsert |
| `src/phases/format.ts` | **Modify** (line 71) | schema path → `.config/_format_schema.md` |
| `src/phases/ingest.ts` | **Modify** (lines 64–68, 135–162, 161) | schema path + СОЗДАНА/ОБНОВЛЕНА detection + call `appendWikiLog` |
| `src/phases/init.ts` | **Modify** (`ensureRootFiles`) | scaffold `.config/` with both schema files |
| `src/phases/lint.ts` | **Modify** (lines 24–37, 180) | replace `appendLintLog` with `appendWikiLog` |
| `tests/wiki-log.test.ts` | **Create** | tests for new log module |
| `tests/wiki-index.test.ts` | **Rewrite** | tests for new grouped format |
| `tests/phases/ingest.test.ts` | **Modify** | add СОЗДАНА/ОБНОВЛЕНА test |
| `tests/phases/lint.test.ts` | **Modify** (line 295–297) | log assertions already generic enough — verify pass |

> **Note:** `src/phases/fix.ts` does not exist; the `fix` LogOperation variant is defined in `wiki-log.ts` for future use but not called yet.

---

## Task 1: Create `src/wiki-log.ts`

**Files:**
- Create: `src/wiki-log.ts`
- Create: `tests/wiki-log.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/wiki-log.test.ts
import { describe, it, expect, vi } from "vitest";
import { appendWikiLog } from "../src/wiki-log";
import type { VaultTools } from "../src/vault-tools";

function makeVt(initial = ""): { vt: VaultTools; written: string } {
  let stored = initial;
  const vt = {
    read: vi.fn(async (p: string) => {
      if (stored === "__throw__") throw new Error("not found");
      return stored;
    }),
    write: vi.fn(async (_p: string, c: string) => { stored = c; }),
  } as unknown as VaultTools;
  return { vt, get written() { return stored; } };
}

const LOG_PATH = "!Wiki/work/_log.md";

describe("appendWikiLog — ingest", () => {
  it("writes ingest entry with СОЗДАНА line", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, LOG_PATH, "work", {
      op: "ingest",
      sourcePath: "docs/foo.md",
      entries: [{ path: "компоненты/foo.md", action: "СОЗДАНА", statusTo: "stub" }],
      outputTokens: 100,
    });
    expect(written).toContain("ingest");
    expect(written).toContain("work");
    expect(written).toContain("СОЗДАНА: компоненты/foo.md (stub)");
    expect(written).toContain("**Источник:** docs/foo.md");
    expect(written).toContain("**Токены:** 100");
    expect(written).toContain("---");
  });

  it("writes ОБНОВЛЕНА with status transition", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, LOG_PATH, "work", {
      op: "ingest",
      sourcePath: "docs/bar.md",
      entries: [{ path: "ops/bar.md", action: "ОБНОВЛЕНА", statusFrom: "stub", statusTo: "developing" }],
      outputTokens: 50,
    });
    expect(written).toContain("ОБНОВЛЕНА: ops/bar.md (stub→developing)");
  });

  it("appends to existing log content", async () => {
    const { vt, written } = makeVt("## prior entry\n---\n");
    await appendWikiLog(vt, LOG_PATH, "work", {
      op: "ingest",
      sourcePath: "docs/x.md",
      entries: [],
      outputTokens: 0,
    });
    expect(written).toContain("prior entry");
    expect(written).toContain("ingest");
  });
});

describe("appendWikiLog — lint", () => {
  it("writes lint entry", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, LOG_PATH, "work", {
      op: "lint",
      domainId: "work",
      fixed: ["компоненты/foo.md", "ops/bar.md"],
      checkedCount: 10,
      outputTokens: 200,
    });
    expect(written).toContain("lint");
    expect(written).toContain("**Проверено:** 10 | **Исправлено:** 2");
    expect(written).toContain("ИСПРАВЛЕНА: компоненты/foo.md");
    expect(written).toContain("ИСПРАВЛЕНА: ops/bar.md");
  });
});

describe("appendWikiLog — fix", () => {
  it("writes fix entry", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, LOG_PATH, "work", {
      op: "fix",
      filePath: "компоненты/foo.md",
      fixed: ["компоненты/foo.md"],
      outputTokens: 42,
    });
    expect(written).toContain("fix");
    expect(written).toContain("**Файл:** компоненты/foo.md");
    expect(written).toContain("ИСПРАВЛЕНА: компоненты/foo.md");
  });
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run tests/wiki-log.test.ts
```
Expected: `Cannot find module '../src/wiki-log'`

- [ ] **Step 3: Implement `src/wiki-log.ts`**

```typescript
import type { VaultTools } from "./vault-tools";

export interface IngestLogEntry {
  path: string;
  action: "СОЗДАНА" | "ОБНОВЛЕНА";
  statusFrom?: string;
  statusTo: string;
}

export type LogOperation =
  | { op: "ingest"; sourcePath: string; entries: IngestLogEntry[]; outputTokens: number }
  | { op: "lint";   domainId: string;  fixed: string[]; checkedCount: number; outputTokens: number }
  | { op: "fix";    filePath: string;  fixed: string[]; outputTokens: number };

function ts(): string {
  return new Date().toISOString().slice(0, 19);
}

function buildEntry(domainId: string, event: LogOperation): string {
  const header = `## ${ts()} — ${event.op} — ${domainId}`;
  const lines: string[] = [header];

  if (event.op === "ingest") {
    lines.push(`**Источник:** ${event.sourcePath}`);
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push("");
    for (const e of event.entries) {
      if (e.action === "СОЗДАНА") {
        lines.push(`- СОЗДАНА: ${e.path} (${e.statusTo})`);
      } else {
        const status = e.statusFrom ? `${e.statusFrom}→${e.statusTo}` : e.statusTo;
        lines.push(`- ОБНОВЛЕНА: ${e.path} (${status})`);
      }
    }
  } else if (event.op === "lint") {
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push(`**Проверено:** ${event.checkedCount} | **Исправлено:** ${event.fixed.length}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- ИСПРАВЛЕНА: ${p}`);
  } else {
    lines.push(`**Файл:** ${event.filePath}`);
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- ИСПРАВЛЕНА: ${p}`);
  }

  lines.push("", "---");
  return "\n" + lines.join("\n") + "\n";
}

export async function appendWikiLog(
  vaultTools: VaultTools,
  logPath: string,
  domainId: string,
  event: LogOperation,
): Promise<void> {
  let existing = "";
  try { existing = await vaultTools.read(logPath); } catch { /* new file */ }
  await vaultTools.write(logPath, existing + buildEntry(domainId, event));
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run tests/wiki-log.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/wiki-log.ts tests/wiki-log.test.ts
git commit -m "feat: add wiki-log.ts shared module — appendWikiLog with ingest/lint/fix variants"
```

---

## Task 2: Rewrite `src/wiki-index.ts` — Grouped Markdown

**Files:**
- Modify: `src/wiki-index.ts`
- Modify: `tests/wiki-index.test.ts`

- [ ] **Step 1: Rewrite tests for new format**

Replace `tests/wiki-index.test.ts` content:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseIndexAnnotations, upsertIndexAnnotation } from "../src/wiki-index";
import type { VaultTools } from "../src/vault-tools";

// ─── parseIndexAnnotations ───────────────────────────────────────────────────

describe("parseIndexAnnotations", () => {
  it("parses grouped Markdown format", () => {
    const content = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — WikiController: single-flight",
      "- [[agent-runner]] компоненты/agent-runner.md — AgentRunner: маршрутизация",
      "",
      "## операции",
      "- [[ingest-operation]] операции/ingest-operation.md — Ingest: извлечение",
    ].join("\n");
    const map = parseIndexAnnotations(content);
    expect(map.get("wiki-controller")).toBe("WikiController: single-flight");
    expect(map.get("agent-runner")).toBe("AgentRunner: маршрутизация");
    expect(map.get("ingest-operation")).toBe("Ingest: извлечение");
    expect(map.size).toBe(3);
  });

  it("returns empty map for empty content", () => {
    expect(parseIndexAnnotations("").size).toBe(0);
  });

  it("skips title and blank lines", () => {
    const content = "# Wiki Index\n\n## general\n- [[Page]] general/page.md — desc\n";
    const map = parseIndexAnnotations(content);
    expect(map.size).toBe(1);
    expect(map.get("Page")).toBe("desc");
  });

  it("handles annotation containing em-dash within text", () => {
    const content = "## sec\n- [[P]] sec/p.md — foo — bar\n";
    const map = parseIndexAnnotations(content);
    expect(map.get("P")).toBe("foo — bar");
  });
});

// ─── upsertIndexAnnotation ───────────────────────────────────────────────────

function makeVt(initial = ""): { vt: VaultTools; written: () => string } {
  let stored = initial;
  const vt = {
    read: vi.fn(async () => {
      if (stored === "__throw__") throw new Error("not found");
      return stored;
    }),
    write: vi.fn(async (_p: string, c: string) => { stored = c; }),
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => true), mkdir: vi.fn(async () => {}) },
  } as unknown as VaultTools;
  return { vt, written: () => stored };
}

function throwVt(): VaultTools {
  const vt = {
    read: vi.fn(async () => { throw new Error("not found"); }),
    write: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => true), mkdir: vi.fn(async () => {}) },
  } as unknown as VaultTools;
  return vt;
}

describe("upsertIndexAnnotation", () => {
  it("creates fresh grouped index on empty file", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "wiki-controller", "desc",
      "!Wiki/work/компоненты/wiki-controller.md");
    expect(written()).toContain("# Wiki Index");
    expect(written()).toContain("## компоненты");
    expect(written()).toContain("- [[wiki-controller]] компоненты/wiki-controller.md — desc");
  });

  it("creates fresh grouped index when file not found", async () => {
    const vt = throwVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "annotation",
      "!Wiki/work/ops/p.md");
    const c = (vt.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(c).toContain("## ops");
    expect(c).toContain("- [[P]] ops/p.md — annotation");
  });

  it("writes to correct path", async () => {
    const { vt } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "d", "!Wiki/work/ops/p.md");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/_index.md");
  });

  it("appends new entry to existing section", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "agent-runner", "AgentRunner",
      "!Wiki/work/компоненты/agent-runner.md");
    expect(written()).toContain("- [[wiki-controller]]");
    expect(written()).toContain("- [[agent-runner]] компоненты/agent-runner.md — AgentRunner");
  });

  it("replaces existing entry in section", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — old desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "wiki-controller", "new desc",
      "!Wiki/work/компоненты/wiki-controller.md");
    const lines = written().split("\n").filter((l) => l.includes("wiki-controller"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("new desc");
    expect(lines[0]).not.toContain("old desc");
  });

  it("appends new section when section missing", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "ingest-op", "Ingest",
      "!Wiki/work/операции/ingest-op.md");
    expect(written()).toContain("## операции");
    expect(written()).toContain("- [[ingest-op]] операции/ingest-op.md — Ingest");
    expect(written()).toContain("## компоненты");
  });

  it("uses 'general' section for pages directly in wiki root", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "top-level", "desc",
      "!Wiki/work/top-level.md");
    expect(written()).toContain("## general");
  });

  it("uses 'general' when fullPath absent", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "desc");
    expect(written()).toContain("## general");
    expect(written()).toContain("- [[P]]");
    expect(written()).toContain("desc");
  });
});
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run tests/wiki-index.test.ts
```
Expected: multiple FAIL (old format parser, old upsert format)

- [ ] **Step 3: Rewrite `src/wiki-index.ts`**

```typescript
import type { VaultTools } from "./vault-tools";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    // New format: - [[pid]] path — annotation
    const m = line.match(/^- \[\[([^\]]+)\]\] [^ ]+ — (.+)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function deriveSection(wikiFolder: string, fullPath?: string): string {
  if (!fullPath) return "general";
  const prefix = wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  return parts.length >= 2 ? parts[0] : "general";
}

function upsertInSection(content: string, section: string, pid: string, entryLine: string): string {
  if (!content.trim()) {
    return `# Wiki Index\n\n## ${section}\n${entryLine}\n`;
  }

  const sectionHeader = `## ${section}`;
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pidRe = new RegExp(`^- \\[\\[${escaped}\\]\\]`);

  const lines = content.split("\n");
  const sectionIdx = lines.findIndex((l) => l === sectionHeader);

  if (sectionIdx === -1) {
    return content.trimEnd() + `\n\n${sectionHeader}\n${entryLine}\n`;
  }

  const nextSection = lines.findIndex((l, i) => i > sectionIdx && l.startsWith("## "));
  const sectionLines = nextSection === -1
    ? lines.slice(sectionIdx + 1)
    : lines.slice(sectionIdx + 1, nextSection);

  const pidIdx = sectionLines.findIndex((l) => pidRe.test(l));
  if (pidIdx !== -1) {
    const absIdx = sectionIdx + 1 + pidIdx;
    return [...lines.slice(0, absIdx), entryLine, ...lines.slice(absIdx + 1)].join("\n");
  }

  // Append after last entry line within section
  const lastEntry = [...sectionLines].reduce((acc, l, i) => l.startsWith("- ") ? i : acc, -1);
  const insertAfter = lastEntry === -1 ? sectionIdx : sectionIdx + 1 + lastEntry;
  return [
    ...lines.slice(0, insertAfter + 1),
    entryLine,
    ...lines.slice(insertAfter + 1),
  ].join("\n");
}

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

  const section = deriveSection(wikiFolder, fullPath);
  const prefix = wikiFolder + "/";
  const relPath = fullPath
    ? (fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath)
    : pid;
  const entryLine = `- [[${pid}]] ${relPath} — ${annotation}`;

  await vaultTools.write(indexPath, upsertInSection(content, section, pid, entryLine));
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run tests/wiki-index.test.ts
```
Expected: all PASS

- [ ] **Step 5: Run full suite to check for regressions**

```bash
npm test
```
Expected: all PASS (callers of `parseIndexAnnotations` — `wiki-seeds.ts`, `ingest.ts` — use `Map<string, string>` interface which is unchanged)

- [ ] **Step 6: Commit**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(wiki-index): rewrite to grouped Markdown format — section-aware parser and upsert"
```

---

## Task 3: Schema Path Migration — `.config/` Layout

**Files:**
- Modify: `src/phases/format.ts` (line 71)
- Modify: `src/phases/ingest.ts` (line 67)
- Modify: `src/phases/init.ts` (`ensureRootFiles`, line 109)

- [ ] **Step 1: Write failing test for format schema path**

Add to `tests/phases/format.test.ts` — find the test that checks schema read path, or add:

```typescript
it("reads format schema from .config/ subfolder", async () => {
  let schemaReadPath = "";
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      schemaReadPath = path;
      if (path.endsWith("_format_schema.md")) return "schema content";
      return "# Page\ncontent";
    }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  await collect(runFormat(["!Wiki/work/page.md"], vt, makeLlm('{"report":"ok","formatted":"# Page"}'),
    "model", false, [], new AbortController().signal));
  expect(schemaReadPath).toContain(".config/_format_schema.md");
});
```

Run to verify it fails:
```bash
npx vitest run tests/phases/format.test.ts -t "reads format schema from .config"
```
Expected: FAIL — path is `!Wiki/_format_schema.md` not `.config/`

- [ ] **Step 2: Update `src/phases/format.ts` line 71**

Change:
```typescript
const formatSchemaPath = `${WIKI_ROOT}/_format_schema.md`;
```
To:
```typescript
const formatSchemaPath = `${WIKI_ROOT}/.config/_format_schema.md`;
```

- [ ] **Step 3: Run format test — verify PASS**

```bash
npx vitest run tests/phases/format.test.ts
```
Expected: all PASS

- [ ] **Step 4: Write failing test for ingest schema path**

Add to `tests/phases/ingest.test.ts`:

```typescript
it("reads wiki schema from .config/ subfolder", async () => {
  let schemaReadPath = "";
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path.includes("_wiki_schema")) schemaReadPath = path;
      return "";
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llm = makeLlm(JSON.stringify({ reasoning: "x", pages: [] }));
  await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
    new AbortController().signal));
  expect(schemaReadPath).toContain(".config/_wiki_schema.md");
});
```

Run to verify it fails:
```bash
npx vitest run tests/phases/ingest.test.ts -t "reads wiki schema from .config"
```
Expected: FAIL — path is `!Wiki/_wiki_schema.md`

- [ ] **Step 5: Update `src/phases/ingest.ts` line 67**

Change:
```typescript
tryRead(vaultTools, `${schemaRoot}/_wiki_schema.md`),
```
To:
```typescript
tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`),
```

- [ ] **Step 6: Update `src/phases/init.ts` — `ensureRootFiles`**

Current `ensureRootFiles` (lines 520–530):
```typescript
async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_wiki_schema.md`;
  const legacyIndex = `${wikiRoot}/_index.md`;
  const legacyLog   = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем init */ }
}
```

Change to:
```typescript
async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const wikiSchema   = `${wikiRoot}/.config/_wiki_schema.md`;
  const formatSchema = `${wikiRoot}/.config/_format_schema.md`;
  const legacyIndex  = `${wikiRoot}/_index.md`;
  const legacyLog    = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(wikiSchema)))   await vaultTools.write(wikiSchema, schemaTemplate);
    if (!(await vaultTools.exists(formatSchema)))  await vaultTools.write(formatSchema, formatSchemaDefault);
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем init */ }
}
```

Also add import at top of `src/phases/init.ts` (after existing imports):
```typescript
import formatSchemaDefault from "../../templates/_format_schema.md";
```

- [ ] **Step 7: Update `runInitWithSources` schema read path (line 254)**

Change:
```typescript
tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
```
To:
```typescript
tryRead(vaultTools, `${wikiRootGuess}/.config/_wiki_schema.md`),
```

Also update line 109 in `runInit` bootstrap:
```typescript
tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
```
→
```typescript
tryRead(vaultTools, `${wikiRootGuess}/.config/_wiki_schema.md`),
```

- [ ] **Step 8: Run full suite**

```bash
npm test
```
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/phases/format.ts src/phases/ingest.ts src/phases/init.ts tests/phases/format.test.ts tests/phases/ingest.test.ts
git commit -m "feat: migrate schema files to !Wiki/.config/ — format, ingest, init"
```

---

## Task 4: Update `ingest.ts` — `appendWikiLog` + СОЗДАНА/ОБНОВЛЕНА Detection

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Write failing test for СОЗДАНА/ОБНОВЛЕНА detection**

Add to `tests/phases/ingest.test.ts`:

```typescript
it("logs СОЗДАНА for new pages and ОБНОВЛЕНА for existing pages", async () => {
  const existingContent = "---\nwiki_status: developing\n---\n# Existing";
  const existingPaths = new Set(["!Wiki/work/компоненты/existing.md"]);
  let logContent = "";

  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === `${VAULT_ROOT}/Sources/doc.md`) return "source text";
      if (existingPaths.has(path)) return existingContent;
      if (path === "!Wiki/work/_log.md") return logContent;
      throw new Error("not found");
    }),
    write: vi.fn().mockImplementation(async (path: string, content: string) => {
      if (path === "!Wiki/work/_log.md") logContent = content;
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llm = makeLlm(JSON.stringify({
    reasoning: "x",
    pages: [
      { path: "!Wiki/work/компоненты/existing.md", content: "---\nwiki_status: mature\n---\n# Existing", annotation: "desc" },
      { path: "!Wiki/work/компоненты/new-page.md", content: "---\nwiki_status: stub\n---\n# New", annotation: "new" },
    ],
  }));
  await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
    new AbortController().signal));
  expect(logContent).toContain("ОБНОВЛЕНА: компоненты/existing.md (developing→mature)");
  expect(logContent).toContain("СОЗДАНА: компоненты/new-page.md (stub)");
});
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
npx vitest run tests/phases/ingest.test.ts -t "logs СОЗДАНА"
```
Expected: FAIL

- [ ] **Step 3: Update `src/phases/ingest.ts`**

Add import at top (after existing imports):
```typescript
import { appendWikiLog } from "../wiki-log";
import type { IngestLogEntry } from "../wiki-log";
```

Add helper function (after `tryRead`):
```typescript
function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^wiki_status:[ \t]*(.+)$/m.exec(content);
  return m ? m[1].trim() : "unknown";
}
```

Replace the write loop (lines 136–155) with detection logic:

```typescript
  const written: string[] = [];
  const logEntries: IngestLogEntry[] = [];
  for (const page of pages) {
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }

    // Detect СОЗДАНА vs ОБНОВЛЕНА before write
    let existingContent: string | null = null;
    try { existingContent = await vaultTools.read(page.path); } catch { /* new page */ }

    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      written.push(page.path);
      yield { kind: "tool_result", ok: true };

      const relPath = page.path.startsWith(wikiVaultPath + "/")
        ? page.path.slice(wikiVaultPath.length + 1)
        : page.path;
      const statusTo = parseWikiStatus(page.content);
      if (existingContent === null) {
        logEntries.push({ path: relPath, action: "СОЗДАНА", statusTo });
      } else {
        logEntries.push({ path: relPath, action: "ОБНОВЛЕНА", statusFrom: parseWikiStatus(existingContent), statusTo });
      }

      if (page.annotation) {
        try {
          await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
        } catch { /* non-critical */ }
      }
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }
```

Replace the `appendLog` call (line 161):
```typescript
  if (written.length > 0) {
    try {
      await appendWikiLog(vaultTools, `${domainRoot}/_log.md`, domain.id, {
        op: "ingest",
        sourcePath: sourceVaultPath,
        entries: logEntries,
        outputTokens,
      });
    } catch { /* non-critical */ }
```

Remove the private `appendLog` function (lines 230–244).

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run tests/phases/ingest.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): enrich log — СОЗДАНА/ОБНОВЛЕНА detection, status transitions, call appendWikiLog"
```

---

## Task 5: Update `lint.ts` — `appendWikiLog`

**Files:**
- Modify: `src/phases/lint.ts`
- Test: `tests/phases/lint.test.ts` (existing test at line 278 is broad enough — verify it still passes)

- [ ] **Step 1: Add import to `src/phases/lint.ts`**

After existing imports add:
```typescript
import { appendWikiLog } from "../wiki-log";
```

- [ ] **Step 2: Replace `appendLintLog` call**

Remove the `appendLintLog` function (lines 24–37) entirely.

Replace call at line 180:
```typescript
    await appendLintLog(vaultTools, wikiVaultPath, domain.id, writtenPaths.length);
```
With:
```typescript
    try {
      await appendWikiLog(vaultTools, `${wikiVaultPath}/_log.md`, domain.id, {
        op: "lint",
        domainId: domain.id,
        fixed: writtenPaths,
        checkedCount: files.length,
        outputTokens,
      });
    } catch { /* non-critical */ }
```

- [ ] **Step 3: Run tests — verify they PASS**

```bash
npx vitest run tests/phases/lint.test.ts
```
Expected: all PASS (existing test at line 278 checks `"## "`, `"lint"`, `"work"` — new format still has all three)

- [ ] **Step 4: Run full suite**

```bash
npm test
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): replace appendLintLog with appendWikiLog — enriched log with fixed paths and token count"
```

---

## Task 6: Version Bump and Build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`
- Modify: `dist/main.js` (generated)

- [ ] **Step 1: Read current version**

```bash
node -e "console.log(require('./package.json').version)"
```

- [ ] **Step 2: Bump patch version**

Read `package.json`, increment `Z` in `X.Y.Z`, write back.
Read `src/manifest.json`, set `version` to same new value, write back.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: exits 0, `dist/main.js` updated

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json dist/main.js
git commit -m "chore: bump patch version"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Schema files → `!Wiki/.config/` | Task 3 |
| `init` scaffolds `.config/` | Task 3 (Step 6) |
| `format.ts` reads `.config/_format_schema.md` | Task 3 (Step 2) |
| `ingest.ts` reads `.config/_wiki_schema.md` | Task 3 (Step 5) |
| `_index.md` grouped Markdown format | Task 2 |
| `parseIndexAnnotations` new format | Task 2 |
| `upsertIndexAnnotation` section-aware | Task 2 |
| `wiki-log.ts` with `appendWikiLog` | Task 1 |
| ingest log: СОЗДАНА/ОБНОВЛЕНА + status | Task 4 |
| ingest log: token count, source path | Task 4 |
| lint log: checkedCount, fixedCount, fixed paths | Task 5 |
| fix variant defined in LogOperation type | Task 1 (type definition) |
| `fix.ts` not in scope (file does not exist) | — skipped per codebase state |

### Out of Scope (per spec)

- ПРОПУЩЕНА tracking in ingest (`WikiPagesOutputSchema` change)
- Cost field in log (price table not available)
- `init --rebuild-index` command
