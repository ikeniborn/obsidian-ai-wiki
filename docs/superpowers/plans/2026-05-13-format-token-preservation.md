# Format Token Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Предотвратить потерю токенов при форматировании: token-retry с multi-turn correction + `appendMissingLines` как fallback.

**Architecture:** После успешного JSON-парсинга проверяем `missingTokensWithContext`; если потери — один token-retry через multi-turn (модель видит свой ответ); если retry не помог — дописываем оригинальные строки-источники в конец документа через `appendMissingLines`.

**Tech Stack:** TypeScript, OpenAI-compatible LLM client, Vitest

---

## File Map

| Файл | Действие |
|---|---|
| `src/phases/format-utils.ts` | Добавить `appendMissingLines`, экспортировать |
| `src/phases/format.ts` | Добавить token-retry после JSON-парсинга; вызвать `appendMissingLines` при необходимости |
| `tests/phases/format-utils.test.ts` | Unit-тесты `appendMissingLines` |
| `tests/phases/format.test.ts` | Integration-тесты token-retry |

---

### Task 1: `appendMissingLines` — unit tests

**Files:**
- Test: `tests/phases/format-utils.test.ts`

- [ ] **Step 1: Добавить импорт и тест-suite в конец файла**

```typescript
// В конец tests/phases/format-utils.test.ts:
import { appendMissingLines } from "../../src/phases/format-utils";

describe("appendMissingLines", () => {
  it("дописывает restored-block с оригинальными строками", () => {
    const formatted = "# Заголовок\n\nТекст.";
    const missing = [
      { token: "ClickHouse", context: "ClickHouse 23.8 — колоночная СУБД." },
      { token: "https://a.b", context: "См. https://a.b/docs" },
    ];
    const result = appendMissingLines(formatted, missing);
    expect(result).toContain("---\n<!-- restored-lines: token loss after retry -->");
    expect(result).toContain("ClickHouse 23.8 — колоночная СУБД.");
    expect(result).toContain("См. https://a.b/docs");
  });

  it("дедуплицирует строки-источники", () => {
    const formatted = "# H";
    const missing = [
      { token: "API", context: "Строка с API и другими токенами" },
      { token: "HTTP", context: "Строка с API и другими токенами" },
    ];
    const result = appendMissingLines(formatted, missing);
    const count = (result.match(/Строка с API/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("пропускает токены с пустым context", () => {
    const formatted = "# H";
    const missing = [
      { token: "API", context: "" },
      { token: "URL", context: "" },
    ];
    const result = appendMissingLines(formatted, missing);
    expect(result).toBe("# H");
  });

  it("если все context пустые — возвращает formatted без изменений", () => {
    const formatted = "# H\n\nТекст.";
    const result = appendMissingLines(formatted, [{ token: "X", context: "" }]);
    expect(result).toBe("# H\n\nТекст.");
  });

  it("не мутирует входной formatted", () => {
    const formatted = "# H";
    const missing = [{ token: "API", context: "строка с API" }];
    const before = formatted;
    appendMissingLines(formatted, missing);
    expect(formatted).toBe(before);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/phases/format-utils.test.ts
```

Ожидаемый результат: FAIL — `appendMissingLines is not a function` (или аналогичная ошибка импорта).

---

### Task 2: Реализовать `appendMissingLines` в `format-utils.ts`

**Files:**
- Modify: `src/phases/format-utils.ts`

- [ ] **Step 1: Добавить функцию и экспорт в конец файла**

Добавить после последней функции в `src/phases/format-utils.ts`:

```typescript
export function appendMissingLines(formatted: string, missing: MissingToken[]): string {
  const lines = [...new Set(missing.filter((m) => m.context !== "").map((m) => m.context))];
  if (lines.length === 0) return formatted;
  return `${formatted}\n\n---\n<!-- restored-lines: token loss after retry -->\n${lines.join("\n")}`;
}
```

- [ ] **Step 2: Запустить тесты — убедиться что проходят**

```bash
npx vitest run tests/phases/format-utils.test.ts
```

Ожидаемый результат: все тесты PASS.

- [ ] **Step 3: Коммит**

```bash
git add src/phases/format-utils.ts tests/phases/format-utils.test.ts
git commit -m "feat(format-utils): add appendMissingLines for token-loss fallback"
```

---

### Task 3: Token-retry — тесты для `format.test.ts`

**Files:**
- Test: `tests/phases/format.test.ts`

Добавить вспомогательную функцию `makeLlmSequence` и два новых теста в существующий `describe("runFormat")`.

- [ ] **Step 1: Добавить `makeLlmSequence` после `makeLlm`**

В `tests/phases/format.test.ts`, после блока `function makeLlm(...)`:

```typescript
function makeLlmSequence(responses: string[]): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const response = responses[Math.min(callCount, responses.length - 1)];
          callCount++;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: response }, finish_reason: null }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}
```

- [ ] **Step 2: Добавить тест — retry восстанавливает токен**

В `describe("runFormat")`, в конец блока:

```typescript
it("token-retry: LLM дропает токен в первом ответе, восстанавливает во втором", async () => {
  // Первый ответ: formatted без URL
  const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
  const json1 = JSON.stringify({ report: "r", formatted: formatted1 });
  // Второй ответ (token-retry): formatted с URL
  const formatted2 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL https://clickhouse.com/docs `insertBatch`. Яндекс.";
  const json2 = JSON.stringify({ report: "r2", formatted: formatted2 });

  const adapter = mockAdapter({ [FILE]: SAMPLE });
  const vt = new VaultTools(adapter, VAULT);
  const llm = makeLlmSequence([json1, json2]);

  const events = await collect(
    runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
  );

  // LLM вызван дважды
  expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

  const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview") as {
    missingTokens: { token: string }[];
    tempPath: string;
  };
  expect(preview).toBeDefined();
  // После retry missing должны быть пусты (или значительно меньше)
  expect(preview.missingTokens.map((m) => m.token)).not.toContain("https://clickhouse.com/docs");

  // Записан результат второго ответа
  expect(adapter.write).toHaveBeenCalledWith("note.formatted.md", expect.stringContaining("https://clickhouse.com/docs"));
});

it("token-retry: оба ответа дропают токен → restored-block добавлен в tempPath", async () => {
  // Оба ответа: formatted без URL
  const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
  const json1 = JSON.stringify({ report: "r", formatted: formatted1 });
  const json2 = JSON.stringify({ report: "r2", formatted: formatted1 });

  const adapter = mockAdapter({ [FILE]: SAMPLE });
  const vt = new VaultTools(adapter, VAULT);
  const llm = makeLlmSequence([json1, json2]);

  const events = await collect(
    runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
  );

  expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

  // write вызван с restored-block
  const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  expect(written).toContain("<!-- restored-lines: token loss after retry -->");
  expect(written).toContain("https://clickhouse.com/docs");
});
```

- [ ] **Step 3: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/phases/format.test.ts
```

Ожидаемый результат: два новых теста FAIL — token-retry не реализован, LLM вызван 1 раз вместо 2.

---

### Task 4: Реализовать token-retry в `format.ts`

**Files:**
- Modify: `src/phases/format.ts`

- [ ] **Step 1: Добавить `appendMissingLines` в импорт**

Строка 8 в `src/phases/format.ts`:

```typescript
import { extractJsonObject, missingTokensWithContext, looksTruncated, appendMissingLines } from "./format-utils";
```

- [ ] **Step 2: Заменить блок после JSON-retry на token-retry flow**

Найти в `format.ts` блок:

```typescript
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
  const baseName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).replace(/\.md$/, "") || "page";
  const tempPath = dir ? `${dir}/${baseName}.formatted.md` : `${baseName}.formatted.md`;

  try {
    await vaultTools.write(tempPath, parsed.formatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
    return;
  }

  const missing = missingTokensWithContext(original, parsed.formatted);
  yield { kind: "format_preview", tempPath, report: parsed.report, missingTokens: missing };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.report };
```

Заменить на:

```typescript
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
  const baseName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).replace(/\.md$/, "") || "page";
  const tempPath = dir ? `${dir}/${baseName}.formatted.md` : `${baseName}.formatted.md`;

  // Token-retry: если первый ответ потерял токены — один correction round-trip.
  let finalFormatted = parsed.formatted;
  let finalReport = parsed.report;
  const missing1 = missingTokensWithContext(original, parsed.formatted);

  if (missing1.length > 0 && !signal.aborted) {
    const tokenList = missing1.map((m) => `\`${m.token}\``).join(", ");
    const restoreMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: fullText },
      {
        role: "user",
        content: `ВОССТАНОВИ ТОКЕНЫ: следующие значения из оригинала отсутствуют в форматированном тексте. Верни полный JSON {report, formatted} где formatted содержит все перечисленные токены без изменения форматирования остального текста.\nПропущенные: ${tokenList}`,
      },
    ];
    const restoreParams = { ...buildChatParams(model, restoreMessages, opts), response_format: { type: "json_object" } };
    const fullText2 = yield* callOnce(restoreParams);
    if (!signal.aborted) {
      const parsed2 = extractJsonObject(fullText2);
      if (parsed2) {
        finalFormatted = parsed2.formatted;
        finalReport = parsed2.report;
      }
      const missing2 = missingTokensWithContext(original, finalFormatted);
      if (missing2.length > 0) {
        finalFormatted = appendMissingLines(finalFormatted, missing2);
      }
    }
  }

  try {
    await vaultTools.write(tempPath, finalFormatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
    return;
  }

  const missingFinal = missingTokensWithContext(original, finalFormatted);
  yield { kind: "format_preview", tempPath, report: finalReport, missingTokens: missingFinal };
  yield { kind: "result", durationMs: Date.now() - start, text: finalReport };
```

- [ ] **Step 3: Запустить все тесты format**

```bash
npx vitest run tests/phases/format.test.ts tests/phases/format-utils.test.ts
```

Ожидаемый результат: все тесты PASS.

- [ ] **Step 4: Запустить полный тест-сьют**

```bash
npm test
```

Ожидаемый результат: все тесты PASS, нет регрессий.

- [ ] **Step 5: Обновить версию и собрать**

Прочитать текущую версию из `package.json` (сейчас `0.1.83`), записать `0.1.84` в `package.json` и `src/manifest.json`, затем:

```bash
npm run build
```

Ожидаемый результат: `dist/main.js` обновлён без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add src/phases/format.ts tests/phases/format.test.ts package.json src/manifest.json dist/main.js dist/manifest.json
git commit -m "feat(format): token-retry + appendMissingLines fallback — prevent token loss on format"
```

---

## Self-Review

### Spec coverage

| Требование | Задача |
|---|---|
| Без доп. LLM-вызовов при нет потерь | Task 4 — token-retry guard `if (missing1.length > 0)` |
| Макс. 1 correction-retry | Task 4 — один `callOnce(restoreParams)` |
| `missingTokensWithContext()` без изменений | Не затронута |
| `appendMissingLines`: дедуп строк, пустой context пропускается | Task 2 |
| Token-retry JSON невалид → `formatted1 + missing1` | Task 4 — `if (parsed2)` ветка: если `!parsed2`, `finalFormatted` остаётся `parsed.formatted`, `missing2 = missingTokensWithContext(original, finalFormatted)` = `missing1` → `appendMissingLines(formatted1, missing1)` ✓ |
| `signal.aborted` в token-retry → ранний return | Task 4 — `if (!signal.aborted)` обёртка после `callOnce` |
| `format_preview { missingTokens }` shape без изменений | Task 4 — `missingFinal` передаётся тем же полем |
| JSON-retry + token-retry: `fullText` из JSON-retry | Task 4 — `fullText` перезаписывается в `callOnce` при JSON-retry, токен-retry использует актуальный `fullText` ✓ |
| Тест: retry восстанавливает токен | Task 3 |
| Тест: оба дропают → restored-block | Task 3 |
| Тест: `appendMissingLines` unit | Task 1–2 |

### Граничный случай: `m.context === ""`

`appendMissingLines` фильтрует через `.filter((m) => m.context !== "")` — покрыто тестом Task 1 Step 1.

### Type consistency

- `MissingToken` определён в `format-utils.ts` строка 147 — `appendMissingLines` принимает `MissingToken[]`, все вызовы передают результат `missingTokensWithContext()` → тип совпадает.
- `fullText` — `string`, возвращается из `callOnce` (return type `AsyncGenerator<RunEvent, string>`) — `{ role: "assistant", content: fullText }` корректен.
- `restoreMessages` добавляет `{ role: "assistant", content: string }` и `{ role: "user", content: string }` — оба совместимы с `OpenAI.Chat.ChatCompletionMessageParam`.
