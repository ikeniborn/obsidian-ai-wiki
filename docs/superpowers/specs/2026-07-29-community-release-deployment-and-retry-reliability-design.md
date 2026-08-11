---
review:
  spec_hash: c7d9cb69ee1899ee
  last_run: 2026-07-29
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-29-community-release-deployment-and-retry-reliability-intent.md
---
# Community Release Deployment and Retry Reliability - Design

Date: 2026-07-29
Status: approved

## 1. Problem Evidence

The existing Community Plugins entry is published and searchable as `AI Wiki`, so this work does not automate Obsidian account or review actions. The remaining release risk is repository-side: a GitHub release must contain the exact flat assets and version metadata consumed by the Community Plugins updater. The current repository has no release validator, CI builds before lint/typecheck/tests, and `package-lock.json` still reports `0.1.181` while package and manifest files report `0.2.2`.

TD-3 and TD-4 remain open in `docs/loen/dynamic-llm-budget-routing/tech-debt.md`. TD-3 lacks a deterministic integration trigger through the real conflict-regeneration boundaries. TD-4 arises because Init forwards an attempt-local child `error` before the user selects Retry; `controller.ts` treats every `error` as permanently terminal even when the retry succeeds.

Live Init session `1785356426320` exposed five additional, general evidence-pipeline defects:

1. A 17,709-byte, 393-line, heading-heavy source became 34 initial chunks, averaging 520 bytes and reaching a 35-36 chunk execution shape after recovery splits.
2. The conservative one-UTF-8-byte-per-token bound combined with section-first splitting, but adjacent sections were never repacked against the complete prepared request budget.
3. The first source was fully mapped by `init.bootstrap-map`, then fully mapped again by `ingest.evidence-map`.
4. Exhausted structured repairs could recursively split input even when the validation defect was a protocol-shape omission that smaller source content could not correct.
5. A semantically valid no-evidence response omitted the complementary `packets: []`; the request-local wire adapter did not normalize it, so the run failed after two attempts.

The final session used 89 LLM requests, 106,654 input tokens, 102,690 output tokens, and 877,179 ms of summed model duration before failing. Local prepared-message estimates were about 4.4 times provider-reported input usage. The estimator remains an intentional provider-independent safety bound; the design removes the multiplicative behavior around it.

## 2. Scope and Boundaries

In scope:

- deterministic GitHub release validation and publication gates;
- TD-3 conflict-regeneration integration coverage;
- TD-4 Init attempt and terminal-status ownership;
- evidence request packing for small through oversized Markdown;
- one full evidence extraction for the first Init source;
- bounded evidence type enrichment after domain taxonomy creation;
- request-local no-evidence wire normalization;
- bounded, reason-aware mapper splitting;
- repository docs, the technical-debt register, and project iwiki updates.

Out of scope:

- Community account login, submission, review, approval, or search-index automation;
- model-specific tokenizers or calibrated under-counting;
- larger input/output budgets, more retries, or weaker schema/domain/authority checks;
- article-, language-, domain-, command-, heading-, or vocabulary-specific production rules;
- changes to Query quality, synthesis batch size, or unrelated lifecycle presentation.

## 3. Architecture

The release path gains a deterministic validator before and after production build. The runtime path retains the existing conservative prompt governor and structured-output runner, but changes ownership at four boundaries:

1. `chunkSourceForEvidence` receives structurally valid Markdown ranges and greedily packs adjacent contiguous ranges while the complete base and repair prepared-message estimates remain within the configured input budget and mapper safety reserve.
2. Bootstrap evidence preparation retains the full verified `EntityEvidence[]` beside its bounded taxonomy summary. After bootstrap creates the final allowed entity types, a compact bounded classifier assigns exactly one allowed type to every retained entity without re-reading or re-extracting source text.
3. The first `runIngest` consumes the typed handoff only when source path, domain id, and source body hash match. The evidence payload is revalidated before synthesis. Mismatch falls back to ordinary typed evidence extraction.
4. Init converts child ingest errors into attempt-local events. A pure terminal-status reducer consumes explicit file outcomes and global failures, so recovered attempts never need to clear unrelated terminal errors.

The direct Ingest operation retains its existing behavior: its unrecovered `error` remains globally terminal. The evidence handoff is internal to Init and is not persisted across sessions.

## 4. Release Contract

### R1. Version and asset validator

`scripts/validate-release.mjs` owns two phases:

- prebuild validates SemVer, plugin id `ai-wiki`, and exact version agreement among `package.json`, the root `package-lock.json` package entries, root `manifest.json`, and `src/manifest.json`;
- postbuild additionally validates non-empty `dist/main.js`, `dist/manifest.json`, and `dist/styles.css`, exact source/distribution manifest equality, and absence of an inline source map in the production bundle.

The validator uses JSON parsing and filesystem metadata, not text replacement. It exits non-zero with the mismatching source names.

Acceptance: a deliberately stale lockfile, mismatched manifest, missing/empty asset, or development source map makes validation fail; a consistent production build passes.

### R2. CI publication gate

`package.json` exposes `typecheck`, full Node test, and release-validation scripts. The release workflow runs, in order: `npm ci`, prebuild validation, lint, typecheck, the full test suite, production build, postbuild validation, provenance attestation for all three assets, then GitHub Release publication. The release contains flat `main.js`, `manifest.json`, and `styles.css` assets and uses the validated package version as tag and release name.

A human chooses and pushes the version commit. GitHub Actions may build and publish the GitHub Release from that commit; no Community account action is performed.

Acceptance: no release or attestation step is reachable after a failed quality or asset gate; all three published assets match the validated build.

### R3. Installation documentation

README installation instructions distinguish Community Plugins installation, GitHub Release asset installation, and local development from `dist/`. They do not describe the repository root as an installable plugin directory.

Acceptance: every documented manual install path ends with one folder containing the three release assets and a manifest with id `ai-wiki`.

## 5. Evidence Packing and Cost

### R4. Maximal prepared-budget packing

`chunkMarkdownSource` remains responsible for lossless structural ranges, line authority, overlap semantics, and code-fence repair. Evidence planning adds a packing pass over adjacent ranges. A candidate merge is allowed only when:

- ranges are contiguous and non-overlapping;
- reconstructed Markdown remains the exact original range, apart from the chunker's existing synthetic fence wrappers;
- both base and bounded-repair prepared requests plus `MAPPER_ESTIMATE_SAFETY_TOKENS` fit the effective input budget.

Packing is greedy in source order. Each emitted chunk is maximal: appending the next structural range would exceed the governed request budget. If one structural range cannot fit, the existing paragraph/line window derivation finds a smaller fitting range before packing.

Acceptance:

- every emitted mapper request fits complete-message preflight;
- with overlap zero, every original source line is covered exactly once and in order;
- no adjacent emitted pair remains mergeable under the same prepared-request estimator;
- a small fitting source produces one chunk regardless of heading count;
- a deterministic 17-18 KB, roughly 400-line, 30-plus-heading multilingual fixture produces at most three chunks at the 16,384 input budget and 4,096 output budget;
- an oversized mixed fixture with headings, paragraphs, and fenced code scales by packed content size and retains full coverage;
- total estimated input across a multi-section fixture is lower than the uncoalesced structural-range baseline.

### R5. Provider-independent estimator

`estimatePreparedMessages` continues to reserve one token unit per serialized UTF-8 byte and the existing media allowance. Provider-reported token usage remains telemetry, not a planning input. No model-name switch or tokenizer table changes the safety decision.

Acceptance: ASCII, Cyrillic, mixed Unicode, JSON metadata, and media fixtures never receive a lower estimate due to model identity; existing prompt-budget safety tests remain green.

## 6. Map-Once Bootstrap Handoff

### R6. Full evidence retention

Bootstrap preparation returns an internal bundle containing:

- the existing bounded `BootstrapEvidence` taxonomy view;
- the complete verified, reduced, initially untyped `EntityEvidence[]`;
- requested domain id, vault source path, and `hashSource(sourceContent)` authority.

Bounding the taxonomy view may remove low-priority themes, facts, exact text, or candidates as today. It never mutates or truncates the retained full evidence.

Acceptance: packet ids, facts, exact source ranges, exact source text, and links in retained evidence equal the output of the existing verified reducer byte-for-byte; taxonomy bounding cannot change the retained collection.

### R7. Bounded type enrichment

After `init.bootstrap` returns the final merged `entity_types`, a dedicated structured classifier receives compact units containing only retained entity keys and extracted facts. It does not receive exact source text or re-numbered source lines. Units are packed with the shared prompt-budget governor. The response maps every supplied entity key to exactly one type from the final allowed set.

Server validation rejects missing, duplicate, foreign, or unknown-type assignments. Applying assignments may add only `entityType`; all other evidence fields must remain identical. The classifier uses the existing structured retry limit and no recursive semantic split. A context or output-size condition may deterministically repartition the unmodified classification units.

Acceptance:

- every non-empty handoff is fully typed before synthesis;
- empty evidence requires no classification request;
- every classifier request fits preflight and contains no complete source replay;
- invalid assignments fail before force wipe or domain save;
- request count is the number of budget-packed classification batches, not the number of source headings or chunks.

### R8. Authoritative handoff consumption

`runIngest` accepts an optional internal prepared-evidence value. It uses that value only when domain id, vault source path, and source body hash match the source it just read. It validates the typed `EntityEvidence[]` against the allowed domain types before context construction or synthesis.

The first Init source receives the handoff on its initial attempt and Retry. Later sources and direct Ingest use ordinary evidence extraction. A mismatch emits metadata-only fallback telemetry and recomputes evidence; it never applies stale evidence.

Acceptance:

- a successful fresh or force Init makes one full evidence-map pass for its first source;
- the first source emits no `ingest.evidence-map` request when the handoff matches;
- a changed source hash causes ordinary extraction and no handoff evidence reaches synthesis;
- Retry after a downstream failure reuses the still-authoritative handoff;
- direct Ingest behavior and delete/rebuild transactional execution remain unchanged.

## 7. Mapper Wire and Recovery

### R9. Symmetric complementary arrays

The request-local mapper wire adapter treats these forms as equivalent before strict schema and coverage validation:

- non-empty `packets` with omitted `noEvidence` becomes `noEvidence: []`;
- non-empty valid `noEvidence` with omitted `packets` becomes `packets: []`.

It does not synthesize evidence, facts, ranges, reasons, or ownership. Both arrays absent, both arrays empty, mixed coverage, foreign chunks, invalid ranges, and malformed non-empty members remain invalid.

Acceptance: a heading-only or evidence-free chunk returned in the second form succeeds in one underlying request; every invalid control still fails the same public coverage checks.

### R10. Bounded split policy

Mapper recovery distinguishes protocol defects from size or content-partition defects:

- local wire normalization runs before model repair;
- `output_limit` exhaustion may split a multi-line source range;
- a parseable response rejected only by chunk-local semantic coverage/range validation may split only when both child prepared estimates are strictly smaller than the parent;
- top-level missing fields, malformed framing/JSON, invalid types, foreign ownership, and an indivisible range do not recursively split after bounded repair;
- a derived child cannot split again. Split depth is at most one per initial packed chunk.

Acceptance: valid first output uses one request; normalizable no-evidence output uses one request; malformed protocol output uses at most the existing base plus repair attempts and zero child requests; one eligible parent split creates at most two children; no source range can form an unbounded split tree.

## 8. TD-3 Conflict Regeneration

### R11. Deterministic integration boundary

An integration fixture drives `runIngest` with an in-memory vault and a local OpenAI-compatible HTTP server. The vault exposes target authority A during synthesis and authority B before apply. The initial patch therefore conflicts. Conflict regeneration receives a malformed field frame first and a valid patch against authority B second.

The fixture retains the production SDK transport, framed parser, Zod and domain validation, fresh-authority checks, and page apply. Determinism comes from fixture state and scripted local responses, not provider randomness or production-only test branches.

Acceptance:

- malformed frame followed by valid repair makes exactly two regeneration requests and applies against B;
- parsed schema/domain defect makes exactly one regeneration request and fails closed;
- repeated stale authority makes zero additional regeneration requests;
- final page content preserves B's untouched authority and contains the accepted patch.

## 9. TD-4 Retry Terminal Status

### R12. Attempt-local events

Init intercepts child ingest `error` events and emits a typed `file_attempt` event containing file, one-based attempt, state, retryability, and safe message. States distinguish failed, retry-scheduled, and recovered attempts. These events remain visible in `agent.jsonl` but are non-terminal for the enclosing operation.

Init emits at most one typed `file_outcome` for each file resolved by Init, with status `done`, `skipped`, `stopped`, or `exhausted`. External cancellation remains owned by the abort signal and may end an active file without a file outcome. Direct Ingest continues to emit global `error` events.

Acceptance: a handled failed attempt is preserved in telemetry; every started file reaches at most one terminal file outcome; a successful Retry records recovery before `file_outcome: done`.

### R13. Pure terminal reducer

Controller status changes pass through one pure reducer. Global `error` and file outcomes `skipped` or `exhausted` produce `error`; `stopped` or an aborted operation produce `cancelled`; all files `done` with no independent global failure produce `done`. A later success never clears an unrelated global or file error.

Acceptance:

- induced failure then Retry success ends `done`;
- Skip and retry exhaustion end `error`;
- Stop and user cancellation end `cancelled`;
- a recovered file plus an unrelated global error ends `error`;
- full Init and incremental Re-init share the same event and reducer contract.

## 10. Verification Matrix

Deterministic tests cover:

- release validator pass/fail fixtures and workflow command order;
- package/lock/manifest/dist consistency;
- Markdown corpus generators for small, medium, heading-heavy multilingual, oversized paragraph, and fenced-code shapes;
- maximal packing, prepared-budget fit, exact line coverage, stable hashes, and no adjacent mergeable chunks;
- map-once full Init, force Init, source-hash mismatch, type-enrichment batching, assignment rejection, and Retry handoff reuse;
- mapper no-evidence symmetry and all invalid controls;
- output-limit/semantic split eligibility, one-level cap, and non-splittable protocol defects;
- TD-3 request counts and final authority;
- TD-4 status table and attempt telemetry;
- lint, typecheck, production build, focused tests, then the full Node test suite.

The corpus contains generated neutral content. The live source and its domain vocabulary are not copied into production code or fixtures. Live provider replay may compare calls, tokens, and latency after deterministic gates pass, but wall-clock timing is diagnostic and cannot make CI flaky.

## 11. Documentation and Delivery

Implementation updates README release/install guidance, `docs/loen/dynamic-llm-budget-routing/tech-debt.md`, and the project iwiki pages for prompt-budget governance, structured-output adapters, and Init retry status. `wiki_lint` must report no new broken references; pre-existing stale/orphan findings are reported and relevant changed pages are refreshed.

Commit, push, PR creation, GitHub Release publication, and Community account actions remain explicit human checkpoints defined by the approved intent.
