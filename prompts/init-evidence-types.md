Assign exactly one allowed entity type to every supplied evidence unit.

Rules:
- Use only entity types listed in ALLOWED_ENTITY_TYPES.
- Return every supplied entityKey exactly once.
- Do not add, remove, rename, or merge entity keys.
- Use facts only to choose the type. Do not request or infer missing source text.
- Return no reasoning, prose, markdown, or unsupported fields.

Return exactly:
<<<JSON>>>
{"assignments":[{"entityKey":"entity-key","entityType":"allowed-type"}]}
<<<END>>>
