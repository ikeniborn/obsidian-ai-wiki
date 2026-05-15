---
title: Re-init force — wipe + rebuild domain
date: 2026-05-15
status: draft
---

# Re-init force — wipe + rebuild domain

## Problem

Кнопка re-init (`⟳`) в боковой панели не выполняет переинициализацию:

1. **Bug**: `view.ts:294` читает `entry.sourcePaths`, но в `DomainEntry` поле называется `source_paths` (snake_case). Всегда `undefined` → `controller.init` вызывается без `--sources` → `init.ts:51` возвращает ошибку `"Domain X already initialised. Use Lint to update entity_types."`.
2. **Поведение**: даже после фикса имени поля, `runInitWithSources` (init.ts:198) при существующем `analyzed_sources` работает в режиме resume — пропускает уже обработанные файлы. Для полностью проингестированного домена `toAnalyze=[]` → "no new sources to process". Это не полная переинициализация.
3. **Иконка**: `⟳` (reinit) визуально пересекается с `↻` (refresh) — обе круглые стрелки, отличаются только направлением спина.

## Goal

Re-init выполняет полную переинициализацию домена:
- Удаляет всю папку домена `!Wiki/<wiki_folder>/`.
- Сбрасывает `entity_types=[]`, `analyzed_sources=[]`, `language_notes=""`.
- Заново читает все источники из `entry.source_paths`.
- Переформирует `entity_types` через bootstrap (первый файл) + delta (остальные).
- Регенерирует wiki-сущности через `runIngest` для каждого файла.

Иконка кнопки заменяется на Lucide `recycle`.

## Non-goals

- Изменение API `runIngest` / `runLint`.
- `--force` совместно с `--dry-run`.
- Backup wiped files / undo.
- Редактирование `source_paths` через UI re-init (это делается через AddDomainModal в режиме edit).
- Сохранение пользовательских правок entity_types или md-файлов вики.

## Design

### Контракт фазы `init --force`

**CLI args:**
```
init <domain> [--dry-run] [--force] [--sources <p1> <p2> ...]
```

**Семантика `--force`:**

| Условие | Поведение |
|---|---|
| Domain не существует | error `"force: domain not found"` |
| `--dry-run` + `--force` | error `"force: dry-run not supported"` |
| `--force` без `--sources`, `entry.source_paths` непуст | использует `entry.source_paths` |
| `--force` без `--sources`, `entry.source_paths` пуст | error `"force: no sources to re-analyze"` |
| `--force` с `--sources` | использует переданные пути |

**Flow:**
1. Валидация (см. таблицу выше).
2. yield `assistant_text` "Re-init: wiping <wiki_folder>...".
3. `wiped = await wipeDomainFolder(vaultTools, entry.wiki_folder)`.
4. yield `tool_use "WipeDomain"` → `tool_result` → `assistant_text` "removed N files".
5. yield `domain_updated` patch: `{ entity_types: [], analyzed_sources: [], language_notes: "" }`.
6. `effectiveSources = sourcePathsArg ?? existing.source_paths`.
7. Вызов `runInitWithSources(domainId, effectiveSources, dryRun=false, ..., force=true)`.
8. Внутри `runInitWithSources` при `force=true`: `isResuming=false` принудительно, `currentDomain.entity_types=[]`, `analyzed_sources=[]`. Первый файл → bootstrap, остальные → delta. Гард `existing?.entity_types?.length` на init.ts:50 пропускается при `force=true`.

### Wipe-функция

```ts
async function wipeDomainFolder(vaultTools: VaultTools, wikiFolder: string): Promise<string[]> {
  const root = domainWikiFolder(wikiFolder);
  const files = await vaultTools.listFiles(root);
  for (const f of files) {
    try { await vaultTools.remove(f); } catch { /* skip locked */ }
  }
  return files;
}
```

Удаляет только файлы внутри `!Wiki/<wiki_folder>/`. Папка остаётся (Obsidian авто-чистит пустую). Корневые `!Wiki/_wiki_schema.md`, `!Wiki/_log.md` не затрагиваются — они вне `wiki_folder`.

### Controller

`src/controller.ts:init`:
```ts
async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean): Promise<void> {
  const args = [domain];
  if (dryRun) args.push("--dry-run");
  if (force) args.push("--force");
  if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
  const onFileError: OnFileError | undefined = sourcePaths?.length
    ? (file, err, canRetry) => {
        const modal = new FileErrorModal(this.app, file, err, canRetry);
        modal.open();
        return modal.result;
      }
    : undefined;
  await this.dispatch("init", args, undefined, undefined, undefined, onFileError);
}
```

### View

`src/view.ts:runReinit`:
```ts
const sourcePaths = entry.source_paths ?? [];   // FIX: snake_case
const hasSources = sourcePaths.length > 0;

if (!hasSources) {
  new Notice(T.view.reinitNoSources);
  return;
}

const mdFiles = this.app.vault.getFiles().filter(
  (f) => f.extension === "md" && sourcePaths.some((p) => f.path.startsWith(p)),
);
const body = T.modal.reinitConfirmBody(entry.id, mdFiles.length, sourcePaths.length);

new ConfirmModal(
  this.app, T.modal.reinitConfirmTitle, [body],
  () => void this.plugin.controller.init(entry.id, false, sourcePaths, true),
).open();
```

Удаляется ветка `reinitConfirmBodyNoSources` — re-init без источников теперь невозможен (Notice + return).

**Иконка:**
```ts
import { setIcon } from "obsidian";
this.reinitBtn = domainRow.createEl("button", { attr: { title: T.view.reinitTitle } });
setIcon(this.reinitBtn, "recycle");
```
Убирается `text: "⟳"`.

### i18n

| Ключ | RU | EN |
|---|---|---|
| `view.reinitTitle` | "Переинициализация домена (wipe + заново)" | "Re-init domain (wipe + rebuild)" |
| `view.reinitNoSources` | "У домена нет source_paths — re-init невозможен" | "Domain has no source_paths — re-init not possible" |
| `modal.reinitConfirmTitle` | "Re-init — подтвердите" | "Re-init — confirm" |
| `modal.reinitConfirmBody(id, fileCount, srcCount)` | `Домен «${id}»: будет удалена вся вики-папка домена и пересобрана из ${fileCount} md-файлов (${srcCount} sourcePaths). Продолжить?` | `Domain «${id}»: entire wiki folder will be deleted and rebuilt from ${fileCount} md-files (${srcCount} source paths). Continue?` |

Ключ `reinitConfirmBodyNoSources` удаляется.

## Edge cases

| Случай | Поведение |
|---|---|
| `force=true` + domain не найден | error в `runInit`, в UI Notice от dispatch |
| `force=true` + `source_paths=[]` + нет `--sources` arg | view.ts: Notice "no source_paths", модал не открывается. Если как-то достигли фазы — error из фазы |
| `force=true` + `--dry-run` | error из фазы (защита на случай прямого вызова) |
| Wipe: файл залочен Obsidian | `try/catch`, skip, продолжаем |
| Wipe: папка не существует | `listFiles` вернёт `[]`, цикл no-op |
| Abort во время wipe | проверка `signal.aborted` после wipe перед LLM-вызовами |
| Конкурентный init на тот же домен | блокируется single-flight в `controller.dispatch` |
| `runInitWithSources` падает после wipe | состояние: папка пуста, `entity_types=[]`. Пользователь видит error, может перезапустить re-init |
| Mobile (`domainRow` не создаётся) | кнопка не существует |

## Testing

**Unit (`tests/phases/init.force.test.ts`):**
1. `--force` без existing domain → error `"force: domain not found"`.
2. `--force` + `--dry-run` → error `"force: dry-run not supported"`.
3. `--force` с existing, `--sources p1 p2` → wipe вызван → bootstrap + delta → `domain_updated` с `analyzed_sources=allFiles`, `entity_types` непуст.
4. `--force` без `--sources`, `entry.source_paths=["docs"]` → использует `["docs"]`.
5. `--force` без `--sources`, `entry.source_paths=[]` → error `"force: no sources to re-analyze"`.
6. Wipe: `vaultTools.remove` вызван для каждого файла внутри `domainWikiFolder(wiki_folder)`, НЕ вызван для `!Wiki/_wiki_schema.md`.
7. `force=true` сбрасывает `entity_types`, `analyzed_sources`, `language_notes` в первом `domain_updated` событии.

VaultTools mock — паттерн существующих phase-тестов (`tests/phases/init.test.ts` если есть, иначе по образцу `tests/phases/ingest.test.ts`).

**Manual verification:**
1. Существующий домен с непустыми `source_paths` и заполненной wiki-папкой → клик recycle-btn → ConfirmModal → подтверждение → wiki-папка очищена → re-ingest всех файлов → новые entity_types, новые md-сущности.
2. Домен без `source_paths` → клик recycle-btn → Notice "no source_paths", модал не открывается.
3. Иконка `recycle` визуально отличается от `↻` (refresh).
4. Abort во время re-init → процесс прерывается, состояние согласовано (либо до wipe, либо после).

## Files

- `src/phases/init.ts` — парсинг `--force`, гард dry-run+force, `wipeDomainFolder`, force-ветка в `runInit`, параметр `force` в `runInitWithSources`, override `isResuming/analyzed_sources/entity_types` при force, пропуск гарда `already initialised`.
- `src/controller.ts` — параметр `force` в `init()`.
- `src/view.ts` — fix `entry.source_paths`, передача `force=true`, проверка пустых source_paths с Notice, `setIcon("recycle")`, удаление `text: "⟳"`, удаление ветки `reinitConfirmBodyNoSources`.
- `src/i18n.ts` — обновление ключей (`reinitTitle`, `reinitConfirmBody`), новый `reinitNoSources`, удаление `reinitConfirmBodyNoSources`.
- `tests/phases/init.force.test.ts` — новый файл с unit-тестами.

## Non-goals (повтор)

- Backup / undo wiped files.
- Сохранение пользовательских правок.
- Изменение API `runIngest` / `runLint`.
- `--dry-run` совместно с `--force`.
- Декомпозиция `runInitWithSources` (force-ветка переиспользует существующий код).
