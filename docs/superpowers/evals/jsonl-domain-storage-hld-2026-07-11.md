# JSONL Domain Storage HLD Eval

Source: `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`
Eval root: `docs/superpowers/evals/jsonl-domain-storage-hld-vault`
Domain root: `docs/superpowers/evals/jsonl-domain-storage-hld-vault/!Wiki/hld-jsonl-eval`
Metadata: `docs/superpowers/evals/jsonl-domain-storage-hld-vault/!Wiki/hld-jsonl-eval/metadata.jsonl`
Index: `docs/superpowers/evals/jsonl-domain-storage-hld-vault/!Wiki/hld-jsonl-eval/index.jsonl`
Log: `docs/superpowers/evals/jsonl-domain-storage-hld-vault/!Wiki/hld-jsonl-eval/log.jsonl`
Markdown files: 61
Page records: 61
Chunk records: 442
Aggregate verdict: `accepted`

## Queries
### data-export-s3-clickhouse
Theme: data export / S3 / ClickHouse
Question: Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?
Status: accepted
Latency: 54 ms
Overlap@5: 0.40
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/отчетность-бти.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/скит.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (lead) — 0.125
- `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` ## 3. Архитектура решения — 0.080
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` ## 3. Архитектура решения — 0.070
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` ## 2. Требования — 0.067
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` ## 3. Архитектура решения — 0.067

### airflow-ha-balancing
Theme: Airflow HA / balancing
Question: Где описана отказоустойчивая архитектура Airflow и какие решения по балансировке указаны?
Status: accepted
Latency: 42 ms
Overlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` ## Сводка решения — 0.133
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` ## Сводка решения — 0.128
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` ## Сводка решения — 0.100
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` ## Архитектура высокого уровня — 0.097
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` ## Сводка решения — 0.093

### integrations-consumers-marts
Theme: integrations / consumers / data marts
Question: Какие документы описывают интеграции потребителей с витринными БД или дата-мартами?
Status: accepted
Latency: 47 ms
Overlap@5: 0.40
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/rt-datauploader-rt-datauploader-prd.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (lead) — 0.231
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (lead) — 0.167
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (lead) — 0.091
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` ## Kafka ЦХД — 0.059
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` ## 9. Определения и сокращения — 0.057

### migration-gitflame
Theme: source-system migration / GitFlame
Question: Что известно о миграции на GitFlame и связанных архитектурных ограничениях?
Status: accepted
Latency: 43 ms
Overlap@5: 0.60
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Контакты — 0.105
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (lead) — 0.100
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Вопросы — 0.095
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Задачи — 0.057
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` ## Архитектура решения — 0.048

### ownership-components
Theme: architecture ownership / components
Question: Какие HLD фиксируют состав архитектурных компонентов и зоны ответственности проектов?
Status: accepted
Latency: 55 ms
Overlap@5: 0.20
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md`
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` ## 2. Архитектура решения — 0.040
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` ## 1. Обзор архитектуры — 0.038
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` ## Оглавление — 0.029
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` ## Основные темы обсуждения — 0.029
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` ## Архитектура — 0.028

## Decision
JSONL eval domain was built in isolation, five live retrieval queries ran against `index.jsonl`, and no retrieval regressions were detected against the lexical baseline.
