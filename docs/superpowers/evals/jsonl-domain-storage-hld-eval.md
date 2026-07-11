# JSONL Domain Storage HLD Eval

Source: `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`
Eval root: `.jsonl-domain-storage-hld-eval`
Domain root: `.jsonl-domain-storage-hld-eval/!Wiki/hld-jsonl-eval`
Metadata: `.jsonl-domain-storage-hld-eval/!Wiki/hld-jsonl-eval/metadata.jsonl`
Index: `.jsonl-domain-storage-hld-eval/!Wiki/hld-jsonl-eval/index.jsonl`
Log: `.jsonl-domain-storage-hld-eval/!Wiki/hld-jsonl-eval/log.jsonl`
Markdown files: 61
Page records: 61
Chunk records: 442
Aggregate verdict: `needs_tuning`
Average improved Overlap@5: 0.68
Best retrieval variant: `weighted-lexical`
Aggregate gold Recall@5: 0.76
Aggregate gold nDCG@5: 0.91
Aggregate gold MRR: 1.00

## Retrieval variants
| Variant | Recall@5 | nDCG@5 | MRR | LegacyOverlap@5 | Accepted |
| --- | ---: | ---: | ---: | ---: | --- |
| weighted-lexical | 0.76 | 0.91 | 1.00 | 0.68 | yes |
| bm25-page | 0.56 | 0.72 | 0.90 | 0.56 | no |
| bm25-chunk | 0.60 | 0.77 | 1.00 | 0.64 | yes |
| rrf-weighted-bm25 | 0.64 | 0.77 | 1.00 | 0.64 | yes |
| rrf-weighted-bm25-legacy | 0.64 | 0.78 | 1.00 | 0.64 | yes |

## Queries
### data-export-s3-clickhouse
Theme: data export / S3 / ClickHouse
Question: Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?
Status: accepted
Latency: 144 ms
Baseline Overlap@5: 0.40
Improved Overlap@5: 0.40
Delta: +0.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/отчетность-бти.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/скит.md`
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md`
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md`
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md`
Variants:
- `weighted-lexical`: Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `bm25-page`: Recall@5 0.40, nDCG@5 0.61, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `bm25-chunk`: Recall@5 0.40, nDCG@5 0.57, MRR 1.00, LegacyOverlap@5 0.60, accepted yes
- `rrf-weighted-bm25`: Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `rrf-weighted-bm25-legacy`: Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (lead) — 1.329
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` ## 3. Архитектура решения — 1.143
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` ## 1. Контекст и цель — 1.143
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` ## 1. Контекст и цель — 1.143
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` ## 2. Требования — 1.143

### airflow-ha-balancing
Theme: Airflow HA / balancing
Question: Где описана отказоустойчивая архитектура Airflow и какие решения по балансировке указаны?
Status: accepted
Latency: 129 ms
Baseline Overlap@5: 1.00
Improved Overlap@5: 1.00
Delta: +0.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md`
Variants:
- `weighted-lexical`: Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, accepted yes
- `bm25-page`: Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, accepted yes
- `bm25-chunk`: Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, accepted yes
- `rrf-weighted-bm25`: Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, accepted yes
- `rrf-weighted-bm25-legacy`: Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, accepted yes
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` ## Сводка решения — 1.158
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` ## Сводка решения — 1.158
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` ## Архитектура высокого уровня — 1.075
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` ## Сводка решения — 1.046
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` ## Сводка решения — 1.046

### integrations-consumers-marts
Theme: integrations / consumers / data marts
Question: Какие документы описывают интеграции потребителей с витринными БД или дата-мартами?
Status: accepted
Latency: 122 ms
Baseline Overlap@5: 0.40
Improved Overlap@5: 0.40
Delta: +0.00
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `!Wiki/hld-jsonl-eval/pages/rt-datauploader-rt-datauploader-prd.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md`
- `!Wiki/hld-jsonl-eval/pages/саоb2o.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`
Variants:
- `weighted-lexical`: Recall@5 0.80, nDCG@5 0.95, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `bm25-page`: Recall@5 0.60, nDCG@5 0.80, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `bm25-chunk`: Recall@5 0.60, nDCG@5 0.86, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `rrf-weighted-bm25`: Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
- `rrf-weighted-bm25-legacy`: Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, accepted yes
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (lead) — 1.033
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (lead) — 0.689
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` ## 9. Определения и сокращения — 0.550
- `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` ## 9. Определения и сокращения — 0.550
- `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (lead) — 0.533

### migration-gitflame
Theme: source-system migration / GitFlame
Question: Что известно о миграции на GitFlame и связанных архитектурных ограничениях?
Status: accepted
Latency: 123 ms
Baseline Overlap@5: 0.60
Improved Overlap@5: 0.80
Delta: +0.20
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md`
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md`
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
Variants:
- `weighted-lexical`: Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, accepted yes
- `bm25-page`: Recall@5 0.40, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.40, accepted no
- `bm25-chunk`: Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, accepted yes
- `rrf-weighted-bm25`: Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, accepted yes
- `rrf-weighted-bm25-legacy`: Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, accepted yes
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Техническое задание: Проектирование и внедрение GitFlame для замены SVN — 1.443
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Техническое задание: Проектирование и внедрение GitFlame для замены SVN — 1.300
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Техническое задание: Проектирование и внедрение GitFlame для замены SVN — 1.300
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Техническое задание: Проектирование и внедрение GitFlame для замены SVN — 1.071
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` ## Техническое задание: Проектирование и внедрение GitFlame для замены SVN — 0.929

### ownership-components
Theme: architecture ownership / components
Question: Какие HLD фиксируют состав архитектурных компонентов и зоны ответственности проектов?
Status: accepted
Latency: 111 ms
Baseline Overlap@5: 0.20
Improved Overlap@5: 0.80
Delta: +0.60
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md`
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md`
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md`
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md`
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md`
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md`
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md`
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`
Variants:
- `weighted-lexical`: Recall@5 0.60, nDCG@5 0.78, MRR 1.00, LegacyOverlap@5 0.80, accepted yes
- `bm25-page`: Recall@5 0.40, nDCG@5 0.42, MRR 0.50, LegacyOverlap@5 0.60, accepted yes
- `bm25-chunk`: Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, accepted yes
- `rrf-weighted-bm25`: Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, accepted yes
- `rrf-weighted-bm25-legacy`: Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, accepted yes
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` ## Вопросы бизнесу — 0.636
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` ## Архитектура (HLD) и Интеграции — 0.636
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` ## Архитектура — 0.457
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` ## Итоговые решения (05.02.2026) — 0.193
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` ## 1. Контекст и цель — 0.193

## Decision
JSONL format works, but one or more queries need retrieval tuning before acceptance.

Regressions:
- no accepted variant improved aggregate gold metrics versus weighted-lexical
