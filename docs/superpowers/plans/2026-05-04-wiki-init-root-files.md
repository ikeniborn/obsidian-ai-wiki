# Wiki Init Root Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Операция `init` автоматически создаёт `_schema.md` (из встроенного шаблона), `_index.md` и `_log.md` если они не существуют в vault.

**Architecture:** Шаблон `_schema.md` хранится в `templates/_schema.md`, esbuild встраивает его в `main.js` через `loader: { '.md': 'text' }`. Функция `ensureRootFiles()` в `src/phases/init.ts` проверяет наличие трёх корневых файлов через `vaultTools.exists()` и создаёт отсутствующие. Vitest настраивается на трансформацию `.md` файлов аналогично esbuild.

**Tech Stack:** TypeScript, esbuild 0.20, Vitest 1.4, Obsidian VaultAdapter API

---

## Файловая карта

| Файл | Действие | Роль |
|------|----------|------|
| `esbuild.config.mjs` | Изменить | Добавить `loader: { '.md': 'text' }` |
| `vitest.config.ts` | Изменить | Добавить плагин трансформации `.md` → ESM строка |
| `src/md-modules.d.ts` | Создать | TypeScript-декларация для `import x from '*.md'` |
| `templates/_schema.md` | Создать | Шаблон схемы вики, встраивается при сборке |
| `tests/init.test.ts` | Создать | Тесты для `ensureRootFiles` |
| `src/phases/init.ts` | Изменить | Добавить `ensureRootFiles()` и импорт шаблона |
| `package.json` | Изменить | Версия 0.1.36 → 0.1.37 |
| `manifest.json` | Изменить | Версия 0.1.36 → 0.1.37 |

---

## Task 1: Инфраструктура сборки — esbuild + vitest + TypeScript

**Files:**
- Modify: `esbuild.config.mjs`
- Modify: `vitest.config.ts`
- Create: `src/md-modules.d.ts`
- Create: `templates/_schema.md`

- [ ] **Step 1: Добавить loader в esbuild.config.mjs**

Открыть `esbuild.config.mjs`. Текущее содержимое `esbuild.context({...})` не имеет поля `loader`. Добавить его:

```js
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:child_process", "node:readline", "node:path", "node:fs"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  platform: "node",
  loader: { ".md": "text" },
});
```

- [ ] **Step 2: Добавить трансформацию .md в vitest.config.ts**

Vitest не использует esbuild loader, нужен отдельный плагин. Открыть `vitest.config.ts` и добавить `plugins`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "md-text",
      transform(code, id) {
        if (id.endsWith(".md")) {
          return { code: `export default ${JSON.stringify(code)}`, map: null };
        }
      },
    },
  ],
  resolve: {
    alias: {
      obsidian: join(__dirname, "vitest.mock.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Создать src/md-modules.d.ts**

```ts
declare module "*.md" {
  const content: string;
  export default content;
}
```

- [ ] **Step 4: Создать templates/_schema.md**

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

- [ ] **Step 5: Убедиться что сборка проходит**

```bash
npm run build
```

Ожидаемый вывод: `dist/ updated: main.js, manifest.json, styles.css` без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add esbuild.config.mjs vitest.config.ts src/md-modules.d.ts templates/_schema.md
git commit -m "build: add .md text loader for esbuild and vitest, add schema template"
```

---

## Task 2: Тесты для ensureRootFiles (TDD — сначала тест)

**Files:**
- Create: `tests/init.test.ts`

- [ ] **Step 1: Создать tests/init.test.ts с четырьмя тестами**

```ts
import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient, LlmWikiPluginSettings, RunEvent } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";
import { runInit } from "../src/phases/init";
import type { DomainEntry } from "../src/domain-map";

const DOMAIN_JSON = JSON.stringify({
  id: "test",
  name: "Test",
  wiki_folder: "vaults/TestVault/!Wiki/test",
  source_paths: [],
  entity_types: [{ type: "concept", description: "d", extraction_cues: ["x"], min_mentions_for_page: 1, wiki_subfolder: "test/concepts" }],
  language_notes: "",
});

function makeLlm(text: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: text } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeAdapter(existingPaths: string[] = []): VaultAdapter {
  return {
    read: vi.fn().mockImplementation((path: string) => {
      if (existingPaths.includes(path)) return Promise.resolve("existing content");
      return Promise.reject(new Error("not found"));
    }),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockImplementation((path: string) => Promise.resolve(existingPaths.includes(path))),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const signal = new AbortController().signal;
const domains: DomainEntry[] = [];

describe("runInit — ensureRootFiles", () => {
  it("создаёт _schema.md когда файл отсутствует", async () => {
    const adapter = makeAdapter([]);
    const vt = new VaultTools(adapter, "/base");
    await collect(runInit(["test"], vt, makeLlm(DOMAIN_JSON), "", domains, "/base", "TestVault", signal));
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaCall = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    expect(schemaCall).toBeDefined();
    expect(schemaCall![1]).toContain("# Wiki Schema");
  });

  it("создаёт _index.md когда файл отсутствует", async () => {
    const adapter = makeAdapter([]);
    const vt = new VaultTools(adapter, "/base");
    await collect(runInit(["test"], vt, makeLlm(DOMAIN_JSON), "", domains, "/base", "TestVault", signal));
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const indexCall = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(indexCall).toBeDefined();
    expect(indexCall![1]).toContain("# Wiki Index");
  });

  it("создаёт _log.md когда файл отсутствует", async () => {
    const adapter = makeAdapter([]);
    const vt = new VaultTools(adapter, "/base");
    await collect(runInit(["test"], vt, makeLlm(DOMAIN_JSON), "", domains, "/base", "TestVault", signal));
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const logCall = writeCalls.find(([path]) => path.endsWith("_log.md"));
    expect(logCall).toBeDefined();
    expect(logCall![1]).toContain("# Wiki Log");
  });

  it("не перезаписывает существующие корневые файлы", async () => {
    const existing = ["!Wiki/_schema.md", "!Wiki/_index.md", "!Wiki/_log.md"];
    const adapter = makeAdapter(existing);
    const vt = new VaultTools(adapter, "/base");
    await collect(runInit(["test"], vt, makeLlm(DOMAIN_JSON), "", domains, "/base", "TestVault", signal));
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const rootWrites = writeCalls.filter(([path]) =>
      path.endsWith("_schema.md") || path.endsWith("_index.md") || (path.endsWith("_log.md") && !path.includes("init"))
    );
    // _log.md обновляется appendLog в конце init — это нормально
    // но _schema.md и _index.md не должны перезаписываться
    const schemaWrite = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    const indexWrite = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(schemaWrite).toBeUndefined();
    expect(indexWrite).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что они падают**

```bash
npx vitest run tests/init.test.ts
```

Ожидаемый вывод: 4 теста FAIL — `_schema.md` не создаётся, `_index.md` не создаётся и т.д.

---

## Task 3: Реализация ensureRootFiles в init.ts

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Добавить импорт шаблона и функцию ensureRootFiles**

В начало файла `src/phases/init.ts` добавить импорт:

```ts
import schemaTemplate from "../../templates/_schema.md";
```

После функции `tryRead` (строка 145) добавить две новые функции:

```ts
async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_schema.md`;
  const index  = `${wikiRoot}/_index.md`;
  const log    = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (!(await vaultTools.exists(index)))  await vaultTools.write(index, "# Wiki Index\n");
    if (!(await vaultTools.exists(log)))    await vaultTools.write(log, "# Wiki Log\n");
  } catch { /* не блокируем init */ }
}
```

- [ ] **Step 2: Вызвать ensureRootFiles в runInit**

В функции `runInit`, после проверки `existing?.entity_types?.length` (строка 27) и сообщения `yield { kind: "assistant_text", delta: \`Bootstrapping domain...\` }` (строка 32), но до `const allFiles = await vaultTools.listFiles("")` (строка 36) добавить вызов:

```ts
yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...\n` };

await ensureRootFiles(vaultTools, wikiRootGuess);  // ← добавить здесь

const allFiles = await vaultTools.listFiles("");
```

Полный вид начала `runInit` после изменения (строки 17–44):

```ts
export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  repoRoot: string,
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const dryRun = args.includes("--dry-run");

  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);
  if (existing?.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }

  yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...\n` };

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const start = Date.now();

  const allFiles = await vaultTools.listFiles("");
  // ...остальной код без изменений
```

- [ ] **Step 3: Запустить тесты — убедиться что все 4 проходят**

```bash
npx vitest run tests/init.test.ts
```

Ожидаемый вывод:
```
✓ tests/init.test.ts (4)
  ✓ runInit — ensureRootFiles > создаёт _schema.md когда файл отсутствует
  ✓ runInit — ensureRootFiles > создаёт _index.md когда файл отсутствует
  ✓ runInit — ensureRootFiles > создаёт _log.md когда файл отсутствует
  ✓ runInit — ensureRootFiles > не перезаписывает существующие корневые файлы
```

- [ ] **Step 4: Запустить все тесты — убедиться что ничего не сломалось**

```bash
npm test
```

Ожидаемый вывод: все тесты PASS, 0 failed.

- [ ] **Step 5: Коммит**

```bash
git add src/phases/init.ts tests/init.test.ts
git commit -m "feat: init creates root wiki files from bundled schema template"
```

---

## Task 4: Версия и финальная сборка

**Files:**
- Modify: `package.json`
- Modify: `manifest.json`

- [ ] **Step 1: Поднять patch-версию в package.json**

Изменить поле `"version"` с `"0.1.36"` на `"0.1.37"`:

```json
{
  "name": "obsidian-llm-wiki",
  "version": "0.1.37",
  ...
}
```

- [ ] **Step 2: Поднять patch-версию в manifest.json**

Изменить поле `"version"` с `"0.1.36"` на `"0.1.37"`:

```json
{
  "id": "llm-wiki",
  "name": "LLM Wiki",
  "version": "0.1.37",
  ...
}
```

- [ ] **Step 3: Собрать production-сборку**

```bash
npm run build
```

Ожидаемый вывод:
```
dist/ updated: main.js, manifest.json, styles.css
```

- [ ] **Step 4: Убедиться что шаблон встроен в main.js**

```bash
grep -c "Wiki Schema" dist/main.js
```

Ожидаемый вывод: `1` (строка с шаблоном присутствует в бандле).

- [ ] **Step 5: Коммит**

```bash
git add package.json manifest.json dist/main.js dist/manifest.json
git commit -m "chore: bump version to 0.1.37"
```
