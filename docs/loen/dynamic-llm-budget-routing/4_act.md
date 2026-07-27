# Dynamic LLM Budget Routing Actions

## 2026-07-23

- Created repeatable test-vault helpers:
  - `scripts/loen-dynamic-budget-routing/set-vault-variant.mjs`
  - `scripts/loen-dynamic-budget-routing/analyze-agent-session.mjs`
- Captured baseline test-vault settings in `evidence/baseline-data.json`.
- Ran and observed these live variants against `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`:
  - `off + 16384`
  - `off + 4096`
  - `connection-close + 4096`
  - `undici-request-adapter + 16384`
  - `undici-request-adapter + 4096`
- Patched only the test-vault installed bundle to force transport mode while Obsidian persisted `devMode.nativeTransportDiagnosticMode = off`.
  Backup: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/main.js.dynamic-budget-backup`.
- Prepared next valid variant in test-vault `data.json`:
  - `nativeAgent.operations.init.maxTokens = 8192`
  - `nativeAgent.operations.ingest.maxTokens = 8192`
  - `nativeAgent.operations.init.model = nativeAgent.model`
  - `nativeAgent.operations.ingest.model = nativeAgent.model`

## Implementation Pass

- Added native `repairInputBudgetTokens` as a global repair input ceiling.
- Propagated repair input ceiling through model-call policy for `init` and `ingest`.
- Passed repair input ceiling into synthesis structured-output retries.
- Added Settings UI control and localized labels for repair input budget.
- Added regression tests for policy propagation and structured repair with a larger repair budget.
- Built production bundle and delivered `main.js`, `manifest.json`, and `styles.css` to the test vault plugin directory.
- Reapplied the test-vault-only `undici-request-adapter` transport override and set `nativeAgent.repairInputBudgetTokens = 65536` in the test vault data.

## Compact Repair Pass

- Added `compactRepairThresholdTokens` to structured JSON profiles.
- Configured ingest synthesis to prefer compact repair when the full repair prompt estimate is at least `32768` tokens.
- Strengthened synthesis prompt and repair instruction with exact patch-section shapes for `add`, `append`, and `replace`.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Duplicate Authority / Entity-Key Repair Pass

- Deduplicated identical replace authority records before synthesis validation and prompt rendering.
- Added allowed entity keys directly to semantic synthesis repair prompts.
- Added repair guidance to rewrite invalid unknown entity keys only to supplied keys or skip.
- Added regression tests for duplicate replace authorities and single-entity semantic repair allowlists.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Empty Output Fallback Budget Pass

- Monitored replay session `1784800324939`.
- Confirmed it created 15 pages before failing on `Prompt requires 66929 estimated tokens but budget is 65536`.
- Isolated the cause: empty-output response-format fallback grew an already near-ceiling synthesis prompt with an extra repair message.
- Changed structured-output retry behavior so empty output with an available response-format fallback reuses the same messages and only changes the response format.
- Added a regression test proving `json_schema -> json_object` fallback does not grow retry messages.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Response-Format Fallback Retry Accounting Pass

- Monitored replay session `1784802036257`.
- Confirmed prompt-growth failure was gone, but synthesis exhausted after `Empty structured output` -> `json_schema -> json_object` -> `No JSON object found`.
- Changed structured-output retry accounting so response-format fallback can use up to two bounded format attempts without consuming the configured schema repair retry budget.
- Preserved `maxRetries = 0` as no-retry behavior.
- Added regression coverage for fallback followed by ordinary schema repair.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Embedding Refresh Retry Pass

- Monitored replay session `1784803891040`.
- Confirmed the run moved past synthesis and failed during embedding refresh with backend `503 model_unavailable`.
- Added bounded retry for pending embedding refresh batches on transient endpoint failures.
- Kept index mutation atomic: repeated embedding failure still preserves existing index bytes and returns an embedding-stage failure.
- Added regression coverage for first-call `503` followed by successful embedding refresh.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Single-Bundle Coverage Canonicalization Pass

- Monitored replay session `1784804535754`.
- Confirmed first source completed with 12 pages and zero structural/semantic retries.
- Identified second-source retry storm around duplicate coverage, invented entity keys, and empty-output fallback exhaustion for `ufw`.
- Moved synthesis duplicate coverage checks from schema parse to semantic validation where bundle context is available.
- Added deterministic single-bundle canonicalization for `entityKey`, server-owned create path, duplicate action coverage, and skip/action conflicts.
- Added regression coverage for invented single-bundle keys and duplicate action coverage without repair.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Query Stream Options / Evidence Mapper Pass

- Monitored reinit session `1784806127418` and query session `1784807651320`.
- Isolated query failure to backend rejection of `stream_options.include_usage`.
- Added streaming compatibility retry for `query.answer` and chat calls: retry once without `stream_options` on `400/422 Unsupported parameter: stream_options`.
- Added mapper wire normalization for compact `noEvidence` values scoped to the current chunk.
- Compact mapper repair diagnostics now use Zod issue codes instead of raw issue messages.
- Sanitized evidence structural-error telemetry to avoid forwarding raw invalid model values.
- Added a `128` token mapper planning safety margin to avoid near-boundary prompt budget failures.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Synthesis Repair Reserve Pass

- Monitored reinit session `1784808634361`.
- Confirmed first two source files completed with zero semantic retries and 17 pages created.
- Isolated the third-file failure to a near-ceiling synthesis prompt: `65245` estimated input tokens against `65536`, then compact repair grew to `66861`.
- Added dynamic synthesis repair reserve for first single-bundle requests when structured repair is enabled: 5% of effective budget, bounded to `512..2048` tokens.
- Fixed prompt-budget truncation convergence so the truncation marker is included within the target length.
- Added regression coverage for synthesis packing below the dynamic repair reserve.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Synthesis Bundle Shaping / Telemetry Pass

- Added metadata-only `prompt_breakdown` telemetry for synthesis prompts.
- Breakdown reports token estimates for contracts, evidence, retrieved context, page descriptions, and registry without leaking text.
- Added safe counts for bundle/entity/wiki-section/fact/range/source/link/description/registry cardinality.
- Capped optional retrieved wiki sections to six per entity in synthesis prompt shaping; required target sections remain preserved.
- Shortened `exactSource.text` before synthesis while retaining exact source ranges.
- Extended regression coverage for optional context caps, source text shortening, and breakdown safety.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override and `repairInputBudgetTokens = 65536`.

## Bootstrap Fresh Transport Pass

- Added an internal native `nativeFreshConnection` call option.
- Propagated the option through native retry context into per-attempt fetch options.
- Added a private native transport symbol so the OpenAI fetch wrapper can request an isolated desktop-direct dispatcher for a single request without leaking internal symbols to the underlying fetch call.
- Enabled this policy only for `init.bootstrap` in normal `diagnosticMode: off`; diagnostic transports such as `undici-request-adapter` and `connection-close` keep ownership of their selected fetch implementation.
- Added regression coverage for bootstrap option propagation, native executor forwarding, and desktop-direct isolated dispatcher selection.
- Rebuilt and delivered the updated bundle to the test vault, keeping the test-vault-only adapter override, `repairInputBudgetTokens = 65536`, and `synthesisMaxEntityBatchSize = 2`.

## Bootstrap Fresh Transport Adapter Guard Pass

- Monitored session `1784811298973`.
- Confirmed `init.bootstrap-map` succeeded under `undici-request-adapter`, then `init.bootstrap` failed immediately with `fetch_error TypeError` because the fresh-connection branch bypassed the adapter in diagnostic mode.
- Restricted the fresh-connection branch to effective `diagnosticMode: off`.
- Added regression coverage proving the fresh symbol preserves `undici-request-adapter` mode and does not leak into adapter options.
- Rebuilt and delivered the corrected bundle to the test vault.

## Awaited Adapter Dispatcher Close Pass

- Monitored session `1784811816505`.
- Confirmed the adapter guard removed the retry hang, but `init.bootstrap` still produced an immediate first-attempt `fetch_error TypeError` after `init.bootstrap-map` body completion.
- Changed isolated direct/adapter dispatcher finalizers from fire-and-forget close to awaitable close.
- Changed response body observation so normal `body_end` waits for the isolated dispatcher close before resolving body consumption to the SDK.
- Added regression coverage proving `undici-request-adapter` response body completion waits for dispatcher close.
- Rebuilt and delivered the updated bundle to the test vault.

## Bootstrap Settle Barrier Pass

- Monitored session `1784812601637`.
- Confirmed awaited dispatcher close did not remove the immediate first-attempt `init.bootstrap` fetch error.
- Added a native-agent-only abortable settle barrier after `init.bootstrap-map` and before `init.bootstrap`.
- Kept the barrier scoped to bootstrap only; ingest, synthesis, query, and chat are unchanged.
- Re-ran focused bootstrap/native transport checks plus the broader bootstrap/transport/query/synthesis suite.
- Rebuilt and delivered the updated bundle to the test vault.

## Bootstrap Settle Window Adjustment Pass

- Monitored session `1784813242526`.
- Confirmed a 750 ms settle barrier was still below the observed successful transport window.
- Increased the bootstrap settle barrier to 1500 ms, above the observed retry recovery start time of roughly 1.2 seconds.
- Rebuilt and delivered the updated bundle to the test vault.

## Source-Level Synthesis Shaping Pass

- Re-analyzed the still-running session `1784813242526` after it exceeded 8000 seconds.
- Confirmed the dominant failure was no longer bootstrap transport: `ingest.synthesize` produced 124 requests, 105 prompt breakdowns, 52 structural errors, and 5 semantic validation retries.
- Confirmed over-generation: the run created many standalone command/config/package fragments, including `commands/wiki_os-unix_apt_install_*`, `commands/wiki_os-unix_glxinfo_*`, and thin configuration pages.
- Changed the default synthesis entity batch size from `2` to `1`.
- Added `synthesisMaxEntitiesPerSource` with default `6` and settings UI control.
- Added deterministic source-level bundle ranking and cap before synthesis calls. Existing/patch targets, software/application, configuration, concept/distribution entities rank above command-like fragments.
- Dropped capped-out entities as explicit synthesis skips, preserving strict coverage without asking the LLM to generate low-value micro-pages.
- Reduced synthesis optional wiki context from six sections per bundle to three and shortened `exactSource.text` to 192 characters.
- Tightened evidence and synthesis prompts so command lines, flags, paths, and one-off install commands should be facts inside stronger parent pages rather than standalone articles.
- Rebuilt and delivered the updated bundle to the test vault with `synthesisMaxEntityBatchSize = 1` and `synthesisMaxEntitiesPerSource = 6`.
## Sentinel-framed ingest structured output

Changed ingest evidence mapping, evidence reduction, and synthesis to use a sentinel-framed JSON profile without provider `response_format`. Added a tolerant reader for legacy raw JSON, while retaining Zod and domain validation. Missing mapper `noEvidence` is normalized to an empty array only when packets provide coverage; coverage validation still rejects uncovered chunks.

Changed paths:

- `src/phases/framed-output.ts`
- `src/phases/ingest-evidence.ts`
- `src/phases/ingest-synthesis.ts`
- `prompts/ingest-evidence-map.md`
- `prompts/ingest-evidence-reduce.md`
- `prompts/ingest-synthesis.md`
- `tests/structured-output.test.ts`
- `tests/ingest-evidence.test.ts`
- `tests/ingest-synthesis.test.ts`

Observed result: captured ingest requests have no `response_format`, prompts contain `<<<JSON>>>`/`<<<END>>>`, and strict local validation remains active.

## Field-framed synthesis output

Replaced synthesis article-in-JSON output with typed field frames. Create and patch Markdown now lives in raw `<<<CONTENT>>>` blocks. Action identity, canonical path, page hash, section operation, section ordinal/hash, skip, and entity-type delta remain parsed into `SynthesisOutputSchema` and then pass existing domain validation. Legacy JSON remains readable for transition compatibility.

Frames added: `CREATE`, `PATCH`, `SECTION`, `CONTENT`, `SKIP`, `ENTITY_TYPES_DELTA_JSON`, and final `END`. Marker recognition ignores marker-like lines inside Markdown code fences.

Changed paths:

- `src/phases/framed-output.ts`
- `src/phases/ingest-synthesis.ts`
- `prompts/ingest-synthesis.md`
- `tests/structured-output.test.ts`
- `tests/ingest-synthesis.test.ts`

## Local validation UI states

- Renamed lifecycle `validating` UI text to `Checking response locally`.
- Renamed post-validation `applying` UI text to `Accepted`.
- Structural repair events now show `Repair requested`.
- `schema_validate` failures show `Domain rejected` followed by `Repair requested` when bounded repair starts.
- Transport retry labeling remains separate from response repair.

## Conflict Regeneration P0 Pass

- Updated guarded conflict regeneration prompts to include the same field-framed synthesis output contract as normal synthesis.
- Added regression coverage for a raw `<<<PATCH>>>` regeneration response with Markdown content outside JSON.
- Changed duplicate-create canonical merge failures from source-fatal `patch` failures to source-local deferred skips.
- Kept strict patch/domain validation: invalid regeneration is not applied, the draft duplicate page is not created, and existing duplicate/canonical pages remain unchanged.
- Added regression coverage for legacy flat regeneration output during duplicate merge.

Verification:

- `node --import tsx --test tests/ingest-synthesis.test.ts`
- `node --import tsx --test tests/ingest-bounded.test.ts`
- `npm run lint`
- `npm run build`

Delivery note: production bundle was rebuilt in `dist/`, but shell delivery to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/` was blocked by environment approval policy.

## OS/Unix Minimum Taxonomy Pass

- Added server-owned minimum entity taxonomy for OS/Unix-like domains only.
- Core types are `application`, `configuration`, `distribution`, `service`, and `concept`.
- Bootstrap model additions are preserved after the core types; duplicate core model types are overwritten by the server-owned contract.
- Non-OS domains keep the model-provided taxonomy unchanged.
- Applied the taxonomy immediately after successful bootstrap parse and before `domain_created` / `domain_updated`.
- Added regression coverage for pure taxonomy merge and `os-unix` dry-run bootstrap with a collapsed model taxonomy.

Verification:

- `node --import tsx --test tests/domain-minimum-entity-types.test.ts`
- `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts`
- `node --import tsx --test tests/ingest-bounded.test.ts tests/ingest-synthesis.test.ts tests/domain-minimum-entity-types.test.ts tests/init-bootstrap-fail-loud.test.ts`
- `npm run lint`
- `npm run build`

Delivery:

- Copied rebuilt `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Delivered `main.js` size: `2752282` bytes.
- Set test-vault `devMode.nativeTransportDiagnosticMode = "off"`.
- Confirmed test-vault effective profile: global input budget `65536`, repair input budget `65536`, output budget `16384`, `perOperation = false`, synthesis batch `1`, max entities per source `6`.

## Bootstrap Taxonomy Quality Gate Pass

- Reverted the OS/Unix hardcoded minimum taxonomy; no permanent domain-specific type list remains in code.
- Added existing taxonomy reuse during bootstrap: existing domain `entity_types` are included in bootstrap context and preserved in the resulting taxonomy; model output may add source-supported new types.
- Added generic bootstrap taxonomy collapse detection: when source evidence has at least three distinct candidates and the generated taxonomy has zero or one distinct type, the result is rejected locally.
- Added one bounded semantic repair for collapsed taxonomy. Repair prompt asks the model to derive reusable types from evidence, reuse existing types where they fit, and avoid generic collapse.
- Empty taxonomy remains allowed when bootstrap evidence has no candidates, preserving existing behavior for sparse or non-informative first sources.
- Added regression coverage for collapsed taxonomy repair and force-bootstrap reuse of existing entity types.

Verification:

- `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts`
- `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts tests/ingest-bounded.test.ts tests/ingest-synthesis.test.ts`
- `npm run lint`
- `npm run build`

## Buffered Desktop Non-Stream Transport Pass

- Reproduced the regression with two failing tests: desktop non-stream selected `desktop-direct` instead of the host-buffered route.
- Changed normal desktop/no-proxy routing to `desktop-hybrid`: `stream: false` uses the injected host transport; `stream: true` keeps pooled direct Undici.
- Kept mobile, proxy, `connection-close`, and `undici-request-adapter` routing unchanged.
- Added `desktop-host` and `desktop-hybrid` diagnostics. Per-request response and trace telemetry report the actual route rather than the hybrid selector.
- Mapped pre-response executor correlation to `desktop-host` for non-stream and `desktop-direct` for stream.
- Kept the bootstrap fresh-connection flag and settle policy in place for this A/B pass; the flag no longer overrides the host route for non-stream requests.
- Updated regression tests for host buffering, actual-route telemetry, fresh bootstrap policy, direct SSE routing, and direct streaming connection reuse.
- Rebuilt `dist/main.js`, delivered it to the test vault, and preserved the prior bundle as `main.js.pre-desktop-hybrid-backup`.

## Bounded Ingest Contract Repair Pass

- Added explicit `<<<END_CONTENT>>>` boundaries for create and patch Markdown. Parsers strip the boundary and reject any reserved protocol marker line left inside article content; legacy frames without the boundary remain readable.
- Added unique canonical identity reuse from article IDs, H1 titles, and frontmatter aliases. Ambiguous aliases do not resolve. Retrieval rank no longer selects an update target.
- Limited synthesis page bodies to the exact canonical target for update. Create receives no optional page body and uses only a server-owned create path.
- Classified empty or malformed output at the active completion cap as `output_limit`. The retry starts from fresh base messages, omits failed assistant output, and raises the output budget dynamically up to the configured global ceiling.
- Added stable evidence mapper validation reason codes to bounded repair prompts.
- Replaced source-level evidence dropping with deterministic small-entity consolidation. Child facts, ranges, exact source, links, and packet IDs are merged into selected parent evidence before synthesis and reported in telemetry.
- Updated old rename tests to use explicit aliases because similarity-only candidates are no longer writable targets.
- Preserved the accepted single-bundle coverage canonicalization contract and updated the production acceptance matrix to require one request and one canonical action.

Changed paths include:

- `src/phases/framed-output.ts`
- `src/phases/structured-output.ts`
- `src/phases/ingest-evidence.ts`
- `src/phases/ingest-synthesis.ts`
- `src/phases/ingest.ts`
- `src/ingest-context.ts`
- `src/model-call-policy.ts`
- `src/utils/raw-frontmatter.ts`
- `prompts/ingest-synthesis.md`
- focused ingest, framing, policy, and structured-output tests

## Evidence Mapper Output Ceiling Propagation Pass

- Monitored replay session `1784868963664` after the first bounded-ingest bundle restart.
- Bootstrap-map and bootstrap both completed on attempt 0 through `desktop-host`; no transport retry occurred.
- The first evidence-map response consumed `4096/4096` tokens without usable content and was correctly classified as `output_limit`.
- Live fingerprints exposed a retry-layer defect: the evidence mapper's bounded repair wrapper invoked the shared structured runner with `maxRetries: 0`, then recreated every retry from original options. Eight mapper requests therefore kept `max_tokens=4096`; six reached `output_limit`; no source file completed.
- Extended `StructuredValidationError` with typed structural error and observed output-token metadata.
- Made the shared output-retry option calculation reusable by bounded operation wrappers.
- Changed evidence mapper/reducer bounded retries to preserve current options and raise the output cap only after typed `output_limit`, while retaining fresh base messages, compact repair guidance, and concrete mapper validation reasons.
- Added a red/green regression test proving mapper request caps change from `4096` to `6144` and no assistant response is replayed.

## Field-Frame Repair Budget Propagation Pass

- Monitored replay session `1784869572887` through its terminal ingest failure.
- Confirmed `init.bootstrap-map` and both observed evidence-map calls raised output caps from `4096` to `6144`; all responses used `desktop-host`, returned HTTP 200, reached `body_end`, and produced zero transport retries.
- The first source completed after six single-entity synthesis calls. Source 2 stopped when the model emitted `## CREATE` instead of `<<<CREATE>>>`; local frame validation rejected it.
- The repair request was never sent because its 16,973-token estimate exceeded the inherited 16,384 init input budget. The configured 65,536 repair input ceiling was dropped by `ingest.ts` while converting call options to `ModelCallPolicy`.
- Preserved `repairInputBudgetTokens` in ingest policy conversion.
- Changed the shared structured runner to use the normal input budget on attempt 0 and switch to the repair input ceiling only after a structural failure.
- Made synthesis frame repair always fresh and compact, without invalid assistant output.
- Added explicit prompt and parser diagnostics requiring literal `<<<...>>>` marker lines and rejecting Markdown-heading substitutes such as `## CREATE`.
- Added red/green parser and end-to-end ingest regressions. The ingest test proves the first request uses 12,500 input tokens, the retry uses 65,536, the retry estimate exceeds 12,500, and no assistant message is replayed.

Changed paths for this pass:

- `src/phases/ingest.ts`
- `src/phases/framed-output.ts`
- `src/phases/ingest-synthesis.ts`
- `src/phases/structured-output.ts`
- `prompts/ingest-synthesis.md`
- `tests/framed-output.test.ts`
- `tests/ingest-bounded.test.ts`
- `tests/structured-output.test.ts`

## Init-to-Ingest Policy Routing Pass

- Diagnosed replay session `1784893122317`: bootstrap completed without transport retries, but all child source requests inherited the `init` limits (`16384` input / `4096` output) instead of the configured `ingest` limits (`65536` input / `16384` output).
- Added an explicit child-ingest runtime to full, forced, source-only, and incremental init orchestration. Bootstrap still uses the parent init runtime; source processing uses the ingest runtime.
- Kept direct `runInit*` callers backward compatible: when no child runtime is supplied, source processing falls back to the parent runtime.
- Kept per-operation settings optional. When disabled, both runtimes resolve from the editable global Chat model settings; no model or budget value is hardcoded by this routing change.
- Clarified settings labels and descriptions so `Init` means bootstrap and `Ingest` means source-file processing, including source work started by init or re-init.
- Added regressions for distinct init/ingest budgets and for global inheritance when per-operation settings are disabled.

Changed paths for this pass:

- `src/agent-runner.ts`
- `src/phases/init.ts`
- `src/i18n.ts`
- `tests/init-force-retry.test.ts`
- `tests/init-ingest-outcome.test.ts`

Delivery:

- Rebuilt and delivered `main.js`, `manifest.json`, and `styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and vault `main.js` match SHA-256 `45b2fc56cd0fa9b0a3be40e127a8dd320239e97f7acdca30af3110151ce5dfa3`.
- Preserved the preceding bundle as `main.js.pre-init-ingest-policy-backup` with SHA-256 `ef38ec5587f25e4f36a895a87f6af9d46fdd903a7908318ee89dce1b8eed65e5`.
- Left the test-vault settings unchanged.

## Init-to-Ingest Live Replay

- Monitored session `1784896515548` to terminal `done`: 22/22 sources completed in 2,858,034 ms.
- Bootstrap used the init policy (`16384/4096`). All source evidence and synthesis requests used the ingest policy (`65536/16384`).
- `AMD Driver.md` mapped as one source chunk instead of 19 and completed with six accepted synthesis actions. `usb.md` passed the old terminal-failure point; `user.md` evidence succeeded in one mapper call instead of four.
- Recorded 121 logical calls: three bootstrap-map, one bootstrap, 22 evidence-map, and 95 synthesis. Every logical call received HTTP 200 with a complete body.
- Provider usage: 465,960 input tokens and 328,216 output tokens; no call reached the 16,384 output cap.
- Structural failures were limited to bootstrap-map output escalation (`4096 -> 6144 -> 9216`). Ingest had zero frame, schema, or domain repair.
- One evidence-map host request failed before headers after 20,075 ms and recovered on attempt 1 with HTTP 200 and a complete 27,880-byte body.
- Final output: 78 created pages and 15 updates. No reserved field-frame marker remained in Markdown; all 105 final WikiLinks resolve to at least one vault page.
- Evidence: `evidence/init-ingest-policy-routing-replay-1784896515548.json`.

Post-run integrity audit found four unparseable frontmatter blocks and one three-way alias collision. These findings start the next bounded page-integrity pass.

## Post-Replay Page Integrity Implementation Pass

- Added a create-flow regression reproducing an unquoted colon in model-authored `description`. The test failed with the same YAML parser error found in four replay pages.
- Added a same-source regression reproducing one canonical alias claimed by a canonical page and a sibling configuration page.
- Added server-side frontmatter governance before page validation. Canonical `type`, framed action `description`, create provenance, and create status are now serialized with the shared YAML writer instead of copied from article Markdown.
- Optional model metadata is retained only when its remaining YAML mapping parses. Invalid optional metadata is discarded with a guard warning; article body content is preserved.
- Added a prepared-page alias guard. It normalizes article IDs, H1 titles, and aliases; keeps an alias on its unique canonical owner; and removes conflicting claims from other prepared pages.
- Excluded pages already approved for guarded duplicate deletion from the future alias-owner inventory. This preserves canonical metadata while the existing deletion path still revalidates content and index authority before removal.
- Updated the force-reinit retry assertion to validate governed YAML and the exact article body separately.

Changed paths for this pass:

- `src/utils/raw-frontmatter.ts`
- `src/phases/ingest.ts`
- `tests/ingest-bounded.test.ts`
- `tests/init-force-domain-wipe.test.ts`

Delivery:

- Rebuilt and delivered `main.js` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault `main.js` match SHA-256 `a22b8fd34514033bb0d2ea7c9e54d459db3cc78575c872f00b2e121d9f5a315c`.
- Preserved the accepted routing bundle as `main.js.pre-page-integrity-backup` with SHA-256 `45b2fc56cd0fa9b0a3be40e127a8dd320239e97f7acdca30af3110151ce5dfa3`.
- `manifest.json` and `styles.css` were already byte-identical to the rebuilt artifacts. Test-vault settings were not changed.

## Canonical Type Reverse-Mapping Repair

- Monitored page-integrity replay session `1784901066143` from bootstrap through the first completed source.
- Bootstrap-map and bootstrap completed on attempt 0 with complete host-buffered bodies; source ingest used `65536/16384` as expected.
- Audited the first six persisted pages before waiting for the full replay. All YAML parsed and all pages had source provenance, but `wiki_os-unix_profile.md` exposed `type: configurations` instead of `configuration`.
- Added a red regression with entity type `configuration` and subfolder `configurations`; before the fix it observed the same plural value.
- Added `governedEntityTypeFromPath`, which reverses configured `effectiveSubfolder` values and falls back to the path type only when no configured match exists.
- Re-ran frontmatter, alias, canonical deletion, full ingest, lint, build, and full repository tests.

Delivery:

- Delivered replacement bundle SHA-256 `4abb0cc55181c376e2e67da488f44ba86c8c9133cf74b56938d40f809600ccb6`.
- Preserved the rejected P0 bundle as `main.js.pre-canonical-type-backup` with SHA-256 `a22b8fd34514033bb0d2ea7c9e54d459db3cc78575c872f00b2e121d9f5a315c`.
- Test-vault settings were not changed.
- Evidence: `evidence/page-integrity-replay-1784901066143-rejected.json`.

## Live Patch-Recovery Repair

- Monitored session `1784901643760` to its terminal source failure at 18/22 files. It made 107 LLM calls with zero transport retries and persisted 66 YAML-valid pages before `usb.md` failed.
- Added `scripts/loen-dynamic-budget-routing/audit-page-integrity.mjs` for read-only YAML, type-folder, provenance, index, protocol-marker, and alias ownership checks.
- Reproduced the terminal path: synthesis used `add` for an existing `## External links`; conflict regeneration then repeated `## Основные характеристики` inside its section body.
- Added deterministic existing-heading reconciliation: one live matching heading changes `add` to deduplicating `append`; zero or multiple matches remain strict failures.
- Made synthesis frame parsing tolerate only one repeated leading H2 that exactly matches the section header. Other top-level H2 content remains schema-invalid.
- Normalized only two-item mapper source-range tuples into `{ startLine, endLine }` before unchanged strict validation.
- Fixed alias ownership's multi-primary predicate and replaced lossy ASCII title normalization with a Unicode-preserving canonical identity. Entity keys and canonical wiki stems remain ASCII-only.
- Added five focused regressions covering the live defects and localized alias behavior.
- Recorded replay evidence at `evidence/page-integrity-replay-1784901643760.json`.
- Rebuilt and delivered the repaired bundle to the test vault at `2026-07-24T18:09:58+03:00`.
- Delivered `main.js` SHA-256 `8ba895860f52c586d13c06b27425fcb944b20cb147cbacbb0ef3b1bc1a87ca91`; preserved the previous bundle as `main.js.pre-live-patch-recovery-backup` with SHA-256 `4abb0cc55181c376e2e67da488f44ba86c8c9133cf74b56938d40f809600ccb6`.

## Server-Owned Mapper and Article-Shape Implementation Pass

- Monitored session `1784909821666` to terminal `done`: 22/22 sources completed in 2,955,994 ms with 118 complete HTTP responses and zero transport retries.
- Isolated seven avoidable extra LLM calls: one bootstrap output-limit retry, four mapper schema retries, one existing-target synthesis repair, and one evidence-map output-limit retry.
- Confirmed the four mapper schema retries came from two single-chunk responses whose copied `chunkId` omitted the final hash character. The eventual accepted responses used the same evidence with the exact identifier.
- Canonicalized packet `chunkId` to the sole server-owned request chunk at the mapper wire boundary. Source ranges, entity keys, configured types, and public multi-chunk coverage validation remain strict.
- Added a deterministic single-target synthesis adapter. A complete create article for exactly one existing canonical target becomes a guarded patch only when the target path and page hash are unique, the preamble contains only frontmatter/H1 scaffolding, and all article H2 sections can be represented safely; `## Sources` remains server-owned. Meaningful preamble prose stays fail-closed and requests repair instead of being dropped.
- Added a created-page shape guard that normalizes one leading compact `#Title` into `# Title` and rejects missing or multiple H1 headings.
- Found and fixed a downstream interaction: dead-link punctuation cleanup changed `# .bashrc` back to `#.bashrc`. Cleanup now preserves ATX heading syntax.

Changed paths for this pass:

- `src/phases/ingest-evidence.ts`
- `src/phases/ingest-synthesis.ts`
- `src/phases/ingest.ts`
- `src/wiki-link-validator.ts`
- `tests/ingest-evidence.test.ts`
- `tests/ingest-synthesis.test.ts`
- `tests/ingest-bounded.test.ts`
- `tests/wiki-link-validator.test.ts`

Delivery:

- Rebuilt and delivered `main.js` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault bundle hashes match SHA-256 `b3adf2c76e9d81da7e788a883066b7c7a86ce92f9160607c87dcfffa8bf50196`.
- Preserved the completed-replay bundle as `main.js.pre-server-owned-contract-backup` with SHA-256 `8ba895860f52c586d13c06b27425fcb944b20cb147cbacbb0ef3b1bc1a87ca91`.
- `manifest.json`, `styles.css`, test settings, and source notes were unchanged.

## Cross-Operation Streaming Compatibility Implementation Pass

- Diagnosed Query session `1784914297075`: retrieval and prompt packing completed, HTTP `400` headers arrived in 55 ms, and the direct response then exposed zero error-body bytes until manual cancellation after 152.5 seconds.
- Confirmed the provider contract outside Obsidian. A minimal request with `stream_options.include_usage` returned `400 Unsupported parameter: stream_options.`; the same plain streaming request returned HTTP `200`, SSE chunks, and `[DONE]`.
- Observed the same defect in Format session `1784914453224`: attempt 0 failed at fetch in 6 ms, attempt 1 received HTTP `400` headers in 33 ms, then stalled with zero body bytes until cancellation after 490.9 seconds.
- Changed shared chat parameter construction so `stream_options.include_usage` is opt-in. Query, Chat, Format, and streaming structured operations now send the provider-compatible plain SSE request by default.
- Added a direct HTTP error-body boundary. Non-success bodies are buffered for at most five seconds, or the smaller configured connection timeout; a stalled body becomes a status-preserving `response_body_timeout` API error rather than inheriting the 600-second model idle timeout.
- Changed native retry fetch metadata so attempt 1 and later request an isolated fresh direct connection. Successful attempt 0 keeps pooled incremental SSE; non-stream hybrid calls remain on `desktop-host`.
- Kept explicit `includeStreamUsage: true` and the existing Query/Chat unsupported-parameter fallback available for known-compatible providers and controlled tests.

Changed paths for this pass:

- `src/phases/llm-utils.ts`
- `src/native-llm-executor.ts`
- `src/native-openai-transport.ts`
- `src/types.ts`
- `tests/query-budget.test.ts`
- `tests/native-llm-executor.test.ts`
- `tests/native-openai-transport.test.ts`

Delivery:

- Rebuilt and delivered `main.js` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault bundle hashes match SHA-256 `d8557e9ed7550ae28cebc7e6d8d8324c6dd6b67e9ac02b16a39db2ed4be997ef`.
- Preserved the previous bundle as `main.js.pre-streaming-compatibility-backup` with SHA-256 `b3adf2c76e9d81da7e788a883066b7c7a86ce92f9160607c87dcfffa8bf50196`.
- Test-vault settings and source notes were unchanged.

## OpenAI Chat Contract Compatibility Implementation Pass

- Reproduced the latest Query and Format failures against the configured endpoint. Both requests received HTTP `400` in under 60 ms, but the direct error-body reader waited for EOF and replaced the provider JSON with a synthetic five-second timeout.
- Isolated the rejected request field: the persisted numeric `thinkingBudgetTokens` value was serialized as the non-standard `thinking: { type: "enabled", budget_tokens: ... }` object. The endpoint returned `Unsupported parameter: thinking.` The same request without that field returned HTTP `200`.
- Changed shared Chat Completions output limits from deprecated `max_tokens` to standard `max_completion_tokens`.
- Removed runtime serialization and settings controls for numeric thinking budgets. Legacy persisted fields remain readable for backward compatibility but are ignored.
- Kept model-dependent `reasoning_effort` absent because the configured model/provider rejects it. No provider-specific reasoning request extension is required for Query, Format, or ingest.
- Changed direct error handling to return a complete JSON error as soon as it is parseable, even when the provider keeps the connection open. A timeout now preserves partial bytes and creates `response_body_timeout` only when zero bytes arrived.
- Updated request fingerprints, availability and vision probes, UI output-budget labels, and affected tests to use `max_completion_tokens`.
- Fixed two strict TypeScript narrowing boundaries exposed by the full verification run without changing their runtime contracts.

Delivery:

- Rebuilt and delivered `main.js`, `manifest.json`, and `styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault `main.js` match SHA-256 `83454dbe6bbfa861ba89e1872af205866f747e3f74934f456f3380f33c5a7923`.
- Preserved the prior bundle as `main.js.pre-streaming-compatibility-backup` with SHA-256 `b3adf2c76e9d81da7e788a883066b7c7a86ce92f9160607c87dcfffa8bf50196`.
- Test-vault settings were not rewritten; stale `thinkingBudgetTokens` values are intentionally harmless and ignored by the new runtime.

## First SSE Event Retry Implementation Pass

- Monitored post-contract-fix Query session `1784919493140` to terminal failure. It received HTTP `200` SSE headers on attempt 0 after 1,464 ms, then delivered zero body bytes and zero chunks until the 600-second operation watchdog cancelled it.
- Confirmed the provider remained available immediately after the failure. A short standard request with `max_completion_tokens: 32000` completed in 2.1 seconds; a 12,973-byte Query-shaped request with the same model, temperature, and ceiling produced meaningful output after 1.56 seconds and completed after 10.69 seconds.
- Added a red executor regression proving a no-first-event stream consumed the whole idle window and left no time for retry.
- Added a derived response-start deadline for streaming calls. It divides the configured idle window across initial plus retry attempts, uses the connection timeout as a lower bound, and never exceeds the full idle timeout. Current `600s` idle, `120s` connection, and three retries derive a `150s` first-event deadline.
- Added the retryable `response_start_timeout` classification. Attempt 1 and later retain the existing fresh-connection policy.
- Preserved the full configured inter-chunk idle timeout after the first valid model event. Caller cancellation and failures after meaningful output remain non-retryable.

Delivery:

- Rebuilt and delivered `main.js`, `manifest.json`, and `styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault `main.js` match SHA-256 `f6616f447f03c86e436dbd7a929facecc73e8391b53b42ccbe7f51677dd3af09`.
- Preserved the prior OpenAI-contract bundle as `main.js.pre-response-start-retry-backup` with SHA-256 `83454dbe6bbfa861ba89e1872af205866f747e3f74934f456f3380f33c5a7923`.
- Test-vault settings were unchanged.

## Query Empty-SSE Compact Repack Implementation Pass

- Monitored Query session `1784923289519` to terminal error after 600,011 ms.
- The unchanged payload received four distinct provider request IDs and HTTP `200` SSE headers, but every attempt produced zero body bytes and zero chunks. Attempts 0-2 reached the derived 150-second response-start deadline; the operation watchdog cancelled attempt 3 after 141.8 seconds.
- Kept ordinary transport retries unchanged, but added a request-scoped response-start retry cap. Query sets this cap to zero so the first accepted empty stream returns to the prompt planner instead of repeating the same payload inside the transport executor.
- Added `response_start_timeout` as a bounded context-repack reason. Query reduces the effective input budget, removes lower-priority complete chunks, preserves the exact question, rerenders dynamic system metadata, and requests a fresh connection.
- Prevented required-only prompts and failures after a consumed model chunk from being replayed.
- Exported the existing metadata-only request fingerprint helper and emit one fingerprint before each primary Query attempt. Compact recovery can now be verified through prompt hash, message lengths, effective budget, and source-chunk count without logging prompt content.
- Kept delegated response-start failure nonterminal in telemetry; it does not emit `transport_retry_exhausted` before a valid compact recovery.

Changed paths for this pass:

- `src/native-llm-executor.ts`
- `src/prompt-budget.ts`
- `src/phases/query-answer.ts`
- `src/phases/structured-output.ts`
- `src/types.ts`
- `tests/native-llm-executor.test.ts`
- `tests/query-budget.test.ts`

Delivery:

- Rebuilt and delivered `main.js`, `manifest.json`, and `styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault `main.js` match SHA-256 `c3d3abeeec3805bf9efb7c60d57f152b2c4b982e3b2d88859e7d11715889dbd2`.
- Preserved the identical-payload retry bundle as `main.js.pre-query-compact-repack-backup` with SHA-256 `f6616f447f03c86e436dbd7a929facecc73e8391b53b42ccbe7f51677dd3af09`.
- Test-vault settings and source notes were unchanged.

## Gateway-Correlated SSE Response-Boundary Pass

- Correlated plugin request `aiwiki-mrzfwi16-3-ptmijjneo9l`, provider request `019f95fc-2e67-766a-8698-6fb6847d6051`, and trace `ced26ad5fbe44ad9f255c4605934b3b4` with gateway audit.
- Gateway backend TTFT was `1.600790922s`; plugin HTTP `200` telemetry appeared at `2026-07-24T21:16:01.578Z`; gateway finalized `client_disconnected` at `2026-07-24T21:16:01.582149Z`. Disconnect followed header delivery by about four milliseconds and TTFT by `5.17ms`.
- Gateway captured the first reasoning fragment (`We`). The plugin body observer captured zero bytes and remained pending until its 150-second response-start timeout. This rejects the earlier 150-second gateway/model stall hypothesis.
- Isolated the matching client boundary: normal direct fetch wrapped the Undici response in a second `undici.Response` backed by the renderer-global `ReadableStream`, then the telemetry layer wrapped it again.
- Added a red regression that replaces the Undici response constructor with a guard. It failed at `closeAtOpenAiDone` before implementation and passed after the extra response reconstruction was removed.
- Pooled and isolated direct fetches now return the raw Undici response. The common observed-body layer owns byte telemetry and OpenAI `[DONE]` detection, preserving early socket release without an Electron/Undici response bridge.
- Added a production-client test with separately flushed headers, delayed `reasoning_content`, final content, and a fresh dispatcher. It receives both chunks without premature disconnect.

Verification:

- Focused transport, executor, retry, and Query suite: 150/150 passed.
- Full repository suite: 1247/1247 passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Project wiki updated; `wiki_lint` reports zero broken links and zero missing sources. Existing stale pages, orphans, and advisory findings remain outside this pass.
- Built bundle SHA-256: `f3c3dfeec5739cb215e9d5a1ec83d607194e6d0e2977762a5b1ec8d4fd8ed0ae`.
- Automatic delivery to the `/tmp` test vault was denied by the current execution policy; test-vault hash remains `c3d3abeeec3805bf9efb7c60d57f152b2c4b982e3b2d88859e7d11715889dbd2` until the local copy command is run.

## Raw Desktop SSE Ownership Pass

- Rejected the preceding partial fix with live Query session `1784929303448`. Client attempt `aiwiki-mrzgtlix-1-7cduwi43qo` received HTTP `200`, while gateway request `019f9613-be61-7497-b8a3-6a58058a73d0` had reasoning ready and terminated as `client_disconnected` at the header boundary. The plugin then waited 150 seconds with zero body chunks.
- Identified the remaining cross-runtime boundary in `observeResponseBody`: it retained an Undici reader but returned a renderer-global `ReadableStream` inside a renderer-global `Response`.
- Added a red identity regression requiring the production desktop SSE path to return the exact Undici response and body. It failed before the implementation and passed after the bypass.
- Successful `desktop-direct`, diagnostic-mode-off SSE now bypasses response observation and returns raw Undici ownership to the OpenAI SDK. Non-success body bounding, desktop-host non-stream, mobile, proxy, and explicit diagnostic modes retain their existing paths.
- Removed transport-owned `[DONE]` closure from the normal direct path. Standard provider EOF owns completion; caller abort and executor response-start/inter-chunk deadlines remain active.
- For a fresh isolated direct request, dispatcher shutdown starts gracefully after header handoff and completes after the active response closes; no response wrapper is introduced.
- Updated raw-SSE trace expectations: healthy normal direct streaming records fetch boundaries and `sdk_complete`, while model lifecycle/output events prove body delivery. Byte/chunk telemetry remains available on observed non-stream and diagnostic paths.

Verification:

- Real low-level endpoint control: HTTP `200`, first byte `1333ms`, `4605` bytes, `[DONE]`, EOF `1770ms`.
- Real project transport plus OpenAI SDK control: 17 chunks, 119 reasoning characters, 2 content characters, complete in `1857ms`.
- Focused transport/executor/retry/Query suite: 138/138 passed.
- Full repository suite: 1248/1248 passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Project wiki updated; lint has no broken links or missing sources. Existing orphans, stale source notices, and advisories remain outside this pass.
- Built bundle SHA-256: `7ca1368d06066490fe8aecf9ee27bcd80dc3292c28a3f773d05c9802422a2c7f`.

## Buffered Desktop Completion Pass

- Rejected raw-response build with live Query session `1784955341746`. It loaded SHA-256 `7ca1368d06066490fe8aecf9ee27bcd80dc3292c28a3f773d05c9802422a2c7f`, received HTTP `200`, and intentionally emitted no `body_start`, proving response wrappers were absent. No model event arrived before the 150-second deadline.
- Generalized the mobile buffered adapter as `wrapBufferedNoStream` while retaining `wrapMobileNoStream` compatibility export.
- Normal desktop `desktop-hybrid` clients now apply the same adapter. Requested streams are sent as `stream:false` through host fetch, `stream_options` is removed, and the completed response is converted to reasoning, content, and terminal chunks for phase compatibility.
- Added compatibility handling for provider `reasoning_content` alongside `reasoning`.
- Kept mobile behavior equivalent. Proxy and explicit diagnostic modes retain true streaming; low-level direct transport remains available for isolation tests.
- Updated production transport tests so normal desktop product behavior is host-buffered and raw SSE coverage is scoped to explicit diagnostics or low-level transport seams.

Changed paths for this pass:

- `src/mobile-llm-wrap.ts`
- `src/native-openai-client.ts`
- `tests/native-openai-transport.test.ts`

Delivery:

- Rebuilt and delivered `main.js`, `manifest.json`, and `styles.css` to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/.obsidian/plugins/ai-wiki/`.
- Source and test-vault `main.js` match SHA-256 `5e021522125b7bccfe0f2df54df3fa3cb488b647855e6722048b68d82d51b077`.
- Preserved raw-SSE bundle as `main.js.pre-buffered-desktop-completion-backup` with SHA-256 `7ca1368d06066490fe8aecf9ee27bcd80dc3292c28a3f773d05c9802422a2c7f`.
- Test-vault settings and source notes were unchanged.

## Consolidation Path-Authority Action

- Reproduced the post-reinit routing defect with a red unit regression: under a one-entity cap, stronger pathless `bashrc` displaced routable `npm` and became the consolidation parent.
- Extended `consolidateSmallEntityBundles` with the server-owned create-path key set. Existing targets remain actionable through required target context or replace authority.
- Restricted adjacent and cap-based parent selection to actionable bundles whenever at least one exists. Pathless bundles remain evidence children; facts, ranges, exact source, packet IDs, links, and nested consolidated keys are merged unchanged.
- Kept direct-call behavior backward compatible when no authority set is supplied. When no actionable bundle exists, original candidates remain for strict downstream rejection instead of receiving an invented path.
- Wired `runIngest` to pass `createPathsByEntityKey` before synthesis consolidation.

Changed paths for this action:

- `src/ingest-context.ts`
- `src/phases/ingest.ts`
- `tests/ingest-context.test.ts`
- `docs/loen/dynamic-llm-budget-routing/3_plan.md`
- `docs/loen/dynamic-llm-budget-routing/4_act.md`
- `docs/loen/dynamic-llm-budget-routing/5_check.md`
- `docs/loen/dynamic-llm-budget-routing/6_reflect.md`
- `docs/loen/dynamic-llm-budget-routing/attempts.jsonl`

Build and delivery:

- Production build passed; `dist/main.js` SHA-256 is `798a00178558b7214df864b7f564df18c4dd821f59d5857086bea9af65ac1130`.
- `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run` no longer exists, so no test-vault bundle was copied and no live replay was started.
- Project wiki `architecture/entity-type-routing` now documents path-authority-aware consolidation.

## Configured-Profile Live Replay and Query A/B

- Recreated the bounded test vault, delivered bundle SHA-256 `798a00178558b7214df864b7f564df18c4dd821f59d5857086bea9af65ac1130`, and ran a clean os-unix force-reinit as session `1784979910443`.
- Kept strict validation, synthesis batch size `1`, the configured init/ingest policy split, and buffered desktop completions.
- Audited all generated pages against the 22 original Work-vault sources and ran ten fixed thematic Query cases.
- Diagnosed the first Query A/B reranker fallback: configured model `ollama-bge-m3` returned `unsupported_model_capability` from `/v1/rerank`.
- Verified `lemonade-reranker-bge-reranker-v2-m3` against the same endpoint, changed only the test-vault reranker model, and reran the same ten Query cases.

Evidence:

- `evidence/configured-profile-reinit-1784979910443.json`
- `evidence/domain-quality-1784979910443.json`
- `evidence/os-unix-query-quality-1784979910443.json`
- `evidence/os-unix-query-grounding-1784979910443.json`
- `evidence/os-unix-query-quality-reranker-1784979910443.json`
- `evidence/os-unix-query-grounding-reranker-1784979910443.json`

## Query Code Boundary and Soft Entity Target Action

- Added a Markdown-aware Query WikiLink boundary shared by extraction, deterministic replacement, and unresolved-link annotation.
- Protected backtick spans and backtick/tilde fenced code, including CRLF fences and multiline code spans. TOML `[[runners]]` now remains byte-identical and does not schedule repair.
- Replaced the Query repair tail's global string replacement with code-aware semantic WikiLink replacement.
- Changed per-source entity count from a hard merge cap to a soft cost target. Routable bundles with canonical create or existing-target authority remain independent regardless of proximity or count.
- Kept pathless supporting evidence consolidation into an actionable parent and preserved its facts, ranges, exact source, packet IDs, and links.
- Added explicit overflow telemetry when retained independent entities exceed the configured target.
- Updated English, Russian, and Spanish settings text to state default/recommended target `6`, soft-target semantics, and the no-unrelated-merge guarantee.

Changed paths for this action:

- `src/phases/query-link-validator.ts`
- `src/phases/query-answer.ts`
- `src/ingest-context.ts`
- `src/phases/ingest.ts`
- `src/i18n.ts`
- `tests/query-link-validator.test.ts`
- `tests/query-budget.test.ts`
- `tests/ingest-context.test.ts`
- `tests/ingest-bounded.test.ts`
- `docs/loen/dynamic-llm-budget-routing/`

Project wiki updates:

- `architecture/entity-type-routing` documents the soft per-source target and independent routing authority.
- `architecture/query-wikilink-validation` documents code-aware extraction and mutation.
- `hierarchical-retrieval-eval` links to the Query validation contract.

## Soft-Target Live Replay and Quality Evaluation

- Monitored force-reinit session `1784986241654` through terminal completion and audited the generated os-unix domain against the Work-vault source corpus.
- Ran the fixed ten-question Query corpus with the supported reranker and recorded page/source grounding separately from lexical fact matching.
- Confirmed field-frame and strict validation stability: zero structural, structured-validation, or semantic-validation retries.
- Isolated two provider/gateway deadline chains at approximately 300 seconds; both recovered, while bootstrap completed on attempt zero.
- Identified deterministic page overproduction: typed evidence received create authority before page eligibility, producing standalone pages for source-local commands, parameters, and generic protocol mentions.

Evidence:

- `evidence/soft-target-reinit-1784986241654.json`
- `evidence/domain-quality-soft-target-1784986241654.json`
- `evidence/os-unix-query-quality-soft-target-1784986241654.json`
- `evidence/os-unix-query-grounding-soft-target-1784986241654.json`
- `evidence/os-unix-query-events-soft-target-1784986241654.jsonl`

## Evidence-Containment Page Eligibility Action

- Redacted plugin-managed top-level source metadata (`wiki_*` and `OutgoingLinks`) before evidence mapping while preserving line numbers and source-global range coordinates.
- Separated canonical path authority from standalone-page eligibility. Existing canonical targets and non-contained independent entities remain actionable; source-contained fragments become supporting evidence by default.
- Treated previous `wiki_articles` values as bounded, canonicalized reuse hints. History may promote only the strongest contained candidates up to the configured soft target.
- Preserved facts, exact source, ranges, packet IDs, links, and nested consolidated keys when supporting evidence is merged into an eligible parent.
- Kept the mechanism domain-neutral: no OS-specific entity types, command lists, or taxonomy defaults were added.
- Updated EN/RU/ES setting descriptions to explain containment, bounded history reuse, and soft-target behavior.

Changed paths for this action:

- `src/ingest-context.ts`
- `src/phases/ingest-evidence.ts`
- `src/phases/ingest.ts`
- `src/i18n.ts`
- `tests/ingest-context.test.ts`
- `tests/ingest-evidence.test.ts`

Delivery state:

- Production build SHA-256: `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`.
- Test vault still contains previous SHA-256 `fd9c50f4aa09fc9bc96048595a2dd9f6bde9d11ebb10b8bb9e54bd4d2e5939b8`.
- External test-vault write was denied by the execution policy, so the latest Obsidian restart loaded the previous bundle and did not start a new live variant.

## Evidence-Containment Live Replay Action

- Delivered and loaded bundle SHA-256 `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`.
- Ran force reinit session `1785000201763` against the 22-source `os-unix` test corpus.
- Captured session, page-quality, ten-query, and answer-grounding artifacts under `evidence/`.
- Manually reviewed the five highest-risk Query answers against source notes.

Evidence artifacts:

- `evidence/evidence-containment-reinit-1785000201763.json`
- `evidence/domain-quality-evidence-containment-1785000201763.json`
- `evidence/os-unix-query-quality-evidence-containment-1785000201763.json`
- `evidence/os-unix-query-events-evidence-containment-1785000201763.jsonl`
- `evidence/os-unix-query-grounding-evidence-containment-1785000201763.json`

## Source-Primary Standalone Eligibility Action

- Added a domain-neutral bounded planner mode to `consolidateSmallEntityBundles`.
- Protected all existing canonical targets and one deterministic source-primary coverage carrier.
- Derived source-title affinity from canonical source basename and mapper entity keys; compact matching handles identities such as `Fail2Ban` and `fail2ban`.
- Ranked remaining standalone candidates by prior reuse hints, containment independence, evidence strength, and stable source order.
- Consolidated non-selected candidates into a strict containing eligible parent or the source-primary carrier while preserving facts, exact source, ranges, packet IDs, links, and nested keys.
- Strengthened synthesis instructions to render consolidated entities as named subsections and preserve supplied technical literals exactly.
- Updated EN/RU/ES settings text; no domain taxonomy or path choice moved to the model.

Changed paths:

- `src/ingest-context.ts`
- `src/phases/ingest.ts`
- `src/i18n.ts`
- `prompts/ingest-synthesis.md`
- `tests/ingest-context.test.ts`
- `tests/ingest-bounded.test.ts`

Built bundle SHA-256: `6e3219c654d1319884ffcbad7e1931b39cba498d8633b457fb474a2de1787b69`.

Delivery to `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run` was blocked by the execution approval boundary; the vault still contains bundle `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`.

## Query Exact Technical Grounding Action

- Added a Markdown-aware technical-unit validator for fenced code, inline code, URLs, IPv4 addresses, UUIDs, paths, assignments, flags, versions, and numbers.
- Compared units against the exact final packed Query context, including article ID, heading, and body.
- Added numeric token boundaries, CRLF/NFC normalization, code-comment exclusion, and Markdown list-ordinal exclusion.
- Added one fresh non-stream framed repair when answer repair is enabled. The repair receives bounded diagnostics and the selected context only.
- Added fail-closed localized output when repair is disabled, fails, or remains unsupported.
- Required later WikiLink repair candidates to pass technical grounding before replacement.
- Compacted the fixed Query prompt by removing redundant command and unrelated table examples; the highest-ranked chunk remains selectable at the existing tight-budget parity gate.
- Reused the existing WikiLink repair setting as a repair permission: `0` validates without an LLM repair, any value above `0` permits at most one Query technical repair.

Changed paths:

- `src/phases/query-grounding-validator.ts`
- `src/phases/query-answer.ts`
- `src/i18n.ts`
- `prompts/query.md`
- `tests/query-grounding-validator.test.ts`
- `tests/query-budget.test.ts`

Documentation:

- Added iwiki page `architecture/query-exact-technical-grounding` and linked it from Query WikiLink validation.
- `wiki_lint` reports zero broken links, missing sources, or legacy WikiLinks. Pre-existing stale and advisory records remain.

Delivery state:

- Production bundle SHA-256: `70a59d056f2ce5ed01aeae8bcc482b44f5e2a260fc2927dec9a4668b6c36538c`.
- Test-vault bundle remains `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`.
- Copy was rejected by the external write approval boundary, so the current Obsidian restart cannot exercise this action.

## Query Deterministic Grounding Sanitation Action

- Ran the completed source-primary domain through the fixed ten-question Query corpus and isolated the cost regression in the grounding repair tail.
- Added deterministic Markdown-aware sanitation before any model repair. Unsupported fenced code lines remain atomic; unsupported prose and inline-code spans are removed without deleting grounded content on the same line.
- Revalidated the complete sanitized answer against the exact selected context and retained one fresh model repair only when local sanitation cannot produce a non-empty grounded answer.
- Fixed false positives for slash-separated prose such as `SSD/HDD` and Markdown heading ordinals such as `### 1.`.
- Added separate `SanitizeGrounding` telemetry and changed evaluation retry counts to include only actual `RepairGrounding` model calls.

Changed paths:

- `src/phases/query-grounding-validator.ts`
- `src/phases/query-answer.ts`
- `tests/query-grounding-validator.test.ts`
- `tests/query-budget.test.ts`
- `scripts/loen-dynamic-budget-routing/eval-domain-queries.ts`

Evidence:

- `evidence/os-unix-query-quality-grounding-source-primary-1785007822375.json`
- `evidence/os-unix-query-quality-deterministic-sanitize-1785007822375.json`
- `evidence/os-unix-query-quality-deterministic-span-sanitize-1785007822375.json`
- `evidence/os-unix-query-quality-deterministic-span-sanitize-events-1785007822375.jsonl`
- `evidence/os-unix-query-quality-deterministic-span-sanitize-npm-check-1785007822375.json`

Production bundle SHA-256: `5d310141f3b3f76ce32ed6343948ce07220feec84bb5505491111055679c8c15`.

## Synthesis Exact Technical Evidence Ledger Action

- Added a server-owned, domain-neutral ledger extracted from complete fenced source segments and exact source URLs before mapper synthesis.
- Assigned every item after entity consolidation by greatest exact-range overlap, with deterministic source-primary fallback.
- Added required `mustPreserveTechnicalEvidence` prompt input and metadata-only token/count telemetry; ledger content is not subject to the 192-character `exactSource` limit or optional context repacking.
- Added two local reconciliation passes around WikiLink cleanup. Unsupported model-authored fenced lines and URLs are removed; missing source segments are appended before `Sources` without another LLM call.
- Added a source-wide pre-write coverage gate. A synthesis `SKIP` now fails closed when technical evidence has no existing or prepared representation.
- Required multi-line source segments to remain contiguous and ordered, rejected reserved field-frame markers, and preserved pre-existing target code and URLs.
- Fixed a regression found by the full ingest suite: raw-regex `\\t` treated the letter `t` as whitespace and corrupted `https`; corrected escapes and added regression coverage.
- Measured 22 os-unix sources: 288 ledger items, 27,865 Markdown characters, about 6,974 content tokens total. Largest source, `Fail2Ban.md`, contributes about 3,446 content tokens, below the configured 65,536 input ceiling.

Changed paths:

- `src/phases/synthesis-evidence-ledger.ts`
- `src/phases/ingest-synthesis.ts`
- `src/phases/ingest.ts`
- `src/types.ts`
- `prompts/ingest-synthesis.md`
- `tests/synthesis-evidence-ledger.test.ts`
- `tests/ingest-synthesis.test.ts`
- `tests/ingest-bounded.test.ts`

Action checks:

- `tests/synthesis-evidence-ledger.test.ts`: 6/6 passed.
- `tests/ingest-synthesis.test.ts`: 58/58 passed.
- `tests/ingest-bounded.test.ts`: 48/48 passed.
- `npx tsc --noEmit`: passed during integration.
- `git diff --check`: passed.

Live delivery state:

- Candidate bundle SHA-256: `8fa8190a3826a8f243a828b7ceca5b244a94d7e5313eaacb8dba1b9c466f4bb3`.
- Automated copy into `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run` was rejected by the external-write approval boundary.
- The running test vault still has the previous installed bundle until the user copies `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` and restarts Obsidian.

## Same-Target Canonical Bundle Repair Action

- Replayed session `1785040016216` through the failing `user.md` source and traced the strict-path rejection to two independent synthesis actions for one server-resolved existing page.
- Added deterministic pre-synthesis consolidation for entity bundles whose alias resolution produces the exact same canonical target path.
- Selected one carrier by source-primary preference, evidence strength, first evidence line, then code-point entity key order.
- Preserved packet IDs, facts, exact ranges/source text, links, required context, duplicate paths, and replace authorities in the carrier.
- Kept the final duplicate-action-path validator unchanged so unrelated collisions still fail closed.
- Added visible init progress before and after the awaited Retry/Skip/Stop file-error decision; this distinguishes a user-decision wait from a lost async operation.
- Kept mapper and synthesis token ceilings unchanged. The only observed HTTP `502` recovered on one retry and produced 1,902 output tokens, so it does not justify a lower or higher cap.

Changed paths:

- `src/ingest-context.ts`
- `src/phases/ingest.ts`
- `src/phases/init.ts`
- `src/i18n.ts`
- `tests/ingest-context.test.ts`
- `tests/ingest-bounded.test.ts`
- `tests/init-ingest-outcome.test.ts`

Candidate bundle SHA-256: `e480ef6886565a331c371a2077e73c408a066c19f180d84b5cf2c3d4d853d25c`.

Delivery remains blocked by the external-write approval boundary. The test vault still contains `8fa8190a3826a8f243a828b7ceca5b244a94d7e5313eaacb8dba1b9c466f4bb3`.

## Same-Target Live Replay and Quality Audit Action

- Monitored force-reinit session `1785045313209` through terminal completion.
- Captured session metrics, page integrity, source/domain quality, and ten fixed Query cases.
- Traced remaining Query losses to two upstream boundaries: missing source technical evidence in generated pages and one-section-per-page context selection.
- Reproduced the largest source loss locally: `AMD Driver.md` exposed only three fenced code items because list-indented fences were outside the ledger parser's `0-3` space boundary.

Evidence:

- `evidence/same-target-replay-1785045313209.json`
- `evidence/domain-quality-same-target-1785045313209.json`
- `evidence/os-unix-query-quality-same-target-1785045313209.json`
- `evidence/os-unix-query-quality-same-target-events-1785045313209.jsonl`

## Markdown Technical Evidence Boundary Action

- Extended deterministic fence parsing to Markdown list and blockquote containers without changing source-global ranges.
- Added conservative unfenced shell/config extraction based on syntax signals, not entity taxonomy or an OS command allowlist.
- Wrapped accepted unfenced runs in exact `text` fences and excluded claimed URLs from duplicate URL items.
- Rejected reserved field-frame markers across the complete source body.
- Updated the existing iwiki architecture page and ran `wiki_lint`.

Changed paths:

- `src/phases/synthesis-evidence-ledger.ts`
- `tests/synthesis-evidence-ledger.test.ts`
- `docs/loen/dynamic-llm-budget-routing/3_plan.md`

Static corpus result:

- ledger items: `288 -> 323`;
- static audit-snippet coverage: `522/537` (`97.21%`);
- largest source ledger: about `3,815` tokens;
- total ledger payload across 22 sources: about `8,118` tokens;
- no configured budget increase required.

Candidate bundle SHA-256: `fb49fae99b2b427077fba136282e580fd2d06117dc0cd4c62427eb40622d450c`.

## Server-Owned Article Lifecycle Metadata Action

- Captured one UTC operation date at ingest start and applied it to every prepared create and update.
- Removed model-authored `timestamp` and `status` before governed frontmatter assembly.
- Forced new pages to `status: stub`; updates preserve the persisted page status.
- Kept taxonomy, canonical routing, and optional non-governed metadata unchanged.
- Updated the existing iwiki frontmatter contract page.

Changed paths:

- `src/utils/raw-frontmatter.ts`
- `src/phases/ingest.ts`
- `tests/ingest-bounded.test.ts`
- `tests/init-force-domain-wipe.test.ts`
- `docs/loen/dynamic-llm-budget-routing/3_plan.md`

Candidate bundle SHA-256: `2c3fd9a575a6363adf4e249d82ef7e46808d40ff82ebae2a3eaec8a9e8a7a51e`.

## Source-Primary Carrier Coherence Action

- Ranked source-primary candidates by source-name affinity, then total exact evidence breadth before model-authored containment count.
- Routed every source-cap overflow bundle to the selected primary carrier in source-primary mode.
- Preserved existing-target independence and legacy/direct containing-parent planning.
- Added a regression reproducing a broad storage procedure competing with a narrow `du`/`blkid` range hierarchy.
- Updated the iwiki entity-routing contract.

Changed paths:

- `src/ingest-context.ts`
- `tests/ingest-context.test.ts`
- `docs/loen/dynamic-llm-budget-routing/3_plan.md`

Candidate bundle SHA-256: `0eaf407ccc2cf4f255f65ee8e37f95bcf77ad4d344fdf296b819449f29720913`.

## Query Article-Depth Context Packing Action

- Added one deterministic post-reranker selector shared by single- and cross-domain Query.
- Reserved `floor(contextTopN / 3)` slots for the best sibling chunks of selected article anchors; remaining slots preserve distinct article coverage.
- Preserved original reranker order in the returned list and global-order fallback when no sibling exists.
- Kept prompt-budget packing as the final whole-chunk bound.
- Updated hierarchical retrieval documentation.

Changed paths:

- `src/phases/query-budget.ts`
- `src/phases/query.ts`
- `src/phases/query-cross-domain.ts`
- `tests/query-budget.test.ts`
- `tests/query-parity.test.ts`
- `docs/loen/dynamic-llm-budget-routing/loop.yaml`
- `docs/loen/dynamic-llm-budget-routing/3_plan.md`

Candidate bundle SHA-256: `a402b51f73797fb225e848c00612f418641340bf8f99c2afe09b177127063312`.

Delivery state:

- test-vault `synthesisMaxEntityBatchSize`: `1`;
- test-vault `synthesisMaxEntitiesPerSource`: `5`;
- installed test-vault bundle remains `e480ef6886565a331c371a2077e73c408a066c19f180d84b5cf2c3d4d853d25c`;
- automated bundle copy was rejected by the external-write approval boundary, so candidate `a402b51f...` still requires user-side copy and Obsidian restart.

## Domain-Neutral Frame Repair and Query Candidate-Pool Action

- Classified synthesis-marker output without an action frame as an incomplete field-frame response instead of attempting legacy JSON parsing.
- Strengthened the synthesis protocol instruction to reject JSON objects and `response` wrappers while preserving real legacy JSON parsing.
- Rebuilt each structural repair from immutable base messages, preventing prior response and repair-history accumulation across attempts.
- Added optional `resultTopN` reranker output control; its default remains the configured final `contextTopN`.
- Requested the bounded retrieval candidate limit from both Query flows, then applied the existing shared six-anchor/two-sibling selector for `contextTopN: 8`.
- Added parser, multi-repair, enabled-reranker, and single/cross-domain parity regressions.
- Replayed the same ten fixed questions against the unchanged 83-page domain generated by session `1785057814992`.

Changed paths:

- `src/phases/framed-output.ts`
- `src/phases/structured-output.ts`
- `src/reranker.ts`
- `src/phases/query.ts`
- `src/phases/query-cross-domain.ts`
- `tests/framed-output.test.ts`
- `tests/structured-output.test.ts`
- `tests/reranker.test.ts`
- `tests/query-parity.test.ts`

Evidence:

- `evidence/generalized-quality-reinit-1785057814992.json`
- `evidence/domain-quality-generalized-quality-1785057814992.json`
- `evidence/os-unix-query-quality-article-depth-1785057814992.json`
- `evidence/os-unix-query-quality-candidate-pool-1785057814992.json`
- `evidence/os-unix-query-quality-candidate-pool-1785057814992-events.jsonl`

Measured result:

- fact coverage: `84.761% -> 95.237%`;
- retrieval hit rate: `100% -> 100%`;
- valid cited-link precision: `100% -> 100%`;
- model retries: `0 -> 0`;
- mean latency: `17.873 s -> 15.191 s`;
- input tokens: `29,172 -> 28,003`;
- selected context shape: eight distinct article chunks before the fix, then six article anchors plus two sibling chunks in every case.

No taxonomy, canonical route, alias, source-language rule, heading preference, command allowlist, or token ceiling changed.

Delivery state:

- candidate `dist/main.js` SHA-256: `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`;
- external-write policy rejected automated copy into the isolated test vault;
- installed test-vault `main.js` remains `a402b51f73797fb225e848c00612f418641340bf8f99c2afe09b177127063312`;
- `manifest.json` and `styles.css` already match the current build, but all three files should be copied together before restart.

## Domain-Neutral Stable Grounding and Wire Compatibility Action

- Accepted singular `exactSourceRange` only when `exactSourceRanges` is absent; ambiguous dual fields remain invalid.
- Preserved valid unique mapper packet IDs and deterministically replaced only missing or duplicate opaque IDs.
- Removed redundant full-path text from bounded reranker candidates and reserved 55% of the unchanged character cap for query-aware article content.
- Evaluated one-article anchor rescue and sibling ordering by retained reranker score, then removed both changes after live acceptance failure.
- Added up to four deterministic sanitation passes so removing one unsupported value cannot expose an unchecked path, number, or flag.
- Changed grounding repair input from the original answer/error set to the sanitized candidate and current residual errors.

Changed paths:

- `src/phases/ingest-evidence.ts`
- `src/reranker.ts`
- `src/phases/query-answer.ts`
- `tests/ingest-evidence.test.ts`
- `tests/reranker.test.ts`
- `tests/query-budget.test.ts`

Evidence:

- `evidence/os-unix-query-quality-reranker-content-v1.json`
- `evidence/os-unix-query-quality-anchor-rescue-v1.json`
- `evidence/os-unix-query-quality-sibling-scores-v1.json`
- `evidence/os-unix-query-quality-stable-sanitizer-v1.json`
- corresponding `.events.jsonl` files

Candidate bundle SHA-256: `96a4053266325123816a9200fa4fbba6683e93176b68a6011d1bce8a87213178`.

Delivery state:

- external test-vault write policy rejected automated copy;
- installed test-vault `main.js` remains `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`;
- test-vault `manifest.json` and `styles.css` already match the candidate build;
- user-side `main.js` copy and Obsidian reload are required before live acceptance.

## Guarded Conflict-Regeneration Format/Semantic Split Action

- Made the synthesis frame profile schema-generic so a caller can isolate wire-frame parsing from output validation.
- Ran guarded conflict regeneration through the shared retry runner with a parser-only `unknown` schema.
- Moved strict `SynthesisOutputSchema`, entity coverage, canonical path, page hash, section authority, and action-kind validation after the bounded frame retry runner.
- Preserved one fresh request plus at most one format repair. A schema- or domain-invalid parsed response now fails after one request without semantic repair.
- Preserved the zero-request guard for a second stale conflict and the no-transport-fallback policy.

Changed paths:

- `src/phases/framed-output.ts`
- `src/phases/ingest-synthesis.ts`
- `tests/ingest-synthesis.test.ts`

Candidate bundle SHA-256: `3227133ae43e4a3eab2edbecae4a1942b1665dac688485128f623da90192f1eb`.

## Guarded Conflict-Regeneration Live Bundle Replay Action

- Installed production bundle SHA-256 `3227133ae43e4a3eab2edbecae4a1942b1665dac688485128f623da90192f1eb` in the isolated test vault.
- Monitored Obsidian reinit session `1785096684125` from bootstrap through the terminal event.
- Ran the same fixed ten-query corpus against the regenerated domain with the effective vault model, transport, budgets, and retrieval settings.
- Audited final page integrity, source evidence preservation, WikiLink resolution, Query fact coverage, and exact technical grounding against the clean `Work` source vault.
- Compared request count, retries, tokens, and latency with prior session `1785087161419`.

Evidence:

- `evidence/conflict-validation-split-live-1785096684125.json`
- `evidence/conflict-validation-split-live-domain-quality-1785096684125.json`
- `evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json`
- `evidence/os-unix-query-quality-conflict-validation-split-live-events-1785096684125.jsonl`
- `evidence/os-unix-query-grounding-conflict-validation-split-live-1785096684125.json`
