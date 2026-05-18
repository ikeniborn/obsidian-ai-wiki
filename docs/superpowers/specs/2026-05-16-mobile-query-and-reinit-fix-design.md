---
state: draft
date: 2026-05-16
review:
  spec_hash: e977842b57acbe29
  last_run: 2026-05-16
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
---

# Mobile query streaming + reinit nested folder — design

## Контекст

Два независимых бага, починим в одной итерации.

### Баг 1 — Mobile native-agent query «висит»

**Симптом.** На мобильном Obsidian при нажатии Ask:
- статус `▶ query` появляется,
- секция Progress пустая,
- запрос висит долго → либо приходит результат, либо timeout.

**Корень.** `src/mobile-fetch.ts` оборачивает `requestUrl` Obsidian — он буферизует весь HTTP-ответ. Phases (`query`, `lint`, …) вызывают OpenAI SDK с `stream: true`. Сервер шлёт SSE — `requestUrl` не отдаёт инкрементальных чанков, ждёт `connection: close`. До закрытия соединения UI не видит ни одного `chunk`, поэтому Progress пуст. Если генерация дольше `timeouts.query` (или сервер держит соединение) — timeout.

`requestUrl` фундаментально не умеет true streaming → нативный SSE на mobile невозможен без обхода через прямой `fetch` (что блокируется CORS на чужих endpoint).

### Баг 2 — Reinit создаёт вложенный домен

**Симптом.** Существующий `!Wiki/adm`. После Reinit домен материализуется в `!Wiki/adm/adm`.

**Корень.** `src/phases/init.ts` ветка `force=true`:
1. Зачищает `existing.entity_types`, `analyzed_sources`, `language_notes` (НЕ `wiki_folder`).
2. Зовёт `runInitWithSources(…, force=true)`.
3. Внутри, при `i === 0 && !isResuming`, выполняется bootstrap LLM-запрос (init.ts:282-309).
4. LLM получает контекст с существующим `_index.md` и **сам решает, какой `wiki_folder` указать** — иногда возвращает `"adm/adm"` (вложение domain id в существующий путь).
5. `entry.wiki_folder = parsed.wiki_folder` (init.ts:326), затем сохраняется в `currentDomain.wiki_folder` (init.ts:352) → перезаписывает корректный путь.

LLM не должен выбирать `wiki_folder` при reinit — путь домена уже зафиксирован.

## Цели

1. Mobile native-agent query действительно работает: запрос отправляется, результат возвращается, прогресс показывает спиннер вместо пустоты.
2. Reinit сохраняет `existing.wiki_folder`, не вкладывает домен в самого себя.

## Изменения

### 1. Mobile: force `stream: false` через LlmClient-обёртку

Новый файл `src/mobile-llm-wrap.ts`:

```ts
import type { LlmClient } from "./types";
import type OpenAI from "openai";

/**
 * Mobile-only wrapper: forces stream:false (requestUrl/mobileFetch не поддерживает
 * incremental SSE). Эмулирует AsyncIterable из non-stream completion для совместимости
 * с phase-кодом, который ожидает chunk-stream.
 */
export function wrapMobileNoStream(inner: LlmClient): LlmClient {
  const create = (async (params: Record<string, unknown>, callOpts?: { signal?: AbortSignal }) => {
    if (params.stream !== true) {
      return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
    }
    const noStreamParams = { ...params, stream: false } as Record<string, unknown>;
    delete noStreamParams.stream_options;
    const resp = (await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<OpenAI.Chat.ChatCompletion>)(noStreamParams, callOpts)) as OpenAI.Chat.ChatCompletion;
    return completionToAsyncIterable(resp);
  }) as unknown as LlmClient["chat"]["completions"]["create"];
  return { chat: { completions: { create } } };
}

async function* completionToAsyncIterable(c: OpenAI.Chat.ChatCompletion): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const choice = c.choices[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const reasoning = (choice?.message as { reasoning?: string } | undefined)?.reasoning;

  if (reasoning) {
    yield mkChunk(c, { reasoning } as Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>);
  }
  if (content) {
    yield mkChunk(c, { content });
  }
  yield mkChunk(c, {}, choice?.finish_reason ?? "stop", c.usage ?? null);
}

function mkChunk(
  base: OpenAI.Chat.ChatCompletion,
  delta: Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>,
  finish_reason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"] | null = null,
  usage: OpenAI.CompletionUsage | null = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: base.id, object: "chat.completion.chunk", created: base.created, model: base.model,
    choices: [{ index: 0, delta: delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason, logprobs: null }],
    usage: usage ?? undefined,
  } as OpenAI.Chat.ChatCompletionChunk;
}
```

Подключение в `src/controller.ts:467-477` (ветка не-claude-agent):

```ts
llm = new OpenAI({ … });
if (Platform.isMobile) {
  llm = wrapMobileNoStream(llm);
}
```

Обёртка применяется **перед** `wrapWithJsonFallback` (если используется), чтобы JSON-fallback видел уже non-stream путь. Проверить порядок применения в `agent-runner.ts`/`buildAgentRunner`.

**Усечение `reasoning`:** на mobile теряем reasoning-стрим. Это приемлемо — на mobile нет devMode и UX упрощён.

### 2. Reinit: preserve existing.wiki_folder

`src/phases/init.ts` — две точки модификации:

**(a)** В `runInitWithSources` bootstrap-блок (после строки 326-333, перед записью в `currentDomain`):

```ts
// На reinit (force=true) wiki_folder уже зафиксирован — LLM не должен его менять.
if (force && existing) {
  entry.wiki_folder = existing.wiki_folder;
}
```

**(b)** Аналогично в incremental-блоке если он также формирует `entry.wiki_folder` (проверить — кажется, нет, но защититься).

Точка (a) достаточна: при reinit с force=true путь `runInitWithSources` всегда идёт через bootstrap (`!isResuming` т.к. analyzed_sources обнулены в `init` force-ветке).

### 3. UX-плейсхолдер на mobile

`src/view.ts` `setRunning()`:

```ts
if (Platform.isMobile) {
  // Streaming недоступен — показываем спиннер чтобы UI не выглядел замёрзшим.
  const placeholder = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step-pending");
  placeholder.setText(i18n().view.mobileWaiting);  // «⏳ Ожидание ответа от LLM…»
}
```

Удаляется при первом реальном событии (`ev.kind === "graph_stats"` или любой step).

Добавить ключ `view.mobileWaiting` в `src/i18n.ts` (ru/en/es).

## Архитектурная заметка

`wrapMobileNoStream` — изолированный shim, не лезет в phases. Если в будущем Obsidian-API получит true streaming (или сменим транспорт на нативный fetch с CORS-проверкой), достаточно убрать обёртку — phases останутся как есть.

## Тестирование

- `tests/mobile-llm-wrap.test.ts` (новый): `wrapMobileNoStream` превращает non-stream completion в AsyncIterable из 1-3 чанков (reasoning?, content, final).
- `tests/phases/init.test.ts` (расширить): reinit с `force=true` сохраняет `existing.wiki_folder` даже если LLM вернул другой путь.
- Ручной тест на mobile: query завершается, спиннер показывается, результат рендерится.
- Ручной тест: reinit домена `adm` оставляет `!Wiki/adm`, не создаёт `!Wiki/adm/adm`.

## Что НЕ делаем

- Не пытаемся реализовать true streaming на mobile через нативный fetch — отдельная задача, CORS-зависимо.
- Не трогаем `claude-agent` backend — на mobile он force-конвертится в native-agent (main.ts:208).
- Не вводим pre-validation для `init` (без force) — баг проявляется только на reinit, точечный фикс безопаснее.

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/mobile-llm-wrap.ts` | новый — `wrapMobileNoStream` |
| `src/controller.ts` | применить `wrapMobileNoStream` на mobile при создании OpenAI |
| `src/phases/init.ts` | preserve `existing.wiki_folder` при force |
| `src/view.ts` | placeholder-step на mobile |
| `src/i18n.ts` | ключ `view.mobileWaiting` ru/en/es |
| `tests/mobile-llm-wrap.test.ts` | новый unit-тест |
| `tests/phases/init.test.ts` | расширить — reinit wiki_folder preservation |
