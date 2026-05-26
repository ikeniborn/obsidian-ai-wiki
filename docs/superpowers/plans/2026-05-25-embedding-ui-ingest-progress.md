---
review:
  plan_hash: 100f3c957a837ccb
  spec_hash: b095cedc581f9fdf
  last_run: 2026-05-25
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
      section: "Task 5: Update docs/prompt-architecture.md"
      section_hash: e4ab927661b3b61a
      text: >
        Task 5 модифицирует docs/prompt-architecture.md, но ни один блок спеки
        не требует изменений в этом файле. Таблица "Files changed" в спеке не
        включает docs/prompt-architecture.md.
      verdict: accepted
      verdict_at: 2026-05-25
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "Task 2: Render info_text in view.ts"
      section_hash: cbe285116337af5e
      text: >
        Task 2, Step 1 ("Find the insertion point") — навигационный шаг без DoD
        и без команды проверки. Нет способа убедиться, что правильная точка вставки
        найдена до выполнения Step 2.
      verdict: accepted
      verdict_at: 2026-05-25
---

# Embedding UI Fix + Ingest Progress Entity Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the embedding toggle UI (child fields appear on enable), add visual grouping, and render similarity-page-selection as a visible progress step with entity breakdown.

**Architecture:** Three independent touch-points — `types.ts` adds an event variant, `view.ts` renders it, `ingest.ts` emits it, `settings.ts` fixes the toggle sentinel. The `docs/prompt-architecture.md` is updated last to reflect the new behavior.

**Tech Stack:** TypeScript, Obsidian Plugin API (Setting, createDiv/createSpan), Vitest

---

### Task 1: Add `info_text` to `RunEvent` union + test

**Files:**
- Modify: `src/types.ts:40-55`
- Modify: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/types.test.ts`:

1. On line 2, add `RunEvent` to the existing type import:
```typescript
import type { ClaudeOperationConfig, NativeOperationConfig, LlmCallOptions, RunEvent } from "../src/types";
```

2. Append after the last `it()` block:

```typescript
it("RunEvent accepts info_text with icon, summary, details", () => {
  const ev: RunEvent = {
    kind: "info_text",
    icon: "🔍",
    summary: "5/42 wiki-pages loaded (jaccard)",
    details: ["Alice", "Memory", "ProjectX"],
  };
  expect(ev.kind).toBe("info_text");
});

it("RunEvent info_text details is optional", () => {
  const ev: RunEvent = { kind: "info_text", icon: "📋", summary: "no pages" };
  expect(ev.kind).toBe("info_text");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/types.test.ts
```

Expected: TypeScript error — `info_text` not assignable to `RunEvent`.

- [ ] **Step 3: Add `info_text` to `RunEvent` in `src/types.ts`**

In `src/types.ts`, add one line to the `RunEvent` union after the `assistant_text` line (line 44):

```typescript
export type RunEvent =
  | { kind: "system"; message: string; sessionId?: string }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; ok: boolean; preview?: string }
  | { kind: "assistant_text"; delta: string; isReasoning?: boolean }
  | { kind: "info_text"; icon: string; summary: string; details?: string[] }
  | { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number }
  | { kind: "ask_user"; question: string; options: string[]; toolUseId: string }
  | { kind: "domain_created"; entry: DomainEntry }
  | { kind: "source_path_added"; domainId: string; path: string }
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string; wiki_folder?: string; analyzed_sources?: string[] } }
  | { kind: "eval_result"; score: number; reasoning: string }
  | { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
  | { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
  | { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
  | { kind: "format_preview"; tempPath: string; report: string; missingTokens: { token: string; context: string }[] }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): add info_text RunEvent variant for phase status messages"
```

---

### Task 2: Render `info_text` in `view.ts`

**Files:**
- Modify: `src/view.ts:624` (after the `assistant_text` else-if block)

- [ ] **Step 1: Find the insertion point**

In `src/view.ts`, locate the `} else if (ev.kind === "assistant_text") {` block (around line 624). The `info_text` handler goes immediately after this block closes (after line ~649).

- [ ] **Step 2: Add the `info_text` handler**

Insert after `} else if (ev.kind === "assistant_text") { ... }` (immediately before `} else if (ev.kind === "system") {`):

```typescript
    } else if (ev.kind === "info_text") {
      this.stopWaiting();
      const step = this.stepsEl.createDiv("ai-wiki-step");
      const head = step.createDiv("ai-wiki-step-head");
      head.createSpan({ cls: "ai-wiki-step-icon" }).setText(ev.icon);
      head.createSpan({ cls: "ai-wiki-step-name" }).setText(ev.summary);
      head.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
      if (ev.details && ev.details.length > 0) {
        const body = step.createDiv("ai-wiki-step-preview");
        for (const d of ev.details) {
          body.createDiv().setText(`· ${d}`);
        }
      }
      this.scrollSteps();
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS (view.ts has no unit tests for DOM rendering — type-checking catches structural issues).

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): render info_text events as progress step items with entity list"
```

---

### Task 3: Replace `assistant_text` yield in `ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts:89`

Note: `pageId` is already imported at line 17 — no new import needed.

- [ ] **Step 1: Replace the yield**

In `src/phases/ingest.ts`, replace line 89:

```typescript
    yield { kind: "assistant_text", delta: `Relevant pages: ${filteredPaths.length}/${existingPaths.length} selected via ${similarity.config.mode} similarity\n` };
```

With:

```typescript
    yield {
      kind: "info_text",
      icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
      summary: `${filteredPaths.length}/${existingPaths.length} wiki-pages loaded (${similarity.config.mode})`,
      details: filteredPaths.map((p) => pageId(p)),
    };
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "feat(ingest): emit info_text with entity breakdown instead of lost assistant_text"
```

---

### Task 4: Fix embedding toggle + add section heading in `settings.ts`

**Files:**
- Modify: `src/settings.ts:504-559`

- [ ] **Step 1: Add heading and fix toggle ON handler**

Replace the block from `// Relevant pages top-K` comment through the closing `}` of the `if (embeddingModel !== undefined)` block (lines ~504–559) with:

```typescript
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

      new Setting(containerEl).setName("Semantic Search").setHeading();

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
                await this.patchLocalNative({ embeddingModel: "" });
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

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "fix(settings): enable embedding toggle shows child fields, add Semantic Search heading"
```

---

### Task 5: Update `docs/prompt-architecture.md`

**Files:**
- Modify: `docs/prompt-architecture.md` — section `### Настройки`

- [ ] **Step 1: Update the settings table**

In `docs/prompt-architecture.md`, locate the `### Настройки` table (around line 364) and replace it with:

```markdown
### Настройки (`LocalConfig.nativeAgent`)

| Поле | Тип | Назначение |
|---|---|---|
| `embeddingModel` | `string?` | Модель эмбеддингов. `undefined` = jaccard; `""` (пустая строка) = режим включён, модель не задана → jaccard до ввода имени; непустая строка = embedding-режим |
| `embeddingDimensions` | `number?` | Число измерений; обязательно при `embeddingModel` |
| `relevantPagesTopK` | `number?` | Максимум страниц в контексте (default: 15) |

**Поведение UI-тоггла "Enable semantic similarity":**
- Toggle OFF → `embeddingModel: undefined, embeddingDimensions: undefined`. Поля модели скрыты.
- Toggle ON → `embeddingModel: ""` (sentinel). Поля "Embedding model" и "Embedding dimensions" появляются. Режим остаётся jaccard до ввода имени модели.

Поля хранятся в `local.json` (не синхронизируются между устройствами).
```

- [ ] **Step 2: Add `info_text` event description to the PageSimilarityService section**

In `docs/prompt-architecture.md`, locate `### Подключение к фазам через AgentRunner` and add after the table:

```markdown
### Прогресс-шаг выбора страниц

После `selectRelevant()` фаза `ingest` эмитирует событие `info_text` (тип `RunEvent`):

```typescript
{ kind: "info_text", icon: "🔍" | "📋", summary: "N/M wiki-pages loaded (mode)", details: string[] }
```

`view.ts` рендерит его как отдельный step-item с иконкой и списком entity-names (значений `pageId(path)` для каждого выбранного файла). Иконка: `🔍` для embedding-режима, `📋` для jaccard.
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/prompt-architecture.md
git commit -m "docs(prompt-architecture): document embedding toggle sentinel and info_text progress step"
```
