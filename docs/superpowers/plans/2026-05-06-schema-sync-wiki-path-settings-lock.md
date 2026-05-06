# Schema Sync + Wiki Path Hardening + Settings Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Синхронизировать конвенции `_schema.md` и промптов; перевести `DomainEntry.wiki_folder` на хранение только подпапки домена с обязательным `!Wiki/`-корнем; заблокировать редактирование доменов в Settings Panel во время активной операции.

**Architecture:** Три независимых куска работы выполняются последовательно. Центральный хелпер `domainWikiFolder()` добавляет константу `!Wiki/` к подпапке домена — все фазы используют его вместо прямого `domain.wiki_folder`. Миграция срабатывает один раз при загрузке плагина, стирая `!Wiki/`-префикс из сохранённых данных. Settings lock опирается на `controller.running` геттер и callback `onBusyChange`, который перерисовывает Settings Panel.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest

---

## Файловая карта

| Файл | Действие | Задача |
|------|----------|--------|
| `templates/_schema.md` | modify | 1 |
| `prompts/ingest.md` | modify | 2 |
| `prompts/optimized/ingest.md` | modify | 2 |
| `src/wiki-path.ts` | create | 3 |
| `tests/wiki-path.test.ts` | create | 3 |
| `src/phases/ingest.ts` | modify | 4 |
| `src/phases/query.ts` | modify | 4 |
| `src/phases/lint.ts` | modify | 4 |
| `src/phases/fix.ts` | modify | 4 |
| `src/phases/init.ts` | modify | 4 |
| `tests/phases/ingest.test.ts` | modify | 4 |
| `tests/phases/query.test.ts` | modify | 4 |
| `tests/phases/lint.test.ts` | modify | 4 |
| `tests/modals.test.ts` | modify | 4 |
| `tests/migration.test.ts` | create | 5 |
| `src/main.ts` | modify | 5, 9 |
| `src/view.ts` | modify | 6 |
| `src/domain-map.ts` | modify | 7 |
| `src/modals.ts` | modify | 7 |
| `src/i18n.ts` | modify | 7, 9 |
| `src/controller.ts` | modify | 8 |
| `src/settings.ts` | modify | 9 |

---

## Task 1: Schema sync — `templates/_schema.md`

**Files:**
- Modify: `templates/_schema.md`

- [ ] **Step 1: Применить 6 правок к файлу**

Открой `templates/_schema.md`. Внеси следующие изменения:

**Правка 1** — в таблице Frontmatter строку с `OutgoingLinks` заменить:
```markdown
| `wiki_outgoing_links` | Массив WikiLinks на связанные страницы. Тип свойства в Obsidian: **Links** (не list/text) — только тогда ссылки участвуют в Graph View. Значения обязательно в формате `[[page-name]]`: `["[[page-a]]", "[[page-b]]"]`. Пустой массив допустим. |
```

**Правка 2** — после строки `wiki_outgoing_links` добавить:
```markdown
| `wiki_external_links` | Массив внешних URL (`http://` или `https://`). Не формируют граф Obsidian — только справочные ресурсы и документация. |
```

**Правка 3** — добавить в таблицу Frontmatter:
```markdown
| `wiki_type` | Тип файла: `page \| index \| log \| schema`. Только для служебных файлов (`_index.md`, `_log.md`, `_schema.md`). Обычные страницы не указывают это поле. |
```

**Правка 4** — в строке `wiki_status` расширить описание `developing`:
```markdown
| `wiki_status` | `stub` (<2 источников, <10 предложений) / `developing` (≥2 источника, ≥10 предложений, основные разделы заполнены) / `mature` (≥4 источника, все разделы) |
```

**Правка 5** — в раздел "Опциональные разделы" добавить пункт:
```markdown
- `## Связанные концепции` — только если нужен пояснительный контекст к связям; без описательного контекста раздел не создавать
```

**Правка 6** — в раздел "Контент" добавить:
```markdown
- Таблицы: markdown с выравниванием (`| Параметр | Значение |` + `|----------|----------|`)
- Кодовые блоки: всегда указывать язык (` ```sql `, ` ```yaml `, ` ```json `)
```

- [ ] **Step 2: Проверить результат**

```bash
grep -n "wiki_outgoing_links\|wiki_external_links\|wiki_type\|developing\|Связанные концепции\|Кодовые блоки" templates/_schema.md
```

Ожидаемый вывод: все 6 новых терминов присутствуют.

- [ ] **Step 3: Commit**

```bash
git add templates/_schema.md
git commit -m "docs(schema): sync conventions from llm-wiki skill — 6 fixes"
```

---

## Task 2: Schema sync — промпты

**Files:**
- Modify: `prompts/ingest.md`
- Modify: `prompts/optimized/ingest.md`

- [ ] **Step 1: Исправить `prompts/ingest.md`**

В конце файла в JSON-примере найти `"OutgoingLinks: []\n"` и заменить на `"wiki_outgoing_links: []\n"`.

В блок ПРАВИЛА добавить три строки перед строкой `{{schema_block}}`:

```
- Раздел "## Основные характеристики" обязателен для каждой страницы
- При добавлении из нового источника — фиксировать в "## История изменений" с датой и источником
- "## Связанные концепции" — создавать только при наличии пояснительного контекста к связям
```

Итоговый файл должен выглядеть так:

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
- Раздел "## Основные характеристики" обязателен для каждой страницы
- При добавлении из нового источника — фиксировать в "## История изменений" с датой и источником
- "## Связанные концепции" — создавать только при наличии пояснительного контекста к связям
{{schema_block}}

Верни ТОЛЬКО JSON-массив, без другого текста:
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [{{source_path}}]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент..."}]
```

- [ ] **Step 2: Исправить `prompts/optimized/ingest.md`**

Аналогично: в JSON-примере нет поля `wiki_outgoing_links` — добавить. Добавить три правила. Итог:

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
- Раздел "## Основные характеристики" обязателен для каждой страницы
- При добавлении из нового источника — фиксировать в "## История изменений" с датой и источником
- "## Связанные концепции" — создавать только при наличии пояснительного контекста к связям
{{schema_block}}

Верни ТОЛЬКО JSON-массив, без другого текста:
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [{{source_path}}]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент..."}]
```

- [ ] **Step 3: Commit**

```bash
git add prompts/ingest.md prompts/optimized/ingest.md
git commit -m "docs(prompts): sync ingest prompt — wiki_outgoing_links, 3 structural rules"
```

---

## Task 3: `src/wiki-path.ts` — константа и хелпер

**Files:**
- Create: `src/wiki-path.ts`
- Create: `tests/wiki-path.test.ts`

- [ ] **Step 1: Написать тест (он должен упасть)**

Создай файл `tests/wiki-path.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { WIKI_ROOT, domainWikiFolder } from "../src/wiki-path";

describe("WIKI_ROOT", () => {
  it("equals !Wiki", () => {
    expect(WIKI_ROOT).toBe("!Wiki");
  });
});

describe("domainWikiFolder", () => {
  it("prepends !Wiki/ to subfolder", () => {
    expect(domainWikiFolder("os")).toBe("!Wiki/os");
  });

  it("handles cyrillic subfolder", () => {
    expect(domainWikiFolder("базы-данных")).toBe("!Wiki/базы-данных");
  });

  it("handles nested subfolder", () => {
    expect(domainWikiFolder("work/archive")).toBe("!Wiki/work/archive");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/wiki-path.test.ts
```

Ожидаемый вывод: `Cannot find module '../src/wiki-path'`

- [ ] **Step 3: Создать `src/wiki-path.ts`**

```typescript
export const WIKI_ROOT = "!Wiki";

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
npx vitest run tests/wiki-path.test.ts
```

Ожидаемый вывод: `3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/wiki-path.ts tests/wiki-path.test.ts
git commit -m "feat(wiki-path): add WIKI_ROOT constant and domainWikiFolder() helper"
```

---

## Task 4: Фазы — использовать `domainWikiFolder()`, обновить тесты

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/fix.ts`
- Modify: `src/phases/init.ts`
- Modify: `tests/phases/ingest.test.ts`
- Modify: `tests/phases/query.test.ts`
- Modify: `tests/phases/lint.test.ts`
- Modify: `tests/modals.test.ts`

- [ ] **Step 1: Обновить тестовые фикстуры — `wiki_folder` без префикса**

В `tests/phases/ingest.test.ts` найти:
```typescript
wiki_folder: "!Wiki/work",
```
Заменить на:
```typescript
wiki_folder: "work",
```

В `tests/phases/query.test.ts`, `tests/phases/lint.test.ts` — аналогично найти и заменить все `wiki_folder: "!Wiki/..."` → `wiki_folder: "..."` (убрать `!Wiki/` префикс).

В `tests/modals.test.ts` найти:
```typescript
wiki_folder: "!Wiki/test",
```
Заменить на:
```typescript
wiki_folder: "test",
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/phases/ingest.test.ts tests/phases/query.test.ts tests/phases/lint.test.ts tests/modals.test.ts
```

Ожидаемый вывод: тесты падают из-за неверного пути (фикстура отдаёт `"work"`, код ожидает `"!Wiki/work"`).

- [ ] **Step 3: Обновить `src/phases/ingest.ts`**

Добавить импорт в начало файла после существующих импортов:
```typescript
import { domainWikiFolder } from "../wiki-path";
```

Найти строку:
```typescript
const absWiki = join(vaultRoot, domain.wiki_folder);
```
Заменить на:
```typescript
const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
```

Найти строку в error message:
```typescript
yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
```
Заменить на:
```typescript
yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
```

- [ ] **Step 4: Обновить `src/phases/query.ts`**

Добавить импорт:
```typescript
import { domainWikiFolder } from "../wiki-path";
```

Найти:
```typescript
const absWiki = join(vaultRoot, domain.wiki_folder);
```
Заменить на:
```typescript
const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
```

Найти строку error message с `domain.wiki_folder` — заменить на `domainWikiFolder(domain.wiki_folder)`.

- [ ] **Step 5: Обновить `src/phases/lint.ts`**

Добавить импорт:
```typescript
import { domainWikiFolder } from "../wiki-path";
```

Найти:
```typescript
const absWiki = join(vaultRoot, domain.wiki_folder);
```
Заменить на:
```typescript
const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
```

- [ ] **Step 6: Обновить `src/phases/fix.ts`**

Добавить импорт:
```typescript
import { domainWikiFolder } from "../wiki-path";
```

Найти все вхождения `domain.wiki_folder` в контексте join/path — заменить на `domainWikiFolder(domain.wiki_folder)`.

- [ ] **Step 7: Обновить `src/phases/init.ts` — нормализация LLM-вывода**

В `init.ts` есть два места, где парсится ответ LLM. В обоих добавить стрип `!Wiki/` сразу после стрипа `vaults/<vaultName>/`:

Первое место (около строки 113):
```typescript
const vaultPrefix = `vaults/${vaultName}/`;
if (entry.wiki_folder?.startsWith(vaultPrefix)) {
  entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
}
// Normalize: strip !Wiki/ prefix if LLM output full path
if (entry.wiki_folder?.startsWith("!Wiki/")) {
  entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
}
if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
```

Второе место (около строки 241) — аналогично:
```typescript
const vaultPrefix = `vaults/${vaultName}/`;
if (entry.wiki_folder?.startsWith(vaultPrefix)) {
  entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
}
if (entry.wiki_folder?.startsWith("!Wiki/")) {
  entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
}
if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
```

- [ ] **Step 8: Запустить тесты — убедиться что проходят**

```bash
npx vitest run tests/phases/ingest.test.ts tests/phases/query.test.ts tests/phases/lint.test.ts tests/modals.test.ts
```

Ожидаемый вывод: все тесты проходят.

- [ ] **Step 9: Запустить все тесты**

```bash
npm test
```

Ожидаемый вывод: все тесты проходят.

- [ ] **Step 10: Commit**

```bash
git add src/phases/ingest.ts src/phases/query.ts src/phases/lint.ts src/phases/fix.ts src/phases/init.ts tests/phases/ingest.test.ts tests/phases/query.test.ts tests/phases/lint.test.ts tests/modals.test.ts
git commit -m "refactor(phases): use domainWikiFolder() helper, strip !Wiki/ from LLM-parsed entries"
```

---

## Task 5: Миграция `wiki_folder` в `loadSettings()`

**Files:**
- Create: `tests/migration.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Написать тест миграции (должен упасть)**

Создай `tests/migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { migrateDomainWikiFolder } from "../src/main";
import type { DomainEntry } from "../src/domain-map";

function makeDomain(wiki_folder: string): DomainEntry {
  return { id: "d", name: "D", wiki_folder };
}

describe("migrateDomainWikiFolder", () => {
  it("strips !Wiki/ prefix", () => {
    const domains = [makeDomain("!Wiki/os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(true);
    expect(domains[0].wiki_folder).toBe("os");
  });

  it("strips !Wiki/ from multiple domains", () => {
    const domains = [makeDomain("!Wiki/os"), makeDomain("!Wiki/базы-данных")];
    migrateDomainWikiFolder(domains);
    expect(domains[0].wiki_folder).toBe("os");
    expect(domains[1].wiki_folder).toBe("базы-данных");
  });

  it("does not change domains without !Wiki/ prefix", () => {
    const domains = [makeDomain("os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(false);
    expect(domains[0].wiki_folder).toBe("os");
  });

  it("does not touch non-standard paths", () => {
    const domains = [makeDomain("CustomWiki/os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(false);
    expect(domains[0].wiki_folder).toBe("CustomWiki/os");
  });

  it("returns false for empty array", () => {
    expect(migrateDomainWikiFolder([])).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/migration.test.ts
```

Ожидаемый вывод: `migrateDomainWikiFolder is not exported from '../src/main'`

- [ ] **Step 3: Добавить функцию и вызов в `src/main.ts`**

В конец файла `src/main.ts` (перед закрывающей скобкой класса или после него) добавить экспортируемую функцию:

```typescript
export function migrateDomainWikiFolder(domains: DomainEntry[]): boolean {
  let changed = false;
  for (const d of domains) {
    if (d.wiki_folder?.startsWith("!Wiki/")) {
      d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      changed = true;
    }
  }
  return changed;
}
```

В конец метода `loadSettings()`, сразу перед закрывающей фигурной скобкой метода, добавить:

```typescript
    // Migrate wiki_folder: strip !Wiki/ prefix (stored as subfolder only since v0.x)
    if (migrateDomainWikiFolder(this.settings.domains)) {
      void this.saveSettings();
    }
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
npx vitest run tests/migration.test.ts
```

Ожидаемый вывод: `5 tests passed`

- [ ] **Step 5: Запустить все тесты**

```bash
npm test
```

Ожидаемый вывод: все проходят.

- [ ] **Step 6: Commit**

```bash
git add tests/migration.test.ts src/main.ts
git commit -m "feat(main): migrate wiki_folder to subfolder-only format on load"
```

---

## Task 6: `src/view.ts` — hardcode wikiRoot

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Заменить динамическое вычисление `wikiRoot` на константу**

Открой `src/view.ts`. Добавить импорт в начало файла:

```typescript
import { WIKI_ROOT } from "./wiki-path";
```

Найти метод `openAddDomain()` — блок:
```typescript
const wikiRoot = (() => {
  const sample = domains[0]?.wiki_folder ?? `!Wiki/x`;
  const raw = sample.replace(/\/[^/]+$/, "") || "!Wiki";
  return raw.replace(/^vaults\/[^/]+\//, "");
})();
new AddDomainModal(this.app, wikiRoot, (input) => {
```

Заменить на:
```typescript
new AddDomainModal(this.app, WIKI_ROOT, (input) => {
```

- [ ] **Step 2: Запустить все тесты**

```bash
npm test
```

Ожидаемый вывод: все проходят.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "refactor(view): hardcode wikiRoot to WIKI_ROOT constant"
```

---

## Task 7: UI модалок и i18n — subfolder-only

**Files:**
- Modify: `src/domain-map.ts`
- Modify: `src/modals.ts`
- Modify: `src/i18n.ts`
- Modify: `src/controller.ts`

- [ ] **Step 1: Обновить JSDoc в `src/domain-map.ts`**

Найти:
```typescript
wiki_folder: string;  // vault-relative, e.g. "!Wiki/os"
```
Заменить на:
```typescript
wiki_folder: string;  // domain subfolder within !Wiki/, e.g. "os" (without "!Wiki/" prefix)
```

Найти в `AddDomainInput`:
```typescript
wikiFolder: string;  // vault-relative, e.g. "!Wiki/os"
```
Заменить на:
```typescript
wikiFolder: string;  // domain subfolder within !Wiki/, e.g. "os"
```

- [ ] **Step 2: Обновить i18n — заменить `wikiFolder_desc` и `wikiFolder_placeholder`**

В `src/i18n.ts` найти в секции `modal` трёх языков (en, ru, es) поля:
- `wikiFolder_name`
- `wikiFolder_desc`
- `wikiFolder_placeholder`

Заменить во всех трёх локалях:

**en:**
```typescript
wikiFolder_name: "Wiki subfolder",
wikiFolder_desc: (_root: string) => "Subfolder within !Wiki/. Auto-filled from domain ID.",
wikiFolder_placeholder: (_root: string) => "e.g.: os",
```

**ru:**
```typescript
wikiFolder_name: "Wiki-подпапка",
wikiFolder_desc: (_root: string) => "Подпапка внутри !Wiki/. Заполняется автоматически из ID домена.",
wikiFolder_placeholder: (_root: string) => "например: os",
```

**es:**
```typescript
wikiFolder_name: "Subcarpeta wiki",
wikiFolder_desc: (_root: string) => "Subcarpeta dentro de !Wiki/. Se rellena automáticamente desde el ID.",
wikiFolder_placeholder: (_root: string) => "ej.: os",
```

- [ ] **Step 3: Обновить `AddDomainModal` в `src/modals.ts`**

Найти автозаполнение wiki-папки в `onChange` поля ID:
```typescript
if (this.wikiFolderInput && !this.input.wikiFolder) {
  this.wikiFolderInput.setValue(`${this.wikiRoot}/${this.input.id}`);
}
```
Заменить на:
```typescript
if (this.wikiFolderInput && !this.input.wikiFolder) {
  this.wikiFolderInput.setValue(this.input.id);
}
```

Найти placeholder поля wiki-папки:
```typescript
t.setPlaceholder(T.wikiFolder_placeholder(this.wikiRoot)).onChange((v) => {
```
Убедиться что он остаётся как есть (теперь `_root` игнорируется, возвращает `"e.g.: os"`).

Поле описания и placeholder оставить как есть — `T.wikiFolder_desc(this.wikiRoot)` теперь возвращает текст с упоминанием `!Wiki/` и больше ничего менять не нужно.

- [ ] **Step 4: Обновить `EditDomainModal` — показывать только подпапку**

В конструкторе `EditDomainModal` уже есть:
```typescript
this.wikiFolderVal = domain.wiki_folder;
```
После миграции `domain.wiki_folder` = `"os"`. Изменений в конструкторе не нужно.

В `onOpen()` найти поле wiki-папки:
```typescript
new Setting(contentEl)
  .setName(T.wikiFolder_name)
  .addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => { this.wikiFolderVal = v; }));
```
Добавить описание с префиксом:
```typescript
new Setting(contentEl)
  .setName(T.wikiFolder_name)
  .setDesc("!Wiki/[подпапка]")
  .addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => { this.wikiFolderVal = v; }));
```

- [ ] **Step 5: Обновить `registerDomain` в `src/controller.ts`**

Найти:
```typescript
const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
s.domains.push({
  ...
  wiki_folder: wikiRelative,
```
Заменить на:
```typescript
const wikiSubfolder = input.wikiFolder.trim() || id;
s.domains.push({
  ...
  wiki_folder: wikiSubfolder,
```

- [ ] **Step 6: Запустить все тесты**

```bash
npm test
```

Ожидаемый вывод: все проходят.

- [ ] **Step 7: Commit**

```bash
git add src/domain-map.ts src/modals.ts src/i18n.ts src/controller.ts
git commit -m "refactor(ui): wiki_folder stores subfolder only — update modals, i18n, registerDomain"
```

---

## Task 8: Controller — `running` геттер + `onBusyChange`

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Добавить `onBusyChange` поле и `running` геттер**

В `src/controller.ts` добавить после объявления приватных полей (после строки `private _chatSessionId`):

```typescript
onBusyChange?: () => void;

get running(): boolean { return this.current !== null; }
```

- [ ] **Step 2: Вызывать `onBusyChange` при смене `this.current`**

В методе `dispatchChat` найти два места:

Место 1 — установка (около строки 72):
```typescript
this.current = ctrl;
```
Заменить на:
```typescript
this.current = ctrl;
this.onBusyChange?.();
```

Место 2 — сброс (около строки 120, в блоке `finally`):
```typescript
this.current = null;
```
Заменить на:
```typescript
this.current = null;
this.onBusyChange?.();
```

В методе `dispatch` (второй метод с `this.current = ctrl`) — аналогично найти строки установки и сброса `this.current` (около строк 262 и 317 в текущем файле) и добавить `this.onBusyChange?.()` после каждой из двух строк.

- [ ] **Step 3: Убедиться что TypeScript компилируется**

```bash
npm run build
```

Ожидаемый вывод: сборка без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): add running getter and onBusyChange callback"
```

---

## Task 9: Settings Panel — busy banner + disable buttons

**Files:**
- Modify: `src/i18n.ts`
- Modify: `src/main.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Добавить `busyBanner` в i18n**

В `src/i18n.ts` в секцию `settings` каждой локали добавить поле `busyBanner`:

**en** (после `domainDeleted`):
```typescript
busyBanner: "Operation in progress — domain editing is disabled.",
```

**ru:**
```typescript
busyBanner: "Операция выполняется — редактирование доменов недоступно.",
```

**es:**
```typescript
busyBanner: "Operación en curso — la edición de dominios está desactivada.",
```

- [ ] **Step 2: Сохранить `settingTab` как поле в `LlmWikiPlugin` и зарегистрировать callback**

В `src/main.ts` добавить поле после `controller!: WikiController`:
```typescript
settingTab?: LlmWikiSettingTab;
```

Найти строку:
```typescript
this.addSettingTab(new LlmWikiSettingTab(this.app, this));
```
Заменить на:
```typescript
this.settingTab = new LlmWikiSettingTab(this.app, this);
this.addSettingTab(this.settingTab);
```

Найти строку:
```typescript
this.controller = new WikiController(this.app, this);
```
После неё добавить:
```typescript
this.controller.onBusyChange = () => this.settingTab?.display();
```

- [ ] **Step 3: Добавить баннер и disable кнопок в `src/settings.ts`**

В начало метода `display()` после `containerEl.empty()` и получения `s` и `T` добавить баннер:

```typescript
const busy = this.plugin.controller.running;
if (busy) {
  containerEl.createEl("div", {
    text: T.settings.busyBanner,
    cls: "setting-item-description llm-wiki-settings-busy-banner",
  });
}
```

В блоке итерации доменов найти кнопку Edit:
```typescript
.addButton((b) =>
  b.setButtonText(T.settings.editDomain).onClick(() => {
```
Заменить на:
```typescript
.addButton((b) => {
  b.setButtonText(T.settings.editDomain).setDisabled(busy).onClick(() => {
```
(закрывающую скобку `.addButton(...)` привести в соответствие)

Аналогично кнопку Delete:
```typescript
.addButton((b) =>
  b.setButtonText(T.settings.deleteDomain).setWarning().onClick(() => {
```
Заменить на:
```typescript
.addButton((b) => {
  b.setButtonText(T.settings.deleteDomain).setWarning().setDisabled(busy).onClick(() => {
```

- [ ] **Step 4: Убедиться что TypeScript компилируется**

```bash
npm run build
```

Ожидаемый вывод: сборка без ошибок, `main.js` обновлён.

- [ ] **Step 5: Запустить все тесты**

```bash
npm test
```

Ожидаемый вывод: все проходят.

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts src/main.ts src/settings.ts
git commit -m "feat(settings): disable domain editing during active operation"
```

---

## Финальная проверка

- [ ] Запустить полный прогон тестов: `npm test` — все зелёные
- [ ] Сборка: `npm run build` — без ошибок TypeScript
- [ ] Убедиться что `git log --oneline -9` показывает 9 коммитов задач
