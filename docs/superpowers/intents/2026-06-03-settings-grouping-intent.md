# Intent: Settings grouping — reorder global params, visual separator, dedup Semantic Search

**Date:** 2026-06-03
**Status:** draft

## Objective

`structuredRetries` renders after the per-operation block, so it visually reads as belonging to the last operation (Format) rather than as a global native backend setting. Fix grouping so global params are visually separated from per-operation config.

## Desired Outcomes

- Native backend settings order: Temperature → Structured output retries → [heading] → Per-operation models toggle → (per-op block)
- Visual heading separates global params from per-operation section
- Duplicate "Semantic Search" heading removed (currently two identical `.setHeading()` calls)
- Claude backend checked; same fix applied if same ordering issue exists

## Health Metrics

- Settings save/load correctly after reorder
- Per-operation toggle still shows/hides the per-op config block
- No regressions in other settings sections

## Strategic Context

- Interacts with: `src/settings.ts` (native and Claude backend sections), `src/i18n.ts` (no changes needed — heading hardcoded)
- Priority trade-off: correctness of UI grouping; no speed/cost concerns

## Constraints

### Steering (behavioral guidance)
- Match existing style: new heading hardcoded as string (like "Semantic Search"), no new i18n key

### Hard (architectural enforcement)
- Touch only: native backend settings order, Claude backend settings order (if same issue), duplicate heading removal
- Do not modify: URL/API key settings, i18n keys, types, controller logic

## Autonomy Zones

- Full autonomy: reordering lines within `src/settings.ts`, removing duplicate heading
- Full autonomy: adding `.setHeading()` call before per-operation toggle
- No autonomy: changing settings schema, adding new settings, modifying save/load logic

## Stop Rules

- Halt if: reorder changes any setting's save/load behavior
- Done when: settings render in correct order, no duplicate heading, `lat check` passes
