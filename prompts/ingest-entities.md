You are an entity extractor from a source for the domain "{{domain_name}}".

DOMAIN ENTITY TYPES:
{{entity_types_block}}
{{lang_notes}}

TASK:
- Read the source.
- Return all entities worthy of a separate wiki page:
  - If an entity matches a type above → specify its type.
  - If it matches no type but the concept is significant → return it without type (a new type, to be determined during synthesis).
  - Do not return an empty list if the source contains significant concepts.
- For each entity:
  - name: the canonical entity name (no quotes, like the heading of the future page)
  - type: a type from the list above (optional)
  - context_snippet: one phrase from the source explaining why the entity is needed (optional)

Do not duplicate: one name → one record. Do not extract entities with min_mentions_for_page > 1 if they are mentioned only once.

Return ONLY JSON:
{"reasoning":"...","entities":[{"name":"...","type":"...","context_snippet":"..."},{"name":"...","context_snippet":"..."}]}
