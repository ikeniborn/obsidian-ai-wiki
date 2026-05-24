# Prompt Architecture

Схема использования промтов и шаблонов по операциям.

## Последовательность операций и зависимости

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    NEW["Новый домен / vault"]
    PAGE["Произвольная страница"]

    subgraph s1["1) Настройка домена"]
        INIT["init"]
    end

    subgraph s2["2) Наполнение вики"]
        INGEST["ingest"]
    end

    subgraph s3["3) Работа с вики"]
        QUERY["query / query-save"]
        LINT["lint"]
    end

    subgraph s4["4) Итеративное исправление"]
        LINTCHAT["lint-chat"]
    end

    subgraph s5["Диалог по результату"]
        CHAT["chat"]
    end

    subgraph s6["Standalone"]
        FORMAT["format"]
    end

    NEW --> INIT
    INIT -->|"DomainEntry, entity_types, _wiki_schema.md, _format_schema.md"| INGEST
    INGEST -->|"wiki pages, _index.md"| QUERY
    INGEST -->|"wiki pages"| LINT
    LINT -->|"lint report"| LINTCHAT
    LINTCHAT -->|"fixed pages"| LINT

    INGEST -.->|"result as context"| CHAT
    QUERY  -.->|"result as context"| CHAT
    LINT   -.->|"result as context"| CHAT

    PAGE --> FORMAT

    classDef setup   fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef fill_op fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef use_op  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef fix_op  fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    classDef dialog  fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef solo    fill:#585b70,color:#cdd6f4,stroke:#6c7086
    classDef input   fill:#313244,color:#cdd6f4,stroke:#6c7086,stroke-dasharray:4 2

    class INIT setup
    class INGEST fill_op
    class QUERY,LINT use_op
    class LINTCHAT fix_op
    class CHAT dialog
    class FORMAT solo
    class NEW,PAGE input
```

**Сплошные стрелки** — жёсткая зависимость (операция не запустится без артефакта-источника).  
**Пунктирные стрелки** — мягкая зависимость (chat берёт `context` из последнего результата; технически запустится без него, но бесполезен).

| Операция | Требует | Производит |
|---|---|---|
| **init** | — | `DomainEntry`, `entity_types`, `_wiki_schema.md`, `_format_schema.md` |
| **ingest** | `DomainEntry`, `_wiki_schema.md` | wiki-страницы, `_index.md` (обновление), `analyzed_sources` |
| **query / query-save** | `DomainEntry`, `_index.md`, wiki-страницы | ответ / `Q-*.md` |
| **lint** | `DomainEntry`, wiki-страницы | lint-отчёт + `domain_updated` (entity_types) |
| **lint-chat** | `DomainEntry`, lint-отчёт, wiki-страницы | исправленные wiki-страницы |
| **chat** | результат любой предыдущей операции | диалог |
| **format** | произвольная страница, `_format_schema.md` | отформатированная страница |

## Routing: операция → фаза

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    UI["Команда Obsidian / UI"]
    UI --> AR["AgentRunner.run"]
    AR --> OP{"operation"}

    OP -->|ingest| PI["phases/ingest.ts"]
    OP -->|"query / query-save"| PQ["phases/query.ts"]
    OP -->|lint| PL["phases/lint.ts"]
    OP -->|chat| PC["phases/chat.ts"]
    OP -->|lint-chat| PLC["phases/lint-chat.ts"]
    OP -->|init| PIN["phases/init.ts"]
    OP -->|format| PF["phases/format.ts"]

    AR -->|devMode| PE["phases/evaluator.ts"]

    classDef phase fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dev   fill:#585b70,color:#cdd6f4,stroke:#6c7086
    class PI,PQ,PL,PC,PLC,PIN,PF phase
    class PE dev
```

## Промты по фазам

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart LR
    subgraph tmpl["templates/ bundled"]
        WIKI_SCHEMA["_wiki_schema.md"]
        FMT_SCHEMA["_format_schema.md"]
    end

    subgraph vault["vault runtime read"]
        V_WIKI[".config/_wiki_schema.md"]
        V_FMT[".config/_format_schema.md"]
        V_IDX["_index.md"]
    end

    BASE["base.md system"]

    BASE --> PI2
    BASE --> PQ2
    BASE --> PL2
    BASE --> PC2
    BASE --> PLC2
    BASE --> PIN2a
    BASE --> PIN2b
    BASE --> PF2
    BASE --> PE2

    PI2["ingest"] --> INGEST["ingest.md"]
    PQ2["query"] --> QUERY["query.md"]
    PL2["lint"] --> LINT["lint.md"]
    PC2["chat"] --> CHAT["chat.md"]
    PLC2["lint-chat"] --> LINTCHAT["lint-chat.md"]
    PIN2a["init file 0"] --> INIT["init.md"]
    PIN2b["init files 1+"] --> INITINC["init-incremental.md"]
    PF2["format"] --> FORMAT["format.md"]

    PE2["evaluator"] --> EVAL["evaluator.md"]

    V_WIKI -->|schema_block| PI2
    V_WIKI -->|schema_block| PQ2
    V_IDX  -->|index_block| PQ2
    V_FMT  -->|format_schema| PF2

    WIKI_SCHEMA -->|schema_block| PIN2a
    FMT_SCHEMA  -->|"written to vault"| V_FMT

    classDef prompt  fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef tmplcls fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef vaultcls fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef base    fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef dev     fill:#585b70,color:#cdd6f4,stroke:#6c7086
    class INGEST,QUERY,LINT,CHAT,LINTCHAT,INIT,INITINC,FORMAT prompt
    class WIKI_SCHEMA,FMT_SCHEMA tmplcls
    class V_WIKI,V_FMT,V_IDX vaultcls
    class BASE base
    class PE2,EVAL dev
```

**Примечание:** `evaluator.md` рендерится в роль `user`, но `base.md` всё равно инжектируется как `system` через `buildChatParams → prependBaseContract` (см. ниже).

## buildChatParams: сборка сообщений

Каждый вызов LLM идёт через `buildChatParams` → формирует финальный массив `messages`:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    MSGS["messages от фазы"]

    MSGS --> PBC["prependBaseContract"]
    PBC -->|"system найден"| PREPEND["base.md + '\n\n' + existing system"]
    PBC -->|"system не найден"| INSERT["новый system = base.md"]

    PREPEND --> ISP
    INSERT --> ISP

    ISP{"opts.systemPrompt?"}
    ISP -->|да| INJECT["append '## Уточнение\n' + systemPrompt"]
    ISP -->|нет| FINAL

    INJECT --> FINAL["финальный messages[]"]

    FINAL --> PARAMS["buildChatParams: добавить model, temperature,\nmaxTokens, jsonMode, thinkingBudget,\nstream_options"]

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef out  fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    class PBC,PREPEND,INSERT,INJECT step
    class ISP dec
    class FINAL,PARAMS out
```

| Опция `LlmCallOptions` | Поведение |
|---|---|
| `systemPrompt` | Добавляет секцию `## Уточнение` в конец system-сообщения |
| `jsonMode: "json_object"` | Устанавливает `response_format: { type: "json_object" }`. Автоматически снимается при `thinkingBudgetTokens > 0`. Fallback: при ошибке 400/422 с ключевыми словами "json_object" / "unsupported" — retry без `response_format` (`wrapWithJsonFallback`) |
| `thinkingBudgetTokens` | Включает thinking-режим модели; снимает `response_format`, `temperature`, `top_p` |
| `temperature`, `maxTokens`, `topP` | Прямая передача в API |
| `structuredRetries` | Число retry в `parseWithRetry` (default 1) |

## parseWithRetry: структурированный вывод с ретраем

Все операции с JSON-схемой (`ingest`, `lint`, `init`, `query.seeds`, `format`) используют `parseWithRetry` из `phases/parse-with-retry.ts`:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    START["parseWithRetry(baseMessages, schema, maxRetries)"]
    START --> CALL["streamOnce → fullText"]
    CALL --> PARSE{"parseStructured"}
    PARSE -->|"invalid JSON"| ERR_JSON["emit structural_error json_parse"]
    PARSE -->|OK| ZOD{"schema.safeParse"}
    ZOD -->|success| RETURN["return value"]
    ZOD -->|fail| ERR_ZOD["emit structural_error schema_validate"]
    ERR_JSON --> RETRY{"attempt < maxRetries?"}
    ERR_ZOD --> RETRY
    RETRY -->|да| APPEND["append assistant+user feedback\n→ повтор с расширенным контекстом"]
    RETRY -->|нет| THROW["throw StructuredValidationError"]
    APPEND --> CALL

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef err  fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    class CALL,APPEND step
    class PARSE,ZOD,RETRY dec
    class RETURN ok
    class ERR_JSON,ERR_ZOD,THROW err
```

При retry — предыдущий ответ LLM добавляется как `assistant`, а текст ошибки Zod как `user`. LLM видит свою ошибку и исправляет структуру.

Точки вызова (`CallSite`):

| callSite | Фаза | Схема |
|---|---|---|
| `ingest.pages` | `ingest.ts` | `WikiPagesOutputSchema` |
| `init.bootstrap` | `init.ts` file 0 | `DomainEntrySchema` |
| `init.delta` | `init.ts` files 1+ | `EntityTypesDeltaSchema` |
| `lint.fix` | `lint.ts` | `LintOutputSchema` |
| `lint.patch` | `lint.ts` (actualizeDomainConfig) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | `lint-chat.ts` | `LintChatSchema` |
| `query.seeds` | `query.ts` (llmSelectSeeds) | `SeedsSchema` |
| `format.output` | `format.ts` | `FormatOutputSchema` |

## Вторичные LLM-вызовы

Некоторые фазы делают более одного LLM-вызова:

### query: seed selection

```
Phase 1: читает _index.md (без файлов wiki)
Phase 2: selectSeeds — Jaccard по токенам (без LLM)
         если seeds == 0 → llmSelectSeeds (parseWithRetry, SeedsSchema)
Phase 3: читает только файлы-семена + BFS-расширение
Phase 4: основной query-вызов (streaming, free text)
```

`llmSelectSeeds` вызывается без system-сообщения → `prependBaseContract` добавляет `base.md` как system.

### lint: actualizeDomainConfig

После основного lint-вызова — отдельный вызов `actualizeDomainConfig`:
- анализирует реальный контент wiki vs текущий `entity_types`
- возвращает дельту (`EntityTypesDeltaSchema`)
- эмитирует `domain_updated` — контроллер сохраняет в domain-map

### ingest: retry invalid paths

При получении страниц с нарушением правила 4 сегментов:
- `retryInvalidPaths` — отдельный `buildChatParams`-вызов (free text)
- передаёт оригинальные messages + ошибку как user-сообщение
- ожидает JSON-массив только для невалидных путей

## Контекст, инжектируемый в каждый промт

| Операция | Промт | Переменные `render()` | Схема ответа |
|---|---|---|---|
| **ingest** | `ingest.md` + `base.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block`, `source_path` | `WikiPagesOutputSchema` `{reasoning, pages[{path,content,annotation}]}` |
| **query** | `query.md` + `base.md` | `domain_name`, `entity_types_block`, `schema_block`, `index_block` | free text |
| **lint** | `lint.md` + `base.md` | `domain_name`, `entity_types_block` | `LintOutputSchema` `{reasoning, report, fixes[]}` |
| **chat** | `chat.md` + `base.md` | `operation_header`, `context` | free text |
| **lint-chat** | `lint-chat.md` + `base.md` | `domain_name`, `lint_report`, `pages_block` | `LintChatSchema` `{summary, pages[{path,content,annotation?}]}` |
| **init** file 0 | `init.md` + `base.md` | `domain_id`, `vault_name`, `schema_block`, `index_block` | `DomainEntrySchema` `{reasoning,id,name,wiki_folder,entity_types,language_notes}` |
| **init** files 1…N | `init-incremental.md` + `base.md` | _(нет переменных — render не нужен)_ | `EntityTypesDeltaSchema` `{reasoning, entity_types?, language_notes?}` |
| **format** | `format.md` + `base.md` | `format_schema`, `has_vision` | `FormatOutputSchema` `{report, formatted}` |
| **evaluator** _(devMode)_ | `base.md` + `evaluator.md` | `operation`, `task_input`, `result` _(user role; base инжектируется как system через buildChatParams)_ | `{score:0-10, reasoning}` |

## Сравнительная таблица промтов

| Промт | Используется в | Задача | Проблемы / противоречия |
|---|---|---|---|
| `base.md` | Все операции (system, prepend через `prependBaseContract`) | Базовый контракт: достоверность, формат, минимализм | Применяется ко ВСЕМ вызовам включая evaluator — `buildChatParams` всегда вставляет `base.md` в system |
| `ingest.md` | `ingest` | Извлечение экземпляров сущностей из источника → wiki-страницы | Не обогащает `entity_types` при обнаружении новых типов. Нужен отдельный `init`. Потенциальное слияние с `init-incremental.md` |
| `query.md` | `query`, `query-save` | Ответ на вопрос по wiki-индексу домена | Нет явного ограничения на длину ответа; при большом `index_block` контекст разрастается |
| `lint.md` | `lint` | Анализ качества wiki + автоисправление страниц | Не получает `schema_block` — LLM не видит конвенции `_wiki_schema.md` при проверке |
| `lint-chat.md` | `lint-chat` | Интерактивное исправление по lint-отчёту | Схема ответа не включала `annotation` — код (`lint-chat.ts`) ждал его, но LLM не возвращал. **Исправлено.** |
| `chat.md` | `chat` | Свободный диалог по результатам операции | Не специфичен для домена: нет `entity_types_block`, `schema_block`. Контекст только через `{{context}}` |
| `init.md` | `init`, файл 0 (bootstrap) | Создание полной записи домена (`entity_types`, `wiki_folder`, …) | В примере `wiki_folder` показывал `"{{domain_id}}"` вместо корректного формата. **Исправлено.** |
| `init-incremental.md` | `init`, файлы 1…N (delta) | Обнаружение новых типов сущностей в домене | Не содержит `{{переменных}}` — `render()` не нужен. Задача пересекается с потребностью `ingest` обогащать `entity_types` |
| `format.md` | `format` | Форматирование произвольной markdown-страницы | Не связан с доменной wiki — намеренно. Дублирует часть правил из `_format_schema.md` |
| `evaluator.md` | `agent-runner`, devMode | Оценка качества результата операции (score 0–10) | Рендерится в роль `user`, но `base.md` применяется как `system` через `buildChatParams`. Вызывается после каждой операции при devMode |
| `_wiki_schema.md` | `init` (bundled), `ingest`/`query` (vault read) | Конвенции wiki-страниц: frontmatter, структура, стиль | Изменения в bundled-шаблоне не попадают в существующие vaults автоматически |
| `_format_schema.md` | `init` (bundled, записывается в vault), `format` (vault read) | Конвенции форматирования не-wiki страниц | При `init` пишется в vault как дефолт — изменения в `templates/` не обновляют существующие vaults |

## Замечания для архитектурного анализа

### init-incremental vs ingest — потенциальное слияние

`init-incremental.md` обнаруживает **типы** сущностей (мета-уровень).  
`ingest.md` извлекает **экземпляры** по известным типам (объектный уровень).

Сейчас два прохода: `init` строит `entity_types`, `ingest` пишет страницы.

**Идея:** дать `ingest` возможность обогащать `entity_types` инкрементально:
1. Добавить `entity_types_delta?` в `WikiPagesOutputSchema`
2. Обновить `ingest.md` — попросить LLM возвращать дельту при новых типах
3. Прокинуть сохранение домена в `ingest.ts` (сейчас `DomainStore` недоступен из фазы)

### lint.md — не получает schema_block

В отличие от `ingest` и `query`, `lint.ts` не читает `.config/_wiki_schema.md` и не передаёт `schema_block` в промт. LLM проверяет wiki без знания конвенций.

### init-incremental.md — не содержит переменных render()

Шаблон не имеет `{{...}}` заполнителей — изменение поведения через `render()` невозможно без добавления переменных в шаблон.

### evaluator + base.md — не изолирован

Старый комментарий "base.md не применяется к evaluator" — неверен. `buildChatParams` вызывается в `evaluator.ts` с messages без system-сообщения, поэтому `prependBaseContract` создаёт `system = base.md`. `evaluator.md` при этом идёт в `user` роль — это уникально, но base.md всё равно присутствует в запросе.

### wrapWithJsonFallback — прозрачный retry без json_object

`AgentRunner` оборачивает переданный `LlmClient` в `wrapWithJsonFallback` (`agent-runner.ts:23`): если LLM вернул 400/422 с упоминанием "json_object" / "unsupported", запрос повторяется без `response_format`. Активируется только при `opts.jsonMode === "json_object"`. Позволяет один и тот же код работать с моделями без поддержки structured output.
