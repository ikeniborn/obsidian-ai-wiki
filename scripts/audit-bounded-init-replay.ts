#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsonlParseError } from "../src/jsonl";
import { contentHash } from "../src/content-hash";
import { classifyContextError } from "../src/prompt-budget";
import {
  chunkRecordId,
  isChunkIndexRecord,
  isPageIndexRecord,
  pageRecordId,
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
  idleTimeoutMs?: number;
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
  wipeCompleteEvents: number;
  stalePreWipeDescendants: number;
  systemFinishEvents: number;
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
  "requestId",
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
const ATTEMPT_LABEL_MARKER = /\b(?:attempt|retry)\s*(?:#|no\.?|number|:|=)?\s*\d+\b/i;
const PROVIDER_LABEL_MARKER =
  /\b(?:anthropic|azure\s+openai|gemini|groq|litellm|ollama|openai|openrouter|xai)\b/i;
const MAX_JSONL_LINE_BYTES = 1_048_576;

interface WipeAudit {
  count: number;
  completeCount: number;
  folder: string;
  removedPaths: string[];
  removedFileHashes: Record<string, string>;
}

interface LifecycleAudit {
  calls: number;
  invalidCalls: number;
  technicalHumanLabelFields: number;
  failures: string[];
}

interface LifecycleDescriptor {
  id: string;
  callSite: string;
  transport?: string;
  attempt?: number;
}

interface SessionAudit {
  finishCount: number;
  finishStatus?: string;
  errorEvents: number;
  idleTimeoutMs: number;
  failures: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function* jsonlRecords<T>(filePath: string): AsyncGenerator<T> {
  let pending = Buffer.alloc(0);
  let line = 0;
  for await (const chunk of createReadStream(filePath)) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    let newline = pending.indexOf(0x0a);
    while (newline >= 0) {
      line++;
      const raw = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (raw.byteLength > MAX_JSONL_LINE_BYTES) {
        throw new JsonlParseError(
          filePath,
          line,
          new Error(`line exceeds ${MAX_JSONL_LINE_BYTES} bytes`),
        );
      }
      const text = raw.toString("utf8").replace(/\r$/, "").trim();
      if (text) {
        try {
          yield JSON.parse(text) as T;
        } catch (error) {
          throw new JsonlParseError(filePath, line, error);
        }
      }
      newline = pending.indexOf(0x0a);
    }
    if (pending.byteLength > MAX_JSONL_LINE_BYTES) {
      throw new JsonlParseError(
        filePath,
        line + 1,
        new Error(`line exceeds ${MAX_JSONL_LINE_BYTES} bytes`),
      );
    }
  }
  if (pending.byteLength > 0) {
    line++;
    const text = pending.toString("utf8").replace(/\r$/, "").trim();
    if (text) {
      try {
        yield JSON.parse(text) as T;
      } catch (error) {
        throw new JsonlParseError(filePath, line, error);
      }
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsStandalone(value: string, technical: string): boolean {
  return new RegExp(
    `(?:^|[^A-Za-z0-9_.-])${escapeRegExp(technical)}(?:$|[^A-Za-z0-9_.-])`,
    "i",
  ).test(value);
}

function humanLabelContainsTechnical(
  event: Record<string, unknown>,
  value: string,
  budgetValues: ReadonlySet<string>,
): boolean {
  if (
    TECHNICAL_LABEL_MARKER.test(value)
    || ATTEMPT_LABEL_MARKER.test(value)
    || PROVIDER_LABEL_MARKER.test(value)
  ) return true;
  for (const callSite of STRUCTURED_CALL_SITES) {
    if (containsStandalone(value, callSite)) return true;
  }
  if (isRecord(event.diagnostics)) {
    for (const field of ["transport", "provider"]) {
      const technical = event.diagnostics[field];
      if (
        typeof technical === "string"
        && technical.length > 0
        && containsStandalone(value, technical)
      ) return true;
    }
  }
  for (const technical of budgetValues) {
    if (containsStandalone(value, technical)) return true;
  }
  return false;
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

async function selectSession(agentPath: string, requested: string): Promise<{
  session: string;
  records: AgentLogRecord[];
}> {
  let session: string | undefined = requested;
  if (requested === "latest-init") {
    session = undefined;
    for await (const record of jsonlRecords<AgentLogRecord>(agentPath)) {
      if (
        record.op === "init"
        && typeof record.session === "string"
      ) {
        session = record.session;
      }
    }
  }
  if (typeof session !== "string" || session.length === 0) {
    throw new Error("selected Init sessions: 0");
  }
  const records: AgentLogRecord[] = [];
  for await (const record of jsonlRecords<AgentLogRecord>(agentPath)) {
    if (record.op === "init" && record.session === session) records.push(record);
  }
  if (records.length === 0) {
    throw new Error("selected Init sessions: 0");
  }
  return { session, records };
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

function auditWipe(records: AgentLogRecord[], expectedFolder: string): WipeAudit {
  const wipeIndexes = records.flatMap((record, index) =>
    isRecord(record.event)
    && record.event.kind === "tool_use"
    && record.event.name === "WipeDomain"
      ? [index]
      : []);
  const completeIndexes = records.flatMap((record, index) =>
    isRecord(record.event) && record.event.kind === "wipe_complete"
      ? [index]
      : []);
  const chunkIndexes = records.flatMap((record, index) =>
    isRecord(record.event) && record.event.kind === "wipe_manifest_chunk"
      ? [index]
      : []);
  if (wipeIndexes.length !== 1 || completeIndexes.length !== 1) {
    return {
      count: wipeIndexes.length,
      completeCount: completeIndexes.length,
      folder: "",
      removedPaths: [],
      removedFileHashes: {},
    };
  }
  const wipe = records[wipeIndexes[0]];
  if (!isRecord(wipe.event) || !isRecord(wipe.event.input)) {
    throw new Error("WipeDomain input is invalid");
  }
  const folder = safeWikiFolder(wipe.event.input.folder);
  if (folder !== expectedFolder) {
    throw new Error(`WipeDomain folder: ${folder}, expected: ${expectedFolder}`);
  }
  const complete = records[completeIndexes[0]].event;
  const creationIndex = records.findIndex((record) =>
    isRecord(record.event) && record.event.kind === "domain_created");
  const createdDomainId = creationIndex >= 0
    && isRecord(records[creationIndex].event)
    && isRecord(records[creationIndex].event.entry)
    && typeof records[creationIndex].event.entry.id === "string"
      ? records[creationIndex].event.entry.id
      : undefined;
  if (
    completeIndexes[0] <= wipeIndexes[0]
    || (creationIndex >= 0 && completeIndexes[0] >= creationIndex)
    || !isRecord(complete)
    || typeof complete.domainId !== "string"
    || complete.domainId.length === 0
    || (createdDomainId !== undefined && complete.domainId !== createdDomainId)
    || !finiteNonnegative(complete.atMs)
    || typeof complete.transactionId !== "string"
    || complete.transactionId.length === 0
    || !finiteNonnegativeInteger(complete.chunkCount)
    || !finiteNonnegativeInteger(complete.totalCount)
    || typeof complete.manifestHash !== "string"
    || !/^fnv1a:[0-9a-f]{8}$/.test(complete.manifestHash)
  ) {
    throw new Error("wipe_complete marker is invalid or not paired after WipeDomain");
  }
  const rawChunkIndexes = chunkIndexes.map((recordIndex) => {
    const event = records[recordIndex].event;
    return isRecord(event) && finiteNonnegativeInteger(event.chunkIndex)
      ? event.chunkIndex
      : undefined;
  });
  const duplicateChunkIndex = rawChunkIndexes.find((value, index) =>
    value !== undefined && rawChunkIndexes.indexOf(value) !== index);
  if (duplicateChunkIndex !== undefined) {
    throw new Error(`duplicate wipe manifest chunk index: ${duplicateChunkIndex}`);
  }
  if (chunkIndexes.length !== complete.chunkCount) {
    throw new Error(
      `wipe manifest chunks: ${chunkIndexes.length}, expected: ${complete.chunkCount}`,
    );
  }
  const seenChunkIndexes = new Set<number>();
  const entries: Array<{ path: string; hash?: string }> = [];
  for (const [expectedIndex, recordIndex] of chunkIndexes.entries()) {
    const chunk = records[recordIndex].event;
    if (!isRecord(chunk)) throw new Error(`wipe manifest chunk ${expectedIndex} is invalid`);
    if (
      !finiteNonnegativeInteger(chunk.chunkIndex)
      || !finiteNonnegativeInteger(chunk.chunkCount)
      || typeof chunk.domainId !== "string"
      || typeof chunk.transactionId !== "string"
      || chunk.domainId !== complete.domainId
      || chunk.transactionId !== complete.transactionId
      || chunk.chunkCount !== complete.chunkCount
      || !Array.isArray(chunk.entries)
      || chunk.entries.length > 100
      || typeof chunk.chunkHash !== "string"
    ) {
      throw new Error(`wipe manifest chunk ${expectedIndex} is invalid`);
    }
    if (seenChunkIndexes.has(chunk.chunkIndex)) {
      throw new Error(`duplicate wipe manifest chunk index: ${chunk.chunkIndex}`);
    }
    seenChunkIndexes.add(chunk.chunkIndex);
    if (chunk.chunkIndex !== expectedIndex) {
      throw new Error(`wipe manifest chunk order: ${chunk.chunkIndex}, expected: ${expectedIndex}`);
    }
    if (recordIndex <= wipeIndexes[0] || recordIndex >= completeIndexes[0]) {
      throw new Error(`wipe manifest chunk ${chunk.chunkIndex} is not between wipe and completion`);
    }
    if (Buffer.byteLength(JSON.stringify(chunk), "utf8") > MAX_JSONL_LINE_BYTES) {
      throw new Error(`wipe manifest chunk ${chunk.chunkIndex} exceeds JSONL line limit`);
    }
    if (chunk.chunkHash !== contentHash(JSON.stringify(chunk.entries))) {
      throw new Error(`wipe manifest chunk ${chunk.chunkIndex} hash mismatch`);
    }
    for (const entry of chunk.entries) {
      if (
        !isRecord(entry)
        || typeof entry.path !== "string"
        || (entry.hash !== undefined
          && (typeof entry.hash !== "string" || !/^fnv1a:[0-9a-f]{8}$/.test(entry.hash)))
      ) {
        throw new Error(`wipe manifest chunk ${chunk.chunkIndex} has invalid entry`);
      }
      entries.push(entry as { path: string; hash?: string });
    }
  }
  if (entries.length !== complete.totalCount) {
    throw new Error(`wipe manifest paths: ${entries.length}, expected: ${complete.totalCount}`);
  }
  if (complete.manifestHash !== contentHash(JSON.stringify(entries))) {
    throw new Error("wipe manifest hash mismatch");
  }
  const removedPaths = entries.map((entry) => entry.path);
  if (new Set(removedPaths).size !== removedPaths.length) {
    throw new Error("wipe manifest contains duplicate paths");
  }
  const removedFileHashes = Object.fromEntries(
    entries.flatMap((entry) => entry.hash === undefined ? [] : [[entry.path, entry.hash]]),
  );
  return {
    count: 1,
    completeCount: 1,
    folder,
    removedPaths,
    removedFileHashes,
  };
}

function auditLifecycles(
  records: AgentLogRecord[],
  idleDeadlineMs: number,
): LifecycleAudit {
  const calls = new Map<string, Record<string, unknown>[]>();
  const lifecycleSequence: Record<string, unknown>[] = [];
  const failures: string[] = [];
  let technicalHumanLabelFields = 0;
  const budgetValues = new Set<string>();
  const budgetByRequestId = new Map<string, Record<string, unknown>>();
  const budgetRequestIdCounts = new Map<string, number>();
  let missingRequestIds = 0;
  for (const record of records) {
    if (!isRecord(record.event) || record.event.kind !== "prompt_budget") continue;
    if (typeof record.event.requestId !== "string" || record.event.requestId.length === 0) {
      missingRequestIds++;
    } else {
      const count = (budgetRequestIdCounts.get(record.event.requestId) ?? 0) + 1;
      budgetRequestIdCounts.set(record.event.requestId, count);
      if (count === 1) budgetByRequestId.set(record.event.requestId, record.event);
    }
    for (const field of [
      "configuredInputBudget",
      "effectiveInputBudget",
      "estimatedInputTokens",
      "actualInputTokens",
      "outputBudget",
    ]) {
      const value = record.event[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        budgetValues.add(String(value));
      }
    }
  }

  for (const record of records) {
    if (!isRecord(record.event) || record.event.kind !== "llm_lifecycle") continue;
    const event = record.event;
    const id = typeof event.id === "string" && event.id.length > 0
      ? event.id
      : "<missing-id>";
    const events = calls.get(id) ?? [];
    events.push(event);
    calls.set(id, events);
    lifecycleSequence.push(event);
    for (const [field, value] of Object.entries(event)) {
      if (
        HUMAN_LABEL_FIELDS.has(field)
        && typeof value === "string"
        && humanLabelContainsTechnical(event, value, budgetValues)
      ) {
        technicalHumanLabelFields++;
        failures.push(`lifecycle ${id} technical human label ${field}`);
      }
    }
  }

  const descriptors = new Map<string, LifecycleDescriptor>();
  for (const [id, events] of calls) {
    let expectedIndex = 0;
    let terminalSeen = false;
    let waitingAtMs: number | undefined;
    let responseSeen = false;
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
      if (
        waitingAtMs !== undefined
        && !responseSeen
        && (phase === "producing" || TERMINAL_LIFECYCLE_PHASES.has(phase))
        && idleDeadlineMs > 0
      ) {
        const elapsedMs = atMs - waitingAtMs;
        if (elapsedMs > idleDeadlineMs) {
          failures.push(
            `lifecycle ${id} exceeds idle deadline: ${elapsedMs}ms > ${idleDeadlineMs}ms`,
          );
        }
        responseSeen = true;
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
    }

    if (!events.some((event) => event.phase === "waiting")) {
      failures.push(`lifecycle ${id} missing waiting`);
    }
    if (!terminalSeen) failures.push(`lifecycle ${id} missing terminal`);

    const preparing = events.find((event) => event.phase === "preparing");
    const diagnostics = preparing && isRecord(preparing.diagnostics)
      ? preparing.diagnostics
      : undefined;
    if (!diagnostics) {
      failures.push(`lifecycle ${id} missing preparing diagnostics`);
      continue;
    }
    if (diagnostics.callSite === undefined) {
      failures.push(`lifecycle ${id} missing diagnostics.callSite`);
      continue;
    }
    if (
      typeof diagnostics.callSite !== "string"
      || !STRUCTURED_CALL_SITES.has(diagnostics.callSite)
    ) {
      failures.push(`lifecycle ${id} has invalid diagnostics.callSite`);
      continue;
    }
    const descriptor: LifecycleDescriptor = {
      id,
      callSite: diagnostics.callSite,
    };
    if (diagnostics.transport === undefined) {
      failures.push(`lifecycle ${id} missing diagnostics.transport`);
    } else if (
      typeof diagnostics.transport !== "string"
      || !["stream", "non-stream", "claude"].includes(diagnostics.transport)
    ) {
      failures.push(`lifecycle ${id} has invalid diagnostics.transport`);
    } else {
      descriptor.transport = diagnostics.transport;
    }
    if (diagnostics.attempt === undefined) {
      failures.push(`lifecycle ${id} missing diagnostics.attempt`);
    } else if (!finiteNonnegativeInteger(diagnostics.attempt)) {
      failures.push(`lifecycle ${id} has invalid diagnostics.attempt`);
    } else {
      descriptor.attempt = diagnostics.attempt;
    }
    for (const event of events) {
      if (!isRecord(event.diagnostics)) {
        failures.push(`lifecycle ${id} missing diagnostics on phase ${String(event.phase)}`);
        continue;
      }
      if (event.diagnostics.callSite !== descriptor.callSite) {
        failures.push(`lifecycle ${id} changed diagnostics.callSite`);
      }
      if (
        descriptor.transport !== undefined
        && event.diagnostics.transport !== undefined
        && event.diagnostics.transport !== descriptor.transport
      ) {
        failures.push(`lifecycle ${id} changed diagnostics.transport`);
      }
      if (
        descriptor.attempt !== undefined
        && event.diagnostics.attempt !== descriptor.attempt
      ) {
        failures.push(`lifecycle ${id} changed diagnostics.attempt`);
      }
    }
    descriptors.set(id, descriptor);
  }

  if (missingRequestIds > 0) {
    failures.push(
      `prompt_budget correlation unsupported/inconclusive: ${missingRequestIds} event(s) missing requestId`,
    );
  }
  for (const [requestId, count] of budgetRequestIdCounts) {
    if (count !== 1) failures.push(`prompt_budget requestId ${requestId} appears ${count} times`);
  }
  for (const [requestId, budget] of budgetByRequestId) {
    if (!calls.has(requestId)) {
      failures.push(`prompt_budget requestId ${requestId} has no lifecycle`);
    }
    const descriptor = descriptors.get(requestId);
    if (
      descriptor
      && budget.callSite !== descriptor.callSite
    ) {
      failures.push(
        `prompt_budget requestId ${requestId} callSite ${String(budget.callSite)} does not match lifecycle ${descriptor.callSite}`,
      );
    }
  }
  for (const id of calls.keys()) {
    if (!budgetByRequestId.has(id)) {
      failures.push(`orphan lifecycle ${id} has no prompt_budget`);
    }
  }

  for (const [index, event] of lifecycleSequence.entries()) {
    if (event.phase !== "retrying") continue;
    const next = lifecycleSequence[index + 1];
    const id = typeof event.id === "string" ? event.id : "<missing-id>";
    const nextId = next && typeof next.id === "string" ? next.id : undefined;
    if (!next || next.phase !== "preparing" || !nextId || nextId === id) {
      failures.push(`lifecycle ${id} retrying must open a fresh lifecycle ID`);
      continue;
    }
    const descriptor = descriptors.get(id);
    const nextDescriptor = descriptors.get(nextId);
    if (
      descriptor
      && nextDescriptor
      && descriptor.callSite !== nextDescriptor.callSite
    ) {
      failures.push(
        `lifecycle ${id} retrying changed call family: ${descriptor.callSite} -> ${nextDescriptor.callSite}`,
      );
    }
    if (
      descriptor?.transport !== undefined
      && nextDescriptor?.transport !== undefined
      && descriptor.transport !== nextDescriptor.transport
      && !(descriptor.transport === "stream" && nextDescriptor.transport === "non-stream")
    ) {
      failures.push(
        `lifecycle ${id} retrying changed transport: ${descriptor.transport} -> ${nextDescriptor.transport}`,
      );
    }
    if (
      descriptor?.attempt !== undefined
      && nextDescriptor?.attempt !== undefined
      && nextDescriptor.attempt !== descriptor.attempt + 1
    ) {
      failures.push(
        `lifecycle ${id} retrying has invalid attempt transition: ${descriptor.attempt} -> ${nextDescriptor.attempt}`,
      );
    }
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

function auditSelectedSession(
  records: AgentLogRecord[],
  idleTimeoutOverride?: number,
): SessionAudit {
  const finishes: string[] = [];
  const finishIndexes: number[] = [];
  const configs: number[] = [];
  let startEvents = 0;
  let errorEvents = 0;
  for (const [index, record] of records.entries()) {
    if (!isRecord(record.event)) continue;
    if (record.event.kind === "error") errorEvents++;
    if (
      record.event.kind === "system"
      && typeof record.event.message === "string"
    ) {
      if (/^start op=init(?:\s|$)/.test(record.event.message)) startEvents++;
      const match = /^finish status=([^\s]+)/.exec(record.event.message);
      if (match) {
        finishes.push(match[1]);
        finishIndexes.push(index);
      }
    }
    if (record.event.kind === "run_config") {
      const timeout = record.event.llmIdleTimeoutMs;
      if (finiteNonnegative(timeout)) configs.push(timeout);
      else configs.push(Number.NaN);
    }
  }
  const failures: string[] = [];
  if (startEvents !== 1) {
    failures.push(`system start events: ${startEvents}, expected: 1`);
  }
  if (finishes.length !== 1) {
    failures.push(`system finish events: ${finishes.length}, expected: 1`);
  } else if (!["done", "success"].includes(finishes[0])) {
    failures.push(`system finish status: ${finishes[0]}, expected: done/success`);
  } else if (finishIndexes[0] !== records.length - 1) {
    failures.push("system finish is not terminal");
  }
  if (errorEvents > 0) failures.push(`session error events: ${errorEvents}`);
  if (idleTimeoutOverride === undefined && configs.length !== 1) {
    failures.push(`run_config events: ${configs.length}, expected: 1`);
  }
  const idleTimeoutMs = idleTimeoutOverride ?? configs[0];
  if (!finiteNonnegative(idleTimeoutMs)) {
    failures.push("run_config llmIdleTimeoutMs is missing or invalid");
  }
  return {
    finishCount: finishes.length,
    finishStatus: finishes[0],
    errorEvents,
    idleTimeoutMs: finiteNonnegative(idleTimeoutMs) ? idleTimeoutMs : 0,
    failures,
  };
}

function safeManifestPath(value: string): string {
  const directory = value.endsWith("/");
  const raw = directory ? value.slice(0, -1) : value;
  if (
    !raw
    || raw.includes("\\")
    || path.isAbsolute(raw)
    || raw.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`unsafe wipe manifest path: ${value}`);
  }
  return directory ? `${raw}/` : raw;
}

async function hashFile(filePath: string): Promise<string> {
  let hash = 0x811c9dc5;
  for await (const chunk of createReadStream(filePath)) {
    for (const byte of chunk as Buffer) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

interface StaleManifestFs {
  lstat: typeof lstat;
  readdir: typeof readdir;
  hashFile: (filePath: string) => Promise<string>;
}

export async function findStaleWipeManifestDescendants(
  domainRoot: string,
  entries: Array<{ path: string; hash?: string }>,
  fs: StaleManifestFs = { lstat, readdir, hashFile },
): Promise<string[]> {
  const stale: string[] = [];
  for (const entry of entries) {
    const raw = entry.path;
    const relative = safeManifestPath(raw);
    const directory = relative.endsWith("/");
    const absolute = path.join(
      domainRoot,
      ...(directory ? relative.slice(0, -1) : relative).split("/"),
    );
    let info;
    try {
      info = await fs.lstat(absolute);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`unsafe domain symlink: ${relative}`);
    }
    if (directory) {
      if (info.isDirectory() && (await fs.readdir(absolute)).length === 0) {
        stale.push(relative);
      }
      continue;
    }
    if (!info.isFile()) {
      stale.push(relative);
      continue;
    }
    if (entry.hash === undefined || await fs.hashFile(absolute) === entry.hash) {
      stale.push(relative);
    }
  }
  return stale.sort();
}

async function stalePreWipeDescendants(
  domainRoot: string,
  wipe: WipeAudit,
): Promise<string[]> {
  return findStaleWipeManifestDescendants(
    domainRoot,
    wipe.removedPaths.map((path) => ({
      path,
      ...(wipe.removedFileHashes[path] === undefined
        ? {}
        : { hash: wipe.removedFileHashes[path] }),
    })),
  );
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

function finiteNonnegativeInteger(value: unknown): value is number {
  return finiteNonnegative(value) && Number.isInteger(value);
}

function validPromptBudgetEvent(event: Record<string, unknown>): boolean {
  if (event.kind !== "prompt_budget") return false;
  if (Object.keys(event).some((field) => !PROMPT_BUDGET_FIELDS.has(field))) return false;
  if (
    event.requestId !== undefined
    && (typeof event.requestId !== "string" || event.requestId.length === 0)
  ) return false;
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
  sessionAudit: SessionAudit,
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
    wipeCompleteEvents: wipe.completeCount,
    stalePreWipeDescendants: staleDescendants.length,
    systemFinishEvents: sessionAudit.finishCount,
    technicalHumanLabelFields: lifecycle.technicalHumanLabelFields,
    leakedPromptFields,
  };
}

async function auditIndex(indexPath: string): Promise<{
  pageRecords: number;
  chunkRecords: number;
  duplicateRecordIds: number;
}> {
  const ids = new Set<string>();
  let pageRecords = 0;
  let chunkRecords = 0;
  let duplicateRecordIds = 0;
  for await (const record of jsonlRecords<unknown>(indexPath)) {
    if (
      isRecord(record)
      && record.schemaVersion === 1
      && record.kind === "page"
      && !isPageIndexRecord(record)
    ) {
      throw new Error(`${indexPath}: invalid current page record`);
    }
    if (
      isRecord(record)
      && record.schemaVersion === 1
      && record.kind === "chunk"
      && !isChunkIndexRecord(record)
    ) {
      throw new Error(`${indexPath}: invalid current chunk record`);
    }
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
  sessionFailures: string[],
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
  failures.push(...sessionFailures);
  failures.push(...lifecycleFailures);
  if (summary.wipeDomainEvents !== 1) {
    failures.push(`WipeDomain events: ${summary.wipeDomainEvents}, expected: 1`);
  }
  if (summary.wipeCompleteEvents !== 1) {
    failures.push(`wipe_complete events: ${summary.wipeCompleteEvents}, expected: 1`);
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
  const selected = await selectSession(agentPath, options.session);
  const sessionAudit = auditSelectedSession(
    selected.records,
    options.idleTimeoutMs,
  );
  const indexPath = await locateDomainIndex(vaultRoot, selected.records);
  const expectedFolder = path.relative(vaultRoot, path.dirname(indexPath)).split(path.sep).join("/");
  const wipe = auditWipe(selected.records, expectedFolder);
  const lifecycle = auditLifecycles(
    selected.records,
    sessionAudit.idleTimeoutMs,
  );
  const staleDescendants = wipe.count === 1 && wipe.completeCount === 1
    ? await stalePreWipeDescendants(path.dirname(indexPath), wipe)
    : [];
  const summary: AuditBoundedInitReplaySummary = {
    ...auditSession(
      selected.records,
      selected.session,
      options.expectedSources,
      lifecycle,
      wipe,
      sessionAudit,
      staleDescendants,
    ),
    ...await auditIndex(indexPath),
  };
  assertAudit(
    summary,
    sessionAudit.failures,
    lifecycle.failures,
    staleDescendants,
  );
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
  const idleTimeoutText = argumentValue(args, "--idle-timeout-ms");
  const expectedSources = expectedSourcesText === undefined
    ? Number.NaN
    : Number(expectedSourcesText);
  const idleTimeoutMs = idleTimeoutText === undefined
    ? undefined
    : Number(idleTimeoutText);
  if (!vault || !session || !Number.isInteger(expectedSources) || expectedSources < 0) {
    throw new Error(
      "Usage: tsx scripts/audit-bounded-init-replay.ts --vault <copied-vault> --session <id|latest-init> --expected-sources <count> [--idle-timeout-ms <ms>]",
    );
  }
  if (
    idleTimeoutMs !== undefined
    && (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0)
  ) {
    throw new Error("idle timeout override must be a non-negative number");
  }
  const summary = await auditBoundedInitReplay({
    vault,
    session,
    expectedSources,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[audit-bounded-init-replay] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
