import type OpenAI from "openai";
import { z } from "zod";
import {
  SynthesisActionSchema,
  SynthesisOutputSchema,
  type SynthesisOutput,
  type SynthesisAction,
} from "./zod-schemas";
import {
  inspectPatchablePage,
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
import type {
  LlmCallOptions,
  LlmChatCompletionCreateOptions,
  LlmClient,
  ModelCallPolicy,
  RunEvent,
} from "../types";
import { prepareChatMessages } from "./llm-utils";
import { createLlmLifecycle, runStructuredWithRetry, StructuredOutputTruncatedError, StructuredValidationError } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import synthesisPrompt from "../../prompts/ingest-synthesis.md";
import { synthesisFrameInstruction, synthesisFrameProfile } from "./framed-output";
import type { SynthesisEvidenceLedgerItem } from "./synthesis-evidence-ledger";

const synthesisRepairInstruction = [
  "Use only CREATE, PATCH, SECTION, CONTENT, END_CONTENT, SKIP, optional ENTITY_TYPES_DELTA_JSON, and END frames.",
  "Every create needs entityKey, path, annotation, and one raw Markdown CONTENT block closed by END_CONTENT.",
  "Every patch needs entityKey, path, expectedPageHash, and SECTION blocks.",
  "Every section needs operation, heading, and raw Markdown CONTENT closed by END_CONTENT. Replace also needs expectedSectionOrdinal and expectedSectionHash.",
  "Every skip needs entityKey and reason. Cover every supplied entity exactly once.",
  "Never put a protocol marker inside Markdown content.",
].join("\n");

const SYNTHESIS_COMPACT_REPAIR_THRESHOLD_TOKENS = 0;
export const SYNTHESIS_COMPACT_REPAIR_MAX_RESERVE_TOKENS = 2_048;
const SYNTHESIS_COMPACT_REPAIR_MIN_RESERVE_TOKENS = 512;
const SYNTHESIS_COMPACT_REPAIR_RESERVE_RATIO = 0.05;
export const SYNTHESIS_MAX_OPTIONAL_WIKI_UNITS_PER_BUNDLE = 3;
export const SYNTHESIS_EXACT_SOURCE_TEXT_LIMIT = 192;

export function synthesisCompactRepairReserveTokens(inputBudgetTokens: number): number {
  if (!Number.isFinite(inputBudgetTokens) || inputBudgetTokens <= 0) return 0;
  return Math.min(
    SYNTHESIS_COMPACT_REPAIR_MAX_RESERVE_TOKENS,
    Math.max(
      SYNTHESIS_COMPACT_REPAIR_MIN_RESERVE_TOKENS,
      Math.floor(inputBudgetTokens * SYNTHESIS_COMPACT_REPAIR_RESERVE_RATIO),
    ),
  );
}

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
  createPathsByEntityKey?: ReadonlyMap<string, string>;
  tagRegistryUnits: readonly ContextUnit[];
  technicalEvidenceByEntityKey?: ReadonlyMap<string, readonly SynthesisEvidenceLedgerItem[]>;
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

function validateBundleActionTargets(
  bundles: readonly EntityContextBundle[],
  actions: readonly SynthesisAction[],
  createPathsByEntityKey: ReadonlyMap<string, string> | undefined,
): void {
  const byEntityKey = new Map(bundles.map((bundle) => [normalizeEntityKey(bundle.entityKey), bundle]));
  for (const action of actions) {
    const bundle = byEntityKey.get(normalizeEntityKey(action.entityKey));
    if (bundle === undefined) continue;
    const targetPaths = new Set([
      ...bundle.units.filter((unit) => unit.required).map((unit) => unit.path),
      ...bundle.replaceAuthorities.map((authority) => authority.path),
    ]);
    if (targetPaths.size > 0) {
      if (action.kind === "create") {
        throw new TypeError(`create is not allowed for existing canonical target: ${bundle.entityKey}`);
      }
      if (!targetPaths.has(action.path)) {
        throw new TypeError(`patch path is not the canonical target for entity: ${bundle.entityKey}`);
      }
      continue;
    }
    if (action.kind === "patch") {
      throw new TypeError(`patch is not allowed without exact target context: ${bundle.entityKey}`);
    }
    if (createPathsByEntityKey !== undefined
      && createPathsByEntityKey.get(bundle.entityKey) === undefined) {
      throw new TypeError(`create is not allowed without a server-owned path: ${bundle.entityKey}`);
    }
  }
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

function normalizeCreateActionPaths(
  output: SynthesisOutput,
  createPathsByEntityKey: ReadonlyMap<string, string> | undefined,
): SynthesisOutput {
  if (createPathsByEntityKey === undefined || createPathsByEntityKey.size === 0) return output;
  const canonicalByNormalizedKey = new Map(
    [...createPathsByEntityKey].map(([entityKey, path]) => [normalizeEntityKey(entityKey), path]),
  );
  let changed = false;
  const actions = output.actions.map((action) => {
    if (action.kind !== "create") return action;
    const canonical = canonicalByNormalizedKey.get(normalizeEntityKey(action.entityKey));
    if (canonical === undefined || action.path === canonical) return action;
    changed = true;
    return { ...action, path: canonical };
  });
  return changed ? { ...output, actions } : output;
}

function canonicalizeSingleBundleCoverage(
  output: SynthesisOutput,
  bundles: readonly EntityContextBundle[],
  createPathsByEntityKey: ReadonlyMap<string, string> | undefined,
): SynthesisOutput {
  if (bundles.length !== 1) return output;
  const bundle = bundles[0];
  const entityKey = bundle.entityKey;
  const targetPath = createPathsByEntityKey?.get(entityKey);
  const actions = output.actions.map((action) =>
    action.kind === "create" && targetPath !== undefined
      ? { ...action, entityKey, path: targetPath }
      : { ...action, entityKey });
  const skips = output.skips.map((skip) => ({ ...skip, entityKey }));
  if (actions.length === 0) {
    return skips.length <= 1
      ? { ...output, skips }
      : { ...output, skips: [{ ...skips[0], reason: skips.map((skip) => skip.reason).join("; ") }] };
  }
  const patchActions = actions.filter((action) => action.kind === "patch");
  if (patchActions.length === actions.length) {
    const first = patchActions[0];
    const canMerge = patchActions.every((action) =>
      action.path === first.path && action.expectedPageHash === first.expectedPageHash);
    if (canMerge) {
      return {
        ...output,
        actions: [{
          ...first,
          sections: patchActions.flatMap((action) => action.sections),
        }],
        skips: [],
      };
    }
    return {
      ...output,
      actions: [patchActions.reduce((best, action) =>
        action.sections.length > best.sections.length ? action : best, first)],
      skips: [],
    };
  }
  const createActions = actions.filter((action) => action.kind === "create");
  if (createActions.length > 0) {
    const first = createActions[0];
    return {
      ...output,
      actions: [createActions.reduce((best, action) =>
        action.content.length > best.content.length ? action : best, first)],
      skips: [],
    };
  }
  return { ...output, actions: [actions[0]], skips: [] };
}

function sectionBody(markdown: string): string {
  return markdown.replace(/^[^\r\n]*(?:\r\n|\n|\r)?/, "").trim();
}

function hasOnlyArticleScaffolding(preamble: string): boolean {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(preamble)?.[0] ?? "";
  const contentLines = preamble.slice(frontmatter.length)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return contentLines.length === 1
    && /^ {0,3}#(?:[ \t]+\S.*|[^#\s].*)$/.test(contentLines[0]);
}

function canonicalizeSingleExistingTargetAction(
  output: SynthesisOutput,
  bundles: readonly EntityContextBundle[],
  existingPageHashes: ReadonlyMap<string, string>,
): SynthesisOutput {
  if (bundles.length !== 1 || output.actions.length !== 1) return output;
  const action = output.actions[0];
  if (action.kind !== "create") return output;
  const bundle = bundles[0];
  const targetPaths = new Set([
    ...bundle.units.filter((unit) => unit.required).map((unit) => unit.path),
    ...bundle.replaceAuthorities.map((authority) => authority.path),
  ]);
  if (targetPaths.size !== 1) return output;
  const path = [...targetPaths][0];
  const expectedPageHash = existingPageHashes.get(path);
  if (expectedPageHash === undefined) return output;

  const article = inspectPatchablePage(action.content);
  if (!hasOnlyArticleScaffolding(article.preamble)) return output;
  const sections = article.sections
    .filter((section) => normalizeSectionHeading(section.heading) !== "sources")
    .map((section) => {
      const authorities = bundle.replaceAuthorities.filter((authority) =>
        authority.path === path
        && normalizeSectionHeading(authority.heading) === normalizeSectionHeading(section.heading));
      const content = sectionBody(section.span);
      if (authorities.length !== 1) {
        return { heading: section.heading, operation: "add" as const, content };
      }
      const authority = authorities[0];
      return {
        heading: section.heading,
        operation: "replace" as const,
        expectedSectionOrdinal: authority.sectionOrdinal,
        expectedSectionHash: authority.sectionHash,
        content,
      };
    });
  if (sections.length === 0) return output;
  return {
    ...output,
    actions: [{
      kind: "patch",
      entityKey: bundle.entityKey,
      path,
      expectedPageHash,
      sections,
    }],
  };
}

interface BuiltSynthesisRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  bundles: EntityContextBundle[];
  promptHash: string;
  estimatedInputTokens: number;
  promptBreakdown: Extract<RunEvent, { kind: "prompt_breakdown" }>;
}

function boundedOptions(
  baseOpts: LlmCallOptions,
  policy: ModelCallPolicy,
  inputBudgetTokens: number,
): LlmCallOptions {
  const opts: LlmCallOptions = {
    ...baseOpts,
    inputBudgetTokens,
    repairInputBudgetTokens: policy.repairInputBudgetTokens,
    outputRetryBudgetTokens: policy.outputRetryBudgetTokens,
    semanticCompression: { profile: policy.compression ?? "balanced", operation: "ingest" },
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

function estimatePromptFragmentTokens(label: string, value: unknown): number {
  return estimatePreparedMessages([{ role: "user", content: `${label}:\n${jsonForPrompt(value)}` }]);
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
      startLine: source.startLine, endLine: source.endLine, text: truncateTextForSynthesis(source.text, SYNTHESIS_EXACT_SOURCE_TEXT_LIMIT),
    })),
    links: [...evidence.links],
  };
}

function technicalEvidenceFor(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
): SynthesisEvidenceLedgerItem[] {
  return bundles.flatMap((bundle) =>
    input.technicalEvidenceByEntityKey?.get(bundle.entityKey) ?? []);
}

function technicalEvidenceDto(item: SynthesisEvidenceLedgerItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    startLine: item.startLine,
    endLine: item.endLine,
    markdown: item.markdown,
  };
}

function truncateTextForSynthesis(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[truncated; exact line range validated server-side]";
  return `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`;
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
    exactSectionText: "server-owned; validated internally",
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

function allowedEntityKeysDto(
  bundles: readonly EntityContextBundle[],
  createPathsByEntityKey: ReadonlyMap<string, string> | undefined,
): Record<string, unknown>[] {
  return bundles.map((bundle) => ({
    entityKey: bundle.entityKey,
    createPath: createPathsByEntityKey?.get(bundle.entityKey),
  }));
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
    replaceAuthorities: uniqueReplaceAuthorities(bundle.replaceAuthorities).map((authority) => ({ ...authority })),
    ...(bundle.consolidatedEntityKeys === undefined
      ? {}
      : { consolidatedEntityKeys: [...bundle.consolidatedEntityKeys] }),
  };
}

function compactBundleForSynthesis(bundle: EntityContextBundle): EntityContextBundle {
  const cloned = cloneBundle(bundle);
  cloned.evidence = {
    ...cloned.evidence,
    exactSource: cloned.evidence.exactSource.map((source) => ({
      ...source,
      text: truncateTextForSynthesis(source.text, SYNTHESIS_EXACT_SOURCE_TEXT_LIMIT),
    })),
  };
  const required = cloned.units.filter((unit) => unit.required);
  const optional = cloned.units
    .filter((unit) => !unit.required)
    .sort((left, right) => right.priority - left.priority
      || right.score - left.score
      || compareCodePoints(left.path, right.path)
      || left.sourceOrdinal - right.sourceOrdinal)
    .slice(0, SYNTHESIS_MAX_OPTIONAL_WIKI_UNITS_PER_BUNDLE);
  cloned.units = [...required, ...optional];
  return cloned;
}

function truncateForPromptBudget(text: string, minimumLength: number): string {
  const nextLength = Math.max(minimumLength, Math.floor(text.length / 2));
  if (nextLength >= text.length) return text;
  const marker = "\n[truncated for prompt budget]";
  const contentLength = Math.max(0, nextLength - marker.length);
  return `${text.slice(0, contentLength)}${marker}`;
}

function compressLongestUnitTextForPromptBudget(bundle: EntityContextBundle, minimumLength: number): boolean {
  let longestIndex = -1;
  let longestLength = minimumLength;
  for (let index = 0; index < bundle.units.length; index++) {
    const length = bundle.units[index].text.length;
    if (length > longestLength) {
      longestIndex = index;
      longestLength = length;
    }
  }
  if (longestIndex === -1) return false;
  const unit = bundle.units[longestIndex];
  const nextText = truncateForPromptBudget(unit.text, minimumLength);
  if (nextText === unit.text) return false;
  bundle.units[longestIndex] = { ...unit, text: nextText };
  return true;
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
      ...(bundle.consolidatedEntityKeys === undefined
        ? {}
        : { consolidatedEntityKeys: bundle.consolidatedEntityKeys }),
      serverOwnedCreatePath: input.createPathsByEntityKey?.get(bundle.entityKey),
      targets: [...new Set(bundle.units.map((unit) => unit.path))]
        .map((path) => ({ path, pageHash: input.existingPageHashes.get(path) }))
        .filter((target) => target.pageHash !== undefined),
      requiredPageSections: bundle.units.filter((unit) => unit.required).map(unitDto),
      evidence: evidenceDto(bundle.evidence),
      mustPreserveTechnicalEvidence: (input.technicalEvidenceByEntityKey?.get(bundle.entityKey) ?? [])
        .map(technicalEvidenceDto),
      contextUnits: bundle.units.filter((unit) => !unit.required).map(unitDto),
      replaceAuthorities: uniqueReplaceAuthorities(bundle.replaceAuthorities).map(authorityDto),
    }),
  ].join("\n")).join("\n\n");
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{
    role: "user",
    content: synthesisPrompt
      .replace("{{domain_contract}}", input.domainContract)
      .replace("{{schema_contract}}", input.schemaContract)
      .replace("{{path_contract}}", `${input.pathContract}\nGoverned path policy: ${jsonForPrompt(pathPolicyDto(input.pathPolicy))}\nAllowed entity keys and server-owned create paths: ${jsonForPrompt(allowedEntityKeysDto(bundles, input.createPathsByEntityKey))}`)
      .replace("{{entity_context_bundles}}", bundleText)
      .replace("{{page_descriptions}}", jsonForPrompt(relevantDescriptions.map(descriptionDto)))
      .replace("{{tag_registry_units}}", jsonForPrompt(registryUnits.map(registryDto))),
  }];
  void opts;
  return messages;
}

function synthesisPromptBreakdown(
  input: SynthesisBatchInput,
  bundles: readonly EntityContextBundle[],
  selectedOptionalIds: ReadonlySet<string> | undefined,
  estimatedInputTokens: number,
): Extract<RunEvent, { kind: "prompt_breakdown" }> {
  const relevantDescriptions = relevantPageDescriptions(input, bundles)
    .filter((description) => selectedOptionalIds === undefined || selectedOptionalIds.has(`description:${description.path}`));
  const registryUnits = input.tagRegistryUnits
    .filter((unit) => unit.required || selectedOptionalIds === undefined || selectedOptionalIds.has(`registry:${unit.id}`));
  const evidence = bundles.map((bundle) => evidenceDto(bundle.evidence));
  const technicalEvidence = technicalEvidenceFor(input, bundles).map(technicalEvidenceDto);
  const contextUnits = bundles.flatMap((bundle) => bundle.units.map(unitDto));
  const contracts = {
    domainContract: input.domainContract,
    schemaContract: input.schemaContract,
    pathContract: input.pathContract,
    pathPolicy: pathPolicyDto(input.pathPolicy),
    allowedEntityKeys: allowedEntityKeysDto(bundles, input.createPathsByEntityKey),
  };
  return {
    kind: "prompt_breakdown",
    callSite: "ingest.synthesize",
    estimatedInputTokens,
    breakdown: {
      contractsTokens: estimatePromptFragmentTokens("contracts", contracts),
      evidenceTokens: estimatePromptFragmentTokens("evidence", evidence),
      contextTokens: estimatePromptFragmentTokens("contextUnits", contextUnits),
      pageDescriptionsTokens: estimatePromptFragmentTokens("pageDescriptions", relevantDescriptions.map(descriptionDto)),
      registryTokens: estimatePromptFragmentTokens("tagRegistryUnits", registryUnits.map(registryDto)),
      ...(technicalEvidence.length === 0
        ? {}
        : { technicalEvidenceTokens: estimatePromptFragmentTokens("mustPreserveTechnicalEvidence", technicalEvidence) }),
    },
    counts: {
      bundles: bundles.length,
      entities: new Set(bundles.map((bundle) => normalizeEntityKey(bundle.entityKey))).size,
      wikiSections: bundles.reduce((sum, bundle) => sum + bundle.units.length, 0),
      requiredWikiSections: bundles.reduce((sum, bundle) => sum + bundle.units.filter((unit) => unit.required).length, 0),
      optionalWikiSections: bundles.reduce((sum, bundle) => sum + bundle.units.filter((unit) => !unit.required).length, 0),
      pageDescriptions: relevantDescriptions.length,
      registryUnits: registryUnits.length,
      facts: bundles.reduce((sum, bundle) => sum + bundle.evidence.facts.length, 0),
      exactSourceRanges: bundles.reduce((sum, bundle) => sum + bundle.evidence.exactSourceRanges.length, 0),
      exactSourceTexts: bundles.reduce((sum, bundle) => sum + bundle.evidence.exactSource.length, 0),
      links: bundles.reduce((sum, bundle) => sum + bundle.evidence.links.length, 0),
      ...(technicalEvidence.length === 0 ? {} : { technicalEvidenceBlocks: technicalEvidence.length }),
    },
  };
}

function renderSemanticRepairPrompt(error: Error, bundles: readonly EntityContextBundle[]): string {
  return [
    "Previous field-framed response failed guarded synthesis validation.",
    error.message,
    "Fix only the invalid fields and return the complete field-framed synthesis output again.",
    `Allowed entity keys: ${jsonForPrompt(bundles.map((bundle) => bundle.entityKey))}.`,
    "Do not introduce new entityKey values. If an invalid action uses an unknown entityKey, rewrite it to one allowed key when it is clearly the same entity, otherwise replace that action with a skip for the allowed key.",
    "Canonical wiki paths must use this shape: !Wiki/<domain>/<allowed-type-folder>/wiki_<domain>_<entity_slug>.md.",
    "Entity slugs use lowercase letters, digits, and underscores only; replace hyphens, spaces, and punctuation with underscores.",
    synthesisFrameInstruction,
    "Return frames only. Close every Markdown block with <<<END_CONTENT>>> and never place protocol markers inside Markdown.",
  ].join("\n");
}

function safeValidationRetryReason(error: Error): string {
  return error.message.replace(/\s+/g, " ").slice(0, 240);
}

function emitSynthesisValidationRetry(args: {
  input: SynthesisBatchInput;
  requestId: string;
  bundles: readonly EntityContextBundle[];
  output: SynthesisOutput;
  cause: Error;
  canSplit: boolean;
  canRepair: boolean;
}): void {
  args.input.onEvent({
    kind: "structured_validation_retry",
    callSite: "ingest.synthesize",
    requestId: args.requestId,
    errorClass: "SynthesisBatchValidationError",
    safeReason: safeValidationRetryReason(args.cause),
    bundleCount: args.bundles.length,
    canSplit: args.canSplit,
    nextAction: args.canSplit ? "split_batch" : args.canRepair ? "repair_prompt" : "fail",
    entityKeys: args.bundles.map((bundle) => bundle.entityKey),
    actionCount: args.output.actions.length,
    skipCount: args.output.skips.length,
  });
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

function replaceAuthorityRecordKey(authority: ReplaceSectionAuthority): string {
  return [
    authority.path,
    normalizeSectionHeading(authority.heading),
    authority.sectionOrdinal,
    authority.sectionHash,
    authority.exactSection,
  ].join("\u0000");
}

function uniqueReplaceAuthorities(records: readonly ReplaceSectionAuthority[]): ReplaceSectionAuthority[] {
  const seen = new Set<string>();
  const unique: ReplaceSectionAuthority[] = [];
  for (const record of records) {
    const key = replaceAuthorityRecordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
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
  for (const [path, records] of map) map.set(path, uniqueReplaceAuthorities(records));
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
  promptBreakdown: Extract<RunEvent, { kind: "prompt_breakdown" }>;
}

function repackSynthesisBundles(
  input: SynthesisBatchInput,
  sourceBundles: readonly EntityContextBundle[],
  packingInputBudget: number,
  failedPromptHash: string | undefined,
  opts: LlmCallOptions,
): RepackedSynthesisRequest {
  const source = sourceBundles.map(compactBundleForSynthesis);
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
    return {
      bundles: selected,
      messages,
      promptHash,
      estimatedInputTokens,
      promptBreakdown: synthesisPromptBreakdown(input, selected, selectedOptionalIds, estimatedInputTokens),
    };
  };
  const initial = renderAt(0);
  if (initial.estimatedInputTokens <= packingInputBudget
    && (failedPromptHash === undefined || initial.promptHash !== failedPromptHash)) return initial;

  let low = 1;
  let high = optionalEntries.length;
  let best: RepackedSynthesisRequest | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = renderAt(middle);
    if (candidate.estimatedInputTokens <= packingInputBudget
      && (failedPromptHash === undefined || candidate.promptHash !== failedPromptHash)) {
      best = candidate;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (best !== undefined) return best;
  const exhausted = renderAt(optionalEntries.length);
  if (source.length === 1) {
    const compressed = cloneBundle(source[0]);
    const renderCompressed = (): RepackedSynthesisRequest => {
      const messages = renderSynthesisMessages(input, [compressed], opts, new Set());
      const prepared = prepareChatMessages(messages, opts);
      return {
        bundles: [compressed],
        messages,
        promptHash: contentHash(JSON.stringify(prepared)),
        estimatedInputTokens: estimatePreparedMessages(prepared),
        promptBreakdown: synthesisPromptBreakdown(input, [compressed], new Set(), estimatePreparedMessages(prepared)),
      };
    };
    let candidate = renderCompressed();
    const fits = () => candidate.estimatedInputTokens <= packingInputBudget
      && (failedPromptHash === undefined || candidate.promptHash !== failedPromptHash);

    while (!fits() && compressed.evidence.links.length > 0) {
      compressed.evidence.links.pop();
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.exactSource.length > 1) {
      compressed.evidence.exactSource.pop();
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.exactSourceRanges.length > 1) {
      compressed.evidence.exactSourceRanges.pop();
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.facts.length > 1) {
      compressed.evidence.facts.pop();
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.packetIds.length > 1) {
      compressed.evidence.packetIds.pop();
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.exactSource.length > 0
      && compressed.evidence.exactSource[0].text.length > 256) {
      const text = compressed.evidence.exactSource[0].text;
      compressed.evidence.exactSource[0].text = truncateForPromptBudget(text, 256);
      candidate = renderCompressed();
    }
    while (!fits() && compressed.evidence.facts.length > 0
      && compressed.evidence.facts[0].length > 512) {
      const fact = compressed.evidence.facts[0];
      compressed.evidence.facts[0] = truncateForPromptBudget(fact, 512);
      candidate = renderCompressed();
    }
    while (!fits() && compressLongestUnitTextForPromptBudget(compressed, 512)) {
      candidate = renderCompressed();
    }
    if (fits()) return candidate;
  }
  throw new PromptBudgetExceededError(
    packingInputBudget,
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
    compressionProfile: input.policy.compression ?? "balanced",
    build: (effectiveInputBudget) => {
      const opts = compressionOptions(input, effectiveInputBudget);
      const packingInputBudget = maxRetries > 0
        ? Math.max(1, effectiveInputBudget - synthesisCompactRepairReserveTokens(effectiveInputBudget))
        : effectiveInputBudget;
      const repacked = repackSynthesisBundles(input, bundles, packingInputBudget, failedPromptHash, opts);
      const messages = repacked.messages;
      const estimatedInputTokens = repacked.estimatedInputTokens;
      return {
        value: {
          messages,
          opts,
          bundles: repacked.bundles,
          promptHash: repacked.promptHash,
          estimatedInputTokens: repacked.estimatedInputTokens,
          promptBreakdown: repacked.promptBreakdown,
        },
        estimatedInputTokens,
        contextUnits: repacked.bundles.length,
      };
    },
    execute: async (request: BuiltSynthesisRequest) => {
      try {
        let messages = request.messages;
        let lastResult: Awaited<ReturnType<typeof runStructuredWithRetry<SynthesisOutput>>> | undefined;
        for (let semanticAttempt = 0; semanticAttempt <= maxRetries; semanticAttempt++) {
          const lifecycle = createLlmLifecycle("synthesize_wiki_pages");
          input.onEvent({ ...request.promptBreakdown, requestId: lifecycle.id });
          const result = await runStructuredWithRetry({
            llm: input.llm,
            model: input.model,
            baseMessages: messages,
            opts: request.opts,
            profile: synthesisFrameProfile(
              SynthesisOutputSchema,
              synthesisRepairInstruction,
              SYNTHESIS_COMPACT_REPAIR_THRESHOLD_TOKENS,
            ),
            maxRetries: semanticAttempt === 0 ? maxRetries : 0,
            callSite: "ingest.synthesize",
            lifecycle,
            signal: input.signal,
            onEvent: input.onEvent,
            transport: "non-stream",
            contextErrorsRetry: true,
            validationExhaustionPhase: request.bundles.length > 1
              ? "retrying"
              : semanticAttempt === maxRetries ? "failed" : "retrying",
          });
          lastResult = result;
          const rawOutput = result.value;
          const normalizedOutput = normalizeCreateActionPaths(
            canonicalizeSingleExistingTargetAction(
              canonicalizeSingleBundleCoverage(rawOutput, request.bundles, input.createPathsByEntityKey),
              request.bundles,
              input.existingPageHashes,
            ),
            input.createPathsByEntityKey,
          );
          const output: SynthesisOutput = {
            ...normalizedOutput,
            entity_types_delta: normalizeEntityTypeDelta(normalizedOutput.entity_types_delta ?? []),
          };
          try {
            validateSynthesisCoverage(request.bundles.map((bundle) => bundle.entityKey), output);
            validateBundleActionTargets(request.bundles, output.actions, input.createPathsByEntityKey);
            validateSynthesisActions({
              existingPaths: existingPathsFor(input),
              existingPageHashes: input.existingPageHashes,
              replaceAuthorities: authoritiesFor(request.bundles),
              actions: output.actions,
              pathPolicy: input.pathPolicy,
            });
            return { result, request, inputTokens: result.inputTokens, output };
          } catch (error) {
            const cause = error as Error;
            const canSplit = request.bundles.length > 1;
            const canRepair = !canSplit && semanticAttempt < maxRetries;
            emitSynthesisValidationRetry({
              input,
              requestId: result.lifecycle.id,
              bundles: request.bundles,
              output,
              cause,
              canSplit,
              canRepair,
            });
            input.onEvent(lifecycleEvent(result.lifecycle.id, result.lifecycle.action, canSplit || canRepair ? "retrying" : "failed"));
            if (!canRepair) {
              throw new SynthesisBatchValidationError(
                bundles.map((bundle) => bundle.entityKey),
                cause,
              );
            }
            input.onEvent({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });
            messages = [
              ...request.messages,
              { role: "user", content: renderSemanticRepairPrompt(cause, request.bundles) },
            ];
          }
        }
        throw new SynthesisBatchValidationError(
          bundles.map((bundle) => bundle.entityKey),
          lastResult === undefined ? new Error("semantic validation exhausted before synthesis") : new Error("semantic validation exhausted"),
        );
      } catch (error) {
        if (classifyContextError(error) !== null) failedPromptHash = request.promptHash;
        throw error;
      }
    },
    onEvent: input.onEvent,
}).then((result) => {
    return orderSynthesisOutput(result.output, result.request.bundles);
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
    "Output protocol:",
    synthesisFrameInstruction,
    "Rules: return exactly one <<<PATCH>>> frame for the same entity and target path, with the fresh page hash. Replace requires exact path, normalized heading, expectedSectionOrdinal, expectedSectionHash, and supplied exact section authority. Never create, skip, include another entity, or apply a page write.",
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
  value: unknown;
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
  const structuredRetries = 1;
  const maxForwardedRequests = structuredRetries + 1;
  let forwardedRequests = 0;
  const guardedCreate = async (
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    requestOptions?: LlmChatCompletionCreateOptions,
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion> => {
    if (forwardedRequests >= maxForwardedRequests) {
      throw new ConflictRegenerationExhaustedError(
        input.entityKey,
        new Error("regeneration exceeded its bounded format repair"),
      );
    }
    forwardedRequests++;
    if (params.stream === true) {
      return input.llm.chat.completions.create(params, requestOptions);
    }
    return input.llm.chat.completions.create(params, requestOptions);
  };
  const guardedLlm: LlmClient = {
    ...input.llm,
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
    profile: synthesisFrameProfile(z.unknown(), synthesisRepairInstruction),
    maxRetries: structuredRetries,
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
  let output: SynthesisOutput;
  try {
    output = SynthesisOutputSchema.parse(regeneration.value);
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
