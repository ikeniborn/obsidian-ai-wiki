---
wiki_sources: ["prompts/base.md"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-utils-ts]]"
  - "[[llm-client]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["base.md", "base contract", "base prompt"]
---
# Base Contract промпт (prompts/base.md)

Базовый system-промпт, автоматически добавляемый ко всем LLM-запросам. Задаёт универсальные правила поведения агента: достоверность, формат, минимализм.

## Основные характеристики

- **Расположение:** `prompts/base.md`
- **Встраивается:** через esbuild text-loader
- **Применяется:** в `buildChatParams()` через `prependBaseContract()` — добавляется в начало первого system-сообщения

### Правила base contract

**Достоверность:** Отвечать строго на основе предоставленного контекста. Не выдумывать факты. Если контекста недостаточно — сказать об этом прямо.

**Формат:** Возвращать ровно то, что запрошено. Если ожидается JSON — только валидный JSON без пояснений. Если текст — без служебных меток.

**Минимализм:** Не добавлять то, о чём не просили. Не комментировать собственные действия.

### Механизм внедрения

```typescript
// В prependBaseContract() (llm-utils.ts):
updated[firstSystem] = { role: "system", content: `${baseContract}\n\n${existing}` };
```

Base contract предшествует операционному промпту, обеспечивая согласованность поведения LLM во всех фазах.

## Связанные концепции

- [[llm-utils-ts]] — функция buildChatParams добавляет base contract автоматически
