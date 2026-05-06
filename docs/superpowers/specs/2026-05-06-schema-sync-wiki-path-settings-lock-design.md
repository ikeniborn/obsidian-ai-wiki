# Design: Schema Sync + Wiki Path Hardening + Settings Lock

**Дата:** 2026-05-06  
**Статус:** approved

---

## Scope

Три независимых куска работы, реализуемых в одном PR:

1. **Schema sync** — синхронизировать `templates/_schema.md` и промпты с конвенцией навыка `llm-wiki`
2. **Wiki path hardening** — `DomainEntry.wiki_folder` хранит только подпапку домена (`"os"`), `!Wiki/` всегда добавляется константой
3. **Settings lock** — блокировать редактирование доменов в Settings Panel во время активной операции

---

## 1. Schema Sync

### 1.1 `templates/_schema.md`

Шесть точечных правок в существующем файле:

| # | Поле/секция | Изменение |
|---|-------------|-----------|
| 1 | `OutgoingLinks` в таблице Frontmatter | Переименовать в `wiki_outgoing_links`; примечание про тип Obsidian Links сохранить |
| 2 | `wiki_external_links` | Добавить строку в таблицу: массив `http/https` URL, не формируют граф Obsidian |
| 3 | `wiki_type` | Добавить строку: `page \| index \| log \| schema`, только для служебных файлов |
| 4 | `wiki_status` → `developing` | Добавить критерии: `≥2 источника, ≥10 предложений, основные разделы заполнены` |
| 5 | Опциональные разделы | Добавить `## Связанные концепции` с правилом: создавать только если нужен пояснительный контекст к связям; без контекста — не создавать |
| 6 | Контент | Добавить: таблицы — markdown с выравниванием (`\|---|`); code-блоки — обязательно указывать язык |

### 1.2 `prompts/ingest.md` и `prompts/optimized/ingest.md`

Правки в JSON-примере и блоке ПРАВИЛА:

- В JSON-примере: `OutgoingLinks: []` → `wiki_outgoing_links: []`
- В `optimized/ingest.md`: добавить `wiki_outgoing_links: []` в пример (поле отсутствует)
- В блок ПРАВИЛА добавить три пункта:
  - `## Основные характеристики` — обязательный раздел каждой страницы
  - При добавлении из нового источника — фиксировать в `## История изменений` с датой и источником
  - `## Связанные концепции` — создавать только при наличии пояснительного контекста к связям

---

## 2. Wiki Path Hardening

### 2.1 Константа и хелпер

Новый файл `src/wiki-path.ts`:

```typescript
export const WIKI_ROOT = "!Wiki";

export function domainWikiFolder(wikiFolder: string): string {
  return `${WIKI_ROOT}/${wikiFolder}`;
}
```

### 2.2 Модель данных

`DomainEntry.wiki_folder` — теперь хранит только подпапку домена (например `"os"`, `"базы-данных"`). Документация поля обновляется:

```typescript
export interface DomainEntry {
  id: string;
  name: string;
  wiki_folder: string;  // домен-относительная подпапка, e.g. "os" (без "!Wiki/")
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
}
```

Аналогично `AddDomainInput.wikiFolder`.

### 2.3 Миграция при загрузке

В `main.ts`, сразу после `loadData()`, до первого использования `settings.domains`:

```typescript
function migrateWikiFolder(domains: DomainEntry[]): boolean {
  let changed = false;
  for (const d of domains) {
    if (d.wiki_folder.startsWith("!Wiki/")) {
      d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      changed = true;
    }
  }
  return changed;
}
```

Если `changed === true` — немедленно `saveSettings()`. Если `wiki_folder` начинается с чего-то другого (нестандартный путь) — не трогать, залогировать `console.warn`.

### 2.4 Замена вызовов в фазах

Все места в `src/phases/` и `src/phases/init.ts`, где используется `domain.wiki_folder` для конструирования пути, заменить на `domainWikiFolder(domain.wiki_folder)`.

Поиск по кодовой базе: `domain.wiki_folder`, `d.wiki_folder`, `entry.wiki_folder`.

### 2.5 UI — `AddDomainModal`

- Убрать поле ввода полного `wikiFolder`
- Добавить read-only префикс-лейбл `!Wiki/` + input только для подпапки
- Auto-fill: при вводе ID домена подставлять `ID` в поле подпапки (уже есть логика)
- `wikiFolder` в `AddDomainInput` теперь содержит только подпапку

### 2.6 UI — `EditDomainModal`

- Поле `wiki_folder` отображает только подпапку (без `!Wiki/`)
- Слева от поля статичный текст `!Wiki/` (CSS pseudo или отдельный `<span>`)
- При сохранении `wiki_folder` = введённое значение (без добавления `!Wiki/` — оно уже убрано из хранения)

---

## 3. Settings Lock During Operation

### 3.1 Expose running state

В `controller.ts` добавить публичный геттер:

```typescript
get running(): boolean { return this._running; }
```

### 3.2 Callback при смене состояния

В `controller.ts` добавить публичное поле:

```typescript
onBusyChange?: () => void;
```

При установке `_running` (оба места — start и stop) вызывать `this.onBusyChange?.()`.

В `main.ts`, после создания controller:

```typescript
this.controller.onBusyChange = () => this.settingTab?.display();
```

### 3.3 Settings Panel

В `LlmWikiSettingTab.display()`, после заголовка General:

```typescript
if (this.plugin.controller.running) {
  containerEl.createEl("div", {
    text: i18n().settings.busyBanner,
    cls: "llm-wiki-settings-busy-banner mod-warning",
  });
}
```

Для каждой кнопки Edit и Delete домена:

```typescript
.addButton((b) => {
  b.setButtonText(T.settings.editDomain)
   .setDisabled(this.plugin.controller.running)
   .onClick(...);
})
```

Остальные настройки (iclaudePath, модели, таймауты) не блокируются — они не влияют на текущую операцию.

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `templates/_schema.md` | 6 правок конвенций |
| `prompts/ingest.md` | поле + 3 правила |
| `prompts/optimized/ingest.md` | поле + 3 правила |
| `src/wiki-path.ts` | новый файл: константа + хелпер |
| `src/domain-map.ts` | обновить JSDoc `wiki_folder` |
| `src/main.ts` | миграция + onBusyChange callback |
| `src/controller.ts` | `get running()` + onBusyChange hook |
| `src/settings.ts` | баннер + setDisabled на кнопках доменов |
| `src/modals.ts` | AddDomainModal + EditDomainModal UI |
| `src/phases/ingest.ts` | `domainWikiFolder()` |
| `src/phases/init.ts` | `domainWikiFolder()` |
| `src/phases/query.ts` | `domainWikiFolder()` (если есть) |
| `src/phases/lint.ts` | `domainWikiFolder()` (если есть) |
| `src/phases/fix.ts` | `domainWikiFolder()` (если есть) |

## Не меняем

- Путь `!Wiki/` в `templates/_schema.md` — корректен для проекта
- Логику single-flight в controller — уже защищает от параллельных операций
- Любые другие настройки в Settings Panel
