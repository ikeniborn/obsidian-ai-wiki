# Повышение качества поиска — obsidian-ai-wiki + векторный слой

Контекст: плагин использует graph BFS (Query) + агентный Grep/Glob (Claude Agent). Поверх добавлен similarity-слой. Граф вики = индекс и для BFS, и для seed-выбора. Рекомендации — состыковать два сигнала и держать граф здоровым.

Текущий storage: каждый домен хранит `metadata.jsonl`, `index.jsonl` и `log.jsonl` прямо в `!Wiki/<domain>/`. `index.jsonl` содержит `page` records для description-seed stage и `chunk` records для clean section vectors; отдельный `_embeddings.json` не используется как runtime source of truth. Это граница структурированного storage: сериализованный `index.jsonl`, массивы векторов и сырые records никогда не входят в LLM-промты. Prompt builders проецируют только выбранные evidence, Markdown-секции и разрешённые метаданные.

---

## Tier 1 — наибольший эффект

### Здоровье графа важнее тюнинга поиска
Фрагментация (одна тема на 3 страницы) бьёт и по BFS, и по seed-выбору.

- **Dedup на Ingest** — similarity к существующим страницам перед созданием новой. Высокий cosine → обновить существующую, не плодить дубль.
- **Lint near-duplicate** — пары страниц выше порога similarity → кандидаты на слияние.
- **Цикл Lint + Fix регулярно** — битые ссылки рвут обход BFS.

### Гибрид retrieval, не dense-only
Документация = имена API, флаги, коды ошибок. Dense их теряет.

- `bge-m3` даёт dense + sparse одной моделью.
- Либо Grep-fallback на точные токены.

### Сильная модель на Ingest/Init
Структура строится один раз, влияет на всё дальше.

- Per-operation models: большая модель на построение (Ingest/Init), дешёвая на Query.

### Ограниченный Ingest без потери evidence

- Input budget — явный лимит оценочного размера полного подготовленного промта, а не автоматически обнаруженный context window модели.
- Большой Markdown делится по границам секций, абзацев, окон строк и fenced-code блоков. Map-вызовы извлекают source-anchored evidence, reduce-вызовы сохраняют покрытие всех чанков и пакетов.
- Новые страницы создаются целиком; существующие меняются только патчами секций `add` / `append` / `replace` с хешами страницы и секции. Нетронутые секции сохраняются, stale patch не перезаписывает новое содержимое.
- Oversized source требует дополнительных bounded calls и поэтому может быть медленнее и дороже. Компромисс — полная обработка вместо обрезания или oversized one-shot request.

### Lifecycle модели и полный Re-init

- Панель показывает только человекочитаемые этапы запроса: подготовка, отправка, ожидание,
  получение ответа, проверка, применение и terminal state. Рассуждение остаётся
  раскрываемым. Call site, transport, попытки, бюджеты и provider diagnostics пишутся
  только в `agent.jsonl`. Agent log хранит до 4 MiB рассуждения на операцию в
  упорядоченных bounded records; превышение заменяется metadata-only marker обрезки.
- Таймер ожидания — локальное прошедшее время UI, не heartbeat провайдера; lifecycle-события
  не продлевают idle deadline.
- Init bootstrap, evidence map/reduce, synthesis Ingest и bounded Lint batches используют
  atomic non-stream ответы. Chat, финальный ответ Query и Format используют SSE.
- Полный Re-init после preflight удаляет и пересоздаёт всё дерево домена, включая
  `metadata.jsonl`, `index.jsonl`, логи, временные файлы, вложенные и пустые устаревшие
  каталоги. При ошибке или конфликте ingest не начинается: безопасный snapshot
  восстанавливается, а параллельно созданное дерево не перезаписывается.

---

## Tier 2 — конвейер Query

### Фьюзия vector + BFS
Не «вектор или граф», а конвейер: вектор находит вход, граф добирает контекст.

```
cosine top-k → seeds → BFS depth 1 → union → RRF (k≈60) → rerank → context
```

- RRF по (vector rank, BFS rank), `k≈60` — без калибровки шкал.
- Альтернатива: `score = α·cosine + β·graph_score`, где graph_score = функция hop-дистанции и числа бэклинков.

### Rerank поверх union
Cross-encoder (`bge-reranker-v2-m3`) → top-5–8 в контекст. Дешёвый прирост precision после фьюзии.

### Порог similarity + fallback
max cosine ниже порога → seeds мусорные. Уходить на keyword/Grep или честное «не найдено», не тащить шум в BFS.

---

## Схема шагов

```mermaid
flowchart TD
    subgraph Ingest["Ingest / Init — построение графа"]
        N[Заметка] --> EX[Извлечение тем<br/>сильная модель]
        EX --> DD{similarity к<br/>существующим?}
        DD -->|высокий cosine| UP[Обновить страницу]
        DD -->|низкий| NW[Новая страница<br/>+ кросс-ссылки]
        UP --> EMB[Эмбеддинг<br/>hash reuse]
        NW --> EMB
        EMB --> IDX[(index.jsonl<br/>page + chunk vectors<br/>+ граф из body links)]
    end

    subgraph Query["Query — retrieval"]
        Q[Запрос] --> VS[cosine top-k<br/>seeds]
        VS --> TH{max cosine<br/>выше порога?}
        TH -->|нет| FB[fallback:<br/>Grep / не найдено]
        TH -->|да| BFS[BFS depth 1<br/>от seeds]
        VS --> UN[union + dedup<br/>по page id]
        BFS --> UN
        UN --> RRF[RRF fusion<br/>k≈60]
        RRF --> RR[rerank<br/>cross-encoder]
        RR --> CTX[контекст в LLM<br/>в input budget]
        CTX --> ANS[Ответ + цитаты]
    end

    IDX -.индекс.-> VS
    IDX -.граф.-> BFS
```

---

## Tier 3 — гигиена и настройка

- **Инкрементальность векторов** — переиспользовать `chunk` vector, пока совпадают `embedTextHash + model + dimensions`; `bodyHash` связывает records с текущим телом страницы и защищает commit от stale refresh. Удалена страница → удалены её `page`/`chunk` records. Иначе similarity отдаёт устаревшие seeds.
- **Бюджет токенов** — Query упаковывает целые citation-bearing chunks в явно настроенный input budget. vector top-k держать 5–8, BFS depth 1, rerank ужимает под бюджет. Плагин не определяет context window модели автоматически.
- **User prompt на плотные кросс-ссылки** в Ingest — прямо кормит BFS.
- **Temperature 0.1–0.3**, structured output retries вверх на слабых локальных моделях.

---

## Без метрик — тюнинг вслепую

- Собрать 30–50 пар «вопрос → эталонная страница».
- Мерить **Recall@k** и **MRR** отдельно для retrieval, отдельно — качество ответа.
- Сравнивать конфиги (dense-only vs гибрид, с rerank и без, depth 1 vs 2) на одном наборе.
- Для JSONL storage есть HLD harness: `scripts/eval-jsonl-domain-storage.ts`. Он безопасно читает HLD-корпус, строит изолированный eval-домен с `metadata.jsonl` / `index.jsonl` / `log.jsonl`, запускает 5 live retrieval queries against `index.jsonl` и пишет отчёт в `docs/superpowers/evals/`. Legacy `Overlap@5` теперь остаётся no-regression guard, а семантическое качество считается по curated gold set `docs/superpowers/evals/hld-gold-set.json`: `Recall@5`, `nDCG@5`, `MRR`.
- HLD harness compares `weighted-lexical`, raw BM25 page/chunk, RRF BM25 variants, and controlled boilerplate demotion factors `0.15`, `0.25`, `0.35`, `0.50`. Current HLD run: 61 pages, 442 chunks, average improved `Overlap@5 = 0.68` against target `0.65`. Gold verdict `accepted`: best variant `weighted-lexical-demoted` with factor `0.15` (`Recall@5 = 0.76`, `nDCG@5 = 0.92`, `MRR = 1.00`). Runtime Query now enables rank-only boilerplate demotion by default with factor `0.15` for generated `template-readme` and `template-hld-*` pages. Raw BM25/RRF remain eval-only because they did not beat weighted lexical; stronger demotion factors reduce legacy overlap and fail guards.

---

## Быстрый референс параметров

| Параметр | Старт | Когда менять |
|---|---|---|
| vector top-k (seeds) | 5–8 | recall низкий → выше, шум → ниже |
| BFS depth | 1 | связанный контекст недобирается → 2 |
| RRF k | 60 | редко трогать |
| rerank → context | top-5–8 | под бюджет токенов |
| similarity порог | подобрать по eval | seeds мусорные → поднять |
| temperature | 0.2 | — |

---

## Если делать одно

**Dedup на Ingest + Lint near-duplicate.** Чистый граф вытягивает и BFS, и seed-выбор разом, без переписывания retrieval. Метрики — чтобы видеть, что именно сработало.
