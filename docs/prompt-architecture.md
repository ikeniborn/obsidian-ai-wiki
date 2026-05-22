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
| **lint** | `DomainEntry`, wiki-страницы | lint-отчёт |
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

    PI2["ingest"] --> INGEST["ingest.md"]
    PQ2["query"] --> QUERY["query.md"]
    PL2["lint"] --> LINT["lint.md"]
    PC2["chat"] --> CHAT["chat.md"]
    PLC2["lint-chat"] --> LINTCHAT["lint-chat.md"]
    PIN2a["init file 0"] --> INIT["init.md"]
    PIN2b["init files 1+"] --> INITINC["init-incremental.md"]
    PF2["format"] --> FORMAT["format.md"]

    PE2["evaluator user role"] --> EVAL["evaluator.md"]

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

## Контекст, инжектируемый в каждый промт

| Операция | Промт | Переменные `render()` | Схема ответа |
|---|---|---|---|
| **ingest** | `ingest.md` + `base.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block`, `source_path` | `WikiPagesOutputSchema` `{reasoning, pages[{path,content,annotation}]}` |
| **query** | `query.md` + `base.md` | `domain_name`, `entity_types_block`, `schema_block`, `index_block` | free text |
| **lint** | `lint.md` + `base.md` | `domain_name`, `entity_types_block` | `LintOutputSchema` `{reasoning, report, fixes[]}` |
| **chat** | `chat.md` + `base.md` | `operation_header`, `context` | free text |
| **lint-chat** | `lint-chat.md` + `base.md` | `domain_name`, `lint_report`, `pages_block` | `LintChatSchema` `{summary, pages[{path,content,annotation?}]}` |
| **init** file 0 | `init.md` + `base.md` | `domain_id`, `vault_name`, `schema_block`, `index_block` | `DomainEntrySchema` `{reasoning,id,name,wiki_folder,entity_types,language_notes}` |
| **init** files 1…N | `init-incremental.md` + `base.md` | _(нет render — сырой текст)_ | `EntityTypesDeltaSchema` `{reasoning, entity_types?, language_notes?}` |
| **format** | `format.md` + `base.md` | `format_schema`, `has_vision` | `FormatOutputSchema` `{report, formatted}` |
| **evaluator** _(devMode)_ | `evaluator.md` | `operation`, `task_input`, `result` _(user role, base не применяется)_ | `{score:0-10, reasoning}` |

## Сравнительная таблица промтов

| Промт | Используется в | Задача | Проблемы / противоречия |
|---|---|---|---|
| `base.md` | Все операции (system, prepend) | Базовый контракт: достоверность, формат, минимализм | Не применяется к `evaluator` — его роль `user`. Исключение намеренное, но нигде не задокументировано |
| `ingest.md` | `ingest` | Извлечение экземпляров сущностей из источника → wiki-страницы | Не обогащает `entity_types` при обнаружении новых типов. Приходится запускать `init` заново. Потенциальное слияние с логикой `init-incremental.md` |
| `query.md` | `query`, `query-save` | Ответ на вопрос по wiki-индексу домена | Нет явного ограничения на длину ответа; при большом `index_block` контекст разрастается неконтролируемо |
| `lint.md` | `lint` | Анализ качества wiki + автоисправление страниц | Не получает `schema_block` — LLM не видит конвенции `_wiki_schema.md` при проверке. `lint.ts` добавляет JSON-пример динамически в коде (`buildRetrySystemPrompt`), а не в промте — разрыв между промтом и поведением |
| `lint-chat.md` | `lint-chat` | Интерактивное исправление по lint-отчёту | Схема ответа не включала `annotation` — код (`lint-chat.ts:87`) ждал его, но LLM не возвращал. **Исправлено.** |
| `chat.md` | `chat` | Свободный диалог по результатам операции | Промт не специфичен для домена — не получает `entity_types_block` и `schema_block`. Контекст только через `{{context}}` (результат предыдущей операции) |
| `init.md` | `init`, файл 0 (bootstrap) | Создание полной записи домена (`entity_types`, `wiki_folder`, …) | В примере `wiki_folder` показывал `"{{domain_id}}"` вместо корректного формата. **Исправлено.** Секция "Wiki Page Conventions" дублировала содержимое `init-incremental.md` с незначительными расхождениями. **Синхронизировано.** |
| `init-incremental.md` | `init`, файлы 1…N (delta) | Обнаружение новых типов сущностей в домене | Вызывается без `render()` — LLM не получает `schema_block`, `vault_name`. Правило "Никаких других полей" противоречило наличию `reasoning`. **Исправлено.** Задача пересекается с потребностью `ingest` обогащать `entity_types` |
| `format.md` | `format` | Форматирование произвольной markdown-страницы | Не связан с доменной wiki — намеренно. Дублирует правила из `_format_schema.md` (часть хардкода в промте, часть в шаблоне) |
| `evaluator.md` | `agent-runner`, devMode | Оценка качества результата операции (score 0–10) | Рендерится в роль `user`, не `system` — единственный промт с такой ролью. `base.md` не применяется. Вызывается после каждой операции при включённом devMode |
| `_wiki_schema.md` | `init` (bundled), `ingest`/`query` (vault read) | Конвенции wiki-страниц: frontmatter, структура, стиль | Отсутствовало поле `wiki_keywords` — оно упоминалось во всех операционных промтах, но не было в схеме. **Исправлено: заменено на `tags`.** Пример папок доменов содержал кириллицу при правиле "латиница". **Исправлено.** |
| `_format_schema.md` | `init` (bundled, записывается в vault), `format` (vault read) | Конвенции форматирования не-wiki страниц | Правило `tags` было расплывчатым. **Исправлено.** При `init` шаблон записывается в vault как дефолт — изменения в `templates/` не попадают в существующие vaults автоматически |

## Замечания для архитектурного анализа

### init-incremental vs ingest — потенциальное слияние

`init-incremental.md` обнаруживает **типы** сущностей (мета-уровень).  
`ingest.md` извлекает **экземпляры** по известным типам (объектный уровень).

Сейчас это два отдельных прохода: сначала `init` строит каталог `entity_types`, потом `ingest` пишет страницы.

**Идея:** дать `ingest` возможность обогащать `entity_types` инкрементально при каждом запуске.  
Для этого потребуется:
1. Добавить `entity_types_delta?` в `WikiPagesOutputSchema`
2. Обновить `ingest.md` — попросить LLM возвращать дельту при обнаружении новых типов
3. Прокинуть сохранение домена в `ingest.ts` (сейчас `DomainStore` недоступен из фазы)

### init-incremental.md — не получает schema_block

В отличие от `init.md`, `initIncrementalTemplate` вызывается без `render()` — LLM не видит конвенции `_wiki_schema.md` при delta-обновлении типов.

### evaluator — изолирован от base.md

`evaluator.md` рендерится в `user` роль и не проходит через `injectBaseContract` — намеренно, чтобы не смешивать инструкции wiki-агента с инструкциями оценщика.
