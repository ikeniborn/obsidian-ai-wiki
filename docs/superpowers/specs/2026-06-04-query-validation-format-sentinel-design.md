---
review:
  spec_hash: 4c85fe758177f228
  last_run: 2026-06-04
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Конфигурация"
      section_hash: 8987ea13fff43eaa
      text: "wikiLinkValidationRetries=0 (validate only) противоречит §A коду: integration всегда вызывает rewriteWithValidLinks без проверки настройки. Подтверждено пользователем: семантика retries=0 = validate без retry верна — §A код требует правки при имплементации."
      verdict: accepted
      verdict_at: 2026-06-04
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "B.5. Zod-схема format"
      section_hash: 7aa3f4952bec69cf
      text: "parseFormatOutput сигнатура: hasVisionDescriptions; тело (строки 279, 284) ссылается на hasVision. §B.5 явно разделяет эти термины — унифицировать имя при имплементации."
      verdict: accepted
      verdict_at: 2026-06-04
    - id: F-003
      phase: coverage
      severity: INFO
      section: "A. Query Link Validation (post-stream + retry → annotate)"
      section_hash: 4c5a6fe72bbb26db
      text: "interface QueryLinkValidationResult экспортируется, integration не возвращает эту структуру — type-only декларация без потребителя."
      verdict: accepted
      verdict_at: 2026-06-04
chain:
  intent: null
---

# Query Link Validation + Format Sentinel/Zod Hardening

## Проблема

Два независимых бага в фазах LLM-pipeline:

1. **Query phase галлюцинирует ссылки**. `runQuery` ([`src/phases/query.ts`](../../../src/phases/query.ts)) стримит ответ LLM как есть. Промпт `prompts/query.md` требует `[[WikiLink]]` для цитирования источников, но никакой пост-валидации нет. LLM выдаёт `[[Костный бульон]]`, `[[Пряное грузинское харчо]]` и т.п. — страниц с такими stem-ами в vault нет. Пользователь получает ответ со сломанными внутренними ссылками.

2. **Format phase возвращает invalid JSON при vision**. Логи показывают два провала `parseFormatOutput` подряд (output ≈ 9.7k + 10.7k токенов, 200+ секунд впустую). Vision-таблицы (~1500 chars каждая) попадают внутрь JSON-строки `formatted`. Модель `deepseek-v4-flash` плохо экранирует control-chars/`"`/`\` в длинных markdown-строках. Retry с усиленным system prompt не помогает — модель повторяет ту же ошибку. JSON-обёртка фундаментально хрупка для длинного markdown с таблицами.

3. **Структура ответа query слабая**. Промпт говорит «используй заголовки, списки, code-fence», но рекомендации мягкие. Пользователь видит плоские абзацы без выделения ключевых сущностей.

## Цели

- Query ответы не содержат ссылок на несуществующие wiki-страницы.
- Format не теряет 20k токенов из-за ошибок экранирования.
- Query ответ структурно отформатирован (списки/таблицы/bold для сущностей).

## Не-цели

- Авто-создание страниц по битым ссылкам (это explicit user action через `save`).
- Persistent cache `knownStems` (vault обычно <10k файлов, recomputation дёшев).
- Жёсткая фиксированная схема секций для query (## Ответ / ## Детали / ## Источники).
- Миграция уже сохранённых `Q-*.md` страниц.

## Решение

### A. Query Link Validation (post-stream + retry → annotate)

Пост-валидация ссылок после стрима ответа LLM с одной retry-попыткой исправления. При повторном провале — annotate битых ссылок.

**Новый модуль** `src/phases/query-link-validator.ts`:

```typescript
export interface QueryLinkValidationResult {
  text: string;
  brokenInitial: string[];
  brokenFinal: string[];
  retried: boolean;
}

export function extractAnswerLinks(text: string): string[] {
  const re = /\[\[([^\]|#/]+?)\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

export function findBrokenLinks(links: string[], knownStems: Set<string>): string[] {
  return [...new Set(links.filter((s) => !knownStems.has(s)))];
}

export function annotateBroken(text: string, broken: Set<string>): string {
  return text.replace(/\[\[([^\]|#/]+?)\]\]/g, (full, stem) => {
    return broken.has(stem.trim()) ? `${full} *(нет в wiki)*` : full;
  });
}

export async function rewriteWithValidLinks(
  llm: LlmClient,
  model: string,
  question: string,
  originalAnswer: string,
  broken: string[],
  contextStems: string[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ text: string; outputTokens: number }>;
```

`rewriteWithValidLinks` делает один non-streaming LLM-вызов:
- system: оригинальный query-промпт + добавка: «В ответе есть ссылки на несуществующие страницы: [список broken]. Перепиши ответ, используя только страницы из доступного списка: [contextStems]. Не добавляй новых фактов».
- user: оригинальный `answer`.
- Возвращает новый text + outputTokens для учёта в общем счёте.

**Интеграция в `src/phases/query.ts`** (между `tool_result` стрима и save-блоком, ≈ строка 178):

```typescript
if (answer && !signal.aborted) {
  yield { kind: "tool_use", name: "ValidateLinks", input: {} };
  const allVaultFiles = await vaultTools.listFiles("");
  const knownStems = new Set(
    allVaultFiles.filter((f) => f.endsWith(".md")).map((f) => pageId(f)),
  );
  const links = extractAnswerLinks(answer);
  const brokenInitial = findBrokenLinks(links, knownStems);
  yield {
    kind: "tool_result",
    ok: brokenInitial.length === 0,
    preview: brokenInitial.length === 0 ? "all valid" : `${brokenInitial.length} broken`,
  };

  if (brokenInitial.length > 0) {
    yield { kind: "tool_use", name: "FixingLinks", input: { broken: brokenInitial.length } };
    const contextStems = [...selectedIds];
    try {
      const r = await rewriteWithValidLinks(
        llm, model, question, answer, brokenInitial, contextStems, opts, signal,
      );
      outputTokens += r.outputTokens;
      const retryLinks = extractAnswerLinks(r.text);
      const brokenFinal = findBrokenLinks(retryLinks, knownStems);
      if (brokenFinal.length === 0) {
        answer = r.text;
        yield { kind: "tool_result", ok: true, preview: "fixed" };
      } else {
        answer = annotateBroken(r.text, new Set(brokenFinal));
        yield { kind: "tool_result", ok: false, preview: `${brokenFinal.length} annotated` };
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return;
      answer = annotateBroken(answer, new Set(brokenInitial));
      yield { kind: "tool_result", ok: false, preview: "retry failed → annotated" };
    }
    yield { kind: "assistant_replace", text: answer };
  }
}
```

**Новое событие** `assistant_replace` в `src/types.ts`:

```typescript
type RunEvent =
  | { kind: "assistant_text"; delta: string; isReasoning?: boolean }
  | { kind: "assistant_replace"; text: string }
  | ...;
```

**Обработка в `src/view.ts`**: найти секцию, аккумулирующую `assistant_text.delta` в текущий hop. При `assistant_replace` — заменить накопленный `assistantText` на `text` и перерендерить markdown-блок.

**Scope валидации**: все `.md` файлы vault (соответствует `knownPageStems` в `fixWikiLinks`). Это даёт обычные wiki-рабочие ссылки за пределами домена.

**Edge cases**:
- `answer === ""` — skip validation.
- Ошибка `vaultTools.listFiles("")` — лог warning, skip validation, отдать original (fail-open).
- `signal.aborted` перед retry — return без annotate.
- AbortError в retry — silent return.
- Дубли битых ссылок — `findBrokenLinks` дедуплицирует.

### B. Format Sentinel Parsing + Salvage

Замена JSON-обёртки на sentinel-маркеры. Markdown с таблицами и control-chars не ломает парсинг.

**Формат вывода LLM** (без vision):

```
<<<REPORT>>>
markdown отчёт об изменениях
<<<FORMATTED>>>
---
frontmatter: ...
---

# страница
полный markdown форматированной страницы
<<<END>>>
```

**При активном vision-распознавании** (`visionSettings.enabled === true` и `visionDescriptions.size > 0`) добавляются маркеры для Zod-валидации embed-preservation:

```
<<<REPORT>>>
...
<<<FORMATTED>>>
...
<<<VISION_COUNT>>>2
<<<EMBEDS>>>Снимок 1.png|Снимок 2.png
<<<END>>>
```

**Парсер** (`src/phases/format-utils.ts` — добавить):

```typescript
export interface SentinelOutput {
  report: string;
  formatted: string;
  visionCount?: number;
  embeds?: string[];
  truncated: boolean;
}

export function parseSentinelOutput(text: string, hasVisionDescriptions: boolean): SentinelOutput | null {
  const reportIdx = text.indexOf("<<<REPORT>>>");
  const formattedIdx = text.indexOf("<<<FORMATTED>>>");
  const endIdx = text.indexOf("<<<END>>>");
  if (reportIdx === -1 || formattedIdx === -1) return null;
  const report = text.slice(reportIdx + "<<<REPORT>>>".length, formattedIdx).trim();
  let formattedEnd: number;
  let truncated = false;
  let visionCount: number | undefined;
  let embeds: string[] | undefined;
  if (hasVisionDescriptions) {
    const visionIdx = text.indexOf("<<<VISION_COUNT>>>", formattedIdx);
    const embedsIdx = text.indexOf("<<<EMBEDS>>>", formattedIdx);
    if (visionIdx === -1 || embedsIdx === -1) return null;
    formattedEnd = visionIdx;
    visionCount = parseInt(text.slice(visionIdx + "<<<VISION_COUNT>>>".length, embedsIdx).trim(), 10);
    const embedsEnd = endIdx === -1 ? text.length : endIdx;
    embeds = text.slice(embedsIdx + "<<<EMBEDS>>>".length, embedsEnd)
      .trim()
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    truncated = endIdx === -1;
  } else {
    formattedEnd = endIdx === -1 ? text.length : endIdx;
    truncated = endIdx === -1;
  }
  const formatted = text.slice(formattedIdx + "<<<FORMATTED>>>".length, formattedEnd).trim();
  return { report, formatted, visionCount, embeds, truncated };
}
```

**Salvage**: если `<<<END>>>` отсутствует но `<<<FORMATTED>>>` присутствует — берём всё после `<<<FORMATTED>>>` как `formatted` с флагом `truncated: true`, эмитится `info_text` warning.

### B.5. Zod-схема format

`FormatOutputSchema` усиливается discriminated-union для vision + superRefine.

**Текущая схема** в `src/phases/zod-schemas.ts`:

```typescript
export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});
```

Слабая. Пропускает пустые строки, не проверяет frontmatter, не валидирует embed preservation.

**Новая схема**:

```typescript
const FormatBaseSchema = z.object({
  report: z.string().min(1, "report не должен быть пустым"),
  formatted: z.string().min(10, "formatted слишком короткий"),
});

const FormatWithVisionSchema = FormatBaseSchema.extend({
  vision_blocks_count: z.number().int().min(0),
  embeds_preserved: z.array(z.string()),
});

export const FormatOutputSchema = z.union([
  FormatBaseSchema,
  FormatWithVisionSchema,
]).superRefine((val, ctx) => {
  if (!val.formatted.startsWith("---\n")) {
    ctx.addIssue({
      code: "custom",
      path: ["formatted"],
      message: "formatted должен начинаться с YAML frontmatter",
    });
  }
  if (val.report.trim().length === 0) {
    ctx.addIssue({ code: "custom", path: ["report"], message: "report пуст" });
  }
  if ("embeds_preserved" in val) {
    for (const path of val.embeds_preserved) {
      if (!val.formatted.includes(`![[${path}]]`)) {
        ctx.addIssue({
          code: "custom",
          path: ["formatted"],
          message: `embed ![[${path}]] потерян`,
        });
      }
    }
  }
});

export type FormatOutput = z.infer<typeof FormatOutputSchema>;
```

**`parseFormatOutput`** становится:

```typescript
function parseFormatOutput(text: string, hasVisionDescriptions: boolean): FormatOutput | null {
  const sentinel = parseSentinelOutput(text, hasVision);
  if (!sentinel) {
    structuralErrorCounter.record(false, 0);
    return null;
  }
  const raw = hasVision
    ? {
        report: sentinel.report,
        formatted: sentinel.formatted,
        vision_blocks_count: sentinel.visionCount ?? 0,
        embeds_preserved: sentinel.embeds ?? [],
      }
    : { report: sentinel.report, formatted: sentinel.formatted };
  const result = FormatOutputSchema.safeParse(raw);
  if (result.success) {
    structuralErrorCounter.record(true, 0);
    return result.data;
  }
  structuralErrorCounter.record(false, 0);
  return null;
}
```

**Retry hint становится конкретным**:

```typescript
const hint = result.error.issues
  .map((i) => `${i.path.join(".")}: ${i.message}`)
  .join("; ");
const retryAddition = `\n\nПредыдущая попытка не прошла валидацию: ${hint}. Исправь и верни заново используя маркеры <<<REPORT>>>...<<<END>>>.`;
```

**Изменения в `src/phases/format.ts`**:
- Убрать `response_format: { type: "json_object" }` из `baseParams`.
- `parseFormatOutput(fullText, hasVisionDescriptions)` принимает флаг. Флаг = `visionDescriptions.size > 0` (vision-распознавание вложений), НЕ параметр `hasVision` (image_url model capability). Только embed-описания добавляют большие таблицы в `formatted`, поэтому только они требуют усиленной Zod-схемы.
- Retry system prompt: вместо JSON-инструкций — sentinel-инструкции + Zod-feedback из первой попытки.
- Token-restore блок (строки 248-273): `messages.assistant.content = fullText` (sentinel-формат); user-prompt просит повторить с маркерами и сохранить пропущенные токены.

**Изменения в `prompts/format.md`**:
- Удалить блок про JSON-экранирование (строки 19-26).
- Заменить «Структура» (строки 27-32) на sentinel-шаблон + примеры (с vision-описаниями и без).
- Добавить новую template-переменную `{{has_vision_descriptions}}` (рендерится в `render(formatTemplate, ...)` из `runFormat`): при `true` — инструкция использовать маркеры `<<<VISION_COUNT>>>` и `<<<EMBEDS>>>` с перечислением путей всех embed'ов.
- Удалить «Бюджет: поле formatted может быть длинным...» либо переформулировать без JSON-контекста.

### C. Query Prompt Strengthening

Усиление `prompts/query.md` без изменения структурных правил (без принудительных секций — пользователь выбрал «только усилить форматирование»).

**Дополнения в раздел «Правила форматирования»**:

- Перечисления: список (`-` или `1.`), не inline через запятую.
- Сравнительные/числовые данные: таблица если ≥3 строки и ≥2 столбца.
- Ключевые сущности и термины: `**bold**` при первом упоминании.
- Code-fence для команд и путей (правило уже есть, усилить акцент).

**Негативный пример** (плоский абзац):

```
Известны три рецепта супов. Пряное грузинское харчо готовится 1,5–2 часа,
щи с фрикадельками требуют длительного костного бульона, костный бульон —
минимум 6 часов.
```

**Позитивный** (структурированный):

```
**Известные рецепты супов** (см. [[Wiki-страница]]):

| Суп | Время | Примечание |
|---|---|---|
| **Пряное грузинское харчо** | 1,5–2 ч | — |
| **Щи с фрикадельками** | требует длительного костного бульона | — |
| **Костный бульон** | ≥6 ч | — |
```

## Тесты

`tests/query-link-validator.test.ts`:
- `extractAnswerLinks — извлекает [[X]] из markdown`
- `extractAnswerLinks — игнорирует [[X|alias]] и [[path/X]]`
- `findBrokenLinks — возвращает только отсутствующие в knownStems`
- `findBrokenLinks — дедуплицирует битые`
- `annotateBroken — заменяет только битые, валидные нетронуты`
- `annotateBroken — не дублирует annotation при повторных битых ссылках`

`tests/query-validation-integration.test.ts`:
- `Query: все ссылки валидны → answer без изменений, retry не вызван`
- `Query: битые ссылки → retry вызван, исправленный answer возвращён`
- `Query: retry тоже битый → annotate fallback`
- `Query: retry throws → annotate fallback на initial`
- `Query: пустой answer → validation skipped`
- `Query: signal.aborted перед retry → return без annotate`

`tests/format-sentinel.test.ts`:
- `parseSentinelOutput — извлекает report и formatted между маркерами`
- `parseSentinelOutput — null если REPORT или FORMATTED отсутствует`
- `parseSentinelOutput — salvage: FORMATTED есть без END → truncated: true`
- `parseSentinelOutput — при hasVision требует VISION_COUNT и EMBEDS маркеры`
- `parseSentinelOutput — markdown с таблицами/control-chars не ломает парсинг`

`tests/format-zod-schema.test.ts`:
- `FormatOutputSchema — отвергает пустой report`
- `FormatOutputSchema — отвергает formatted < 10 chars`
- `FormatOutputSchema — superRefine: formatted без frontmatter → error`
- `FormatOutputSchema (vision) — пропавший embed → error с путём`
- `FormatOutputSchema (vision) — vision_blocks_count и embeds_preserved обязательны`

`tests/format-retry.test.ts`:
- `Format: первая попытка fail → retry с конкретным Zod-feedback`
- `Format: retry успешен → result emitted`
- `Format: retry тоже fail → salvage второй попытки`
- `Format: salvage сработал → warning + успешная запись`
- `Format: salvage fail → error event`

## Файлы

**Новые**:
- `src/phases/query-link-validator.ts`
- `tests/query-link-validator.test.ts`
- `tests/query-validation-integration.test.ts`
- `tests/format-sentinel.test.ts`
- `tests/format-zod-schema.test.ts`
- `tests/format-retry.test.ts`

**Модифицируемые**:
- `src/phases/query.ts` — интеграция validator после стрима, генерация `assistant_replace`.
- `src/phases/format.ts` — sentinel-парсинг, `hasVision` параметр в `parseFormatOutput`, Zod-feedback в retry.
- `src/phases/format-utils.ts` — `parseSentinelOutput`, `SentinelOutput` тип.
- `src/phases/zod-schemas.ts` — discriminated `FormatOutputSchema` + superRefine.
- `src/types.ts` — добавить `assistant_replace` в `RunEvent`.
- `src/view.ts` — handler для `assistant_replace` (reset + re-render).
- `prompts/query.md` — структурное форматирование, негатив/позитив примеры.
- `prompts/format.md` — sentinel-формат, vision-маркеры, удалить JSON-инструкции.
- `lat.md/llm-pipeline.md` — обновить `parseFormatOutput`, добавить query validation секцию.
- `lat.md/tests.md` — секции для новых тестов.
- `lat.md/architecture.md` — упомянуть `query-link-validator` модуль.

## Конфигурация

Без новых settings:
- `wikiLinkValidationRetries` существующая опция переиспользуется для query (0 = только validate, без retry).
- Format retry-логика уже существует — расширяем salvage без нового флага.

## Метрики риска

- **Sentinel collision**: `<<<REPORT>>>` встречается в реальной странице крайне маловероятно. Тест на random vault dump подтверждает.
- **Доп. LLM-вызов query**: только при наличии битых ссылок. Average overhead +1 вызов на 5-10 query при нормальном grounding.
- **Latency validation**: O(N) по pages где N ≈ 100-1000. <50ms.

## Совместимость

- Старые сохранённые `Q-*.md` страницы не трогаем.
- Backend-agnostic: sentinel работает без `response_format` → совместимо со всеми моделями (включая мобильный non-streaming).
- `assistant_replace` событие — новый kind в RunEvent union, существующий UI игнорирует unknown kinds (типобезопасно через discriminated union).

## Out of scope

- Persistent кэш `knownStems`.
- Авто-создание битой страницы по битой ссылке.
- Жёсткие фиксированные секции `## Краткий ответ / ## Детали / ## Источники` для query.
- Splitting format вывода на несколько LLM-вызовов по секциям.
- Миграция Vision-описаний в существующих страницах.
