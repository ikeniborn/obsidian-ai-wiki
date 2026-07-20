import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { RunEvent, WikiOperation } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") {
    return { url: "node:path", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const obsidianModule = `
export class App {}
export class Component {}
export class ItemView {}
export class Modal {}
export class WorkspaceLeaf {}
export class TFile {}
export class TFolder {}
export class AbstractInputSuggest {}
export class DropdownComponent {}
export class PluginSettingTab {}
export class Setting {}
export class ToggleComponent {}
export class Plugin {}
export class Notice {}
export const MarkdownRenderer = { render: async () => {} };
export const Platform = { isDesktopApp: true, isMobile: false };
export const moment = { locale: () => "en" };
export const requestUrl = async () => { throw new Error("requestUrl unavailable in test"); };
export const setIcon = () => {};
`;
const obsidianUrl = `data:text/javascript,${encodeURIComponent(obsidianModule)}`;
const obsidianLoader = `
const moduleUrl = ${JSON.stringify(obsidianUrl)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "obsidian") return { url: moduleUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(obsidianLoader)}`);

const { WikiController } = await import("../src/controller");

const AGENT_PATH = ".obsidian/plugins/obsidian-ai-wiki/agent.jsonl";
const LINE_CAP = 1_048_576;

class AgentLogAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  writeAttempts = 0;
  failWrites = 0;

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writeAttempts++;
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("synthetic write failure");
    }
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.writeAttempts++;
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("synthetic append failure");
    }
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [], folders: [] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(): Promise<void> {}
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

type LogController = {
  logEvent(
    vaultRoot: string,
    sessionId: string,
    op: WikiOperation,
    domainId: string | undefined,
    event: RunEvent,
  ): Promise<void>;
};

function loggerFixture(adapter = new AgentLogAdapter()): {
  adapter: AgentLogAdapter;
  log: (event: RunEvent) => Promise<void>;
} {
  const app = {
    vault: {
      adapter,
      configDir: ".obsidian",
    },
  };
  const plugin = {
    settings: {
      agentLogEnabled: true,
    },
    manifest: {
      id: "obsidian-ai-wiki",
      dir: ".obsidian/plugins/obsidian-ai-wiki",
    },
  };
  const controller = new WikiController(
    app as never,
    plugin as never,
    { load: async () => [] } as never,
    { load: async () => ({}) } as never,
  );
  const internal = controller as unknown as LogController;
  return {
    adapter,
    log: (event) => internal.logEvent("", "session-1", "init", "demo", event),
  };
}

function records(adapter: AgentLogAdapter): Array<Record<string, unknown>> {
  const text = adapter.files.get(AGENT_PATH) ?? "";
  const lines = text.split("\n").filter(Boolean);
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, "utf8") <= LINE_CAP);
  }
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function eventOf(record: Record<string, unknown>): Record<string, unknown> {
  return record.event as Record<string, unknown>;
}

test("reasoning over one MiB is chunked before later critical telemetry", async () => {
  const fixture = loggerFixture();
  const reasoning = "ordered-reasoning-".repeat(70_000);
  await fixture.log({ kind: "assistant_text", delta: reasoning, isReasoning: true });
  await fixture.log({
    kind: "llm_lifecycle",
    id: "request-1",
    phase: "completed",
    atMs: 10,
  });
  await fixture.log({
    kind: "wipe_complete",
    domainId: "demo",
    transactionId: "wipe-1",
    chunkCount: 0,
    totalCount: 0,
    hashAlgorithm: "sha256-v2",
    manifestHash: `sha256:${"0".repeat(64)}`,
    atMs: 11,
  });
  await fixture.log({ kind: "system", message: "finish status=done durationMs=12" });

  const persisted = records(fixture.adapter);
  const events = persisted.map(eventOf);
  const reasoningEvents = events.filter((event) =>
    event.kind === "assistant_text" && event.isReasoning === true);
  assert.ok(reasoningEvents.length > 1);
  assert.equal(reasoningEvents.map((event) => event.delta).join(""), reasoning);
  assert.deepEqual(
    events.slice(-3).map((event) => [event.kind, event.phase ?? event.message]),
    [
      ["llm_lifecycle", "completed"],
      ["wipe_complete", undefined],
      ["system", "finish status=done durationMs=12"],
    ],
  );
});

test("oversized ordinary event writes a sensitive-free omission and continues", async () => {
  const fixture = loggerFixture();
  const secret = "SECRET_OVERSIZED_PAYLOAD";
  await fixture.log({ kind: "error", message: secret.repeat(60_000) });
  await fixture.log({ kind: "system", message: "finish status=error durationMs=1" });

  const persisted = records(fixture.adapter);
  const events = persisted.map(eventOf);
  assert.equal(events[0]?.kind, "log_record_omitted");
  assert.equal(events[0]?.eventKind, "error");
  assert.equal(typeof events[0]?.byteCount, "number");
  assert.doesNotMatch(JSON.stringify(events[0]), new RegExp(secret));
  assert.equal(events[1]?.kind, "system");
});

test("reasoning beyond the total retention cap emits a bounded truncation marker", async () => {
  const fixture = loggerFixture();
  const omittedSecret = "SECRET_REASONING_OVER_RETENTION_CAP";
  await fixture.log({
    kind: "assistant_text",
    delta: `${"r".repeat(5 * 1024 * 1024)}${omittedSecret}`,
    isReasoning: true,
  });
  await fixture.log({ kind: "system", message: "after-truncation" });

  const persisted = records(fixture.adapter);
  const events = persisted.map(eventOf);
  const marker = events.find((event) => event.kind === "reasoning_omitted");
  assert.ok(marker);
  assert.equal(marker.truncated, true);
  assert.equal(typeof marker.omittedByteCount, "number");
  assert.equal(typeof marker.retainedByteLimit, "number");
  assert.doesNotMatch(JSON.stringify(marker), new RegExp(omittedSecret));
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(omittedSecret));
  assert.equal(events.at(-1)?.message, "after-truncation");
});

test("reasoning is detached before a failed write and is not replayed", async () => {
  const adapter = new AgentLogAdapter();
  adapter.failWrites = 1;
  const fixture = loggerFixture(adapter);
  await fixture.log({
    kind: "assistant_text",
    delta: "POISON_REASONING_THAT_MUST_NOT_REPLAY",
    isReasoning: true,
  });
  await fixture.log({ kind: "system", message: "first-event" });
  await fixture.log({ kind: "system", message: "second-event" });

  const persisted = records(adapter);
  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /POISON_REASONING_THAT_MUST_NOT_REPLAY/);
  assert.deepEqual(
    persisted.map(eventOf).map((event) => event.message),
    ["first-event", "second-event"],
  );
  assert.equal(adapter.writeAttempts, 3);
});
