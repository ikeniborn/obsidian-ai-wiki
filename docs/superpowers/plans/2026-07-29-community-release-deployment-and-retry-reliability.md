---
review:
  plan_hash: c62fa32f76f91c72
  last_run: 2026-07-29
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-29-community-release-deployment-and-retry-reliability-intent.md
  spec: docs/superpowers/specs/2026-07-29-community-release-deployment-and-retry-reliability-design.md
result_check:
  verdict: OK
  source: plan
  plan_hash: c62fa32f76f91c72
  last_run: 2026-08-11
  reviewed: true
  docs_checked: true
---
# Community Release Deployment and Retry Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a validated GitHub release candidate while closing TD-3, TD-4, and the generic Init evidence request-amplification and schema-recovery defects.

**Architecture:** Preserve structural Markdown chunking and the provider-independent prompt estimator, then add evidence-specific greedy packing against complete prepared requests. Retain bootstrap evidence, enrich only its entity types, and hand it to first-source Ingest under path/domain/hash authority; separately make mapper recovery reason-aware and Init file failures attempt-local. Gate GitHub Release creation behind deterministic metadata, quality, build, and three-asset checks.

**Tech Stack:** TypeScript, Node.js test runner, Zod, OpenAI JavaScript SDK, esbuild, GitHub Actions, YAML, Obsidian plugin manifests.

---

## File Map

- Create `scripts/validate-release.mjs`: prebuild/postbuild release-contract validator.
- Create `tests/release-validation.test.ts`: validator and workflow ordering regressions.
- Modify `.github/workflows/release.yml`, `package.json`, `package-lock.json`: quality-gated release path and synchronized metadata.
- Modify `src/phases/ingest-evidence.ts`: prepared-budget packing, complementary-array normalization, bounded split classification, bootstrap bundle.
- Create `src/phases/evidence-type-enrichment.ts`: bounded post-bootstrap type assignment without source replay.
- Create `prompts/init-evidence-types.md`: compact classifier contract.
- Modify `src/phases/init.ts`, `src/phases/ingest.ts`, `src/types.ts`: authoritative evidence handoff and attempt/file outcome events.
- Create `src/run-status.ts`: pure operation terminal-status reducer.
- Modify `src/controller.ts`: reducer integration for non-chat operations.
- Create `tests/fixtures/evidence-source-corpus.ts`: generated neutral small/large Markdown corpus.
- Modify `tests/ingest-evidence.test.ts`, `tests/init-ingest-outcome.test.ts`: packing, map-once, wire, split, and Retry regressions.
- Create `tests/evidence-type-enrichment.test.ts`: type assignment batching and validation.
- Create `tests/conflict-regeneration-integration.test.ts`: TD-3 local HTTP integration fixture.
- Create `tests/run-status.test.ts`: TD-4 status truth table.
- Modify `README.md`, `docs/loen/dynamic-llm-budget-routing/tech-debt.md`: install/release contract, performance scope, TD closure evidence.
- Modify `dist/main.js`, `dist/manifest.json`, `dist/styles.css`: verified production build artifacts tracked by the repository.

### Task 1: Deterministic Release Validator

**Closes:** R1 and the release-metadata consistency outcome from the approved intent.

**Files:**
- Create: `scripts/validate-release.mjs`
- Create: `tests/release-validation.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add failing prebuild and postbuild CLI tests**

Create temporary repository roots in `tests/release-validation.test.ts`, invoke the CLI with `process.execPath`, and assert these exact cases: consistent prebuild passes; stale lockfile fails naming `package-lock.json`; source/root manifest mismatch fails; missing, empty, or inline-source-map dist assets fail postbuild.

```ts
const runValidator = (root: string, phase: "prebuild" | "postbuild") =>
  spawnSync(process.execPath, ["scripts/validate-release.mjs", "--root", root, "--phase", phase], {
    cwd: repoRoot,
    encoding: "utf8",
  });

test("prebuild rejects stale lockfile version", () => {
  const root = releaseFixture();
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  lock.version = "0.2.1";
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
  const result = runValidator(root, "prebuild");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-lock\.json.*0\.2\.1.*0\.2\.2/s);
});
```

- [ ] **Step 2: Run the validator tests and confirm failure**

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: FAIL because `scripts/validate-release.mjs` does not exist.

- [ ] **Step 3: Implement the two-phase JSON and asset validator**

Implement argument parsing for only `--root <path>` and `--phase prebuild|postbuild`. Parse JSON with `JSON.parse`; require valid SemVer, id `ai-wiki`, equal versions in `package.json`, both lockfile roots, root/source manifests, and postbuild manifest. In postbuild require non-empty `dist/main.js`, `dist/manifest.json`, `dist/styles.css`, byte-equal source/distribution manifests, and reject `sourceMappingURL=data:` in `main.js`. Accumulate source-labelled errors, print each to stderr, and exit once with code 1.

```js
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const versions = new Map([
  ["package.json", pkg.version],
  ["package-lock.json", lock.version],
  ["package-lock.json packages['']", lock.packages?.[""]?.version],
  ["manifest.json", rootManifest.version],
  ["src/manifest.json", sourceManifest.version],
]);
for (const [name, version] of versions) {
  if (version !== pkg.version) errors.push(`${name} version ${String(version)} != package.json ${pkg.version}`);
}
```

- [ ] **Step 4: Add package scripts and synchronize lock metadata**

Add `typecheck`, `test`, `release:validate:pre`, and `release:validate:post` scripts. Run the lockfile-only install so both root version fields become `0.2.2` without changing dependencies.

```json
{
  "typecheck": "tsc --noEmit",
  "test": "node --import tsx --test tests/*.test.ts",
  "release:validate:pre": "node scripts/validate-release.mjs --phase prebuild",
  "release:validate:post": "node scripts/validate-release.mjs --phase postbuild"
}
```

```bash
npm install --package-lock-only --ignore-scripts
```

- [ ] **Step 5: Verify validator behavior**

```bash
node --import tsx --test tests/release-validation.test.ts
npm run release:validate:pre
npm run build
npm run release:validate:post
```

Expected: all tests PASS; both repository validation phases exit 0.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 1**

```bash
git add scripts/validate-release.mjs tests/release-validation.test.ts package.json package-lock.json
git commit -m "build: validate release metadata and assets"
```

### Task 2: GitHub Release Quality Gate

**Closes:** R2 and the requirement that publication remain unreachable after any failed gate.

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `tests/release-validation.test.ts`

- [ ] **Step 1: Add a failing workflow-contract test**

Parse `.github/workflows/release.yml` with `yaml.parse`. Assert step order is checkout, setup, install, prebuild validation, lint, typecheck, test, build, postbuild validation, attestation, version read, release; assert attestation and release each name all three `dist` assets.

```ts
const workflow = parse(readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8"));
const steps = workflow.jobs.release.steps as Array<Record<string, unknown>>;
const runs = steps.flatMap((step) => typeof step.run === "string" ? [step.run] : []);
assert.deepEqual(runs.slice(1, 7), [
  "npm run release:validate:pre",
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run build",
  "npm run release:validate:post",
]);
```

- [ ] **Step 2: Run the workflow test and confirm failure**

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: FAIL because current workflow builds before quality checks and omits manifest attestation.

- [ ] **Step 3: Reorder workflow and attest the complete flat asset set**

Use package scripts for every gate. Keep trigger on a pushed `src/manifest.json` version commit to `master`. Put `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` in both `subject-path` and `files`; derive tag and name only after postbuild validation.

- [ ] **Step 4: Verify YAML contract**

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: HUMAN CHECKPOINT — request approval and commit Task 2**

```bash
git add .github/workflows/release.yml tests/release-validation.test.ts
git commit -m "ci: gate GitHub release publication"
```

### Task 3: Generic Prepared-Budget Evidence Packing

**Closes:** R4-R5 and the heading-driven request amplification found in the live session.

**Files:**
- Create: `tests/fixtures/evidence-source-corpus.ts`
- Modify: `tests/ingest-evidence.test.ts`
- Modify: `src/phases/ingest-evidence.ts`

- [ ] **Step 1: Add neutral corpus generators and failing packing assertions**

Generate deterministic small, multilingual heading-heavy (17-18 KB, about 400 lines, at least 32 headings), oversized paragraph, and fenced-code sources. For every returned chunk assert complete ordered coverage; for each adjacent pair reconstruct the combined source range and assert its complete prepared mapper estimate cannot fit. At 16,384 input and 4,096 output, require small source = 1 chunk and heading-heavy source <= 3 chunks.

```ts
export function headingHeavySource(): string {
  return Array.from({ length: 34 }, (_, section) => [
    `## Section ${section + 1}`,
    ...Array.from({ length: 10 }, (_, line) =>
      `Neutral fact ${section + 1}.${line + 1}: данные ${"x".repeat(16)}.`,
    ),
  ].join("\n")).join("\n");
}
```

- [ ] **Step 2: Run focused tests and confirm heading amplification**

```bash
node --import tsx --test tests/ingest-evidence.test.ts
```

Expected: new heading-heavy assertion FAILS with roughly one chunk per section.

- [ ] **Step 3: Add a source-range packer used by both initial and context-repack planning**

In `src/phases/ingest-evidence.ts`, add `packAdjacentMapperChunks`. Iterate structural chunks in source order, merge only contiguous non-overlapping ranges with `createSourceChunkForRange`, and accept a merge only when `estimateStructuredRequest(messagesForMapper(...), mapperOpts, retries) + MAPPER_ESTIMATE_SAFETY_TOKENS <= effectiveInputBudget`. Renumber after packing. Call it inside `chunkSourceForEvidence` and `rechunkMapperSourceForRetry`; keep `chunkMarkdownSource` unchanged.

```ts
function packAdjacentMapperChunks(
  source: string,
  chunks: SourceChunk[],
  canFit: (chunk: SourceChunk) => boolean,
): SourceChunk[] {
  const packed: SourceChunk[] = [];
  for (const next of chunks) {
    const previous = packed.at(-1);
    if (previous && previous.endLine + 1 === next.startLine) {
      const merged = createSourceChunkForRange(source, previous.startLine, next.endLine, previous.ordinal, previous.headingPath);
      if (canFit(merged)) {
        packed[packed.length - 1] = merged;
        continue;
      }
    }
    packed.push(next);
  }
  normalizeSourceChunksFrom(source, packed, 0);
  return packed;
}
```

- [ ] **Step 4: Verify maximality, budgets, hashes, fences, and corpus scaling**

```bash
node --import tsx --test tests/markdown-chunks.test.ts tests/ingest-evidence.test.ts
```

Expected: PASS; heading-heavy source <= 3 chunks; no adjacent emitted pair is mergeable; existing coverage and fence tests remain green.

- [ ] **Step 5: HUMAN CHECKPOINT — request approval and commit Task 3**

```bash
git add tests/fixtures/evidence-source-corpus.ts tests/ingest-evidence.test.ts src/phases/ingest-evidence.ts
git commit -m "perf: pack evidence ranges by prepared budget"
```

### Task 4: Mapper Wire Normalization and Bounded Split Policy

**Closes:** R9-R10 and the omitted-complementary-array plus recursive split failures.

**Files:**
- Modify: `src/phases/ingest-evidence.ts`
- Modify: `tests/ingest-evidence.test.ts`

- [ ] **Step 1: Add failing normalization and split-matrix tests**

Cover: non-empty `noEvidence` with omitted `packets` succeeds in one request; non-empty packets with omitted `noEvidence` remains one request; both absent/empty and malformed members fail. Record request counts for missing-field protocol output, output-limit exhaustion, chunk-local coverage/range failure, and a failing derived child.

```ts
assert.deepEqual(await mapResponse({ noEvidence: [{ chunkId, reason: "Heading only" }] }), []);
assert.equal(calls, 1);
await assert.rejects(mapResponse({}), /packets|noEvidence/i);
assert.equal(protocolChildCalls, 0);
assert.equal(eligibleSplitCalls, 3); // parent + two children
```

- [ ] **Step 2: Run focused tests and confirm current retries/splits fail counts**

```bash
node --import tsx --test tests/ingest-evidence.test.ts
```

Expected: FAIL on omitted `packets` and recursive/protocol split controls.

- [ ] **Step 3: Normalize only complementary empty arrays before strict schema validation**

In `mapperSchemaFor`, set `packets: []` only when `packets` is absent and `noEvidence` is a non-empty array; keep the existing reverse normalization only when packets are non-empty. Do not normalize both-absent or both-empty responses.

```ts
const hasPackets = Array.isArray(record.packets) && record.packets.length > 0;
const hasNoEvidence = Array.isArray(record.noEvidence) && record.noEvidence.length > 0;
const packetsInput = record.packets === undefined && hasNoEvidence ? [] : record.packets;
const noEvidenceInput = record.noEvidence === undefined && hasPackets ? [] : record.noEvidence;
```

- [ ] **Step 4: Classify split eligibility and enforce depth one plus strict progress**

Track `{ chunk, splitDepth }` inside `mapChunksWithContextRepack`. Split only `StructuredValidationError.errorType === "output_limit"` or a parseable `schema_validate` whose last Zod issues contain only chunk-local coverage/range codes. Reject frame/JSON/missing/type/foreign ownership defects. Before scheduling children, compute both prepared estimates and require each below the parent estimate; set child depth to 1 and never split it again.

```ts
function mapperSplitReason(error: unknown): "output_limit" | "local_semantic" | null {
  if (!(error instanceof EvidenceCoverageError) || !(error.cause instanceof StructuredValidationError)) return null;
  if (error.cause.errorType === "output_limit") return "output_limit";
  if (error.cause.errorType !== "schema_validate" || !(error.cause.lastError instanceof z.ZodError)) return null;
  const codes = error.cause.lastError.issues.map(evidenceValidationReason);
  return codes.length > 0 && codes.every((code) => /chunk_coverage_mismatch|source_range_out_of_bounds/.test(code))
    ? "local_semantic"
    : null;
}
```

- [ ] **Step 5: Verify normalization and bounded recovery**

```bash
node --import tsx --test tests/ingest-evidence.test.ts
```

Expected: PASS; normalizable outputs use one request; protocol defects make zero child requests; each initial chunk creates at most two children.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 4**

```bash
git add src/phases/ingest-evidence.ts tests/ingest-evidence.test.ts
git commit -m "fix: bound evidence mapper recovery"
```

### Task 5: Bootstrap Evidence Retention and Type Enrichment

**Closes:** R6-R7 and the requirement to preserve full evidence while assigning final domain types without source replay.

**Files:**
- Create: `src/phases/evidence-type-enrichment.ts`
- Create: `prompts/init-evidence-types.md`
- Create: `tests/evidence-type-enrichment.test.ts`
- Modify: `src/phases/ingest-evidence.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add failing bundle immutability and classifier tests**

Assert `prepareBootstrapEvidenceBundle` returns the existing bounded taxonomy payload plus a deep-equal full evidence collection. For type enrichment assert empty evidence makes zero calls; batching obeys prepared budget; every entity receives exactly one allowed type; missing, duplicate, foreign, or unknown assignments fail; only `entityType` changes; requests include keys/facts but exclude `exactSource` text.

- [ ] **Step 2: Run new tests and confirm missing APIs**

```bash
node --import tsx --test tests/evidence-type-enrichment.test.ts tests/ingest-evidence.test.ts
```

Expected: FAIL because bundle and enrichment APIs do not exist.

- [ ] **Step 3: Return a bootstrap bundle while preserving the old wrapper**

Add this exported contract in `src/phases/ingest-evidence.ts`; move current extraction/bounding into the bundle function and keep `prepareBootstrapEvidence` returning `.bootstrap` for existing callers/tests.

```ts
export interface BootstrapEvidenceBundle {
  bootstrap: BootstrapEvidence;
  evidence: EntityEvidence[];
  domainId: string;
  sourcePath: string;
  sourceBodyHash: string;
}

export async function prepareBootstrapEvidenceBundle(
  source: string,
  provisionalDomainId: string,
  sourcePath: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<BootstrapEvidenceBundle>;

export async function prepareBootstrapEvidence(
  source: string,
  provisionalDomainId: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<BootstrapEvidence> {
  return (await prepareBootstrapEvidenceBundle(
    source,
    provisionalDomainId,
    "",
    policy,
    runtime,
  )).bootstrap;
}
```

- [ ] **Step 4: Implement compact bounded type enrichment**

Add callsite `init.bootstrap-type-map`. The new module partitions `{ entityKey, facts }` units with `estimatePreparedMessages(prepareChatMessages(...))`, uses the existing structured retry bound, validates exact key coverage and the final allowed set, then returns copies with only `entityType` added. Size-related repartition keeps units unchanged; schema failure does not recursively split.

```ts
export interface EvidenceTypeAssignment { entityKey: string; entityType: string }

export function applyEvidenceTypeAssignments(
  evidence: EntityEvidence[],
  assignments: EvidenceTypeAssignment[],
  allowedTypes: ReadonlySet<string>,
): EntityEvidence[] {
  const byKey = new Map(assignments.map((item) => [item.entityKey, item.entityType]));
  if (byKey.size !== assignments.length || byKey.size !== evidence.length) throw new Error("Evidence type assignment coverage mismatch");
  return evidence.map((item) => {
    const entityType = byKey.get(item.entityKey);
    if (!entityType || !allowedTypes.has(entityType)) throw new Error(`Invalid evidence type assignment for ${item.entityKey}`);
    return { ...item, entityType };
  });
}
```

- [ ] **Step 5: Verify classifier boundaries**

```bash
node --import tsx --test tests/evidence-type-enrichment.test.ts tests/ingest-evidence.test.ts
npm run typecheck
```

Expected: PASS; no full source replay; invalid assignments fail before caller state mutation.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 5**

```bash
git add src/phases/evidence-type-enrichment.ts prompts/init-evidence-types.md tests/evidence-type-enrichment.test.ts src/phases/ingest-evidence.ts src/types.ts
git commit -m "feat: retain and type bootstrap evidence"
```

### Task 6: Authoritative First-Source Evidence Handoff

**Closes:** R8 and the duplicate full-source bootstrap/Ingest mapping defect.

**Files:**
- Modify: `src/phases/init.ts`
- Modify: `src/phases/ingest.ts`
- Modify: `tests/init-ingest-outcome.test.ts`

- [ ] **Step 1: Add failing fresh, force, mismatch, and Retry handoff tests**

Extend the existing in-memory Init harness to count callsites. Assert fresh and force Init invoke `init.bootstrap-map` for each packed chunk, invoke bounded type enrichment, and never invoke `ingest.evidence-map` for the first source. Call `runIngest` directly with a deliberately mismatched prepared hash to assert fallback to ordinary mapping; Init's stronger bootstrap preflight must still reject a source changed before domain mutation. Induce a downstream first-attempt failure and assert Retry reuses the matching handoff.

- [ ] **Step 2: Run Init tests and confirm duplicate mapping**

```bash
node --import tsx --test tests/init-ingest-outcome.test.ts
```

Expected: FAIL because first-source Ingest still calls `ingest.evidence-map`.

- [ ] **Step 3: Define and validate the internal handoff**

Add a final optional `preparedEvidence` parameter to `runIngest` so delete transaction semantics remain isolated in `IngestInternalExecution`. Validate domain id, normalized vault source path, and `hashSource(sourceContent)`, then validate each typed evidence item and allowed entity type. On mismatch emit metadata-only fallback telemetry and call `prepareSourceEvidence`; on match bypass extraction and proceed through unchanged context/synthesis validation.

```ts
export interface PreparedIngestEvidence {
  domainId: string;
  sourcePath: string;
  sourceBodyHash: string;
  evidence: EntityEvidence[];
}
```

- [ ] **Step 4: Enrich before domain mutation and thread handoff through first-source Retry**

Extend `PreparedDomainBootstrap` with retained evidence and authority. After bootstrap returns final `entity_types`, run enrichment before force wipe, domain save, or update. Pass the typed handoff only when `file === preparedBootstrap.sourceFile`; keep it across the local retry loop. Later files, incremental Init, direct Ingest, and delete rebuild pass no handoff.

- [ ] **Step 5: Verify map-once and fallback behavior**

```bash
node --import tsx --test tests/init-ingest-outcome.test.ts tests/evidence-type-enrichment.test.ts tests/ingest-bounded.test.ts
npm run typecheck
```

Expected: PASS; first source has one full evidence extraction; mismatch recomputes; delete transaction tests remain green.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 6**

```bash
git add src/phases/init.ts src/phases/ingest.ts tests/init-ingest-outcome.test.ts
git commit -m "perf: reuse authoritative bootstrap evidence"
```

### Task 7: TD-3 Conflict-Regeneration Integration Fixture

**Closes:** R11 and TD-3.

**Files:**
- Create: `tests/conflict-regeneration-integration.test.ts`
- Modify: `tests/ingest-synthesis.test.ts`

- [ ] **Step 1: Build a failing local HTTP integration fixture**

Start `node:http` on `127.0.0.1` port 0 and construct the production OpenAI SDK client against `/v1`. Script mapper and synthesis responses, expose authority A to synthesis, mutate the in-memory target to B before apply, then return a malformed framed regeneration response followed by a valid patch carrying B's current page/section authority. Serve ordinary JSON for non-stream calls and OpenAI-compatible SSE chunks plus `[DONE]` for stream calls.

```ts
const server = createServer(async (request, response) => {
  const body = await readJson(request);
  scriptedRequests.push(body);
  const content = completionTextFor(body, scriptedRequests.length);
  if (body.stream === true) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify(streamChunk(content))}\n\n`);
    response.end("data: [DONE]\n\n");
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(chatCompletion(content)));
  }
});
const client = new OpenAI({ apiKey: "test", baseURL: `http://127.0.0.1:${port}/v1` });
```

- [ ] **Step 2: Run the fixture and confirm it reaches the unresolved boundary**

```bash
node --import tsx --test tests/conflict-regeneration-integration.test.ts
```

Expected: FAIL until scripted transport, stale authority timing, and repaired apply are wired through `runIngest`.

- [ ] **Step 3: Complete deterministic response scripts and exact assertions**

Assert two regeneration HTTP requests for malformed-then-valid framing and final content preserving B's untouched section. Keep or tighten existing focused unit controls: parsed schema/domain defect = one regeneration request; `conflictCount: 1` repeated stale case = zero requests.

- [ ] **Step 4: Verify TD-3 boundaries**

```bash
node --import tsx --test tests/conflict-regeneration-integration.test.ts tests/ingest-synthesis.test.ts
```

Expected: PASS with exact request counts 2, 1, and 0; accepted patch applies only against authority B.

- [ ] **Step 5: HUMAN CHECKPOINT — request approval and commit Task 7**

```bash
git add tests/conflict-regeneration-integration.test.ts tests/ingest-synthesis.test.ts
git commit -m "test: cover conflict regeneration integration"
```

### Task 8: TD-4 Attempt-Local Init Events

**Closes:** R12 and the event-ownership half of TD-4.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/phases/init.ts`
- Modify: `tests/init-ingest-outcome.test.ts`

- [ ] **Step 1: Add failing full and incremental Retry event tests**

For each Init path induce attempt 1 failure then successful Retry. Assert child global `error` is suppressed, telemetry contains `failed`, `retry_scheduled`, `recovered`, followed by one `file_outcome: done`. Add Skip, Stop, exhausted retry, unreadable file, and cancellation controls with at most one file outcome.

- [ ] **Step 2: Run tests and confirm child errors leak globally**

```bash
node --import tsx --test tests/init-ingest-outcome.test.ts
```

Expected: FAIL because `forwardIngest` forwards attempt-local `error` and no explicit file outcome exists.

- [ ] **Step 3: Add typed attempt and outcome events**

Extend `RunEvent` with:

```ts
| { kind: "file_attempt"; file: string; attempt: number; state: "failed" | "retry_scheduled" | "recovered"; retryable: boolean; message?: string }
| { kind: "file_outcome"; file: string; status: "done" | "skipped" | "stopped" | "exhausted" }
```

- [ ] **Step 4: Convert child errors at the Init ownership boundary**

Change `forwardIngest` to capture, not yield, child `error` events while preserving all other telemetry. Both full and incremental loops emit `file_attempt` with one-based attempt numbers. First-attempt Skip emits `skipped`; failure after the single allowed Retry emits `exhausted`; Stop emits `stopped`; success after failure emits `recovered` before `done`. Direct Ingest remains unchanged.

- [ ] **Step 5: Verify full/incremental parity and telemetry**

```bash
node --import tsx --test tests/init-ingest-outcome.test.ts
npm run typecheck
```

Expected: PASS; handled attempt failures remain visible but non-terminal; every resolved file has at most one outcome.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 8**

```bash
git add src/types.ts src/phases/init.ts tests/init-ingest-outcome.test.ts
git commit -m "fix: scope Init file attempt failures"
```

### Task 9: Pure Terminal Status Reducer

**Closes:** R13 and the controller-status half of TD-4.

**Files:**
- Create: `src/run-status.ts`
- Create: `tests/run-status.test.ts`
- Modify: `src/controller.ts`

- [ ] **Step 1: Add the failing terminal-status truth table**

Test initial done; Retry recovery done; skipped/exhausted error; stopped and abort cancelled; global error dominates later success and abort; non-zero exit error; timeout error. Use only pure reducer inputs, with no Obsidian runtime dependency.

```ts
assert.equal(reduceRunStatus("done", { kind: "file_outcome", file: "a.md", status: "done" }), "done");
assert.equal(reduceRunStatus("done", { kind: "file_outcome", file: "a.md", status: "skipped" }), "error");
assert.equal(reduceRunStatus("error", { kind: "file_outcome", file: "a.md", status: "done" }), "error");
assert.equal(finalizeRunStatus("error", { aborted: true, timedOut: false }), "error");
```

- [ ] **Step 2: Run reducer tests and confirm missing module**

```bash
node --import tsx --test tests/run-status.test.ts
```

Expected: FAIL because `src/run-status.ts` does not exist.

- [ ] **Step 3: Implement monotonic terminal precedence**

Implement `reduceRunStatus` for global `error`, `exit`, and `file_outcome`; ignore `file_attempt`. Implement finalization where timeout is error, user abort is cancelled only when no error exists, and error can never be cleared by a later event.

```ts
export type RunTerminalStatus = "done" | "error" | "cancelled";

export function reduceRunStatus(status: RunTerminalStatus, event: RunEvent): RunTerminalStatus {
  if (status === "error") return status;
  if (event.kind === "error") return "error";
  if (event.kind === "exit" && event.code !== 0) return "error";
  if (event.kind === "file_outcome") {
    if (event.status === "skipped" || event.status === "exhausted") return "error";
    if (event.status === "stopped") return "cancelled";
  }
  return status;
}
```

- [ ] **Step 4: Route non-chat controller status changes through the reducer**

Replace event-loop assignments with `reduceRunStatus`. Keep infrastructure failures, domain persistence failures, caught exceptions, and timeout as independent global errors. Finalize abort without overwriting an existing error. Do not change chat-session status ownership.

- [ ] **Step 5: Verify TD-4 status contract**

```bash
node --import tsx --test tests/run-status.test.ts tests/init-ingest-outcome.test.ts
npm run typecheck
```

Expected: PASS; failure + Retry success ends done; Skip/exhaustion error; Stop/cancel cancelled; unrelated error remains error.

- [ ] **Step 6: HUMAN CHECKPOINT — request approval and commit Task 9**

```bash
git add src/run-status.ts tests/run-status.test.ts src/controller.ts
git commit -m "fix: reduce terminal run status from outcomes"
```

### Task 10: Documentation, Whole-Branch Verification, and Release Checkpoint

**Closes:** R3, the R1-R13 verification matrix, technical-debt documentation, iwiki consistency, and the release human checkpoints.

**Files:**
- Modify: `README.md`
- Modify: `docs/loen/dynamic-llm-budget-routing/tech-debt.md`
- Modify: `dist/main.js`
- Modify: `dist/manifest.json`
- Modify: `dist/styles.css`
- Modify: relevant project iwiki pages through MCP tools

- [ ] **Step 1: Update install and release documentation**

Document three distinct paths: Community Plugins search for `AI Wiki`; manual installation from one GitHub Release's flat `main.js`, `manifest.json`, `styles.css`; local development from `dist/`. State root checkout is not an install bundle. Document that CI publishes only after metadata, lint, typecheck, tests, build, and postbuild gates.

- [ ] **Step 2: Close TD-3 and TD-4 with exact deterministic evidence**

In `docs/loen/dynamic-llm-budget-routing/tech-debt.md`, mark each fixed and cite the focused test file plus exact request/status assertions. Add the generic evidence-pipeline contract: prepared-budget packing, map-once first source, complementary-array normalization, and one-level reason-aware split. Do not cite the private live article as a fixture.

- [ ] **Step 3: Update project iwiki behavior pages and lint**

Use `wiki_update_page` for existing release, prompt-budget, structured-output, and Init retry sections, or `wiki_write_page` only when no relevant page exists. Use the changed source path in each write. Then run `wiki_lint`; repair new broken references and report unrelated pre-existing findings.

- [ ] **Step 4: Run focused deterministic suite**

```bash
node --import tsx --test tests/release-validation.test.ts tests/markdown-chunks.test.ts tests/ingest-evidence.test.ts tests/evidence-type-enrichment.test.ts tests/init-ingest-outcome.test.ts tests/conflict-regeneration-integration.test.ts tests/ingest-synthesis.test.ts tests/run-status.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Run complete quality and release gates**

```bash
npm run release:validate:pre
npm run lint
npm run typecheck
npm test
npm run build
npm run release:validate:post
git diff --check
```

Expected: every command exits 0; `dist` contains non-empty flat `main.js`, `manifest.json`, `styles.css`; all versions equal `0.2.2`; no inline source map.

- [ ] **Step 6: Inspect branch scope and release asset hashes**

```bash
git status --short
git diff --stat origin/master
sha256sum dist/main.js dist/manifest.json dist/styles.css
```

Expected: only planned files; three hashes print successfully.

- [ ] **Step 7: HUMAN CHECKPOINT — request approval and commit verified production artifacts**

```bash
git add dist/main.js dist/manifest.json dist/styles.css
git commit -m "build: refresh release candidate assets"
```

- [ ] **Step 8: HUMAN CHECKPOINT — request approval and commit documentation after iwiki verification**

```bash
git add README.md docs/loen/dynamic-llm-budget-routing/tech-debt.md
git commit -m "docs: record release and retry reliability"
```

- [ ] **Step 9: Run chain result reconciliation**

Run `$check-chain result docs/superpowers/plans/2026-07-29-community-release-deployment-and-retry-reliability.md` and fix every `needs_work` finding before delivery.

- [ ] **Step 10: HUMAN CHECKPOINT — request approval for push/PR and later version publication**

Do not push, open a PR, bump a new version, create a GitHub Release, or perform Community account actions without explicit user approval. After PR merge, a separately approved version commit to `master` triggers the validated GitHub Release workflow.
