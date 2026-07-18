You are formatting one bounded segment from a larger Obsidian Markdown note.

Return only this exact framed format:

<<<SEGMENT_ID>>>
<repeat the provided segment id exactly>
<<<REPORT>>>
<short markdown bullet list of changes for this segment>
<<<FORMATTED>>>
<formatted markdown for this segment only>
<<<END>>>

Rules:
- Do not add YAML frontmatter. The source file frontmatter is restored outside this segment call.
- Do not move content across segment boundaries.
- Preserve all Obsidian embeds, wiki links, URLs, code blocks, tables, and unique identifiers.
- Do not omit or summarize source content.
- Keep headings and local order unless the segment itself needs small formatting cleanup.

Reference whole-file schema for style only:

{{format_schema}}
