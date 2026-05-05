# Дизайн: чат после ingest и query

Дата: 2026-05-05

## Цель

Показывать чат-секцию для обсуждения результатов не только после `lint`, но и после `ingest` и `query`. Чат сбрасывается при старте любой новой операции.

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | Добавить `domainId?: string` в `RunHistoryEntry` |
| `src/controller.ts` | Заполнять `domainId` в `dispatch()`; переименовать `lintChat()` → `chat()` |
| `src/view.ts` | Заменить `lastLint` на `lastContext`; расширить условие показа чата; сбрасывать чат в `setRunning()` |
| `prompts/chat.md` | Заменить lint-специфичный текст на универсальный через переменную `{{operation_header}}` |
| `src/phases/chat.ts` | Принимать `operationHeader: string` вместо захардкоженного текста |

## Изменения по файлам

### `src/types.ts`

```typescript
export interface RunHistoryEntry {
  id: string;
  operation: WikiOperation;
  args: string[];
  domainId?: string;   // ← новое, опциональное
  startedAt: number;
  finishedAt: number;
  status: "done" | "error" | "cancelled";
  finalText: string;
  steps: Array<{ kind: "tool_use" | "tool_result"; label: string }>;
}
```

Обратно совместимо: старые записи в `settings.history` получат `undefined`.

### `src/controller.ts`

В `dispatch()` записывать `domainId` в `RunHistoryEntry`:

```typescript
const entry: RunHistoryEntry = {
  id: `${startedAt}`,
  operation: op,
  args,
  domainId,       // ← из параметра dispatch()
  ...
};
```

Переименовать `lintChat()` → `chat()`, сигнатура та же плюс `operation: WikiOperation` для логирования.

### `src/view.ts`

Заменить поле `lastLint`:

```typescript
// было
private lastLint: { domainId: string; report: string } | null = null;

// стало
private lastContext: { operation: WikiOperation; domainId: string | undefined; report: string } | null = null;
```

В `setRunning()` добавить сброс чата:

```typescript
this.chatSection?.remove();
this.chatSection = null;
this.lastContext = null;
this.chatHistory = [];
```

В `finish()` расширить условие показа чата:

```typescript
// было: только lint с domainId
if (entry.operation === "lint" && entry.status === "done" && domainId) { ... }

// стало: lint, ingest, query, query-save при наличии finalText
const CHAT_OPS: WikiOperation[] = ["lint", "ingest", "query", "query-save"];
if (CHAT_OPS.includes(entry.operation) && entry.status === "done" && entry.finalText) {
  this.lastContext = {
    operation: entry.operation,
    domainId: entry.domainId,
    report: entry.finalText,
  };
  this.chatHistory = [];
  this.showChatSection();
}
```

В `showChatSection()` кнопка отправки вызывает переименованный метод:

```typescript
void this.plugin.controller.chat(
  this.lastContext.operation,
  this.lastContext.domainId,
  this.lastContext.report,
  this.chatHistory,
  text,
);
```

### `prompts/chat.md`

Текущее содержимое файла:

```markdown
{{domain_header}}
Помогай пользователю анализировать и исправлять проблемы, выявленные lint-проверкой.
Отвечай конкретно, ссылаясь на страницы и сущности из отчёта.

ОТЧЁТ LINT:
{{lint_report}}
```

Новое содержимое:

```markdown
{{operation_header}}
Помогай пользователю анализировать и обсуждать результаты операции.
Отвечай конкретно, ссылаясь на страницы и сущности из контекста.

РЕЗУЛЬТАТ ОПЕРАЦИИ:
{{context}}
```

Переменные: `{{domain_header}}` → `{{operation_header}}`, `{{lint_report}}` → `{{context}}`.

### `src/phases/chat.ts`

Добавить параметр `operationHeader: string` (или генерировать из `operation`):

```typescript
export async function* runLintChat(
  llm: LlmClient,
  model: string,
  domain: DomainEntry | undefined,
  signal: AbortSignal,
  opts: LlmCallOptions,
  context: string,           // было lintReport
  history: ChatMessage[],
  operationHeader: string,   // ← новое
): AsyncGenerator<RunEvent>
```

Значение `operationHeader` генерируется в `controller.ts` перед вызовом `runLintChat`:

```typescript
const OPERATION_LABELS: Partial<Record<WikiOperation, string>> = {
  lint: "Lint-проверка wiki",
  ingest: "Извлечение знаний (ingest)",
  query: "Ответ на запрос (query)",
  "query-save": "Ответ на запрос с сохранением (query-save)",
};
const operationHeader = OPERATION_LABELS[operation] ?? operation;
```

Рендер:

```typescript
render(chatTemplate, {
  operation_header: operationHeader,
  context,
})
```

## Поток данных

```
finish(entry) где entry.operation ∈ {lint, ingest, query, query-save}
  && entry.status === "done" && entry.finalText
  → lastContext = { operation, domainId: entry.domainId, report: entry.finalText }
  → chatHistory = []
  → showChatSection()

setRunning(op, args)
  → chatSection?.remove()
  → lastContext = null
  → chatHistory = []

[пользователь пишет]
  → controller.chat(lastContext.operation, lastContext.domainId, lastContext.report, chatHistory, text)
  → dispatchChat(domainId, report, chatMessages)
  → runLintChat(..., context, history, operationHeader)
```

## Ручная проверка

1. `ingest` с выбранным доменом → чат появляется после завершения
2. `query` → чат появляется
3. `lint` → чат появляется (поведение не изменилось)
4. Написать сообщение в чат → ответ приходит
5. Запустить новую операцию → чат исчезает, история сбрасывается
6. `ingest` без выбранного домена → чат появляется, `domainId = undefined`
