# Agent Base Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить базовый системный промт (`prompts/base.md`), встраиваемый при сборке и инжектируемый первым в каждой операции LLM-агента.

**Architecture:** `prompts/base.md` импортируется как строка через esbuild text loader (уже настроен). `buildChatParams()` в `llm-utils.ts` prepend-ит базовый контракт к первому системному сообщению перед фазовым промтом. Пользовательский `## Уточнение` остаётся последним.

**Tech Stack:** TypeScript, esbuild (`loader: { ".md": "text" }`), vitest (плагин `md-text` уже настроен в `vitest.config.ts`)

---

## File Map

| Файл | Действие | Роль |
|------|----------|------|
| `prompts/base.md` | Create | Содержимое базового контракта |
| `src/phases/llm-utils.ts` | Modify | Импорт base.md + prepend в buildChatParams |
| `tests/llm-utils.test.ts` | Modify | Новые тесты + обновление существующих ожидаемых строк |

---

## Task 1: Написать падающие тесты для базового контракта

**Files:**
- Modify: `tests/llm-utils.test.ts`

- [ ] **Step 1: Добавить импорт baseContract и новый describe-блок в тест**

Открыть `tests/llm-utils.test.ts`. Добавить в начало файла импорт:

```typescript
import baseContract from "../../prompts/base.md";
```

Добавить после существующего describe-блока:

```typescript
describe("buildChatParams — base contract injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("prepends base contract before phase prompt", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("base contract is first: before phase prompt and before Уточнение", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "note" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nnote`);
  });

  it("prepends base contract when no system message exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, {});
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(baseContract);
  });
});
```

- [ ] **Step 2: Запустить только новые тесты — убедиться что они падают**

```bash
cd /home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki
npx vitest run tests/llm-utils.test.ts
```

Ожидается: новый describe-блок — FAIL (base.md не существует → импорт упадёт или контент не prepend-ится). Старые тесты могут пройти.

---

## Task 2: Создать `prompts/base.md`

**Files:**
- Create: `prompts/base.md`

- [ ] **Step 1: Создать файл с содержимым базового контракта**

Создать `/home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki/prompts/base.md` со следующим содержимым:

```markdown
Ты — wiki-агент. Следуй этим правилам независимо от операции.

## Достоверность
Отвечай строго на основе предоставленного контекста.
Не выдумывай факты, которых нет в источнике.
Если контекста недостаточно — скажи об этом прямо.

## Формат
Возвращай ровно то, что запрошено.
Если ожидается JSON — только валидный JSON, без пояснений вокруг.
Если ожидается текст — без служебных меток и технических артефактов.

## Минимализм
Не добавляй то, о чём не просили.
Не комментируй собственные действия, если это не часть задачи.
```

- [ ] **Step 2: Убедиться что vitest теперь импортирует файл без ошибок**

```bash
npx vitest run tests/llm-utils.test.ts
```

Ожидается: тесты на base contract всё ещё FAIL (контракт не injectится), но уже не из-за отсутствия файла. Ошибки должны быть типа `expected "Phase system prompt." to equal "Ты — wiki-агент...`.

---

## Task 3: Модифицировать `llm-utils.ts` — inject базового контракта

**Files:**
- Modify: `src/phases/llm-utils.ts`

- [ ] **Step 1: Добавить импорт base.md и функцию prependBaseContract**

Открыть `src/phases/llm-utils.ts`. Заменить содержимое файла на:

```typescript
import type OpenAI from "openai";
import type { LlmCallOptions } from "../types";
import baseContract from "../../prompts/base.md";

/** Извлекает reasoning и content из одного streaming-чанка.
 *  Reasoning-модели (minimax, o1 и др.) возвращают думающий текст в нестандартном поле delta.reasoning.
 *  Модели без поддержки reasoning возвращают пустую строку — ошибок не возникает. */
export function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): { reasoning: string; content: string } {
  const delta = chunk.choices[0]?.delta;
  const rawReasoning = (delta as Record<string, unknown> | undefined)?.reasoning;
  return {
    reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
    content: typeof delta?.content === "string" ? delta.content : "",
  };
}

export function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): Record<string, unknown> {
  let msgs = prependBaseContract(messages);
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;
  return params;
}

function prependBaseContract(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${baseContract}\n\n${existing}` };
    return updated;
  }
  return [{ role: "system", content: baseContract }, ...messages];
}

function injectSystemPrompt(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (!systemPrompt) return messages;
  const section = `## Уточнение\n${systemPrompt}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}
```

---

## Task 4: Обновить существующие тесты под новое поведение

**Files:**
- Modify: `tests/llm-utils.test.ts`

Существующий describe-блок `"buildChatParams — User prompt injection"` проверяет строки без базового контракта — после изменения он упадёт. Нужно обновить ожидаемые значения.

- [ ] **Step 1: Обновить ожидаемые строки в старом describe-блоке**

В блоке `"buildChatParams — User prompt injection"` заменить все ожидаемые строки, добавив `${baseContract}\n\n` в начало:

```typescript
describe("buildChatParams — User prompt injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("appends User prompt as ## Уточнение section", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "Используй формальный стиль." });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(
      `${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nИспользуй формальный стиль.`,
    );
  });

  it("does not modify messages when systemPrompt is empty", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("does not modify messages when systemPrompt is absent", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("creates system message when none exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, { systemPrompt: "note" });
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(`${baseContract}\n\n## Уточнение\nnote`);
  });
});
```

- [ ] **Step 2: Запустить все тесты — должны пройти**

```bash
npx vitest run tests/llm-utils.test.ts
```

Ожидается: все тесты PASS.

- [ ] **Step 3: Запустить полный test suite**

```bash
npx vitest run
```

Ожидается: все тесты PASS. Если есть другие тесты, проверяющие системный промт через `buildChatParams` — обновить по той же схеме.

---

## Task 5: Сборка и коммит

**Files:**
- Build: `dist/main.js`

- [ ] **Step 1: Поднять patch-версию**

Прочитать текущую версию из `package.json` (поле `version`). Инкрементировать patch: `X.Y.Z` → `X.Y.(Z+1)`. Записать новую версию в `package.json` и `manifest.json`.

- [ ] **Step 2: Собрать production bundle**

```bash
cd /home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki
npm run build
```

Ожидается: `dist/ updated: main.js, manifest.json, styles.css` без ошибок.

- [ ] **Step 3: Проверить что base.md встроен в bundle**

```bash
grep -c "wiki-агент" dist/main.js
```

Ожидается: `1` (строка из base.md присутствует в бандле).

- [ ] **Step 4: Коммит**

```bash
git add prompts/base.md src/phases/llm-utils.ts tests/llm-utils.test.ts dist/main.js package.json manifest.json
git commit -m "feat: add base agent contract injected before every system prompt"
```
