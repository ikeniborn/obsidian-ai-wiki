# Format Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить операцию **Format** — анализ открытой не-wiki markdown-страницы, генерация preview в `!Temp/`, итерация через чат, Apply/Cancel.

**Architecture:** Новая фаза `runFormat` (phases/format.ts) возвращает JSON `{report, formatted}`. Controller хранит `_pendingFormat` state, View рендерит preview-блок с кнопками Apply/Cancel + чат для регенерации. Перед записью temp — validator проверяет значимые токены (числа, URL, имена, code identifiers) на сохранность.

**Tech Stack:** TypeScript, Obsidian API, vitest, esbuild, OpenAI SDK (LlmClient interface), prompts через .md → текст.

**Spec:** `docs/superpowers/specs/2026-05-08-format-operation-design.md`

---

## Task 1: Переименовать `_schema.md` → `_wiki_schema.md`

**Files:**
- Rename: `templates/_schema.md` → `templates/_wiki_schema.md`
- Modify: `src/phases/init.ts:6,58,188,350`
- Modify: `src/phases/ingest.ts:60,252`
- Modify: `src/phases/lint.ts:12`
- Modify: `src/phases/fix.ts:13`
- Modify: `src/phases/query.ts:11,51,71`
- Modify: `templates/_wiki_schema.md:38` (внутренняя ссылка на `_schema.md`)

- [ ] **Step 1: Переименование файла**

```bash
git mv templates/_schema.md templates/_wiki_schema.md
```

- [ ] **Step 2: Заменить импорты и пути**

Везде `_schema.md` → `_wiki_schema.md` в файлах списка выше. Проверить grep:

```bash
grep -rn "_schema.md\|_schema\.md" src/ prompts/ templates/
# должно вернуть: только новое имя _wiki_schema.md
```

В `templates/_wiki_schema.md:38`:
```
Только для служебных файлов (`_index.md`, `_log.md`, `_wiki_schema.md`).
```

- [ ] **Step 3: Запустить тесты**

```bash
npm test
```

Expected: PASS (рефакторинг без изменения поведения)

- [ ] **Step 4: Build sanity-check**

```bash
npm run build
```

Expected: успешная сборка, нет ошибок esbuild по импорту шаблонов.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename _schema.md → _wiki_schema.md"
```

---

## Task 2: Расширить типы для Format

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Расширить `WikiOperation`**

`src/types.ts:4-11`:

```ts
export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "fix"
  | "chat"
  | "init"
  | "format";
```

- [ ] **Step 2: Расширить `OpKey` и добавить timeouts/operations поле**

`src/types.ts:93`:

```ts
export type OpKey = "ingest" | "query" | "lint" | "init" | "format";
```

`LlmWikiPluginSettings.timeouts` (строка 113-119):
```ts
timeouts: {
  ingest: number;
  query: number;
  lint: number;
  fix: number;
  init: number;
  format: number;
};
```

- [ ] **Step 3: Добавить format-варианты в `RunEvent`**

`src/types.ts:40-55`:

```ts
| { kind: "format_preview"; tempPath: string; report: string; missingTokens: string[] }
| { kind: "format_applied"; path: string }
| { kind: "format_cancelled" }
```

- [ ] **Step 4: Обновить `DEFAULT_SETTINGS`**

`src/types.ts:149`:

```ts
timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600, format: 600 },
```

`claudeAgent.operations` (строка 155-160):
```ts
operations: {
  ingest: { model: "haiku",  maxTokens: 4096 },
  query:  { model: "sonnet", maxTokens: 4096 },
  lint:   { model: "sonnet", maxTokens: 8192 },
  init:   { model: "sonnet", maxTokens: 8192 },
  format: { model: "sonnet", maxTokens: 8192 },
},
```

`nativeAgent.operations` (строка 170-175):
```ts
operations: {
  ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
  query:  { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
  lint:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
  init:   { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
  format: { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
},
```

- [ ] **Step 5: Type-check**

```bash
npm run build
```

Expected: TS compile без ошибок (per-operation maps согласованы с типом).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add Format operation types and defaults"
```

---

## Task 3: Создать `templates/_format-schema.md`

**Files:**
- Create: `templates/_format-schema.md`

- [ ] **Step 1: Записать шаблон**

`templates/_format-schema.md`:

```markdown
# Format Schema (правила форматирования не-wiki страниц)

## Frontmatter

| Поле | Правило |
|------|---------|
| `tags` | Иерархические, при наличии тематической классификации |
| `aliases` | Аббревиатуры, синонимы, английские варианты |
| `created` | YYYY-MM-DD при наличии в источнике или при первом форматировании |
| `updated` | YYYY-MM-DD текущая дата форматирования |
| `external_links` | Массив URL — только если в теле есть `http(s)://` ссылки |
| `related` | Массив `[[wikilinks]]` — только если в теле уже встречаются ссылки на другие страницы |

Поля `wiki_*` запрещены.

## Структура

- H1 — название страницы
- Вводный абзац 1-3 предложения сразу после H1, без подзаголовка
- `##` разделы по логике контента; иерархия без скачков (H2 → H3 → H4)
- Запрещены пустые разделы и placeholder-текст

## Таблицы

Markdown с выравниванием. Применять при структурных перечислениях параметров/сравнений. Не превращать повествовательный текст в таблицы.

## Mermaid

` ```mermaid ` блоки для процессов, последовательностей, связей.
- Описанные в тексте процессы → flowchart/sequenceDiagram
- Содержимое схем из изображений (только при vision-backend) → отдельный mermaid-блок ниже изображения. Само изображение сохраняется.

## Изображения

- Каждой картинке — описательная подпись непосредственно под ней
- При `has_vision=true`: дополнительно текстовое описание (таблица параметров, mermaid, или связный текст)
- При `has_vision=false`: используем только alt и существующие подписи; новой информации не сочиняем

## Код

Fenced blocks всегда с указанием языка.

## Стиль

- Нейтральный, информативный, без оценочных суждений
- Технические термины — оригинальное написание (SQL, API, LLM)
- Запрещено: «очевидно», «лучший способ», местоимения «я/мы/наш»

## Жёсткие запреты

- Не добавлять факты, отсутствующие в исходнике (исключение: текстовое извлечение из изображений при `has_vision=true`)
- Не удалять факты
- Не искажать смысл; перефраз для ясности разрешён
- Все изменения перечислять в `report`
```

- [ ] **Step 2: Commit**

```bash
git add templates/_format-schema.md
git commit -m "feat(templates): add _format-schema.md for non-wiki pages"
```

---

## Task 4: Создать `prompts/format.md`

**Files:**
- Create: `prompts/format.md`

- [ ] **Step 1: Записать промт**

`prompts/format.md`:

```
Ты — редактор markdown-страницы вне wiki-базы знаний.

Твоя задача — проанализировать страницу и предложить форматирование по правилам ниже.

ЖЁСТКИЕ ПРАВИЛА:
- Не добавляй и не удаляй факты, имена, числа, URL.
- Не искажай смысл. Перефраз для ясности разрешён.
- Все изменения опиши в поле report.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
{{format_schema}}

VISION: {{has_vision}}
- При has_vision=true: извлекай содержимое схем и изображений, создавай таблицы или mermaid-блоки ниже изображения. Само изображение сохраняй.
- При has_vision=false: работай только с alt-текстом и подписями, новой информации не сочиняй.

Верни ТОЛЬКО JSON-объект (без обёртки markdown, без комментариев):

{
  "report": "<markdown отчёт об изменениях, перечисление по пунктам>",
  "formatted": "<полный markdown отформатированной страницы, включая frontmatter>"
}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/format.md
git commit -m "feat(prompts): add format.md system prompt"
```

---

## Task 5: Утилиты — `extractJsonObject` и `significantTokens`

**Files:**
- Create: `src/phases/format-utils.ts`
- Create: `tests/phases/format-utils.test.ts`

- [ ] **Step 1: Failing test — extractJsonObject**

`tests/phases/format-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJsonObject, significantTokens, missingTokens } from "../../src/phases/format-utils";

describe("extractJsonObject", () => {
  it("парсит чистый JSON", () => {
    const out = extractJsonObject('{"report":"r","formatted":"f"}');
    expect(out).toEqual({ report: "r", formatted: "f" });
  });

  it("парсит JSON с обёрткой текста до и после", () => {
    const out = extractJsonObject('Вот ответ:\n{"report":"r","formatted":"# H"}\nКонец');
    expect(out).toEqual({ report: "r", formatted: "# H" });
  });

  it("учитывает фигурные скобки внутри строк", () => {
    const out = extractJsonObject('{"report":"a {b} c","formatted":"d"}');
    expect(out).toEqual({ report: "a {b} c", formatted: "d" });
  });

  it("учитывает escape-последовательности", () => {
    const out = extractJsonObject('{"report":"line1\\nline2","formatted":"f"}');
    expect(out?.report).toBe("line1\nline2");
  });

  it("возвращает null для невалидного JSON", () => {
    expect(extractJsonObject("not json")).toBeNull();
    expect(extractJsonObject("{ broken")).toBeNull();
  });
});

describe("significantTokens", () => {
  it("извлекает числа", () => {
    const t = significantTokens("Версия 1.2.3 в 2024 году");
    expect(t.has("1.2")).toBe(true);
    expect(t.has("3")).toBe(true);
    expect(t.has("2024")).toBe(true);
  });

  it("извлекает URL", () => {
    const t = significantTokens("См. https://example.com/path и http://a.b");
    expect(t.has("https://example.com/path")).toBe(true);
    expect(t.has("http://a.b")).toBe(true);
  });

  it("извлекает имена собственные (заглавные)", () => {
    const t = significantTokens("Ростелеком использует ClickHouse и Postgres");
    expect(t.has("Ростелеком")).toBe(true);
    expect(t.has("ClickHouse")).toBe(true);
    expect(t.has("Postgres")).toBe(true);
  });

  it("извлекает идентификаторы из inline кода", () => {
    const t = significantTokens("Метод `getUser` вызывает `parseJson`.");
    expect(t.has("getUser")).toBe(true);
    expect(t.has("parseJson")).toBe(true);
  });

  it("извлекает идентификаторы из fenced блоков", () => {
    const t = significantTokens("```ts\nfunction foo() { return BAR_CONST; }\n```");
    expect(t.has("foo")).toBe(true);
    expect(t.has("BAR_CONST")).toBe(true);
  });
});

describe("missingTokens", () => {
  it("возвращает пустой массив если все токены сохранены", () => {
    const orig = "Ростелеком 2024 https://a.b `foo`";
    const fmt = "Ростелеком в 2024 году ссылка https://a.b метод `foo`";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });

  it("находит утраченные токены", () => {
    const orig = "Ростелеком 2024 https://a.b";
    const fmt = "Ростелеком 2024";
    expect(missingTokens(orig, fmt)).toContain("https://a.b");
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run tests/phases/format-utils.test.ts
```

Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

`src/phases/format-utils.ts`:

```ts
export interface FormatResponse {
  report: string;
  formatted: string;
}

export function extractJsonObject(text: string): FormatResponse | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          if (typeof parsed.report !== "string" || typeof parsed.formatted !== "string") return null;
          return { report: parsed.report, formatted: parsed.formatted };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const STOP_WORDS = new Set([
  "The", "This", "That", "These", "Those", "And", "Or", "But", "If", "When",
  "Это", "Этот", "Эти", "Тот", "Если", "Когда", "Однако", "Также",
]);

export function significantTokens(text: string): Set<string> {
  const out = new Set<string>();

  for (const m of text.matchAll(/https?:\/\/\S+/g)) out.add(m[0]);
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const m of text.matchAll(/[A-ZА-Я][\wА-Яа-я-]{2,}/g)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0]);
  }

  // inline code: `xxx`
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(id[0]);
  }
  // fenced: ```...```
  for (const m of text.matchAll(/```[\s\S]*?```/g)) {
    for (const id of m[0].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(id[0]);
  }

  return out;
}

export function missingTokens(original: string, formatted: string): string[] {
  const orig = significantTokens(original);
  const fmt = significantTokens(formatted);
  const missing: string[] = [];
  for (const t of orig) if (!fmt.has(t)) missing.push(t);
  return missing;
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx vitest run tests/phases/format-utils.test.ts
```

Expected: PASS все тесты.

- [ ] **Step 5: Commit**

```bash
git add src/phases/format-utils.ts tests/phases/format-utils.test.ts
git commit -m "feat(format): JSON extractor and significant-tokens validator"
```

---

## Task 6: Фаза `runFormat` (без vision)

**Files:**
- Create: `src/phases/format.ts`
- Create: `tests/phases/format.test.ts`
- Create: `tests/fixtures/format-sample.md`

- [ ] **Step 1: Создать фикстуру**

`tests/fixtures/format-sample.md`:

```md
# Заметка про ClickHouse

ClickHouse — колоночная СУБД от Яндекса. Использует SQL-диалект.

Версия 23.8 поддерживает Replicated движок.

См. https://clickhouse.com/docs.

Метод `insertBatch` принимает массив строк.
```

- [ ] **Step 2: Failing test**

`tests/phases/format.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runFormat } from "../../src/phases/format";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient, ChatMessage } from "../../src/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VAULT = "/vault";
const FILE = "note.md";
const SAMPLE = readFileSync(join(__dirname, "../fixtures/format-sample.md"), "utf-8");

function mockAdapter(files: Record<string, string> = {}): VaultAdapter {
  return {
    read: vi.fn().mockImplementation((p: string) => Promise.resolve(files[p] ?? "")),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLlm(responseJson: string): LlmClient {
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseJson } }] };
    },
  };
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue(stream) } },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []; for await (const e of gen) out.push(e); return out;
}

describe("runFormat", () => {
  it("парсит JSON, пишет temp, эмитит format_preview", async () => {
    const formatted = "---\ntags: [db]\n---\n\n# Заметка про ClickHouse\n\nClickHouse 23.8 SQL https://clickhouse.com/docs `insertBatch`. Яндекс.";
    const json = JSON.stringify({ report: "## Изменения\n- frontmatter", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    const preview = events.find((e: any) => e.kind === "format_preview");
    expect(preview).toBeDefined();
    expect((preview as any).tempPath).toBe("!Temp/note.formatted.md");
    expect((preview as any).report).toContain("frontmatter");
    expect(adapter.write).toHaveBeenCalledWith("!Temp/note.formatted.md", formatted);
  });

  it("при невалидном JSON эмитит error и не пишет temp", async () => {
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm("not json"), "model", false, [], new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("validator: при потере значимых токенов добавляет их в missingTokens", async () => {
    const formatted = "# Заметка"; // потеряли 23.8, ClickHouse, https://..., insertBatch, Яндекса
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    const preview = events.find((e: any) => e.kind === "format_preview") as any;
    expect(preview.missingTokens.length).toBeGreaterThan(0);
    expect(preview.missingTokens).toContain("https://clickhouse.com/docs");
  });

  it("создаёт !Temp если папки нет", async () => {
    const formatted = SAMPLE;
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    (adapter.exists as any).mockResolvedValue(false);
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal));
    expect(adapter.mkdir).toHaveBeenCalledWith("!Temp");
  });

  it("abort прекращает работу без записи temp", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, makeLlm("{}"), "model", false, [], ctrl.signal));
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("включает chat history в messages при refine", async () => {
    const formatted = SAMPLE;
    const json = JSON.stringify({ report: "r", formatted });
    const llm = makeLlm(json);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const history: ChatMessage[] = [
      { role: "user", content: "сделай таблицу из параметров" },
      { role: "assistant", content: "ок, переделал" },
    ];
    await collect(runFormat([FILE], vt, llm, "model", false, history, new AbortController().signal));
    const callArgs = (llm.chat.completions.create as any).mock.calls[0][0];
    const messages = callArgs.messages as Array<{ role: string; content: unknown }>;
    expect(messages.some((m) => m.role === "user" && (m.content as string).includes("сделай таблицу"))).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
  });
});
```

- [ ] **Step 3: Run — verify FAIL**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: FAIL — модуль `runFormat` не найден.

- [ ] **Step 4: Реализация**

`src/phases/format.ts`:

```ts
import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";
import formatTemplate from "../../prompts/format.md";
import formatSchema from "../../templates/_format-schema.md";
import { render } from "./template";
import { extractJsonObject, missingTokens } from "./format-utils";

const TEMP_FOLDER = "!Temp";

export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const filePath = args[0];

  if (!filePath) {
    yield { kind: "error", message: "Format: file path is required" };
    return;
  }
  if (signal.aborted) return;

  const original = await vaultTools.read(filePath);
  if (!original) {
    yield { kind: "error", message: `Format: cannot read ${filePath}` };
    return;
  }

  const systemContent = render(formatTemplate, {
    format_schema: formatSchema,
    has_vision: String(hasVision),
  });

  const userInitial =
    `Исходный файл: ${filePath}\n---\n${original}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userInitial },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  yield { kind: "assistant_text", delta: `Анализ файла ${filePath}...\n` };

  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
  }

  if (signal.aborted) return;

  const parsed = extractJsonObject(fullText);
  if (!parsed) {
    yield { kind: "error", message: "Format: LLM вернул невалидный JSON" };
    yield { kind: "result", durationMs: Date.now() - start, text: fullText };
    return;
  }

  const baseName = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "page";
  const tempPath = `${TEMP_FOLDER}/${baseName}.formatted.md`;

  try {
    if (!(await vaultTools.exists(TEMP_FOLDER))) {
      await vaultTools.mkdir(TEMP_FOLDER);
    }
    await vaultTools.write(tempPath, parsed.formatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись temp не удалась — ${(e as Error).message}` };
    return;
  }

  const missing = missingTokens(original, parsed.formatted);
  yield { kind: "format_preview", tempPath, report: parsed.report, missingTokens: missing };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.report };
}
```

- [ ] **Step 5: Расширить VaultTools (если нужно)**

Проверить что `VaultTools` экспортирует `exists`/`mkdir`. Если нет — добавить минимальные обёртки.

```bash
grep -n "exists\|mkdir" src/vault-tools.ts
```

Если методов нет — добавить:

```ts
async exists(path: string): Promise<boolean> {
  return this.adapter.exists(path);
}
async mkdir(path: string): Promise<void> {
  return this.adapter.mkdir(path);
}
```

- [ ] **Step 6: Run — verify PASS**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: PASS все тесты.

- [ ] **Step 7: Commit**

```bash
git add src/phases/format.ts tests/phases/format.test.ts tests/fixtures/format-sample.md src/vault-tools.ts
git commit -m "feat(format): runFormat phase with JSON parse and validator"
```

---

## Task 7: Vision-режим в `runFormat`

**Files:**
- Modify: `src/phases/format.ts`
- Modify: `tests/phases/format.test.ts`

- [ ] **Step 1: Failing test**

Добавить в `tests/phases/format.test.ts`:

```ts
it("при hasVision=true и наличии image-ссылки добавляет image_url content blocks", async () => {
  const sampleWithImg = SAMPLE + "\n\n![схема](images/diagram.png)\n";
  const formatted = sampleWithImg;
  const json = JSON.stringify({ report: "r", formatted });
  const llm = makeLlm(json);
  const adapter = mockAdapter({ [FILE]: sampleWithImg });
  const vt = new VaultTools(adapter, VAULT);
  await collect(runFormat([FILE], vt, llm, "model", true, [], new AbortController().signal));
  const callArgs = (llm.chat.completions.create as any).mock.calls[0][0];
  const messages = callArgs.messages as Array<{ role: string; content: unknown }>;
  const userMsg = messages.find((m) => m.role === "user")!;
  expect(Array.isArray(userMsg.content)).toBe(true);
  const blocks = userMsg.content as Array<{ type: string }>;
  expect(blocks.some((b) => b.type === "image_url")).toBe(true);
});

it("при hasVision=false image-ссылки в content blocks НЕ добавляет", async () => {
  const sampleWithImg = SAMPLE + "\n\n![схема](images/diagram.png)\n";
  const formatted = sampleWithImg;
  const json = JSON.stringify({ report: "r", formatted });
  const llm = makeLlm(json);
  const adapter = mockAdapter({ [FILE]: sampleWithImg });
  const vt = new VaultTools(adapter, VAULT);
  await collect(runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal));
  const callArgs = (llm.chat.completions.create as any).mock.calls[0][0];
  const messages = callArgs.messages as Array<{ role: string; content: unknown }>;
  const userMsg = messages.find((m) => m.role === "user")!;
  expect(typeof userMsg.content).toBe("string");
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run tests/phases/format.test.ts -t "hasVision"
```

Expected: FAIL — image_url не добавляется.

- [ ] **Step 3: Реализация в `format.ts`**

Заменить блок построения user-сообщения:

```ts
const imagePaths = hasVision ? extractImagePaths(original) : [];

const userContent: OpenAI.Chat.ChatCompletionContentPart[] | string =
  imagePaths.length > 0
    ? [
        { type: "text", text: userInitial },
        ...imagePaths.map<OpenAI.Chat.ChatCompletionContentPart>((p) => ({
          type: "image_url",
          image_url: { url: resolveImageUrl(p, filePath) },
        })),
      ]
    : userInitial;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: systemContent },
  { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
  ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
];
```

И добавить хелперы:

```ts
function extractImagePaths(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1].trim();
    if (!url.startsWith("http")) out.push(url);
  }
  return out;
}

function resolveImageUrl(imgPath: string, filePath: string): string {
  // Vault-relative paths; для простоты — отдаём как есть. Backend (claude-cli)
  // сам резолвит относительные пути от cwd.
  return imgPath;
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: PASS все тесты.

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts tests/phases/format.test.ts
git commit -m "feat(format): vision support — image_url blocks for claude backend"
```

---

## Task 8: Маршрут `format` в AgentRunner

**Files:**
- Modify: `src/agent-runner.ts`
- Modify: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Failing test**

Добавить в `tests/agent-runner.integration.test.ts`:

```ts
it("маршрутизирует operation=format в runFormat", async () => {
  // mock LlmClient возвращает валидный format JSON
  const formatted = "# OK";
  const json = JSON.stringify({ report: "r", formatted });
  const llm = makeStreamingLlm(json);  // существующий хелпер или аналог
  const adapter = makeAdapter({ "note.md": "# Заметка ClickHouse 1.0" });
  const vt = new VaultTools(adapter, "/vault");
  const runner = new AgentRunner(llm, settingsWithFormat(), vt, "vault", []);
  const ctrl = new AbortController();
  const events: any[] = [];
  for await (const ev of runner.run({
    operation: "format", args: ["note.md"], cwd: "/vault",
    signal: ctrl.signal, timeoutMs: 60000,
  })) events.push(ev);
  expect(events.some((e) => e.kind === "format_preview")).toBe(true);
});
```

(Адаптировать к существующим хелперам в файле.)

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run tests/agent-runner.integration.test.ts -t "format"
```

Expected: FAIL — `Unknown operation: format`.

- [ ] **Step 3: Добавить case в `agent-runner.ts`**

`src/agent-runner.ts:65` после `case "init"`:

```ts
case "format": {
  const hasVision = this.settings.backend === "claude-agent";
  yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts);
  break;
}
```

Импорт сверху файла:

```ts
import { runFormat } from "./phases/format";
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts tests/agent-runner.integration.test.ts
git commit -m "feat(agent-runner): route operation=format to runFormat"
```

---

## Task 9: Controller — guard и `format()` метод

**Files:**
- Modify: `src/controller.ts`
- Create: `tests/controller-format.test.ts`

- [ ] **Step 1: Failing test**

`tests/controller-format.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WikiController } from "../src/controller";
// ... импорты моков (см. tests/controller-mobile.test.ts как образец)

describe("WikiController.format", () => {
  it("показывает Notice если нет активного файла", async () => {
    const { controller, NoticeMock, app } = makeController();
    (app.workspace.getActiveFile as any).mockReturnValue(null);
    await controller.format();
    expect(NoticeMock).toHaveBeenCalled();
  });

  it("если файл внутри wiki-домена — открывает ConfirmModal с предложением Ingest", async () => {
    const { controller, app, ConfirmModalMock } = makeController({
      domains: [{ id: "ai", name: "AI", wiki_folder: "ии", source_paths: [] }],
    });
    (app.workspace.getActiveFile as any).mockReturnValue({ path: "ии/note.md", name: "note.md" });
    await controller.format();
    expect(ConfirmModalMock).toHaveBeenCalled();
  });

  it("если файл вне wiki — диспатчит format операцию", async () => {
    const { controller, app, dispatchSpy } = makeController({ domains: [] });
    (app.workspace.getActiveFile as any).mockReturnValue({ path: "notes/x.md", name: "x.md" });
    await controller.format();
    expect(dispatchSpy).toHaveBeenCalledWith("format", expect.any(Array), undefined, undefined, undefined, undefined);
  });
});
```

(Использовать существующие helpers из `tests/controller-*.test.ts`. Если их нет — построить минимальный mock-набор по образцу `controller-mobile.test.ts`.)

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run tests/controller-format.test.ts
```

Expected: FAIL — метод `format` не существует.

- [ ] **Step 3: Реализация в `controller.ts`**

Добавить поле:

```ts
private _pendingFormat: { originalPath: string; tempPath: string; chat: ChatMessage[] } | null = null;
```

Добавить метод (после `ingestActive` ~ строка 53):

```ts
async format(): Promise<void> {
  const file = this.app.workspace.getActiveFile();
  if (!file) { new Notice(i18n().ctrl.noActiveFile); return; }
  if (file.extension !== "md") { new Notice(i18n().view.formatOnlyMarkdown ?? "Format only works on markdown"); return; }

  const domains = await this.loadDomains();
  const inWiki = domains.find((d) => file.path.startsWith(d.wiki_folder + "/") || file.path === d.wiki_folder);
  if (inWiki) {
    new ConfirmModal(
      this.app,
      i18n().view.formatInWikiTitle,
      [i18n().view.formatInWikiBody(inWiki.id)],
      () => void this.suggestIngestForWikiFile(file.path, inWiki),
    ).open();
    return;
  }

  this._pendingFormat = { originalPath: file.path, tempPath: "", chat: [] };
  await this.dispatch("format", [file.path], undefined, undefined, undefined, undefined);
}

private async suggestIngestForWikiFile(filePath: string, domain: DomainEntry): Promise<void> {
  // читаем frontmatter, ищем wiki_sources
  const content = await this.app.vault.adapter.read(filePath);
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { new Notice(i18n().view.formatInWikiNoSources); return; }
  const frontmatter = m[1];
  const sourcesMatch = frontmatter.match(/wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/);
  if (!sourcesMatch) { new Notice(i18n().view.formatInWikiNoSources); return; }
  const sources = sourcesMatch[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  if (!sources.length) { new Notice(i18n().view.formatInWikiNoSources); return; }
  await this.init(domain.id, false, sources);
}
```

Импорт `ConfirmModal` сверху уже есть.

В `dispatch()`: после события `format_preview` обновить `_pendingFormat.tempPath`. Вставить в цикл for-await (~строка 371):

```ts
if (ev.kind === "format_preview" && this._pendingFormat) {
  this._pendingFormat.tempPath = ev.tempPath;
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx vitest run tests/controller-format.test.ts
```

Expected: PASS базовые тесты (для guard wiki-folder).

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts tests/controller-format.test.ts
git commit -m "feat(controller): format() with wiki-folder guard and pending state"
```

---

## Task 10: Controller — `formatRefine`, `formatApply`, `formatCancel`

**Files:**
- Modify: `src/controller.ts`
- Modify: `tests/controller-format.test.ts`

- [ ] **Step 1: Failing tests**

В `tests/controller-format.test.ts` добавить:

```ts
it("formatApply переносит content из temp в оригинал, удаляет temp", async () => {
  const { controller, vault } = makeController();
  controller["_pendingFormat"] = { originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [] };
  (vault.adapter.read as any).mockResolvedValueOnce("ОТФОРМАТИРОВАНО");
  await controller.formatApply();
  expect(vault.adapter.write).toHaveBeenCalledWith("x.md", "ОТФОРМАТИРОВАНО");
  expect(vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
  expect(controller["_pendingFormat"]).toBeNull();
});

it("formatCancel удаляет temp без изменения оригинала", async () => {
  const { controller, vault } = makeController();
  controller["_pendingFormat"] = { originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [] };
  await controller.formatCancel();
  expect(vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
  expect(vault.adapter.write).not.toHaveBeenCalledWith("x.md", expect.anything());
  expect(controller["_pendingFormat"]).toBeNull();
});

it("formatApply без _pendingFormat — Notice + no-op", async () => {
  const { controller, vault, NoticeMock } = makeController();
  await controller.formatApply();
  expect(vault.adapter.write).not.toHaveBeenCalled();
  expect(NoticeMock).toHaveBeenCalled();
});

it("formatRefine добавляет сообщение в chat и редиспатчит format", async () => {
  const { controller, dispatchSpy } = makeController();
  controller["_pendingFormat"] = { originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [] };
  await controller.formatRefine("сделай таблицу");
  expect(controller["_pendingFormat"]!.chat).toEqual([{ role: "user", content: "сделай таблицу" }]);
  expect(dispatchSpy).toHaveBeenCalledWith("format", ["x.md"], undefined, undefined, undefined, undefined);
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run tests/controller-format.test.ts -t "formatApply|formatCancel|formatRefine"
```

Expected: FAIL — методов нет.

- [ ] **Step 3: Реализация**

Добавить в `controller.ts`:

```ts
async formatApply(): Promise<void> {
  const p = this._pendingFormat;
  if (!p || !p.tempPath) { new Notice(i18n().view.formatNoPending ?? "No format preview to apply"); return; }
  if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
  try {
    const content = await this.app.vault.adapter.read(p.tempPath);
    await this.app.vault.adapter.write(p.originalPath, content);
    await this.app.vault.adapter.remove(p.tempPath);
    new Notice(i18n().view.formatApplied(p.originalPath));
    this.activeView()?.appendEvent({ kind: "format_applied", path: p.originalPath });
  } catch (e) {
    new Notice(i18n().ctrl.errorPrefix((e as Error).message));
  } finally {
    this._pendingFormat = null;
    this.onBusyChange?.();
  }
}

async formatCancel(): Promise<void> {
  const p = this._pendingFormat;
  if (!p || !p.tempPath) { this._pendingFormat = null; return; }
  try { await this.app.vault.adapter.remove(p.tempPath); } catch { /* orphan */ }
  this._pendingFormat = null;
  new Notice(i18n().view.formatCancelled);
  this.activeView()?.appendEvent({ kind: "format_cancelled" });
  this.onBusyChange?.();
}

async formatRefine(message: string): Promise<void> {
  const p = this._pendingFormat;
  if (!p) { new Notice(i18n().view.formatNoPending ?? "No format preview to refine"); return; }
  if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
  p.chat.push({ role: "user", content: message });
  // Передаём chat history через RunRequest.chatMessages — расширить dispatch:
  await this.dispatchFormatRefine(p);
}

private async dispatchFormatRefine(p: { originalPath: string; tempPath: string; chat: ChatMessage[] }): Promise<void> {
  // Аналог dispatch, но с chatMessages = p.chat. Используем ветку format в AgentRunner.
  await this.dispatch("format", [p.originalPath], undefined, undefined, undefined, undefined);
}
```

Расширить `dispatch()` сигнатуру: пробросить `chatMessages` для format. Самый простой способ — проверить операцию:

```ts
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError): Promise<void> {
  // ... после создания runGen:
  const chatMessages = op === "format" ? this._pendingFormat?.chat ?? [] : undefined;
  const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages });
```

- [ ] **Step 4: Расширить assistant message в `_pendingFormat.chat` после получения report**

В цикле обработки событий dispatch:

```ts
if (ev.kind === "format_preview" && this._pendingFormat) {
  this._pendingFormat.tempPath = ev.tempPath;
  // Сохраняем response в историю для следующего refine
  this._pendingFormat.chat.push({ role: "assistant", content: ev.report });
}
```

- [ ] **Step 5: Run — verify PASS**

```bash
npx vitest run tests/controller-format.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts tests/controller-format.test.ts
git commit -m "feat(controller): formatApply/formatCancel/formatRefine"
```

---

## Task 11: i18n keys

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Добавить ключи в EN и RU**

Найти секцию `view:` в `en` объекте, добавить:

```ts
format: "Format",
formatConfirmTitle: "Format — confirm",
formatConfirmBody: "Claude will analyze the active page and propose formatting changes. Preview will be saved to !Temp/.",
formatInWikiTitle: "File in wiki domain",
formatInWikiBody: (id: string) => `File belongs to wiki domain «${id}». Format does not apply to wiki pages. Run Ingest on its sources?`,
formatInWikiNoSources: "No source paths in wiki_sources frontmatter — Ingest unavailable.",
formatPreviewTitle: "Format preview",
formatApply: "Apply",
formatCancel: "Cancel",
formatRegenerating: "Regenerating preview…",
formatApplied: (path: string) => `Applied to ${path}`,
formatCancelled: "Format cancelled",
formatTokensMissing: (list: string) => `Significant tokens missing: ${list}. Refine via chat or cancel.`,
formatOnlyMarkdown: "Format only works on markdown files",
formatNoPending: "No format preview to apply or refine",
```

В RU-объекте — переводы:

```ts
format: "Форматирование",
formatConfirmTitle: "Форматирование — подтверждение",
formatConfirmBody: "Claude проанализирует открытую страницу и предложит правки. Preview будет сохранён в !Temp/.",
formatInWikiTitle: "Файл в wiki-домене",
formatInWikiBody: (id: string) => `Файл относится к wiki-домену «${id}». Format не применяется к wiki-страницам. Запустить Ingest на основании источников?`,
formatInWikiNoSources: "В wiki_sources frontmatter нет путей источников — Ingest невозможен.",
formatPreviewTitle: "Format preview",
formatApply: "Применить",
formatCancel: "Отмена",
formatRegenerating: "Регенерация preview…",
formatApplied: (path: string) => `Применено к ${path}`,
formatCancelled: "Форматирование отменено",
formatTokensMissing: (list: string) => `Утрачены значимые токены: ${list}. Уточните через чат или отмените.`,
formatOnlyMarkdown: "Format работает только с markdown-файлами",
formatNoPending: "Нет активного preview для применения или уточнения",
```

В `settings.*` (en и ru):

```ts
op_format: "Format" / "Форматирование",
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: TS compile успешен (en и ru объекты структурно совпадают).

- [ ] **Step 3: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): Format operation keys for en and ru"
```

---

## Task 12: View — кнопка Format и preview-блок

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Добавить кнопку**

В `onOpen()` около строки 113-114, после `lintBtn`:

```ts
this.formatBtn = actionRow.createEl("button", { text: T.view.format });
this.formatBtn.addEventListener("click", () => {
  new ConfirmModal(this.plugin.app, T.view.formatConfirmTitle, [T.view.formatConfirmBody],
    () => void this.plugin.controller.format()).open();
});
```

Добавить поле в класс:

```ts
private formatBtn!: HTMLButtonElement;
private formatPreviewSection: HTMLElement | null = null;
private formatApplyBtn: HTMLButtonElement | null = null;
private formatCancelBtn: HTMLButtonElement | null = null;
```

В `setRunning()` дисейблить `formatBtn`:

```ts
this.formatBtn.disabled = true;
```

В `finish()` (или эквивалент) — `formatBtn.disabled = false`. Найти где включаются другие кнопки.

- [ ] **Step 2: Обработка `format_preview` события**

В `appendEvent()`:

```ts
if (ev.kind === "format_preview") {
  this.renderFormatPreview(ev.tempPath, ev.report, ev.missingTokens);
  return;
}
if (ev.kind === "format_applied") {
  this.formatPreviewSection?.remove();
  this.formatPreviewSection = null;
  return;
}
if (ev.kind === "format_cancelled") {
  this.formatPreviewSection?.remove();
  this.formatPreviewSection = null;
  return;
}
```

- [ ] **Step 3: Метод `renderFormatPreview`**

Добавить в класс:

```ts
private renderFormatPreview(tempPath: string, report: string, missing: string[]): void {
  const T = i18n();
  this.formatPreviewSection?.remove();

  const root = this.containerEl.children[1] as HTMLElement;
  this.formatPreviewSection = root.createDiv("llm-wiki-format-preview");

  const header = this.formatPreviewSection.createEl("h4", { text: T.view.formatPreviewTitle });
  void header;

  const link = this.formatPreviewSection.createEl("a", {
    text: `📄 ${tempPath}`,
    cls: "internal-link",
    attr: { href: tempPath, "data-href": tempPath },
  });
  void link;
  registerLinkHandler(this.formatPreviewSection, this.app);

  const reportEl = this.formatPreviewSection.createDiv("llm-wiki-format-report");
  void MarkdownRenderer.render(this.app, report, reportEl, "", new Component());

  if (missing.length > 0) {
    const warn = this.formatPreviewSection.createDiv("llm-wiki-format-warn");
    warn.setText(T.view.formatTokensMissing(missing.join(", ")));
  }

  const btnRow = this.formatPreviewSection.createDiv("llm-wiki-format-actions");
  this.formatApplyBtn = btnRow.createEl("button", { text: T.view.formatApply, cls: "mod-cta" });
  this.formatApplyBtn.disabled = missing.length > 0;
  this.formatApplyBtn.addEventListener("click", () => void this.plugin.controller.formatApply());

  this.formatCancelBtn = btnRow.createEl("button", { text: T.view.formatCancel, cls: "mod-warning" });
  this.formatCancelBtn.addEventListener("click", () => void this.plugin.controller.formatCancel());
}
```

- [ ] **Step 4: Build sanity**

```bash
npm run build
```

Expected: успешная сборка.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): Format button and preview block with Apply/Cancel"
```

---

## Task 13: View — чат для refine форматирования

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Добавить чат в `renderFormatPreview`**

В метод `renderFormatPreview` добавить блок чата ниже Apply/Cancel:

```ts
const chatBox = this.formatPreviewSection.createDiv("llm-wiki-format-chat");
chatBox.createEl("h5", { text: T.view.chatLabel });

const inputEl = chatBox.createEl("textarea", {
  cls: "llm-wiki-format-chat-input",
  attr: { placeholder: "Уточнение…", rows: "2" },
});
const sendBtn = chatBox.createEl("button", { text: T.view.chatSend });
sendBtn.addEventListener("click", () => {
  const msg = inputEl.value.trim();
  if (!msg) return;
  inputEl.value = "";
  void this.plugin.controller.formatRefine(msg);
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});
```

- [ ] **Step 2: При регенерации (новый `format_preview` после refine) — переотрисовать**

`renderFormatPreview` уже удаляет старую секцию первой строкой `this.formatPreviewSection?.remove()` — поведение корректное.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): chat input in format preview for refine"
```

---

## Task 14: Settings UI для format-операции

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Найти секцию per-operation моделей и добавить format**

Найти в `settings.ts` блок где рендерятся секции `op_ingest`/`op_query`/`op_lint`/`op_init` (поиск по `op_ingest` или `operations.ingest`):

```bash
grep -n "op_ingest\|operations.ingest\|operations\[" src/settings.ts
```

В соответствующем месте добавить аналогичный блок для `format`:

```ts
// Для claude и native — добавить рендер op_format с полями model, maxTokens (и temperature для native).
// Структура повторяет op_lint.
```

Конкретный код зависит от текущей реализации `settings.ts`. Базовый паттерн:

```ts
const sectionFormat = container.createDiv();
sectionFormat.createEl("h4", { text: T.settings.op_format });
new Setting(sectionFormat)
  .setName(T.settings.opModel_name)
  .setDesc(T.settings.opModel_desc)
  .addText((t) => t
    .setValue(s.claudeAgent.operations.format.model)
    .onChange(async (v) => { s.claudeAgent.operations.format.model = v; await this.plugin.saveSettings(); }));
new Setting(sectionFormat)
  .setName(T.settings.opMaxTokens_name)
  .setDesc(T.settings.opMaxTokens_desc)
  .addText((t) => t
    .setValue(String(s.claudeAgent.operations.format.maxTokens))
    .onChange(async (v) => { const n = parseInt(v, 10); if (!isNaN(n)) { s.claudeAgent.operations.format.maxTokens = n; await this.plugin.saveSettings(); }}));
// аналогично для nativeAgent.operations.format с temperature
```

- [ ] **Step 2: timeouts.format в UI**

В секции timeouts (поиск `timeouts.ingest`) добавить поле `format`:

```ts
// найти текущий рендер таймаутов и добавить ещё один input для timeouts.format
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): UI for Format per-operation model and timeout"
```

---

## Task 15: Миграция настроек для существующих установок

**Files:**
- Modify: `src/main.ts` (или там где `loadSettings`)

- [ ] **Step 1: Найти место merge-а defaults с сохранёнными настройками**

```bash
grep -n "DEFAULT_SETTINGS\|loadData\|loadSettings" src/main.ts
```

- [ ] **Step 2: Тест миграции**

В `tests/main-migration.test.ts` (если существует) или новом `tests/format-migration.test.ts` — проверить что старые сохранённые настройки без `timeouts.format` и `operations.format` после загрузки получают дефолты.

```ts
import { describe, it, expect } from "vitest";
import { migrateSettings } from "../src/main";  // или адекватная точка входа

describe("settings migration: format", () => {
  it("добавляет timeouts.format = 600 если отсутствует", () => {
    const old = { timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600 } };
    const next = migrateSettings(old as any);
    expect(next.timeouts.format).toBe(600);
  });

  it("добавляет operations.format в claudeAgent и nativeAgent", () => {
    const old = {
      claudeAgent: { operations: { ingest: { model: "x", maxTokens: 1 }, query: { model: "x", maxTokens: 1 }, lint: { model: "x", maxTokens: 1 }, init: { model: "x", maxTokens: 1 } } },
      nativeAgent: { operations: { ingest: { model: "y", maxTokens: 1, temperature: 0 }, query: { model: "y", maxTokens: 1, temperature: 0 }, lint: { model: "y", maxTokens: 1, temperature: 0 }, init: { model: "y", maxTokens: 1, temperature: 0 } } },
    };
    const next = migrateSettings(old as any);
    expect(next.claudeAgent.operations.format).toBeDefined();
    expect(next.nativeAgent.operations.format).toBeDefined();
  });
});
```

- [ ] **Step 3: Run — verify FAIL**

```bash
npx vitest run tests/format-migration.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Реализация миграции**

Если `main.ts` уже мерджит через `Object.assign(DEFAULT_SETTINGS, loaded)` — добавить явное копирование под-объектов:

```ts
function migrateSettings(loaded: Partial<LlmWikiPluginSettings>): LlmWikiPluginSettings {
  const merged: LlmWikiPluginSettings = {
    ...DEFAULT_SETTINGS,
    ...loaded,
    timeouts: { ...DEFAULT_SETTINGS.timeouts, ...(loaded.timeouts ?? {}) },
    claudeAgent: {
      ...DEFAULT_SETTINGS.claudeAgent,
      ...(loaded.claudeAgent ?? {}),
      operations: { ...DEFAULT_SETTINGS.claudeAgent.operations, ...(loaded.claudeAgent?.operations ?? {}) },
    },
    nativeAgent: {
      ...DEFAULT_SETTINGS.nativeAgent,
      ...(loaded.nativeAgent ?? {}),
      operations: { ...DEFAULT_SETTINGS.nativeAgent.operations, ...(loaded.nativeAgent?.operations ?? {}) },
    },
  };
  return merged;
}
```

Использовать `migrateSettings()` в месте `loadData()`.

- [ ] **Step 5: Run — verify PASS**

```bash
npx vitest run tests/format-migration.test.ts
npm test
```

Expected: PASS все тесты.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/format-migration.test.ts
git commit -m "feat(settings): migrate old configs adding format defaults"
```

---

## Task 16: Версия и финальная проверка

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`
- Modify: `README.md`

- [ ] **Step 1: Patch-инкремент**

```bash
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); const m=JSON.parse(fs.readFileSync('src/manifest.json')); const [maj,min,pat]=p.version.split('.').map(Number); const next=[maj,min,pat+1].join('.'); p.version=next; m.version=next; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n'); fs.writeFileSync('src/manifest.json', JSON.stringify(m,null,2)+'\n'); console.log('bumped to', next);"
```

- [ ] **Step 2: Обновить README**

Добавить в `README.md` короткий раздел о Format-операции (3-5 строк):

```md
## Format

Анализирует открытую markdown-страницу (вне wiki-доменов), предлагает правки форматирования (frontmatter, заголовки, таблицы, mermaid, описания изображений). Preview сохраняется в `!Temp/`. Уточнение через чат, кнопки **Apply**/**Cancel**. Жёсткий инвариант: запрещено добавлять/удалять факты или искажать смысл — только перефраз для ясности.
```

- [ ] **Step 3: Запуск полного теста + билд**

```bash
npm test && npm run build
```

Expected: все тесты PASS, билд успешен.

- [ ] **Step 4: Smoke-тест в Obsidian (ручной)**

1. Открыть тестовый vault с симлинком плагина.
2. Reload Obsidian.
3. Открыть .md файл вне wiki-домена.
4. В боковой панели нажать **Format** → подтвердить.
5. Дождаться preview, открыть `!Temp/<name>.formatted.md` по ссылке.
6. Проверить отчёт, нажать **Apply** — оригинал должен обновиться, temp удалиться.
7. Повторить с .md файлом в wiki-домене → должен открыться диалог про Ingest.
8. Повторить с уточнением через чат → preview должен регенерироваться.

- [ ] **Step 5: Commit**

```bash
git add package.json src/manifest.json README.md
git commit -m "chore: bump version, add Format docs to README"
```

---

## Self-Review (выполнено перед сохранением плана)

**1. Spec coverage:**
- §2 UX-поток — Tasks 9, 12, 13 ✓
- §3 Архитектура — Tasks 6, 8, 9, 10 ✓
- §4 Файлы — Tasks 1-16 покрывают все ✓
- §5 Шаблон форматирования — Task 3 ✓
- §6 Контракт LLM — Tasks 4, 5, 6 ✓
- §7 Validator — Task 5, 6 ✓
- §8 UI — Tasks 12, 13 ✓
- §9 i18n — Task 11 ✓
- §10 Settings — Tasks 2, 14, 15 ✓
- §11 Тесты — Tasks 5, 6, 7, 8, 9, 10, 15 ✓
- §12 Edge cases — покрыты в Tasks 6 (mkdir), 9 (no active file, mobile через существующий dispatch guard), 10 (no pending) ✓
- §13 Версионирование — Task 16 ✓
- §14 Документация — Task 16 ✓

**2. Placeholder scan:** Каждый шаг содержит конкретный код или команду. Места где код зависит от существующей структуры (Task 14 settings.ts) — указан паттерн для адаптации.

**3. Type consistency:** `runFormat(args, vaultTools, llm, model, hasVision, chatHistory, signal, opts)` — сигнатура совпадает между Tasks 6, 7, 8. `RunEvent` варианты `format_preview`/`format_applied`/`format_cancelled` используются согласованно. `_pendingFormat: { originalPath, tempPath, chat }` — одна структура везде.
