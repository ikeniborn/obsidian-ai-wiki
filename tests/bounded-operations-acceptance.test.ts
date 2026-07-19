import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { contentHash } from "../src/content-hash";
import type { DomainEntry } from "../src/domain";
import type { EntityContextBundle } from "../src/ingest-context";
import type {
  EvidencePolicy,
  EvidenceRuntime,
} from "../src/phases/ingest-evidence";
import type { LintFinding } from "../src/phases/lint-batches";
import type { VisionRecognitionRecord } from "../src/phases/vision-recognition";
import type { SelectedChunk } from "../src/page-similarity";
import type {
  IngestOutcome,
  LlmClient,
  RunEvent,
  RunRequest,
} from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";
import type {
  ChunkIndexRecord,
  PageIndexRecord,
} from "../src/wiki-index-jsonl";
import { mockChatResponse } from "./openai-mock-response";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const {
  buildEntityContext,
} = await import("../src/ingest-context");
const {
  assertCompleteSourceCoverage,
} = await import("../src/markdown-chunks");
const {
  buildChunkInputs,
  DEFAULT_CHUNKING,
  PageSimilarityService,
} = await import("../src/page-similarity");
const {
  estimatePreparedMessages,
  packContextUnits,
  runWithContextRepack,
  shrinkInputBudget,
} = await import("../src/prompt-budget");
const {
  applyPagePatch,
  inspectPatchablePage,
} = await import("../src/section-patches");
const {
  prepareSourceEvidence,
  chunkSourceForEvidence,
} = await import("../src/phases/ingest-evidence");
const {
  synthesizeEntityBatch,
} = await import("../src/phases/ingest-synthesis");
const {
  buildLintWorkItems,
} = await import("../src/phases/lint-batches");
const { runIngest } = await import("../src/phases/ingest");
const { runLint } = await import("../src/phases/lint");
const { runLintFixChat } = await import("../src/phases/lint-chat");
const { runFormat } = await import("../src/phases/format");
const { analyzePdf } = await import("../src/phases/attachment-analyzer");
const { answerFromContext } = await import("../src/phases/query-answer");
const { runLintChat } = await import("../src/phases/chat");
const { VaultTools } = await import("../src/vault-tools");

interface CapturedRequest {
  entryPoint: string;
  params: Record<string, unknown>;
  effectiveInputBudget: number;
}

const capturedRequests: CapturedRequest[] = [];
const ingestOperationBudget = 20_000;
const fixtureDomainContract = "Demo domain";
const ingestOperationOpts = {
  inputBudgetTokens: ingestOperationBudget,
  semanticCompression: { profile: "balanced" as const, operation: "ingest" as const },
  structuredRetries: 0,
};

function capture(
  entryPoint: string,
  effectiveInputBudget: number,
  params: unknown,
): Record<string, unknown> {
  const typed = params as Record<string, unknown>;
  capturedRequests.push({ entryPoint, effectiveInputBudget, params: typed });
  return typed;
}

function messageText(params: unknown): string {
  const messages = (params as {
    messages?: OpenAI.Chat.ChatCompletionMessageParam[];
  }).messages ?? [];
  return messages.map((message) =>
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content)
  ).join("\n");
}

function streamText(content: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "content",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture",
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
    yield {
      id: "usage",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture",
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}

function streamJson(value: unknown): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return streamText(JSON.stringify(value));
}

function completionJson(value: unknown): OpenAI.Chat.ChatCompletion {
  return {
    id: "completion",
    object: "chat.completion",
    created: 0,
    model: "fixture",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify(value),
        refusal: null,
      },
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
  } as OpenAI.Chat.ChatCompletion;
}

class MemoryAdapter implements VaultAdapter {
  readonly writes: Array<{ path: string; data: string }> = [];

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.writes.push({ path, data });
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ""}${data}`);
  }

  async exists(path: string): Promise<boolean> {
    return path === ""
      || this.files.has(path)
      || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async mkdir(): Promise<void> {}
  async remove(path: string): Promise<void> { this.files.delete(path); }

  async rmdir(path: string): Promise<void> {
    for (const file of [...this.files.keys()]) {
      if (file === path || file.startsWith(`${path}/`)) this.files.delete(file);
    }
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path ? `${path}/` : "";
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.push(file);
      else folders.add(`${prefix}${rest.slice(0, slash)}`);
    }
    return { files: files.sort(), folders: [...folders].sort() };
  }
}

function domain(): DomainEntry {
  return {
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    pageNameVersion: 1,
    entity_types: [{
      type: "concept",
      description: "A concept.",
      extraction_cues: ["entity"],
      wiki_subfolder: "concept",
    }],
  };
}

function contextPages(count: number): Map<string, string> {
  return new Map(Array.from({ length: count }, (_, index) => [
    `!Wiki/demo/concept/wiki_demo_page_${index}.md`,
    [
      `# Page ${index}`,
      "",
      "## Facts",
      `shared entity fact ${index}`,
      "",
      "## Details",
      `page-${index}-detail ${"x".repeat(60)}`,
      "",
    ].join("\n"),
  ]));
}

function evidence(entityKey = "shared-entity") {
  return {
    entityKey,
    entityType: "concept",
    packetIds: ["source:packet-1"],
    facts: ["shared entity fact"],
    exactSourceRanges: [{ startLine: 1, endLine: 1 }],
    exactSource: [{ startLine: 1, endLine: 1, text: "shared entity fact" }],
    links: [],
  };
}

function bundleFromContext(
  entityEvidence: ReturnType<typeof evidence>,
  context: ReturnType<typeof buildEntityContext>,
): EntityContextBundle {
  return {
    entityKey: entityEvidence.entityKey,
    evidence: entityEvidence,
    units: context.units,
    replaceAuthorities: context.replaceAuthorities,
    estimatedInputTokens: context.estimatedInputTokens,
  };
}

function synthesisArgs(
  bundle: EntityContextBundle,
  llm: LlmClient,
  existingPaths: ReadonlySet<string> = new Set(),
  existingPageHashes: ReadonlyMap<string, string> = new Map(),
) {
  return {
    bundles: [bundle],
    existingPaths,
    existingPageHashes,
    existingPageDescriptions: [],
    tagRegistryUnits: [],
    pathPolicy: {
      domainRoot: "!Wiki/demo",
      allowedSubfolders: ["concept"],
    },
    domainContract: fixtureDomainContract,
    schemaContract: "Use H2 sections.",
    pathContract: "Use canonical demo paths.",
    llm,
    model: "fixture",
    policy: {
      inputBudgetTokens: ingestOperationBudget,
      outputBudgetTokens: 2_000,
      compression: "balanced" as const,
    },
    opts: ingestOperationOpts,
    signal: new AbortController().signal,
    onEvent: (_event: RunEvent) => {},
  };
}

function synthesisClient(
  responder: (prompt: string) => unknown,
  budget = ingestOperationBudget,
): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const typed = capture("synthesizeEntityBatch", budget, params);
          return streamJson(responder(messageText(typed)));
        },
      },
    },
  } as unknown as LlmClient;
}

async function exerciseIngestContextAndSynthesis(): Promise<void> {
  const onePage = contextPages(1);
  const entityEvidence = evidence();
  const createContext = buildEntityContext({
    evidence: entityEvidence,
    candidatePages: onePage,
    inputBudgetTokens: 20_000,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(
    createContext.units.map((unit) => unit.heading),
    ["## Facts", "## Details"],
  );
  const createBundle = bundleFromContext(entityEvidence, createContext);
  const createResponse = {
    reasoning: "Create the entity.",
    actions: [{
      kind: "create",
      entityKey: entityEvidence.entityKey,
      path: "!Wiki/demo/concept/wiki_demo_shared_entity.md",
      annotation: "Shared entity.",
      content: "# Shared entity\n\n## Facts\nshared entity fact\n",
    }],
    skips: [],
  };
  const createLlm = synthesisClient(() => createResponse);
  const createFirst = await synthesizeEntityBatch(synthesisArgs(createBundle, createLlm));
  const createSecond = await synthesizeEntityBatch(synthesisArgs(createBundle, createLlm));
  assert.deepEqual(createFirst, createSecond);
  assert.equal(createFirst.actions.length, 1);

  const targetPath = "!Wiki/demo/concept/wiki_demo_page_0.md";
  const current = onePage.get(targetPath)!;
  const inspected = inspectPatchablePage(current);
  const updateContext = buildEntityContext({
    evidence: entityEvidence,
    candidatePages: onePage,
    targetPath,
    inputBudgetTokens: 20_000,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(
    updateContext.units.map((unit) => unit.heading),
    ["## Facts", "## Details"],
  );
  const facts = updateContext.units.find((unit) => unit.heading === "## Facts");
  assert.ok(facts);
  const updateResponse = {
    reasoning: "Update the governed Facts section.",
    actions: [{
      kind: "patch",
      entityKey: entityEvidence.entityKey,
      path: targetPath,
      expectedPageHash: inspected.pageHash,
      sections: [{
        operation: "replace",
        heading: "## Facts",
        expectedSectionOrdinal: facts.sourceOrdinal,
        expectedSectionHash: facts.sectionHash,
        content: "shared entity fact updated",
      }],
    }],
    skips: [],
  };
  const updateBundle = bundleFromContext(entityEvidence, updateContext);
  const updateLlm = synthesisClient(() => updateResponse);
  const updateFirst = await synthesizeEntityBatch(synthesisArgs(
    updateBundle,
    updateLlm,
    new Set([targetPath]),
    new Map([[targetPath, inspected.pageHash]]),
  ));
  const updateSecond = await synthesizeEntityBatch(synthesisArgs(
    updateBundle,
    updateLlm,
    new Set([targetPath]),
    new Map([[targetPath, inspected.pageHash]]),
  ));
  assert.deepEqual(updateFirst, updateSecond);
  assert.equal(updateFirst.actions.length, 1);
  const applied = applyPagePatch(
    current,
    updateFirst.actions[0] as Parameters<typeof applyPagePatch>[1],
    updateContext.replaceAuthorities,
  );
  assert.equal(applied.ok, true);
  if (applied.ok) {
    const after = inspectPatchablePage(applied.content);
    assert.equal(
      after.sections.find((section) => section.heading === "## Details")?.span,
      inspected.sections.find((section) => section.heading === "## Details")?.span,
    );
  }

  for (const count of [15, 100]) {
    const transportStart = capturedRequests.length;
    const context = buildEntityContext({
      evidence: entityEvidence,
      candidatePages: contextPages(count),
      inputBudgetTokens: ingestOperationBudget,
      fixedMessages: [{ role: "system", content: fixtureDomainContract }],
      opts: ingestOperationOpts,
    });
    assert.ok(context.estimatedInputTokens <= ingestOperationBudget);
    if (count === 100) {
      assert.ok(new Set(context.units.map((unit) => unit.path)).size >= 2);
    }
    const input = synthesisArgs(
      bundleFromContext(entityEvidence, context),
      synthesisClient(() => createResponse, ingestOperationBudget),
    );
    assert.equal(ingestOperationBudget, input.policy.inputBudgetTokens);
    const output = await synthesizeEntityBatch(input);
    const transports = capturedRequests.slice(transportStart)
      .filter((request) => request.entryPoint === "synthesizeEntityBatch");
    assert.ok(transports.length > 0);
    assert.ok(transports.every((request) =>
      request.effectiveInputBudget === ingestOperationBudget));
    assert.equal(
      new Set(output.actions.map((action) => action.path)).size,
      output.actions.length,
    );
    if (count === 15) {
      const duplicateResponse = {
        ...createResponse,
        actions: [createResponse.actions[0], createResponse.actions[0]],
      };
      await assert.rejects(
        synthesizeEntityBatch(synthesisArgs(
          bundleFromContext(entityEvidence, context),
          synthesisClient(() => duplicateResponse),
        )),
        /duplicate action path/i,
      );
    }
  }
}

async function drainIngest(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
): Promise<{ events: RunEvent[]; outcome: IngestOutcome }> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, outcome: next.value };
    events.push(next.value);
  }
}

async function exerciseRawIndexBoundary(): Promise<void> {
  const sourcePath = "src/source.md";
  const pagePath = "!Wiki/demo/concept/wiki_demo_alpha.md";
  const indexPath = "!Wiki/demo/index.jsonl";
  const vectorSentinel = "987654321.125";
  const source = "Alpha is covered by the source.";
  const page = [
    "---",
    "type: concept",
    "description: Alpha concept.",
    "resource: [source]",
    "---",
    "# Alpha",
    "",
    "## Facts",
    source,
    "",
  ].join("\n");
  const pageRecord: PageIndexRecord = {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: pagePath,
    type: "concept",
    description: "Alpha concept.",
    resource: ["source"],
    bodyHash: contentHash(page),
    descriptionHash: contentHash("Alpha concept."),
  };
  const vector = Array.from({ length: 230_000 }, (_, index) =>
    index === 229_999 ? Number(vectorSentinel) : 0.125);
  const chunkRecord: ChunkIndexRecord = {
    kind: "chunk",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: pagePath,
    heading: "## Facts",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector,
    vectorModel: "fixture",
    dimensions: vector.length,
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
  const rawIndex = `${JSON.stringify(pageRecord)}\n${JSON.stringify(chunkRecord)}\n`;
  assert.ok(Buffer.byteLength(rawIndex) > 1.27 * 1024 * 1024);
  const adapter = new MemoryAdapter(new Map([
    [sourcePath, source],
    [pagePath, page],
    [indexPath, rawIndex],
  ]));
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const typed = capture("runIngest", 20_000, params);
          const prompt = messageText(typed);
          if (prompt.includes("CHUNK_ID ")) {
            const chunkId = prompt.match(/CHUNK_ID ([^\s]+)/)?.[1];
            assert.ok(chunkId);
            return mockChatResponse(params, JSON.stringify({
              packets: [{
                id: "p1",
                chunkId,
                entityKey: "alpha",
                entityType: "concept",
                facts: [source],
                exactSourceRanges: [{ startLine: 1, endLine: 1 }],
                links: [],
                sourceAnchor: `${sourcePath}:1`,
              }],
              noEvidence: [],
            }));
          }
          if (prompt.includes("Entity bundle: entity-alpha")) {
            return streamJson({
              reasoning: "Existing page already covers the evidence.",
              actions: [],
              skips: [{ entityKey: "alpha", reason: "No change required." }],
              entity_types_delta: [],
            });
          }
          throw new Error("unexpected runIngest request");
        },
      },
    },
  } as unknown as LlmClient;
  const { events, outcome } = await drainIngest(runIngest(
    [sourcePath],
    new VaultTools(adapter, "/vault"),
    llm,
    "fixture",
    [domain()],
    "/vault",
    new AbortController().signal,
    {
      inputBudgetTokens: 20_000,
      maxTokens: 2_000,
      semanticCompression: { profile: "balanced", operation: "ingest" },
      structuredRetries: 0,
    },
    new PageSimilarityService({ mode: "jaccard", topK: 5 }),
  ));
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.ok(events.some((event) => event.kind === "prompt_budget"));
  for (const request of capturedRequests.filter((item) => item.entryPoint === "runIngest")) {
    const serialized = JSON.stringify(request.params);
    assert.equal(serialized.includes(vectorSentinel), false);
    assert.equal(serialized.includes('"kind":"chunk"'), false);
  }
}

function allMessageText(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  return messages.map((message) =>
    typeof message.content === "string" ? message.content : ""
  ).join("\n");
}

function mapperMeta(messages: OpenAI.Chat.ChatCompletionMessageParam[]): {
  id: string;
  ordinal: number;
} {
  const match = allMessageText(messages).match(/CHUNK_ID ([^\s]+) START \d+ END \d+/u);
  assert.ok(match);
  return { id: match[1], ordinal: Number(match[1].split(":", 1)[0]) };
}

function isReducerRequest(messages: OpenAI.Chat.ChatCompletionMessageParam[]): boolean {
  return allMessageText(messages).includes("REDUCE_EVIDENCE");
}

function reducerInput(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Array<Record<string, unknown>> {
  const content = messages.find((message) =>
    typeof message.content === "string"
    && message.content.startsWith("REDUCE_INPUT ")
  )?.content;
  assert.equal(typeof content, "string");
  return JSON.parse(content.slice("REDUCE_INPUT ".length)) as Array<Record<string, unknown>>;
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

function reducedEvidence(input: Array<Record<string, unknown>>): Record<string, unknown> {
  const first = input[0];
  return {
    entityKey: first.entityKey,
    entityType: first.entityType,
    packetIds: input.flatMap((item) =>
      Array.isArray(item.packetIds) ? item.packetIds : [item.id]),
    facts: uniqueJson(input.flatMap((item) =>
      Array.isArray(item.facts) ? item.facts : [])),
    exactSourceRanges: uniqueJson(input.flatMap((item) =>
      Array.isArray(item.exactSourceRanges) ? item.exactSourceRanges : [])),
    exactSource: uniqueJson(input.flatMap((item) =>
      Array.isArray(item.exactSource) ? item.exactSource : [])),
    links: uniqueJson(input.flatMap((item) =>
      Array.isArray(item.links) ? item.links : [])),
  };
}

async function exerciseEvidenceThroughSynthesis(): Promise<void> {
  const events: RunEvent[] = [];
  const evidenceRequests: OpenAI.Chat.ChatCompletionMessageParam[][] = [];
  const policy: EvidencePolicy = {
    inputBudgetTokens: 12_000,
    outputBudgetTokens: 4_000,
    compressionProfile: "balanced",
    overlapLines: 0,
    mapperRetries: 1,
    reducerRetries: 1,
    maxReductionDepth: 6,
  };
  const runtime: EvidenceRuntime = {
    llm: {
      chat: {
        completions: {
          create: async (params: unknown) => {
            const typed = capture("prepareSourceEvidence", 12_000, params);
            const messages = typed.messages as OpenAI.Chat.ChatCompletionMessageParam[];
            evidenceRequests.push(messages);
            if (isReducerRequest(messages)) {
              return mockChatResponse(params, JSON.stringify(reducedEvidence(reducerInput(messages))));
            }
            const meta = mapperMeta(messages);
            return mockChatResponse(params, JSON.stringify({
              packets: Array.from({ length: 12 }, (_, packetIndex) => ({
                id: `p${meta.ordinal}-${packetIndex}`,
                chunkId: meta.id,
                entityKey: "postgresql",
                entityType: "concept",
                facts: [`fact-${meta.ordinal}`],
                exactSourceRanges: [{ startLine: 1, endLine: 1 }],
                links: ["https://postgresql.org"],
                sourceAnchor: `${meta.id}:1`,
              })),
              noEvidence: [],
            }));
          },
        },
      },
    } as unknown as LlmClient,
    model: "fixture",
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    configuredEntityTypes: ["concept"],
  };
  const source = Array.from(
    { length: 500 },
    (_, index) => `line ${index + 1} PostgreSQL details`,
  ).join("\n");
  const expectedChunks = chunkSourceForEvidence(
    source,
    "demo",
    policy,
    runtime.opts ?? {},
    runtime.configuredEntityTypes,
  );
  assertCompleteSourceCoverage(source, expectedChunks);
  const result = await prepareSourceEvidence(source, "demo", policy, runtime);
  assert.equal(result.length, 1);
  const expectedPacketIds = expectedChunks.flatMap((chunk, ordinal) =>
    Array.from(
      { length: 12 },
      (_, packetIndex) => `${chunk.id}:p${ordinal}-${packetIndex}`,
    ));
  assert.deepEqual(result[0].packetIds, expectedPacketIds);
  assert.deepEqual(
    evidenceRequests
      .filter((request) => !isReducerRequest(request))
      .map((request) => mapperMeta(request).id),
    expectedChunks.map((chunk) => chunk.id),
  );
  assert.ok(evidenceRequests.some(isReducerRequest));

  const synthesisSeen: Record<string, unknown>[] = [];
  const synthesisLlm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const typed = capture("synthesizeEntityBatch:evidence", 35_000, params);
          synthesisSeen.push(typed);
          return streamJson({
            reasoning: "Create PostgreSQL.",
            actions: [{
              kind: "create",
              entityKey: "postgresql",
              path: "!Wiki/demo/concept/wiki_demo_postgresql.md",
              annotation: "PostgreSQL.",
              content: "# PostgreSQL\n\n## Facts\nMapped evidence.\n",
            }],
            skips: [],
          });
        },
      },
    },
  } as unknown as LlmClient;
  await synthesizeEntityBatch({
    ...synthesisArgs({
      entityKey: result[0].entityKey,
      evidence: result[0],
      units: [],
      replaceAuthorities: [],
      estimatedInputTokens: 0,
    }, synthesisLlm),
    policy: {
      inputBudgetTokens: 35_000,
      outputBudgetTokens: 2_000,
      compression: "balanced" as const,
    },
  });
  const synthesisPrompt = JSON.stringify(synthesisSeen[0]);
  for (const chunk of expectedChunks) assert.ok(synthesisPrompt.includes(chunk.id));
  for (const packetId of expectedPacketIds) assert.ok(synthesisPrompt.includes(packetId));
  assert.equal(
    events.filter((event) => event.kind === "prompt_budget").length,
    evidenceRequests.length,
  );
}

async function collectEvents(
  generator: AsyncGenerator<RunEvent>,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function lintBatchItems(params: Record<string, unknown>): Array<{
  id: string;
  path: string;
  heading: string;
}> | null {
  const user = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])
    .find((message) => message.role === "user" && typeof message.content === "string");
  if (!user || typeof user.content !== "string") return null;
  const match = user.content.match(
    /Submitted lint work items:\n([\s\S]*?)\n\nOptional related sections:/,
  );
  return match
    ? JSON.parse(match[1]) as Array<{ id: string; path: string; heading: string }>
    : null;
}

async function exerciseLintAndLintChat(): Promise<void> {
  const pages = new Map<string, string>();
  const files = new Map<string, string>();
  for (let index = 0; index < 100; index++) {
    const path = `!Wiki/demo/concept/wiki_demo_lint_${index}.md`;
    const content =
      `---\nresource:\n  - "Sources/raw/page-${index}.md"\n---\n# Page ${index}\n\n## Facts\n${
        index === 42 ? "oversized\n".repeat(3_000) : `fact ${index}`
      }`;
    pages.set(path, content);
    files.set(path, content);
    files.set(`Sources/raw/page-${index}.md`, `source ${index}`);
  }
  const adapter = new MemoryAdapter(files);
  const submittedIds: string[] = [];
  const findingTexts: string[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const typed = capture("runLint", 24_000, params);
          const items = lintBatchItems(typed);
          if (items) {
            submittedIds.push(...items.map((item) => item.id));
            const findings = items.map((item): LintFinding => ({
              path: item.path,
              heading: item.heading,
              rule: "acceptance",
              severity: "warning",
              text: `finding-${encodeURIComponent(item.id)}`,
              repairInstruction: "Keep the finding bounded.",
            }));
            findingTexts.push(...findings.map((finding) => finding.text));
            const output = {
              coveredWorkIds: items.map((item) => item.id),
              findings,
              patches: [],
              deletes: [],
            };
            return typed.stream === false ? completionJson(output) : streamJson(output);
          }
          const output = {
            reasoning: "Keep current config.",
            entity_types: domain().entity_types,
            language_notes: "",
          };
          return typed.stream === false ? completionJson(output) : streamJson(output);
        },
      },
    },
  } as unknown as LlmClient;
  const events = await collectEvents(runLint(
    ["demo"],
    new VaultTools(adapter, "/vault"),
    llm,
    "fixture",
    [domain()],
    "/vault",
    new AbortController().signal,
    0,
    {
      inputBudgetTokens: 24_000,
      maxTokens: 20_000,
      structuredRetries: 0,
      semanticCompression: { profile: "balanced", operation: "lint" },
    },
  ));
  const expectedItems = buildLintWorkItems(pages, 24_000);
  assert.deepEqual(
    [...submittedIds].sort(),
    expectedItems.map((item) => item.id).sort(),
  );
  assert.equal(new Set(submittedIds).size, submittedIds.length);
  assert.equal(new Set(findingTexts).size, findingTexts.length);
  const findingReports = events.filter((event) =>
    event.kind === "assistant_text" && event.delta.startsWith("- [warning]"));
  assert.equal(findingReports.length, 1);
  const report = findingReports[0].kind === "assistant_text"
    ? findingReports[0].delta
    : "";
  for (const text of findingTexts) {
    assert.equal(report.split(text).length - 1, 1, text);
  }
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget" && event.callSite === "lint.batch"));
  const lintLifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && event.action === "check_wiki_quality");
  assert.ok(lintLifecycle.length > 0);
  let successfulBatchCount = 0;
  for (const id of new Set(lintLifecycle.map((event) => event.id))) {
    const attempt = lintLifecycle.filter((event) => event.id === id);
    const phases = attempt.map((event) => event.phase);
    const callSite = attempt[0]?.diagnostics?.callSite;
    if (callSite === "lint.patch") {
      assert.deepEqual(
        phases,
        ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
      );
      continue;
    }
    if (phases.at(-1) === "completed") successfulBatchCount += 1;
    assert.deepEqual(
      phases,
      phases.at(-1) === "failed"
        ? ["preparing", "failed"]
        : ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
    );
  }
  assert.ok(successfulBatchCount > 0);

  const chatPaths = [...pages.keys()].slice(0, 5);
  const reportLines = chatPaths.map((path, index) =>
    `- [warning] ${path} :: ## Facts :: acceptance-rule-${index} :: issue ${index}`
  );
  const instruction = `Fix ${chatPaths.map((path) =>
    path.split("/").pop()!.replace(/\.md$/, "")).join(" ")}`;
  let lintChatParams: Record<string, unknown> | undefined;
  const chatEvents = await collectEvents(runLintFixChat(
    {
      operation: "lint-chat",
      context: reportLines.join("\n"),
      chatMessages: [{ role: "user", content: instruction }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    domain(),
    {
      chat: {
        completions: {
          create: async (params: unknown) => {
            lintChatParams = capture("runLintFixChat", 12_000, params);
            return streamJson({ summary: "lint chat complete", patches: [] });
          },
        },
      },
    } as unknown as LlmClient,
    "fixture",
    {
      inputBudgetTokens: 12_000,
      structuredRetries: 0,
      semanticCompression: { profile: "balanced", operation: "lint" },
    },
    new AbortController().signal,
  ));
  assert.ok(lintChatParams);
  const lintChatSerialized = JSON.stringify(lintChatParams);
  for (let index = 0; index < chatPaths.length; index++) {
    const marker = `acceptance-rule-${index}`;
    assert.equal(lintChatSerialized.split(marker).length - 1, 1, marker);
  }
  assert.ok(chatEvents.some((event) =>
    event.kind === "prompt_budget" && event.callSite === "lint-chat.patch"));
}

function textFromUserMessage(params: Record<string, unknown>): string {
  const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const user = messages.findLast((message) => message.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  return Array.isArray(user.content)
    ? user.content.map((part) =>
        "text" in part && typeof part.text === "string" ? part.text : ""
      ).join("\n")
    : "";
}

function segmentFrame(segmentId: string, formatted: string): string {
  return [
    "<<<SEGMENT_ID>>>",
    segmentId,
    "<<<REPORT>>>",
    `formatted ${segmentId}`,
    "<<<FORMATTED>>>",
    formatted,
    "<<<END>>>",
  ].join("\n");
}

async function exerciseFormat(): Promise<void> {
  const source = [
    "---",
    "tags: [acceptance]",
    "---",
    "# Format acceptance",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    ...Array.from(
      { length: 100 },
      (_, index) => `FormatToken${index} ${"x".repeat(60)}`,
    ),
    "",
  ].join("\n");
  const adapter = new MemoryAdapter(new Map([["notes/source.md", source]]));
  const segmentIds: string[] = [];
  const events = await collectEvents(runFormat(
    ["notes/source.md"],
    new VaultTools(adapter, "/vault"),
    {
      chat: {
        completions: {
          create: async (params: unknown) => {
            const typed = capture("runFormat", 10_000, params);
            const user = textFromUserMessage(typed);
            const id = user.match(/Segment ID:\s*(segment[-\d]+)/)?.[1];
            assert.ok(id);
            segmentIds.push(id);
            const segment = user.match(
              /<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/,
            )?.[1] ?? "";
            return streamText(segmentFrame(id, segment));
          },
        },
      },
    } as unknown as LlmClient,
    "fixture",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 10_000, maxTokens: 2_000 },
  ));
  assert.ok(segmentIds.length > 1);
  assert.equal(new Set(segmentIds).size, segmentIds.length);
  assert.equal(adapter.files.get("notes/source.md"), source);
  for (const request of capturedRequests.filter((item) => item.entryPoint === "runFormat")) {
    assert.doesNotMatch(
      JSON.stringify(request.params),
      /semantic compression|compression profile/i,
    );
  }
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget" && event.callSite === "format.segment"));
}

function recognition(pageId: string): VisionRecognitionRecord {
  return {
    pageId,
    ocr: [`ocr-${pageId}`],
    objects: [`object-${pageId}`],
    relationships: [`relationship-${pageId}`],
    layout: [`layout-${pageId}`],
    uncertainty: [`uncertainty-${pageId}`],
  };
}

function pageIdsFromParams(params: Record<string, unknown>): string[] {
  const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const user = messages.find((message) => message.role === "user");
  const content = Array.isArray(user?.content) ? user.content : [];
  const text = content
    .filter((part): part is OpenAI.Chat.ChatCompletionContentPartText =>
      part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return [...text.matchAll(/\bp\d+\b/g)].map((match) => match[0]);
}

async function exerciseVisionPdf(): Promise<void> {
  const events: RunEvent[] = [];
  const description = await analyzePdf(
    new ArrayBuffer(0),
    {
      chat: {
        completions: {
          create: async (params: unknown) => {
            const typed = capture("analyzePdf", 10_000, params);
            return completionJson({
              records: pageIdsFromParams(typed).map(recognition),
            });
          },
        },
      },
    } as unknown as LlmClient,
    "fixture",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 10_000,
      maxTokens: 2_000,
      compressionProfile: "minimum",
      onEvent: (event) => events.push(event),
    },
    {
      loadPdf: async () => ({
        numPages: 7,
        renderPage: async (pageNumber, options) => ({
          pageId: `p${pageNumber}`,
          dataUrl: `data:image/jpeg;base64,p${pageNumber}-${options.scale}-${options.quality}`,
        }),
      }),
    },
  );
  for (let pageNumber = 1; pageNumber <= 7; pageNumber++) {
    const record = recognition(`p${pageNumber}`);
    for (const value of [
      record.pageId,
      ...record.ocr,
      ...record.objects,
      ...record.relationships,
      ...record.layout,
      ...record.uncertainty,
    ]) {
      assert.ok(description.includes(value), value);
    }
  }
  assert.ok(events.every((event) =>
    event.kind !== "prompt_budget"
    || event.estimatedInputTokens <= event.effectiveInputBudget));
}

function selectedChunk(index: number): SelectedChunk {
  return {
    articleId: `wiki_demo_${index}`,
    path: `!Wiki/demo/concept/wiki_demo_${index}.md`,
    heading: `## Section ${index}`,
    body: `CHUNK_${index}_START\n${`fact ${index} `.repeat(20)}\nCHUNK_${index}_END`,
    score: 100 - index,
    source: index % 2 === 0 ? "seed" : "graph",
    ordinal: index,
  };
}

async function drainGenerator<T>(
  generator: AsyncGenerator<RunEvent, T>,
): Promise<{ events: RunEvent[]; result: T }> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

async function exerciseQueryAndChat(): Promise<void> {
  const queryQuestion = "KEEP CURRENT QUERY QUESTION WHOLE";
  let queryParams: Record<string, unknown> | undefined;
  await drainGenerator(answerFromContext({
    llm: {
      chat: {
        completions: {
          create: async (params: unknown) => {
            queryParams = capture("answerFromContext", 3_000, params);
            return streamText("bounded query answer");
          },
        },
      },
    } as unknown as LlmClient,
    model: "fixture",
    opts: { inputBudgetTokens: 3_000 },
    signal: new AbortController().signal,
    systemPrompt: "Answer from complete chunks.",
    question: queryQuestion,
    chunks: Array.from({ length: 10 }, (_, index) => selectedChunk(index)),
    wikiLinkValidationRetries: 0,
  }));
  assert.ok(queryParams);
  assert.ok(JSON.stringify(queryParams).includes(queryQuestion));

  const chatInstruction = "KEEP CURRENT CHAT INSTRUCTION WHOLE";
  let chatParams: Record<string, unknown> | undefined;
  await collectEvents(runLintChat(
    {
      chat: {
        completions: {
          create: async (params: unknown) => {
            chatParams = capture("runLintChat", 2_500, params);
            return streamText("bounded chat answer");
          },
        },
      },
    } as unknown as LlmClient,
    "fixture",
    undefined,
    new AbortController().signal,
    { inputBudgetTokens: 2_500 },
    "prior bounded context",
    [
      { role: "user", content: "older question ".repeat(100) },
      { role: "assistant", content: "older answer ".repeat(100) },
      { role: "user", content: chatInstruction },
    ],
    "Chat contract.",
  ));
  assert.ok(chatParams);
  assert.ok(JSON.stringify(chatParams).includes(chatInstruction));
}

function contextError(message: string): Error {
  return Object.assign(new Error(message), { code: "context_length_exceeded" });
}

async function exerciseContextRecovery(): Promise<void> {
  const budgets: number[] = [];
  const signatures: string[] = [];
  let attempt = 0;
  await assert.rejects(runWithContextRepack({
    callSite: "query.answer",
    configuredInputBudget: 1_000,
    compressionProfile: "balanced",
    build: (effectiveInputBudget) => {
      budgets.push(effectiveInputBudget);
      const packed = packContextUnits({
        inputBudgetTokens: effectiveInputBudget,
        fixedMessages: [],
        opts: {},
        units: [
          {
            id: "required",
            source: "source",
            text: "CURRENT QUESTION",
            required: true,
            priority: 100,
            estimatedTokens: 16,
          },
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `optional-${index}`,
            source: "wiki" as const,
            text: `OPTIONAL_${index}_${"x".repeat(115)}`,
            required: false,
            priority: 10 - index,
            estimatedTokens: 126,
          })),
        ],
        render: (units) => [{
          role: "user",
          content: units.map((unit) => unit.text).join("\n"),
        }],
      });
      return {
        value: packed.messages,
        estimatedInputTokens: packed.estimatedInputTokens,
        contextUnits: packed.selected.length,
      };
    },
    execute: async (messages) => {
      signatures.push(JSON.stringify(messages));
      attempt++;
      if (attempt === 1) {
        throw contextError("prompt size 1200 exceeds maximum context 1000");
      }
      throw contextError("context window exceeded");
    },
    onEvent: () => {},
  }), /context/i);
  assert.deepEqual(budgets, [
    1_000,
    shrinkInputBudget(1_000, { promptTokens: 1_200, maxContextTokens: 1_000 }),
    562,
  ]);
  assert.equal(attempt, 3);
  assert.equal(signatures.length, 3);
  assert.equal(new Set(signatures).size, 3);
}

async function exerciseUnchangedEmbeddings(): Promise<void> {
  const root = "!Wiki/demo";
  const body = "# Alpha\n\n## Facts\nAlpha facts.";
  const page: PageIndexRecord = {
    kind: "page",
    schemaVersion: 1,
    articleId: "wiki_demo_alpha",
    path: `${root}/concept/wiki_demo_alpha.md`,
    type: "concept",
    description: "Alpha description",
    resource: ["source"],
    bodyHash: contentHash(body),
    descriptionHash: contentHash("Alpha description"),
  };
  const inputs = buildChunkInputs(page.description, body, DEFAULT_CHUNKING);
  const chunks: ChunkIndexRecord[] = inputs.map((input, ordinal) => ({
    kind: "chunk",
    schemaVersion: 1,
    articleId: page.articleId,
    path: page.path,
    heading: input.heading ?? "",
    ordinal: input.ordinal ?? ordinal,
    bodyHash: input.hash,
    embedTextHash: input.hash,
    vector: [0.1, 0.2],
    vectorModel: "fixture-embedding",
    dimensions: 2,
    updatedAt: "2026-07-18T00:00:00.000Z",
  }));
  const adapter = new MemoryAdapter(new Map([
    [`${root}/index.jsonl`, [page, ...chunks]
      .map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const service = new PageSimilarityService({
    mode: "embedding",
    topK: 2,
    model: "fixture-embedding",
    dimensions: 2,
    baseUrl: "http://unused.invalid",
  });
  const originalFetch = globalThis.fetch;
  let embeddingRequests = 0;
  globalThis.fetch = async () => {
    embeddingRequests++;
    throw new Error("unchanged hashes must not issue embedding requests");
  };
  try {
    assert.deepEqual(await service.refreshCache(
      root,
      new VaultTools(adapter, ""),
      new Map([[page.articleId, page.description]]),
      new Map([[page.articleId, body]]),
      { fullCorpus: true },
    ), { updated: 0, failed: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(embeddingRequests, 0);
}

function assertCapturedRequestsBounded(): void {
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "runIngest"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "synthesizeEntityBatch"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "prepareSourceEvidence"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "runLint"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "runLintFixChat"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "runFormat"));
  assert.ok(capturedRequests.some((request) =>
    request.entryPoint === "analyzePdf"));
  for (const request of capturedRequests) {
    const messages = request.params.messages as
      | OpenAI.Chat.ChatCompletionMessageParam[]
      | undefined;
    if (messages) {
      assert.ok(
        estimatePreparedMessages(messages) <= request.effectiveInputBudget,
        request.entryPoint,
      );
    }
    assert.equal(JSON.stringify(request.params).includes('"vector"'), false);
  }
}

async function runProductionAcceptanceMatrix(): Promise<void> {
  capturedRequests.length = 0;
  await exerciseIngestContextAndSynthesis();
  await exerciseRawIndexBoundary();
  await exerciseEvidenceThroughSynthesis();
  await exerciseLintAndLintChat();
  await exerciseFormat();
  await exerciseVisionPdf();
  await exerciseQueryAndChat();
  await exerciseContextRecovery();
  await exerciseUnchangedEmbeddings();
  assertCapturedRequestsBounded();
}

test("Task 16 acceptance matrix uses production orchestration requests", async () => {
  await runProductionAcceptanceMatrix();
});
