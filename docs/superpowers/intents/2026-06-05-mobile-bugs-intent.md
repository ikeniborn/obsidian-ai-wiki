# Intent: Mobile Bug Fixes — Buffer, Scroll, agent.jsonl

**Date:** 2026-06-05
**Status:** draft

## Objective

Fix three bugs that break the plugin on Obsidian mobile (iOS/Android). Production-critical: mobile users cannot run query at all. Root cause of query failure is `Buffer` global (Node.js-only) used in `src/page-similarity.ts`.

## Desired Outcomes

- Query operation completes successfully on mobile when embedding mode is enabled
- Settings panel scroll position stays at the toggled element after onChange re-render
- agent.jsonl receives events during query operation (start, run events, finish/error)

## Health Metrics

- Desktop embedding mode continues working (encodeVector/decodeVector produce identical base64 output)
- Jaccard mode unchanged (no code path changes)
- All existing tests pass
- Desktop: ingest, lint, format, query all unaffected

## Strategic Context

- Interacts with: `src/page-similarity.ts` (Buffer fix), `src/settings.ts` (scroll fix), `src/controller.ts` + `LocalConfig` (agent.jsonl)
- Priority trade-off: correctness > speed > cost
- `btoa`/`atob` already used in `src/phases/attachment-analyzer.ts:34-39` — confirmed available on mobile

## Constraints

### Steering (behavioral guidance)
- Use the same chunked `String.fromCharCode` pattern as `arrayBufferToBase64` in attachment-analyzer.ts
- Scroll restore must use `requestAnimationFrame` to run after DOM update
- agent.jsonl: investigate whether bug is independent (agentLogEnabled defaulting false) or consequence of Buffer fix; include both fix + verification path

### Hard (architectural enforcement)
- Do NOT change `claude-cli-client.ts` Buffer usage — that file is desktop/electron-only (external to bundle)
- Do NOT change Jaccard code paths in page-similarity.ts
- esbuild platform=node means Buffer exists on desktop; fix must be backward-compatible (btoa/atob available in Node 16+)

## Autonomy Zones

- Full autonomy (reversible, low risk): replace Buffer in page-similarity.ts, add scroll save/restore in settings.ts
- Guarded (verify output equivalence): encodeVector/decodeVector — confirm base64 output is identical to Buffer-based implementation
- Proposal-first (needs approval): any change to agentLogEnabled default or LocalConfig schema
- No autonomy (human only): releasing to production

## Stop Rules

- Halt if: encodeVector/decodeVector output differs from Buffer-based baseline (check with a test vector)
- Escalate if: agent.jsonl still not writing after Buffer fix (independent bug in folder creation or settings persistence on mobile)
- Done when: all three fixes applied, lat.md updated, lat check passes, tests pass
