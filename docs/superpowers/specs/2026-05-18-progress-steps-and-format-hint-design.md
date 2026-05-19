---
title: Progress step labels + backend-specific format hint
date: 2026-05-18
status: approved
review:
  spec_hash: 20842b94da0549ea
  last_run: "2026-05-18"
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  section_hashes:
    fix1:     062a8302cc9a9ab5
    fix2:     8caa54a42469798c
    affected: a52acda65f5a0871
  findings: []
---

# Design: Progress step labels + backend-specific format hint

Two independent UX fixes:

1. **Backend-specific truncation hint** — format phase error message shows hint only for active backend.
2. **Step labels in progress panel** — reasoning and assistant blocks get named step headers matching the tool_use style.

---

## Fix 1 — Backend-specific format truncation message

### Problem

`src/phases/format.ts` lines 122 and 141 hardcode both backend hints in the error message:
```
"...сократите страницу или увеличьте лимит (claude-agent: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh; native-agent: Settings → per-operation → format → maxTokens)"
```
User sees both regardless of which backend is active.

### Solution

**File:** `src/phases/format.ts`

Add `backend` parameter to `runFormat` signature (after `opts`):

```typescript
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
): AsyncGenerator<RunEvent>
```

Add helper inside the function (or at module level):

```typescript
function truncationHint(backend: "claude-agent" | "native-agent"): string {
  return backend === "claude-agent"
    ? "увеличьте лимит: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh"
    : "увеличьте лимит: Settings → per-operation → format → maxTokens";
}
```

Replace both error strings:

```typescript
// Line ~122 (first truncation):
yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };

// Line ~141 (after retry):
? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
```

**File:** `src/agent-runner.ts`

Pass `this.settings.backend` as last argument to `runFormat`:

```typescript
yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend);
```

---

## Fix 2 — Step labels for reasoning and assistant blocks

### Problem

In `src/view.ts`, the reasoning block (`isReasoning: true`) and assistant block render as bare icon + streaming text with no label. The user sees:

```
🧠 [streaming reasoning text]
💬 [streaming answer text]
```

No context about what each block represents. Inconsistent with `tool_use` steps which have a named `ai-wiki-step-head`.

Additionally, "Формирует ответ" block must not appear while reasoning is in progress — this is already guaranteed by the stream ordering (all `isReasoning: true` deltas arrive before non-reasoning ones), so no logic change needed.

### Solution

**File:** `src/view.ts`

Restructure reasoning block to match tool_use style (head + content):

```typescript
// Before:
this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
this.reasoningBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });

// After:
this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
rHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.analysing);
this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
```

Restructure assistant block:

```typescript
// Before:
this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
this.assistantBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });

// After:
this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
const aHead = this.assistantBlock.createDiv("ai-wiki-step-head");
aHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
aHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.formingResponse);
this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
```

**File:** `src/i18n.ts`

Add two keys to each locale's `view` section:

| Key | EN | RU | ES |
|---|---|---|---|
| `analysing` | `"Analysing…"` | `"Анализирует…"` | `"Analizando…"` |
| `formingResponse` | `"Forming response…"` | `"Формирует ответ…"` | `"Formando respuesta…"` |

### Result

Progress panel sequential flow with thinking model:

```
🧠 Анализирует…
   [streaming reasoning text — shown while reasoning]

💬 Формирует ответ…    ← appears only after reasoning complete
   [streaming answer text]
```

Without thinking (no reasoning events): only `💬 Формирует ответ…` block appears, unchanged behavior.

---

## Affected files

| File | Changes |
|---|---|
| `src/phases/format.ts` | `backend` param + `truncationHint()` helper + 2 error strings |
| `src/agent-runner.ts` | Pass `this.settings.backend` to `runFormat` |
| `src/view.ts` | `ai-wiki-step-head` structure in reasoning + assistant blocks |
| `src/i18n.ts` | `analysing` + `formingResponse` keys in EN, RU, ES locales |

No changes to `types.ts`, `controller.ts`, CSS, or any phase other than `format.ts`.
