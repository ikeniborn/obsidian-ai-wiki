# Reranker Integration HLD Eval

Source: `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`
Eval root: `docs/superpowers/evals/.reranker-integration-hld-eval`
Endpoint: `https://homelab.ikeniborn.ru/litellm/v1/rerank`
Model: `lemonade-reranker-bge-reranker-v2-m3`
Top-K flow: `8 -> 1/25 -> 30 -> 8`
Reranker top N: `30`
Context top N: `8`
Timeout: `800 ms`
Candidate text cap: `120 chars`
Verdict: `accepted`
Best variant: `page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3`

## Aggregate
Markdown files: 61
Baseline: Recall@5 0.80, nDCG@5 0.93, MRR 1.00
Reranked: Recall@5 0.80, nDCG@5 0.93, MRR 1.00
Delta Recall@5: 0.00
Delta nDCG@5: 0.01
Delta MRR: 0.00
p95 rerank latency: 601 ms
p95 latency regression: 601 ms
Successful rerank calls: 5

## Variants
| Variant | Mode | Scope | Alpha | Max promotion | Min gap | Base ratio | Max target | Verdict | Recall@5 | nDCG@5 | MRR | Delta Recall | Delta nDCG | Delta MRR | Blocked reason |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `full-rerank` | full | chunk | - | - | - | - | - | `needs_tuning` | 0.68 | 0.85 | 1.00 | -0.12 | -0.07 | 0.00 | - |
| `guarded-alpha-0.05-cap-0` | guarded | chunk | 0.05 | 0 | - | - | - | `accepted` | 0.80 | 0.93 | 1.00 | 0.00 | 0.00 | 0.00 | - |
| `guarded-alpha-0.05-cap-1` | guarded | chunk | 0.05 | 1 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `guarded-alpha-0.10-cap-1` | guarded | chunk | 0.10 | 1 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `guarded-alpha-0.15-cap-1` | guarded | chunk | 0.15 | 1 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `guarded-alpha-0.25-cap-1` | guarded | chunk | 0.25 | 1 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `guarded-alpha-0.35-cap-1` | guarded | chunk | 0.35 | 1 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `guarded-alpha-0.10-cap-2` | guarded | chunk | 0.10 | 2 | - | - | - | `needs_tuning` | 0.76 | 0.92 | 1.00 | -0.04 | -0.01 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.10` | guarded | page | 0.60 | 1 | 0.10 | - | - | `needs_tuning` | 0.76 | 0.91 | 1.00 | -0.04 | -0.02 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.15` | guarded | page | 0.60 | 1 | 0.15 | - | - | `needs_tuning` | 0.76 | 0.91 | 1.00 | -0.04 | -0.02 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.20` | guarded | page | 0.60 | 1 | 0.20 | - | - | `needs_tuning` | 0.76 | 0.91 | 1.00 | -0.04 | -0.02 | 0.00 | - |
| `page-aware-alpha-0.80-cap-1-gap-0.20` | guarded | page | 0.80 | 1 | 0.20 | - | - | `needs_tuning` | 0.76 | 0.91 | 1.00 | -0.04 | -0.02 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95` | guarded | page | 0.60 | 1 | 0.20 | 0.95 | - | `needs_tuning` | 0.80 | 0.93 | 1.00 | 0.00 | 0.00 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3` | guarded | page | 0.60 | 1 | 0.20 | 0.95 | 2 | `accepted` | 0.80 | 0.93 | 1.00 | 0.00 | 0.01 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.20-base-1.00` | guarded | page | 0.60 | 1 | 0.20 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.30-base-1.00` | guarded | page | 0.60 | 1 | 0.30 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.40-base-1.00` | guarded | page | 0.60 | 1 | 0.40 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.20-base-1.00-top3` | guarded | page | 0.60 | 1 | 0.20 | 1.00 | 2 | `accepted` | 0.80 | 0.93 | 1.00 | 0.00 | 0.00 | 0.00 | - |
| `page-aware-alpha-0.60-cap-1-gap-0.30-base-1.00-top3` | guarded | page | 0.60 | 1 | 0.30 | 1.00 | 2 | `accepted` | 0.80 | 0.93 | 1.00 | 0.00 | 0.00 | 0.00 | - |
| `page-aware-alpha-0.80-cap-1-gap-0.20-base-1.00` | guarded | page | 0.80 | 1 | 0.20 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.80-cap-1-gap-0.30-base-1.00` | guarded | page | 0.80 | 1 | 0.30 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.80-cap-1-gap-0.40-base-1.00` | guarded | page | 0.80 | 1 | 0.40 | 1.00 | - | `needs_tuning` | 0.80 | 0.92 | 1.00 | 0.00 | -0.00 | 0.00 | - |
| `page-aware-alpha-0.80-cap-1-gap-0.20-base-1.00-top3` | guarded | page | 0.80 | 1 | 0.20 | 1.00 | 2 | `accepted` | 0.80 | 0.93 | 1.00 | 0.00 | 0.00 | 0.00 | - |

## Queries
### data-export-s3-clickhouse
Theme: data export / S3 / ClickHouse
Question: Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?
Status: `accepted`
Candidates sent: 30
Rerank latency: 601 ms
Floor: 0.40
Baseline metrics: Recall@5 0.80, nDCG@5 0.90, MRR 1.00
Reranked metrics: Recall@5 0.80, nDCG@5 0.93, MRR 1.00
Baseline LegacyOverlap@5: 1.00
Reranked LegacyOverlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 0)
Reranked top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 0)

### airflow-ha-balancing
Theme: Airflow HA / balancing
Question: Где описана отказоустойчивая архитектура Airflow и какие решения по балансировке указаны?
Status: `accepted`
Candidates sent: 30
Rerank latency: 549 ms
Floor: 1.00
Baseline metrics: Recall@5 1.00, nDCG@5 1.00, MRR 1.00
Reranked metrics: Recall@5 1.00, nDCG@5 1.00, MRR 1.00
Baseline LegacyOverlap@5: 1.00
Reranked LegacyOverlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
Reranked top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)

### integrations-consumers-marts
Theme: integrations / consumers / data marts
Question: Какие документы описывают интеграции потребителей с витринными БД или дата-мартами?
Status: `accepted`
Candidates sent: 22
Rerank latency: 397 ms
Floor: 0.40
Baseline metrics: Recall@5 0.80, nDCG@5 0.97, MRR 1.00
Reranked metrics: Recall@5 0.80, nDCG@5 0.97, MRR 1.00
Baseline LegacyOverlap@5: 1.00
Reranked LegacyOverlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 1)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
Reranked top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 1)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)

### migration-gitflame
Theme: source-system migration / GitFlame
Question: Что известно о миграции на GitFlame и связанных архитектурных ограничениях?
Status: `accepted`
Candidates sent: 30
Rerank latency: 526 ms
Floor: 0.60
Baseline metrics: Recall@5 0.80, nDCG@5 0.97, MRR 1.00
Reranked metrics: Recall@5 0.80, nDCG@5 0.97, MRR 1.00
Baseline LegacyOverlap@5: 1.00
Reranked LegacyOverlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-rt-widestore-hld.md` (gold grade 1)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md` (gold grade 0)
Reranked top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-rt-widestore-hld.md` (gold grade 1)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md` (gold grade 0)

### ownership-components
Theme: architecture ownership / components
Question: Какие HLD фиксируют состав архитектурных компонентов и зоны ответственности проектов?
Status: `accepted`
Candidates sent: 11
Rerank latency: 194 ms
Floor: 0.20
Baseline metrics: Recall@5 0.60, nDCG@5 0.79, MRR 1.00
Reranked metrics: Recall@5 0.60, nDCG@5 0.79, MRR 1.00
Baseline LegacyOverlap@5: 1.00
Reranked LegacyOverlap@5: 1.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/цхд-2-спецификации-одс.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
Reranked top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/цхд-2-спецификации-одс.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)

## Decision
This report is model-on integration evidence for the selected rerank endpoint and model. It does not alter plugin runtime defaults and does not make reranking required for normal plugin use.
The endpoint produced successful rerank calls and passed quality and latency gates.
