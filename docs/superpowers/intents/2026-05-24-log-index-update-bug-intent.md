# Intent: Fix _log/_index not updated after init/ingest/lint (#35)

**Date:** 2026-05-24
**Status:** draft

## Objective
Regression: after migrating domain folder into `.config` subdirectory inside the vault,
`_log.md` and `_index.md` are no longer updated when running `init`, `ingest`, or `lint`.
Root cause unknown — needs investigation.

## Desired Outcomes
- After `ingest`: `_log.md` is updated with new entries
- After `ingest`: `_index.md` contains new records
- After `init`: `_log.md` and `_index.md` are created/updated with correct content
- After `lint`: `_log.md` and `_index.md` are updated with correct content

## Health Metrics
- Quality of log content written by `init` must not degrade
- Quality of index content written by `lint` must not degrade
- Other operations (query, chat) unaffected

## Constraints
- Paths to `_log`/`_index` are static but include the domain segment inside the vault
- Domain folder was moved into `.config` subdirectory — this likely changed path resolution
- Relationship with `GraphCache` or `autodetectCwd()` is unknown — must be investigated before fixing
- No architectural changes without user approval

## Autonomy Level
- Investigate and diagnose root cause independently
- Fix path resolution bugs (non-architectural)
- Write/update tests

## Stop Rules
- Any architectural decision requires user approval before proceeding
- Changes to `_log`/`_index` file format require user approval
- If fix requires changes to `autodetectCwd()` logic — escalate
