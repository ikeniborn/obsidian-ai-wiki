import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { hashSource } from "../src/incremental-sources";
import { estimatePreparedMessages } from "../src/prompt-budget";
import type { LlmClient, RunEvent } from "../src/types";
import type {
  EntityEvidence,
  EvidencePolicy,
  EvidenceRuntime,
} from "../src/phases/ingest-evidence";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const {
  prepareBootstrapEvidence,
  prepareBootstrapEvidenceBundle,
} = await import("../src/phases/ingest-evidence");
const {
  applyEvidenceTypeAssignments,
  enrichEvidenceTypes,
} = await import("../src/phases/evidence-type-enrichment");

function completion(value: unknown, finishReason: "stop" | "length" = "stop"): OpenAI.Chat.ChatCompletion {
  return {
    id: "type-enrichment",
    object: "chat.completion",
    created: 0,
    model: "mock",
    choices: [{
      index: 0,
      finish_reason: finishReason,
      message: { role: "assistant", content: JSON.stringify(value), refusal: null },
      logprobs: null,
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function runtime(
  respond: (messages: OpenAI.Chat.ChatCompletionMessageParam[], attempt: number) => unknown,
  requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [],
  events: RunEvent[] = [],
): EvidenceRuntime {
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          requests.push(params.messages);
          attempt += 1;
          const value = respond(params.messages, attempt);
          if (value instanceof Error) throw value;
          if (value && typeof value === "object" && "finishReason" in value) {
            const result = value as { finishReason: "stop" | "length"; body: unknown };
            return completion(result.body, result.finishReason);
          }
          return completion(value);
        },
      },
    },
  } as unknown as LlmClient;
  return {
    llm,
    model: "mock",
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    opts: {},
  };
}

function policy(inputBudgetTokens = 4_000, mapperRetries = 1): EvidencePolicy {
  return {
    inputBudgetTokens,
    outputBudgetTokens: 512,
    compressionProfile: "balanced",
    overlapLines: 0,
    mapperRetries,
    reducerRetries: 1,
    maxReductionDepth: 6,
  };
}

function messageText(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  return messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");
}

function classifierUnits(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Array<{
  entityKey: string;
  facts: string[];
}> {
  const text = messageText(messages);
  const marker = "EVIDENCE_TYPE_UNITS ";
  const start = text.lastIndexOf(marker);
  assert.notEqual(start, -1, "classifier request marker");
  const encoded = text.slice(start + marker.length).split("\n", 1)[0];
  return JSON.parse(encoded) as Array<{ entityKey: string; facts: string[] }>;
}

function evidence(entityKey: string, fact = `fact for ${entityKey}`): EntityEvidence {
  return {
    entityKey,
    packetIds: [`${entityKey}:p1`],
    facts: [fact],
    exactSourceRanges: [{ startLine: 1, endLine: 1 }],
    exactSource: [{ startLine: 1, endLine: 1, text: `EXACT_SOURCE_${entityKey}` }],
    links: [`https://example.test/${entityKey}`],
  };
}

test("bootstrap bundle retains full evidence and source provenance while the old wrapper stays compatible", async () => {
  const source = "PostgreSQL is a database.\nSee https://postgresql.org";
  const sourcePath = "notes/postgresql.md";
  const mapRuntime = runtime((messages) => {
    const match = /CHUNK_ID (\S+)/u.exec(messageText(messages));
    assert.ok(match);
    return {
      packets: [{
        id: "p1",
        chunkId: match[1],
        entityKey: "postgresql",
        facts: ["PostgreSQL is a database"],
        exactSourceRanges: [{ startLine: 1, endLine: 2 }],
        links: ["https://postgresql.org"],
        sourceAnchor: `${sourcePath}:1`,
      }],
      noEvidence: [],
    };
  });

  const bundle = await prepareBootstrapEvidenceBundle(
    source,
    "databases",
    sourcePath,
    policy(8_000),
    mapRuntime,
  );
  const retained = structuredClone(bundle.evidence);

  assert.deepEqual(bundle, {
    bootstrap: {
      candidates: [{
        entityKey: "postgresql",
        packetIds: bundle.evidence[0].packetIds,
        facts: ["PostgreSQL is a database"],
        exactSource: [{ startLine: 1, endLine: 2, text: source }],
      }],
      domainThemes: ["PostgreSQL is a database"],
      languageEvidence: [source],
    },
    evidence: retained,
    domainId: "databases",
    sourcePath,
    sourceBodyHash: hashSource(source),
  });

  bundle.bootstrap.candidates[0].facts[0] = "bounded view changed";
  bundle.bootstrap.candidates[0].exactSource[0].text = "bounded text changed";
  assert.deepEqual(bundle.evidence, retained, "bounded taxonomy view must not alias full evidence");

  const wrapper = await prepareBootstrapEvidence(source, "databases", policy(8_000), mapRuntime);
  const secondBundle = await prepareBootstrapEvidenceBundle(source, "databases", "", policy(8_000), mapRuntime);
  assert.deepEqual(wrapper, secondBundle.bootstrap);
});

test("type assignments preserve input and change only entityType", () => {
  const input = [evidence("postgresql"), evidence("redis")];
  const original = structuredClone(input);
  const typed = applyEvidenceTypeAssignments(input, [
    { entityKey: "postgresql", entityType: "database" },
    { entityKey: "redis", entityType: "cache" },
  ], new Set(["database", "cache"]));

  assert.deepEqual(input, original);
  assert.deepEqual(typed, [
    { ...original[0], entityType: "database" },
    { ...original[1], entityType: "cache" },
  ]);
});

for (const fixture of [
  {
    name: "missing",
    assignments: [{ entityKey: "postgresql", entityType: "database" }],
  },
  {
    name: "duplicate",
    assignments: [
      { entityKey: "postgresql", entityType: "database" },
      { entityKey: "postgresql", entityType: "database" },
    ],
  },
  {
    name: "foreign",
    assignments: [
      { entityKey: "postgresql", entityType: "database" },
      { entityKey: "foreign", entityType: "cache" },
    ],
  },
  {
    name: "unknown type",
    assignments: [
      { entityKey: "postgresql", entityType: "database" },
      { entityKey: "redis", entityType: "invented" },
    ],
  },
]) {
  test(`type assignment validation rejects ${fixture.name} coverage`, () => {
    assert.throws(
      () => applyEvidenceTypeAssignments(
        [evidence("postgresql"), evidence("redis")],
        fixture.assignments,
        new Set(["database", "cache"]),
      ),
      /coverage mismatch|invalid evidence type assignment/i,
    );
  });
}

test("empty evidence performs no classifier requests", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const result = await enrichEvidenceTypes(
    [],
    new Set(["database"]),
    policy(),
    runtime(() => assert.fail("empty evidence must not call the model"), requests),
  );
  assert.deepEqual(result, []);
  assert.equal(requests.length, 0);
});

test("classifier budget-packs compact immutable units and covers every key exactly once", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const events: RunEvent[] = [];
  const input = Array.from({ length: 6 }, (_, index) => evidence(
    `entity-${index + 1}`,
    `bounded fact ${index + 1} ${"x".repeat(360)}`,
  ));
  // Rescaled from a byte-era budget of 3_900 for the token estimator
  // (task-3 prompt-budget-automation): 928 (3_900 / 4.2) still forces
  // multiple classifier batches.
  const inputPolicy = policy(928);
  const result = await enrichEvidenceTypes(
    input,
    new Set(["database", "cache"]),
    inputPolicy,
    runtime((messages) => ({
      assignments: classifierUnits(messages).map((unit, index) => ({
        entityKey: unit.entityKey,
        entityType: index % 2 === 0 ? "database" : "cache",
      })),
    }), requests, events),
  );

  assert.ok(requests.length > 1, "fixture must require multiple budget batches");
  assert.deepEqual(result.map((item) => item.entityKey), input.map((item) => item.entityKey));
  assert.ok(result.every((item) => item.entityType === "database" || item.entityType === "cache"));
  assert.deepEqual(result.map(({ entityType: _entityType, ...item }) => item), input);
  assert.deepEqual(requests.flatMap(classifierUnits), input.map(({ entityKey, facts }) => ({ entityKey, facts })));
  for (const request of requests) {
    assert.ok(estimatePreparedMessages(request) <= inputPolicy.inputBudgetTokens);
    const text = messageText(request);
    assert.equal(text.includes("EXACT_SOURCE_"), false);
    assert.equal(text.includes("https://example.test/"), false);
    assert.equal(text.includes("packetIds"), false);
    assert.equal(text.includes("exactSource"), false);
  }
  assert.ok(events.some((event) => event.kind === "llm_request_fingerprint"
    && event.callSite === "init.bootstrap-type-map"));
});

for (const fixture of [
  { name: "missing", mutate: (keys: string[]) => keys.slice(1).map((entityKey) => ({ entityKey, entityType: "database" })) },
  { name: "duplicate", mutate: (keys: string[]) => keys.map((entityKey) => ({ entityKey, entityType: "database" })).concat({ entityKey: keys[0], entityType: "database" }) },
  { name: "foreign", mutate: (keys: string[]) => keys.map((entityKey, index) => ({ entityKey: index === 0 ? "foreign" : entityKey, entityType: "database" })) },
  { name: "unknown", mutate: (keys: string[]) => keys.map((entityKey) => ({ entityKey, entityType: "invented" })) },
]) {
  test(`classifier schema failure for ${fixture.name} assignments retries but never repartitions`, async () => {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    await assert.rejects(
      enrichEvidenceTypes(
        [evidence("postgresql"), evidence("redis")],
        new Set(["database"]),
        policy(8_000, 1),
        runtime((messages) => ({
          assignments: fixture.mutate(classifierUnits(messages).map((unit) => unit.entityKey)),
        }), requests),
      ),
      /structural validation failed|coverage|assignment/i,
    );
    assert.equal(requests.length, 2, "one base request plus bounded structured retry");
    assert.deepEqual(classifierUnits(requests[0]), classifierUnits(requests[1]));
  });
}

for (const fixture of [
  {
    name: "foreign key",
    assignments: [
      { entityKey: "input too long", entityType: "database" },
      { entityKey: "redis", entityType: "database" },
    ],
  },
  {
    name: "unknown type",
    assignments: [
      { entityKey: "postgresql", entityType: "prompt too long" },
      { entityKey: "redis", entityType: "database" },
    ],
  },
]) {
  test(`model-controlled context wording in ${fixture.name} remains a schema failure`, async () => {
    const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
    await assert.rejects(
      enrichEvidenceTypes(
        [evidence("postgresql"), evidence("redis")],
        new Set(["database"]),
        policy(8_000, 0),
        runtime(() => ({ assignments: fixture.assignments }), requests),
      ),
      /structural validation failed|assignment/i,
    );
    assert.equal(requests.length, 1, "schema diagnostics must not trigger size repartition");
  });
}

test("provider context recovery repartitions complete units without recursive schema splitting", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const input = [evidence("postgresql"), evidence("redis"), evidence("sqlite"), evidence("valkey")];
  let first = true;
  const result = await enrichEvidenceTypes(
    input,
    new Set(["database"]),
    policy(12_000, 0),
    runtime((messages) => {
      if (first) {
        first = false;
        return Object.assign(new Error("input exceeds maximum context length"), {
          code: "context_length_exceeded",
        });
      }
      return {
        assignments: classifierUnits(messages).map(({ entityKey }) => ({ entityKey, entityType: "database" })),
      };
    }, requests),
  );

  assert.equal(requests.length, 3, "one failed batch and two deterministic child batches");
  assert.deepEqual(classifierUnits(requests[0]), input.map(({ entityKey, facts }) => ({ entityKey, facts })));
  assert.deepEqual(requests.slice(1).flatMap(classifierUnits), classifierUnits(requests[0]));
  assert.deepEqual(result, input.map((item) => ({ ...item, entityType: "database" })));
});

test("output-size recovery repartitions only after the structured retry bound", async () => {
  const requests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const input = [evidence("postgresql"), evidence("redis")];
  let first = true;
  const result = await enrichEvidenceTypes(
    input,
    new Set(["database"]),
    policy(12_000, 0),
    runtime((messages) => {
      const assignments = classifierUnits(messages).map(({ entityKey }) => ({ entityKey, entityType: "database" }));
      if (first) {
        first = false;
        return { finishReason: "length", body: { assignments } };
      }
      return { assignments };
    }, requests),
  );

  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).flatMap(classifierUnits), classifierUnits(requests[0]));
  assert.deepEqual(result, input.map((item) => ({ ...item, entityType: "database" })));
});
