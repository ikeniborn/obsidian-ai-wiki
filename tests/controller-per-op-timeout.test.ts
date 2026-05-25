import { describe, it, expect, vi, afterEach } from "vitest";
import { WikiController } from "../src/controller";
import type { AgentRunner } from "../src/agent-runner";
import type { RunEvent } from "../src/types";
import type { LlmWikiView } from "../src/view";

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

function makeStubRunner(): AgentRunner {
  const resultEvent: RunEvent = { kind: "result", text: "ok", durationMs: 10, inputTokens: 1, outputTokens: 1 };
  return { run: vi.fn(async function* () { yield resultEvent; }) } as unknown as AgentRunner;
}

function makeStubView(): LlmWikiView {
  return {
    setRunning: vi.fn(),
    appendEvent: vi.fn(),
    finish: vi.fn().mockResolvedValue(undefined),
  } as unknown as LlmWikiView;
}

type PrivateCtrl = {
  buildAgentRunner: (vaultRoot: string, resumeId?: string, opKey?: string, timeoutSec?: number) => Promise<AgentRunner>;
  ensureView: () => Promise<void>;
  activeView: () => LlmWikiView | null;
  dispatch: (op: string, args: string[], domainId?: string) => Promise<void>;
};

describe("WikiController — per-op timeout forwarded to buildAgentRunner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes ingest timeout (60s) to buildAgentRunner, not query timeout (300s)", async () => {
    const app = makeApp();
    const plugin = {
      settings: {
        backend: "native-agent",
        nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
        timeouts: { ingest: 60, query: 300, lint: 900, init: 3600, format: 600 },
        agentLogEnabled: false,
        history: [],
        historyLimit: 20,
        devMode: { enabled: false, evaluatorModel: "sonnet" },
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
      app,
    } as unknown as Parameters<typeof WikiController>[1];

    const domainStore = { load: vi.fn().mockResolvedValue([]), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
    const localConfigStore = { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];

    const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
    const priv = ctrl as unknown as PrivateCtrl;

    const stubRunner = makeStubRunner();
    const buildSpy = vi.spyOn(priv, "buildAgentRunner").mockResolvedValue(stubRunner);
    vi.spyOn(priv, "ensureView").mockResolvedValue(undefined);
    vi.spyOn(priv, "activeView").mockReturnValue(makeStubView());

    await priv.dispatch("ingest", ["/tmp/vault/notes/x.md"]);

    expect(buildSpy).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      "ingest",
      60,
    );
  });

  it("passes 0 (unlimited) when ingest timeout is 0", async () => {
    const app = makeApp();
    const plugin = {
      settings: {
        backend: "native-agent",
        nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
        timeouts: { ingest: 0, query: 300, lint: 900, init: 3600, format: 600 },
        agentLogEnabled: false,
        history: [],
        historyLimit: 20,
        devMode: { enabled: false, evaluatorModel: "sonnet" },
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
      app,
    } as unknown as Parameters<typeof WikiController>[1];

    const domainStore = { load: vi.fn().mockResolvedValue([]), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
    const localConfigStore = { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];

    const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
    const priv = ctrl as unknown as PrivateCtrl;

    const stubRunner = makeStubRunner();
    const buildSpy = vi.spyOn(priv, "buildAgentRunner").mockResolvedValue(stubRunner);
    vi.spyOn(priv, "ensureView").mockResolvedValue(undefined);
    vi.spyOn(priv, "activeView").mockReturnValue(makeStubView());

    await priv.dispatch("ingest", ["/tmp/vault/notes/x.md"]);

    expect(buildSpy).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      "ingest",
      0,
    );
  });
});
