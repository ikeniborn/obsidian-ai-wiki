# Domain Populate: Наполнение домена при создании

**Дата:** 2026-05-05  
**Статус:** Approved

## Контекст

При добавлении домена сейчас создаётся пустой `DomainEntry` с `source_paths: []`, после чего запускается `init` (LLM сэмплирует vault и генерирует `entity_types`). Source paths не указываются, wiki не наполняется.

Цель: добавить в форму создания домена список папок-источников и автоматически запускать `init`, который сам изучает источники, формирует описание домена с сущностями и создаёт wiki-страницы — всё в одной операции.

---

## Изменения

### 1. Форма AddDomainModal (`src/modals.ts`)

**Поля формы:**
- `id` — идентификатор домена (уже есть)
- `name` — отображаемое имя (уже есть)
- `wikiFolder` — vault-relative путь к wiki (уже есть, с фиксом ниже)
- `sourcePaths` — список папок-источников (новое)

**UI для sourcePaths:**
```
Source paths:
[ Notes/AI/   ] [×]  ← FolderSuggest autocomplete
[ Sources/    ] [×]
[ + добавить  ] ← кнопка добавляет новое поле
```

Каждое поле использует `FolderSuggest` — новый класс `extends AbstractInputSuggest<TFolder>`, который вызывает `app.vault.getAllFolders()` и фильтрует по введённому тексту. Кнопка `[×]` удаляет поле.

**Фикс wikiFolder:**
- Плейсхолдер показывает `vaults/work/!Wiki/id` — должно быть `!Wiki/id`
- `wikiRoot` вычисляется только из vault-relative пути первого домена или дефолта `!Wiki`, без `autodetectCwd()`

**Расширение `AddDomainInput` в `src/types.ts`:**
```typescript
sourcePaths: string[]  // vault-relative пути к папкам-источникам
```

---

### 2. Флоу после создания (`src/view.ts → openAddDomain()`)

```
registerDomain(input)  // сохраняет домен с source_paths
  │
  ├─ sourcePaths пустой → controller.init(domainId, false)  // как сейчас
  │
  └─ sourcePaths непустой:
       подсчитать .md файлы рекурсивно во всех папках
       показать ConfirmModal:
         "Найдено N файлов в M папках. Запустить инициализацию домена '{id}'?"
         [Запустить] → controller.init(domainId, false)   // расширенный init
         [Пропустить] → controller.init(domainId, false)  // как сейчас (сэмплирование vault)
```

Подсчёт файлов: `app.vault.getFiles().filter(f => f.extension === 'md' && sourcePaths.some(p => f.path.startsWith(p)))`

---

### 3. Расширение фазы `runInit` (`src/phases/init.ts`)

Текущее поведение: сэмплирует случайные файлы из vault → LLM генерирует `entity_types` + `language_notes`.

**Новое поведение при наличии `source_paths`** — две фазы внутри одной операции:

```
runInit(req, vaultTools, llm, domain)
  │
  ├─ source_paths пустой → текущее поведение (сэмплирование vault)
  │
  └─ source_paths непустой:
       glob .md файлов рекурсивно из каждой папки в source_paths
       emit: init_start { totalFiles: N }
       │
       // Фаза 1: изучение источников
       прочитать все файлы (или репрезентативную выборку при N > порога)
       LLM: проанализировать содержимое → сформировать entity_types + language_notes
       emit: domain_updated { patch }   // описание домена готово
       │
       // Фаза 2: создание wiki-страниц
       for each file:
         emit: file_start { file, index, total }
         LLM: извлечь сущности из файла → записать wiki-страницы
         emit: file_done { file }
         on error:
           choice = await onFileError(file, error, canRetry)
           'skip'  → continue
           'retry' → повторить (один раз); если снова ошибка → loop без retry
           'stop'  → return
```

**`onFileError` callback** передаётся через `RunRequest`:
```typescript
onFileError?: (file: string, err: Error, canRetry: boolean) => Promise<'skip' | 'retry' | 'stop'>
```

Контроллер конструирует его при создании запроса на init:
```typescript
onFileError: async (file, err, canRetry) =>
  new FileErrorModal(this.app, file, err, canRetry).waitForClose()
```

---

### 4. Диалог ошибки (`src/modals.ts → FileErrorModal`)

Promise-based Modal:

```
┌─────────────────────────────────────────┐
│ Ошибка при обработке файла              │
│                                         │
│ Notes/AI/paper1.md                      │
│ <текст ошибки>                          │
│                                         │
│ [Пропустить]  [Повторить]  [Остановить] │
└─────────────────────────────────────────┘
```

При `canRetry: false` кнопка «Повторить» скрыта.

---

### 5. Новые RunEvent типы (`src/types.ts`)

```typescript
{ type: 'init_start'; totalFiles: number }
{ type: 'file_start'; file: string; index: number; total: number }
{ type: 'file_done'; file: string }
```

---

### 6. Прогресс в LlmWikiView (`src/view.ts`)

При расширенном init (с source_paths) рендерить прогресс-бар:

```
Инициализация домена "ai"
████████░░░░░░░░  17 / 47 файлов
→ Notes/AI/transformers.md
```

---

## Файлы затронутые изменениями

| Файл | Изменение |
|------|-----------|
| `src/types.ts` | `AddDomainInput.sourcePaths`, `onFileError` в `RunRequest`, 3 новых RunEvent |
| `src/modals.ts` | `FolderSuggest`, поля sourcePaths, `FileErrorModal`, фикс wikiFolder |
| `src/view.ts` | `openAddDomain()` флоу, рендер init_start/file_start/file_done |
| `src/phases/init.ts` | расширение `runInit()` для работы с source_paths |
| `src/controller.ts` | реализация `onFileError` callback при запуске init |

---

## Что не меняется

- Операция `ingest` (одиночная) — без изменений
- Операция `lint` — не запускается при создании домена
- Single-flight guard — не нарушается, init — одна операция
- Новых фаз не добавляется
- Bootstrap как отдельный шаг отсутствует — init сам создаёт структуру wiki при необходимости
