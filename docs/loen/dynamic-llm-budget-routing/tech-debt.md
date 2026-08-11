# Dynamic LLM Budget Routing Technical Debt

Status: open
Updated: 2026-08-11
Live baseline: Obsidian reinit session `1785096684125`
Project wiki: `architecture/dynamic-llm-budget-routing-technical-debt`

## Scope

This register tracks only domain-neutral gaps confirmed by tests or live evidence. Fixes must not add OS-specific entity types, paths, commands, aliases, headings, prompt exceptions, larger token ceilings, or extra model retries.

## Generic Evidence Pipeline Contract

- Adjacent Markdown ranges are greedily packed only while the complete prepared mapper request, repair reserve, and safety margin fit the configured input budget. Structural source coverage, source order, exact ranges, and fenced blocks remain authoritative for small and large inputs.
- Init maps the bootstrap source once. It enriches that evidence with entity types, then hands the authoritative domain/path/body-hash bundle to first-source Ingest; Retry reuses the matching bundle instead of remapping the source.
- Mapper wire normalization treats omitted `packets` or omitted `noEvidence` as an empty complementary array only when the present array completely and validly covers the chunk. Ambiguous, mixed, foreign, or malformed coverage still fails closed.
- Mapper semantic recovery splits only eligible output-limit or local schema/range failures, permits one split level, and requires strict prepared-request progress. Provider context repacking preserves split lineage and cannot enable a second semantic split.

Deterministic evidence: neutral generated corpora and contract assertions in `tests/ingest-evidence.test.ts`, `tests/markdown-chunks.test.ts`, and `tests/init-ingest-outcome.test.ts`. No private source article is used as a fixture.

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

Status: fixed.

The deterministic loopback fixture in `tests/conflict-regeneration-integration.test.ts` retains the OpenAI HTTP transport, response framing/parser, semantic validation, stale-authority inspection, and final vault apply boundaries. It changes the target after the initial synthesis response, returns one malformed regeneration frame, then a valid guarded patch against the current page and section hashes.

Exact assertions:

- malformed regeneration is bounded to two regeneration requests; the complete fixture performs one mapper, one synthesis, and two regeneration requests (`requests.length === 4`);
- the accepted patch contains the current-authority content, rejects the stale patch content, and preserves the unrelated concurrently changed section;
- `tests/ingest-synthesis.test.ts` asserts every parsed schema or domain defect forwards exactly one request and cannot trigger format repair;
- the same focused suite asserts a repeated stale conflict (`conflictCount === 1`) forwards zero requests.

## TD-4: Init Terminal Status After Successful File Retry

Status: fixed.

Init now emits attempt-local `file_attempt` telemetry and one terminal `file_outcome`; `src/run-status.ts` reduces only terminal outcomes and global failures into the operation status.

Exact assertions:

- `tests/init-ingest-outcome.test.ts` verifies both full and incremental Init retain `failed -> retry_scheduled -> recovered` telemetry, emit one `file_outcome: done`, and do not leak the handled child failure as a global error;
- `tests/run-status.test.ts` verifies that sequence reduces to `done`;
- `file_outcome: skipped` and `file_outcome: exhausted` reduce to `error`, while `file_outcome: stopped` and user abort reduce to `cancelled`;
- timeout, non-zero exit, and unrelated global error remain `error`; a later success, zero exit, or abort cannot overwrite that status.

## Non-Actions

- Do not increase the 65,536 ingest input ceiling. Maximum provider-reported live input was 18,221 tokens.
- Do not increase synthesis batch size above the tested weak-model default of `1`.
- Do not weaken schema, canonical path, alias, page-hash, section-authority, WikiLink, or exact-grounding validation.
- Do not encode the os-unix benchmark vocabulary into production logic.
