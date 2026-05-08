---
wiki_sources: ["src/mobile-fetch.ts"]
wiki_updated: 2026-05-08
wiki_status: stub
wiki_outgoing_links:
  - "[[wiki-controller]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki", "mobile"]
aliases: ["mobileFetch", "mobile-fetch.ts"]
---
# mobileFetch (mobile-fetch.ts)

Адаптер `fetch`-API на базе Obsidian `requestUrl()` для обхода CORS на мобильной платформе. Используется как `fetch`-параметр клиента OpenAI SDK при `Platform.isMobile`.

## Основные характеристики

- **Расположение:** `src/mobile-fetch.ts`
- **Экспорт:** `mobileFetch: typeof fetch` — совместим с сигнатурой `fetch(input, init)`

### Поведение

- Поддерживает строковый/`URL`/`Request` input — извлекает URL
- Тело: только `string`. Бинарное/`FormData` — выбрасывает `Error` с явным сообщением
- Прокидывает `method` (default `GET`), `headers`, `body`
- `init.signal.aborted` → `DOMException("Aborted", "AbortError")`
- `throw: false` в `requestUrl` — не бросает на HTTP-ошибки; возвращает `Response` с тем же `status`/`headers`/`body`

### Зачем

Мобильный Obsidian (iOS/Android) не имеет полноценного `fetch` без CORS-ограничений. `requestUrl()` — нативный Obsidian API, проксирующий запросы через WebView. OpenAI SDK принимает кастомный `fetch` через опцию `fetch` — этот адаптер подключается в `WikiController.buildAgentRunner()` только на мобильной платформе.

## Связанные концепции

- [[wiki-controller]] — подключает `mobileFetch` через `Platform.isMobile ? mobileFetch : undefined` при инициализации `OpenAI` клиента
