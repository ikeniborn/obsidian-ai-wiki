Ты — архитектор wiki-базы знаний. Сгенерируй запись домена для domain-map.json.
Верни ТОЛЬКО валидный JSON следующей структуры:
{
  "id": "{{domain_id}}",
  "name": "Человекочитаемое название",
  "wiki_folder": "vaults/{{vault_name}}/!Wiki/{{domain_id}}",
  "source_paths": [],
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"{{domain_id}}/..."}],
  "language_notes": ""
}
{{schema_block}}
{{index_block}}
