# Логика фильтрации статей

Описывает, как система выбирает ограниченный набор вики-страниц в качестве контекста LLM для операций ingest, query и lint.

## Ingest: entity-based ретривал

Ingest использует двухшаговый конвейер с предварительным извлечением сущностей — без BFS.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
  'background': '#1e1e2e',
  'primaryColor': '#313244',
  'primaryTextColor': '#cdd6f4',
  'primaryBorderColor': '#89b4fa',
  'lineColor': '#888888',
  'secondaryColor': '#181825',
  'tertiaryColor': '#45475a'
}}}%%
flowchart TD
    SRC["Исходный файл"]
    LLM1["LLM #1: извлечь сущности\n→ EntitiesOutput { entities[] }"]
    SEL["selectByEntities(entities, annotations, nonMetaPaths)"]
    AF{"allFailed?"}
    HALT["❌ ошибка — остановка"]
    UNION["Union путей по всем сущностям"]
    READ["readAll(union) → existingPages"]
    LLM2["LLM #2: синтезировать wiki-страницы\n→ WikiPagesOutput"]
    WRITE["Запись страниц + upsertIndexAnnotation"]
    REFRESH["refreshCache()"]

    SRC --> LLM1
    LLM1 --> SEL
    SEL --> AF
    AF -->|"да (и есть сущности + страницы)"| HALT
    AF -->|"нет"| UNION
    UNION --> READ
    READ --> LLM2
    LLM2 --> WRITE
    WRITE --> REFRESH

    classDef input  fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec,stroke-width:2px
    classDef llm    fill:#cba6f7,color:#1e1e2e,stroke:#8839ef,stroke-width:2px
    classDef action fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef decide fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d,stroke-width:2px
    classDef err    fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    classDef cache  fill:#94e2d5,color:#1e1e2e,stroke:#179299

    class SRC input
    class LLM1,LLM2 llm
    class SEL,UNION,READ,WRITE action
    class AF decide
    class HALT err
    class REFRESH cache
```

`selectByEntities()` — для каждой сущности (`name`, `type`, `context_snippet`) отдельно вычисляет top-K похожих страниц через Jaccard или embedding. BFS не применяется — `graphDepth` в ingest игнорируется (`void graphDepth`).

## Query и Lint: seeds + BFS

Query и lint используют двухэтапный конвейер фильтрации.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
  'background': '#1e1e2e',
  'primaryColor': '#313244',
  'primaryTextColor': '#cdd6f4',
  'primaryBorderColor': '#89b4fa',
  'lineColor': '#888888',
  'secondaryColor': '#181825',
  'tertiaryColor': '#45475a'
}}}%%
flowchart TD
    subgraph inputs["Входные данные"]
        IN_QUERY["Вопрос пользователя"]
        IN_LINT["Содержимое вики-статьи"]
    end

    subgraph similarity["Этап 1: Выбор seeds по схожести"]
        MODE{"SimilarityConfig.mode"}
        JAC["Jaccard: scoreSeed() по токенам"]
        EMB["Embedding: косинусное сходство"]
        EMB_CACHE["_embeddings.json (кэш на домен)"]
        EMB_API["OpenAI-совместимый эндпоинт"]
        TOPK["Top-K путей по оценке"]
        LLM_FALLBACK["llmSelectSeeds() fallback\n(только query, если seeds = ∅)"]

        MODE -->|jaccard| JAC
        MODE -->|embedding| EMB
        EMB --> EMB_CACHE
        EMB_CACHE -->|"промах кэша"| EMB_API
        EMB_API --> EMB_CACHE
        JAC --> TOPK
        EMB_CACHE -->|"оценки готовы"| TOPK
        TOPK -->|"пусто — только query"| LLM_FALLBACK
    end

    subgraph bfs_layer["Этап 2: BFS-расширение (wiki-graph)"]
        BFS_SEEDS["Seeds: top-K + articleId (lint)"]
        GRAPH["WikiGraph: граф смежности (ненаправленный)"]
        BFS["bfsExpand(seeds, graph, depth)"]
        EXPANDED["Расширенный набор pageIds"]

        BFS_SEEDS --> BFS
        GRAPH --> BFS
        BFS --> EXPANDED
    end

    subgraph llm_ctx["Контекст LLM"]
        PAGES["Содержимое отобранных страниц\n(query: cap = topK × 3)"]
        LLM_CALL["Вызов LLM"]
    end

    IN_QUERY --> MODE
    IN_LINT --> MODE
    TOPK --> BFS_SEEDS
    LLM_FALLBACK --> BFS_SEEDS
    EXPANDED --> PAGES
    PAGES --> LLM_CALL

    classDef input    fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec,stroke-width:2px
    classDef stage    fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b,stroke-width:2px
    classDef decision fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d,stroke-width:2px
    classDef cache    fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef fallback fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    classDef output   fill:#cba6f7,color:#1e1e2e,stroke:#8839ef,stroke-width:2px

    class IN_QUERY,IN_LINT input
    class TOPK,EXPANDED,PAGES stage
    class MODE decision
    class EMB_CACHE,GRAPH cache
    class LLM_FALLBACK fallback
    class LLM_CALL output
```

## Детали по операциям

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
  'background': '#1e1e2e',
  'primaryColor': '#313244',
  'primaryTextColor': '#cdd6f4',
  'primaryBorderColor': '#89b4fa',
  'lineColor': '#888888',
  'secondaryColor': '#181825',
  'tertiaryColor': '#45475a'
}}}%%
flowchart LR
    subgraph ingest_op["INGEST"]
        I1["Исходный файл"] --> I2["LLM: extractEntities()"]
        I2 --> I3["selectByEntities(entities,\nannotations, nonMetaPaths)"]
        I3 -->|"allFailed → halt"| I_ERR["❌"]
        I3 --> I4["union путей → readAll()"]
        I4 --> I5["LLM: WikiPagesOutput"]
        I5 --> I6["Запись + upsertAnnotation"]
        I6 --> I7["refreshCache()"]
    end

    subgraph query_op["QUERY"]
        Q1["Вопрос пользователя"] --> Q2["loadCache() + selectRelevant()\n(только аннотированные страницы)"]
        Q2 -->|"seeds найдены"| Q3["readAll() → buildGraph → BFS"]
        Q2 -->|"пусто"| Q4["llmSelectSeeds()"]
        Q4 --> Q3
        Q3 --> Q5["buildContextBlock(cap=topK×3)"]
        Q5 --> Q6["LLM: ответ"]
    end

    subgraph lint_op["LINT: цикл по статьям"]
        L1["Вики-статья"] --> L2["selectRelevant(articleContent,\nannotations, otherPaths)"]
        L2 --> L3["seeds = [articleId, ...topKIds]\nbfsExpand(seeds, graph, 1)"]
        L3 --> L4["LLM: fixes + deletes"]
        L4 --> L5["fixWikiLinks + запись"]
        L5 --> L6["Rebuild graphCache + refreshCache"]
        L6 -->|"следующая статья"| L1
    end

    classDef op_input fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec,stroke-width:2px
    classDef op_llm   fill:#cba6f7,color:#1e1e2e,stroke:#8839ef,stroke-width:2px
    classDef op_write fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef op_cache fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef op_fb    fill:#f38ba8,color:#1e1e2e,stroke:#d20f39

    class I1,Q1,L1 op_input
    class I2,I5,Q6,L4 op_llm
    class I6,L5 op_write
    class I7,L6 op_cache
    class Q4 op_fb
```

## Ключевые понятия

| Понятие | Описание |
|---|---|
| `selectRelevant()` | Точка входа выбора seeds. Используется в **query и lint** — не в ingest. Направляет в jaccard или embedding. |
| `selectByEntities()` | Точка входа ingest. Для каждой `ExtractedEntity` (name, type, context_snippet) вычисляет top-K страниц отдельно. Возвращает `EntityRetrievalResult { results, allFailed }`. |
| `allFailed` | `true`, если все entity-запросы вернули пустой результат при непустом wiki. Ingest прерывается с ошибкой. |
| `scoreSeed()` | Оценка Жаккара: `пересечение(queryTokens, pageTokens) / queryTokens.size` |
| `pageTokens` | Объединение: токены pageId + annotation (тело и frontmatter-keywords включаются только если передан content; в index-режиме content = `""`, используется только annotation). |
| `indexAnnotations` | `Map<pageId, annotation>` из `_index.md`. Лёгкое саммари для скоринга без чтения полного контента. В query: только аннотированные страницы участвуют в seed selection. |
| `bfsExpand()` | Ненаправленный BFS — обходит рёбра в обе стороны (`A→B` и `B→A`). Используется в **query и lint** — ingest не использует BFS. |
| `graphDepth` | Глубина BFS для query. Lint всегда использует `depth=1`. Ingest — не используется (`void graphDepth`). |
| `topK` | Максимум seeds из этапа схожести. В query: контекст дополнительно ограничен `topK × 3` страницами (`buildContextBlock`). |
| `refreshCache()` | Обновляет `_embeddings.json` хэшами и векторами аннотаций. Вызывается: в ingest — после записи всех страниц; в lint — после каждой статьи. |
