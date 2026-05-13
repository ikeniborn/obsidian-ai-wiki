# Format: защита от потери токенов

**Дата:** 2026-05-13  
**Область:** `src/phases/format.ts`, `src/phases/format-utils.ts`

## Проблема

Операция форматирования отправляет страницу в LLM и получает `formatted` — отформатированный текст. LLM иногда удаляет критичные токены (имена, числа, URL, идентификаторы) несмотря на инструкции в промпте. Система уже детектирует потери через `missingTokensWithContext()` и показывает предупреждения в UI, но не предотвращает применение с потерями.

## Требования

- Форматирование не должно менять содержание: имена, числа, URL, идентификаторы из кода
- Существующий детектор `missingTokensWithContext()` сохраняется без изменений
- Без дополнительных LLM-вызовов при успешном форматировании (нет потерь → нет overhead)
- Максимум 1 correction-retry при обнаружении потерь

## Решение: Подход A — token-retry + appendMissingLines

Два независимых retry-потока в `format.ts`:
1. **JSON-retry** (существующий) — невалидный JSON → повтор с усиленным системным промптом
2. **Token-retry** (новый) — missing tokens → multi-turn correction с указанием пропущенных токенов

### Поток выполнения

```
runFormat()
  → callOnce(baseParams)                    # 1-й вызов (без изменений)
  → extractJsonObject()                     # JSON-парсинг (без изменений)
  → [JSON-retry если невалид]               # без изменений
  → missingTokensWithContext(original, formatted)
  → если missing1.length > 0:
      callOnce(restoreParams)               # НОВЫЙ token-retry (см. restoreParams ниже)
      extractJsonObject() на новом ответе → formatted2
      → если formatted2 невалиден: formatted2 = formatted1, missing2 = missing1
      → missingTokensWithContext(original, formatted2) → missing2
      → если missing2.length > 0:
          appendMissingLines(formatted2, missing2)
  → vaultTools.write(tempPath, result)
  → format_preview { missingTokens }        # список того, что было восстановлено / осталось
```

### Token-retry: структура сообщений

Multi-turn запрос — модель видит свой предыдущий ответ:

```
system:    тот же systemContent
user:      тот же userContent (оригинальный файл)
assistant: <fullText1 — сырая строка первого LLM-ответа>
user:      "ВОССТАНОВИ ТОКЕНЫ: следующие значения из оригинала отсутствуют
            в форматированном тексте. Верни полный JSON {report, formatted}
            где formatted содержит все перечисленные токены без изменения
            форматирования остального текста.
            Пропущенные: `TokenA`, `2025-01-01`, `https://example.com`"
```

`restoreParams` включает `response_format: { type: "json_object" }` — как и `baseParams`.

### appendMissingLines

Новая функция в `format-utils.ts`:

```typescript
function appendMissingLines(
  formatted: string,
  missing: MissingToken[]  // уже содержат context = строка из оригинала
): string
```

Логика:
1. Собирает `m.context` из каждого `MissingToken` (уже вычислено, повторного сканирования нет)
2. Дедуплицирует строки
3. Дописывает в конец `formatted`:

```markdown

---
<!-- restored-lines: token loss after retry -->
<строка из оригинала 1>
<строка из оригинала 2>
```

Функция возвращает новую строку, не мутирует входные данные.

## Изменяемые файлы

| Файл | Изменение |
|---|---|
| `src/phases/format.ts` | Добавить token-retry после JSON-парсинга; вызвать `appendMissingLines` при необходимости |
| `src/phases/format-utils.ts` | Добавить `appendMissingLines(formatted, missing): string`; экспортировать |

## Не изменяется

- `prompts/format.md` — промпт без изменений
- `src/view.ts` — `format_preview` рендер без изменений
- `missingTokensWithContext()` — логика без изменений
- `format_preview` event shape — без изменений

## Граничные случаи

| Случай | Поведение |
|---|---|
| `m.context === ""` для токена | Токен не добавляется в restored-block (нет строки-источника) |
| JSON-retry уже выполнен + token-retry нужен | Token-retry строит multi-turn поверх `fullText` из JSON-retry (сырая строка ответа) |
| Token-retry вернул невалидный JSON | `formatted2 = formatted1`, `missing2 = missing1`; вызываем `appendMissingLines(formatted1, missing1)` |
| После retry 0 пропущенных токенов | `appendMissingLines` не вызывается |
| `signal.aborted` в token-retry | Ранний return, как в остальных местах |

## Тестирование

- `tests/phases/format.test.ts` — добавить кейс: mock LLM дропает токен в первом ответе, восстанавливает во втором
- `tests/phases/format.test.ts` — кейс: mock дропает токен в обоих ответах → проверить restored-block в tempPath
- `tests/phases/format-utils.test.ts` — unit-тест `appendMissingLines`: дедупликация строк, пустой context пропускается, уже есть `---` в конце formatted
