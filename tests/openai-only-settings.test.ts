import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffective } from "../src/effective-settings";
import { LocalConfigStore, sanitizeLocalConfig } from "../src/local-config";
import { hydrateSettings } from "../src/settings-persistence";

test("local legacy fields are ignored while supported state survives", () => {
  const modelContext = {
    "https://llm.example/v1::model": {
      contextWindow: 32_768,
      source: "configured" as const,
      calibration: 1,
      samples: 0,
    },
  };
  const loaded = sanitizeLocalConfig({
    iclaudePath: "/usr/bin/claude",
    backend: "claude-agent",
    shellConsentGiven: true,
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret", legacyModel: "sonnet" },
    proxy: { password: "proxy-secret", legacyUrl: "https://proxy.example" },
    migrated_v1: true,
    migrated_v2: false,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: false,
    migrated_auto_budget: true,
    lastDomain: "work",
    modelContext,
    unknownFutureField: "ignored",
  });

  assert.deepEqual(loaded, {
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret" },
    proxy: { password: "proxy-secret" },
    migrated_v1: true,
    migrated_v2: false,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: false,
    migrated_auto_budget: true,
    lastDomain: "work",
    modelContext,
  });
});

test("local load is non-writing and the next ordinary save emits only supported fields", async () => {
  const writes: string[] = [];
  const stored = {
    iclaudePath: "/usr/bin/claude",
    backend: "claude-agent",
    shellConsentGiven: true,
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret", legacyModel: "sonnet" },
    proxy: { password: "proxy-secret", legacyUrl: "https://proxy.example" },
    migrated_v1: true,
    migrated_v2: false,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: false,
    migrated_auto_budget: true,
    lastDomain: "work",
    modelContext: {
      "https://llm.example/v1::model": {
        contextWindow: 32_768,
        source: "configured",
        calibration: 1,
        samples: 0,
      },
    },
    unknownFutureField: "ignored",
  };
  const plugin = {
    manifest: { dir: ".obsidian/plugins/ai-wiki" },
    app: {
      vault: {
        adapter: {
          exists: async () => true,
          read: async () => JSON.stringify(stored),
          write: async (_path: string, value: string) => { writes.push(value); },
        },
      },
    },
  } as unknown as ConstructorParameters<typeof LocalConfigStore>[0];
  const store = new LocalConfigStore(plugin);

  const loaded = await store.load();

  assert.equal(writes.length, 0);
  assert.equal("iclaudePath" in loaded, false);
  assert.equal("backend" in loaded, false);
  assert.equal("shellConsentGiven" in loaded, false);

  await store.save({ lastDomain: "next" });

  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), {
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret" },
    proxy: { password: "proxy-secret" },
    migrated_v1: true,
    migrated_v2: false,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: false,
    migrated_auto_budget: true,
    lastDomain: "next",
    modelContext: stored.modelContext,
  });
});

test("effective settings overlay only supported local values", () => {
  const settings = hydrateSettings({
    agentLogEnabled: false,
    historyLimit: 47,
    nativeAgent: { model: "settings-model" },
    proxy: {
      enabled: true,
      url: "https://proxy.example",
      username: "proxy-user",
      noProxy: "localhost",
    },
  });
  settings.nativeAgent.apiKey = "settings-key";

  const effective = resolveEffective(settings, {
    agentLogEnabled: true,
    nativeAgent: { apiKey: "local-key" },
    proxy: { password: "proxy-secret" },
  });

  assert.equal("backend" in effective, false);
  assert.equal(effective.agentLogEnabled, true);
  assert.equal(effective.historyLimit, 47);
  assert.equal(effective.nativeAgent.model, "settings-model");
  assert.equal(effective.nativeAgent.apiKey, "local-key");
  assert.deepEqual(effective.proxy, {
    enabled: true,
    url: "https://proxy.example",
    username: "proxy-user",
    noProxy: "localhost",
    password: "proxy-secret",
  });
});

test("legacy Claude selection loads as OpenAI without retaining unknown fields", () => {
  const loaded = hydrateSettings({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet", allowedTools: "Read" },
    nativeAgent: {
      baseUrl: "https://llm.example/v1",
      model: "gpt-compatible",
      contextWindowTokens: 65_536,
      contextWindowTokensByModel: { "query-model": 131_072 },
      inputBudgetTokens: 24_000,
      repairInputBudgetTokens: 32_000,
      maxTokens: 4_096,
      thinkingBudgetTokens: 128,
      embeddingModel: "embed-model",
      embeddingDimensions: 768,
      relevantPagesTopK: 12,
      mergeDeleteWarnThreshold: 7,
      chunkMaxChars: 4_000,
      chunkOverlapChars: 400,
      chunkMinChars: 200,
      chunkMaxCount: 50,
      operations: {
        query: {
          model: "query-model",
          temperature: 0.4,
          inputBudgetTokens: 20_000,
          maxTokens: 3_000,
          thinkingBudgetTokens: 64,
          compressionProfile: "minimum",
          obsoleteOperationField: true,
        },
        obsoleteOperation: { model: "ignored" },
      },
      obsoleteNestedField: true,
    },
    timeouts: { query: 42, obsoleteTimeout: 99 },
    history: [{
      id: "run-1",
      operation: "query",
      args: ["question"],
      domainId: "work",
      startedAt: 1,
      finishedAt: 2,
      status: "done",
      finalText: "answer",
      steps: [{ kind: "tool_use", label: "search", obsoleteStepField: true }],
      obsoleteHistoryField: true,
    }],
    proxy: {
      enabled: true,
      url: "https://proxy.example",
      username: "proxy-user",
      noProxy: "localhost",
      password: "ignored-secret",
    },
    vision: {
      enabled: true,
      model: "vision-model",
      compressionProfile: "maximum",
      obsoleteVisionField: true,
    },
    devMode: {
      enabled: true,
      nativeTransportDiagnosticMode: "connection-close",
      logDir: "/tmp/ignored",
    },
    lintOptions: { useLlm: false, obsoleteLintField: true },
    historyLimit: 37,
    unknownFutureField: "ignored",
  });

  assert.equal("backend" in loaded, false);
  assert.equal("claudeAgent" in loaded, false);
  assert.equal("unknownFutureField" in loaded, false);
  assert.equal(loaded.nativeAgent.baseUrl, "https://llm.example/v1");
  assert.equal(loaded.nativeAgent.model, "gpt-compatible");
  assert.deepEqual(loaded.nativeAgent.contextWindowTokensByModel, {
    "query-model": 131_072,
    "gpt-compatible": 65_536,
    "llama3.2": 65_536,
  });
  assert.equal("contextWindowTokens" in loaded.nativeAgent, false);
  assert.equal(loaded.nativeAgent.inputBudgetTokens, 24_000);
  assert.equal(loaded.nativeAgent.repairInputBudgetTokens, 32_000);
  assert.equal(loaded.nativeAgent.maxTokens, 4_096);
  assert.equal(loaded.nativeAgent.thinkingBudgetTokens, 128);
  assert.equal(loaded.nativeAgent.embeddingModel, "embed-model");
  assert.equal(loaded.nativeAgent.embeddingDimensions, 768);
  assert.equal(loaded.nativeAgent.relevantPagesTopK, 12);
  assert.equal(loaded.nativeAgent.mergeDeleteWarnThreshold, 7);
  assert.equal(loaded.nativeAgent.chunkMaxChars, 4_000);
  assert.equal(loaded.nativeAgent.chunkOverlapChars, 400);
  assert.equal(loaded.nativeAgent.chunkMinChars, 200);
  assert.equal(loaded.nativeAgent.chunkMaxCount, 50);
  assert.equal("obsoleteNestedField" in loaded.nativeAgent, false);
  assert.equal("obsoleteOperation" in loaded.nativeAgent.operations, false);
  assert.deepEqual(loaded.nativeAgent.operations.query, {
    model: "query-model",
    temperature: 0.4,
    inputBudgetTokens: 20_000,
    maxTokens: 3_000,
    thinkingBudgetTokens: 64,
    compressionProfile: "minimum",
  });
  assert.equal((loaded.timeouts as Record<string, unknown>).obsoleteTimeout, undefined);
  assert.deepEqual(loaded.history, [{
    id: "run-1",
    operation: "query",
    args: ["question"],
    domainId: "work",
    startedAt: 1,
    finishedAt: 2,
    status: "done",
    finalText: "answer",
    steps: [{ kind: "tool_use", label: "search" }],
  }]);
  assert.deepEqual(loaded.proxy, {
    enabled: true,
    url: "https://proxy.example",
    username: "proxy-user",
    noProxy: "localhost",
  });
  assert.deepEqual(loaded.vision, {
    enabled: true,
    model: "vision-model",
    compressionProfile: "maximum",
  });
  assert.deepEqual(loaded.devMode, {
    enabled: true,
    nativeTransportDiagnosticMode: "connection-close",
  });
  assert.deepEqual(loaded.lintOptions, { useLlm: false });
  assert.equal(loaded.historyLimit, 37);
});

test("serializing hydrated settings emits only the current schema", () => {
  const saved = JSON.parse(JSON.stringify(hydrateSettings({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet" },
    nativeAgent: {
      baseUrl: "http://localhost:11434/v1",
      model: "local",
      operations: { format: { model: "format", temperature: 0.1, maxTokens: 8_192 } },
    },
  }))) as Record<string, unknown>;

  assert.equal(saved.backend, undefined);
  assert.equal(saved.claudeAgent, undefined);
  assert.equal((saved.nativeAgent as { model: string }).model, "local");
  assert.equal(
    ((saved.nativeAgent as { operations: { format: { maxTokens?: number } } })
      .operations.format.maxTokens),
    8_192,
  );
});

test("history arguments are copied and retain only string values", () => {
  const args = ["first", 42, "second"];
  const loaded = hydrateSettings({
    history: [{
      id: "run-1",
      operation: "query",
      args,
      startedAt: 1,
      finishedAt: 2,
      status: "done",
      finalText: "answer",
      steps: [],
    }],
  });

  assert.deepEqual(loaded.history[0].args, ["first", "second"]);
  assert.notEqual(loaded.history[0].args, args);
  loaded.history[0].args.push("third");
  assert.deepEqual(args, ["first", 42, "second"]);
});
