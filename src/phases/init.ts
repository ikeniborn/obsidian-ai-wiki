import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { IngestOutcome, LlmCallOptions, RunEvent, LlmClient, OnFileError } from "../types";
import { VaultTools } from "../vault-tools";
import { createLlmLifecycle, runStructuredStreaming, type StructuredSink } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import { DomainEntrySchema } from "./zod-schemas";
import schemaTemplate from "../../templates/_wiki_schema.md";
import initTemplate from "../../prompts/init.md";
import { render } from "./template";
import { wikiSections } from "./llm-utils";
import { runIngest, type PreparedIngestEvidence } from "./ingest";
import {
  WIKI_ROOT,
  domainIndexPath,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
} from "../wiki-path";
import type { PageSimilarityService } from "../page-similarity";
import { readPageDescriptions } from "../wiki-index-store";
import { i18nFor, resolveLang } from "../i18n";
import { promptVersionOf } from "../prompt-version";
import { EmbeddingUnavailableError } from "../embedding-error";
import { hashSource } from "../incremental-sources";
import {
  prepareBootstrapEvidenceBundle,
  splitBootstrapPayload,
  worstCaseBootstrapOverheadTokens,
  type BootstrapEvidence,
  type BootstrapEvidenceBundle,
} from "./ingest-evidence";
import { enrichEvidenceTypes } from "./evidence-type-enrichment";
import {
  classifyContextError,
  estimatePreparedMessages,
  PromptBudgetExceededError,
} from "../prompt-budget";
import { prepareChatMessages } from "./llm-utils";
import { RunEventBridge } from "../run-event-bridge";
import {
  advanceWipeManifestRoot,
  assertBoundedWipeIdentifier,
  assertWellFormedWipeString,
  initialWipeManifestRoot,
  WIPE_EVENT_MAX_BYTES,
  WIPE_HASH_ALGORITHM,
  WIPE_LOG_LINE_MAX_BYTES,
  wipeChunkHash,
  wipeProofHash,
  type WipeManifestEntry,
} from "../wipe-proof";
import { cancelRuntimeTimeout, scheduleRuntimeTimeout } from "../runtime-timers";

type IngestFailureStage = Extract<IngestOutcome, { ok: false }>["stage"];

function safeFileAttemptMessage(error: unknown, category?: IngestFailureStage): string {
  const constructorName = error !== null && typeof error === "object"
    ? (error as { constructor?: { name?: unknown } }).constructor?.name
    : undefined;
  const errorClass = typeof constructorName === "string"
    && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(constructorName)
    ? constructorName
    : "Error";
  return category === undefined
    ? `class=${errorClass}`
    : `class=${category === "embedding" ? "EmbeddingUnavailableError" : "IngestOutcomeError"} category=${category}`;
}

async function* forwardIngest(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
  onDomainUpdate: (event: Extract<RunEvent, { kind: "domain_updated" }>) => void,
): AsyncGenerator<RunEvent, { outcome: IngestOutcome; childError?: string }> {
  let childError: string | undefined;
  while (true) {
    const next = await generator.next();
    if (next.done) return { outcome: next.value, childError };
    if (next.value.kind === "error") {
      childError = next.value.message;
      continue;
    }
    if (next.value.kind === "domain_updated") onDomainUpdate(next.value);
    yield next.value;
  }
}

interface PreparedDomainBootstrap {
  sourceFile: string;
  sourceContent: string;
  preparedSources?: Array<{ path: string; content: string }>;
  preparedEvidence: PreparedIngestEvidence;
  entry: DomainEntry;
  outputTokens: number;
}

export interface InitIngestRuntime {
  model: string;
  opts: LlmCallOptions;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function bootstrapAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function waitForBootstrapTransportSettle(signal: AbortSignal, delayMs = 1_500): Promise<void> {
  if (signal.aborted) return Promise.reject(bootstrapAbortError(signal));
  let onAbort: (() => void) | undefined;
  const pending = new Promise<void>((resolve, reject) => {
    const timer = scheduleRuntimeTimeout(resolve, delayMs);
    onAbort = (): void => {
      cancelRuntimeTimeout(timer);
      reject(bootstrapAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return pending.finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

function cloneEntityTypes(entityTypes: readonly EntityType[] | undefined): EntityType[] {
  return (entityTypes ?? []).map((entityType) => ({
    ...entityType,
    extraction_cues: [...entityType.extraction_cues],
  }));
}

function mergeBootstrapEntityTypes(
  existingTypes: readonly EntityType[] | undefined,
  generatedTypes: readonly EntityType[],
): EntityType[] {
  const existing = cloneEntityTypes(existingTypes);
  const existingNames = new Set(existing.map((entityType) => entityType.type));
  const additions = generatedTypes
    .filter((entityType) => !existingNames.has(entityType.type))
    .map((entityType) => ({ ...entityType, extraction_cues: [...entityType.extraction_cues] }))
    .sort((left, right) => left.type.localeCompare(right.type));
  return [...existing, ...additions];
}

function bootstrapTaxonomyIssue(
  entry: Pick<DomainEntry, "entity_types">,
  bootstrapEvidence: BootstrapEvidence,
): string | null {
  const candidateCount = new Set(bootstrapEvidence.candidates.map((candidate) => candidate.entityKey)).size;
  const typeCount = new Set((entry.entity_types ?? []).map((entityType) => entityType.type)).size;
  if (candidateCount >= 3 && typeCount <= 1) {
    return `taxonomy too collapsed: ${candidateCount} evidence candidates mapped to ${typeCount} entity type(s)`;
  }
  return null;
}

/**
 * Smallest output reserve that still fits a complete `DomainEntry` with a
 * realistic `entity_types` list. Reclaiming below this would trade a size
 * failure for a truncated model answer.
 */
const MIN_BOOTSTRAP_OUTPUT_TOKENS = 2_048;
/**
 * Floor on the source evidence a bootstrap payload must still be able to carry
 * once the capped per-group overhead is subtracted. Below it the mapper spends
 * a request per couple of kilobytes of markdown, so no chunk size makes the
 * operation progress and the model itself is the wrong size for the job.
 */
const MIN_BOOTSTRAP_CHUNK_TOKENS = 512;
/**
 * Ceiling on the bootstrap evidence one Init may carry, in payload tokens.
 * 240_000 tokens is roughly a megabyte of markdown — beyond any single source
 * file a domain is bootstrapped from. It is a budget, not a request count, so
 * the ceiling scales with the model: a narrow window turns it into more, smaller
 * requests rather than into a refusal.
 */
const MAX_BOOTSTRAP_EVIDENCE_TOKENS = 240_000;
/**
 * Hard ceiling on the provider requests one bootstrap attempt issues, whatever
 * the arithmetic above allows. It only binds on narrow windows. Both figures
 * below are `evidencePerGroup(...)`, the same arithmetic the ceiling and the
 * refusal message use: at the default 16_384-token input budget a group carries
 * 12_049 evidence tokens, so the evidence budget caps first at 20 requests; at a
 * 3_686-token input budget (an 8_192-token window) a group carries 656 by that
 * worst-case accounting, and 64 requests admit 41_984 evidence tokens instead of
 * the 10_496 a fixed count of 16 allowed. Real per-group overhead runs well
 * below its 1_783-token bound, so a run of that shape carries proportionally
 * more than the worst case admits — a ~87 KB source completes in 24 groups.
 */
export const MAX_BOOTSTRAP_REQUESTS = 64;
/**
 * Worst case for the taxonomy repair instruction appended to a group request.
 * It is reserved from the packing budget and enforced when the instruction is
 * rendered, so a repair can never push a packed group past the input budget.
 */
const MAX_TAXONOMY_REPAIR_TOKENS = 512;

/** Largest number of split groups this budget may turn into provider requests. */
function maxBootstrapGroupsFor(evidenceTokensPerGroup: number): number {
  return Math.max(1, Math.min(
    MAX_BOOTSTRAP_REQUESTS,
    Math.ceil(MAX_BOOTSTRAP_EVIDENCE_TOKENS / Math.max(1, evidenceTokensPerGroup)),
  ));
}

/**
 * Deterministic merge with no heuristic conflict resolution. Group 0 owns
 * identity: `domainId` is an input to the prompt, so the model does not invent
 * it. Entity types are unioned across every group, so no group's taxonomy is
 * lost.
 */
export function mergeBootstrapEntries(entries: DomainEntry[]): DomainEntry {
  const [first, ...rest] = entries;
  if (first === undefined) throw new Error("Cannot merge an empty bootstrap group result");
  let entityTypes = cloneEntityTypes(first.entity_types);
  for (const entry of rest) {
    entityTypes = mergeBootstrapEntityTypes(entityTypes, entry.entity_types ?? []);
  }
  return {
    id: first.id,
    name: first.name,
    wiki_folder: first.wiki_folder,
    entity_types: entityTypes,
    language_notes: entries.find((entry) => entry.language_notes?.trim())?.language_notes
      ?? first.language_notes,
  };
}

/**
 * Maps every size-shaped failure bounded evidence preparation can raise onto the
 * one enumerated model-context error, so no size condition escapes into a shape
 * that names neither the model nor a remedy. Anything else is a model or prompt
 * failure and keeps its own message.
 */
function evidencePreparationFailure(
  error: Error,
  asModelContext: (needs: string) => string,
): string {
  const overflow = error instanceof PromptBudgetExceededError
    ? { estimated: error.estimated, budget: error.budget }
    // The mapper and reducer catches rewrap anything that is not their own error
    // class (ingest-evidence.ts:1409-1415, :1829-1835). That contract is left
    // intact for every class; the counts survive verbatim in the wrapped text and
    // only PromptBudgetExceededError writes that sentence, so they are read back
    // from there instead of changing what those catches throw.
    : /Prompt requires (\d+) estimated tokens but budget is (\d+)/.exec(error.message);
  if (overflow) {
    const [estimated, budget] = Array.isArray(overflow)
      ? [overflow[1], overflow[2]]
      : [overflow.estimated, overflow.budget];
    return asModelContext(
      `a bounded evidence request needs ${estimated} tokens against a ${budget}-token budget`,
    );
  }
  const sizeShaped: Array<[RegExp, string]> = [
    [
      /Unable to derive a bounded mapper chunk size|Mapper prompt and repair reserve exceed the input budget/i,
      "the evidence mapper prompt and its repair reserve fit no source chunk size",
    ],
    [
      /Reducer prompt and repair reserve exceed the input budget/i,
      "the evidence reducer prompt and its repair reserve do not fit one request",
    ],
    [
      /A single evidence packet cannot fit the reducer budget/i,
      "one evidence packet does not fit the reducer request budget",
    ],
    [
      /exceeds \d+ byte output budget/i,
      "the reduced evidence does not fit the output budget this model leaves",
    ],
  ];
  for (const [pattern, needs] of sizeShaped) {
    if (pattern.test(error.message)) return asModelContext(needs);
  }
  return `init: domain bootstrap failed — bounded evidence preparation failed: ${error.message}. Fix model/prompt and re-run.`;
}

interface BootstrapBudget {
  systemContent: string;
  includeSchema: boolean;
  inputBudgetTokens: number;
  outputBudgetTokens: number | undefined;
  fixedRequestEstimate: number;
  payloadBudgetTokens: number;
}

/**
 * The repair instruction is appended to an already packed group request, so it
 * has to fit the reserve the packing budget kept for it. Hints are dropped
 * largest-first until it does; the issue and the rules — the only parts the
 * model needs to act — always survive. Existing entity types are named rather
 * than repeated in full: the group request already carries them.
 */
function renderBootstrapTaxonomyRepairPrompt(
  issue: string,
  bootstrapEvidence: BootstrapEvidence,
  existingTypes: readonly EntityType[] | undefined,
  calibration?: number,
): string {
  const build = (
    candidates: number,
    facts: number,
    themes: number,
    existingNames: number,
  ): string => JSON.stringify({
    repair: "Regenerate the domain entry JSON. The previous taxonomy was rejected by local domain validation.",
    issue,
    rules: [
      "Derive reusable entity types from the supplied bootstrap evidence.",
      "Do not collapse unrelated candidates into one generic type.",
      "Reuse existing entity types when they fit; add only source-supported missing types.",
      "Do not invent a permanent domain-specific fallback list.",
    ],
    existingEntityTypes: (existingTypes ?? []).slice(0, existingNames).map((entityType) => entityType.type),
    evidenceCandidates: bootstrapEvidence.candidates.slice(0, candidates).map((candidate) => ({
      entityKey: candidate.entityKey,
      facts: candidate.facts.slice(0, facts),
    })),
    domainThemes: bootstrapEvidence.domainThemes.slice(0, themes),
  });
  const fits = (content: string): boolean =>
    estimatePreparedMessages([{ role: "user", content }], calibration) <= MAX_TAXONOMY_REPAIR_TOKENS;
  const allExisting = existingTypes?.length ?? 0;
  for (const [candidates, facts, themes, existingNames] of [
    [bootstrapEvidence.candidates.length, 6, 12, allExisting],
    [24, 3, 6, Math.min(allExisting, 48)],
    [12, 2, 3, Math.min(allExisting, 24)],
    [6, 1, 0, Math.min(allExisting, 12)],
    [0, 0, 0, 0],
  ] as const) {
    const content = build(candidates, facts, themes, existingNames);
    if (fits(content)) return content;
  }
  return build(0, 0, 0, 0);
}

async function* prepareDomainBootstrap(
  domainId: string,
  sourcePaths: string[],
  sourceFile: string,
  sourceContent: string,
  existing: DomainEntry | undefined,
  force: boolean,
  vaultName: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  startedAt: number,
): AsyncGenerator<RunEvent, PreparedDomainBootstrap | null> {
  const compressionProfile = opts.semanticCompression?.profile ?? "balanced";
  const schemaContent = render(schemaTemplate, {
    section_conventions: wikiSections(resolveLang(opts.outputLanguage)),
  });
  const renderSystemContent = (includeSchema: boolean): string => render(initTemplate, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: includeSchema && schemaContent
      ? `\nWiki conventions (_wiki_schema.md):\n${schemaContent}`
      : "",
  });
  const bootstrapMessages = (
    bootstrapEvidence: BootstrapEvidence,
    systemContent: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] => [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: JSON.stringify({
        domainId,
        vaultName,
        sourcePaths,
        sourceFile,
        existingEntityTypes: cloneEntityTypes(existing?.entity_types),
        bootstrapEvidence,
      }),
    },
  ];
  const emptyBootstrapEvidence: BootstrapEvidence = {
    candidates: [],
    domainThemes: [],
    languageEvidence: [],
  };
  const emptyPayloadEstimate = estimatePreparedMessages([{
    role: "user",
    content: JSON.stringify(emptyBootstrapEvidence),
  }], opts.tokenCalibration);
  // Worst case a group can carry besides its evidence: both capped lists at full
  // length plus the JSON envelope. It is a constant, so the chunk budget is
  // decidable before the evidence preparation the budget governs has run.
  const worstCaseGroupOverhead = worstCaseBootstrapOverheadTokens(opts.tokenCalibration);
  const budgetFor = (
    includeSchema: boolean,
    inputBudgetTokens: number,
    outputBudgetTokens: number | undefined,
  ): BootstrapBudget => {
    const systemContent = renderSystemContent(includeSchema);
    const fixedRequestEstimate = estimatePreparedMessages(
      prepareChatMessages(bootstrapMessages(emptyBootstrapEvidence, systemContent), opts),
      opts.tokenCalibration,
    );
    return {
      systemContent,
      includeSchema,
      inputBudgetTokens,
      outputBudgetTokens,
      fixedRequestEstimate,
      // + emptyPayloadEstimate cancels the empty payload already counted inside
      // fixedRequestEstimate, leaving what a real payload may add.
      payloadBudgetTokens: inputBudgetTokens - fixedRequestEstimate + emptyPayloadEstimate,
    };
  };
  /**
   * Widens the payload budget towards `requiredPayloadTokens` using the levers
   * the model actually offers, largest first, stopping as soon as it fits.
   * Nothing is trimmed or truncated: when no lever is left the caller fails
   * explicitly instead of shrinking the evidence.
   */
  const widenBootstrapBudget = (
    current: BootstrapBudget,
    requiredPayloadTokens: number,
  ): BootstrapBudget => {
    if (current.payloadBudgetTokens >= requiredPayloadTokens) return current;
    let widened = current;
    // 1. Drop the schema block from the system prompt — the same lever
    //    lint-chat.ts already pulls, and the largest single reclaimable chunk.
    if (widened.includeSchema) {
      widened = budgetFor(false, widened.inputBudgetTokens, widened.outputBudgetTokens);
      if (widened.payloadBudgetTokens >= requiredPayloadTokens) return widened;
    }
    // 2. Reclaim the output reserve down to a floor that still fits a domain
    //    entry. Only possible when the model's own window is known, because the
    //    reclaimed tokens have to come from somewhere real.
    const contextWindowTokens = opts.contextWindowTokens;
    if (contextWindowTokens !== undefined
      && widened.outputBudgetTokens !== undefined
      && widened.outputBudgetTokens > MIN_BOOTSTRAP_OUTPUT_TOKENS) {
      const reclaimed = Math.min(
        contextWindowTokens - MIN_BOOTSTRAP_OUTPUT_TOKENS,
        widened.inputBudgetTokens + widened.outputBudgetTokens - MIN_BOOTSTRAP_OUTPUT_TOKENS,
      );
      if (reclaimed > widened.inputBudgetTokens) {
        widened = budgetFor(widened.includeSchema, reclaimed, MIN_BOOTSTRAP_OUTPUT_TOKENS);
      }
    }
    return widened;
  };
  const unsupportedModelContext = (needs: string, current: BootstrapBudget): string =>
    `init: ${needs}, but model ${model} allows ${current.inputBudgetTokens} input token(s)`
    + (opts.contextWindowTokens === undefined
      ? ""
      : ` from a context window of ${opts.contextWindowTokens} token(s)`)
    + ". Choose a model with a larger context window.";

  /** What one group may pack, keeping the repair instruction's reserve free. */
  const splitBudgetOf = (current: BootstrapBudget): number =>
    current.payloadBudgetTokens - MAX_TAXONOMY_REPAIR_TOKENS;
  const evidencePerGroup = (current: BootstrapBudget): number =>
    splitBudgetOf(current) - worstCaseGroupOverhead;
  const groupCeilingOf = (current: BootstrapBudget): number =>
    maxBootstrapGroupsFor(evidencePerGroup(current));

  const configuredBudget = budgetFor(true, opts.inputBudgetTokens ?? 16_384, opts.maxTokens);
  // Chunk planning uses the widest prompt the model could be pushed to, because
  // it decides how much source ONE evidence unit may carry and a unit has to fit
  // whichever variant is finally sent. Which variant that is stays undecided
  // here: the levers are only spent once the real evidence says they are needed.
  const planningBudget = widenBootstrapBudget(
    configuredBudget,
    worstCaseGroupOverhead + MIN_BOOTSTRAP_CHUNK_TOKENS + MAX_TAXONOMY_REPAIR_TOKENS,
  );
  const chunkBudgetTokens = evidencePerGroup(planningBudget);
  if (chunkBudgetTokens < MIN_BOOTSTRAP_CHUNK_TOKENS) {
    yield {
      kind: "error",
      message: unsupportedModelContext(
        `the Init prompt needs ${planningBudget.fixedRequestEstimate} tokens and every evidence group up to `
        + `${worstCaseGroupOverhead} more, leaving ${Math.max(0, chunkBudgetTokens)} token(s) for source `
        + `evidence instead of ${MIN_BOOTSTRAP_CHUNK_TOKENS}`,
        planningBudget,
      ),
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }
  const budgetOpts = (current: BootstrapBudget): LlmCallOptions => ({
    ...opts,
    inputBudgetTokens: current.inputBudgetTokens,
    ...(current.outputBudgetTokens === undefined ? {} : { maxTokens: current.outputBudgetTokens }),
  });
  // Split with the schema still in the prompt whenever a group can hold one
  // minimal evidence unit that way. Only an arithmetically impossible with-schema
  // prompt splits against the widened one.
  const splitsWithSchema = splitBudgetOf(configuredBudget) >= MIN_BOOTSTRAP_CHUNK_TOKENS;
  let budget = splitsWithSchema ? configuredBudget : planningBudget;

  const bootstrapEvents = new RunEventBridge();
  let bootstrapEvidenceOutputTokens = 0;
  let bootstrapBundle: BootstrapEvidenceBundle;
  try {
    bootstrapBundle = yield* bootstrapEvents.forwardAbortable(signal, (operationSignal) =>
      prepareBootstrapEvidenceBundle(sourceContent, domainId, sourceFile, {
      // Evidence preparation keeps the budget the user's settings resolved: the
      // bootstrap levers pay for the bootstrap request, not for other phases.
      inputBudgetTokens: configuredBudget.inputBudgetTokens,
      outputBudgetTokens: configuredBudget.outputBudgetTokens,
      compressionProfile,
      mapperRetries: opts.structuredRetries ?? 1,
      reducerRetries: opts.structuredRetries ?? 1,
      bootstrapPayloadBudgetTokens: splitBudgetOf(budget),
      chunkBudgetTokens,
      calibration: opts.tokenCalibration ?? 1,
    }, {
      llm,
      model,
      opts: budgetOpts(configuredBudget),
      signal: operationSignal,
      onEvent: (event) => {
        if (event.kind === "llm_call_stats") bootstrapEvidenceOutputTokens += event.outputTokens;
        bootstrapEvents.push(event);
      },
      configuredEntityTypes: [],
      mapCallSite: "init.bootstrap-map",
    }));
  } catch (error) {
    if ((error as Error).name === "AbortError" || signal.aborted) return null;
    yield {
      kind: "error",
      message: evidencePreparationFailure(
        error as Error,
        (needs) => unsupportedModelContext(needs, configuredBudget),
      ),
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }
  // Validation, the repair prompt and any re-split reason about the whole
  // taxonomy, so they see the union of every group rather than whichever slice
  // was sent first. The union is exactly what the splitter was given.
  const fullBootstrapEvidence: BootstrapEvidence = {
    candidates: bootstrapBundle.bootstrapGroups.flatMap((group) => group.candidates),
    domainThemes: bootstrapBundle.bootstrapGroups[0].domainThemes,
    languageEvidence: bootstrapBundle.bootstrapGroups[0].languageEvidence,
  };
  let bootstrapGroups = bootstrapBundle.bootstrapGroups;
  let bootstrapSubdivided = bootstrapBundle.bootstrapSubdivided;
  let minimumGroupTokens = bootstrapBundle.bootstrapMinimumGroupTokens;
  const splitFits = (current: BootstrapBudget): boolean =>
    minimumGroupTokens <= splitBudgetOf(current)
    && bootstrapGroups.length <= groupCeilingOf(current);
  // Only now, with the real evidence measured, are the widening levers spent —
  // and only if this split does not fit the prompt as configured.
  if (!splitFits(budget)) {
    const widened = widenBootstrapBudget(
      budget,
      Math.max(minimumGroupTokens, worstCaseGroupOverhead + MIN_BOOTSTRAP_CHUNK_TOKENS)
      + MAX_TAXONOMY_REPAIR_TOKENS,
    );
    if (widened.payloadBudgetTokens > budget.payloadBudgetTokens) {
      const resplit = splitBootstrapPayload(
        fullBootstrapEvidence,
        splitBudgetOf(widened),
        opts.tokenCalibration,
      );
      budget = widened;
      bootstrapGroups = resplit.groups;
      bootstrapSubdivided = resplit.subdivided;
      minimumGroupTokens = resplit.minimumGroupTokens;
    }
  }
  yield {
    kind: "evidence_split",
    callSite: "init.bootstrap",
    groups: bootstrapGroups.length,
    candidates: bootstrapGroups.reduce((total, group) => total + group.candidates.length, 0),
    subdivided: bootstrapSubdivided,
    payloadBudget: splitBudgetOf(budget),
  };
  const groupCeiling = groupCeilingOf(budget);
  if (bootstrapGroups.length > groupCeiling) {
    yield {
      kind: "error",
      message: unsupportedModelContext(
        `the source evidence needs ${bootstrapGroups.length} bootstrap requests of `
        + `${splitBudgetOf(budget)} payload token(s); this model allows at most ${groupCeiling}, `
        + `about ${groupCeiling * Math.max(1, evidencePerGroup(budget))} tokens of evidence`,
        budget,
      ),
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }
  // A group still above the payload budget is atomic: one evidence unit that no
  // further split divides. The levers are spent — the evidence is never cut.
  if (minimumGroupTokens > splitBudgetOf(budget)) {
    yield {
      kind: "error",
      message: unsupportedModelContext(
        `one indivisible evidence unit needs ${minimumGroupTokens} payload token(s) `
        + `and the widest payload this model allows is ${splitBudgetOf(budget)}`,
        budget,
      ),
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }
  const requestOpts: LlmCallOptions = { ...budgetOpts(budget), nativeFreshConnection: true };
  const groupMessages = bootstrapGroups.map((group) =>
    bootstrapMessages(group, budget.systemContent));
  for (const messages of groupMessages) {
    const estimatedInputTokens = estimatePreparedMessages(
      prepareChatMessages(messages, requestOpts),
      opts.tokenCalibration,
    );
    if (estimatedInputTokens > budget.inputBudgetTokens) {
      yield {
        kind: "error",
        message: unsupportedModelContext(
          `a bootstrap request needs ${estimatedInputTokens} tokens`,
          budget,
        ),
      };
      yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
      return null;
    }
  }
  // Announced only past every check that can still refuse: a user told the wiki
  // conventions were dropped should be getting a domain out of it.
  if (configuredBudget.includeSchema && !budget.includeSchema) {
    yield {
      kind: "system",
      message: "init: wiki conventions omitted from the Init prompt to fit the model context",
    };
  }

  yield { kind: "tool_use", name: "Initialising domain", input: {} };
  if (llm.nativeRequestExecutor) {
    try {
      await waitForBootstrapTransportSettle(signal);
    } catch (error) {
      if ((error as Error).name === "AbortError" || signal.aborted) return null;
      throw error;
    }
  }
  type BootstrapDomainEntry = {
    id: string;
    name: string;
    wiki_folder: string;
    entity_types: EntityType[];
    language_notes: string;
  };
  let attemptSinks: Array<StructuredSink<BootstrapDomainEntry>> = [];
  let bootstrapOutputTokens = 0;
  let entry: DomainEntry | undefined;
  try {
    // One repair instruction per group: a rejected taxonomy is a property of the
    // merged answer, but each group can only be repaired against its own slice.
    let repairInstructions: Array<string | undefined> = groupMessages.map(() => undefined);
    for (let semanticAttempt = 0; ; semanticAttempt++) {
      const groupEntries: DomainEntry[] = [];
      attemptSinks = [];
      for (const [index, messages] of groupMessages.entries()) {
        const sink: StructuredSink<BootstrapDomainEntry> = {};
        const repair = repairInstructions[index];
        const bootstrapLifecycle = createLlmLifecycle("bootstrap_domain");
        for await (const event of runStructuredStreaming({
          llm,
          model,
          baseMessages: repair === undefined
            ? messages
            : [...messages, { role: "user", content: repair }],
          opts: requestOpts,
          profile: { kind: "json-zod", schema: DomainEntrySchema },
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.bootstrap",
          lifecycle: bootstrapLifecycle,
          signal,
          onEvent: () => {},
          transport: "non-stream",
        }, sink)) {
          yield event;
        }
        bootstrapOutputTokens += sink.outputTokens ?? 0;
        attemptSinks.push(sink);
        const parsed = sink.value!;
        groupEntries.push({
          id: parsed.id,
          name: parsed.name,
          wiki_folder: parsed.wiki_folder,
          entity_types: parsed.entity_types,
          language_notes: parsed.language_notes,
        });
      }
      for (const field of ["id", "wiki_folder"] as const) {
        if (groupEntries.some((groupEntry) => groupEntry[field] !== groupEntries[0][field])) {
          yield { kind: "system", message: `bootstrap group conflict on ${field}; group 0 wins` };
        }
      }
      const merged = mergeBootstrapEntries(groupEntries);
      entry = {
        id: merged.id,
        name: merged.name,
        wiki_folder: sanitizeWikiFolder(merged.wiki_folder),
        entity_types: mergeBootstrapEntityTypes(existing?.entity_types, merged.entity_types ?? []),
        language_notes: merged.language_notes,
      };
      for (const entityType of entry.entity_types ?? []) {
        if (entityType.wiki_subfolder) {
          entityType.wiki_subfolder = sanitizeWikiSubfolder(entityType.wiki_subfolder);
        }
        if (entityType.wiki_subfolder === domainId) entityType.wiki_subfolder = "";
      }
      if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
      if (force && existing) entry.wiki_folder = existing.wiki_folder;
      const taxonomyIssue = bootstrapTaxonomyIssue(entry, fullBootstrapEvidence);
      if (taxonomyIssue === null) break;
      for (const attemptSink of attemptSinks) {
        yield lifecycleEvent(attemptSink.lifecycle!.id, attemptSink.lifecycle!.action, "failed");
      }
      if (semanticAttempt >= (opts.structuredRetries ?? 1)) {
        throw new Error(taxonomyIssue);
      }
      const repairs = bootstrapGroups.map((group) => renderBootstrapTaxonomyRepairPrompt(
        taxonomyIssue,
        group,
        existing?.entity_types,
        opts.tokenCalibration,
      ));
      // The reserve above keeps room for this, but a request is never dispatched
      // on the assumption: an unaffordable repair ends the attempt instead.
      const repairFits = groupMessages.every((messages, index) => estimatePreparedMessages(
        prepareChatMessages([...messages, { role: "user", content: repairs[index] }], requestOpts),
        opts.tokenCalibration,
      ) <= budget.inputBudgetTokens);
      if (!repairFits) throw new Error(taxonomyIssue);
      repairInstructions = repairs;
    }
    for (const attemptSink of attemptSinks) {
      yield lifecycleEvent(attemptSink.lifecycle!.id, attemptSink.lifecycle!.action, "applying");
      yield lifecycleEvent(attemptSink.lifecycle!.id, attemptSink.lifecycle!.action, "completed");
    }
    yield { kind: "tool_result", ok: true, preview: `domain: ${entry.id}` };
    for (const attemptSink of attemptSinks) {
      if (attemptSink.fullText) yield { kind: "assistant_text", delta: attemptSink.fullText };
    }
  } catch (error) {
    // Init plans its bootstrap splits from the context window up front and has no
    // repack loop, so a provider context rejection is terminal here rather than
    // recovered. Report it anyway: this is the operation the context-window setting
    // exists for, so a window set larger than the model's real one must still leave
    // a trace where the user looks for it (a `context_window_conflict` line in
    // agent.jsonl), and a probed window can still be learned down for the next run.
    const contextError = classifyContextError(error);
    if (contextError !== null) requestOpts.onContextError?.(contextError);
    yield { kind: "tool_result", ok: false, preview: (error as Error).message };
    if ((error as Error).name === "AbortError" || signal.aborted) return null;
    yield {
      kind: "error",
      message: `init: domain bootstrap failed — could not derive entity types (structured-output error: ${(error as Error).message}). Fix model/prompt and re-run.`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  if (signal.aborted) return null;

  if (entry === undefined) {
    yield {
      kind: "error",
      message: `init: domain bootstrap failed — invalid domain entry for ${sourceFile}`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }
  try {
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
  } catch {
    yield {
      kind: "error",
      message: `init: domain bootstrap failed — invalid domain entry for ${sourceFile}`,
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  const enrichmentEvents = new RunEventBridge();
  let enrichmentOutputTokens = 0;
  let evidence: PreparedIngestEvidence["evidence"];
  try {
    evidence = yield* enrichmentEvents.forwardAbortable(signal, (operationSignal) =>
      enrichEvidenceTypes(
        bootstrapBundle.evidence,
        new Set((entry.entity_types ?? []).map((entityType) => entityType.type)),
        {
          // Enrichment is a separate phase: it runs on the budget the user's
          // settings resolved, never on one widened for the bootstrap payload.
          inputBudgetTokens: configuredBudget.inputBudgetTokens,
          outputBudgetTokens: configuredBudget.outputBudgetTokens,
          compressionProfile,
          mapperRetries: opts.structuredRetries ?? 1,
          reducerRetries: opts.structuredRetries ?? 1,
        },
        {
          llm,
          model,
          opts: budgetOpts(configuredBudget),
          signal: operationSignal,
          onEvent: (event) => {
            if (event.kind === "llm_call_stats") enrichmentOutputTokens += event.outputTokens;
            enrichmentEvents.push(event);
          },
        },
      ));
  } catch (error) {
    if ((error as Error).name === "AbortError" || signal.aborted) return null;
    yield {
      kind: "error",
      // Enrichment raises the same size-shaped failures as the bootstrap payload —
      // partitionTypeUnits throws PromptBudgetExceededError for a single oversized
      // {entityKey, facts} unit — so it reports through the same enumerated
      // model-context error instead of a third message shape that names neither the
      // model nor its window. Anything that is not size-shaped keeps its own text.
      message: evidencePreparationFailure(
        error as Error,
        (needs) => unsupportedModelContext(needs, configuredBudget),
      ),
    };
    yield { kind: "result", durationMs: Date.now() - startedAt, text: "" };
    return null;
  }

  return {
    sourceFile,
    sourceContent,
    preparedEvidence: {
      domainId,
      sourcePath: bootstrapBundle.sourcePath,
      sourceBodyHash: bootstrapBundle.sourceBodyHash,
      evidence,
    },
    entry,
    outputTokens: bootstrapEvidenceOutputTokens + bootstrapOutputTokens + enrichmentOutputTokens,
  };
}

async function* forwardBootstrap(
  generator: AsyncGenerator<RunEvent, PreparedDomainBootstrap | null>,
): AsyncGenerator<RunEvent, PreparedDomainBootstrap | null> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
    yield next.value;
  }
}

export async function* runInit(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  onFileError?: OnFileError,
  similarity?: PageSimilarityService,
  ingestRuntime?: InitIngestRuntime,
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const dryRun = args.includes("--dry-run");
  const sourcesIdx = args.indexOf("--sources");
  const sourcePaths = sourcesIdx >= 0 ? args.slice(sourcesIdx + 1) : [];

  const force = args.includes("--force");
  const incremental = args.includes("--incremental");

  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);

  if (incremental) {
    if (!existing) {
      yield { kind: "error", message: `incremental: domain not found: "${domainId}"` };
      return;
    }
    if (!existing.entity_types?.length) {
      yield { kind: "error", message: `incremental: domain "${domainId}" not initialised — run a full init/reinit first` };
      return;
    }
    if (!sourcePaths.length) {
      yield { kind: "result", durationMs: 0, text: `Domain "${domainId}": no changed sources to re-ingest.` };
      return;
    }
    yield* runIncrementalReinit(
      domainId,
      sourcePaths,
      vaultTools,
      llm,
      model,
      domains,
      signal,
      opts,
      onFileError,
      similarity,
      ingestRuntime,
    );
    return;
  }

  if (force) {
    if (!existing) {
      yield { kind: "error", message: `force: domain not found: "${domainId}"` };
      return;
    }
    if (dryRun) {
      yield { kind: "error", message: "force: dry-run not supported" };
      return;
    }
    try {
      forceDomainRoot(existing.wiki_folder);
    } catch (error) {
      yield { kind: "error", message: `force: invalid wiki folder — ${(error as Error).message}` };
      return;
    }
    const effectiveSources = sourcePaths.length ? sourcePaths : (existing.source_paths ?? []);
    if (!effectiveSources.length) {
      yield { kind: "error", message: "force: no sources to re-analyze" };
      return;
    }

    let preparedSources: Array<{ path: string; content: string }>;
    try {
      const sourceFileLists = await Promise.all(
        effectiveSources.map((sourcePath) =>
          sourcePath.endsWith(".md") ? Promise.resolve([sourcePath]) : vaultTools.listFiles(sourcePath)),
      );
      const sourceFiles = [...new Set(sourceFileLists.flat())]
        .filter((file) => file.endsWith(".md"))
        .sort(compareCodePoints);
      preparedSources = await Promise.all(sourceFiles.map(async (path) => ({
        path,
        content: await vaultTools.read(path),
      })));
    } catch (error) {
      yield { kind: "error", message: `force: could not prepare sources: ${(error as Error).message}` };
      return;
    }
    const firstSource = preparedSources[0]?.path;
    if (!firstSource) {
      yield { kind: "error", message: `No .md files found in source paths: ${effectiveSources.join(", ")}` };
      return;
    }
    const firstSourceContent = preparedSources[0].content;
    const bootstrap = forwardBootstrap(prepareDomainBootstrap(
      domainId,
      effectiveSources,
      firstSource,
      firstSourceContent,
      existing,
      true,
      vaultName,
      llm,
      model,
      signal,
      opts,
      Date.now(),
    ));
    let preparedBootstrap: PreparedDomainBootstrap | null;
    while (true) {
      const next = await bootstrap.next();
      if (next.done) {
        preparedBootstrap = next.value;
        break;
      }
      yield next.value;
    }
    if (!preparedBootstrap || signal.aborted) return;
    preparedBootstrap.preparedSources = preparedSources;

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.reinitWiping(domainWikiFolder(existing.wiki_folder)) };
    yield {
      kind: "tool_use",
      name: "WipeDomain",
      input: { folder: forceDomainRoot(existing.wiki_folder) },
    };
    if (signal.aborted) {
      yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
      return;
    }
    try {
      for (const prepared of preparedSources) {
        if (await vaultTools.read(prepared.path) !== prepared.content) {
          yield { kind: "tool_result", ok: false, preview: `source changed: ${prepared.path}` };
          yield { kind: "error", message: `force: source changed during bootstrap preflight: ${prepared.path}` };
          return;
        }
        if (signal.aborted) {
          yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
          return;
        }
      }
    } catch (error) {
      yield { kind: "tool_result", ok: false, preview: (error as Error).message };
      yield { kind: "error", message: `force: could not recheck prepared sources: ${(error as Error).message}` };
      return;
    }
    if (signal.aborted) {
      yield { kind: "tool_result", ok: false, preview: "force: cancelled before wipe" };
      return;
    }
    let wipeManifest: WipeDomainManifest;
    try {
      wipeManifest = await wipeDomainFolderWithManifest(
        vaultTools,
        existing.wiki_folder,
        signal,
        { telemetryDomainId: domainId },
      );
    } catch (error) {
      yield { kind: "tool_result", ok: false, preview: (error as Error).message };
      yield { kind: "error", message: `force: wipe failed — ${(error as Error).message}` };
      return;
    }
    for (const event of await wipeManifestEvents(domainId, wipeManifest)) yield event;
    yield { kind: "tool_result", ok: true };
    yield {
      kind: "assistant_text",
      delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.removedFiles(
        Object.keys(wipeManifest.removedFileHashes).length,
      ),
    };

    yield* runInitWithSources(
      domainId,
      effectiveSources,
      false,
      vaultTools,
      llm,
      model,
      domains.filter((domain) => domain.id !== domainId),
      vaultName,
      signal,
      opts,
      onFileError,
      true,
      similarity,
      preparedBootstrap,
      ingestRuntime,
    );
    return;
  }

  if (sourcePaths.length) {
    yield* runInitWithSources(
      domainId,
      sourcePaths,
      dryRun,
      vaultTools,
      llm,
      model,
      domains,
      vaultName,
      signal,
      opts,
      onFileError,
      false,
      similarity,
      undefined,
      ingestRuntime,
    );
    return;
  }

  if (!existing) {
    yield { kind: "error", message: `init: domain not found: "${domainId}" — add it in settings first` };
    return;
  }
  if (existing.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }
  const effectiveSources = existing.source_paths ?? [];
  if (!effectiveSources.length) {
    yield { kind: "error", message: `init: no source_paths configured for "${domainId}" — add them in settings` };
    return;
  }
  yield* runInitWithSources(
    domainId,
    effectiveSources,
    dryRun,
    vaultTools,
    llm,
    model,
    domains,
    vaultName,
    signal,
    opts,
    onFileError,
    false,
    similarity,
    undefined,
    ingestRuntime,
  );
}

export async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  dryRun: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  force: boolean = false,
  similarity?: PageSimilarityService,
  preparedBootstrap?: PreparedDomainBootstrap,
  ingestRuntime?: InitIngestRuntime,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let outputTokens = 0;
  const wikiRootGuess = `!Wiki`;
  const sourceModel = ingestRuntime?.model ?? model;
  const sourceOpts = ingestRuntime?.opts ?? opts;

  yield { kind: "tool_use", name: "Glob", input: { pattern: sourcePaths.join(", ") } };
  const preparedSourceContents = new Map(
    preparedBootstrap?.preparedSources?.map(({ path, content }) => [path, content]) ?? [],
  );
  let sourceFiles: string[];
  if (preparedBootstrap?.preparedSources !== undefined) {
    sourceFiles = preparedBootstrap.preparedSources.map(({ path }) => path);
  } else {
    await ensureRootFiles(vaultTools, wikiRootGuess);
    const sourceFileLists = await Promise.all(sourcePaths.map((sp) => vaultTools.listFiles(sp)));
    sourceFiles = [...new Set(sourceFileLists.flat())].filter((f) => f.endsWith(".md"));
  }

  if (!sourceFiles.length) {
    yield { kind: "tool_result", ok: false, preview: "no .md files found" };
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: `${sourceFiles.length} source files` };

  const existing = domains.find((d) => d.id === domainId);
  // "Resuming" means the domain was already bootstrapped (has entity_types), so
  // the bootstrap step is skipped and only unanalyzed sources are processed.
  // A freshly-registered domain reloads with analyzed_sources:{} (always defined),
  // so keying on analyzed_sources would wrongly skip bootstrap and leave the
  // domain with zero entity_types — which then routes/rejects every page.
  const isResuming = !force && !!existing?.entity_types?.length;
  const alreadyAnalyzed = new Set(force ? [] : Object.keys(existing?.analyzed_sources ?? {}));
  const toAnalyze = isResuming
    ? sourceFiles.filter((f) => !alreadyAnalyzed.has(f))
    : sourceFiles;

  yield { kind: "init_start", totalFiles: toAnalyze.length };

  if (toAnalyze.length === 0) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Domain "${domainId}": no new sources to process.`,
      outputTokens: outputTokens || undefined,
    };
    return;
  }

  const initialDomainRoot = existing
    ? domainWikiFolder(existing.wiki_folder)
    : preparedBootstrap
      ? domainWikiFolder(preparedBootstrap.entry.wiki_folder)
      : wikiRootGuess;
  let annotationsCache = await readPageDescriptions(vaultTools, initialDomainRoot);

  let currentDomain: DomainEntry | null = existing ?? null;
  let bootstrapApplied = false;
  let handoffSourceFile = preparedBootstrap?.sourceFile;
  let firstSourceEvidence = preparedBootstrap?.preparedEvidence;
  let successfulFiles = 0;

  if (force && preparedBootstrap && !existing) {
    const entry = preparedBootstrap.entry;
    currentDomain = {
      id: domainId,
      name: entry.name,
      wiki_folder: entry.wiki_folder,
      entity_types: entry.entity_types,
      language_notes: entry.language_notes,
      source_paths: sourcePaths,
      analyzed_sources: {},
      analyzed_sources_v2: true,
    };
    outputTokens += preparedBootstrap.outputTokens;
    yield { kind: "tool_use", name: "SaveDomain", input: { id: domainId } };
    yield { kind: "domain_created", entry: currentDomain };
    yield { kind: "tool_result", ok: true };
    await vaultTools.write(domainIndexPath(domainWikiFolder(currentDomain.wiki_folder)), "");
    bootstrapApplied = true;
  }

  for (let i = 0; i < toAnalyze.length; i++) {
    if (signal.aborted) return;

    const file = toAnalyze[i];
    yield { kind: "file_start", file, index: i, total: toAnalyze.length };

    let fileContent: string;
    try {
      fileContent = preparedSourceContents.has(file)
        ? preparedSourceContents.get(file)!
        : await vaultTools.read(file);
    } catch {
      yield { kind: "assistant_text", delta: `⚠ ${file}: не удалось прочитать файл, пропускаем\n` };
      yield { kind: "file_outcome", file, status: "skipped" };
      continue;
    }

    yield { kind: "assistant_text", delta: i18nFor(resolveLang(opts.outputLanguage)).initProgress.fileChars(file, fileContent.length) };

    // --- Step 1: Analyze ---
    if (i === 0 && !isResuming && !bootstrapApplied) {
      let bootstrapResult = preparedBootstrap;
      const requiresFreshPreflight = bootstrapResult === undefined;
      if (bootstrapResult) {
        if (bootstrapResult.sourceFile !== file || bootstrapResult.sourceContent !== fileContent) {
          yield { kind: "error", message: `force: prepared bootstrap source changed: ${file}` };
          return;
        }
      } else {
        const bootstrap = forwardBootstrap(prepareDomainBootstrap(
          domainId,
          sourcePaths,
          file,
          fileContent,
          existing,
          force,
          vaultName,
          llm,
          model,
          signal,
          opts,
          start,
        ));
        while (true) {
          const next = await bootstrap.next();
          if (next.done) {
            bootstrapResult = next.value ?? undefined;
            break;
          }
          yield next.value;
        }
      }
      if (!bootstrapResult) return;
      const recheckFreshBootstrapSource = async (): Promise<string | undefined> => {
        if (!requiresFreshPreflight) return undefined;
        let freshSourceContent: string;
        try {
          freshSourceContent = await vaultTools.read(file);
        } catch (error) {
          return `init: could not recheck bootstrap source ${file}: ${(error as Error).message}`;
        }
        if (
          freshSourceContent !== bootstrapResult.sourceContent
          || hashSource(freshSourceContent) !== bootstrapResult.preparedEvidence.sourceBodyHash
        ) {
          return `init: source changed during bootstrap preflight: ${file}`;
        }
        return undefined;
      };
      const initialPreflightIssue = await recheckFreshBootstrapSource();
      if (initialPreflightIssue) {
        yield { kind: "error", message: initialPreflightIssue };
        return;
      }
      handoffSourceFile = bootstrapResult.sourceFile;
      firstSourceEvidence = bootstrapResult.preparedEvidence;
      outputTokens += bootstrapResult.outputTokens;
      const entry = bootstrapResult.entry;

      if (dryRun) {
        yield {
          kind: "result",
          durationMs: Date.now() - start,
          text: `Dry run — domain entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``,
          outputTokens: outputTokens || undefined,
        };
        return;
      }

      currentDomain = {
        ...(existing ?? { id: domainId, name: entry.name }),
        wiki_folder: entry.wiki_folder,
        entity_types: entry.entity_types,
        language_notes: entry.language_notes,
        source_paths: sourcePaths,
        analyzed_sources: {},
        analyzed_sources_v2: true,
      };

      yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
      const persistencePreflightIssue = await recheckFreshBootstrapSource();
      if (persistencePreflightIssue) {
        yield { kind: "tool_result", ok: false, preview: "bootstrap source preflight failed" };
        yield { kind: "error", message: persistencePreflightIssue };
        return;
      }
      if (existing) {
        yield {
          kind: "domain_updated", domainId,
          patch: {
            entity_types: currentDomain.entity_types,
            language_notes: currentDomain.language_notes,
            wiki_folder: currentDomain.wiki_folder,
            analyzed_sources: {},
          },
        };
      } else {
        yield { kind: "domain_created", entry: currentDomain };
      }
      yield { kind: "tool_result", ok: true };
    } else {
      if (!currentDomain) {
        continue;
      }
    }

    if (signal.aborted) return;
    if (!currentDomain) {
      continue;
    }

    // --- Ingest: write pages + intercept domain_updated for entity_types propagation ---
    let retried = false;
    let done = false;
    let attempt = 1;
    let ingestOutcome: IngestOutcome | undefined;
    while (!done) {
      let caughtErr: Error | null = null;
      let controlledRetryable: boolean | undefined;
      let controlledStage: IngestFailureStage | undefined;
      try {
        const forwarded = forwardIngest(
          runIngest(
            [file],
            vaultTools,
            llm,
            sourceModel,
            [currentDomain],
            vaultTools.vaultRoot,
            signal,
            sourceOpts,
            similarity,
            annotationsCache,
            undefined,
            undefined,
            undefined,
            file === handoffSourceFile ? firstSourceEvidence : undefined,
          ),
          (event) => {
            if (event.domainId === domainId && currentDomain) {
              currentDomain = { ...currentDomain, ...event.patch };
            }
          },
        );
        while (true) {
          const next = await forwarded.next();
          if (next.done) {
            ingestOutcome = next.value.outcome;
            if (!ingestOutcome.ok && next.value.childError) {
              ingestOutcome = { ...ingestOutcome, message: next.value.childError };
            }
            break;
          }
          yield next.value;
        }
        if (!ingestOutcome.ok) {
          controlledRetryable = ingestOutcome.retryable;
          controlledStage = ingestOutcome.stage;
          caughtErr = new Error(ingestOutcome.message);
          caughtErr.name = ingestOutcome.stage === "embedding"
            ? "EmbeddingUnavailableError"
            : "IngestOutcomeError";
        }
      } catch (e) {
        caughtErr = e as Error;
      }
      if (caughtErr) {
        if (caughtErr.name === "AbortError" || signal.aborted) return;
        const failureRetryable = controlledRetryable ?? true;
        yield {
          kind: "file_attempt",
          file,
          attempt,
          state: "failed",
          retryable: failureRetryable,
          message: safeFileAttemptMessage(caughtErr, controlledStage),
        };
        if (caughtErr instanceof EmbeddingUnavailableError || caughtErr.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caughtErr.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
          return;
        }
        const canRetry = !retried && failureRetryable;
        let choice: Awaited<ReturnType<NonNullable<OnFileError>>> = "skip";
        if (onFileError) {
          const progress = i18nFor(resolveLang(sourceOpts.outputLanguage)).initProgress;
          yield { kind: "info_text", icon: "⏳", summary: progress.fileErrorWaiting(file) };
          choice = await onFileError(file, caughtErr, canRetry);
          yield { kind: "info_text", icon: "ℹ️", summary: progress.fileErrorDecision(choice) };
        }
        if (signal.aborted) return;
        if (choice === "stop") {
          yield { kind: "file_outcome", file, status: "stopped" };
          return;
        }
        if (choice === "retry" && canRetry) {
          retried = true;
          attempt += 1;
          yield { kind: "file_attempt", file, attempt, state: "retry_scheduled", retryable: true };
          continue;
        }
        yield { kind: "file_outcome", file, status: retried ? "exhausted" : "skipped" };
        done = true;
      } else {
        if (retried) {
          yield { kind: "file_attempt", file, attempt, state: "recovered", retryable: true };
        }
        done = true;
      }
    }

    if (!ingestOutcome?.ok) continue;
    outputTokens += ingestOutcome.outputTokens;

    if (similarity) {
      const domainRoot = currentDomain ? domainWikiFolder(currentDomain.wiki_folder) : wikiRootGuess;
      annotationsCache = await readPageDescriptions(vaultTools, domainRoot);
    }

    if (signal.aborted) return;

    // --- Mark file complete: record analyzed_sources hash ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: {
        ...(currentDomain.analyzed_sources ?? {}),
        [file]: ingestOutcome.sourceBodyHash,
      },
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield {
      kind: "domain_updated", domainId,
      patch: {
        entity_types: currentDomain.entity_types,
        language_notes: currentDomain.language_notes,
        analyzed_sources: currentDomain.analyzed_sources,
      },
    };
    yield { kind: "tool_result", ok: true };

    successfulFiles++;
    yield { kind: "file_outcome", file, status: "done" };
    yield { kind: "file_done", file };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  yield {
    kind: "eval_meta",
    fields: {
      files_processed: successfulFiles,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised ${successfulFiles} of ${toAnalyze.length} source files.`,
    outputTokens: outputTokens || undefined,
  };
}

export async function* runIncrementalReinit(
  domainId: string,
  changedFiles: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  similarity?: PageSimilarityService,
  ingestRuntime?: InitIngestRuntime,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const sourceModel = ingestRuntime?.model ?? model;
  const sourceOpts = ingestRuntime?.opts ?? opts;
  let currentDomain = domains.find((d) => d.id === domainId) ?? null;
  if (!currentDomain) {
    yield { kind: "error", message: `incremental: domain "${domainId}" missing` };
    return;
  }

  yield { kind: "init_start", totalFiles: changedFiles.length };
  let doneCount = 0;

  for (let i = 0; i < changedFiles.length; i++) {
    if (signal.aborted) return;
    const file = changedFiles[i];
    yield { kind: "file_start", file, index: i, total: changedFiles.length };

    let retried = false;
    let fileDone = false;
    let attempt = 1;
    let ingestOutcome: IngestOutcome | undefined;
    while (!fileDone) {
      let caught: Error | null = null;
      let controlledRetryable: boolean | undefined;
      let controlledStage: IngestFailureStage | undefined;
      try {
        const forwarded = forwardIngest(
          runIngest(
            [file],
            vaultTools,
            llm,
            sourceModel,
            [currentDomain],
            vaultTools.vaultRoot,
            signal,
            sourceOpts,
            similarity,
          ),
          (event) => {
            if (event.domainId === domainId) currentDomain = { ...currentDomain!, ...event.patch };
          },
        );
        while (true) {
          const next = await forwarded.next();
          if (next.done) {
            ingestOutcome = next.value.outcome;
            if (!ingestOutcome.ok && next.value.childError) {
              ingestOutcome = { ...ingestOutcome, message: next.value.childError };
            }
            break;
          }
          yield next.value;
        }
        if (!ingestOutcome.ok) {
          controlledRetryable = ingestOutcome.retryable;
          controlledStage = ingestOutcome.stage;
          caught = new Error(ingestOutcome.message);
          caught.name = ingestOutcome.stage === "embedding"
            ? "EmbeddingUnavailableError"
            : "IngestOutcomeError";
        }
      } catch (e) {
        caught = e as Error;
      }
      if (caught) {
        if (caught.name === "AbortError" || signal.aborted) return;
        const failureRetryable = controlledRetryable ?? true;
        yield {
          kind: "file_attempt",
          file,
          attempt,
          state: "failed",
          retryable: failureRetryable,
          message: safeFileAttemptMessage(caught, controlledStage),
        };
        if (caught instanceof EmbeddingUnavailableError || caught.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caught.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: Date.now() - start, text: "" };
          return;
        }
        const canRetry = !retried && failureRetryable;
        let choice: Awaited<ReturnType<NonNullable<OnFileError>>> = "skip";
        if (onFileError) {
          const progress = i18nFor(resolveLang(sourceOpts.outputLanguage)).initProgress;
          yield { kind: "info_text", icon: "⏳", summary: progress.fileErrorWaiting(file) };
          choice = await onFileError(file, caught, canRetry);
          yield { kind: "info_text", icon: "ℹ️", summary: progress.fileErrorDecision(choice) };
        }
        if (signal.aborted) return;
        if (choice === "stop") {
          yield { kind: "file_outcome", file, status: "stopped" };
          return;
        }
        if (choice === "retry" && canRetry) {
          retried = true;
          attempt += 1;
          yield { kind: "file_attempt", file, attempt, state: "retry_scheduled", retryable: true };
          continue;
        }
        yield { kind: "file_outcome", file, status: retried ? "exhausted" : "skipped" };
        fileDone = true;
      } else {
        if (retried) {
          yield { kind: "file_attempt", file, attempt, state: "recovered", retryable: true };
        }
        fileDone = true;
      }
    }

    if (signal.aborted) return;
    if (!ingestOutcome?.ok) continue;

    const analyzedMap = currentDomain.analyzed_sources ?? {};
    const nextAnalyzed: Record<string, string> = {
      ...analyzedMap,
      [file]: ingestOutcome.sourceBodyHash,
    };
    currentDomain = {
      ...currentDomain,
      analyzed_sources: nextAnalyzed,
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: currentDomain.analyzed_sources } };
    yield { kind: "tool_result", ok: true };

    doneCount++;
    yield { kind: "file_outcome", file, status: "done" };
    yield { kind: "file_done", file };
  }

  yield {
    kind: "eval_meta",
    fields: {
      files_processed: doneCount,
      domain: domainId,
      promptVersion: promptVersionOf(initTemplate),
    },
  };
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}": re-ingested ${doneCount} of ${changedFiles.length} changed source(s).`,
  };
}

/**
 * Concurrency boundary for force re-init:
 * - plugin wipes of the same root are serialized by activeDomainWipes;
 * - the atomic root-to-transaction rename is the linearization point;
 * - writers that keep using the public root are detected and preserved;
 * - the unpredictable transaction namespace is operation-owned after mkdir.
 *
 * Direct external writes into that internal namespace are unsupported. A
 * generic VaultAdapter offers no primitive that can serialize such malicious
 * writes, so this function does not claim to make them safe.
 */
export async function wipeDomainFolder(
  vaultTools: VaultTools,
  wikiFolder: string,
  signal?: AbortSignal,
  options: ForceWipeOptions = {},
): Promise<string[]> {
  const manifest = await wipeDomainFolderWithManifest(
    vaultTools,
    wikiFolder,
    signal,
    options,
  );
  const root = forceDomainRoot(wikiFolder);
  return Object.keys(manifest.removedFileHashes)
    .map((relative) => `${root}/${relative}`)
    .sort(compareCodePoints);
}

export interface WipeDomainManifest {
  transactionId: string;
  removedPaths: string[];
  removedFileHashes: Record<string, string>;
  manifestHash: string;
  telemetryEvents?: Array<Extract<RunEvent, { kind: "wipe_manifest_chunk" }>>;
  telemetryComplete?: Extract<RunEvent, { kind: "wipe_complete" }>;
}

const WIPE_MANIFEST_CHUNK_PATHS = 100;
export const WIPE_MANIFEST_LINE_MAX_BYTES = WIPE_LOG_LINE_MAX_BYTES;
export const WIPE_MANIFEST_EVENT_MAX_BYTES = WIPE_EVENT_MAX_BYTES;

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function representativeAgentEnvelope(event: RunEvent): Record<string, unknown> {
  return {
    ts: "9999-12-31T23:59:59.999Z",
    session: "session-id",
    op: "init",
    domainId: "domain-id",
    backend: "openai-compatible",
    model: "provider/model",
    event,
  };
}

async function planWipeManifestChunks(
  domainId: string,
  transactionId: string,
  entries: WipeManifestEntry[],
): Promise<{
  chunks: Array<Extract<RunEvent, { kind: "wipe_manifest_chunk" }>>;
  complete: Extract<RunEvent, { kind: "wipe_complete" }>;
}> {
  assertBoundedWipeIdentifier(domainId, "wipe domainId");
  assertBoundedWipeIdentifier(transactionId, "wipe transaction");
  for (const entry of entries) assertWellFormedWipeString(entry.path, "manifest path");
  const groups: WipeManifestEntry[][] = [];
  let current: WipeManifestEntry[] = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    const representative = {
      kind: "wipe_manifest_chunk" as const,
      domainId,
      transactionId,
      chunkIndex: Number.MAX_SAFE_INTEGER,
      chunkCount: Number.MAX_SAFE_INTEGER,
      hashAlgorithm: WIPE_HASH_ALGORITHM,
      entries: candidate,
      chunkHash: `sha256:${"f".repeat(64)}`,
    };
    if (
      candidate.length > WIPE_MANIFEST_CHUNK_PATHS
      || encodedBytes(representative) > WIPE_MANIFEST_EVENT_MAX_BYTES
    ) {
      if (current.length === 0) {
        throw new Error("force: wipe manifest entry exceeds telemetry payload limit");
      }
      groups.push(current);
      current = [entry];
      const single = { ...representative, entries: current };
      if (encodedBytes(single) > WIPE_MANIFEST_EVENT_MAX_BYTES) {
        throw new Error("force: wipe manifest entry exceeds telemetry payload limit");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  const chunks: Array<Extract<RunEvent, { kind: "wipe_manifest_chunk" }>> = [];
  for (const [chunkIndex, chunkEntries] of groups.entries()) {
    const chunk: Extract<RunEvent, { kind: "wipe_manifest_chunk" }> = {
      kind: "wipe_manifest_chunk",
      domainId,
      transactionId,
      chunkIndex,
      chunkCount: groups.length,
      hashAlgorithm: WIPE_HASH_ALGORITHM,
      entries: chunkEntries,
      chunkHash: await wipeChunkHash(chunkEntries),
    };
    if (
      encodedBytes(chunk) > WIPE_MANIFEST_EVENT_MAX_BYTES
      || encodedBytes(representativeAgentEnvelope(chunk)) > WIPE_MANIFEST_LINE_MAX_BYTES
    ) {
      throw new Error("force: wipe manifest chunk exceeds telemetry payload limit");
    }
    chunks.push(chunk);
  }
  let manifestHash = await initialWipeManifestRoot(entries.length, chunks.length);
  for (const chunk of chunks) {
    manifestHash = await advanceWipeManifestRoot(manifestHash, {
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      entryCount: chunk.entries.length,
      chunkHash: chunk.chunkHash,
    });
  }
  const complete: Extract<RunEvent, { kind: "wipe_complete" }> = {
    kind: "wipe_complete",
    domainId,
    transactionId,
    chunkCount: chunks.length,
    totalCount: entries.length,
    hashAlgorithm: WIPE_HASH_ALGORITHM,
    manifestHash,
    atMs: Number.MAX_SAFE_INTEGER,
  };
  if (
    encodedBytes(complete) > WIPE_MANIFEST_EVENT_MAX_BYTES
    || encodedBytes(representativeAgentEnvelope(complete)) > WIPE_MANIFEST_LINE_MAX_BYTES
  ) {
    throw new Error("force: wipe_complete exceeds telemetry payload limit");
  }
  return { chunks, complete };
}

export async function wipeManifestEvents(
  domainId: string,
  manifest: WipeDomainManifest,
  atMs = Date.now(),
): Promise<Array<Extract<RunEvent, { kind: "wipe_manifest_chunk" | "wipe_complete" }>>> {
  const entries = manifest.removedPaths.map((path) => ({
    path,
    ...(manifest.removedFileHashes[path] === undefined
      ? {}
      : { hash: manifest.removedFileHashes[path] }),
  }));
  const planned = manifest.telemetryEvents && manifest.telemetryComplete
    ? { chunks: manifest.telemetryEvents, complete: manifest.telemetryComplete }
    : await planWipeManifestChunks(domainId, manifest.transactionId, entries);
  return [
    ...planned.chunks,
    {
      ...planned.complete,
      atMs,
    },
  ];
}

export async function wipeDomainFolderWithManifest(
  vaultTools: VaultTools,
  wikiFolder: string,
  signal?: AbortSignal,
  options: ForceWipeOptions = {},
): Promise<WipeDomainManifest> {
  assertBoundedWipeIdentifier(wikiFolder, "wipe wikiFolder");
  assertBoundedWipeIdentifier(
    options.telemetryDomainId ?? wikiFolder,
    "wipe domainId",
  );
  const root = forceDomainRoot(wikiFolder);
  requireTransactionalWipeAdapter(vaultTools);
  const snapshotByteLimit = options.snapshotByteLimit ?? FORCE_WIPE_SNAPSHOT_BYTE_LIMIT;
  const fileByteLimit = options.fileByteLimit ?? FORCE_WIPE_FILE_BYTE_LIMIT;
  if (
    !Number.isSafeInteger(snapshotByteLimit)
    || snapshotByteLimit < 0
    || !Number.isSafeInteger(fileByteLimit)
    || fileByteLimit < 0
  ) {
    throw new Error("force: invalid snapshot or per-file byte limit");
  }

  if (activeDomainWipes.has(root)) {
    throw new Error(`force: wipe already in progress for ${root}`);
  }
  activeDomainWipes.add(root);
  try {
    return await wipeDomainFolderLocked(
      vaultTools,
      root,
      signal,
      snapshotByteLimit,
      fileByteLimit,
      options.telemetryDomainId ?? wikiFolder,
    );
  } finally {
    activeDomainWipes.delete(root);
  }
}

async function wipeDomainFolderLocked(
  vaultTools: VaultTools,
  root: string,
  signal: AbortSignal | undefined,
  snapshotByteLimit: number,
  fileByteLimit: number,
  telemetryDomainId: string,
): Promise<WipeDomainManifest> {
  if (!await checkedExists(vaultTools, root, signal)) {
    const removedPaths: string[] = [];
    const removedFileHashes: Record<string, string> = {};
    const transactionId = `wipe-empty-${Date.now().toString(36)}`;
    const telemetry = await planWipeManifestChunks(
      telemetryDomainId,
      transactionId,
      [],
    );
    return {
      transactionId,
      removedPaths,
      removedFileHashes,
      manifestHash: telemetry.complete.manifestHash,
      telemetryEvents: telemetry.chunks,
      telemetryComplete: telemetry.complete,
    };
  }

  const transaction = await createWipeTransaction(vaultTools, signal);
  const quarantinedRoot = `${transaction}/domain`;
  const removed = new Set<string>();
  let rootRenameAttempted = false;
  let snapshot: DomainTreeSnapshot | undefined;
  let preparedManifest: WipeDomainManifest | undefined;
  try {
    await requireEmptyDirectory(vaultTools, transaction, signal, "new transaction");
    if (
      await checkedExists(vaultTools, quarantinedRoot, signal)
    ) {
      throw new Error("force: transaction destination unexpectedly exists");
    }

    rootRenameAttempted = true;
    let renameError: Error | undefined;
    try {
      await vaultTools.rename(root, quarantinedRoot);
    } catch (error) {
      renameError = error instanceof Error ? error : new Error(String(error));
    }
    const rootAfterRename = await checkedExists(vaultTools, root, signal);
    const quarantineAfterRename = await checkedExists(vaultTools, quarantinedRoot, signal);
    if (renameError && rootAfterRename && !quarantineAfterRename) throw renameError;
    if (rootAfterRename || !quarantineAfterRename) {
      throw new Error(
        `force: atomic rename trust failure: root=${rootAfterRename} quarantine=${quarantineAfterRename}`,
      );
    }
    if (renameError) throw renameError;
    await requireDirectEntries(
      vaultTools,
      transaction,
      [],
      [quarantinedRoot],
      signal,
      "post-rename transaction",
    );

    snapshot = await inventoryDomainTree(
      vaultTools,
      quarantinedRoot,
      signal,
      snapshotByteLimit,
      fileByteLimit,
    );
    if (!snapshot.existed) {
      throw new Error("force: quarantined domain disappeared before inventory");
    }
    await requireOriginalRootAbsent(vaultTools, root, signal);
    preparedManifest = await prepareWipeDomainManifest(
      snapshot,
      quarantinedRoot,
      root,
      transaction.slice(transaction.lastIndexOf("/") + 1),
      telemetryDomainId,
    );

    for (const [path, bytes] of snapshot.files) {
      throwIfWipeAborted(signal);
      await requireOriginalRootAbsent(vaultTools, root, signal);
      if (
        !await checkedExists(vaultTools, path, signal)
        || !sameBytes(new Uint8Array(await checkedReadBinary(vaultTools, path, signal)), bytes)
      ) {
        throw new Error(`force: wipe target changed before removal: ${path}`);
      }

      try {
        await vaultTools.remove(path);
      } catch (error) {
        if (!await vaultTools.exists(path)) removed.add(path);
        throw error;
      }
      const pathRemains = await vaultTools.exists(path);
      if (!pathRemains) removed.add(path);
      throwIfWipeAborted(signal);
      if (pathRemains) {
        throw new Error(`force: removal did not remove ${path}`);
      }
      await requireOriginalRootAbsent(vaultTools, root, signal);
    }

    for (const folder of foldersDeepestFirst(snapshot.folders)) {
      await requireOriginalRootAbsent(vaultTools, root, signal);
      await requireEmptyDirectory(vaultTools, folder, signal, "quarantined folder");
      await rmdirEmptyDirectory(vaultTools, folder, signal, "quarantined folder");
      throwIfWipeAborted(signal);
      if (await checkedExists(vaultTools, folder, signal)) {
        throw new Error(`force: non-recursive rmdir did not remove ${folder}`);
      }
    }

    await requireOriginalRootAbsent(vaultTools, root, signal);
    await removeKnownEmptyDirectory(vaultTools, transaction, signal, "transaction");
    await requireOriginalRootAbsent(vaultTools, root, signal);
  } catch (error) {
    try {
      await rollbackWipeTransaction(
        vaultTools,
        root,
        transaction,
        quarantinedRoot,
        rootRenameAttempted,
        snapshot,
        removed,
      );
    } catch (rollbackError) {
      throw new Error(
        `force: wipe failed (${(error as Error).message}); rollback failed — ${(rollbackError as Error).message}`,
      );
    }
    throw error;
  }
  if (!preparedManifest) throw new Error("force: wipe manifest was not prepared");
  return preparedManifest;
}

async function prepareWipeDomainManifest(
  snapshot: DomainTreeSnapshot,
  quarantinedRoot: string,
  root: string,
  transactionId: string,
  domainId: string,
): Promise<WipeDomainManifest> {
  const removedFileHashes: Record<string, string> = {};
  for (const [quarantinedPath, bytes] of snapshot.files) {
    const originalPath = originalPathFromQuarantine(
      quarantinedPath,
      quarantinedRoot,
      root,
    );
    removedFileHashes[originalPath.slice(root.length + 1)] = await wipeProofHash(bytes);
  }
  const removedPaths = [
    ...Object.keys(removedFileHashes),
    ...snapshot.folders
      .filter((folder) => folder !== quarantinedRoot)
      .map((folder) => {
        const originalPath = originalPathFromQuarantine(
          folder,
          quarantinedRoot,
          root,
        );
        return `${originalPath.slice(root.length + 1)}/`;
      }),
  ].sort(compareCodePoints);
  const entries = removedPaths.map((path) => ({
    path,
    ...(removedFileHashes[path] === undefined ? {} : { hash: removedFileHashes[path] }),
  }));
  const telemetry = await planWipeManifestChunks(domainId, transactionId, entries);
  return {
    transactionId,
    removedPaths,
    removedFileHashes,
    manifestHash: telemetry.complete.manifestHash,
    telemetryEvents: telemetry.chunks,
    telemetryComplete: telemetry.complete,
  };
}

export const FORCE_WIPE_SNAPSHOT_BYTE_LIMIT = 128 * 1024 * 1024;
export const FORCE_WIPE_FILE_BYTE_LIMIT = 32 * 1024 * 1024;
// Retained snapshot plus one transient read used by compare/rollback.
export const FORCE_WIPE_PEAK_BYTE_LIMIT =
  FORCE_WIPE_SNAPSHOT_BYTE_LIMIT + FORCE_WIPE_FILE_BYTE_LIMIT;

export interface ForceWipeOptions {
  snapshotByteLimit?: number;
  fileByteLimit?: number;
  telemetryDomainId?: string;
}

interface DomainTreeSnapshot {
  root: string;
  existed: boolean;
  files: Map<string, Uint8Array>;
  folders: string[];
  byteLimit: number;
  fileByteLimit: number;
}

function requireTransactionalWipeAdapter(vaultTools: VaultTools): void {
  if (
    typeof vaultTools.adapter.readBinary !== "function"
    || typeof vaultTools.adapter.writeBinary !== "function"
    || typeof vaultTools.adapter.rename !== "function"
    || typeof vaultTools.adapter.stat !== "function"
    || typeof vaultTools.adapter.remove !== "function"
    || typeof vaultTools.adapter.rmdir !== "function"
  ) {
    throw new Error(
      "force: transactional wipe requires adapter stat, readBinary, writeBinary, remove, rmdir, and rename",
    );
  }
}

const activeDomainWipes = new Set<string>();
let transactionSequence = 0;

async function createWipeTransaction(
  vaultTools: VaultTools,
  signal?: AbortSignal,
): Promise<string> {
  const runToken = `${Date.now().toString(36)}-${(transactionSequence++).toString(36)}`;
  for (let attempt = 0; attempt < 64; attempt++) {
    throwIfWipeAborted(signal);
    const candidate = `${WIKI_ROOT}/.ai-wiki-reinit-txn-${runToken}-${attempt.toString(36)}`;
    if (await checkedExists(vaultTools, candidate, signal)) continue;
    let mkdirSucceeded = false;
    try {
      await vaultTools.mkdir(candidate);
      mkdirSucceeded = true;
    } catch {
      // A throwing mkdir never transfers ownership. It may be an EEXIST race,
      // including an empty foreign directory, so never inspect or remove it.
      continue;
    }
    try {
      if (!await checkedExists(vaultTools, candidate, signal)) {
        throw new Error(`force: transaction mkdir did not create ${candidate}`);
      }
      await requireEmptyDirectory(vaultTools, candidate, signal, "new transaction");
      return candidate;
    } catch (error) {
      try {
        if (mkdirSucceeded && await vaultTools.exists(candidate)) {
          const listed = await vaultTools.adapter.list(candidate);
          if (listed.files.length === 0 && listed.folders.length === 0) {
            // Cleanup runs without the abort signal: a cancelled setup must
            // still be able to drop the transaction directory it created.
            await rmdirEmptyDirectory(vaultTools, candidate, undefined, "new transaction");
          }
        }
      } catch (cleanupError) {
        throw new Error(
          `force: transaction setup failed (${(error as Error).message}); cleanup failed — ${(cleanupError as Error).message}`,
        );
      }
      throw error;
    }
  }
  throw new Error("force: unable to allocate unique transaction path");
}

function throwIfWipeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("force: wipe cancelled");
}

async function checkedExists(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfWipeAborted(signal);
  const exists = await vaultTools.exists(path);
  throwIfWipeAborted(signal);
  return exists;
}

async function checkedReadBinary(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfWipeAborted(signal);
  const bytes = await vaultTools.readBinary(path);
  throwIfWipeAborted(signal);
  return bytes;
}

async function checkedList(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
): Promise<{ files: string[]; folders: string[] }> {
  throwIfWipeAborted(signal);
  const listed = await vaultTools.adapter.list(path);
  throwIfWipeAborted(signal);
  return listed;
}

async function checkedStat(
  vaultTools: VaultTools,
  path: string,
  signal?: AbortSignal,
) {
  throwIfWipeAborted(signal);
  const stat = await vaultTools.stat(path);
  throwIfWipeAborted(signal);
  return stat;
}

async function requireOriginalRootAbsent(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
): Promise<void> {
  if (await checkedExists(vaultTools, root, signal)) {
    throw new Error(`force: original root unexpectedly exists during quarantine wipe: ${root}`);
  }
}

function originalPathFromQuarantine(path: string, quarantine: string, root: string): string {
  if (!path.startsWith(`${quarantine}/`)) {
    throw new Error(`force: untrusted quarantine result path ${path}`);
  }
  return `${root}${path.slice(quarantine.length)}`;
}

async function requireDirectEntries(
  vaultTools: VaultTools,
  path: string,
  expectedFiles: string[],
  expectedFolders: string[],
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  if (!await checkedExists(vaultTools, path, signal)) {
    throw new Error(`force: ${label} missing: ${path}`);
  }
  const listed = await checkedList(vaultTools, path, signal);
  const files = [...listed.files].sort(compareCodePoints);
  const folders = [...listed.folders].sort(compareCodePoints);
  if (
    !samePaths(files, [...expectedFiles].sort(compareCodePoints))
    || !samePaths(folders, [...expectedFolders].sort(compareCodePoints))
  ) {
    throw new Error(`force: ${label} is not empty or has unexpected children: ${path}`);
  }
}

async function requireEmptyDirectory(
  vaultTools: VaultTools,
  path: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  await requireDirectEntries(vaultTools, path, [], [], signal, label);
}

/**
 * Remove a directory the caller has just verified empty.
 *
 * Obsidian's desktop adapter implements `rmdir(path, recursive)` as
 * `fs.rm(path, { maxRetries: 5, recursive })`, so with `recursive: false` it
 * rejects every directory with EISDIR and can never remove one. Only when the
 * non-recursive call fails and the directory is still there do we re-verify
 * that it is empty and retry recursively, so the recursive call can remove
 * nothing beyond the empty directory the caller asked for. A non-recursive
 * failure that did remove the directory still propagates: an adapter that
 * reports a failed removal is never trusted.
 */
async function rmdirEmptyDirectory(
  vaultTools: VaultTools,
  path: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  try {
    await vaultTools.rmdir(path, false);
  } catch (error) {
    if (!await vaultTools.exists(path)) throw error;
    try {
      await requireEmptyDirectory(vaultTools, path, signal, label);
    } catch {
      throw error;
    }
    await vaultTools.rmdir(path, true);
  }
}

async function removeKnownEmptyDirectory(
  vaultTools: VaultTools,
  path: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  await requireEmptyDirectory(vaultTools, path, signal, label);
  await rmdirEmptyDirectory(vaultTools, path, signal, label);
  throwIfWipeAborted(signal);
  if (await checkedExists(vaultTools, path, signal)) {
    throw new Error(`force: non-recursive rmdir did not remove ${label} ${path}`);
  }
}

function foldersDeepestFirst(folders: string[]): string[] {
  return [...folders].sort((left, right) =>
    right.split("/").length - left.split("/").length || compareCodePoints(left, right));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function forceDomainRoot(wikiFolder: string): string {
  if (
    typeof wikiFolder !== "string"
    || wikiFolder.length === 0
    || wikiFolder !== wikiFolder.trim()
    || wikiFolder === "."
    || wikiFolder === ".."
    || wikiFolder === WIKI_ROOT
    || wikiFolder.includes("/")
    || wikiFolder.includes("\\")
    || Array.from(wikiFolder).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`unsafe wikiFolder ${JSON.stringify(wikiFolder)}`);
  }
  const root = domainWikiFolder(wikiFolder);
  if (root !== `${WIKI_ROOT}/${wikiFolder}`) {
    throw new Error(`unsafe derived domain root ${JSON.stringify(root)}`);
  }
  return root;
}

function assertDirectDomainChild(root: string, parent: string, path: string): void {
  const parentPrefix = `${parent}/`;
  const child = path.startsWith(parentPrefix) ? path.slice(parentPrefix.length) : "";
  const segments = path.split("/");
  if (
    !path.startsWith(`${root}/`)
    || child.length === 0
    || child.includes("/")
    || path.includes("\\")
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`force: untrusted domain inventory path ${path}`);
  }
}

async function inventoryDomainTree(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
  snapshotByteLimit = FORCE_WIPE_SNAPSHOT_BYTE_LIMIT,
  fileByteLimit = FORCE_WIPE_FILE_BYTE_LIMIT,
): Promise<DomainTreeSnapshot> {
  const layout = await inventoryDomainLayout(
    vaultTools,
    root,
    signal,
    snapshotByteLimit,
    fileByteLimit,
  );
  if (!layout.existed) {
    return {
      root,
      existed: false,
      files: new Map(),
      folders: [],
      byteLimit: snapshotByteLimit,
      fileByteLimit,
    };
  }

  const files = new Map<string, Uint8Array>();
  let snapshotBytes = 0;
  for (const [path, expectedSize] of layout.files) {
    const buffer = await checkedReadBinary(vaultTools, path, signal);
    if (buffer.byteLength !== expectedSize) {
      throw new Error(`force: file size changed after stat: ${path}`);
    }
    snapshotBytes += buffer.byteLength;
    if (
      buffer.byteLength > fileByteLimit
      || !Number.isSafeInteger(snapshotBytes)
      || snapshotBytes > snapshotByteLimit
    ) {
      throw new Error(`force: snapshot byte limit exceeded after read: ${path}`);
    }
    // DataAdapter readBinary returns an owned ArrayBuffer. Keeping its view
    // avoids a second retained copy; later checks hold only one extra file.
    files.set(path, new Uint8Array(buffer));
    throwIfWipeAborted(signal);
  }
  return {
    root,
    existed: true,
    files,
    folders: layout.folders,
    byteLimit: snapshotByteLimit,
    fileByteLimit,
  };
}

interface DomainTreeLayout {
  existed: boolean;
  files: Map<string, number>;
  folders: string[];
}

async function inventoryDomainLayout(
  vaultTools: VaultTools,
  root: string,
  signal?: AbortSignal,
  snapshotByteLimit = FORCE_WIPE_SNAPSHOT_BYTE_LIMIT,
  fileByteLimit = FORCE_WIPE_FILE_BYTE_LIMIT,
): Promise<DomainTreeLayout> {
  if (!await checkedExists(vaultTools, root, signal)) {
    return { existed: false, files: new Map(), folders: [] };
  }

  const filePaths: string[] = [];
  const folders: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    throwIfWipeAborted(signal);
    folders.push(folder);
    const listed = await checkedList(vaultTools, folder, signal);
    const listedFiles = [...listed.files].sort(compareCodePoints);
    const listedFolders = [...listed.folders].sort(compareCodePoints);
    for (const path of listedFiles) {
      throwIfWipeAborted(signal);
      assertDirectDomainChild(root, folder, path);
      filePaths.push(path);
    }
    for (const path of listedFolders) {
      throwIfWipeAborted(signal);
      assertDirectDomainChild(root, folder, path);
      await visit(path);
      throwIfWipeAborted(signal);
    }
  };
  await visit(root);
  filePaths.sort(compareCodePoints);

  const files = new Map<string, number>();
  let totalBytes = 0;
  let maxFileBytes = 0;
  let maxFilePath = "";
  for (const path of filePaths) {
    throwIfWipeAborted(signal);
    const stat = await checkedStat(vaultTools, path, signal);
    if (
      stat === null
      || stat.type !== "file"
      || !Number.isSafeInteger(stat.size)
      || stat.size < 0
    ) {
      throw new Error(`force: invalid file stat size for ${path}`);
    }
    totalBytes += stat.size;
    if (stat.size > maxFileBytes) {
      maxFileBytes = stat.size;
      maxFilePath = path;
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes > snapshotByteLimit) {
      throw new Error(
        `force: snapshot byte limit exceeded (${totalBytes} > ${snapshotByteLimit})`,
      );
    }
    files.set(path, stat.size);
  }

  // Peak formula: retained snapshot <= snapshotByteLimit, and every later
  // comparison reads one file <= fileByteLimit, so peak <= their sum.
  if (maxFileBytes > fileByteLimit) {
    throw new Error(
      `force: per-file snapshot limit exceeded at ${maxFilePath} (${maxFileBytes} > ${fileByteLimit})`,
    );
  }
  return {
    existed: true,
    files,
    folders: folders.sort(compareCodePoints),
  };
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

async function restoreDomainTree(
  vaultTools: VaultTools,
  snapshot: DomainTreeSnapshot,
  removed: Set<string>,
): Promise<void> {
  const current = await inventoryDomainLayout(
    vaultTools,
    snapshot.root,
    undefined,
    snapshot.byteLimit,
    snapshot.fileByteLimit,
  );
  let firstTrustError: Error | undefined;
  for (const path of current.files.keys()) {
    const expected = snapshot.files.get(path);
    if (expected === undefined) {
      firstTrustError ??= new Error(`rollback trust failure at ${path}`);
      continue;
    }
    const buffer = await checkedReadBinary(vaultTools, path);
    if (
      buffer.byteLength > snapshot.fileByteLimit
      || !sameBytes(expected, new Uint8Array(buffer))
    ) {
      firstTrustError ??= new Error(`rollback trust failure at ${path}`);
    }
  }
  for (const folder of current.folders) {
    if (!snapshot.folders.includes(folder)) {
      firstTrustError ??= new Error(`rollback trust failure at unexpected folder ${folder}`);
    }
  }
  if (!snapshot.existed) {
    if (current.existed) throw new Error(`rollback trust failure: ${snapshot.root} unexpectedly exists`);
    return;
  }
  for (const folder of [...snapshot.folders].sort(
    (left, right) => left.split("/").length - right.split("/").length || compareCodePoints(left, right),
  )) {
    if (!await vaultTools.exists(folder)) await vaultTools.mkdir(folder);
  }
  for (const [path, bytes] of snapshot.files) {
    if (current.files.has(path)) continue;
    if (!removed.has(path) && current.existed) {
      firstTrustError ??= new Error(`rollback trust failure at missing unremoved file ${path}`);
      continue;
    }
    try {
      await vaultTools.writeBinary(path, bytes.buffer as ArrayBuffer);
    } catch (error) {
      firstTrustError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (firstTrustError) throw firstTrustError;
  await verifyDomainTree(vaultTools, snapshot);
}

async function verifyDomainTree(
  vaultTools: VaultTools,
  snapshot: DomainTreeSnapshot,
): Promise<void> {
  const restored = await inventoryDomainLayout(
    vaultTools,
    snapshot.root,
    undefined,
    snapshot.byteLimit,
    snapshot.fileByteLimit,
  );
  if (
    !restored.existed
    || !samePaths(restored.folders, snapshot.folders)
    || !samePaths([...restored.files.keys()], [...snapshot.files.keys()])
  ) {
    throw new Error("rollback verification failed: domain tree differs from snapshot");
  }
  for (const [path, expected] of snapshot.files) {
    const buffer = await checkedReadBinary(vaultTools, path);
    if (
      buffer.byteLength > snapshot.fileByteLimit
      || !sameBytes(expected, new Uint8Array(buffer))
    ) {
      throw new Error(`rollback verification failed: bytes differ at ${path}`);
    }
  }
}

function snapshotAtRecoveryPath(
  snapshot: DomainTreeSnapshot,
  recoveryRoot: string,
): DomainTreeSnapshot {
  const recoverPath = (path: string): string => path === snapshot.root
    ? recoveryRoot
    : `${recoveryRoot}${path.slice(snapshot.root.length)}`;
  return {
    ...snapshot,
    root: recoveryRoot,
    // Re-key paths while retaining the owned snapshot buffers. This adds no
    // second byte snapshot; verification still reads one file at a time.
    files: new Map([...snapshot.files].map(([path, bytes]) => [recoverPath(path), bytes])),
    folders: snapshot.folders.map(recoverPath),
  };
}

async function preserveSnapshotInRecovery(
  vaultTools: VaultTools,
  transaction: string,
  snapshot: DomainTreeSnapshot,
): Promise<string> {
  const recoveryRoot = `${transaction}/recovery`;
  if (await vaultTools.exists(recoveryRoot)) {
    throw new Error(`rollback trust failure: recovery path already exists at ${recoveryRoot}`);
  }

  if (!await vaultTools.exists(transaction)) {
    try {
      await vaultTools.mkdir(transaction);
    } catch (error) {
      throw new Error(
        `rollback recovery mkdir failed at ${recoveryRoot}: ${(error as Error).message}`,
      );
    }
    if (!await vaultTools.exists(transaction)) {
      throw new Error(`rollback recovery parent was not created for ${recoveryRoot}`);
    }
  }
  await requireEmptyDirectory(
    vaultTools,
    transaction,
    undefined,
    "rollback recovery transaction",
  );

  const recoverySnapshot = snapshotAtRecoveryPath(snapshot, recoveryRoot);
  await restoreDomainTree(
    vaultTools,
    recoverySnapshot,
    new Set(recoverySnapshot.files.keys()),
  );
  return recoveryRoot;
}

async function rollbackWipeTransaction(
  vaultTools: VaultTools,
  root: string,
  transaction: string,
  quarantinedRoot: string,
  rootRenameAttempted: boolean,
  snapshot: DomainTreeSnapshot | undefined,
  removed: Set<string>,
): Promise<void> {
  const rootExists = await vaultTools.exists(root);
  const quarantinedExists = await vaultTools.exists(quarantinedRoot);

  if (rootExists && !quarantinedExists && snapshot) {
    // A writer recreated the public root after the quarantined tree was
    // removed. Never merge with or overwrite that new data. Persist the old
    // snapshot in the operation-owned transaction namespace before reporting
    // the trust failure, even when final transaction teardown already ran.
    const recoveryRoot = await preserveSnapshotInRecovery(
      vaultTools,
      transaction,
      snapshot,
    );
    throw new Error(
      `rollback trust failure: original root unexpectedly exists; old snapshot preserved at recovery path ${recoveryRoot}`,
    );
  }
  if (!rootRenameAttempted || (rootExists && !quarantinedExists)) {
    if (await vaultTools.exists(transaction)) {
      const listed = await vaultTools.adapter.list(transaction);
      if (listed.files.length === 0 && listed.folders.length === 0) {
        await rmdirEmptyDirectory(vaultTools, transaction, undefined, "rollback transaction");
      }
    }
    return;
  }
  if (!quarantinedExists && snapshot && !rootExists) {
    await restoreDomainTree(vaultTools, snapshot, removed);
  } else if (!quarantinedExists) {
    throw new Error(`rollback trust failure: quarantined domain missing at ${quarantinedRoot}`);
  }

  if (snapshot) {
    await restoreDomainTree(vaultTools, snapshot, removed);
  }

  if (await vaultTools.exists(root)) {
    throw new Error(
      `rollback trust failure: original root unexpectedly exists; preserved with transaction ${transaction}`,
    );
  }
  if (!await vaultTools.exists(quarantinedRoot)) {
    throw new Error(`rollback trust failure: quarantined domain missing at ${quarantinedRoot}`);
  }

  await requireDirectEntries(
    vaultTools,
    transaction,
    [],
    [quarantinedRoot],
    undefined,
    "rollback transaction",
  );
  await vaultTools.rename(quarantinedRoot, root);
  const rootRestored = await vaultTools.exists(root);
  const quarantineRemoved = !await vaultTools.exists(quarantinedRoot);
  if (!rootRestored || !quarantineRemoved) {
    throw new Error(
      `rollback verification failed after quarantine rename: root=${rootRestored} quarantineAbsent=${quarantineRemoved}`,
    );
  }
  await removeKnownEmptyDirectory(vaultTools, transaction, undefined, "rollback transaction");
}

async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const legacyIndex  = `${wikiRoot}/_index.md`;
  const legacyLog    = `${wikiRoot}/_log.md`;

  try { await vaultTools.mkdir(wikiRoot); } catch { /* already exists */ }
  // NB: do NOT create GLOBAL_CONFIG_DIR (!Wiki/_config) — it is a legacy artifact
  // (JSONL layout keeps config per-domain). Creating it here re-spawned the empty
  // dir that removeEmptyConfigDirs cleans on load. See storage-layout-sidecar-fix.

  try {
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем */ }
}
