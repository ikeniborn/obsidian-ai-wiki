#!/usr/bin/env node
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonl } from "../src/jsonl";
import { classifyContextError } from "../src/prompt-budget";
import {
  chunkRecordId,
  isChunkIndexRecord,
  isPageIndexRecord,
  pageRecordId,
  parseWikiIndexJsonl,
} from "../src/wiki-index-jsonl";

interface AgentLogRecord {
  ts?: unknown;
  session?: unknown;
  op?: unknown;
  domainId?: unknown;
  event?: unknown;
}

export interface AuditBoundedInitReplayOptions {
  vault: string;
  session: string;
  expectedSources: number;
}

export interface AuditBoundedInitReplaySummary {
  session: string;
  expectedSources: number;
  successfulSources: number;
  contextErrors: number;
  promptBudgetEvents: number;
  invalidPromptBudgetEvents: number;
  budgetViolations: number;
  failedSourceCompletions: number;
  lifecycleCalls: number;
  invalidLifecycleCalls: number;
  wipeDomainEvents: number;
  stalePreWipeDescendants: number;
  technicalHumanLabelFields: number;
  pageRecords: number;
  chunkRecords: number;
  duplicateRecordIds: number;
  leakedPromptFields: number;
}

const PROMPT_BUDGET_FIELDS = new Set([
  "actualInputTokens",
  "callSite",
  "compressionProfile",
  "configuredInputBudget",
  "contextUnits",
  "effectiveInputBudget",
  "estimatedInputTokens",
  "kind",
  "outputBudget",
  "reductionDepth",
  "retryReason",
  "sourceChunks",
]);

const STRUCTURED_CALL_SITES = new Set([
  "init.bootstrap",
  "init.bootstrap-map",
  "init.delta",
  "lint.patch",
  "lint.fix",
  "lint.batch",
  "lint-chat.fix",
  "lint-chat.patch",
  "query.seeds",
  "query.answer",
  "ingest.entities",
  "ingest.evidence-map",
  "ingest.evidence-reduce",
  "ingest.pages",
  "ingest.synthesize",
  "ingest.merge",
  "ingest.classify",
  "format.output",
  "format.segment",
  "vision.analysis",
]);

const COMPRESSION_PROFILES = new Set(["maximum", "balanced", "minimum"]);
const RETRY_REASONS = new Set([
  "preflight_budget_exceeded",
  "provider_context_error",
]);
const ORDERED_LIFECYCLE_PHASES = [
  "preparing",
  "sent",
  "waiting",
  "producing",
  "validating",
  "applying",
] as const;
const TERMINAL_LIFECYCLE_PHASES = new Set([
  "completed",
  "retrying",
  "failed",
  "cancelled",
]);
const LIFECYCLE_ACTIONS = new Set([
  "bootstrap_domain",
  "extract_source_facts",
  "reduce_source_evidence",
  "synthesize_wiki_pages",
  "select_relevant_pages",
  "answer_question",
  "check_wiki_quality",
  "apply_lint_fixes",
  "format_note",
  "analyze_attachments",
]);
const HUMAN_LABEL_FIELDS = new Set([
  "actionLabel",
  "humanLabel",
  "label",
  "phaseLabel",
  "stateLabel",
]);
const TECHNICAL_LABEL_MARKER =
  /\b(?:call[\s_-]*site|transport|attempt|(?:configured|effective|input|output|thinking)[\s_-]*budget|provider|stream|non-stream|claude)\b/i;
const DEFAULT_IDLE_DEADLINE_MS = 300_000;

interface WipeAudit {
  count: number;
  atMs: number;
  folder: string;
}

interface LifecycleAudit {
  calls: number;
  invalidCalls: number;
  technicalHumanLabelFields: number;
  failures: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function existingFile(candidate: string, vaultRoot: string): Promise<string | null> {
  try {
    const resolved = await realpath(candidate);
    if (!inside(vaultRoot, resolved) || !(await stat(resolved)).isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function locateAgentLog(vaultRoot: string): Promise<string> {
  const pluginsRoot = path.join(vaultRoot, ".obsidian", "plugins");
  const preferred = await existingFile(path.join(pluginsRoot, "ai-wiki", "agent.jsonl"), vaultRoot);
  if (preferred) return preferred;

  let entries;
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true });
  } catch {
    throw new Error("agent.jsonl candidates: 0");
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = await existingFile(path.join(pluginsRoot, entry.name, "agent.jsonl"), vaultRoot);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length !== 1) {
    throw new Error(`agent.jsonl candidates: ${candidates.length}`);
  }
  return candidates[0];
}

function selectSession(records: AgentLogRecord[], requested: string): {
  session: string;
  records: AgentLogRecord[];
} {
  const initRecords = records.filter((record) =>
    record.op === "init" && typeof record.session === "string");
  const session = requested === "latest-init"
    ? initRecords.at(-1)?.session
    : requested;
  if (typeof session !== "string" || session.length === 0) {
    throw new Error("selected Init sessions: 0");
  }
  const selected = initRecords.filter((record) => record.session === session);
  if (selected.length === 0) {
    throw new Error("selected Init sessions: 0");
  }
  return { session, records: selected };
}

function safeWikiFolder(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    throw new Error("unsafe wiki_folder");
  }
  const withoutPrefix = value.startsWith("!Wiki/") ? value.slice("!Wiki/".length) : value;
  if (
    !withoutPrefix
    || path.isAbsolute(withoutPrefix)
    || withoutPrefix === "."
    || withoutPrefix === ".."
    || withoutPrefix.includes("/")
  ) {
    throw new Error("unsafe wiki_folder");
  }
  return `!Wiki/${withoutPrefix}`;
}

function parseRecordTime(value: unknown, context: string): number {
  if (typeof value !== "string") throw new Error(`${context} timestamp is missing`);
  const atMs = Date.parse(value);
  if (!Number.isFinite(atMs)) throw new Error(`${context} timestamp is invalid`);
  return atMs;
}

function auditWipe(records: AgentLogRecord[], expectedFolder: string): WipeAudit {
  const wipes = records.filter((record) =>
    isRecord(record.event)
    && record.event.kind === "tool_use"
    && record.event.name === "WipeDomain");
  if (wipes.length !== 1) {
    return { count: wipes.length, atMs: Number.NaN, folder: "" };
  }
  const wipe = wipes[0];
  if (!isRecord(wipe.event) || !isRecord(wipe.event.input)) {
    throw new Error("WipeDomain input is invalid");
  }
  const folder = safeWikiFolder(wipe.event.input.folder);
  if (folder !== expectedFolder) {
    throw new Error(`WipeDomain folder: ${folder}, expected: ${expectedFolder}`);
  }
  return {
    count: 1,
    atMs: parseRecordTime(wipe.ts, "WipeDomain"),
    folder,
  };
}

function auditLifecycles(
  records: AgentLogRecord[],
  idleDeadlineMs: number,
): LifecycleAudit {
  const calls = new Map<string, Record<string, unknown>[]>();
  const failures: string[] = [];
  let technicalHumanLabelFields = 0;

  for (const record of records) {
    if (!isRecord(record.event) || record.event.kind !== "llm_lifecycle") continue;
    const event = record.event;
    const id = typeof event.id === "string" && event.id.length > 0
      ? event.id
      : "<missing-id>";
    const events = calls.get(id) ?? [];
    events.push(event);
    calls.set(id, events);
    for (const [field, value] of Object.entries(event)) {
      if (
        HUMAN_LABEL_FIELDS.has(field)
        && typeof value === "string"
        && TECHNICAL_LABEL_MARKER.test(value)
      ) {
        technicalHumanLabelFields++;
        failures.push(`lifecycle ${id} technical human label ${field}`);
      }
    }
  }

  for (const [id, events] of calls) {
    let expectedIndex = 0;
    let terminalSeen = false;
    let waitingAtMs: number | undefined;
    let previousAtMs = Number.NEGATIVE_INFINITY;
    let action: string | undefined;

    for (const event of events) {
      const phase = event.phase;
      const atMs = event.atMs;
      if (typeof event.action !== "string" || !LIFECYCLE_ACTIONS.has(event.action)) {
        failures.push(`lifecycle ${id} has invalid action`);
      } else if (action === undefined) {
        action = event.action;
      } else if (event.action !== action) {
        failures.push(`lifecycle ${id} changed action`);
      }
      if (typeof atMs !== "number" || !Number.isFinite(atMs)) {
        failures.push(`lifecycle ${id} has invalid atMs`);
        continue;
      }
      if (atMs < previousAtMs) {
        failures.push(`lifecycle ${id} has decreasing atMs`);
      }
      previousAtMs = atMs;

      if (typeof phase !== "string") {
        failures.push(`lifecycle ${id} has invalid phase`);
        continue;
      }
      if (TERMINAL_LIFECYCLE_PHASES.has(phase)) {
        if (terminalSeen) failures.push(`lifecycle ${id} has multiple terminal phases`);
        terminalSeen = true;
        if (phase === "completed" && expectedIndex !== ORDERED_LIFECYCLE_PHASES.length) {
          failures.push(`lifecycle ${id} completed before full ordered lifecycle`);
        }
        continue;
      }
      if (terminalSeen) {
        failures.push(`lifecycle ${id} continues after terminal phase`);
        continue;
      }
      const expected = ORDERED_LIFECYCLE_PHASES[expectedIndex];
      if (phase !== expected) {
        failures.push(`lifecycle ${id} expected ${expected ?? "terminal"}, got ${phase}`);
        const actualIndex = ORDERED_LIFECYCLE_PHASES.indexOf(
          phase as (typeof ORDERED_LIFECYCLE_PHASES)[number],
        );
        if (actualIndex >= expectedIndex) expectedIndex = actualIndex + 1;
      } else {
        expectedIndex++;
      }
      if (phase === "waiting") waitingAtMs = atMs;
      if (
        waitingAtMs !== undefined
        && phase !== "waiting"
        && idleDeadlineMs > 0
      ) {
        const elapsedMs = atMs - waitingAtMs;
        if (elapsedMs > idleDeadlineMs) {
          failures.push(
            `lifecycle ${id} exceeds idle deadline: ${elapsedMs}ms > ${idleDeadlineMs}ms`,
          );
        }
      }
    }

    if (!events.some((event) => event.phase === "waiting")) {
      failures.push(`lifecycle ${id} missing waiting`);
    }
    if (!terminalSeen) failures.push(`lifecycle ${id} missing terminal`);
  }

  return {
    calls: calls.size,
    invalidCalls: new Set(
      failures.flatMap((failure) => {
        const match = /^lifecycle ([^ ]+)/.exec(failure);
        return match ? [match[1]] : [];
      }),
    ).size,
    technicalHumanLabelFields,
    failures,
  };
}

function domainCreatedFolders(records: AgentLogRecord[]): Set<string> {
  const folders = new Set<string>();
  for (const record of records) {
    if (!isRecord(record.event) || record.event.kind !== "domain_created") continue;
    if (!isRecord(record.event.entry)) throw new Error("unsafe wiki_folder");
    folders.add(safeWikiFolder(record.event.entry.wiki_folder));
  }
  return folders;
}

function fallbackFolderHints(records: AgentLogRecord[]): Set<string> {
  const patchFolders = new Set<string>();
  const domainIds = new Set<string>();
  for (const record of records) {
    if (typeof record.domainId === "string") domainIds.add(safeWikiFolder(record.domainId));
    if (!isRecord(record.event)) continue;
    if (typeof record.event.domainId === "string") {
      domainIds.add(safeWikiFolder(record.event.domainId));
    }
    if (
      record.event.kind === "domain_updated"
      && isRecord(record.event.patch)
      && record.event.patch.wiki_folder !== undefined
    ) {
      patchFolders.add(safeWikiFolder(record.event.patch.wiki_folder));
    }
  }
  return patchFolders.size > 0 ? patchFolders : domainIds;
}

async function scanIndexFiles(vaultRoot: string): Promise<string[]> {
  const wikiRoot = path.join(vaultRoot, "!Wiki");
  let entries;
  try {
    entries = await readdir(wikiRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = await existingFile(path.join(wikiRoot, entry.name, "index.jsonl"), vaultRoot);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

async function locateDomainIndex(
  vaultRoot: string,
  selectedRecords: AgentLogRecord[],
): Promise<string> {
  const createdFolders = domainCreatedFolders(selectedRecords);
  const folderHints = createdFolders.size > 0
    ? createdFolders
    : fallbackFolderHints(selectedRecords);
  const hinted: string[] = [];
  for (const hint of folderHints) {
    const candidate = await existingFile(path.join(vaultRoot, ...hint.split("/"), "index.jsonl"), vaultRoot);
    if (candidate && !hinted.includes(candidate)) hinted.push(candidate);
  }
  if (hinted.length === 1) return hinted[0];
  if (hinted.length > 1) throw new Error(`selected domain index.jsonl candidates: ${hinted.length}`);
  if (folderHints.size > 0) throw new Error("selected domain index.jsonl candidates: 0");

  const scanned = await scanIndexFiles(vaultRoot);
  if (scanned.length !== 1) {
    throw new Error(`selected domain index.jsonl candidates: ${scanned.length}`);
  }
  return scanned[0];
}

async function readIdleDeadlineMs(agentPath: string): Promise<number> {
  const settingsPath = path.join(path.dirname(agentPath), "data.json");
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (
      isRecord(settings)
      && typeof settings.llmIdleTimeoutSec === "number"
      && Number.isFinite(settings.llmIdleTimeoutSec)
      && settings.llmIdleTimeoutSec >= 0
    ) {
      return settings.llmIdleTimeoutSec * 1000;
    }
  } catch {
    // Missing or malformed settings use the runtime default.
  }
  return DEFAULT_IDLE_DEADLINE_MS;
}

async function stalePreWipeDescendants(
  domainRoot: string,
  wipeAtMs: number,
): Promise<string[]> {
  const stale: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(domainRoot, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw new Error(`unsafe domain symlink: ${relative}`);
      }
      const info = await stat(absolute);
      if (info.mtimeMs < wipeAtMs) {
        stale.push(entry.isDirectory() ? `${relative}/` : relative);
      }
      if (entry.isDirectory()) await visit(absolute);
    }
  }
  await visit(domainRoot);
  return stale.sort();
}

function eventContainsContextError(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return classifyContextError({ message: value }) !== null;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (classifyContextError(value) !== null) return true;
  if (Array.isArray(value)) return value.some((item) => eventContainsContextError(item, seen));
  return Object.values(value).some((item) => eventContainsContextError(item, seen));
}

function finiteNonnegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNonnegativeInteger(value: unknown): boolean {
  return finiteNonnegative(value) && Number.isInteger(value);
}

function validPromptBudgetEvent(event: Record<string, unknown>): boolean {
  if (event.kind !== "prompt_budget") return false;
  if (Object.keys(event).some((field) => !PROMPT_BUDGET_FIELDS.has(field))) return false;
  for (const field of [
    "callSite",
    "configuredInputBudget",
    "effectiveInputBudget",
    "estimatedInputTokens",
    "compressionProfile",
    "contextUnits",
  ]) {
    if (!Object.hasOwn(event, field)) return false;
  }
  if (typeof event.callSite !== "string" || !STRUCTURED_CALL_SITES.has(event.callSite)) return false;
  if (!finiteNonnegative(event.configuredInputBudget)) return false;
  if (!finiteNonnegative(event.effectiveInputBudget)) return false;
  if (!finiteNonnegative(event.estimatedInputTokens)) return false;
  if (
    typeof event.compressionProfile !== "string"
    || !COMPRESSION_PROFILES.has(event.compressionProfile)
  ) return false;
  if (!finiteNonnegativeInteger(event.contextUnits)) return false;
  if (event.actualInputTokens !== undefined && !finiteNonnegative(event.actualInputTokens)) {
    return false;
  }
  if (event.outputBudget !== undefined && !finiteNonnegative(event.outputBudget)) return false;
  if (event.sourceChunks !== undefined && !finiteNonnegativeInteger(event.sourceChunks)) {
    return false;
  }
  if (event.reductionDepth !== undefined && !finiteNonnegativeInteger(event.reductionDepth)) {
    return false;
  }
  if (
    event.retryReason !== undefined
    && (
      typeof event.retryReason !== "string"
      || !RETRY_REASONS.has(event.retryReason)
    )
  ) return false;
  return true;
}

function auditSession(
  records: AgentLogRecord[],
  session: string,
  expectedSources: number,
  lifecycle: LifecycleAudit,
  wipe: WipeAudit,
  staleDescendants: string[],
): Omit<AuditBoundedInitReplaySummary, "pageRecords" | "chunkRecords" | "duplicateRecordIds"> {
  const successfulSources = new Set<string>();
  const failedSources = new Set<string>();
  const failedSourceCompletions = new Set<string>();
  let currentSource: string | undefined;
  let contextErrors = 0;
  let promptBudgetEvents = 0;
  let invalidPromptBudgetEvents = 0;
  let budgetViolations = 0;
  let leakedPromptFields = 0;

  for (const record of records) {
    const event = record.event;
    if (!isRecord(event)) continue;
    if (eventContainsContextError(event)) contextErrors++;

    if (event.kind === "file_start" && typeof event.file === "string") {
      currentSource = event.file;
    } else if (event.kind === "error" && currentSource) {
      failedSources.add(currentSource);
    } else if (event.kind === "file_done" && typeof event.file === "string") {
      successfulSources.add(event.file);
      if (failedSources.has(event.file)) failedSourceCompletions.add(event.file);
      if (currentSource === event.file) currentSource = undefined;
    }

    if (
      event.kind === "domain_updated"
      && currentSource
      && failedSources.has(currentSource)
      && isRecord(event.patch)
      && isRecord(event.patch.analyzed_sources)
      && Object.hasOwn(event.patch.analyzed_sources, currentSource)
    ) {
      failedSourceCompletions.add(currentSource);
    }

    if (event.kind !== "prompt_budget") continue;
    promptBudgetEvents++;
    const unknownFields = Object.keys(event)
      .filter((field) => !PROMPT_BUDGET_FIELDS.has(field))
      .length;
    leakedPromptFields += unknownFields;
    if (!validPromptBudgetEvent(event)) invalidPromptBudgetEvents++;
    const estimated = event.estimatedInputTokens;
    const effective = event.effectiveInputBudget;
    if (
      typeof estimated !== "number"
      || !Number.isFinite(estimated)
      || typeof effective !== "number"
      || !Number.isFinite(effective)
      || estimated > effective
    ) {
      budgetViolations++;
    }
  }

  return {
    session,
    expectedSources,
    successfulSources: successfulSources.size,
    contextErrors,
    promptBudgetEvents,
    invalidPromptBudgetEvents,
    budgetViolations,
    failedSourceCompletions: failedSourceCompletions.size,
    lifecycleCalls: lifecycle.calls,
    invalidLifecycleCalls: lifecycle.invalidCalls,
    wipeDomainEvents: wipe.count,
    stalePreWipeDescendants: staleDescendants.length,
    technicalHumanLabelFields: lifecycle.technicalHumanLabelFields,
    leakedPromptFields,
  };
}

function auditIndex(text: string, indexPath: string): {
  pageRecords: number;
  chunkRecords: number;
  duplicateRecordIds: number;
} {
  const records = parseWikiIndexJsonl(text, indexPath);
  const ids = new Set<string>();
  let pageRecords = 0;
  let chunkRecords = 0;
  let duplicateRecordIds = 0;
  for (const record of records) {
    let id: string | undefined;
    if (isPageIndexRecord(record)) {
      pageRecords++;
      id = pageRecordId(record);
    } else if (isChunkIndexRecord(record)) {
      chunkRecords++;
      id = chunkRecordId(record);
    }
    if (!id) continue;
    if (ids.has(id)) duplicateRecordIds++;
    else ids.add(id);
  }
  return { pageRecords, chunkRecords, duplicateRecordIds };
}

function assertAudit(
  summary: AuditBoundedInitReplaySummary,
  lifecycleFailures: string[],
  staleDescendants: string[],
): void {
  const failures: string[] = [];
  if (summary.successfulSources !== summary.expectedSources) {
    failures.push(
      `successful sources: ${summary.successfulSources}, expected: ${summary.expectedSources}`,
    );
  }
  if (summary.contextErrors > 0) failures.push(`context errors: ${summary.contextErrors}`);
  if (summary.successfulSources > 0 && summary.promptBudgetEvents === 0) {
    failures.push("prompt_budget events: 0");
  }
  if (summary.invalidPromptBudgetEvents > 0) {
    failures.push(`invalid prompt_budget events: ${summary.invalidPromptBudgetEvents}`);
  }
  if (summary.budgetViolations > 0) failures.push(`budget violations: ${summary.budgetViolations}`);
  if (summary.failedSourceCompletions > 0) {
    failures.push(`failed source completions: ${summary.failedSourceCompletions}`);
  }
  if (summary.lifecycleCalls !== summary.promptBudgetEvents) {
    failures.push(
      `model lifecycle calls: ${summary.lifecycleCalls}, prompt_budget events: ${summary.promptBudgetEvents}`,
    );
  }
  failures.push(...lifecycleFailures);
  if (summary.wipeDomainEvents !== 1) {
    failures.push(`WipeDomain events: ${summary.wipeDomainEvents}, expected: 1`);
  }
  if (summary.stalePreWipeDescendants > 0) {
    failures.push(
      `stale pre-wipe descendants: ${summary.stalePreWipeDescendants} (${staleDescendants.join(", ")})`,
    );
  }
  if (summary.technicalHumanLabelFields > 0) {
    const fields = lifecycleFailures
      .filter((failure) => failure.includes("technical human label"))
      .map((failure) => failure.split(" ").at(-1))
      .filter((field): field is string => field !== undefined);
    failures.push(
      `technical lifecycle fields in human labels: ${summary.technicalHumanLabelFields} (${fields.join(", ")})`,
    );
  }
  if (summary.duplicateRecordIds > 0) {
    failures.push(`duplicate record ids: ${summary.duplicateRecordIds}`);
  }
  if (summary.leakedPromptFields > 0) {
    failures.push(`leaked prompt fields: ${summary.leakedPromptFields}`);
  }
  if (failures.length > 0) throw new Error(`Replay audit failed: ${failures.join("; ")}`);
}

export async function auditBoundedInitReplay(
  options: AuditBoundedInitReplayOptions,
): Promise<AuditBoundedInitReplaySummary> {
  if (!Number.isInteger(options.expectedSources) || options.expectedSources < 0) {
    throw new Error("expected sources must be a non-negative integer");
  }
  const vaultRoot = await realpath(options.vault);
  if (!(await stat(vaultRoot)).isDirectory()) throw new Error("vault is not a directory");

  const agentPath = await locateAgentLog(vaultRoot);
  const agentRecords = parseJsonl<AgentLogRecord>(
    await readFile(agentPath, "utf8"),
    agentPath,
  );
  const selected = selectSession(agentRecords, options.session);
  const indexPath = await locateDomainIndex(vaultRoot, selected.records);
  const expectedFolder = path.relative(vaultRoot, path.dirname(indexPath)).split(path.sep).join("/");
  const wipe = auditWipe(selected.records, expectedFolder);
  const lifecycle = auditLifecycles(
    selected.records,
    await readIdleDeadlineMs(agentPath),
  );
  const staleDescendants = wipe.count === 1
    ? await stalePreWipeDescendants(path.dirname(indexPath), wipe.atMs)
    : [];
  const summary: AuditBoundedInitReplaySummary = {
    ...auditSession(
      selected.records,
      selected.session,
      options.expectedSources,
      lifecycle,
      wipe,
      staleDescendants,
    ),
    ...auditIndex(await readFile(indexPath, "utf8"), indexPath),
  };
  assertAudit(summary, lifecycle.failures, staleDescendants);
  return summary;
}

function argumentValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<void> {
  const vault = argumentValue(args, "--vault");
  const session = argumentValue(args, "--session");
  const expectedSourcesText = argumentValue(args, "--expected-sources");
  const expectedSources = expectedSourcesText === undefined
    ? Number.NaN
    : Number(expectedSourcesText);
  if (!vault || !session || !Number.isInteger(expectedSources) || expectedSources < 0) {
    throw new Error(
      "Usage: tsx scripts/audit-bounded-init-replay.ts --vault <copied-vault> --session <id|latest-init> --expected-sources <count>",
    );
  }
  const summary = await auditBoundedInitReplay({ vault, session, expectedSources });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[audit-bounded-init-replay] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
