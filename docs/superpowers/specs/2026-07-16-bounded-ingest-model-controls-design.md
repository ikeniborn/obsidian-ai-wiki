---
review:
  spec_hash: 07e1445bc795678d
  last_run: 2026-07-19
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-16-bounded-ingest-model-controls-intent.md
---

# Bounded Ingest and Model Controls - Design

Date: 2026-07-16
Status: approved
Intent: `docs/superpowers/intents/2026-07-16-bounded-ingest-model-controls-intent.md`

## Acceptance From Intent

- A one-page domain and a 100-page domain can complete normal Ingest without a model context-length error when their source input is within the supported budget.
- The current 22-source Init/Re-init scenario completes on a safe vault copy instead of failing every `ingest.pages` call after the first source.
- Every page-synthesis request stays within an explicit context budget and contains no embedding vectors or other machine-only service records.
- Create/update decisions remain stable against focused regression fixtures, and the bounded context does not introduce duplicate pages.
- Updating an existing page preserves its prior facts and untouched sections while incorporating relevant information from the current source.
- Small domains do not lose relevant context or synthesis quality merely because the same bounded pipeline also supports larger domains.
- An oversized source is processed through bounded Markdown chunks and structured evidence reduction instead of failing, being truncated, or losing unprocessed sections.
- Native backend users can configure global input/output token budgets and override both values per operation; Claude Agent users can configure the input budget globally and per operation while output limits remain owned by the external CLI configuration.
- Existing `maxTokens` values retain their output-limit meaning and appear as `Output budget tokens`; no saved value silently changes meaning during migration.
- A global maximum/balanced/minimum semantic compression profile has per-operation overrides when per-operation mode is enabled. Ingest/Init compress evidence representation without dropping facts, Query/Chat/Lint compress prose without dropping findings, and Vision compresses descriptions without changing recognized OCR, objects, or structure. Format is excluded because it must not semantically rewrite content.
- The native Vision model `Check` action sends a real inline-image request through the configured Base URL, API key, and model, then reports a clear success or provider error without mutating settings.
- Every model-backed operation shows a human-readable lifecycle in the sidebar without
  exposing `callSite`, transport, attempt, or budget fields there.
- Reasoning remains expandable while progress distinguishes waiting for the first response
  from receiving model output.
- Full Re-init removes the complete prior domain tree, including obsolete empty
  subdirectories, before creating fresh domain state.
- Done when: 1-page, 15-page, and 100-page fixtures stay within the selected context budget with no raw vectors; oversized-source evidence covers every input chunk; focused create/update and duplicate checks pass; untouched sections are preserved; unchanged chunk embeddings are reused; the 22-source Init/Re-init scenario completes on a safe vault copy without a context-length failure; global/per-operation budgets and compression profiles resolve correctly; compression preservation invariants pass for Ingest, Lint, and Vision while Format remains unchanged; the native Vision image probe passes success/failure read-only fixtures; all model-backed operations expose the approved human lifecycle without technical sidebar fields; and full Re-init leaves no stale descendants in the rebuilt domain tree.

## Problem Evidence

The production log at
`/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/agent.jsonl`
contains one Init/Re-init session over 22 sources. The first source completes. Every later
`ingest.pages` request fails with a prompt size between approximately 556,000 and
565,000 tokens against a 524,288-token model context limit. The entity-extraction call
for each of those sources remains small and succeeds, so accumulated operation history
is not the cause.

The on-disk domain state identifies the dominant payload:

- `!Wiki/os-unix/index.jsonl`: 1,277,348 bytes across 58 `chunk` records containing
  numeric embedding vectors.
- All 15 wiki Markdown pages combined: 29,504 bytes.
- `src/phases/ingest.ts::buildIngestMessages` appends the complete index text under the
  legacy label `Wiki index (_index.md)`.

`domainIndexPath` used to identify a compact Markdown annotation index. It now identifies
`index.jsonl`, which is machine storage for page metadata and chunk vectors. The old
prompt assembly remained after the storage migration. The current runtime also still
uses Markdown-oriented `parseIndexAnnotations`, `upsertIndexAnnotation`, and
`reconcileIndex` against the JSONL path. In the observed domain the result is an index
containing chunk records but no persisted page records.

Two secondary scaling defects remain after removing the raw index payload:

- per-entity retrieval selects up to `relevantPagesTopK` pages for every entity, then
  sends the deduplicated union as complete Markdown pages with no global prompt budget;
- `runIngest` reports a failed page-synthesis call as events and returns normally, so
  `runInitWithSources` can still mark that source analyzed.

The structured-output transport currently retries most streaming errors as non-streaming
with the same messages. A context-length error must bypass that transport fallback and
return to a context governor that can repack the request.

## Chosen Approach

Use a structured evidence map/reduce pipeline with per-entity reducers and section-level
page patches. Every LLM call is governed by an operation-specific model-call policy.
Small sources follow the same pipeline with one source chunk, keeping behavior coherent
across domains from 1 to 100 pages. Large sources add map/reduce calls rather than
truncating content or failing solely because the original source cannot fit one prompt.

The design has four coordinated parts:

- bounded prompt construction and context-overflow recovery;
- Markdown source chunking, structured evidence extraction, and per-entity reduction;
- section-level page updates plus structured JSONL page/chunk persistence;
- Settings controls for budgets/compression and a native Vision image probe.

Two operational contracts complement those parts:

- one shared model-call lifecycle for Init/Re-init, Ingest, Query, Chat, Lint, Format,
  and Vision;
- one fail-closed destructive Re-init wipe that deletes and recreates the target domain
  tree without retaining stale descendants.

Rejected alternatives:

- **Only remove `index.jsonl` from the prompt.** This fixes the observed immediate error
  but leaves an unbounded union of complete pages and does not support oversized sources.
- **Recursive free-text summaries.** This is simpler than evidence packets but repeated
  summarization can lose rare commands, numeric values, exceptions, and source anchors.
- **Independent per-entity pipelines without a shared reducer.** Calls stay small, but
  global duplicate detection and cross-entity consistency become weaker and more costly.
- **Reuse `maxTokens` as an input limit.** `maxTokens` is already the native API output
  cap. Reinterpreting saved values would silently change behavior and would conflate two
  independent resource limits.

## Model Call Policy

Each operation resolves one policy before constructing messages:

```ts
type CompressionProfile = "maximum" | "balanced" | "minimum";

interface ModelCallPolicy {
  inputBudgetTokens: number;
  outputBudgetTokens?: number;
  compression: CompressionProfile;
}
```

Native OpenAI-compatible operations receive input and output budgets. The output value
continues to populate API `max_tokens`. Claude Agent operations receive the input budget
and compression profile only; the external CLI configuration remains the owner of the
Claude output cap.

Policy resolution follows current operation routing:

- direct Ingest uses the `ingest` policy;
- Init/Re-init, including nested ingest work, uses the `init` policy;
- Query and cross-domain Query use the `query` policy;
- Lint and Lint follow-up use the `lint` policy;
- Query follow-up Chat inherits the `query` policy;
- Format uses numeric budgets but no semantic-compression fragment;
- Vision analysis uses the Format input policy plus the Vision compression override when
  configured.

The global input-budget default is `16384`. The global compression default is
`balanced`. Existing native output defaults remain unchanged. Per-operation mode exposes
operation values or overrides without changing the meaning of existing model,
temperature, effort, or thinking-budget controls.

## Token Estimation and Prompt Packing

Exact tokenization is model-specific and unavailable through the OpenAI-compatible
contract. The first implementation adds no tokenizer dependency. Text parts use a
conservative preflight estimate where one UTF-8 byte is one estimated input token. This
intentionally underuses some model contexts but never treats a multi-byte string as
cheaper than its serialized representation. An `image_url` is an opaque media unit:
base64 bytes are not counted as text tokens, and each raster/PDF page reserves 4,096
estimated input tokens. Provider context errors remain the authoritative signal when a
model prices media differently. Successful backend usage remains the authoritative actual
token count for telemetry.

The estimator runs after base contract, language, reasoning, custom system prompt, schema,
and compression fragments have been injected. The budget therefore applies to the full
serialized message content, not only source/wiki text.

Context units use this contract:

```ts
interface ContextUnit {
  id: string;
  source: "system" | "schema" | "source" | "evidence" | "wiki" | "registry";
  text: string;
  required: boolean;
  priority: number;
  estimatedTokens: number;
}
```

Packing rules:

- system/schema contracts and the current task payload are required;
- a targeted existing section is required for a `replace` patch;
- related wiki sections, tag vocabulary beyond required tags, and auxiliary descriptions
  are optional and ordered by retrieval score plus page diversity;
- a context unit is included completely or omitted completely;
- no generic substring truncation is allowed;
- required units that exceed the budget invoke operation-specific splitting/reduction;
- fixed prompt overhead that alone exceeds the configured budget produces a visible
  configuration error.

Every call records estimated input, configured/effective budget, actual input when the
backend reports usage, unit counts, and reduction depth. Prompt content is not logged.

## Human-Readable LLM Lifecycle

Model progress is emitted at execution boundaries rather than inferred from elapsed time
or from unrelated tool events. One lifecycle uses these ordered user states:

1. `Preparing request`
2. `Request sent to model`
3. `Waiting for model response`
4. `Model is producing a response`
5. `Validating response`
6. `Applying result`
7. terminal `Completed`, `Retrying`, `Failed`, or `Cancelled`

The sidebar translates each state and combines it with an operation-specific human action,
for example `Extracting source facts`, `Creating wiki pages`, `Answering the question`, or
`Analyzing attachments`. It never renders `callSite`, transport, attempt number, token
budget, or raw provider diagnostics. Those technical fields remain in `agent.jsonl`.

The waiting duration is rendered by a local view timer. The timer emits no `RunEvent` and
does not reset the operation idle watchdog. A request transition is emitted once when the
client call is dispatched. Streaming calls transition to `Model is producing a response`
on the first reasoning or content chunk. Reasoning text continues to use the existing
expandable reasoning block.

Background structured calls whose output is consumed atomically use non-stream transport:
Init bootstrap, evidence mapping/reduction, Ingest synthesis, and bounded Lint batches.
Their reasoning is surfaced after the response is parsed. Interactive Chat, Query answer,
and Format keep SSE; their first reasoning/content chunk advances the lifecycle live.
Transport fallback, structured repair, and context repacking close the current lifecycle
as `Retrying` before opening the next attempt. Attempt numbers remain log-only.

The lifecycle helper is shared by native OpenAI-compatible calls and operation-level Claude
execution so operation names and states remain consistent across backends. A state event
contains a stable operation identity, phase, human action key, elapsed-time anchor, and
log-only diagnostic metadata. The view consumes only the identity, phase, and action key.

## Full Re-init Domain Wipe

Destructive Re-init reads and validates the bootstrap result before mutation, then removes
the complete target `!Wiki/<domain>` tree exactly once. This includes pages, `index.jsonl`,
`metadata.jsonl`, logs, temporary files, entity-type folders, and obsolete empty folders.
The runtime then recreates the domain root and writes fresh metadata/index state from the
approved bootstrap result.

Deletion failure is terminal and occurs before source ingest. The implementation verifies
that no prior descendant remains before recreation. Other domains are outside the deletion
scope and remain byte-identical. Internal model retries cannot replay the destructive wipe.

## Oversized Source Chunking

The source chunker is Markdown-aware and deterministic. It scans lines while tracking
heading hierarchy and fenced-code state. Each chunk records original line ranges and a
content hash:

```ts
interface SourceChunk {
  id: string;
  headingPath: string[];
  ordinal: number;
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
}
```

Splitting order:

1. top-level and nested Markdown sections;
2. paragraph boundaries inside an oversized section;
3. line windows with overlap inside an oversized paragraph or fenced block.

Code-fence segments carry the original fence language and line-range anchor. The chunker
does not discard lines. A coverage check unions all source line ranges and fails before
LLM work if any original line is missing. Small sources produce one chunk and use the same
downstream contracts.

## Evidence Mapping and Reduction

Each source chunk is sent to a structured evidence mapper. The mapper returns evidence
packets or an explicit no-evidence record:

```ts
interface EvidencePacket {
  id: string;
  chunkId: string;
  entityKey: string;
  entityType?: string;
  facts: string[];
  exactSourceRanges: Array<{ startLine: number; endLine: number }>;
  links: string[];
  sourceAnchor: string;
}

interface NoEvidence {
  chunkId: string;
  reason: string;
}
```

The server validates every referenced line range and copies exact technical fragments
from the source rather than trusting the model to reproduce commands or code. Every
`SourceChunk.id` must occur in at least one packet or one `NoEvidence` result.

The deterministic reducer first groups packets by normalized `entityKey`, removes exact
duplicate facts/ranges/links, and preserves packet IDs. An entity group that still exceeds
its available context is reduced through another structured call. The reduced result must
list every consumed packet ID. Missing IDs trigger structured repair; exhaustion fails the
source instead of accepting partial evidence.

Compression profiles control representation density, not evidence eligibility:

- `maximum`: remove repetition and prose padding; keep one dense statement per distinct
  fact and retain all exact ranges;
- `balanced`: retain concise fact context and relationships;
- `minimum`: retain detailed explanations without inventing facts absent from evidence.

No profile may drop packet coverage, exact ranges, or required entity relationships.

## Structured JSONL Index Boundary

`index.jsonl` remains the single storage file and keeps its existing `page` and `chunk`
record schemas. Runtime annotation operations move to structured helpers:

- parse JSONL once into page/chunk records;
- upsert/remove/reconcile `page` records by `articleId`;
- preserve all unrelated `chunk` records during page-record writes;
- preserve all unrelated `page` records during chunk-vector refresh;
- derive retrieval descriptions through `collectPageDescriptions` or its structured
  replacement;
- keep legacy Markdown annotation parsing only in migration code, not normal runtime.

The ingest prompt builder receives typed page descriptions and selected Markdown context
units. It never receives serialized index content. Types and tests enforce that neither
`vector` nor a raw `WikiIndexRecord` can cross the prompt-builder boundary.

## Wiki Context Selection

Retrieval remains per entity, but its output becomes globally bounded:

1. rank candidate pages for the entity from page descriptions/chunk vectors;
2. read only candidate page Markdown;
3. split candidate pages into complete sections;
4. score sections against the entity evidence;
5. deduplicate exact section text;
6. add section units to the global packer by score and page diversity.

`relevantPagesTopK` remains a candidate-generation limit, not a guarantee that every
selected page is sent. The context packer owns the final limit. A one-page domain can send
all complete sections when they fit. A larger domain sends only the sections that fit after
required source evidence and fixed prompt overhead.

## Page Synthesis and Patch Contract

Synthesis batches contain one or more entity bundles while the complete request fits the
input budget. The output is a discriminated union:

```ts
interface CreatePage {
  kind: "create";
  path: string;
  annotation: string;
  content: string;
}

interface PatchPage {
  kind: "patch";
  path: string;
  expectedPageHash: string;
  annotation?: string;
  sections: SectionPatch[];
}

interface SectionPatch {
  heading: string;
  expectedSectionHash?: string;
  operation: "add" | "append" | "replace";
  content: string;
}
```

Rules:

- new pages are complete Markdown documents;
- existing pages are never replaced wholesale by a draft built from partial context;
- `replace` is allowed only when the full current section was supplied to the model;
- `add` must target a heading absent from the current page;
- `append` adds non-duplicate facts while preserving existing section text;
- section deletion is not part of this contract;
- page/section hashes guard concurrent or stale edits;
- governed frontmatter, entity-type tags, `resource`, and `## Sources` remain server-owned;
- link validation, strict article-path validation, source collision guards, and current
  dedup thresholds remain in force.

When dedup identifies a new draft as an existing entity, synthesis targets the canonical
page through patches. Existing page deletion remains allowed only through the current
validated duplicate-merge path after incoming evidence has been represented in the
canonical page. Path validation and large-delete warnings remain unchanged.

## Write and Resume Semantics

All map/reduce/synthesis output is validated before applying the corresponding change
batch. A source is successful only after:

- every source chunk has evidence/no-evidence coverage;
- every entity bundle has a validated create/patch result or an explicit skip decision;
- all accepted page writes finish;
- JSONL page records reconcile with on-disk pages;
- changed-page chunk vectors refresh successfully when embeddings are configured;
- source backlinks reconcile with actual page paths.

`runIngest` must expose a typed success/failure outcome to Init instead of relying on a
normal generator return after error events. `runInitWithSources` writes the analyzed-source
hash only for a successful outcome. A failed or skipped source remains resumable.

Vault writes are not transactional. A failure after some successful page writes does not
delete those pages. The source remains unanalysed, and the next run performs idempotent
page/index/backlink reconciliation before completing it.

## Semantic Compression Policies

Three shared prompt fragments define representation density:

- `prompts/compression-maximum.md`
- `prompts/compression-balanced.md`
- `prompts/compression-minimum.md`

The fragment is combined with operation-specific invariants:

- Ingest/Init: preserve every evidence packet/range and generated knowledge fact;
- Query/Chat: preserve claims needed to answer the question and their citations;
- Lint/Lint Chat: preserve every finding, severity, path, and repair instruction;
- Vision: preserve recognized OCR, objects, relationships, layout/structure, and
  uncertainty;
- Format: inject no semantic-compression fragment.

The global profile defaults to `balanced`. When per-operation mode is enabled, each
compressible operation exposes `Use global`, `Maximum`, `Balanced`, and `Minimum`.
Vision exposes its override in the Vision section. Query follow-up and Lint follow-up
inherit their parent operation profiles.

## Non-Ingest Budget Adapters

Every operation has an explicit response when required content exceeds its input budget.
None may fall back to generic string truncation.

### Query and Chat

The current question, active system contract, and selected citation-bearing wiki chunks
are required. Older chat turns and lower-scored context chunks are optional whole units.
The packer removes optional units by age/score while retaining complete messages/chunks.
If the current question plus fixed contract alone exceeds budget, the operation reports a
configuration/input error rather than truncating the question. Cross-domain Query uses the
same rule after domain-level candidate fusion.

### Lint and Lint Chat

Lint processes pages in budgeted batches and records page IDs covered by every batch.
Findings from all batches are merged deterministically by page, section, rule, and finding
text. An oversized single page uses the Markdown section chunker; its section findings are
recombined before domain-level reporting. Compression changes wording density only and
cannot remove a finding, severity, location, or repair instruction. Lint Chat packs whole
findings and chat turns, preserving the current instruction and every finding selected for
repair.

### Format

Format keeps the current single-call path when the complete request fits. An oversized
note uses a preservation-oriented Markdown segment pipeline:

1. extract frontmatter and immutable Obsidian embeds/tokens with their existing guards;
2. split the body into ordered complete sections, then paragraphs/line windows when one
   section is still oversized;
3. format each segment independently with the same schema and neighboring heading path,
   forbidding movement across segment boundaries;
4. route each Vision description only to the segment containing its embed;
5. reassemble segments in original order and merge per-segment reports;
6. run existing frontmatter, token, embed, WikiLink, sentinel, and preview safeguards over
   the complete reconstructed note.

Format receives no compression fragment. If one segment's output reaches the output cap,
the segment is split more narrowly and retried; partial framed output is not accepted as a
complete segment.

### Vision Analysis

Raster images and Excalidraw renders remain one required media unit per analysis call.
Multi-page PDFs are processed in page batches that fit the input reservation. Each page
produces a structured recognition record with OCR, objects, relationships, layout, and
uncertainty. Batch records are reduced only for prose density; page IDs and recognition
fields remain covered. If one rendered page exceeds the provider context despite the media
reservation, it is resized once within existing rendering-quality constraints and retried;
continued failure skips that attachment with the current visible warning rather than
inventing a description.

## Settings Model and Migration

Native settings add:

```ts
interface NativeAgentSettings {
  inputBudgetTokens: number;
  maxTokens: number; // persisted key; displayed as Output budget tokens
  compressionProfile: CompressionProfile;
}

interface NativeOperationConfig {
  inputBudgetTokens: number;
  maxTokens: number;
  compressionProfile?: CompressionProfile; // undefined means Use global
}
```

Claude settings add global/per-operation `inputBudgetTokens` and
`compressionProfile`. They do not add an output-budget field. Existing Claude model and
effort behavior is unchanged.

Load behavior:

- missing input budgets receive `16384`;
- missing compression profiles receive `balanced` globally and `Use global` per
  operation;
- existing `maxTokens` values are retained exactly;
- the UI label and description change from ambiguous `Max tokens` to
  `Output budget tokens`;
- native global controls show input, output, and compression;
- native per-operation sections show input/output plus compression except Format;
- Claude global/per-operation sections show input plus compression except Format;
- invalid numeric edits do not replace the last valid saved value;
- EN/RU/ES settings text remains shape-compatible and synchronized.

## Native Vision Model Probe

The Vision model control uses the existing `addModelControl` Check-button placement. The
button is present only for the native OpenAI-compatible backend. The helper sends one
read-only `/chat/completions` request containing:

- the configured Vision model;
- a short text instruction;
- a small static inline PNG as an `image_url` content part;
- a small internal output cap;
- the configured Base URL and local API key.

Success requires HTTP status below 400 and non-empty assistant content. Timeout, HTTP
error, malformed response, and empty content produce distinct failure notices. The probe
does not modify the model field, budgets, compression profile, or any vault file.

Claude Agent Vision Check and Claude multimodal transport are outside this design.

## Context Error Recovery

Context-length errors are classified before generic streaming fallback. The same
oversized messages must not be retried as non-streaming.

For a context error:

1. if the provider reports prompt size and maximum context, multiply the current
   effective budget by `maxContext / promptSize`, then apply a `0.9` safety factor;
2. otherwise reduce the effective input budget to `75%` of its previous value;
3. return to the operation-specific packer/reducer and rebuild messages;
4. allow at most two context-repack attempts for that logical call;
5. after exhaustion, emit a visible error containing configured budget, final effective
   budget, and call site.

This retry occurs below the operation boundary. It cannot replay `WipeDomain` or any
other destructive Re-init prelude.

Output truncation remains a structured-output failure. The response is never accepted by
cutting text. The caller reduces entity batch size or retries with a denser profile within
the operation's preservation invariant. Structured retry exhaustion fails the source.

## Conflict and Failure Handling

- Missing source-chunk coverage fails before page writes.
- Missing reducer packet IDs trigger structured repair, then source failure on exhaustion.
- Invalid source line ranges fail validation; exact source text is never guessed.
- Page or section hash mismatch triggers one reread/retrieve/regenerate cycle.
- A second hash conflict rejects the patch without overwriting newer content.
- Embedding endpoint failure preserves the existing Init fail-loud behavior.
- An LLM/model/provider failure emits an error and leaves the source resumable.
- Vision Check failures remain Settings notices and do not alter runtime configuration.
- Fixed prompt overhead larger than the configured input budget is a configuration error,
  not a request to truncate system/schema rules.

## Diagnostics

Add a metadata-only budget event to the existing `agent.jsonl` envelope. Fields include:

```ts
{
  kind: "prompt_budget";
  callSite: string;
  configuredInputBudget: number;
  effectiveInputBudget: number;
  estimatedInputTokens: number;
  actualInputTokens?: number;
  outputBudget?: number;
  compressionProfile: CompressionProfile;
  contextUnits: number;
  sourceChunks?: number;
  reductionDepth?: number;
  retryReason?: string;
}
```

No prompt text, evidence text, source content, image data, API key, or authorization
header is logged. Existing `llm_call_stats`, structural diagnostics, and JSONL envelope
remain compatible.

## Verification Strategy

### Unit Tests

- token estimation, full-message accounting, required/optional packing, and exact budget
  boundaries;
- Markdown chunk coverage, heading anchors, fenced blocks, and oversized line windows;
- evidence/no-evidence coverage, exact-range validation, deterministic dedup, and reducer
  packet-ID coverage;
- add/append/replace section patches, untouched-section byte stability, and hash conflicts;
- structured page-record writes preserving chunk records and chunk refresh preserving page
  records;
- native/Claude policy resolution, global/per-operation fallback, compression inheritance,
  and Format exclusion;
- Vision probe request shape and success/HTTP/timeout/empty-response behavior.

### Regression Fixtures

- a synthetic 1.27 MB vector index proves no vector/raw record reaches a captured prompt;
- 1-page, 15-page, and 100-page domains stay under the configured input budget;
- create/update gold decisions remain unchanged and no new duplicates appear;
- an oversized source accounts for every chunk and preserves exact technical ranges;
- an existing-page update leaves all non-target sections byte-stable;
- a failed source receives no analyzed hash;
- unchanged page chunks issue zero embedding requests;
- all compression profiles preserve Ingest evidence, Lint findings, and Vision recognition
  fields while Format messages remain unchanged.
- oversized Query/Chat histories retain the current question and complete selected units;
- multi-batch Lint covers every page/section and merges every finding once;
- oversized Format reassembles all ordered segments and passes existing preservation
  guards without receiving a compression fragment;
- multi-page Vision/PDF analysis covers every page and preserves recognition fields through
  reduction.

### End-to-End Acceptance

- run build and ESLint;
- run the focused and full executable test suites;
- replay the current 22 sources on a safe vault copy with the same native model/backend;
- confirm zero context-length errors, all source outcomes successful, prompts within
  effective budgets, no raw vectors, no duplicate regression, and no untouched-section
  loss;
- never wipe or reinitialize the user's working vault for verification.

## Requirements and Definitions of Done

### R1 - Raw Index Isolation

No serialized `index.jsonl`, vector array, or raw index record may enter any LLM prompt.

DoD: a 1.27 MB synthetic vector-index fixture produces captured prompts with zero vector
sentinels/raw records while structured page/chunk retrieval still succeeds.

### R2 - Input and Output Budgets

Every operation resolves and enforces the approved backend-specific model-call policy.

DoD: native global/per-operation fixtures resolve input/output budgets; Claude fixtures
resolve input only; every captured prompt estimate is at or below its effective budget.

### R3 - Safe Context Recovery

Context errors repack below the operation boundary and never retry identical oversized
messages through transport fallback.

DoD: provider-count and no-count context-error fixtures follow the specified shrink rules,
stop after two repacks, and emit one destructive prelude at most.

### R4 - Complete Source Chunking

Sources larger than one input budget are split without omitted source lines.

DoD: normal, heading-heavy, paragraph-heavy, and oversized-fence fixtures have complete
line-range coverage and stable chunk hashes.

### R5 - Evidence Coverage

Evidence map/reduce accounts for every source chunk and reducer input packet.

DoD: missing chunk or packet coverage fails validation; valid fixtures preserve all exact
technical ranges through final synthesis input.

### R6 - Globally Bounded Wiki Context

Per-entity retrieval supplies relevant complete sections through one global context packer,
not an unbounded union of full pages.

DoD: 1/15/100-page fixtures stay within budget, preserve required target sections, and
show page-diverse optional context selection.

### R7 - Non-Destructive Page Updates

Creates use full documents; existing pages use hash-guarded section patches.

DoD: add/append/replace fixtures preserve governed frontmatter and every untouched section;
stale hashes cannot overwrite disk content.

### R8 - Structured Index Integrity

Normal runtime uses JSONL page/chunk helpers and preserves the opposite record kind during
each update.

DoD: page and chunk records survive alternating page-upsert, chunk-refresh, reconcile, and
delete fixtures; unchanged chunks are not re-embedded.

### R9 - Honest Init Resume State

Init records a source hash only after a typed successful Ingest outcome.

DoD: LLM, coverage, patch, write, index, and embedding failures leave the source absent
from analyzed state; a successful rerun records it once.

### R10 - Semantic Compression Invariants

Global/per-operation profiles affect all approved compressible operations and never Format.

DoD: profile-matrix fixtures change density instructions while preserving Ingest evidence,
Query citations, Lint findings, and Vision recognition fields; Format messages are equal
across profiles.

### R11 - Settings Compatibility

Settings expose the approved controls without changing saved output-budget semantics.

DoD: old settings load with unchanged `maxTokens`, new defaults populate missing fields,
global/per-operation edits round-trip, invalid edits preserve prior values, and EN/RU/ES
settings shapes compile.

### R12 - Native Vision Availability Check

The native Vision Check performs one real read-only multimodal request.

DoD: mocked request fixtures verify selected model, auth, inline image, timeout, non-empty
success, clear failures, and zero setting/vault mutations; Claude shows no Vision Check.

### R13 - Safe Diagnostics

Budget/reduction decisions are observable without logging content or secrets.

DoD: `prompt_budget` events contain the specified metadata fields and contain no prompt,
source, evidence, image, or authorization payload.

### R14 - Backend Boundaries

Native and Claude share input governance while retaining their approved output and vision
capability boundaries.

DoD: native sends output caps and exposes Vision Check; Claude sends no plugin-owned output
cap, exposes no Vision Check, and still enforces input packing/compression policy.

### R15 - Documentation and Acceptance

Public docs and iwiki describe implemented budgets, compression, Vision Check, and bounded
Ingest behavior after runtime changes land.

DoD: relevant README files and iwiki pages are updated, `wiki_lint` has no new broken/stale
findings from changed sources, build/lint/tests pass, and the safe 22-source replay meets the
Acceptance From Intent section.

### R16 - Bounded Non-Ingest Operations

Query/Chat, Lint, Format, and Vision use their approved operation-specific budget adapters
instead of generic truncation or an oversized one-shot request.

DoD: oversized fixtures retain the current Query question and complete context units, cover
all Lint pages/findings, reassemble every Format segment under existing preservation guards,
and cover every Vision/PDF page while preserving recognition fields; Format receives no
compression fragment.

### R17 - Human-Readable Model Progress

All model-backed operation families emit the shared lifecycle. Sidebar labels contain only
localized human actions/states; technical routing remains in `agent.jsonl`.

DoD: Init/Re-init, Ingest, Query, Chat, Lint, Format, and Vision fixtures observe ordered
prepare/sent/wait/receive-or-response/validate/apply/terminal transitions; reasoning stays
expandable; waiting timers do not reset watchdogs; no sidebar text contains `callSite`,
transport, attempt, or budget fields.

### R18 - Complete Destructive Re-init Wipe

Full Re-init deletes the entire prior target-domain tree before fresh domain creation.

DoD: fixtures with pages, service files, temporary files, nested entity folders, and empty
obsolete folders retain no prior descendants after wipe; fresh metadata/index are created
only afterward; another domain is byte-identical; one explicit run emits one `WipeDomain`.

## Risks and Mitigations

- **Conservative token estimation underuses large contexts.** Mitigation: expose the input
  budget, log actual backend usage, and prefer extra bounded calls over overflow.
- **Weak models omit evidence IDs.** Mitigation: strict schemas, coverage validation, repair,
  and fail-closed source state.
- **Map/reduce increases calls and latency.** Mitigation: one-chunk fast path, deterministic
  dedup before LLM reduction, and multi-entity batching under the global budget.
- **Section patches can conflict with concurrent edits.** Mitigation: page/section hashes and
  one bounded regeneration attempt.
- **Compression can become lossy.** Mitigation: operation-specific invariants and fixture
  coverage across all three profiles.
- **A real Vision probe has provider cost.** Mitigation: tiny static image, short prompt, small
  output cap, and execution only after explicit Check click.
- **Segmented Format can reduce cross-section editorial consistency.** Mitigation: preserve
  heading-path context, forbid cross-segment movement, retain the single-call fast path, and
  run full-note preservation guards after reassembly.
- **Vision media-token pricing varies by provider.** Mitigation: conservative per-page
  reservation, PDF page batching, one bounded resize retry, and context-error telemetry.
- **Lifecycle events could accidentally keep a hung request alive.** Mitigation: UI elapsed
  time is local-only and lifecycle transitions are excluded from semantic idle reset.
- **Full-tree deletion increases destructive scope.** Mitigation: validate the canonical
  target domain path, bootstrap before mutation, delete exactly one domain, verify absence,
  and fail before ingest if cleanup is incomplete.

## Out of Scope

- Changing the `index.jsonl` page/chunk schema.
- Adding a model-specific tokenizer dependency.
- Automatic discovery of a model's context window.
- Plugin control over Claude Agent output limits.
- Claude Agent multimodal transport or Vision Check.
- Semantic compression of Format.
- Destructive verification against the user's working vault.
- Recommending or automatically switching models.
