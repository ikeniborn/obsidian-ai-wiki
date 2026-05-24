import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WikiController } from "../src/controller";
import { graphCache } from "../src/wiki-graph-cache";
import type { DomainEntry } from "../src/domain";
import type { RunEvent } from "../src/types";
import type { AgentRunner } from "../src/agent-runner";
import type { LlmWikiView } from "../src/view";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub for LlmWikiView — only the methods called inside dispatch */
function makeStubView(): LlmWikiView {
  return {
    setRunning: vi.fn(),
    appendEvent: vi.fn(),
    finish: vi.fn().mockResolvedValue(undefined),
  } as unknown as LlmWikiView;
}

function makeApp() {
  return {
    vault: {
      adapter: {
        getBasePath: () => "/tmp/vault",
        getFullPath: (p: string) => `/tmp/vault/${p}`,
        read: vi.fn().mockResolvedValue(""),
        write: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        mkdir: vi.fn().mockResolvedValue(undefined),
        append: vi.fn().mockResolvedValue(undefined),
      },
      configDir: ".obsidian",
      getName: () => "vault",
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      modify: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: vi.fn().mockResolvedValue(undefined) }),
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue({ path: "notes/x.md", extension: "md", name: "x.md" }),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makePlugin(app: ReturnType<typeof makeApp>) {
  return {
    settings: {
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
      timeouts: { ingest: 30, query: 30, lint: 30, init: 30, format: 30 },
      agentLogEnabled: false,
      history: [],
      historyLimit: 20,
      devMode: { enabled: false, evaluatorModel: "sonnet" },
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app,
  } as unknown as Parameters<typeof WikiController>[1];
}

function makeDomainStore(domains: DomainEntry[] = []) {
  return { load: vi.fn().mockResolvedValue(domains), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
}

function makeLocalConfigStore() {
  return { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];
}

/** Build a fake AgentRunner whose run() yields a single result event then ends. */
function makeStubRunner(): AgentRunner {
  const resultEvent: RunEvent = { kind: "result", text: "ok", durationMs: 10, inputTokens: 1, outputTokens: 1 };
  return {
    run: vi.fn(async function* () {
      yield resultEvent;
    }),
  } as unknown as AgentRunner;
}

type PrivateCtrl = {
  buildAgentRunner: () => Promise<AgentRunner>;
  ensureView: () => Promise<void>;
  activeView: () => LlmWikiView | null;
  dispatch: (op: string, args: string[], domainId?: string) => Promise<void>;
};

function build(domains: DomainEntry[] = []) {
  const app = makeApp();
  const plugin = makePlugin(app);
  const domainStore = makeDomainStore(domains);
  const localConfigStore = makeLocalConfigStore();
  const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
  const priv = ctrl as unknown as PrivateCtrl;

  const stubView = makeStubView();
  const stubRunner = makeStubRunner();

  // Stub private methods to avoid real LLM/view setup
  vi.spyOn(priv, "buildAgentRunner").mockResolvedValue(stubRunner);
  vi.spyOn(priv, "ensureView").mockResolvedValue(undefined);
  vi.spyOn(priv, "activeView").mockReturnValue(stubView);

  return { ctrl, priv, plugin, domainStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WikiController cache invalidation after mutating ops", () => {
  beforeEach(() => {
    graphCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DOMAIN: DomainEntry = {
    id: "ai",
    name: "AI",
    wiki_folder: "ии",
    source_paths: [],
    entity_types: [],
    language_notes: "",
  };

  it("invalidates graphCache for ingest when domainId provided", async () => {
    const { priv } = build([DOMAIN]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");

    await priv.dispatch("ingest", ["/tmp/vault/notes/x.md"], "ai");

    expect(invalidateSpy).toHaveBeenCalledWith("ai");
  });

  it("invalidates graphCache for lint with domainId", async () => {
    const { priv } = build([DOMAIN]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");

    await priv.dispatch("lint", ["ai"], "ai");

    expect(invalidateSpy).toHaveBeenCalledWith("ai");
  });

  it("invalidates graphCache for init with domainId", async () => {
    const { priv } = build([DOMAIN]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");

    await priv.dispatch("init", ["ai"], "ai");

    expect(invalidateSpy).toHaveBeenCalledWith("ai");
  });

  it("invalidates all domains when no domainId given (lint all)", async () => {
    const domain2: DomainEntry = { id: "db", name: "DB", wiki_folder: "базы-данных", source_paths: [], entity_types: [], language_notes: "" };
    const { priv } = build([DOMAIN, domain2]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");

    await priv.dispatch("lint", []);

    expect(invalidateSpy).toHaveBeenCalledWith("ai");
    expect(invalidateSpy).toHaveBeenCalledWith("db");
  });

  it("does NOT invalidate graphCache for read-only query", async () => {
    const { priv } = build([DOMAIN]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");

    await priv.dispatch("query", ["what is AI?"], "ai");

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
