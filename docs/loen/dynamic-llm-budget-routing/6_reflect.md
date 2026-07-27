# Dynamic LLM Budget Routing Reflection

## Checkpoint

Keep strict validation. The retries are real output-contract failures, not validation false positives.

Reject these options:

- `off` transport: both 16384 and 4096 variants hang before the first HTTP response.
- `connection-close + 4096`: reaches HTTP, but does not recover cleanly and triggers capped/empty structured output.
- `ingest maxTokens = 4096`: causes systemic `ingest.evidence-map` repairs and can degrade article count/quality.

Current best observed option:

- `undici-request-adapter + 16384`: removes evidence-map truncation and produces high-quality first-source output, but still fails when a synthesis repair prompt exceeds the input budget.

Next decision point:

- Do not only raise output budget. The next fix must route repair prompts through a bounded/compact repair context or dynamically increase input budget when the provider context allows it.
- `inputBudgetTokens = 65536` is useful for this model/provider and unblocks repair calls around 60k input tokens. It should be supported as a dynamic ceiling, not treated as the only reliability mechanism.
- Preferred pipeline direction: `undici-request-adapter`, high enough output budget for init/reinit ingest, deterministic routing, compact/schema-focused repair prompts, and strict validation.

Problem areas to resolve in order:

1. Dynamic input budget: allow synthesis repair to use a higher input ceiling when the model/provider supports it, because observed repair input reached `60238`.
2. Repair context size: prefer compact or targeted repair for synthesis once context exceeds a threshold, even if it fits in 65536. Large full-context repair reduces schema obedience.
3. Section patch contract: make `operation` and `content` impossible or much harder to omit by using a smaller repair schema/task for one failed entity/section.
4. Source chunk IDs: bootstrap/evidence prompts must require exact supplied chunk ids, not reconstructed ranges like `0:1-65`.

## Proposed Fixes

1. Add per-call budget planner:
   - keep configured budgets as user ceilings;
   - compute operation defaults by callSite and source size;
   - for reinit, use init policy for nested ingest, but force safe minimums for `init.bootstrap-map`, `ingest.evidence-map`, and `ingest.synthesize`;
   - allow repair-only input expansion up to a configured/provider ceiling.
2. Add synthesis repair mode:
   - first schema failure uses compact targeted repair instead of full context when estimated repair input is large;
   - repair task should include entity key, allowed path, invalid action index, schema error, and minimal evidence for that entity only;
   - if targeted repair fails once, split entity batch to 1 and retry once.
3. Harden section patch contract:
   - prompt/schema examples must name exact allowed operations: `add`, `append`, `replace`;
   - forbid returning headings inside section `content`;
   - consider server-side coercion only for safe cases where intent is unambiguous, otherwise keep strict reject.
4. Harden source chunk contract:
   - evidence/bootstrap prompts must pass a list of exact chunk ids and say to copy ids verbatim;
   - schema should prefer `chunkId` from supplied ids over model-composed ranges;
   - validation should keep rejecting unknown chunk references.
5. Improve settings:
   - expose global/per-operation input, output, and thinking budgets;
   - add recommended presets for large bounded ingest: output `16384`, input ceiling `65536`, thinking `4096`;
   - add descriptions that `init` budget governs nested reinit ingest.

## Reflection After Source-Level Synthesis Shaping

The 8000-second replay shows the pipeline was structurally over-producing pages, not merely losing transport or failing JSON mode. `batch=1` is the right default for the current local model because single-bundle canonicalization can correct invented `entityKey`/create path output without a semantic repair loop. It is still not sufficient alone: without a source-level cap, `batch=1` turns one over-extracted source into dozens of serial synthesis calls.

Keep:

- strict validation;
- server-owned path routing;
- default synthesis batch size `1`;
- source-level page cap default `6`;
- prompt guidance against command-fragment articles.

Do next:

- rerun from a clean test vault and compare pages/source, synthesis calls/source, retries/source, and average prompt size;
- if evidence-map still emits large packet arrays, add a framed/sentinel structured mode or a mapper-side packet cap;
- consider a first-class `procedure` entity type during bootstrap so command-heavy OS notes have a parent article target instead of falling back to command/config pages.

## Final Replay Reflection — session 1784824895256

Decision: **fix**. Do not accept the current pipeline as the final variant.

Observed result:

- status `error` after 6,068,285 ms;
- 18/22 sources completed; `usb.md` failed and three later sources were not started;
- 120 LLM calls, 587,760 input tokens, 585,607 output tokens;
- 23 structural failures: 14 `empty_output`, 9 `schema_validate`;
- 14 calls reached the exact 16,384 output cap;
- 1 bootstrap transport retry, recovered;
- 53 pages reported created, 58 Markdown pages remained in the vault;
- every page used type `configuration` and folder `configurations`;
- 32 dead-link warnings and one duplicate merge attempt.

Terminal cause:

- duplicate guard selected `fstab` -> `etc-fstab` merge at score 0.90;
- conflict regeneration received a model patch shaped with the legacy flat regeneration fields;
- the field-frame synthesis adapter validated it as the general `SynthesisOutputSchema` and rejected missing `reasoning/actions/skips` plus unrecognized patch fields;
- conflict regeneration allows zero structured retries, so this recoverable protocol mismatch terminated the full reinit.

Required fixes, in order:

1. Give conflict regeneration one canonical field-framed patch contract and parser. Do not retain a legacy flat patch prompt beside the general synthesis envelope.
2. Make one duplicate-merge regeneration failure source-local: retain the canonical page, skip the duplicate candidate, record a deferred merge, and continue remaining sources.
3. Enforce a minimum bootstrap taxonomy for OS domains (`application`, `configuration`, `distribution`, `service`, `concept` or equivalent). Merge model additions into the minimum instead of accepting one inferred type.
4. Treat `completion_tokens == outputBudget` with blank content as provider truncation, not generic schema repair. Retry once with reduced reasoning or a larger supported output ceiling; otherwise fail the entity locally.
5. Tighten evidence sentinel examples for required `sourceAnchor`, exact chunk IDs, and complete coverage. Keep strict rejection for unknown ranges.
6. Reduce dead links: links may target only supplied existing page IDs or entities guaranteed in the same accepted action set; otherwise emit plain text.
7. Keep batch size 1 for this model, but reduce calls through deterministic entity consolidation before synthesis. Target no more than 3-4 article entities per ordinary source.
8. Run the next replay with diagnostic mode `off` and verify bootstrap attempt 0. The adapter replay is no longer the production candidate.

Acceptance gates for the next replay:

- 22/22 sources complete and terminal status `done`;
- zero fatal source-level failures;
- zero JSON/frame parse failures;
- bootstrap transport retries zero;
- empty-output rate below 2% and total structural retry rate below 5%;
- at least four meaningful entity types represented;
- zero non-canonical paths and zero unknown entity keys;
- dead-link warnings below 5 and no command-fragment page explosion;
- total LLM calls below 80 for this 22-source corpus.

## Transport Regression Decision

Decision: **fix the non-stream transport boundary before more prompt or budget tuning**.

This supersedes the earlier recommendation to use `undici-request-adapter`. The adapter is rejected because all ten measured init sessions fail its first bootstrap request. `diagnosticMode=off` is also not accepted as currently implemented because both measured sessions stall after HTTP 200 with zero body bytes.

The `0.1.200` release itself is exonerated: it contains no transport diff. The actionable boundary is commit `d72cf5b` after `0.1.204`, where non-stream desktop requests stop using buffered Obsidian `requestUrl` and begin using direct pooled undici.

Next bounded experiment:

1. Restore the pre-regression buffered host transport for desktop non-stream calls only.
2. Keep direct undici for true streaming calls.
3. Keep request-scoped retry orchestration, but classify post-header zero-byte expiry as `provider_body_stall`, not `connection_timeout`.
4. Run one clean os-unix reinit and require bootstrap-map/bootstrap attempt 0 success before evaluating synthesis quality.

Decision threshold:

- accept buffered non-stream routing if the same vault completes bootstrap-map and bootstrap with zero transport retries on two consecutive clean restarts;
- reject it if either restart reproduces a post-header zero-byte stall;
- do not treat a shorter body-start timeout as the root fix; it only limits wasted time after failure.

Confidence:

- high that current transport behavior is a post-release regression surface;
- medium that pooled undici/gateway keep-alive interaction is the exact low-level cause;
- low that prompt size, JSON framing, or model availability causes the observed zero-byte body stalls.

## Buffered Desktop Non-Stream Delivery Reflection

Decision: **handoff for protected live replay**.

The implementation meets local gates: the red tests reproduced the direct-route regression, 77 transport/executor tests pass after the fix, 21 bootstrap tests pass, lint has no errors, and the delivered vault bundle matches the rebuilt artifact. The route change is bounded to desktop/no-proxy/non-stream requests; streaming, mobile, proxy, and explicit diagnostic transports retain their previous implementations.

Do not mark this variant `keep` yet. Obsidian must reload the delivered bundle and run force reinit twice. Each run must show `desktop-hybrid` in `run_config`, `desktop-host` on both bootstrap-map and bootstrap non-stream attempts, HTTP 200 followed by a non-empty `body_end`, and zero bootstrap transport retries. Any repeated post-header zero-byte stall rejects the variant and triggers rollback to `main.js.pre-desktop-hybrid-backup`.

## Desktop Hybrid Replay Reflection - session 1784840143468

Decision: **fix** the synthesis pipeline while retaining the buffered desktop non-stream transport candidate.

Keep:

- `desktop-hybrid`: the first full replay completed 134/134 response bodies with zero transport retries;
- strict local schema and domain validation;
- server-owned create paths;
- synthesis batch size 1 as the conservative default for this model;
- source-derived taxonomy rather than a hardcoded OS taxonomy.

Fix next, in order:

1. Make `<<<END_CONTENT>>>` an explicit compatible frame boundary and reject any reserved protocol marker that remains inside persisted Markdown.
2. Resolve existing pages by canonical key, title, and unique alias before assigning a create path. Never use `governed[0]` as required target context for a new entity.
3. For create, omit optional page bodies; for update, provide only exact target sections. Keep candidate descriptions for duplicate selection, but restore enough exact source text to ground article content.
4. Classify blank content with `outputTokens >= maxTokens` as `output_limit`. Retry from fresh base messages with a compact frame directive; do not append empty assistant turns. Allow one bounded output-budget escalation to a configured ceiling.
5. Include actionable, safe evidence validation reason codes in bounded repair prompts. A root `custom` code alone cannot guide correction.
6. Replace the hard source cap with consolidation: merge low-prominence command/file/package evidence into parent article candidates before synthesis. Do not discard their evidence.
7. Add alias-collision and post-index final-link gates. Intermediate same-batch link warnings are telemetry, not the final quality result.
8. Refine source-derived taxonomy after mapper candidates are known; reuse existing types and propose new types only from repeated source evidence.

Acceptance remains open:

- transport requires one more clean fresh restart;
- synthesis requires zero reserved marker leakage and no final operation errors;
- empty-output rate must fall below 2%;
- total calls must fall below 80;
- duplicate/alias collisions must be zero;
- generated articles must remain grounded in their recorded source resources.

## Bounded Ingest Contract Repair Reflection

Decision: **handoff for live replay**.

Keep the implementation for the next experiment: all local gates pass, strict validation remains enabled, routing is server-owned, and capped child evidence is consolidated rather than discarded. Do not mark the loop complete until a fresh os-unix reinit proves the provider-facing behavior.

Next replay gates:

- zero persisted reserved marker lines;
- zero non-canonical paths and unknown entity keys;
- zero alias-equivalent duplicate pages;
- create requests contain no page bodies and update requests contain only their canonical target;
- cap retries report `output_limit`, use a fresh compact request, and stay under the configured ceiling;
- mapper repair diagnostics include a concrete reason code;
- every consolidation event preserves child facts in the parent prompt;
- complete 22/22 sources with fewer than 80 total LLM calls and under 2% empty outputs.

## Evidence Mapper Output Ceiling Reflection

Decision: **fix and rerun**.

Session `1784868963664` is rejected as synthesis-quality evidence because it exercised the old mapper retry wrapper and made no source progress. Keep its transport result: bootstrap succeeded on attempt 0 with complete host-buffered bodies and no retry.

The next replay must demonstrate an evidence-map cap sequence above `4096` after an `output_limit` event, normally `4096 -> 6144`. Repeated equal caps after typed output-limit reject the bundle immediately.

## Field-Frame Repair Budget Reflection

Decision: **fix and rerun**.

Session `1784869572887` proves the dynamic output ceiling fix works and the buffered non-stream transport remains stable. Reject the session as pipeline acceptance because a valid local frame rejection could not schedule repair under the normal init input budget.

Keep strict frame/domain validation. Do not accept `## CREATE` as a protocol alias. The correct recovery is an exact diagnostic plus one fresh compact repair under the configured repair input ceiling.

For the next replay, use `init.maxTokens = 8192`. This removes the known systematic 4,096-token first-attempt failure without hardcoding a model-specific floor in production. Keep global output retry ceiling and repair input ceiling at 65,536, synthesis batch at 1, and transport diagnostic mode off.

Acceptance for this pass:

- no repair preflight failure at 16,384 after a frame or domain rejection;
- frame retry fingerprints contain fresh base messages plus one compact directive and no assistant output;
- first mapper calls no longer consume a 4,096-token cap;
- progress passes source 2 and continues without transport retry.

## Init-to-Ingest Policy Routing Reflection

Decision: **fix and rerun**.

Session `1784893122317` is rejected as a synthesis-quality result. It did not exercise the configured ingest policy: init orchestration reused its bootstrap runtime for every child source. The resulting 16,384-token mapper budget fragmented `AMD Driver.md` into 19 chunks and amplified schema retries and cross-chunk taxonomy conflict.

Keep the user-facing policy model:

- with per-operation settings disabled, init and ingest inherit editable global Chat model values;
- with per-operation settings enabled, `Init` controls bootstrap only and `Ingest` controls source-file work, including work launched by init and re-init;
- missing or invalid persisted values alone use normal application defaults.

Do not weaken entity-type conflict validation based on this rejected run. First rerun with correct stage routing. Accept this pass only when bootstrap reports `16384/4096`, source evidence and synthesis report `65536/16384`, `AMD Driver.md` plans one source chunk, and transport retries remain zero.

## Init-to-Ingest Live Replay Reflection

Decision: **fix page integrity, keep stage routing**.

Keep:

- separate init bootstrap and child-ingest policies;
- `desktop-hybrid` non-stream transport;
- strict frame/schema/domain validation;
- field-framed Markdown output and server-owned canonical paths;
- one evidence-map chunk per tested source under the 65,536 ingest input budget;
- deterministic entity consolidation before synthesis.

The live replay closes the original routing failure: every source used `65536/16384`, AMD no longer fragmented into 19 chunks, 22/22 sources completed, and ingest required zero structural repair.

Do not accept the generated wiki as final yet. Four invalid model-authored frontmatter blocks were written after validation and one alias became ambiguous across three pages. Fix these post-synthesis integrity defects before another full replay.

After P0 integrity, run a separate cost experiment. Batch size 1 produced 95 synthesis requests for 95 actions and 121 total calls. A dynamic or selectively larger batch may meet the under-80 target, but it must not be mixed with the correctness fix. Bootstrap output should also start above 4,096 or use a predictive initial ceiling; dynamic escalation recovered but consumed two avoidable requests.

## Post-Replay Page Integrity Reflection

Decision: **handoff for clean replay**.

Keep the P0 implementation. It removes model control over YAML serialization for canonical fields, preserves valid article bodies and optional metadata, and resolves new alias collisions before any page write. Strict routing, schema validation, CAS writes, and canonical duplicate deletion remain fail-closed.

Do not close the overall topic yet. Reload the delivered bundle and run one clean os-unix force-reinit. Accept page integrity only when:

- every generated frontmatter block parses;
- every page has canonical type, exact source provenance, and type-folder agreement;
- every normalized alias has at most one owner;
- 22/22 sources complete with zero ingest structural repair and no reserved markers.

Treat synthesis call count and initial bootstrap output sizing as P1. Changing batch behavior in the P0 replay would make the quality comparison ambiguous.

## Canonical Type Replay Reflection

Decision: **reject session `1784901066143`; keep the reverse-mapping fix and rerun**.

The early page audit worked as intended: it stopped acceptance after the first source instead of allowing a full costly replay to validate structurally wrong metadata. Transport, budget routing, YAML serialization, and provenance were healthy; canonical type derivation was not.

The replacement is deterministic and domain-neutral. It uses each domain's configured entity type/subfolder mapping, so it does not hardcode OS taxonomy or English plural rules. Permit the next replay to continue beyond source one only after disk audit confirms singular canonical types and unique alias owners.

## Live Patch-Recovery Reflection

Decision: **reject session `1784901643760`; keep the deterministic repairs and rerun**.

Keep the transport result: 107 calls reached complete responses with zero transport retries. Keep strict schema, domain, path, and patch validation. The terminal failure was local orchestration: an existing heading was treated as an LLM conflict, then one malformed regeneration response had no recovery path.

The repair removes avoidable model decisions without accepting ambiguous content. Existing headings are converted from add to append only with one exact live match; matching repeated H2 is stripped once; mapper tuples are accepted only in the exact two-value form and still undergo range validation. Unicode alias identity prevents false collisions while exact aliases remain guarded.

Run another clean force-reinit. Page integrity acceptance still requires 22/22 sources, terminal `done`, zero persisted marker/YAML/type/provenance defects, and a clean alias audit. Output-cap and model-copy repairs may remain bounded recoveries. Total calls below 80 remains a separate P1 batching experiment after correctness acceptance.

## Server-Owned Mapper and Article-Shape Reflection

Decision: **handoff for clean replay**.

Keep the three deterministic adapters. They remove choices for which the server has exactly one answer without weakening validation: mapper IDs remain request-local, existing-target conversion requires unique path/hash authority, scaffolding-only preamble, and parseable H2 sections, and created pages still require exactly one H1.

The next force-reinit must complete 22/22 and satisfy:

- zero mapper retries caused only by copied single-chunk IDs;
- zero synthesis repair for `create` on a uniquely resolved existing target;
- every created page has exactly one valid H1;
- zero YAML, type-folder, provenance, index, marker, or alias audit failures;
- zero transport retries remains the expected transport baseline.

Do not combine this P0 replay with batching changes. Bootstrap/evidence output-limit escalation, dead links to consolidated entities, thematic tag pressure, and the under-80 call target remain measured P1 work after page-integrity acceptance.

## OpenAI Chat Contract Compatibility Reflection

Decision: **keep the contract fix; require live Query and Format acceptance**.

The failures were deterministic request-contract errors, not model availability or output truncation. The client sent a provider-specific `thinking` object that is not part of OpenAI Chat Completions, while transport error handling hid the provider's immediate JSON explanation behind an artificial timeout.

Keep the standard-first request surface: `model`, `messages`, and only configured OpenAI fields such as `temperature`, `top_p`, `max_completion_tokens`, `response_format`, and opt-in `stream_options`. Keep numeric legacy thinking settings ignored; `max_completion_tokens` is the one portable total completion ceiling. Do not add `reasoning_effort` without an explicit model capability because the active endpoint rejects it.

Keep the corrected non-success reader. A complete JSON error must not depend on connection EOF, partial error bytes must survive the read deadline, and only a truly empty body may become `response_body_timeout`.

Do not start another force-reinit yet. Reload bundle `83454dbe6bbfa861ba89e1872af205866f747e3f74934f456f3380f33c5a7923`, run Query and Format once, and inspect both exact request lifecycles. If both succeed without HTTP `400`, resume clean reinit monitoring; otherwise use the now-visible provider error as the next evidence boundary.

## First SSE Event Retry Reflection

Decision: **keep the OpenAI contract fix; add bounded retry for accepted empty streams; rerun Query**.

Session `1784919493140` proves the request is now accepted but also exposes a timeout-layer race. HTTP `200` is not sufficient acceptance when an SSE body sends no event. The equal caller and native idle deadlines turned a retryable zero-output provider stall into terminal cancellation.

Keep the derived deadline rather than a new fixed setting. It adapts to the existing connection timeout, idle timeout, and retry count. Keep the full idle window after the first valid model event, and keep the no-replay rule after meaningful output.

Do not attribute this single exact stall to `max_completion_tokens: 32000` or prompt size: both controlled requests succeeded. Also do not classify it as the earlier schema error; the request received standard SSE HTTP `200` headers.

Reload bundle `f6616f447f03c86e436dbd7a929facecc73e8391b53b42ccbe7f51677dd3af09` and repeat Query. Accept transport behavior if it either completes on attempt 0 or records `response_start_timeout` near 150 seconds followed by a successful fresh attempt. Run Format only after this gate, then resume clean reinit.

## Query Empty-SSE Compact Repack Reflection

Decision: **reject identical transport replay; hand off the compact-payload variant for live Query acceptance**.

Session `1784923289519` proves the derived timeout works but also proves four fresh copies of one accepted payload are not a useful recovery strategy. Unique provider request IDs exclude one stuck pooled socket. Repeated HTTP `200` with no SSE bytes places the remaining failure inside the gateway/model path for the exact request, but client evidence cannot distinguish gateway queueing from model execution without provider-side logs.

Keep:

- the OpenAI-standard request surface;
- the derived 150-second first-event deadline;
- normal transport retries for connection, HTTP, and other transient failures;
- strict no-replay after meaningful output;
- configured input and output values as user ceilings.

Change for Query only:

- delegate the first `response_start_timeout` to the prompt planner;
- reduce optional context and submit a different fingerprint on a fresh connection;
- never resend a required-only prompt unchanged;
- do not label delegated recovery as terminal transport exhaustion.

Do not lower `max_completion_tokens: 32000` blindly: direct controls succeeded with that value. Live compact telemetry is the next causal test. If every progressively smaller fingerprint still receives HTTP `200` with zero SSE bytes, preserve the client fix but classify the remaining condition as provider-side and correlate the recorded provider request IDs at the gateway.

## Buffered Desktop Completion Reflection

Decision: **reject renderer SSE as normal desktop product transport; keep buffered host completion and require live Query acceptance**.

Raw-response identity was the strongest viable renderer SSE variant, and session `1784955341746` rejected it. The gateway can produce reasoning while Obsidian receives no body event even when no response or stream wrapper exists. Continuing to tune Undici ownership would repeat an invalid transport assumption.

Keep the standard OpenAI Chat Completions contract and phase-level `AsyncIterable` interface. Move only network delivery for normal no-proxy desktop clients: send `stream:false` through stable Obsidian host transport and adapt the completed response into existing phase chunks. Accept loss of incremental rendering on this route in exchange for deterministic completion, cancellation boundaries, and lower retry cost.

Do not remove batch, budget, schema, or domain validation controls as part of this transport repair. Proxy and explicit diagnostic routes may continue true streaming because they do not use the failing normal renderer path.

Reload bundle `5e021522125b7bccfe0f2df54df3fa3cb488b647855e6722048b68d82d51b077` and run the exact UFW Query. Accept when attempt 0 reports `non-stream/desktop-host`, reaches HTTP `200` and terminal success, and gateway records `stream:false` without client cancellation. Only then resume clean force-reinit.

Live decision: **accept buffered desktop completion and resume clean force-reinit**.

Query session `1784956634864` met every client acceptance criterion on attempt zero and completed in 11.923 seconds. The renderer-direct SSE failure is removed from normal desktop product execution rather than masked by another retry. Keep this routing for Query, Chat, Format, bootstrap, and ingest. The next experiment is one clean os-unix force-reinit followed by session, page-integrity, retry, and call-count audit.

Format session `1784956658532` confirms the same transport result across a second operation. Keep buffered routing. Do not classify its second call as a network retry.

Before treating Format quality as optimized, reconcile translation and preservation scopes. Exact preservation should cover identifiers, URLs, numbers, code, paths, product names, and governed frontmatter values; ordinary title-cased prose should be allowed to translate. The current broad Latin-title token heuristic forces avoidable repair and can reverse the requested output language. This P1 does not block clean reinit because ingest uses separate evidence and synthesis contracts.

## Post-Reinit Domain Quality Reflection

Decision: **keep transport and hybrid retrieval; reject generated domain; repair and rerun**.

Session `1784956783666` closes the transport question. It completed 106/106 HTTP responses with no retry, and the corrected ten-question Query run used embeddings and reranker without fallback. Do not change buffered desktop routing, increase the global token budget, weaken validation, or tune retrieval ranking based on the invalid headless fallback control.

The next P0 repair is content governance:

1. Establish server-owned create authority before consolidation. A parent is eligible only when it is an existing target or has a canonical create path. Pathless `bashrc -> node-js -> SKIP` routing must be impossible.
2. Add a per-source evidence ledger. Every validated fact and exact range must reach a create/patch section or a governed skip reason. Evidence-bearing zero-effect sources must fail instead of reporting successful completion.
3. Treat commands, configurations, URLs, UUIDs, versions, IPs, and numeric settings as exact governed evidence. Model-authored external URLs must be rejected unless they occur in supplied evidence.
4. Make timestamp and status server-owned and reconcile Related links against the final non-trash registry after all source files finish.
5. Apply the same boundary to Query: code/config lines absent from packed context must be repaired, omitted, or answered as insufficient. Evaluation must not count negated mentions as covered facts.

Retain domain-neutral taxonomy. A procedural source may use one deterministic source-primary coverage carrier plus reusable secondary entities; parent selection comes from source evidence, declared identities, existing targets, and canonical path authority, not hardcoded OS entity types.

Cost work remains P1. Batch size 1 generated 81 synthesis calls, but changing batch size before coverage and routing are correct would confound the next result. Dynamic batching and per-call output ceilings can be measured after a replay reaches 100% source effect, zero unsupported safety-critical instructions, and at least 9/10 manually grounded Query answers.

## Consolidation Path-Authority Reflection

Decision: **keep locally; require live replay**.

The first content-governance P0 is now deterministic and domain-neutral. Consolidation no longer treats evidence strength as sufficient routing authority: only an exact existing target or a server-owned canonical create path may own the final synthesis bundle. This directly removes the observed `bashrc -> node-js -> SKIP` class without weakening validation or hardcoding OS entity types.

Do not mark source coverage fixed yet. A source can still finish with evidence but no accepted page mutation when no actionable bundle exists or synthesis explicitly skips all bundles. The next separate bounded action is the per-source evidence ledger and zero-effect failure gate. Live confirmation follows after recreating the test vault and loading bundle SHA-256 `798a00178558b7214df864b7f564df18c4dd821f59d5857086bea9af65ac1130`.

## Configured-Profile Live Replay Reflection

Decision: **keep transport and reranker configuration; fix content routing and local Query validation**.

Session `1784979910443` closes live acceptance of the path-authority bundle as a stable execution candidate. All 104 requests completed through the buffered desktop route, bootstrap required no warm-up retry, strict validation produced only one recovered frame parse failure, and every persisted page passed structural integrity checks. Do not alter transport routing, increase global budgets, weaken validation, or increase synthesis batch size based on this run.

The generated domain is still rejected. Path authority prevents a pathless bundle from displacing a routable bundle, but the later hard entity cap still forces independent, routable entities into a nearest source-range parent. The observed network, storage, user-management, npm, SSH, and Fail2Ban merges prove that proximity and evidence strength are not semantic parent authority. This is a deterministic orchestration defect, not model obedience alone.

Keep the supported test-vault reranker model `lemonade-reranker-bge-reranker-v2-m3`. Its A/B pass improved mean expected-page recall from 36.83% to 50.67%, raised full fact coverage from 6/10 to 9/10, removed the extra link-repair call, and reduced output usage. No reinit is required for this settings-only Query change.

Next bounded fixes:

1. WikiLink validation must ignore fenced and inline code so TOML `[[runners]]` is not treated as a wiki target.
2. Entity count is a soft cost ceiling, not authority to merge independent routable entities. Only explicitly supporting/small evidence may consolidate; standalone bundles must remain separate and emit cap-overflow telemetry.
3. After those local fixes, add the per-source evidence ledger and exact technical-evidence gate before another full live reinit.

Run another full reinit only after these changes are built and delivered. Repeating the current bundle would consume about 47 minutes while reproducing the known content defects.

## Query Code Boundary and Soft Entity Target Reflection

Decision: **keep locally; deliver and rerun**.

The Query fix removes a deterministic false positive rather than relaxing citation validation. WikiLinks in prose remain closed over selected context article IDs; only syntax inside Markdown code is excluded. This should remove the observed GitLab Runner repair call without changing retrieval or answer grounding.

The entity fix corrects ownership semantics. A numeric cost control cannot authorize identity changes, so `synthesisMaxEntitiesPerSource = 6` remains recommended but becomes a soft target. Independent routable entities may exceed it and are still processed under `synthesisMaxEntityBatchSize = 1`. Increased synthesis-call count is an accepted correctness cost until an explicit semantic planner can classify supporting evidence.

Keep strict validation, buffered desktop transport, the supported reranker, and current budgets. Do not raise the per-source target to hide overflow and do not increase synthesis batch size during the next correctness replay.

The next live acceptance compares the same 22-source and ten-question corpus with session `1784979910443`. Required improvements are higher declared-entity and technical-evidence preservation, no unrelated consolidation events, no Query repair for code syntax, and continued zero transport retries. A separate per-source evidence ledger remains the next P0 if exact preservation is still below acceptance.

## Soft-Target Live Replay Reflection

Decision: **keep Query code-boundary fix; reject unrestricted create eligibility; fix and rerun**.

The soft target corrected one ownership error: independent routable entities were no longer merged solely because the configured count was exceeded. The live result exposed the opposite error. Because every typed mapper entity immediately received a server-owned path, routing authority was mistaken for evidence that a standalone page should exist.

Do not restore the hard cap and do not add an OS-specific command or taxonomy list. Add a separate domain-neutral eligibility layer before synthesis:

- existing canonical targets remain independent;
- strict source-range containment identifies supporting candidates;
- prior `wiki_articles` act only as bounded reuse hints, not permanent truth;
- independent non-contained candidates remain separate beyond the target;
- every consolidated candidate retains exact evidence in its parent bundle.

Keep buffered desktop transport, strict validation, batch size `1`, and the supported reranker. Treat the approximately 300-second HTTP `502` chains as a separate deadline-aware retry pass after content routing reaches acceptance.

## Evidence-Containment Page Eligibility Reflection

Decision: **keep locally; deliver and run one controlled replay**.

The new boundary removes the observed feedback loop without weakening validation or encoding domain-specific taxonomy. Plugin-owned backlinks no longer enter mapper evidence. Canonical paths remain deterministic server data, but only existing targets, independent source evidence, and a bounded subset of history-backed contained candidates receive standalone synthesis actions.

Do not raise budgets, restore the hard entity cap, or increase synthesis batch size for the next replay. Compare against session `1784986241654` using the same 22 sources and ten questions. Primary acceptance signals are lower page count and synthesis-call count without regression in declared coverage, exact technical preservation, source grounding, or zero structural/domain retries.

The latest restart loaded bundle `fd9c50f4aa09fc9bc96048595a2dd9f6bde9d11ebb10b8bb9e54bd4d2e5939b8`, not candidate `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`; therefore it is not a valid replay of this action.

## Evidence-Containment Live Replay Reflection

Decision: **fix**. Keep managed-frontmatter redaction and strict containment, but reject non-contained evidence as sufficient standalone-page authority.

The replay reduced pages from 136 to 122 and calls from 170 to 159, but it did not recover the configured-profile grounding baseline. Every surviving non-contained mapper candidate still received its own create action. This is why command and protocol fragments continued to dominate cost even though the managed-backlink feedback loop was removed.

Keep:

- buffered desktop completion transport;
- bootstrap attempt-zero behavior;
- strict schema, frame, path, alias, and domain validation;
- server-owned canonical routing;
- synthesis batch size `1` for this model;
- managed source-field redaction and evidence-preserving containment.

Fix next:

- select one domain-neutral source-primary coverage carrier;
- bound additional new standalone pages while never merging existing targets;
- move non-selected evidence into the source-primary article as named supporting sections;
- preserve exact ranges, snippets, facts, packet IDs, and links through consolidation;
- then add a separate exact technical-grounding gate for Query.

Do not treat the six transport retry events as the primary blocker. All recovered, bootstrap was clean, and only two calls hit the provider's approximately 300-second deadline. Deadline-aware compact retry remains P1 after content shape is corrected.

## Source-Primary Standalone Eligibility Reflection

Decision: **keep locally and continue with Query grounding before the next restart**.

The planner now gives the per-source setting enforceable meaning without restoring nearest-neighbour identity merges. Existing pages retain exact update authority; all new overflow is represented inside one source-owned carrier. Domain taxonomy and canonical routing remain unchanged.

One limitation remains explicit: prompt instructions alone cannot prove that the model copied every technical literal or retained every consolidated fact. The next bounded pass is therefore local exact technical validation for Query. A per-source synthesis evidence ledger remains a later P0 if the next reinit still loses source commands or values.

## Query Exact Technical Grounding Reflection

Decision: **keep locally and hand off for one combined live replay**.

The Query acceptance boundary is now deterministic. Prompt obedience remains useful, but executable and numeric technical content cannot reach final output unless it occurs exactly in the selected context or passes one locally revalidated repair. A later citation repair cannot bypass the boundary. Grounded answers retain the one-call path.

Keep:

- local exact technical validation;
- one fresh bounded repair at most;
- fail-closed insufficient-evidence output;
- code-aware WikiLink validation after grounding;
- compact Query prompt and post-reranker chunk priority;
- source-primary ingest planning, strict validation, server-owned routing, and synthesis batch size `1`.

The overall pipeline is not accepted yet. The candidate bundle is outside the running Obsidian process, and the test vault still holds the evidence-containment SHA. After delivery and restart, run one clean 22-source force reinit, audit page count/calls/evidence preservation, then repeat the fixed ten Query questions. Query acceptance requires zero returned unsupported technical units; ingest acceptance requires fewer pages and synthesis calls than session `1785000201763` without lower source coverage.

If the combined replay still loses exact source content inside generated pages, the next P0 is a synthesis evidence ledger. Do not add more Query retries, raise global budgets, weaken validation, or increase batch size in response.

## Query Deterministic Grounding Sanitation Reflection

Decision: **keep Query sanitation; fix synthesis evidence completeness**.

Deterministic sanitation removes the common dependence on model repair while preserving strict selected-context grounding. Span-level prose handling recovered useful content that line-level deletion removed, and heading/path boundary fixes eliminated validator-created retries. Keep one fresh model repair only as a bounded fallback for a non-empty answer that local sanitation cannot validate.

Do not raise Query budgets or retain unsupported source-like commands to meet the lexical score. The raw candidates average 90.14% required-fact coverage, but exact validation correctly removes facts absent from selected generated pages. The remaining gap is upstream: the source-primary reinit lost GitLab Runner commands, WD GREEN UUID/unit operations, NFS mount commands, SSH key-generation commands, and other exact source evidence.

Next bounded action: add a domain-neutral server-owned synthesis evidence ledger. Extract must-preserve technical units from each source independently of mapper prose, route every unit to an existing target or source-primary carrier, reject unsupported model-authored technical units, and fail a source when required evidence has neither a persisted representation nor an explicit governed disposition. Keep batch size `1`, canonical routing, strict validation, and current transport unchanged.

## Synthesis Exact Technical Evidence Ledger Reflection

Decision: **keep locally; deliver one controlled live replay**.

The implementation closes the upstream gap without shifting routing or content authority to the model. Full source fenced segments and URLs remain required through prompt packing, then deterministic local reconciliation proves their persisted representation. Unsupported model code and URLs are removed without repair, and a zero-effect technical source now fails before page writes.

Keep:

- server-owned canonical routing and source-primary consolidation;
- synthesis batch size `1` as the recommended weak-model setting;
- current 65,536 input ceiling and configured output/repair ceilings;
- field-framed synthesis, buffered desktop completion, strict schema/domain validation;
- Query deterministic sanitation and fail-closed technical grounding;
- item-level contiguous evidence coverage and metadata-only reconciliation telemetry.

Do not add dynamic budget growth for this pass. The largest measured source ledger is about 3,446 content tokens, and all bounded/full checks pass at current ceilings. Increasing budget would not replace the persisted-evidence guarantee.

Next action: copy bundle `8fa8190a3826a8f243a828b7ceca5b244a94d7e5313eaacb8dba1b9c466f4bb3` into the isolated test vault, restart Obsidian, and run exactly one clean 22-source force reinit. Accept only when all sources finish, unsupported page URLs are zero, page count stays at or below 85, and snippet/URL/value preservation improves over 60.15%/80.95%/44.19% with no ledger-driven model retry.

## Same-Target Canonical Bundle Repair Reflection

Decision: **keep locally; deliver and replay**.

The failure was a planner cardinality defect, not an invalid model path and not an output-budget problem. Alias resolution correctly reused the existing canonical page, but synthesis cardinality still followed mapper entity count. Consolidating exact same-target bundles before the LLM restores the required invariant: one target path has one synthesis owner per source transaction.

The completed old-bundle replay reinforces that classification: no structural repair or structured-validation retry occurred, and the single HTTP `502` recovered. Skipping `user.md` allowed the last source to complete, but the domain remained incomplete at 21/22. This run is a baseline, not acceptance evidence for the candidate.

Keep strict duplicate-path rejection as the final safety boundary. Do not weaken alias reuse, increase batch size, or ask the model to coordinate paths. Do not tune mapper output from the isolated recovered `502`; its small recovered output disproves cap pressure as the direct cause.

Next live replay must load candidate `e480ef6886565a331c371a2077e73c408a066c19f180d84b5cf2c3d4d853d25c`, complete `user.formatted.md` and `user.md` without duplicate-target rejection, expose a visible decision wait if another source fails, then finish the 22-source content and ten-query acceptance audit.

## Same-Target Live Replay Reflection

Decision: **keep transport, strict validation, same-target ownership, and exact evidence reconciliation; continue deterministic content fixes before replay**.

Session `1785045313209` closes the recurring transport/retry concern for the tested pipeline. All 123 calls returned HTTP 200, bootstrap succeeded on attempt zero, strict validation required no model retry, and 22/22 sources completed. Raising budgets or weakening validation has no supporting evidence.

The remaining failures are content orchestration:

1. Markdown-container fences and unfenced shell notes escaped the technical ledger.
2. Timestamp remains model-owned and stale on all 89 pages.
3. The page target is exceeded by four, and some overflow carriers are semantically weak.
4. Query selects correct pages but often omits their technical sibling sections before grounding sanitation.

Do not spend another full replay on only one of these known defects. Finish bounded deterministic fixes, rebuild one bundle, then rerun the same 22 sources and ten queries.

## Markdown Technical Evidence Boundary Reflection

Decision: **keep locally**.

The change fixes parser coverage, not model obedience. Nested fences remain exact source evidence regardless of list indentation, and script-like unfenced notes receive a conservative syntax-based boundary. The static 22-source scan raises ledger coverage to 97.21% of the existing audit sample at a maximum source cost of about 3,815 tokens, so no budget expansion is justified.

Next bounded action: make create/update timestamp and create status server-owned. Then address source-primary carrier quality/page count and Query sibling-section packing before delivering candidate `fb49fae99b2b427077fba136282e580fd2d06117dc0cd4c62427eb40622d450c` or its successor.

## Server-Owned Article Lifecycle Metadata Reflection

Decision: **keep locally**.

Lifecycle metadata is deterministic write state, not article content. One operation date now gives every changed page a coherent freshness marker, new pages start as stubs, and updates retain editorial maturity. This removes 89 stale timestamps without prompt changes, retries, or additional tokens.

Next bounded action: inspect source-primary carrier selection against the observed weak merges and page-count excess. Keep existing-target authority and the final path collision guard unchanged.

## Source-Primary Carrier Coherence Reflection

Decision: **keep locally**.

The previous planner treated model-authored range containment as semantic ownership. Evidence breadth is a safer domain-neutral primary signal, and one source carrier gives overflow a stable article context. No routing, taxonomy, validation, batch, or budget contract changed.

Do not change the code default from six pages yet. Set the isolated replay variant to five and compare page count, carrier quality, evidence preservation, synthesis calls, and ten-query coverage. Before delivery, complete the known Query sibling-section packing pass so one long replay measures the combined candidate.

## Query Article-Depth Context Packing Reflection

Decision: **keep locally and deliver the combined candidate**.

Raw top-N truncation maximized article breadth but starved article depth. Reserving one third of the same fixed slots for anchor siblings gives technical sections a deterministic path into grounding while retaining six distinct pages at the default `contextTopN: 8`. No extra retrieval, model call, retry, or token ceiling was added.

The combined replay should use source standalone target `5`, synthesis batch `1`, and existing budgets. Acceptance remains empirical: page count at or below 85, improved technical/value preservation, zero unsupported Query units, and mean ten-query fact coverage above 73.524%.

## Domain-Neutral Frame Repair and Query Candidate-Pool Reflection

Decision: **keep both general fixes; reject corpus-specific tuning**.

The synthesis retry chain was caused by protocol-state misclassification and mutable repair history. An incomplete field-framed response must stay in the frame error domain, and every repair must start from immutable request context. Neither rule depends on the tested wiki domain. The recovered HTTP `502` occurred only after the avoidable second repair had run for about five minutes; it is not evidence for a bootstrap transport change or a larger global budget.

The Query selector design was correct but unreachable because reranking had already truncated its candidate pool. Separating bounded candidate-pool size from final context size restored article depth with no extra model call, retry, or context slot. The fixed replay gained 10.476 percentage points of fact coverage and reduced latency and input tokens. A two-point expected-page-recall tradeoff is acceptable because required retrieval hit stayed at 100% and answer completeness improved materially.

Do not encode missing UFW, SSH, storage, or cache facts as heading priorities, command lists, aliases, or taxonomy rules. Any later sibling-ranking refinement requires a multi-domain benchmark and must preserve the current strict grounding boundary. Keep synthesis batch `1` as the tested weak-model recommendation, not as a consequence of the frame protocol.

Next acceptance action: install bundle `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`, restart Obsidian, and run one clean force reinit. Confirm that an incomplete action frame, if repeated, produces a frame-specific fresh repair without prompt growth or JSON-wrapper drift.

## Stable Grounding and Wire Compatibility Reflection

Decision: **keep three domain-neutral fixes; revert both retrieval ranking experiments**.

Keep:

- unambiguous mapper wire normalization and server-owned opaque packet IDs;
- bounded reranker candidates that always include article content;
- iterative deterministic grounding sanitation and residual-only repair input;
- strict entity, path, range, schema, link, and technical grounding validation.

Revert:

- later-article anchor rescue;
- sibling-slot ordering by retained reranker score.

The rejected selectors improved expected-page recall by two points but reduced answer fact coverage by 8.571 to 10.237 points and introduced one repair. That trade is not acceptable. No OS-specific heading, command, taxonomy, alias, or path preference should replace them.

The NFS failure was not provider transport and not a need for larger budgets. It was deterministic validation state: removing a number exposed new path tokens, then repair reused stale pre-sanitation data. Revalidation to a fixed bound resolves that class locally, while residual-only repair prevents avoidable prompt inflation across every domain.

Next action: deliver bundle `96a4053266325123816a9200fa4fbba6683e93176b68a6011d1bce8a87213178`, restart Obsidian, and run one clean force reinit. Live acceptance focuses on mapper structural retries, synthesis repair shape, transport recovery, persisted evidence, and the unchanged ten-query set.

## Guarded Conflict-Regeneration Format/Semantic Split Reflection

Decision: **keep**.

Conflict regeneration now retries only transport-complete output that cannot be parsed as the required field-frame protocol. Strict schema and domain checks run after that bounded parser loop, so a create action, malformed action shape, wrong entity, wrong path, stale page hash, or invalid section authority cannot consume a semantic repair request.

The change is local to guarded conflict regeneration. Normal synthesis retains its existing structured and semantic recovery policy. The request bounds are explicit and verified: valid output uses one request, malformed frames use at most two, parsed invalid output uses one, and a repeated stale conflict uses zero.

Next bounded action: correct Init terminal status after a file-level Retry succeeds, then deliver the combined bundle for live replay. Do not widen the shared retry runner or increase model budgets for this failure class.

## Guarded Conflict-Regeneration Live Bundle Replay Reflection

Decision: **keep the parser/semantic split; fix remaining quality gaps before closing the loop**.

The live bundle is operationally better: one clean bootstrap, 22/22 sources, 106/106 HTTP `200` responses, zero retries, 13.1% fewer calls, and a 39.1% shorter reinit than session `1785087161419`. No input or output budget increase is justified. The largest actual prompt was 18,221 tokens; the near-ceiling 63,478 value is a conservative local estimate dominated by duplicated evidence accounting.

The replay does not live-prove malformed conflict-frame recovery because no stale write triggered conflict regeneration. Keep the bounded implementation based on focused coverage and the absence of regressions, but add a deterministic integration trigger instead of waiting for provider randomness.

Do not accept the whole pipeline as complete yet. Query fact coverage is 91.809%, below the accepted 92.904% gate, even though every missed fact exists in generated pages. Source fidelity also misses 12/537 audited technical snippets. Both failures need domain-neutral deterministic work: trace ledger assignment/reconciliation gaps, and improve answer selection from already retrieved canonical pages without adding model retries, budgets, taxonomy rules, or OS-specific prompt exceptions. The successful-file-Retry terminal-status check remains pending because this run had no file-level retry.
