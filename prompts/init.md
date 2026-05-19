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

Включи поле `reasoning` первым в JSON-ответе: пошаговое обоснование выбранной структуры домена.

## Output JSON Example

{
  "reasoning": "Проанализировал источники. Выявил сущности: Process, ServiceContract, Customer.",
  "id": "{{domain_id}}",
  "name": "Telecom Operations",
  "wiki_folder": "{{domain_id}}",
  "entity_types": [
    {
      "type": "Process",
      "description": "Бизнес-процесс или шаг workflow",
      "extraction_cues": ["BPMN", "workflow", "процесс"],
      "min_mentions_for_page": 1,
      "wiki_subfolder": "processes"
    }
  ],
  "language_notes": "Смесь русского/английского; сохраняй оригинальное написание product-имён."
}

ПРАВИЛО wiki_subfolder: одно слово, без слэшей, без domain_id.
Нельзя: "os/network", "os_network". Можно: "network", "processes", "protocols".

## Wiki Page Conventions

Страницы wiki должны иметь frontmatter с полями:
- wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]
