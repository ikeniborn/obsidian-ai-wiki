import type OpenAI from "openai";
import {
  SynthesisActionSchema,
  SynthesisOutputSchema,
  type SynthesisOutput,
  type SynthesisAction,
} from "./zod-schemas";
import {
  normalizeSectionHeading,
  type ReplaceSectionAuthority,
} from "../section-patches";
import { contentHash } from "../content-hash";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";
import { validateArticlePath } from "../wiki-path";
import type { EntityContextBundle, WikiSectionUnit } from "../ingest-context";
import type { EntityEvidence } from "./ingest-evidence";
import {
  classifyContextError,
  estimatePreparedMessages,
  PromptBudgetExceededError,
  runWithContextRepack,
  type ContextUnit,
} from "../prompt-budget";
import type { LlmCallOptions, LlmClient, ModelCallPolicy, RunEvent } from "../types";
import { prepareChatMessages } from "./llm-utils";
import { createLlmLifecycle, runStructuredWithRetry, StructuredOutputTruncatedError, StructuredValidationError } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import synthesisPrompt from "../../prompts/ingest-synthesis.md";

export interface SynthesisCoverage {
  actions: readonly SynthesisAction[];
  skips: readonly { entityKey: string; reason: string }[];
}

export interface SynthesisActionValidationInput {
  existingPaths: ReadonlySet<string>;
  replaceAuthorities: ReadonlyMap<string, readonly ReplaceSectionAuthority[]>;
  actions: readonly unknown[];
  existingPageHashes: ReadonlyMap<string, string>;
  pathPolicy: SynthesisPathPolicy;
}

export interface SynthesisPageDescription {
  entityKey: string;
  path: string;
  description: string;
  entityType?: string;
}

export interface SynthesisPathPolicy {
  domainRoot: string;
  allowedSubfolders: readonly string[];
  allowedPaths?: readonly string[];
}

export interface SynthesisBatchInput {
  bundles: readonly EntityContextBundle[];
  existingPaths?: ReadonlySet<string>;
  existingPageHashes: ReadonlyMap<string, string>;
  existingPageDescriptions: readonly SynthesisPageDescription[];
  tagRegistryUnits: readonly ContextUnit[];
  pathPolicy: SynthesisPathPolicy;
  domainContract: string;
  schemaContract: string;
  pathContract: string;
  llm: LlmClient;
  model: string;
  policy: ModelCallPolicy;
  opts: LlmCallOptions;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
}

export interface ConflictRegenerationInput {
  entityKey: string;
  evidence: EntityEvidence;
  targetPath: string;
  pageHash: string;
  targetSections: readonly WikiSectionUnit[];
  replaceAuthorities: readonly ReplaceSectionAuthority[];
  pathPolicy: SynthesisPathPolicy;
  domainContract: string;
  schemaContract: string;
  pathContract: string;
  llm: LlmClient;
  model: string;
  policy: ModelCallPolicy;
  opts: LlmCallOptions;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
  conflictCount?: number;
}

export class SynthesisSplitRequiredError extends Error {
  constructor(public readonly entityKeys: readonly string[], message = "Synthesis context cannot fit one entity bundle") {
    super(message);
    this.name = "SynthesisSplitRequiredError";
  }
}

export class SynthesisStructuredError extends Error {
  constructor(public readonly entityKeys: readonly string[], public readonly cause: Error) {
    super(`Synthesis structured output exhausted for ${entityKeys.join(", ")}: ${cause.message}`, { cause });
    this.name = "SynthesisStructuredError";
  }
}

class SynthesisBatchValidationError extends Error {
  constructor(public readonly entityKeys: readonly string[], public readonly cause: Error) {
    super(`Synthesis batch validation failed for ${entityKeys.join(", ")}: ${cause.message}`, { cause });
    this.name = "SynthesisBatchValidationError";
  }
}

export class ConflictRegenerationExhaustedError extends Error {
  constructor(public readonly entityKey: string, public readonly cause: Error) {
    super(`Conflict regeneration rejected for ${entityKey}: ${cause.message}`, { cause });
    this.name = "ConflictRegenerationExhaustedError";
  }
}

export class ConflictStillStaleError extends Error {
  constructor(public readonly entityKey: string, public readonly cause: Error) {
    super(`Conflict remains stale for ${entityKey}: ${cause.message}`, { cause });
    this.name = "ConflictStillStaleError";
  }
}

function normalizeEntityKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || normalizeEntityKey(value).length === 0) {
    throw new TypeError(`${label} must be a normalized nonblank string`);
  }
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizedPath(value: unknown, policy: SynthesisPathPolicy): string {
  if (typeof value !== "string") throw new TypeError("path must be a string");
  const path = value.normalize("NFC").trim();
  const root = policy.domainRoot.normalize("NFC").trim();
  const rootParts = root.split("/");
  const allowed = new Set(policy.allowedSubfolders.map((folder) => folder.normalize("NFC").trim()));
  const allowedPaths = policy.allowedPaths?.map((candidate) => candidate.normalize("NFC").trim());
  if (root.length === 0 || rootParts.length !== 2 || rootParts[0] !== "!Wiki" || allowed.size === 0 || root.includes("//")
    || rootParts.some((part) => part.length === 0 || part === "." || part === "..")
    || [...allowed].some((folder) => folder.length === 0 || folder === "." || folder === ".." || /[\\/\0]/.test(folder))
    || path.length === 0 || path !== value
    || path.includes("\\") || path.includes("\0") || path.includes("//")) {
    throw new TypeError(`path must be a normalized nonblank canonical wiki path: ${value}`);
  }
  const parts = path.split("/");
  const stem = parts.at(-1)?.replace(/\.md$/, "") ?? "";
  if (!validateArticlePath(path, root)
    || parts.length !== rootParts.length + 2
    || parts.slice(0, rootParts.length).join("/") !== root
    || !allowed.has(parts[rootParts.length])
    || (allowedPaths !== undefined && !allowedPaths.includes(path))
    || !GENERIC_WIKI_STEM_REGEX.test(stem)) {
    throw new TypeError(`path is not a canonical wiki path: ${path}`);
  }
  const domain = rootParts.at(-1) ?? "";
  if (!stem.startsWith(`wiki_${domain}_`)) {
    throw new TypeError(`path entity stem does not match its domain: ${path}`);
  }
  return path;
}

function validatePathPolicy(policy: SynthesisPathPolicy): void {
  const base = { ...policy, allowedPaths: undefined };
  const rootParts = policy.domainRoot.normalize("NFC").trim().split("/");
  if (rootParts.length !== 2 || rootParts[0] !== "!Wiki" || rootParts[1].length === 0
    || policy.allowedSubfolders.length === 0) throw new TypeError("path policy must govern a !Wiki/<domain> root and allowed subfolders");
  for (const folder of policy.allowedSubfolders) {
    if (folder.length === 0 || folder.includes("/") || folder.includes("\\") || folder.includes("\0") || folder === "." || folder === "..") {
      throw new TypeError("path policy contains an invalid allowed subfolder");
    }
  }
  for (const path of policy.allowedPaths ?? []) normalizedPath(path, base);
}

function authorityIdentity(authority: ReplaceSectionAuthority): string {
  return [
    authority.path,
    normalizeSectionHeading(authority.heading),
    authority.sectionOrdinal,
  ].join("\u0000");
}

function validateAuthorityMap(
  authorities: ReadonlyMap<string, readonly ReplaceSectionAuthority[]>,
  pathPolicy: SynthesisPathPolicy,
): void {
  for (const [mapPath, records] of authorities) {
    const path = normalizedPath(mapPath, pathPolicy);
    const identities = new Map<string, string>();
    for (const authority of records) {
      if (normalizedPath(authority.path, pathPolicy) !== path) throw new TypeError("replace authority path conflicts with map path");
      requireNonBlank(authority.heading, "replace authority heading");
      if (!/^##[ \t]+[^\r\n]+$/.test(authority.heading) || normalizeSectionHeading(authority.heading).length === 0) {
        throw new TypeError("replace authority heading must be a single nonblank H2");
      }
      if (!Number.isSafeInteger(authority.sectionOrdinal) || authority.sectionOrdinal < 0) {
        throw new TypeError("replace authority ordinal must be a nonnegative safe integer");
      }
      const hash = requireNonBlank(authority.sectionHash, "replace authority hash");
      if (typeof authority.exactSection !== "string" || authority.exactSection.trim().length === 0) {
        throw new TypeError("replace authority exact section must be a normalized nonblank string");
      }
      const exactSection = authority.exactSection;
      if (contentHash(exactSection) !== hash) {
        throw new TypeError("replace authority hash does not match exact section");
      }
      const exactHeading = exactSection.split(/\r\n|\n|\r/, 1)[0] ?? "";
      if (normalizeSectionHeading(exactHeading) !== normalizeSectionHeading(authority.heading)) {
        throw new TypeError("replace authority heading does not match exact section");
      }
      const identity = authorityIdentity(authority);
      const fingerprint = `${hash}\u0000${exactSection}`;
      const previous = identities.get(identity);
      if (previous !== undefined) {
        throw new TypeError(previous === fingerprint
          ? "duplicate replace authority record"
          : "conflicting replace authority records");
      }
      identities.set(identity, fingerprint);
    }
  }
}

export function validateSynthesisCoverage(
  entityKeys: readonly string[],
  output: SynthesisCoverage,
): void {
  const expected = new Map<string, string>();
  for (const rawKey of entityKeys) {
    const key = normalizeEntityKey(requireNonBlank(rawKey, "entity key"));
    if (expected.has(key)) throw new TypeError(`duplicate expected entity key: ${key}`);
    expected.set(key, key);
  }
  const covered = new Set<string>();
  const cover = (rawKey: unknown, label: string) => {
    const key = normalizeEntityKey(requireNonBlank(rawKey, label));
    if (!expected.has(key)) throw new TypeError(`unknown entity key: ${key}`);
    if (covered.has(key)) throw new TypeError(`duplicate entity coverage: ${key}`);
    covered.add(key);
  };
  for (const action of output.actions) cover(action.entityKey, "action entity key");
  for (const skip of output.skips) {
    cover(skip.entityKey, "skip entity key");
    requireNonBlank(skip.reason, "skip reason");
  }
  const missing = [...expected.keys()].filter((key) => !covered.has(key));
  if (missing.length > 0) throw new TypeError(`missing entity coverage: ${missing.join(", ")}`);
}

export function validateSynthesisActions(input: SynthesisActionValidationInput): void {
  const pathPolicy = input.pathPolicy;
  validatePathPolicy(pathPolicy);
  validateAuthorityMap(input.replaceAuthorities, pathPolicy);
  for (const serverPath of input.existingPaths) normalizedPath(serverPath, pathPolicy);
  for (const serverPath of input.existingPageHashes.keys()) normalizedPath(serverPath, pathPolicy);
  const paths = new Set<string>();
  for (const [index, rawAction] of input.actions.entries()) {
    const parsed = SynthesisActionSchema.safeParse(rawAction);
    if (!parsed.success) throw new TypeError(`invalid synthesis action ${index}: ${parsed.error.message}`);
    const action = parsed.data;
    requireNonBlank(action.entityKey, `action ${index} entity key`);
    const path = normalizedPath(action.path, pathPolicy);
    if (paths.has(path)) throw new TypeError(`duplicate action path: ${path}`);
    paths.add(path);
    const exists = input.existingPaths.has(path) || input.existingPageHashes.has(path);
    if (action.kind === "create" && exists) throw new TypeError(`cannot create existing page: ${path}`);
    if (action.kind === "patch" && !exists) throw new TypeError(`cannot patch absent page: ${path}`);
    if (action.kind === "patch") {
      const expectedHash = input.existingPageHashes?.get(path);
      if (expectedHash === undefined || action.expectedPageHash !== expectedHash) {
        throw new TypeError(`patch page hash is not the server-owned current hash: ${path}`);
      }
    }
    if (action.kind === "patch") {
      const authorities = input.replaceAuthorities.get(path) ?? [];
      for (const section of action.sections) {
        const heading = normalizeSectionHeading(section.heading);
        if (section.operation !== "replace") continue;
        const expectedOrdinal = section.expectedSectionOrdinal;
        const expectedHash = section.expectedSectionHash;
        const authorized = authorities.some((record) => record.path === path
          && normalizeSectionHeading(record.heading) === heading
          && record.sectionOrdinal === expectedOrdinal
          && record.sectionHash === expectedHash);
        if (!authorized) throw new TypeError(`replace section lacks exact authority: ${path} ${heading}`);
      }
    }
  }
}

interface BuiltSynthesisRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  bundles: EntityContextBundle[];
  promptHash: string;
  estimatedInputTokens: number;
}

function boundedOptions(
  baseOpts: LlmCallOptions,
  policy: ModelCallPolicy,
  inputBudgetTokens: number,
): LlmCallOptions {
  const opts: LlmCallOptions = {
    ...baseOpts,
    inputBudgetTokens,
    semanticCompression: { profile: policy.compression, operation: "ingest" },
  };
  if (policy.outputBudgetTokens !== undefined) opts.maxTokens = policy.outputBudgetTokens;
  else delete opts.maxTokens;
  return opts;
}

function compressionOptions(input: SynthesisBatchInput, inputBudgetTokens: number): LlmCallOptions {
  return boundedOptions(input.opts, input.policy, inputBudgetTokens);
}

function jsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function pathPolicyDto(policy: SynthesisPathPolicy): Record<string, unknown> {
  return {
    domainRoot: policy.domainRoot,
    allowedSubfolders: [...policy.allowedSubfolders],
    ...(policy.allowedPaths === undefined ? {} : { allowedPaths: [...policy.allowedPaths] }),
  };
}

function evidenceDto(evidence: EntityEvidence): Record<string, unknown> {
  return {
    entityKey: evidence.entityKey,
    entityType: evidence.entityType,
    packetIds: [...evidence.packetIds],
    facts: [...evidence.facts],
    exactSourceRanges: evidence.exactSourceRanges.map((range) => ({ startLine: range.startLine, endLine: range.endLine })),
    exactSource: evidence.exactSource.map((source) => ({
      startLine: source.startLine, endLine: source.endLine, text: source.text,
    })),
    links: [...evidence.links],
  };
}

function unitDto(unit: WikiSectionUnit): Record<string, unknown> {
  return {
    id: unit.id,
    source: unit.source,
    text: unit.text,
    required: unit.required,
    priority: unit.priority,
    estimatedTokens: unit.estimatedTokens,
    pageId: unit.pageId,
    path: unit.path,
    heading: unit.heading,
    sectionHash: unit.sectionHash,
    score: unit.score,
    sourceOrdinal: unit.sourceOrdinal,
    duplicatePaths: [...unit.duplicatePaths],
  };
}

function authorityDto(authority: ReplaceSectionAuthority): Record<string, unknown> {
  return {
    path: authority.path,
    heading: authority.heading,
    sectionOrdinal: authority.sectionOrdinal,
    sectionHash: authority.sectionHash,
    exactSection: authority.exactSection,
  };
}

function descriptionDto(description: SynthesisPageDescription): Record<string, unknown> {
  return {
    entityKey: description.entityKey,
    path: description.path,
    description: description.description,
    entityType: description.entityType,
  };
}

function registryDto(unit: ContextUnit): Record<string, unknown> {
  return {
    id: unit.id,
    source: unit.source,
    text: unit.text,
    required: unit.required,
    priority: unit.priority,
    estimatedTokens: unit.estimatedTokens,
  };
}

function relevantPageDescriptions(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
): readonly SynthesisPageDescription[] {
  const keys = new Set(bundles.map((bundle) => normalizeEntityKey(bundle.entityKey)));
  const paths = new Set(bundles.flatMap((bundle) => bundle.units.map((unit) => unit.path)));
  return input.existingPageDescriptions.filter((page) =>
    keys.has(normalizeEntityKey(page.entityKey)) || paths.has(page.path));
}

function cloneBundle(bundle: EntityContextBundle): EntityContextBundle {
  return {
    ...bundle,
    evidence: {
      ...bundle.evidence,
      packetIds: [...bundle.evidence.packetIds],
      facts: [...bundle.evidence.facts],
      exactSourceRanges: bundle.evidence.exactSourceRanges.map((range) => ({ ...range })),
      exactSource: bundle.evidence.exactSource.map((source) => ({ ...source })),
      links: [...bundle.evidence.links],
    },
    units: bundle.units.map((unit) => ({ ...unit, duplicatePaths: [...unit.duplicatePaths] })),
    replaceAuthorities: bundle.replaceAuthorities.map((authority) => ({ ...authority })),
  };
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function renderSynthesisMessages(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
  opts: LlmCallOptions,
  selectedOptionalIds?: ReadonlySet<string>,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const relevantDescriptions = relevantPageDescriptions(input, bundles)
    .filter((description) => selectedOptionalIds === undefined || selectedOptionalIds.has(`description:${description.path}`));
  const registryUnits = input.tagRegistryUnits
    .filter((unit) => unit.required || selectedOptionalIds === undefined || selectedOptionalIds.has(`registry:${unit.id}`));
  const bundleText = bundles.map((bundle) => [
    `Entity bundle: entity-${bundle.entityKey}`,
    jsonForPrompt({
      entityKey: bundle.entityKey,
      targets: [...new Set(bundle.units.map((unit) => unit.path))]
        .map((path) => ({ path, pageHash: input.existingPageHashes.get(path) }))
        .filter((target) => target.pageHash !== undefined),
      page: bundle.units.filter((unit) => unit.required).map(unitDto),
      evidence: evidenceDto(bundle.evidence),
      units: bundle.units.map(unitDto),
      replaceAuthorities: bundle.replaceAuthorities.map(authorityDto),
    }),
  ].join("\n")).join("\n\n");
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{
    role: "user",
    content: synthesisPrompt
      .replace("{{domain_contract}}", input.domainContract)
      .replace("{{schema_contract}}", input.schemaContract)
      .replace("{{path_contract}}", `${input.pathContract}\nGoverned path policy: ${jsonForPrompt(pathPolicyDto(input.pathPolicy))}`)
      .replace("{{entity_context_bundles}}", bundleText)
      .replace("{{page_descriptions}}", jsonForPrompt(relevantDescriptions.map(descriptionDto)))
      .replace("{{tag_registry_units}}", jsonForPrompt(registryUnits.map(registryDto))),
  }];
  void opts;
  return messages;
}

function existingPathsFor(input: SynthesisBatchInput): ReadonlySet<string> {
  return new Set([
    ...(input.existingPaths ?? []),
    ...input.existingPageHashes.keys(),
    ...input.existingPageDescriptions.map((page) => page.path),
  ]);
}

function validateServerOwnedInputs(input: SynthesisBatchInput): void {
  validatePathPolicy(input.pathPolicy);
  for (const path of existingPathsFor(input)) normalizedPath(path, input.pathPolicy);
  for (const path of input.existingPageHashes.keys()) normalizedPath(path, input.pathPolicy);
  for (const description of input.existingPageDescriptions) normalizedPath(description.path, input.pathPolicy);
}

function authoritiesFor(bundles: readonly EntityContextBundle[]): ReadonlyMap<string, readonly ReplaceSectionAuthority[]> {
  const map = new Map<string, ReplaceSectionAuthority[]>();
  for (const bundle of bundles) {
    for (const authority of bundle.replaceAuthorities) {
      const records = map.get(authority.path) ?? [];
      records.push(authority);
      map.set(authority.path, records);
    }
  }
  return map;
}

function orderSynthesisOutput(
  output: SynthesisOutput,
  bundles: readonly EntityContextBundle[],
): SynthesisOutput {
  const ordinals = new Map(bundles.map((bundle, ordinal) => [normalizeEntityKey(bundle.entityKey), ordinal]));
  const compareEntity = (left: { entityKey: string }, right: { entityKey: string }): number => {
    const leftOrdinal = ordinals.get(normalizeEntityKey(left.entityKey)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrdinal = ordinals.get(normalizeEntityKey(right.entityKey)) ?? Number.MAX_SAFE_INTEGER;
    return leftOrdinal - rightOrdinal;
  };
  const entityTypes = [...(output.entity_types_delta ?? [])].sort((left, right) =>
    compareCodePoints(normalizeEntityKey(left.type), normalizeEntityKey(right.type)));
  return {
    ...output,
    actions: [...output.actions].sort(compareEntity),
    skips: [...output.skips].sort(compareEntity),
    entity_types_delta: entityTypes,
  };
}

export function mergeSynthesisBatchOutputs(outputs: readonly SynthesisOutput[]): SynthesisOutput {
  const deltas = new Map<string, SynthesisOutput["entity_types_delta"] extends (infer T)[] | undefined ? T : never>();
  for (const output of outputs) {
    for (const raw of normalizeEntityTypeDelta(output.entity_types_delta ?? [])) {
      const key = raw.type.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
      const previous = deltas.get(key);
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(raw)) {
        throw new TypeError(`conflicting entity type delta: ${key}`);
      }
      deltas.set(key, raw);
    }
  }
  return {
    reasoning: outputs.map((output) => output.reasoning).filter((value) => value.trim()).join("\n"),
    actions: outputs.flatMap((output) => output.actions),
    skips: outputs.flatMap((output) => output.skips),
    entity_types_delta: [...deltas.values()].sort((left, right) =>
      compareCodePoints(normalizeEntityKey(left.type), normalizeEntityKey(right.type))),
  };
}

function normalizeEntityTypeDelta(
  values: NonNullable<SynthesisOutput["entity_types_delta"]>,
): NonNullable<SynthesisOutput["entity_types_delta"]> {
  const normalized = new Map<string, NonNullable<SynthesisOutput["entity_types_delta"]>[number]>();
  for (const value of values) {
    const item = {
      ...value,
      type: value.type.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(),
      description: value.description.normalize("NFC").trim(),
      extraction_cues: value.extraction_cues.map((cue) => cue.normalize("NFC").trim()),
      wiki_subfolder: value.wiki_subfolder?.normalize("NFC").trim(),
    };
    const key = item.type.toLowerCase();
    const previous = normalized.get(key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item)) {
      throw new TypeError(`conflicting entity type delta: ${key}`);
    }
    normalized.set(key, item);
  }
  return [...normalized.values()];
}

function splitBundles(bundles: readonly EntityContextBundle[]): [EntityContextBundle[], EntityContextBundle[]] {
  const middle = Math.floor(bundles.length / 2);
  if (middle <= 0 || middle >= bundles.length) throw new Error("Synthesis split made no progress");
  return [bundles.slice(0, middle), bundles.slice(middle)];
}

interface RepackedSynthesisRequest {
  bundles: EntityContextBundle[];
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  promptHash: string;
  estimatedInputTokens: number;
}

function repackSynthesisBundles(
  input: SynthesisBatchInput,
  sourceBundles: readonly EntityContextBundle[],
  effectiveInputBudget: number,
  failedPromptHash: string | undefined,
  opts: LlmCallOptions,
): RepackedSynthesisRequest {
  const source = sourceBundles.map(cloneBundle);
  const optionalEntries = [
    ...source.flatMap((bundle, bundleIndex) => bundle.units
      .filter((unit) => !unit.required)
      .map((unit) => ({ kind: "bundle" as const, id: unit.id, priority: unit.priority, bundleIndex }))),
    ...relevantPageDescriptions(input, source).map((description) => ({
      kind: "description" as const, id: `description:${description.path}`, priority: 0, bundleIndex: -1,
    })),
    ...input.tagRegistryUnits.filter((unit) => !unit.required).map((unit) => ({
      kind: "registry" as const, id: `registry:${unit.id}`, priority: unit.priority, bundleIndex: -1,
    })),
  ].sort((left, right) => left.priority - right.priority
    || compareCodePoints(left.id, right.id)
    || left.bundleIndex - right.bundleIndex);
  const renderAt = (dropped: number): RepackedSynthesisRequest => {
    const droppedEntries = optionalEntries.slice(0, dropped);
    const droppedIds = new Set(droppedEntries.map((entry) => entry.id));
    const droppedBundleKeys = new Set(droppedEntries
      .filter((entry) => entry.kind === "bundle")
      .map((entry) => `${entry.bundleIndex}\u0000${entry.id}`));
    const selected = source.map((bundle, bundleIndex) => ({
      ...bundle,
      units: bundle.units.filter((unit) => !droppedBundleKeys.has(`${bundleIndex}\u0000${unit.id}`)),
    }));
    const selectedOptionalIds = new Set(optionalEntries
      .filter((entry) => entry.kind !== "bundle" && !droppedIds.has(entry.id))
      .map((entry) => entry.id));
    const messages = renderSynthesisMessages(input, selected, opts, selectedOptionalIds);
    const prepared = prepareChatMessages(messages, opts);
    const estimatedInputTokens = estimatePreparedMessages(prepared);
    const promptHash = contentHash(JSON.stringify(prepared));
    return { bundles: selected, messages, promptHash, estimatedInputTokens };
  };
  const initial = renderAt(0);
  if (initial.estimatedInputTokens <= effectiveInputBudget
    && (failedPromptHash === undefined || initial.promptHash !== failedPromptHash)) return initial;

  let low = 1;
  let high = optionalEntries.length;
  let best: RepackedSynthesisRequest | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = renderAt(middle);
    if (candidate.estimatedInputTokens <= effectiveInputBudget
      && (failedPromptHash === undefined || candidate.promptHash !== failedPromptHash)) {
      best = candidate;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (best !== undefined) return best;
  const exhausted = renderAt(optionalEntries.length);
  throw new PromptBudgetExceededError(
    effectiveInputBudget,
    exhausted.estimatedInputTokens,
    exhausted.bundles.map((bundle) => bundle.entityKey),
  );
}

async function executeSynthesisBatch(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
  maxRetries: number,
): Promise<SynthesisOutput> {
  let failedPromptHash: string | undefined;
  return runWithContextRepack({
    requestBudgetsEmittedByExecute: true,
    callSite: "ingest.synthesize",
    configuredInputBudget: input.policy.inputBudgetTokens,
    outputBudget: input.policy.outputBudgetTokens,
    compressionProfile: input.policy.compression,
    build: (effectiveInputBudget) => {
      const opts = compressionOptions(input, effectiveInputBudget);
      const repacked = repackSynthesisBundles(input, bundles, effectiveInputBudget, failedPromptHash, opts);
      const messages = repacked.messages;
      const estimatedInputTokens = repacked.estimatedInputTokens;
      return {
        value: {
          messages,
          opts,
          bundles: repacked.bundles,
          promptHash: repacked.promptHash,
          estimatedInputTokens: repacked.estimatedInputTokens,
        },
        estimatedInputTokens,
        contextUnits: repacked.bundles.length,
      };
    },
    execute: async (request: BuiltSynthesisRequest) => {
      try {
        const result = await runStructuredWithRetry({
          llm: input.llm,
          model: input.model,
          baseMessages: request.messages,
          opts: request.opts,
          profile: { kind: "json-zod", schema: SynthesisOutputSchema },
          maxRetries,
          callSite: "ingest.synthesize",
          lifecycle: createLlmLifecycle("synthesize_wiki_pages"),
          signal: input.signal,
          onEvent: input.onEvent,
          transport: "non-stream",
          contextErrorsRetry: true,
        });
        return { result, request, inputTokens: result.inputTokens };
      } catch (error) {
        if (classifyContextError(error) !== null) failedPromptHash = request.promptHash;
        throw error;
      }
    },
    onEvent: input.onEvent,
}).then((result) => {
    const rawOutput = result.result.value;
    const output: SynthesisOutput = {
      ...rawOutput,
      entity_types_delta: normalizeEntityTypeDelta(rawOutput.entity_types_delta ?? []),
    };
    try {
      validateSynthesisCoverage(result.request.bundles.map((bundle) => bundle.entityKey), output);
      validateSynthesisActions({
        existingPaths: existingPathsFor(input),
        existingPageHashes: input.existingPageHashes,
        replaceAuthorities: authoritiesFor(result.request.bundles),
        actions: output.actions,
        pathPolicy: input.pathPolicy,
      });
    } catch (error) {
      input.onEvent(lifecycleEvent(result.result.lifecycle.id, result.result.lifecycle.action, "failed"));
      throw new SynthesisBatchValidationError(
        bundles.map((bundle) => bundle.entityKey),
        error as Error,
      );
    }
    return orderSynthesisOutput(output, result.request.bundles);
  });
}

function renderConflictRegenerationMessages(
  input: ConflictRegenerationInput,
  opts: LlmCallOptions,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const content = [
    "Regenerate exactly one guarded patch for one conflicted wiki entity.",
    `Domain contract: ${input.domainContract}`,
    `Schema contract: ${input.schemaContract}`,
    `Path contract: ${input.pathContract}`,
    `Governed path policy: ${jsonForPrompt(pathPolicyDto(input.pathPolicy))}`,
    `Entity key: ${input.entityKey}`,
    `Target path: ${input.targetPath}`,
    `Fresh page hash: ${input.pageHash}`,
    "Validated entity evidence:",
    jsonForPrompt(evidenceDto(input.evidence)),
    "Fresh complete target sections:",
    jsonForPrompt(input.targetSections.map((unit) => ({
      path: unit.path,
      heading: unit.heading,
      sectionHash: unit.sectionHash,
      sectionOrdinal: unit.sourceOrdinal,
      exactSection: unit.text,
    }))),
    "Fresh replace authorities:",
    jsonForPrompt(input.replaceAuthorities.map(authorityDto)),
    "Rules: return one patch for the same entity and target path, with the fresh page hash. Replace requires exact path, normalized heading, expectedSectionOrdinal, expectedSectionHash, and supplied exact section authority. Never create, skip, include another entity, or apply a page write.",
  ].join("\n\n");
  void opts;
  return [{ role: "user", content }];
}

function validateFreshRegenerationContext(input: ConflictRegenerationInput): void {
  const authorities = new Map([[input.targetPath, input.replaceAuthorities]]);
  validateSynthesisActions({
    existingPaths: new Set([input.targetPath]),
    existingPageHashes: new Map([[input.targetPath, input.pageHash]]),
    replaceAuthorities: authorities,
    actions: [],
    pathPolicy: input.pathPolicy,
  });
  for (const authority of input.replaceAuthorities) {
    const section = input.targetSections.find((unit) => unit.path === authority.path
      && unit.sourceOrdinal === authority.sectionOrdinal
      && normalizeSectionHeading(unit.heading) === normalizeSectionHeading(authority.heading));
    if (!section || section.sectionHash !== authority.sectionHash || section.text !== authority.exactSection) {
      throw new TypeError("fresh replace authority does not match target section");
    }
  }
}

async function executeSingleRegenerationRequest(input: ConflictRegenerationInput): Promise<{
  value: SynthesisOutput;
  lifecycle: ReturnType<typeof createLlmLifecycle>;
}> {
  const opts = {
    ...boundedOptions(input.opts, input.policy, input.policy.inputBudgetTokens),
    jsonMode: false as const,
    jsonSchema: undefined,
    structuredRetries: 0,
  };
  const messages = renderConflictRegenerationMessages(input, opts);
  const estimatedInputTokens = estimatePreparedMessages(prepareChatMessages(messages, opts));
  if (estimatedInputTokens > input.policy.inputBudgetTokens) {
    throw new PromptBudgetExceededError(
      input.policy.inputBudgetTokens,
      estimatedInputTokens,
      [input.entityKey],
    );
  }
  let forwardedRequests = 0;
  const guardedCreate = async (
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion> => {
    if (forwardedRequests > 0) {
      throw new ConflictRegenerationExhaustedError(
        input.entityKey,
        new Error("regeneration attempted a second underlying request"),
      );
    }
    forwardedRequests++;
    if (params.stream === true) {
      return input.llm.chat.completions.create(params, requestOptions);
    }
    return input.llm.chat.completions.create(params, requestOptions);
  };
  const guardedLlm: LlmClient = {
    chat: {
      completions: {
        create: guardedCreate as LlmClient["chat"]["completions"]["create"],
      },
    },
  };
  const result = await runStructuredWithRetry({
    llm: guardedLlm,
    model: input.model,
    baseMessages: messages,
    opts,
    profile: { kind: "json-zod", schema: SynthesisOutputSchema },
    maxRetries: 0,
    callSite: "ingest.synthesize",
    lifecycle: createLlmLifecycle("synthesize_wiki_pages"),
    signal: input.signal,
    onEvent: input.onEvent,
    transport: "non-stream",
  });
  return { value: result.value, lifecycle: result.lifecycle };
}

async function synthesizeBundles(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
  depth: number,
): Promise<SynthesisOutput> {
  if (bundles.length === 0) throw new Error("Cannot synthesize an empty bundle list");
  if (depth > 16) throw new Error("Synthesis split limit exceeded");
  try {
    return await executeSynthesisBatch(input, bundles, bundles.length === 1 ? (input.opts.structuredRetries ?? 1) : 0);
  } catch (error) {
    const contextFailure = error instanceof PromptBudgetExceededError || classifyContextError(error) !== null;
    if (contextFailure) {
      if (bundles.length === 1) {
        throw new SynthesisSplitRequiredError(bundles.map((bundle) => bundle.entityKey), String((error as Error).message));
      }
    } else if (!(error instanceof StructuredValidationError)
      && !(error instanceof StructuredOutputTruncatedError)
      && !(error instanceof SynthesisBatchValidationError)) {
      throw error;
    } else if (bundles.length === 1) {
      const cause = error instanceof StructuredValidationError ? error.lastError : error instanceof SynthesisBatchValidationError ? error.cause : error;
      throw new SynthesisStructuredError(bundles.map((bundle) => bundle.entityKey), cause);
    }
    const [left, right] = splitBundles(bundles);
    const leftOutput = await synthesizeBundles(input, left, depth + 1);
    const rightOutput = await synthesizeBundles(input, right, depth + 1);
    return orderSynthesisOutput(mergeSynthesisBatchOutputs([leftOutput, rightOutput]), bundles);
  }
}

export async function synthesizeEntityBatch(input: SynthesisBatchInput): Promise<SynthesisOutput> {
  if (input.bundles.length === 0) throw new Error("synthesizeEntityBatch requires at least one bundle");
  validateServerOwnedInputs(input);
  const output = await synthesizeBundles(input, input.bundles, 0);
  validateSynthesisCoverage(input.bundles.map((bundle) => bundle.entityKey), output);
  validateSynthesisActions({
    existingPaths: existingPathsFor(input),
    existingPageHashes: input.existingPageHashes,
    replaceAuthorities: authoritiesFor(input.bundles),
    actions: output.actions,
    pathPolicy: input.pathPolicy,
  });
  return orderSynthesisOutput(output, input.bundles);
}

function conflictError(
  input: ConflictRegenerationInput,
  message: string,
): Error {
  const cause = new Error(message);
  return (input.conflictCount ?? 0) > 0
    ? new ConflictStillStaleError(input.entityKey, cause)
    : new ConflictRegenerationExhaustedError(input.entityKey, cause);
}

export async function regenerateConflictedPatch(input: ConflictRegenerationInput): Promise<SynthesisAction> {
  if ((input.conflictCount ?? 0) > 0) {
    throw new ConflictStillStaleError(input.entityKey, new Error("conflict regeneration already attempted"));
  }
  try {
    validateFreshRegenerationContext(input);
  } catch (error) {
    throw conflictError(input, (error as Error).message);
  }
  let regeneration: Awaited<ReturnType<typeof executeSingleRegenerationRequest>>;
  try {
    regeneration = await executeSingleRegenerationRequest(input);
  } catch (error) {
    if (error instanceof ConflictRegenerationExhaustedError) throw error;
    throw conflictError(input, error instanceof StructuredValidationError ? error.lastError.message : (error as Error).message);
  }
  const output = regeneration.value;
  try {
    validateSynthesisCoverage([input.entityKey], output);
    validateSynthesisActions({
      existingPaths: new Set([input.targetPath]),
      existingPageHashes: new Map([[input.targetPath, input.pageHash]]),
      replaceAuthorities: new Map([[input.targetPath, input.replaceAuthorities]]),
      actions: output.actions,
      pathPolicy: input.pathPolicy,
    });
  } catch (error) {
    input.onEvent(lifecycleEvent(regeneration.lifecycle.id, regeneration.lifecycle.action, "failed"));
    throw conflictError(input, (error as Error).message);
  }
  if (output.skips.length !== 0 || output.actions.length !== 1) {
    input.onEvent(lifecycleEvent(regeneration.lifecycle.id, regeneration.lifecycle.action, "failed"));
    throw conflictError(input, "regeneration must return exactly one action and no skip");
  }
  const action = output.actions[0];
  if (action.kind !== "patch"
    || action.entityKey !== input.entityKey
    || action.path !== input.targetPath
    || action.expectedPageHash !== input.pageHash) {
    input.onEvent(lifecycleEvent(regeneration.lifecycle.id, regeneration.lifecycle.action, "failed"));
    throw conflictError(input, "regeneration returned a different entity, path, or page hash");
  }
  return action;
}
