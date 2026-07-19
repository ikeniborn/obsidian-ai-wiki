import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { assertCompleteSourceCoverage } from "../src/markdown-chunks";
import { estimatePreparedMessages } from "../src/prompt-budget";
import type {
  LlmClient,
  RunEvent,
} from "../src/types";
import type {
  EvidencePolicy,
  EvidenceRuntime,
} from "../src/phases/ingest-evidence";
import type { EvidencePacket } from "../src/phases/ingest-evidence";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const {
  buildEvidenceCoverage,
  dedupeEvidencePackets,
  dedupeVerifiedEvidencePackets,
  chunkSourceForEvidence,
  prepareBootstrapEvidence,
  prepareSourceEvidence,
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
            max_tokens?: unknown;
          };
          const messages = request.messages;
          requests.push(messages);
          requestParams.push(params as Record<string, unknown>);
          probe?.start();
          try {
            await new Promise((resolve) => setTimeout(resolve, probe === undefined ? 0 : 1));
            const outputValue = respond(messages);
            const output = JSON.stringify(outputValue);
            const maxTokens = request.max_tokens;
            if (typeof maxTokens === "number") {
              assert.ok(
                mockOutputBytes(outputValue) <= maxTokens,
                `mock output ${mockOutputBytes(outputValue)} exceeded request max_tokens ${maxTokens}`,
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

function evidencePolicy(inputBudgetTokens = 4500): EvidencePolicy {
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

function realisticReducerPolicy(): EvidencePolicy {
  return {
    ...evidencePolicy(12_000),
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

test("mapper repair exhaustion performs real requests and emits one safe budget event per request", async () => {
  const events: RunEvent[] = [];
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const runtime = mockRuntime(() => ({
    packets: [{ ...packet("bad", "foreign"), exactSourceRanges: [{ startLine: 1, endLine: 1 }] }],
    noEvidence: [],
  }), events, requests);
  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", evidencePolicy(), runtime),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceCoverageError);
      assert.match(error.message, /structural validation failed after 2 attempt/i);
      return true;
    },
  );
  assert.equal(requests.length, 2, "initial mapper request plus one structured repair");
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
  await assert.rejects(
    prepareSourceEvidence(source, "demo", { ...evidencePolicy(), outputBudgetTokens: 2_000 }, runtime),
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
  await assert.rejects(
    prepareSourceEvidence("one source line", "demo", { ...evidencePolicy(), outputBudgetTokens: 6_000 }, runtime),
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
  const source = Array.from({ length: 500 }, (_, index) => `${sentinel}-${index + 1}`).join("\n");
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

test("bootstrap rejects evidence that reconstructs every line of an oversized source", async () => {
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
  const policy = {
    ...evidencePolicy(6000),
    outputBudgetTokens: 256,
    bootstrapPayloadBudgetTokens: 6000,
  };
  const expectedChunks = chunkSourceForEvidence(source, "bootstrap", policy, runtime.opts ?? {}, []);
  assert.ok(expectedChunks.length > 1);
  assertCompleteSourceCoverage(source, expectedChunks);
  await assert.rejects(
    prepareBootstrapEvidence(source, "bootstrap", policy, runtime),
    (error: unknown) => error instanceof EvidenceCoverageError
      && /Bootstrap evidence payload requires \d+ tokens but budget is 6000/.test(error.message),
  );
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
  assert.ok(params.every((request) => request.max_tokens === policy.outputBudgetTokens));
});

test("evidence mapper and reducer use direct non-stream requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const params: Array<Record<string, unknown>> = [];
  const runtime = mockRuntime((messages) => isReducerRequest(messages)
    ? validReduced(reducerInput(messages))
    : { packets: repeatedMapperPackets(messages, 24), noEvidence: [] }, [], requests, params);
  const source = Array.from({ length: 500 }, (_, index) => `non-stream evidence ${index + 1}`).join("\n");

  await prepareSourceEvidence(
    source,
    "demo",
    { ...realisticReducerPolicy(), outputBudgetTokens: 7_000 },
    runtime,
  );

  assert.ok(params.some((request) => isReducerRequest(
    request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
  )));
  assert.ok(params.some((request) => !isReducerRequest(
    request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
  )));
  assert.ok(params.every((request) => request.stream === false));
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
  const source = Array.from({ length: 500 }, (_, index) => `${hostileSource} ${index + 1}`).join("\n");

  await prepareSourceEvidence(
    source,
    "demo",
    { ...realisticReducerPolicy(), outputBudgetTokens: 7_000 },
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
    && event.message === "Structured output validation event");
  assert.ok(structuralEvent?.kind === "structural_error");
  assert.equal(structuralEvent.retryAttempt, 0);
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

test("packet IDs are chunk-local, namespaced deterministically, and duplicate locals fail", async () => {
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

  const duplicateRuntime = mockRuntime((messages) => {
    const meta = mapperMeta(messages);
    return {
      packets: [
        { ...validMapperPacket(messages), id: "p1" },
        { ...validMapperPacket(messages), id: "p1" },
      ],
      noEvidence: [],
    };
  }, [], []);
  duplicateRuntime.configuredEntityTypes = ["tool", "service"];
  await assert.rejects(
    prepareSourceEvidence("duplicate local id", "demo", policy, duplicateRuntime),
    (error: unknown) => error instanceof EvidenceCoverageError && /duplicate packet id/i.test(error.message),
  );
});

test("entity grouping inherits missing types, combines identical types, and rejects conflicts before reduction", async () => {
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
    const result = await prepareSourceEvidence(source, "demo", { ...evidencePolicy(8000), outputBudgetTokens: 512 }, runtime);
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
    prepareSourceEvidence(source, "demo", { ...evidencePolicy(8000), outputBudgetTokens: 512 }, runtime),
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
        packets: [{ ...validMapperPacket(messages), chunkId: "foreign", sourceAnchor: sentinel, facts: [sentinel.repeat(500)] }],
        noEvidence: [],
      };
    }
    return { packets: [validMapperPacket(messages)], noEvidence: [] };
  }, [], requests, params);
  const result = await prepareSourceEvidence("one source line", "demo", { ...evidencePolicy(), outputBudgetTokens: 20_000 }, runtime);
  assert.equal(result.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(allMessageText(requests[1]).includes(sentinel), false);
  assert.ok(estimatePreparedMessages(requests[1]) < estimatePreparedMessages(requests[0]) + 512);
  assert.equal(params.length, requests.length);
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
  const result = await prepareSourceEvidence(source, "demo", { ...evidencePolicy(5500), outputBudgetTokens: 1000 }, runtime);
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

test("input-only evidence policy omits max_tokens and preserves runtime ownership", async () => {
  const withoutRuntimeMax: Array<Record<string, unknown>> = [];
  const first = mockRuntime((messages) => ({ packets: [validMapperPacket(messages)], noEvidence: [] }), [], [], withoutRuntimeMax);
  await prepareSourceEvidence("input-only", "demo", { ...evidencePolicy(), outputBudgetTokens: undefined }, first);
  assert.ok(withoutRuntimeMax.every((params) => !("max_tokens" in params)));

  const withRuntimeMax: Array<Record<string, unknown>> = [];
  const second = mockRuntime((messages) => ({ packets: [validMapperPacket(messages)], noEvidence: [] }), [], [], withRuntimeMax);
  second.opts = { maxTokens: 512 };
  await prepareSourceEvidence("input-only", "demo", { ...evidencePolicy(), outputBudgetTokens: undefined }, second);
  assert.ok(withRuntimeMax.every((params) => params.max_tokens === 512));
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
