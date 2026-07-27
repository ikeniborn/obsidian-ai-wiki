# Dynamic LLM Budget Routing Checks

## Evidence

| Variant | Session | Status | First output budget | Transport | Transport retry | Structural retries | Result |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| `undici-request-adapter + 16384` | `1784753985275` | done | 16384 | recovered | 1 | 0 | 12 pages created |
| `off + 16384` | `1784754420415` / `1784754904402` | cancelled | 16384 | no HTTP | 0 | 0 | hung before first HTTP |
| `off + 4096` | `1784779632951` | cancelled | 4096 | no HTTP | 0 | 0 | hung before first HTTP |
| `connection-close + 4096` | `1784780697842` | cancelled | 4096 | not recovered | 1 | 2 | capped/empty output, stalled |
| `undici-request-adapter + 4096` | `1784781335222` | done | 4096 | recovered | 1 | 22 | completed slowly, many repairs |
| `undici-request-adapter + 4096 rerun` | `1784782121039` | running at checkpoint | 4096 | recovered | 1 | 21 | repair loop, degraded output |
| `undici-request-adapter + 16384 high budget` | `1784782915944` | failed | 16384 | recovered | 1 | 1 | first file created 7 pages; synthesis repair exceeded input budget |
| `undici-request-adapter + output 16384 + input 65536` | `1784794138147` | failed | 16384 | recovered | 1 | 5 | first file created 6 pages; budget overflow gone; synthesis schema exhausted on `etc-exports` |

Evidence files are under `docs/loen/dynamic-llm-budget-routing/evidence/`.

## Current Finding

`4096` is not only an init budget. In current reinit routing, operation `init` options are forwarded into the nested ingest path, so `init.maxTokens = 4096` caps `ingest.evidence-map` and `ingest.synthesize` during reinit. This explains repeated schema repairs and degraded page formation.

The high-budget run confirms the cap finding: `ingest.evidence-map` produced `6206` and `6152` output tokens, so a `4096` cap truncates the evidence JSON. With `16384`, cap-related evidence-map failures disappeared.

Remaining failure: after one `ingest.synthesize` schema error, bounded repair failed before model call with `Prompt requires 33034 estimated tokens but budget is 32768`. This is an input-budget/repair-context issue, not an output-budget issue.

The 65536 input-budget run confirmed that diagnosis: synthesis requests reached `60238`, `45282`, `52369`, and `59875` estimated input tokens and were sent instead of failing before transport. It then failed on repeated synthesis schema errors:

- invalid `sections[0].operation` discriminator;
- missing `sections[0].content`;
- top-level H2 inside section content;
- bootstrap-map `Unknown source chunk 0:1-65`.

Therefore the remaining problem is no longer transport or output truncation. It is synthesis contract obedience under large repair context.

## Implementation Checks

```bash
node --import tsx --test tests/model-call-policy.test.ts tests/structured-output.test.ts tests/settings-model-controls.test.ts
```

Result: pass, 80 tests.

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts
```

Result: pass, 81 tests.

```bash
npm run build
```

Result: pass.

## Bootstrap Fresh Transport Checks

```bash
node --import tsx --test --test-name-pattern "fresh connection|successful init bootstrap uses one direct" tests/native-llm-executor.test.ts tests/native-openai-transport.test.ts tests/init-bootstrap-fail-loud.test.ts
```

Result: pass, 3 matching tests.

```bash
node --import tsx --test tests/init-bootstrap-fail-loud.test.ts tests/native-llm-executor.test.ts tests/native-openai-transport.test.ts tests/query-budget.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 178 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Bootstrap Fresh Transport Adapter Guard Checks

```bash
node --import tsx --test --test-name-pattern "fresh connection" tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts tests/init-bootstrap-fail-loud.test.ts
```

Result: pass, 3 matching tests.

```bash
node --import tsx --test tests/init-bootstrap-fail-loud.test.ts tests/native-llm-executor.test.ts tests/native-openai-transport.test.ts tests/query-budget.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 179 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Awaited Adapter Dispatcher Close Checks

```bash
node --import tsx --test --test-name-pattern "dispatcher close|fresh connection|successful init bootstrap uses one direct" tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts tests/init-bootstrap-fail-loud.test.ts
```

Result: pass, 5 matching tests.

```bash
node --import tsx --test tests/init-bootstrap-fail-loud.test.ts tests/native-llm-executor.test.ts tests/native-openai-transport.test.ts tests/query-budget.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 180 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Bootstrap Settle Barrier Checks

```bash
node --import tsx --test --test-name-pattern "successful init bootstrap uses one direct|fresh connection|dispatcher close" tests/init-bootstrap-fail-loud.test.ts tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts
```

Result: pass, 5 matching tests.

```bash
node --import tsx --test tests/init-bootstrap-fail-loud.test.ts tests/native-llm-executor.test.ts tests/native-openai-transport.test.ts tests/query-budget.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 180 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Bootstrap Settle Window Adjustment Checks

```bash
node --import tsx --test --test-name-pattern "successful init bootstrap uses one direct|fresh connection|dispatcher close" tests/init-bootstrap-fail-loud.test.ts tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts
```

Result: pass, 5 matching tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Synthesis Bundle Shaping / Telemetry Checks

```bash
node --import tsx --test tests/ingest-synthesis.test.ts
```

Result: pass, 53 tests.

```bash
node --import tsx --test tests/query-budget.test.ts tests/ingest-evidence.test.ts tests/ingest-synthesis.test.ts tests/structured-output.test.ts tests/prompt-budget-diagnostics.test.ts
```

Result: pass, 197 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Replay After Query Stream Options / Evidence Mapper Fix

Session `1784808634361`:

- `init.bootstrap-map` completed on the first attempt;
- `init.bootstrap` had one recoverable transport retry and then completed;
- first two source files completed with zero semantic validation retries;
- 17 pages were created before the third source;
- third source failed in `ingest.synthesize` after JSON parse failure because repair prompt required `66861` estimated input tokens against the `65536` repair input ceiling;
- initial request was already near ceiling at `65245`, leaving only `291` tokens for retry growth.

## Synthesis Repair Reserve Checks

```bash
node --import tsx --test --test-name-pattern "context repack never drops required registry" tests/ingest-synthesis.test.ts
```

Result: pass.

```bash
node --import tsx --test tests/query-budget.test.ts tests/ingest-evidence.test.ts tests/ingest-synthesis.test.ts tests/structured-output.test.ts
```

Result: pass, 195 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

```bash
npm run lint
```

Result: pass with 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

## Compact Repair Checks

```bash
node --import tsx --test tests/structured-output.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 99 tests.

```bash
npm run build
```

Result: pass.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

## Replay After Compact Repair

Session `1784798787169` confirmed improvements and exposed the next failure class:

- transport recovered;
- first file created 6 pages;
- synthesis section-shape errors did not recur;
- evidence-map still produced `Unknown source chunk 0:1-64:fnv1a:f7c171dd`;
- synthesis hit `Empty structured output` at `output=16384`, recovered past JSON mode fallback;
- batch split occurred on `duplicate replace authority record`;
- semantic repair repeated `unknown entity key: profile_proxy_env_config`;
- final error: `ingest: synthesis failed — duplicate replace authority record`.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/h-compact-repair-replay-1784798787169.json`.

## Duplicate Authority / Entity-Key Repair Checks

```bash
node --import tsx --test tests/ingest-synthesis.test.ts
```

Result: pass, 51 tests.

```bash
npm run build
```

Result: pass.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

## Replay After Duplicate Authority / Entity-Key Repair

Session `1784800324939`:

- transport recovered;
- first source created 7 pages;
- second source created 8 pages;
- no semantic validation retries were observed before failure;
- no `duplicate replace authority record` recurrence;
- no `unknown entity key: profile_proxy_env_config` recurrence;
- one `No JSON object found` structural repair recovered;
- final blocker: `ingest.synthesize` empty output fallback grew the retry prompt to `66929` estimated tokens over the `65536` repair ceiling.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/unknown-1784800324939.json`.

## Empty Output Fallback Budget Checks

```bash
node --import tsx --test tests/structured-output.test.ts
```

Result: pass, 51 tests.

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/model-call-policy.test.ts
```

Result: pass, 93 tests.

```bash
npm run build
```

Result: pass.

## Replay After Empty Output Fallback Budget Fix

Session `1784802036257`:

- transport recovered;
- bootstrap-map had one recoverable `Unknown source chunk 0:1-65:fnv1a:f96e1200`;
- first source created 9 pages;
- no repair budget overflow occurred after `Empty structured output`;
- final blocker: `Synthesis structured output exhausted for exportfs: No JSON object found` after response-format fallback consumed the only retry.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/unknown-1784802036257.json`.

## Response-Format Fallback Retry Accounting Checks

```bash
node --import tsx --test tests/structured-output.test.ts
```

Result: pass, 52 tests.

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/model-call-policy.test.ts
```

Result: pass, 93 tests.

```bash
npm run build
```

Result: pass.

## Replay After Response-Format Fallback Retry Accounting Fix

Session `1784803891040`:

- transport recovered;
- bootstrap-map had one recoverable `Unknown source chunk 0:1-67:fnv1a:1e0051`;
- synthesis progressed and wrote 7 wiki pages plus `index.jsonl` and `metadata.jsonl`;
- final blocker: embedding refresh failed with `Embedding API error: 503` and backend code `model_unavailable`.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/unknown-1784803891040.json`.

## Embedding Refresh Retry Checks

```bash
node --import tsx --test tests/page-similarity-jsonl.test.ts
```

Result: pass, 16 tests.

```bash
node --import tsx --test tests/init-ingest-outcome.test.ts tests/ingest-bounded.test.ts tests/structured-output.test.ts
```

Result: pass, 101 tests.

```bash
npm run build
```

Result: pass.

## Replay After Embedding Refresh Retry Fix

Session `1784804535754`:

- transport recovered;
- no bootstrap-map `Unknown source chunk` occurred;
- first source created 12 pages with zero structural and semantic retries;
- second source exposed synthesis coverage freedom: duplicate entity coverage, invented single-bundle entity keys, and final `Synthesis structured output exhausted for ufw: Empty structured output`.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/unknown-1784804535754.json`.

## Single-Bundle Coverage Canonicalization Checks

```bash
node --import tsx --test tests/ingest-synthesis.test.ts
```

Result: pass, 52 tests.

```bash
node --import tsx --test tests/structured-output.test.ts tests/page-similarity-jsonl.test.ts tests/init-ingest-outcome.test.ts tests/ingest-bounded.test.ts
```

Result: pass, 117 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Replay After Single-Bundle Coverage Canonicalization

Session `1784806127418`:

- status `done`;
- 22 source files processed;
- 17 wiki pages created;
- one recovered transport retry;
- zero semantic validation retries;
- remaining structural retries were mostly `ingest.evidence-map` `noEvidence` shape noise and several empty-output fallbacks.

Evidence: `docs/loen/dynamic-llm-budget-routing/evidence/unknown-1784806127418.json`.

Query session `1784807651320`:

- question: `как настроит fail2ban?`;
- `query.answer` got HTTP `400 Unsupported parameter: stream_options.`;
- body read completed, so the failure was backend parameter compatibility, not transport.

## Query Stream Options / Evidence Mapper Checks

```bash
node --import tsx --test tests/query-budget.test.ts
```

Result: pass, 33 tests.

```bash
node --import tsx --test tests/ingest-evidence.test.ts
```

Result: pass, 58 tests.

```bash
node --import tsx --test tests/query-budget.test.ts tests/ingest-evidence.test.ts tests/structured-output.test.ts tests/ingest-synthesis.test.ts
```

Result: pass, 195 tests.

```bash
npm run lint
```

Result: pass with the same 4 pre-existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts`.

```bash
npm run build
```

Result: pass.

## Source-Level Synthesis Shaping Checks

Observed session `1784813242526`:

- duration reached more than 8000 seconds;
- `ingest.synthesize`: 124 request fingerprints, 105 prompt breakdowns, 52 structural errors, 5 semantic validation retries;
- average synthesis prompt estimate was about 30448 tokens, max 41805;
- largest prompts carried 14 wiki sections, 12 optional sections, 7-8 page descriptions, and about 8k contract tokens;
- over-generation created command-level pages such as `apt_install_*`, `glxinfo_*`, `sudo_*`, plus thin package/config pages.

```bash
npm run build
```

Result: pass.

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/settings-model-controls.test.ts
```

Result: pass, 106 tests.

Delivered test-vault bundle:

- `main.js` size `2743467`, mtime `2026-07-23T15:49:12.701Z`;
- `manifest.json` size `317`, mtime `2026-07-23T15:49:12.702Z`;
- `styles.css` size `13487`, mtime `2026-07-23T15:49:12.702Z`.

Test-vault settings:

- `nativeAgent.synthesisMaxEntityBatchSize = 1`;
- `nativeAgent.synthesisMaxEntitiesPerSource = 6`;
- `nativeAgent.inputBudgetTokens = 65536`;
- `nativeAgent.repairInputBudgetTokens = 65536`;
- `nativeAgent.maxTokens = 16384`.
## Live restart checkpoint — session 1784822269108

- Observed at: 2026-07-23T16:00:32Z
- Status: running
- `init.bootstrap-map`: HTTP 200 on attempt 0, 71.4 s.
- `init.bootstrap`: attempt 0 failed at `fetch_start` after 1 ms with `TypeError`; retry 1 recovered with HTTP 200 after 15.9 s.
- Bootstrap prompt: estimated 18,013 tokens, actual 4,607 tokens; no budget failure.
- First `ingest.evidence-map`: HTTP 200, then `schema_validate` because required `noEvidence` was omitted; bounded schema retry started.
- Settings observed: input/repair budget 65,536, output budget 16,384, synthesis batch size 1. Source entity cap uses code default 6 because the persisted setting is absent.
- Evidence: `evidence/unknown-1784822269108.json`.

## Sentinel-framed ingest check

- `node --import tsx --test tests/ingest-evidence.test.ts`: 58/58 passed.
- Combined ingest suite: 144/144 passed; one parallel loader collision on Markdown imports was isolated from functional tests.
- `node --import tsx --test tests/structured-output.test.ts`: 53/53 passed when run separately.
- `npm run build`: passed.
- Captured evidence-map, evidence-reduce, and synthesis requests omit `response_format` and include sentinel instructions.
- Final bundle delivered to the test vault at `2026-07-23T19:11:37+03:00`; `main.js` size `2743810` bytes.

## Live sentinel restart — session 1784823481498

- Status: running; 22 source files discovered.
- `init.bootstrap-map`: no `responseFormatType`, HTTP 200 on attempt 0, sentinel parse and validation completed without structural retry.
- `init.bootstrap`: still uses `json_schema`; connection reuse failed after 7 ms with `TypeError`, retry 1 recovered with HTTP 200 after 20.9 s.
- First `ingest.evidence-map`: no `responseFormatType`; request started with estimated input 7,220 tokens and output budget 16,384.
- Current totals: one transport retry, one recovery, zero structural retries, zero budget failures.
- Evidence: `evidence/unknown-1784823481498.json`.

First source result:

- `ingest.evidence-map`: HTTP 200, sentinel/raw JSON parsed and validated on attempt 0; the former missing-`noEvidence` retry did not recur.
- `ingest.synthesize`: no `responseFormatType`, but its JSON payload contained malformed escaping at position 796 and triggered one `frame_parse` repair.
- Conclusion: sentinel removed provider schema dependence and mapper schema retry, but synthesis still embeds long Markdown inside JSON strings. The remaining repair requires a field-framed synthesis protocol where page content is outside JSON string escaping.

## Field-framed synthesis check

- Baseline session `1784823481498`: completed after one source with two synthesis structural retries: malformed JSON escaping and empty output. One bootstrap transport retry recovered.
- `node --import tsx --test tests/structured-output.test.ts tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts`: 140/140 passed.
- Field-frame parser test preserves raw Markdown quotes, backslashes, and fenced content without JSON escaping.
- Synthesis integration test confirms field-framed create output and no provider `response_format`.
- `npm run build`: passed.
- Bundle delivered at `2026-07-23T19:29:58+03:00`; `main.js` size `2749027` bytes.

## Live field-frame restart — session 1784824418474

- First source completed with five created pages and zero structural retries.
- Five entities produced separate `ingest.synthesize` requests because `synthesisMaxEntityBatchSize = 1`; these were batch progression, not response retries.
- Synthesis fingerprints omitted `responseFormatType`; field-framed output passed local validation without JSON/schema repair.
- Bootstrap transport failure repeated on attempt 0: `TypeError` after 3 ms, then attempt 1 recovered with HTTP 200. The same 1-7 ms pattern exists in ten recent reinit sessions and is not consistent with the configured 120-second connection timeout.
- Existing transport telemetry retained only the outer error class, so root cause code was not observable.
- Added bounded transport error metadata: `errorCode`, `causeClass`, and `causeCode`; messages and URLs remain excluded.
- `node --import tsx --test tests/native-openai-transport.test.ts`: 46/46 passed.
- `npm run build`: passed.
- Diagnostic bundle delivered at `2026-07-23T19:38:48+03:00`; `main.js` size `2749442` bytes. Obsidian restart is required before the added cause fields can appear.

## Diagnostic adapter replay — session 1784824895256

- At the latest checkpoint, 5/22 sources completed and 17 pages were created; source 6/22 was running.
- Bootstrap attempt 0 again failed with `TypeError` after 5 ms. No `errorCode`, `causeClass`, or `causeCode` existed; retry 1 returned HTTP 200 after 5.9 seconds.
- The same local, cause-less failure is isolated to `init.bootstrap` while `undici-request-adapter` is active. It is not consistent with the 120-second connection timeout or a surfaced DNS/TCP/TLS error.
- The diagnostic adapter overrides the normal bootstrap fresh-connection path and is development-only. Test-vault `devMode.nativeTransportDiagnosticMode` is set to `off` for the next restart so bootstrap uses its production isolated fresh connection policy.
- Current run also recorded five structural retries: one evidence empty output, one evidence semantic validation failure, and three synthesis empty outputs. These are provider/output problems, separate from bootstrap transport.

## Local validation UI check

- `node --import tsx --test tests/llm-lifecycle.test.ts tests/view-llm-lifecycle.test.ts tests/claude-chat-context.test.ts`: 42/42 passed.
- `npm run build`: passed.
- Bundle delivered at `2026-07-23T20:27:12+03:00`; `main.js` size `2749865` bytes.
- UI labels distinguish local checking, accepted output, repair requests, domain rejection, and transport retries without changing lifecycle or validation behavior.

## Pre-0.1.200 Transport Regression Check

Release timeline:

- `0.1.199 -> 0.1.200` has no transport changes. Release `0.1.200` only changes domain metadata cleanup and release files.
- Releases `0.1.199` and `0.1.204` use the OpenAI SDK default desktop fetch when no proxy is configured.
- Commit `d72cf5b` on 2026-07-21, after tag `0.1.204`, replaces the prior non-stream desktop route with the request-scoped native client and pooled direct `undici.Agent` transport.
- Immediately before `d72cf5b`, non-stream desktop calls route through `mobileFetch`, which uses Obsidian `requestUrl` and constructs a `Response` only after `r.text` is fully buffered.

Vault evidence across 12 init sessions:

- `undici-request-adapter`: 10/10 sessions fail the first `init.bootstrap` attempt with a cause-less `TypeError` in 1-7 ms; eight recover, one is cancelled during the retry body read, and one later run has unrelated provider 502/504 retries.
- `diagnosticMode=off`: 2/2 sessions reach HTTP 200 on `init.bootstrap-map`, advertise non-zero content length, and then record zero body chunks. Three body reads terminate with zero bytes across those two sessions.
- Session `1784832560599`: content lengths 3905 and 4821; attempt 0 reaches `body_error` at 600011 ms with zero chunks, attempt 1 is cancelled at 357837 ms with zero chunks.
- Session `1784833551598`: content length 1760; body read is cancelled at 558351 ms with zero chunks.
- The emitted retry class `connection_timeout` is inaccurate for these records: headers already arrived and the actual terminal timer is the 600000 ms idle timeout.

Standalone Electron A/B against the same endpoint/model, with a large input and `max_tokens=16384`:

- Obsidian installer runtime identified as Electron 34.3.0 / Chrome 132.
- Electron 34.3.0 exact current wrapper: main 8/8 complete, renderer 8/8 complete; every response reads the advertised body fully.
- Electron 36.2.0 exact current wrapper: main 8/8 complete, renderer 8/8 complete.
- Renderer default browser fetch fails immediately because of browser policy/CORS; this is not the vault failure, which receives HTTP 200.
- Bare direct-undici renderer calls show one immediate second-call timeout in each Electron version, then recover; this confirms runtime-sensitive connection state but does not reproduce the vault post-header stall.

Measured conclusion:

- The body observer is not a deterministic cause: 32/32 exact-wrapper Electron requests completed.
- Model, key, endpoint, and prompt budget are not sufficient causes: direct Node/Electron probes complete, while vault failure changes shape with transport mode.
- Strongest regression boundary is the post-0.1.204 non-stream transport switch in `d72cf5b`.
- Exact low-level cause remains conditional: pooled undici connection/body delivery interacting with the long-lived Obsidian renderer and gateway. Current evidence does not distinguish a client pool defect from a gateway keep-alive incompatibility.

Evidence summary: `evidence/pre-0200-transport-regression.json`.

## Buffered Desktop Non-Stream Repair Check

Red-phase reproduction:

- `desktop transport routes non-stream through host fetch and streaming through direct fetch`: failed with actual `direct`, expected `host`.
- `desktop hybrid transport reports the actual non-stream host route`: failed with actual `direct`, expected `host`.

Verification:

- `node --import tsx --test tests/native-openai-transport.test.ts tests/native-llm-executor.test.ts`: 77/77 passed.
- `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts`: 21/21 passed.

## Guarded Conflict-Regeneration Format/Semantic Split Check

- Red baseline: `node --import tsx --test tests/ingest-synthesis.test.ts` passed 58/60. The bounded frame repair fixture and the no-semantic-repair request-count fixture failed.
- Focused result: `node --import tsx --test tests/ingest-synthesis.test.ts` passed 61/61, including explicit one-request checks for schema, entity, path, page-hash, and section-authority rejection.
- Configured LoEn verifier passed 261/261:
  `node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts tests/ingest-evidence.test.ts tests/synthesis-evidence-ledger.test.ts tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts`.
- Full repository tests: `node --import tsx --test tests/*.test.ts` passed 1306/1306.
- TypeScript: `npx tsc --noEmit` passed.
- ESLint: `npm run lint` passed with zero errors and four pre-existing Node builtin warnings.
- Production build: `npm run build` passed.
- Diff hygiene: `git diff --check` passed.

Result: pass. Frame-invalid output gets at most one repair; valid first output uses one request; schema/domain-invalid output uses one request; repeated stale conflict uses zero requests.
- `npm run lint`: 0 errors; 4 pre-existing Node-import warnings.
- `npm run build`: passed.
- `dist/main.js` and test-vault `main.js`: matching SHA-256 `a0c7d315c4b3317d4e07672173fd692baa1da0cec6b3c1a137b33242395827d3`.

Live acceptance remains pending. Required evidence: two consecutive fresh Obsidian reinit sessions where `init.bootstrap` completes on attempt 0 through `desktop-host`, with a non-empty fully consumed body and no transport retry. Streaming calls must continue to report `desktop-direct`.

Replay baseline before restart:

- Agent log marker: 8,865 lines / 4,646,598 bytes; latest session `1784833551598` is the cancelled direct-transport baseline.
- Test settings: diagnostic mode `off`, input and repair budgets `65536`, output budget `16384`, synthesis batch `1`, source entity cap `6`.

## Desktop hybrid full replay - session 1784840143468

Terminal result:

- `status=done`; 22/22 source files completed in 4,458,538 ms.
- 134/134 HTTP responses completed with non-empty `body_end`; zero `body_error` and zero transport retries.
- All non-stream requests used `desktop-host`. Bootstrap-map and both bootstrap calls completed on attempt 0 with bodies of 4,318, 1,255, and 3,213 bytes.
- This is clean restart 1/2 for buffered desktop non-stream acceptance.

Cost and retry result:

- 134 calls: 3 bootstrap, 29 evidence-map, and 102 synthesis.
- 690,327 input tokens and 600,049 output tokens; 1,290,376 total.
- Nine synthesis calls returned empty content at exactly the 16,384 output cap. They consumed 147,456 output tokens and 950,356 ms, or 21.3% of the full run.
- Seven evidence-map outputs failed schema validation. `user.md` required four mapper calls before synthesis.
- One duplicate merge regeneration for `fstab` was rejected because section content contained a top-level H2. The failure remained source-local and the full reinit continued.

Article quality result:

- 76 pages created, seven updated, one operation rejected.
- 24/76 final pages contain leaked `<<<END_CONTENT>>>` protocol markers.
- Confirmed duplicates include `/etc/fstab` versus `fstab`, and two Ubuntu 24.04 pages. Seven aliases resolve to multiple generated pages.
- The broad Ubuntu and Linux pages contain cross-source context not supported by their recorded resources; the Linux page also contains the dangling text `Подробнее см..`.
- Final link resolution is clean after indexing: 38 domain links and 63 source citations resolve, with zero unresolved links. The 113 intermediate warnings are therefore transient/stale lint signals and must not be used as the final link gate.
- Bootstrap configured six source-derived types, but generated pages use only four. Service-like entities are classified as applications.

Prompt evidence:

- 92 primary synthesis prompts average 24,591 locally estimated input tokens; maximum 30,648.
- Average prompt contribution: contracts 8,969; optional wiki context 5,404; evidence 1,372; page descriptions 1,384; registry 949.
- Provider usage reports only 542,188 input tokens for those calls, 4.17x below the local estimate.
- Optional wiki context outweighs evidence by 3.9x, matching observed cross-source contamination.

Evidence: `evidence/desktop-hybrid-replay-1784840143468.json`.

## Bounded Ingest Contract Repair Check

Local verification:

- Focused repair suite: 290/290 passed.
- Rename/index and production acceptance regressions: 5/5 passed.
- Full test suite: 1215/1215 passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.

Behavior covered by tests:

- explicit content boundaries are removed and reserved marker lines are rejected;
- alias-equivalent entities reuse one canonical page while ambiguous aliases do not resolve;
- create prompts omit all page bodies and update prompts contain only the exact target body;
- cap exhaustion emits `output_limit` and performs one fresh compact retry with a dynamic bounded output ceiling;
- mapper repair includes a stable concrete validation reason;
- small child evidence reaches parent synthesis and is not dropped by the per-source cap.

Live replay remains required. Local tests cannot measure provider empty-output rate, final alias collisions, article grounding, or total calls for the 22-source corpus.

Delivery:

- `dist/main.js` and test-vault `main.js` match SHA-256 `f7489e6e7c92a7ec28739cf133fcd008448c374ad6ea9bbda209586c22bd3dcc`.
- `manifest.json` and `styles.css` also match their rebuilt artifacts.
- Delivered `main.js` size: 2,767,218 bytes.
- Next replay profile: effective backend override `native-agent`; input and repair ceilings `65536`; global output retry ceiling `65536`; per-operation budgets enabled; ingest initial input `65536` and output `16384`; synthesis batch `1`; source entity cap `6`; transport diagnostic mode `off`.

## Evidence Mapper Output Ceiling Propagation Check

Live failed-run evidence from session `1784868963664`:

- bootstrap-map and bootstrap: HTTP 200, complete bodies, attempt 0, zero transport retries;
- evidence-map fingerprints: eight requests, all `max_tokens=4096`;
- six `output_limit` errors and zero completed source files;
- root cause: bounded evidence retry wrapper discarded the shared runner's raised options between attempts.

Red/green verification:

- regression before fix: expected `[4096, 6144]`, observed `[4096, 4096]`;
- regression after fix: passed with `[4096, 6144]` and no assistant replay;
- evidence/structured-output/policy suite: 127/127 passed;
- full suite: 1216/1216 passed;
- `npm run lint`: zero errors; four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed.

Another Obsidian restart is required because session `1784868963664` loaded the preceding bundle.

Corrected bundle delivery:

- test-vault `main.js` matches rebuilt `dist/main.js` at SHA-256 `d8afd6846b0ccc78c79fe25c21d6620592ecb2546c2f3549b650416462cf7fcd`;
- delivered size: 2,768,663 bytes;
- dynamic ceiling test profile remains `4096` mapper initial cap, `16384` synthesis initial cap, and `65536` global retry ceiling.

## Field-Frame Repair Budget Check

Rejected live session: `1784869572887`.

- Duration before failure: 382,003 ms.
- Progress: 1/22 source files completed; six pages created.
- Transport retries: 0; every observed native response reached HTTP 200 and `body_end` through `desktop-host`.
- Dynamic output-cap sequences: bootstrap-map `4096 -> 6144`; evidence-map file 1 `4096 -> 6144`; evidence-map file 2 `4096 -> 6144`.
- Terminal structural error: `frame_parse`, caused by `## CREATE` in place of an exact field marker.
- Terminal budget error: `Prompt requires 16973 estimated tokens but budget is 16384`.
- Parsed evidence: `evidence/unknown-1784869572887.json`.

Red/green evidence:

- Parser regression before fix: generic JSON parse error on `## CREATE`; after fix: actionable missing-`<<<CREATE>>>` diagnostic.
- End-to-end ingest regression before fix: retry replayed an assistant message; after fix: fresh repair with no assistant output.
- Budget regression after fix: synthesis effective input budgets are `[12500, 65536]`, and retry estimate exceeds the initial 12,500 ceiling.

Verification:

- LoEn focused suite: 227/227 passed.
- Full test suite: 1218/1218 passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.

Live rerun remains required. Set the test-vault `init.maxTokens` to 8,192 for the next variant: 4,096 was empirically exhausted by every bootstrap/evidence mapper call in this session, while 6,144 recovered. This is test configuration, not a code floor.

Corrected bundle delivery:

- `dist/main.js` and test-vault `main.js` match SHA-256 `ef38ec5587f25e4f36a895a87f6af9d46fdd903a7908318ee89dce1b8eed65e5`.
- `manifest.json` and `styles.css` also match rebuilt artifacts.
- Test profile: init input 16,384; init initial output 8,192; global repair input/output retry ceilings 65,536; synthesis batch 1; source entity cap 6; transport diagnostic mode off.
- Wiki lint after documentation updates: zero broken links; pre-existing orphan, stale-source, and advisory findings remain.

## Init-to-Ingest Policy Routing Check

Rejected live session: `1784893122317`.

- Bootstrap transport retries: zero.
- Progress before failure: 2/22 source files, 51 LLM requests, 20 structural failures.
- Child source requests used the init policy (`16384` input / `4096` output), despite an enabled ingest policy of `65536` input / `16384` output.
- `AMD Driver.md` was split into 19 evidence-map chunks and failed on conflicting per-chunk types: `Conflicting entity type for amdgpu: application, configuration`.
- The same real source plans as one chunk after resolving the child runtime from the ingest policy.

Red/green evidence:

- Before the fix, two focused regressions failed because init child work received no distinct ingest runtime.
- After the fix, focused init-policy coverage passed 34/34.
- The added global-inheritance regression passed and proves disabled per-operation settings remain user-configurable through global settings.

Verification:

- Full test suite: 1221/1221 passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Real AMD source planner check under ingest limits: one chunk covering lines 1-305.

Live acceptance remains pending. The next replay must show init budgets on bootstrap fingerprints, ingest budgets on source fingerprints, and one evidence-map chunk for `AMD Driver.md`.

Delivered replay profile:

- per-operation settings enabled;
- init bootstrap limits: `16384` input / `4096` output;
- ingest source limits: `65536` input / `16384` output;
- global repair input and output-retry ceilings: `65536`;
- synthesis batch size: `1`; source entity cap: `6`; transport diagnostic mode: `off`;
- source and test-vault bundle hashes match at `45b2fc56cd0fa9b0a3be40e127a8dd320239e97f7acdca30af3110151ce5dfa3`.

## Init-to-Ingest Live Replay Check

Accepted routing and retry result for session `1784896515548`:

- terminal status `done`; 22/22 files completed;
- bootstrap policy `16384/4096`; source policy `65536/16384`;
- `AMD Driver.md` evidence `sourceChunks=1`;
- 121 logical requests, 121 HTTP 200 responses, zero ingest structural repairs;
- two bootstrap-map `output_limit` repairs and one recovered pre-header transport retry;
- 465,960 provider input tokens; 328,216 provider output tokens;
- 95 synthesis requests for 95 accepted create/update actions;
- average synthesis prompt estimate 17,141 tokens, maximum 28,757; optional context average 721 tokens versus 5,404 in the prior full replay;
- zero persisted protocol markers, zero non-canonical folders among parseable pages, zero unresolved final WikiLinks.

Rejected final-page integrity:

- 4/78 pages contain invalid YAML frontmatter due to an unquoted colon in `description`;
- those four index records lost canonical type and resource provenance;
- alias `cpufrequtils` resolves to three pages;
- 121 calls exceed the under-80 cost target because batch size 1 produces one synthesis request per accepted action.

The routing pass is accepted. The overall pipeline remains open for P0 page integrity, then separate P1 call-count/bootstrap-output tuning.

## Post-Replay Page Integrity Check

Red/green evidence:

- Invalid-frontmatter regression failed before implementation with the same unquoted-colon `YAMLParseError`; it passes after server serialization.
- Alias regression failed before implementation with aliases `[tool, tool settings]` on the sibling page; it passes with only `[tool settings]` retained there.
- Full ingest suite initially exposed a canonical-deletion interaction. The alias guard treated a pending-delete duplicate as a future owner and removed the alias from the canonical page. Excluding pending-delete pages from alias inventory restored the existing fail-closed deletion invariant.

Verification:

- Targeted frontmatter, alias, and canonical-delete regressions: 3/3 passed.
- Full ingest suite: 39/39 passed.
- Frontmatter, provenance, index, and delete integrity suite: 80/80 passed.
- Full test suite: 1223/1223 passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Project wiki updated for governed frontmatter and alias ownership; `wiki_lint` reports zero broken links. Existing orphan, stale-source, and advisory findings remain.
- Delivered `main.js` matches the rebuilt artifact at SHA-256 `a22b8fd34514033bb0d2ea7c9e54d459db3cc78575c872f00b2e121d9f5a315c`.

Local P0 acceptance is complete. A clean force-reinit is still required to prove every generated os-unix page parses and no normalized alias has multiple owners. The 121-call cost target remains a separate P1 experiment.

## Canonical Type Reverse-Mapping Check

Rejected live signal:

- Session `1784901066143`, first-source audit: six YAML-valid pages, zero missing resources, but canonical type mismatch `configuration -> configurations`.
- The session is invalid for page-integrity acceptance regardless of its eventual terminal status.

Red/green evidence:

- Before fix: plural-folder regression observed `configurations` and failed.
- After fix: canonical type is `configuration`; type tag is also `configuration`.
- P0 plus canonical-delete regressions: 4/4 passed.
- Full ingest suite: 40/40 passed.
- Full repository suite: 1224/1224 passed.
- `npm run lint`: zero errors; four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Delivered bundle matches SHA-256 `4abb0cc55181c376e2e67da488f44ba86c8c9133cf74b56938d40f809600ccb6`.

Another clean force-reinit is required. The first completed source must pass YAML, canonical type-to-folder, provenance, and unique-owner alias audit before monitoring continues to 22/22.

## Live Patch-Recovery Check

Rejected live session `1784901643760`:

- progress: 18/22 sources, 107 calls, 66 created pages and eight updates;
- transport retries: zero; every observed provider response completed through `desktop-host`;
- terminal error: conflict regeneration returned a matching top-level H2 inside section content;
- precursor: the original patch used `add` for an already existing `## External links` section;
- non-terminal structural signals included one mapper range-tuple response, one chunk-id typo, one field-frame repair, and output-cap escalation.

Red/green verification:

- four initial live-defect regressions failed before implementation and passed after it;
- localized alias preservation failed under ASCII identity and passed after Unicode-safe normalization;
- focused framing/evidence/ingest suite: 123/123 passed;
- full repository suite: 1229/1229 passed;
- `npm run lint`: zero errors; four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- read-only audit of all 66 persisted pages: valid YAML, canonical type-folder mapping, source provenance, index agreement, zero reserved markers, zero duplicate aliases, and zero alias-primary conflicts.

Evidence: `evidence/page-integrity-replay-1784901643760.json`.

Another clean force-reinit is required because the audited pages came from the rejected bundle and the source set is incomplete.

Corrected bundle delivery:

- source and test-vault `main.js` match at SHA-256 `8ba895860f52c586d13c06b27425fcb944b20cb147cbacbb0ef3b1bc1a87ca91`;
- rollback bundle `main.js.pre-live-patch-recovery-backup` matches the rejected live bundle at SHA-256 `4abb0cc55181c376e2e67da488f44ba86c8c9133cf74b56938d40f809600ccb6`;
- `manifest.json` and `styles.css` already matched the rebuilt artifacts and were left unchanged;
- restart and clean force-reinit remain required for live acceptance.

## Server-Owned Mapper and Article-Shape Check

Rejected live acceptance for session `1784909821666` despite terminal `done`:

- 22/22 sources completed; 118 calls; zero transport retries; every observed response reached `body_end`;
- four mapper schema repairs were caused only by mistyped copies of a server-known single-chunk ID;
- one synthesis repair changed `create` to patch for the already resolved canonical `linux` target;
- final 79-page audit found one structural defect: `configurations/wiki_os-unix_bashrc.md: missing H1`;
- YAML, canonical type-folder mapping, provenance, index agreement, reserved markers, and alias ownership otherwise passed.

Red/green verification:

- single-chunk ID typo regression passes with one mapper call; foreign/multi-chunk IDs remain rejected;
- complete create-to-existing-target regression passes with one synthesis call and exact page/section guards; a second regression proves meaningful preamble prose is not discarded and instead requests repair;
- compact H1 end-to-end regression and direct dead-link cleanup regression pass;
- focused evidence/synthesis/ingest/link suite: 166/166 passed;
- full repository suite: 1234/1234 passed;
- `npm run lint`: zero errors; four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed.
- Project wiki updated for mapper, routing, synthesis, and H1 contracts; `wiki_lint` reports zero broken links and zero missing sources. Six stale pages and three orphans are pre-existing and outside this pass.

The audit of the old generated vault still reports the expected `.bashrc` defect because this pass does not rewrite prior output in place. A clean force-reinit with the delivered bundle is required for live acceptance.

Corrected bundle delivery:

- source and test-vault `main.js` match SHA-256 `b3adf2c76e9d81da7e788a883066b7c7a86ce92f9160607c87dcfffa8bf50196`;
- rollback bundle `main.js.pre-server-owned-contract-backup` matches SHA-256 `8ba895860f52c586d13c06b27425fcb944b20cb147cbacbb0ef3b1bc1a87ca91`.

## Cross-Operation Streaming Compatibility Check

Rejected old-bundle live evidence:

- Query `1784914297075`: valid `12974/16384` prompt, HTTP `400` headers after 55 ms, zero error-body bytes, cancelled after 152.5 seconds.
- Format `1784914453224`: first pooled fetch failed in 6 ms; retry received HTTP `400` headers after 33 ms, zero error-body bytes, cancelled after 490.9 seconds.
- Direct endpoint check: `stream_options.include_usage` is unsupported; plain SSE succeeds.

Red/green verification:

- default stream-options regression failed before implementation and now proves omission plus explicit opt-in;
- stalled HTTP error-body regression failed after 300 ms before implementation and now returns a status-preserving synthetic error in about 25 ms;
- retry-connection regression observed no fresh flag before implementation and now observes pooled attempt 0 followed by fresh attempt 1;
- Query/Chat plus native executor focused suite: 64/64 passed;
- Format and structured-output suite: 95/95 passed;
- full repository suite: 1237/1237 passed;
- `npm run lint`: zero errors; four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- live source-wrapper probe against the configured endpoint: HTTP `200`, SSE content type, `[DONE]`, no `stream_options`, 1.7 seconds.
- Project wiki updated with default request compatibility, bounded error-body handling, and fresh retry routing.

Delivered bundle SHA-256 is `d8557e9ed7550ae28cebc7e6d8d8324c6dd6b67e9ac02b16a39db2ed4be997ef`; rollback bundle SHA-256 is `b3adf2c76e9d81da7e788a883066b7c7a86ce92f9160607c87dcfffa8bf50196`.

Local acceptance is complete. Live acceptance requires an Obsidian restart, one Query request, and one Format request before another force-reinit. Both first requests must omit HTTP `400`, produce at least one SSE body chunk, and finish without transport retry.

## OpenAI Chat Contract Compatibility Check

Rejected old-bundle evidence:

- Query `1784916589711`: HTTP `400` after 56 ms, then misleading `HTTP 400 response body timed out after 5000ms`.
- Format `1784916602664`: one transient fetch failure, then HTTP `400` after 38 ms and the same misleading body-timeout error.
- Direct endpoint reproduction returned `Unsupported parameter: thinking.` for the old request and HTTP `200` for the standard request.

Red/green and integration verification:

- legacy-thinking regression failed before implementation because `thinking` was emitted, then passed with no non-standard field;
- keep-alive JSON-error regression failed before implementation because a complete provider error was discarded after timeout, then passed with immediate status-preserving delivery;
- shared builder exact-key regression permits only the configured standard Chat Completions fields;
- affected settings, structured-output, vision, init, evidence, synthesis, native transport, Query, Format, and semantic-compression suites passed;
- full repository suite passed twice: 1240/1240;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- static source audit found no `max_tokens`, `params.thinking`, `reasoning_effort`, or `extra_body` request serialization;
- live shared-builder probe sent only `model`, `messages`, and `max_completion_tokens`, then received valid SSE content and `finish_reason: stop`;
- intentional bad-request probe through the repaired desktop transport surfaced `400 Unsupported parameter: thinking.` in 77 ms instead of a synthetic five-second timeout.

Project wiki now documents the OpenAI-standard request surface and corrected error-body behavior. `wiki_lint` reports zero broken links and zero missing sources; existing stale pages, orphans, and advisory section findings are outside this pass.

Delivered bundle SHA-256 is `83454dbe6bbfa861ba89e1872af205866f747e3f74934f456f3380f33c5a7923`.

Local acceptance is complete. Live acceptance requires reloading this exact bundle, then one Query and one Format request. Both must avoid HTTP `400`, produce SSE content, and reach an accepted terminal state without compatibility repair.

## First SSE Event Retry Check

Rejected live evidence for session `1784919493140`:

- OpenAI request-contract repair worked: attempt 0 received HTTP `200` and `text/event-stream`, with no HTTP compatibility error or transport retry.
- The exact response stalled after headers: `bodyBytes=0`, `bodyChunks=0`, and `body_error` after 599,289 ms.
- Equal 600-second caller and native idle deadlines let caller cancellation win, producing `Timeout after 600s` instead of retrying a zero-output attempt.

Isolation controls:

- short standard request, `max_completion_tokens: 32000`: first meaningful delta at 1.69 seconds, terminal `stop` at 2.1 seconds;
- Query-shaped request, 12,973 input bytes, `max_completion_tokens: 32000`: first meaningful delta at 1.56 seconds, terminal `stop` at 10.69 seconds;
- therefore neither the configured completion ceiling nor packed input size independently reproduces the empty SSE body.

Red/green verification:

- no-first-event regression initially observed one attempt at the derived half-window instead of the required retry, then passed with two attempts and `response_start_timeout` telemetry;
- first-valid-event regression proves the normal full inter-chunk idle window is restored;
- focused executor, retry, transport, Query, and Format suites: 171/171 passed;
- full repository suite: 1242/1242 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- static request audit still finds no `max_tokens`, `params.thinking`, `reasoning_effort`, or `extra_body` serialization.

Project wiki documents the derived first-event deadline and retry boundary. `wiki_lint` reports zero broken links and zero missing sources; existing stale pages, orphans, and advisory findings remain outside this pass.

Delivered bundle SHA-256 is `f6616f447f03c86e436dbd7a929facecc73e8391b53b42ccbe7f51677dd3af09`.

Local acceptance is complete. Live acceptance requires reloading this exact bundle and repeating Query. A healthy request should finish normally; an empty accepted stream should emit `response_start_timeout` near 150 seconds and retry on attempt 1 instead of waiting 600 seconds. Format follows only after Query acceptance.

## Query Empty-SSE Compact Repack Check

Rejected live evidence for session `1784923289519`:

- four independent provider requests returned HTTP `200` and `text/event-stream`;
- all four had unique client IDs, provider request IDs, and direct connections;
- all four ended with zero SSE bytes and zero chunks;
- attempts 0-2 timed out at 151.5 seconds including header latency; attempt 3 was cancelled at 141.8 seconds by the 600-second operation watchdog;
- the repeated prompt remained `12974/16384`, with eight selected source chunks and `max_completion_tokens: 32000`;
- direct standard and similarly sized controls succeeded, so neither the output ceiling nor rough request size independently explains the exact-payload stall.

Red/green verification:

- transport delegation regression proves the 150-second derived deadline remains intact while an identical response-start retry is suppressed;
- compact Query regression proves the next payload keeps the question and whole chunks, selects fewer chunks, changes the fingerprint, and requests a fresh connection;
- required-only regression proves no unchanged prompt replay;
- focused executor, retry, Query, and structured-output suite: 140/140 passed before the final no-replay guard;
- final full repository suite: 1245/1245 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- static source audit still finds no `max_tokens`, `params.thinking`, `reasoning_effort`, or `extra_body` serialization.

Project wiki documents Query-owned empty-SSE repacking and fingerprint telemetry. `wiki_lint` reports zero broken links and zero missing sources; existing stale pages, orphans, and advisory findings remain outside this pass.

Delivered bundle SHA-256 is `c3d3abeeec3805bf9efb7c60d57f152b2c4b982e3b2d88859e7d11715889dbd2`.

Local acceptance is complete. Live acceptance requires plugin reload and the same UFW Query. If attempt 0 stalls, the next request must report a lower effective input budget, fewer than eight chunks, a different fingerprint, and no `transport_retry_scheduled` for the unchanged payload.

## Gateway-Correlated SSE Response-Boundary Check

Rejected live Query session `1784927456241`:

- compact recovery behaved as designed: three attempts used distinct fingerprints `f41b4031`, `99589c64`, and `7a2e0527`, reduced effective input budgets `16384 -> 12288 -> 9216`, and reduced source chunks `8 -> 7 -> 3`;
- every request received HTTP `200` SSE headers, but plugin telemetry observed zero body bytes and each attempt reached the 150-second response-start deadline;
- the third exact attempt correlates to gateway request `019f95fc-2e67-766a-8698-6fb6847d6051` through client attempt ID and W3C trace context.

Gateway evidence corrects the earlier diagnosis:

- backend TTFT was `1.600790922s`, with reasoning present;
- plugin recorded response headers at `21:16:01.578Z`;
- gateway recorded `client_disconnected` at `21:16:01.582149Z`, roughly four milliseconds after the plugin header event and `5.17ms` after backend TTFT;
- therefore the gateway/model did not remain silent for 150 seconds. The downstream stream disconnected at the response-header boundary, while the plugin-side wrapped reader failed to surface bytes or closure.

Red/green and integration verification:

- response-boundary regression failed before implementation at the extra `undici.Response` construction and passes after raw-response routing;
- production reasoning-first SSE regression passes with flushed headers, delayed reasoning, final content, and a fresh dispatcher;
- focused transport/executor/retry/Query suite: 150/150 passed;
- full repository suite: 1247/1247 passed;
- TypeScript, lint, build, and diff checks passed; lint retains four pre-existing warnings;
- wiki documentation and lint completed with no broken links or missing sources.

Built bundle SHA-256 is `f3c3dfeec5739cb215e9d5a1ec83d607194e6d0e2977762a5b1ec8d4fd8ed0ae`. Live acceptance remains pending copy, plugin reload, and one UFW Query. The decisive signal is a non-zero `body_chunk` before the response-start deadline and no header-time `client_disconnected` gateway terminal state.

## Raw Desktop SSE Ownership Check

Rejected live session `1784929303448`:

- exact initial Query fingerprint remained `fnv1a:f41b4031` with `12974` estimated input tokens and `32000` output tokens;
- plugin received HTTP `200` after about 1.66 seconds and entered body read with zero bytes;
- gateway correlated the same client/provider/trace identifiers, preserved `reasoning_text: We need to answer`, and recorded `terminal_state=client_disconnected` at `2026-07-24T21:41:45.808472Z`;
- plugin response-start timeout occurred 150 seconds later with zero chunks, then Query correctly built a smaller repack;
- therefore the prior removal of only the inner `undici.Response` did not fix the renderer boundary.

Red/green result:

- new response/body identity test failed against the remaining common `Response` wrapper;
- successful normal desktop SSE now returns the original Undici response and body, and the identity test passes;
- the old test requiring socket closure at `[DONE]` was replaced with the OpenAI-standard contract: provider EOF ends the body;
- reasoning-first fresh streaming still yields both reasoning and content without closing before `[DONE]`;
- bounded HTTP error bodies and diagnostic response observation remain covered.

Controls and verification:

- low-level same-endpoint stream completed in `1770ms` with `4605` bytes, `[DONE]`, and EOF;
- project transport plus OpenAI SDK completed in `1857ms`, yielding 17 chunks and visible content;
- focused suite: 138/138; full suite: 1248/1248;
- typecheck, lint, build, and diff checks passed; lint retains four pre-existing warnings;
- wiki lint reports no broken links or missing sources.

Built bundle SHA-256 is `7ca1368d06066490fe8aecf9ee27bcd80dc3292c28a3f773d05c9802422a2c7f`. Local acceptance is complete. Live acceptance now requires delivery, plugin reload, and the exact UFW Query. Expected healthy trace is `fetch_start -> fetch_headers -> sdk_complete` plus reasoning/content lifecycle events; `body_chunk` is intentionally absent on raw normal desktop SSE. Gateway must not report header-time `client_disconnected`.

## Buffered Desktop Completion Check

Rejected live evidence:

- Query session `1784955341746` loaded the raw-response bundle and still timed out with HTTP `200` plus zero model events.
- Absence of `body_start` proves the response observer and renderer `Response` reconstruction were no longer present.
- Therefore raw Undici body delivery itself is unreliable in the long-lived Obsidian renderer; further response-wrapper changes cannot repair normal product streaming.

Red/green and integration verification:

- new normal-desktop production-client regression first failed because request stayed `stream:true` on `desktop-direct`;
- after implementation it proves one host call, request `stream:false`, no `stream_options`, compatible reasoning/content chunks, and correlation `non-stream/desktop-host`;
- focused transport, executor, retry, Query, and structured-output suite: 195/195 passed;
- full repository suite: 1249/1249 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- real configured-endpoint project-client control: HTTP `200`, content `OK`, 133 reasoning characters, 2,840 ms, no retry, correlation `non-stream/desktop-host`;
- project wiki updated; lint reports zero broken links and zero missing sources. Existing orphan, stale-source, and advisory findings remain outside this pass.

Built bundle SHA-256 is `5e021522125b7bccfe0f2df54df3fa3cb488b647855e6722048b68d82d51b077`. Live acceptance requires delivery, plugin reload, and the exact UFW Query. Expected normal product correlation is `transport=non-stream`, `networkTransport=desktop-host`; gateway request body must report `stream:false` and finish normally.

Live acceptance passed with Query session `1784956634864`:

- exact question: `как настроить ufw?`;
- terminal status: `done` after 11,923 ms;
- one attempt, `transport=non-stream`, `networkTransport=desktop-host`;
- HTTP `200`, provider request `019f97b4-c9ae-7e57-a342-79d0a5116c15`;
- complete trace: `fetch_start -> fetch_headers -> body_start -> body_chunk -> body_end -> sdk_complete`;
- host JSON body: 5,690 bytes in one complete chunk;
- no transport retry, context repack, structural repair, or error event;
- valid links and 960-character final answer;
- 2,960 actual input tokens and 1,238 output tokens.

This satisfies buffered desktop completion acceptance. Gateway-side `stream:false` is also implied by `application/json`, host route, and non-stream SDK completion; no SSE body or renderer-direct connection was created.

Format session `1784956658532` also accepted buffered transport:

- terminal status: `done` after 45,453 ms;
- two logical model calls, both `non-stream/desktop-host`, HTTP `200`, complete host JSON bodies, and no transport retry or error;
- call 1: 2,425 input tokens, 3,710 output tokens, 31,813 ms;
- call 2: 3,213 input tokens, 1,740 output tokens, 13,499 ms;
- final preview had zero missing tokens and was applied successfully.

The second call was a local token-preservation repair, not transport recovery. First output translated English prose to Russian under global language rules. `significantTokens()` then treated 18 title-cased English prose words and `OutgoingLinks` as mandatory verbatim tokens. Restore prompt caused final note to remain in English. This is a separate Format quality/cost contract conflict.

## Post-Reinit Domain Quality Check

Reinit session `1784956783666` completed 22/22 sources in 2,663,822 ms. All 106 model calls returned HTTP 200 through `non-stream/desktop-host`; transport retries were zero. The run used 406,601 input tokens and 278,472 output tokens, created 65 pages, applied 12 later updates, and made 81 synthesis calls. One evidence-map schema repair normalized uppercase `PATH`; two synthesis repairs converted pathless creates for `bashrc` and `node-js` into skips.

Deterministic integrity passed all 65 pages for YAML, type-folder routing, resource existence, index agreement, aliases, reserved markers, and H1 shape. Content acceptance failed:

- 21/22 sources have an attributed page; `ОС/Unix/Сервисы/npm.md` has zero effect;
- exact technical preservation is 234/537 command/config lines and 22/43 technical values;
- 15/21 source URLs remain, while generated pages add 30 URLs absent from their attributed sources;
- two unresolved Related links target consolidated `wiki_os-unix_https_proxy`;
- one canonical Related self-link remains;
- zero of 65 pages use the 2026-07-25 run date; the model chose eight unrelated 2025 dates.

The first ten-question control is not a production retrieval score: its Node runtime lacked Obsidian `requestUrl`, so embeddings failed and every reranker fell back. Direct gateway controls returned HTTP 200 for `/embeddings` and `/rerank` in about 100 ms. The corrected harness routes those calls through a headless Obsidian-compatible request adapter.

Accepted hybrid Query result:

- 10/10 questions completed, with zero chat transport, structural, or validation retry;
- 10/10 embedding runs and 10/10 reranker runs completed without fallback;
- retrieval hit at least one expected page for 9/10 questions, mean expected-page recall 81.67%, full expected-page coverage 7/10;
- all 35 emitted WikiLinks resolve;
- mean answer latency 14.74 seconds; 30,719 input and 16,234 output tokens across ten chat calls;
- exact technical-output grounding is 153/202 against both selected page bodies and their attributed source corpus.

The lexical required-fact score of 77.14% is rejected as an acceptance metric because it counts negated mentions. Manual review finds one fully acceptable answer (SSH), one mostly acceptable answer (AMDGPU/ROCm), two partial answers (proxy and NFS), and six rejected answers (Fail2Ban, GitLab Runner, cache/sysctl, UFW, storage mounts, npm). Security-sensitive Fail2Ban output altered regex and log paths; storage output replaced the real WD Green UUID with a placeholder; UFW mentioned five missing actions only to state that they were absent.

Full evidence and per-question findings are recorded in `evidence/os-unix-domain-quality-report.md`. Machine-readable artifacts are `evidence/domain-quality-1784956783666.json`, `evidence/os-unix-query-quality-hybrid.json`, `evidence/os-unix-query-quality-hybrid-events.jsonl`, and `evidence/os-unix-query-grounding-hybrid.json`.

Acceptance result: **rejected for domain content quality**. Buffered transport and hybrid retrieval pass; source coverage, grounding, and answer quality do not.

## Consolidation Path-Authority Check

Red/green evidence:

- The new regression failed before implementation with `actual: ['bashrc']`, `expected: ['npm']`.
- The same regression passed after authority-aware parent selection and confirmed `bashrc -> npm` evidence preservation.
- Full `ingest-context` plus `runIngest` integration set: 80/80 passed.
- LoEn ingest verifier plus consolidation tests: 275/275 passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors and four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- `wiki_lint`: zero broken links and zero missing sources; existing orphans, stale pages, and advisory findings remain outside this action.

Acceptance result: **locally accepted, live replay pending**. Pathless bundles cannot displace a routable parent when authority exists. Strict synthesis path validation is unchanged. The missing test vault blocks only bundle delivery and live os-unix confirmation.

## Configured-Profile Replay and Reranker Check

Live reinit session `1784979910443` reached terminal `done` in 2,812,423 ms:

- 22/22 sources completed;
- 104/104 LLM calls received HTTP `200`;
- zero transport, structured-validation, or semantic-validation retries;
- one field-frame parse retry recovered on the next request;
- 378,308 input and 303,386 output tokens;
- 72 pages created and 7 later updates;
- bootstrap-map and bootstrap both completed on attempt zero through `non-stream/desktop-host`.

Deterministic page integrity passed: no invalid frontmatter, type-folder mismatch, missing source resource, index mismatch, reserved marker, duplicate alias, or invalid H1. Content quality did not pass:

- declared source entity coverage: 31/106, or 29.25%;
- exact technical snippet preservation: 301/537, or 56.05%;
- exact technical value preservation: 19/43, or 44.19%;
- source URL preservation: 16/21, or 76.19%;
- 21 generated URLs were absent from their attributed sources;
- zero of 72 pages used the server run date;
- hard-cap consolidation merged independent tools and procedures into nearby unrelated parents.

Ten-query A/B on the same generated domain:

| Metric | Unsupported reranker fallback | Supported reranker |
|---|---:|---:|
| Completed | 10/10 | 10/10 |
| Retrieval hit at K | 7/10 | 8/10 |
| Mean expected-page recall | 36.83% | 50.67% |
| Mean required-fact coverage | 87.76% | 95.71% |
| Full fact coverage | 6/10 | 9/10 |
| WikiLink precision | 96.67% | 100% |
| Chat calls | 11 | 10 |
| Input tokens | 29,357 | 29,769 |
| Output tokens | 18,701 | 15,536 |
| Summed duration | 215,593 ms | 212,081 ms |

With `lemonade-reranker-bge-reranker-v2-m3`, reranking completed for 10/10 cases without fallback. Technical-output grounding measured 85.17% against selected pages and 82.78% against their attributed original sources. The remaining retrieval ceiling is primarily the malformed canonical article graph, not reranker transport.

Acceptance result: **keep buffered transport and the supported reranker configuration; reject the generated domain and continue content-governance repair**.

## Query Code Boundary and Soft Entity Target Check

Red evidence:

- Query validator test failed because `replaceAnswerLink` did not exist and whole-answer regex treated code as links.
- CRLF/multiline regression extracted `runners` and missed the later semantic article link.
- Consolidation removed routable `ss` under target `2` and merged adjacent routable `nmcli` into `iptables`.

Green verification:

- Query validator plus Query integration: 41/41 passed.
- `ingest-context`: 38/38 passed.
- `ingest-bounded`: 45/45 passed.
- Combined LoEn-focused suite: 319/319 passed.
- Full repository suite: 1258/1258 passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors and four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Built `dist/main.js` SHA-256: `fd9c50f4aa09fc9bc96048595a2dd9f6bde9d11ebb10b8bb9e54bd4d2e5939b8`.

Behavior checks:

- Query answer with valid context link plus fenced TOML `[[runners]]` used one model call and emitted no `FixingLinks` or `assistant_replace` event.
- Three independent routable bundles remained three bundles under target `2`; overflow telemetry identified the excess entity.
- A typed one-fact routable entity remained separate from an adjacent strong routable parent.
- An untyped/pathless supporting fragment still consolidated into its actionable parent and reached the synthesis prompt.

Acceptance result: **locally accepted; live reinit and ten-query rerun required**.

## Soft-Target Live Replay Check

Session `1784986241654` reached terminal `done` in 5,009,118 ms:

- 22/22 sources completed;
- 170 logical calls, 598,494 input tokens, and 398,496 output tokens;
- 136 pages created and 10 later updates;
- zero structural, structured-validation, or semantic-validation retries;
- three transport retry events across two synthesis chains, caused by HTTP `502` near the gateway's 300-second deadline;
- bootstrap map and bootstrap completed on attempt zero.

Compared with configured-profile session `1784979910443`:

- declared entity coverage improved from 29.25% to 51.89%;
- technical snippet preservation improved from 56.05% to 59.40%;
- technical value preservation regressed from 44.19% to 37.21%;
- unsupported generated URLs increased from 21 to 41;
- page count increased from 72 to 136 and duration increased by 78%.

Ten-query evaluation completed 10/10 with one model call per question and no retry. Mean expected-page recall improved from 50.67% to 57.00%, but page grounding fell from 85.17% to 81.94% and source grounding fell from 82.78% to 74.54%.

Acceptance result: **rejected as optimal**. Soft-target routing prevents unrelated hard-cap merges, but unrestricted create eligibility produces excessive fragmentation, higher cost, and weaker source grounding.

## Evidence-Containment Page Eligibility Check

Root-cause evidence:

- Mapper input included plugin-managed `wiki_articles` backlinks from prior runs.
- Model reasoning explicitly reused those backlinks, creating a deterministic self-reinforcing page graph.
- Every typed entity received canonical create authority before page eligibility was established, so routing authority was incorrectly treated as a requirement for a standalone page.

Red/green verification:

- Before implementation, a source-contained `chmod` fragment remained a standalone page candidate.
- Before implementation, a third source-history hint exceeded the configured soft target.
- Before implementation, mapper input retained managed source metadata.
- After implementation, focused ingest context and evidence tests passed 104/104.
- `ingest-bounded` passed 45/45.
- Full repository suite passed 1262/1262.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors and four pre-existing Node-import warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Built `dist/main.js` SHA-256: `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`.

Acceptance result: **locally accepted, live replay pending**. Strict validation, canonical routing, batch size `1`, and the soft target remain unchanged. The current test-vault restart cannot validate this action because it loaded the previous bundle SHA.

## Evidence-Containment Live Replay Check

Session `1785000201763` reached terminal `done` after 4,864,457 ms:

- 22/22 sources completed;
- 159 LLM calls: 22 evidence-map, 135 synthesis, one bootstrap-map, one bootstrap;
- 576,317 input tokens and 361,344 output tokens;
- 122 pages created and 11 updated;
- bootstrap-map and bootstrap completed on attempt zero;
- six transport retry events formed four recovered logical chains;
- two approximately 300-second HTTP 502 responses occurred on heavy calls;
- four short pre-HTTP connection failures recovered on fresh attempts;
- one field-frame parse failure recovered with a fresh structural retry;
- zero structured-validation and domain-validation retries.

Deterministic domain audit:

- 100% source-to-page coverage and 122/122 structurally valid pages;
- declared entity coverage 41.51%;
- exact technical snippet preservation 58.29%;
- URL preservation 71.43%;
- technical value preservation 44.19%;
- 29 generated external URLs absent from attributed sources;
- zero unresolved final WikiLinks;
- 120 pages remained `stub` and all timestamps were model-authored rather than server-owned.

Ten-query evaluation:

- 10/10 completed with one call each and zero retry;
- 51/51 WikiLinks resolved;
- mean expected-page recall 48.17%;
- lexical required-fact coverage 79.81%;
- page and source technical grounding both measured 74.31%.

Manual P0 findings:

- NFS changed export options and commands and introduced placeholders;
- Fail2Ban added regexes and jail values while admitting they were absent from the wiki;
- GitLab Runner added package and systemd commands absent from the source;
- UFW added port/IP examples and a `sysctl` command absent from supplied pages;
- storage replaced exact UUIDs, `defaults,noexec`, and `DirectoryMode=0777` with placeholders, `noatime`, and `0755`.

Acceptance result: **rejected as optimal**. Transport and strict response contracts are stable enough to expose the remaining deterministic page-eligibility and technical-grounding defects.

## Source-Primary Standalone Eligibility Check

Red evidence:

- five non-contained routable candidates remained five synthesis actions under a target of two;
- an explicitly preferred source-primary candidate had no effect on carrier selection.

Green verification:

- focused planner/ingest/settings suite: 110/110 passed;
- full repository suite: 1265/1265 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- project wiki updated and `wiki_lint` reports no broken links; pre-existing orphan/stale/advisory records remain.

Behavior checks:

- target `2` turns five new candidates into two synthesis bundles;
- overflow evidence is present in the carrier bundle and consolidation telemetry;
- exact source, facts, ranges, packet IDs, links, and consolidated keys survive the merge;
- an existing canonical target remains independent even when the target is exhausted;
- source `Fail2Ban.md` selects entity `fail2ban` over earlier candidates without domain-specific rules.

Acceptance result: **locally accepted; combined live replay pending**.

## Query Exact Technical Grounding Check

Red evidence:

- altered modes, paths, URLs, IP ranges, UUIDs, versions, and numbers initially reached final Query output;
- a later WikiLink model repair could rewrite an already grounded technical value;
- the first exact-copy prompt expansion displaced the post-reranker winner at the `7000`-token parity boundary.

Green verification:

- focused Query grounding, budget, link, and parity suite: 64/64 passed;
- full repository suite: 1275/1275 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- iwiki updated; `wiki_lint` reports zero broken links, missing sources, and legacy WikiLinks.

Behavior checks:

- an exact answer completes with one model call;
- unsupported technical units schedule at most one fresh repair call;
- a still-unsupported repair becomes a localized insufficient-evidence response;
- a WikiLink repair that changes `DirectoryMode=0777` to `DirectoryMode=0755` is rejected;
- `22` is not accepted from `22.04`, and `600` is not accepted from `6000`;
- Markdown item numbers do not become false technical claims;
- Query prompt compaction restores the reranker winner under the existing tight input budget.

Acceptance result: **locally accepted; delivery and combined live replay pending**.

## Query Deterministic Grounding Sanitation Check

Red evidence from the strict-repair replay:

- 10/10 queries completed, but seven extra grounding model calls doubled Query cost to 93,736 tokens and raised mean latency to 34.5 seconds;
- one repair exceeded the 16,384-token Query input budget and two repairs returned reasoning without final frames;
- final required-fact coverage fell to 55.14% with three fail-closed answers;
- `SSD/HDD` was falsely classified as path `/HDD`.

Green verification:

- focused Query grounding/budget/link suite: 54/54 passed;
- full repository suite: 1278/1278 passed;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `5d310141f3b3f76ce32ed6343948ce07220feec84bb5505491111055679c8c15`.

Ten-query span-sanitation replay:

- 10/10 completed, zero transport or structural retry, zero invalid WikiLinks, and zero empty/fail-closed answer;
- mean fact coverage recovered to 77.05%, with five full answers and no zero-fact answer;
- 11 calls and 54,136 total tokens, down from 17 calls and 93,736 tokens in the strict-repair replay;
- mean latency fell from 34.5 to 21.4 seconds;
- one remaining npm repair was traced to Markdown heading ordinals, fixed locally, and the one-case live check then completed in one call with 100% fact coverage and zero retry.

The raw first candidates averaged 90.14% fact coverage. Remaining post-validation losses are unsupported commands absent from selected generated pages: GitLab Runner installation/service commands, WD GREEN mount details, NFS client mount commands, and SSH key generation commands.

Acceptance result: **keep Query sanitation; overall pipeline still needs work**. Safety, retry, and cost gates pass. The 79.81% fact target cannot be met safely until synthesis preserves source technical evidence in canonical pages.

## Synthesis Exact Technical Evidence Ledger Check

Red evidence:

- A create draft that omitted source command `sudo safe --flag` and source URL while adding invented command and URL was written unchanged before integration.
- A synthesis `SKIP` could complete when a fenced source block had no persisted representation.
- A broad ingest run exposed a raw-regex escape defect that collapsed `tt` in an allowed existing `https` URL; the focused draft test alone did not expose it.
- Multi-line source blocks could be considered covered when their lines appeared separately and out of order context.

Green verification:

- configured LoEn verifier: 251/251 passed;
- full repository suite: 1287/1287 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `8fa8190a3826a8f243a828b7ceca5b244a94d7e5313eaacb8dba1b9c466f4bb3`.

Behavior checks:

- exact fenced segments and source URLs survive synthesis without relying on mapper prose or model repair;
- unsupported model code and URLs are removed locally, missing source items are appended, and the test uses exactly the original two LLM calls;
- a skipped unrepresented ledger fails before page writes;
- existing target URLs remain byte-correct, and a new URL is accepted only when present in the source;
- multi-line segments require contiguous ordered representation;
- prompt breakdown reports technical evidence cost without leaking content;
- measured 22-source corpus cost is about 6,974 content tokens total, with the largest single source about 3,446 tokens, so no global budget increase is required.

Documentation check:

- added `architecture/synthesis-exact-technical-evidence-ledger` and linked it from Query grounding;
- `wiki_lint` reports zero broken links, missing sources, legacy WikiLinks, or new orphan pages;
- two pre-existing orphan pages plus existing stale/advisory records remain outside this bounded action.

Acceptance result: **locally accepted; one clean 22-source live replay required**. Static safety, budget, and retry gates pass. Live content-preservation thresholds and page-count ceiling remain unmeasured for bundle `8fa8190a...`.

## Same-Target Canonical Bundle Repair Check

Red evidence from session `1785040016216`:

- the old-bundle replay ended after 3,775,978 ms with 21/22 sources, 120 model calls, 83 creates, 7 page updates, and `finish status=error`;
- it emitted zero structural repairs and zero structured-validation retries; its only transport retry was one recovered `ingest.evidence-map` HTTP `502`;
- `user.formatted.md` created `concepts/wiki_os-unix_user_management_commands.md` successfully;
- the next `user.md` mapper emitted `userdel` and `usermod`, both alias-resolved to that exact page;
- independent batch-size-one synthesis calls each returned a patch for the same target;
- the final strict collision guard rejected the second action with `strict path/source collision guard rejected`;
- init then awaited its configured file-error decision callback, with no progress event explaining the wait.

Green verification:

- focused ingest/context/init suite: 111/111 passed;
- configured LoEn verifier: 252/252 passed;
- full repository suite: 1289/1289 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `e480ef6886565a331c371a2077e73c408a066c19f180d84b5cf2c3d4d853d25c`.
- iwiki has a linked `architecture/same-target-synthesis-ownership` page; `wiki_lint` reports zero broken links and no new orphan, with pre-existing stale/advisory records unchanged.

Behavior checks:

- two aliases sharing one existing target produce one synthesis call and one canonical patch;
- evidence and required target context from both aliases reach the carrier prompt;
- different canonical targets and pathless bundles remain independent;
- duplicate paths returned through any other route remain rejected;
- full and incremental init expose both the file-decision wait and selected decision.

Acceptance result: **locally accepted; live replay pending**. The exact failing source is covered by an integration test, but the new bundle has not yet loaded in Obsidian.

## Same-Target Live Replay Check

Session `1785045313209`:

- terminal `done`, 22/22 sources, 2,635,098 ms;
- 123 calls: 22 evidence-map, 99 synthesis, bootstrap-map and bootstrap;
- 123/123 HTTP responses were `200`;
- zero transport, structured-validation, or semantic retry;
- one local schema repair for duplicate normalized heading `Примеры`, recovered without budget overflow;
- 89 pages, 89 creates and 8 updates;
- page integrity passed with zero invalid page, duplicate alias owner, or alias/primary conflict.

Domain audit:

- 100% source-to-page coverage;
- technical snippets `490/537` (`91.25%`), URLs `21/21`, technical values `25/43` (`58.14%`);
- zero unresolved final WikiLinks and zero unsupported generated URLs;
- page-count ceiling failed by four (`89 > 85`);
- every page retained a model-authored stale timestamp; zero pages used the run date `2026-07-26`.

Ten-query audit:

- 10/10 completed, zero transport/structural retry, zero invalid WikiLinks;
- mean fact coverage `73.524%`, five complete cases, one AMD fail-closed case;
- 11 calls, 32,239 input and 23,252 output tokens, mean latency 17.061 s;
- retrieval found the correct AMD/UFW/storage/npm pages, but only one section per article reached context and local sanitation removed unsupported commands.

Acceptance result: **execution accepted; domain quality still needs work**. Transport and strict response handling are no longer the blocker.

## Markdown Technical Evidence Boundary Check

Red evidence:

- list-indented backtick and blockquote-indented tilde fences produced zero ledger items;
- unfenced npm shell lines produced zero ledger items.

Green verification:

- focused ledger tests: 8/8 passed;
- configured LoEn verifier: 254/254 passed;
- full repository suite: 1291/1291 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- `wiki_lint`: zero broken or legacy links; pre-existing stale/orphan/advisory records remain.

Static behavior checks:

- `AMD Driver.md` ledger expanded from 7 total items/3 code items to 30 total/27 code items;
- all npm installation/prefix/PATH/clasp commands are required ledger evidence;
- 522/537 existing audit snippets now occur in deterministic ledger coverage;
- maximum source ledger remains far below the 65,536 ingest input ceiling.

Acceptance result: **locally accepted; combine with remaining deterministic P0 fixes before another 44-minute replay**.

## Server-Owned Article Lifecycle Metadata Check

Red evidence:

- create accepted a stale model timestamp and a mature model status;
- session `1785045313209` produced 89/89 pages with stale model-authored timestamps.

Green verification:

- create and update tests prove the operation date replaces model metadata;
- create is always `stub`, while update preserves the existing page status;
- focused ingest/ledger suite: 57/57 passed;
- configured LoEn verifier: 254/254 passed;
- full repository suite: 1291/1291 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `2c3fd9a575a6363adf4e249d82ef7e46808d40ff82ebae2a3eaec8a9e8a7a51e`.

Acceptance result: **locally accepted; live date audit remains part of the combined replay**.

## Source-Primary Carrier Coherence Check

Red evidence:

- the planner assigned `blkid` to narrow `du` instead of the broad source carrier;
- live session `1785045313209` showed the same shape for storage and user-management overflow.

Green verification:

- broad-evidence/source-cap regression: passed;
- focused ingest/context suite: 94/94 passed;
- configured LoEn verifier: 254/254 passed;
- full repository suite: 1292/1292 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `0eaf407ccc2cf4f255f65ee8e37f95bcf77ad4d344fdf296b819449f29720913`.

Acceptance result: **locally accepted; live carrier names and page count remain to be measured with source target `5`**.

## Query Article-Depth Context Packing Check

Red evidence:

- no shared selector existed and both Query flows used `reranked.chunks.slice(0, contextLimit)`;
- the live ten-query audit commonly selected eight different articles and omitted technical sibling sections.

Green verification:

- selector unit tests prove six anchors plus two siblings for `contextTopN: 8`, global fallback, stable order, top-one behavior, and invalid-limit handling;
- Query focused/parity suite: 58/58 passed;
- all Query tests: 72/72 passed;
- full repository suite: 1296/1296 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `a402b51f73797fb225e848c00612f418641340bf8f99c2afe09b177127063312`.

Acceptance result: **locally accepted; fixed ten-query replay required after domain regeneration**.

## Domain-Neutral Frame Repair and Query Candidate-Pool Check

Live baseline, session `1785057814992`:

- terminal `done`, 22/22 sources, 83 creates and 4 updates in 3,008,993 ms;
- 113 successful HTTP `200` responses;
- bootstrap-map and bootstrap both completed on attempt zero;
- two structural synthesis repairs, both on one source;
- the first malformed response contained `<<<REASONING>>>` without an action frame, then fell through to a JSON parse error;
- repair history grew from 18,331 to 20,896 input tokens before one recovered HTTP `502` on the second repair;
- page integrity passed for all 83 pages with no duplicate alias owner, alias/primary conflict, or persisted protocol marker.

TDD and static verification:

- red focused run: 5 expected failures, 117 passes;
- green focused parser/repair/query run: 122/122 passed;
- enabled reranker candidate-pool suite: 29/29 passed;
- full repository suite: 1299/1299 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`.

Repeated ten-query evaluation:

- all 10 cases completed with zero model retry;
- retrieval hit rate and valid cited-link precision remained `100%`;
- mean required-fact coverage improved from `84.761%` to `95.237%`;
- mean expected-page recall changed from `44.166%` to `42.166%` because two final slots moved from extra article anchors to sibling sections; required retrieval hit did not regress;
- mean latency improved from `17.873 s` to `15.191 s`;
- input tokens decreased from `29,172` to `28,003`;
- each final context contained six distinct article anchors plus two sibling chunks at the unchanged size of eight.

Documentation verification:

- updated structured runner, framed parser, and hierarchical retrieval contracts;
- `wiki_lint` reports no broken, missing-source, or legacy links;
- pre-existing orphan, stale, and advisory records remain outside this bounded action.

Acceptance result: **Query candidate-pool fix accepted; frame/repair fix locally accepted with one live reinit pending**. The implementation is domain-neutral and changes no taxonomy, canonical routing, batch size, or token ceiling.

Delivery check: **blocked by external-write policy**. The candidate bundle is built, but test-vault `main.js` still has SHA `a402b51f73797fb225e848c00612f418641340bf8f99c2afe09b177127063312` rather than candidate SHA `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`.

## Domain-Neutral Stable Grounding and Wire Compatibility Check

TDD and static verification:

- mapper/reranker/query focused suite: 163/163 passed;
- full repository suite: 1303/1303 passed, zero skipped;
- `npx tsc --noEmit`: passed;
- `npm run lint`: zero errors and four pre-existing Node-import warnings;
- `npm run build`: passed;
- `git diff --check`: passed;
- built `dist/main.js` SHA-256: `96a4053266325123816a9200fa4fbba6683e93176b68a6011d1bce8a87213178`.

Fixed ten-query variants on the immutable 78-page domain:

| Variant | Fact coverage | Page recall | Retries | Invalid links | Mean latency |
|---|---:|---:|---:|---:|---:|
| Accepted baseline | 92.904% | 43.166% | 0 | 0 | 18.612 s |
| Reranker content only | 93.142% | 43.166% | 0 | 0 | 15.705 s |
| Article anchor rescue | 82.667% | 45.166% | 1 | 0 | 15.748 s |
| Rescue plus sibling scores | 84.333% | 45.166% | 1 | 0 | 14.876 s |
| Accepted selector plus stable sanitation | 91.238% | 43.166% | 0 | 0 | 15.431 s |

The final run completed 10/10 with 100% WikiLink precision and restored NFS from fail-closed 0% to 100% without repair. Its 1.666-point mean difference from baseline is one storage fact in one temperature-0.5 response; all other per-case fact scores match baseline and retrieval shape remains the accepted selector.

Acceptance result: **keep mapper wire normalization, bounded reranker content, and stable grounding sanitation; reject and remove article rescue and sibling-score ordering**.

Delivery check: **blocked by external-write policy**. Candidate `main.js` is `96a4053266325123816a9200fa4fbba6683e93176b68a6011d1bce8a87213178`; installed test-vault `main.js` is still `799578b02a5efb302ad53631156b6132ef8e781ac7929898da57ec7d6bdfaffd`.

## Guarded Conflict-Regeneration Live Bundle Replay Check

Bundle and terminal state:

- Installed and loaded `dist/main.js` SHA-256: `3227133ae43e4a3eab2edbecae4a1942b1665dac688485128f623da90192f1eb`.
- Session `1785096684125` completed `22/22` sources with `status=done` in 2,189,398 ms.
- Bootstrap completed on attempt zero through `desktop-host`.
- All 106 HTTP responses were `200`; transport, structural, structured-validation, and semantic-validation retry counts were all zero.
- Conflict regeneration was not reached naturally. Its malformed-frame and semantic-rejection bounds therefore remain live-inconclusive and locally covered by the 61/61 focused tests.

Prior-session comparison:

| Metric | `1785087161419` | `1785096684125` |
|---|---:|---:|
| Terminal status | error | done |
| Duration | 3,595,961 ms | 2,189,398 ms |
| LLM calls | 122 | 106 |
| Transport retries | 3 | 0 |
| Structural retries | 1 | 0 |
| Input tokens | 471,165 | 413,375 |
| Output tokens | 318,813 | 280,647 |
| P95 call latency | 61,116 ms | 42,424 ms |
| Maximum call latency | 322,768 ms | 71,154 ms |

Prompt and domain checks:

- Maximum provider-reported input was 18,221 tokens. The 63,478-token local estimate was a Fail2Ban batch with 97 technical-evidence blocks, not a real context overflow.
- Final domain: 76 pages, 100% source-to-page coverage, 525/537 exact technical snippets preserved, and 21/21 URLs preserved.
- Page integrity passed: zero invalid H1 counts, duplicate alias owners, alias/primary conflicts, unresolved final WikiLinks, or unsupported page URLs.
- Nine self-links remain confined to source citations. Intermediate WikiLink warnings were transient and resolved after final indexing.

Ten-query checks:

- 10/10 completed; retrieval hit 10/10; zero retry; zero invalid WikiLinks.
- Expected-page recall improved from 48.166% to 56.000% macro and from 50.000% to 57.500% micro.
- Required-fact coverage changed from 93.238% to 91.809% macro and from 93.103% to 91.379% micro.
- All omitted expected facts exist in generated pages; misses occurred in retrieval/answer selection, not synthesis preservation.
- Exact technical grounding was 215/215 against generated pages and 212/215 against clean source notes.

Acceptance result: **partial pass; fix required**. Retry, transport, runtime, integrity, and grounding gates pass. The conflict branch lacked a natural live trigger, exact snippet preservation is 97.77%, and Query fact coverage is below the accepted 92.904% gate.

## Technical Debt Publication Check

- Local register: `docs/loen/dynamic-llm-budget-routing/tech-debt.md`.
- Project wiki: `architecture/dynamic-llm-budget-routing-technical-debt`, linked from `overview.md`.
- `wiki_lint`: zero broken links, missing sources, legacy WikiLinks, new-page orphans, or new-page advisories.
- Existing wiki state remains: two unrelated orphans, eight stale pages, and 54 unrelated advisories.
- Known API key from ignored `tmp/api.txt` has zero matches in tracked or untracked commit content.
