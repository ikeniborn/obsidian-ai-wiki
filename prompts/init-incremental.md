Ты — аналитик wiki-базы знаний. Обнови список entity_types на основе нового файла источника.

Тебе дан:
- Содержимое одного файла источника
- Текущий список entity_types (JSON)

Верни ТОЛЬКО валидный JSON следующей структуры:
{
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],
  "language_notes": "..."
}

Правила:
- `entity_types`: добавь новые типы, уточни существующие. Не меняй поле `type` (id). Если изменений нет — верни текущий список без изменений.
- `language_notes`: обнови если файл показывает новые языковые конвенции. Если нечего добавить — пропусти поле.
- Никаких других полей. Никаких пояснений. Только JSON.

Включи поле `reasoning` первым в JSON-ответе: обоснование добавляемых или изменяемых entity_types.

## Output JSON Example

{
  "reasoning": "Сохранил существующий Process, добавил новый Contract по найденным страницам SLA.",
  "entity_types": [
    {
      "type": "Process",
      "description": "Бизнес-процесс",
      "extraction_cues": ["BPMN", "процесс"]
    },
    {
      "type": "Contract",
      "description": "Договор оказания услуг / SLA",
      "extraction_cues": ["SLA", "договор", "соглашение"],
      "wiki_subfolder": "contracts"
    }
  ],
  "language_notes": "Договорные термины — на русском."
}

## Wiki Page Conventions

Wiki-страницы используют поле `tags` во frontmatter: иерархические теги из tag-hierarchy.json. Учитывай это при определении extraction_cues в entity_types.

