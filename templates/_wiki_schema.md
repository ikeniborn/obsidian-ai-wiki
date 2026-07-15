# Wiki Schema

## Language and style
- Primary language: follow the configured output-language directive (from settings); when it is "auto", match the source/article language.
- The output language applies to ALL natural-language text, including content copied from the source: table cell values, field values (prompt, expected, notes, descriptions), list items, and quoted sentences. These are content — translate them. A full sentence in another language (incl. CJK) is never a "term".
- Verbatim preservation is ONLY for: fenced code blocks, file paths, identifiers, commands, URLs, proper names, and `[[wiki-link]]` targets (they are filenames — never translate a link target).
- Do not translate technical terms: SQL, API, LLM, ETL, SCD, TTL, DDL, JSON, YAML
- System names — keep the original spelling (RT.DataExporter, CRM B2C, ЦХД)
- Expand abbreviations on first use on the page
- Style: neutral, informative, no value judgements
- Forbidden: "Obviously...", "The best way...", the pronouns "I", "we", "our"

## File and folder naming
- Files: kebab-case, Cyrillic allowed, no spaces or special characters except the hyphen
  - Examples: `версионирование-scd.md`, `clickhouse-обзор.md`
- Domain folders: lowercase, Latin script (`ai/`, `databases/`)
- H1 heading: the page title in the configured output language; a technical term in parentheses when needed

{{section_conventions}}

## Frontmatter

| Field | Rule |
|------|---------|
| `type` | Entity type — the page's entity-type subdirectory (e.g. `concept`, or one of the domain's configured entity types). Set once when the page is created; do not change on update. |
| `description` | One-line overview of the page (plain text, no line breaks). This is the sole source of the retrieval overview embedding — keep it accurate and current. |
| `resource` | YAML list of plain source-note stems — no `[[ ]]`, no folder path: `["source-a", "source-b"]`. On UPDATE — add, do not remove. |
| `timestamp` | YYYY-MM-DD |
| `tags` | YAML list: `[category/subcategory, domain/topic]`. Hierarchy via `/`, lowercase, no spaces, no `#`. Reuse tags from existing domain pages; create new ones following the same scheme. Obsidian recognizes the `tags` key automatically — do not set the type explicitly. |
| `status` | `stub` (<2 sources, <10 sentences) / `developing` (≥2 sources, ≥10 sentences, main sections filled in) / `mature` (≥4 sources, all sections) |
| `aliases` | Abbreviations, English variants, synonyms |

## Common mistakes (forbidden)

| Mistake | Why it is bad | Correct |
|--------|-------------|-----------|
| `tags: - "[[wiki_fin_...]]"` | A WikiLink is not a tag; the validator will remove it | Put it as a `- [[stem]]` bullet under `## Related` |
| `tags: - {type: ..., name: ...}` | tags — strings only | `tags: - finance/technical-analysis` |
| `resource: ["[[source-a]]"]` | `resource` holds plain stems, not WikiLinks | `resource: ["source-a"]` |
| A link in the body with no matching bullet under `## Related` / `## External links` | The retrieval graph and reference list miss the connection | Add `- [[stem]]` (outgoing) or `- [text](url)` (external) under the matching heading |

## WikiLinks

- Only `[[page-name]]` — no aliases, no folder paths
- ❌ Forbidden: `[[Page|alias]]`, `[[folder/page]]`
- ✅ Correct: `[[page-name]]`, `[[Кириллица]]`, `[[Scalability]]`
- Link only to existing pages; dead links yield a warning

## Source, related, and external links (body sections, not frontmatter)

Links live in body sections, one bullet per line — never in frontmatter:

- `## Sources` — the source note(s) this page was extracted from, as WikiLinks. Same bare stems as the `resource` frontmatter; the ingest pipeline injects this section from `resource`:
  ```markdown
  ## Sources

  - [[source-note]]
  ```
- `## Related` — WikiLinks to other wiki pages:
  ```markdown
  ## Related

  - [[page-a]]
  - [[page-b]]
  ```
- `## External links` — external URLs, `[text](url)`:
  ```markdown
  ## External links

  - [Example docs](https://example.com/docs)
  ```

All three headings are fixed English literals — do not translate or localize them, even when the page body is in another language. `## Related` and `## External links` are reference data excluded from retrieval embeddings; `## Sources` IS embedded, so the wiki→source connection stays searchable as well as navigable.

## Content
- Synthesis, not copying — rework the information from the sources
- Verbatim quotes only in code blocks (SQL, configurations)
- Forbidden: placeholder text (TODO, "see source"), empty sections, removing existing information
- Tables: markdown with alignment (`| Parameter | Value |` + `|----------|----------|`)
- Code blocks: always specify the language (` ```sql `, ` ```yaml `, ` ```json `)
