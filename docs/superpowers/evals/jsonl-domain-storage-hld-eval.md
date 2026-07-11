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
Aggregate verdict: `accepted`
Average improved Overlap@5: 0.68
Best retrieval variant: `weighted-lexical-demoted`
Demotion factor: 0.15
Aggregate gold Recall@5: 0.76
Aggregate gold nDCG@5: 0.92
Aggregate gold MRR: 1.00
Setting recommendation: `candidate: 0.15`

## Retrieval variants
| Variant | Factor | Recall@5 | nDCG@5 | MRR | LegacyOverlap@5 | Top-1 boilerplate | Accepted | Guard reasons |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| weighted-lexical | - | 0.76 | 0.91 | 1.00 | 0.68 | no | yes | - |
| bm25-page | - | 0.56 | 0.72 | 0.90 | 0.56 | yes | no | legacy overlap 0.40 < floor 0.60; top-1 boilerplate |
| bm25-chunk | - | 0.60 | 0.77 | 1.00 | 0.64 | no | yes | - |
| rrf-weighted-bm25 | - | 0.64 | 0.77 | 1.00 | 0.64 | no | yes | - |
| rrf-weighted-bm25-legacy | - | 0.64 | 0.78 | 1.00 | 0.64 | no | yes | - |
| weighted-lexical-demoted | 0.15 | 0.76 | 0.92 | 1.00 | 0.60 | no | yes | - |
| rrf-weighted-bm25-demoted | 0.15 | 0.64 | 0.78 | 1.00 | 0.56 | no | no | legacy overlap 0.20 < floor 0.40 |
| rrf-weighted-bm25-legacy-demoted | 0.15 | 0.64 | 0.80 | 1.00 | 0.60 | no | yes | - |
| weighted-lexical-demoted | 0.25 | 0.76 | 0.92 | 1.00 | 0.52 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-demoted | 0.25 | 0.64 | 0.78 | 1.00 | 0.48 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-legacy-demoted | 0.25 | 0.64 | 0.80 | 1.00 | 0.56 | no | yes | - |
| weighted-lexical-demoted | 0.35 | 0.76 | 0.92 | 1.00 | 0.52 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-demoted | 0.35 | 0.64 | 0.78 | 1.00 | 0.48 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-legacy-demoted | 0.35 | 0.64 | 0.80 | 1.00 | 0.52 | no | no | legacy overlap 0.40 < floor 0.60 |
| weighted-lexical-demoted | 0.50 | 0.76 | 0.92 | 1.00 | 0.52 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-demoted | 0.50 | 0.64 | 0.78 | 1.00 | 0.48 | no | no | legacy overlap 0.20 < floor 0.40; legacy overlap 0.40 < floor 0.60 |
| rrf-weighted-bm25-legacy-demoted | 0.50 | 0.64 | 0.80 | 1.00 | 0.52 | no | no | legacy overlap 0.40 < floor 0.60 |

## Queries
### data-export-s3-clickhouse
Theme: data export / S3 / ClickHouse
Question: Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?
Status: accepted
Latency: 156 ms
Baseline Overlap@5: 0.40
Improved Overlap@5: 0.40
Delta: +0.00
Top-1 boilerplate: no
Gold labels:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-s3-download-links-guide.md` (gold grade 1)
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/отчетность-бти.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/скит.md` (gold grade 0)
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 0)
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
Variants:
- `weighted-lexical`: factor -, Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `bm25-page`: factor -, Recall@5 0.40, nDCG@5 0.61, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/crm-b2c.md` (gold grade 0)
- `bm25-chunk`: factor -, Recall@5 0.40, nDCG@5 0.57, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
- `rrf-weighted-bm25`: factor -, Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy`: factor -, Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `weighted-lexical-demoted`: factor 0.15, Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `rrf-weighted-bm25-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `weighted-lexical-demoted`: factor 0.25, Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `rrf-weighted-bm25-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `weighted-lexical-demoted`: factor 0.35, Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `rrf-weighted-bm25-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `weighted-lexical-demoted`: factor 0.50, Recall@5 0.80, nDCG@5 0.88, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-clickhouse-s3-storage-optimize-fix.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
- `rrf-weighted-bm25-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.65, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.63, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/экспорт-в-слой-распространения-s3.md` (gold grade 3)
Variants vs weighted-lexical:
- `bm25-page`: ΔRecall@5 -0.40, ΔnDCG@5 -0.27, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `bm25-chunk`: ΔRecall@5 -0.40, ΔnDCG@5 -0.32, ΔMRR +0.00, ΔLegacyOverlap@5 +0.20
- `rrf-weighted-bm25`: ΔRecall@5 -0.20, ΔnDCG@5 -0.23, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy`: ΔRecall@5 -0.20, ΔnDCG@5 -0.25, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.23, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.25, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.23, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.25, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.23, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.25, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.23, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.25, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
BM25 contribution:
- best BM25-family variant `rrf-weighted-bm25`: ΔnDCG@5 -0.23, ΔRecall@5 -0.20
Demotion contribution:
- `weighted-lexical-demoted` factor 0.15: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.15: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.15: no top-5 movement
- `weighted-lexical-demoted` factor 0.25: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.25: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.25: no top-5 movement
- `weighted-lexical-demoted` factor 0.35: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.35: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.35: no top-5 movement
- `weighted-lexical-demoted` factor 0.50: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.50: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.50: no top-5 movement
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
Latency: 144 ms
Baseline Overlap@5: 1.00
Improved Overlap@5: 1.00
Delta: +0.00
Top-1 boilerplate: no
Gold labels:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 0)
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Variants:
- `weighted-lexical`: factor -, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `bm25-page`: factor -, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `bm25-chunk`: factor -, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25`: factor -, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-legacy`: factor -, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `weighted-lexical-demoted`: factor 0.15, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-demoted`: factor 0.15, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.15, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `weighted-lexical-demoted`: factor 0.25, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-demoted`: factor 0.25, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.25, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `weighted-lexical-demoted`: factor 0.35, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-demoted`: factor 0.35, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.35, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `weighted-lexical-demoted`: factor 0.50, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-demoted`: factor 0.50, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.50, Recall@5 1.00, nDCG@5 1.00, MRR 1.00, LegacyOverlap@5 1.00, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v1.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v2.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v3.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-ha-architecture-v4.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-balancing-analysis.md` (gold grade 2)
Variants vs weighted-lexical:
- `bm25-page`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `bm25-chunk`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
BM25 contribution:
- best BM25-family variant `bm25-page`: ΔnDCG@5 +0.00, ΔRecall@5 +0.00
Demotion contribution:
- `weighted-lexical-demoted` factor 0.15: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.15: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.15: no top-5 movement
- `weighted-lexical-demoted` factor 0.25: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.25: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.25: no top-5 movement
- `weighted-lexical-demoted` factor 0.35: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.35: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.35: no top-5 movement
- `weighted-lexical-demoted` factor 0.50: no top-5 movement
- `rrf-weighted-bm25-demoted` factor 0.50: no top-5 movement
- `rrf-weighted-bm25-legacy-demoted` factor 0.50: no top-5 movement
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
Latency: 129 ms
Baseline Overlap@5: 0.40
Improved Overlap@5: 0.40
Delta: +0.00
Top-1 boilerplate: no
Gold labels:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-minio-clickhouse-superset.md` (gold grade 1)
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-datauploader-rt-datauploader-prd.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
Variants:
- `weighted-lexical`: factor -, Recall@5 0.80, nDCG@5 0.95, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
- `bm25-page`: factor -, Recall@5 0.60, nDCG@5 0.80, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `bm25-chunk`: factor -, Recall@5 0.60, nDCG@5 0.86, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
- `rrf-weighted-bm25`: factor -, Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
- `rrf-weighted-bm25-legacy`: factor -, Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.15, Recall@5 0.80, nDCG@5 0.97, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.25, Recall@5 0.80, nDCG@5 0.97, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.35, Recall@5 0.80, nDCG@5 0.97, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.50, Recall@5 0.80, nDCG@5 0.97, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.75, MRR 1.00, LegacyOverlap@5 0.20, Top-1 boilerplate no, accepted no, guards legacy overlap 0.20 < floor 0.40
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/саоb2o.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.85, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/интеграция-дзо-с-витринными-бд.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 0)
Variants vs weighted-lexical:
- `bm25-page`: ΔRecall@5 -0.20, ΔnDCG@5 -0.15, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `bm25-chunk`: ΔRecall@5 -0.20, ΔnDCG@5 -0.09, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25`: ΔRecall@5 -0.20, ΔnDCG@5 -0.20, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy`: ΔRecall@5 -0.20, ΔnDCG@5 -0.10, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.02, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.20, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.10, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.02, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.20, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.10, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.02, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.20, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.10, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.02, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.20, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.10, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
BM25 contribution:
- best BM25-family variant `bm25-chunk`: ΔnDCG@5 -0.09, ΔRecall@5 -0.20
Demotion contribution:
- `weighted-lexical-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` -> `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md`
- `rrf-weighted-bm25-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`; `!Wiki/hld-jsonl-eval/pages/саоb2o.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `weighted-lexical-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`
- `rrf-weighted-bm25-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`; `!Wiki/hld-jsonl-eval/pages/саоb2o.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `weighted-lexical-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`
- `rrf-weighted-bm25-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`; `!Wiki/hld-jsonl-eval/pages/саоb2o.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
- `weighted-lexical-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-с-gus.md` -> `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md`; `!Wiki/hld-jsonl-eval/pages/интеграция-rt-dv.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`
- `rrf-weighted-bm25-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/саоb2o.md`; `!Wiki/hld-jsonl-eval/pages/саоb2o.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md`
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
Latency: 128 ms
Baseline Overlap@5: 0.60
Improved Overlap@5: 0.80
Delta: +0.20
Top-1 boilerplate: no
Gold labels:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-rt-widestore-hld.md` (gold grade 1)
- `!Wiki/hld-jsonl-eval/pages/rt-lakestore-rt-lakestore-arch.md` (gold grade 1)
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v3-full.md` (gold grade 0)
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
Variants:
- `weighted-lexical`: factor -, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `bm25-page`: factor -, Recall@5 0.40, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 0)
- `bm25-chunk`: factor -, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `rrf-weighted-bm25`: factor -, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `rrf-weighted-bm25-legacy`: factor -, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.80, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.93, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted no, guards legacy overlap 0.40 < floor 0.60
  - `!Wiki/hld-jsonl-eval/pages/миграция-на-gitflame.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-widestore-join-clickhouse-etl-join-analysis.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md` (gold grade 0)
Variants vs weighted-lexical:
- `bm25-page`: ΔRecall@5 -0.20, ΔnDCG@5 -0.13, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `bm25-chunk`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `rrf-weighted-bm25-legacy`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 +0.00
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.00, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
BM25 contribution:
- best BM25-family variant `bm25-chunk`: ΔnDCG@5 +0.00, ΔRecall@5 +0.00
Demotion contribution:
- `weighted-lexical-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `rrf-weighted-bm25-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`
- `weighted-lexical-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md`
- `rrf-weighted-bm25-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `weighted-lexical-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md`
- `rrf-weighted-bm25-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `weighted-lexical-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-ппа-hld.md`
- `rrf-weighted-bm25-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-hld.md`
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
Latency: 123 ms
Baseline Overlap@5: 0.20
Improved Overlap@5: 0.80
Delta: +0.60
Top-1 boilerplate: no
Gold labels:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-rt-dataexporter-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 2)
Baseline top:
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 2)
Legacy JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
Improved page top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-hld-v1-lean.md` (gold grade 0)
Improved chunk top:
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
JSONL retrieval top:
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
- `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
Variants:
- `weighted-lexical`: factor -, Recall@5 0.60, nDCG@5 0.78, MRR 1.00, LegacyOverlap@5 0.80, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
- `bm25-page`: factor -, Recall@5 0.40, nDCG@5 0.42, MRR 0.50, LegacyOverlap@5 0.60, Top-1 boilerplate yes, accepted no, guards top-1 boilerplate
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/цхд-2-спецификации-одс.md` (gold grade 0)
- `bm25-chunk`: factor -, Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-rt-dataexporter-prd.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
- `rrf-weighted-bm25`: factor -, Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy`: factor -, Recall@5 0.40, nDCG@5 0.51, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.15, Recall@5 0.60, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.15, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.15, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/template-readme.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.25, Recall@5 0.60, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.25, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.25, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.35, Recall@5 0.60, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.35, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.35, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `weighted-lexical-demoted`: factor 0.50, Recall@5 0.60, nDCG@5 0.79, MRR 1.00, LegacyOverlap@5 0.60, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
- `rrf-weighted-bm25-demoted`: factor 0.50, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
- `rrf-weighted-bm25-legacy-demoted`: factor 0.50, Recall@5 0.40, nDCG@5 0.58, MRR 1.00, LegacyOverlap@5 0.40, Top-1 boilerplate no, accepted yes
  - `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` (gold grade 2)
  - `!Wiki/hld-jsonl-eval/pages/су-ноп.md` (gold grade 3)
  - `!Wiki/hld-jsonl-eval/pages/etl-hive.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` (gold grade 0)
  - `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md` (gold grade 0)
Variants vs weighted-lexical:
- `bm25-page`: ΔRecall@5 -0.20, ΔnDCG@5 -0.36, ΔMRR -0.50, ΔLegacyOverlap@5 -0.20
- `bm25-chunk`: ΔRecall@5 -0.20, ΔnDCG@5 -0.28, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25`: ΔRecall@5 -0.20, ΔnDCG@5 -0.28, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy`: ΔRecall@5 -0.20, ΔnDCG@5 -0.28, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.01, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.01, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.01, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `weighted-lexical-demoted`: ΔRecall@5 +0.00, ΔnDCG@5 +0.01, ΔMRR +0.00, ΔLegacyOverlap@5 -0.20
- `rrf-weighted-bm25-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
- `rrf-weighted-bm25-legacy-demoted`: ΔRecall@5 -0.20, ΔnDCG@5 -0.21, ΔMRR +0.00, ΔLegacyOverlap@5 -0.40
BM25 contribution:
- best BM25-family variant `rrf-weighted-bm25-demoted`: ΔnDCG@5 -0.21, ΔRecall@5 -0.20
Demotion contribution:
- `weighted-lexical-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`; `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `rrf-weighted-bm25-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` -> `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.15: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`; `!Wiki/hld-jsonl-eval/pages/etl-hive.md` -> `!Wiki/hld-jsonl-eval/pages/template-readme.md`
- `weighted-lexical-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`; `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `rrf-weighted-bm25-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.25: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`; `!Wiki/hld-jsonl-eval/pages/etl-hive.md` -> `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`; `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `weighted-lexical-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`; `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `rrf-weighted-bm25-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.35: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`; `!Wiki/hld-jsonl-eval/pages/etl-hive.md` -> `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`; `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `weighted-lexical-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md`; `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
- `rrf-weighted-bm25-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md`; `!Wiki/hld-jsonl-eval/pages/сип-сип-draft.md` -> `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md`; `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-hld.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`
- `rrf-weighted-bm25-legacy-demoted` factor 0.50: `!Wiki/hld-jsonl-eval/pages/template-readme.md` -> `!Wiki/hld-jsonl-eval/pages/су-ноп.md`; `!Wiki/hld-jsonl-eval/pages/су-ноп.md` -> `!Wiki/hld-jsonl-eval/pages/etl-hive.md`; `!Wiki/hld-jsonl-eval/pages/etl-hive.md` -> `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md`; `!Wiki/hld-jsonl-eval/pages/сип-саммари-siplr-564-datadev-803.md` -> `!Wiki/hld-jsonl-eval/pages/rt-dataexporter-airflow-calculator-methodology.md`
Top chunks:
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` ## Вопросы бизнесу — 0.636
- `!Wiki/hld-jsonl-eval/pages/ппа-clickstream-ппа-clickstream-draft.md` ## Архитектура (HLD) и Интеграции — 0.636
- `!Wiki/hld-jsonl-eval/pages/су-ноп.md` ## Архитектура — 0.457
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-draft.md` ## Итоговые решения (05.02.2026) — 0.193
- `!Wiki/hld-jsonl-eval/pages/1лтп-1лтп-hld.md` ## 1. Контекст и цель — 0.193

## Decision
JSONL eval domain was built in isolation, five live retrieval queries ran against `index.jsonl`, and no retrieval regressions were detected against the lexical baseline.
