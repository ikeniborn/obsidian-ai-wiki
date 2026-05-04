# Дизайн: Самодостаточная инициализация корневых файлов вики

**Дата:** 2026-05-04
**Статус:** Утверждён

## Проблема

Операция `init` не создаёт корневые файлы вики (`_schema.md`, `_index.md`, `_log.md`) при первом запуске. Агент читает их через `tryRead` (возвращает `""` если нет), но не создаёт. Пользователь должен создавать их вручную или они возникают неявно.

Дополнительная проблема: содержимое `_schema.md` нигде не определено как часть агента — оно зависело бы от внешних файлов или ручного ввода. Агент должен быть самодостаточным независимо от выбранного backend (claude-agent, OpenAI-совместимый). Backend — чистый LLM без встроенных функций; весь harness между плагином и LLM — это агент (плагин + скиллы).

## Решение

Шаблон `_schema.md` хранится в `templates/_schema.md` репозитория `obsidian-llm-wiki`. При сборке esbuild встраивает его как строку в `main.js`. Операция `init` создаёт все три корневых файла если они не существуют.

## Изменения

### 1. `esbuild.config.mjs`

Добавить `loader: { '.md': 'text' }` в контекст сборки — esbuild встраивает `.md` файлы как строковые константы.

```js
const ctx = await esbuild.context({
  // ...существующие поля...
  loader: { '.md': 'text' },
});
```

### 2. `src/md-modules.d.ts` (новый файл)

TypeScript-декларация для импортов `.md` файлов:

```ts
declare module '*.md' {
  const content: string;
  export default content;
}
```

### 3. `templates/_schema.md` (новый файл)

Шаблон схемы — встраивается при сборке, используется при первом `init`. Содержит конвенции из `rules/wiki-conventions.md` скилла `llm-wiki`:

```markdown
# Wiki Schema

## Язык и стиль
- Основной язык: русский
- Технические термины не переводить: SQL, API, LLM, ETL, SCD, TTL, DDL, JSON, YAML
- Имена систем — оригинальное написание (RT.DataExporter, CRM B2C, ЦХД)
- Аббревиатуры расшифровывать при первом использовании на странице
- Стиль: нейтральный, информативный, без оценочных суждений
- Запрещено: "Очевидно, что...", "Лучший способ...", местоимения "я", "мы", "наш"

## Именование файлов и папок
- Файлы: kebab-case, кириллица допустима, без пробелов и спецсимволов кроме дефиса
  - Примеры: `версионирование-scd.md`, `clickhouse-обзор.md`
- Папки доменов: нижний регистр, латиница (`ии/`, `базы-данных/`)
- Заголовок H1: русское название; техтермин в скобках при необходимости

## Структура страницы (обязательный порядок)
1. Frontmatter (YAML)
2. Заголовок H1
3. Вводный абзац — 1-3 предложения без заголовка, сразу после H1
4. `## Основные характеристики` — ключевые свойства и параметры
5. `## Связанные концепции` — WikiLinks на другие страницы

## Опциональные разделы
- `## Применение в контексте [Домен]`
- `## Примеры`
- `## Ограничения`
- `## Best Practices`
- `## История изменений`

## Frontmatter

| Поле | Правило |
|------|---------|
| `wiki_sources` | Массив реальных путей от корня репозитория. Только прочитанные файлы. При UPDATE — добавлять, не удалять |
| `wiki_updated` | YYYY-MM-DD |
| `wiki_status` | `stub` (<2 источников, <10 предложений) / `developing` / `mature` (≥4 источника, все разделы) |
| `tags` | Иерархические теги из tag-hierarchy.json |
| `aliases` | Аббревиатуры, английские варианты, синонимы |

## WikiLinks
- Ссылаться только на существующие страницы через `[[имя-страницы]]`
- Запрещено: мёртвые ссылки, ссылки на файлы вне `!Wiki/`, ссылки на источники через WikiLinks

## Контент
- Синтез, не копирование — переработать информацию из источников
- Дословные цитаты только в code-блоках (SQL, конфигурации)
- При добавлении информации из нового источника — указывать дату и источник в `## История изменений`
- Запрещено: placeholder-текст (TODO, "см. источник"), пустые разделы, удаление существующей информации
```

### 4. `src/phases/init.ts`

Добавить `ensureRootFiles()` как первый шаг `runInit`, до загрузки контекста:

```ts
import schemaTemplate from '../../templates/_schema.md';

export async function* runInit(...): AsyncGenerator<RunEvent> {
  // ...валидация domainId...

  await ensureRootFiles(vaultTools, wikiRootGuess); // ← новый первый шаг

  // существующий код: listFiles, readAll, buildPrompt, LLM call...
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_schema.md`;
  const index  = `${wikiRoot}/_index.md`;
  const log    = `${wikiRoot}/_log.md`;

  if (!(await fileExists(vaultTools, schema))) {
    await vaultTools.write(schema, schemaTemplate);
  }
  if (!(await fileExists(vaultTools, index))) {
    await vaultTools.write(index, `# Wiki Index\n`);
  }
  if (!(await fileExists(vaultTools, log))) {
    await vaultTools.write(log, `# Wiki Log\n`);
  }
}

async function fileExists(vaultTools: VaultTools, path: string): Promise<boolean> {
  try { await vaultTools.read(path); return true; } catch { return false; }
}
```

**Идемпотентность:** повторный запуск `init` не перезаписывает существующие файлы.

**Ошибки записи:** если `vaultTools.write` бросает исключение при создании корневых файлов — ошибка поглощается (по аналогии с `appendLog`). Отсутствие корневых файлов не блокирует основную операцию init.

## Что не меняется

- Логика генерации domain entry через LLM — без изменений
- `appendLog` в конце `init` — просто дописывает к уже существующему `_log.md`
- Операции `ingest`, `query`, `lint`, `fix`, `chat` — без изменений
- Правила обновления `_log.md` и `_index.md` — процедурные шаги агента, зашиты в соответствующих phase-файлах

## Обоснование выбора подхода

**esbuild loader vs prebuild-скрипт vs TS-строки:**
- esbuild `loader: { '.md': 'text' }` — минимальный конфиг, шаблон остаётся настоящим `.md` файлом
- Шаблон редактируется с подсветкой синтаксиса, версионируется в git, виден в Obsidian
- Одна строка в конфиге сборки — нет дополнительных скриптов или generated файлов

## Затронутые файлы

| Файл | Действие |
|------|----------|
| `esbuild.config.mjs` | Изменить: добавить `loader` |
| `src/md-modules.d.ts` | Создать |
| `templates/_schema.md` | Создать |
| `src/phases/init.ts` | Изменить: добавить `ensureRootFiles` |
