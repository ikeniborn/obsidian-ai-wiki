# Dev Mode: управление промтами и оценка качества

**Дата**: 2026-05-04  
**Статус**: утверждён

---

## Цель

Создать инфраструктуру для анализа и оптимизации системных промтов агента:

1. Вынести промты из TypeScript-кода в текстовые Markdown-шаблоны (`prompts/*.md`)
2. Исправить поведение глобального "уточняющего промта" в настройках
3. Добавить подраздел "Разработка" в настройки с dev-логгером и evaluator-фазой

Результат — JSONL-логи с промтами, входными данными, результатами и оценками, пригодные для offline-оптимизации через DSPy.

---

## 1. Промт-шаблоны

### Расположение

```
prompts/
  ingest.md
  query.md
  lint.md
  chat.md
  fix.md
  init.md
  evaluator.md
```

Файлы находятся в корне репозитория (не в `src/`), чтобы быть доступными для анализа и редактирования отдельно от кода.

### Синтаксис шаблонов

Плейсхолдеры вида `{{variable_name}}`. Неизвестные плейсхолдеры остаются как есть (не бросают ошибку).

```markdown
Ты — ассистент синтеза wiki-знаний для домена «{{domain_name}}».
Извлекай сущности из источника и создавай/обновляй wiki-страницы.

{{entity_types_block}}

ПРАВИЛА:
...
```

### Переменные по файлам

| Файл | Переменные |
|---|---|
| `ingest.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `schema`, `today` |
| `query.md` | `domain_name`, `entity_types_block`, `schema_block`, `index_block` |
| `lint.md` | `domain_name`, `entity_types_block` |
| `chat.md` | `domain_name` |
| `fix.md` | `domain_name`, `instruction` |
| `init.md` | `domain_name`, `vault_name` |
| `evaluator.md` | `operation`, `task_input`, `result` |

### esbuild-интеграция

В `esbuild.config.mjs` добавляется inline-плагин, который перехватывает импорты `*.md` из `prompts/` и возвращает содержимое файла как строку:

```js
{
  name: "md-loader",
  setup(build) {
    build.onLoad({ filter: /\.md$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(await fs.readFile(args.path, "utf8"))}`,
      loader: "js",
    }));
  }
}
```

### `src/phases/template.ts`

Единственная экспортируемая функция:

```ts
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
```

### Изменения в фазах

Функции `buildIngestMessages()`, `buildQuerySystemPrompt()` и аналоги перестают конкатенировать строки — вместо этого вызывают `render(INGEST_TEMPLATE, { domain_name: ..., ... })`. Сами шаблонные строки импортируются из `prompts/*.md`.

---

## 2. Уточняющий промт

### Текущая проблема

`DEFAULT_SETTINGS.systemPrompt` содержит `"You are a wiki assistant... Use only the provided sources."` — это создаёт конфликты:

- Язык (английский) vs. фазовые промты (русский)
- "Use only provided sources" конфликтует с задачей `ingest`, который создаёт контент
- `injectSystemPrompt()` **предшествует** фазовому промту — пользовательский текст перебивает специализированную инструкцию

### Решение

1. Дефолтное значение `systemPrompt` → пустая строка `""`
2. Название поля в UI: "Уточняющий промт" (было "System prompt")
3. Описание: "Добавляется в конец системного промта каждой операции. Используйте для уточнения стиля, языка или специфики проекта."
4. `injectSystemPrompt()` изменяет порядок: `existing + "\n\n" + userPrompt` (было `userPrompt + "\n\n" + existing`)
5. Если `userPrompt` пуст — функция не добавляет ничего (поведение без изменений)

---

## 3. Dev Mode — настройки

### Структура

```ts
interface DevModeSettings {
  enabled: boolean;       // включить dev-логгер и evaluator
  logPath: string;        // путь к JSONL-файлу
  evaluatorModel: string; // имя модели (тот же backend)
}
```

Добавляется в `LlmWikiPluginSettings`:

```ts
devMode: {
  enabled: false,
  logPath: "",
  evaluatorModel: "sonnet",
}
```

### UI подраздел "Разработка"

Отображается в конце страницы настроек. Три поля:

- **Dev режим** — toggle, включает логгер и evaluator
- **Путь к лог-файлу** — текстовое поле, placeholder `/tmp/llm-wiki-dev.jsonl`
- **Модель оценщика** — текстовое поле, placeholder `sonnet`

---

## 4. Dev Logger

### Когда пишет

При `devMode.enabled === true` и непустом `logPath`: одна строка JSONL после завершения каждой операции (до evaluator-шага).

`system_prompt` в логе — **финальный** промт (после добавления уточняющего промта пользователя), то есть именно то, что получила модель.

### Формат

```jsonl
{
  "ts": "2026-05-04T10:00:00.000Z",
  "operation": "ingest",
  "model": "haiku",
  "system_prompt": "Ты — ассистент синтеза wiki-знаний...",
  "user_message": "Домен: ии\nИсточник: ...",
  "result": "Источник «file.md» → домен «ии»: записано 3 стр.",
  "duration_ms": 4210,
  "eval": null
}
```

После evaluator-шага `"eval"` обновляется:

```json
"eval": { "score": 8, "reasoning": "Корректно извлечены 3 сущности, формат frontmatter соответствует схеме." }
```

### DSPy-совместимость

Поля напрямую маппируются на DSPy-пример:
- `input` = `{ system_prompt, user_message }`
- `output` = `{ result }`
- `metric` = `eval.score`

---

## 5. Evaluator

### Триггер

После завершения основной операции в `AgentRunner.run()`, если `devMode.enabled` и `evaluatorModel` задан.

### LLM-вызов

- Клиент: тот же `llm` (backend не меняется)
- Модель: `devMode.evaluatorModel`
- Промт: `evaluator.md` с переменными `{{operation}}`, `{{task_input}}`, `{{result}}`
- Режим: не стримится (один запрос без streaming)
- Ожидаемый формат ответа: `{ "score": 0-10, "reasoning": "..." }`

### Промт `evaluator.md` (начальный вариант)

```markdown
Ты — оценщик качества работы wiki-агента. Оцени результат операции.

Операция: {{operation}}

Входное задание:
{{task_input}}

Результат:
{{result}}

Верни JSON строго в формате:
{"score": <0-10>, "reasoning": "<одно предложение>"}

Критерии оценки:
- 9-10: результат полностью соответствует заданию, без ошибок
- 7-8: результат корректен, есть незначительные недочёты
- 5-6: задание выполнено частично
- 0-4: результат не соответствует заданию или содержит ошибки
```

### Отображение в боковой панели

После evaluator-шага в панели появляется строка:

```
[eval: 8/10] Корректно извлечены 3 сущности, формат frontmatter соответствует схеме.
```

Отображается только при `devMode.enabled`. Реализуется через новый тип события `{ kind: "eval_result", score: number, reasoning: string }` в `RunEvent`.

---

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `prompts/*.md` | **новые файлы** — 7 шаблонов |
| `esbuild.config.mjs` | добавить md-loader плагин |
| `src/phases/template.ts` | **новый файл** — функция `render()` |
| `src/phases/ingest.ts` | заменить `buildIngestMessages()` на `render()` |
| `src/phases/query.ts` | заменить `buildQuerySystemPrompt()` на `render()` |
| `src/phases/lint.ts` | заменить build-функцию на `render()` |
| `src/phases/chat.ts` | заменить на `render()` |
| `src/phases/fix.ts` | заменить на `render()` |
| `src/phases/init.ts` | заменить на `render()` |
| `src/phases/evaluator.ts` | **новый файл** — `runEvaluator()` |
| `src/phases/llm-utils.ts` | исправить порядок в `injectSystemPrompt()` |
| `src/types.ts` | добавить `DevModeSettings`, `eval_result` в `RunEvent`, `devMode` в `LlmWikiPluginSettings` |
| `src/settings.ts` | добавить UI подраздел "Разработка" |
| `src/agent-runner.ts` | вызывать `runEvaluator()` после операции при dev mode |
| `src/view.ts` | рендерить `eval_result` событие |

---

## Порядок реализации

1. Промт-шаблоны: создать `prompts/*.md` + esbuild-плагин + `template.ts` + рефактор фаз
2. Уточняющий промт: исправить дефолт, порядок инжекции, UI-текст
3. Dev mode: добавить типы, настройки, UI подраздел
4. Dev logger: JSONL-запись в `agent-runner.ts`
5. Evaluator: `evaluator.ts` + интеграция в `agent-runner.ts` + рендер в `view.ts`
