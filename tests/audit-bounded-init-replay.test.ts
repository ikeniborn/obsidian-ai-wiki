import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditBoundedInitReplay } from "../scripts/audit-bounded-init-replay";
import { createPromptBudgetEvent } from "../src/prompt-budget";

interface AgentRecord {
  ts: string;
  session: string;
  op: "init";
  event: Record<string, unknown>;
}

interface Fixture {
  root: string;
  agentPath: string;
  indexPaths: Record<string, string>;
  cleanup: () => Promise<void>;
}

const SESSION = "200";
const SOURCE_MARKER = "SECRET_SOURCE_MARKER";
const IDLE_DEADLINE_MS = 300_000;
const CONNECTION_TIMEOUT_MS = 15_000;
const OLD_MANIFEST_FILE = "obsolete-old.md";
const OLD_MANIFEST_CONTENT = "old domain content";
const WIPE_HASH_ALGORITHM = "sha256-v2";

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalEntries(entries: Array<{ path: string; hash?: string }>): Buffer {
  const parts: Buffer[] = [uint32(entries.length)];
  for (const entry of entries) {
    parts.push(prefixed(entry.path));
    parts.push(entry.hash === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), prefixed(entry.hash)]));
  }
  return Buffer.concat(parts);
}

function uint32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function prefixed(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function manifestRoot(
  chunks: Array<{ chunkIndex: number; chunkCount: number; entries: unknown[]; chunkHash: string }>,
  totalCount: number,
): string {
  let root = sha256(Buffer.concat([
    prefixed("iwiki-wipe-manifest-sha256-v2"),
    uint32(totalCount),
    uint32(chunks.length),
  ]));
  for (const chunk of chunks) {
    root = sha256(Buffer.concat([
      prefixed("iwiki-wipe-manifest-sha256-v2-step"),
      prefixed(root),
      uint32(chunk.chunkIndex),
      uint32(chunk.chunkCount),
      uint32(chunk.entries.length),
      prefixed(chunk.chunkHash),
    ]));
  }
  return root;
}
const SCRIPT_PATH = fileURLToPath(
  new URL("../scripts/audit-bounded-init-replay.ts", import.meta.url),
);

function agentRecord(event: Record<string, unknown>, session = SESSION): AgentRecord {
  return {
    ts: new Date(Number(session)).toISOString(),
    session,
    op: "init",
    event,
  };
}

function promptBudget(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...createPromptBudgetEvent({
      requestId: "call-0",
      callSite: "ingest.evidence-map",
      configuredInputBudget: 16_384,
      effectiveInputBudget: 12_288,
      estimatedInputTokens: 12_000,
      actualInputTokens: 11_900,
      outputBudget: 4096,
      compressionProfile: "balanced",
      contextUnits: 3,
      sourceChunks: 2,
      reductionDepth: 0,
      retryReason: "provider_context_error",
    }),
    ...overrides,
  };
}

function pageRecord(articleId: string): Record<string, unknown> {
  return {
    kind: "page",
    schemaVersion: 1,
    articleId,
    path: `!Wiki/replay-folder/concept/${articleId}.md`,
    type: "concept",
    description: `description-${articleId}`,
    resource: ["source"],
    bodyHash: `body-${articleId}`,
    descriptionHash: `description-${articleId}`,
  };
}

function chunkRecord(articleId: string, ordinal: number): Record<string, unknown> {
  return {
    kind: "chunk",
    schemaVersion: 1,
    articleId,
    path: `!Wiki/replay-folder/concept/${articleId}.md`,
    heading: "## Facts",
    ordinal,
    bodyHash: `body-${articleId}`,
    embedTextHash: `embed-${articleId}-${ordinal}`,
    vector: [0.1, 0.2],
    vectorModel: "fixture",
    dimensions: 2,
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function lifecycleRecords(
  id: string,
  atMs: number,
  session = SESSION,
  options: {
    callSite?: string;
    attempt?: number;
    phases?: string[];
    diagnostics?: Record<string, unknown>;
  } = {},
): AgentRecord[] {
  const diagnostics = {
    callSite: options.callSite ?? "ingest.evidence-map",
    transport: "non-stream",
    attempt: options.attempt ?? 0,
    configuredInputBudget: 16_384,
    effectiveInputBudget: 12_288,
    provider: "fixture-provider",
    ...options.diagnostics,
  };
  return (options.phases ?? [
    "preparing",
    "sent",
    "waiting",
    "producing",
    "validating",
    "applying",
    "completed",
  ]).map((phase, index) => agentRecord({
    kind: "llm_lifecycle",
    id,
    action: "extract_source_facts",
    phase,
    atMs: atMs + index,
    diagnostics,
  }, session));
}

function transportRetryEvent(
  kind: "transport_retry_scheduled" | "transport_retry_recovered" | "transport_retry_exhausted",
  overrides: Record<string, unknown> = {},
): AgentRecord {
  const recovered = kind === "transport_retry_recovered";
  return agentRecord({
    kind,
    logicalRequestId: "call-0",
    lifecycleId: recovered ? "call-0:retry-1" : "call-0",
    callSite: "ingest.evidence-map",
    attempt: recovered ? 1 : 0,
    maxRetries: 1,
    errorClass: "retryable_http",
    status: 502,
    meaningfulOutputSeen: recovered,
    connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: IDLE_DEADLINE_MS,
    ...(kind === "transport_retry_scheduled"
      ? { delayMs: 1, delaySource: "retry-after-ms" }
      : {}),
    ...overrides,
  });
}

function replaceFirstCallWithTransportRetry(
  records: AgentRecord[],
  options: {
    status?: number;
    scheduled?: Record<string, unknown>;
    recovered?: Record<string, unknown>;
  } = {},
): void {
  const firstLifecycle = records.findIndex((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
  const initial = lifecycleRecords("call-0", 1_000, SESSION, {
    phases: ["preparing", "sent", "waiting", "retrying"],
  });
  const replacement = lifecycleRecords("call-0:retry-1", 1_100, SESSION, {
    attempt: 1,
  });
  records.splice(
    firstLifecycle,
    7,
    ...initial,
    transportRetryEvent("transport_retry_scheduled", {
      status: options.status ?? 502,
      ...options.scheduled,
    }),
    ...replacement.slice(0, 4),
    transportRetryEvent("transport_retry_recovered", {
      status: options.status ?? 502,
      ...options.recovered,
    }),
    ...replacement.slice(4),
  );
}

function indexJsonl(
  records: Record<string, unknown>[] = [
    pageRecord("alpha"),
    chunkRecord("alpha", 0),
    chunkRecord("alpha", 1),
    pageRecord("beta"),
  ],
): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function wipeTelemetry(
  domainId: string,
  session: string,
  entries: Array<{ path: string; hash?: string }> = [
    { path: OLD_MANIFEST_FILE, hash: sha256(OLD_MANIFEST_CONTENT) },
    { path: "obsolete-empty/" },
  ],
): AgentRecord[] {
  const transactionId = `wipe-${session}`;
  const chunkCount = entries.length === 0 ? 0 : Math.ceil(entries.length / 100);
  const chunkEvents = Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const chunkEntries = entries.slice(chunkIndex * 100, (chunkIndex + 1) * 100);
    return {
      kind: "wipe_manifest_chunk",
      domainId,
      transactionId,
      chunkIndex,
      chunkCount,
      hashAlgorithm: WIPE_HASH_ALGORITHM,
      entries: chunkEntries,
      chunkHash: sha256(canonicalEntries(chunkEntries)),
    };
  });
  const manifestHash = manifestRoot(chunkEvents, entries.length);
  return [
    ...chunkEvents.map((event) => agentRecord(event, session)),
    agentRecord({
      kind: "wipe_complete",
      domainId,
      transactionId,
      chunkCount,
      totalCount: entries.length,
      hashAlgorithm: WIPE_HASH_ALGORITHM,
      manifestHash,
      atMs: Number(session),
    }, session),
  ];
}

function sessionRecords(options: {
  session?: string;
  domainId?: string;
  wikiFolder?: string;
  sources?: string[];
} = {}): AgentRecord[] {
  const session = options.session ?? SESSION;
  const domainId = options.domainId ?? "domain-id";
  const wikiFolder = options.wikiFolder ?? "replay-folder";
  const sources = options.sources ?? ["sources/a.md", "sources/b.md"];
  const records = [
    agentRecord({ kind: "system", message: "start op=init" }, session),
    agentRecord({
      kind: "run_config",
      llmConnectionTimeoutMs: CONNECTION_TIMEOUT_MS,
      llmIdleTimeoutMs: IDLE_DEADLINE_MS,
    }, session),
    agentRecord({
      kind: "tool_use",
      name: "WipeDomain",
      input: { folder: `!Wiki/${wikiFolder}` },
    }, session),
    agentRecord({ kind: "tool_result", ok: true }, session),
    ...wipeTelemetry(domainId, session),
    agentRecord({
      kind: "domain_created",
      entry: {
        id: domainId,
        name: "Replay",
        wiki_folder: wikiFolder,
        source_paths: ["sources"],
      },
    }, session),
    agentRecord({ kind: "init_start", totalFiles: sources.length }, session),
  ];
  for (const [index, source] of sources.entries()) {
    records.push(
      agentRecord({
        kind: "file_start",
        file: source,
        index,
        total: sources.length,
      }, session),
      agentRecord(promptBudget({
        requestId: `call-${index}`,
        callSite: index === 0 ? "ingest.evidence-map" : "ingest.synthesize",
        retryReason: index === 0 ? "provider_context_error" : undefined,
      }), session),
      ...lifecycleRecords(`call-${index}`, 1_000 + index * 100, session, {
        callSite: index === 0 ? "ingest.evidence-map" : "ingest.synthesize",
      }),
      agentRecord({
        kind: "domain_updated",
        domainId,
        patch: {
          analyzed_sources: Object.fromEntries(
            sources.slice(0, index + 1).map((item) => [item, `hash-${index}`]),
          ),
        },
      }, session),
      agentRecord({ kind: "file_done", file: source }, session),
    );
  }
  records.push(agentRecord({ kind: "system", message: "finish status=done" }, session));
  return records;
}

async function fixture(options: {
  records?: AgentRecord[];
  agentRaw?: string;
  indexes?: Record<string, string>;
} = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "audit bounded init "));
  const pluginDir = path.join(root, ".obsidian", "plugins", "renamed-ai-wiki");
  const agentPath = path.join(pluginDir, "agent.jsonl");
  const indexes = options.indexes ?? {
    "replay-folder": indexJsonl(),
    "domain-id": indexJsonl([pageRecord("wrong-domain")]),
    unrelated: indexJsonl([pageRecord("unrelated")]),
  };
  const indexPaths: Record<string, string> = {};
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    agentPath,
    options.agentRaw
      ?? (options.records ?? sessionRecords())
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    "utf8",
  );
  for (const [folder, raw] of Object.entries(indexes)) {
    const domainDir = path.join(root, "!Wiki", folder);
    await mkdir(domainDir, { recursive: true });
    indexPaths[folder] = path.join(domainDir, "index.jsonl");
    await writeFile(indexPaths[folder], raw, "utf8");
  }
  return {
    root,
    agentPath,
    indexPaths,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function audit(value: Fixture, options: {
  session?: string;
  expectedSources?: number;
  idleTimeoutMs?: number;
} = {}) {
  return auditBoundedInitReplay({
    vault: value.root,
    session: options.session ?? "latest-init",
    expectedSources: options.expectedSources ?? 2,
    ...(options.idleTimeoutMs === undefined
      ? {}
      : { idleTimeoutMs: options.idleTimeoutMs }),
  });
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      const relative = path.relative(root, absolute);
      if (item.isDirectory()) {
        entries[`${relative}/`] = String((await stat(absolute)).mtimeMs);
        await visit(absolute);
      } else {
        const info = await stat(absolute);
        entries[relative] = `${info.mtimeMs}:${(await readFile(absolute)).toString("base64")}`;
      }
    }
  }
  await visit(root);
  return entries;
}

async function runCli(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", SCRIPT_PATH, ...args], {
      cwd: path.dirname(SCRIPT_PATH),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("success uses domain_created wiki_folder when domainId differs and other domains exist", async () => {
  const value = await fixture();
  try {
    const summary = await audit(value);
    assert.deepEqual(summary, {
      session: SESSION,
      expectedSources: 2,
      successfulSources: 2,
      contextErrors: 0,
      promptBudgetEvents: 2,
      invalidPromptBudgetEvents: 0,
      budgetViolations: 0,
      failedSourceCompletions: 0,
      lifecycleCalls: 2,
      invalidLifecycleCalls: 0,
      wipeDomainEvents: 1,
      wipeCompleteEvents: 1,
      stalePreWipeDescendants: 0,
      systemFinishEvents: 1,
      technicalHumanLabelFields: 0,
      transportRetryScheduled: 0,
      transportRetryRecovered: 0,
      transportRetryExhausted: 0,
      invalidTransportRetryEvents: 0,
      duplicateSourceEffects: 0,
      duplicatePageEffects: 0,
      pageRecords: 2,
      chunkRecords: 2,
      duplicateRecordIds: 0,
      leakedPromptFields: 0,
    });
    assert.equal(JSON.stringify(summary).includes("sources/a.md"), false);
    assert.equal(JSON.stringify(summary).includes(SOURCE_MARKER), false);
  } finally {
    await value.cleanup();
  }
});

test("processed sources require at least one prompt_budget event", async () => {
  const records = sessionRecords().filter((record) => record.event.kind !== "prompt_budget");
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /prompt_budget events: 0/i);
  } finally {
    await value.cleanup();
  }
});

test("full lifecycle, one wipe, and diagnostics-only technical fields pass", async () => {
  const sources = Array.from({ length: 22 }, (_, index) => `sources/${index + 1}.md`);
  const value = await fixture({ records: sessionRecords({ sources }) });
  try {
    const before = await snapshot(value.root);
    const summary = await audit(value, { expectedSources: 22 });
    const after = await snapshot(value.root);

    assert.equal(summary.successfulSources, 22);
    assert.equal(summary.lifecycleCalls, 22);
    assert.equal(summary.wipeDomainEvents, 1);
    assert.deepEqual(after, before);
  } finally {
    await value.cleanup();
  }
});

test("selected Init requires exactly one successful system finish", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "missing",
      (records: AgentRecord[]) => records.filter((record) =>
        !(record.event.kind === "system"
          && String(record.event.message).startsWith("finish status="))),
      /system finish events: 0, expected: 1/i,
    ],
    [
      "duplicate",
      (records: AgentRecord[]) => {
        const finish = records.at(-1)!;
        return [...records, structuredClone(finish)];
      },
      /system finish events: 2, expected: 1/i,
    ],
    ...(["error", "cancelled"] as const).map((status) => [
      status,
      (records: AgentRecord[]) => records.map((record) =>
        record.event.kind === "system"
          && String(record.event.message).startsWith("finish status=")
          ? agentRecord({ kind: "system", message: `finish status=${status}` })
          : record),
      new RegExp(`system finish status: ${status}`, "i"),
    ]),
  ] as Array<[
    string,
    (records: AgentRecord[]) => AgentRecord[],
    RegExp,
  ]>) {
    await t.test(name, async () => {
      const value = await fixture({ records: mutate(sessionRecords()) });
      try {
        await assert.rejects(audit(value), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("selected Init rejects any error event despite successful file_done records", async () => {
  const records = sessionRecords();
  records.splice(records.length - 1, 0, agentRecord({
    kind: "error",
    message: "late replay failure",
  }));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /session error events: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("selected Init rejects events recorded after its system finish", async () => {
  const records = sessionRecords();
  records.push(agentRecord({ kind: "info_text", icon: "·", summary: "late event" }));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /system finish is not terminal/i);
  } finally {
    await value.cleanup();
  }
});

test("latest Init selects an incomplete newest session and rejects it", async () => {
  const newest = sessionRecords({ session: "300", sources: ["new.md"] })
    .filter((record) =>
      !(record.event.kind === "system"
        && String(record.event.message).startsWith("finish status=")));
  const value = await fixture({
    records: [
      ...sessionRecords({ session: "100", sources: ["old.md"] }),
      ...newest,
    ],
  });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /system finish events: 0, expected: 1/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("latest Init does not fall back when the newest session is missing start", async () => {
  const newest = sessionRecords({ session: "300", sources: ["new.md"] })
    .filter((record) =>
      !(record.event.kind === "system"
        && String(record.event.message).startsWith("start op=init")));
  const value = await fixture({
    records: [
      ...sessionRecords({ session: "100", sources: ["old.md"] }),
      ...newest,
    ],
  });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /system start events: 0, expected: 1/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("selected session idle timeout is independent from settings changed after replay", async () => {
  const records = sessionRecords();
  const config = records.find((record) => record.event.kind === "run_config")!;
  config.event.llmIdleTimeoutMs = 1_000;
  for (const record of records) {
    if (
      record.event.kind === "llm_lifecycle"
      && record.event.id === "call-0"
      && ["producing", "validating", "applying", "completed"].includes(String(record.event.phase))
    ) {
      record.event.atMs = 3_003;
    }
  }
  const value = await fixture({ records });
  try {
    await writeFile(
      path.join(path.dirname(value.agentPath), "data.json"),
      JSON.stringify({ llmIdleTimeoutSec: 999 }),
      "utf8",
    );
    await assert.rejects(
      audit(value),
      /lifecycle call-0 exceeds idle deadline: 2001ms > 1000ms/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("selected session without run_config is explicitly inconclusive", async () => {
  const records = sessionRecords().filter((record) => record.event.kind !== "run_config");
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /run_config events: 0, expected: 1.*llmIdleTimeoutMs is missing or invalid/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("explicit idle timeout override permits auditing a legacy run_config gap", async () => {
  const records = sessionRecords().filter((record) => record.event.kind !== "run_config");
  const value = await fixture({ records });
  try {
    const summary = await audit(value, { idleTimeoutMs: IDLE_DEADLINE_MS });
    assert.equal(summary.session, SESSION);
  } finally {
    await value.cleanup();
  }
});

test("valid structured retry has one prompt budget per fresh lifecycle ID", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  const firstLifecycle = records.findIndex((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
  records.splice(
    firstLifecycle,
    7,
    ...lifecycleRecords("call-0", 1_000, SESSION, {
      phases: ["preparing", "sent", "waiting", "retrying"],
    }),
    ...lifecycleRecords("call-0:retry-1", 1_100, SESSION, {
      attempt: 1,
    }),
  );
  const firstBudget = records.findIndex((record) => record.event.kind === "prompt_budget");
  records.splice(
    firstBudget + 1,
    0,
    agentRecord(promptBudget({ requestId: "call-0:retry-1" })),
  );
  const value = await fixture({ records });
  try {
    const summary = await audit(value, { expectedSources: 1 });
    assert.equal(summary.lifecycleCalls, 2);
    assert.equal(summary.promptBudgetEvents, 2);
  } finally {
    await value.cleanup();
  }
});

test("valid 502 transport retry uses one logical request and continues after recovery", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  replaceFirstCallWithTransportRetry(records);
  const done = records.findIndex((record) => record.event.kind === "file_done");
  records.splice(done, 0, agentRecord({
    kind: "tool_use",
    name: "Create",
    input: { path: "!Wiki/replay-folder/concept/alpha.md" },
  }));
  const value = await fixture({ records });
  try {
    const summary = await audit(value, { expectedSources: 1 });
    assert.equal(summary.transportRetryScheduled, 1);
    assert.equal(summary.transportRetryRecovered, 1);
    assert.equal(summary.transportRetryExhausted, 0);
    assert.equal(summary.duplicateSourceEffects, 0);
    assert.equal(summary.duplicatePageEffects, 0);
  } finally {
    await value.cleanup();
  }
});

test("transport retry accepts only the approved HTTP status matrix", async (t) => {
  for (const status of [408, 409, 429, 500, 502, 599]) {
    await t.test(String(status), async () => {
      const records = sessionRecords({ sources: ["sources/a.md"] });
      replaceFirstCallWithTransportRetry(records, { status });
      const value = await fixture({ records });
      try {
        const summary = await audit(value, { expectedSources: 1 });
        assert.equal(summary.transportRetryRecovered, 1);
      } finally {
        await value.cleanup();
      }
    });
  }

  await t.test("400 is rejected", async () => {
    const records = sessionRecords({ sources: ["sources/a.md"] });
    replaceFirstCallWithTransportRetry(records, { status: 400 });
    const value = await fixture({ records });
    try {
      await assert.rejects(
        audit(value, { expectedSources: 1 }),
        /transport retry scheduled.*status 400.*not retryable/i,
      );
    } finally {
      await value.cleanup();
    }
  });

  await t.test("provider retry override accepts 400", async () => {
    const records = sessionRecords({ sources: ["sources/a.md"] });
    replaceFirstCallWithTransportRetry(records, {
      status: 400,
      scheduled: { errorClass: "provider_retry" },
      recovered: { errorClass: "provider_retry" },
    });
    const value = await fixture({ records });
    try {
      const summary = await audit(value, { expectedSources: 1 });
      assert.equal(summary.transportRetryRecovered, 1);
    } finally {
      await value.cleanup();
    }
  });

  await t.test("connection retry has no HTTP status", async () => {
    const records = sessionRecords({ sources: ["sources/a.md"] });
    replaceFirstCallWithTransportRetry(records, {
      scheduled: { status: undefined, errorClass: "connection" },
      recovered: { status: undefined, errorClass: "connection" },
    });
    const value = await fixture({ records });
    try {
      const summary = await audit(value, { expectedSources: 1 });
      assert.equal(summary.transportRetryRecovered, 1);
    } finally {
      await value.cleanup();
    }
  });
});

test("retry exhaustion is terminal and cannot be followed by successful effects", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  replaceFirstCallWithTransportRetry(records);
  const replacementStart = records.findIndex((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0:retry-1");
  const replacementEnd = records.findLastIndex((record) =>
    (record.event.kind === "llm_lifecycle" && record.event.id === "call-0:retry-1")
    || record.event.kind === "transport_retry_recovered");
  records.splice(
    replacementStart,
    replacementEnd - replacementStart + 1,
    ...lifecycleRecords("call-0:retry-1", 1_100, SESSION, {
      attempt: 1,
      phases: ["preparing", "sent", "waiting", "failed"],
    }),
    transportRetryEvent("transport_retry_exhausted", {
      lifecycleId: "call-0:retry-1",
      attempt: 1,
      meaningfulOutputSeen: false,
    }),
  );
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /transport retry exhausted.*followed by operation effects/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("transport retry is rejected after meaningful model content", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  replaceFirstCallWithTransportRetry(records, {
    scheduled: { meaningfulOutputSeen: true },
  });
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /transport retry scheduled.*meaningful output/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("transport retry requires ordered attempts, unique lifecycle IDs, and configured bound", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "recovered attempt",
      (records: AgentRecord[]) => {
        const event = records.find((record) => record.event.kind === "transport_retry_recovered")!;
        event.event.attempt = 0;
      },
      /transport retry recovered.*attempt 0.*expected 1/i,
    ],
    [
      "duplicate lifecycle",
      (records: AgentRecord[]) => {
        for (const record of records) {
          if (record.event.kind === "llm_lifecycle" && record.event.id === "call-0:retry-1") {
            record.event.id = "call-0";
          }
        }
        const event = records.find((record) => record.event.kind === "transport_retry_recovered")!;
        event.event.lifecycleId = "call-0";
      },
      /transport retry attempt 1.*fresh lifecycle/i,
    ],
    [
      "bound",
      (records: AgentRecord[]) => {
        const event = records.find((record) => record.event.kind === "transport_retry_recovered")!;
        event.event.maxRetries = 0;
      },
      /transport retry recovered.*attempt 1.*maxRetries 0/i,
    ],
  ] as Array<[string, (records: AgentRecord[]) => void, RegExp]>) {
    await t.test(name, async () => {
      const records = sessionRecords({ sources: ["sources/a.md"] });
      replaceFirstCallWithTransportRetry(records);
      mutate(records);
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value, { expectedSources: 1 }), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("transport retry idle timeout must match selected run configuration", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  replaceFirstCallWithTransportRetry(records, {
    scheduled: { idleTimeoutMs: IDLE_DEADLINE_MS - 1 },
  });
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /transport retry scheduled.*idleTimeoutMs 299999.*run_config 300000/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("transport retry connection timeout must match selected run configuration", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  replaceFirstCallWithTransportRetry(records, {
    scheduled: { connectionTimeoutMs: CONNECTION_TIMEOUT_MS - 1 },
    recovered: { connectionTimeoutMs: CONNECTION_TIMEOUT_MS - 1 },
  });
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value, { expectedSources: 1 }),
      /transport retry scheduled.*connectionTimeoutMs 14999.*run_config 15000/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("selected run configuration requires connection timeout metadata", async () => {
  const records = sessionRecords();
  const config = records.find((record) => record.event.kind === "run_config")!;
  delete config.event.llmConnectionTimeoutMs;
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /run_config llmConnectionTimeoutMs is missing or invalid/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("recovered retry rejects duplicate source and page effects", async (t) => {
  for (const [name, duplicate, expected] of [
    [
      "source",
      (records: AgentRecord[]) => {
        const done = records.find((record) => record.event.kind === "file_done")!;
        records.splice(records.indexOf(done), 0, structuredClone(done));
      },
      /duplicate source effects.*sources\/a\.md/i,
    ],
    [
      "page",
      (records: AgentRecord[]) => {
        const done = records.findIndex((record) => record.event.kind === "file_done");
        const write = agentRecord({
          kind: "tool_use",
          name: "Create",
          input: { path: "!Wiki/replay-folder/concept/alpha.md" },
        });
        records.splice(done, 0, write, structuredClone(write));
      },
      /duplicate page effects.*alpha\.md/i,
    ],
  ] as Array<[string, (records: AgentRecord[]) => void, RegExp]>) {
    await t.test(name, async () => {
      const records = sessionRecords({ sources: ["sources/a.md"] });
      replaceFirstCallWithTransportRetry(records);
      duplicate(records);
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value, { expectedSources: 1 }), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("auditor permits a correlated stream to non-stream fallback with a fresh attempt", async () => {
  const records = sessionRecords({ sources: ["sources/a.md"] });
  const firstLifecycle = records.findIndex((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
  records.splice(
    firstLifecycle,
    7,
    ...lifecycleRecords("call-0", 1_000, SESSION, {
      phases: ["preparing", "sent", "waiting", "retrying"],
      diagnostics: { transport: "stream" },
    }),
    ...lifecycleRecords("call-0:retry-1", 1_100, SESSION, {
      attempt: 1,
      diagnostics: { transport: "non-stream" },
    }),
  );
  const firstBudget = records.findIndex((record) => record.event.kind === "prompt_budget");
  records.splice(
    firstBudget + 1,
    0,
    agentRecord(promptBudget({ requestId: "call-0:retry-1" })),
  );
  const value = await fixture({ records });
  try {
    const summary = await audit(value, { expectedSources: 1 });
    assert.equal(summary.lifecycleCalls, 2);
  } finally {
    await value.cleanup();
  }
});

test("correlation reports a missing lifecycle ID and an orphan lifecycle ID", async () => {
  const records = sessionRecords();
  const secondBudget = records.find((record) =>
    record.event.kind === "prompt_budget" && record.event.requestId === "call-1")!;
  secondBudget.event.requestId = "missing-call";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /prompt_budget requestId missing-call has no lifecycle.*orphan lifecycle call-1 has no prompt_budget/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("legacy prompt budget without requestId is explicitly inconclusive", async () => {
  const records = sessionRecords();
  const budget = records.find((record) => record.event.kind === "prompt_budget")!;
  delete budget.event.requestId;
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /prompt_budget correlation unsupported\/inconclusive.*missing requestId/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("duplicate prompt budget requestId is rejected", async () => {
  const records = sessionRecords();
  const budget = records.find((record) => record.event.kind === "prompt_budget")!;
  records.splice(records.indexOf(budget) + 1, 0, structuredClone(budget));
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /prompt_budget requestId call-0 appears 2 times/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("missing waiting phase fails with the lifecycle ID", async () => {
  const records = sessionRecords().filter((record) =>
    !(record.event.kind === "llm_lifecycle"
      && record.event.id === "call-0"
      && record.event.phase === "waiting"));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /lifecycle call-0.*missing waiting/i);
  } finally {
    await value.cleanup();
  }
});

test("missing terminal phase fails with the lifecycle ID", async () => {
  const records = sessionRecords().filter((record) =>
    !(record.event.kind === "llm_lifecycle"
      && record.event.id === "call-0"
      && record.event.phase === "completed"));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /lifecycle call-0.*missing terminal/i);
  } finally {
    await value.cleanup();
  }
});

test("lifecycle beyond the idle deadline fails with elapsed milliseconds", async () => {
  const records = sessionRecords();
  for (const record of records) {
    if (
      record.event.kind === "llm_lifecycle"
      && record.event.id === "call-0"
      && ["producing", "validating", "applying", "completed"].includes(String(record.event.phase))
    ) {
      record.event.atMs = 1_002 + IDLE_DEADLINE_MS + 1;
    }
  }
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      new RegExp(`lifecycle call-0.*idle deadline.*${IDLE_DEADLINE_MS + 1}ms`, "i"),
    );
  } finally {
    await value.cleanup();
  }
});

test("timely producing stops the idle deadline before late validation and completion", async () => {
  const records = sessionRecords();
  for (const record of records) {
    if (
      record.event.kind === "llm_lifecycle"
      && record.event.id === "call-0"
      && ["validating", "applying", "completed"].includes(String(record.event.phase))
    ) {
      record.event.atMs = 1_003 + IDLE_DEADLINE_MS + 1;
    }
  }
  const value = await fixture({ records });
  try {
    const summary = await audit(value);
    assert.equal(summary.invalidLifecycleCalls, 0);
  } finally {
    await value.cleanup();
  }
});

for (const terminal of ["failed", "retrying"]) {
  test(`delayed ${terminal} terminal phase fails the idle deadline`, async () => {
    const records = sessionRecords({ sources: ["sources/a.md"] });
    const firstLifecycle = records.findIndex((record) =>
      record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
    const replacement = lifecycleRecords("call-0", 1_000, SESSION, {
      phases: ["preparing", "sent", "waiting", terminal],
    });
    replacement.at(-1)!.event.atMs = 1_002 + IDLE_DEADLINE_MS + 1;
    if (terminal === "retrying") {
      replacement.push(
        agentRecord(promptBudget({
          requestId: "call-0:retry-1",
          callSite: "ingest.evidence-map",
        })),
        ...lifecycleRecords("call-0:retry-1", 1_002 + IDLE_DEADLINE_MS + 2, SESSION, {
          attempt: 1,
        }),
      );
    }
    records.splice(firstLifecycle, 7, ...replacement);
    const value = await fixture({ records });
    try {
      await assert.rejects(
        audit(value, { expectedSources: 1 }),
        new RegExp(`lifecycle call-0.*idle deadline.*${IDLE_DEADLINE_MS + 1}ms`, "i"),
      );
    } finally {
      await value.cleanup();
    }
  });
}

test("two WipeDomain events fail with the observed count", async () => {
  const records = sessionRecords();
  const wipe = records.find((record) =>
    record.event.kind === "tool_use" && record.event.name === "WipeDomain")!;
  records.splice(records.indexOf(wipe) + 1, 0, structuredClone(wipe));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /WipeDomain events: 2, expected: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("missing and duplicate wipe_complete markers fail pairing", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "missing",
      (records: AgentRecord[]) => records.filter((record) =>
        record.event.kind !== "wipe_complete"),
      /wipe_complete events: 0, expected: 1/i,
    ],
    [
      "duplicate",
      (records: AgentRecord[]) => {
        const marker = records.find((record) => record.event.kind === "wipe_complete")!;
        const index = records.indexOf(marker);
        return [
          ...records.slice(0, index + 1),
          structuredClone(marker),
          ...records.slice(index + 1),
        ];
      },
      /wipe_complete events: 2, expected: 1/i,
    ],
  ] as Array<[
    string,
    (records: AgentRecord[]) => AgentRecord[],
    RegExp,
  ]>) {
    await t.test(name, async () => {
      const value = await fixture({ records: mutate(sessionRecords()) });
      try {
        await assert.rejects(audit(value), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("chunked wipe manifest accepts thousands of paths within the JSONL line limit", async () => {
  const entries = Array.from({ length: 2_500 }, (_, index) => ({
    path: `obsolete/type-${Math.floor(index / 100)}/page-${index}.md`,
    hash: sha256(`old-${index}`),
  }));
  const records = sessionRecords();
  const telemetry = wipeTelemetry("domain-id", SESSION, entries);
  const firstTelemetry = records.findIndex((record) =>
    record.event.kind === "wipe_manifest_chunk" || record.event.kind === "wipe_complete");
  records.splice(
    firstTelemetry,
    records.filter((record) =>
      record.event.kind === "wipe_manifest_chunk" || record.event.kind === "wipe_complete").length,
    ...telemetry,
  );
  for (const record of telemetry) {
    assert.ok(Buffer.byteLength(JSON.stringify(record), "utf8") <= 1_048_576);
    if (record.event.kind === "wipe_manifest_chunk") {
      assert.ok((record.event.entries as unknown[]).length <= 100);
    } else {
      assert.equal(Object.hasOwn(record.event, "entries"), false);
    }
  }
  const value = await fixture({ records });
  try {
    const summary = await audit(value);
    assert.equal(summary.wipeCompleteEvents, 1);
  } finally {
    await value.cleanup();
  }
});

test("wipe manifest rejects missing, duplicate, reordered, and tampered chunks", async (t) => {
  const entries = Array.from({ length: 150 }, (_, index) => ({
    path: `obsolete/page-${index}.md`,
    hash: sha256(`old-${index}`),
  }));
  for (const [name, mutate, expected] of [
    [
      "missing",
      (telemetry: AgentRecord[]) => telemetry.filter((record) =>
        !(record.event.kind === "wipe_manifest_chunk" && record.event.chunkIndex === 0)),
      /wipe manifest chunks: 1, expected: 2/i,
    ],
    [
      "duplicate",
      (telemetry: AgentRecord[]) => {
        const chunk = telemetry.find((record) =>
          record.event.kind === "wipe_manifest_chunk" && record.event.chunkIndex === 0)!;
        return [structuredClone(chunk), ...telemetry];
      },
      /duplicate wipe manifest chunk index: 0/i,
    ],
    [
      "reordered",
      (telemetry: AgentRecord[]) => [
        telemetry[1],
        telemetry[0],
        ...telemetry.slice(2),
      ],
      /wipe manifest chunk order: 1, expected: 0/i,
    ],
    [
      "tampered",
      (telemetry: AgentRecord[]) => {
        const copy = structuredClone(telemetry);
        const chunk = copy.find((record) => record.event.kind === "wipe_manifest_chunk")!;
        (chunk.event.entries as Array<Record<string, unknown>>)[0].path = "tampered.md";
        return copy;
      },
      /wipe manifest chunk 0 hash mismatch/i,
    ],
  ] as Array<[
    string,
    (telemetry: AgentRecord[]) => AgentRecord[],
    RegExp,
  ]>) {
    await t.test(name, async () => {
      const records = sessionRecords();
      const current = records.filter((record) =>
        record.event.kind === "wipe_manifest_chunk" || record.event.kind === "wipe_complete");
      const firstTelemetry = records.indexOf(current[0]);
      records.splice(firstTelemetry, current.length, ...mutate(wipeTelemetry("domain-id", SESSION, entries)));
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("wipe proof schema rejects sha256-v1 live proofs", async () => {
  const records = sessionRecords();
  const complete = records.find((record) => record.event.kind === "wipe_complete")!;
  complete.event.hashAlgorithm = "sha256-v1";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /wipe_complete marker is invalid|hash algorithm/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("auditor rejects ill-formed UTF-16 manifest paths before hashing", async () => {
  const records = sessionRecords();
  const chunk = records.find((record) => record.event.kind === "wipe_manifest_chunk")!;
  const entries = chunk.event.entries as Array<Record<string, unknown>>;
  entries[0].path = `bad-\uD800-path.md`;
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /manifest path.*ill-formed UTF-16/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("pre-wipe file surviving with fresh mtime fails by manifest identity", async () => {
  const value = await fixture();
  const staleFile = path.join(
    value.root,
    "!Wiki",
    "replay-folder",
    OLD_MANIFEST_FILE,
  );
  try {
    await writeFile(staleFile, OLD_MANIFEST_CONTENT, "utf8");
    await utimes(staleFile, new Date(), new Date());
    await assert.rejects(
      audit(value),
      /stale pre-wipe descendants: 1.*obsolete-old\.md/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("stale pre-wipe empty directory manifest fails with its relative path", async () => {
  const value = await fixture();
  const staleDir = path.join(value.root, "!Wiki", "replay-folder", "obsolete-empty");
  try {
    await mkdir(staleDir);
    await utimes(staleDir, new Date(), new Date());
    await assert.rejects(
      audit(value),
      /stale pre-wipe descendants: 1.*obsolete-empty\//i,
    );
  } finally {
    await value.cleanup();
  }
});

test("stale directory manifest rejects a recreated file at the directory path", async () => {
  const value = await fixture();
  try {
    const mismatchedPath = path.join(value.root, "!Wiki", "replay-folder", "obsolete-empty");
    await writeFile(mismatchedPath, "not a directory", "utf8");
    await assert.rejects(
      audit(value),
      /stale pre-wipe descendants: 1.*obsolete-empty\//i,
    );
  } finally {
    await value.cleanup();
  }
});

test("preparing lifecycle diagnostics require known callSite, transport, and attempt", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "missing transport",
      (diagnostics: Record<string, unknown>) => {
        delete diagnostics.transport;
      },
      /lifecycle call-0 missing diagnostics\.transport/i,
    ],
    [
      "unknown callSite",
      (diagnostics: Record<string, unknown>) => {
        diagnostics.callSite = "unknown.call";
      },
      /lifecycle call-0 has invalid diagnostics\.callSite/i,
    ],
    [
      "unknown transport",
      (diagnostics: Record<string, unknown>) => {
        diagnostics.transport = "websocket";
      },
      /lifecycle call-0 has invalid diagnostics\.transport/i,
    ],
    [
      "missing attempt",
      (diagnostics: Record<string, unknown>) => {
        delete diagnostics.attempt;
      },
      /lifecycle call-0 missing diagnostics\.attempt/i,
    ],
  ] as Array<[
    string,
    (diagnostics: Record<string, unknown>) => void,
    RegExp,
  ]>) {
    await t.test(name, async () => {
      const records = sessionRecords();
      const preparing = records.find((record) =>
        record.event.kind === "llm_lifecycle"
        && record.event.id === "call-0"
        && record.event.phase === "preparing")!;
      mutate(preparing.event.diagnostics as Record<string, unknown>);
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("prompt budget callSite must match its lifecycle diagnostics", async () => {
  const records = sessionRecords();
  const budget = records.find((record) =>
    record.event.kind === "prompt_budget" && record.event.requestId === "call-0")!;
  budget.event.callSite = "ingest.synthesize";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /prompt_budget requestId call-0 callSite ingest\.synthesize does not match lifecycle ingest\.evidence-map/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("retry lifecycle requires stable transport and exactly incremented attempt", async (t) => {
  for (const [name, retryOptions, expected] of [
    [
      "transport",
      { attempt: 1, diagnostics: { transport: "stream" } },
      /lifecycle call-0 retrying changed transport: non-stream -> stream/i,
    ],
    [
      "attempt",
      { attempt: 0 },
      /lifecycle call-0 retrying has invalid attempt transition: 0 -> 0/i,
    ],
  ] as const) {
    await t.test(name, async () => {
      const records = sessionRecords({ sources: ["sources/a.md"] });
      const firstLifecycle = records.findIndex((record) =>
        record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
      records.splice(
        firstLifecycle,
        7,
        ...lifecycleRecords("call-0", 1_000, SESSION, {
          phases: ["preparing", "sent", "waiting", "retrying"],
        }),
        ...lifecycleRecords("call-0:retry-1", 1_100, SESSION, retryOptions),
      );
      const firstBudget = records.findIndex((record) => record.event.kind === "prompt_budget");
      records.splice(
        firstBudget + 1,
        0,
        agentRecord(promptBudget({ requestId: "call-0:retry-1" })),
      );
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value, { expectedSources: 1 }), expected);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("technical fields in persisted human labels fail but diagnostics remain allowed", async () => {
  const records = sessionRecords();
  const lifecycle = records.find((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0")!;
  lifecycle.event.humanLabel = "Extracting source facts — callSite=ingest.evidence-map";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /technical lifecycle fields in human labels: 1.*humanLabel/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("standalone dotted callSite in a human label is rejected", async () => {
  const records = sessionRecords();
  const lifecycle = records.find((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0")!;
  lifecycle.event.phaseLabel = "Extracting with ingest.synthesize";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /technical lifecycle fields in human labels: 1.*phaseLabel/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("provider name in a human label is rejected", async () => {
  const records = sessionRecords();
  const lifecycle = records.find((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0")!;
  lifecycle.event.humanLabel = "OpenAI is preparing the request";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /technical lifecycle fields in human labels: 1.*humanLabel/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("transport and attempt notation in human labels are rejected", async (t) => {
  for (const label of ["Using non-stream transport", "Preparing attempt #2"]) {
    await t.test(label, async () => {
      const records = sessionRecords();
      const lifecycle = records.find((record) =>
        record.event.kind === "llm_lifecycle" && record.event.id === "call-0")!;
      lifecycle.event.humanLabel = label;
      const value = await fixture({ records });
      try {
        await assert.rejects(
          audit(value),
          /technical lifecycle fields in human labels: 1.*humanLabel/i,
        );
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("exact session prompt budget value in a human label is rejected without rejecting prose numbers", async () => {
  const records = sessionRecords();
  const lifecycles = records.filter((record) =>
    record.event.kind === "llm_lifecycle" && record.event.id === "call-0");
  const budget = records.find((record) =>
    record.event.kind === "prompt_budget" && record.event.requestId === "call-0")!;
  budget.event.configuredInputBudget = 32_768;
  lifecycles[0].event.actionLabel = "32768";
  lifecycles[1].event.stateLabel = "Stage 2 of normal processing";
  const value = await fixture({ records });
  try {
    await assert.rejects(
      audit(value),
      /technical lifecycle fields in human labels: 1.*actionLabel/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("context-length error fixture fails even when the source later completes", async () => {
  const records = sessionRecords();
  const done = records.findIndex((record) => record.event.kind === "file_done");
  records.splice(done, 0, agentRecord({
    kind: "error",
    message: "prompt has 17000 tokens and exceeds maximum context length 16384",
  }));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /context errors: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("overflow fixture rejects estimate above effective budget", async () => {
  const records = sessionRecords();
  const budget = records.find((record) => record.event.kind === "prompt_budget")!;
  budget.event.estimatedInputTokens = 12_289;
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /budget violations: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("failed-source fixture rejects completion after an error", async () => {
  const records = sessionRecords();
  const done = records.findLastIndex((record) => record.event.kind === "file_done");
  records.splice(done, 0, agentRecord({ kind: "error", message: "ingest failed" }));
  const value = await fixture({ records });
  try {
    await assert.rejects(audit(value), /failed source completions: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("prompt_budget runtime schema rejects every wrong field type and unsafe number", async (t) => {
  const invalidValues: Array<[string, unknown]> = [
    ["requestId", ""],
    ["callSite", "secret source content"],
    ["configuredInputBudget", Number.NaN],
    ["effectiveInputBudget", -1],
    ["estimatedInputTokens", "12000"],
    ["actualInputTokens", Number.POSITIVE_INFINITY],
    ["outputBudget", -1],
    ["compressionProfile", "verbose"],
    ["contextUnits", 1.5],
    ["sourceChunks", ["chunk-secret"]],
    ["reductionDepth", -1],
    ["retryReason", "source text marker"],
  ];
  for (const [field, invalid] of invalidValues) {
    await t.test(field, async () => {
      const records = sessionRecords();
      const budget = records.find((record) => record.event.kind === "prompt_budget")!;
      budget.event[field] = invalid;
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value), /invalid prompt_budget events: 1/i);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("unknown prompt_budget fields, including omittedUnits, are content leaks", async (t) => {
  for (const field of ["sourceText", "omittedUnits"]) {
    await t.test(field, async () => {
      const records = sessionRecords();
      const budget = records.find((record) => record.event.kind === "prompt_budget")!;
      budget.event[field] = [SOURCE_MARKER];
      const value = await fixture({ records });
      try {
        await assert.rejects(audit(value), /leaked prompt fields: 1/i);
      } finally {
        await value.cleanup();
      }
    });
  }
});

test("malformed agent JSONL reports its file and line", async () => {
  const value = await fixture({ agentRaw: '{"session":"200","op":"init"}\n{bad}\n' });
  try {
    await assert.rejects(audit(value), /agent\.jsonl:2:/i);
  } finally {
    await value.cleanup();
  }
});

test("malformed index JSONL reports its file and line", async () => {
  const value = await fixture({
    indexes: { "replay-folder": `${JSON.stringify(pageRecord("alpha"))}\n{bad}\n` },
  });
  try {
    await assert.rejects(audit(value), /index\.jsonl:2:/i);
  } finally {
    await value.cleanup();
  }
});

test("agent and index JSONL are streamed instead of read as whole files", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  assert.doesNotMatch(source, /readFile\(agentPath/);
  assert.doesNotMatch(source, /readFile\(indexPath/);
  assert.match(source, /createReadStream/);
});

test("stale manifest proof ignores only ENOENT and surfaces other lstat failures", async () => {
  const module = await import("../scripts/audit-bounded-init-replay");
  const findStale = (module as unknown as {
    findStaleWipeManifestDescendants?: (
      root: string,
      entries: Array<{ path: string; hash?: string }>,
      fs: {
        lstat: (path: string) => Promise<never>;
        readdir: (path: string) => Promise<string[]>;
        hashFile: (path: string) => Promise<string>;
      },
    ) => Promise<string[]>;
  }).findStaleWipeManifestDescendants;
  assert.equal(typeof findStale, "function");
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  await assert.rejects(
    findStale!("/vault/domain", [{ path: "old.md", hash: `sha256:${"0".repeat(64)}` }], {
      lstat: async () => { throw denied; },
      readdir: async () => [],
      hashFile: async () => `sha256:${"0".repeat(64)}`,
    }),
    /permission denied/i,
  );
});

test("lifecycle budget correlation builds one requestId map without records.find", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  assert.match(source, /budgetByRequestId/);
  assert.doesNotMatch(source, /const budget = records\.find/);
});

test("wipe chunk duplicate validation is linear and does not rescan indexes", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  const auditWipeSource = source.slice(
    source.indexOf("function auditWipe"),
    source.indexOf("function auditLifecycles"),
  );
  assert.doesNotMatch(auditWipeSource, /\.indexOf\(/);
  assert.match(auditWipeSource, /Set<number>/);
});

test("wipe proof audit hashes one bounded chunk at a time without full-manifest joins", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  const auditWipeSource = source.slice(
    source.indexOf("function auditWipe"),
    source.indexOf("function auditLifecycles"),
  );
  assert.doesNotMatch(auditWipeSource, /canonicalWipeEntries|JSON\.stringify\(entries\)/);
  assert.match(auditWipeSource, /advanceWipeManifestRoot/);
});

test("latest-init selection works after a large unrelated prefix", async () => {
  const prefix = Array.from({ length: 20_000 }, (_, index) =>
    agentRecord({ kind: "info_text", icon: "·", summary: `old-${index}` }, "100"));
  const value = await fixture({
    records: [...prefix, ...sessionRecords()],
  });
  try {
    const summary = await audit(value);
    assert.equal(summary.session, SESSION);
    assert.equal(summary.successfulSources, 2);
  } finally {
    await value.cleanup();
  }
});

test("oversized agent JSONL line fails with a clear byte-limit error", async () => {
  const value = await fixture({
    agentRaw: `${JSON.stringify({
      ts: new Date().toISOString(),
      session: SESSION,
      op: "init",
      event: {
        kind: "info_text",
        icon: "·",
        summary: "x".repeat(1_100_000),
      },
    })}\n`,
  });
  try {
    await assert.rejects(
      audit(value),
      /agent\.jsonl:1: line exceeds 1048576 bytes/i,
    );
  } finally {
    await value.cleanup();
  }
});

test("duplicate page IDs fail", async () => {
  const duplicate = pageRecord("alpha");
  const value = await fixture({
    indexes: { "replay-folder": indexJsonl([duplicate, duplicate]) },
  });
  try {
    await assert.rejects(audit(value), /duplicate record ids: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("duplicate chunk IDs fail while distinct ordinals remain valid", async () => {
  const duplicate = chunkRecord("alpha", 0);
  const value = await fixture({
    indexes: {
      "replay-folder": indexJsonl([
        pageRecord("alpha"),
        duplicate,
        chunkRecord("alpha", 1),
        duplicate,
      ]),
    },
  });
  try {
    await assert.rejects(audit(value), /duplicate record ids: 1/i);
  } finally {
    await value.cleanup();
  }
});

test("explicit older session differs from latest-init selection", async () => {
  const records = [
    ...sessionRecords({ session: "100", wikiFolder: "old-folder", sources: ["old.md"] }),
    ...sessionRecords({ session: SESSION, wikiFolder: "replay-folder" }),
  ];
  const value = await fixture({
    records,
    indexes: {
      "old-folder": indexJsonl([pageRecord("old")]),
      "replay-folder": indexJsonl(),
    },
  });
  try {
    const older = await audit(value, { session: "100", expectedSources: 1 });
    const latest = await audit(value);
    assert.equal(older.session, "100");
    assert.equal(older.successfulSources, 1);
    assert.equal(older.pageRecords, 1);
    assert.equal(latest.session, SESSION);
    assert.equal(latest.successfulSources, 2);
    assert.equal(latest.pageRecords, 2);
  } finally {
    await value.cleanup();
  }
});

test("unsafe domain_created wiki_folder is rejected instead of falling back", async () => {
  const records = sessionRecords({ wikiFolder: "../outside" });
  const value = await fixture({ records, indexes: { "replay-folder": indexJsonl() } });
  try {
    await assert.rejects(audit(value), /unsafe wiki_folder/i);
  } finally {
    await value.cleanup();
  }
});

test("CLI accepts a vault path with spaces, prints summary, and writes nothing", async () => {
  const value = await fixture();
  try {
    const before = await snapshot(value.root);
    const result = await runCli([
      "--vault",
      value.root,
      "--session",
      "latest-init",
      "--expected-sources",
      "2",
    ]);
    const after = await snapshot(value.root);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).session, SESSION);
    assert.deepEqual(after, before);
  } finally {
    await value.cleanup();
  }
});
