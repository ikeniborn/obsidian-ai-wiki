# Dynamic LLM Budget Routing Goal

## Objective

Evaluate whether os-unix reinit instability is better solved by dynamic per-call LLM budgets and runtime parameters, by transport compatibility mode, or by a combined pipeline, without committing another code fix before evidence.

## Success Criteria

- Measure at least four variants across transport mode and init/evidence output budget.
- Record comparable metrics: time to first HTTP response, time to first file, transport retries, structural retries, final status, created pages, and failure reason.
- Select one recommended pipeline for os-unix replay with explicit rationale.
- Keep validation strict; do not weaken domain/schema validation as part of the research.

## Constraints

- Test vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`.
- Domain: `os-unix`.
- Source scope: `ОС/Unix/`.
- Do not change production behavior during research unless evidence justifies a follow-up implementation.

## Mutable Scope

- Test vault plugin `data.json` runtime settings.
- Test vault logs and generated wiki output.
- LoEn artifacts under this topic.
- Optional helper scripts used only for experiment orchestration or log analysis.

## Protected Scope

- Production source code behavior, except later explicit implementation after research conclusion.
- Strict validation rules.
- User source notes.

## Verifier

Analyze `agent.jsonl` for each variant and compare metrics against decision thresholds in `3_plan.md`.

## Authorized Repair Pass

Transport research identified commit `d72cf5b` as the actionable regression boundary. The user authorized a production repair and a new test-vault reinit on 2026-07-23.

Repair success requires:

- desktop non-stream calls use the buffered Obsidian host transport when no proxy or diagnostic override is active;
- true streaming calls retain direct undici streaming;
- proxy, mobile, retry, prompt budget, schema, and domain validation behavior remain unchanged;
- transport telemetry reports the actual per-request route;
- focused tests, lint, and build pass;
- two consecutive clean reinit restarts complete bootstrap-map and bootstrap attempt 0 without transport retry before the transport repair is considered final.

## Rollback Policy

Restore test vault settings from the saved baseline after each variant or before handoff.
