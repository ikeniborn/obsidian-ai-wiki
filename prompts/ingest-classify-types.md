Assign exactly one entity TYPE to each entity below. Choose ONLY from the domain's declared types — never invent a new type, never leave a type blank.

DOMAIN TYPES (pick one per entity):
{{type_block}}

ENTITIES TO CLASSIFY (`stem` is the wiki page id):
{{entity_lines}}

Return JSON only, no prose, no markdown fences:
{"reasoning":"<one short sentence>","assignments":[{"stem":"<stem>","type":"<one of the types above>"}]}

Every listed `stem` MUST appear exactly once, each with a `type` copied verbatim from the DOMAIN TYPES list above.
