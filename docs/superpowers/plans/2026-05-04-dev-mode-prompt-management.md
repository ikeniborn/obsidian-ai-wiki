# Dev Mode: Prompt Management & Quality Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вынести системные промты фаз в `prompts/*.md`, исправить поведение поля "User prompt" в настройках, добавить подраздел "Разработка" с dev-логгером и evaluator-фазой.

**Architecture:** Markdown-шаблоны хранятся в `prompts/` (корень репозитория) и встраиваются esbuild'ом как строки (лоадер уже настроен). Функция `render()` в `src/phases/template.ts` подставляет `{{var}}` переменные. Dev-режим добавляет JSONL-запись и LLM-вызов оценщика в конце каждой операции через `AgentRunner`.

**Tech Stack:** TypeScript, esbuild (`.md` → text, уже настроен), vitest, Obsidian Plugin API

---

## Файловая карта

| Путь | Действие |
|---|---|
| `prompts/ingest.md` | создать |
| `prompts/query.md` | создать |
| `prompts/lint.md` | создать |
| `prompts/chat.md` | создать |
| `prompts/fix.md` | создать |
| `prompts/init.md` | создать |
| `prompts/evaluator.md` | создать |
| `src/phases/template.ts` | создать |
| `src/phases/evaluator.ts` | создать |
| `tests/template.test.ts` | создать |
| `src/phases/ingest.ts` | изменить — использовать `render()` |
| `src/phases/query.ts` | изменить — использовать `render()` |
| `src/phases/lint.ts` | изменить — использовать `render()` |
| `src/phases/chat.ts` | изменить — использовать `render()` |
| `src/phases/fix.ts` | изменить — использовать `render()` |
| `src/phases/init.ts` | изменить — использовать `render()` |
| `src/phases/llm-utils.ts` | изменить — append + "## Уточнение" |
| `src/types.ts` | изменить — DevModeSettings, eval_result, devMode |
| `src/settings.ts` | изменить — rename + dev mode UI |
| `src/i18n.ts` | изменить — обновить тексты |
| `src/agent-runner.ts` | изменить — dev logger + evaluator |
| `src/view.ts` | изменить — рендер eval_result |

---

## Task 1: `template.ts` — функция render()

**Files:**
- Create: `src/phases/template.ts`
- Create: `tests/template.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
// tests/template.test.ts
import { describe, it, expect } from "vitest";
import { render } from "../src/phases/template";

describe("render", () => {
  it("substitutes known variables", () => {
    expect(render("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("leaves unknown placeholders as-is", () => {
    expect(render("Hello {{unknown}}!", {})).toBe("Hello {{unknown}}!");
  });

  it("handles multiple occurrences of same variable", () => {
    expect(render("{{x}} and {{x}}", { x: "A" })).toBe("A and A");
  });

  it("handles empty template", () => {
    expect(render("", { x: "A" })).toBe("");
  });

  it("does not replace partial-match patterns", () => {
    expect(render("{{ name }}", { name: "X" })).toBe("{{ name }}");
  });
});
```

- [ ] **Шаг 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/template.test.ts
```

Ожидается: FAIL — `render` не существует.

- [ ] **Шаг 3: Реализовать `template.ts`**

```ts
// src/phases/template.ts
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
```

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
npx vitest run tests/template.test.ts
```

Ожидается: PASS (5 тестов).

- [ ] **Шаг 5: Коммит**

```bash
git add src/phases/template.ts tests/template.test.ts
git commit -m "feat: add template render() function with tests"
```

---

## Task 2: Создать шаблоны `prompts/*.md`

**Files:**
- Create: `prompts/ingest.md`
- Create: `prompts/query.md`
- Create: `prompts/lint.md`
- Create: `prompts/chat.md`
- Create: `prompts/fix.md`
- Create: `prompts/init.md`
- Create: `prompts/evaluator.md`

Переменные для шаблонов получаются из существующих `build*Messages()` функций в фазах. Пустые переменные дают пустую строку — `render()` оставляет их как есть только если ключ отсутствует; передавать пустую строку `""` безопасно.

- [ ] **Шаг 1: Создать `prompts/ingest.md`**

```markdown
Ты — ассистент синтеза wiki-знаний для домена «{{domain_name}}».
Извлекай сущности из источника и создавай/обновляй wiki-страницы.

ТИПЫ СУЩНОСТЕЙ ДОМЕНА:
{{entity_types_block}}
{{lang_notes}}

ПРАВИЛА:
- CREATE: сущность не существует в wiki, упоминаний >= min_mentions_for_page
- UPDATE: сущность существует → добавить новую информацию, НЕ удалять старую
- SKIP: слишком мало упоминаний или информация уже есть
- Синтез, не копирование. Технические конфиги/SQL можно цитировать в code-блоках.
- Путь страницы должен начинаться с "{{wiki_path}}/"
- Frontmatter обязателен: wiki_sources, wiki_updated: {{today}}, wiki_status: stub|developing|mature
{{schema_block}}

Верни ТОЛЬКО JSON-массив, без другого текста:
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [{{source_path}}]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\n---\n# EntityName\n\ncontент..."}]
```

- [ ] **Шаг 2: Создать `prompts/query.md`**

```markdown
Ты — ассистент по wiki-базе знаний домена «{{domain_name}}».
Отвечай строго на основе предоставленных wiki-страниц. Будь точен и лаконичен.
Используй WikiLinks [[название]] при ссылках на страницы из индекса.
{{entity_types_block}}
{{schema_block}}
{{index_block}}
```

- [ ] **Шаг 3: Создать `prompts/lint.md`**

```markdown
Ты — рецензент качества wiki-базы знаний домена «{{domain_name}}».
Выявляй: дублирование, пробелы, размытые определения, устаревший контент.
Верни краткий отчёт в markdown.
{{entity_types_block}}
```

- [ ] **Шаг 4: Создать `prompts/chat.md`**

```markdown
{{domain_header}}
Помогай пользователю анализировать и исправлять проблемы, выявленные lint-проверкой.
Отвечай конкретно, ссылаясь на страницы и сущности из отчёта.

ОТЧЁТ LINT:
{{lint_report}}
```

- [ ] **Шаг 5: Создать `prompts/fix.md`**

```markdown
Ты — редактор wiki-базы знаний домена «{{domain_name}}».
{{fix_instruction}}

{{entity_types_block}}
Верни ТОЛЬКО JSON-массив изменённых страниц (если страница не изменилась — не включай):
[{"path":"{{wiki_path}}/EntityName.md","content":"полный контент страницы"}]
Допустимые пути wiki: {{wiki_path}}/
Дата: {{today}}
```

- [ ] **Шаг 6: Создать `prompts/init.md`**

```markdown
Ты — архитектор wiki-базы знаний. Сгенерируй запись домена для domain-map.json.
Верни ТОЛЬКО валидный JSON следующей структуры:
{
  "id": "{{domain_id}}",
  "name": "Человекочитаемое название",
  "wiki_folder": "vaults/{{vault_name}}/!Wiki/{{domain_id}}",
  "source_paths": [],
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"{{domain_id}}/..."}],
  "language_notes": ""
}
{{schema_block}}
{{index_block}}
```

- [ ] **Шаг 7: Создать `prompts/evaluator.md`**

```markdown
Ты — оценщик качества работы wiki-агента. Оцени результат операции.

Операция: {{operation}}

Входное задание:
{{task_input}}

Результат:
{{result}}

Верни JSON строго в формате:
{"score": <0-10>, "reasoning": "<одно предложение>"}

Критерии оценки:
- 9-10: результат полностью соответствует заданию, без ошибок
- 7-8: результат корректен, есть незначительные недочёты
- 5-6: задание выполнено частично
- 0-4: результат не соответствует заданию или содержит ошибки
```

- [ ] **Шаг 8: Убедиться, что TypeScript видит `.md` импорты**

Файл `src/md-modules.d.ts` уже существует:
```ts
declare module "*.md" {
  const content: string;
  export default content;
}
```

esbuild уже настроен: `loader: { ".md": "text" }` в `esbuild.config.mjs`. Дополнительных изменений не требуется.

- [ ] **Шаг 9: Коммит**

```bash
git add prompts/
git commit -m "feat: add prompt templates for all agent phases"
```

---

## Task 3: Рефактор фаз — использовать `render()`

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/chat.ts`
- Modify: `src/phases/fix.ts`
- Modify: `src/phases/init.ts`

- [ ] **Шаг 1: Рефактор `ingest.ts`**

Добавить импорты в начало файла:
```ts
import ingestTemplate from "../../prompts/ingest.md";
import { render } from "./template";
```

Заменить тело `buildIngestMessages()` (строки 228–282). Функция `buildEntityTypesBlock()` остаётся без изменений — она нужна в `lint.ts`. Вместо конкатенации строк:

```ts
function buildIngestMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
  wikiVaultPath: string,
  existingPages: Map<string, string>,
  schemaContent: string,
  indexContent: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c.slice(0, 400)}`).join("\n\n")
    : "Нет.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain);
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `КОНВЕНЦИИ (_schema.md):\n${schemaContent.slice(0, 2000)}` : "",
    source_path: sourcePath,
  });

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Wiki-папка: ${wikiVaultPath}`,
        ``,
        `Источник: ${sourcePath}`,
        sourceContent.slice(0, 8000),
        ``,
        `Существующие wiki-страницы:\n${existing}`,
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent.slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
```

- [ ] **Шаг 2: Рефактор `query.ts`**

Добавить импорты:
```ts
import queryTemplate from "../../prompts/query.md";
import { render } from "./template";
```

Заменить строки 69–76 (построение `systemPrompt`):

```ts
const systemPrompt = render(queryTemplate, {
  domain_name: domain.name,
  entity_types_block: entityTypesBlock,
  schema_block: schemaContent ? `\nКонвенции (_schema.md):\n${schemaContent.slice(0, 2000)}` : "",
  index_block: indexContent ? `\nВики-индекс (_index.md):\n${indexContent.slice(0, 3000)}` : "",
});
```

- [ ] **Шаг 3: Рефактор `lint.ts`**

Добавить импорты:
```ts
import lintTemplate from "../../prompts/lint.md";
import { render } from "./template";
```

Заменить систему сообщений lint (строки 56–75):

```ts
const systemContent = render(lintTemplate, {
  domain_name: domain.name,
  entity_types_block: entityTypesBlock ? `\nТИПЫ СУЩНОСТЕЙ ДОМЕНА:\n${entityTypesBlock}` : "",
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: systemContent },
  {
    role: "user",
    content: [
      `Домен: ${domain.id} (${domain.name})`,
      `Автоматические проблемы:\n${structuralIssues || "Нет."}`,
      "",
      `Wiki-страницы:\n${[...pages.entries()].map(([p, c]) => `--- ${p} ---\n${c.slice(0, 500)}`).join("\n\n")}`,
    ].join("\n"),
  },
];
```

- [ ] **Шаг 4: Рефактор `chat.ts`**

Добавить импорты:
```ts
import chatTemplate from "../../prompts/chat.md";
import { render } from "./template";
```

Заменить построение `systemContent` (строки 17–25):

```ts
const domainHeader = domain
  ? `Ты — редактор wiki-базы знаний домена «${domain.name || domain.id}».`
  : `Ты — редактор wiki-базы знаний.`;

const systemContent = render(chatTemplate, {
  domain_header: domainHeader,
  lint_report: lintReport,
});
```

- [ ] **Шаг 5: Рефактор `fix.ts`**

Добавить импорты:
```ts
import fixTemplate from "../../prompts/fix.md";
import { render } from "./template";
```

Заменить `buildFixMessages()` (строки 140–180):

```ts
function buildFixMessages(
  domain: DomainEntry,
  wikiVaultPath: string,
  pages: Map<string, string>,
  structuralIssues: string,
  entityTypesBlock: string,
  lintReport?: string,
  userInstruction?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const today = new Date().toISOString().slice(0, 10);
  const pagesBlock = [...pages.entries()]
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  const fixInstruction = userInstruction
    ? `Выполни задачу пользователя. Верни только изменённые страницы.`
    : `Исправь проблемы в wiki-страницах и верни только изменённые страницы.`;

  const systemContent = render(fixTemplate, {
    domain_name: domain.name,
    fix_instruction: fixInstruction,
    entity_types_block: entityTypesBlock ? `ТИПЫ СУЩНОСТЕЙ:\n${entityTypesBlock}\n` : "",
    wiki_path: wikiVaultPath,
    today,
  });

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        userInstruction ? `ЗАДАЧА:\n${userInstruction}` : "",
        lintReport ? `\nОТЧЁТ LINT:\n${lintReport}` : "",
        structuralIssues ? `\nСТРУКТУРНЫЕ ПРОБЛЕМЫ:\n${structuralIssues}` : "",
        `\nWIKI-СТРАНИЦЫ домена ${domain.id}:\n${pagesBlock}`,
      ].filter(Boolean).join("\n"),
    },
  ];
}
```

- [ ] **Шаг 6: Рефактор `init.ts`**

Добавить импорты:
```ts
import initTemplate from "../../prompts/init.md";
import { render } from "./template";
```

Заменить построение `systemContent` (строки 49–62):

```ts
const systemContent = render(initTemplate, {
  domain_id: domainId,
  vault_name: vaultName,
  schema_block: schemaContent ? `\nКонвенции вики (_schema.md):\n${schemaContent.slice(0, 1500)}` : "",
  index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent.slice(0, 1000)}` : "",
});
```

- [ ] **Шаг 7: Запустить все тесты, убедиться что не сломали**

```bash
npm test
```

Ожидается: все существующие тесты PASS.

- [ ] **Шаг 8: Сборка**

```bash
npm run build
```

Ожидается: без ошибок.

- [ ] **Шаг 9: Коммит**

```bash
git add src/phases/
git commit -m "refactor: extract phase system prompts to prompts/*.md templates"
```

---

## Task 4: Исправить User prompt (бывший systemPrompt)

**Files:**
- Modify: `src/phases/llm-utils.ts`
- Modify: `src/types.ts` (DEFAULT_SETTINGS)
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`

- [ ] **Шаг 1: Написать тест для нового поведения `injectSystemPrompt`**

В файле `tests/template.test.ts` добавить (или создать `tests/llm-utils.test.ts`):

```ts
// tests/llm-utils.test.ts
import { describe, it, expect } from "vitest";
import { buildChatParams } from "../src/phases/llm-utils";
import type OpenAI from "openai";

describe("buildChatParams — User prompt injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("appends User prompt as ## Уточнение section", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "Используй формальный стиль." });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(
      "Phase system prompt.\n\n## Уточнение\nИспользуй формальный стиль.",
    );
  });

  it("does not modify messages when systemPrompt is empty", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe("Phase system prompt.");
  });

  it("does not modify messages when systemPrompt is absent", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe("Phase system prompt.");
  });

  it("creates system message when none exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, { systemPrompt: "note" });
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("## Уточнение\nnote");
  });
});
```

- [ ] **Шаг 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/llm-utils.test.ts
```

Ожидается: FAIL — текущая логика prepend, а не append.

- [ ] **Шаг 3: Изменить `injectSystemPrompt` в `src/phases/llm-utils.ts`**

Заменить функцию `injectSystemPrompt` (строки 30–41):

```ts
function injectSystemPrompt(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (!systemPrompt) return messages;
  const section = `## Уточнение\n${systemPrompt}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}
```

Также изменить строку 21 — добавить проверку на пустую строку:

```ts
const msgs = opts.systemPrompt ? injectSystemPrompt(messages, opts.systemPrompt) : messages;
```

(Это уже есть, но `injectSystemPrompt` теперь сама проверяет пустоту — оба условия корректны.)

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
npx vitest run tests/llm-utils.test.ts
```

Ожидается: PASS (4 теста).

- [ ] **Шаг 5: Обновить дефолт в `src/types.ts`**

Строка 131 — изменить дефолт поля `systemPrompt`:

```ts
systemPrompt: "",
```

- [ ] **Шаг 6: Обновить i18n в `src/i18n.ts`**

Найти и заменить все три языка (en, ru, es):

```ts
// EN (строки 7–8)
systemPrompt_name: "User prompt",
systemPrompt_desc: "Appended to the system prompt of every operation as a '## Уточнение' section. Empty by default.",

// RU (строки 143–144)
systemPrompt_name: "User prompt",
systemPrompt_desc: "Добавляется в конец системного промта каждой операции разделом «## Уточнение». По умолчанию пуст.",

// ES (строки 277–278)
systemPrompt_name: "User prompt",
systemPrompt_desc: "Se añade al final del prompt del sistema de cada operación como sección '## Уточнение'. Vacío por defecto.",
```

- [ ] **Шаг 7: Запустить все тесты**

```bash
npm test
```

Ожидается: PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add src/phases/llm-utils.ts src/types.ts src/i18n.ts tests/llm-utils.test.ts
git commit -m "feat: rename systemPrompt to User prompt, append as Уточнение section"
```

---

## Task 5: Dev mode — типы и настройки UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`

- [ ] **Шаг 1: Добавить `DevModeSettings` в `src/types.ts`**

После `export const DEFAULT_SETTINGS` добавить интерфейс перед ним (или внутри `LlmWikiPluginSettings`).

В интерфейс `LlmWikiPluginSettings` добавить поле:

```ts
devMode: {
  enabled: boolean;
  logPath: string;
  evaluatorModel: string;
};
```

В `DEFAULT_SETTINGS` добавить:

```ts
devMode: {
  enabled: false,
  logPath: "",
  evaluatorModel: "sonnet",
},
```

- [ ] **Шаг 2: Добавить строки i18n в `src/i18n.ts`**

В объект `settings` каждого языка добавить (перед закрывающей скобкой):

```ts
// EN
h3_devmode: "Developer",
devMode_enabled_name: "Dev mode",
devMode_enabled_desc: "Enable dev logger and evaluator after each operation.",
devMode_logPath_name: "Dev log path",
devMode_logPath_desc: "Path to JSONL file for dev logs.",
devMode_evaluatorModel_name: "Evaluator model",
devMode_evaluatorModel_desc: "Model name for the evaluator (same backend).",

// RU
h3_devmode: "Разработка",
devMode_enabled_name: "Dev режим",
devMode_enabled_desc: "Включить dev-логгер и оценщик после каждой операции.",
devMode_logPath_name: "Путь к dev-логу",
devMode_logPath_desc: "Путь к JSONL-файлу для dev-логов.",
devMode_evaluatorModel_name: "Модель оценщика",
devMode_evaluatorModel_desc: "Имя модели для оценщика (тот же бэкенд).",

// ES
h3_devmode: "Desarrollo",
devMode_enabled_name: "Modo dev",
devMode_enabled_desc: "Activar el registrador dev y el evaluador tras cada operación.",
devMode_logPath_name: "Ruta del log dev",
devMode_logPath_desc: "Ruta al archivo JSONL para logs dev.",
devMode_evaluatorModel_name: "Modelo evaluador",
devMode_evaluatorModel_desc: "Nombre del modelo para el evaluador (mismo backend).",
```

Также добавить соответствующие поля в тип `I18nMessages['settings']` если он явно типизирован.

- [ ] **Шаг 3: Добавить UI подраздел в `src/settings.ts`**

В конце метода `display()`, перед закрывающей скобкой, добавить:

```ts
// ── Dev mode ──────────────────────────────────────────────────────────────
new Setting(containerEl).setName(T.settings.h3_devmode).setHeading();

new Setting(containerEl)
  .setName(T.settings.devMode_enabled_name)
  .setDesc(T.settings.devMode_enabled_desc)
  .addToggle((t) =>
    t.setValue(s.devMode.enabled)
      .onChange(async (v) => { s.devMode.enabled = v; await this.plugin.saveSettings(); }),
  );

new Setting(containerEl)
  .setName(T.settings.devMode_logPath_name)
  .setDesc(T.settings.devMode_logPath_desc)
  .addText((t) =>
    t.setPlaceholder("/tmp/llm-wiki-dev.jsonl")
      .setValue(s.devMode.logPath)
      .onChange(async (v) => { s.devMode.logPath = v.trim(); await this.plugin.saveSettings(); }),
  );

new Setting(containerEl)
  .setName(T.settings.devMode_evaluatorModel_name)
  .setDesc(T.settings.devMode_evaluatorModel_desc)
  .addText((t) =>
    t.setPlaceholder("sonnet")
      .setValue(s.devMode.evaluatorModel)
      .onChange(async (v) => { s.devMode.evaluatorModel = v.trim(); await this.plugin.saveSettings(); }),
  );
```

- [ ] **Шаг 4: Убедиться что сборка проходит**

```bash
npm run build
```

Ожидается: без ошибок TypeScript.

- [ ] **Шаг 5: Коммит**

```bash
git add src/types.ts src/settings.ts src/i18n.ts
git commit -m "feat: add dev mode settings (enabled, logPath, evaluatorModel)"
```

---

## Task 6: Dev logger в `agent-runner.ts`

**Files:**
- Modify: `src/agent-runner.ts`

Dev logger пишет одну строку JSONL после завершения каждой операции. Для этого нужно перехватить финальный `result` event и системный промт, который использовала операция.

- [ ] **Шаг 1: Добавить функцию `writeDevLog` в `src/agent-runner.ts`**

Добавить импорты в начало файла:
```ts
import { appendFileSync } from "node:fs";
```

Добавить приватный метод в класс `AgentRunner`:

```ts
private writeDevLog(entry: {
  operation: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  result: string;
  durationMs: number;
}): void {
  const logPath = this.settings.devMode?.logPath;
  if (!logPath) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
    appendFileSync(logPath, line, "utf-8");
  } catch { /* не блокируем операцию */ }
}
```

- [ ] **Шаг 2: Перехватить промт и результат в `AgentRunner.run()`**

В методе `run()` нужно собрать `systemPrompt` и `userMessage`. Но фазы не возвращают их напрямую — они встроены в сообщения, которые передаются в `buildChatParams()`. Самый простой подход: сохранять `result.text` из `result` события и передавать информацию об операции.

Изменить метод `run()`:

```ts
async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
  const { model, opts } = this.buildOptsFor(req.operation);
  yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}` };

  if (req.signal.aborted) return;

  const repoRoot = req.cwd ?? "";
  const domains = req.domainId
    ? this.domains.filter((d) => d.id === req.domainId)
    : this.domains;

  const startMs = Date.now();
  let finalResultText = "";

  const gen = this.runOperation(req, model, opts, repoRoot, domains);
  for await (const ev of gen) {
    if (ev.kind === "result") finalResultText = ev.text;
    yield ev;
  }

  if (this.settings.devMode?.enabled && finalResultText) {
    const taskInput = req.args.join(" ") || req.operation;
    this.writeDevLog({
      operation: req.operation,
      model,
      systemPrompt: opts.systemPrompt ?? "",
      userMessage: taskInput,
      result: finalResultText,
      durationMs: Date.now() - startMs,
    });
  }
}
```

Вынести switch-блок из `run()` в приватный метод `runOperation()`:

```ts
private async *runOperation(
  req: RunRequest,
  model: string,
  opts: LlmCallOptions,
  repoRoot: string,
  domains: DomainEntry[],
): AsyncGenerator<RunEvent, void, void> {
  switch (req.operation) {
    case "ingest":
      yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
      break;
    case "query":
      yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
      break;
    case "query-save":
      yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
      break;
    case "lint":
      yield* runLint(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts);
      break;
    case "fix":
      yield* runFix(req.args, this.vaultTools, this.llm, model, domains, repoRoot, req.signal, opts, req.context, req.instruction);
      break;
    case "chat": {
      const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
      yield* runLintChat(this.llm, model, domain, req.signal, opts, req.context ?? "", req.chatMessages ?? []);
      break;
    }
    case "init":
      yield* runInit(req.args, this.vaultTools, this.llm, model, domains, repoRoot, this.vaultName, req.signal, opts);
      break;
    default: {
      const start = Date.now();
      yield { kind: "error", message: `Unknown operation: ${req.operation as string}` };
      yield { kind: "result", durationMs: Date.now() - start, text: "" };
    }
  }
}
```

- [ ] **Шаг 3: Запустить тесты**

```bash
npm test
```

Ожидается: PASS.

- [ ] **Шаг 4: Коммит**

```bash
git add src/agent-runner.ts
git commit -m "feat: add dev logger — writes JSONL after each operation when dev mode enabled"
```

---

## Task 7: Evaluator фаза + интеграция + рендер

**Files:**
- Create: `src/phases/evaluator.ts`
- Modify: `src/types.ts` — добавить `eval_result` в `RunEvent`
- Modify: `src/agent-runner.ts` — вызвать evaluator, обновить лог
- Modify: `src/view.ts` — рендерить `eval_result`

- [ ] **Шаг 1: Написать падающий тест для `evaluator.ts`**

```ts
// tests/evaluator.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseEvalResponse } from "../src/phases/evaluator";

describe("parseEvalResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseEvalResponse('{"score": 8, "reasoning": "Good result."}');
    expect(result).toEqual({ score: 8, reasoning: "Good result." });
  });

  it("parses JSON embedded in text", () => {
    const result = parseEvalResponse('Here is my assessment:\n{"score": 7, "reasoning": "Ok."}');
    expect(result).toEqual({ score: 7, reasoning: "Ok." });
  });

  it("returns null for invalid JSON", () => {
    expect(parseEvalResponse("not json")).toBeNull();
  });

  it("returns null for missing fields", () => {
    expect(parseEvalResponse('{"score": 8}')).toBeNull();
  });

  it("clamps score to 0-10", () => {
    const result = parseEvalResponse('{"score": 15, "reasoning": "x"}');
    expect(result?.score).toBe(10);
  });
});
```

- [ ] **Шаг 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/evaluator.test.ts
```

Ожидается: FAIL — `parseEvalResponse` не существует.

- [ ] **Шаг 3: Создать `src/phases/evaluator.ts`**

```ts
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import evaluatorTemplate from "../../prompts/evaluator.md";
import { render } from "./template";
import { buildChatParams } from "./llm-utils";

export interface EvalResult {
  score: number;
  reasoning: string;
}

export function parseEvalResponse(text: string): EvalResult | null {
  const match = text.match(/\{[^{}]*"score"[^{}]*"reasoning"[^{}]*\}/s)
    ?? text.match(/\{[^{}]*"reasoning"[^{}]*"score"[^{}]*\}/s);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.score !== "number" || typeof parsed.reasoning !== "string") return null;
    return { score: Math.min(10, Math.max(0, parsed.score)), reasoning: parsed.reasoning };
  } catch {
    return null;
  }
}

export async function* runEvaluator(
  llm: LlmClient,
  model: string,
  operation: string,
  taskInput: string,
  result: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const systemContent = render(evaluatorTemplate, { operation, task_input: taskInput, result });
  const messages = [{ role: "system" as const, content: systemContent }];
  const params = buildChatParams(model, messages, opts);

  try {
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as import("openai").Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    const text = resp.choices[0]?.message?.content ?? "";
    const evalResult = parseEvalResponse(text);
    if (evalResult) {
      yield { kind: "eval_result", score: evalResult.score, reasoning: evalResult.reasoning };
    }
  } catch {
    // evaluator failures are non-fatal
  }
}
```

- [ ] **Шаг 4: Запустить тест evaluator, убедиться что проходит**

```bash
npx vitest run tests/evaluator.test.ts
```

Ожидается: PASS (5 тестов).

- [ ] **Шаг 5: Добавить `eval_result` в `RunEvent` в `src/types.ts`**

В union `RunEvent` добавить:

```ts
| { kind: "eval_result"; score: number; reasoning: string }
```

- [ ] **Шаг 6: Интегрировать evaluator в `src/agent-runner.ts`**

Добавить импорт:
```ts
import { runEvaluator } from "./phases/evaluator";
```

В методе `run()`, после `writeDevLog`, добавить вызов evaluator и обновление лога:

```ts
if (this.settings.devMode?.enabled && finalResultText && this.settings.devMode.evaluatorModel) {
  const taskInput = req.args.join(" ") || req.operation;
  const evalModel = this.settings.devMode.evaluatorModel;
  const evalOpts: LlmCallOptions = {};
  for await (const ev of runEvaluator(this.llm, evalModel, req.operation, taskInput, finalResultText, req.signal, evalOpts)) {
    yield ev;
    if (ev.kind === "eval_result") {
      this.updateDevLogEval(taskInput, ev.score, ev.reasoning);
    }
  }
}
```

Добавить приватный метод `updateDevLogEval` для обновления последней записи в JSONL (читаем файл, заменяем последнюю строку):

```ts
private updateDevLogEval(taskInput: string, score: number, reasoning: string): void {
  const logPath = this.settings.devMode?.logPath;
  if (!logPath) return;
  try {
    const { readFileSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const content = readFileSync(logPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    const lastIdx = lines.length - 1;
    const last = JSON.parse(lines[lastIdx]);
    last.eval = { score, reasoning };
    lines[lastIdx] = JSON.stringify(last);
    writeFileSync(logPath, lines.join("\n") + "\n", "utf-8");
  } catch { /* не блокируем */ }
}
```

Примечание: `require` использован вместо top-level import, так как `node:fs` уже во внешних зависимостях esbuild — это допустимо для runtime CJS.

- [ ] **Шаг 7: Рендерить `eval_result` в `src/view.ts`**

Найти метод `appendEvent(ev: RunEvent)` в `view.ts`. Добавить case для `eval_result`:

```ts
case "eval_result": {
  const el = this.stepsEl.createEl("div", { cls: "llm-wiki-eval-result" });
  el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);
  break;
}
```

Если в view используется switch по `ev.kind`, добавить этот case. Если используется if-else цепочка — добавить блок по аналогии с `"result"`.

- [ ] **Шаг 8: Запустить все тесты**

```bash
npm test
```

Ожидается: PASS.

- [ ] **Шаг 9: Сборка**

```bash
npm run build
```

Ожидается: без ошибок.

- [ ] **Шаг 10: Коммит**

```bash
git add src/phases/evaluator.ts src/types.ts src/agent-runner.ts src/view.ts tests/evaluator.test.ts
git commit -m "feat: add evaluator phase with eval_result event and dev log integration"
```

---

## Self-Review

**Покрытие спецификации:**

| Требование из спецификации | Задача |
|---|---|
| prompts/*.md в корне репозитория | Task 2 |
| esbuild loader уже настроен | Task 2, шаг 8 |
| render() функция | Task 1 |
| Рефактор всех 6 фаз | Task 3 |
| User prompt — дефолт пустой | Task 4, шаг 5 |
| User prompt — append как ## Уточнение | Task 4, шаги 1–4 |
| UI переименование в "User prompt" | Task 4, шаг 6 |
| DevModeSettings в types | Task 5, шаг 1 |
| UI подраздел "Разработка" | Task 5, шаг 3 |
| JSONL dev logger | Task 6 |
| eval_result RunEvent | Task 7, шаг 5 |
| Evaluator фаза | Task 7, шаги 1–4 |
| Интеграция evaluator в AgentRunner | Task 7, шаг 6 |
| Рендер [eval: N/10] в боковой панели | Task 7, шаг 7 |
| Обновление JSONL с оценкой | Task 7, шаг 6 |

**Консистентность типов:** `eval_result` определяется в Task 7 шаге 5 до использования в `view.ts` шаге 7. `DevModeSettings` определяется в Task 5 до использования в Task 6 и 7. ✓

**Плейсхолдеры:** нет TBD. ✓
