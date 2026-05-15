---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-15-reinit-force-design.md
  - docs/superpowers/specs/2026-05-15-reinit-force-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [plan, init, force, wipe, tdd]
---

# Re-init Force Plan

Реализационный план [[reinit-force-design]]: превратить кнопку re-init в полную переинициализацию домена через флаг `--force` фазы [[init-operation]] — wipe wiki-папки + сброс `entity_types/analyzed_sources/language_notes` + повторный bootstrap+delta+ingest. Иконка меняется на Lucide `recycle`.

## Архитектура реализации

Фаза `init` получает флаг `--force`: новая ветка в `runInit` сначала удаляет файлы внутри `domainWikiFolder(wiki_folder)`, шлёт `domain_updated` со сброшенными полями, затем делегирует в `runInitWithSources(force=true)`. При `force=true` `runInitWithSources` обходит гард «already initialised», игнорирует `analyzed_sources` (`isResuming=false`) и стартует bootstrap независимо от существующего домена.

[[wiki-controller]] прокидывает `force` через CLI args. [[llm-wiki-view]] переиспользует `controller.init()` с новым параметром, удаляет ветку no-sources (заменяет Notice'ом), меняет глиф `⟳` на `setIcon("recycle")`.

**Tech stack:** TypeScript, Obsidian API (`setIcon`, `Notice`, `TFile`), vitest, esbuild.

## Затрагиваемые файлы

| Файл | Изменение |
|---|---|
| `src/phases/init.ts` | `wipeDomainFolder` helper; парсинг `--force`; валидация (dry-run+force, domain not found, no sources); force-ветка в `runInit`; параметр `force` в `runInitWithSources`; override `isResuming/analyzed_sources/entity_types`; пропуск гарда `already initialised` |
| `src/controller.ts` | параметр `force?: boolean` в `init()`, передача `--force` в `args` |
| `src/view.ts` | fix `entry.source_paths` (snake_case), удаление ветки `reinitConfirmBodyNoSources`, Notice при пустых `source_paths`, `setIcon(this.reinitBtn, "recycle")`, `force=true` в вызове `controller.init` |
| `src/i18n.ts` | обновление `reinitTitle`, `reinitConfirmBody`, добавление `reinitNoSources`, удаление `reinitConfirmBodyNoSources` (en/ru/es) |
| `tests/phases/init.force.test.ts` | новый файл с unit-тестами |

## Декомпозиция на задачи (TDD)

План построен по [[superpowers:test-driven-development]] — каждая задача начинается с failing-теста.

### Task 1: `wipeDomainFolder` helper

Новый экспорт в `src/phases/init.ts`. Тесты в новом `tests/phases/init.force.test.ts` (3 теста):

- удаляет каждый файл под `!Wiki/<folder>/` и возвращает их список;
- не трогает файлы вне `!Wiki/<folder>/` (`_wiki_schema.md`, `_log.md`);
- skip + continue при ошибке `remove` (locked file).

Commit: `feat(init): add wipeDomainFolder helper for force re-init`.

### Task 2: `force` параметр в `runInitWithSources`

Расширить сигнатуру `runInitWithSources(..., force: boolean = false)`. При `force=true`:

```ts
const isResuming = !force && existing?.analyzed_sources !== undefined;
const alreadyAnalyzed = new Set(force ? [] : (existing?.analyzed_sources ?? []));
const toAnalyze = isResuming ? sourceFiles.filter((f) => !alreadyAnalyzed.has(f)) : sourceFiles;
```

В bootstrap-ветке `domain_updated` patch включает сброс `analyzed_sources: []`.

Тесты (2):

- `force=true` игнорирует `analyzed_sources` и стартует bootstrap от первого файла;
- `force=true` без существующего домена работает по обычному bootstrap-пути.

Commit: `feat(init): add force param to runInitWithSources to override resume`.

### Task 3: `--force` парсинг + валидация + wipe в `runInit`

Парсинг `const force = args.includes("--force");`. Force-ветка перед обычным flow:

```ts
if (force) {
  if (!existing) yield { kind: "error", message: `force: domain "${domainId}" not found` };
  if (dryRun)   yield { kind: "error", message: "force: dry-run not supported" };
  const effectiveSources = sourcePaths.length ? sourcePaths : (existing.source_paths ?? []);
  if (!effectiveSources.length) yield { kind: "error", message: "force: no sources to re-analyze" };

  yield { kind: "assistant_text", delta: `Re-init: wiping ${domainWikiFolder(existing.wiki_folder)}...\n` };
  yield { kind: "tool_use", name: "WipeDomain", input: { folder: existing.wiki_folder } };
  const wiped = await wipeDomainFolder(vaultTools, existing.wiki_folder);
  yield { kind: "tool_result", ok: true };
  yield { kind: "assistant_text", delta: `removed ${wiped.length} files\n` };
  yield { kind: "domain_updated", domainId, patch: { entity_types: [], analyzed_sources: [], language_notes: "" } };

  if (signal.aborted) return;

  // мутация in-memory объекта, чтобы runInitWithSources увидел сброшенное состояние
  existing.entity_types = [];
  existing.analyzed_sources = [];
  existing.language_notes = "";

  yield* runInitWithSources(domainId, effectiveSources, false, ..., true);
  return;
}
```

Тесты (5):

- `--force` без domain → error `"force: domain not found"`;
- `--force` + `--dry-run` → error `"force: dry-run not supported"`;
- `--force` без `--sources`, пустой `source_paths` → error `"force: no sources to re-analyze"`;
- `--force` вызывает `wipe` и сбрасывает поля в первом `domain_updated`;
- `--force` с `--sources` использует переданные пути, не `entry.source_paths`.

Проверить регрессию: `tests/phases/init.test.ts` зелёные. Commit: `feat(init): wire --force flag — wipe + reset + re-bootstrap`.

### Task 4: Controller `init()` принимает `force`

`src/controller.ts:308–319` — расширить сигнатуру:

```ts
async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean): Promise<void> {
  const args: string[] = [domain];
  if (dryRun) args.push("--dry-run");
  if (force) args.push("--force");
  if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
  const onFileError: OnFileError | undefined = sourcePaths?.length ? ... : undefined;
  await this.dispatch("init", args, ..., onFileError);
}
```

`onFileError` остаётся завязан на `sourcePaths?.length` (по спеке, не расширяется на `force`). Type-check `npx tsc --noEmit`. Commit: `feat(controller): pass force flag to init phase`.

### Task 5: View — snake_case fix, recycle icon, drop no-sources branch

`src/view.ts`:

- заменить `text: "⟳"` на `setIcon(this.reinitBtn, "recycle")` (импорт `setIcon` из `obsidian`);
- переписать `runReinit()`: `entry.source_paths` (snake_case), early-return с `Notice(T.view.reinitNoSources)` при пустых source_paths, вызов `controller.init(entry.id, false, sourcePaths, true)`;
- ветка с `reinitConfirmBodyNoSources` удалена.

Commit откладывается до Task 6 (ключ `reinitNoSources` ещё не существует).

### Task 6: i18n (en, ru, es)

`src/i18n.ts`:

- обновить `reinitTitle` (текст про wipe + rebuild) во всех трёх локалях;
- обновить `reinitConfirmBody(id, files, srcCount)` — новый текст про удаление папки;
- добавить `reinitNoSources`;
- удалить `reinitConfirmBodyNoSources` в en, ru, es.

`npx tsc --noEmit` → нет ошибок. `npm test` → все зелёные, включая новый `init.force.test.ts`. `npm run build` → success. Commit обоих файлов вместе: `feat(view,i18n): re-init uses recycle icon, drops no-sources branch`.

### Task 7: Manual verification

5 manual-кейсов (см. [[reinit-force-design]] § Testing) после `npm run build` и reload Obsidian. Регрессии — отдельным issue, не silent fix.

## Контрольные точки

- Спека §Design Flow steps 1–8 → Task 3 Step 3.
- Спека §Wipe-функция → Task 1.
- Спека §Controller → Task 4.
- Спека §View → Task 5.
- Спека §i18n table → Task 6.
- 7 unit-тестов из §Testing → 3 в Task 1 (wipe), 2 в Task 2 (force overrides), 5 в Task 3 (dispatch). Item 6 «Wipe не трогает _wiki_schema.md» — Task 1 test "does not touch files outside".
- Abort после wipe → guarded by `if (signal.aborted) return;` (Task 3).
- Locked file → Task 1 test "skips files that fail to remove".
- Mobile (no domainRow) → reinitBtn никогда не создаётся, ветка не затрагивается.

## Связанные страницы

- [[reinit-force-design]] — спецификация
- [[reinit-button-plan]] — предыдущий план (только UI, без force)
- [[init-operation]] — расширяемая операция
- [[wiki-controller]] — `controller.init` с новым параметром
- [[llm-wiki-view]] — UI с recycle-иконкой
- [[single-flight-guard]] — защита от параллельных запусков
