import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
      kind: "tool_use",
      name: "WipeDomain",
      input: { folder: `!Wiki/${wikiFolder}` },
    }, session),
    agentRecord({ kind: "tool_result", ok: true }, session),
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
} = {}) {
  return auditBoundedInitReplay({
    vault: value.root,
    session: options.session ?? "latest-init",
    expectedSources: options.expectedSources ?? 2,
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
      stalePreWipeDescendants: 0,
      technicalHumanLabelFields: 0,
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

test("stale pre-wipe empty directory manifest fails with its relative path", async () => {
  const value = await fixture();
  const staleDir = path.join(value.root, "!Wiki", "replay-folder", "obsolete-empty");
  try {
    await mkdir(staleDir);
    await utimes(staleDir, 0.1, 0.1);
    await assert.rejects(
      audit(value),
      /stale pre-wipe descendants: 1.*obsolete-empty\//i,
    );
  } finally {
    await value.cleanup();
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
