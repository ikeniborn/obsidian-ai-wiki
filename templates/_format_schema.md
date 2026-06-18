# Format Schema (formatting rules for non-wiki pages)

## Frontmatter

| Field | Rule |
|------|---------|
| `tags` | YAML list: `[category/subcategory, domain/topic]`. Hierarchy via `/`, lowercase, no spaces, no `#`. Reuse tags from existing pages; create new ones following the same scheme. Only when a thematic classification exists. |
| `aliases` | Abbreviations, synonyms, English variants |
| `created` | YYYY-MM-DD when present in the source or at first formatting |
| `updated` | YYYY-MM-DD the current formatting date |
| `external_links` | Array of URLs — only if the body has `http(s)://` links |
| `related` | Array of `[[wikilinks]]` — only if the body already contains links to other pages |

The `wiki_*` fields — do not include them in the output. They are managed programmatically and will be restored automatically.

If the source frontmatter is broken — missing or duplicated `---` fences, invalid YAML, or fields placed outside a fenced block — rebuild it into a single valid YAML frontmatter block, preserving the real field values (excluding the `wiki_*` fields, which are managed separately). Never emit two `---` fences in a row or leave frontmatter keys in the body.

## Structure

- H1 — the page title
- Intro paragraph 1-3 sentences immediately after H1, without a subheading
- `##` sections by content logic; hierarchy without jumps (H2 → H3 → H4)
- Empty sections and placeholder text are forbidden

## Tables

Markdown with alignment. Use for structured enumerations of parameters/comparisons. Do not turn narrative text into tables.

## Mermaid

` ```mermaid ` blocks for processes, sequences, relationships.
- Processes described in text → flowchart/sequenceDiagram
- Content of diagrams from images (vision backend only) → a separate mermaid block below the image. The image itself is preserved.

## Images

- Each image gets a descriptive caption directly below it
- When `has_vision=true`: an additional text description. For diagrams/schemes — a structured logical description of the meaning (purpose, components, how the flow is connected), not a verbatim transcription of elements; below, when needed, a mermaid block (process/architecture) or a table (grid/matrix). For other images — coherent text or a parameter table.
- When `has_vision=false`: use only alt and existing captions; do not invent new information

## Code

Fenced blocks always with a language tag.

## Style

- Neutral, informative, no value judgements
- Technical terms — original spelling (SQL, API, LLM)
- Forbidden: "obviously", "the best way", the pronouns "I/we/our"

## Hard prohibitions

- Do not add facts absent from the source (exception: text extraction from images when `has_vision=true`)
- Do not remove facts
- Do not distort the meaning; rephrasing for clarity is allowed
- List all changes in `report`
