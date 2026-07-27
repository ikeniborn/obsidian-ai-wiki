# Dynamic LLM Budget Routing Context

## Research Question

Can per-call dynamic LLM output budgets and runtime parameters reduce hangs/retries more reliably than changing transport mode alone for os-unix reinit?

## Observed Baseline Facts

- With `undici-request-adapter`, `init.bootstrap-map` receives HTTP 200 and the latest measured full run reached `finish status=done`, but many runs had one early transport retry around `init.bootstrap`.
- With `diagnosticMode=off`, the stable no-headers retry disappeared, but `init.bootstrap-map` hung in `waiting` and was later cancelled.
- First bootstrap-map request is small on input (`~7069` estimated tokens), but inherits large output budget (`16384`) from the global chat setting.
- Prior synthesis fixes reduced path/entity retries, but current instability includes bootstrap/evidence and transport/runtime behavior.

## Metrics

- `first_http_ms`: elapsed time from session start to first `native_http_response`.
- `first_file_ms`: elapsed time from session start to first `file_start`.
- `transport_retries`: count of `transport_retry_scheduled`.
- `structural_retries`: count of `structural_error` where `succeeded` is not true.
- `status`: done, error, cancelled, or timeout.
- `created_pages`: sum from result text when available.
- `failure_reason`: final error, cancel, timeout, or none.

## Candidate Variants

- A: `diagnosticMode=off`, init output budget 16384.
- B: `diagnosticMode=off`, init output budget 4096.
- C: `diagnosticMode=connection-close`, init output budget 4096.
- D: `diagnosticMode=undici-request-adapter`, init output budget 4096.
- E: dynamic policy simulation from logs: map/bootstrap 4096, bootstrap 8192, synthesis by entity batch.

## Decision Threshold

Prefer the variant with `status=done`, zero or minimal structural retries, no unrecovered transport retries, and smallest first response/file latency. If only adapter mode succeeds, treat it as a transport compatibility candidate rather than a dev-only diagnostic.

## Repair Finding: Empty Output Fallback

Session `1784800324939` confirmed that the duplicate replace authority and unknown entity-key failures did not recur before the next blocker. The run created 15 pages, then `ingest.synthesize` returned an empty structured response. The runner switched `json_schema -> json_object`, but also appended a repair prompt to a synthesis context already near the `65536` repair input ceiling. That grew the retry prompt to `66929` estimated tokens and failed before transport.

The suspected surface is the structured-output empty-response fallback path, not domain validation. When response-format fallback is available, the retry can resend the same prepared messages with the downgraded response format instead of growing the prompt with a repair instruction.

## Repair Finding: Fallback Retry Accounting

Session `1784802036257` confirmed the prompt-growth fix: the run no longer failed with a repair budget overflow after empty output. It created 9 pages and reached the next synthesis batch. The new blocker was retry accounting: `Empty structured output` triggered `json_schema -> json_object`, then the downgraded response returned `No JSON object found`. Because the response-format fallback consumed the only structured retry, synthesis exhausted before it could send a normal schema repair prompt.

Response-format fallback is now treated as a small bounded format retry budget for structured JSON calls when `maxRetries > 0`. It can add up to two extra attempts for `json_schema -> json_object -> none`, while preserving the configured schema/repair retry budget.

## Repair Finding: Transient Embedding Endpoint Failure

Session `1784803891040` passed the latest synthesis blockers and wrote wiki pages, then failed during embedding refresh with `Embedding API error: 503` and backend code `model_unavailable`. The embedding cache refresh is atomic and a later re-run can self-heal missing vectors, but a transient 503 should not immediately fail the whole init/reinit when a retry can recover the batch.

Embedding refresh now retries each pending embedding batch up to three attempts for transient failures: HTTP `429`, HTTP `5xx`, connection/timeout failures, and backend messages such as `model_unavailable` or `temporarily unavailable`. The index write remains atomic: if all retry attempts fail, the previous index bytes are preserved and the ingest outcome still fails at the embedding stage.

## Repair Finding: Single-Bundle Entity Coverage Freedom

Session `1784804535754` produced the best first-source result so far: 12 pages with no structural or semantic retries. The second source then exposed remaining synthesis freedom inside single-bundle calls: duplicate action coverage, invented entity keys such as `profile_file` for an allowed `ufw` bundle, and repeated empty-output fallbacks eventually exhausted synthesis for `ufw`.

For a single-bundle synthesis request, the model should not choose coverage routing at all. The server now canonicalizes single-bundle coverage after shape parsing and before semantic validation: action and skip `entityKey` values are rewritten to the only allowed bundle key, create paths are rewritten from server-owned `createPathsByEntityKey` when available, skips are removed when an action exists, and duplicate action coverage is collapsed deterministically. Multi-bundle outputs still use strict semantic validation and split/repair behavior.

## Repair Finding: Query Stream Options Compatibility

Query session `1784807651320` failed before answer generation with HTTP `400 Unsupported parameter: stream_options.` on `query.answer`. The body was read fully and the request had valid prompt budget telemetry, so this is not a transport/read failure. The target OpenAI-compatible backend accepts chat requests but rejects `stream_options.include_usage`.

The query/chat streaming path now detects this capability mismatch and retries the same streaming request once without `stream_options`. This keeps streaming behavior when the backend supports plain streaming and avoids falling into semantic/domain repair.

## Repair Finding: Evidence Mapper Structural Noise

The successful reinit session `1784806127418` reached `status=done`, created 17 pages from 22 source files, and had zero semantic validation retries. Remaining retry volume came mostly from `ingest.evidence-map` schema noise where the model returned compact `noEvidence` values without the required object shape.

The mapper wire schema now normalizes compact `noEvidence` strings/summary objects into `{ chunkId, reason }` for the current chunk only. Public validation still rejects foreign chunks and mixed packet/noEvidence coverage.

Mapper repair prompts also stopped embedding raw Zod issue messages because those can include raw invalid model values and grow the repair prompt. Evidence structural diagnostics now forward sanitized messages only, and mapper chunk planning keeps a small safety margin so estimates do not sit exactly on the input budget boundary.

## Repair Finding: Synthesis Repair Reserve

Session `1784808634361` processed the first two source files with zero semantic retries, then failed on the third file during `ingest.synthesize`. The initial synthesis request was accepted by preflight at `65245` estimated input tokens against a `65536` budget, returned HTTP 200, and then failed JSON parsing with `No JSON object found`. The compact repair retry needed `66861` estimated tokens and failed before transport.

The remaining issue was not a larger global budget requirement. The packing step allowed a first synthesis prompt too close to the ceiling while structured repair was enabled. Single-bundle synthesis now reserves dynamic headroom before the first request when a repair retry is possible: 5% of the effective input budget, bounded between `512` and `2048` tokens. At the current `65536` budget this reserves `2048` tokens, forcing prompt compression before the first call and leaving room for compact repair.

The same pass fixed a latent compression loop: `truncateForPromptBudget` used to append the truncation marker after slicing, which could make near-minimum strings longer and prevent convergence under tighter packing budgets. The marker is now included inside the target length.

## Repair Finding: Synthesis Bundle Size Sources

The `65245` token synthesis bundle from session `1784808634361` was a single entity bundle, not a multi-entity batch. The size came from a heavy synthesis payload for `ОС/Unix/Ubuntu/Nobles/AMD Driver.md`: evidence-map produced roughly `10045` output tokens, retrieval reported `17/17 pages retrieved`, and synthesis serialized contracts, evidence, exact source text, retrieved wiki sections, page descriptions, and registry data into one prompt.

Synthesis now emits a metadata-only `prompt_breakdown` event for `ingest.synthesize`. It reports estimated token contribution for contracts, evidence, context units, page descriptions, and registry, plus safe counts for bundles, entities, wiki sections, facts, ranges, source snippets, links, page descriptions, and registry units. The event deliberately contains no source text, paths from raw model output, or omitted content.

Synthesis also now caps optional retrieved wiki sections per entity to six, while preserving required target sections for patch safety. Exact source text sent to synthesis is shortened to a bounded snippet with the validated line range retained; mapper/reducer remain responsible for evidence range validation.

## Repair Finding: Bootstrap Transport Warm-Up

Repeated reinit runs showed a recoverable transport retry at `init.bootstrap` before file processing. This happened even after synthesis budget and routing fixes, and the request body was small relative to synthesis. The signal points to a connection-establishment/reuse problem on the first bootstrap request rather than prompt-size pressure.

Bootstrap is the right place for a scoped transport warm-up/fresh-connection policy because it is the first structured native OpenAI call in the run and is not performance-critical compared with later synthesis batches. The policy should not be global: applying it to every native request would hide connection-pooling behavior and add overhead to high-volume ingest/query paths.

Session `1784811298973` showed that the first implementation of this policy conflicted with the test-vault `undici-request-adapter` override. `init.bootstrap-map` succeeded with the adapter, then `init.bootstrap` attempted the fresh direct fetch path because the diagnostic transport still reports `desktop-direct` as the network transport. That produced an immediate `fetch_error TypeError` and the retry attempt stalled before the injected fetch boundary. The policy must therefore be scoped by effective diagnostic mode, not only by network transport.

Session `1784811816505` showed the adapter guard removed the retry hang but not the first `init.bootstrap` retry. The pattern was: `init.bootstrap-map` completed body read, `init.bootstrap` began immediately afterward, and attempt 0 failed at fetch level in 1 ms before HTTP headers. Attempt 1 recovered. This points to an overlap between the prior isolated adapter dispatcher shutdown and the next request, because the adapter finalizer fired `dispatcher.close()` without awaiting completion before the response body completed to the SDK.

Session `1784812601637` showed that awaited dispatcher close alone did not remove the first `init.bootstrap` retry. The remaining pattern is a hot back-to-back runtime edge: `init.bootstrap` started about 28 ms after `init.bootstrap-map` SDK completion, failed in 2 ms before HTTP, and the built-in retry recovered when the next attempt started roughly 1.2 seconds after `init.bootstrap-map` completion. A bootstrap-specific settle barrier can replace this failed attempt with a deterministic one-time wait that is shorter than the observed retry path.

Session `1784813242526` showed that a 750 ms settle barrier was still below the stable window: `init.bootstrap` started about 765 ms after `init.bootstrap-map` completion and still failed in 1 ms before HTTP. The next retry start around 1.2 seconds remained the successful boundary. The barrier is therefore set to 1500 ms for the next validation run.

## Transport Regression Research: Pre-0.1.200 Baseline

### Research Question

Did a client transport change after release `0.1.199`, rather than the model or gateway, introduce the repeated `HTTP 200 headers -> zero body bytes -> timeout` failure seen during bootstrap?

### Baseline

- Release `0.1.199` and `0.1.200` both let the OpenAI SDK use its default desktop fetch when no proxy was configured.
- The `0.1.199 -> 0.1.200` diff contains no transport changes.
- Current test-vault sessions use the custom desktop `undici` transport, request-scoped retry executor, and response-body observer added after `0.1.204`.
- Session `1784832560599` received HTTP 200 headers twice, advertised non-zero content lengths, then read zero body chunks until abort.

### Metrics

- `attempts`: identical non-stream requests per transport variant.
- `headers_ok`: requests receiving HTTP 200 headers.
- `body_ok`: requests whose body reaches the SDK completely.
- `zero_body_stalls`: HTTP 200 responses with non-zero content length and no first body chunk before timeout.
- `first_body_ms`: time from request start to first observed body chunk.

### Decision Threshold

Treat the issue as a client regression only if an A/B run against the same endpoint and prompt reproduces stalls with the current wrapper while the pre-wrapper/default SDK path succeeds. A source-code timeline alone is insufficient evidence.

## Repair Finding: Canonical Type Versus Wiki Subfolder

Live page-integrity replay session `1784901066143` passed bootstrap on attempt 0 and wrote six parseable pages for the first source. Immediate disk audit found a server-owned metadata regression: `!Wiki/os-unix/configurations/wiki_os-unix_profile.md` contained `type: configurations`, while the configured entity type is `configuration` and its `wiki_subfolder` is `configurations`.

The model response was not responsible. `processPageContent` stripped the model's valid singular type and called `entityTypeFromPath`, which returns the raw folder segment. The initial regression used `concept -> concept`, so it did not exercise a type whose folder has a different name.

The bounded repair must reverse the configured `effectiveSubfolder(entityType)` mapping before serializing canonical frontmatter. Raw folder fallback remains only for legacy or unconfigured paths. Strict path routing, tags, provenance, alias ownership, and write CAS remain unchanged.

## Repair Finding: Corrected Replay Terminal Failure

Corrected live session `1784901643760` reached 18/22 sources with 107 LLM calls, zero transport retries, and complete HTTP 200 bodies. It then failed while applying `usb.md`: a guarded patch for `ubuntu-24-04-lts` encountered a write conflict, and the one-shot conflict regeneration returned replacement section content containing a top-level `##` heading. Strict synthesis validation rejected that content and the source ingest had no further recovery path.

The same replay exposed two additional deterministic repair opportunities:

- `swap.md` mapper output represented `exactSourceRanges` as unambiguous `[startLine, endLine]` tuples instead of range objects, causing a schema repair request.
- Alias guarding allowed a sole alias owner whenever that page was one of the primary owners, even when another page owned the same primary identity. The guard must require that the alias owner is the only primary owner.

The first post-run audit also classified localized titles such as `Глобальная конфигурация npm` and `Настройка кэширования Linux` as the bare identities `npm` and `linux`. The alias matcher reused the ASCII wiki-stem slugifier, which discards non-Latin letters. Alias ownership needs a Unicode-preserving canonical identity; wiki filenames and entity keys remain under the existing ASCII contract.

The bounded repair surface is therefore conflict-section normalization/retry, safe mapper range normalization before strict validation, a Unicode-safe alias identity, and the alias primary-owner predicate. Transport policy, canonical path routing, and domain type governance are unchanged.

## Repair Finding: Server-Owned Mapper and Article Shape

Clean replay session `1784909821666` completed all 22 sources in 2,955,994 ms with 118 complete HTTP responses, zero transport retries, and no terminal error. The preceding `usb.md` conflict-regeneration failure did not recur. Page metadata, provenance, type-folder routing, and alias ownership remained valid.

The run still failed P0 acceptance for deterministic contract reasons:

- `Gitlab runner.md` and `logrotate.md` each needed two mapper retries because the model copied a single-chunk `chunkId` with the final hash character missing. The third response copied the server-known identifier correctly.
- `swap.md` needed one synthesis repair because the model emitted `create` for the existing canonical target `linux`.
- `npm.md` persisted `#.bashrc` without the Markdown-required space, leaving one page without a valid H1.

The bounded repair must remove those choices from the model where the server has exactly one answer: canonicalize mapper packet/no-evidence chunk IDs to the sole requested chunk before strict source-range validation; derive synthesis action kind from resolved target presence; and validate or safely normalize the article's first H1 before write. Ambiguous multi-chunk IDs, unsafe create-to-patch conversion, extra H1s, and other malformed Markdown remain strict failures.

The replay also recorded P1 signals that are not part of this repair: one bootstrap output-limit retry (`4096 -> 6144`), one evidence-map output-limit retry (`16384 -> 24576`), 118 total calls, recurring dead links to consolidated entities, and a thematic tag registry warning (`15/12`). These require separate budget/cost and content-quality experiments after P0 correctness.

## Repair Finding: Streaming Compatibility and Error-Body Stall

Query session `1784914297075` completed retrieval and packed 8 source chunks into a valid `12974/16384` prompt, then received HTTP `400` headers on `query.answer` after 55 ms. The desktop direct response exposed `application/json` but delivered zero observed body bytes until the user cancelled after 152.5 seconds. Because the OpenAI SDK never received the provider error body, the existing Query retry without `stream_options` could not run.

A direct endpoint probe reproduced the provider contract deterministically: a minimal streaming request with `stream_options.include_usage` returned `400 Unsupported parameter: stream_options.`, while the same request without that optional field returned HTTP `200` SSE chunks and `[DONE]`. Fresh curl, undici, and the project fetch wrapper all read the 400 body immediately, so the long body stall is a client/runtime edge on the long-lived pooled direct transport, not a prompt or model-budget failure.

Format session `1784914453224` then failed its first direct-stream fetch in 6 ms and retried through the same shared dispatcher, where it remained pending. This makes the repair cross-operation: Query, Chat, Format, and streaming structured calls all inherit `buildChatParams` and the same direct transport.

The bounded repair is to omit optional stream usage metadata by default, preserve explicit opt-in compatibility fallback, bound non-success HTTP body reads independently from the model idle timeout, and isolate native retry attempts from a potentially unhealthy pooled connection. Prompt packing, retrieval, domain validation, and non-stream desktop-host routing remain unchanged.

## Repair Finding: Accepted SSE Headers With No First Event

After the OpenAI request-contract repair, Query session `1784919493140` no longer received HTTP `400`. Attempt 0 received HTTP `200` and `Content-Type: text/event-stream` after 1,464 ms, but the provider sent zero response-body bytes and zero chunks for the full operation window. The outer 600-second Query watchdog won the race with the native 600-second idle timer, classified the lifecycle as cancelled, and prevented the native retry policy from running.

Two controls reject prompt size and configured output ceiling as sufficient causes. A standard short request with `max_completion_tokens: 32000` completed in 2.1 seconds. A Query-shaped request with 12,973 input bytes, the same model, temperature, and completion ceiling produced meaningful output after 1.56 seconds and completed after 10.69 seconds. The failed exact request is therefore a transient accepted-response stall at the provider/body boundary.

The bounded repair must give a stream with no first valid SSE event its own retryable deadline before the outer operation watchdog. Derive that deadline from the configured idle window, connection window, and retry count so no new user setting or model-specific constant is required. Once the first valid model chunk arrives, retain the full configured inter-chunk idle timeout. Never retry after meaningful output.

## Repair Finding: Gateway-Correlated Renderer Stream Cancellation

Two exact Query attempts now have end-to-end correlation. For session `1784929303448`, client attempt `aiwiki-mrzgtlix-1-7cduwi43qo` received HTTP `200` after 1.66 seconds. Gateway audit recorded backend reasoning text `We need to answer`, then `terminal_state=client_disconnected` at `2026-07-24T21:41:45.808472Z`, within about one millisecond of the plugin's HTTP response event. The plugin's body observer started with zero bytes and remained blocked until the derived 150-second first-event deadline.

This reproduces the prior correlated attempt after removal of the inner `undici.Response` reconstruction. Therefore the inner wrapper was not the full cause. The remaining successful SSE path still acquires a reader from the raw Undici body, creates a renderer-global `ReadableStream`, and constructs a renderer-global `Response` before returning to the OpenAI SDK. Live evidence now rejects that remaining cross-runtime bridge.

A low-level `undici.request` control against the same endpoint and model completed normally: HTTP `200`, first body byte after 1,333 ms, 4,605 response bytes, OpenAI `[DONE]`, and EOF after 1,770 ms. The gateway therefore supplies a complete standard SSE response when the client retains ownership of the original body.

The bounded repair is to return successful desktop-direct streaming responses to the OpenAI SDK unchanged. Body reconstruction, renderer stream bridging, and transport-owned `[DONE]` cancellation must not run on that path. Non-stream host buffering, non-success body bounding, mobile/proxy behavior, caller abort, and response-start timeout policy remain unchanged.

## Repair Finding: Raw Undici SSE Still Stalls in Obsidian

Live session `1784955341746` loaded the verified raw-response bundle and repeated the exact UFW Query. Attempt 0 received HTTP `200` after 1,523 ms and emitted `fetch_headers` without `body_start`, proving the new raw handoff path was active. No valid model chunk reached the executor, and the request hit the 150-second response-start deadline before Query scheduled its compact retry.

This rejects response reconstruction as the root cause. The remaining failing component is `undici.fetch` response-body delivery inside the long-lived Obsidian Electron renderer. Node and standalone controls are not representative enough to approve renderer streaming.

The project already has a proven host-buffered compatibility path. `wrapMobileNoStream` converts requested streaming calls to standard Chat Completions `stream:false`, removes `stream_options`, lets Obsidian `requestUrl` buffer the response, then adapts the completion back to the `AsyncIterable` contract expected by Query, Chat, Format, and structured phases. Normal desktop non-stream ingest has already completed full replays through this host route with zero transport retries.

The next bounded repair is to generalize that wrapper and apply it whenever the selected normal desktop transport is `desktop-hybrid`. This eliminates renderer Undici from production no-proxy calls. Mobile behavior remains equivalent; proxy and explicit development diagnostic transports retain real streaming. The accepted tradeoff is buffered desktop UI delivery instead of incremental deltas.

## Post-Reinit Domain Quality Research

### Research Questions

1. How faithfully does the generated `os-unix` domain preserve the facts, commands, URLs, numeric values, and intended entities present in its 22 source notes?
2. Can domain retrieval and Query answer ten representative questions with relevant, source-grounded content and canonical WikiLinks without retries?

### Metrics

- `source_completion`: completed source files divided by the 22-file input set.
- `source_page_coverage`: source files referenced by at least one generated page divided by completed source files.
- `declared_entity_coverage`: source `wiki_articles` identities resolved to a canonical page title, stem, or alias.
- `command_preservation`: distinct source command/config lines found verbatim in pages carrying that source in `resource`.
- `url_preservation`: distinct source URLs found in pages carrying that source in `resource`.
- `numeric_preservation`: source technical numeric literals retained in attributed pages, with manual review of flagged omissions.
- `unsupported_claim_rate`: sampled generated factual claims not supported by any page-attributed source.
- `page_integrity`: valid YAML, canonical type-folder routing, one H1, source provenance, unique aliases, and no unresolved internal links.
- `query_retrieval_hit_at_k`: questions whose expected source/page appears in selected Query context.
- `query_answer_grounded`: answers whose material claims are supported by selected domain pages.
- `query_answer_complete`: questions whose required answer points are present.
- `query_link_precision`: emitted WikiLinks resolving to canonical domain pages.
- `query_retry_rate`, `query_latency_ms`, and actual input/output tokens per question.

### Decision Threshold

Accept the domain only if reinit completes 22/22, deterministic page integrity has no P0 failures, source-page coverage is 100%, all ten Query runs complete, retrieval hit@k and WikiLink precision are 100%, grounded-answer pass rate is at least 90%, and no key source-level entity is lost through consolidation or pathless create routing. Any source processed with zero page effect or any unsupported safety-critical command is a P0 failure regardless of aggregate score.

## Repair Finding: Same-Target Alias Bundles

Live session `1785040016216` reached 20/22 sources with 116 completed LLM calls before `user.md` failed strict apply validation. The rejected path, `!Wiki/os-unix/concepts/wiki_os-unix_user_management_commands.md`, was canonical, existed on disk, and had valid `concept` metadata. The failure came from the duplicate-path guard after several evidence entities such as `userdel` and `usermod` independently resolved through aliases to that same existing page and each synthesis batch produced a patch action for it.

The model did not invent this path: the server supplied it as the target in each single-bundle prompt. Allowing duplicate writes after synthesis would be unsafe because independently generated patches can conflict or lose evidence. Bundles that share one server-resolved existing target must therefore be consolidated before batching and synthesis. The carrier must retain all packet IDs, facts, exact ranges/text, links, required context units, replace authorities, and consolidated entity keys. The existing duplicate-path apply guard remains strict.

After the deterministic failure, init awaited the configured `onFileError` decision. The absence of `file_done` and terminal `system` events while the Retry/Skip/Stop dialog was open was expected control flow, not a lost Promise. The wait should still emit an explicit progress event before and after the user decision so logs and monitoring do not misclassify it as a hang.

The same session recorded one transport retry: a small `Keyboard shortcuts custom.md` mapper request received HTTP `502` at the gateway's approximately 300-second boundary and recovered on attempt 1 in about 14.7 seconds. This was 1/116 completed calls. The recovered response used only 1,902 output tokens, so current evidence does not prove that the configured 16,384 output ceiling caused the stall. A lower mapper ceiling remains a candidate only if repeated correlated runs show output-limit or long-generation causality; changing it now could trade one recovered transport retry for deterministic output-limit retries.

## Research Finding: Wire-Shape Noise and Reranker Content Starvation

### Research Question

Can domain-neutral local normalization remove mapper retries that carry no semantic choice, and can the existing reranker budget rank article content instead of duplicated path metadata?

### Baseline

- Reinit session `1785068631709` completed 22/22 sources with strict validation, but used five structural repairs.
- Two repairs were semantically unambiguous mapper wire defects: eight packets used singular `exactSourceRange` instead of one-element `exactSourceRanges`, and one mapper response reused opaque packet ID `p1`.
- The entity-key/type conflict remains semantically ambiguous and must stay strict.
- The configured reranker candidate cap is 120 characters. A representative generated page needs 132 characters for `Title + Path + Heading + Text:` before any article body is included, so the reranker frequently sees zero content.
- The fixed ten-query baseline is 10/10 complete, zero Query retry, zero invalid WikiLinks, and 92.904% required-fact coverage.

### Metrics

- mapper structural retries attributable to singular range shape or duplicate opaque IDs;
- candidate body characters available to reranking under the unchanged 120-character cap;
- fixed ten-query completion, retry count, invalid links, fact coverage, latency, and tokens;
- retrieval of seeded technical sub-entity pages and relevant sibling sections.

### Decision Threshold

Keep the pass only if singular range and duplicate packet-ID fixtures pass without repair while malformed ranges, unknown entity keys/types, and source-bound violations still fail. Every non-empty reranker chunk must expose a query-aware body excerpt without increasing the configured candidate cap. The ten-query replay must keep 10/10 completion, zero retries, zero invalid links, and must not regress below the 92.904% fact-coverage baseline.

## Research Finding: Article Anchor Boundary Loss

The reranker-content experiment completed 10/10 fixed queries with zero retry, zero invalid WikiLinks, and 93.142% fact coverage. It disproved reranker text starvation as the immediate cause of the remaining SSH miss.

For the SSH case, `wiki_os-unix_ssh_keygen` was seed article 4, raw chunk 13, and reranked article anchor 7. The final context admitted six article anchors. Anchor 6 (`wiki_os-unix_rc_local`) had chunk score `0.5211` and article score `0.0141`; the excluded keygen page had nearly equal chunk score `0.5155` and article score `0.0313`. The fixed first-N article boundary therefore discarded strong article-stage evidence in favor of a marginally stronger chunk from a much weaker article.

One conservative article rescue is justified when a later candidate Pareto-dominates an admitted anchor across the two independent retrieval stages: its chunk score is within 95% of the anchor and its article score is more than `1 / 0.95` times stronger. This does not use entity names, taxonomy, paths, headings, or language.

## Research Finding: Per-Chunk Reranker Scores Are Discarded

The NFS ranking trace shows that page-aware reranking uses the maximum reranker score to order pages, then interleaves each page's chunks in baseline order. Individual reranker scores are not attached to returned chunks and cannot affect sibling selection. As a result, `selectQueryContextChunks` picks whichever sibling appears first in the page interleave, not the sibling the reranker scored highest for the question.

This is independent of the test domain. Any multi-section article loses section-level reranker information whenever page-aware promotion is enabled. The safe repair is narrower than full chunk reranking: keep page anchors and guarded page order unchanged, retain each valid per-chunk score as telemetry on the returned chunk, and use it only to choose the already-budgeted sibling slots. Disabled, timeout, malformed, and missing-model fallbacks must preserve the existing order exactly.
