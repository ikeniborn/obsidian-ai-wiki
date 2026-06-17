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
| `wiki_sources` | Array of real paths from the repository root. Read files only. On UPDATE — add, do not remove. Obsidian property type: **Links** (not list/text) — only then do the links participate in Graph View. Values must be in the `[[page-name]]` format: `["[[page-a]]", "[[page-b]]"] |
| `wiki_updated` | YYYY-MM-DD |
| `wiki_status` | `stub` (<2 sources, <10 sentences) / `developing` (≥2 sources, ≥10 sentences, main sections filled in) / `mature` (≥4 sources, all sections) |
| `wiki_type` | File type: `page \| index \| log \| schema`. Only for service files (`_index.md`, `_log.md`, `_wiki_schema.md`). Regular pages do not set this field. |
| `tags` | YAML list: `[category/subcategory, domain/topic]`. Hierarchy via `/`, lowercase, no spaces, no `#`. Reuse tags from existing domain pages; create new ones following the same scheme. Obsidian recognizes the `tags` key automatically — do not set the type explicitly. |
| `aliases` | Abbreviations, English variants, synonyms |
| `wiki_outgoing_links` | Array of WikiLinks to related pages. Obsidian property type: **Links** (not list/text) — only then do the links participate in Graph View. Values must be in the `[[page-name]]` format: `["[[page-a]]", "[[page-b]]"]`. An empty array is allowed. |
| `wiki_external_links` | Array of external URLs (`http://` or `https://`). They do not form the Obsidian graph — reference resources and documentation only. |

## Common mistakes (forbidden)

| Mistake | Why it is bad | Correct |
|--------|-------------|-----------|
| `tags: - "[[wiki_fin_...]]"` | A WikiLink is not a tag; the validator will remove it | Put it in `wiki_outgoing_links` |
| `tags: - {type: ..., name: ...}` | tags — strings only | `tags: - finance/technical-analysis` |
| `wiki_outgoing_links: ["[[a]]", "[[b]]"]` | Inline JSON is not parsed by the wiki-link-validator | Block list: `- "[[a]]"` on separate lines |
| A link in the body without a record in `wiki_outgoing_links` | The Obsidian graph does not see the connection | Every `[[link]]` in the body → in `wiki_outgoing_links` |

## Forbidden Frontmatter Patterns

| Example | Problem | Fix |
|---------|---------|-----|
| `wiki_sources: ["[[wiki_work_foo]]"]` | Wiki-page stem in sources field | Move to `wiki_outgoing_links` |
| `wiki_outgoing_links: ["[[MyNote]]"]` | Source stem in wiki-links field | Move to `wiki_sources` |

## WikiLinks

- Only `[[page-name]]` — no aliases, no folder paths
- ❌ Forbidden: `[[Page|alias]]`, `[[folder/page]]`
- ✅ Correct: `[[page-name]]`, `[[Кириллица]]`, `[[Scalability]]`
- Link only to existing pages; dead links yield a warning

`wiki_outgoing_links` — YAML block list (not inline JSON):
- ✅ Correct:
  ```yaml
  wiki_outgoing_links:
    - "[[page-a]]"
    - "[[page-b]]"
  ```
- ❌ Forbidden: `wiki_outgoing_links: ["[[page-a]]", "[[page-b]]"]`

`wiki_outgoing_links` MUST contain every `[[link]]` found in the page body.

## Content
- Synthesis, not copying — rework the information from the sources
- Verbatim quotes only in code blocks (SQL, configurations)
- When adding information from a new source — record the date and source in the change-history section (see the section conventions above)
- Forbidden: placeholder text (TODO, "see source"), empty sections, removing existing information
- Tables: markdown with alignment (`| Parameter | Value |` + `|----------|----------|`)
- Code blocks: always specify the language (` ```sql `, ` ```yaml `, ` ```json `)
