---
review:
  spec_hash: e167046383a07912
  last_run: 2026-06-02
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "### Fix / ### Root Cause (duplicates)"
      section_hash: fixed
      text: "Duplicate headings ### Fix and ### Root Cause across Fix 1 and Fix 2"
      verdict: fixed
      verdict_at: 2026-06-02
chain:
  intent: null
---

# BFS Scope and Phantom Node Fix

## Overview

Two bugs in query BFS traversal identified via session analysis (`1780382342568`):

1. **Phantom nodes** — dangling `[[link]]` targets appear in `expandedByHop` and inflate `expanded` count, even though they have no corresponding file and are never sent to the LLM.
2. **Fragile `_config` exclusion** — `META_FILES` filters only specific filenames; any new `.md` file added to `_config/` would leak into the BFS graph undetected.

## Session Analysis Report

Session `1780382342568` — `query` op, domain `fin`, 2026-06-02T06:39:02Z.

**Timeline:**

| Phase | Duration | Result |
|---|---|---|
| Read `_index.md` | ~12 ms | 66 annotations |
| Seed selection (embedding) | ~806 ms | 5 seeds |
| Glob `fin/**/*.md` | ~1 ms | 65 pages |
| Read all pages | ~3 ms | 65 loaded |
| BFS expand (depth=1) | <1 ms | 16 expanded (14 real + 2 phantom) |
| LLM answer | ~10.8 s | 985 tokens |
| **Total** | **13.6 s** | done |

**Seed quality:**

| Seed | Score | Relevance |
|---|---|---|
| `wiki_fin_pravilo_treh_svechej` | 0.837 | ✅ direct match |
| `wiki_fin_st_214_12_nk` | 0.836 | ⚠️ financial law, not trading |
| `wiki_fin_rosfinmonitoring` | 0.817 | ⚠️ regulatory, not trading |
| `wiki_fin_impermanent_loss` | 0.816 | ✅ technical finance |
| `wiki_fin_technology_portfolio` | 0.812 | ✅ ok |

Two seeds (`rosfinmonitoring`, `st_214_12_nk`) are likely false positives — the embedding model conflates "financial" with "trading". This is a known embedding quality issue, not a code bug. No fix in this spec.

**BFS expansion (hop 1):**

Real pages (9): `wiki_fin_korrekcija_po_trem_svecham`, `wiki_fin_fifo`, `wiki_fin_3_ndfl`, `wiki_fin_115_fz`, `wiki_fin_uvedomlenie_fns`, `wiki_fin_vneshniy_kontur`, `wiki_fin_puly_likvidnosti`, `wiki_fin_yield_farming`, `wiki_fin_base_portfolio`

Phantom nodes (2): `Трендовые линии`, `Фарминг ликвидности` — dangling `[[links]]` inside seed page content, no matching `.md` file in `fin/`.

**Errors:** 0. **Answer:** correct.

**LLM stats:** 12 343 input tokens, 985 output tokens, TTFT 1954 ms, 91 tok/s out.

## Fix 1: Phantom Nodes in BFS

### Root Cause: phantom nodes

`buildWikiGraph` adds all `[[link]]` targets as forward edges regardless of whether the target page exists. `bfsExpand` / `bfsExpandWithHops` traverse forward edges without checking if the neighbor is a real graph key. Result: dangling refs become "visited" nodes.

Backlink traversal is safe — the reverse index is built from graph keys, so it can only produce real nodes.

### Fix: phantom guard

In `src/wiki-graph.ts`, in both `bfsExpand` and `bfsExpandWithHops`, add `graph.has(neighbor)` guard on forward traversal:

```ts
// Before:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
}

// After:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor) && graph.has(neighbor)) {
    visited.add(neighbor); next.add(neighbor);
  }
}
```

Apply to both `bfsExpand` (forward loop) and `bfsExpandWithHops` (forward loop). Backlink loop unchanged.

**Effect:** `expanded` count reflects only pages with actual files. `byHop` contains no phantom IDs. For session above: `expanded: 16 → 14`.

## Fix 2: `_config` Directory Exclusion

### Root Cause: _config filter

`query.ts` line 99 filters files by filename suffix (`META_FILES`). This covers `_index.md` and `_log.md` but not future files. Any new `.md` added to `_config/` leaks into the BFS graph.

### Fix: path filter

In `src/phases/query.ts`, change the file filter from filename-based to path-based:

```ts
// Before:
const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));

// After:
const files = allFiles.filter(
  (f) => !META_FILES.some((m) => f.endsWith(m)) && !f.includes("/_config/")
);
```

`META_FILES` list stays as-is (still needed to filter root-level meta files in domains that store them without `_config/` subdirectory, if any).

**Effect:** All files under any `_config/` subdirectory are excluded from BFS graph construction. The `_index.md` is still read separately in Phase 1 via `domainIndexPath`.

## Scope

- `src/wiki-graph.ts` — `bfsExpand` and `bfsExpandWithHops` (forward traversal guard)
- `src/phases/query.ts` — file filter (path-based `_config` exclusion)
- Tests: update `wiki-graph` unit tests to assert phantom nodes are not in BFS results; update `query` integration test (if any) to assert `_config/` files excluded

## Out of Scope

- Seed quality / false positive seeds — separate embedding tuning concern
- `lint.ts` and `lint-chat.ts` have their own `META_FILES` — not changed here
