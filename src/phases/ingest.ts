import { dirname, isAbsolute, join, relative } from "path-browserify";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { DomainEntry } from "../domain";
import { mergeEntityTypes } from "../domain";
import { EmbeddingUnavailableError } from "../embedding-error";
import { contentHash } from "../content-hash";
import { hashSource } from "../incremental-sources";
import {
  batchEntityContexts,
  buildEntityContext,
  type EntityContextBundle,
} from "../ingest-context";
import type { ContextUnit } from "../prompt-budget";
import {
  applyPagePatch,
  inspectPatchablePage,
  normalizeSectionHeading,
  type ReplaceSectionAuthority,
} from "../section-patches";
import type {
  IngestOutcome,
  IngestInternalExecution,
  LlmCallOptions,
  LlmClient,
  ModelCallPolicy,
  RunEvent,
} from "../types";
import {
  ensureDescription,
  ensureResource,
  ensureSourcesSection,
  ensureType,
  entityTypeFromPath,
  filterStaleWikiLinks,
  normalizeTag,
  parseResourceFromFm,
  parseTagsFromFm,
  recoverSourceFrontmatter,
  stripInvalidWikiArticles,
  upsertRawFrontmatter,
  validateAndRepairSourceFrontmatter,
  validateAndRepairWikiPageFrontmatter,
} from "../utils/raw-frontmatter";
import {
  DEFAULT_MAX_TAG_CATEGORIES,
  ensureEntityTypeTag,
  renderTagRegistryBlock,
  thematicCategories,
  type TagRegistry,
} from "../utils/tag-registry";
import type { VaultTools } from "../vault-tools";
import { pageId } from "../wiki-graph";
import {
  readPageDescriptions,
  reconcilePageIndex,
  removeArticleIndexWithAuthority,
  restoreArticleIndexAuthority,
} from "../wiki-index-store";
import type { PageIndexRecord, WikiIndexRecord } from "../wiki-index-jsonl";
import { pageIndexRecordFromMarkdown } from "../wiki-index";
import { fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
import { appendWikiLog, type IngestLogEntry } from "../wiki-log";
import {
  domainWikiFolder,
  effectiveSubfolder,
  isWikiPagePath,
  validateArticlePath,
} from "../wiki-path";
import {
  fileImage,
  TransactionVaultTools,
} from "../file-transaction";
import { GENERIC_WIKI_STEM_REGEX, buildWikiStem, stemRegex } from "../wiki-stem";
import { ensureDomainConfig } from "../domain-config";
import { i18nFor, resolveLang } from "../i18n";
import { promptVersionOf } from "../prompt-version";
import ingestTemplate from "../../prompts/ingest.md";
import wikiSchemaTemplate from "../../templates/_wiki_schema.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import {
  EvidenceCoverageError,
  EvidenceReducerError,
  prepareSourceEvidence,
  type EntityEvidence,
} from "./ingest-evidence";
import {
  ConflictRegenerationExhaustedError,
  ConflictStillStaleError,
  mergeSynthesisBatchOutputs,
  regenerateConflictedPatch,
  SynthesisSplitRequiredError,
  SynthesisStructuredError,
  synthesizeEntityBatch,
  type SynthesisPageDescription,
  type SynthesisPathPolicy,
} from "./ingest-synthesis";
import type { SynthesisAction, SynthesisOutput } from "./zod-schemas";
import { routeAndValidatePages } from "./entity-routing";
import { PageSimilarityService, type ExtractedEntity } from "../page-similarity";
import { RunEventBridge } from "../run-event-bridge";
import { lifecycleEvent } from "../llm-lifecycle";

function parseWikiStatus(content: string): string {
  const match = /^---\n[\s\S]*?^status:[ \t]*(.+)$/m.exec(content);
  return match ? match[1].trim() : "unknown";
}

async function readPagesStrict(vaultTools: VaultTools, paths: string[]): Promise<Map<string, string>> {
  return new Map(await Promise.all(paths.map(async (path) =>
    [path, await vaultTools.read(path)] as const)));
}

function makeFailure(
  stage: Extract<IngestOutcome, { ok: false }>["stage"],
  message: string,
  sourcePath?: string,
  retryable = true,
): IngestOutcome {
  return {
    ok: false,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    stage,
    message,
    retryable,
  };
}

function modelPolicy(opts: LlmCallOptions): ModelCallPolicy {
  return {
    inputBudgetTokens: opts.inputBudgetTokens ?? 16_384,
    ...(opts.maxTokens === undefined ? {} : { outputBudgetTokens: opts.maxTokens }),
    compression: opts.semanticCompression?.profile ?? "balanced",
  };
}

function pageEntityKey(domainId: string, record: PageIndexRecord): string {
  const prefix = `wiki_${domainId}_`;
  return record.articleId.startsWith(prefix)
    ? record.articleId.slice(prefix.length)
    : record.articleId;
}

function typedDescriptions(
  domainId: string,
  records: readonly PageIndexRecord[],
): SynthesisPageDescription[] {
  return records.map((record) => ({
    entityKey: pageEntityKey(domainId, record),
    path: record.path,
    description: record.description,
    entityType: record.type,
  }));
}

function registryFromRecords(records: readonly PageIndexRecord[], sourceContent: string): TagRegistry {
  const categories = new Map<string, Map<string, number>>();
  const tags = [
    ...records.flatMap((record) => record.tags ?? []),
    ...parseTagsFromFm(sourceContent),
  ];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const category = tag.split("/")[0];
    const values = categories.get(category) ?? new Map<string, number>();
    values.set(tag, (values.get(tag) ?? 0) + 1);
    categories.set(category, values);
  }
  return {
    categories,
    total: [...categories.values()].reduce((sum, values) => sum + values.size, 0),
  };
}

function tagRegistryUnits(text: string): ContextUnit[] {
  if (!text) return [];
  return [{
    id: "domain-tag-registry",
    source: "registry",
    text,
    required: false,
    priority: 1,
    estimatedTokens: new TextEncoder().encode(text).byteLength,
  }];
}

function actionAuthorities(
  bundles: readonly EntityContextBundle[],
  path: string,
): ReplaceSectionAuthority[] {
  return bundles.flatMap((bundle) =>
    bundle.replaceAuthorities.filter((authority) => authority.path === path));
}

function targetPathFor(
  evidence: EntityEvidence,
  domain: DomainEntry,
  domainRoot: string,
  existingPaths: ReadonlySet<string>,
): string | undefined {
  const entityType = domain.entity_types?.find((candidate) => candidate.type === evidence.entityType);
  if (!entityType) return undefined;
  let stem: string;
  try {
    stem = buildWikiStem(domain.id, evidence.entityKey);
  } catch {
    return undefined;
  }
  const path = `${domainRoot}/${effectiveSubfolder(entityType)}/${stem}.md`;
  return existingPaths.has(path) ? path : undefined;
}

function processPageContent(
  content: string,
  annotation: string,
  path: string,
  domain: DomainEntry,
  domainRoot: string,
  sourceStem: string,
  additionalResources: readonly string[] = [],
): { content: string; warnings: string[]; tags: string[] } {
  const repaired = validateAndRepairWikiPageFrontmatter(content);
  const entityTagged = ensureEntityTypeTag(repaired.content, path, domain);
  const typed = ensureType(entityTagged.content, entityTypeFromPath(domainRoot, path));
  const described = ensureDescription(typed, annotation);
  const sourced = ensureResource(described, sourceStem);
  const withSources = reconcilePageProvenance(
    sourced.content,
    null,
    sourceStem,
    additionalResources,
  );
  return {
    content: withSources,
    warnings: [
      ...repaired.warnings,
      ...(entityTagged.added && entityTagged.tag ? [`tags: + ${entityTagged.tag}`] : []),
      ...(sourced.injected ? [`resource: + [[${sourceStem}]]`] : []),
    ],
    tags: parseTagsFromFm(withSources),
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

function setPageResources(content: string, resources: readonly string[]): string {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) return content;
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(match[1]) as Record<string, unknown>) ?? {};
  } catch {
    return content;
  }
  parsed.resource = [...resources];
  return `---\n${yamlStringify(parsed)}---\n${content.slice(match[0].length)}`;
}

function regenerateSourcesSection(content: string, resources: readonly string[]): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## sources");
  if (start < 0) return ensureSourcesSection(content, [...resources]);
  const next = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const end = next < 0 ? lines.length : next;
  const withoutManagedSection = [
    ...lines.slice(0, start),
    ...lines.slice(end),
  ].join("\n").replace(/\s*$/, "\n");
  return ensureSourcesSection(withoutManagedSection, [...resources]);
}

function reconcilePageProvenance(
  content: string,
  existing: string | null,
  sourceStem: string,
  additionalResources: readonly string[] = [],
): string {
  const resources = [...new Set([
    ...parseResourceFromFm(existing ?? ""),
    ...parseResourceFromFm(content),
    ...additionalResources,
    sourceStem,
  ].map((value) => value.trim()).filter(Boolean))].sort(compareCodePoints);
  return regenerateSourcesSection(setPageResources(content, resources), resources);
}

function normalizedKnowledgeBlocks(markdown: string): string[] {
  const blocks = markdown
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((block) => block.split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .filter(Boolean))
    .filter((lines) => lines.length > 0);
  return blocks.flatMap((lines) => {
    const isSet = lines.every((line) => /^(?:[-+*]|\d+[.)])\s+/.test(line));
    return isSet ? lines : [lines.join("\n")];
  });
}

function metadataValueIsRepresented(canonical: unknown, duplicate: unknown): boolean {
  if (Array.isArray(duplicate)) {
    if (!Array.isArray(canonical)) return false;
    return duplicate.every((duplicateItem) =>
      canonical.some((canonicalItem) => metadataValueIsRepresented(canonicalItem, duplicateItem)));
  }
  if (duplicate !== null && typeof duplicate === "object") {
    if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) return false;
    return Object.entries(duplicate).every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(canonical, key)
      && metadataValueIsRepresented((canonical as Record<string, unknown>)[key], value));
  }
  if (typeof duplicate === "string") {
    return typeof canonical === "string"
      && canonical.normalize("NFC").trim().replace(/\s+/g, " ")
        === duplicate.normalize("NFC").trim().replace(/\s+/g, " ");
  }
  return Object.is(canonical, duplicate);
}

function pageMetadata(content: string): Record<string, unknown> | null {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) return {};
  try {
    const parsed: unknown = yamlParse(match[1]);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function preambleWithoutFrontmatter(content: string): string {
  const preamble = inspectPatchablePage(content).preamble;
  return preamble.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function duplicateEvidenceIsRepresented(canonical: string, duplicate: string): boolean {
  const canonicalMetadata = pageMetadata(canonical);
  const duplicateMetadata = pageMetadata(duplicate);
  if (canonicalMetadata === null || duplicateMetadata === null) return false;
  for (const [key, value] of Object.entries(duplicateMetadata)) {
    if (key.trim().toLowerCase() === "resource") continue;
    if (!Object.prototype.hasOwnProperty.call(canonicalMetadata, key)
      || !metadataValueIsRepresented(canonicalMetadata[key], value)) return false;
  }

  const canonicalPreamble = new Set(normalizedKnowledgeBlocks(preambleWithoutFrontmatter(canonical)));
  const duplicatePreamble = normalizedKnowledgeBlocks(preambleWithoutFrontmatter(duplicate));
  if (!duplicatePreamble.every((block) => canonicalPreamble.has(block))) return false;

  const canonicalSections = new Map<string, Set<string>>();
  for (const section of inspectPatchablePage(canonical).sections) {
    const heading = normalizeSectionHeading(section.heading);
    const blocks = canonicalSections.get(heading) ?? new Set<string>();
    const body = section.span.replace(/^[^\r\n]*(?:\r\n|\n|\r)?/, "");
    normalizedKnowledgeBlocks(body).forEach((block) => blocks.add(block));
    canonicalSections.set(heading, blocks);
  }
  let representedBlocks = duplicatePreamble.length;
  for (const section of inspectPatchablePage(duplicate).sections) {
    const heading = normalizeSectionHeading(section.heading);
    const body = section.span.replace(/^[^\r\n]*(?:\r\n|\n|\r)?/, "");
    const duplicateBlocks = normalizedKnowledgeBlocks(body);
    representedBlocks += duplicateBlocks.length;
    const canonicalBlocks = canonicalSections.get(heading);
    if (duplicateBlocks.some((block) => !canonicalBlocks?.has(block))) return false;
  }
  return representedBlocks > 0;
}

export async function collectSourceStems(
  domain: DomainEntry,
  vaultTools: VaultTools,
  vaultRoot: string,
): Promise<Set<string>> {
  const stems = new Set<string>();
  for (const sourcePath of domain.source_paths ?? []) {
    const vaultPath = isAbsolute(sourcePath)
      ? vaultTools.toVaultPath(sourcePath) ?? ""
      : (sourcePath.endsWith("/") ? sourcePath.slice(0, -1) : sourcePath);
    if (!vaultPath) continue;
    const files = await vaultTools.listFiles(vaultPath);
    for (const file of files) {
      if (file.endsWith(".md")) stems.add(file.split("/").pop()!.replace(/\.md$/, ""));
    }
  }
  return stems;
}

export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
  graphDepth = 1,
  wikiLinkValidationRetries = 3,
  internal?: IngestInternalExecution,
): AsyncGenerator<RunEvent, IngestOutcome> {
  void graphDepth;
  const deferred = (
    effects: Omit<NonNullable<Extract<IngestOutcome, { ok: true }>["deferred"]>, "manifestComplete" | "mutations"> = {},
  ): NonNullable<Extract<IngestOutcome, { ok: true }>["deferred"]> | undefined => internal === undefined
    ? undefined
    : {
        ...effects,
        manifestComplete: internal.transaction.manifestComplete,
        mutations: internal.transaction.mutations,
      };
  const failure = (
    stage: Extract<IngestOutcome, { ok: false }>["stage"],
    message: string,
    sourcePath?: string,
    retryable = true,
  ): IngestOutcome => {
    const outcome = makeFailure(stage, message, sourcePath, retryable);
    const effects = deferred();
    return effects === undefined ? outcome : { ...outcome, deferred: effects };
  };
  const requestedPath = args[0];
  if (!requestedPath) {
    const message = "ingest: file path required";
    yield { kind: "error", message };
    return failure("read", message, undefined, false);
  }

  const absoluteSource = isAbsolute(requestedPath) ? requestedPath : join(vaultRoot, requestedPath);
  const sourcePath = vaultTools.toVaultPath(absoluteSource);
  if (!sourcePath) {
    const message = `Source file ${requestedPath} is outside the vault.`;
    yield { kind: "error", message };
    return failure("read", message, undefined, false);
  }

  yield { kind: "tool_use", name: "Read", input: { path: sourcePath } };
  let sourceContent: string;
  try {
    sourceContent = await vaultTools.read(sourcePath);
  } catch (error) {
    const message = `Cannot read ${sourcePath}: ${(error as Error).message}`;
    yield { kind: "tool_result", ok: false, preview: message };
    yield { kind: "error", message };
    return failure("read", message, sourcePath);
  }
  yield { kind: "tool_result", ok: true, preview: sourceContent.slice(0, 100) };
  const processedSourceBodyHash = hashSource(sourceContent);

  const domain = detectDomain(absoluteSource, domains, vaultRoot);
  if (!domain) {
    const message = "No domain found for this file. Configure domain-map.";
    yield { kind: "error", message };
    return failure("context", message, sourcePath, false);
  }
  const domainRoot = vaultTools.toVaultPath(join(vaultRoot, domainWikiFolder(domain.wiki_folder)));
  if (!domainRoot) {
    const message = `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath, false);
  }

  const startedAt = Date.now();
  const policy = modelPolicy(opts);
  const eventBridge = new RunEventBridge();
  const pendingSynthesisLifecycles = new Map<string, Extract<RunEvent, { kind: "llm_lifecycle" }>>();
  let synthesisLifecycleCompleted = false;
  let outputTokens = 0;
  let deferredSourcePathAdded: { domainId: string; path: string } | undefined;
  let deferredLog: {
    sourcePath: string;
    entries: IngestLogEntry[];
    outputTokens: number;
  } | undefined;
  const captureEvent = (event: RunEvent): void => {
    if (event.kind === "llm_call_stats") outputTokens += event.outputTokens;
    if (event.kind === "llm_lifecycle" && event.action === "synthesize_wiki_pages") {
      if (event.phase === "validating") pendingSynthesisLifecycles.set(event.id, event);
      if (["completed", "retrying", "failed", "cancelled"].includes(event.phase)) {
        pendingSynthesisLifecycles.delete(event.id);
      }
    }
    eventBridge.push(event);
  };
  const finalizeSynthesisLifecycles = (
    phase: "completed" | "failed" | "cancelled",
  ): RunEvent[] => {
    const events = [...pendingSynthesisLifecycles.values()].map((lifecycle) =>
      lifecycleEvent(lifecycle.id, lifecycle.action, phase));
    pendingSynthesisLifecycles.clear();
    return events;
  };

  try {
  let pagePaths: string[];
  let pageRecords: PageIndexRecord[];
  try {
    await ensureDomainConfig(vaultTools, domainRoot);
    pagePaths = (await vaultTools.listFiles(domainRoot))
      .filter((path) => isWikiPagePath(path) && validateArticlePath(path, domainRoot));
    const actualPages = await readPagesStrict(vaultTools, pagePaths);
    pageRecords = [...actualPages].map(([path, content]) =>
      pageIndexRecordFromMarkdown(domainRoot, path, content));
    await reconcilePageIndex(
      vaultTools,
      domainRoot,
      [...actualPages].map(([path, content]) => ({ path, content })),
    );
  } catch (error) {
    const message = `ingest: context loading failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath);
  }

  const annotations = cachedAnnotations ?? new Map<string, string>();
  annotations.clear();
  for (const record of pageRecords) annotations.set(record.articleId, record.description);

  yield {
    kind: "assistant_text",
    delta: i18nFor(resolveLang(opts.outputLanguage)).ingestProgress.synthesizing(domain.id),
  };

  let evidence: EntityEvidence[];
  try {
    evidence = yield* eventBridge.forwardAbortable(signal, (operationSignal) =>
      prepareSourceEvidence(sourceContent, domain.id, {
      inputBudgetTokens: policy.inputBudgetTokens,
      outputBudgetTokens: policy.outputBudgetTokens,
      compressionProfile: policy.compression,
      mapperRetries: opts.structuredRetries ?? 1,
      reducerRetries: opts.structuredRetries ?? 1,
    }, {
      llm,
      model,
      opts,
      signal: operationSignal,
      configuredEntityTypes: (domain.entity_types ?? []).map((entityType) => entityType.type),
      onEvent: captureEvent,
    }));
  } catch (error) {
    if (signal.aborted || (error as Error).name === "AbortError") {
      return failure("evidence", "ingest cancelled", sourcePath);
    }
    const message = `ingest: evidence preparation failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "", outputTokens: 0 };
    return failure("evidence", message, sourcePath,
      error instanceof EvidenceCoverageError || error instanceof EvidenceReducerError);
  }

  const service = similarity ?? new PageSimilarityService({ mode: "jaccard", topK: 20 });
  const extracted: ExtractedEntity[] = evidence.map((entity) => ({
    name: entity.entityKey,
    type: entity.entityType,
    context_snippet: entity.facts.join(" "),
  }));
  const existingPathSet = new Set(pagePaths);
  const foundPages = new Set<string>();
  const candidatePathsByEntity = new Map<string, string[]>();
  const targetPathByEntity = new Map<string, string>();
  try {
    await service.loadCache(domainRoot, vaultTools);
    const selected = await service.selectByEntities(extracted, annotations, pagePaths);
    if (selected.allFailed && extracted.length > 0 && pagePaths.length > 0) {
      throw new EmbeddingUnavailableError(selected.failReason ?? "per-entity retrieval failed");
    }
    for (let index = 0; index < evidence.length; index++) {
      const entity = extracted[index];
      const key = `${entity.name}::${entity.type ?? ""}`;
      const candidates = new Set(selected.results.get(key) ?? []);
      const targetPath = targetPathFor(evidence[index], domain, domainRoot, existingPathSet);
      if (targetPath) candidates.add(targetPath);
      const governed = [...candidates].filter((path) =>
        existingPathSet.has(path) && validateArticlePath(path, domainRoot));
      candidatePathsByEntity.set(evidence[index].entityKey, governed);
      const contextTarget = targetPath ?? governed[0];
      if (contextTarget) targetPathByEntity.set(evidence[index].entityKey, contextTarget);
      governed.forEach((path) => foundPages.add(path));
    }
  } catch (error) {
    const message = `ingest: candidate retrieval failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure(
      error instanceof EmbeddingUnavailableError || (error as Error).name === "EmbeddingUnavailableError"
        ? "embedding"
        : "context",
      message,
      sourcePath,
    );
  }

  yield {
    kind: "info_text",
    icon: service.config.mode === "embedding" ? "🔍" : "📋",
    summary: `${foundPages.size}/${pagePaths.length} pages retrieved (${service.config.mode}, ${evidence.length} entities)`,
  };

  const candidateBodies = new Map<string, string>();
  try {
    for (const path of foundPages) candidateBodies.set(path, await vaultTools.read(path));
  } catch (error) {
    const message = `ingest: candidate context read failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath);
  }

  const schemaContent = render(wikiSchemaTemplate, {
    section_conventions: wikiSections(resolveLang(opts.outputLanguage)),
  });
  let sourceStems: Set<string>;
  try {
    sourceStems = await collectSourceStems(domain, vaultTools, vaultRoot);
  } catch (error) {
    const message = `ingest: source inventory failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath);
  }
  const entityTypeNames = (domain.entity_types ?? []).map((entityType) => entityType.type);
  const maxTagCategories = domain.max_tag_categories ?? DEFAULT_MAX_TAG_CATEGORIES;
  const registry = registryFromRecords(pageRecords, sourceContent);
  const registryText = renderTagRegistryBlock(registry, entityTypeNames, maxTagCategories);
  const allowedSubfolders = [...new Set((domain.entity_types ?? []).map(effectiveSubfolder))];
  const pathPolicy: SynthesisPathPolicy = { domainRoot, allowedSubfolders };
  const domainContract = [
    `Domain: ${domain.id} (${domain.name})`,
    buildEntityTypesBlock(domain, domainRoot) || "No entity types configured.",
    domain.language_notes ? `Language rules: ${domain.language_notes}` : "",
    `Source: ${sourcePath}`,
  ].filter(Boolean).join("\n");
  const pathContract = `Use exactly !Wiki/${domain.id}/<allowed-type-folder>/wiki_${domain.id}_<entity>.md.`;

  const bundles: EntityContextBundle[] = [];
  const existingPageHashes = new Map<string, string>();
  try {
    for (const entity of evidence) {
      const paths = candidatePathsByEntity.get(entity.entityKey) ?? [];
      const pages = new Map(paths.map((path) => [path, candidateBodies.get(path)!]));
      const targetPath = targetPathByEntity.get(entity.entityKey);
      const context = buildEntityContext({
        evidence: entity,
        candidatePages: pages,
        targetPath,
        inputBudgetTokens: policy.inputBudgetTokens,
        fixedMessages: [{ role: "system", content: domainContract }],
        opts,
      });
      for (const path of pages.keys()) existingPageHashes.set(path, contentHash(pages.get(path)!));
      bundles.push({
        entityKey: entity.entityKey,
        evidence: entity,
        units: context.units,
        replaceAuthorities: context.replaceAuthorities,
        estimatedInputTokens: context.estimatedInputTokens,
      });
    }
  } catch (error) {
    const message = `ingest: entity context failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath);
  }

  let synthesis: SynthesisOutput = {
    reasoning: "",
    actions: [],
    skips: [],
    entity_types_delta: [],
  };
  if (bundles.length > 0) {
    let batches: EntityContextBundle[][];
    try {
      batches = batchEntityContexts(
        bundles,
        policy.inputBudgetTokens,
        (items) => [{
          role: "user",
          content: JSON.stringify(items.map((item) => ({
            entityKey: item.entityKey,
            evidence: item.evidence,
            units: item.units,
            replaceAuthorities: item.replaceAuthorities,
          }))),
        }],
        opts,
      );
    } catch (error) {
      const message = `ingest: context batching failed — ${(error as Error).message}`;
      yield { kind: "error", message };
      return failure("context", message, sourcePath);
    }

    const outputs: SynthesisOutput[] = [];
    try {
      for (const batch of batches) {
        const output = yield* eventBridge.forwardAbortable(signal, (operationSignal) =>
          synthesizeEntityBatch({
          bundles: batch,
          existingPaths: existingPathSet,
          existingPageHashes,
          existingPageDescriptions: typedDescriptions(domain.id, pageRecords),
          tagRegistryUnits: tagRegistryUnits(registryText),
          pathPolicy,
          domainContract,
          schemaContract: schemaContent,
          pathContract,
          llm,
          model,
          policy,
          opts,
          signal: operationSignal,
          onEvent: captureEvent,
        }));
        signal.throwIfAborted();
        outputs.push(output);
      }
      synthesis = mergeSynthesisBatchOutputs(outputs);
    } catch (error) {
      if (signal.aborted || (error as Error).name === "AbortError") {
        return failure("synthesis", "ingest cancelled", sourcePath);
      }
      const message = `ingest: synthesis failed — ${(error as Error).message}`;
      yield { kind: "error", message };
      yield { kind: "result", durationMs: Date.now() - startedAt, text: "", outputTokens: 0 };
      return failure(
        error instanceof SynthesisSplitRequiredError
          ? "context"
          : "synthesis",
        message,
        sourcePath,
        error instanceof SynthesisStructuredError,
      );
    }
  }

  if (synthesis.reasoning) {
    yield { kind: "assistant_text", delta: synthesis.reasoning, isReasoning: true };
  }

  const routingEntities = evidence.map((entity) => ({
    name: entity.entityKey,
    type: entity.entityType,
  }));
  const pageRecordByPath = new Map(pageRecords.map((record) => [record.path, record]));
  const validDomainTypes = new Set((domain.entity_types ?? []).map((entityType) => entityType.type));
  const routeableActions: SynthesisAction[] = [];
  const routeableIndexes: number[] = [];
  const preservedPatches = new Map<number, SynthesisAction>();
  const authoritativeRejected: Array<{ page: SynthesisAction; reason: string }> = [];
  for (let index = 0; index < synthesis.actions.length; index++) {
    const action = synthesis.actions[index];
    const record = action.kind === "patch" ? pageRecordByPath.get(action.path) : undefined;
    if (record === undefined) {
      routeableActions.push(action);
      routeableIndexes.push(index);
      continue;
    }
    if (!validDomainTypes.has(record.type)) {
      authoritativeRejected.push({
        page: action,
        reason: `fresh page type "${record.type}" is not configured for domain ${domain.id}`,
      });
      continue;
    }
    preservedPatches.set(index, action);
  }
  const routedResult = await routeAndValidatePages(
    routeableActions,
    routingEntities,
    domain,
    domainRoot,
    async () => new Map(),
  );
  const rejectedActions = [...authoritativeRejected, ...routedResult.rejected];
  if (rejectedActions.length > 0) {
    for (const rejected of rejectedActions) {
      yield { kind: "tool_use", name: "Write", input: { path: rejected.page.path } };
      yield { kind: "tool_result", ok: false, preview: `rejected — ${rejected.reason}` };
    }
    const message = `ingest: ${rejectedActions.length} action(s) failed strict type routing`;
    yield { kind: "error", message };
    return failure("patch", message, sourcePath);
  }
  const routedByIndex = new Map(routeableIndexes.map((index, offset) =>
    [index, routedResult.routed[offset]] as const));
  const orderedRoutedActions = synthesis.actions.map((_, index) =>
    preservedPatches.get(index) ?? routedByIndex.get(index)!);

  const stemMask = stemRegex(domain.id);
  const routedActions: SynthesisAction[] = [];
  const routedPaths = new Set<string>();
  for (const action of orderedRoutedActions) {
    const stem = pageId(action.path);
    const invalid = !validateArticlePath(action.path, domainRoot)
      || !stemMask.test(stem)
      || sourceStems.has(stem)
      || routedPaths.has(action.path);
    if (invalid) {
      yield { kind: "tool_use", name: "Write", input: { path: action.path } };
      yield { kind: "tool_result", ok: false, preview: `strict path/source collision guard rejected ${action.path}` };
      const message = `ingest: strict path validation rejected ${action.path}`;
      yield { kind: "error", message };
      return failure("patch", message, sourcePath, false);
    }
    routedPaths.add(action.path);
    routedActions.push(action);
  }

  const sourceStem = sourcePath.split("/").pop()!.replace(/\.md$/, "");
  const prepared = new Map<string, { content: string; action: SynthesisAction; existing: string | null }>();
  const pendingDuplicateDeletes = new Map<string, {
    canonicalPath: string;
    duplicateContent: string;
    duplicateHash: string;
  }>();
  const writtenTagCategories = new Set<string>();
  for (const action of routedActions) {
    const actionDuplicateResources: string[] = [];
    let existing: string | null = null;
    if (await vaultTools.exists(action.path)) {
      try {
        existing = await vaultTools.read(action.path);
      } catch (error) {
        const message = `ingest: cannot read action target ${action.path} — ${(error as Error).message}`;
        yield { kind: "error", message };
        return failure("context", message, sourcePath);
      }
    }
    if (action.kind === "create" && existing !== null) {
      const message = `ingest: create collided with existing page ${action.path}`;
      yield { kind: "error", message };
      return failure("patch", message, sourcePath, false);
    }
    if (action.kind === "patch" && existing === null) {
      const message = `ingest: patch target is missing ${action.path}`;
      yield { kind: "error", message };
      return failure("patch", message, sourcePath);
    }

    let nextContent: string;
    let effectiveAction = action;
    if (action.kind === "create") {
      nextContent = action.content;
      if ((opts.dedupOnIngest ?? false) && (opts.dedupThreshold ?? 0) > 0) {
        if (service.config.mode === "jaccard") service.setJaccardCorpus(annotations);
        const hit = await service.maxSimilarityToExisting(
          `${action.annotation}\n\n${action.content}`,
          new Set([pageId(action.path)]),
        );
        if (hit.pid && hit.score >= (opts.dedupThreshold ?? 0.85)) {
          const targetPath = pageRecords.find((record) => record.articleId === hit.pid)?.path
            ?? pagePaths.find((path) => pageId(path) === hit.pid);
          const entity = evidence.find((candidate) => candidate.entityKey === action.entityKey);
          if (!targetPath || !entity || !existingPathSet.has(targetPath)) {
            const message = `ingest: duplicate target ${hit.pid} is not an existing governed page`;
            yield { kind: "error", message };
            return failure("patch", message, sourcePath, false);
          }
          yield {
            kind: "info_text",
            icon: "🔁",
            summary: `ingest: merging ${action.path} into ${targetPath} (${hit.score.toFixed(2)})`,
          };
          try {
            const fresh = await vaultTools.read(targetPath);
            const freshContext = buildEntityContext({
              evidence: entity,
              candidatePages: new Map([[targetPath, fresh]]),
              targetPath,
              inputBudgetTokens: policy.inputBudgetTokens,
              fixedMessages: [{ role: "system", content: domainContract }],
              opts,
              linkSectionPurpose: "duplicate-merge",
            });
            const inspected = inspectPatchablePage(fresh);
            effectiveAction = yield* eventBridge.forwardAbortable(signal, (operationSignal) =>
              regenerateConflictedPatch({
              entityKey: action.entityKey,
              evidence: entity,
              targetPath,
              pageHash: inspected.pageHash,
              targetSections: freshContext.units.filter((unit) => unit.path === targetPath),
              replaceAuthorities: freshContext.replaceAuthorities,
              pathPolicy,
              domainContract,
              schemaContract: schemaContent,
              pathContract,
              llm,
              model,
              policy,
              opts,
              signal: operationSignal,
              onEvent: captureEvent,
            }));
            signal.throwIfAborted();
            if (effectiveAction.kind !== "patch") {
              throw new ConflictStillStaleError(action.entityKey, new Error("duplicate regeneration did not return a patch"));
            }
            const regenerated = applyPagePatch(fresh, effectiveAction, freshContext.replaceAuthorities);
            if (!regenerated.ok) {
              throw new ConflictStillStaleError(action.entityKey, new Error(regenerated.reason));
            }
            existing = fresh;
            nextContent = regenerated.content;

            const excluded = new Set([pageId(action.path), hit.pid]);
            for (let candidateIndex = 0; candidateIndex < pagePaths.length; candidateIndex++) {
              const duplicateHit = await service.maxSimilarityToExisting(
                `${action.annotation}\n\n${action.content}`,
                excluded,
              );
              if (!duplicateHit.pid
                || duplicateHit.score < (opts.dedupThreshold ?? 0.85)
                || excluded.has(duplicateHit.pid)) break;
              excluded.add(duplicateHit.pid);
              const duplicatePath = pageRecords.find((record) => record.articleId === duplicateHit.pid)?.path
                ?? pagePaths.find((path) => pageId(path) === duplicateHit.pid);
              const hasTraversal = duplicatePath?.split("/").some((segment) => segment === "." || segment === "..");
              if (!duplicatePath
                || hasTraversal
                || !validateArticlePath(duplicatePath, domainRoot)
                || !stemMask.test(pageId(duplicatePath))
                || sourceStems.has(pageId(duplicatePath))
                || routedPaths.has(duplicatePath)
                || duplicatePath === targetPath) {
                yield { kind: "tool_use", name: "Delete", input: { path: duplicatePath ?? duplicateHit.pid } };
                yield { kind: "tool_result", ok: false, preview: "strict canonical-merge delete path rejected" };
                continue;
              }
              const duplicateContent = await vaultTools.read(duplicatePath);
              if (duplicateEvidenceIsRepresented(nextContent, duplicateContent)) {
                pendingDuplicateDeletes.set(duplicatePath, {
                  canonicalPath: targetPath,
                  duplicateContent,
                  duplicateHash: contentHash(duplicateContent),
                });
                actionDuplicateResources.push(...parseResourceFromFm(duplicateContent));
              }
            }
          } catch (error) {
            const message = `ingest: duplicate merge regeneration failed — ${(error as Error).message}`;
            yield { kind: "error", message };
            return failure("patch", message, sourcePath,
              error instanceof ConflictRegenerationExhaustedError || error instanceof ConflictStillStaleError);
          }
        }
      }
    } else {
      const initial = applyPagePatch(existing!, action, actionAuthorities(bundles, action.path));
      if (initial.ok) {
        nextContent = initial.content;
      } else {
        const entity = evidence.find((candidate) => candidate.entityKey === action.entityKey);
        if (!entity) {
          const message = `ingest: patch authority entity missing for ${action.path}`;
          yield { kind: "error", message };
          return failure("patch", message, sourcePath, false);
        }
        try {
          const fresh = await vaultTools.read(action.path);
          const freshContext = buildEntityContext({
            evidence: entity,
            candidatePages: new Map([[action.path, fresh]]),
            targetPath: action.path,
            inputBudgetTokens: policy.inputBudgetTokens,
            fixedMessages: [{ role: "system", content: domainContract }],
            opts,
          });
          const inspected = inspectPatchablePage(fresh);
          effectiveAction = yield* eventBridge.forwardAbortable(signal, (operationSignal) =>
            regenerateConflictedPatch({
            entityKey: action.entityKey,
            evidence: entity,
            targetPath: action.path,
            pageHash: inspected.pageHash,
            targetSections: freshContext.units.filter((unit) => unit.path === action.path),
            replaceAuthorities: freshContext.replaceAuthorities,
            pathPolicy,
            domainContract,
            schemaContract: schemaContent,
            pathContract,
            llm,
            model,
            policy,
            opts,
            signal: operationSignal,
            onEvent: captureEvent,
          }));
          signal.throwIfAborted();
          if (effectiveAction.kind !== "patch") {
            throw new ConflictStillStaleError(action.entityKey, new Error("regeneration did not return a patch"));
          }
          const regenerated = applyPagePatch(fresh, effectiveAction, freshContext.replaceAuthorities);
          if (!regenerated.ok) throw new ConflictStillStaleError(action.entityKey, new Error(regenerated.reason));
          existing = fresh;
          nextContent = regenerated.content;
        } catch (error) {
          const message = `ingest: patch conflict regeneration failed — ${(error as Error).message}`;
          yield { kind: "error", message };
          return failure("patch", message, sourcePath,
            error instanceof ConflictRegenerationExhaustedError || error instanceof ConflictStillStaleError);
        }
      }
    }

    if (prepared.has(effectiveAction.path)) {
      const message = `ingest: multiple actions resolved to ${effectiveAction.path}`;
      yield { kind: "error", message };
      return failure("patch", message, sourcePath, false);
    }
    const processed = processPageContent(
      nextContent,
      effectiveAction.annotation ?? "",
      effectiveAction.path,
      domain,
      domainRoot,
      sourceStem,
      actionDuplicateResources,
    );
    if (processed.warnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: `Page guards applied: ${effectiveAction.path}`,
        details: processed.warnings,
      };
    }
    processed.tags.forEach((tag) => writtenTagCategories.add(tag.split("/")[0]));
    prepared.set(effectiveAction.path, { content: processed.content, action: effectiveAction, existing });
  }

  let allVaultPaths: string[];
  try {
    allVaultPaths = await vaultTools.listFiles("");
  } catch (error) {
    const message = `ingest: global link inventory failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("context", message, sourcePath);
  }
  const knownStems = new Set([
    ...allVaultPaths.filter((path) => path.endsWith(".md")).map((path) => pageId(path)),
    ...[...prepared.keys()].map(pageId),
  ]);
  const linkFix = fixWikiLinks(
    new Map([...prepared].map(([path, value]) => [path, value.content])),
    wikiLinkValidationRetries,
    knownStems,
  );
  for (const [path, value] of prepared) {
    value.content = stripDeadLinks(linkFix.fixed.get(path) ?? value.content, knownStems);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const logEntries: IngestLogEntry[] = [];
  const synthesisLifecycles = [...pendingSynthesisLifecycles.values()];
  let synthesisApplying = false;
  for (const [path, value] of prepared) {
    signal.throwIfAborted();
    yield { kind: "tool_use", name: value.existing === null ? "Create" : "Update", input: { path } };
    try {
      if (value.existing === null) {
        if (await vaultTools.exists(path)) {
          throw new Error(`create conflict: path now exists ${path}`);
        }
      } else {
        if (!await vaultTools.exists(path)) {
          throw new Error(`update conflict: path disappeared ${path}`);
        }
        const actual = await vaultTools.read(path);
        if (actual !== value.existing || contentHash(actual) !== contentHash(value.existing)) {
          throw new Error(`update conflict: page changed after patch preparation ${path}`);
        }
      }
      if (!synthesisApplying) {
        for (const lifecycle of synthesisLifecycles) {
          yield lifecycleEvent(lifecycle.id, lifecycle.action, "applying");
        }
        synthesisApplying = true;
      }
      signal.throwIfAborted();
      if (vaultTools instanceof TransactionVaultTools) {
        await vaultTools.writeIfCurrent(
          path,
          value.existing === null ? { exists: false } : fileImage(value.existing),
          value.content,
        );
      } else {
        await vaultTools.write(path, value.content);
      }
    } catch (error) {
      const message = `ingest: page write failed for ${path} — ${(error as Error).message}`;
      yield { kind: "tool_result", ok: false, preview: message };
      yield { kind: "error", message };
      return failure("write", message, sourcePath);
    }
    yield { kind: "tool_result", ok: true };
    const relativePath = path.slice(domainRoot.length + 1);
    if (value.existing === null) {
      created.push(path);
      logEntries.push({ path: relativePath, action: "CREATED", statusTo: parseWikiStatus(value.content) });
    } else {
      updated.push(path);
      logEntries.push({
        path: relativePath,
        action: "UPDATED",
        statusFrom: parseWikiStatus(value.existing),
        statusTo: parseWikiStatus(value.content),
      });
    }
  }

  const deleteThreshold = opts.mergeDeleteWarnThreshold ?? 5;
  if (pendingDuplicateDeletes.size > deleteThreshold) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Large merge: ${pendingDuplicateDeletes.size} deletion${pendingDuplicateDeletes.size === 1 ? "" : "s"}`,
      details: [...pendingDuplicateDeletes.keys()],
    };
  }
  for (const [path, authority] of pendingDuplicateDeletes) {
    yield { kind: "tool_use", name: "Delete", input: { path } };
    let removedIndexRecords: WikiIndexRecord[] | undefined;
    try {
      const pathHasTraversal = path.split("/").some((segment) => segment === "." || segment === "..");
      const canonicalHasTraversal = authority.canonicalPath
        .split("/").some((segment) => segment === "." || segment === "..");
      if (pathHasTraversal
        || canonicalHasTraversal
        || !validateArticlePath(path, domainRoot)
        || !validateArticlePath(authority.canonicalPath, domainRoot)
        || !stemMask.test(pageId(path))
        || !stemMask.test(pageId(authority.canonicalPath))
        || sourceStems.has(pageId(path))
        || sourceStems.has(pageId(authority.canonicalPath))
        || routedPaths.has(path)
        || path === authority.canonicalPath) {
        throw new Error("stale canonical duplicate authority failed strict path validation");
      }
      const [actualDuplicate, actualCanonical] = await Promise.all([
        vaultTools.read(path),
        vaultTools.read(authority.canonicalPath),
      ]);
      if (actualDuplicate !== authority.duplicateContent
        || contentHash(actualDuplicate) !== authority.duplicateHash) {
        throw new Error("stale canonical duplicate content changed before deletion");
      }
      if (!duplicateEvidenceIsRepresented(actualCanonical, actualDuplicate)) {
        throw new Error("stale canonical duplicate evidence is not represented on disk");
      }
      removedIndexRecords = await removeArticleIndexWithAuthority(
        vaultTools,
        domainRoot,
        pageId(path),
      );
      const [postIndexDuplicate, postIndexCanonical] = await Promise.all([
        vaultTools.read(path),
        vaultTools.read(authority.canonicalPath),
      ]);
      if (postIndexDuplicate !== actualDuplicate
        || contentHash(postIndexDuplicate) !== authority.duplicateHash
        || postIndexCanonical !== actualCanonical
        || !duplicateEvidenceIsRepresented(postIndexCanonical, postIndexDuplicate)) {
        throw new Error("stale canonical duplicate authority changed during index removal");
      }
      if (vaultTools instanceof TransactionVaultTools) {
        await vaultTools.removeIfCurrent(path, fileImage(postIndexDuplicate));
      } else {
        await vaultTools.remove(path);
      }
      if (await vaultTools.exists(path)) throw new Error(`duplicate page still exists after removal: ${path}`);
      deleted.push(path);
      logEntries.push({
        path: path.slice(domainRoot.length + 1),
        action: "DELETED",
      });
      yield { kind: "tool_result", ok: true };
    } catch (error) {
      if (removedIndexRecords !== undefined && await vaultTools.exists(path)) {
        await restoreArticleIndexAuthority(
          vaultTools,
          domainRoot,
          pageId(path),
          removedIndexRecords,
        );
      }
      const message = `ingest: canonical duplicate deletion failed for ${path} — ${(error as Error).message}`;
      yield { kind: "tool_result", ok: false, preview: message };
      yield { kind: "error", message };
      return failure("write", message, sourcePath);
    }
  }

  let finalPages: Map<string, string>;
  try {
    const finalPaths = (await vaultTools.listFiles(domainRoot))
      .filter((path) => isWikiPagePath(path) && validateArticlePath(path, domainRoot));
    finalPages = await readPagesStrict(vaultTools, finalPaths);
    await reconcilePageIndex(
      vaultTools,
      domainRoot,
      [...finalPages].map(([path, content]) => ({ path, content })),
    );
  } catch (error) {
    const message = `ingest: index reconciliation failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("index", message, sourcePath);
  }

  const successfulPaths = [...new Set([
    ...created,
    ...updated,
    ...[...finalPages]
      .filter(([path, content]) =>
        validateArticlePath(path, domainRoot)
        && parseResourceFromFm(content).includes(sourceStem))
      .map(([path]) => path),
  ])].sort(compareCodePoints);

  if (successfulPaths.length > 0) {
    try {
      const descriptions = await readPageDescriptions(vaultTools, domainRoot);
      const changedBodies = new Map<string, string>();
      for (const path of successfulPaths) {
        const body = finalPages.get(path);
        if (body !== undefined) changedBodies.set(pageId(path), body);
      }
      const refreshed = await service.refreshCache(domainRoot, vaultTools, descriptions, changedBodies);
      if (refreshed.failed > 0) {
        throw new EmbeddingUnavailableError(`${refreshed.failed} required embedding chunk(s) failed`);
      }
    } catch (error) {
      const message = `ingest: embedding refresh failed — ${(error as Error).message}`;
      yield { kind: "error", message };
      return failure("embedding", message, sourcePath);
    }
  }

  let backlinkPages: Map<string, string>;
  try {
    const backlinkPaths = (await vaultTools.listFiles(domainRoot))
      .filter((path) => isWikiPagePath(path) && validateArticlePath(path, domainRoot));
    backlinkPages = await readPagesStrict(vaultTools, backlinkPaths);
    await reconcilePageIndex(
      vaultTools,
      domainRoot,
      [...backlinkPages].map(([path, content]) => ({ path, content })),
    );
  } catch (error) {
    const message = `ingest: final page inventory failed — ${(error as Error).message}`;
    yield { kind: "error", message };
    return failure("index", message, sourcePath);
  }

  const finalStems = new Set([...backlinkPages.keys()].map(pageId));
  const associatedPaths = [...backlinkPages]
      .filter(([path, content]) =>
        validateArticlePath(path, domainRoot)
        && parseResourceFromFm(content).includes(sourceStem))
      .map(([path]) => path)
      .sort(compareCodePoints);
  try {
    yield { kind: "tool_use", name: "Update", input: { path: sourcePath } };
    const freshSource = await vaultTools.read(sourcePath);
    if (hashSource(freshSource) !== processedSourceBodyHash) {
      throw new Error("source body changed after evidence preparation");
    }
    const normalizedSource = recoverSourceFrontmatter(freshSource);
    const updatedSource = upsertRawFrontmatter(normalizedSource, {
      wiki_articles: associatedPaths.map((path) => `[[${pageId(path)}]]`),
    });
    const repaired = validateAndRepairSourceFrontmatter(updatedSource);
    const validArticles = stripInvalidWikiArticles(repaired.content, finalStems);
    const filtered = filterStaleWikiLinks(validArticles.content, finalStems, ["related"]);
    const warnings = [...repaired.warnings, ...validArticles.warnings, ...filtered.warnings];
    if (filtered.content !== freshSource) {
      if (vaultTools instanceof TransactionVaultTools) {
        await vaultTools.writeIfCurrent(sourcePath, fileImage(freshSource), filtered.content);
      } else {
        await vaultTools.write(sourcePath, filtered.content);
      }
    }
    if (warnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "Source frontmatter repaired", details: warnings };
    }
    yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourcePath}` };
    if (associatedPaths.length > 0) {
      const sourcePathAdded = {
        domainId: domain.id,
        path: extractParentSourcePath(absoluteSource, vaultRoot),
      };
      if (internal === undefined) yield { kind: "source_path_added", ...sourcePathAdded };
      else deferredSourcePathAdded = sourcePathAdded;
    }
  } catch (error) {
    const message = `ingest: source backlink reconciliation failed — ${(error as Error).message}`;
    yield { kind: "tool_result", ok: false, preview: message };
    yield { kind: "error", message };
    return failure("backlink", message, sourcePath);
  }

  const entityCategorySet = new Set(entityTypeNames.map(normalizeTag));
  const thematicAfter = new Set(thematicCategories(registry, entityTypeNames));
  for (const category of writtenTagCategories) {
    if (!entityCategorySet.has(category)) thematicAfter.add(category);
  }
  if (thematicAfter.size > maxTagCategories) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Tag category limit exceeded: ${thematicAfter.size}/${maxTagCategories} thematic categories`,
      details: [...thematicAfter].sort(),
    };
  }
  if (linkFix.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: linkFix.warnings };
  }

  if (logEntries.length > 0) {
    const log = {
      sourcePath,
      entries: logEntries,
      outputTokens,
    };
    if (internal !== undefined) {
      deferredLog = log;
    } else {
      try {
        await appendWikiLog(vaultTools, domainRoot, domain.id, {
          op: "ingest",
          ...log,
        });
      } catch {
        // Operation logging remains non-critical user-visible metadata.
      }
    }
  }

  const delta = synthesis.entity_types_delta;
  if (!synthesisApplying) {
    for (const lifecycle of synthesisLifecycles) {
      yield lifecycleEvent(lifecycle.id, lifecycle.action, "applying");
    }
  }
  for (const event of finalizeSynthesisLifecycles("completed")) {
    yield event;
  }
  synthesisLifecycleCompleted = true;
  const domainPatch = delta?.length
    ? { entity_types: mergeEntityTypes(domain.entity_types ?? [], delta) }
    : undefined;
  if (domainPatch !== undefined && internal === undefined) {
    yield {
      kind: "domain_updated",
      domainId: domain.id,
      patch: domainPatch,
    };
  }

  const resultText = buildIngestSummary(
    domain.id,
    sourcePath,
    created.length,
    updated.length,
    deleted.length,
    0,
    synthesis.actions.length,
  );
  if (internal === undefined) {
    yield { kind: "assistant_text", delta: resultText };
    yield {
      kind: "eval_meta",
      fields: {
        source_paths: [sourcePath],
        created_pages: created,
        updated_pages: updated,
        found_pages: [...foundPages],
        promptVersion: promptVersionOf(ingestTemplate),
      },
    };
    yield {
      kind: "result",
      durationMs: Date.now() - startedAt,
      text: resultText,
      outputTokens: outputTokens || undefined,
    };
  }
  return {
    ok: true,
    sourcePath,
    created,
    updated,
    deleted,
    outputTokens,
    sourceBodyHash: processedSourceBodyHash,
    ...(internal === undefined
      ? {}
      : {
          deferred: deferred({
            ...(domainPatch === undefined ? {} : { domainPatch }),
            ...(deferredSourcePathAdded === undefined ? {} : { sourcePathAdded: deferredSourcePathAdded }),
            ...(deferredLog === undefined ? {} : { log: deferredLog }),
          })!,
        }),
  };
  } finally {
    if (!synthesisLifecycleCompleted) {
      for (const event of finalizeSynthesisLifecycles(signal.aborted ? "cancelled" : "failed")) {
        yield event;
      }
    }
  }
}

function buildIngestSummary(
  domainId: string,
  sourcePath: string,
  createdCount: number,
  updatedCount: number,
  mergedCount: number,
  dedupMergedCount: number,
  total: number,
): string {
  const sourceName = sourcePath.split("/").pop() ?? sourcePath;
  const totalActed = createdCount + updatedCount + mergedCount + dedupMergedCount;
  if (totalActed === 0) {
    return `Источник «${sourceName}» обработан — новых или изменённых страниц нет.`;
  }
  const parts: string[] = [];
  if (createdCount > 0) parts.push(`создано ${createdCount}`);
  if (updatedCount > 0) parts.push(`обновлено ${updatedCount}`);
  if (mergedCount > 0) parts.push(`объединено ${mergedCount}`);
  if (dedupMergedCount > 0) parts.push(`дублей объединено ${dedupMergedCount}`);
  const count = parts.length === 1 ? `${parts[0]} стр.` : parts.join(", ");
  const skipped = total - (createdCount + updatedCount + dedupMergedCount);
  return `Источник «${sourceName}» → домен «${domainId}»: ${count}${skipped > 0 ? `, ошибок ${skipped}` : ""}`;
}

/** Match a file to a domain by source_paths prefix; null when nothing matches. */
export function detectDomainStrict(
  absoluteFilePath: string,
  domains: DomainEntry[],
  vaultRoot: string,
): DomainEntry | null {
  for (const domain of domains) {
    const matched = domain.source_paths?.some((sourcePath) => {
      const absolute = isAbsolute(sourcePath) ? sourcePath : join(vaultRoot, sourcePath);
      const prefix = absolute.endsWith("/") ? absolute : `${absolute}/`;
      return absoluteFilePath === absolute || absoluteFilePath.startsWith(prefix);
    });
    if (matched) return domain;
  }
  return null;
}

export function detectDomain(
  absoluteFilePath: string,
  domains: DomainEntry[],
  vaultRoot: string,
): DomainEntry | null {
  return detectDomainStrict(absoluteFilePath, domains, vaultRoot) ?? domains[0] ?? null;
}

export function extractParentSourcePath(absoluteSource: string, vaultRoot: string): string {
  const parent = dirname(absoluteSource);
  const normalizedRoot = vaultRoot.endsWith("/") ? vaultRoot : `${vaultRoot}/`;
  const clamped = `${parent}/`.startsWith(normalizedRoot) ? parent : vaultRoot;
  const relativePath = relative(vaultRoot, clamped);
  return `${relativePath || "."}/`;
}

export function buildEntityTypesBlock(domain: DomainEntry, wikiVaultPath: string): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types.map((entityType) => {
    const subfolder = effectiveSubfolder(entityType);
    return [
      `### Type: ${entityType.type}`,
      `Description: ${entityType.description}`,
      `Keywords: ${entityType.extraction_cues.join(", ")}`,
      entityType.min_mentions_for_page == null
        ? ""
        : `Min. mentions for a page: ${entityType.min_mentions_for_page}`,
      `Wiki subfolder: ${subfolder}`,
      `Path for entities of this type: ${wikiVaultPath}/${subfolder}/<EntityName>.md`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function isLegacyUnprefixedPage(path: string): boolean {
  if (!isWikiPagePath(path)) return false;
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return !name.startsWith("_") && !GENERIC_WIKI_STEM_REGEX.test(name);
}
