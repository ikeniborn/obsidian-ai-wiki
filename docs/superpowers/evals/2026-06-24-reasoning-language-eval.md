# Eval — Reasoning / Answer Language Directives

**Date:** 2026-06-24
**Spec:** `docs/superpowers/specs/2026-06-24-reasoning-logging-and-language-rule-design.md`
**Plan:** `docs/superpowers/plans/2026-06-24-reasoning-logging-and-language-rule.md`

## Purpose & scope

Validate spec Part B (strengthened directives) **outside any Obsidian vault** and **without an
LLM**, by exercising the real pure functions from `src/`. Covers the contract the vision path
(Part C) reuses.

In scope (deterministic):
- `reasoningDirective(lang)` — correct language name, anti-drift clause, JSON-`reasoning`-field clause.
- `langInstruction(lang)` — correct language name + no-switch clause.
- `resolveReasoningLang` — explicit / `auto` / `undefined` fallback chain.

Out of scope (needs the Obsidian runtime / a live LLM, checked manually):
- Reasoning logging consolidation in `Controller.logEvent` (spec Part A).
- The model actually obeying the directive (progress-bar reasoning language).

## How to run

```bash
node_modules/.bin/esbuild eval/reasoning-language/run.ts \
  --bundle --platform=node --format=cjs \
  --loader:.md=text \
  --alias:obsidian=./eval/reasoning-language/obsidian-stub.ts \
  --outfile=eval/reasoning-language/run.cjs
node eval/reasoning-language/run.cjs
```

`--loader:.md=text` is required because `llm-utils.ts` imports `prompts/base.md`. `obsidian-stub.ts`
provides the only `obsidian` symbol `i18n.ts` uses — `moment.locale()` — driven by
`globalThis.__MOMENT_LOCALE__`.

## Cases

| Case | Asserts |
|------|---------|
| R1–R3 | `reasoningDirective` names the correct language (en/ru/es) |
| R4 | section heading `## Reasoning language` present |
| R5 | anti-drift clause ("do not switch") present |
| R6 | JSON `reasoning` field clause present |
| L1–L3 | `langInstruction` names the language + carries the no-switch clause |
| RL1–RL4 | `resolveReasoningLang` fallback chain (explicit / auto→output / auto→locale / undefined→en) |

## Results (current)

`TOTAL: 13 passed, 0 failed`
