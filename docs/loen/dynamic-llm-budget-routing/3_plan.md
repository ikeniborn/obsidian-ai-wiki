# Dynamic LLM Budget Routing Plan

## Mode

LoEn research loop.

## Plan

1. Capture baseline settings and recent session metrics.
2. Prepare a repeatable variant runner around the test vault settings and `agent.jsonl`.
3. Run variants A-D by changing only test vault settings and asking Obsidian/reinit to use those settings.
4. Parse logs after each run into `evidence/<variant>.json`.
5. Compare metrics in `5_check.md`.
6. Select recommended pipeline in `6_reflect.md` and final result in `7_result.md`.

## Measurement Commands

```bash
node scripts/loen-dynamic-budget-routing/analyze-agent-session.mjs <session-id>
node scripts/loen-dynamic-budget-routing/set-vault-variant.mjs <variant>
```

## Quality Gates

- Every variant must record exact settings used.
- Every variant must record exact session id.
- No variant may weaken schema/domain validation.
- Stop early only if two consecutive variants are blocked by the same external condition.

## Evidence-Containment Page Eligibility Pass

### Failure Contract

- Session `1784986241654` completed all 22 sources but expanded the domain from 72 to 136 pages.
- Every typed mapper entity received a canonical create path before semantic ownership was evaluated, so one-line commands, generic protocols, and nested configuration details became standalone pages.
- Query recall improved, but source grounding, technical-value preservation, duration, and cost regressed.

### Design Contract

- Existing canonical targets always remain independent.
- Source-range containment may classify a new candidate as supporting evidence for a broader candidate; entity names and domain taxonomy do not participate in this decision.
- Prior source `wiki_articles` are weak reuse hints. They may promote contained candidates only up to the configured soft target.
- Independent candidates are never merged only to satisfy the target.
- Consolidation preserves facts, exact source, ranges, packet IDs, and links.

### Bounded Steps

1. Add red tests for contained supporting candidates, weak source-history promotion, target capacity, and existing-target authority.
2. Implement deterministic eligibility and parent assignment in `ingest-context`.
3. Pass source-history identities from ingest without exposing path choice to the model.
4. Run focused tests, full verification, update iwiki, build, and deliver one replay bundle.

### Verification Commands

```bash
node --import tsx --test tests/ingest-context.test.ts tests/ingest-bounded.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

### Live Acceptance

- 22/22 sources complete with strict validation.
- Page count and synthesis calls fall materially below session `1784986241654` without returning to unrelated hard-cap merges.
- No standalone page is created only from evidence wholly owned by a broader unpromoted candidate.
- Ten-query source grounding recovers to at least the configured-profile baseline while expected-page recall does not regress below it.

## Source-Primary Standalone Eligibility Pass

### Failure Contract

- Session `1785000201763` completed 22/22 sources, but still created 122 pages through 135 synthesis calls.
- Strict containment removed nested fragments but left every non-contained mapper candidate eligible for a new page; command names, protocol labels, and narrow configuration blocks therefore remained standalone articles.
- Ten-query execution required no retry and emitted only valid WikiLinks, yet technical grounding fell to 74.31%. Manual review found source-absent commands, placeholder UUIDs, altered mount options, regexes, and numeric settings.

### Design Contract

- Existing canonical targets always remain independent and cannot be consolidated.
- Each source gets one deterministic primary coverage carrier selected from model-extracted candidates using source-title affinity, evidence breadth, and evidence strength.
- The configured per-source value limits standalone synthesis actions; it does not discard evidence or choose entity type/path.
- Additional new pages are ranked by prior canonical reuse hints and evidence strength until capacity is reached.
- Non-selected candidates become named supporting evidence in the source-primary carrier, or in a strict containing eligible parent when one exists.
- No domain-specific taxonomy, command list, or OS type is hardcoded.

### Bounded Steps

1. Add red tests for non-contained overflow, source-primary preference, existing-target protection, and complete child-evidence preservation.
2. Implement deterministic source-primary selection and bounded standalone eligibility in `ingest-context`.
3. Derive source-title affinity in ingest and pass it as server-owned planning data.
4. Update settings text to describe the value as a maximum standalone-page target rather than a soft no-op limit.
5. Run focused and full verification, update iwiki, build, and deliver one replay bundle.

### Verification Commands

```bash
node --import tsx --test tests/ingest-context.test.ts tests/ingest-bounded.test.ts tests/settings-model-controls.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

### Live Acceptance

- 22/22 sources complete with strict validation and zero canonical routing failures.
- New-page actions are bounded while existing-target patches remain protected.
- Page count and synthesis calls fall below session `1785000201763` without evidence-bearing zero-effect sources.
- Technical preservation does not regress; query technical grounding is measured separately before adding the exact-grounding gate.

## Query Exact Technical Grounding Pass

### Failure Contract

- All ten Query calls in session `1785000201763` completed without retry and produced valid WikiLinks, but only 74.31% of sampled technical units were exact page/source evidence.
- Manual review found executable or safety-sensitive inventions: altered NFS export flags, new Fail2Ban regexes and jail values, GitLab package commands, UFW examples, and placeholder storage UUIDs/options.
- Link validation cannot detect this class because every citation may resolve while the cited page does not support the command or value.

### Design Contract

- Query prompt explicitly requires exact copying of commands, configuration lines, URLs, paths, identifiers, addresses, UUIDs, and numeric settings from selected chunks.
- Local validation compares technical units only with the final packed chunks actually sent to the model.
- Natural-language paraphrase remains allowed; executable/configuration literals do not.
- One fresh compact structured repair may remove or correct unsupported units. The repair receives selected context, exact failure kinds, the question, and the candidate answer.
- If repair still contains unsupported technical units, replace the answer with a localized insufficient-evidence response. Never return unsafe content merely because retries are disabled or exhausted.

### Bounded Steps

1. Add pure red tests for fenced code, inline code, URLs, paths, IP/UUID, numeric settings, comments, CRLF, and exact selected-context matching.
2. Add Query integration tests for successful local acceptance, one repair, and fail-closed replacement.
3. Implement the smallest code-aware technical-unit extractor and validator.
4. Add one bounded repair after answer generation and before final acceptance; preserve existing WikiLink validation.
5. Run focused/full checks, update iwiki, build, and deliver one combined replay/query bundle.

### Verification Commands

```bash
node --import tsx --test tests/query-grounding-validator.test.ts tests/query-budget.test.ts tests/query-link-validator.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

### Acceptance

- Unsupported commands/configuration/technical literals cannot reach the final returned answer.
- A fully grounded answer adds no LLM call.
- A repair uses at most one additional logical call and fresh messages.
- Existing WikiLink code masking and citation closure remain unchanged.

## Query Deterministic Grounding Sanitation Pass

### Failure Contract

- Combined replay session `1785007822375` completed 22/22 sources with zero transport retry, but the ten-query run required seven extra grounding calls and returned three fail-closed answers.
- Exact Query source grounding improved from 74.31% to 91.67%, while mean required-fact coverage fell from 79.81% to 55.14% and total Query tokens more than doubled.
- The first candidate answers covered 85.48% of required facts. Post-validation lost 30.34 percentage points because one repair exceeded the 16,384-token Query input budget and two provider responses contained reasoning without a final frame.
- Path extraction also classified prose such as `SSD/HDD` as the absolute path `/HDD`.

### Design Contract

- Keep exact selected-context validation and fail-closed behavior; unsupported technical content must never reach the final answer.
- Path extraction requires a real token boundary and must not classify slash-separated prose terms as filesystem paths.
- Before any model repair, remove unsupported technical lines locally while preserving grounded lines and valid Markdown fences. Revalidate the complete sanitized answer.
- A locally sanitized, non-empty answer is accepted without another LLM call. One fresh LLM repair remains only as a fallback when deterministic sanitation cannot produce a valid answer.
- Emit distinct local-sanitation and actual-model-repair events so evaluation does not hide repair cost or classify local checking as an LLM retry.

### Bounded Steps

1. Add red extractor and sanitizer tests for slash-separated prose, mixed grounded/unsupported code blocks, prose lines, CRLF fences, and empty-fence cleanup.
2. Add Query integration tests proving unsupported lines are removed locally with one total model call and that an unresolved sanitation result still follows the bounded repair/fail-closed path.
3. Implement the smallest Markdown-aware deterministic sanitizer and run it before the existing structured repair.
4. Update Query evaluation telemetry to count actual grounding model repairs separately from local sanitation.
5. Run focused/full checks and repeat the fixed ten-query corpus against the existing domain without another reinit.

### Verification Commands

```bash
node --import tsx --test tests/query-grounding-validator.test.ts tests/query-budget.test.ts tests/query-link-validator.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

### Live Acceptance

- Final technical grounding remains 100% against selected pages and no invalid WikiLink is returned.
- The ten-query corpus has zero transport/structural failures and zero reasoning-only repair dependency on the common path.
- Mean required-fact coverage recovers above the previous 79.81% baseline.
- Grounding repair LLM calls and Query token use fall materially below session `1785007822375`.

## Terminal Condition

The loop completes when one variant is recommended with evidence, or handoff states why live experiments are blocked.

## Synthesis Exact Technical Evidence Ledger Pass

### Failure Contract

- Source-primary session `1785007822375` reduced page count and call cost, but preserved only 323/537 technical snippets, 17/21 URLs, and 19/43 technical values.
- `evidenceDto` truncates every `exactSource` text to 192 characters, and prompt repacking may drop additional exact-source entries. The synthesis model therefore cannot see many later commands, UUIDs, configuration lines, or source URLs.
- Strict Query grounding correctly removes source facts that are absent from generated pages. Weakening Query validation would reintroduce unsupported instructions.

### Design Contract

- Build a server-owned, domain-neutral ledger directly from source Markdown, independent of mapper facts: complete fenced technical segments plus exact source URLs.
- Assign each ledger item to the retained bundle with greatest exact-range overlap. Unclaimed items go to the deterministic source-primary carrier.
- Send assigned ledger items as required synthesis input without the 192-character `exactSource` truncation. Keep batch size, canonical routing, and configured budgets unchanged.
- After all create/patch conflict handling, reconcile the complete prepared page locally: remove model-authored fenced lines and URLs absent from assigned source evidence or the pre-existing target; append any still-missing source ledger items before the managed `Sources` section.
- Fail the source before writes when ledger evidence has no persisted target. Never schedule an LLM repair for ledger reconciliation.
- Reject reserved field-frame markers in source ledger content. Do not add domain-specific commands, entity types, or taxonomy.

### Bounded Steps

1. Add red unit tests for frontmatter exclusion, CRLF/backtick/tilde fences, segment ranges, URL extraction, overlap assignment, source-primary fallback, unsupported code/URL sanitation, deterministic append, and idempotence.
2. Add synthesis prompt/telemetry tests proving full ledger content survives exact-source truncation and remains required during optional context repacking.
3. Integrate ledger extraction, assignment, prompt rendering, final reconciliation, coverage gate, and metadata-only telemetry into ingest.
4. Run focused and full checks, typecheck, lint, build, and diff validation.
5. Deliver one bundle and run one clean 22-source reinit; rerun domain-quality audit and the fixed ten Query cases.

### Verification Commands

```bash
node --import tsx --test tests/synthesis-evidence-ledger.test.ts tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts
node --import tsx --test tests/*.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

### Live Acceptance

- 22/22 sources finish with zero unrepresented ledger item and zero unsupported generated URL.
- Technical snippet, URL, and technical-value preservation improve over 60.15%, 80.95%, and 44.19% without increasing page count above 85.
- Ledger reconciliation adds zero model call and no structural/domain retry.
- Query keeps zero unsupported final technical units; fact coverage recovers because source commands are present in canonical pages.

## Markdown Technical Evidence Boundary Pass

### Failure Contract

- Session `1785045313209` completed 22/22 sources without transport or structured retries, but the domain audit preserved only 490/537 sampled technical snippets.
- The ledger accepted only fences indented by at most three spaces. Valid fenced blocks nested under Markdown lists therefore disappeared from server-owned evidence; `AMD Driver.md` exposed only 3 code items instead of its complete command set.
- Shell-style source notes such as `npm.md` contain executable lines without fences. The synthesis model omitted those lines, and strict Query sanitation then removed unsupported commands from otherwise relevant answers.

### Design Contract

- Recognize fenced technical blocks at any Markdown container indentation while retaining exact source-global line ranges and reserved-marker rejection.
- Conservatively recognize unfenced command/configuration lines from syntax signals such as flags, paths, assignments, redirects, pipes, URLs, variables, versions, and numeric arguments. Do not use domain names, entity types, or an OS command allowlist.
- Render accepted unfenced lines as exact `text` fences and keep them under the existing required ledger assignment, reconciliation, and coverage gates.
- Do not classify Markdown headings, list prose, blockquotes, tables, or ordinary sentences as executable evidence.

### Bounded Steps

1. Add red tests for list-indented backtick/tilde fences, unfenced shell/config lines, ordinary prose exclusion, and idempotent reconciliation.
2. Extend only the deterministic ledger extractor and existing telemetry counts.
3. Run focused tests, the configured LoEn verifier, full tests, typecheck, lint, build, and diff validation.
4. Re-audit the 22 source files statically before delivering the next replay bundle.

### Live Acceptance

- All nested fenced segments and conservatively detected unfenced technical lines receive a persisted carrier.
- Technical snippet/value preservation improves without unsupported generated URLs or another model call.
- Prompt size remains below configured source-ingest input ceilings.

## Server-Owned Article Lifecycle Metadata Pass

### Failure Contract

- The clean replay generated 89 structurally valid pages, but every page retained a model-selected historical timestamp and zero pages used the actual ingest date.
- Created-page `status` is also accepted from model frontmatter even though one-source creation has a deterministic server answer: `stub`.
- Prompt rules cannot make lifecycle metadata authoritative; temperature/model changes can silently rewrite it.

### Design Contract

- Capture one UTC ingest date per source operation and govern `timestamp` on every prepared create or update.
- Govern created-page `status` as `stub`; existing-page updates retain their current status because section patches do not own page maturity.
- Keep model ownership of optional descriptive metadata such as aliases and tags, subject to existing guards.
- Preserve existing YAML repair, type/path, resource, and provenance behavior.

### Bounded Steps

1. Add a red ingest integration assertion proving stale model timestamp and mature create status cannot persist.
2. Extend the existing frontmatter governor with explicit timestamp/status fields and pass the operation date from ingest.
3. Run focused/full checks, update iwiki, build, and diff validation.

### Live Acceptance

- Every page created or updated by a force-reinit uses the run date.
- Every newly created one-source page has status `stub` regardless of model output.
- No frontmatter/YAML integrity regression occurs.

## Source-Primary Carrier Coherence Pass

### Failure Contract

- Session `1785045313209` met the six-page source target but routed `blkid` into `du`, `head` into `sort`, and several user-management commands into `sudo`/`sudoers`.
- Without source-name affinity, primary ranking prefers the count of model-authored containing ranges before total evidence breadth; a narrow command packet can therefore become the source carrier.
- Capacity overflow then prefers any eligible containing sibling before the selected source-primary carrier, spreading one source's supporting evidence across semantically weak command pages.

### Design Contract

- Source-name affinity remains the first primary signal; without it, total exact evidence breadth precedes contained-child count and fact strength.
- Existing canonical targets remain independent synthesis owners.
- Every non-selected candidate in source-primary mode contributes to the one selected source carrier. Strict containment remains available to legacy/direct planning without source-primary mode.
- Page target, batch size, taxonomy, paths, and evidence-preservation rules remain unchanged.

### Bounded Steps

1. Add red planner tests for narrow-containing-primary bias and containing-sibling overflow.
2. Reorder domain-neutral primary ranking and route source-cap overflow to the primary carrier.
3. Run focused/full checks, update iwiki, build, and record candidate evidence.

### Live Acceptance

- Storage and user-management overflow is reported under one coherent source-primary carrier, not arbitrary command siblings.
- Existing targets remain separate and all child facts, ranges, source text, packet IDs, and links survive.
- The next replay evaluates page target `5` as a test-vault setting; no code default is changed without comparative evidence.

## Query Article-Depth Context Packing Pass

### Failure Contract

- The ten-query audit retrieved the correct AMD, UFW, storage, and npm articles, but commonly selected one section from each of eight pages.
- Single- and cross-domain Query both truncate the global post-reranker list with `slice(0, contextTopN)`.
- Commands and exact settings in sibling `Examples` or configuration sections are therefore absent before deterministic grounding, so valid answer content is removed or the answer fails closed.

### Design Contract

- Keep post-reranker order authoritative and preserve the highest-ranked chunk from each selected article anchor.
- For limits above one, reserve at most one third of context slots for the highest-ranked sibling chunks belonging to those anchors; use remaining slots for distinct article anchors.
- If anchors have no siblings, fill all remaining slots from global reranker order.
- Apply the same helper to single- and cross-domain Query. Input token budget packing remains the final bound and may omit tail chunks without reordering.

### Bounded Steps

1. Add red unit tests for sibling reservation, no-sibling fallback, one-slot behavior, stable reranker order, and invalid limits.
2. Replace raw context slicing in both Query flows with one shared deterministic selector.
3. Add parity/integration evidence, run focused/full checks, update iwiki, build, and deliver the combined replay candidate.

### Live Acceptance

- `contextTopN: 8` retains up to six article anchors and uses up to two slots for their best siblings.
- Correct technical sibling sections reach Query grounding without increasing `contextTopN`, input budget, retries, or model calls.
- Ten-query expected-page recall and unsupported-unit rejection do not regress; mean fact coverage improves over `73.524%`.

## Rollback

Restore baseline test vault `data.json` from `evidence/baseline-data.json` after experiments.

## Pre-0.1.200 Transport Regression Pass

1. Compare release `0.1.199`, `0.1.200`, `0.1.204`, current `master`, and the working-tree transport path.
2. Run the same bootstrap-like non-stream request in standalone Electron through:
   - OpenAI SDK default fetch;
   - OpenAI SDK with direct `undici.fetch`;
   - current `createNativeOpenAiFetch` wrapper;
   - current wrapper with body observation bypassed, if the exact wrapper reproduces the stall.
3. Repeat each relevant variant enough times to distinguish a deterministic wrapper failure from an intermittent endpoint failure.
4. Correlate A/B results with `agent.jsonl` stages and select the smallest causal surface.

Measurement commands are temporary local Electron probes. They must not print the API key or persist it in generated artifacts.

## Buffered Desktop Non-Stream Repair Pass

### Design Contract

- Desktop, no proxy, diagnostic mode off, non-stream request: use the injected Obsidian host fetch. In production this is `mobileFetch`, backed by `requestUrl`, and it returns a `Response` only after body text is buffered.
- Desktop true streaming request: use the existing pooled direct undici fetch so SSE remains incremental.
- Mobile: keep host fetch for all requests.
- Proxy: keep proxy fetch for all requests.
- Explicit diagnostic modes: keep their selected direct transport for all requests.
- Report client-level route as `desktop-hybrid`; report each request as `desktop-host` or `desktop-direct`.
- Keep the existing bootstrap fresh/settle policy during this first A/B pass so transport routing is the only live variable.

### Bounded Steps

1. Add failing routing and telemetry tests for desktop host non-stream plus direct streaming.
2. Implement hybrid routing and exact per-request transport metadata.
3. Run focused transport, executor, and bootstrap tests.
4. Run lint and production build.
5. Update native transport architecture documentation through iwiki MCP.
6. Copy the built bundle to the test vault and verify SHA-256 equality.
7. Start a fresh os-unix reinit after manual Obsidian restart and monitor bootstrap-map/bootstrap traces.

### Verification Commands

```bash
node --import tsx --test tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts
node --import tsx --test tests/init-bootstrap-fail-loud.test.ts
npm run lint
npm run build
```

### Live Acceptance

- `run_config.nativeTransport.transport = desktop-hybrid` and diagnostic mode is off.
- `init.bootstrap-map` and `init.bootstrap` trace `networkTransport = desktop-host`.
- Both calls reach `body_end` and `sdk_complete` on attempt 0.
- No `transport_retry_scheduled` occurs before first source processing.
- Repeat once from another clean restart before removing the old bootstrap settle/fresh workaround.

## Bounded Ingest Contract Repair Pass

### Design Contract

- Article Markdown uses an explicit content boundary; reserved protocol markers are never persisted.
- Existing canonical pages are reused through unique article-id, title, or alias identity. Retrieval rank alone never selects an update target.
- Create calls receive evidence and descriptions only. Update calls receive only the exact canonical target body.
- Empty responses that consume the requested output cap are classified as `output_limit` and retried from fresh compact messages with a bounded dynamic ceiling.
- Evidence mapper repairs receive a concrete, safe validation reason.
- Small entities are merged into deterministic parent evidence before synthesis; facts are not silently dropped.

### Bounded Steps

1. Add failing parser and schema tests for explicit content boundaries and reserved markers.
2. Add failing ingest tests for alias reuse and create/update context isolation.
3. Add failing structured-output tests for output-cap classification and compact ceiling retry.
4. Add failing mapper tests for concrete validation feedback.
5. Add failing consolidation tests proving small-entity facts reach a parent bundle.
6. Implement the smallest production changes needed to pass those tests.
7. Run focused tests, full lint/build, update iwiki, and copy the verified bundle to the test vault.

### Verification Commands

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts
node --import tsx --test tests/ingest-evidence.test.ts tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts
node --import tsx --test tests/model-call-policy.test.ts tests/settings-model-controls.test.ts
npm run lint
npm run build
```

### Live Acceptance

- No persisted article contains a line matching `^<<<[A-Z][A-Z0-9_]*>>>$`.
- Alias-equivalent entities patch one existing canonical path and do not create duplicates.
- Create synthesis prompts contain no page bodies; update prompts contain only their target page body.
- Output-cap events are `output_limit`; retry messages contain no empty assistant turn and respect the configured ceiling.
- Mapper repair prompts include the validator reason category.
- Capped small entities are reported as consolidated and their facts appear in parent synthesis evidence.

## Live Field-Frame Repair Budget Pass

### Failure Contract

- Replay session `1784869572887` completed bootstrap and the first source, then stopped on source 2.
- The provider returned HTTP 200 with a complete body, but synthesis used `## CREATE` instead of the exact `<<<CREATE>>>` marker.
- Local validation correctly rejected the response; its repair request required 16,973 estimated input tokens while the active init input budget was 16,384.
- The configured 65,536 repair input ceiling was lost when ingest converted call options into its internal model policy.

### Bounded Steps

1. Add a parser regression for Markdown headings used in place of exact field-frame markers.
2. Add an end-to-end ingest regression proving a field-frame repair uses the dedicated repair input budget and fresh messages.
3. Preserve the repair input ceiling in ingest policy conversion and apply it only after an invalid response.
4. Make synthesis frame repairs compact and fresh; never replay invalid assistant output.
5. Strengthen synthesis instructions with the exact `<<<...>>>` versus `## ...` distinction.
6. Run focused tests, full verification, update iwiki, rebuild, and deliver a new test-vault bundle.

### Live Acceptance

- A malformed field-frame response schedules a request instead of failing local budget preflight.
- Repair message history contains no assistant output.
- Retry prompt names the missing exact marker and forbids Markdown-heading substitutes.
- Reinit progresses beyond source 2 with no frame repair budget failure.

## Init-to-Ingest Policy Routing Pass

### Failure Contract

- Session `1784893122317` completed bootstrap without transport retries, then applied the `init` limits (`16384` input / `4096` output) to every source ingest.
- The configured `ingest` limits (`65536` input / `16384` output) were never used by child source processing.
- `AMD Driver.md` therefore changed from one mapper chunk in successful session `1784840143468` to 19 chunks, reached 51 requests and 20 structural failures after two completed files, then stopped on conflicting per-chunk entity types.

### Bounded Steps

1. Add a regression proving an init run resolves separate bootstrap and child-ingest model policies.
2. Pass the ingest runtime from `AgentRunner` into full and incremental init orchestration.
3. Keep direct `runInit*` callers backward compatible by falling back to the parent runtime when no child runtime is supplied.
4. Run focused and full verification, update iwiki, build, and deliver the test bundle.

### Live Acceptance

- Bootstrap calls use the configured `init` model and budgets.
- `ingest.evidence-map` and `ingest.synthesize` calls use the configured `ingest` model and budgets.
- With the current test settings, `AMD Driver.md` is planned as one mapper chunk instead of 19.
- Transport retry count remains zero; validation remains strict.

## Query Empty-SSE Compact Repack Pass

### Failure Contract

- Query session `1784923289519` sent four OpenAI-compatible streaming requests for the same prepared payload.
- Every attempt received HTTP `200` SSE headers, but all four produced zero body bytes and zero model events.
- Attempts 0-2 reached the derived 150-second response-start deadline; attempt 3 was cancelled by the 600-second operation watchdog after 141.8 seconds.
- Every retry used a new client request id, provider request id, and fresh connection, so repeating the identical payload consumed the full operation budget without changing the failure condition.

### Bounded Steps

1. Add a transport regression proving Query can delegate the first `response_start_timeout` to its prompt planner while preserving the derived 150-second deadline.
2. Add a Query regression proving delegated empty-SSE failure reduces optional context, keeps the question and complete chunks, and uses a fresh connection.
3. Extend context-repack telemetry with `response_start_timeout` and emit safe request fingerprints for Query attempts.
4. Keep ordinary connection/HTTP retry behavior unchanged and do not repack after meaningful stream output.
5. Run focused and full verification, update iwiki, build, and deliver the replacement test-vault bundle.

### Live Acceptance

- Query no longer sends four identical payloads after accepted empty SSE.
- First empty-SSE failure occurs near the derived 150-second deadline and the next request has fewer optional chunks plus a different prompt fingerprint.
- The current UFW query completes within the existing 600-second operation budget, or fails with compact-attempt telemetry that isolates provider behavior.
- No non-standard OpenAI request fields are reintroduced.

## Gateway-Correlated SSE Disconnect Pass

### Failure Contract

- Query request `019f95fc-2e67-766a-8698-6fb6847d6051` reached the gateway and the Ollama backend produced its first reasoning token after `1.600790922s`.
- The plugin recorded HTTP `200` headers at `2026-07-24T21:16:01.578Z`; the gateway recorded `client_disconnected` at `2026-07-24T21:16:01.582149Z`, about four milliseconds later.
- Gateway duration exceeded TTFT by only `5.17ms`, while the plugin-side response reader observed zero bytes and remained pending until its 150-second response-start timeout.
- The direct desktop path currently reconstructs an Undici response around a renderer-global `ReadableStream` before the common body observer reconstructs it again. This cross-runtime response boundary is the smallest client-side surface matching the header-time disconnect.

### Bounded Steps

1. Add a regression that rejects an extra `undici.Response` reconstruction in the normal direct desktop SSE path.
2. Return the raw Undici response from pooled and isolated direct fetches.
3. Move OpenAI `[DONE]` detection into the common observed body so early socket release and transport telemetry remain intact.
4. Verify delayed reasoning-only first chunks followed by final content through the production client.
5. Run focused/full verification, update iwiki, rebuild, and deliver a test-vault bundle.

### Live Acceptance

- The correlated request no longer ends as `client_disconnected` immediately after gateway TTFT.
- Plugin telemetry records at least one SSE body chunk and reaches `producing` before the response-start deadline.
- Query completes, or any remaining failure includes non-zero body telemetry and a terminal gateway state other than header-time client disconnect.

## Post-Replay Page Integrity Pass

### Failure Contract

- Session `1784896515548` completed 22/22 sources and proved correct init-to-ingest policy routing.
- Four created pages nevertheless persisted invalid YAML because an unquoted colon in model-authored `description` made frontmatter unparsable. The index then fell back to folder-derived types and lost each page's resource provenance.
- The `cpu.md` source created three pages that all claimed alias `cpufrequtils`, leaving an ambiguous canonical identity.
- These are post-synthesis integrity defects: response framing, schema validation, canonical paths, and transport all succeeded.

### Bounded Steps

1. Add failing create-flow coverage proving invalid model frontmatter cannot reach the vault or index.
2. Make create-page governed frontmatter structurally serialized by server code while preserving valid body content and allowed metadata candidates.
3. Add failing same-source coverage for duplicate aliases across prepared pages.
4. Enforce deterministic alias uniqueness, preferring a page whose canonical identity owns the alias and removing ambiguous aliases elsewhere.
5. Run focused and full verification, audit the fixture pages, update iwiki, build, and deliver the corrected bundle.

### Acceptance

- Every persisted page frontmatter parses with the shared YAML parser.
- Every page retains canonical `type`, source `resource`, and type-folder agreement.
- No normalized alias resolves to more than one wiki page.
- Existing strict domain validation, one-chunk AMD mapping, and zero ingest structural repair behavior remain unchanged.

## Canonical Type Reverse-Mapping Repair

### Failure Contract

- Session `1784901066143` wrote parseable frontmatter but used plural wiki folder names as canonical `type` values.
- The defect is deterministic whenever `entityType !== wiki_subfolder`, for example `configuration -> configurations`.
- The active replay is rejected even if it completes because its page metadata was produced by the affected bundle.

### Bounded Steps

1. Add a failing create-flow regression with `configuration -> configurations`.
2. Resolve the canonical entity type by reverse lookup of configured `effectiveSubfolder` before frontmatter serialization.
3. Keep folder fallback for legacy/unconfigured paths.
4. Run P0, ingest, and full regression suites; rebuild and deliver a replacement bundle.
5. Restart from a clean force-reinit and audit the first completed source before allowing the full replay to continue.

### Acceptance

- `configurations/...` pages serialize `type: configuration`.
- Entity tag remains `configuration`.
- YAML, source provenance, alias ownership, routing, and canonical deletion guards remain green.

## Live Patch-Recovery Repair

### Failure Contract

- Corrected replay session `1784901643760` reached 18/22 sources with zero transport retries, then failed on `usb.md`.
- Synthesis requested `add` for an `## External links` section that already existed. Patch application routed this deterministic condition through LLM conflict regeneration.
- Regeneration repeated the matching H2 inside section content; strict validation rejected it and ended the source.
- The replay also produced mapper range tuples and exposed lossy ASCII alias identity for mixed-script titles.

### Bounded Steps

1. Add red regressions for a repeated matching H2, tuple ranges, existing-heading add, exact alias ambiguity, and localized alias preservation.
2. Strip at most one matching leading section heading from field-frame content; reject any remaining or different top-level H2.
3. Convert `add` to `append` only when the live page has exactly one matching heading.
4. Normalize exactly two-item range tuples before strict range validation.
5. Preserve Unicode letters in alias identity while keeping wiki paths and entity keys under the ASCII contract.
6. Run focused/full verification, audit the failed vault, update iwiki, rebuild, and deliver a new bundle.

### Acceptance

- Existing-section additions do not invoke conflict regeneration and preserve existing content.
- Matching repeated H2 is removed; unrelated/nested H2 output remains invalid.
- Range tuples cause no mapper retry but still pass normal line-bound validation.
- Exact ambiguous aliases are removed; localized mixed-script aliases are not collapsed to a bare ASCII product token.
- Full suite, lint, build, and live page integrity audit pass before another replay.

## Server-Owned Mapper and Article-Shape Repair

### Failure Contract

- Session `1784909821666` completed 22/22 with zero transport retries, but incurred four mapper schema retries from mistyped single-chunk IDs and one synthesis repair from `create` on existing target `linux`.
- `configurations/wiki_os-unix_bashrc.md` persisted `#.bashrc`, so the final page-integrity audit failed despite valid YAML and routing.
- Output-limit recovery, dead consolidated links, tag-category pressure, and total call count are measured P1 concerns and remain outside this P0 patch.

### Bounded Steps

1. Add red mapper regressions for mistyped packet and no-evidence chunk IDs in a single-chunk request, while retaining rejection for foreign IDs in multi-chunk validation.
2. Canonicalize sole-request chunk IDs before existing exact-range and coverage validation.
3. Add a red synthesis regression for model `create` output when canonical resolution already supplied an existing target; derive action kind deterministically or reject conversion when no safe body-to-patch mapping exists.
4. Add a red create-flow regression for a leading `#Title`; normalize only the first compact H1 form and keep missing/multiple article headings strict.
5. Run focused/full verification, update iwiki, rebuild, and deliver a corrected bundle for another clean replay.

### Acceptance

- Single-chunk mapper ID copy errors cause no LLM retry and cannot redirect evidence to another chunk.
- Existing canonical targets cannot reach synthesis validation as `create` actions.
- Every created article has exactly one valid leading H1 after governed frontmatter.
- Strict source ranges, canonical paths, CAS patching, alias ownership, and transport behavior remain unchanged.

## Cross-Operation Streaming Compatibility Repair

### Failure Contract

- Query session `1784914297075` received HTTP `400` headers in 55 ms but stalled with zero error-body bytes until manual cancellation at 152.5 seconds.
- The endpoint rejects optional `stream_options.include_usage`; plain SSE streaming succeeds.
- Format session `1784914453224` then hit an immediate pooled direct-fetch failure and reused the same dispatcher for its retry.
- Existing compatibility recovery is operation-specific and cannot execute until the SDK receives a complete error body.

### Bounded Steps

1. Add red coverage proving streaming requests omit optional usage metadata by default and retain explicit opt-in fallback.
2. Add red transport coverage for HTTP error headers followed by a body stall; cap that body wait independently from model generation idle timeout.
3. Add red executor coverage proving retry attempts request a fresh direct connection after attempt zero.
4. Implement the smallest shared changes in chat parameter construction, direct response handling, and native retry fetch metadata.
5. Run Query, Format/structured, native transport/executor, full tests, lint, and build.
6. Update iwiki transport docs, build a verified bundle, and retest Query before starting another reinit.

### Acceptance

- Default Query, Chat, Format, and streaming structured requests contain no `stream_options` field.
- Explicit `includeStreamUsage: true` still sends the field and can fall back without it on a readable provider rejection.
- A non-success direct response with a stalled body becomes a bounded status-preserving API error instead of waiting for the configured 600-second model idle timeout.
- Native retry attempt 1 and later use an isolated fresh connection; successful attempt 0 keeps pooled SSE streaming.
- Plain streaming remains incremental and non-stream reinit remains on `desktop-host`.

## First SSE Event Retry Repair

### Failure Contract

- Query session `1784919493140` received standard SSE HTTP `200` headers but no body bytes or chunks for 599,289 ms.
- Equal 600-second operation and native idle deadlines let caller cancellation win, so zero-output attempt 0 never entered retry policy.
- Direct controls succeeded with both `max_completion_tokens: 32000` and a 12,973-byte Query-shaped prompt, so neither setting is independently causal.

### Bounded Steps

1. Add a red executor regression for an accepted stream whose first iterator read never resolves; prove it currently reaches the full idle deadline instead of reserving time for retry.
2. Derive a first-event deadline by partitioning the configured idle window across available attempts while respecting the connection timeout.
3. Classify expiry as retryable `response_start_timeout`; attempt 1 keeps the existing fresh-connection policy.
4. Switch to the full configured inter-chunk idle timeout after the first valid model chunk and preserve fail-closed behavior after meaningful output.
5. Run focused executor/transport tests, full tests, typecheck, lint, build, and static OpenAI request audit.
6. Update iwiki and deliver a new bundle for Query and Format acceptance.

### Acceptance

- A zero-event HTTP `200` stream retries before the outer operation deadline.
- Retry telemetry reports `response_start_timeout`, not user cancellation or generic connection timeout.
- First valid model chunk restores the normal full idle window.
- Caller abort and any failure after meaningful output remain non-retryable.
- Standard requests and incremental SSE response parsing remain unchanged.

## Raw Desktop SSE Ownership Repair

### Failure Contract

- Query session `1784929303448` received HTTP `200`; gateway had already produced reasoning, then recorded `client_disconnected` at the response-header boundary.
- The plugin received zero body bytes and timed out after 150 seconds.
- Removing the inner `undici.Response` reconstruction did not change the live failure, so the remaining renderer `ReadableStream` plus global `Response` bridge is rejected.
- A direct low-level control completed the same provider's standard SSE lifecycle through `[DONE]` and EOF in 1,770 ms.

### Bounded Steps

1. Add a red transport regression proving successful desktop-direct streaming returns the original Undici response and body objects without reconstruction.
2. Bypass `observeResponseBody` only for successful desktop-direct SSE responses; retain it for host/mobile/proxy responses and bounded non-success bodies.
3. Remove transport-owned `[DONE]` cancellation from the successful direct path and rely on the standard provider EOF consumed by the OpenAI SDK.
4. Verify raw streaming through the project transport and OpenAI SDK, caller abort, HTTP error buffering, retries, Query tests, full suite, typecheck, lint, and build.
5. Update iwiki, deliver the bundle, and rerun the exact UFW Query before another reinit.

### Acceptance

- No renderer `ReadableStream` or `Response` is constructed after a successful desktop-direct SSE fetch.
- The OpenAI SDK receives the original Undici body, yields reasoning/content, sees provider EOF, and completes.
- HTTP errors remain status-preserving and bounded; non-stream bootstrap stays on `desktop-host`.
- Live gateway audit no longer reports `client_disconnected` at header delivery for the exact Query.

## Buffered Desktop Completion Repair

### Failure Contract

- Session `1784955341746` loaded the raw-response build, emitted `fetch_headers` without `body_start`, but still produced no model chunk before the 150-second deadline.
- Therefore the normal Obsidian renderer cannot rely on `undici.fetch` body delivery even without response reconstruction.
- Desktop-host non-stream requests are already stable across full reinit runs, and the mobile compatibility wrapper already converts completions back to the phase-level stream interface.

### Bounded Steps

1. Add a red production-client test proving a requested stream on normal desktop hybrid is sent as `stream:false` through the injected host fetch and returned as compatible chunks.
2. Generalize the mobile no-stream wrapper name and reasoning-field handling without changing its public compatibility export.
3. Apply the wrapper to `mobile-host` and normal `desktop-hybrid` clients only; preserve proxy and explicit diagnostic streaming.
4. Update transport diagnostics and tests to report actual `desktop-host`/`non-stream` execution for normal desktop Query and Chat.
5. Run focused/full verification, update iwiki, build, deliver, and repeat the exact UFW Query.

### Acceptance

- Normal desktop no-proxy Query sends standard `stream:false` and uses `desktop-host`; no `desktop-direct` request is created.
- Phase callers still receive reasoning/content/final chunks through `AsyncIterable` and preserve answer semantics.
- Mobile behavior stays equivalent; proxy and explicit diagnostic modes retain true streaming.
- Live UFW Query completes on attempt 0 without response-start repack or gateway client cancellation.

## Post-Reinit Domain Quality Evaluation

### Measurement Steps

1. Wait for session `1784956783666` to reach a terminal state; snapshot source, page, LLM-call, retry, budget, and latency totals from `agent.jsonl`.
2. Run deterministic page-integrity and provenance audits across all generated `!Wiki/os-unix` pages.
3. Compare each completed source with pages listing it in `resource`; measure intended entity, command, URL, and numeric-literal preservation and manually review every zero-effect source and flagged omission.
4. Build ten thematic questions spanning the source set, each with expected source/page targets and required answer points fixed before Query execution.
5. Execute all ten questions against the generated domain through the same production Query path and model settings used by the plugin.
6. Score retrieval hit@k, grounding, completeness, WikiLink validity, retries, latency, and token use; record raw session IDs and answer artifacts.
7. Classify failures by deterministic routing, consolidation, retrieval, prompt contract, model obedience, provider latency, or transport; rank fixes by P0/P1 impact.

### Acceptance

- Every metric and question has reproducible evidence in `5_check.md` or a referenced artifact under `scripts/loen-dynamic-budget-routing/`.
- Quality conclusions distinguish transport success from content correctness and search effectiveness.
- Proposed fixes trace to observed failures; no global budget increase or validation weakening is accepted without measured necessity.

## Consolidation Path-Authority Repair

### Failure Contract

- Session `1784956783666` produced evidence for `npm.md` but made no page mutation.
- Consolidation selected pathless `bashrc`, then pathless `node-js`, as parent entities before synthesis.
- Strict synthesis validation rejected both creates because neither parent had an existing canonical target nor a server-owned create path; repair returned `SKIP`.
- `createPathsByEntityKey` was already available before consolidation, but parent selection did not receive that authority.

### Bounded Action

1. Add a red regression where a stronger pathless bundle competes with a weaker routable bundle under the source entity cap.
2. Pass the set of existing-target and canonical-create entity keys into consolidation.
3. Permit consolidation parents only from that actionable set; preserve existing behavior when no authority set is supplied to direct callers.
4. Run focused consolidation and ingest tests, then record action and check evidence.

### Acceptance

- A pathless bundle can contribute evidence but cannot become the final consolidation parent when any actionable bundle exists.
- Consolidated child facts, ranges, exact source, packet IDs, and links remain preserved.
- Existing-target bundles remain protected.
- Strict synthesis path validation remains unchanged.

## Query Code Boundary and Soft Entity Target Repair

### Failure Contract

- Query evaluation treated TOML `[[runners]]` inside code as a broken WikiLink, scheduled an unnecessary model repair, and annotated code after repair failed.
- Session `1784979910443` retained only 31/106 declared source entities and showed independent network, storage, user-management, npm, SSH, and Fail2Ban entities merged into unrelated parents.
- The per-source entity setting acted as a hard routing cap: every routable bundle above the count was merged by source-range proximity and evidence strength.

### Bounded Action

1. Add red extraction, annotation, replacement, CRLF, multiline-code, and Query integration tests for WikiLink-shaped code syntax.
2. Apply one Markdown code boundary to Query WikiLink extraction and mutation.
3. Add red consolidation tests proving routable standalone entities survive both proximity and per-source count pressure.
4. Convert the per-source count to a soft cost target; consolidate only evidence without independent path authority and emit overflow telemetry.
5. Update settings descriptions, run focused/full verification, update iwiki, build, and deliver the test bundle.

### Acceptance

- Inline/fenced code never creates a broken WikiLink, repair request, annotation, or deterministic replacement.
- Independent routable bundles remain separate even when the configured target is exceeded.
- Pathless supporting evidence still reaches an actionable parent without fact loss.
- Synthesis batch size remains an independent hard request-size control and defaults to `1`.
- Strict schema, path, alias, and domain validation remain unchanged.

## Same-Target Canonical Bundle Repair

### Failure Contract

- Session `1785040016216` failed at 20/22 sources after multiple aliases from `user.md` resolved to the existing canonical `user_management_commands` page.
- Each single-entity synthesis request correctly received the same server-owned target, but merged output contained multiple actions for that path.
- The final duplicate-path guard correctly rejected the second action; weakening it would permit conflicting writes.
- Init then waited for the configured file-error decision without an explicit waiting-state event.

### Bounded Action

1. Add a red unit regression for same-target bundles with overlapping context and replace authorities.
2. Consolidate bundles by exact server-resolved existing target before count-based consolidation and LLM batching.
3. Preserve all child evidence, context authority, and entity coverage on one deterministic carrier; keep create routing and different targets separate.
4. Add an ingest regression proving one canonical patch reaches apply and the strict duplicate-path guard remains unchanged.
5. Emit explicit progress before and after `onFileError` so logs distinguish user-decision wait from pipeline hang.
6. Run focused tests, configured LoEn verifier, full suite, typecheck, lint, build, and live bundle hash verification.

### Acceptance

- Any exact existing target appears in at most one synthesis bundle and one apply action per source.
- Consolidated child facts, packet IDs, ranges, exact source text, links, required units, and replace authorities survive.
- Multiple create paths and genuinely different canonical targets remain independent.
- Duplicate model actions outside server consolidation still fail strict validation.
- File-error waits are visible in logs and preserve Retry/Skip/Stop behavior.
- No mapper output-budget change is accepted from the isolated recovered 502 without repeated causal evidence.

## Domain-Neutral Frame Repair and Query Candidate-Pool Pass

### Failure Contract

- Live reinit session `1785057814992` completed 22/22 sources, but one synthesis response contained a valid `<<<REASONING>>>` frame and no action frame.
- The synthesis parser misclassified that incomplete framed response as legacy JSON, so repair received a misleading JSON parse error and the model returned a JSON `response` wrapper.
- A second repair appended the prior assistant response and repair request, increasing input from 18,331 to 20,896 tokens before a recovered HTTP `502`.
- The first ten-query replay still selected one chunk per article because `rerankChunks` truncated to `contextTopN` before the article-depth selector could reserve sibling sections.
- UFW exposed both defects, but neither defect depends on OS taxonomy, paths, commands, language, or source layout.

### Bounded Action

1. Add red tests for an incomplete synthesis frame, repeated repair prompt growth, and downstream selection from a wider reranked pool.
2. Classify any synthesis-marker response without CREATE, PATCH, or SKIP as a frame error with an action-specific diagnostic; keep actual legacy JSON compatibility.
3. Rebuild every parse repair from immutable base messages plus one current repair instruction.
4. Add an optional bounded reranker result pool while preserving `contextTopN` as the public default.
5. Request the wider candidate pool in single- and cross-domain Query, then apply the shared fixed-size article-depth selector.
6. Repeat the same ten fixed questions against the immutable generated domain and compare quality, retries, latency, and token use.

### Acceptance

- Incomplete field frames never fall through to a JSON parse error.
- Every repair request contains original messages plus one repair instruction and no prior assistant output.
- Existing reranker callers retain `contextTopN` behavior unless they explicitly request a wider result pool.
- Query retains the configured final context size while sibling sections become reachable.
- Fixed-question fact coverage improves without invalid WikiLinks, unsupported technical output, model retries, or a budget increase.
- No domain-specific entity type, path, alias, heading, command list, or prompt exception is introduced.

## Domain-Neutral Mapper Wire and Reranker Payload Pass

### Failure Contract

- Session `1785068631709` spent two of five structural repairs on mapper output that changed only wire representation: singular `exactSourceRange` and duplicate opaque packet IDs.
- Packet IDs have no model-owned semantic meaning or cross-reference; packet order and all facts/ranges remain authoritative.
- Reranker candidate text repeats title and full path inside a 120-character cap. Long canonical paths can consume the complete cap before the article body, so article reranking is effectively metadata-only.

### Bounded Action

1. Add red mapper tests for singular one-range input, duplicate/missing opaque IDs, ambiguous dual range fields, malformed ranges, and unchanged strict entity/range checks.
2. Normalize singular range only when plural form is absent; assign deterministic request-local packet IDs before existing coverage validation.
3. Add red reranker tests proving long paths cannot starve a non-empty query-aware body excerpt under the unchanged cap.
4. Compact redundant candidate metadata and reserve a bounded share for body content; keep candidate count, timeout, model, and total character cap unchanged.
5. Run focused/full verification and repeat the same ten fixed questions against the immutable 78-page domain.

### Acceptance

- Singular one-range and opaque-ID defects schedule no LLM repair and preserve every packet in original order.
- Both singular and plural range fields together remain invalid; malformed/out-of-bounds ranges and unknown entity/type values remain invalid.
- Every non-empty candidate body contributes content to the reranker without increasing request count or candidate character budget.
- Fixed ten-query completion/retry/link gates remain green and fact coverage does not fall below 92.904%.
- No domain-specific taxonomy, path, heading, command, alias, or language rule is introduced.

## Domain-Neutral Article Anchor Rescue Pass

### Failure Contract

- Query context uses six article anchors plus two sibling chunks at `contextTopN: 8`.
- A seed-4 technical article survived raw chunk ranking and reranking but landed at article anchor 7.
- The admitted anchor 6 had only 1.1% more chunk score but less than half the article score, so a hard first-N boundary erased independent article-stage evidence.

### Bounded Action

1. Add red selector tests for one Pareto-dominant later article, weak chunk evidence, weak article evidence, sibling reservation, and stable output order.
2. Permit at most one later article to replace the weakest admitted anchor when chunk score is at least 95% of that anchor and article score is more than `1 / 0.95` times stronger.
3. Keep final context size, sibling budget, reranker order, prompt budget, and model calls unchanged.
4. Repeat the fixed ten-query set on the same immutable domain.

### Acceptance

- A strong article cannot be lost solely at the first-N anchor boundary when both retrieval stages support it.
- No rescue occurs with missing scores, materially weaker chunk evidence, or only marginal article-score noise.
- At most one anchor changes and returned chunks retain original reranker order.
- Ten-query completion, retry, invalid-link, and 92.904% fact-coverage gates remain green.

## Domain-Neutral Sibling Reranker Score Pass

### Failure Contract

- Page-aware reranking receives a score for every chunk but returns only the original embedding score and page-interleaved order.
- The Query selector therefore cannot distinguish a strongly reranked sibling from a weak sibling once their page anchor is admitted.
- Full intra-page resorting would be a larger behavior change and is not justified by one replay.

### Bounded Action

1. Add red reranker tests proving valid per-chunk scores survive page-aware output without replacing the baseline similarity score.
2. Add red selector tests proving sibling slots prefer higher reranker scores and preserve original order when scores are absent.
3. Attach optional `rerankerScore` only on successful valid reranker output; leave every fallback chunk byte-for-byte unchanged.
4. Order only sibling slots by that optional score. Keep article anchors, rescue gate, context count, budgets, and model calls unchanged.
5. Repeat the fixed ten-query set on the same domain.

### Acceptance

- Page-aware article ordering remains guarded and unchanged.
- Successful reranker output retains per-chunk relevance for sibling selection; fallback behavior is unchanged.
- Anchors remain first in global rank order; selected siblings follow in reranker-score order so prompt packing cannot discard the strongest sibling merely because page interleaving placed it later.
- Ten-query completion, zero invalid links, and fact coverage stay above baseline; any new retry or fail-closed regression rejects the combined selector candidate.

## Domain-Neutral Stable Grounding and Wire Compatibility Pass

### Failure Contract

- Mapper repairs in session `1785068631709` included semantically equivalent wire noise: singular `exactSourceRange` and duplicate/missing opaque packet IDs.
- Long canonical paths could consume the full 120-character reranker candidate before any article body reached the reranker.
- The combined article-rescue and sibling-score selector variants raised expected-page recall but reduced ten-query fact coverage and introduced an NFS grounding repair.
- NFS local sanitation reduced eight unsupported units to two, but removing `2049` exposed new `/tcp` and `/udp` path tokens. The pipeline did not repeat local sanitation.
- Grounding repair then reused the original answer and original diagnostics instead of the sanitized candidate and residual diagnostics, causing avoidable prompt growth and a preflight failure before any repair HTTP call.

### Bounded Action

1. Normalize only unambiguous one-range mapper wire input and server-own opaque packet IDs; preserve strict semantic, entity, type, and range validation.
2. Reserve body text inside the unchanged reranker candidate cap while removing redundant full-path metadata.
3. Evaluate article rescue and per-sibling reranker ordering independently and together, then restore the prior selector when acceptance gates fail.
4. Repeat deterministic local grounding sanitation to a four-pass fixed bound and revalidate after every pass.
5. Build any remaining grounding repair from the sanitized candidate and current residual diagnostics only.
6. Repeat the fixed ten-query replay against the immutable 78-page domain and run full repository verification.

### Acceptance

- Wire-only mapper defects do not consume a model repair; ambiguous or semantically invalid output remains rejected.
- Reranker request count, candidate count, timeout, and total character cap stay unchanged.
- Retrieval experiments that add a retry or reduce fact coverage below the accepted baseline are reverted.
- Newly exposed technical units are removed locally without an additional model call.
- A necessary repair never receives technical units already removed by deterministic sanitation.
- Ten-query completion and WikiLink precision remain 100%, with zero model repair after restoring the accepted selector.

## Guarded Conflict-Regeneration Format Repair Pass

### Failure Contract

- Live session `1785087161419` completed 21 sources before `wifi.md` required a guarded patch regeneration for an existing canonical target.
- The fresh regeneration request returned HTTP `200` and described the correct patch in reasoning, but emitted no action frames and no `<<<END>>>` marker.
- `executeSingleRegenerationRequest` currently sets `maxRetries: 0` and rejects a second underlying request, so one wire-format defect escalates to a file-level Retry decision.
- This is distinct from a second stale patch: no write occurred and fresh page/section authorities remained unchanged.

### Bounded Action

1. Add a red regression where the first guarded regeneration response is frame-invalid and the second is a valid patch.
2. Permit exactly one structured format repair from the immutable fresh regeneration context.
3. Keep semantic entity/path/hash/section validation after parsing; invalid semantic output receives no model repair.
4. Keep the existing `conflictCount` guard: a patch that becomes stale after regeneration still makes zero additional requests.
5. Add an exhaustion regression proving two malformed responses stop without a third request.

### Acceptance

- One missing/invalid frame response can recover locally within the guarded regeneration operation.
- A valid first response still uses one request.
- Wrong entity, path, hash, section authority, create action, or repeated stale conflict remains rejected.
- At most two underlying requests occur: one fresh regeneration plus one format repair.
