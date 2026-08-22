import assert from "node:assert/strict";
import test from "node:test";
import { hydrateSettings } from "../src/settings-persistence";

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
