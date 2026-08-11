import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import {
  assertCompleteSourceCoverage,
  chunkMarkdownSource,
  createSourceChunkForRange,
  type SourceChunk,
} from "../src/markdown-chunks";
import { estimatePreparedMessages } from "../src/prompt-budget";
import { estimateText } from "../src/token-estimate";
import type {
  LlmChatCompletionCreateOptions,
  LlmClient,
  RunEvent,
} from "../src/types";
import type {
  EvidencePolicy,
  EvidenceRuntime,
} from "../src/phases/ingest-evidence";
import type { EvidencePacket } from "../src/phases/ingest-evidence";
import {
  fencedEvidenceSource,
  headingHeavyEvidenceSource,
  mediumEvidenceSource,
  mixedOversizedEvidenceSource,
  oversizedParagraphEvidenceSource,
  smallEvidenceSource,
} from "./fixtures/evidence-source-corpus";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const {
  buildEvidenceCoverage,
  dedupeEvidencePackets,
  dedupeVerifiedEvidencePackets,
  chunkSourceForEvidence,
  prepareBootstrapEvidence,
  prepareBootstrapEvidenceBundle,
  prepareSourceEvidence,
  splitBootstrapPayload,
  estimateBootstrapPayloadForTest,
  EvidenceCoverageError,
  EvidenceReducerError,
  findLargestFeasibleBudget,
  partitionUnits,
  validateEvidenceMap,
  validateReducedEvidence,
} = await import("../src/phases/ingest-evidence");
const {
  EntityEvidenceSchema,
  EvidencePacketSchema,
  PreVerifiedEntityEvidenceSchema,
} = await import("../src/phases/zod-schemas");

const packet = (id: string, chunkId: string, fact = "fact"): EvidencePacket => ({
  id,
  chunkId,
  entityKey: "postgresql",
  entityType: "tool",
  facts: [fact],
  exactSourceRanges: [{ startLine: 1, endLine: 1 }],
  links: ["https://postgresql.org"],
  sourceAnchor: "source.md:2",
});

test("every source chunk requires packets or an explicit no-evidence result", () => {
  assert.throws(() => buildEvidenceCoverage(
    ["c1", "c2"],
    [packet("p1", "c1")],
    [],
  ), /c2/);
  assert.deepEqual(buildEvidenceCoverage(
    ["c1", "c2"],
    [packet("p1", "c1")],
    [{ chunkId: "c2", reason: "No domain evidence" }],
  ), new Set(["c1", "c2"]));
});

test("invalid, foreign, duplicate, or mixed chunk coverage fails closed", () => {
  assert.throws(() => buildEvidenceCoverage(
    ["c1"], [packet("p1", "c2")], [],
  ), /unknown|foreign/i);
  assert.throws(() => buildEvidenceCoverage(
    ["c1"], [packet("p1", "c1"), packet("p1", "c1")], [],
  ), /duplicate/i);
  assert.throws(() => buildEvidenceCoverage(
    ["c1"], [packet("p1", "c1")], [{ chunkId: "c1", reason: "none" }],
  ), /mixed/i);
  assert.throws(() => buildEvidenceCoverage(
    ["c1"], [], [{ chunkId: "c2", reason: "none" }],
  ), /unknown|foreign/i);
});

test("public coverage validation rejects non-normalized entity keys", () => {
  assert.throws(() => buildEvidenceCoverage(
    ["c1"],
    [{ ...packet("p1", "c1"), entityKey: "PostgreSQL / DB" }],
    [],
  ), (error: unknown) => error instanceof EvidenceCoverageError
    && /normalized entity key/i.test(error.message));
});

test("evidence prompts state the exact fail-closed entity key grammar", () => {
  const mapPrompt = readFileSync(
    new URL("../prompts/ingest-evidence-map.md", import.meta.url),
    "utf8",
  );
  const reducePrompt = readFileSync(
    new URL("../prompts/ingest-evidence-reduce.md", import.meta.url),
    "utf8",
  );
  const pattern = "^[a-z0-9]+(?:[_-][a-z0-9]+)*$";

  assert.equal(mapPrompt.includes(pattern), true);
  assert.match(mapPrompt, /lowercase ASCII letters.*digits.*underscore.*hyphen/is);
  assert.match(mapPrompt, /`proxy\.pac`.*`proxy-pac`/s);
  assert.equal(reducePrompt.includes(pattern), true);
  assert.match(reducePrompt, /same.*entityKey/is);
});

test("invalid entity key diagnostic gives the exact grammar and a conversion example", () => {
  assert.throws(() => buildEvidenceCoverage(
    ["c1"],
    [{ ...packet("p1", "c1"), entityKey: "proxy.pac" }],
    [],
  ), (error: unknown) => error instanceof EvidenceCoverageError
    && error.message.includes("^[a-z0-9]+(?:[_-][a-z0-9]+)*$")
    && /proxy\.pac.*proxy-pac/i.test(error.message));
});

test("invalid entity keys and out-of-chunk-local one-based ranges fail", () => {
  assert.throws(() => validateEvidenceMap({
    chunk: { id: "c1", startLine: 10, endLine: 20 },
    packets: [{ ...packet("p1", "c1"), entityKey: "PostgreSQL / DB" }],
    noEvidence: [],
  }, Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)), /entity.*key|normalized/i);
  assert.throws(() => validateEvidenceMap({
    chunk: { id: "c1", startLine: 10, endLine: 20 },
    packets: [{ ...packet("p1", "c1"), exactSourceRanges: [{ startLine: 12, endLine: 12 }] }],
    noEvidence: [],
  }, Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)), /range/i);
});

test("chunk-local ranges translate to source-global exact source copied server-side", () => {
  const [verified] = validateEvidenceMap({
    chunk: { id: "c1", startLine: 10, endLine: 11 },
    packets: [packet("p1", "c1")],
    noEvidence: [],
  }, Array.from({ length: 11 }, (_, index) => `source line ${index + 1}`));
  assert.deepEqual(verified.exactSourceRanges, [{ startLine: 10, endLine: 10 }]);
  assert.deepEqual(verified.exactSource, [{
    startLine: 10,
    endLine: 10,
    text: "source line 10",
  }]);
});

test("packet schema and runtime reject empty facts and source ranges", () => {
  assert.equal(EvidencePacketSchema.safeParse({ ...packet("p1", "c1"), facts: [] }).success, false);
  assert.equal(EvidencePacketSchema.safeParse({ ...packet("p1", "c1"), exactSourceRanges: [] }).success, false);
  assert.throws(() => validateEvidenceMap({
    chunk: { id: "c1", startLine: 1, endLine: 1 },
    packets: [{ ...packet("p1", "c1"), facts: [] }],
    noEvidence: [],
  }, "line"), EvidenceCoverageError);
  assert.throws(() => validateEvidenceMap({
    chunk: { id: "c1", startLine: 1, endLine: 1 },
    packets: [{ ...packet("p1", "c1"), exactSourceRanges: [] }],
    noEvidence: [],
  }, "line"), EvidenceCoverageError);
});

test("public evidence schemas keep rejecting null entity types", () => {
  const packetWithNullType = { ...packet("p1", "c1"), entityType: null };
  assert.equal(EvidencePacketSchema.safeParse(packetWithNullType).success, false);
  assert.equal(EntityEvidenceSchema.safeParse({
    entityKey: "postgresql",
    entityType: null,
    packetIds: ["p1"],
    facts: ["fact"],
    exactSourceRanges: [{ startLine: 1, endLine: 1 }],
    exactSource: [{ startLine: 1, endLine: 1, text: "source" }],
    links: [],
  }).success, false);
});

test("entity evidence schema and runtime reject impossible empty aggregates", () => {
  const [verified] = validateEvidenceMap({
    chunk: { id: "c1", startLine: 1, endLine: 1 },
    packets: [packet("p1", "c1")],
    noEvidence: [],
  }, "source line");
  const valid = dedupeVerifiedEvidencePackets([verified]);
  for (const field of ["packetIds", "facts", "exactSourceRanges", "exactSource"] as const) {
    const empty = { ...valid, [field]: [] };
    assert.equal(EntityEvidenceSchema.safeParse(empty).success, false, `${field} must be non-empty in schema`);
    assert.throws(() => validateReducedEvidence([verified], empty), EvidenceReducerError);
  }
  assert.equal(EntityEvidenceSchema.safeParse({ ...valid, links: [] }).success, true);
});

test("deterministic reducer removes exact duplicates but preserves IDs and ranges", () => {
  const reduced = dedupeEvidencePackets([
    packet("p1", "c1", "same"),
    packet("p2", "c2", "same"),
  ]);
  assert.deepEqual(reduced.packetIds, ["p1", "p2"]);
  assert.deepEqual(reduced.facts, ["same"]);
  assert.equal(reduced.exactSourceRanges.length, 1);
});

test("LLM reducer output must account for every consumed packet and cannot invent data", () => {
  const first = {
    ...packet("p1", "c1", "a"),
    exactSource: [{ startLine: 1, endLine: 1, text: "source a" }],
  };
  const second = {
    ...packet("p2", "c2", "b"),
    exactSource: [{ startLine: 1, endLine: 1, text: "source b" }],
  };
  assert.throws(() => validateReducedEvidence(
    [first, second],
    {
      entityKey: "postgresql",
      entityType: "tool",
      packetIds: ["p1"],
      facts: ["a"],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      exactSource: [{ startLine: 1, endLine: 1, text: "source a" }],
      links: ["https://postgresql.org"],
    },
  ), /p2/);
  assert.throws(() => validateReducedEvidence(
    [first],
    {
      entityKey: "postgresql",
      entityType: "tool",
      packetIds: ["p1"],
      facts: ["a", "invented"],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      exactSource: [{ startLine: 1, endLine: 1, text: "source a" }],
      links: ["https://postgresql.org"],
    },
  ), /invent|unsupported|fact/i);
});

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "evidence-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(promptTokens = 1): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "evidence-usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function mockRuntime(
  respond: (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => unknown,
  events: RunEvent[],
  requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [],
  requestParams: Array<Record<string, unknown>> = [],
  probe?: { start: () => void; end: () => void },
): EvidenceRuntime {
  const llm: LlmClient = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const request = params as {
            messages: OpenAI.Chat.ChatCompletionMessageParam[];
            stream?: boolean;
            max_completion_tokens?: unknown;
          };
          const messages = request.messages;
          requests.push(messages);
          requestParams.push(params as Record<string, unknown>);
          probe?.start();
          try {
            await new Promise((resolve) => setTimeout(resolve, probe === undefined ? 0 : 1));
            const outputValue = respond(messages);
            const output = JSON.stringify(outputValue);
            const maxTokens = request.max_completion_tokens;
            if (typeof maxTokens === "number") {
              assert.ok(
                mockOutputBytes(outputValue) <= maxTokens,
                `mock output ${mockOutputBytes(outputValue)} exceeded request max_completion_tokens ${maxTokens}`,
              );
            }
            if (request.stream === false) {
              return {
                id: "evidence-completion",
                object: "chat.completion",
                created: 0,
                model: "mock",
                choices: [{
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: output, refusal: null },
                  logprobs: null,
                }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              };
            }
            return (async function* () {
              yield chunk(output);
              yield usageChunk();
            })();
          } finally {
            probe?.end();
          }
        },
      },
    },
  } as unknown as LlmClient;
  return {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    configuredEntityTypes: ["tool"],
  };
}

function evidencePolicy(inputBudgetTokens = 5000): EvidencePolicy {
  return {
    inputBudgetTokens,
    outputBudgetTokens: 512,
    compressionProfile: "balanced",
    overlapLines: 0,
    mapperRetries: 1,
    reducerRetries: 1,
    maxReductionDepth: 6,
  };
}

function allMessageText(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  return messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");
}

function requestHash(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  return JSON.stringify(messages);
}

function isReducerRequest(messages: OpenAI.Chat.ChatCompletionMessageParam[]): boolean {
  return allMessageText(messages).includes("REDUCE_EVIDENCE");
}

function assertClosedToolLifecycles(events: RunEvent[]): void {
  let open = false;
  for (const event of events) {
    if (event.kind === "tool_use") {
      assert.equal(open, false, `tool lifecycle reopened before result: ${event.name}`);
      open = true;
    } else if (event.kind === "tool_result") {
      assert.equal(open, true, "tool_result emitted without tool_use");
      open = false;
    }
  }
  assert.equal(open, false, "tool lifecycle left open");
}

function reducerInput(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Array<Record<string, unknown>> {
  const content = messages.find((message) => typeof message.content === "string"
    && message.content.startsWith("REDUCE_INPUT "))?.content;
  assert.equal(typeof content, "string");
  return JSON.parse(content.slice("REDUCE_INPUT ".length)) as Array<Record<string, unknown>>;
}

function mapperMeta(messages: OpenAI.Chat.ChatCompletionMessageParam[]): {
  id: string;
  ordinal: number;
  startLine: number;
  endLine: number;
} {
  const match = allMessageText(messages).match(/CHUNK_ID ([^\s]+) START (\d+) END (\d+)/u);
  assert.ok(match);
  return {
    id: match[1],
    ordinal: Number(match[1].split(":", 1)[0]),
    startLine: Number(match[2]),
    endLine: Number(match[3]),
  };
}

function uniqueJson(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validReduced(input: Array<Record<string, unknown>>): Record<string, unknown> {
  const first = input[0];
  return {
    entityKey: first.entityKey,
    ...(typeof first.entityType === "string" ? { entityType: first.entityType } : {}),
    packetIds: input.flatMap((item) => Array.isArray(item.packetIds) ? item.packetIds : [item.id]),
    facts: uniqueJson(input.flatMap((item) => Array.isArray(item.facts) ? item.facts : [])),
    exactSourceRanges: uniqueJson(input.flatMap((item) => Array.isArray(item.exactSourceRanges) ? item.exactSourceRanges : [])),
    exactSource: uniqueJson(input.flatMap((item) => Array.isArray(item.exactSource) ? item.exactSource : [])),
    links: uniqueJson(input.flatMap((item) => Array.isArray(item.links) ? item.links : [])),
  };
}

function validMapperPacket(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  factSize = 0,
  entityType: string | null = "tool",
): Record<string, unknown> {
  const { id, ordinal } = mapperMeta(messages);
  const mapped: Record<string, unknown> = {
    ...packet(`p${ordinal}`, id, factSize > 0 ? `fact-${ordinal}-${"x".repeat(factSize)}` : `fact-${ordinal}`),
    exactSourceRanges: [{ startLine: 1, endLine: 1 }],
    sourceAnchor: `${id}:1`,
  };
  if (entityType === null) delete mapped.entityType;
  else mapped.entityType = entityType;
  return mapped;
}

const PACKING_INPUT_BUDGET = 16_384;
const PACKING_OUTPUT_BUDGET = 4_096;
const PACKING_SAFETY_TOKENS = 128;

function packingPolicy(): EvidencePolicy {
  return {
    ...evidencePolicy(PACKING_INPUT_BUDGET),
    outputBudgetTokens: PACKING_OUTPUT_BUDGET,
    overlapLines: 0,
  };
}

function exactCoveredSource(source: string, chunks: SourceChunk[]): string {
  const lines = source.split("\n");
  return chunks
    .flatMap((chunk) => lines.slice(chunk.startLine - 1, chunk.endLine))
    .join("\n");
}

test("neutral evidence corpus has stable generic size and shape", () => {
  const headingHeavy = headingHeavyEvidenceSource();
  const lines = headingHeavy.split("\n");
  const headings = lines.filter((line) => /^#{1,6} /u.test(line));
  const bytes = new TextEncoder().encode(headingHeavy).byteLength;

  assert.ok(bytes >= 17_000 && bytes <= 18_000, `heading-heavy corpus has ${bytes} bytes`);
  assert.ok(lines.length >= 390 && lines.length <= 410, `heading-heavy corpus has ${lines.length} lines`);
  assert.ok(headings.length >= 32, `heading-heavy corpus has ${headings.length} headings`);
});

test("evidence planning packs fitting heading ranges by complete prepared budget", async () => {
  const policy = packingPolicy();
  const small = chunkSourceForEvidence(smallEvidenceSource(), "neutral", policy);
  const source = headingHeavyEvidenceSource();
  const chunks = chunkSourceForEvidence(source, "neutral", policy);

  assert.equal(small.length, 1);
  assert.ok(chunks.length <= 3, `expected at most 3 packed chunks, received ${chunks.length}`);
  assertCompleteSourceCoverage(source, chunks);
  assert.equal(exactCoveredSource(source, chunks), source);

  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const attempts = new Map<string, number>();
  const runtime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    const attempt = (attempts.get(meta.id) ?? 0) + 1;
    attempts.set(meta.id, attempt);
    if (attempt === 1) {
      return { packets: [], noEvidence: [] };
    }
    return { packets: [], noEvidence: [{ chunkId: meta.id, reason: "none" }] };
  }, [], requests);
  await prepareSourceEvidence(source, "neutral", policy, runtime);

  assert.equal(requests.length, chunks.length * 2, "each packed chunk receives one bounded repair");
  for (const request of requests) {
    assert.ok(
      estimatePreparedMessages(request) + PACKING_SAFETY_TOKENS <= policy.inputBudgetTokens,
      "complete base or repair request plus safety reserve must fit",
    );
  }

  const lines = source.split("\n");
  for (let index = 1; index < chunks.length; index++) {
    const previous = chunks[index - 1];
    const next = chunks[index];
    assert.equal(previous.endLine + 1, next.startLine);
    const combinedSource = lines.slice(previous.startLine - 1, next.endLine).join("\n");
    assert.ok(
      chunkSourceForEvidence(combinedSource, "neutral", policy).length > 1,
      `adjacent ranges ${previous.startLine}-${next.endLine} remain mergeable`,
    );
  }
});

test("packed maximality uses final ordinals at a request boundary", () => {
  const source = Array.from(
    { length: 40 },
    (_, index) => `## Neutral heading ${index + 1} ${"x".repeat(24)}`,
  ).join("\n");
  // Rescaled from a byte-era budget of 4_744 for the token estimator (task-3
  // prompt-budget-automation): 1_190 tokens reproduces the same paired split.
  const chunks = chunkSourceForEvidence(source, "neutral", {
    ...packingPolicy(),
    inputBudgetTokens: 1_190,
  });

  assert.deepEqual(chunks.slice(0, 10).map((chunk) => [chunk.startLine, chunk.endLine]), [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 10],
    [11, 12],
    [13, 14],
    [15, 16],
    [17, 18],
    [19, 20],
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.ordinal), chunks.map((_, index) => index));
  assertCompleteSourceCoverage(source, chunks);
});

test("mapper planning splits a large source only a bounded number of times", () => {
  const source = Array.from(
    { length: 1_000 },
    (_, index) => `## Neutral section ${index + 1}\nRecord ${index + 1}: ${"x".repeat(24)}`,
  ).join("\n");
  const originalSplit = String.prototype.split;
  let fullSourceSplits = 0;
  String.prototype.split = function(separator, limit): string[] {
    if (this.toString() === source && separator === "\n") fullSourceSplits += 1;
    return originalSplit.call(this, separator, limit);
  };

  let chunks: SourceChunk[];
  try {
    chunks = chunkSourceForEvidence(source, "neutral", packingPolicy());
  } finally {
    String.prototype.split = originalSplit;
  }

  assertCompleteSourceCoverage(source, chunks);
  assert.ok(fullSourceSplits <= 32, `planner split the full source ${fullSourceSplits} times`);
});

test("packed evidence corpus preserves oversized and fenced source authority", () => {
  const policy = packingPolicy();
  for (const source of [
    mediumEvidenceSource(),
    mixedOversizedEvidenceSource(),
    oversizedParagraphEvidenceSource(),
    fencedEvidenceSource(),
  ]) {
    const chunks = chunkSourceForEvidence(source, "neutral", policy);
    assertCompleteSourceCoverage(source, chunks);
    assert.equal(exactCoveredSource(source, chunks), source);
    assert.equal(
      chunks.every((chunk) => chunk.id === `${chunk.ordinal}:${chunk.startLine}-${chunk.endLine}:${chunk.contentHash}`),
      true,
    );
  }

  const fenced = fencedEvidenceSource();
  // Rescaled from a byte-era budget of 6_000 for the token estimator (task-3
  // prompt-budget-automation): 1_500 tokens still forces an interior wrapped
  // fenced chunk.
  const fencedChunks = chunkSourceForEvidence(fenced, "neutral", {
    ...policy,
    inputBudgetTokens: 1_500,
  });
  assertCompleteSourceCoverage(fenced, fencedChunks);
  assert.ok(fencedChunks.length > 1);
  const interiorFencedChunks = fencedChunks
    .filter((chunk) => chunk.startLine > 3 && chunk.endLine < 184);
  assert.ok(interiorFencedChunks.length > 0, "fixture must produce an interior fenced chunk");
  assert.ok(
    interiorFencedChunks
      .every((chunk) => chunk.markdown.startsWith("```text\n") && chunk.markdown.endsWith("\n```")),
  );

  const mixed = mixedOversizedEvidenceSource();
  const mixedChunks = chunkSourceForEvidence(mixed, "neutral", {
    ...policy,
    inputBudgetTokens: 6_000,
  });
  assert.ok(mixedChunks.length > 1);
  assertCompleteSourceCoverage(mixed, mixedChunks);
  assert.equal(exactCoveredSource(mixed, mixedChunks), mixed);
  assert.equal(
    mixedChunks.every((chunk) => chunk.id === `${chunk.ordinal}:${chunk.startLine}-${chunk.endLine}:${chunk.contentHash}`),
    true,
  );
  assert.ok(mixedChunks.some((chunk) => chunk.markdown.includes("```text")));
});

test("packed mapper input estimate stays below uncoalesced structural baseline", async () => {
  const source = mediumEvidenceSource();
  const policy = packingPolicy();
  const capture = async (input: string): Promise<OpenAI.Chat.ChatCompletionMessageParam[][]> => {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    const runtime = mockRuntime((messages) => {
      const { id } = mapperMeta(messages);
      return { packets: [], noEvidence: [{ chunkId: id, reason: "none" }] };
    }, [], requests);
    await prepareSourceEvidence(input, "neutral", policy, runtime);
    return requests;
  };

  const packedRequests = await capture(source);
  const structural = chunkMarkdownSource(source, {
    maxEstimatedTokens: 700,
    overlapLines: 0,
  });
  const baselineRequests = (
    await Promise.all(structural.map((chunk) => capture(createSourceChunkForRange(
      source,
      chunk.startLine,
      chunk.endLine,
      0,
      chunk.headingPath,
    ).markdown)))
  ).flat();
  const total = (requests: OpenAI.Chat.ChatCompletionMessageParam[][]): number =>
    requests.reduce((sum, request) => sum + estimatePreparedMessages(request), 0);

  assert.ok(structural.length > packedRequests.length);
  assert.ok(total(packedRequests) < total(baselineRequests));
});

test("evidence telemetry wrapper preserves native transport diagnostics", async () => {
  const consumeHttpResponse = (_signal: AbortSignal) => undefined;
  const consumeTransportTrace = (_signal: AbortSignal) => undefined;
  const events: RunEvent[] = [];
  let observedRetry = false;
  const create = async (
    params: OpenAI.Chat.ChatCompletionCreateParams,
    options?: LlmChatCompletionCreateOptions,
  ): Promise<OpenAI.Chat.ChatCompletion> => {
    assert.equal(options?.retry?.connectionTimeoutMs, 1_234);
    assert.equal(options?.retry?.consumeNativeHttpResponseDiagnostic, consumeHttpResponse);
    assert.equal(options?.retry?.consumeNativeTransportTrace, consumeTransportTrace);
    observedRetry = true;
    options?.retry?.onEvent({
      kind: "native_transport_correlation",
      logicalRequestId: options.retry.logicalRequestId,
      lifecycleId: options.retry.lifecycle.current().id,
      callSite: "ingest.evidence-map",
      transport: "non-stream",
      attempt: 0,
      networkTransport: "desktop-direct",
      endpointPath: "/v1/chat/completions",
      diagnosticMode: "connection-close",
      connectionTimeoutMs: options.retry.connectionTimeoutMs,
      idleTimeoutMs: options.retry.idleTimeoutMs,
      clientRequestId: "aiwiki-test-correlation",
    });
    options?.retry?.onEvent({
      kind: "native_transport_trace",
      stage: "fetch_abort",
      logicalRequestId: options.retry.logicalRequestId,
      lifecycleId: options.retry.lifecycle.current().id,
      callSite: "ingest.evidence-map",
      transport: "non-stream",
      attempt: 0,
      networkTransport: "desktop-direct",
      endpointPath: "/v1/chat/completions",
      diagnosticMode: "connection-close",
      elapsedMs: 10,
      connectionTimeoutMs: options.retry.connectionTimeoutMs,
      idleTimeoutMs: options.retry.idleTimeoutMs,
      errorClass: "AbortError",
    });
    const payload = {
      packets: [validMapperPacket(params.messages)],
      noEvidence: [],
    };
    return {
      id: "native-evidence-completion",
      object: "chat.completion",
      created: 0,
      model: "mock",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(payload), refusal: null },
        logprobs: null,
      }],
    };
  };
  const llm: LlmClient = {
    nativeRequestExecutor: true,
    nativeConnectionTimeoutMs: 1_234,
    nativeTransportDiagnostic: {
      transport: "desktop-direct",
      diagnosticMode: "connection-close",
      endpointPath: "/v1/chat/completions",
    },
    consumeNativeHttpResponseDiagnostic: consumeHttpResponse,
    consumeNativeTransportTrace: consumeTransportTrace,
    chat: { completions: { create: create as LlmClient["chat"]["completions"]["create"] } },
  };
  const result = await prepareSourceEvidence(
    "PostgreSQL source",
    "demo",
    evidencePolicy(),
    {
      llm,
      model: "mock",
      signal: new AbortController().signal,
      configuredEntityTypes: ["tool"],
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(result.length, 1);
  assert.equal(observedRetry, true);
  assert.equal(events.some((event) => event.kind === "native_transport_correlation"), true);
  assert.equal(events.some((event) => event.kind === "native_transport_trace"), true);
});

function realisticReducerPolicy(): EvidencePolicy {
  // Rescaled from a byte-era budget of 13_000 for the token estimator
  // (task-3 prompt-budget-automation): divided by the default 4.2 chars-per-
  // token divisor to keep the same relative tightness against these fixtures.
  return {
    ...evidencePolicy(3_095),
    outputBudgetTokens: 4_000,
  };
}

function mockOutputBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function repeatedMapperPackets(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  count = 12,
  entityType: string | null = "tool",
): Record<string, unknown>[] {
  const { id, ordinal } = mapperMeta(messages);
  return Array.from({ length: count }, (_, packetIndex) => ({
    ...validMapperPacket(messages, 0, entityType),
    id: `p${ordinal}-${packetIndex}`,
    facts: [`fact-${ordinal}`],
    exactSourceRanges: [{ startLine: 1, endLine: 1 }],
    sourceAnchor: `${id}:1`,
  }));
}

for (const configuredEntityTypes of [undefined, []] as Array<string[] | undefined>) {
  const label = configuredEntityTypes === undefined ? "undefined" : "empty";
  test(`normal source rejects mapper entityType when configured types are ${label}`, async () => {
    const events: RunEvent[] = [];
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    const runtime = mockRuntime((messages) => ({
      packets: [validMapperPacket(messages, 0, "tool")],
      noEvidence: [],
    }), events, requests);
    runtime.configuredEntityTypes = configuredEntityTypes;
    await assert.rejects(
      prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime),
      (error: unknown) => error instanceof EvidenceCoverageError
        && /entityType is not allowed without configured entity types/i.test(error.message),
    );
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => allMessageText(request).includes("CONFIGURED_ENTITY_TYPES none")));
  });
}

test("normal source accepts mapper entityType from configured types", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => ({
    packets: [validMapperPacket(messages, 0, "tool")],
    noEvidence: [],
  }), events, requests);
  runtime.configuredEntityTypes = ["tool"];
  const result = await prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime);
  assert.equal(result[0].entityType, "tool");
  assert.match(allMessageText(requests[0]), /CONFIGURED_ENTITY_TYPES tool/);
});

test("mapper wire normalization does not weaken the configured type allowlist", async () => {
  const runtime = mockRuntime((messages) => ({
    packets: [validMapperPacket(messages, 0, "service")],
    noEvidence: [],
  }), []);
  runtime.configuredEntityTypes = ["tool"];

  await assert.rejects(
    prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime),
    (error: unknown) => error instanceof EvidenceCoverageError
      && /unknown configured entity type.*service/i.test(error.message),
  );
});

test("mapper wire null becomes an omitted entity type when no types are configured", async () => {
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages, 0, null);
    mapped.entityType = null;
    return { packets: [mapped], noEvidence: [] };
  }, []);
  runtime.configuredEntityTypes = [];

  const result = await prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime);

  assert.equal(result[0].entityType, undefined);
  assert.equal("entityType" in result[0], false);
});

test("configured mapper wire null stays missing and uses existing single-type inference", async () => {
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages, 0, null);
    mapped.entityType = null;
    return { packets: [mapped], noEvidence: [] };
  }, []);
  runtime.configuredEntityTypes = ["tool"];

  const result = await prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime);

  assert.equal(result[0].entityType, "tool");
});

test("mapper wire accepts compact noEvidence strings for the current chunk", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime(() => ({
    packets: [],
    noEvidence: ["No domain evidence in this chunk."],
  }), events);

  const result = await prepareSourceEvidence("generic source line", "demo", evidencePolicy(), runtime);

  assert.deepEqual(result, []);
  assert.equal(events.some((event) => event.kind === "structural_error"), false);
});

test("mapper wire normalizes exact source range tuples without a repair request", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages) as unknown as Record<string, unknown>;
    mapped.exactSourceRanges = [[1, 1]];
    return { packets: [mapped], noEvidence: [] };
  }, events);

  const result = await prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime);

  assert.deepEqual(result[0].exactSourceRanges, [{ startLine: 1, endLine: 1 }]);
  assert.equal(events.some((event) => event.kind === "structural_error"), false);
});

test("mapper wire normalizes an unambiguous singular exact source range without repair", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages) as unknown as Record<string, unknown>;
    mapped.exactSourceRange = { startLine: 1, endLine: 1 };
    delete mapped.exactSourceRanges;
    return { packets: [mapped], noEvidence: [] };
  }, events);

  const result = await prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime);

  assert.deepEqual(result[0].exactSourceRanges, [{ startLine: 1, endLine: 1 }]);
  assert.equal(events.some((event) => event.kind === "structural_error"), false);
});

test("mapper wire rejects ambiguous singular and plural exact source range fields", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages) as unknown as Record<string, unknown>;
    mapped.exactSourceRange = { startLine: 1, endLine: 1 };
    return { packets: [mapped], noEvidence: [] };
  }, events);

  await assert.rejects(
    prepareSourceEvidence("PostgreSQL source", "demo", evidencePolicy(), runtime),
    EvidenceCoverageError,
  );
  assert.equal(events.some((event) => event.kind === "structural_error"), true);
});

test("mapper treats omitted noEvidence as an empty set when packets cover the chunk", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => ({
    packets: [validMapperPacket(messages)],
  }), events, requests);

  const result = await prepareSourceEvidence(
    "PostgreSQL source",
    "demo",
    { ...evidencePolicy(), mapperRetries: 3 },
    runtime,
  );

  assert.equal(result.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(events.some((event) => event.kind === "structural_error"), false);
});

test("mapper treats omitted packets as an empty set when noEvidence covers the chunk", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => ({
    noEvidence: [{ chunkId: mapperMeta(messages).id, reason: "Heading-only chunk" }],
  }), events, requests);

  const result = await prepareSourceEvidence(
    "## Heading only",
    "demo",
    { ...evidencePolicy(), mapperRetries: 3 },
    runtime,
  );

  assert.deepEqual(result, []);
  assert.equal(requests.length, 1);
  assert.equal(events.some((event) => event.kind === "structural_error"), false);
});

test("chunk planner treats undefined configured types as no configured types", () => {
  const source = Array.from({ length: 46 }, (_, index) => `line-${index + 1}-postgresql`).join("\n");
  const policy = evidencePolicy();
  const implicitNone = chunkSourceForEvidence(source, "demo", policy);
  const explicitNone = chunkSourceForEvidence(source, "demo", policy, {}, []);
  assert.deepEqual(
    implicitNone.map(({ startLine, endLine }: { startLine: number; endLine: number }) => ({ startLine, endLine })),
    explicitNone.map(({ startLine, endLine }: { startLine: number; endLine: number }) => ({ startLine, endLine })),
  );
});

test("source orchestration maps complete chunks and recursively reduces whole packets", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const policy = realisticReducerPolicy();
  const runtime = mockRuntime((messages) => {
    const output = isReducerRequest(messages)
      ? validReduced(reducerInput(messages))
      : { packets: repeatedMapperPackets(messages), noEvidence: [] };
    return output;
  }, events, requests);

  const source = Array.from({ length: 500 }, (_, index) => `line ${index + 1} PostgreSQL details`).join("\n");
  const expectedChunks = chunkSourceForEvidence(
    source,
    "demo",
    policy,
    runtime.opts ?? {},
    runtime.configuredEntityTypes,
  );
  assertCompleteSourceCoverage(source, expectedChunks);
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  const expectedChunkIds = expectedChunks.map((chunk: { id: string }) => chunk.id);
  const expectedPacketIds = expectedChunks.flatMap((chunk: { id: string }, ordinal: number) => (
    Array.from({ length: 12 }, (__, packetIndex) => `${chunk.id}:p${ordinal}-${packetIndex}`)
  ));
  assert.equal(result.length, 1);
  assert.deepEqual(requests.filter((request) => !isReducerRequest(request)).map((request) => mapperMeta(request).id), expectedChunkIds);
  assert.deepEqual(result[0].packetIds, expectedPacketIds);

  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length, requests.length, "one prompt_budget event per actual request");
  assert.ok(events.every((event) =>
    event.kind === "prompt_budget"
    || event.kind === "llm_request_fingerprint"
    || event.kind === "llm_lifecycle"
    || event.kind === "llm_call_stats"
    || event.kind === "tool_use"
    || event.kind === "tool_result"));
  const telemetry = JSON.stringify(budgetEvents);
  for (const forbidden of ["PostgreSQL details", "fact-", "postgresql.org"]) {
    assert.equal(telemetry.includes(forbidden), false, `telemetry leaked ${forbidden}`);
  }
  for (let index = 0; index < requests.length; index++) {
    const event = budgetEvents[index];
    assert.equal(event.kind, "prompt_budget");
    const independentlyEstimated = estimatePreparedMessages(requests[index]);
    assert.equal(event.estimatedInputTokens, independentlyEstimated);
    assert.ok(independentlyEstimated <= event.effectiveInputBudget);
    assert.equal(event.sourceChunks, expectedChunks.length);
    assert.equal(JSON.stringify(event).includes("PostgreSQL details"), false);
  }

  const reducerPairs = requests
    .map((request, index) => ({ request, event: budgetEvents[index] }))
    .filter(({ request }) => isReducerRequest(request));
  const reducerBudget = policy.inputBudgetTokens;
  for (const { request } of reducerPairs) {
    assert.ok(estimatePreparedMessages(request) <= reducerBudget, "reducer request consumed repair reserve");
  }
  const depths = [...new Set(reducerPairs.map(({ event }) => event.reductionDepth ?? -1))].sort((a, b) => a - b);
  assert.ok(depths.at(-1)! >= 2);
  let previousUnits = Number.POSITIVE_INFINITY;
  for (const depth of depths) {
    const batches = reducerPairs.filter(({ event }) => event.reductionDepth === depth).map(({ request }) => reducerInput(request));
    const unitCount = batches.reduce((sum, batch) => sum + batch.length, 0);
    assert.ok(unitCount < previousUnits, `depth ${depth} must strictly reduce ${previousUnits} -> ${unitCount}`);
    previousUnits = unitCount;
    const coveredIds = batches.flatMap((batch) => batch.flatMap((unit) => Array.isArray(unit.packetIds) ? unit.packetIds : [unit.id]));
    assert.deepEqual(coveredIds, expectedPacketIds, `depth ${depth} must partition whole packets exactly once`);
  }
});

test("reducer wire null becomes omitted when the expected entity type is undefined", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) {
      return { ...validReduced(reducerInput(messages)), entityType: null };
    }
    return { packets: repeatedMapperPackets(messages, 12, null), noEvidence: [] };
  }, [], requests);
  runtime.configuredEntityTypes = [];

  const source = Array.from(
    { length: 500 },
    (_, index) => `wire null reducer ${index + 1} PostgreSQL details`,
  ).join("\n");
  const result = await prepareSourceEvidence(source, "demo", realisticReducerPolicy(), runtime);

  assert.ok(requests.some(isReducerRequest));
  assert.equal(result[0].entityType, undefined);
  assert.equal("entityType" in result[0], false);
});

test("reducer wire null is rejected when the expected entity type is configured", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) {
      return { ...validReduced(reducerInput(messages)), entityType: null };
    }
    return { packets: repeatedMapperPackets(messages), noEvidence: [] };
  }, [], requests);
  runtime.configuredEntityTypes = ["tool"];

  const source = Array.from(
    { length: 500 },
    (_, index) => `configured reducer ${index + 1} PostgreSQL details`,
  ).join("\n");
  await assert.rejects(
    prepareSourceEvidence(source, "demo", realisticReducerPolicy(), runtime),
    EvidenceReducerError,
  );
  assert.ok(requests.some(isReducerRequest));
});

test("exact prepared mapper sizing bounds every captured request", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    const mapped = validMapperPacket(messages);
    mapped.entityKey = `entity-${mapperMeta(messages).ordinal}`;
    return { packets: [mapped], noEvidence: [] };
  }, events, requests);
  const source = Array.from({ length: 1000 }, (_, index) => `budget fixture ${index + 1}`).join("\n");
  const policy = { ...evidencePolicy(5500), outputBudgetTokens: 512 };
  await prepareSourceEvidence(source, "demo", policy, runtime);
  assert.ok(requests.length > 1);
  for (const request of requests) {
    assert.ok(estimatePreparedMessages(request) <= policy.inputBudgetTokens);
  }
});

test("recursive reducer reserves budget for a captured first request and repair", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const reducerAttempts = new Map<string, number>();
  const policy = realisticReducerPolicy();
  const runtime = mockRuntime((messages) => {
    if (!isReducerRequest(messages)) {
      const output = { packets: repeatedMapperPackets(messages), noEvidence: [] };
      return output;
    }
    const input = reducerInput(messages);
    const key = JSON.stringify(input);
    const attempt = (reducerAttempts.get(key) ?? 0) + 1;
    reducerAttempts.set(key, attempt);
    const valid = validReduced(input);
    const output = attempt === 1
      ? { ...valid, packetIds: (valid.packetIds as unknown[]).slice(0, -1) }
      : valid;
    return output;
  }, events, requests);
  const source = Array.from({ length: 500 }, (_, index) => `repair threshold ${index + 1}`).join("\n");
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  assert.ok(result[0].packetIds.length > 1);

  const reducerBudget = policy.inputBudgetTokens;
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  const pairs = requests.map((request, index) => ({ request, event: budgetEvents[index] }))
    .filter(({ request }) => isReducerRequest(request));
  const basePairs = pairs.filter(({ request }) => !allMessageText(request).includes("STRUCTURED_REPAIR:"));
  assert.ok(basePairs.length > 1);
  for (const { request } of basePairs) {
    assert.ok(estimatePreparedMessages(request) <= reducerBudget, "base reducer request consumed repair reserve");
  }
  assert.ok([...reducerAttempts.values()].some((attempts) => attempts === 2));
  assert.equal(budgetEvents.length, requests.length);
  for (const { request, event } of pairs) {
    assert.equal(event.kind, "prompt_budget");
    assert.equal(event.estimatedInputTokens, estimatePreparedMessages(request));
    assert.ok(event.estimatedInputTokens <= event.effectiveInputBudget);
  }
});

test("single-chunk mapper rejects foreign packet ownership", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages);
    return {
      packets: [{ ...mapped, chunkId: mapped.chunkId.slice(0, -1) }],
      noEvidence: [],
    };
  }, [], requests);

  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", evidencePolicy(), runtime),
    EvidenceCoverageError,
  );

  assert.equal(requests.length, 2);
});

test("mapper complementary normalization rejects foreign noEvidence ownership", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime(() => ({
    noEvidence: [{ chunkId: "foreign-chunk", reason: "none" }],
  }), [], requests);

  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", evidencePolicy(), runtime),
    EvidenceCoverageError,
  );

  assert.equal(requests.length, 2);
});

test("mapper range repair exhaustion performs real requests and emits one safe budget event per request", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages);
    return {
      packets: [{ ...mapped, exactSourceRanges: [{ startLine: 2, endLine: 2 }] }],
      noEvidence: [],
    };
  }, events, requests);
  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", evidencePolicy(), runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceCoverageError);
      assert.match(error.message, /structural validation failed after 2 attempt/i);
      return true;
    },
  );
  assert.equal(requests.length, 2, "initial mapper request plus one structured repair");
  assert.match(allMessageText(requests[1]), /source_range_out_of_bounds/i);
  assert.match(allMessageText(requests[1]), /chunk-local CHUNK_LINE/i);
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length, requests.length);
  assert.deepEqual(
    budgetEvents.map((event) => event.requestId),
    events
      .filter((event) => event.kind === "llm_lifecycle" && event.phase === "preparing")
      .map((event) => event.kind === "llm_lifecycle" ? event.id : undefined),
  );
  for (let index = 0; index < requests.length; index++) {
    assert.equal(budgetEvents[index].kind, "prompt_budget");
    assert.equal(budgetEvents[index].estimatedInputTokens, estimatePreparedMessages(requests[index]));
    assert.equal(budgetEvents[index].reductionDepth, 0);
    assert.equal(JSON.stringify(budgetEvents[index]).includes("one source line"), false);
  }
});

function reducerFailureRuntime(
  mutate: (valid: Record<string, unknown>) => Record<string, unknown>,
): { runtime: EvidenceRuntime; events: RunEvent[]; requests: OpenAI.Chat.ChatCompletionMessageParam[][] } {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const policy = realisticReducerPolicy();
  return {
    events,
    requests,
    runtime: mockRuntime((messages) => {
      const output = isReducerRequest(messages)
        ? mutate(validReduced(reducerInput(messages)))
        : { packets: repeatedMapperPackets(messages), noEvidence: [] };
      return output;
    }, events, requests),
  };
}

const reducerFailureSource = Array.from({ length: 500 }, (_, index) => `failure line ${index + 1}`).join("\n");

test("reducer missing packet IDs exhausts repair and fails typed", async () => {
  const fixture = reducerFailureRuntime((valid) => ({
    ...valid,
    packetIds: (valid.packetIds as unknown[]).slice(0, -1),
  }));
  await assert.rejects(
    prepareSourceEvidence(reducerFailureSource, "demo", realisticReducerPolicy(), fixture.runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceReducerError);
      assert.match(error.message, /structural validation failed after 2 attempt/i);
      assert.match(error.message, /packet coverage mismatch: .*p\d+/i);
      return true;
    },
  );
  const reducerRequests = fixture.requests.filter(isReducerRequest);
  const reducerEvents = fixture.events.filter((event) => event.kind === "prompt_budget"
    && event.callSite === "ingest.evidence-reduce");
  assert.equal(reducerEvents.length, reducerRequests.length);
  assert.ok(reducerRequests.length >= 2);
  const reducerInputs = reducerRequests.map((request) => JSON.stringify(reducerInput(request)));
  assert.ok(new Set(reducerInputs).size < reducerInputs.length, "a reducer batch must be repaired");
  for (let index = 0; index < reducerRequests.length; index++) {
    assert.equal(reducerEvents[index].kind, "prompt_budget");
    assert.equal(reducerEvents[index].estimatedInputTokens, estimatePreparedMessages(reducerRequests[index]));
    assert.ok(reducerEvents[index].estimatedInputTokens <= reducerEvents[index].effectiveInputBudget);
  }
});

test("reducer extra packet IDs exhausts repair and fails typed", async () => {
  const fixture = reducerFailureRuntime((valid) => ({
    ...valid,
    packetIds: [...valid.packetIds as unknown[], "foreign-packet"],
  }));
  await assert.rejects(
    prepareSourceEvidence(reducerFailureSource, "demo", realisticReducerPolicy(), fixture.runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceReducerError);
      assert.match(error.message, /structural validation failed after 2 attempt/i);
      assert.match(error.message, /packet coverage mismatch: extra IDs/i);
      return true;
    },
  );
  assert.ok(fixture.requests.filter(isReducerRequest).length >= 2);
});

for (const fixture of [
  {
    name: "fact",
    expectedError: /invented or missing facts/i,
    mutate: (valid: Record<string, unknown>) => ({ ...valid, facts: [...valid.facts as unknown[], "invented fact"] }),
  },
  {
    name: "link",
    expectedError: /invented or missing links/i,
    mutate: (valid: Record<string, unknown>) => ({ ...valid, links: [...valid.links as unknown[], "https://invented.invalid"] }),
  },
  {
    name: "range",
    expectedError: /invented or missing exact source ranges/i,
    mutate: (valid: Record<string, unknown>) => ({
      ...valid,
      exactSourceRanges: [...valid.exactSourceRanges as unknown[], { startLine: 999_999, endLine: 999_999 }],
    }),
  },
]) {
  test(`reducer invented ${fixture.name} exhausts repair and fails typed`, async () => {
    const runtimeFixture = reducerFailureRuntime(fixture.mutate);
    await assert.rejects(
      prepareSourceEvidence(reducerFailureSource, "demo", realisticReducerPolicy(), runtimeFixture.runtime),
      (error: unknown) => {
        assert.ok(error instanceof EvidenceReducerError);
        assert.match(error.message, /structural validation failed after 2 attempt/i);
        assert.match(error.message, fixture.expectedError);
        return true;
      },
    );
    assert.ok(runtimeFixture.requests.filter(isReducerRequest).length >= 2);
  });
}

test("reducer partition non-progress fails typed before looping", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    return { packets: [validMapperPacket(messages, 700)], noEvidence: [] };
  }, events, requests);
  const source = Array.from({ length: 400 }, (_, index) => `non-progress ${index}`).join("\n");
  // Rescaled from the default 5_000 budget for the token estimator (task-3
  // prompt-budget-automation): 1_195 keeps the mapper's oversized packets
  // just large enough that the reducer can never partition off a first batch.
  await assert.rejects(
    prepareSourceEvidence(source, "demo", { ...evidencePolicy(1_195), outputBudgetTokens: 2_000 }, runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceReducerError);
      assert.match(error.message, /Reducer made no progress at depth 0/);
      return true;
    },
  );
  assert.equal(requests.filter(isReducerRequest).length, 0);
});

test("irreducible single evidence packet oversize fails typed", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime((messages) => ({
    packets: [validMapperPacket(messages, 5000)],
    noEvidence: [],
  }), events);
  // Rescaled from the default 5_000 budget for the token estimator (task-3
  // prompt-budget-automation): 2_000 tokens is still too small for the
  // single 5_000-character fact, which the default budget now comfortably fits.
  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", { ...evidencePolicy(2_000), outputBudgetTokens: 6_000 }, runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceReducerError);
      assert.match(error.message, /A single evidence packet cannot fit the reducer budget/);
      return true;
    },
  );
});

test("reducer rejects an irreducible expected output before any reducer LLM call", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const policy = { ...realisticReducerPolicy(), outputBudgetTokens: 3_000 };
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    const mapped = validMapperPacket(messages);
    mapped.entityKey = "aggregate";
    mapped.facts = [`bounded-${"x".repeat(1_000)}`];
    return { packets: [mapped], noEvidence: [] };
  }, events, requests);
  const source = Array.from({ length: 1_500 }, (_, index) => `output budget ${index + 1} ${"x".repeat(300)}`).join("\n");
  await assert.rejects(
    prepareSourceEvidence(source, "demo", policy, runtime),
    (error: unknown) => error instanceof EvidenceReducerError
      && /expected output.*exceeds.*3000 byte/i.test(error.message),
  );
  assert.equal(requests.filter(isReducerRequest).length, 0);
});

test("bootstrap derives bounded candidate, theme, and language evidence from validated packets", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const mapperAttempts = new Map<string, number>();
  const policy = {
    ...realisticReducerPolicy(),
    inputBudgetTokens: 15_000,
    bootstrapPayloadBudgetTokens: 3500,
  } as EvidencePolicy;
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) {
      const output = validReduced(reducerInput(messages));
      return output;
    }
    const meta = mapperMeta(messages);
    const attempt = (mapperAttempts.get(meta.id) ?? 0) + 1;
    mapperAttempts.set(meta.id, attempt);
    const packets = repeatedMapperPackets(messages);
    for (const mapped of packets) mapped.facts = ["PostgreSQL is a database"];
    if (attempt === 1) {
      for (const mapped of packets) mapped.entityType = "tool";
    } else {
      for (const mapped of packets) delete mapped.entityType;
    }
    const output = { packets, noEvidence: [] };
    return output;
  }, events, requests);
  const sentinel = "FULL_SOURCE_SENTINEL";
  const source = Array.from({ length: 420 }, (_, index) => `${sentinel}-${index + 1}`).join("\n");
  const expectedChunks = chunkSourceForEvidence(source, "bootstrap", policy, runtime.opts ?? {}, []);
  const result = await prepareBootstrapEvidence(source, "bootstrap", policy, runtime);
  assert.deepEqual(result.candidates.map((candidate) => candidate.entityKey), ["postgresql"]);
  assert.deepEqual(result.candidates.flatMap((candidate) => candidate.packetIds), expectedChunks.flatMap((chunk: { id: string }, ordinal: number) => (
    Array.from({ length: 12 }, (__, packetIndex) => `${chunk.id}:p${ordinal}-${packetIndex}`)
  )));
  assert.ok(result.candidates.every((candidate) => !("entityType" in candidate)));
  assert.ok(result.candidates.every((candidate) => Array.isArray(candidate.facts) && candidate.facts.length > 0));
  assert.ok(result.candidates.every((candidate) => Array.isArray(candidate.exactSource) && candidate.exactSource.length > 0));
  assert.ok(result.domainThemes.includes("PostgreSQL is a database"));
  assert.ok(result.languageEvidence.length > 0);
  assert.equal(JSON.stringify(events).includes(sentinel), false);
  assert.equal(JSON.stringify(result).includes(source), false);
  assert.ok(requests.length > 1);
  for (const request of requests) {
    const estimated = estimatePreparedMessages(request);
    assert.ok(
      estimated <= policy.inputBudgetTokens,
      `request estimate ${estimated} exceeded ${policy.inputBudgetTokens}`,
    );
    assert.equal(JSON.stringify(request).includes(source), false);
  }
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length, requests.length);
  assert.ok(events.every((event) =>
    event.kind === "prompt_budget"
    || event.kind === "llm_request_fingerprint"
    || event.kind === "llm_lifecycle"
    || event.kind === "llm_call_stats"
    || event.kind === "tool_use"
    || event.kind === "tool_result"
    || event.kind === "structural_error"));
  for (let index = 0; index < requests.length; index++) {
    const event = budgetEvents[index];
    assert.equal(event.kind, "prompt_budget");
    assert.equal(event.sourceChunks, expectedChunks.length);
    if (isReducerRequest(requests[index])) {
      assert.ok((event.reductionDepth ?? 0) > 0);
    } else {
      assert.equal(event.reductionDepth, 0);
    }
    assert.equal(event.estimatedInputTokens, estimatePreparedMessages(requests[index]));
    assert.ok(event.estimatedInputTokens <= event.effectiveInputBudget);
    for (const forbidden of [sentinel, "PostgreSQL is a database", "postgresql.org"]) {
      assert.equal(JSON.stringify(event).includes(forbidden), false, `bootstrap telemetry leaked ${forbidden}`);
    }
  }
  const nextUseEstimate = estimatePreparedMessages([{ role: "user", content: JSON.stringify(result) }]);
  assert.ok(nextUseEstimate <= 3500, `bootstrap next-use payload ${nextUseEstimate} exceeded 3500`);
});

test("bootstrap compresses aggregate evidence payload instead of reconstructing every line", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    assert.equal(isReducerRequest(messages), false);
    const meta = mapperMeta(messages);
    const mapped = validMapperPacket(messages, 0, null);
    mapped.entityKey = `entity-${meta.ordinal}`;
    mapped.exactSourceRanges = [{ startLine: 1, endLine: meta.endLine - meta.startLine + 1 }];
    return { packets: [mapped], noEvidence: [] };
  }, events, requests);
  const source = Array.from({ length: 300 }, (_, index) => `RECONSTRUCT-${index + 1}`).join("\n");
  // Rescaled from a byte-era budget of 6_000 for the token estimator (task-3
  // prompt-budget-automation): 1_500 still forces the source to split across
  // multiple mapper chunks.
  const policy = {
    ...evidencePolicy(1500),
    outputBudgetTokens: 256,
    bootstrapPayloadBudgetTokens: 1500,
  };
  const expectedChunks = chunkSourceForEvidence(source, "bootstrap", policy, runtime.opts ?? {}, []);
  assert.ok(expectedChunks.length > 1);
  assertCompleteSourceCoverage(source, expectedChunks);
  const bundle = await prepareBootstrapEvidenceBundle(source, "bootstrap", "", policy, runtime);
  // The payload used to be trimmed until it fit, which dropped evidence. Task 9
  // splits it instead: each group is bounded and every candidate survives.
  for (const group of bundle.bootstrapGroups) {
    const estimated = estimatePreparedMessages([{ role: "user", content: JSON.stringify(group) }]);
    assert.ok(estimated <= 1500, `bootstrap group ${estimated} exceeded budget`);
  }
  assert.ok(bundle.bootstrapMinimumGroupTokens <= 1500);
  assert.equal(
    new Set(bundle.bootstrapGroups.flatMap(
      (group) => group.candidates.map((candidate) => candidate.entityKey),
    )).size,
    expectedChunks.length,
    "every mapped entity must survive the split",
  );
  assert.ok(bundle.bootstrap.candidates.length > 0);
  assert.equal(requests.length, expectedChunks.length);
});

test("synthetic fenced wrappers never consume mapper source line numbers", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const source = [
    "before",
    "```ts",
    ...Array.from({ length: 80 }, (_, index) => `code ${index + 1} ${"x".repeat(60)}`),
    "```",
    "after",
    "",
  ].join("\r\n");
  const policy = { ...evidencePolicy(8000), outputBudgetTokens: 1000 };
  const runtime = mockRuntime((messages) => {
    const text = allMessageText(messages);
    const chunkText = text.split("SOURCE CHUNK:\n", 2)[1] ?? "";
    const displayed = chunkText.split("\n");
    const original = displayed
      .map((line) => /^CHUNK_LINE (\d+) \| ([\s\S]*)$/u.exec(line))
      .filter((match): match is RegExpExecArray => match !== null);
    const codeLines = original
      .filter((match) => match[2].startsWith("code "))
      .map((match) => Number(match[1]));
    const meta = mapperMeta(messages);
    if (codeLines.length === 0) return { packets: [], noEvidence: [{ chunkId: meta.id, reason: "No code" }] };
    return {
      packets: [{
        ...packet("local-p1", meta.id),
        entityKey: `fenced-${meta.ordinal}`,
        exactSourceRanges: [{ startLine: codeLines[0], endLine: codeLines.at(-1)! }],
        sourceAnchor: `${meta.id}:${codeLines[0]}`,
      }],
      noEvidence: [],
    };
  }, [], requests);

  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  const exactSource = result.flatMap((entity) => entity.exactSource);
  const expected = Array.from({ length: 80 }, (_, index) => `code ${index + 1} ${"x".repeat(60)}\r`).join("\n");
  assert.equal(exactSource.map((range) => range.text).join("\n"), expected);
});

test("source frontmatter is excluded from mapper evidence without shifting body lines", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const source = [
    "---",
    "tags:",
    "  - unix",
    "wiki_articles:",
    "  - \"[[wiki_os-unix_stale_entity]]\"",
    "---",
    "Body fact about PostgreSQL.",
  ].join("\n");
  const runtime = mockRuntime((messages) => {
    const text = allMessageText(messages);
    const bodyLine = /CHUNK_LINE (\d+) \| Body fact about PostgreSQL\./u.exec(text);
    assert.ok(bodyLine);
    const localLine = Number(bodyLine[1]);
    return {
      packets: [{
        ...validMapperPacket(messages),
        exactSourceRanges: [{ startLine: localLine, endLine: localLine }],
      }],
      noEvidence: [],
    };
  }, [], requests);

  const result = await prepareSourceEvidence(source, "demo", evidencePolicy(), runtime);
  const mapperText = requests.map(allMessageText).join("\n");

  assert.doesNotMatch(mapperText, /wiki_articles|stale_entity/u);
  assert.match(mapperText, /tags:/u);
  assert.match(mapperText, /Body fact about PostgreSQL\./u);
  assert.deepEqual(result[0].exactSourceRanges, [{ startLine: 7, endLine: 7 }]);
  assert.equal(result[0].exactSource[0].text, "Body fact about PostgreSQL.");
});

test("all evidence requests use the policy output cap and reject conflicting maxTokens", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const params: Array<Record<string, unknown>> = [];
  const policy = evidencePolicy();
  const runtime = mockRuntime((messages) => ({
    packets: [{ ...validMapperPacket(messages), id: "p1" }],
    noEvidence: [],
  }), [], requests, params);
  runtime.opts = { maxTokens: 999 };
  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", policy, runtime),
    (error: unknown) => error instanceof EvidenceCoverageError && /maxTokens.*outputBudgetTokens/i.test(error.message),
  );
  assert.equal(params.length, 0);

  runtime.opts = {};
  await prepareSourceEvidence("one source line", "demo", policy, runtime);
  assert.ok(params.length > 0);
  assert.ok(params.every((request) => request.max_completion_tokens === policy.outputBudgetTokens));
});

test("evidence mapper and reducer use direct non-stream requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const params: Array<Record<string, unknown>> = [];
  const runtime = mockRuntime((messages) => isReducerRequest(messages)
    ? validReduced(reducerInput(messages))
    : { packets: repeatedMapperPackets(messages, 24), noEvidence: [] }, [], requests, params);
  const source = Array.from({ length: 500 }, (_, index) => `non-stream evidence ${index + 1}`).join("\n");

  // Rescaled from a byte-era budget of 14_500 for the token estimator
  // (task-3 prompt-budget-automation): divided by the default 4.2 chars-per-
  // token divisor.
  await prepareSourceEvidence(
    source,
    "demo",
    { ...realisticReducerPolicy(), inputBudgetTokens: 3_452, outputBudgetTokens: 7_000 },
    runtime,
  );

  assert.ok(params.some((request) => isReducerRequest(
    request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
  )));
  assert.ok(params.some((request) => !isReducerRequest(
    request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
  )));
  assert.ok(params.every((request) => request.stream === false));
  assert.ok(params.every((request) => request.response_format === undefined));
  assert.ok(params.every((request) => JSON.stringify(request.messages).includes("<<<JSON>>>")));
});

test("evidence progress uses ordered human lifecycle actions with visible retry", async () => {
  const events: RunEvent[] = [];
  let mapperAttempts = 0;
  const hostileEntityType = "HOSTILE_ENTITY_TYPE_DO_NOT_FORWARD";
  const hostilePacketId = "HOSTILE_PACKET_ID_DO_NOT_FORWARD";
  const hostileSource = "HOSTILE_SOURCE_PHRASE_DO_NOT_FORWARD";
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    mapperAttempts += 1;
    if (mapperAttempts === 1) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          id: hostilePacketId,
          entityType: hostileEntityType,
        }],
        noEvidence: [],
      };
    }
    return { packets: repeatedMapperPackets(messages, 24), noEvidence: [] };
  }, events);
  const source = Array.from({ length: 420 }, (_, index) => `${hostileSource} ${index + 1}`).join("\n");

  // Rescaled from a byte-era budget of 14_500 for the token estimator
  // (task-3 prompt-budget-automation): divided by the default 4.2 chars-per-
  // token divisor.
  await prepareSourceEvidence(
    source,
    "demo",
    { ...realisticReducerPolicy(), inputBudgetTokens: 3_452, outputBudgetTokens: 7_000 },
    runtime,
  );

  assert.equal(events.some((event) =>
    event.kind === "tool_use"
    && (event.name === "Evidence mapping" || event.name === "Evidence reduction")), false);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  const ids = [...new Set(lifecycle.map((event) => event.id))];
  assert.ok(ids.length >= 3);
  assert.equal(lifecycle.some((event) => event.action === "extract_source_facts"), true);
  assert.equal(lifecycle.some((event) => event.action === "reduce_source_evidence"), true);
  for (const id of ids) {
    const calls = lifecycle.filter((event) => event.id === id);
    assert.deepEqual(
      calls.map((event) => event.phase),
      calls.at(-1)?.phase === "retrying"
        ? ["preparing", "sent", "waiting", "producing", "validating", "retrying"]
        : ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
    );
    assert.equal(new Set(calls.map((event) => event.action)).size, 1);
  }
  const structuralEvent = events.find((event) =>
    event.kind === "structural_error"
    && event.callSite === "ingest.evidence-map"
    && event.errorType === "schema_validate"
    && event.retryAttempt === 0);
  assert.ok(structuralEvent?.kind === "structural_error");
  assert.equal(structuralEvent.succeeded, false);
  const diagnostics = JSON.stringify(events);
  for (const hostile of [hostileEntityType, hostilePacketId, hostileSource, "\"packets\""]) {
    assert.equal(diagnostics.includes(hostile), false, `diagnostics leaked ${hostile}`);
  }
  assert.equal(events.some((event) =>
    event.kind === "assistant_text"
    || event.kind === "assistant_replace"), false);
});

test("evidence mapper error closes the active human lifecycle", async () => {
  const events: RunEvent[] = [];
  const runtime = mockRuntime((messages) => ({
    packets: [{
      ...validMapperPacket(messages),
      entityType: "HOSTILE_ERROR_ENTITY_TYPE",
    }],
    noEvidence: [],
  }), events);

  await assert.rejects(
    prepareSourceEvidence("HOSTILE_ERROR_SOURCE", "demo", evidencePolicy(), runtime),
    EvidenceCoverageError,
  );

  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.action, "extract_source_facts");
  assert.equal(lifecycle.at(-1)?.phase, "failed");
  const diagnostics = JSON.stringify(events);
  assert.equal(diagnostics.includes("HOSTILE_ERROR_ENTITY_TYPE"), false);
  assert.equal(diagnostics.includes("HOSTILE_ERROR_SOURCE"), false);
});

test("packet IDs preserve valid values and normalize only missing or duplicate locals", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const source = Array.from({ length: 1000 }, (_, index) => `id fixture ${index + 1}`).join("\n");
  const runtime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    return {
      packets: [{ ...validMapperPacket(messages), id: "p1", entityKey: `entity-${meta.ordinal}` }],
      noEvidence: [],
    };
  }, [], requests);
  runtime.configuredEntityTypes = ["tool", "service"];
  const policy = evidencePolicy(5500);
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  assert.ok(result.length > 1);
  const ids = result.flatMap((entity) => entity.packetIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.includes(":")));

  const duplicateEvents: RunEvent[] = [];
  const duplicateRuntime = mockRuntime((messages) => {
    const first = validMapperPacket(messages) as unknown as Record<string, unknown>;
    const second = validMapperPacket(messages) as unknown as Record<string, unknown>;
    delete second.id;
    return {
      packets: [
        { ...first, id: "p1", entityKey: "first", facts: ["first fact"] },
        { ...second, entityKey: "second", facts: ["second fact"] },
      ],
      noEvidence: [],
    };
  }, duplicateEvents, []);
  duplicateRuntime.configuredEntityTypes = ["tool", "service"];
  const normalized = await prepareSourceEvidence("duplicate local id", "demo", policy, duplicateRuntime);
  const normalizedIds = normalized.flatMap((entity) => entity.packetIds);
  assert.equal(new Set(normalizedIds).size, 2);
  assert.ok(normalizedIds.some((id) => id.endsWith(":p1")));
  assert.ok(normalizedIds.some((id) => id.endsWith(":p2")));
  assert.equal(duplicateEvents.some((event) => event.kind === "structural_error"), false);
});

test("entity grouping inherits missing types, combines identical types, and rejects conflicts before reduction", async () => {
  // Budgets below are rescaled from a byte-era 8_000 for the token estimator
  // (task-3 prompt-budget-automation): divided by the default 4.2 chars-per-
  // token divisor, so the fixture still splits into 3+ mapper chunks.
  const source = Array.from({ length: 300 }, (_, index) => `type fixture ${index + 1} ${"x".repeat(60)}`).join("\n");
  for (const types of [["tool", undefined], [undefined, "tool"]]) {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    const runtime = mockRuntime((messages) => {
      const meta = mapperMeta(messages);
      if (meta.ordinal >= 2) return { packets: [], noEvidence: [{ chunkId: meta.id, reason: "fixture boundary" }] };
      return {
        packets: [{
          ...validMapperPacket(messages),
          id: "p1",
          entityKey: "shared",
          ...(types[meta.ordinal] === undefined ? {} : { entityType: types[meta.ordinal] }),
        }],
        noEvidence: [],
      };
    }, [], requests);
    runtime.configuredEntityTypes = ["tool", "service"];
    const result = await prepareSourceEvidence(source, "demo", { ...evidencePolicy(1_905), outputBudgetTokens: 512 }, runtime);
    assert.equal(result[0].entityType, "tool");
  }

  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    if (meta.ordinal >= 2) return { packets: [], noEvidence: [{ chunkId: meta.id, reason: "fixture boundary" }] };
    return {
      packets: [{
        ...validMapperPacket(messages),
        id: "p1",
        entityKey: "shared",
        entityType: meta.ordinal === 0 ? "tool" : "service",
      }],
      noEvidence: [],
    };
  }, [], requests);
  runtime.configuredEntityTypes = ["tool", "service"];
  await assert.rejects(
    prepareSourceEvidence(source, "demo", { ...evidencePolicy(1_905), outputBudgetTokens: 512 }, runtime),
    (error: unknown) => error instanceof EvidenceCoverageError && /conflicting entity type/i.test(error.message),
  );
  assert.equal(requests.filter(isReducerRequest).length, 0);
});

test("source coverage is asserted immediately after chunk creation before mapper calls", async () => {
  const source = await import("node:fs/promises");
  const implementation = await source.readFile(new URL("../src/phases/ingest-evidence.ts", import.meta.url), "utf8");
  const orchestration = implementation.indexOf("async function prepareSourceEvidenceInternal");
  const chunks = implementation.indexOf("const chunks = chunkSourceForEvidence(", orchestration);
  const coverage = implementation.indexOf("assertCompleteSourceCoverage(source, chunks)", orchestration);
  const mapper = implementation.indexOf("await mapChunksWithContextRepack(", orchestration);
  assert.ok(chunks >= 0 && coverage > chunks && coverage < mapper);
});

test("1000-line planner search stays within a logarithmic candidate bound", () => {
  let calls = 0;
  const planned = findLargestFeasibleBudget(1, 1000, (budget) => {
    calls += 1;
    return budget >= 731
      ? { kind: "feasible" as const, value: { sourceLines: 1000 } }
      : { kind: "too-small" as const };
  });
  assert.equal(planned?.budget, 1000);
  assert.ok(calls <= 10, `binary planner used ${calls} candidates`);
});

test("reducer prefix packing stays within an O(n log n) estimate bound", () => {
  const units = Array.from({ length: 1000 }, (_, index) => ({
    entityKey: "postgresql",
    entityType: "tool",
    packetIds: [`p${index}`],
    facts: [`fact-${index}`],
    exactSourceRanges: [{ startLine: index + 1, endLine: index + 1 }],
    exactSource: [{ startLine: index + 1, endLine: index + 1, text: `line-${index}` }],
    links: [],
  }));
  let estimates = 0;
  const batches = partitionUnits(units, 10_000, { inputBudgetTokens: 10_000, maxTokens: 64 }, 0, () => {
    estimates += 1;
  });
  assert.equal(batches.flat().length, units.length);
  assert.ok(estimates <= units.length * 20, `prefix packing used ${estimates} estimates`);
});

test("bounded structured repair never replays a huge invalid model response", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const params: Array<Record<string, unknown>> = [];
  const sentinel = "HUGE_INVALID_MODEL_OUTPUT";
  let attempts = 0;
  const runtime = mockRuntime((messages) => {
    attempts += 1;
    if (attempts === 1) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          exactSourceRanges: [{ startLine: 2, endLine: 2 }],
          sourceAnchor: sentinel,
          facts: [sentinel.repeat(500)],
        }],
        noEvidence: [],
      };
    }
    return { packets: [validMapperPacket(messages)], noEvidence: [] };
  }, [], requests, params);
  const result = await prepareSourceEvidence("one source line", "demo", { ...evidencePolicy(), outputBudgetTokens: 20_000 }, runtime);
  assert.equal(result.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(allMessageText(requests[1]).includes(sentinel), false);
  assert.ok(estimatePreparedMessages(requests[1]) < estimatePreparedMessages(requests[0]) + 1_024);
  assert.equal(params.length, requests.length);
});

test("evidence mapper output-limit retry raises the cap without replaying assistant output", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let attempt = 0;
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      requests.push(params);
      attempt += 1;
      const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
      const content = attempt === 1
        ? ""
        : JSON.stringify({ packets: [validMapperPacket(messages)], noEvidence: [] });
      const completionTokens = attempt === 1 ? 4096 : 32;
      return {
        id: `evidence-output-limit-${attempt}`,
        object: "chat.completion",
        created: 0,
        model: "mock",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 10, completion_tokens: completionTokens, total_tokens: 10 + completionTokens },
      };
    } } },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];
  const runtime: EvidenceRuntime = {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    configuredEntityTypes: ["tool"],
    opts: { outputRetryBudgetTokens: 12_288 },
  };

  const result = await prepareSourceEvidence(
    "one source line",
    "demo",
    { ...evidencePolicy(), outputBudgetTokens: 4096 },
    runtime,
  );

  assert.equal(result.length, 1);
  assert.deepEqual(requests.map((request) => request.max_completion_tokens), [4096, 6144]);
  const retryMessages = requests[1].messages as Array<{ role: string; content: string }>;
  assert.equal(retryMessages.some((message) => message.role === "assistant"), false);
  assert.match(retryMessages.at(-1)?.content ?? "", /output limit/i);
  assert.equal(events.some((event) =>
    event.kind === "structural_error" && event.errorType === "output_limit"), true);
});

test("near-boundary mapper planning reserves the actual output-limit retry envelope", async () => {
  const captured: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const attempts = new Map<string, number>();
  const outputBudgetTokens = 256;
  // Rescaled from a byte-era budget of 6_000 for the token estimator (task-3
  // prompt-budget-automation): divided by the default 4.2 chars-per-token
  // divisor so the source still forces multiple mapper base/retry requests.
  const inputBudgetTokens = 1_429;
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
      captured.push(messages);
      const meta = mapperMeta(messages);
      const attempt = (attempts.get(meta.id) ?? 0) + 1;
      attempts.set(meta.id, attempt);
      const output = attempt === 1
        ? ""
        : JSON.stringify({ packets: [], noEvidence: [{ chunkId: meta.id, reason: "none" }] });
      const completionTokens = attempt === 1 ? outputBudgetTokens : 1;
      return {
        id: `near-boundary-${meta.id}-${attempt}`,
        object: "chat.completion",
        created: 0,
        model: "mock",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: output, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 1, completion_tokens: completionTokens, total_tokens: completionTokens + 1 },
      };
    } } },
  } as unknown as LlmClient;
  const runtime: EvidenceRuntime = {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    configuredEntityTypes: [],
    opts: { outputRetryBudgetTokens: 1_024 },
  };
  const source = Array.from(
    { length: 180 },
    (_, index) => `Boundary ${index.toString().padStart(3, "0")}: ${"x".repeat(24)}`,
  ).join("\n");

  await prepareSourceEvidence(source, "neutral", {
    ...evidencePolicy(inputBudgetTokens),
    outputBudgetTokens,
    overlapLines: 0,
  }, runtime);

  assert.ok(captured.length >= 4, "fixture must exercise multiple base and output-limit retry requests");
  for (const request of captured) {
    assert.ok(
      estimatePreparedMessages(request) + PACKING_SAFETY_TOKENS <= inputBudgetTokens,
      `prepared request requires ${estimatePreparedMessages(request)} plus safety`,
    );
  }
});

test("ingest compression profiles differ once while preserving evidence invariants", async () => {
  const capture = async (profile: "maximum" | "minimum") => {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    const runtime = mockRuntime((messages) => ({
      packets: [validMapperPacket(messages)],
      noEvidence: [],
    }), [], requests);
    await prepareSourceEvidence("one source line", "demo", { ...evidencePolicy(), compressionProfile: profile }, runtime);
    return requests[0].filter((message) => message.role === "system")
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");
  };
  const maximum = await capture("maximum");
  const minimum = await capture("minimum");
  assert.notEqual(maximum, minimum);
  for (const prompt of [maximum, minimum]) {
    assert.equal((prompt.match(/## Semantic compression/g) ?? []).length, 1);
    assert.match(prompt, /Preserve every evidence packet ID, exact source range, link, entity relationship, and generated knowledge fact/);
  }
});

function contextLengthError(): Error & { code: string } {
  return Object.assign(new Error("context length exceeded"), { code: "context_length_exceeded" });
}

test("mapper context recovery rechunks into smaller complete child requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let providerAttempts = 0;
  const source = Array.from({ length: 300 }, (_, index) => `mapper recovery ${index + 1} ${"x".repeat(40)}`).join("\n");
  const runtime = mockRuntime((messages) => {
    if (!isReducerRequest(messages)) {
      providerAttempts += 1;
      if (providerAttempts === 1) throw contextLengthError();
      const meta = mapperMeta(messages);
      return {
        packets: [{
          ...validMapperPacket(messages),
          entityKey: `mapper-${meta.ordinal}`,
          exactSourceRanges: [{ startLine: 1, endLine: meta.endLine - meta.startLine + 1 }],
        }],
        noEvidence: [],
      };
    }
    return validReduced(reducerInput(messages));
  }, events, requests);
  const result = await prepareSourceEvidence(source, "demo", { ...evidencePolicy(8000), outputBudgetTokens: 1000 }, runtime);
  const mapperRequests = requests.filter((request) => !isReducerRequest(request));
  assert.ok(mapperRequests.length > 1);
  assert.ok(estimatePreparedMessages(mapperRequests[1]) < estimatePreparedMessages(mapperRequests[0]));
  assert.equal(result.flatMap((entity) => entity.exactSource).map((range) => range.text).join("\n"), source);
  assert.equal(new Set(result.flatMap((entity) => entity.packetIds)).size, result.flatMap((entity) => entity.packetIds).length);
  const mapperEvents = events.filter((event) => event.kind === "prompt_budget" && event.callSite === "ingest.evidence-map");
  assert.equal(mapperEvents.length, mapperRequests.length);
  assert.ok(mapperEvents.filter((event) => event.retryReason === "provider_context_error").length <= 3);
  assert.ok(mapperEvents.some((event) => event.retryReason === "provider_context_error"));
  assert.ok(events.some((event) =>
    event.kind === "tool_use"
    && event.name === "Evidence context repack"));
  assert.ok(events.some((event) =>
    event.kind === "tool_result"
    && event.ok
    && event.preview === "retry scheduled"));
  assertClosedToolLifecycles(events);
});

test("mapper context repack preserves semantic split depth for child replacements", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let childContextFailed = false;
  const source = Array.from(
    { length: 8 },
    (_, index) => `lineage mapper ${index + 1} ${"x".repeat(40)}`,
  ).join("\n");
  const runtime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    const lineCount = meta.endLine - meta.startLine + 1;
    if (meta.startLine === 1 && meta.endLine === 8) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          exactSourceRanges: [{ startLine: 1, endLine: 9 }],
        }],
        noEvidence: [],
      };
    }
    if (!childContextFailed && meta.startLine === 1 && meta.endLine === 4) {
      childContextFailed = true;
      throw contextLengthError();
    }
    if (childContextFailed && meta.startLine <= 4) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          exactSourceRanges: [{ startLine: 1, endLine: lineCount + 1 }],
        }],
        noEvidence: [],
      };
    }
    return { noEvidence: [{ chunkId: meta.id, reason: "none" }] };
  }, events, requests);

  // Rescaled from a byte-era budget of 10_000 for the token estimator (task-3
  // prompt-budget-automation): 1_800 keeps the initial chunk whole (1-8) so
  // the split/repack lineage this test asserts still occurs.
  await assert.rejects(
    prepareSourceEvidence(source, "demo", {
      ...evidencePolicy(1_800),
      outputBudgetTokens: 1_000,
      mapperRetries: 1,
    }, runtime),
    EvidenceCoverageError,
  );

  assert.deepEqual(requests.slice(0, 3).map((request) => {
    const meta = mapperMeta(request);
    return `${meta.startLine}-${meta.endLine}`;
  }), ["1-8", "1-8", "1-4"]);
  assert.ok(requests.length > 3, "context repack must schedule a smaller overlapping replacement");
  assert.ok(estimatePreparedMessages(requests[3]) < estimatePreparedMessages(requests[2]));
  assert.equal(events.filter((event) =>
    event.kind === "tool_use" && event.name === "Evidence mapper split").length, 1);
  assert.equal(events.some((event) =>
    event.kind === "prompt_budget" && event.retryReason === "provider_context_error"), true);
});

test("mapper semantic child context repack succeeds without a second split", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let childContextFailed = false;
  const source = Array.from(
    { length: 8 },
    (_, index) => `lineage success ${index + 1} ${"x".repeat(40)}`,
  ).join("\n");
  const runtime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    if (meta.startLine === 1 && meta.endLine === 8) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          exactSourceRanges: [{ startLine: 1, endLine: 9 }],
        }],
        noEvidence: [],
      };
    }
    if (!childContextFailed && meta.startLine === 1 && meta.endLine === 4) {
      childContextFailed = true;
      throw contextLengthError();
    }
    return { noEvidence: [{ chunkId: meta.id, reason: "none" }] };
  }, events, requests);

  let result: unknown;
  await assert.doesNotReject(async () => {
    result = await prepareSourceEvidence(source, "demo", {
      ...evidencePolicy(10_000),
      outputBudgetTokens: 1_000,
      mapperRetries: 1,
    }, runtime);
  });

  assert.deepEqual(result, []);
  assert.deepEqual(requests.map((request) => {
    const meta = mapperMeta(request);
    return `${meta.startLine}-${meta.endLine}`;
  }), ["1-8", "1-8", "1-4", "1-3", "4-6", "7-8"]);
  assert.equal(events.filter((event) =>
    event.kind === "tool_use" && event.name === "Evidence mapper split").length, 1);
  assert.equal(events.filter((event) =>
    event.kind === "prompt_budget" && event.retryReason === "provider_context_error").length, 1);
  assert.equal(events.filter((event) =>
    event.kind === "tool_use" && event.name === "Evidence context repack").length, 1);
  const overlappingRepacked = requests.slice(3).map(mapperMeta)
    .filter((meta) => meta.startLine <= 4 && meta.endLine >= 1);
  assert.ok(overlappingRepacked.length > 0);
  assert.ok(overlappingRepacked.every((meta) => meta.endLine - meta.startLine + 1 < 4));
});

test("mapper structural exhaustion splits the failed source chunk into smaller evidence-map requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const source = Array.from({ length: 80 }, (_, index) => `split mapper line ${index + 1}`).join("\n");
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    const meta = mapperMeta(messages);
    if (meta.startLine === 1 && meta.endLine === 80) {
      return {
        packets: [{
          ...validMapperPacket(messages),
          exactSourceRanges: [{ startLine: 1, endLine: 81 }],
        }],
        noEvidence: [],
      };
    }
    return {
      packets: [{
        ...validMapperPacket(messages),
        entityKey: `split-mapper-${meta.startLine}`,
        exactSourceRanges: [{ startLine: 1, endLine: meta.endLine - meta.startLine + 1 }],
      }],
      noEvidence: [],
    };
  }, events, requests);

  const result = await prepareSourceEvidence(source, "demo", {
    ...evidencePolicy(10_000),
    outputBudgetTokens: 1_000,
    mapperRetries: 1,
  }, runtime);
  const mapperRequests = requests.filter((request) => !isReducerRequest(request));

  assert.deepEqual(
    mapperRequests.map((request) => {
      const meta = mapperMeta(request);
      return `${meta.startLine}-${meta.endLine}`;
    }),
    ["1-80", "1-80", "1-40", "41-80"],
  );
  assert.ok(estimatePreparedMessages(mapperRequests[2]) < estimatePreparedMessages(mapperRequests[0]));
  assert.ok(estimatePreparedMessages(mapperRequests[3]) < estimatePreparedMessages(mapperRequests[0]));
  assert.equal(result.flatMap((entity) => entity.exactSource).map((range) => range.text).join("\n"), source);
  const splitEvent = events.find((event) =>
    event.kind === "tool_use" && event.name === "Evidence mapper split");
  assert.deepEqual(splitEvent?.kind === "tool_use" ? splitEvent.input : undefined, {
    chunkId: mapperMeta(mapperRequests[0]).id,
    startLine: 1,
    endLine: 80,
    replacementChunks: 2,
    reason: "chunk_local_validation",
    splitDepth: 0,
  });
  assertClosedToolLifecycles(events);
});

test("mapper protocol defects exhaust bounded repair without child requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const runtime = mockRuntime(() => ({}), events, requests);

  await assert.rejects(
    prepareSourceEvidence(
      "protocol line 1\nprotocol line 2\nprotocol line 3\nprotocol line 4",
      "demo",
      { ...evidencePolicy(), mapperRetries: 2 },
      runtime,
    ),
    EvidenceCoverageError,
  );

  assert.equal(requests.length, 3);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "Evidence mapper split"), false);
});

test("mapper malformed framed JSON exhausts repair without child requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
      requests.push(messages);
      return {
        id: `malformed-frame-${requests.length}`,
        object: "chat.completion",
        created: 0,
        model: "mock",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "<<<JSON>>>\n{not-json}\n<<<END>>>", refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    } } },
  } as unknown as LlmClient;
  const runtime: EvidenceRuntime = {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    configuredEntityTypes: ["tool"],
    onEvent: (event) => events.push(event),
  };

  await assert.rejects(
    prepareSourceEvidence(
      "frame line 1\nframe line 2\nframe line 3\nframe line 4",
      "demo",
      { ...evidencePolicy(), mapperRetries: 1 },
      runtime,
    ),
    EvidenceCoverageError,
  );

  assert.equal(requests.length, 2);
  assert.equal(events.some((event) =>
    event.kind === "structural_error" && event.errorType === "frame_parse"), true);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "Evidence mapper split"), false);
});

test("mapper non-local schema controls never schedule child requests", async () => {
  const cases: Array<{
    name: string;
    output: (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => unknown;
  }> = [
    { name: "both arrays empty", output: () => ({ packets: [], noEvidence: [] }) },
    { name: "invalid collection type", output: () => ({ packets: "invalid", noEvidence: [] }) },
    { name: "malformed packet", output: () => ({ packets: [42], noEvidence: [] }) },
    { name: "malformed noEvidence", output: () => ({ packets: [], noEvidence: [42] }) },
    {
      name: "noEvidence missing reason",
      output: (messages) => ({ noEvidence: [{ chunkId: mapperMeta(messages).id }] }),
    },
    {
      name: "invalid entity key",
      output: (messages) => ({
        packets: [{ ...validMapperPacket(messages), entityKey: "Invalid Entity" }],
        noEvidence: [],
      }),
    },
    {
      name: "foreign packet",
      output: (messages) => ({
        packets: [{ ...validMapperPacket(messages), chunkId: "foreign-chunk" }],
        noEvidence: [],
      }),
    },
    {
      name: "mixed coverage",
      output: (messages) => ({
        packets: [validMapperPacket(messages)],
        noEvidence: [{ chunkId: mapperMeta(messages).id, reason: "none" }],
      }),
    },
  ];

  for (const fixture of cases) {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    const events: RunEvent[] = [];
    const runtime = mockRuntime(fixture.output, events, requests);
    await assert.rejects(
      prepareSourceEvidence(
        "control line 1\ncontrol line 2\ncontrol line 3\ncontrol line 4",
        "demo",
        { ...evidencePolicy(), mapperRetries: 1 },
        runtime,
      ),
      EvidenceCoverageError,
      fixture.name,
    );
    assert.equal(requests.length, 2, fixture.name);
    assert.equal(
      events.some((event) => event.kind === "tool_use" && event.name === "Evidence mapper split"),
      false,
      fixture.name,
    );
  }
});

test("mapper split children cannot split again after structured exhaustion", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const source = Array.from({ length: 8 }, (_, index) => `bounded split ${index + 1}`).join("\n");
  const runtime = mockRuntime((messages) => {
    const mapped = validMapperPacket(messages);
    const meta = mapperMeta(messages);
    return {
      packets: [{
        ...mapped,
        exactSourceRanges: [{ startLine: 1, endLine: meta.endLine - meta.startLine + 2 }],
      }],
      noEvidence: [],
    };
  }, events, requests);

  await assert.rejects(
    prepareSourceEvidence(source, "demo", { ...evidencePolicy(), mapperRetries: 1 }, runtime),
    EvidenceCoverageError,
  );

  assert.deepEqual(requests.map((request) => {
    const meta = mapperMeta(request);
    return `${meta.startLine}-${meta.endLine}`;
  }), ["1-8", "1-8", "1-4", "1-4"]);
  assert.equal(events.filter((event) => event.kind === "tool_use" && event.name === "Evidence mapper split").length, 1);
});

test("mapper output-limit exhaustion schedules at most two bounded children", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
      const meta = mapperMeta(messages);
      const parent = meta.startLine === 1 && meta.endLine === 4;
      const maxTokens = params.max_completion_tokens as number;
      requests.push(messages);
      const content = parent
        ? ""
        : JSON.stringify({ noEvidence: [{ chunkId: meta.id, reason: "none" }] });
      const completionTokens = parent ? maxTokens : 1;
      return {
        id: `bounded-output-${requests.length}`,
        object: "chat.completion",
        created: 0,
        model: "mock",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 1, completion_tokens: completionTokens, total_tokens: completionTokens + 1 },
      };
    } } },
  } as unknown as LlmClient;
  const runtime: EvidenceRuntime = {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    configuredEntityTypes: ["tool"],
    opts: { outputRetryBudgetTokens: 2_048 },
    onEvent: (event) => events.push(event),
  };

  const result = await prepareSourceEvidence(
    "output line 1\noutput line 2\noutput line 3\noutput line 4",
    "demo",
    { ...evidencePolicy(), mapperRetries: 1 },
    runtime,
  );

  assert.deepEqual(result, []);
  assert.deepEqual(requests.map((request) => {
    const meta = mapperMeta(request);
    return `${meta.startLine}-${meta.endLine}`;
  }), ["1-4", "1-4", "1-2", "3-4"]);
  const splitEvents = events.filter((event) => event.kind === "tool_use" && event.name === "Evidence mapper split");
  assert.equal(splitEvents.length, 1);
  assert.deepEqual(splitEvents[0]?.kind === "tool_use" ? splitEvents[0].input : undefined, {
    chunkId: mapperMeta(requests[0]).id,
    startLine: 1,
    endLine: 4,
    replacementChunks: 2,
    reason: "output_limit",
    splitDepth: 0,
  });
});

test("reducer context recovery repartitions whole units into smaller requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let reducerAttempts = 0;
  const policy = { ...realisticReducerPolicy(), outputBudgetTokens: 7_000 };
  const runtime = mockRuntime((messages) => {
    if (!isReducerRequest(messages)) return { packets: repeatedMapperPackets(messages, 24), noEvidence: [] };
    reducerAttempts += 1;
    if (reducerAttempts === 1) throw contextLengthError();
    return validReduced(reducerInput(messages));
  }, events, requests);
  const source = Array.from({ length: 500 }, (_, index) => `reducer recovery ${index + 1}`).join("\n");
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  const reducerRequests = requests.filter(isReducerRequest);
  assert.ok(reducerRequests.length > 1);
  assert.ok(estimatePreparedMessages(reducerRequests[1]) < estimatePreparedMessages(reducerRequests[0]));
  assert.ok(reducerInput(reducerRequests[1]).length < reducerInput(reducerRequests[0]).length);
  assert.ok(result[0].packetIds.length > 1);
  const reducerEvents = events.filter((event) => event.kind === "prompt_budget" && event.callSite === "ingest.evidence-reduce");
  assert.equal(reducerEvents.length, reducerRequests.length);
  assert.ok(reducerEvents.filter((event) => event.retryReason === "provider_context_error").length <= 3);
  assert.ok(reducerEvents.some((event) => event.retryReason === "provider_context_error"));
});

test("reducer execution is sequential with one request in flight", async () => {
  let active = 0;
  let maxActive = 0;
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime((messages) => isReducerRequest(messages)
      ? validReduced(reducerInput(messages))
      : { packets: repeatedMapperPackets(messages, 24), noEvidence: [] }, events, requests, [], {
    start: () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
    },
    end: () => { active -= 1; },
  });
  const source = Array.from({ length: 500 }, (_, index) => `sequential recovery ${index + 1}`).join("\n");
  await prepareSourceEvidence(source, "demo", { ...realisticReducerPolicy(), outputBudgetTokens: 7_000 }, runtime);
  assert.equal(maxActive, 1);
});

test("mapper context recovery strictly shrinks the exact later failed payload", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let failed = false;
  let failedHash = "";
  const source = Array.from({ length: 500 }, (_, index) => `later mapper ${index + 1} ${"x".repeat(24)}`).join("\n");
  const runtime = mockRuntime((messages) => {
    if (isReducerRequest(messages)) return validReduced(reducerInput(messages));
    const meta = mapperMeta(messages);
    if (!failed && meta.ordinal === 1) {
      failed = true;
      failedHash = requestHash(messages);
      throw contextLengthError();
    }
    return {
      packets: [{
        ...validMapperPacket(messages),
        entityKey: `later-mapper-${meta.ordinal}`,
        exactSourceRanges: [{ startLine: 1, endLine: meta.endLine - meta.startLine + 1 }],
      }],
      noEvidence: [],
    };
  }, events, requests);
  const result = await prepareSourceEvidence(source, "demo", { ...evidencePolicy(7000), outputBudgetTokens: 1000 }, runtime);
  const mapperRequests = requests.filter((request) => !isReducerRequest(request));
  const failedIndex = mapperRequests.findIndex((request) => requestHash(request) === failedHash);
  assert.ok(failedIndex > 0);
  assert.equal(mapperRequests.filter((request) => requestHash(request) === failedHash).length, 1);
  const retry = mapperRequests.slice(failedIndex + 1).find((request) => estimatePreparedMessages(request) < estimatePreparedMessages(mapperRequests[failedIndex]));
  assert.ok(retry);
  assert.equal(result.flatMap((entity) => entity.exactSource).map((range) => range.text).join("\n"), source);
  assert.ok(events.some((event) => event.kind === "prompt_budget" && event.retryReason === "provider_context_error"));
});

test("reducer context recovery strictly shrinks the exact later tail batch", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  let reducerAttempts = 0;
  let failedHash = "";
  const policy = { ...realisticReducerPolicy(), outputBudgetTokens: 7_000 };
  const runtime = mockRuntime((messages) => {
    if (!isReducerRequest(messages)) return { packets: repeatedMapperPackets(messages, 24), noEvidence: [] };
    reducerAttempts += 1;
    if (reducerAttempts === 2) {
      failedHash = requestHash(messages);
      throw contextLengthError();
    }
    return validReduced(reducerInput(messages));
  }, events, requests);
  const source = Array.from({ length: 600 }, (_, index) => `later reducer ${index + 1}`).join("\n");
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  const reducerRequests = requests.filter(isReducerRequest);
  const failedIndex = reducerRequests.findIndex((request) => requestHash(request) === failedHash);
  assert.ok(failedIndex > 0);
  assert.equal(reducerRequests.filter((request) => requestHash(request) === failedHash).length, 1);
  const failedUnits = reducerInput(reducerRequests[failedIndex]);
  const retry = reducerRequests.slice(failedIndex + 1).find((request) => reducerInput(request).length < failedUnits.length);
  assert.ok(retry);
  assert.equal(new Set(result[0].packetIds).size, result[0].packetIds.length);
  assert.ok(events.some((event) => event.kind === "prompt_budget" && event.retryReason === "provider_context_error"));
});

test("input-only evidence policy omits max_completion_tokens and preserves runtime ownership", async () => {
  const withoutRuntimeMax: Array<Record<string, unknown>> = [];
  const first = mockRuntime((messages) => ({ packets: [validMapperPacket(messages)], noEvidence: [] }), [], [], withoutRuntimeMax);
  await prepareSourceEvidence("input-only", "demo", { ...evidencePolicy(), outputBudgetTokens: undefined }, first);
  assert.ok(withoutRuntimeMax.every((params) => !("max_completion_tokens" in params)));

  const withRuntimeMax: Array<Record<string, unknown>> = [];
  const second = mockRuntime((messages) => ({ packets: [validMapperPacket(messages)], noEvidence: [] }), [], [], withRuntimeMax);
  second.opts = { maxTokens: 512 };
  await prepareSourceEvidence("input-only", "demo", { ...evidencePolicy(), outputBudgetTokens: undefined }, second);
  assert.ok(withRuntimeMax.every((params) => params.max_completion_tokens === 512));
});

test("pre-verified and verified evidence aggregates use distinct public schemas", async () => {
  const plain = packet("plain", "chunk");
  const verified = validateEvidenceMap({ chunk: { id: "chunk", startLine: 1, endLine: 1 }, packets: [plain], noEvidence: [] }, "source")[0];
  const preVerified = dedupeEvidencePackets([plain]);
  assert.equal("exactSource" in preVerified, false);
  assert.equal(PreVerifiedEntityEvidenceSchema.safeParse(preVerified).success, true);
  assert.equal(EntityEvidenceSchema.safeParse(preVerified).success, false);
  const verifiedAggregate = dedupeVerifiedEvidencePackets([verified]);
  assert.equal(EntityEvidenceSchema.safeParse(verifiedAggregate).success, true);
  assert.notDeepEqual(preVerified, verifiedAggregate);
});

test("mixed verified and pre-verified packets fail before aggregation", () => {
  const verified = validateEvidenceMap({
    chunk: { id: "chunk", startLine: 1, endLine: 1 },
    packets: [packet("verified", "chunk")],
    noEvidence: [],
  }, "source")[0];
  assert.throws(
    () => validateReducedEvidence([verified, packet("plain", "chunk")], {
      entityKey: "postgresql",
      entityType: "tool",
      packetIds: ["verified", "plain"],
      facts: ["fact"],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }],
      exactSource: [{ startLine: 1, endLine: 1, text: "source" }],
      links: [],
    }),
    (error: unknown) => error instanceof EvidenceReducerError && /mixed verification state/i.test(error.message),
  );
});

const bootstrapCandidate = (key: string, units: number) => ({
  entityKey: key,
  packetIds: [`${key}-p`],
  facts: Array.from({ length: units }, (_, i) => `fact ${i} about ${key} `.repeat(20)),
  exactSource: Array.from({ length: units }, (_, i) => ({
    startLine: i * 10 + 1,
    endLine: i * 10 + 5,
    text: `source ${i} for ${key} `.repeat(20),
  })),
});

test("a bootstrap payload that fits is returned as a single group", () => {
  const payload = { candidates: [], domainThemes: [], languageEvidence: [] };
  const split = splitBootstrapPayload(payload, 1_000_000);
  assert.equal(split.groups.length, 1);
  assert.equal(split.subdivided, 0);
  assert.equal(split.minimumGroupTokens, estimateBootstrapPayloadForTest(payload));
});

test("an oversized bootstrap payload splits across candidates without dropping any", () => {
  const payload = {
    candidates: [bootstrapCandidate("a", 1), bootstrapCandidate("b", 1), bootstrapCandidate("c", 1)],
    domainThemes: ["theme"],
    languageEvidence: ["evidence"],
  };
  const budget = Math.ceil(estimateBootstrapPayloadForTest(payload) / 2);
  const split = splitBootstrapPayload(payload, budget);
  assert.ok(split.groups.length >= 2);
  assert.equal(
    split.groups.flatMap((group) => group.candidates.map((candidate) => candidate.entityKey)).join(","),
    "a,b,c",
    "no candidate may be dropped and the order must be preserved",
  );
  for (const group of split.groups) {
    assert.deepEqual(group.domainThemes, payload.domainThemes);
    assert.deepEqual(group.languageEvidence, payload.languageEvidence);
  }
});

test("a bootstrap candidate aggregating many chunks is subdivided rather than left oversized", () => {
  // One entity mentioned in 12 chunks: exactly the shape reduceUntilBounded produces.
  const wide = bootstrapCandidate("wide", 12);
  const payload = { candidates: [wide], domainThemes: ["t"], languageEvidence: ["e"] };
  const budget = Math.ceil(estimateBootstrapPayloadForTest(payload) / 4);
  const split = splitBootstrapPayload(payload, budget);

  assert.ok(split.groups.length >= 2, "a single oversized candidate must be subdivided");
  assert.ok(split.subdivided > 0);
  for (const group of split.groups) {
    assert.ok(
      estimateBootstrapPayloadForTest(group) <= budget,
      `group of ${group.candidates.length} needs ${estimateBootstrapPayloadForTest(group)} > ${budget}`,
    );
  }
  assert.ok(split.minimumGroupTokens <= budget);
  const facts = split.groups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.facts));
  assert.equal(new Set(facts).size, wide.facts.length, "every fact must survive exactly once");
  assert.equal(facts.length, wide.facts.length);
  const ranges = split.groups.flatMap((group) => group.candidates.flatMap(
    (candidate) => candidate.exactSource.map((range) => range.text),
  ));
  assert.equal(new Set(ranges).size, wide.exactSource.length, "every range must survive exactly once");
  assert.equal(ranges.length, wide.exactSource.length);
  assert.ok(split.groups.every((group) => group.candidates.every((candidate) => candidate.entityKey === "wide")));
});

test("an oversized evidence unit is isolated, kept whole, and reported upward", () => {
  // The divisible units around it must still be separated out, and the unit
  // that cannot be divided is reported rather than truncated.
  const mixed = {
    entityKey: "mixed",
    packetIds: ["mixed-p"],
    facts: ["small fact one", "huge ".repeat(4_000), "small fact three"],
    exactSource: [
      { startLine: 1, endLine: 2, text: "small source one" },
      { startLine: 11, endLine: 12, text: "huge source ".repeat(4_000) },
      { startLine: 21, endLine: 22, text: "small source three" },
    ],
  };
  const payload = { candidates: [mixed], domainThemes: [], languageEvidence: [] };
  const budget = Math.ceil(estimateBootstrapPayloadForTest(payload) / 8);
  const split = splitBootstrapPayload(payload, budget);

  assert.ok(split.subdivided > 0);
  assert.equal(split.groups.length, 3, "the two small units must not share a group with the oversized one");
  const oversized = split.groups.filter((group) => estimateBootstrapPayloadForTest(group) > budget);
  assert.equal(oversized.length, 1, "only the indivisible unit may exceed the budget");
  assert.deepEqual(oversized[0].candidates.map((candidate) => candidate.facts), [[mixed.facts[1]]]);
  assert.ok(split.minimumGroupTokens > budget, "the caller must learn the budget it needs");
  assert.equal(split.minimumGroupTokens, estimateBootstrapPayloadForTest(oversized[0]));
  assert.deepEqual(
    split.groups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.facts)),
    mixed.facts,
    "no fact may be truncated, dropped or reordered",
  );
  assert.deepEqual(
    split.groups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.exactSource)),
    mixed.exactSource,
    "no source range may be truncated, dropped or reordered",
  );
});

test("a single indivisible evidence unit stays whole and reports the budget it needs", () => {
  const atomic = {
    entityKey: "atomic",
    packetIds: ["atomic-p"],
    facts: ["fact ".repeat(2_000)],
    exactSource: [],
  };
  const payload = { candidates: [atomic], domainThemes: [], languageEvidence: [] };
  const budget = 16;
  const split = splitBootstrapPayload(payload, budget);

  assert.equal(split.groups.length, 1);
  assert.deepEqual(split.groups[0].candidates, [atomic]);
  assert.ok(split.minimumGroupTokens > budget);
  assert.equal(split.minimumGroupTokens, estimateBootstrapPayloadForTest(split.groups[0]));
});

test("the chunk budget bounds mapper chunks and is converted out of calibrated tokens", () => {
  const source = Array.from({ length: 240 }, (_, index) => `chunk budget line ${index + 1}`).join("\n");
  const unbound = chunkSourceForEvidence(source, "demo", evidencePolicy(20_000), {}, []);
  const bound = chunkSourceForEvidence(
    source,
    "demo",
    { ...evidencePolicy(20_000), chunkBudgetTokens: 200 },
    {},
    [],
  );
  assert.ok(bound.length > unbound.length, "a chunk budget below the request budget must bind");
  for (const chunk of bound) {
    assert.ok(
      estimateText(chunk.markdown) <= 200,
      `chunk ${chunk.id} needs ${estimateText(chunk.markdown)} raw tokens for a budget of 200`,
    );
  }
  // The budget is calibrated; chunkMarkdownSource measures raw estimator tokens,
  // so halving the calibration doubles the raw room a chunk may use.
  const calibrated = chunkSourceForEvidence(
    source,
    "demo",
    { ...evidencePolicy(20_000), chunkBudgetTokens: 200, calibration: 0.5 },
    {},
    [],
  );
  assert.ok(calibrated.length < bound.length, "a calibration below 1 must widen the raw chunk budget");
  for (const chunk of calibrated) assert.ok(estimateText(chunk.markdown) <= 400);
});

test("a non-positive token calibration is rejected instead of hanging the chunk search", () => {
  assert.throws(
    () => chunkSourceForEvidence("line", "demo", { ...evidencePolicy(5_000), calibration: 0 }, {}, []),
    (error: unknown) => error instanceof EvidenceCoverageError && /calibration/i.test((error as Error).message),
  );
});
