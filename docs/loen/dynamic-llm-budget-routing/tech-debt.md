# Dynamic LLM Budget Routing Technical Debt

Status: open
Updated: 2026-07-27
Live baseline: Obsidian reinit session `1785096684125`
Project wiki: `architecture/dynamic-llm-budget-routing-technical-debt`

## Scope

This register tracks only domain-neutral gaps confirmed by tests or live evidence. Fixes must not add OS-specific entity types, paths, commands, aliases, headings, prompt exceptions, larger token ceilings, or extra model retries.

## TD-1: Exact Technical Evidence Classification and Reconciliation

Live source audit reported 12 exact-string mismatches out of 537 candidate snippets.

The raw count contains three different classes:

- Seven technical literals are absent from the final domain: one desktop-file path, two NFS `fstab` entries, two NetworkManager commands, and two disk-label `fstab` commands.
- Three commands are represented with equivalent content but different chaining, qualification, or source attribution: `df -h`, `mount -a`, and `systemctl daemon-reload`.
- Two English explanatory sentences were incorrectly classified as exact technical content even though natural-language prose is translatable.

Required fix:

- classify complete fenced/config/command/path evidence separately from translatable prose;
- preserve stable evidence ownership through entity consolidation and shared-page updates;
- compare normalized command structure where shell chaining does not change the technical operation;
- deterministically restore genuinely absent evidence without another model call;
- retain source attribution when a shared canonical page represents evidence from multiple sources.

Acceptance:

- zero unrepresented accepted ledger items across the fixed 22-source corpus;
- zero prose false positives in the exact-evidence audit;
- 100% source URL preservation;
- no additional LLM request, retry, or token-ceiling increase.

Evidence: `evidence/conflict-validation-split-live-domain-quality-1785096684125.json`.

## TD-2: Query Context Coverage and Grounding Sanitation

The fixed ten-query replay completed 10/10 with zero retries and zero invalid WikiLinks, but macro required-fact coverage was 91.809%, below the accepted 92.904% gate.

All five omitted fact groups exist in generated pages. Failures are therefore downstream of synthesis:

- the final context can select the correct article but omit the section containing an exact path or command;
- answer compression can describe an operation without returning its supported command;
- deterministic grounding sanitation can remove a supported term and leave malformed Markdown such as `****`.

Required fix:

- preserve coverage of distinct question facets when selecting sections within the existing context limit;
- validate sanitizer support against the exact selected article, heading, and body before deletion;
- remove empty emphasis, list items, and code labels created by sanitation;
- keep fail-closed grounding and the existing one-call healthy path.

Acceptance:

- 10/10 fixed cases complete with zero model repair and zero invalid WikiLinks;
- macro required-fact coverage at or above 92.904%;
- no malformed Markdown after sanitation;
- unchanged Query input/output ceilings and final context size.

Evidence: `evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json` and `evidence/os-unix-query-grounding-conflict-validation-split-live-1785096684125.json`.

## TD-3: Deterministic Conflict-Regeneration Integration Trigger

Unit coverage proves guarded conflict regeneration repairs one malformed frame, rejects parsed schema/domain defects without repair, and stops after the explicit request bound. Live session `1785096684125` did not naturally produce a stale write, so the branch was not exercised by the provider replay.

Required fix:

- add a live-equivalent deterministic integration fixture that creates a stale target authority;
- inject a malformed first regeneration response and a valid second response without depending on provider randomness;
- retain real transport, parser, semantic-validation, and apply boundaries in the harness.

Acceptance:

- malformed frame: exactly two underlying requests at most;
- parsed semantic defect: exactly one request;
- repeated stale conflict: zero additional requests;
- successful repaired patch reaches apply with current page and section authorities.

Evidence: focused `tests/ingest-synthesis.test.ts` coverage and `evidence/conflict-validation-split-live-1785096684125.json`.

## TD-4: Init Terminal Status After Successful File Retry

Earlier live runs could retain a handled file error and finish with `status=error` after the user selected Retry and all 22 sources eventually completed. Session `1785096684125` finished correctly but contained no file-level retry, so it does not close this gap.

Required fix:

- distinguish active/unrecovered file failures from recovered attempts;
- clear or supersede the recorded failure after a successful Retry;
- preserve real failure status for Skip, Stop, cancellation, and exhausted retries.

Acceptance:

- an induced file failure followed by successful Retry finishes `status=done`;
- the recovered attempt remains visible in telemetry;
- unresolved, skipped, stopped, or cancelled work cannot be reported as done.

Evidence: prior session `1785087161419` and successful no-retry control session `1785096684125`.

## Non-Actions

- Do not increase the 65,536 ingest input ceiling. Maximum provider-reported live input was 18,221 tokens.
- Do not increase synthesis batch size above the tested weak-model default of `1`.
- Do not weaken schema, canonical path, alias, page-hash, section-authority, WikiLink, or exact-grounding validation.
- Do not encode the os-unix benchmark vocabulary into production logic.
