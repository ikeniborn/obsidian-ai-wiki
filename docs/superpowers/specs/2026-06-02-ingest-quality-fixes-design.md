---
chain:
  intent: null
review:
  spec_hash: f9cbe480b00bc34c
  last_run: "2026-06-02"
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Problem Summary"
      section_hash: e9956f8d625d3e4f
      text: "Нумерация строк таблицы: 1, 2, 4 — строка #3 отсутствует без пояснения"
      verdict: fixed
      verdict_at: "2026-06-02"
    - id: F-002
      phase: structure
      severity: WARNING
      section: "Document"
      section_hash: f9cbe480b00bc34c
      text: "Порядок секций Fix 1 → Fix 4 → Fix 2 не совпадает с порядком задач в таблице (1, 2, 4) и Implementation Order (1+4, затем 2)"
      verdict: fixed
      verdict_at: "2026-06-02"
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "Success Criteria"
      section_hash: f36b41d04bdf12b2
      text: "Критерий Fix 4 содержит OR: «0 dead links или LLM создаёт stub-страницу» — неясно, какое условие считается успехом"
      verdict: fixed
      verdict_at: "2026-06-02"
---
# Ingest Quality Fixes — Design Spec

**Date:** 2026-06-02  
**Session analysis:** session `1780346144951`, domain `fin`, 24 sources, 66 pages created  
**Scope:** Three targeted fixes for systematic ingest quality issues

---

## Problem Summary

| # | Problem | Frequency | Root Cause |
|---|---------|-----------|------------|
| 1 | Source file names in `wiki_outgoing_links` | 32/66 pages (49%) | LLM puts current source filename as outgoing link |
| 2 | Duplicate `wiki_articles` key in source frontmatter | 2 occurrences | `removeWikiFields` regex fails on some YAML formats |
| 4 | Dead wiki link `[[wiki_fin_proof_of_reserve]]` in chainlink page | 1 occurrence | LLM references entity without creating its page |

*Problem #3 (stale links in existing source frontmatter) is handled by existing `filterStaleWikiLinks` — not a new issue, no fix needed.*

All three are currently caught by validators and auto-repaired, but generate noise and lose link context.

---

## Fix 1 — Prompt: forbid source names in `wiki_outgoing_links`

**File:** `prompts/ingest.md`  
**Location:** After the existing `wiki_outgoing_links:` rule line

**Change:** Append explicit forbidden example immediately after the `wiki_outgoing_links` rule:

```
  ❌ ЗАПРЕЩЕНО: [[ИмяТекущегоИсточника]] или [[ЛюбойДругойФайл-источник]] в wiki_outgoing_links.
     Источник уже записан в wiki_sources — дублировать в outgoing_links не нужно.
     Пример: обрабатываем «Фарминг ликвидности.md» → НЕЛЬЗЯ [[Фарминг ликвидности]] в outgoing_links.
```

**Why it works:** LLM adds source filename because it sees semantic relationship (page is derived from source). Explicit negative example with a concrete filename pattern breaks the association. The rule already exists (`Никогда [[ИмяИсточника]]`) but without a concrete example the model ignores it.

---

## Fix 2 — Code: replace `upsertRawFrontmatter` with yaml-parse approach

**File:** `src/utils/raw-frontmatter.ts`

**Problem:** `removeWikiFields` uses regex to strip `wiki_articles` block before appending new one. Regex can fail when YAML list items lack expected indentation (e.g., after re-serialization by `yaml.stringify` with different indent settings), leaving old `wiki_articles` block → duplicate key.

**Solution:** Replace string-manipulation with parse → mutate → re-serialize:

```typescript
export function upsertRawFrontmatter(
  content: string,
  fields: { wiki_added?: string; wiki_updated: string; wiki_articles: string[] },
): string {
  const match = FM_RE.exec(content);
  const body = match ? content.slice(match[0].length) : content;

  let existing: Record<string, unknown> = {};
  if (match) {
    try {
      existing = (yamlParse(match[1]) as Record<string, unknown>) ?? {};
    } catch { /* malformed YAML — start fresh */ }
  }

  // Preserve wiki_added from existing if caller didn't supply one
  const wikiAdded =
    fields.wiki_added ??
    (typeof existing.wiki_added === "string" ? existing.wiki_added : undefined);

  // Strip wiki-managed fields, keep everything else
  const { wiki_added: _a, wiki_updated: _u, wiki_articles: _ar, ...rest } =
    existing as Record<string, unknown>;
  void _a; void _u; void _ar;

  // Rebuild: user fields first, wiki fields at end (stable order)
  const result: Record<string, unknown> = { ...rest };
  if (wikiAdded !== undefined) result.wiki_added = wikiAdded;
  result.wiki_updated = fields.wiki_updated;
  if (fields.wiki_articles.length > 0) result.wiki_articles = fields.wiki_articles;

  return `---\n${yamlStringify(result)}---\n${body}`;
}
```

**Delete:** `buildWikiFields` and `removeWikiFields` — only used inside `upsertRawFrontmatter`.

**Formatting note:** `yamlStringify` normalizes all source frontmatter fields. This is already happening via `validateAndRepairSourceFrontmatter` (called immediately after), so no new regression.

---

## Fix 4 — Prompt: forbid dead wiki links

**File:** `prompts/ingest.md`  
**Location:** End of the ПРАВИЛА section (before ПРАВИЛО ПУТЕЙ)

**Change:** Add new rule:

```
- МЁРТВЫЕ ССЫЛКИ: каждый [[wiki_domain_slug]] в wiki_outgoing_links и в теле статьи обязан
  либо существовать среди «Существующих wiki-страниц» (переданы в контексте), либо
  присутствовать в списке pages этого ответа. Нет страницы — не пиши ссылку.
```

**Why it works:** LLM referenced `[[wiki_fin_proof_of_reserve]]` because Proof of Reserve is mentioned in the Chainlink article body and it correctly inferred a wiki link should exist — but didn't create the page. Explicit rule forces LLM to choose: create page OR omit link.

---

## Implementation Order

1. `prompts/ingest.md` — Fix 1 + Fix 4 (single commit, low risk)
2. `src/utils/raw-frontmatter.ts` — Fix 2 (separate commit, requires test verification)

---

## Success Criteria

| Fix | Verification |
|-----|-------------|
| Fix 1 | Next ingest session: 0 `Frontmatter repaired` events with `non-wiki stem` in details |
| Fix 2 | 0 `Duplicate key "wiki_articles"` warnings in source frontmatter repair events |
| Fix 4 | 0 `dead link [[wiki_fin_*]]` WikiLink warnings post-ingest; any referenced entity must either have a wiki page or be absent from `wiki_outgoing_links` |

---

## Out of Scope

- Embedding retrieval rate (15.1%) — expected cold-start behavior, not a bug
- Stale links in existing source frontmatter — handled by existing `filterStaleWikiLinks`, not a new issue
- Zero-retrieval search events — expected when entity pool is empty at session start
