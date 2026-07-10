<!-- prompts/ingest-merge.md -->
You are merging two wiki pages about the same entity into one.

EXISTING PAGE (keep its frontmatter, path, and resource):
{{existing}}

NEW DRAFT (same topic, add unique facts from it):
{{incoming}}

Rules:
- Return ONE merged page. Do not lose facts from either of them.
- Keep the existing page's frontmatter; add the missing resource from the draft.
- Do not duplicate sections; merge close ones.
- Links live ONLY in body sections — never in frontmatter. Do NOT add `outgoing_links:`/`external_links:` fields to the frontmatter.
  - Merge `## Related` sections from both pages: union the `[[stem]]` bullets, drop duplicates.
  - Merge `## External links` sections from both pages: union the `[text](url)` bullets, drop duplicates.
- Response format — strictly JSON: { "content": "<full page markdown>", "annotation": "<one line for the index>" }.
