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
        QUERY["query"]
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
    INIT -->|"DomainEntry, entity_types, !Wiki/_config/_wiki_schema.md, !Wiki/_config/_format_schema.md"| INGEST
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
| **init** | — | `DomainEntry`, `entity_types`, `!Wiki/_config/_wiki_schema.md`, `!Wiki/_config/_format_schema.md` |
| **ingest** | `DomainEntry`, `_wiki_schema.md` | wiki-страницы, `_index.md` (обновление), `analyzed_sources` |
| **query** | `DomainEntry`, `_index.md`, wiki-страницы | ответ (seeds via similarity/Jaccard → BFS → LLM-subset) |
| **lint** | `DomainEntry`, wiki-страницы | lint-отчёт + исправленные страницы + `domain_updated` (entity_types) |
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
    OP -->|query| PQ["phases/query.ts"]
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

    subgraph vault["vault runtime read (global + per-domain)"]
        V_WIKI["!Wiki/_config/_wiki_schema.md (global)"]
        V_FMT["!Wiki/_config/_format_schema.md (global)"]
        V_IDX["domain/_config/_index.md"]
    end

    BASE["base.md system"]

    BASE --> PI2
    BASE --> PQ2
    BASE --> PL2
    BASE --> PC2
    BASE --> PLC2
    BASE --> PIN2a
    BASE --> PF2
    BASE --> PE2

    PI2["ingest"] --> INGEST["ingest.md"]
    PQ2["query"] --> QUERY["query.md"]
    PL2["lint"] --> LINT["lint.md"]
    PC2["chat"] --> CHAT["chat.md"]
    PLC2["lint-chat"] --> LINTCHAT["lint-chat.md"]
    PIN2a["init file 0"] --> INIT["init.md"]
    PF2["format"] --> FORMAT["format.md"]

    PE2["evaluator"] --> EVAL["evaluator.md"]

    V_WIKI -->|schema_block| PI2
    V_WIKI -->|schema_block| PL2
    V_WIKI -->|schema_block| PLC2
    V_IDX  -->|index_block| PQ2
    V_FMT  -->|format_schema| PF2

    WIKI_SCHEMA -->|schema_block| PIN2a
    FMT_SCHEMA  -->|"written to vault"| V_FMT

    classDef prompt  fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef tmplcls fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef vaultcls fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef base    fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef dev     fill:#585b70,color:#cdd6f4,stroke:#6c7086
    class INGEST,QUERY,LINT,CHAT,LINTCHAT,INIT,FORMAT prompt
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
    PBC -->|"system найден"| PREPEND["base.md + newline + existing system"]
    PBC -->|"system не найден"| INSERT["новый system = base.md"]

    PREPEND --> ISP
    INSERT --> ISP

    ISP{"opts.systemPrompt?"}
    ISP -->|да| INJECT["append Уточнение + systemPrompt"]
    ISP -->|нет| FINAL

    INJECT --> FINAL["финальный messages[]"]

    FINAL --> PARAMS["buildChatParams: добавить model, temperature, maxTokens, jsonMode, thinkingBudget, stream_options"]

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

Все операции с JSON-схемой (`ingest`, `lint`, `lint-chat`, `init`, `query.seeds`, `format`) используют `parseWithRetry` из `phases/parse-with-retry.ts`:

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
    RETRY -->|да| APPEND["append assistant+user feedback → повтор с расширенным контекстом"]
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
| `lint.fix` | `lint.ts` | `LintOutputSchema` |
| `lint.patch` | `lint.ts` (actualizeDomainConfig) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | `lint-chat.ts` | `LintChatSchema` |
| `query.seeds` | `query.ts` (llmSelectSeeds) | `SeedsSchema` |
| `format.output` | `format.ts` | `FormatOutputSchema` |

## Вторичные LLM-вызовы

Некоторые фазы делают более одного LLM-вызова:

### query: seed selection + graph expansion

```
Phase 1: читает _index.md (без файлов wiki)
Phase 2: seed selection из аннотаций индекса (без чтения файлов)
         embedding-режим → loadCache() + selectRelevant() (косинусное сходство)
         jaccard-режим   → selectSeeds() (Jaccard по токенам)
         если seeds == 0 → llmSelectSeeds (parseWithRetry, SeedsSchema)
         если seeds == 0 → error
Phase 3: glob — список всех файлов домена
Phase 4: readAll → все страницы домена → graphCache.get() → BFS от seeds
         только BFS-expanded страницы передаются в контекст LLM (не все)
Phase 5: основной query-вызов (streaming, free text)
```

**Ключевое изменение (2026-05-26):** раньше при нахождении seeds читались только seed-файлы без BFS. Теперь всегда читаются все страницы для построения графа, BFS всегда запускается от seeds. LLM получает только BFS-expanded подмножество — similarity задаёт направление, граф обеспечивает покрытие.

`llmSelectSeeds` вызывается без system-сообщения → `prependBaseContract` добавляет `base.md` как system.

### lint: actualizeDomainConfig

После основного lint-вызова (единый CoT+Structured вызов через `parseWithRetry, LintOutputSchema`) — отдельный вызов `actualizeDomainConfig`:
- анализирует реальный контент wiki vs текущий `entity_types`
- возвращает дельту (`EntityTypesDeltaSchema`)
- эмитирует `domain_updated` — контроллер сохраняет в domain-map

### ingest: entity_types_delta

Если LLM возвращает `entity_types_delta` в ответе:
- `mergeEntityTypes(domain.entity_types, delta)` — merge по ключу `type`
- эмитирует `domain_updated { domainId, patch: { entity_types: merged } }`
- контроллер сохраняет патч; `runInitWithSources` интерцептирует событие для обновления `currentDomain` перед следующим файлом

### ingest: retry invalid paths

При получении страниц с нарушением правила 4 сегментов:
- `retryInvalidPaths` — отдельный `buildChatParams`-вызов (free text)
- передаёт оригинальные messages + ошибку как user-сообщение
- ожидает JSON-массив только для невалидных путей

## Контекст, инжектируемый в каждый промт

| Операция | Промт | Переменные `render()` | Схема ответа |
|---|---|---|---|
| **ingest** | `ingest.md` + `base.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block`, `source_path` | `WikiPagesOutputSchema` `{reasoning, pages[{path,content,annotation?}], entity_types_delta?}` |
| **query** | `query.md` + `base.md` | `domain_name`, `entity_types_block`, `index_block` | free text |
| **lint** | `lint.md` + `base.md` | `domain_name`, `entity_types_block`, `schema_block` | `LintOutputSchema` `{reasoning, report, fixes[{path,content,annotation?}]}` |
| **chat** | `chat.md` + `base.md` | `operation_header`, `context` | free text |
| **lint-chat** | `lint-chat.md` + `base.md` | `domain_name`, `lint_report`, `pages_block`, `schema_block` | `LintChatSchema` `{summary, pages[{path,content,annotation?}]}` |
| **init** file 0 | `init.md` + `base.md` | `domain_id`, `vault_name`, `schema_block`, `index_block` | `DomainEntrySchema` `{reasoning,id,name,wiki_folder,entity_types,language_notes}` |
| **format** | `format.md` + `base.md` | `format_schema`, `has_vision` | `FormatOutputSchema` `{report, formatted}` |
| **evaluator** _(devMode)_ | `base.md` + `evaluator.md` | `operation`, `task_input`, `result` _(user role; base инжектируется как system через buildChatParams)_ | `{score:0-10, reasoning}` |

## Сравнительная таблица промтов

| Промт | Используется в | Задача | Проблемы / противоречия |
|---|---|---|---|
| `base.md` | Все операции (system, prepend через `prependBaseContract`) | Базовый контракт: достоверность, формат, минимализм | Применяется ко ВСЕМ вызовам включая evaluator — `buildChatParams` всегда вставляет `base.md` в system |
| `ingest.md` | `ingest` | Извлечение экземпляров сущностей из источника → wiki-страницы + обогащение `entity_types` через `entity_types_delta?` | — |
| `query.md` | `query` | Ответ на вопрос по wiki-индексу домена | Нет явного ограничения на длину ответа; при большом `index_block` контекст разрастается |
| `lint.md` | `lint` | Единый CoT+Structured вызов: анализ качества wiki + автоисправление страниц в одном ответе | — |
| `lint-chat.md` | `lint-chat` | Интерактивное исправление по lint-отчёту; читает `_wiki_schema.md` → `schema_block` | — |
| `chat.md` | `chat` | Свободный диалог по результатам операции | Не специфичен для домена: нет `entity_types_block`, `schema_block`. Контекст только через `{{context}}` |
| `init.md` | `init`, файл 0 (bootstrap) | Создание полной записи домена (`entity_types`, `wiki_folder`, …) | — |
| `format.md` | `format` | Форматирование произвольной markdown-страницы | Не связан с доменной wiki — намеренно. Дублирует часть правил из `_format_schema.md` |
| `evaluator.md` | `agent-runner`, devMode | Оценка качества результата операции (score 0–10) | Рендерится в роль `user`, но `base.md` применяется как `system` через `buildChatParams`. Вызывается после каждой операции при devMode |
| `_wiki_schema.md` | `init` (bundled), `ingest`/`lint`/`lint-chat` (vault read) | Конвенции wiki-страниц: frontmatter, структура, стиль. Путь: `!Wiki/_config/_wiki_schema.md` (shared by all domains) | Изменения в bundled-шаблоне не попадают в существующие vaults автоматически |
| `_format_schema.md` | `init` (bundled, записывается в vault), `format` (vault read) | Конвенции форматирования не-wiki страниц. Путь: `!Wiki/_config/_format_schema.md` (shared by all domains) | При `init` пишется в vault как дефолт — изменения в `templates/` не обновляют существующие vaults |

## Замечания для архитектурного анализа

### wrapWithJsonFallback — прозрачный retry без json_object

`AgentRunner` оборачивает переданный `LlmClient` в `wrapWithJsonFallback` (`agent-runner.ts:23`): если LLM вернул 400/422 с упоминанием "json_object" / "unsupported", запрос повторяется без `response_format`. Активируется только при `opts.jsonMode === "json_object"`. Позволяет один и тот же код работать с моделями без поддержки structured output.

## PageSimilarityService — выбор релевантных страниц

`PageSimilarityService` (`src/page-similarity.ts`) решает проблему O(N²) загрузки всех wiki-страниц в `runIngest`: вместо передачи всего wiki в контекст LLM выбираются только top-K наиболее релевантных страниц.

### Два режима работы

| Режим | Метод отбора | Требования |
|---|---|---|
| `jaccard` | Jaccard-оценка пересечения токенов source-файла и аннотаций из `_index.md` | — |
| `embedding` | Косинусное сходство векторов через OpenAI-совместимый `/embeddings` endpoint | `embeddingModel`, `embeddingDimensions`, `baseUrl`; API-ключ **опционален** (Ollama не требует) |

В режиме `embedding` при недоступности API автоматически применяется Jaccard как fallback. Запросы к API выполняются батчами по 100 элементов.

### Кэш эмбеддингов

Векторы страниц хранятся в `!Wiki/<domain>/_config/_embeddings.json`. Структура:

```json
{
  "model": "text-embedding-3-small",
  "dimensions": 1536,
  "entries": {
    "<pageId>": { "vector": "<base64 Float32Array>", "hash": "<annotation hash>" }
  }
}
```

Кэш инвалидируется при изменении аннотации страницы (по хэшу контента). При смене модели или числа измерений весь кэш пересоздаётся. `refreshCache` обновляет только устаревшие записи — вызывается в `runIngest` (после записи страниц) и `runLint` (после прохода по домену).

### Подключение к фазам через AgentRunner

`AgentRunner.buildSimilarity()` создаёт единственный экземпляр `PageSimilarityService` на запрос и передаёт его во все фазы:

| Фаза | Использование |
|---|---|
| `ingest` | `loadCache()` + `selectRelevant()` перед формированием контекста; `refreshCache()` после записи страниц |
| `init` | `selectRelevant()` для файлов после первого (ingest-pass) |
| `query` | `loadCache()` + `selectRelevant()` для seed selection (только в `embedding` режиме; иначе Jaccard) |
| `lint` | `refreshCache()` после прохода по домену |
| `format` | не использует similarity |

Сервис активен только при `backend = "native-agent"`. При `backend = "claude-agent"` `buildSimilarity()` возвращает `undefined`, фазы получают весь контент без фильтрации.

### Полный lifecycle эмбеддингов (Mermaid)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a', 'activationBorderColor': '#cba6f7', 'activationBkgColor': '#313244', 'noteBkgColor': '#45475a', 'noteTextColor': '#cdd6f4', 'loopTextColor': '#cdd6f4'}}}%%
sequenceDiagram
    participant AR as AgentRunner
    participant PS as PageSimilarityService
    participant LLM as LLM
    participant API as Embeddings API
    participant FS as _embeddings.json
    participant V as Vault

    rect rgb(30, 80, 140)
        Note over AR,V: ── INGEST ──
        AR->>V: read source + _wiki_schema.md + _index.md
        AR->>V: listFiles(wikiVaultPath) → existingPaths
        alt similarity включена (jaccard или embedding)
            AR->>PS: loadCache(domainRoot, vaultTools)
            PS->>FS: read _embeddings.json → this.cache
            AR->>PS: selectRelevant(sourceContent, annotations, existingPaths)
            note over PS: jaccard: scoreSeed по токенам<br/>embedding: fetchEmbeddings + cosine
            PS-->>AR: seedPaths (top-K)
            AR->>V: readAll(nonMetaPaths) → allPages
            AR->>AR: graphCache.get(domainId, allPages) → graph
            AR->>AR: bfsExpand(seedIds, graph, graphDepth) → expandedIds
            AR->>AR: existingPages = allPages.filter(expandedIds)
            AR->>AR: emit info_text (📋/🔍 expanded/total, bfs depth N)
        else similarity отключена
            AR->>V: readAll(nonMetaPaths) → existingPages (все)
        end
        AR->>LLM: parseWithRetry(WikiPagesOutputSchema)<br/>source + existingPages + schema + index
        LLM-->>AR: pages[] + entity_types_delta?
        loop pages[]
            AR->>V: write(page.path, page.content)
            AR->>V: upsertIndexAnnotation(_index.md)
        end
        AR->>AR: entity_types_delta → domain_updated
        AR->>V: backlink sync (frontmatter source file)
        alt similarity && written > 0
            AR->>PS: refreshCache(domainRoot, vaultTools, updatedAnnotations)
            PS->>FS: read _embeddings.json
            loop stale / новые записи
                PS->>API: fetchEmbeddings(annotations) batch≤100
                API-->>PS: векторы
            end
            PS->>FS: write _embeddings.json
        end
    end

    rect rgb(30, 120, 70)
        Note over AR,V: ── QUERY ──
        AR->>V: read _index.md → indexAnnotations
        alt embedding-режим
            AR->>PS: loadCache(wikiVaultPath, vaultTools)
            PS->>FS: read _embeddings.json → this.cache
            AR->>PS: selectRelevant(question, annotations, annotatedPaths)
            PS->>API: fetchEmbeddings([question[:2000]]) → queryVec
            loop страницы без вектора в кэше
                PS->>API: fetchEmbeddings([annotation]) batch≤100
                API-->>PS: pageVec
            end
            PS->>PS: cosine(queryVec, pageVec) → top-K
            PS-->>AR: seeds[]
        else jaccard / нет similarity
            AR->>AR: selectSeeds(question, syntheticPages, topK, minScore)
            AR-->>AR: seeds[]
        end
        alt seeds == 0
            AR->>LLM: llmSelectSeeds(question, indexAnnotations, allIds)
            LLM-->>AR: seeds[] (SeedsSchema)
        end
        AR->>V: listFiles + readAll(allWikiFiles)
        AR->>AR: graphCache.get(domainId, pages) → graph
        AR->>AR: bfsExpand(seeds, graph, graphDepth) → selectedIds
        AR->>AR: buildContextBlock(pages, seeds, selectedIds)<br/>LLM получает только expanded subset
        AR->>LLM: query prompt (streaming)
        LLM-->>AR: answer
    end

    rect rgb(150, 80, 30)
        Note over AR,V: ── LINT ──
        AR->>V: listFiles + readAll(allWikiFiles) → pages
        AR->>AR: graphCache.get() + checkStructure + checkGraphStructure
        AR->>LLM: parseWithRetry(LintOutputSchema)<br/>pages + schema + entity_types
        LLM-->>AR: report + fixes[]
        AR->>LLM: actualizeDomainConfig → EntityTypesDeltaSchema
        LLM-->>AR: entity_types patch → domain_updated
        loop fixes[]
            AR->>V: write(page.path, page.content)
            AR->>V: upsertIndexAnnotation(_index.md)
        end
        AR->>V: backlink sync (raw source files)
        alt similarity включена
            AR->>PS: refreshCache(wikiVaultPath, vaultTools, updatedAnnotations)
            PS->>FS: read _embeddings.json
            loop stale записи
                PS->>API: fetchEmbeddings(annotations) batch≤100
                API-->>PS: векторы
            end
            PS->>FS: write _embeddings.json
        end
    end
```

**Ключевые свойства:**
- `PageSimilarityService` ephemeral — создаётся заново на каждый `run()`. `loadCache()` восстанавливает диск-кэш в `this.cache` до вызова `selectRelevant()`, иначе каждый ingest делал бы API-запросы для всех страниц.
- `refreshCache()` вызывается в ingest (после записи страниц) и lint (после прохода). Пишет на диск только при наличии stale entries — no-op если аннотации не менялись.
- **`apiKey` опционален**: guard проверяет только `baseUrl` и `model`. Ollama и другие локальные серверы работают без ключа.
- API-недоступность → автоматический fallback на Jaccard (и в `selectEmbedding`, и в `refreshCache`).
- Инвалидация по хэшу аннотации: вектор пересчитывается только при изменении текста аннотации страницы в `_index.md`.

### Прогресс-шаг выбора страниц

После `selectRelevant()` фаза `ingest` эмитирует событие `info_text` (тип `RunEvent`):

```typescript
{ kind: "info_text", icon: "🔍" | "📋", summary: "N/M wiki-pages loaded (mode)", details: string[] }
```

`view.ts` рендерит его как отдельный step-item с иконкой и списком entity-names (значений `pageId(path)` для каждого выбранного файла). Иконка: `🔍` для embedding-режима, `📋` для jaccard.

### Настройки (`LocalConfig.nativeAgent`)

| Поле | Тип | Назначение |
|---|---|---|
| `embeddingModel` | `string?` | Модель эмбеддингов. `undefined` = jaccard; `""` (пустая строка) = режим включён, модель не задана → jaccard до ввода имени; непустая строка = embedding-режим |
| `embeddingDimensions` | `number?` | Число измерений; обязательно при `embeddingModel` |
| `relevantPagesTopK` | `number?` | Максимум страниц в контексте (default: 15) |

**Поведение UI-тоггла "Enable semantic similarity":**
- Toggle OFF → `embeddingModel: undefined, embeddingDimensions: undefined`. Поля модели скрыты.
- Toggle ON → `embeddingModel: ""` (sentinel). Поля "Embedding model" и "Embedding dimensions" появляются. Режим остаётся jaccard до ввода имени модели.

**Кнопка ↻ "Fetch available models"** (рядом с полями Model и Embedding model):
- Вызывает `GET {baseUrl}/models` с заголовком `Authorization: Bearer {apiKey}` (пустой для Ollama).
- Ответ: `{ data: [{ id: string }] }` — стандарт OpenAI-compatible.
- Поле **Model** (LLM): показывает все модели в dropdown.
- Поле **Embedding model**: фильтрует по `/embed/i` — показывает только embedding-модели.
- Список сбрасывается при `display()` (перезаходе в настройки) — нужно нажать ↻ снова.
- Доступна только для `native-agent` backend (Claude agent — без кнопки).

Поля хранятся в `local.json` (не синхронизируются между устройствами).
