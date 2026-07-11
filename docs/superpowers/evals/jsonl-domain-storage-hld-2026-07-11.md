# JSONL Domain Storage HLD Eval

Source: `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`
Markdown files: 61
Aggregate verdict: `needs_tuning`

## Sampled Files
- `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD/!Template/README.md` — 2502 chars
- `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD/!Template/hld-v1-lean.md` — 1953 chars
- `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD/!Template/hld-v2-standard.md` — 4815 chars
- `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD/!Template/hld-v3-full.md` — 7584 chars
- `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD/1ЛТП/1ЛТП DRAFT.md` — 24583 chars

## Queries
### data-export-s3-clickhouse
Theme: data export / S3 / ClickHouse
Question: Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?
Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.

### airflow-ha-balancing
Theme: Airflow HA / balancing
Question: Где описана отказоустойчивая архитектура Airflow и какие решения по балансировке указаны?
Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.

### integrations-consumers-marts
Theme: integrations / consumers / data marts
Question: Какие документы описывают интеграции потребителей с витринными БД или дата-мартами?
Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.

### migration-gitflame
Theme: source-system migration / GitFlame
Question: Что известно о миграции на GitFlame и связанных архитектурных ограничениях?
Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.

### ownership-components
Theme: architecture ownership / components
Question: Какие HLD фиксируют состав архитектурных компонентов и зоны ответственности проектов?
Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.

## Decision
The harness is operational and source-safe, but aggregate verdict remains `needs_tuning` until baseline and live retrieval evidence are captured.
