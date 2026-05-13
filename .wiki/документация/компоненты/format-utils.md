---
wiki_status: stub
wiki_sources:
  - src/phases/format-utils.ts
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [компонент, format, validator, json-repair]
---

# format-utils

Утилиты форматирования и валидации токенов для операции format. Модуль `src/phases/format-utils.ts` предоставляет парсинг JSON-ответа LLM, обнаружение обрезанных ответов и проверку сохранности токенов.

## API

### Типы

**`FormatResponse`**
```typescript
export interface FormatResponse {
  report: string;
  formatted: string;
}
```
DTO-ответ LLM: `report` — текстовый отчёт об изменениях, `formatted` — результирующий markdown.

**`MissingToken`**
```typescript
export interface MissingToken {
  token: string;
  context: string;
}
```
Токен, отсутствующий в отформатированном тексте, с контекстной строкой из оригинала (max 120 символов).

### Функции

| Функция | Сигнатура | Описание |
|---------|-----------|---------|
| `extractJsonObject` | `(text: string) → FormatResponse \| null` | Извлечь первый валидный JSON-объект из текста; снимает ` ```json ``` ` обёртку; пробует `repairJson` при parse-ошибке |
| `looksTruncated` | `(text: string) → boolean` | Вернуть `true`, если JSON-объект начат, но не закрыт (обнаружение обрезанного ответа LLM) |
| `significantTokens` | `(text: string) → Set<string>` | Извлечь значимые токены: URL, числа, Latin-CamelCase/PascalCase ≥3 букв, ALL-CAPS акронимы, идентификаторы из `` `code` `` и ` ```blocks``` ` |
| `missingTokens` | `(original, formatted: string) → string[]` | Упрощённый wrapper — только список строк токенов (без контекста) |
| `missingTokensWithContext` | `(original, formatted: string) → MissingToken[]` | Найти токены из `original`, отсутствующие в `formatted`; возвращает токены с контекстной строкой |
| `appendMissingLines` | `(formatted: string, missing: MissingToken[]) → string` | Жёсткий fallback: дописать уникальные контекстные строки в конец `formatted` за разделителем `---` |

## Алгоритм significantTokens

1. URL (`https?://\S+`) — извлекаются первыми, удаляются из residual-текста (исключает ложные токены из URL-частей)
2. Числа — `\b\d+(?:\.\d+)?\b` (word-boundary защищает от подстрок)
3. Latin-CamelCase: `\b[A-Z][A-Za-z0-9-]{2,}` — не захватывает суффиксы camelCase (например из `socketTimeout` не извлекается `Timeout`)
4. ALL-CAPS акронимы: `\b[A-Z]{2,}\b`
5. Идентификаторы из `` `inline` `` и ` ```fenced``` ` блоков: `\b[A-Za-z_][A-Za-z0-9_]{2,}\b`

Кириллические слова не считаются значимыми — рефраз допустим.

## Алгоритм missingTokensWithContext

Для каждого токена из `significantTokens(original)`:
- Генерирует леммы: singular↔plural через суффиксные правила (`-ies`/`-s`/`-es`)
- Ищет варианты в `formatted` с word-boundary regex
- При отсутствии — находит первую строку оригинала с токеном, обрезает до 120 символов

## Внутренние функции (не экспортируются)

| Функция | Назначение |
|---------|-----------|
| `stripCodeFence(text)` | Снять ` ```json ``` ` только если весь ответ обёрнут (anchored match); не срабатывает на внутренние блоки |
| `tryParseJson(slice)` | `JSON.parse` → при ошибке → `repairJson` → повторный parse |
| `repairJson(s)` | Убрать trailing-commas + экранировать raw control-chars (0x00–0x1F) внутри JSON-строк |
| `escapeRawControlsInStrings(src)` | Посимвольный проход: `\n`→`\\n`, `\r`→`\\r`, `\t`→`\\t`, остальные→`\\uXXXX` |
| `lemmas(token)` | Plural/singular деривация для token-matching |

## Использование в операции format

```
runFormat (format.ts)
  → extractJsonObject()       ← парсинг JSON-ответа LLM
  → looksTruncated()          ← проверка до retry: обрезан ли?
  → missingTokensWithContext() ← после parse: есть ли пропущенные токены?
    → token-restore multi-turn call (при missing > 0)
    → appendMissingLines()    ← hard fallback если токены всё ещё missing
```

## Связанные страницы

- [[format-operation]]
- [[agent-runner]]
