# Format operation — design

**Дата:** 2026-05-08
**Статус:** spec, ожидает review
**Автор:** brainstorming session

## 1. Цель

Добавить операцию **Format** — анализ открытой markdown-страницы (вне wiki-доменов) и генерация структурированного preview с предлагаемыми правками: frontmatter, заголовки, таблицы, mermaid-диаграммы, описания изображений и схем. Пользователь итерирует preview через чат, затем подтверждает применение.

**Жёсткий инвариант:** запрещено добавлять или удалять факты, искажать смысл. Разрешён перефраз для ясности. Все изменения перечисляются в отчёте.

## 2. UX-поток

1. Пользователь открывает `.md` файл вне wiki-домена.
2. В боковой панели LLM wiki жмёт кнопку **Format** (рядом с Ingest/Lint).
3. Если файл внутри `wiki_folder` любого домена — диалог: «Файл относится к wiki-домену «X». Format не применяется к wiki-страницам. Запустить Ingest на основании источников?»
4. Иначе — диалог подтверждения, после чего запускается анализ.
5. LLM возвращает `{report, formatted}`. Plugin пишет `formatted` в `!Temp/<basename>.formatted.md`, рендерит report + ссылку на temp + кнопки **Apply** / **Cancel**.
6. Пользователь открывает temp-файл по ссылке, читает изменения. Может уточнить через чат — каждый комментарий регенерирует preview (перезаписывает temp).
7. **Apply** — содержимое temp переносится в оригинал, temp удаляется. **Cancel** — temp удаляется, изменения отбрасываются.

## 3. Архитектура

```
View [Format btn] → controller.format(activeFile)
  → guard: file inside any wiki_folder?
      → да → ConfirmModal "запустить Ingest на основании wiki_sources?"
      → нет → AgentRunner.run({ operation: "format", args: [vaultPath] })
              → phases/format.ts runFormat()
                1. read file (frontmatter + body)
                2. resolve images: backend=claude-agent → image_url content blocks; иначе alt+caption
                3. messages: system = prompts/format.md (rendered) + user (содержимое + опц. image blocks) + chat history
                4. LLM stream → накапливаем deltas
                5. parse финальный JSON { report, formatted }
                6. validator: значимые токены оригинала ⊆ formatted?
                7. write !Temp/<basename>.formatted.md
                8. yield format_preview { tempPath, report, missingTokens }

Apply  → controller.formatApply()  → vault.modify(original, tempContent); vault.delete(temp); emit format_applied
Cancel → controller.formatCancel() → vault.delete(temp); emit format_cancelled
Refine (chat msg) → controller.formatRefine(msg) → новый runFormat с расширенной chat history → перезапись temp
```

Single-flight: regenerate во время regenerate отклоняется. Apply дисейблится при наличии missing-токенов и пока идёт генерация. Cancel всегда активен после появления preview.

## 4. Файлы

### Новые

| Файл | Назначение |
|---|---|
| `src/phases/format.ts` | `runFormat()` — генерация JSON `{report, formatted}`, запись temp |
| `prompts/format.md` | Системный промт; шаблоны `{{format_schema}}`, `{{has_vision}}` |
| `templates/_format-schema.md` | Правила форматирования не-wiki страниц (см. §5) |
| `tests/phases/format.test.ts` | Unit: парсинг JSON, validator, fallback, vision/no-vision, abort, refine |
| `tests/fixtures/format-sample.md` | Исходная страница для тестов |
| `tests/controller-format.test.ts` | Guard wiki-folder, Apply/Cancel/Refine flows |

### Изменяемые

| Файл | Изменение |
|---|---|
| `src/types.ts` | `WikiOperation` += `"format"`; `OpKey` += `"format"`; `RunEvent` += `format_preview`, `format_applied`, `format_cancelled`; `LlmWikiPluginSettings.timeouts` += `format`; per-operation maps += `format` |
| `src/agent-runner.ts` | `case "format"` → `runFormat`; `buildOptsFor` ключ `format` |
| `src/controller.ts` | `format(file)`, `formatRefine(msg)`, `formatApply()`, `formatCancel()`. Состояние `_pendingFormat: { originalPath, tempPath, chat: ChatMessage[] }`. Guard проверки. |
| `src/view.ts` | Кнопка `Format` в action row; preview-блок с ссылкой на temp + Apply/Cancel; чат для refine. Слушатели событий `format_preview`/`format_applied`/`format_cancelled`. |
| `src/i18n.ts` | Ключи (см. §6) для en + ru |
| `src/settings.ts` | Default `timeouts.format = 600`; per-operation `format` для claude и native; UI секция format-операции (модель + maxTokens) |
| `src/main.ts` | (опц.) команда `format-active` |
| `src/phases/lint.ts:12` | `META_FILES`: `_schema.md` → `_wiki_schema.md` |
| `src/phases/init.ts`, `src/phases/ingest.ts`, `prompts/*.md` | Аудит и замена ссылок `_schema.md` → `_wiki_schema.md` |
| `templates/_schema.md` | Переименовать → `templates/_wiki_schema.md` |
| `package.json`, `src/manifest.json` | patch-инкремент перед билдом |

## 5. Шаблон форматирования (`templates/_format-schema.md`)

Правила для **не-wiki** страниц. Не использует `_wiki_schema.md` (тот специфичен для wiki: `wiki_sources`, `wiki_status`, dead-link checks).

### Frontmatter

| Поле | Правило |
|---|---|
| `tags` | Иерархические, при наличии тематической классификации |
| `aliases` | Аббревиатуры, синонимы, англ. варианты |
| `created` | YYYY-MM-DD при наличии в источнике или при первом форматировании |
| `updated` | YYYY-MM-DD текущая дата форматирования |
| `external_links` | Массив URL — только если в теле есть `http(s)://` ссылки |
| `related` | Массив `[[wikilinks]]` — только если в теле уже встречаются ссылки на другие страницы |

`wiki_*` поля **запрещены** (это не wiki-страница).

### Структура

- H1 — название страницы.
- Вводный абзац 1-3 предложения сразу после H1, без подзаголовка.
- Далее `##` разделы по логике контента; иерархия без скачков (H2 → H3 → H4).
- Запрещены пустые разделы и placeholder-текст.

### Таблицы

Markdown с выравниванием. Применять когда в тексте есть структурные перечисления параметров/сравнений/характеристик. Не превращать в таблицы повествовательный текст.

### Mermaid

` ```mermaid ` блоки для процессов, последовательностей, связей. Источник:
- описанные в тексте процессы → flowchart/sequenceDiagram;
- содержимое схем из изображений (только при vision-backend) → отдельный mermaid-блок ниже изображения. Само изображение **сохраняется**.

### Изображения

- Каждой картинке — описательная подпись непосредственно под ней.
- При `has_vision=true`: дополнительно текстовое описание содержимого схемы (таблица параметров, mermaid-диаграмма, или связный текст). Изображение в markdown остаётся.
- При `has_vision=false`: используем только alt-текст и существующие подписи; новой информации не сочиняем.

### Код

Fenced blocks всегда с указанием языка (` ```sql `, ` ```yaml `, ` ```ts `).

### Стиль

- Нейтральный, информативный, без оценочных суждений.
- Технические термины — оригинальное написание (SQL, API, LLM).
- Запрещено: «очевидно», «лучший способ», местоимения «я/мы/наш».

### Запреты (жёсткие)

- Не добавлять факты, отсутствующие в исходнике (исключение: текстовое извлечение из изображений при `has_vision=true`).
- Не удалять факты.
- Не искажать смысл. Перефраз для ясности — разрешён.
- Все изменения перечислять в отчёте `report`.

## 6. Контракт LLM-ответа

```json
{
  "report": "## Предлагаемые изменения\n- [frontmatter] добавлены tags, aliases\n- [H2] раздел 'Описание' переименован в 'Применение'\n- [таблица] параметры абзацев 3-5 собраны в таблицу\n- [mermaid] схема процесса извлечена из image1.png\n- [перефраз] раздел 'Архитектура' переписан для ясности",
  "formatted": "---\ntags: [...]\n---\n\n# Заголовок\n..."
}
```

**Парсер:** `extractJsonObject(text)` — ищет первый `{`, балансирует скобки с учётом строк/escape (аналог `parseJsonPages` в `lint.ts`). Fallback при невалидном JSON: `RunEvent error`, preview не создаётся.

**Streaming:** дельты собираются как `assistant_text` для отображения в Progress. Финальный текст парсится после закрытия стрима.

**System prompt (`prompts/format.md`) шаблон:**

```
Ты — редактор markdown-страницы вне wiki-базы знаний.

Твоя задача — проанализировать страницу и предложить форматирование по правилам ниже.

ЖЁСТКИЕ ПРАВИЛА:
- Не добавляй и не удаляй факты, имена, числа, URL.
- Не искажай смысл. Перефраз для ясности разрешён.
- Все изменения опиши в поле report.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
{{format_schema}}

VISION: {{has_vision}}
- При has_vision=true: извлекай содержимое схем и изображений, создавай таблицы или mermaid-блоки ниже изображения.
- При has_vision=false: работай только с alt-текстом и подписями, новой информации не сочиняй.

Верни ТОЛЬКО JSON:
{
  "report": "<markdown отчёт об изменениях>",
  "formatted": "<полный markdown отформатированной страницы>"
}
```

**User message (initial):**
```
Исходный файл: <vaultPath>
---
<frontmatter + body>

[Изображения: <list paths>]   // только если has_vision=true; далее image_url content blocks
```

**Refine:** в messages добавляется prior assistant response + новое user-сообщение. Полная история чата хранится в `controller._pendingFormat.chat`.

## 7. Validator (защита инварианта)

Перед записью temp:

```
significantTokens(text) = {
  numbers:          /\d+(\.\d+)?/g
  urls:             /https?:\/\/\S+/g
  proper_nouns:     /[A-ZА-Я][\w-]{2,}/g (минус стоп-слова)
  code_identifiers: содержимое `inline` и ```fenced``` блоков
}

missing = origSet \ formattedSet
```

Поведение:
- Preview **всегда** записывается.
- Если `missing.size > 0` → `format_preview` событие включает `missingTokens: string[]`. View показывает warning, **Apply дисейблится**. Пользователь либо уточняет через чат → регенерация, либо отменяет.
- Threshold: 0 (точное совпадение). Если на практике даст много ложных срабатываний — повысить порог в отдельной итерации.

## 8. UI

### Кнопка

`src/view.ts` около строки 113, в `actionRow`:
```
[ Ingest ] [ Lint ] [ Format ]
```

### Preview-блок (после события `format_preview`)

```
┌─ Format preview ──────────────────────┐
│ 📄 [!Temp/имя.formatted.md]           │  ← internal-link
│                                         │
│ ## Предлагаемые изменения              │
│ - ...                                   │
│ ⚠ Утрачены значимые токены: X, Y       │  ← если validator
│                                         │
│ [ Apply ] [ Cancel ]                   │
├─ Уточнение через чат ──────────────────┤
│ ... сообщения ...                      │
│ [ textarea ] [ Send ]                  │
└────────────────────────────────────────┘
```

Apply дисейблится: пока идёт регенерация ИЛИ при наличии `missingTokens`. Cancel всегда активен. Send в чате → `controller.formatRefine(msg)`.

Pattern переиспользует существующий чат-блок (`chatSection` в `view.ts`).

## 9. i18n

```ts
// view.*
format:                "Format" / "Форматирование"
formatConfirmTitle:    "Format — confirm" / "Форматирование — подтверждение"
formatConfirmBody:     "Claude will analyze the active page and propose formatting changes. Preview will be saved to !Temp/."
                     / "Claude проанализирует открытую страницу и предложит правки. Preview будет сохранён в !Temp/."
formatInWikiTitle:     "File in wiki domain" / "Файл в wiki-домене"
formatInWikiBody:      (id) => `File belongs to wiki domain «${id}». Format does not apply to wiki pages. Run Ingest on its sources?`
                            / `Файл относится к wiki-домену «${id}». Format не применяется к wiki-страницам. Запустить Ingest на основании источников?`
formatInWikiNoSources: "No source paths in wiki_sources frontmatter — Ingest unavailable."
                     / "В wiki_sources frontmatter нет путей источников — Ingest невозможен."
formatPreviewTitle:    "Format preview" / "Format preview"
formatApply:           "Apply" / "Применить"
formatCancel:          "Cancel" / "Отмена"
formatRegenerating:    "Regenerating preview…" / "Регенерация preview…"
formatApplied:         (path) => `Applied to ${path}` / `Применено к ${path}`
formatCancelled:       "Format cancelled" / "Форматирование отменено"
formatTokensMissing:   (list) => `Significant tokens missing: ${list}. Refine via chat or cancel.`
                              / `Утрачены значимые токены: ${list}. Уточните через чат или отмените.`

// settings.*
op_format:             "Format" / "Форматирование"
```

## 10. Settings

`LlmWikiPluginSettings`:
- `timeouts.format`: default 600 секунд
- `claudeAgent.operations.format`: `{ model: "sonnet", maxTokens: 8192 }`
- `nativeAgent.operations.format`: `{ model: <default>, maxTokens: 8192, temperature: 0.2 }`

UI настроек: новая секция `op_format` (модель + maxTokens), параллельно существующим секциям `op_ingest`/`op_query`/`op_lint`/`op_init`.

## 11. Тесты

### `tests/phases/format.test.ts`

| Кейс | Проверка |
|---|---|
| Валидный JSON ответ | `format_preview` событие с `tempPath`, temp файл записан |
| Streaming | дельты накапливаются, парсер вызывается на финале |
| Невалидный JSON | `RunEvent error`, temp не пишется |
| Validator: missing токены | `format_preview` с `missingTokens`, Apply дисейбл |
| Refine с историей | повторный вызов с `chatMessages.length≥2` → промт включает историю |
| `has_vision=false` + изображения | передаётся только alt + caption |
| `has_vision=true` + изображения | image_url content blocks (mock claude backend) |
| Abort signal | генератор завершается без записи temp |

### `tests/agent-runner.integration.test.ts` (расширение)

Маршрут `operation: "format"` через mock-адаптер с фикстурным JSON → события `format_preview`/`result`.

### `tests/controller-format.test.ts`

| Кейс | Проверка |
|---|---|
| Файл в wiki-домене | ConfirmModal "Ingest на основании источников" |
| Файл вне wiki | запуск format |
| Apply | content из temp перенесён в оригинал, temp удалён |
| Cancel | temp удалён, оригинал не тронут |
| Apply без `_pendingFormat` | no-op + Notice |
| Refine во время running | отклонено single-flight |

## 12. Edge cases

| Кейс | Поведение |
|---|---|
| Нет активного файла | Notice `noActiveFile` |
| Файл не `.md` | Notice "Format works only on markdown" |
| `!Temp/` отсутствует | `vault.createFolder("!Temp")` лениво при первом write |
| `!Temp/<name>.formatted.md` уже есть от предыдущего pending | Если pending активен — single-flight отклоняет; если orphan от прошлой сессии — перезаписать |
| Mobile (`Platform.isMobile`) | Работает: format-фаза не использует node:fs |
| Закрытие view с активным pending | Modal "preview не применён, оставить в !Temp?". State в памяти теряется при reload — orphan чистится вручную |
| Plugin reload | `_pendingFormat` теряется, temp-файл остаётся в !Temp как orphan |
| `formatted` без frontmatter, оригинал имел | Validator замечает потерю значимых токенов из frontmatter → warning |
| Backend native, промт упоминает vision | `{{has_vision}}=false` → LLM не пытается vision |

## 13. Версионирование и сборка

Перед билдом — patch-инкремент в `package.json` и `src/manifest.json` (правило проекта).

## 14. Документация

- Обновить `README.md` с описанием Format.
- Обновить wiki-описание архитектуры (при наличии в `docs/architecture/`).

## 15. Open questions / follow-ups

- Threshold validator-а (0 vs N) — может потребовать настройки по результатам реальных запусков.
- Опциональный `Apply anyway` для случая, когда validator ругается, но пользователь уверен — отложено до feedback.
- Persistent `_pendingFormat` (через Obsidian settings) для восстановления после reload — отложено; orphan-чистка достаточна на старте.
