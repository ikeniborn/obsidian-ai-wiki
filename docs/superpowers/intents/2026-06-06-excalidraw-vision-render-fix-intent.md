# Intent: excalidraw-vision-render-fix

**Date:** 2026-06-06
**Status:** draft

## Objective
Fix Excalidraw rendering in the Vision pre-step of formatting. Currently it fails
with `Failed to resolve module specifier '@excalidraw/utils'`, so Excalidraw
attachments are not processed and no textual information can be extracted from them
via the vision LLM. Notes containing `![[draw.excalidraw]]` cannot be formatted with
their drawing content described.

## Desired Outcomes
- Formatting a note with `![[draw.excalidraw]]` produces a Vision `tool_result ok`
  with a textual description of the drawing (instead of "Vision skipped" / the
  module-resolution error).
- The Excalidraw description is inserted into the formatted output.

## Health Metrics
- Image and PDF Vision branches keep working unchanged.
- `dist/main.js` bundle stays ~2M (no inflation from bundling the 19M lib).
- Existing tests stay green (`extractExcalidrawJson`, attachment routing,
  `Vision embed preserved`).
- Formatting without vision / without Excalidraw is unchanged.

## Strategic Context
- Interacts with: `obsidian-excalidraw-plugin` (host plugin, `ExcalidrawAutomate.createPNG`),
  VaultTools, format phase, attachment-analyzer.
- Priority trade-off: **trust** — correct rendering and a clean bundle over speed/size.

## Constraints
### Steering (behavioral guidance)
- Minimal, surgical edits (project CLAUDE.md).
- Lazy + desktop-guarded access to the host plugin / `window` (same pattern as
  node-builtins, per `lint-before-release` memory).
- No host plugin present → clear error → "Vision skipped", never a crash.

### Hard (architectural enforcement)
- Do NOT bundle `@excalidraw/utils` (19M, inflates the bundle) — remove from esbuild
  `external` and from package.json deps.
- Phase functions stay decoupled from Obsidian internals via VaultTools — do not pull
  `app` directly into the analyzer.
- The source Excalidraw file is never modified (output only).

## Autonomy Zones
- Full autonomy (reversible, low risk): edit render code, VaultTools, esbuild config,
  package.json, tests, lat.md.
- Guarded (log + confidence threshold): run `npm run lint`, tests, `lat check` — must
  pass before completion.
- Proposal-first (needs approval): commit / publish-version.
- No autonomy (human only): manual render check in a live Obsidian with a real
  Excalidraw file (no headless canvas test available).

## Stop Rules
- Halt if: lint / tests / `lat check` fail.
- Escalate if: the host plugin API differs from expectations (`createPNG` / `ea` absent).
- Done when: tests + lint + `lat check` are green, bundle stays ~2M, behavior matches
  Desired Outcomes.
