---
state: approved
review:
  spec_hash: 11f6070cea317228
  last_run: 2026-05-16
  phases:
    structure:
      status: passed
    coverage:
      status: passed
    clarity:
      status: passed
    consistency:
      status: passed
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Fix1/### Корень проблемы и Fix2/### Причина"
      section_hash: "bb908c5875bdfd8c / f876ff1034b676dc"
      text: "Заголовок `### Корень проблемы` встречался дважды. Fix 2 переименован в `### Причина`."
      verdict: fixed
      verdict_at: 2026-05-16
    - id: F-002
      phase: structure
      severity: WARNING
      section: "Fix1/### Изменение и Fix2/### Правка"
      section_hash: "a9bb8c674b23407d / 45bf4869d160f146"
      text: "Заголовок `### Изменение` встречался дважды. Fix 2 переименован в `### Правка`."
      verdict: fixed
      verdict_at: 2026-05-16
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "Fix3/### Новая фаза `runLintFixChat`"
      section_hash: b931795eaa412285
      text: "`vaultTools.listFiles()` и `vaultTools.readAll()` — существующие методы VaultTools (используются в lint.ts, ingest.ts, query.ts)."
      verdict: wontfix
      verdict_at: 2026-05-16
    - id: F-004
      phase: clarity
      severity: INFO
      section: "Fix3/### Новая фаза `runLintFixChat`"
      section_hash: b931795eaa412285
      text: "Сигнатура дополнена типами: `llm: LlmClient, model: string, opts: LlmCallOptions, signal: AbortSignal`."
      verdict: fixed
      verdict_at: 2026-05-16
---

# Lint UX Fixes Design

## Проблемы

1. **Progress не показывает время** после завершения операции — `progressCount` очищается при `state !== "running"`.
2. **Lint Result показывает сырой JSON** — `lint.md` инструктирует LLM вернуть JSON, но код ожидает markdown.
3. **Lint chat не пишет файлы** — `runLintChat` только обсуждает, файлы не изменяет.

---

## Fix 1: Время в Progress после завершения

### Корень проблемы

`updateMetrics()` (`view.ts:817`) — очищает `progressCount` при `state !== "running"`.  
`finish()` устанавливает `state = entry.status` до вызова `updateMetrics()` → время пропадает.

### Изменение

`src/view.ts`, метод `finish()`, после `this.updateMetrics()`:

```ts
const totalDur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
this.progressCount.setText(`${totalDur}s`);
```

Итого: 2 строки.

---

## Fix 2: Lint Result — markdown вместо JSON

### Причина

`prompts/lint.md` строка 3:
```
Верни **JSON** с полем `reasoning` первым, затем `entity_types` и `language_notes`.
```

LLM возвращает JSON → `llmReport` содержит сырой JSON → попадает в `reportParts` → рендерится MarkdownRenderer как plain text.

Поля `entity_types` и `language_notes` из этого JSON **нигде не используются** — `actualizeDomainConfig` делает отдельный LLM-вызов с собственными сообщениями и схемой.

### Правка

`prompts/lint.md`:

```markdown
Ты — рецензент качества wiki-базы знаний домена «{{domain_name}}».
Выявляй: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Верни развёрнутый анализ в формате Markdown.
{{entity_types_block}}
```

`actualizeDomainConfig` не затрагивается — независимый вызов.

---

## Fix 3: Lint chat с записью файлов

### Архитектура

Lint chat превращается в полноценную WikiOperation `"lint-chat"`, проходящую через стандартный `dispatch`-поток (Progress + Result + новый чат-контекст).

### LLM-протокол

Один структурированный вызов через `parseWithRetry`. LLM возвращает:

```json
{
  "summary": "## Исправлено\n- Убраны мёртвые ссылки в X.md\n...",
  "pages": [
    {"path": "Wiki/X.md", "content": "полный контент страницы"},
    {"path": "Wiki/Y.md", "content": "..."}
  ]
}
```

- `pages` → пишутся через `vaultTools.write` → `tool_use`/`tool_result` в Progress
- `summary` → `result.text` → рендерится как markdown в Result
- JSON никогда не виден пользователю

### Промпт `prompts/lint-chat.md`

```markdown
Ты — редактор wiki-базы знаний домена «{{domain_name}}».
Прими задание пользователя и lint-отчёт, исправь указанные проблемы в страницах.

Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"..."}]}
Если правок нет — pages пустой массив, summary — текстовый ответ.

LINT-ОТЧЁТ:
{{lint_report}}

СТРАНИЦЫ ДОМЕНА:
{{pages_block}}
```

### Zod-схема `LintChatSchema`

```ts
const LintChatSchema = z.object({
  summary: z.string(),
  pages: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).default([]),
});
```

### Новая фаза `runLintFixChat` (`src/phases/lint-chat.ts`)

```ts
function runLintFixChat(
  req: RunRequest,
  vaultTools: VaultTools,
  vaultRoot: string,
  domain: DomainEntry | undefined,
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): AsyncGenerator<RunEvent>
```

Поток:
1. Загрузить страницы домена: `vaultTools.listFiles(wikiVaultPath)` → `vaultTools.readAll(files)`
2. Построить messages: system = lint-chat.md с подстановками, user = `[...chatMessages]`
3. `parseWithRetry({ schema: LintChatSchema, ... })`
4. Для каждой страницы из `parsed.pages`:
   - Валидировать: путь внутри `wikiVaultPath`
   - `yield { kind: "tool_use", name: "Write", input: { path } }`
   - `vaultTools.write(path, content)`
   - `yield { kind: "tool_result", ok: true/false }`
5. `yield { kind: "result", text: parsed.summary, ... }`

### Изменения по файлам

| Файл | Изменение |
|---|---|
| `src/types.ts` | `WikiOperation` += `"lint-chat"` |
| `src/types.ts` | `OpKey` не расширяется — `"lint-chat"` не входит в `OpKey` |
| `prompts/lint-chat.md` | Новый файл |
| `src/phases/lint-chat.ts` | Новый файл: `runLintFixChat` |
| `src/phases/zod-schemas.ts` | Добавить `LintChatSchema` |
| `src/agent-runner.ts` | `buildOptsFor`: `"lint-chat"` → маппится в `"lint"` ключ; case `"lint-chat"` → `runLintFixChat` |
| `src/controller.ts` | Новый метод `lintApplyFromChat(domainId, lintReport, chatHistory, newMessage)` → `dispatch("lint-chat", ...)` |
| `src/view.ts` | `showChatSection()`: если `lastContext.operation === "lint"` **или** `"lint-chat"`, submit → `lintApplyFromChat()` вместо `chat()` |

### Timeout и модель

- Timeout: `settings.timeouts.lint` (переиспользуется)
- `buildOptsFor("lint-chat")` → маппится на ключ `"lint"` (как `"query-save"` → `"query"`)

### graphCache

`dispatch("lint-chat", ...)` → в `controller.dispatch()` проверка `mutatesWiki`:
```ts
const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || ...;
```
→ `graphCache.invalidate(domainId)` после завершения.

### UX-поток

```
Lint завершился → Result (отчёт) + чат-секция
Пользователь: "убери мёртвые ссылки в X.md"
[Send] → чат-секция пропадает (setRunning очищает) 
       → Progress: tool_use Write X.md / tool_result ok
Result: "## Исправлено\n- Убраны ссылки в X.md"
Новый чат-контекст (operation=lint-chat) → можно продолжать
```

### Ограничения

- `lint-chat` появляется в History как отдельная запись
- Страницы вне `wikiVaultPath` блокируются (как в `runLint`)
- Mobile: `lint-chat` недоступен (как `lint`)
