# LLM-as-Judge Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить второй слой валидации (LLM-as-Judge) поверх существующего token-checker для операций `format` и `ingest`. Judge возвращает structured-verdict (verdict + score + lostClaims + structuralLosses), отображается в UI как warning, не блокирует apply.

**Architecture:** Новая фаза `runJudge` (отдельный LLM-вызов), вызывается из `AgentRunner` после успешного `runFormat`/`runIngest`. Phase эмитит внутренний `judge_input` event (original+output), который `AgentRunner` перехватывает и передаёт в `maybeRunJudge`. Конфиг — новая секция `settings.judge` (master-toggle + per-backend (claude/native) + per-operation модели). Ошибки judge → warning, основная операция не валится.

**Tech Stack:** TypeScript, Vitest, esbuild, Obsidian API, OpenAI-совместимый LlmClient (тот же, что у формат-фазы — модель переопределяется через params).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Типы: `JudgeOpKey`, `JudgeSeverity`, `JudgeVerdict`, `JudgeLostClaim`, `JudgeOperationConfig`, `JudgeBackendConfig`, `JudgeConfig`, расширение `LlmWikiPluginSettings`, `RunEvent` += `judge_report` + `judge_input` |
| `src/settings.ts` | DEFAULT для `judge`, UI-секция (master + per-backend collapsable) |
| `src/main.ts` | Миграция в `loadSettings` (отсутствующая секция → defaults) |
| `prompts/judge.md` | Системный промпт (роль, severity, verdict, schema) |
| `src/phases/judge.ts` | `runJudge` generator + `parseJudgeResponse` парсер |
| `src/phases/format.ts` | yield `judge_input` перед `result` |
| `src/phases/ingest.ts` | yield `judge_input` перед `result` |
| `src/agent-runner.ts` | `maybeRunJudge` helper, перехват `judge_input`, dispatch judge |
| `src/view.ts` | Рендер `judge_report` блока + игнор `judge_input` |
| `tests/phases/judge.test.ts` | Unit-тесты `runJudge`: парсинг, schema, abort, error handling |
| `tests/phases/judge-prompt.test.ts` | Снапшот рендера judge-промпта для format/ingest |
| `tests/agent-runner.integration.test.ts` | Сценарии judge enabled/disabled, backend toggle, ошибка judge |
| `tests/main.settings.test.ts` *(new или extend существующего)* | Миграция defaults для `judge` |

---

### Task 1: Types — JudgeConfig + RunEvent extensions

**Files:**
- Modify: `src/types.ts:41-59` (RunEvent union), `src/types.ts:110-145` (LlmWikiPluginSettings), `src/types.ts:147-187` (DEFAULT_SETTINGS)

- [ ] **Step 1: Add Judge types**

В `src/types.ts` после `LlmCallOptions` (после строки 79) добавить:

```ts
export type JudgeOpKey = "format" | "ingest";
export type JudgeSeverity = "critical" | "major" | "minor";
export type JudgeVerdict = "pass" | "warn" | "fail";

export interface JudgeLostClaim {
  quote: string;
  severity: JudgeSeverity;
  reason: string;
}

export interface JudgeOperationConfig {
  model: string;
}

export interface JudgeBackendConfig {
  enabled: boolean;
  model: string;
  perOperation: boolean;
  operations: Record<JudgeOpKey, JudgeOperationConfig>;
}

export interface JudgeConfig {
  enabled: boolean;
  claudeAgent: JudgeBackendConfig;
  nativeAgent: JudgeBackendConfig;
}
```

- [ ] **Step 2: Extend RunEvent union**

В `src/types.ts:59` после `format_cancelled` добавить (перед `;`):

```ts
  | { kind: "judge_input"; operation: JudgeOpKey; original: string; output: string }
  | {
      kind: "judge_report";
      operation: JudgeOpKey;
      verdict: JudgeVerdict;
      score: number;
      lostClaims: JudgeLostClaim[];
      structuralLosses: string[];
    }
```

- [ ] **Step 3: Extend LlmWikiPluginSettings**

В `src/types.ts:110-145` (interface `LlmWikiPluginSettings`) после `devMode` добавить:

```ts
  judge: JudgeConfig;
```

- [ ] **Step 4: Extend DEFAULT_SETTINGS**

В `src/types.ts:187` (после блока `devMode`) перед закрывающей `};` добавить:

```ts
  judge: {
    enabled: false,
    claudeAgent: {
      enabled: true,
      model: "haiku",
      perOperation: false,
      operations: {
        format: { model: "haiku" },
        ingest: { model: "haiku" },
      },
    },
    nativeAgent: {
      enabled: true,
      model: "llama3.2",
      perOperation: false,
      operations: {
        format: { model: "llama3.2" },
        ingest: { model: "llama3.2" },
      },
    },
  },
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: `main.js` сборка без TS-ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(judge): add JudgeConfig types and RunEvent variants"
```

---

### Task 2: Settings migration in `loadSettings`

**Files:**
- Modify: `src/main.ts:127-154` (объект-сборка settings)

- [ ] **Step 1: Add judge merge logic**

В `src/main.ts:127` (внутри `this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}), ... }`) добавить ключ `judge` ПОСЛЕ `nativeAgent`-блока (после строки 152, до `history`):

```ts
      judge: mergeJudgeConfig((data?.judge as Record<string, unknown> | undefined) ?? {}),
```

- [ ] **Step 2: Add helper at bottom of main.ts**

В конец `src/main.ts` (перед `migrateLegacyData` или сразу после класса) добавить:

```ts
function mergeJudgeConfig(data: Record<string, unknown>): import("./types").JudgeConfig {
  const def = DEFAULT_SETTINGS.judge;
  const ca = (data.claudeAgent as Record<string, unknown>) ?? {};
  const na = (data.nativeAgent as Record<string, unknown>) ?? {};
  const caOps = (ca.operations as Record<string, unknown>) ?? {};
  const naOps = (na.operations as Record<string, unknown>) ?? {};
  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : def.enabled,
    claudeAgent: {
      ...def.claudeAgent,
      ...ca,
      operations: {
        format: { ...def.claudeAgent.operations.format, ...((caOps.format as object) ?? {}) },
        ingest: { ...def.claudeAgent.operations.ingest, ...((caOps.ingest as object) ?? {}) },
      },
    },
    nativeAgent: {
      ...def.nativeAgent,
      ...na,
      operations: {
        format: { ...def.nativeAgent.operations.format, ...((naOps.format as object) ?? {}) },
        ingest: { ...def.nativeAgent.operations.ingest, ...((naOps.ingest as object) ?? {}) },
      },
    },
  };
}
```

(Импорт `DEFAULT_SETTINGS` уже присутствует — проверить.)

- [ ] **Step 3: Write migration test**

Create `tests/main.judge-settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";

describe("judge settings defaults", () => {
  it("has disabled master toggle by default", () => {
    expect(DEFAULT_SETTINGS.judge.enabled).toBe(false);
  });
  it("claude-agent default model is haiku", () => {
    expect(DEFAULT_SETTINGS.judge.claudeAgent.model).toBe("haiku");
    expect(DEFAULT_SETTINGS.judge.claudeAgent.operations.format.model).toBe("haiku");
    expect(DEFAULT_SETTINGS.judge.claudeAgent.operations.ingest.model).toBe("haiku");
  });
  it("native-agent default model is llama3.2", () => {
    expect(DEFAULT_SETTINGS.judge.nativeAgent.model).toBe("llama3.2");
  });
  it("perOperation off by default", () => {
    expect(DEFAULT_SETTINGS.judge.claudeAgent.perOperation).toBe(false);
    expect(DEFAULT_SETTINGS.judge.nativeAgent.perOperation).toBe(false);
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/main.judge-settings.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/main.judge-settings.test.ts
git commit -m "feat(judge): merge judge settings on load with defaults"
```

---

### Task 3: Judge system prompt

**Files:**
- Create: `prompts/judge.md`

- [ ] **Step 1: Write prompt file**

Create `prompts/judge.md`:

```markdown
Ты — валидатор семантической сохранности при трансформации markdown-документа.

# Вход

OPERATION: {{operation}}  (`format` = переформатирование одного файла, `ingest` = синтез wiki-страниц из исходника)
ORIGINAL — исходный текст
OUTPUT — результат после трансформации

# Задача

Сравни OUTPUT с ORIGINAL. Найди:

1. **Утраченные факты** (`lostClaims`) — конкретные утверждения, числа, даты, имена, ссылки, выводы из ORIGINAL, отсутствующие или искажённые в OUTPUT.
2. **Структурные потери** (`structuralLosses`) — пропавшие списки, таблицы, code-блоки, inline-ссылки, цитаты, изображения, заголовки разделов.

# Что игнорировать

- Перефраз с сохранением смысла
- Удаление дубликатов, "воды", служебных пометок
- Изменение форматирования (отступы, регистр, порядок)
- Реструктуризацию (для `ingest` — разбиение на страницы и удаление meta-шапки нормально)
- Стилевые правки

# Severity (для каждого lostClaim)

- `critical` — фактическая ошибка (число/дата/имя искажены) ИЛИ удалён ключевой блок с уникальной информацией
- `major` — значимая деталь утрачена, но не меняет ключевой смысл
- `minor` — второстепенная деталь, побочный пример, дублирующий нюанс

# Verdict (рекомендация)

- `fail` — ≥1 critical
- `warn` — ≥1 major ИЛИ ≥3 minor
- `pass` — иначе

# Score

Целое 0-100. Корреляция с verdict: pass ≥ 85, warn 50-84, fail < 50.

# Выход

СТРОГО JSON-объект без markdown-обёртки, без ```json, без пояснений:

```
{
  "verdict": "pass" | "warn" | "fail",
  "score": <int 0-100>,
  "lostClaims": [
    { "quote": "<≤200 символов из ORIGINAL>", "severity": "critical|major|minor", "reason": "<≤200 символов>" }
  ],
  "structuralLosses": [ "<≤200 символов>" ]
}
```

Все спецсимволы в строках экранируй (`\n`, `\"`, `\\`). Массивы могут быть пустыми.
```

- [ ] **Step 2: Verify import path**

Открыть `src/phases/format.ts:5` — убедиться что pattern `import xxx from "../../prompts/xxx.md"` работает (это esbuild text-loader).

Run: `grep -n "loader" esbuild.config.mjs`
Expected: видим `.md` → `text` loader (или эквивалент).

- [ ] **Step 3: Commit**

```bash
git add prompts/judge.md
git commit -m "feat(judge): add judge system prompt"
```

---

### Task 4: Judge phase — `runJudge` generator

**Files:**
- Create: `src/phases/judge.ts`

- [ ] **Step 1: Write failing test**

Create `tests/phases/judge.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runJudge, parseJudgeResponse } from "../../src/phases/judge";
import type { LlmClient } from "../../src/types";

function makeLlm(responseJson: string): LlmClient {
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseJson } }] };
    },
  };
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue(stream) } },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("parseJudgeResponse", () => {
  it("parses valid JSON", () => {
    const r = parseJudgeResponse('{"verdict":"pass","score":92,"lostClaims":[],"structuralLosses":[]}');
    expect(r).toEqual({ verdict: "pass", score: 92, lostClaims: [], structuralLosses: [] });
  });

  it("strips ```json fence", () => {
    const r = parseJudgeResponse('```json\n{"verdict":"warn","score":70,"lostClaims":[],"structuralLosses":[]}\n```');
    expect(r?.verdict).toBe("warn");
  });

  it("rejects invalid verdict", () => {
    expect(parseJudgeResponse('{"verdict":"ok","score":50,"lostClaims":[],"structuralLosses":[]}')).toBeNull();
  });

  it("clamps score to 0-100", () => {
    const r = parseJudgeResponse('{"verdict":"fail","score":150,"lostClaims":[],"structuralLosses":[]}');
    expect(r?.score).toBe(100);
  });

  it("rejects non-object", () => {
    expect(parseJudgeResponse("not json")).toBeNull();
  });

  it("filters lostClaims with invalid severity", () => {
    const r = parseJudgeResponse(
      '{"verdict":"warn","score":60,"lostClaims":[{"quote":"x","severity":"bad","reason":"y"},{"quote":"a","severity":"major","reason":"b"}],"structuralLosses":[]}',
    );
    expect(r?.lostClaims).toHaveLength(1);
    expect(r?.lostClaims[0].severity).toBe("major");
  });
});

describe("runJudge", () => {
  it("yields judge_report on valid response", async () => {
    const llm = makeLlm('{"verdict":"pass","score":95,"lostClaims":[],"structuralLosses":[]}');
    const ev = await collect(runJudge("format", "orig", "out", llm, "haiku", new AbortController().signal));
    const report = ev.find((e) => e.kind === "judge_report");
    expect(report).toBeTruthy();
    if (report?.kind === "judge_report") {
      expect(report.verdict).toBe("pass");
      expect(report.score).toBe(95);
      expect(report.operation).toBe("format");
    }
  });

  it("yields error event on invalid JSON", async () => {
    const llm = makeLlm("not json at all");
    const ev = await collect(runJudge("format", "o", "u", llm, "haiku", new AbortController().signal));
    const err = ev.find((e) => e.kind === "error");
    expect(err).toBeTruthy();
    if (err?.kind === "error") expect(err.message).toMatch(/^\[judge\]/);
  });

  it("silent on abort", async () => {
    const ac = new AbortController();
    ac.abort();
    const llm = makeLlm('{"verdict":"pass","score":100,"lostClaims":[],"structuralLosses":[]}');
    const ev = await collect(runJudge("format", "o", "u", llm, "haiku", ac.signal));
    expect(ev.find((e) => e.kind === "judge_report")).toBeUndefined();
  });

  it("yields error event on LLM throw", async () => {
    const llm = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error("network")) } },
    } as unknown as LlmClient;
    const ev = await collect(runJudge("ingest", "o", "u", llm, "haiku", new AbortController().signal));
    const err = ev.find((e) => e.kind === "error");
    expect(err).toBeTruthy();
    if (err?.kind === "error") expect(err.message).toMatch(/^\[judge\]/);
  });
});
```

- [ ] **Step 2: Run test (should fail — module не существует)**

Run: `npx vitest run tests/phases/judge.test.ts`
Expected: FAIL — `Cannot find module '../../src/phases/judge'`.

- [ ] **Step 3: Implement runJudge**

Create `src/phases/judge.ts`:

```ts
import type OpenAI from "openai";
import type { JudgeOpKey, JudgeLostClaim, JudgeSeverity, JudgeVerdict, LlmCallOptions, LlmClient, RunEvent } from "../types";
import judgeTemplate from "../../prompts/judge.md";
import { render } from "./template";
import { buildChatParams, extractStreamDeltas } from "./llm-utils";

export interface JudgeResult {
  verdict: JudgeVerdict;
  score: number;
  lostClaims: JudgeLostClaim[];
  structuralLosses: string[];
}

const VALID_VERDICTS: JudgeVerdict[] = ["pass", "warn", "fail"];
const VALID_SEVERITIES: JudgeSeverity[] = ["critical", "major", "minor"];

function stripFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return m ? m[1].trim() : trimmed;
}

export function parseJudgeResponse(text: string): JudgeResult | null {
  const cleaned = stripFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }

  if (typeof parsed.verdict !== "string" || !VALID_VERDICTS.includes(parsed.verdict as JudgeVerdict)) return null;
  if (typeof parsed.score !== "number") return null;

  const lostRaw = Array.isArray(parsed.lostClaims) ? parsed.lostClaims : [];
  const lost: JudgeLostClaim[] = [];
  for (const c of lostRaw) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    if (typeof cc.quote !== "string" || typeof cc.reason !== "string") continue;
    if (typeof cc.severity !== "string" || !VALID_SEVERITIES.includes(cc.severity as JudgeSeverity)) continue;
    lost.push({ quote: cc.quote, severity: cc.severity as JudgeSeverity, reason: cc.reason });
  }

  const structuralRaw = Array.isArray(parsed.structuralLosses) ? parsed.structuralLosses : [];
  const structural = structuralRaw.filter((s: unknown): s is string => typeof s === "string");

  return {
    verdict: parsed.verdict as JudgeVerdict,
    score: Math.min(100, Math.max(0, Math.round(parsed.score))),
    lostClaims: lost,
    structuralLosses: structural,
  };
}

export async function* runJudge(
  operation: JudgeOpKey,
  original: string,
  output: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  if (signal.aborted) return;

  const system = render(judgeTemplate, { operation });
  const user = `OPERATION: ${operation}\n\n---ORIGINAL---\n${original}\n\n---OUTPUT---\n${output}`;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const params = { ...buildChatParams(model, messages, opts), response_format: { type: "json_object" } };

  let acc = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { content } = extractStreamDeltas(chunk);
      if (content) acc += content;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "error", message: `[judge] ${(e as Error).message}` };
    return;
  }

  if (signal.aborted) return;

  const result = parseJudgeResponse(acc);
  if (!result) {
    yield { kind: "error", message: "[judge] невалидный JSON в ответе" };
    return;
  }

  yield {
    kind: "judge_report",
    operation,
    verdict: result.verdict,
    score: result.score,
    lostClaims: result.lostClaims,
    structuralLosses: result.structuralLosses,
  };
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `npx vitest run tests/phases/judge.test.ts`
Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/judge.ts tests/phases/judge.test.ts
git commit -m "feat(judge): add runJudge phase with response parser"
```

---

### Task 5: Judge prompt rendering snapshot

**Files:**
- Create: `tests/phases/judge-prompt.test.ts`

- [ ] **Step 1: Write snapshot test**

Create `tests/phases/judge-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { render } from "../../src/phases/template";
import judgeTemplate from "../../prompts/judge.md";

describe("judge prompt rendering", () => {
  it("substitutes operation=format", () => {
    const out = render(judgeTemplate, { operation: "format" });
    expect(out).toContain("OPERATION: format");
    expect(out).not.toContain("{{operation}}");
  });

  it("substitutes operation=ingest", () => {
    const out = render(judgeTemplate, { operation: "ingest" });
    expect(out).toContain("OPERATION: ingest");
    expect(out).not.toContain("{{operation}}");
  });

  it("contains severity definitions", () => {
    const out = render(judgeTemplate, { operation: "format" });
    expect(out).toMatch(/critical/);
    expect(out).toMatch(/major/);
    expect(out).toMatch(/minor/);
  });

  it("contains JSON schema fields", () => {
    const out = render(judgeTemplate, { operation: "format" });
    expect(out).toMatch(/verdict/);
    expect(out).toMatch(/score/);
    expect(out).toMatch(/lostClaims/);
    expect(out).toMatch(/structuralLosses/);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/phases/judge-prompt.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/phases/judge-prompt.test.ts
git commit -m "test(judge): snapshot judge prompt rendering"
```

---

### Task 6: Format phase emits `judge_input`

**Files:**
- Modify: `src/phases/format.ts:146-148`

- [ ] **Step 1: Update format test expectation**

Открыть `tests/phases/format.test.ts`. Найти тест, проверяющий events runFormat. Добавить кейс что `judge_input` event эмитится перед `result`:

В существующий success-сценарий после проверки `format_preview` добавить:

```ts
const judgeInput = events.find((e) => e.kind === "judge_input");
expect(judgeInput).toBeTruthy();
if (judgeInput?.kind === "judge_input") {
  expect(judgeInput.operation).toBe("format");
  expect(judgeInput.original).toBe(SAMPLE);
  expect(judgeInput.output).toBeTruthy();
}
```

- [ ] **Step 2: Run test (should fail)**

Run: `npx vitest run tests/phases/format.test.ts`
Expected: FAIL — `judge_input` not emitted.

- [ ] **Step 3: Add yield in runFormat**

В `src/phases/format.ts:146` (после `const missing = missingTokensWithContext(...)`) перед `yield { kind: "format_preview", ... }` добавить:

```ts
  yield { kind: "judge_input", operation: "format", original, output: parsed.formatted };
```

Финальный порядок строк 146-148:

```ts
  const missing = missingTokensWithContext(original, parsed.formatted);
  yield { kind: "judge_input", operation: "format", original, output: parsed.formatted };
  yield { kind: "format_preview", tempPath, report: parsed.report, missingTokens: missing };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.report };
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/phases/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts tests/phases/format.test.ts
git commit -m "feat(judge): emit judge_input from format phase"
```

---

### Task 7: Ingest phase emits `judge_input`

**Files:**
- Modify: `src/phases/ingest.ts:113-126`

- [ ] **Step 1: Write failing test**

В `tests/phases/ingest.test.ts` добавить (или создать новый):

```ts
it("emits judge_input with concatenated written pages", async () => {
  // ... reuse существующего setup с моком LLM, возвращающим 2 страницы
  const events = await collect(runIngest(...));
  const ji = events.find((e) => e.kind === "judge_input");
  expect(ji).toBeTruthy();
  if (ji?.kind === "judge_input") {
    expect(ji.operation).toBe("ingest");
    expect(ji.original).toBe(SOURCE_CONTENT);
    expect(ji.output).toContain("\n\n---\n\n");  // separator между страницами
  }
});
```

(Конкретный setup взять из существующих ingest-тестов.)

- [ ] **Step 2: Run test (should fail)**

Run: `npx vitest run tests/phases/ingest.test.ts`
Expected: FAIL — нет judge_input.

- [ ] **Step 3: Implement**

В `src/phases/ingest.ts:117-118` (внутри `if (written.length > 0)` блока) перед `await appendLog(...)` добавить чтение записанных страниц + concat:

```ts
  if (written.length > 0) {
    const writtenContents: string[] = [];
    for (const p of written) {
      try { writtenContents.push(await vaultTools.read(p)); } catch { /* skip */ }
    }
    const judgeOutput = writtenContents.join("\n\n---\n\n");
    yield { kind: "judge_input", operation: "ingest", original: sourceContent, output: judgeOutput };

    await appendLog(vaultTools, wikiRoot, sourceVaultPath, domain.id, written);
    await updateIndex(vaultTools, wikiRoot, written);
    // ... остальное без изменений
```

(Если `written.length === 0` — judge_input не эмитится, нечего судить.)

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/phases/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(judge): emit judge_input from ingest phase"
```

---

### Task 8: AgentRunner — `maybeRunJudge` integration

**Files:**
- Modify: `src/agent-runner.ts:109-149` (метод `run`)

- [ ] **Step 1: Write failing test**

В `tests/agent-runner.integration.test.ts` добавить тесты:

```ts
describe("AgentRunner judge integration", () => {
  it("does NOT call judge when judge.enabled=false", async () => {
    // setup: settings.judge.enabled = false
    // mock: format phase emits judge_input
    // expect: no judge_report event in output, no extra LLM calls
  });

  it("calls judge when enabled and emits judge_report", async () => {
    // setup: settings.judge.enabled=true, claudeAgent.enabled=true
    // mock LLM returns format JSON, then judge JSON
    // expect: judge_report event with verdict=pass
  });

  it("skips judge when backend.enabled=false", async () => {
    // settings.judge.enabled=true but claudeAgent.enabled=false
    // expect: no judge_report
  });

  it("does NOT forward judge_input to consumer", async () => {
    // any setup with judge enabled or disabled
    // expect: events list has no judge_input kind (it is internal)
  });

  it("emits warning on judge LLM error, format succeeds", async () => {
    // judge LLM throws, format completes
    // expect: format_preview present, error event with [judge] prefix, no exception
  });
});
```

(Конкретный mock-LlmClient: первый вызов возвращает format JSON, второй — judge JSON или error. Использовать счётчик в `vi.fn().mockImplementation` для разных responses.)

- [ ] **Step 2: Run tests (should fail)**

Run: `npx vitest run tests/agent-runner.integration.test.ts`
Expected: FAIL — judge не вызывается, judge_input forwarded.

- [ ] **Step 3: Add `maybeRunJudge` method**

В `src/agent-runner.ts` после `runOperation` (перед `run`) добавить:

```ts
  private resolveJudgeModel(operation: import("./types").JudgeOpKey): string | null {
    const j = this.settings.judge;
    if (!j?.enabled) return null;
    const cfg = this.settings.backend === "claude-agent" ? j.claudeAgent : j.nativeAgent;
    if (!cfg.enabled) return null;
    return cfg.perOperation ? cfg.operations[operation].model : cfg.model;
  }

  private async *maybeRunJudge(
    operation: import("./types").JudgeOpKey,
    original: string,
    output: string,
    signal: AbortSignal,
  ): AsyncGenerator<RunEvent> {
    const model = this.resolveJudgeModel(operation);
    if (!model) return;
    const { runJudge } = await import("./phases/judge");
    yield* runJudge(operation, original, output, this.llm, model, signal);
  }
```

- [ ] **Step 4: Update `run` method to intercept judge_input**

Заменить блок цикла в `src/agent-runner.ts:123-126`:

```ts
    let judgePending: { operation: import("./types").JudgeOpKey; original: string; output: string } | null = null;
    for await (const ev of this.runOperation(req, model, opts, vaultRoot, domains)) {
      if (ev.kind === "judge_input") {
        judgePending = { operation: ev.operation, original: ev.original, output: ev.output };
        continue;  // не форвардим в consumer
      }
      if (ev.kind === "result") finalResultText = ev.text;
      yield ev;
    }

    if (judgePending && !req.signal.aborted) {
      yield* this.maybeRunJudge(judgePending.operation, judgePending.original, judgePending.output, req.signal);
    }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/agent-runner.integration.test.ts`
Expected: 5/5 PASS (новые сценарии) + предыдущие тоже PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent-runner.ts tests/agent-runner.integration.test.ts
git commit -m "feat(judge): wire judge into AgentRunner after format/ingest"
```

---

### Task 9: View — render `judge_report` block

**Files:**
- Modify: `src/view.ts:305-314` (event handler), новый метод `renderJudgeReport`

- [ ] **Step 1: Add field for judge section**

В `src/view.ts:49` рядом с `formatPreviewSection` добавить:

```ts
  private judgeReportSection: HTMLElement | null = null;
```

- [ ] **Step 2: Handle judge_input + judge_report**

В `src/view.ts:305` (метод `appendEvent`) сразу после первой проверки добавить:

```ts
    if (ev.kind === "judge_input") return;  // internal — not for UI
    if (ev.kind === "judge_report") {
      this.renderJudgeReport(ev.operation, ev.verdict, ev.score, ev.lostClaims, ev.structuralLosses);
      return;
    }
```

И в обработчике `format_applied/format_cancelled` (строка 310) добавить очистку judge:

```ts
    if (ev.kind === "format_applied" || ev.kind === "format_cancelled") {
      this.formatPreviewSection?.remove();
      this.formatPreviewSection = null;
      this.judgeReportSection?.remove();
      this.judgeReportSection = null;
      return;
    }
```

Также в начале `start()` / при старте новой операции — очистить `judgeReportSection` (найти место где очищается `formatPreviewSection` при старте: `grep -n "formatPreviewSection = null" src/view.ts`, добавить рядом).

- [ ] **Step 3: Implement renderJudgeReport**

В конец класса (после `renderFormatPreview`) добавить:

```ts
  private renderJudgeReport(
    operation: import("./types").JudgeOpKey,
    verdict: import("./types").JudgeVerdict,
    score: number,
    lostClaims: import("./types").JudgeLostClaim[],
    structuralLosses: string[],
  ): void {
    this.judgeReportSection?.remove();

    const root = this.containerEl.children[1] as HTMLElement;
    this.judgeReportSection = root.createDiv("llm-wiki-judge-report");

    const header = this.judgeReportSection.createEl("h4", { cls: `llm-wiki-judge-header llm-wiki-judge-${verdict}` });
    header.setText(`Judge (${operation}): ${verdict.toUpperCase()} — ${score}/100`);

    if (lostClaims.length > 0) {
      const order: import("./types").JudgeSeverity[] = ["critical", "major", "minor"];
      for (const sev of order) {
        const items = lostClaims.filter((c) => c.severity === sev);
        if (items.length === 0) continue;
        const grp = this.judgeReportSection.createEl("details", { cls: `llm-wiki-judge-claims llm-wiki-judge-claims-${sev}` });
        const summary = grp.createEl("summary");
        summary.setText(`${sev.toUpperCase()} (${items.length})`);
        if (verdict !== "pass") grp.setAttribute("open", "");
        const list = grp.createEl("ul");
        for (const c of items) {
          const li = list.createEl("li");
          li.createEl("code", { text: c.quote.length > 120 ? c.quote.slice(0, 120) + "…" : c.quote });
          li.createSpan({ text: " — " });
          li.createSpan({ text: c.reason });
        }
      }
    }

    if (structuralLosses.length > 0) {
      const sect = this.judgeReportSection.createEl("details", { cls: "llm-wiki-judge-structural" });
      const summary = sect.createEl("summary");
      summary.setText(`Структурные потери (${structuralLosses.length})`);
      if (verdict !== "pass") sect.setAttribute("open", "");
      const list = sect.createEl("ul");
      for (const s of structuralLosses) list.createEl("li", { text: s });
    }
  }
```

- [ ] **Step 4: Add CSS classes**

В `styles.css` добавить:

```css
.llm-wiki-judge-report { margin-top: 1em; padding: 0.5em; border-left: 3px solid var(--background-modifier-border); }
.llm-wiki-judge-pass { color: var(--text-success); }
.llm-wiki-judge-warn { color: var(--text-warning); }
.llm-wiki-judge-fail { color: var(--text-error); }
.llm-wiki-judge-claims-critical summary { color: var(--text-error); }
.llm-wiki-judge-claims-major summary { color: var(--text-warning); }
.llm-wiki-judge-claims-minor summary { color: var(--text-muted); }
```

(Если `styles.css` нет — найти где Obsidian-плагин держит стили: `ls *.css` в корне.)

- [ ] **Step 5: Build & verify**

Run: `npm run build`
Expected: успех без TS-ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts styles.css
git commit -m "feat(judge): render judge_report block in side panel"
```

---

### Task 10: Settings UI — judge section

**Files:**
- Modify: `src/settings.ts` (после блока devMode, ~ строка 450)

- [ ] **Step 1: Add UI block**

В `src/settings.ts` найти конец блока `devMode` (после `s.devMode.evaluatorModel = v.trim()` и закрытия). Сразу после добавить (используя ту же `s` переменную и pattern `new Setting(containerEl)`):

```ts
    new Setting(containerEl).setName("LLM Judge validator").setHeading();

    new Setting(containerEl)
      .setName("Enable Judge")
      .setDesc("Дополнительный LLM-вызов после format/ingest, проверяет семантическую сохранность.")
      .addToggle((t) =>
        t.setValue(s.judge.enabled).onChange(async (v) => {
          s.judge.enabled = v;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (s.judge.enabled) {
      for (const backend of ["claudeAgent", "nativeAgent"] as const) {
        const label = backend === "claudeAgent" ? "Claude agent" : "Native agent";
        new Setting(containerEl).setName(`Judge — ${label}`).setHeading();

        new Setting(containerEl)
          .setName("Enabled")
          .addToggle((t) =>
            t.setValue(s.judge[backend].enabled).onChange(async (v) => {
              s.judge[backend].enabled = v;
              await this.plugin.saveSettings();
              this.display();
            }),
          );

        if (!s.judge[backend].enabled) continue;

        new Setting(containerEl)
          .setName("Default model")
          .addText((t) =>
            t.setValue(s.judge[backend].model).onChange(async (v) => {
              s.judge[backend].model = v.trim();
              await this.plugin.saveSettings();
            }),
          );

        new Setting(containerEl)
          .setName("Per-operation models")
          .addToggle((t) =>
            t.setValue(s.judge[backend].perOperation).onChange(async (v) => {
              s.judge[backend].perOperation = v;
              await this.plugin.saveSettings();
              this.display();
            }),
          );

        if (s.judge[backend].perOperation) {
          for (const op of ["format", "ingest"] as const) {
            new Setting(containerEl)
              .setName(`Model — ${op}`)
              .addText((t) =>
                t.setValue(s.judge[backend].operations[op].model).onChange(async (v) => {
                  s.judge[backend].operations[op].model = v.trim();
                  await this.plugin.saveSettings();
                }),
              );
          }
        }
      }
    }
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Manual smoke**

Установить плагин (`ln -s $(pwd)/dist ~/.config/obsidian/Plugins/obsidian-llm-wiki` уже сделано). В Obsidian → Settings → LLM Wiki → проверить что:
- Видна секция "LLM Judge validator"
- Toggle "Enable Judge" работает
- При включении появляются под-секции claude/native
- Toggle "Per-operation models" показывает/скрывает model-input на op

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(judge): add settings UI for judge config"
```

---

### Task 11: End-to-end smoke + finalize

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: все passes (включая новые judge-тесты).

- [ ] **Step 2: Build production**

Run: `npm run build`
Expected: `main.js` генерируется без warnings.

- [ ] **Step 3: Manual E2E (Obsidian)**

В Obsidian:
1. Включить Judge в settings (master + claude-agent enabled).
2. Запустить `format` на тестовом .md → проверить: `format_preview` блок появился, затем `judge_report` блок (отдельно, под preview).
3. Запустить `ingest` на тестовом source-файле → проверить: result + `judge_report`.
4. Выключить Judge master toggle → запустить format → проверить: `judge_report` НЕ появляется, format работает как раньше.
5. Force judge LLM error (например невалидный model "xxx-no-such") → проверить: format-preview виден, под ним warning "[judge] ..." в ленте событий, apply работает.

- [ ] **Step 4: Bump version + final commit**

Согласно CLAUDE.md: bump patch в `package.json` и `src/manifest.json`, затем `npm run build`.

```bash
# манипуляция версией → npm run build → main.js обновился
git add package.json src/manifest.json main.js
git commit -m "chore: bump patch for judge feature"
```

---

## Execution Notes

- DRY: `parseJudgeResponse` отдельно от `runJudge` для unit-тестируемости (как `parseEvalResponse` в evaluator.ts:12).
- YAGNI: judge не сохраняется в `history`, не блокирует apply, не возвращает suggested fix — всё out of scope per spec.
- TDD: каждый task начинается с failing test, кроме чисто structural (types, prompts, settings UI).
- Commit cadence: 1 commit на task. Не амендить прошлые.

## Out of scope reminders (per spec)

- JudgeReport в `history`
- Judge для query/chat/lint/fix/init
- Auto-retry формата по verdict
- Блокировка Apply на verdict=fail
- Suggested fix
