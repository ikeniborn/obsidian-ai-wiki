import type OpenAI from "openai";
import { extractCompleteH2Sections } from "./markdown-chunks";
import { scoreLexicalChunk, tokenizeLexical } from "./lexical-retrieval";
import {
  estimatePreparedMessages,
  packContextUnits,
  type ContextUnit,
} from "./prompt-budget";
import type { EntityEvidence } from "./phases/ingest-evidence";
import type { ReplaceSectionAuthority } from "./section-patches";
import type { LlmCallOptions } from "./types";
import { pageId } from "./wiki-graph";
import { isWikiPagePath, WIKI_ROOT } from "./wiki-path";

export interface WikiSectionUnit extends ContextUnit {
  pageId: string;
  path: string;
  heading: string;
  sectionHash: string;
  score: number;
  sourceOrdinal: number;
  duplicatePaths: string[];
}

export type EntityContextRenderer = (
  units: readonly WikiSectionUnit[],
  opts: LlmCallOptions,
  fixedMessages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
) => OpenAI.Chat.ChatCompletionMessageParam[];

export interface EntityContextInput {
  evidence: EntityEvidence;
  candidatePages: Map<string, string>;
  targetPath?: string;
  inputBudgetTokens: number;
  fixedMessages: readonly OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  linkSectionPurpose?: "duplicate-merge";
  render?: EntityContextRenderer;
  renderEntityContextMessages?: EntityContextRenderer;
}

export class TargetContextMissingError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string) {
    super("Target page has no patchable context section");
    this.name = "TargetContextMissingError";
    this.targetPath = targetPath;
  }
}

export class InvalidWikiContextPathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super("Candidate context path must be a wiki Markdown page");
    this.name = "InvalidWikiContextPathError";
    this.path = path;
  }
}

export function validateGovernedCandidatePath(path: string): void {
  if (path.includes("\\") || path.includes("\0") || !path.startsWith(`${WIKI_ROOT}/`)) {
    throw new InvalidWikiContextPathError(path);
  }
  const segments = path.slice(`${WIKI_ROOT}/`.length).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new InvalidWikiContextPathError(path);
  }
  const normalized = `${WIKI_ROOT}/${segments.join("/")}`;
  if (normalized !== path || !normalized.startsWith(`${WIKI_ROOT}/`) || !isWikiPagePath(normalized)) {
    throw new InvalidWikiContextPathError(path);
  }
}

export interface EntityContextResult {
  units: WikiSectionUnit[];
  replaceAuthorities: ReplaceSectionAuthority[];
  estimatedInputTokens: number;
}

export interface EntityContextBundle {
  entityKey: string;
  evidence: EntityEvidence;
  units: WikiSectionUnit[];
  replaceAuthorities: ReplaceSectionAuthority[];
  estimatedInputTokens: number;
}

export class ContextSplitRequiredError extends Error {
  readonly budget: number;
  readonly estimated: number;
  readonly entityKey?: string;

  constructor(message: string, budget: number, estimated: number, entityKey?: string) {
    super(message);
    this.name = "ContextSplitRequiredError";
    this.budget = budget;
    this.estimated = estimated;
    this.entityKey = entityKey;
  }
}

export class DuplicateEntityContextError extends Error {
  readonly entityKeys: string[];

  constructor(entityKeys: string[]) {
    super("Duplicate entity keys cannot be batched");
    this.name = "DuplicateEntityContextError";
    this.entityKeys = entityKeys;
  }
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function validateBudget(budget: number): void {
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new RangeError("inputBudgetTokens must be a positive safe integer");
  }
}

function evidenceText(evidence: EntityEvidence): string {
  return [
    evidence.entityKey,
    evidence.entityType ?? "",
    evidence.facts.join("\n"),
    evidence.exactSource.map((item) => item.text).join("\n"),
    evidence.links.join("\n"),
  ].join("\n");
}

function normalizedText(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n");
}

export function renderEntityContextMessages(
  units: readonly WikiSectionUnit[],
  opts: LlmCallOptions,
  fixedMessages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  void opts;
  if (units.length === 0) return [...fixedMessages];
  const content = [
    "Wiki context contract: use only complete governed sections below.",
    ...units.map((unit) => [
      `Path: ${unit.path}`,
      `Heading: ${unit.heading}`,
      `Section hash: ${unit.sectionHash}`,
      `Authority: ${unit.required ? `${unit.path}#${unit.sourceOrdinal}:${unit.sectionHash}` : "none"}`,
      `Duplicates: ${unit.duplicatePaths.join(",")}`,
      "Text:",
      unit.text,
    ].join("\n")),
  ].join("\n\n");
  return [...fixedMessages, { role: "user", content }];
}

function makeUnit(
  path: string,
  markdown: string,
  heading: string,
  sourceOrdinal: number,
  score: number,
  required: boolean,
  duplicatePaths: string[] = [path],
): WikiSectionUnit {
  return {
    id: `${path}::${heading}::${sourceOrdinal}`,
    source: "wiki",
    text: markdown,
    required,
    priority: score,
    estimatedTokens: new TextEncoder().encode(markdown).byteLength,
    pageId: pageId(path),
    path,
    heading,
    sectionHash: "",
    score,
    sourceOrdinal,
    duplicatePaths,
  };
}

export function buildEntityContext(input: EntityContextInput): EntityContextResult {
  validateBudget(input.inputBudgetTokens);
  if (input.linkSectionPurpose !== undefined && input.linkSectionPurpose !== "duplicate-merge") {
    throw new RangeError("linkSectionPurpose must be \"duplicate-merge\" when provided");
  }
  if (input.targetPath !== undefined) validateGovernedCandidatePath(input.targetPath);
  for (const path of input.candidatePages.keys()) {
    validateGovernedCandidatePath(path);
  }
  if (input.targetPath !== undefined && !input.candidatePages.has(input.targetPath)) {
    throw new TargetContextMissingError(input.targetPath);
  }
  const queryTokens = tokenizeLexical(evidenceText(input.evidence));
  const byPage = new Map<string, WikiSectionUnit[]>();
  const targetSections: WikiSectionUnit[] = [];
  const candidateUnits: WikiSectionUnit[] = [];

  const candidateEntries = [...input.candidatePages.entries()]
    .sort((a, b) => (a[0] === input.targetPath ? -1 : b[0] === input.targetPath ? 1 : compareCodePoints(a[0], b[0])));
  for (const [path, markdown] of candidateEntries) {
    const sections = extractCompleteH2Sections(markdown);
    for (const section of sections) {
      const isLinkSection = /^(?:##\s+)(?:Related|External links)\s*$/iu.test(section.heading);
      if (isLinkSection && input.linkSectionPurpose !== "duplicate-merge") continue;
      const score = scoreLexicalChunk(queryTokens, {
        articleId: pageId(path), path, heading: section.heading, body: section.markdown,
        ordinal: section.ordinal,
      }).score;
      const unit = makeUnit(path, section.markdown, section.heading, section.ordinal, score, false);
      unit.sectionHash = section.contentHash;
      candidateUnits.push(unit);
    }
  }

  const duplicateGroups = new Map<string, WikiSectionUnit[]>();
  for (const unit of candidateUnits) {
    const key = normalizedText(unit.text);
    let group = duplicateGroups.get(key);
    if (!group) {
      group = [];
      duplicateGroups.set(key, group);
    }
    group.push(unit);
  }
  for (const group of duplicateGroups.values()) {
    const representative = [...group].sort((a, b) => {
      const aTarget = a.path === input.targetPath ? 1 : 0;
      const bTarget = b.path === input.targetPath ? 1 : 0;
      return bTarget - aTarget
        || b.score - a.score
        || compareCodePoints(a.path, b.path)
        || a.sourceOrdinal - b.sourceOrdinal;
    })[0];
    representative.duplicatePaths = [...new Set(group.map((unit) => unit.path))].sort(compareCodePoints);
    const items = byPage.get(representative.path) ?? [];
    items.push(representative);
    byPage.set(representative.path, items);
    if (representative.path === input.targetPath) targetSections.push(representative);
  }
  for (const items of byPage.values()) {
    items.sort((a, b) => b.score - a.score || compareCodePoints(a.path, b.path) || a.sourceOrdinal - b.sourceOrdinal);
  }

  if (input.targetPath !== undefined && targetSections.length === 0) {
    throw new TargetContextMissingError(input.targetPath);
  }

  let required: WikiSectionUnit[] = [];
  if (input.targetPath && targetSections.length > 0) {
    const target = [...targetSections].sort((a, b) => b.score - a.score || a.sourceOrdinal - b.sourceOrdinal)[0];
    required = [{ ...target, required: true }];
  }
  const requiredIds = new Set(required.map((unit) => unit.id));
  for (const [path, items] of byPage) {
    const remaining = items.filter((unit) => !requiredIds.has(unit.id));
    if (remaining.length > 0) byPage.set(path, remaining);
    else byPage.delete(path);
  }
  const optional: WikiSectionUnit[] = [];
  const maxRounds = Math.max(0, ...Array.from(byPage, ([path, items]) => (
    path === input.targetPath ? items.length + 1 : items.length
  )));
  for (let round = 0; round < maxRounds; round++) {
    const candidates = [...byPage.entries()]
      .map(([path, items]) => path === input.targetPath ? (round === 0 ? undefined : items[round - 1]) : items[round])
      .filter((unit): unit is WikiSectionUnit => unit !== undefined)
      .sort((a, b) => b.score - a.score || compareCodePoints(a.path, b.path) || a.sourceOrdinal - b.sourceOrdinal);
    optional.push(...candidates);
  }
  optional.forEach((unit, index) => {
    unit.priority = optional.length - index;
  });

  const renderer = input.renderEntityContextMessages ?? input.render ?? renderEntityContextMessages;

  try {
    const packed = packContextUnits({
      inputBudgetTokens: input.inputBudgetTokens,
      fixedMessages: input.fixedMessages,
      opts: input.opts,
      units: [...required, ...optional],
      render: (units, opts, fixedMessages) => renderer(units as readonly WikiSectionUnit[], opts, fixedMessages),
    });
    return {
      units: packed.selected as WikiSectionUnit[],
      replaceAuthorities: required.map((unit) => ({
        path: unit.path,
        heading: unit.heading,
        sectionOrdinal: unit.sourceOrdinal,
        sectionHash: unit.sectionHash,
        exactSection: unit.text,
      })),
      estimatedInputTokens: packed.estimatedInputTokens,
    };
  } catch (error) {
    const estimated = error instanceof Error && "estimated" in error
      ? Number((error as { estimated: number }).estimated)
      : input.inputBudgetTokens + 1;
    throw new ContextSplitRequiredError(
      required.length > 0
        ? "Required target context exceeds input budget; reduce evidence before synthesis"
        : "Context fixed/rendered overhead exceeds input budget; reduce evidence before synthesis",
      input.inputBudgetTokens,
      estimated,
    );
  }
}

export function batchEntityContexts(
  bundles: EntityContextBundle[],
  inputBudgetTokens: number,
  renderBatch: (bundles: EntityContextBundle[]) => OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): EntityContextBundle[][] {
  validateBudget(inputBudgetTokens);
  void opts;
  const sorted = [...bundles].sort((a, b) => compareCodePoints(a.entityKey, b.entityKey));
  const duplicateKeys = sorted.filter((bundle, index) => index > 0 && bundle.entityKey === sorted[index - 1].entityKey)
    .map((bundle) => bundle.entityKey);
  if (duplicateKeys.length > 0) throw new DuplicateEntityContextError([...new Set(duplicateKeys)]);
  const cloneBundle = (bundle: EntityContextBundle): EntityContextBundle => ({
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
  });
  const renderSnapshot = (items: EntityContextBundle[]) => renderBatch(items.map(cloneBundle));
  const batches: EntityContextBundle[][] = [];
  let current: EntityContextBundle[] = [];
  for (const bundle of sorted) {
    const candidate = [...current, bundle];
    const estimated = estimatePreparedMessages(renderSnapshot(candidate));
    if (estimated <= inputBudgetTokens) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw new ContextSplitRequiredError(
        "Entity context bundle exceeds input budget; reduce evidence before batching",
        inputBudgetTokens,
        estimated,
        bundle.entityKey,
      );
    }
    batches.push(current);
    current = [];
    const singletonEstimate = estimatePreparedMessages(renderSnapshot([bundle]));
    if (singletonEstimate > inputBudgetTokens) {
      throw new ContextSplitRequiredError(
        "Entity context bundle exceeds input budget; reduce evidence before batching",
        inputBudgetTokens,
        singletonEstimate,
        bundle.entityKey,
      );
    }
    current = [bundle];
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
