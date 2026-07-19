import type OpenAI from "openai";
import { z } from "zod";
import { assertCompleteSourceCoverage, chunkMarkdownSource, type SourceChunk } from "../markdown-chunks";
import {
  createPromptBudgetEvent,
  classifyContextError,
  estimatePreparedMessages,
  PromptBudgetExceededError,
  runWithContextRepack,
} from "../prompt-budget";
import type {
  CompressionProfile,
  LlmCallOptions,
  LlmClient,
  RunEvent,
} from "../types";
import {
  createLlmLifecycle,
  runStructuredWithRetry,
  StructuredValidationError,
  type RunStructuredArgs,
  type RunStructuredResult,
} from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import { prepareChatMessages } from "./llm-utils";
import mapPrompt from "../../prompts/ingest-evidence-map.md";
import reducePrompt from "../../prompts/ingest-evidence-reduce.md";
import {
  EvidenceMapperOutputSchema,
  EntityEvidenceSchema,
  PreVerifiedEntityEvidenceSchema,
  EvidenceMapSchema,
  EvidencePacketSchema,
  NoEvidenceSchema,
} from "./zod-schemas";

export interface EvidenceRange {
  startLine: number;
  endLine: number;
}

export interface EvidencePacket {
  id: string;
  chunkId: string;
  entityKey: string;
  entityType?: string;
  facts: string[];
  exactSourceRanges: EvidenceRange[];
  links: string[];
  sourceAnchor: string;
}

export interface VerifiedEvidencePacket extends EvidencePacket {
  exactSource: Array<EvidenceRange & { text: string }>;
}

export interface EntityEvidence {
  entityKey: string;
  entityType?: string;
  packetIds: string[];
  facts: string[];
  exactSourceRanges: EvidenceRange[];
  exactSource: Array<EvidenceRange & { text: string }>;
  links: string[];
}

export interface PreVerifiedEntityEvidence {
  entityKey: string;
  entityType?: string;
  packetIds: string[];
  facts: string[];
  exactSourceRanges: EvidenceRange[];
  links: string[];
}

export interface NoEvidence {
  chunkId: string;
  reason: string;
}

export interface EvidenceChunk {
  id: string;
  startLine: number;
  endLine: number;
}

export class EvidenceCoverageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceCoverageError";
  }
}

export class EvidenceReducerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceReducerError";
  }
}

const ENTITY_KEY_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

function assertEntityKey(key: string): void {
  if (!ENTITY_KEY_RE.test(key)) {
    throw new EvidenceCoverageError(
      `Invalid normalized entity key "${key}"; expected ^[a-z0-9]+(?:[_-][a-z0-9]+)*$ `
      + `(example conversion: "proxy.pac" -> "proxy-pac")`,
    );
  }
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}

function rangeKey(range: EvidenceRange): string {
  return `${range.startLine}:${range.endLine}`;
}

function assertLocalRange(range: EvidenceRange, chunk: EvidenceChunk): void {
  const chunkLineCount = chunk.endLine - chunk.startLine + 1;
  if (range.startLine > range.endLine
    || range.startLine < 1
    || range.endLine > chunkLineCount) {
    throw new EvidenceCoverageError(
      `Chunk-local evidence range ${range.startLine}-${range.endLine} is outside chunk ${chunk.id} lines 1-${chunkLineCount}`,
    );
  }
}

function globalRange(range: EvidenceRange, chunk: EvidenceChunk): EvidenceRange {
  return {
    startLine: chunk.startLine + range.startLine - 1,
    endLine: chunk.startLine + range.endLine - 1,
  };
}

function sourceLines(source: string | string[]): string[] {
  return Array.isArray(source) ? source : source.split("\n");
}

export function buildEvidenceCoverage(
  chunkIds: string[],
  packets: EvidencePacket[],
  noEvidence: NoEvidence[],
): Set<string> {
  const expected = new Set(chunkIds);
  if (expected.size !== chunkIds.length || chunkIds.some((id) => id.trim() === "")) {
    throw new EvidenceCoverageError("Duplicate or blank source chunk ID");
  }
  const packetIds = new Set<string>();
  const packetChunks = new Set<string>();
  for (const packet of packets) {
    try {
      EvidencePacketSchema.parse({
        id: packet.id,
        chunkId: packet.chunkId,
        entityKey: packet.entityKey,
        entityType: packet.entityType,
        facts: packet.facts,
        exactSourceRanges: packet.exactSourceRanges,
        links: packet.links,
        sourceAnchor: packet.sourceAnchor,
      });
    } catch (error) {
      throw new EvidenceCoverageError(
        `Invalid evidence packet ${packet.id || "(blank)"}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    assertEntityKey(packet.entityKey);
    if (packetIds.has(packet.id)) throw new EvidenceCoverageError(`Duplicate packet ID ${packet.id}`);
    packetIds.add(packet.id);
    if (!expected.has(packet.chunkId)) throw new EvidenceCoverageError(`Unknown source chunk ${packet.chunkId}`);
    if (packetChunks.has(packet.chunkId)) {
      // Multiple packets are valid; this set only tracks packet coverage.
    }
    packetChunks.add(packet.chunkId);
  }
  const noEvidenceChunks = new Set<string>();
  for (const item of noEvidence) {
    try { NoEvidenceSchema.parse(item); } catch (error) {
      throw new EvidenceCoverageError(
        `Invalid noEvidence result: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (noEvidenceChunks.has(item.chunkId)) {
      throw new EvidenceCoverageError(`Duplicate noEvidence chunk ${item.chunkId}`);
    }
    if (!expected.has(item.chunkId)) throw new EvidenceCoverageError(`Unknown source chunk ${item.chunkId}`);
    noEvidenceChunks.add(item.chunkId);
  }
  for (const chunkId of packetChunks) {
    if (noEvidenceChunks.has(chunkId)) throw new EvidenceCoverageError(`Mixed packet/noEvidence coverage for ${chunkId}`);
  }
  const covered = new Set([...packetChunks, ...noEvidenceChunks]);
  const missing = chunkIds.filter((id) => !covered.has(id));
  if (missing.length > 0) throw new EvidenceCoverageError(`Missing source chunk coverage: ${missing.join(", ")}`);
  return covered;
}

export function validateEvidenceMap(
  input: { chunk: EvidenceChunk; packets: EvidencePacket[]; noEvidence: NoEvidence[] },
  source?: string | string[],
): VerifiedEvidencePacket[] {
  let parsed: z.infer<typeof EvidenceMapSchema>;
  try {
    parsed = EvidenceMapSchema.parse({
      ...input,
      chunk: {
        id: input.chunk.id,
        startLine: input.chunk.startLine,
        endLine: input.chunk.endLine,
      },
    });
  } catch (error) {
    throw new EvidenceCoverageError(
      `Invalid evidence map for chunk ${input.chunk.id}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (parsed.chunk.startLine > parsed.chunk.endLine) {
    throw new EvidenceCoverageError(`Invalid range for chunk ${parsed.chunk.id}`);
  }
  buildEvidenceCoverage([parsed.chunk.id], parsed.packets, parsed.noEvidence);
  const lines = source === undefined ? undefined : sourceLines(source);
  return parsed.packets.map((packet) => {
    assertEntityKey(packet.entityKey);
    const exactSourceRanges = packet.exactSourceRanges.map((range) => {
      assertLocalRange(range, parsed.chunk);
      return globalRange(range, parsed.chunk);
    });
    const exactSource = exactSourceRanges.map((range) => {
      if (lines === undefined) {
        throw new EvidenceCoverageError("Original source is required to verify exact evidence");
      }
      if (range.endLine > lines.length) {
        throw new EvidenceCoverageError(`Evidence range ${rangeKey(range)} is outside source`);
      }
      return {
        ...range,
        text: lines.slice(range.startLine - 1, range.endLine).join("\n"),
      };
    });
    return { ...packet, exactSourceRanges, exactSource };
  });
}

export function dedupeEvidencePackets(packets: EvidencePacket[]): PreVerifiedEntityEvidence {
  if (packets.length === 0) throw new EvidenceReducerError("Cannot reduce empty evidence packet list");
  const ids = new Set<string>();
  const first = packets[0];
  assertEntityKey(first.entityKey);
  const entityType = first.entityType;
  const facts: string[] = [];
  const ranges: EvidenceRange[] = [];
  const links: string[] = [];
  for (const packet of packets) {
    EvidencePacketSchema.parse({
      id: packet.id,
      chunkId: packet.chunkId,
      entityKey: packet.entityKey,
      entityType: packet.entityType,
      facts: packet.facts,
      exactSourceRanges: packet.exactSourceRanges,
      links: packet.links,
      sourceAnchor: packet.sourceAnchor,
    });
    if (ids.has(packet.id)) throw new EvidenceReducerError(`Duplicate packet ID ${packet.id}`);
    ids.add(packet.id);
    if (packet.entityKey !== first.entityKey || packet.entityType !== entityType) {
      throw new EvidenceReducerError("Mixed entity packets cannot be reduced together");
    }
    assertEntityKey(packet.entityKey);
    facts.push(...packet.facts);
    ranges.push(...packet.exactSourceRanges);
    links.push(...packet.links);
  }
  return {
    entityKey: first.entityKey,
    ...(entityType === undefined ? {} : { entityType }),
    packetIds: [...ids],
    facts: unique(facts, (fact) => fact),
    exactSourceRanges: unique(ranges, rangeKey),
    links: unique(links, (link) => link),
  };
}

export function dedupeVerifiedEvidencePackets(packets: VerifiedEvidencePacket[]): EntityEvidence {
  if (packets.length === 0) throw new EvidenceReducerError("Cannot reduce empty evidence packet list");
  const preVerified = dedupeEvidencePackets(packets);
  const exactSource = unique(
    packets.flatMap((packet) => packet.exactSource),
    (range) => `${rangeKey(range)}:${range.text}`,
  );
  const result: EntityEvidence = { ...preVerified, exactSource };
  try { EntityEvidenceSchema.parse(result); } catch (error) {
    throw new EvidenceReducerError(error instanceof Error ? error.message : "Invalid verified evidence aggregate");
  }
  return result;
}

export function validateReducedEvidence(
  consumed: Array<EvidencePacket | VerifiedEvidencePacket>,
  reduced: EntityEvidence | PreVerifiedEntityEvidence,
): EntityEvidence | PreVerifiedEntityEvidence {
  const verifiedFlags = consumed.map((packet) => "exactSource" in packet);
  const verified = verifiedFlags.every(Boolean);
  if (verifiedFlags.some((value) => value !== verified)) {
    throw new EvidenceReducerError("Mixed verification state in consumed evidence packets");
  }
  try {
    (verified ? EntityEvidenceSchema : PreVerifiedEntityEvidenceSchema).parse(reduced);
  } catch (error) {
    throw new EvidenceReducerError(error instanceof Error ? error.message : "Invalid reduced evidence");
  }
  const expected = verified
    ? dedupeVerifiedEvidencePackets(consumed.filter(
      (packet): packet is VerifiedEvidencePacket => "exactSource" in packet,
    ))
    : dedupeEvidencePackets(consumed.filter((packet) => !("exactSource" in packet)));
  if (reduced.packetIds.length !== expected.packetIds.length
    || new Set(reduced.packetIds).size !== reduced.packetIds.length
    || reduced.packetIds.some((id, index) => id !== expected.packetIds[index])) {
    const missing = expected.packetIds.filter((id) => !reduced.packetIds.includes(id));
    throw new EvidenceReducerError(
      `Reduced evidence does not account for every consumed packet ID: ${missing.join(", ") || "unexpected IDs"}`,
    );
  }
  if (reduced.entityKey !== expected.entityKey || reduced.entityType !== expected.entityType) {
    throw new EvidenceReducerError("Reduced evidence changed entity identity");
  }
  if (JSON.stringify(reduced.facts) !== JSON.stringify(expected.facts)) throw new EvidenceReducerError("Reduced evidence contains unsupported facts");
  if (JSON.stringify(reduced.exactSourceRanges) !== JSON.stringify(expected.exactSourceRanges)) throw new EvidenceReducerError("Reduced evidence changed exact source ranges");
  if (JSON.stringify(reduced.links) !== JSON.stringify(expected.links)) throw new EvidenceReducerError("Reduced evidence contains unsupported links");
  if (verified && JSON.stringify((reduced as EntityEvidence).exactSource)
    !== JSON.stringify((expected as EntityEvidence).exactSource)) {
    throw new EvidenceReducerError("Reduced evidence changed exact source");
  }
  return reduced;
}

export interface EvidencePolicy {
  inputBudgetTokens: number;
  outputBudgetTokens?: number;
  compressionProfile?: CompressionProfile;
  compression?: CompressionProfile;
  overlapLines?: number;
  mapperRetries?: number;
  reducerRetries?: number;
  maxReductionDepth?: number;
  bootstrapPayloadBudgetTokens?: number;
}

export interface EvidenceRuntime {
  llm: LlmClient;
  model: string;
  opts?: LlmCallOptions;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  configuredEntityTypes?: string[];
  mapCallSite?: "ingest.evidence-map" | "init.bootstrap-map";
}

export interface BootstrapCandidateEvidence {
  entityKey: string;
  packetIds: string[];
  facts: string[];
  exactSource: Array<EvidenceRange & { text: string }>;
}

export interface BootstrapEvidence {
  candidates: BootstrapCandidateEvidence[];
  domainThemes: string[];
  languageEvidence: string[];
}

interface EvidenceMappingMode {
  allowedEntityTypes?: Set<string>;
  rejectEntityTypes: boolean;
}

type EvidenceUnit = VerifiedEvidencePacket | EntityEvidence;

function isEntityEvidence(unit: EvidenceUnit): unit is EntityEvidence {
  return "packetIds" in unit;
}

function packetIdsOf(unit: EvidenceUnit): string[] {
  return isEntityEvidence(unit) ? unit.packetIds : [unit.id];
}

function evidenceFromUnits(units: EvidenceUnit[]): EntityEvidence {
  if (units.length === 0) throw new EvidenceReducerError("Cannot aggregate an empty evidence batch");
  const first = units[0];
  const entityKey = first.entityKey;
  const entityType = first.entityType;
  const packetIds: string[] = [];
  const facts: string[] = [];
  const ranges: EvidenceRange[] = [];
  const exactSource: Array<EvidenceRange & { text: string }> = [];
  const links: string[] = [];
  const ids = new Set<string>();
  for (const unit of units) {
    if (unit.entityKey !== entityKey || unit.entityType !== entityType) {
      throw new EvidenceReducerError("Mixed entity packets cannot be reduced together");
    }
    for (const id of packetIdsOf(unit)) {
      if (ids.has(id)) throw new EvidenceReducerError(`Duplicate consumed packet ID ${id}`);
      ids.add(id);
      packetIds.push(id);
    }
    facts.push(...unit.facts);
    ranges.push(...unit.exactSourceRanges);
    exactSource.push(...unit.exactSource);
    links.push(...unit.links);
  }
  return {
    entityKey,
    ...(entityType === undefined ? {} : { entityType }),
    packetIds,
    facts: unique(facts, (fact) => fact),
    exactSourceRanges: unique(ranges, rangeKey),
    exactSource: unique(exactSource, (range) => `${rangeKey(range)}:${range.text}`),
    links: unique(links, (link) => link),
  };
}

function addSchemaIssue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message });
}

const EvidencePacketWireSchema = EvidencePacketSchema.extend({
  entityType: EvidencePacketSchema.shape.entityType.nullable()
    .transform((entityType) => entityType ?? undefined),
}).transform((packet): EvidencePacket => {
  const { entityType, ...withoutEntityType } = packet;
  return entityType === undefined ? withoutEntityType : { ...withoutEntityType, entityType };
});

const EvidenceMapperWireOutputSchema = EvidenceMapperOutputSchema.extend({
  packets: z.array(EvidencePacketWireSchema),
});

const UntypedEntityEvidenceWireSchema = EntityEvidenceSchema.extend({
  entityType: EntityEvidenceSchema.shape.entityType.nullable()
    .transform((entityType) => entityType ?? undefined),
}).transform((evidence): EntityEvidence => {
  const { entityType, ...withoutEntityType } = evidence;
  return entityType === undefined ? withoutEntityType : { ...withoutEntityType, entityType };
});

function structuredWireSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): z.ZodSchema<T> {
  return schema as unknown as z.ZodSchema<T>;
}

function mapperSchemaFor(chunk: SourceChunk, mode: EvidenceMappingMode) {
  return structuredWireSchema(EvidenceMapperWireOutputSchema.superRefine((value, ctx) => {
    try {
      buildEvidenceCoverage([chunk.id], value.packets, value.noEvidence);
      for (const packet of value.packets) {
        assertEntityKey(packet.entityKey);
        if (mode.rejectEntityTypes && packet.entityType !== undefined) {
          throw new EvidenceCoverageError("entityType is not allowed without configured entity types");
        }
        if (packet.entityType !== undefined
          && mode.allowedEntityTypes !== undefined
          && !mode.allowedEntityTypes.has(packet.entityType)) {
          throw new EvidenceCoverageError(`Unknown configured entity type "${packet.entityType}"`);
        }
        for (const range of packet.exactSourceRanges) assertLocalRange(range, chunk);
      }
    } catch (error) {
      addSchemaIssue(ctx, error instanceof Error ? error.message : "Invalid evidence map");
    }
  }));
}

function reducerSchemaFor(expected: EntityEvidence) {
  const wireSchema = expected.entityType === undefined
    ? UntypedEntityEvidenceWireSchema
    : EntityEvidenceSchema;
  return structuredWireSchema(wireSchema.superRefine((value, ctx) => {
    try { assertReducedEntity(expected, value); } catch (error) {
      addSchemaIssue(ctx, error instanceof Error ? error.message : "Invalid reduced evidence");
    }
  }));
}

function assertReducedEntity(expected: EntityEvidence, actual: EntityEvidence): void {
  if (actual.entityKey !== expected.entityKey || actual.entityType !== expected.entityType) {
    throw new EvidenceReducerError("Reduced evidence changed entity identity");
  }
  if (actual.packetIds.length !== expected.packetIds.length
    || new Set(actual.packetIds).size !== actual.packetIds.length
    || actual.packetIds.some((id, index) => id !== expected.packetIds[index])) {
    const missing = expected.packetIds.filter((id) => !actual.packetIds.includes(id));
    throw new EvidenceReducerError(`Reduced evidence packet coverage mismatch: ${missing.join(", ") || "extra IDs"}`);
  }
  if (JSON.stringify(actual.facts) !== JSON.stringify(expected.facts)) {
    throw new EvidenceReducerError("Reduced evidence contains invented or missing facts");
  }
  if (JSON.stringify(actual.exactSourceRanges) !== JSON.stringify(expected.exactSourceRanges)) {
    throw new EvidenceReducerError("Reduced evidence contains invented or missing exact source ranges");
  }
  if (JSON.stringify(actual.exactSource) !== JSON.stringify(expected.exactSource)) {
    throw new EvidenceReducerError("Reduced evidence changed exact source");
  }
  if (JSON.stringify(actual.links) !== JSON.stringify(expected.links)) {
    throw new EvidenceReducerError("Reduced evidence contains invented or missing links");
  }
}

function compressionOf(policy: EvidencePolicy): CompressionProfile {
  return policy.compressionProfile ?? policy.compression ?? "balanced";
}

function messagesForMapper(
  prompt: string,
  chunk: SourceChunk,
  domainId: string,
  mode: EvidenceMappingMode,
  source: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const configuredTypes = mode.rejectEntityTypes
    ? "none"
    : mode.allowedEntityTypes === undefined
      ? "unspecified"
      : [...mode.allowedEntityTypes].join(", ") || "none";
  const originalLines = sourceLines(source).slice(chunk.startLine - 1, chunk.endLine);
  const numberedLines = originalLines.map((line, index) => `CHUNK_LINE ${index + 1} | ${line}`);
  return [
    { role: "system", content: prompt.replace("{{domain_name}}", domainId) },
    {
      role: "user",
      content: `CONFIGURED_ENTITY_TYPES ${configuredTypes}\nCHUNK_ID ${chunk.id} START ${chunk.startLine} END ${chunk.endLine}\nSOURCE CHUNK:\n${numberedLines.join("\n")}`,
    },
  ];
}

interface MapperRequestDetails {
  hash: string;
  estimatedInputTokens: number;
  rawBytes: number;
  lineCount: number;
}

function mapperRequestDetails(
  source: string,
  chunk: SourceChunk,
  domainId: string,
  mode: EvidenceMappingMode,
  policy: EvidencePolicy,
  opts: LlmCallOptions,
): MapperRequestDetails {
  const messages = messagesForMapper(mapPrompt, chunk, domainId, mode, source);
  const mapperOpts = taskLlmOptions(opts, policy, policy.inputBudgetTokens);
  const prepared = prepareChatMessages(messages, mapperOpts);
  const original = sourceLines(source).slice(chunk.startLine - 1, chunk.endLine).join("\n");
  return {
    hash: JSON.stringify(prepared),
    estimatedInputTokens: estimateStructuredRequest(messages, mapperOpts, policy.mapperRetries ?? 1),
    rawBytes: new TextEncoder().encode(original).byteLength,
    lineCount: chunk.endLine - chunk.startLine + 1,
  };
}

function estimateLlmMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): number {
  return estimatePreparedMessages(prepareChatMessages(messages, opts));
}

const STRUCTURED_REPAIR_INSTRUCTION = "STRUCTURED_REPAIR: Return only the required JSON object; preserve all supplied evidence coverage exactly.";

function structuredRepairMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    ...messages,
    { role: "user", content: STRUCTURED_REPAIR_INSTRUCTION },
  ];
}

function estimateStructuredRequest(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  retries: number,
): number {
  const base = estimateLlmMessages(messages, opts);
  if (retries <= 0) return base;
  return Math.max(base, estimateLlmMessages(structuredRepairMessages(messages), opts));
}

async function runBoundedStructuredWithRetry<T>(
  args: RunStructuredArgs<T>,
): Promise<RunStructuredResult<T>> {
  let messages = args.baseMessages;
  for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
    try {
      return await runStructuredWithRetry({
        ...args,
        baseMessages: messages,
        maxRetries: 0,
        lifecycle: attempt === 0
          ? args.lifecycle
          : { ...args.lifecycle, id: `${args.lifecycle.id}:bounded-${attempt}` },
        validationExhaustionPhase: attempt === args.maxRetries ? "failed" : "retrying",
      });
    } catch (error) {
      if (!(error instanceof StructuredValidationError)) throw error;
      if (attempt === args.maxRetries) {
        throw new StructuredValidationError(
          args.callSite,
          args.maxRetries + 1,
          error.lastError,
        );
      }
      messages = structuredRepairMessages(args.baseMessages);
    }
  }
  throw new Error("unreachable bounded structured retry state");
}

function forwardEvidenceStructuredEvent(
  runtime: EvidenceRuntime,
  event: RunEvent,
): void {
  if (event.kind === "structural_error") {
    runtime.onEvent?.({
      ...event,
      message: "Structured output validation event",
    });
  } else if (
    event.kind === "llm_lifecycle"
    || event.kind === "assistant_text"
    || event.kind === "rule_fired"
    || event.kind === "llm_call_stats"
    || event.kind === "prompt_budget"
  ) {
    runtime.onEvent?.(event);
  }
}

function taskLlmOptions(
  opts: LlmCallOptions,
  policy: EvidencePolicy,
  inputBudgetTokens: number,
): LlmCallOptions {
  const result: LlmCallOptions = {
    ...opts,
    inputBudgetTokens,
    semanticCompression: { profile: compressionOf(policy), operation: "ingest" },
  };
  if (policy.outputBudgetTokens !== undefined) result.maxTokens = policy.outputBudgetTokens;
  return result;
}

function assertReducerOutputFits(
  units: EvidenceUnit[],
  depth: number,
  outputBudget?: number,
): void {
  if (outputBudget === undefined) return;
  const expectedBytes = new TextEncoder().encode(JSON.stringify(evidenceFromUnits(units))).byteLength;
  const outputBytes = outputBudget;
  if (expectedBytes > outputBytes) {
    throw new EvidenceReducerError(
      `Reducer expected output at depth ${depth} requires ${expectedBytes} bytes and exceeds ${outputBytes} byte output budget`,
    );
  }
}

export function chunkSourceForEvidence(
  source: string,
  domainId: string,
  policy: EvidencePolicy,
  opts: LlmCallOptions = {},
  configuredEntityTypes?: string[],
): SourceChunk[] {
  ensurePolicy(policy);
  if (source.length === 0) return [];
  const normalizedEntityTypes = configuredEntityTypes ?? [];
  const mode: EvidenceMappingMode = {
    rejectEntityTypes: normalizedEntityTypes.length === 0,
    allowedEntityTypes: new Set(normalizedEntityTypes),
  };
  const initialRequestBudget = policy.inputBudgetTokens;
  if (initialRequestBudget <= 0) {
    throw new EvidenceCoverageError("Mapper prompt and repair reserve exceed the input budget");
  }
  const planned = findLargestFeasibleBudget<SourceChunk[]>(1, initialRequestBudget, (chunkBudget) => {
    let chunks: SourceChunk[];
    try {
      chunks = chunkMarkdownSource(source, {
        maxEstimatedTokens: chunkBudget,
        overlapLines: policy.overlapLines ?? 0,
      });
    } catch {
      return { kind: "too-small" as const };
    }
    const estimates = chunks.map((chunk) => estimateStructuredRequest(
      messagesForMapper(mapPrompt, chunk, domainId, mode, source),
      taskLlmOptions(opts, policy, policy.inputBudgetTokens),
      policy.mapperRetries ?? 1,
    ));
    const largest = Math.max(...estimates);
    return largest <= initialRequestBudget
      ? { kind: "feasible" as const, value: chunks }
      : { kind: "too-large" as const };
  });
  if (planned !== undefined) return planned.value;
  throw new EvidenceCoverageError("Unable to derive a bounded mapper chunk size from the prepared request estimator");
}

function messagesForReducer(units: EvidenceUnit[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: "system", content: `${reducePrompt}\nREDUCE_EVIDENCE` },
    { role: "user", content: `REDUCE_INPUT ${JSON.stringify(units)}` },
  ];
}

function ensurePolicy(policy: EvidencePolicy): void {
  if (!Number.isSafeInteger(policy.inputBudgetTokens) || policy.inputBudgetTokens <= 0) {
    throw new EvidenceCoverageError("Evidence input budget must be a positive safe integer");
  }
  if (policy.outputBudgetTokens !== undefined
    && (!Number.isSafeInteger(policy.outputBudgetTokens) || policy.outputBudgetTokens <= 0)) {
    throw new EvidenceCoverageError("Evidence output budget must be a positive safe integer");
  }
}

function ensureOutputBudget(policy: EvidencePolicy, opts: LlmCallOptions | undefined): void {
  if (policy.outputBudgetTokens !== undefined
    && opts?.maxTokens !== undefined
    && opts.maxTokens !== policy.outputBudgetTokens) {
    throw new EvidenceCoverageError(
      `runtime.opts.maxTokens ${opts.maxTokens} conflicts with outputBudgetTokens ${policy.outputBudgetTokens}`,
    );
  }
}

export function findLargestFeasibleBudget<T>(
  minimum: number,
  maximum: number,
  evaluate: (budget: number) =>
    | { kind: "too-small" }
    | { kind: "too-large" }
    | { kind: "feasible"; value: T },
): { budget: number; value: T } | undefined {
  let low = minimum;
  let high = maximum;
  let feasible: { budget: number; value: T } | undefined;
  while (low <= high) {
    const budget = low + Math.floor((high - low) / 2);
    const result = evaluate(budget);
    if (result.kind === "too-small") low = budget + 1;
    else if (result.kind === "too-large") high = budget - 1;
    else {
      feasible = { budget, value: result.value };
      low = budget + 1;
    }
  }
  return feasible;
}

interface RequestTelemetry {
  callSite: "ingest.evidence-map" | "ingest.evidence-reduce" | "init.bootstrap-map";
  configuredInputBudget: number;
  effectiveInputBudget: number;
  outputBudget?: number;
  compressionProfile: CompressionProfile;
  contextUnits: number;
  sourceChunks: number;
  reductionDepth: number;
}

function llmWithRequestTelemetry(
  runtime: EvidenceRuntime,
  metadata: RequestTelemetry,
): LlmClient {
  const completions = runtime.llm.chat.completions;
  let pendingRequestId: string | undefined;
  function createWithTelemetry(
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    requestOpts?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>;
  function createWithTelemetry(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOpts?: { signal?: AbortSignal },
  ): Promise<OpenAI.Chat.ChatCompletion>;
  async function createWithTelemetry(
    params:
      | OpenAI.Chat.ChatCompletionCreateParamsStreaming
      | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOpts?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion> {
    const estimatedInputTokens = estimatePreparedMessages(params.messages);
    if (estimatedInputTokens > metadata.effectiveInputBudget) {
      throw new PromptBudgetExceededError(
        metadata.effectiveInputBudget,
        estimatedInputTokens,
        [],
      );
    }
    const requestId = pendingRequestId;
    pendingRequestId = undefined;
    if (!requestId) {
      throw new Error(`Missing requestId for ${metadata.callSite} prompt budget telemetry`);
    }
    let error: unknown;
    try {
      return params.stream
        ? await completions.create(params, requestOpts)
        : await completions.create(params, requestOpts);
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      const event = createPromptBudgetEvent({
        requestId,
        callSite: metadata.callSite,
        configuredInputBudget: metadata.configuredInputBudget,
        effectiveInputBudget: metadata.effectiveInputBudget,
        estimatedInputTokens,
        outputBudget: metadata.outputBudget,
        compressionProfile: metadata.compressionProfile,
        contextUnits: metadata.contextUnits,
        sourceChunks: metadata.sourceChunks,
        reductionDepth: metadata.reductionDepth,
        retryReason: classifyContextError(error) === null
          ? undefined
          : "provider_context_error",
      });
      if (event.retryReason === undefined) runtime.onEvent?.(event);
      else forwardContextRepackProgress(runtime, event);
    }
  }
  return {
    emitsPromptBudget: true,
    beginPromptBudgetRequest: (requestId) => {
      pendingRequestId = requestId;
    },
    chat: {
      completions: {
        create: createWithTelemetry,
      },
    },
  };
}

function forwardContextRepackProgress(
  runtime: EvidenceRuntime,
  event: Extract<RunEvent, { kind: "prompt_budget" }>,
): void {
  if (event.retryReason === undefined) return;
  runtime.onEvent?.(event);
  runtime.onEvent?.({
    kind: "tool_use",
    name: "Evidence context repack",
    input: {
      callSite: event.callSite,
      retryReason: event.retryReason,
      effectiveInputBudget: event.effectiveInputBudget,
      contextUnits: event.contextUnits,
      sourceChunks: event.sourceChunks,
      reductionDepth: event.reductionDepth,
    },
  });
  runtime.onEvent?.({ kind: "tool_result", ok: true, preview: "retry scheduled" });
}

async function mapChunk(
  source: string,
  domainId: string,
  chunk: SourceChunk,
  totalChunks: number,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
  mode: EvidenceMappingMode,
): Promise<VerifiedEvidencePacket[]> {
  const configuredBudget = policy.inputBudgetTokens;
  const mapCallSite = runtime.mapCallSite ?? "ingest.evidence-map";
  const opts = { ...(runtime.opts ?? {}), inputBudgetTokens: configuredBudget };
  try {
    const messages = messagesForMapper(mapPrompt, chunk, domainId, mode, source);
    const mapperOpts = taskLlmOptions(opts, policy, configuredBudget);
    const estimatedInputTokens = estimateStructuredRequest(messages, mapperOpts, policy.mapperRetries ?? 1);
    if (estimatedInputTokens > configuredBudget) {
      throw new PromptBudgetExceededError(configuredBudget, estimatedInputTokens, []);
    }
    const result = await runBoundedStructuredWithRetry<{
      packets: EvidencePacket[];
      noEvidence: NoEvidence[];
    }>({
      llm: llmWithRequestTelemetry(runtime, {
        callSite: mapCallSite,
        configuredInputBudget: configuredBudget,
        effectiveInputBudget: configuredBudget,
        outputBudget: policy.outputBudgetTokens,
        compressionProfile: compressionOf(policy),
        contextUnits: 1,
        sourceChunks: totalChunks,
        reductionDepth: 0,
      }),
      model: runtime.model,
      baseMessages: messages,
      opts: mapperOpts,
      profile: { kind: "json-zod", schema: mapperSchemaFor(chunk, mode) },
      maxRetries: policy.mapperRetries ?? 1,
      callSite: mapCallSite,
      lifecycle: createLlmLifecycle("extract_source_facts"),
      signal: runtime.signal ?? new AbortController().signal,
      onEvent: (event) => forwardEvidenceStructuredEvent(runtime, event),
      transport: "non-stream",
      contextErrorsRetry: true,
    });
    let mapped: VerifiedEvidencePacket[];
    try {
      mapped = validateEvidenceMap(
        { chunk, packets: result.value.packets, noEvidence: result.value.noEvidence },
        source,
      ).map((packet) => ({ ...packet, id: `${chunk.id}:${packet.id}` }));
    } catch (error) {
      runtime.onEvent?.(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, "failed"));
      throw error;
    }
    runtime.onEvent?.(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, "applying"));
    runtime.onEvent?.(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, "completed"));
    return mapped;
  } catch (error) {
    if (error instanceof EvidenceCoverageError) throw error;
    if (classifyContextError(error) !== null) throw error;
    throw new EvidenceCoverageError(
      `Evidence mapper failed for chunk ${chunk.id}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function rechunkMapperSourceForRetry(
  source: string,
  domainId: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
  mode: EvidenceMappingMode,
  maximumRawBudget: number,
  effectiveInputBudget: number,
): SourceChunk[] {
  const planned = findLargestFeasibleBudget<SourceChunk[]>(1, Math.min(maximumRawBudget, effectiveInputBudget), (rawBudget) => {
    let chunks: SourceChunk[];
    try {
      chunks = chunkMarkdownSource(source, {
        maxEstimatedTokens: rawBudget,
        overlapLines: policy.overlapLines ?? 0,
      });
    } catch {
      return { kind: "too-small" as const };
    }
    const mapperOpts = taskLlmOptions(runtime.opts ?? {}, policy, effectiveInputBudget);
    const largest = Math.max(...chunks.map((chunk) => estimateStructuredRequest(
      messagesForMapper(mapPrompt, chunk, domainId, mode, source), mapperOpts, policy.mapperRetries ?? 1,
    )));
    return largest <= effectiveInputBudget
      ? { kind: "feasible" as const, value: chunks }
      : { kind: "too-large" as const };
  });
  if (planned === undefined) {
    throw new EvidenceCoverageError("Mapper context retry cannot derive a smaller fitting source chunk");
  }
  return planned.value;
}

async function mapChunksWithContextRepack(
  source: string,
  domainId: string,
  initialChunks: SourceChunk[],
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
  mode: EvidenceMappingMode,
): Promise<{ chunks: SourceChunk[]; packets: VerifiedEvidencePacket[]; noEvidence: NoEvidence[] }> {
  const configuredBudget = policy.inputBudgetTokens;
  const mapCallSite = runtime.mapCallSite ?? "ingest.evidence-map";
  const configuredTypes = mode.rejectEntityTypes ? [] : [...(mode.allowedEntityTypes ?? [])];
  let failedMapper: (MapperRequestDetails & Pick<SourceChunk, "id" | "startLine" | "endLine">) | undefined;
  return runWithContextRepack({
    requestBudgetsEmittedByExecute: true,
    callSite: mapCallSite,
    configuredInputBudget: configuredBudget,
    outputBudget: policy.outputBudgetTokens,
    compressionProfile: compressionOf(policy),
    build: (effectiveInputBudget) => {
      const effectivePolicy = { ...policy, inputBudgetTokens: effectiveInputBudget };
      let chunks: SourceChunk[];
      if (failedMapper === undefined && effectiveInputBudget === configuredBudget) {
        chunks = initialChunks;
      } else if (failedMapper === undefined) {
        chunks = chunkSourceForEvidence(source, domainId, effectivePolicy, runtime.opts ?? {}, configuredTypes);
      } else {
        const forcedRawBudget = failedMapper.rawBytes - 1;
        if (forcedRawBudget <= 0) {
          throw new EvidenceCoverageError(`Mapper chunk ${failedMapper.id} cannot be split into a smaller original-source range`);
        }
        chunks = rechunkMapperSourceForRetry(
          source,
          domainId,
          effectivePolicy,
          runtime,
          mode,
          forcedRawBudget,
          effectiveInputBudget,
        );
      }
      assertCompleteSourceCoverage(source, chunks);
      const mapperOpts = taskLlmOptions(runtime.opts ?? {}, policy, effectiveInputBudget);
      const estimates = chunks.map((chunk) => estimateStructuredRequest(
        messagesForMapper(mapPrompt, chunk, domainId, mode, source),
        mapperOpts,
        policy.mapperRetries ?? 1,
      ));
      const estimatedInputTokens = Math.max(...estimates);
      if (estimatedInputTokens > effectiveInputBudget) {
        throw new PromptBudgetExceededError(effectiveInputBudget, estimatedInputTokens, []);
      }
      if (failedMapper !== undefined) {
        const replacements = chunks.filter((chunk) => chunk.endLine >= failedMapper!.startLine
          && chunk.startLine <= failedMapper!.endLine);
        if (replacements.length === 0) {
          throw new EvidenceCoverageError(`Mapper failed chunk ${failedMapper.id} has no replacement range`);
        }
        const replacementDetails = replacements.map((chunk) => mapperRequestDetails(
          source, chunk, domainId, mode, effectivePolicy, runtime.opts ?? {},
        ));
        if (replacementDetails.some((details) => details.hash === failedMapper!.hash)
          || Math.max(...replacementDetails.map((details) => details.estimatedInputTokens))
            >= failedMapper.estimatedInputTokens) {
          throw new EvidenceCoverageError(`Mapper retry for chunk ${failedMapper.id} did not make strict progress`);
        }
      }
      return {
        value: { chunks, effectiveInputBudget },
        estimatedInputTokens,
        contextUnits: chunks.length,
        sourceChunks: chunks.length,
        reductionDepth: 0,
      };
    },
    execute: async ({ chunks, effectiveInputBudget }) => {
      const effectivePolicy = { ...policy, inputBudgetTokens: effectiveInputBudget };
      const packets: VerifiedEvidencePacket[] = [];
      const noEvidence: NoEvidence[] = [];
      for (const chunk of chunks) {
        const details = mapperRequestDetails(source, chunk, domainId, mode, effectivePolicy, runtime.opts ?? {});
        let mapped: VerifiedEvidencePacket[];
        try {
          mapped = await mapChunk(source, domainId, chunk, chunks.length, effectivePolicy, runtime, mode);
        } catch (error) {
          if (classifyContextError(error) !== null) {
            failedMapper = { ...details, id: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine };
          }
          throw error;
        }
        if (mapped.length === 0) noEvidence.push({ chunkId: chunk.id, reason: "No domain evidence" });
        packets.push(...mapped);
      }
      return { chunks, packets, noEvidence };
    },
    onEvent: (event) => forwardContextRepackProgress(runtime, event),
  });
}

function reducerFits(units: EvidenceUnit[], budget: number, opts: LlmCallOptions, retries: number): boolean {
  return estimateStructuredRequest(messagesForReducer(units), opts, retries) <= budget;
}

export function partitionUnits(
  units: EvidenceUnit[],
  budget: number,
  opts: LlmCallOptions,
  retries: number,
  onEstimate?: () => void,
  maxBatchUnits?: number,
): EvidenceUnit[][] {
  if (maxBatchUnits !== undefined && (!Number.isSafeInteger(maxBatchUnits) || maxBatchUnits <= 0)) {
    throw new EvidenceReducerError("Reducer retry batch limit must be positive");
  }
  const batches: EvidenceUnit[][] = [];
  let start = 0;
  while (start < units.length) {
    onEstimate?.();
    if (!reducerFits([units[start]], budget, opts, retries)) {
      throw new EvidenceReducerError(`A single evidence packet cannot fit the reducer budget (${packetIdsOf(units[start]).join(", ")})`);
    }
    let low = start + 1;
    let high = Math.min(units.length, start + (maxBatchUnits ?? units.length));
    let end = start + 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      onEstimate?.();
      if (reducerFits(units.slice(start, middle), budget, opts, retries)) {
        end = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    batches.push(units.slice(start, end));
    start = end;
  }
  return batches;
}

async function reduceBatchOnce(
  units: EvidenceUnit[],
  totalChunks: number,
  depth: number,
  reducerBudget: number,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<EntityEvidence> {
  const expected = evidenceFromUnits(units);
  const configuredBudget = policy.inputBudgetTokens;
  try {
    const messages = messagesForReducer(units);
    const reducerOpts = taskLlmOptions(runtime.opts ?? {}, policy, reducerBudget);
    const estimatedInputTokens = estimateStructuredRequest(messages, reducerOpts, policy.reducerRetries ?? 1);
    if (estimatedInputTokens > reducerBudget) {
      throw new PromptBudgetExceededError(reducerBudget, estimatedInputTokens, []);
    }
    const response = await runBoundedStructuredWithRetry<EntityEvidence>({
      llm: llmWithRequestTelemetry(runtime, {
        callSite: "ingest.evidence-reduce",
        configuredInputBudget: configuredBudget,
        effectiveInputBudget: reducerBudget,
        outputBudget: policy.outputBudgetTokens,
        compressionProfile: compressionOf(policy),
        contextUnits: units.length,
        sourceChunks: totalChunks,
        reductionDepth: depth,
      }),
      model: runtime.model,
      baseMessages: messages,
      opts: reducerOpts,
      profile: { kind: "json-zod", schema: reducerSchemaFor(expected) },
      maxRetries: policy.reducerRetries ?? 1,
      callSite: "ingest.evidence-reduce",
      lifecycle: createLlmLifecycle("reduce_source_evidence"),
      signal: runtime.signal ?? new AbortController().signal,
      onEvent: (event) => forwardEvidenceStructuredEvent(runtime, event),
      transport: "non-stream",
      contextErrorsRetry: true,
    });
    try {
      assertReducedEntity(expected, response.value);
      if (JSON.stringify(response.value).length >= JSON.stringify(units).length) {
        throw new EvidenceReducerError(`Reducer non-progress at depth ${depth}`);
      }
    } catch (error) {
      runtime.onEvent?.(lifecycleEvent(response.lifecycle.id, response.lifecycle.action, "failed"));
      throw error;
    }
    runtime.onEvent?.(lifecycleEvent(response.lifecycle.id, response.lifecycle.action, "applying"));
    runtime.onEvent?.(lifecycleEvent(response.lifecycle.id, response.lifecycle.action, "completed"));
    return response.value;
  } catch (error) {
    if (error instanceof EvidenceReducerError) throw error;
    if (classifyContextError(error) !== null) throw error;
    throw new EvidenceReducerError(
      `Evidence reducer failed at depth ${depth}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function reduceBatch(
  units: EvidenceUnit[],
  totalChunks: number,
  depth: number,
  reducerBudget: number,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<EntityEvidence[]> {
  const configuredBudget = policy.inputBudgetTokens;
  const retries = policy.reducerRetries ?? 1;
  let failedReducer: { hash: string; units: EvidenceUnit[]; estimatedInputTokens: number } | undefined;
  return runWithContextRepack({
    requestBudgetsEmittedByExecute: true,
    callSite: "ingest.evidence-reduce",
    configuredInputBudget: configuredBudget,
    outputBudget: policy.outputBudgetTokens,
    compressionProfile: compressionOf(policy),
    build: (effectiveInputBudget) => {
      const budget = Math.min(reducerBudget, effectiveInputBudget);
      const reducerOpts = taskLlmOptions(runtime.opts ?? {}, policy, budget);
      const maxBatchUnits = failedReducer === undefined ? undefined : failedReducer.units.length - 1;
      if (maxBatchUnits !== undefined && maxBatchUnits <= 0) {
        throw new EvidenceReducerError("Reducer context retry cannot split a single-unit batch");
      }
      const batches = partitionUnits(units, budget, reducerOpts, retries, undefined, maxBatchUnits);
      batches.forEach((batch) => assertReducerOutputFits(batch, depth, policy.outputBudgetTokens));
      const estimates = batches.map((batch) => estimateStructuredRequest(
        messagesForReducer(batch), reducerOpts, retries,
      ));
      if (failedReducer !== undefined) {
        const failedIds = new Set(packetIdsOf(failedReducer.units[0]));
        const replacements = batches.filter((batch) => batch.some((item) => packetIdsOf(item).some((id) => failedIds.has(id))));
        if (replacements.length === 0 || replacements.some((batch) => {
          const estimate = estimateStructuredRequest(messagesForReducer(batch), reducerOpts, retries);
          return estimate >= failedReducer!.estimatedInputTokens
            || JSON.stringify(messagesForReducer(batch)) === failedReducer!.hash;
        })) {
          throw new EvidenceReducerError("Reducer retry did not make strict progress");
        }
      }
      return {
        value: { batches, budget },
        estimatedInputTokens: Math.max(...estimates),
        contextUnits: batches.reduce((sum, batch) => sum + batch.length, 0),
        sourceChunks: totalChunks,
        reductionDepth: depth,
      };
    },
    execute: async ({ batches, budget }) => {
      const reduced: EntityEvidence[] = [];
      for (const batch of batches) {
        const messages = messagesForReducer(batch);
        const details = {
          hash: JSON.stringify(messages),
          units: [...batch],
          estimatedInputTokens: estimateStructuredRequest(
            messages,
            taskLlmOptions(runtime.opts ?? {}, policy, budget),
            retries,
          ),
        };
        try {
          reduced.push(await reduceBatchOnce(batch, totalChunks, depth, budget, policy, runtime));
        } catch (error) {
          if (classifyContextError(error) !== null) failedReducer = details;
          throw error;
        }
      }
      return reduced;
    },
    onEvent: (event) => forwardContextRepackProgress(runtime, event),
  });
}

async function reduceUntilBounded(
  units: EvidenceUnit[],
  totalChunks: number,
  depth: number,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<EntityEvidence> {
  const aggregate = evidenceFromUnits(units);
  const reducerOpts = taskLlmOptions(runtime.opts ?? {}, policy, policy.inputBudgetTokens);
  const reducerRetries = policy.reducerRetries ?? 1;
  const combinedFits = reducerFits(units, policy.inputBudgetTokens, reducerOpts, reducerRetries);
  if (depth === 0 && combinedFits) return aggregate;
  if (depth > 0 && units.length === 1 && combinedFits && isEntityEvidence(units[0])) {
    return units[0];
  }
  if (depth >= (policy.maxReductionDepth ?? 8)) {
    throw new EvidenceReducerError(`Maximum evidence reduction depth ${depth} reached`);
  }
  const reducerBudget = policy.inputBudgetTokens;
  if (reducerBudget <= 0) {
    throw new EvidenceReducerError("Reducer prompt and repair reserve exceed the input budget");
  }
  const batches = partitionUnits(units, reducerBudget, reducerOpts, reducerRetries);
  if (batches.length >= units.length) {
    throw new EvidenceReducerError(`Reducer made no progress at depth ${depth}`);
  }
  for (const batch of batches) {
    assertReducerOutputFits(batch, depth + 1, policy.outputBudgetTokens);
  }
  const reduced: EntityEvidence[] = [];
  for (const batch of batches) {
    reduced.push(...await reduceBatch(
      batch, totalChunks, depth + 1, reducerBudget, policy, runtime,
    ));
  }
  if (reduced.length >= units.length) {
    throw new EvidenceReducerError(`Reducer did not shrink packet groups at depth ${depth}`);
  }
  return reduceUntilBounded(reduced, totalChunks, depth + 1, policy, runtime);
}

async function prepareSourceEvidenceInternal(
  source: string,
  domainId: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
  mode: EvidenceMappingMode,
): Promise<EntityEvidence[]> {
  ensurePolicy(policy);
  ensureOutputBudget(policy, runtime.opts);
  const configuredTypes = mode.rejectEntityTypes
    ? []
    : mode.allowedEntityTypes === undefined
      ? undefined
      : [...mode.allowedEntityTypes];
  const chunks = chunkSourceForEvidence(
    source,
    domainId,
    policy,
    runtime.opts ?? {},
    configuredTypes,
  );
  assertCompleteSourceCoverage(source, chunks);
  if (chunks.length === 0) return [];
  const mappedSource = await mapChunksWithContextRepack(source, domainId, chunks, policy, runtime, mode);
  const finalChunks = mappedSource.chunks;
  const packets: VerifiedEvidencePacket[] = [];
  const noEvidence = mappedSource.noEvidence;
  const allMapped = mappedSource.packets;
  const configuredType = mode.allowedEntityTypes?.size === 1
    ? [...mode.allowedEntityTypes][0]
    : undefined;
  const observedTypes = new Map<string, Set<string>>();
  for (const packet of allMapped) {
    if (packet.entityType !== undefined) {
      const types = observedTypes.get(packet.entityKey) ?? new Set<string>();
      types.add(packet.entityType);
      observedTypes.set(packet.entityKey, types);
    }
  }
  for (const packet of allMapped) {
    const types = observedTypes.get(packet.entityKey) ?? new Set<string>();
    if (types.size > 1) {
      throw new EvidenceCoverageError(`Conflicting entity type for ${packet.entityKey}: ${[...types].join(", ")}`);
    }
    if (packet.entityType === undefined) {
      const inherited = [...types][0] ?? configuredType;
      if (inherited !== undefined) packet.entityType = inherited;
    }
    packets.push(packet);
  }
  const groups = new Map<string, VerifiedEvidencePacket[]>();
  for (const packet of packets) {
    const group = groups.get(packet.entityKey) ?? [];
    group.push(packet);
    groups.set(packet.entityKey, group);
  }
  assertCompleteSourceCoverage(source, finalChunks);
  buildEvidenceCoverage(finalChunks.map((chunk) => chunk.id), packets, noEvidence);
  const result: EntityEvidence[] = [];
  for (const group of groups.values()) {
    result.push(await reduceUntilBounded(group, finalChunks.length, 0, policy, runtime));
  }
  return result;
}

export async function prepareSourceEvidence(
  source: string,
  domainId: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<EntityEvidence[]> {
  const configuredEntityTypes = runtime.configuredEntityTypes ?? [];
  return prepareSourceEvidenceInternal(source, domainId, policy, runtime, {
    rejectEntityTypes: configuredEntityTypes.length === 0,
    allowedEntityTypes: new Set(configuredEntityTypes),
  });
}

export async function prepareBootstrapEvidence(
  source: string,
  provisionalDomainId: string,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<BootstrapEvidence> {
  const evidence = await prepareSourceEvidenceInternal(source, provisionalDomainId, policy, runtime, {
    rejectEntityTypes: true,
    allowedEntityTypes: new Set(),
  });
  const candidates = evidence.map(({ entityKey, packetIds, facts, exactSource }) => ({
    entityKey,
    packetIds: [...packetIds],
    facts: [...facts],
    exactSource: exactSource.map((range) => ({ ...range })),
  }));
  const domainThemes = unique(evidence.flatMap((item) => item.facts), (fact) => fact);
  const languageEvidence = unique(
    evidence.flatMap((item) => item.exactSource.map((range) => range.text)),
    (text) => text,
  );
  const result = { candidates, domainThemes, languageEvidence };
  const payloadBudget = Math.min(
    policy.inputBudgetTokens,
    policy.bootstrapPayloadBudgetTokens ?? policy.inputBudgetTokens,
  );
  if (!Number.isSafeInteger(payloadBudget) || payloadBudget <= 0) {
    throw new EvidenceCoverageError("Bootstrap payload budget must be a positive safe integer");
  }
  const estimated = estimatePreparedMessages([{ role: "user", content: JSON.stringify(result) }]);
  if (estimated > payloadBudget) {
    throw new EvidenceCoverageError(
      `Bootstrap evidence payload requires ${estimated} tokens but budget is ${payloadBudget}`,
    );
  }
  return result;
}
