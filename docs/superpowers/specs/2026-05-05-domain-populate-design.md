# Domain Populate: Наполнение домена при создании

**Дата:** 2026-05-05  
**Статус:** Approved

## Контекст

При добавлении домена сейчас создаётся пустой `DomainEntry` с `source_paths: []`, после чего запускается `init` (LLM сэмплирует vault и генерирует `entity_types`). Пользователь должен вручную добавлять пути к источникам и запускать `ingest` по одному файлу.

Цель: добавить в форму создания домена перечисление папок-источников и автоматически запускать наполнение (ingest всех файлов + lint) сразу после создания.

---

## Изменения

### 1. Форма AddDomainModal (`src/modals.ts`)

**Новые поля:**
- Список полей для папок-источников с кнопкой «+ Добавить путь»
- Каждое поле — `FolderSuggest` (autocomplete из `app.vault.getAllFolders()`)
- Кнопка `[×]` удаляет поле

**Фикс wikiFolder:**
- Плейсхолдер показывает `vaults/work/!Wiki/id` — нужно `!Wiki/id`
- `wikiRoot` вычисляется только из vault-relative пути первого домена или дефолта `!Wiki`, без `autodetectCwd()`

**Расширение `AddDomainInput` в `src/types.ts`:**
```typescript
sourcePaths: string[]  // vault-relative пути к папкам-источникам
```

### 2. Флоу после создания (`src/view.ts → openAddDomain()`)

```
registerDomain(input)  // сохраняет домен с source_paths
  │
  ├─ sourcePaths пустой → controller.init(domainId, false)  // как сейчас
  │
  └─ sourcePaths непустой:
       glob .md файлов рекурсивно по всем папкам
       показать ConfirmModal:
         "Найдено N файлов в M папках. Запустить наполнение домена '{id}'?"
         [Запустить] → controller.populate(domainId, sourcePaths)
         [Пропустить] → controller.init(domainId, false)
```

Подсчёт файлов: `app.vault.getFiles().filter(f => f.extension === 'md' && sourcePaths.some(p => f.path.startsWith(p)))`

### 3. Новая фаза `runPopulate` (`src/phases/populate.ts`)

```
runPopulate(req, vaultTools, llm, domains, onFileError)
  │
  ├─ glob .md файлов из каждой папки рекурсивно
  ├─ emit: populate_start { totalFiles: N }
  │
  ├─ for each file (index i of N):
  │    ├─ emit: file_start { file, index: i, total: N }
  │    ├─ try: runIngest(req с args[0]=file, ...)
  │    ├─ on success: emit file_done { file }
  │    └─ on error:
  │         retried = false
  │         loop:
  │           choice = await onFileError(file, error, canRetry: !retried)
  │           'skip'  → break
  │           'retry' → retried=true, повторить runIngest; если снова ошибка → loop без retry
  │           'stop'  → return
  │
  └─ runLint(req с domainId=req.args[0])
```

**Сигнатура `onFileError`:**
```typescript
type OnFileError = (file: string, err: Error, canRetry: boolean) => Promise<'skip' | 'retry' | 'stop'>
```

### 4. Диалог ошибки (`src/modals.ts → ConfirmModal`)

Новый Modal (Promise-based):

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

### 5. Новые RunEvent типы (`src/types.ts`)

```typescript
{ type: 'populate_start'; totalFiles: number }
{ type: 'file_start'; file: string; index: number; total: number }
{ type: 'file_done'; file: string }
```

### 6. Прогресс в LlmWikiView (`src/view.ts`)

События `populate_start` / `file_start` / `file_done` рендерятся как прогресс:

```
Наполнение домена "ai"
████████░░░░░░░░  17 / 47 файлов
→ Notes/AI/transformers.md
```

После завершения всех файлов — lint отображается как обычно (существующий рендер).

### 7. Dispatch в AgentRunner (`src/agent-runner.ts`)

Добавить case `'populate'` в `run()`, передавая `onFileError` callback из контроллера.

**Параметры RunRequest для populate:**
- `operation: 'populate'`
- `args: [domainId, ...folderPaths]`
- `onFileError?: OnFileError` — добавляется как опциональное поле в тип `RunRequest`

Контроллер конструирует callback при создании запроса:
```typescript
const req: RunRequest = {
  operation: 'populate',
  args: [domainId, ...folderPaths],
  onFileError: async (file, err, canRetry) => {
    return new FileErrorModal(this.app, file, err, canRetry).waitForClose();
  }
};
```

`runPopulate` вызывает `runIngest` с клонированным req: `{ ...req, args: [file] }`.

---

## Файлы затронутые изменениями

| Файл | Изменение |
|------|-----------|
| `src/types.ts` | `AddDomainInput.sourcePaths`, 3 новых RunEvent |
| `src/modals.ts` | `FolderSuggest`, поля sourcePaths, `ConfirmModal`, фикс wikiFolder |
| `src/view.ts` | `openAddDomain()` флоу, рендер populate событий |
| `src/agent-runner.ts` | case `'populate'`, передача `onFileError` |
| `src/phases/populate.ts` | **новый файл** — `runPopulate()` |
| `src/controller.ts` | `populate()` метод, реализация `onFileError` callback |

---

## Что не меняется

- Операция `ingest` (одиночная) — без изменений
- Операция `lint` — без изменений, вызывается как функция из populate
- Single-flight guard — не нарушается, populate — одна операция
- `runInit()` — не вызывается при populate (init — для пустых доменов без источников)
