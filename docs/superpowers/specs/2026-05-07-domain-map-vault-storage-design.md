# Domain-map → vault + iclaudePath → local config (Design Spec)

**Date:** 2026-05-07
**Status:** Draft — pending approval

## Problem

Two synchronization pain points при переносе плагина между ПК:

1. **`settings.claudeAgent.iclaudePath`** хранится в `data.json` плагина, который синхронизируется (Obsidian Sync, git, Syncthing). Путь до `iclaude.sh` зависит от машины — на каждом новом ПК настройка ломается, требует ручного фикса.
2. **`settings.domains[]`** хранится там же. Список доменов — shared между машинами и логически принадлежит вики (а не конфигу плагина). Сейчас редактирование требует синка `data.json`, что сцепляет shared- и machine-local-данные в одном файле.

## Goal

- Перенести `domains[]` в vault-файл `!Wiki/_domain.json` (по конвенции `_log.md`, `_schema.md`, `_index.md`).
- Перенести `iclaudePath` в machine-local файл `<plugin-dir>/local.json`, не предназначенный для синка.
- Обеспечить безопасную auto-миграцию для существующих юзеров.

## Non-Goals

- Аудит всех остальных полей `LlmWikiPluginSettings` на shared/local разделение.
- Изменение протокола `RunEvent` или фаз.
- UI-редактор `_domain.json` напрямую (юзер правит через Settings → Domains как и раньше).

## Architecture

```
┌─────────────┐   onload migrate (one-shot)  ┌──────────────────┐
│  data.json  │──────────────────────────────>│ !Wiki/_domain-   │
│  (synced)   │                               │   map.json       │
└─────────────┘                               └──────────────────┘
       │                                              ▲
       │ removed: domains[],                          │ DomainMapStore
       │          claudeAgent.iclaudePath             │  (lazy read,
       ▼                                              │   atomic write)
┌─────────────────────┐                       ┌──────────────────┐
│  LocalConfigStore   │<──── reads ───────────│  WikiController  │
│  <plugin-dir>/      │                       │  / SettingsTab   │
│  local.json         │                       └──────────────────┘
└─────────────────────┘
       ▲
       │ iclaudePath (per-machine)
```

Two изолированных модуля:
- `DomainMapStore` — vault-relative, shared, атомарная запись.
- `LocalConfigStore` — plugin-dir, machine-local, кэширующий.

## Components

### `src/domain-map-store.ts` (new)

```ts
import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain-map";

const FILE_PATH = "!Wiki/_domain.json";
const TMP_PATH = `${FILE_PATH}.tmp`;

export class DomainMapCorruptError extends Error {}

export class DomainMapStore {
  constructor(private vault: Vault) {}

  /** Lazy read on every call. Hard-fail on corrupt JSON. Empty list if file absent. */
  async load(): Promise<DomainEntry[]> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(FILE_PATH))) return [];
    const raw = await adapter.read(FILE_PATH);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new DomainMapCorruptError(`${FILE_PATH}: ${(e as Error).message}`); }
    if (!Array.isArray(parsed)) throw new DomainMapCorruptError(`${FILE_PATH}: not an array`);
    return parsed as DomainEntry[];
  }

  /** Atomic write: write tmp, then rename. */
  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists("!Wiki"))) await adapter.mkdir("!Wiki");
    await adapter.write(TMP_PATH, JSON.stringify(domains, null, 2));
    if (await adapter.exists(FILE_PATH)) await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
}
```

### `src/local-config.ts` (new)

```ts
import type { Plugin } from "obsidian";

export interface LocalConfig {
  iclaudePath: string;
}

const DEFAULTS: LocalConfig = { iclaudePath: "" };

export class LocalConfigStore {
  private cache: LocalConfig | null = null;

  constructor(private plugin: Plugin) {}

  private path(): string {
    const dir = this.plugin.manifest.dir!;
    return `${dir}/local.json`;
  }

  async load(): Promise<LocalConfig> {
    if (this.cache) return this.cache;
    const adapter = this.plugin.app.vault.adapter;
    const p = this.path();
    if (!(await adapter.exists(p))) { this.cache = { ...DEFAULTS }; return this.cache; }
    try {
      const raw = await adapter.read(p);
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalConfig>) };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }

  async save(patch: Partial<LocalConfig>): Promise<void> {
    const cur = await this.load();
    this.cache = { ...cur, ...patch };
    await this.plugin.app.vault.adapter.write(this.path(), JSON.stringify(this.cache, null, 2));
  }
}
```

### Изменения в существующих файлах

| Файл | Изменение |
|---|---|
| `src/types.ts` | Удалить `domains: DomainEntry[]` из `LlmWikiPluginSettings`. Удалить `iclaudePath` из `claudeAgent`. Удалить эти поля из `DEFAULT_SETTINGS`. |
| `src/main.ts` | onload: создать `domainMapStore`, `localConfigStore`. Вызвать `migrateLegacyData()`. Передать оба store в `WikiController`. |
| `src/controller.ts` | Конструктор принимает `DomainMapStore` и `LocalConfigStore`. `loadDomains()` async → `await store.load()`. Dispatch loop: `domain_created` / `domain_updated` / `source_path_added` → `store.save(applyPatch(...))` вместо `plugin.saveSettings()`. `buildAgentRunner()` берёт `iclaudePath` из `localConfig.load()`. Catch `DomainMapCorruptError` → `new Notice` + abort run. |
| `src/settings.ts` | Domains-секция: `await store.load()` в `display()` (`display` стал async через `void` wrapper). Edit/Delete вызывают `store.save()`. iclaudePath input биндится к `LocalConfigStore.save({iclaudePath})`. |
| `src/main.ts` (loadDomains usage) | Все `plugin.settings.domains` чтения заменить на `await controller.loadDomains()` или передавать через параметр. |

### Migration (one-shot, idempotent)

Добавляется в `main.ts` после `loadSettings()`:

```ts
async function migrateLegacyData(
  plugin: LlmWikiPlugin,
  domainMapStore: DomainMapStore,
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const data = (await plugin.loadData()) as Record<string, any> | null;
  if (!data) return;

  let dirty = false;

  // domains → vault
  if (Array.isArray(data.domains) && data.domains.length > 0) {
    const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/_domain.json");
    if (!vaultExists) {
      await domainMapStore.save(data.domains);
    }
    delete data.domains;
    dirty = true;
  } else if ("domains" in data) {
    delete data.domains;
    dirty = true;
  }

  // iclaudePath → local
  const legacyPath = data.claudeAgent?.iclaudePath;
  if (typeof legacyPath === "string" && legacyPath.length > 0) {
    const cur = await localConfigStore.load();
    if (!cur.iclaudePath) {
      await localConfigStore.save({ iclaudePath: legacyPath });
    }
    delete data.claudeAgent.iclaudePath;
    dirty = true;
  } else if (data.claudeAgent && "iclaudePath" in data.claudeAgent) {
    delete data.claudeAgent.iclaudePath;
    dirty = true;
  }

  if (dirty) await plugin.saveData(data);
}
```

Idempotency: повторный onload видит `data.domains === undefined` и пропускает блок. Vault-файл не перезаписывается.

## Data Flow

**Load (onload):**
1. Создаются `domainMapStore`, `localConfigStore`.
2. `migrateLegacyData()` — one-shot перенос. Мутирует `data.json` (удаляет `domains`, `claudeAgent.iclaudePath`).
3. `plugin.loadSettings()` — читает уже очищенный `data.json`, заполняет `settings` БЕЗ legacy-полей.
4. `controller = new WikiController(app, plugin, domainMapStore, localConfigStore)`.

Порядок 1→2→3 критичен: `loadSettings()` использует spread `...(data ?? {})`, который иначе скопировал бы legacy-поля в runtime-`settings` несмотря на удаление из interface.

**Read (loadDomains):**
- `controller.loadDomains()` → `await domainMapStore.load()` каждый раз (lazy).
- Подхватывает внешние правки файла.
- `DomainMapCorruptError` → notice в UI + блок операций до фикса.

**Write (RunEvent):**
- `dispatch()` ловит `domain_created`/`domain_updated`/`source_path_added`:
  ```ts
  const cur = await this.domainMapStore.load();
  const next = applyDomainEvent(cur, ev);
  await this.domainMapStore.save(next);
  ```
- Mutex `_running` контроллера сериализует записи.

Helper (новый, в `src/domain-map.ts` рядом с типами):

```ts
import type { RunEvent } from "./types";

export function applyDomainEvent(
  domains: DomainEntry[],
  ev: Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" }>,
): DomainEntry[] {
  const next = [...domains];
  if (ev.kind === "domain_created") {
    if (next.some((d) => d.id === ev.entry.id)) return next; // idempotent
    next.push(ev.entry);
    return next;
  }
  const i = next.findIndex((d) => d.id === ev.domainId);
  if (i < 0) return next;
  if (ev.kind === "domain_updated") {
    next[i] = { ...next[i], ...ev.patch };
    return next;
  }
  // source_path_added
  const paths = new Set(next[i].source_paths ?? []);
  paths.add(ev.path);
  next[i] = { ...next[i], source_paths: [...paths] };
  return next;
}
```

`source_path_added` логика повторяет существующую `consolidateSourcePaths()` поведение dedupe.

**Settings UI:**
- iclaudePath input → `onChange` → `localConfigStore.save({ iclaudePath: v })`.
- Domain edit/delete → `await domainMapStore.save(updated)`.

## Error Handling

| Случай | Поведение |
|---|---|
| `_domain.json` отсутствует | `[]` — пустой стейт, нет ошибки |
| `_domain.json` битый JSON / не массив | Throw `DomainMapCorruptError` → controller catches → `new Notice("Domain map corrupt: <msg>")` → run aborts |
| `local.json` отсутствует | Defaults `{ iclaudePath: "" }` |
| `local.json` битый | Defaults (молча, не критично) |
| `iclaudePath === ""` при запуске | Существующая проверка в `controller.run()` отказывает с инструкцией |

## Sync Considerations

`<plugin-dir>/local.json` лежит внутри `.obsidian/plugins/obsidian-llm-wiki/` — попадает под Obsidian Sync если юзер не исключил. Документируем в README:

> При использовании Obsidian Sync / git / Syncthing исключите `.obsidian/plugins/obsidian-llm-wiki/local.json` — этот файл содержит machine-specific путь до `iclaude.sh`.

Альтернатива (вынести вне vault) — отвергнута: нестандартное расположение, ломает портативность плагина.

## Tests

| Файл | Покрытие |
|---|---|
| `tests/domain-map-store.test.ts` (new) | load: missing→[], present→parsed, corrupt JSON→throw, non-array→throw. save: atomic (tmp создан, потом rename), ensureDir, idempotent rewrite. |
| `tests/local-config.test.ts` (new) | load: missing→defaults, present→merged, corrupt→defaults. save: write+merge cache. |
| `tests/main-migration.test.ts` (new) | data.domains present + no vault file → migrated. data.iclaudePath → moved to local. data.json cleaned. Re-run → no-op (idempotent). vault file already exists → не перезаписан. |
| `tests/controller.integration.test.ts` (update) | `loadDomains()` дёргает store. `domain_created` → `store.save()`. Corrupt store → Notice + run aborted. |
| `tests/phases/*.test.ts` | без изменений (фазы не знают про store). |

## Rollout

1. Bump patch version (`X.Y.(Z+1)`).
2. Build.
3. Release notes — описать миграцию, упомянуть Sync exclusion для `local.json`.

## Out of Scope (будущие итерации)

- Watch `_domain.json` через `Vault.on('modify')` для UI-обновления при внешних правках.
- TOON-формат вместо JSON.
- Backup `.bak` при записи.
- Изоляция остальных machine-local полей (`devMode.evaluatorModel`, `nativeAgent.baseUrl`).
