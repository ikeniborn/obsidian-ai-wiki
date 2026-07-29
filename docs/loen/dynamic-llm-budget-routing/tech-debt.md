# Dynamic LLM Budget Routing Technical Debt

Status: open
Updated: 2026-07-27
Live baseline: Obsidian reinit session `1785096684125`
Project wiki: `architecture/dynamic-llm-budget-routing-technical-debt`

## Scope

This register tracks only domain-neutral gaps confirmed by tests or live evidence. Fixes must not add OS-specific entity types, paths, commands, aliases, headings, prompt exceptions, larger token ceilings, or extra model retries.

## TD-1: Exact Technical Evidence Classification and Reconciliation

Status: fixed, pending live verification.

Live source audit reported 12 missing snippets out of 537 candidates (323 ledger items, 3 unrepresented), decomposed into four groups:

- 6 snippets / 3 ledger items (`NFS Server.md` `code:203-203`, `code:217-217`, `storage.md` `code:33-37`) absent from the final domain due to evidence erosion on a cross-source page rewrite: `reconcileSynthesisEvidence` only reconciled against the live ledger, not against an existing page's own already-published evidence section, so a later source's rewrite of a shared page silently dropped an earlier source's evidence block. Fixed by carrying over any evidence block from `existing` that the ledger no longer covers, deduplicated against what the new content already contains (`src/phases/synthesis-evidence-ledger.ts`).
- 1 snippet (`systemctl daemon-reload && \`) represented with equivalent content but without its trailing shell line continuation — fixed by tolerating a trailing continuation (`&&`/`\`) symmetrically in `findMissingSynthesisEvidence` (`src/phases/synthesis-evidence-ledger.ts`) and in the audit's own snippet-vs-corpus comparison in `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs` (via the shared `stripTrailingContinuation` helper exported by `scripts/loen-dynamic-budget-routing/audit-snippets.mjs`).
- 2 English explanatory sentences incorrectly classified as exact technical content by the audit's case-insensitive `commandStart` command-head match — fixed by making that match case-sensitive, so a capitalized prose sentence no longer registers as a shell command.
- 3 snippets (`~/.local/share/applications/obsidian.desktop`, `sudo apt install network-manager`, `sudo nmcli dev show`) never accepted into any ledger in the first place — a ledger-*selection* gap, not a reconciliation defect, explicitly out of scope for this fix and recorded under Discovered Debt.

Acceptance (met against the fixed 22-source corpus prior to live verification):

- zero unrepresented accepted ledger items;
- zero prose false positives in the exact-evidence audit;
- 100% source URL preservation;
- no additional LLM request, retry, or token-ceiling increase.

Evidence: `evidence/conflict-validation-split-live-domain-quality-1785096684125.json` (baseline); live re-run pending per the Live Verification Protocol.

## TD-2: Query Context Coverage and Grounding Sanitation

Status: fixed, pending live verification.

The fixed ten-query replay completed 10/10 with zero retries and zero invalid WikiLinks, but macro required-fact coverage was 91.809%, below the accepted 92.904% gate. All five omitted fact groups existed in generated pages — the gaps were downstream of synthesis:

- the final context could select the correct article but omit the section containing an exact path or command — fixed by reserving a sibling context slot for each question facet (tokenized from the query) not already covered by the selected chunks, in `selectQueryContextChunks` (`src/phases/query-budget.ts`);
- a supported path unit could be wrongly flagged as unsupported solely because it captured a trailing sentence period — fixed by stripping the trailing period in the `path` pattern's value cleaner in `extractTechnicalUnits` (`src/phases/query-grounding-validator.ts`);
- after a correct removal, deterministic grounding sanitation could leave malformed Markdown residue behind, such as an empty emphasis span `****` — fixed by extending `cleanSanitizedProseLine` (`src/phases/query-grounding-validator.ts`) to repair empty emphasis spans, empty parenthesis pairs, empty code labels, and now-empty/numeral-only residue lines;
- a technical unit could legitimately be supported only by a selected article's own title (not its body) — fixed by adding title-derived-id support (`findUnsupportedTechnicalUnits`'s new `articleIds` parameter), gated to multi-segment, non-numeric units matched by suffix against the selected articles' id forms.

Acceptance (met against the fixed 10-query replay prior to live verification):

- 10/10 fixed cases complete with zero model repair and zero invalid WikiLinks;
- macro required-fact coverage at or above 92.904%;
- no malformed Markdown after sanitation;
- unchanged Query input/output ceilings and final context size.

Evidence: `evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json` and `evidence/os-unix-query-grounding-conflict-validation-split-live-1785096684125.json` (baseline); live re-run pending per the Live Verification Protocol. A second, diagnostic-only corpus for the os-mac domain (`scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json`, 16 cases) now exists alongside the os-unix corpus; os-unix remains the sole domain used for cross-source attribution acceptance.

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
