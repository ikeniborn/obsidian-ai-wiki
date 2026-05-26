# Prompt Architecture

Архитектура промптов, пайплайнов и функций агента. Описывает как собираются сообщения для LLM, как работают retry-цепочки, граф-поиск и валидация WikiLink.

---

## 1. Операции и зависимости

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

**Сплошные стрелки** — жёсткая зависимость (операция не запустится без артефакта).  
**Пунктирные стрелки** — мягкая зависимость (chat берёт `context` из результата; без него бесполезен).

| Операция | Требует | Производит |
|---|---|---|
| **init** | — | `DomainEntry`, `entity_types`, `_wiki_schema.md`, `_format_schema.md` |
| **ingest** | `DomainEntry`, `_wiki_schema.md` | wiki-страницы, `_index.md`, `analyzed_sources` |
| **query** | `DomainEntry`, `_index.md`, wiki-страницы | ответ (seeds → BFS → LLM-subset) |
| **lint** | `DomainEntry`, wiki-страницы | lint-отчёт, исправленные страницы, `domain_updated` |
| **lint-chat** | `DomainEntry`, lint-отчёт, wiki-страницы | исправленные wiki-страницы |
| **chat** | результат любой предыдущей операции | диалог |
| **format** | произвольная страница, `_format_schema.md` | отформатированная страница |

---

## 2. Routing: операция → фаза

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    UI["Команда Obsidian / UI"]
    UI --> AR["AgentRunner.run()"]
    AR --> OP{"operation"}

    OP -->|ingest| PI["phases/ingest.ts · runIngest()"]
    OP -->|query| PQ["phases/query.ts · runQuery()"]
    OP -->|lint| PL["phases/lint.ts · runLint()"]
    OP -->|chat| PC["phases/chat.ts · runLintChat()"]
    OP -->|lint-chat| PLC["phases/lint-chat.ts · runLintFixChat()"]
    OP -->|init| PIN["phases/init.ts · runInit()"]
    OP -->|format| PF["phases/format.ts · runFormat()"]

    AR -->|devMode| PE["phases/evaluator.ts · runEvaluator()"]

    classDef phase fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dev   fill:#585b70,color:#cdd6f4,stroke:#6c7086
    class PI,PQ,PL,PC,PLC,PIN,PF phase
    class PE dev
```

Все фазы реализованы как `async function*` — генераторы `RunEvent`. `AgentRunner` итерирует поток и маршрутизирует события в UI.

---

## 3. Промпты по фазам

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart LR
    subgraph tmpl["templates/ (bundled в dist)"]
        WIKI_SCHEMA["_wiki_schema.md"]
        FMT_SCHEMA["_format_schema.md"]
    end

    subgraph vault["vault runtime (читается из файлов)"]
        V_WIKI["!Wiki/_config/_wiki_schema.md"]
        V_FMT["!Wiki/_config/_format_schema.md"]
        V_IDX["domain/_config/_index.md"]
    end

    BASE["prompts/base.md\n(system contract)"]

    BASE --> PI2
    BASE --> PQ2
    BASE --> PL2
    BASE --> PC2
    BASE --> PLC2
    BASE --> PIN2
    BASE --> PF2
    BASE --> PE2

    PI2["ingest"] --> INGEST["prompts/ingest.md"]
    PQ2["query"] --> QUERY["prompts/query.md"]
    PL2["lint"] --> LINT["prompts/lint.md"]
    PC2["chat"] --> CHAT["prompts/chat.md"]
    PLC2["lint-chat"] --> LINTCHAT["prompts/lint-chat.md"]
    PIN2["init"] --> INIT["prompts/init.md"]
    PF2["format"] --> FORMAT["prompts/format.md"]
    PE2["evaluator"] --> EVAL["prompts/evaluator.md"]

    V_WIKI -->|schema_block| PI2
    V_WIKI -->|schema_block| PL2
    V_WIKI -->|schema_block| PLC2
    V_IDX  -->|index_block| PQ2
    V_FMT  -->|format_schema| PF2

    WIKI_SCHEMA -->|schema_block| PIN2
    FMT_SCHEMA  -->|"записывается в vault при init"| V_FMT

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

`evaluator.md` рендерится в роль `user`, но `base.md` всё равно инжектируется через `prependBaseContract` как `system` — применяется ко всем вызовам без исключений.

### Переменные шаблонов (render)

`src/phases/template.ts` — простая интерполяция `{{var}}`:

```typescript
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
```

| Операция | Промт | Переменные render() | Схема ответа |
|---|---|---|---|
| **ingest** | `ingest.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block` | `WikiPagesOutputSchema` |
| **query** | `query.md` | `domain_name`, `entity_types_block`, `index_block` | free text |
| **lint** | `lint.md` | `domain_name`, `entity_types_block`, `schema_block` | `LintOutputSchema` |
| **chat** | `chat.md` | `operation_header`, `context` | free text |
| **lint-chat** | `lint-chat.md` | `domain_name`, `lint_report`, `pages_block`, `schema_block` | `LintChatSchema` |
| **init** | `init.md` | `domain_id`, `vault_name`, `schema_block`, `index_block` | `DomainEntrySchema` |
| **format** | `format.md` | `format_schema`, `has_vision` | `FormatOutputSchema` |
| **evaluator** | `evaluator.md` | `operation`, `task_input`, `result` | `{score, reasoning}` |

---

## 4. buildChatParams: сборка сообщений

`src/phases/llm-utils.ts · buildChatParams()` — единственная точка сборки параметров запроса к LLM.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    MSGS["messages[] от фазы"]

    MSGS --> PBC["prependBaseContract()"]
    PBC -->|"system найден"| PREPEND["base.md + '\\n\\n' + existing system"]
    PBC -->|"system не найден"| INSERT["новый system = base.md"]

    PREPEND --> ISP
    INSERT --> ISP

    ISP{"opts.systemPrompt?"}
    ISP -->|да| INJECT["injectSystemPrompt():\nappend '## Уточнение\\n' + systemPrompt"]
    ISP -->|нет| FINAL

    INJECT --> FINAL["финальный messages[]"]
    FINAL --> PARAMS["buildChatParams:\nmodel, temperature, maxTokens, topP,\njsonMode, thinkingBudget, stream_options"]

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef out  fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    class PBC,PREPEND,INSERT,INJECT step
    class ISP dec
    class FINAL,PARAMS out
```

| Опция `LlmCallOptions` | Поведение |
|---|---|
| `systemPrompt` | Добавляет `## Уточнение\n{text}` в конец system-сообщения |
| `jsonMode: "json_schema"` | `response_format: { type: "json_schema", ... }`. Приоритет над `json_object` |
| `jsonMode: "json_object"` | `response_format: { type: "json_object" }` |
| `thinkingBudgetTokens > 0` | Включает extended thinking; снимает `response_format`, `temperature`, `top_p` |
| `temperature`, `maxTokens`, `topP` | Прямая передача в API |

---

## 5. wrapWithJsonFallback: деградация response_format

`AgentRunner` оборачивает `LlmClient` в `wrapWithJsonFallback` (`src/phases/llm-utils.ts`). При ошибке 400/422 с ключевыми словами `"response_format"`, `"json_object"`, `"json mode"`, `"unsupported"` — деградирует `response_format` до следующего уровня.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart LR
    S["json_schema"] -->|"400/422 json-mode error"| O["json_object"]
    O -->|"400/422 json-mode error"| N["без response_format"]
    N -->|"любая ошибка"| THROW["throw"]

    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef warn fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef err  fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    class S ok
    class O warn
    class N warn
    class THROW err
```

`degradeResponseFormat()` (`llm-utils.ts:140`): `json_schema` → `json_object` → удалить поле.  
Для стриминга: retry выполняется только если ни одного content-чанка не было получено (reasoning-чанки `delta.reasoning` не считаются контентом).

---

## 6. parseWithRetry: структурированный вывод с retry

`src/phases/parse-with-retry.ts · parseWithRetry()` — используется всеми операциями с JSON-схемой.

**Ключевое:** при `jsonMode: "json_object"` автоматически апгрейдится до `json_schema` через `zodToJsonSchema()`. `superRefine`-правила (например, WikiLink-проверки) в JSON Schema не выражаются — они применяются на уровне Zod после парсинга.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    START["parseWithRetry(baseMessages, schema, maxRetries)"]
    START --> UPGRADE["json_object → json_schema\n(zodToJsonSchema автоматически)"]
    UPGRADE --> CALL["streamOnce() → fullText + stats"]
    CALL --> STATS["emit llm_call_stats\n(inputTokens, outputTokens, ttftMs, tok/s)"]
    STATS --> PARSE{"parseStructured()"}

    PARSE -->|"прямой JSON.parse OK"| ZOD
    PARSE -->|"fail → stripThinking → stripFences → jsonrepair → regex"| ZOD
    PARSE -->|"всё failed"| ERR_JSON["emit structural_error json_parse"]

    ZOD{"schema.safeParse()"}
    ZOD -->|success| RETURN["return { value, outputTokens, fullText }"]
    ZOD -->|fail| ERR_ZOD["emit structural_error schema_validate"]

    ERR_JSON --> RETRY{"attempt < maxRetries?"}
    ERR_ZOD --> RETRY
    RETRY -->|да| APPEND["append:\nassistant: fullText\nuser: formatZodFeedback()"]
    RETRY -->|нет| THROW["throw StructuredValidationError"]
    APPEND --> CALL

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef err  fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    class CALL,APPEND,UPGRADE,STATS step
    class PARSE,ZOD,RETRY dec
    class RETURN ok
    class ERR_JSON,ERR_ZOD,THROW err
```

**parseStructured fallback-цепочка** (`llm-utils.ts:17`):
1. `JSON.parse(text)` — прямой
2. `stripThinking()` → убирает `<think>...</think>` блоки thinking-моделей
3. `stripFences()` → убирает ` ```json ` обёртки
4. `jsonrepair(stripped)` — исправляет частично корректный JSON
5. regex `.match(/\{[\s\S]*\}/)` + позиционный `slice` при "Unexpected non-whitespace at position N"

**formatZodFeedback**: при `err === null` → "не валидный JSON"; при `ZodError` → список `path: message` по первым 20 issue.

**streamOnce fallback**: при ошибке стриминга — повтор через non-streaming (`chat.completions.create` без `stream: true`).

### CallSite → схема

| callSite | Фаза | Zod-схема |
|---|---|---|
| `ingest.pages` | `ingest.ts` | `WikiPagesOutputSchema` |
| `init.bootstrap` | `init.ts` файл 0 | `DomainEntrySchema` |
| `init.delta` | `init.ts` файлы 1..N | `EntityTypesDeltaSchema` |
| `lint.fix` | `lint.ts` | `LintOutputSchema` |
| `lint.patch` | `lint.ts` (actualizeDomainConfig) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | `lint-chat.ts` | `LintChatSchema` |
| `query.seeds` | `query.ts` (llmSelectSeeds) | `SeedsSchema` |
| `format.output` | `format.ts` | `FormatOutputSchema` |

---

## 7. Статистика LLM-вызовов

`src/phases/llm-utils.ts · wrapStreamWithStats()` — декоратор над стримом, собирает метрики без изменения поведения.

```typescript
interface LlmStreamStats {
  inputTokens: number;   // из финального чанка (stream_options.include_usage=true)
  outputTokens: number;
  ttftMs: number;        // время до первого чанка
  llmDurationMs: number; // от первого до последнего чанка
}
```

`buildLlmCallStatsEvent(stats)` эмитирует `RunEvent` с типом `llm_call_stats`, добавляя `inTokPerSec` и `outTokPerSec`.

`computeSpeedText(stats[])` — агрегирует несколько вызовов за операцию: суммирует токены, медианный TTFT.

`extractStreamDeltas(chunk)` читает `delta.content` и нестандартные поля reasoning-моделей (`delta.reasoning`, `delta.reasoning_content`).

---

## 8. WikiLink Validation

`src/wiki-link-validator.ts` — полный цикл проверки и автоисправления WikiLink-нарушений.

### Типы нарушений (ViolationKind)

| Kind | Паттерн | Пример |
|---|---|---|
| `alias` | `[[page\|alias]]` | `[[Процесс\|Шаг 1]]` — алиасы запрещены |
| `path` | `[[path/to/page]]` | `[[Folder/Page]]` — пути запрещены, только stem |
| `inline-json` | `wiki_outgoing_links: [...]` | JSON-массив в одну строку (нарушение формата frontmatter) |
| `outgoing-desync` | body links ≠ fm links | тело содержит `[[A]]`, `[[B]]`, но `wiki_outgoing_links` содержит только `[[A]]` |

### fixWikiLinks: алгоритм

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    FWL["fixWikiLinks(pages, maxPasses, knownPageStems?)"]

    FWL --> MZ{"maxPasses == 0?"}
    MZ -->|да| WO["validateWikiLinks() → warnings only\n(без авто-исправления)"]
    MZ -->|нет| LOOP["for pass in 0..maxPasses"]

    LOOP --> VAL["validateWikiLinks(current)"]
    VAL --> NOVIOL{"violations == 0?"}
    NOVIOL -->|да| DONE["выход из цикла"]
    NOVIOL -->|нет| FIX["fixOnePass(content) для каждой страницы"]
    FIX --> LOOP

    DONE --> REMAIN["validateWikiLinks(current) → оставшиеся → warnings"]
    WO --> DEAD
    REMAIN --> DEAD{"knownPageStems задан?"}
    DEAD -->|да| DEADCHECK["for link in body links:\n  stem not in knownPageStems → dead link warning"]
    DEAD -->|нет| RET
    DEADCHECK --> RET["return { fixed, warnings }"]

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    class FIX,WO,DEADCHECK step
    class MZ,NOVIOL,DEAD dec
    class RET ok
```

**fixOnePass** (`wiki-link-validator.ts:49`):
1. `stripAlias(body)` — `[[page|alias]]` → `[[page]]`
2. `stripPath(body)` — `[[path/to/page]]` → `[[page]]` (берёт последний сегмент)
3. inline-json в frontmatter → разворачивает в блок `- "[[link]]"`
4. `setFmLinks(fm, bodyLinks)` — синхронизирует `wiki_outgoing_links` в frontmatter с body

**Dead link detection**: проверяет только stems (`link.split("/").pop()`), не полные пути. `knownPageStems` строится из существующих wiki-страниц (`Set<string>`).

### Интеграция в ingest

`src/phases/ingest.ts:182` — после получения страниц от LLM, до записи в vault:

```typescript
const wlFixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
// wikiLinkValidationRetries: из настроек (default 3)
// knownStems: stems из existingPaths + stems новых страниц этого же ingest-вызова
```

Предупреждения накапливаются и эмитируются единым событием **после** завершения write-цикла:

```typescript
// ingest.ts:275
yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
```

| Параметр | Источник | Default |
|---|---|---|
| `maxPasses` | `wikiLinkValidationRetries` из настроек | `3` |
| `knownPageStems` | existing wiki paths + новые страницы текущего ingest | строится в фазе |

---

## 9. Граф вики и BFS-расширение

`src/wiki-graph.ts` — построение графа WikiLink и обход BFS от seed-страниц.

### Структура графа

```typescript
type WikiGraph = Map<string, Set<string>>;
// key: pageId (stem страницы), value: Set<string> исходящих ссылок
```

`buildWikiGraph(pages)` — парсит `[[link]]` из тела каждой страницы через regex `/\[\[([^\]|#]+)/g`.

### BFS-расширение (undirected)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    BFS["bfsExpand(seeds, graph, depth)"]
    BFS --> REV["pre-compute reverse index\n(Map<target, Set<source>>)"]
    REV --> INIT2["visited = Set(seeds)\nfrontier = Set(seeds)"]
    INIT2 --> HOP["for hop in 0..depth"]
    HOP --> FWD["для каждого node в frontier:\n  прямые рёбра: graph.get(node)"]
    FWD --> BWD["обратные рёбра: reverse.get(node)"]
    BWD --> NEXT{"next.size == 0?"}
    NEXT -->|да| END["выход: visited"]
    NEXT -->|нет| UPD["frontier = next"]
    UPD --> HOP

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef dec  fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d
    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    class REV,INIT2,FWD,BWD,UPD step
    class NEXT dec
    class END ok
```

Граф обходится **без направления**: прямые рёбра (A→B) и обратные (B→A backlinks) равнозначны. Depth=1 (default) означает непосредственных соседей seeds в обоих направлениях.

Проверки качества графа (`checkGraphStructure`): изолированные узлы (нет in/out рёбер), hub-узлы (> `hubThreshold` исходящих), несимметричные ссылки.

---

## 10. PageSimilarityService: выбор релевантных страниц

`src/page-similarity.ts` — решает O(N) проблему: вместо передачи всех wiki-страниц в контекст LLM выбирает top-K наиболее релевантных через Jaccard или embedding.

### Два режима

| Режим | Метод | Требования |
|---|---|---|
| `jaccard` | Пересечение токенов source-файла и аннотаций `_index.md` | — |
| `embedding` | Косинусное сходство float32-векторов | `embeddingModel`, `embeddingDimensions`, `baseUrl`; API-ключ опционален |

При недоступности embedding API — автоматический fallback на Jaccard.

### Jaccard: алгоритм (src/wiki-seeds.ts)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a'}}}%%
flowchart TD
    Q["вопрос / source-текст"]
    Q --> TQ["tokenize(question)\n→ Set<string> questionTokens"]

    P["страница: pageId + content + annotation"]
    P --> TP["tokenize(pageId ∪ wiki_keywords ∪ body ∪ annotation)\n→ Set<string> pageTokens"]

    TQ --> SCORE["score = |intersection| / |questionTokens|"]
    TP --> SCORE

    SCORE --> FILTER["filter: score >= seedMinScore (default 0.1)"]
    FILTER --> TOPK["sort desc → top seedTopK (default 5)"]

    classDef step fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec
    classDef ok   fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    class TQ,TP,SCORE,FILTER step
    class TOPK ok
```

**tokenize** (`wiki-seeds.ts:16`): lowercase → split по `[^\p{L}\p{N}]+` → отбрасывает токены ≤2 символов + стоп-слова (EN + RU). Формула: `|intersection| / |questionTokens|` — не классический Jaccard (union в знаменателе), а покрытие запроса.

### Embedding: кэш векторов

Хранится в `!Wiki/<domain>/_config/_embeddings.json`:

```json
{
  "model": "text-embedding-3-small",
  "dimensions": 1536,
  "entries": {
    "<pageId>": { "vector": "<base64 Float32Array>", "hash": "<annotation hash>" }
  }
}
```

Инвалидация по хэшу аннотации: вектор пересчитывается при изменении текста аннотации в `_index.md`. Смена `model` или `dimensions` — пересоздаёт весь кэш. `refreshCache()` обновляет только устаревшие записи, батчи по 100.

**Косинусное сходство** (`page-similarity.ts:43`):
```typescript
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

### Полный lifecycle: ingest + query + lint

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'background': '#1e1e2e', 'primaryColor': '#313244', 'primaryTextColor': '#cdd6f4', 'primaryBorderColor': '#89b4fa', 'lineColor': '#888888', 'secondaryColor': '#181825', 'tertiaryColor': '#45475a', 'activationBorderColor': '#cba6f7', 'activationBkgColor': '#313244', 'noteBkgColor': '#45475a', 'noteTextColor': '#cdd6f4', 'loopTextColor': '#cdd6f4'}}}%%
sequenceDiagram
    participant AR as AgentRunner
    participant PS as PageSimilarityService
    participant API as Embeddings API
    participant FS as _embeddings.json
    participant G as WikiGraph
    participant LLM as LLM
    participant V as Vault

    rect rgb(30, 80, 140)
        Note over AR,V: ── INGEST ──
        AR->>V: read source + _wiki_schema.md + _index.md
        alt similarity включена
            AR->>PS: loadCache(domainRoot) → read _embeddings.json
            AR->>PS: selectRelevant(sourceContent, annotations, existingPaths)
            note over PS: jaccard: scoreSeed() по токенам<br/>embedding: fetchEmbeddings + cosine top-K
            PS-->>AR: seedPaths[]
            AR->>V: readAll(allWikiFiles) → allPages
            AR->>G: buildWikiGraph(allPages)
            AR->>G: bfsExpand(seedIds, graph, depth) → expandedIds
            AR->>AR: existingPages = allPages filtered by expandedIds
            AR->>AR: emit graph_stats {seeds, expanded, total}
        else similarity отключена
            AR->>V: readAll → existingPages (все)
        end
        AR->>LLM: parseWithRetry(WikiPagesOutputSchema)\nsource + existingPages + schema + index
        LLM-->>AR: pages[] + entity_types_delta?
        loop pages[]
            AR->>AR: fixWikiLinks(pages, maxPasses, knownStems)
            AR->>V: write(page.path, fixed_content)
            AR->>V: upsertIndexAnnotation(_index.md)
        end
        AR->>AR: emit WikiLink warnings (если есть)
        AR->>AR: entity_types_delta → emit domain_updated
        alt similarity && written > 0
            AR->>PS: refreshCache(domainRoot, updatedAnnotations)
            loop stale/новые записи
                PS->>API: fetchEmbeddings(annotations) batch≤100
                API-->>PS: vectors
            end
            PS->>FS: write _embeddings.json
        end
    end

    rect rgb(30, 120, 70)
        Note over AR,V: ── QUERY ──
        AR->>V: read _index.md → annotations
        alt embedding-режим
            AR->>PS: loadCache → read _embeddings.json
            AR->>PS: selectRelevant(question, annotations, paths)
            PS->>API: fetchEmbeddings([question[:2000]])
            PS->>PS: cosine(queryVec, pageVec) → top-K
            PS-->>AR: seeds[]
        else jaccard / нет similarity
            AR->>AR: selectSeeds(question, syntheticPages, topK, minScore)
        end
        alt seeds == 0
            AR->>LLM: llmSelectSeeds(question, indexAnnotations) → SeedsSchema
        end
        AR->>V: readAll(allWikiFiles)
        AR->>G: buildWikiGraph + bfsExpand(seeds, depth)
        AR->>AR: buildContextBlock(pages, seeds, expandedIds)
        AR->>LLM: query prompt streaming → answer
    end

    rect rgb(150, 80, 30)
        Note over AR,V: ── LINT ──
        AR->>V: readAll(allWikiFiles) → pages
        AR->>G: buildWikiGraph + checkStructure + checkGraphStructure
        AR->>LLM: parseWithRetry(LintOutputSchema)
        LLM-->>AR: report + fixes[]
        AR->>LLM: actualizeDomainConfig → EntityTypesDeltaSchema
        LLM-->>AR: entity_types patch → emit domain_updated
        loop fixes[]
            AR->>V: write(page.path, content)
            AR->>V: upsertIndexAnnotation(_index.md)
        end
        alt similarity включена
            AR->>PS: refreshCache → API → write _embeddings.json
        end
    end
```

### Использование similarity по фазам

| Фаза | loadCache | selectRelevant | refreshCache |
|---|---|---|---|
| `ingest` | ✓ перед отбором | ✓ → BFS-expand | ✓ после записи страниц |
| `init` (файлы 1..N) | — | ✓ (ingest-pass) | — |
| `query` | ✓ (embedding mode) | ✓ → seed selection | — |
| `lint` | — | — | ✓ после прохода |
| `format` | — | — | — |

`PageSimilarityService` ephemeral — создаётся заново на каждый `AgentRunner.run()`. `loadCache()` восстанавливает диск-кэш до первого `selectRelevant()`.

### Настройки

| Поле `nativeAgent` | Тип | Назначение |
|---|---|---|
| `embeddingModel` | `string?` | `undefined` = jaccard; `""` = режим включён, ждёт модель; непустая = embedding |
| `embeddingDimensions` | `number?` | Число измерений; обязательно при `embeddingModel` |
| `relevantPagesTopK` | `number?` | Максимум страниц в контексте (default: 15) |
| `seedTopK` | `number` | Число seeds при Jaccard (default: 5) |
| `seedMinScore` | `number` | Минимальный Jaccard-score (default: 0.1) |

---

## 11. Вторичные LLM-вызовы

### query: многоэтапный отбор контекста

```
1. read _index.md → annotations (без чтения wiki-файлов)
2. seed selection:
   embedding → loadCache + cosine top-K
   jaccard   → selectSeeds() по токенам
   seeds==0  → llmSelectSeeds (parseWithRetry, SeedsSchema)
   seeds==0 после LLM → error
3. readAll(allWikiFiles) → buildWikiGraph → bfsExpand(seeds, depth)
4. buildContextBlock(expanded subset) → LLM только BFS-expanded страницы
5. query prompt streaming → answer
```

### lint: actualizeDomainConfig

После основного `parseWithRetry(LintOutputSchema)` — отдельный вызов:
- анализирует реальный контент wiki vs текущий `entity_types`
- возвращает дельту (`EntityTypesDeltaSchema`, callSite `lint.patch`)
- эмитирует `domain_updated` → контроллер сохраняет в domain-map

### ingest: entity_types_delta

Если LLM вернул `entity_types_delta`:
- `mergeEntityTypes(domain.entity_types, delta)` — merge по ключу `type`
- эмитирует `domain_updated { domainId, patch: { entity_types } }`
- `runInitWithSources` перехватывает событие для обновления `currentDomain` перед следующим файлом

### ingest: retry невалидных путей

При нарушении правила 4 сегментов (`!Wiki/<domain>/<subfolder>/<Article>.md`):
- `splitByPathValidity()` делит страницы на valid/invalid
- `retryInvalidPaths()` — отдельный `buildChatParams`-вызов (free text)
- передаёт оригинальные messages + ошибку как user-сообщение
- ожидает JSON-массив только для невалидных путей

---

## 12. RunEvent: поток событий

Все фазы возвращают `AsyncGenerator<RunEvent>`. Типы событий (`src/types.ts`):

| kind | Описание |
|---|---|
| `tool_use` / `tool_result` | I/O операции с vault |
| `assistant_text` | Стриминг текста LLM; `isReasoning=true` для thinking-чанков |
| `info_text` | Прогресс: выбор страниц, WikiLink warnings, BFS stats |
| `llm_call_stats` | Метрики: inputTokens, outputTokens, ttftMs, tok/s |
| `graph_stats` | seeds[], expanded, total, fromCache |
| `structural_error` | JSON-parse или schema-validate fail с retry-статусом |
| `domain_updated` | Изменение entity_types или language_notes |
| `domain_created` | Новый DomainEntry при init |
| `result` | Финальный текст операции + durationMs |
| `eval_result` | score + reasoning от evaluator (devMode) |
| `format_preview` | Предпросмотр форматирования с отчётом |
