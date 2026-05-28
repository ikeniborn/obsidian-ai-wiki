# Логика фильтрации статей

Описывает, как система выбирает ограниченный набор вики-страниц в качестве контекста LLM для операций ingest, query и lint.

## Общий конвейер

Все три операции используют единый двухэтапный конвейер фильтрации:
1. **Выбор по схожести** — отбор top-K страниц-«зёрен» по релевантности
2. **BFS-расширение** — расширение набора через связи в вики-графе

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
    subgraph input_layer["Входные данные"]
        IN_INGEST["Содержимое исходного файла"]
        IN_QUERY["Вопрос пользователя"]
        IN_LINT["Содержимое вики-статьи"]
    end

    subgraph similarity["Этап 1: Выбор по схожести"]
        direction TB
        MODE{"SimilarityConfig.mode"}
        JAC["Jaccard: пересечение токенов via scoreSeed()"]
        EMB["Embedding: косинусное сходство векторов"]
        EMB_CACHE["_embeddings.json (кэш на домен)"]
        EMB_API["OpenAI-совместимый эндпоинт (Ollama и др.)"]
        TOPK["Top-K путей по оценке"]
        LLM_FALLBACK["llmSelectSeeds() fallback (только query)"]

        MODE -->|jaccard| JAC
        MODE -->|embedding| EMB
        EMB --> EMB_CACHE
        EMB_CACHE -->|"промах кэша"| EMB_API
        EMB_API --> EMB_CACHE
        JAC --> TOPK
        EMB_CACHE -->|"оценки готовы"| TOPK
        TOPK -->|"пусто - только query"| LLM_FALLBACK
        LLM_FALLBACK --> BFS_SEEDS
    end

    subgraph bfs_layer["Этап 2: BFS-расширение (wiki-graph)"]
        BFS_SEEDS["Seed IDs: articleId + topK путей"]
        GRAPH["WikiGraph: граф смежности (ненаправленный)"]
        BFS["bfsExpand(seeds, graph, depth)"]
        EXPANDED["Расширенный набор страниц"]

        BFS_SEEDS --> BFS
        GRAPH --> BFS
        BFS --> EXPANDED
    end

    subgraph llm_ctx["Контекст LLM"]
        PAGES["Содержимое отобранных вики-страниц"]
        LLM_CALL["Вызов LLM: статья + контекст"]
    end

    IN_INGEST --> MODE
    IN_QUERY --> MODE
    IN_LINT --> MODE

    TOPK --> BFS_SEEDS
    EXPANDED --> PAGES
    PAGES --> LLM_CALL

    classDef input    fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec,stroke-width:2px
    classDef stage    fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b,stroke-width:2px
    classDef decision fill:#f9e2af,color:#1e1e2e,stroke:#df8e1d,stroke-width:2px
    classDef cache    fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef fallback fill:#f38ba8,color:#1e1e2e,stroke:#d20f39
    classDef output   fill:#cba6f7,color:#1e1e2e,stroke:#8839ef,stroke-width:2px

    class IN_INGEST,IN_QUERY,IN_LINT input
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
        I1["Исходный файл"] --> I2["selectRelevant(content, annotations, allPaths)"]
        I2 --> I3["BFS depth=настраивается"]
        I3 --> I4["LLM: WikiPagesOutputSchema"]
        I4 --> I5["Запись страниц в vault"]
        I5 --> I6["refreshCache()"]
    end

    subgraph query_op["QUERY"]
        Q1["Вопрос пользователя"] --> Q2["loadCache() + selectRelevant()"]
        Q2 -->|"seeds найдены"| Q3["BFS-расширение"]
        Q2 -->|"пусто"| Q4["llmSelectSeeds()"]
        Q4 --> Q3
        Q3 --> Q5["LLM: QueryOutputSchema"]
    end

    subgraph lint_op["LINT: цикл по статьям"]
        L1["Вики-статья"] --> L2["selectRelevant(articleContent, annotations, otherPaths)"]
        L2 --> L3["BFS depth=1"]
        L3 --> L4["LLM: fixes + deletes"]
        L4 --> L5["Применить правки: fixWikiLinks + запись"]
        L5 --> L6["Rebuild graphCache + refreshCache"]
        L6 -->|"следующая статья"| L1
    end

    classDef op_input fill:#89b4fa,color:#1e1e2e,stroke:#74c7ec,stroke-width:2px
    classDef op_llm   fill:#cba6f7,color:#1e1e2e,stroke:#8839ef,stroke-width:2px
    classDef op_write fill:#a6e3a1,color:#1e1e2e,stroke:#40a02b
    classDef op_cache fill:#94e2d5,color:#1e1e2e,stroke:#179299
    classDef op_fb    fill:#f38ba8,color:#1e1e2e,stroke:#d20f39

    class I1,Q1,L1 op_input
    class I4,Q5,L4 op_llm
    class I5,L5 op_write
    class I6,L6,Q2 op_cache
    class Q4 op_fb
```

## Ключевые понятия

| Понятие | Описание |
|---|---|
| `selectRelevant()` | Точка входа выбора по схожести. Направляет в режим jaccard или embedding. |
| `scoreSeed()` | Оценка Жаккара: `пересечение(queryTokens, pageTokens) / queryTokens.size` |
| `pageTokens` | Объединение: токены pageId + `wiki_keywords` из frontmatter + тело (500 символов) + annotation |
| `indexAnnotations` | `Map<pageId, annotation>` из `_index.md`. Лёгкое саммари страницы для скоринга без чтения полного контента. |
| `bfsExpand()` | Ненаправленный BFS — обходит рёбра в обе стороны (`A→B` и `B→A`). Симметрия по задумке. |
| `graphDepth` | Настраиваемая глубина BFS для query. Lint всегда использует `depth=1`. |
| `topK` | Максимум seeds из этапа схожести. Настраивается через `relevantPagesTopK` в `LocalConfig.nativeAgent`. |
| `refreshCache()` | Обновляет `_embeddings.json` векторами для вновь записанных страниц. Вызывается после записи в ingest и пер-статейно в lint. |
