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
  consolidatedEntityKeys?: string[];
}

export interface ConsolidatedEntityAssignment {
  entityKey: string;
  parentEntityKey: string;
}

export interface ConsolidatedEntityBundles {
  kept: EntityContextBundle[];
  consolidated: ConsolidatedEntityAssignment[];
  overflowEntityKeys: string[];
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

function cloneEntityContextBundle(bundle: EntityContextBundle): EntityContextBundle {
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
    ...(bundle.consolidatedEntityKeys === undefined
      ? {}
      : { consolidatedEntityKeys: [...bundle.consolidatedEntityKeys] }),
  };
}

function uniqueValues<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function coveredEvidenceLines(bundle: EntityContextBundle): number {
  return bundle.evidence.exactSourceRanges.reduce(
    (sum, range) => sum + Math.max(0, range.endLine - range.startLine + 1),
    0,
  );
}

function evidenceStrength(bundle: EntityContextBundle): number {
  const coveredLines = coveredEvidenceLines(bundle);
  const exactChars = bundle.evidence.exactSource.reduce((sum, source) => sum + source.text.length, 0);
  return bundle.evidence.facts.length * 16
    + bundle.evidence.exactSourceRanges.length * 8
    + coveredLines * 4
    + Math.min(16, Math.floor(exactChars / 128));
}

function rangeDistance(left: EntityContextBundle, right: EntityContextBundle): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const a of left.evidence.exactSourceRanges) {
    for (const b of right.evidence.exactSourceRanges) {
      const gap = a.endLine < b.startLine
        ? b.startLine - a.endLine - 1
        : b.endLine < a.startLine
          ? a.startLine - b.endLine - 1
          : 0;
      distance = Math.min(distance, gap);
    }
  }
  return distance;
}

function firstEvidenceLine(bundle: EntityContextBundle): number {
  return Math.min(
    Number.POSITIVE_INFINITY,
    ...bundle.evidence.exactSourceRanges.map((range) => range.startLine),
  );
}

function nearestParent(
  child: EntityContextBundle,
  parents: readonly EntityContextBundle[],
): { parent: EntityContextBundle; distance: number } | undefined {
  return parents
    .map((parent) => ({ parent, distance: rangeDistance(child, parent) }))
    .sort((left, right) => left.distance - right.distance
      || evidenceStrength(right.parent) - evidenceStrength(left.parent)
      || compareCodePoints(left.parent.entityKey, right.parent.entityKey))[0];
}

function strictlyContainsEvidence(
  parent: EntityContextBundle,
  child: EntityContextBundle,
): boolean {
  if (parent.entityKey === child.entityKey || child.evidence.exactSourceRanges.length === 0) return false;
  const containsEveryRange = child.evidence.exactSourceRanges.every((childRange) =>
    parent.evidence.exactSourceRanges.some((parentRange) =>
      parentRange.startLine <= childRange.startLine && parentRange.endLine >= childRange.endLine));
  return containsEveryRange && coveredEvidenceLines(parent) > coveredEvidenceLines(child);
}

function nearestContainingParent(
  child: EntityContextBundle,
  parents: readonly EntityContextBundle[],
): EntityContextBundle | undefined {
  return parents
    .filter((parent) => strictlyContainsEvidence(parent, child))
    .sort((left, right) => coveredEvidenceLines(left) - coveredEvidenceLines(right)
      || evidenceStrength(right) - evidenceStrength(left)
      || compareCodePoints(left.entityKey, right.entityKey))[0];
}

function mergeEvidenceBundle(parent: EntityContextBundle, child: EntityContextBundle): void {
  parent.evidence.packetIds = uniqueValues(
    [...parent.evidence.packetIds, ...child.evidence.packetIds],
    (value) => value,
  );
  parent.evidence.facts = uniqueValues(
    [...parent.evidence.facts, ...child.evidence.facts],
    (value) => value,
  );
  parent.evidence.exactSourceRanges = uniqueValues(
    [...parent.evidence.exactSourceRanges, ...child.evidence.exactSourceRanges],
    (range) => `${range.startLine}:${range.endLine}`,
  );
  parent.evidence.exactSource = uniqueValues(
    [...parent.evidence.exactSource, ...child.evidence.exactSource],
    (source) => `${source.startLine}:${source.endLine}:${source.text}`,
  );
  parent.evidence.links = uniqueValues(
    [...parent.evidence.links, ...child.evidence.links],
    (value) => value,
  );
  parent.consolidatedEntityKeys = uniqueValues([
    ...(parent.consolidatedEntityKeys ?? []),
    child.entityKey,
    ...(child.consolidatedEntityKeys ?? []),
  ], (value) => value);
  parent.estimatedInputTokens += child.estimatedInputTokens;
}

function mergeSameTargetContext(parent: EntityContextBundle, child: EntityContextBundle): void {
  for (const childUnit of child.units) {
    const existing = parent.units.find((unit) => unit.id === childUnit.id);
    if (existing === undefined) {
      parent.units.push({ ...childUnit, duplicatePaths: [...childUnit.duplicatePaths] });
      continue;
    }
    existing.required ||= childUnit.required;
    existing.priority = Math.max(existing.priority, childUnit.priority);
    existing.score = Math.max(existing.score, childUnit.score);
    existing.duplicatePaths = uniqueValues(
      [...existing.duplicatePaths, ...childUnit.duplicatePaths],
      (value) => value,
    ).sort(compareCodePoints);
  }
  parent.replaceAuthorities = uniqueValues(
    [...parent.replaceAuthorities, ...child.replaceAuthorities.map((authority) => ({ ...authority }))],
    (authority) => [
      authority.path,
      authority.heading,
      authority.sectionOrdinal,
      authority.sectionHash,
      authority.exactSection,
    ].join("\u0000"),
  );
}

export function consolidateSameTargetEntityBundles(
  sourceBundles: readonly EntityContextBundle[],
  targetPathByEntityKey: ReadonlyMap<string, string>,
  preferredCarrierEntityKeys: ReadonlySet<string> = new Set(),
): ConsolidatedEntityBundles {
  const bundles = sourceBundles.map(cloneEntityContextBundle);
  const byTarget = new Map<string, EntityContextBundle[]>();
  for (const bundle of bundles) {
    const target = targetPathByEntityKey.get(bundle.entityKey);
    if (target === undefined) continue;
    const group = byTarget.get(target) ?? [];
    group.push(bundle);
    byTarget.set(target, group);
  }

  const removed = new Set<string>();
  const consolidated: ConsolidatedEntityAssignment[] = [];
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) =>
      Number(preferredCarrierEntityKeys.has(right.entityKey))
      - Number(preferredCarrierEntityKeys.has(left.entityKey))
      || evidenceStrength(right) - evidenceStrength(left)
      || firstEvidenceLine(left) - firstEvidenceLine(right)
      || compareCodePoints(left.entityKey, right.entityKey));
    const parent = ranked[0];
    for (const child of ranked.slice(1)) {
      mergeEvidenceBundle(parent, child);
      mergeSameTargetContext(parent, child);
      removed.add(child.entityKey);
      consolidated.push({ entityKey: child.entityKey, parentEntityKey: parent.entityKey });
    }
  }

  return {
    kept: bundles.filter((bundle) => !removed.has(bundle.entityKey)),
    consolidated,
    overflowEntityKeys: [],
  };
}

export function consolidateSmallEntityBundles(
  sourceBundles: readonly EntityContextBundle[],
  maxEntities: number,
  createPathEntityKeys?: ReadonlySet<string>,
  preferredCreateEntityKeys: ReadonlySet<string> = new Set(),
  sourcePrimaryEntityKeys?: ReadonlySet<string>,
): ConsolidatedEntityBundles {
  const bundles = sourceBundles.map(cloneEntityContextBundle);
  const consolidated: ConsolidatedEntityAssignment[] = [];
  const removed = new Set<string>();
  const hasExistingTarget = (bundle: EntityContextBundle): boolean =>
    bundle.replaceAuthorities.length > 0 || bundle.units.some((unit) => unit.required);
  const hasPathAuthority = (bundle: EntityContextBundle): boolean =>
    createPathEntityKeys === undefined
    || createPathEntityKeys.has(bundle.entityKey)
    || hasExistingTarget(bundle);
  const requestedTarget = Number.isSafeInteger(maxEntities) && maxEntities > 0
    ? maxEntities
    : bundles.length;
  const actionable = bundles.filter(hasPathAuthority);
  const supportingParents = new Map<string, EntityContextBundle>();
  for (const child of actionable) {
    if (hasExistingTarget(child)) continue;
    const parent = nearestContainingParent(child, actionable);
    if (parent !== undefined) supportingParents.set(child.entityKey, parent);
  }

  if (sourcePrimaryEntityKeys !== undefined && actionable.length > 0) {
    const containingChildCount = (bundle: EntityContextBundle): number => actionable
      .filter((candidate) => strictlyContainsEvidence(bundle, candidate))
      .length;
    const ranked = [...actionable].sort((left, right) =>
      Number(sourcePrimaryEntityKeys.has(right.entityKey))
      - Number(sourcePrimaryEntityKeys.has(left.entityKey))
      || coveredEvidenceLines(right) - coveredEvidenceLines(left)
      || containingChildCount(right) - containingChildCount(left)
      || evidenceStrength(right) - evidenceStrength(left)
      || Number(preferredCreateEntityKeys.has(right.entityKey))
      - Number(preferredCreateEntityKeys.has(left.entityKey))
      || firstEvidenceLine(left) - firstEvidenceLine(right)
      || compareCodePoints(left.entityKey, right.entityKey));
    const primary = ranked[0];
    const eligibleKeys = new Set(actionable
      .filter(hasExistingTarget)
      .map((bundle) => bundle.entityKey));
    eligibleKeys.add(primary.entityKey);

    const remainingCapacity = Math.max(0, requestedTarget - eligibleKeys.size);
    const additional = actionable
      .filter((bundle) => !eligibleKeys.has(bundle.entityKey))
      .sort((left, right) =>
        Number(preferredCreateEntityKeys.has(right.entityKey))
        - Number(preferredCreateEntityKeys.has(left.entityKey))
        || Number(supportingParents.has(left.entityKey))
        - Number(supportingParents.has(right.entityKey))
        || evidenceStrength(right) - evidenceStrength(left)
        || firstEvidenceLine(left) - firstEvidenceLine(right)
        || compareCodePoints(left.entityKey, right.entityKey))
      .slice(0, remainingCapacity);
    for (const bundle of additional) eligibleKeys.add(bundle.entityKey);

    const eligible = bundles.filter((bundle) => eligibleKeys.has(bundle.entityKey));
    const primaryCarrier = eligible.find((bundle) => bundle.entityKey === primary.entityKey);
    for (const child of bundles.filter((bundle) => !eligibleKeys.has(bundle.entityKey))) {
      const parent = primaryCarrier
        ?? nearestContainingParent(child, eligible)
        ?? nearestParent(child, eligible)?.parent;
      if (parent === undefined) continue;
      mergeEvidenceBundle(parent, child);
      removed.add(child.entityKey);
      consolidated.push({ entityKey: child.entityKey, parentEntityKey: parent.entityKey });
    }

    const kept = bundles.filter((bundle) => !removed.has(bundle.entityKey));
    const overflowEntityKeys = kept.length > requestedTarget
      ? kept.slice(requestedTarget).map((bundle) => bundle.entityKey)
      : [];
    return { kept, consolidated, overflowEntityKeys };
  }

  const eligibleKeys = new Set(actionable
    .filter((bundle) => hasExistingTarget(bundle) || !supportingParents.has(bundle.entityKey))
    .map((bundle) => bundle.entityKey));
  const promotionCapacity = Math.max(0, requestedTarget - eligibleKeys.size);
  const promoted = actionable
    .filter((bundle) => supportingParents.has(bundle.entityKey)
      && preferredCreateEntityKeys.has(bundle.entityKey))
    .sort((left, right) => evidenceStrength(right) - evidenceStrength(left)
      || firstEvidenceLine(left) - firstEvidenceLine(right)
      || compareCodePoints(left.entityKey, right.entityKey))
    .slice(0, promotionCapacity);
  for (const bundle of promoted) eligibleKeys.add(bundle.entityKey);

  if (eligibleKeys.size === 0 && actionable.length > 0) {
    const fallback = [...actionable].sort((left, right) =>
      Number(preferredCreateEntityKeys.has(right.entityKey))
      - Number(preferredCreateEntityKeys.has(left.entityKey))
      || evidenceStrength(right) - evidenceStrength(left)
      || firstEvidenceLine(left) - firstEvidenceLine(right)
      || compareCodePoints(left.entityKey, right.entityKey))[0];
    eligibleKeys.add(fallback.entityKey);
  }

  const eligible = bundles.filter((bundle) => eligibleKeys.has(bundle.entityKey));
  for (const child of bundles.filter((bundle) =>
    hasPathAuthority(bundle) && !eligibleKeys.has(bundle.entityKey))) {
    const parent = nearestContainingParent(child, eligible)
      ?? nearestParent(child, eligible)?.parent;
    if (parent === undefined) continue;
    mergeEvidenceBundle(parent, child);
    removed.add(child.entityKey);
    consolidated.push({ entityKey: child.entityKey, parentEntityKey: parent.entityKey });
  }

  let kept = bundles.filter((bundle) => !removed.has(bundle.entityKey));
  const finalActionable = kept.filter((bundle) => eligibleKeys.has(bundle.entityKey));
  if (finalActionable.length > 0 && finalActionable.length < kept.length) {
    for (const child of kept.filter((bundle) => !eligibleKeys.has(bundle.entityKey))) {
      const nearest = nearestParent(child, finalActionable);
      if (nearest === undefined) continue;
      mergeEvidenceBundle(nearest.parent, child);
      consolidated.push({ entityKey: child.entityKey, parentEntityKey: nearest.parent.entityKey });
    }
    kept = kept.filter((bundle) => eligibleKeys.has(bundle.entityKey));
  }

  const overflowEntityKeys = kept.length > requestedTarget
    ? kept.slice(requestedTarget).map((bundle) => bundle.entityKey)
    : [];
  return { kept, consolidated, overflowEntityKeys };
}

export function batchEntityContexts(
  bundles: EntityContextBundle[],
  inputBudgetTokens: number,
  renderBatch: (bundles: EntityContextBundle[]) => OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): EntityContextBundle[][] {
  validateBudget(inputBudgetTokens);
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
    ...(bundle.consolidatedEntityKeys === undefined
      ? {}
      : { consolidatedEntityKeys: [...bundle.consolidatedEntityKeys] }),
  });
  const estimateBatch = (items: EntityContextBundle[]) => estimatePreparedMessages(
    renderBatch(items.map(cloneBundle)),
    opts.tokenCalibration,
  );
  const compressSingletonEvidence = (bundle: EntityContextBundle): EntityContextBundle => {
    const compressed = cloneBundle(bundle);
    if (estimateBatch([compressed]) <= inputBudgetTokens) return compressed;

    const optionalUnits = compressed.units
      .map((unit, index) => ({ unit, index }))
      .filter(({ unit }) => !unit.required)
      .sort((a, b) => a.unit.priority - b.unit.priority || b.index - a.index);
    for (const optional of optionalUnits) {
      if (estimateBatch([compressed]) <= inputBudgetTokens) break;
      compressed.units.splice(compressed.units.indexOf(optional.unit), 1);
    }
    while (compressed.evidence.links.length > 0 && estimateBatch([compressed]) > inputBudgetTokens) {
      compressed.evidence.links.pop();
    }
    while (compressed.evidence.exactSource.length > 1 && estimateBatch([compressed]) > inputBudgetTokens) {
      compressed.evidence.exactSource.pop();
    }
    while (compressed.evidence.exactSourceRanges.length > 1 && estimateBatch([compressed]) > inputBudgetTokens) {
      compressed.evidence.exactSourceRanges.pop();
    }
    while (compressed.evidence.facts.length > 1 && estimateBatch([compressed]) > inputBudgetTokens) {
      compressed.evidence.facts.pop();
    }
    while (compressed.evidence.packetIds.length > 1 && estimateBatch([compressed]) > inputBudgetTokens) {
      compressed.evidence.packetIds.pop();
    }
    if (compressed.evidence.exactSource.length > 0) {
      let text = compressed.evidence.exactSource[0].text;
      while (text.length > 256 && estimateBatch([compressed]) > inputBudgetTokens) {
        text = text.slice(0, Math.max(256, Math.floor(text.length / 2)));
        compressed.evidence.exactSource[0].text = `${text}\n[truncated for prompt budget]`;
      }
    }
    compressed.estimatedInputTokens = Math.min(compressed.estimatedInputTokens, inputBudgetTokens);
    return compressed;
  };
  const batches: EntityContextBundle[][] = [];
  let current: EntityContextBundle[] = [];
  for (const sourceBundle of sorted) {
    const bundle = compressSingletonEvidence(sourceBundle);
    const candidate = [...current, bundle];
    const estimated = estimateBatch(candidate);
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
    const singletonEstimate = estimateBatch([bundle]);
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
