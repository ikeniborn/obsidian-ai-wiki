---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-15-reinit-force-design.md
  - docs/TODO.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [spec, init, force, wipe, view, i18n, ui]
---

# Re-init Force Design

Спецификация флага `--force` для [[init-operation]]: кнопка re-init в боковой панели [[llm-wiki-view]] выполняет полную переинициализацию домена — удаление wiki-папки, сброс `entity_types`/`analyzed_sources`/`language_notes`, повторный bootstrap+delta+ingest для всех источников. Эволюция [[reinit-button-design]]: вместо resume-режима — wipe + rebuild.

## Проблема

Текущая кнопка re-init (`⟳`, `view.ts:294`):

1. **Bug snake_case**: читает `entry.sourcePaths`, но в `DomainEntry` поле называется `source_paths` → всегда `undefined` → `controller.init` вызывается без `--sources` → фаза возвращает ошибку `"Domain X already initialised. Use Lint to update entity_types."`.
2. **Resume вместо rebuild**: даже после фикса имени `runInitWithSources` (init.ts:198) при существующем `analyzed_sources` работает в режиме resume — пропускает уже обработанные файлы. Для проингестированного домена `toAnalyze=[]` → `"no new sources to process"`. Это не полная переинициализация.
3. **Иконка**: `⟳` (reinit) визуально пересекается с `↻` (refresh) — обе круглые стрелки.

## Цель

Re-init выполняет полную переинициализацию домена:

- Удаляет всю папку домена `!Wiki/<wiki_folder>/`.
- Сбрасывает `entity_types=[]`, `analyzed_sources=[]`, `language_notes=""`.
- Заново читает все источники из `entry.source_paths`.
- Переформирует `entity_types` через bootstrap (первый файл) + delta-обновление (остальные).
- Регенерирует wiki-сущности через `runIngest` для каждого файла.

Иконка кнопки заменяется на Lucide `recycle`.

## Non-goals

- Изменение API `runIngest` / `runLint`.
- Совмещение `--force` с `--dry-run`.
- Backup wiped files / undo.
- Редактирование `source_paths` через UI re-init (делается через AddDomainModal в режиме edit).
- Сохранение пользовательских правок entity_types или md-файлов вики.
- Декомпозиция `runInitWithSources` — force-ветка переиспользует существующий код.

## Контракт фазы `init --force`

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

## Flow выполнения

1. Парсинг и валидация (см. таблицу выше).
2. yield `assistant_text` `"Re-init: wiping <wiki_folder>..."`.
3. `wiped = await wipeDomainFolder(vaultTools, entry.wiki_folder)`.
4. yield `tool_use "WipeDomain"` → `tool_result` → `assistant_text` `"removed N files"`.
5. yield `domain_updated` patch: `{ entity_types: [], analyzed_sources: [], language_notes: "" }`.
6. `effectiveSources = sourcePathsArg ?? existing.source_paths`.
7. Вызов `runInitWithSources(domainId, effectiveSources, dryRun=false, ..., force=true)`.
8. Внутри `runInitWithSources` при `force=true`: `isResuming=false` принудительно; `entity_types=[]`, `analyzed_sources=[]` сброшены через прямую мутацию `existing` перед вызовом; гард `existing?.entity_types?.length` на init.ts:50 пропускается при `force=true`. Первый файл → bootstrap, остальные → delta-инкремент.

## Wipe-функция

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

## Controller

Сигнатура `WikiController.init` расширяется параметром `force?: boolean`:

```ts
async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean): Promise<void> {
  const args = [domain];
  if (dryRun) args.push("--dry-run");
  if (force) args.push("--force");
  if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
  // onFileError — только при наличии sourcePaths (как раньше)
  ...
}
```

См. [[wiki-controller]].

## View

`src/view.ts:runReinit`:

```ts
const sourcePaths = entry.source_paths ?? [];   // FIX: snake_case
if (sourcePaths.length === 0) {
  new Notice(T.view.reinitNoSources);
  return;                                       // модал не открывается
}
const mdFiles = this.app.vault.getFiles().filter(
  (f) => f.extension === "md" && sourcePaths.some((p) => f.path.startsWith(p)),
);
new ConfirmModal(app, T.modal.reinitConfirmTitle,
  [T.modal.reinitConfirmBody(entry.id, mdFiles.length, sourcePaths.length)],
  () => void this.plugin.controller.init(entry.id, false, sourcePaths, true),
).open();
```

Ветка `reinitConfirmBodyNoSources` удаляется: re-init без `source_paths` теперь невозможен (Notice + return).

**Иконка:**

```ts
import { setIcon } from "obsidian";
this.reinitBtn = domainRow.createEl("button", { attr: { title: T.view.reinitTitle } });
setIcon(this.reinitBtn, "recycle");
```

Убирается `text: "⟳"`.

## i18n

| Ключ | RU | EN |
|---|---|---|
| `view.reinitTitle` | `Переинициализация домена (wipe + заново)` | `Re-init domain (wipe + rebuild)` |
| `view.reinitNoSources` | `У домена нет source_paths — re-init невозможен` | `Domain has no source_paths — re-init not possible` |
| `modal.reinitConfirmTitle` | `Re-init — подтвердите` | `Re-init — confirm` |
| `modal.reinitConfirmBody(id, files, srcCount)` | `Домен «${id}»: будет удалена вся вики-папка домена и пересобрана из ${files} md-файлов (${srcCount} sourcePaths). Продолжить?` | `Domain «${id}»: entire wiki folder will be deleted and rebuilt from ${files} md-files (${srcCount} source paths). Continue?` |

Ключ `reinitConfirmBodyNoSources` удаляется во всех локалях (en, ru, es).

## Edge cases

| Случай | Поведение |
|---|---|
| `force=true` + domain не найден | error в `runInit`, в UI Notice от dispatch |
| `force=true` + `source_paths=[]` без `--sources` | view.ts: Notice "no source_paths", модал не открывается; на уровне фазы — error из защитной проверки |
| `force=true` + `--dry-run` | error фазы (защита на случай прямого вызова) |
| Wipe: файл залочен Obsidian | `try/catch`, skip, продолжаем |
| Wipe: папка не существует | `listFiles` вернёт `[]`, цикл no-op |
| Abort во время wipe | проверка `signal.aborted` после wipe перед LLM-вызовами |
| Конкурентный init на тот же домен | блокируется [[single-flight-guard]] в `controller.dispatch` |
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

**Manual verification:**

1. Существующий домен с непустыми `source_paths` и заполненной wiki-папкой → клик recycle-btn → ConfirmModal → подтверждение → wiki-папка очищена → re-ingest всех файлов → новые entity_types, новые md-сущности.
2. Домен без `source_paths` → клик recycle-btn → Notice "no source_paths", модал не открывается.
3. Иконка `recycle` визуально отличается от `↻` (refresh).
4. Abort во время re-init → процесс прерывается, состояние согласовано (либо до wipe, либо после).

## Затрагиваемые файлы

- `src/phases/init.ts` — парсинг `--force`, гард dry-run+force, `wipeDomainFolder`, force-ветка в `runInit`, параметр `force` в `runInitWithSources`, override `isResuming/analyzed_sources/entity_types`, пропуск гарда `already initialised`.
- `src/controller.ts` — параметр `force` в `init()`.
- `src/view.ts` — fix `entry.source_paths`, передача `force=true`, проверка пустых `source_paths` с Notice, `setIcon("recycle")`, удаление `text: "⟳"`, удаление ветки `reinitConfirmBodyNoSources`.
- `src/i18n.ts` — обновление ключей (`reinitTitle`, `reinitConfirmBody`), новый `reinitNoSources`, удаление `reinitConfirmBodyNoSources`.
- `tests/phases/init.force.test.ts` — новый файл с unit-тестами.

## Связанные страницы

- [[reinit-force-plan]] — реализационный план
- [[reinit-button-design]] — предыдущая итерация (UI-кнопка без force)
- [[init-operation]] — расширяемая операция
- [[llm-wiki-view]] — UI-компонент
- [[wiki-controller]] — `controller.init`
- [[single-flight-guard]] — паттерн защиты от параллельных запусков
