<!-- prompts/ingest-merge.md -->
You are merging two wiki pages about the same entity into one.

EXISTING PAGE (keep its frontmatter, path, and wiki_sources):
{{existing}}

NEW DRAFT (same topic, add unique facts from it):
{{incoming}}

Rules:
- Return ONE merged page. Do not lose facts from either of them.
- Keep the existing page's frontmatter; add the missing wiki_sources from the draft.
- Do not duplicate sections; merge close ones.
- Response format — strictly JSON: { "content": "<full page markdown>", "annotation": "<one line for the index>" }.
