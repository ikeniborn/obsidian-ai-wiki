# Vault-relative пути для доменов

**Дата:** 2026-05-05  
**Статус:** Approved

## Проблема

`DomainEntry.wiki_folder` и `source_paths` хранятся относительно `repoRoot` — директории, которая является родителем `vaults/`. Например:

```
wiki_folder:   "vaults/Work/!Wiki/ии"
source_paths:  ["vaults/Work/notes/ai/"]
```

Это создаёт избыточность: поскольку все источники и wiki-папки всегда находятся внутри волта `Work`, префикс `vaults/Work/` — лишний шум. Кроме того, `repoRoot` вычисляется через хрупкую строковую эвристику (`vaultBasePath.endsWith("/vaults/${vaultName}")`), которая потенциально ломается при нестандартном расположении волта.

## Решение: vault-relative пути

Хранить пути относительно `vaultRoot` (= `app.vault.adapter.getBasePath()`):

```
wiki_folder:   "!Wiki/ии"
source_paths:  ["notes/ai/"]
```

`vaultRoot` — готовый якорь из Obsidian API, не требует вычислений. Vault-relative пути совпадают с тем, как Obsidian API (`vault.read()`, `vault.write()`) уже принимает пути, и с тем, что пользователь видит в интерфейсе Obsidian.

## Что не меняется

- `source_paths` всегда ссылаются внутрь волта (подтверждено пользователем; `extractParentSourcePath` уже зажимает до `vaultRoot`).
- Формат `DomainEntry` в `domain-map.ts` — структура остаётся прежней, только семантика полей меняется.
- Миграция существующих данных — выполняется вручную пользователем.

## Затрагиваемые компоненты

### 1. `src/controller.ts`

**`registerDomain()`:**
```typescript
// Было:
const vaultPrefix = `vaults/${vaultName}`;
const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
wiki_folder: `${vaultPrefix}/${wikiRelative}`,

// Стало:
const wikiRelative = input.wikiFolder.trim() || `!Wiki/${id}`;
wiki_folder: wikiRelative,
```

**`dispatch()` и `dispatchChat()`:**
```typescript
// Было:
const vaultSuffix = `/vaults/${vaultName}`;
const repoRoot = vaultBasePath.endsWith(vaultSuffix)
  ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
  : vaultBasePath;

// Стало:
const vaultRoot = vaultBasePath;  // vaultName не нужен
```

`cwd` при запуске агента: `cwd: vaultRoot` (было `cwd: repoRoot`).

`consolidateSourcePaths()` вызов: передаём `vaultRoot` вместо `repoRoot`.

### 2. Все фазы: `ingest.ts`, `query.ts`, `lint.ts`, `fix.ts`

```typescript
// Было:
const absWiki = isAbsolute(domain.wiki_folder) ? domain.wiki_folder : join(repoRoot, domain.wiki_folder);

// Стало:
const absWiki = join(vaultRoot, domain.wiki_folder);
```

Проверка `isAbsolute` уходит — vault-relative пути никогда не абсолютны.

Сигнатуры всех фазовых функций, принимающих `repoRoot: string`, заменяются на `vaultRoot: string`. Включает `detectDomain()` в `ingest.ts` — она принимает `repoRoot` и разрешает source_paths через `join(repoRoot, sp)` → меняется на `join(vaultRoot, sp)`.

В `runIngest`: `const absSource = isAbsolute(filePath) ? filePath : join(vaultRoot, filePath)` (было `join(repoRoot, ...)`). Контроллер передаёт абсолютный путь, поэтому ветка `isAbsolute` срабатывает всегда — проверку `isAbsolute` можно оставить для защиты от будущих вызовов с vault-relative путём.

### 3. `src/source-paths.ts` — `consolidateSourcePaths()`

```typescript
// Было:
export function consolidateSourcePaths(existing: string[], newPath: string, repoRoot: string): string[]

// Стало:
export function consolidateSourcePaths(existing: string[], newPath: string, vaultRoot: string): string[]
```

Внутренняя логика `toAbs()` / `normed()` использует `vaultRoot` как базу.

### 4. `src/agent-runner.ts`

`runOperation()`: параметр `repoRoot: string` → `vaultRoot: string`. Все вызовы фаз: `repoRoot` → `vaultRoot`.

`AgentRunner.vaultName` остаётся — он передаётся в `runInit` для LLM-промпта (не для путей).

### 5. `src/phases/init.ts` — `runInit()`

Параметр `repoRoot: string` убирается (он принимается, но не используется в теле функции).

После парсинга LLM-ответа (`entry = JSON.parse(...)`): нормализовать `entry.wiki_folder` к vault-relative — стрипнуть `vaults/${vaultName}/` если присутствует:

```typescript
const vaultPrefix = `vaults/${vaultName}/`;
if (entry.wiki_folder.startsWith(vaultPrefix)) {
  entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
}
```

Это защищает от старого поведения LLM-промпта, пока промпт не обновлён.

### 6. `src/phases/ingest.ts` — `extractParentSourcePath()`

```typescript
// Было (возвращает repoRoot-relative):
export function extractParentSourcePath(absSource: string, repoRoot: string, vaultRoot: string): string
// Возвращает relative(repoRoot, clamped)

// Стало (возвращает vault-relative):
export function extractParentSourcePath(absSource: string, vaultRoot: string): string
// Возвращает relative(vaultRoot, clamped)
```

Параметр `repoRoot` убирается, логика зажима к `vaultRoot` остаётся.

Возвращаемый путь всегда заканчивается на `/` (trailing slash) — инвариант, унаследованный из текущей реализации (`return (rel || ".") + "/"`). Это не меняется.

### 7. `src/view.ts`

Построение `wikiRoot` для модала добавления домена — убрать stripping `vaultPrefix`:

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

### 8. `src/domain-map.ts` — комментарий в `AddDomainInput`

```typescript
// Было:
wikiFolder: string;  // vault-relative, e.g. "!Wiki/os" (without "vaults/VaultName/")

// Стало:
wikiFolder: string;  // vault-relative, e.g. "!Wiki/os"
```

## Тесты

### Существующие тесты

- `tests/runner.integration.test.ts` — скорректировать вызовы, где передаётся `repoRoot`, заменить на `vaultRoot`.
- Прочие тесты (`stream`, `prompt`, `settings`) — без изменений.

### Новые unit-тесты (добавить в существующий файл или новый `tests/source-paths.test.ts`)

**`extractParentSourcePath`:**
```
vaultRoot = "/vault"
absSource = "/vault/notes/ai/article.md"
→ "notes/ai/"

absSource вне vault → "./" (clamped to vaultRoot; relative("", "") = "", возвращается "." + "/")
```

**`consolidateSourcePaths`:**
```
existing = ["notes/ai/"], newPath = "notes/ai/2024/article/"
→ ["notes/ai/"]  (уже покрыт предком)

existing = ["notes/ai/2024/"], newPath = "notes/ai/"
→ ["notes/ai/"]  (новый путь поглощает потомка)
```

## Инвариант после изменения

- `DomainEntry.wiki_folder` — всегда vault-relative, никогда абсолютный, никогда не начинается с `vaults/`
- `DomainEntry.source_paths` — то же самое
- `repoRoot` как концепция отсутствует в коде (ни переменная, ни параметр)
- Единственная точка получения абсолютного пути: `join(vaultRoot, vaultRelativePath)`
