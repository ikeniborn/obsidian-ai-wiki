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

function assertAudit(summary: AuditBoundedInitReplaySummary): void {
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
  const summary: AuditBoundedInitReplaySummary = {
    ...auditSession(selected.records, selected.session, options.expectedSources),
    ...auditIndex(await readFile(indexPath, "utf8"), indexPath),
  };
  assertAudit(summary);
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
