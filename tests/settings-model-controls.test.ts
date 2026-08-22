import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

import {
  applyBudgetInput,
  backendModelControlDescriptor,
  createLiveModelControl,
  normalizePersistedModelControls,
  parsePositiveBudgetInput,
  renderModelControlFields,
  renderNativeBudgetControls,
  resolveCallPolicy,
} from "../src/model-call-policy";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import { hydrateSettings } from "../src/settings-persistence";
import type { ModelContextRecord } from "../src/model-context";
import { runNativeVisionModelCheck } from "../src/vision-probe";
import { clearNativeBudgets, hasStoredNativeBudget, settleOnce } from "../src/auto-budget-notice";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

function probeRecord(): ModelContextRecord {
  return { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 };
}
const { i18nFor } = await import("../src/i18n");
const runtimeControls = await import("../src/types") as unknown as Record<string, unknown>;
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const modalsSource = readFileSync(new URL("../src/modals.ts", import.meta.url), "utf8");

function assertSourceOrder(source: string, markers: readonly string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const position = source.indexOf(marker, previous + 1);
    assert.notEqual(position, -1, `missing settings layout marker: ${marker}`);
    assert.ok(position > previous, `settings layout marker is out of order: ${marker}`);
    previous = position;
  }
}

function sourceBlock(
  source: string,
  marker: string,
  from = 0,
): { start: number; end: number; body: string } {
  const start = source.indexOf(marker, from);
  assert.notEqual(start, -1, `missing settings block marker: ${marker}`);
  const open = source.indexOf("{", start + marker.length - 1);
  assert.notEqual(open, -1, `missing opening brace after: ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) {
      return { start, end: index + 1, body: source.slice(open + 1, index) };
    }
  }
  assert.fail(`missing closing brace after: ${marker}`);
}

function assertSingleHeading(source: string): void {
  assert.equal(
    source.match(/\.setHeading\(\)/g)?.length ?? 0,
    1,
    "chat-model controls must not be split by an intervening heading",
  );
}

test("old settings gain model controls without changing output budgets", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.maxTokens = 7777;
  settings.nativeAgent.operations.query.maxTokens = 3333;
  delete (settings.nativeAgent as { inputBudgetTokens?: unknown }).inputBudgetTokens;
  delete (settings.nativeAgent as { compressionProfile?: unknown }).compressionProfile;
  delete (settings.nativeAgent.operations.query as { inputBudgetTokens?: unknown }).inputBudgetTokens;

  normalizePersistedModelControls(settings);

  assert.equal(settings.nativeAgent.maxTokens, 7777);
  assert.equal(settings.nativeAgent.operations.query.maxTokens, 3333);
  // Native input budgets are optional: normalization leaves an absent value absent
  // (it is derived from the model context later) instead of inventing a constant.
  assert.equal(settings.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.operations.query.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.compressionProfile, "balanced");
  assert.equal(settings.nativeAgent.operations.query.compressionProfile, undefined);
});

test("normalization preserves valid overrides and removes invalid ones", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.vision.compressionProfile = "minimum";
  settings.nativeAgent.operations.ingest.compressionProfile = "maximum";
  (settings.nativeAgent.operations.query as { compressionProfile?: unknown }).compressionProfile = "invalid";
  (settings.vision as { compressionProfile?: unknown }).compressionProfile = "invalid";

  normalizePersistedModelControls(settings);

  assert.equal(settings.nativeAgent.operations.ingest.compressionProfile, "maximum");
  assert.equal(settings.nativeAgent.operations.query.compressionProfile, undefined);
  assert.equal(settings.vision.compressionProfile, undefined);
});

test("positive budget parser accepts only strict positive integers and preserves prior values", () => {
  assert.equal(parsePositiveBudgetInput("12345", 777), 12345);
  assert.equal(parsePositiveBudgetInput(" 42 ", 777), 42);
  for (const input of ["", "0", "-1", "1.5", "1e3", "Infinity", "12px"]) {
    assert.equal(parsePositiveBudgetInput(input, 777), 777, input);
  }
});

test("runtime controls keep top-level 3/15/300 defaults", () => {
  assert.equal(DEFAULT_SETTINGS.llmIdleRetries, 3);
  assert.equal(DEFAULT_SETTINGS.llmConnectionTimeoutSec, 15);
  assert.equal(DEFAULT_SETTINGS.llmIdleTimeoutSec, 300);
  assert.equal("llmIdleRetries" in DEFAULT_SETTINGS.nativeAgent, false);
  assert.equal("llmConnectionTimeoutSec" in DEFAULT_SETTINGS.nativeAgent, false);
  assert.equal("llmIdleTimeoutSec" in DEFAULT_SETTINGS.nativeAgent, false);
});

test("native transport diagnostic mode defaults and normalizes to off without Settings UI", () => {
  const normalize = runtimeControls.normalizeLlmRuntimeControls as (
    value: LlmWikiPluginSettings,
  ) => void;
  assert.equal(DEFAULT_SETTINGS.devMode.nativeTransportDiagnosticMode, "off");
  assert.doesNotMatch(settingsSource, /nativeTransportDiagnosticMode/);

  const valid = structuredClone(DEFAULT_SETTINGS);
  valid.devMode.enabled = true;
  valid.devMode.nativeTransportDiagnosticMode = "connection-close";
  normalize(valid);
  assert.equal(valid.devMode.nativeTransportDiagnosticMode, "connection-close");

  const undiciAdapter = structuredClone(DEFAULT_SETTINGS);
  undiciAdapter.devMode.enabled = true;
  undiciAdapter.devMode.nativeTransportDiagnosticMode = "undici-request-adapter";
  normalize(undiciAdapter);
  assert.equal(undiciAdapter.devMode.nativeTransportDiagnosticMode, "undici-request-adapter");

  const disabledDevMode = structuredClone(DEFAULT_SETTINGS);
  disabledDevMode.devMode.enabled = false;
  disabledDevMode.devMode.nativeTransportDiagnosticMode = "undici-request-adapter";
  normalize(disabledDevMode);
  assert.equal(disabledDevMode.devMode.nativeTransportDiagnosticMode, "off");

  const invalid = structuredClone(DEFAULT_SETTINGS);
  invalid.devMode.enabled = true;
  (invalid.devMode as { nativeTransportDiagnosticMode: unknown }).nativeTransportDiagnosticMode = "invalid";
  normalize(invalid);
  assert.equal(invalid.devMode.nativeTransportDiagnosticMode, "off");
});

test("persisted top-level runtime controls round-trip and saved idle 600 survives", () => {
  const normalize = runtimeControls.normalizeLlmRuntimeControls;
  assert.equal(typeof normalize, "function");
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.llmIdleRetries = 7;
  settings.llmConnectionTimeoutSec = 45;
  settings.llmIdleTimeoutSec = 600;

  (normalize as (value: LlmWikiPluginSettings) => void)(settings);

  assert.equal(settings.llmIdleRetries, 7);
  assert.equal(settings.llmConnectionTimeoutSec, 45);
  assert.equal(settings.llmIdleTimeoutSec, 600);
  assert.match(mainSource, /this\.settings = hydrateSettings\(data\)/);
});

test("runtime control validation rejects fractions, unsafe idle timers, and invalid minima", () => {
  const parseRetries = runtimeControls.parseLlmRetryCount;
  const parseConnection = runtimeControls.parseLlmConnectionTimeoutSec;
  const parseIdle = runtimeControls.parseLlmIdleTimeoutSec;
  assert.equal(typeof parseRetries, "function");
  assert.equal(typeof parseConnection, "function");
  assert.equal(typeof parseIdle, "function");

  const retries = parseRetries as (value: unknown, previous: number) => number;
  const connection = parseConnection as (value: unknown, previous: number) => number;
  const idle = parseIdle as (value: unknown, previous: number) => number;
  assert.equal(retries("0", 9), 0);
  assert.equal(retries("4", 9), 4);
  assert.equal(connection("1", 9), 1);
  assert.equal(idle("0", 9), 0);
  assert.equal(idle("2146999", 9), 2_146_999);
  for (const value of ["", "-1", "1.5", "1e3", "Infinity", "12px"]) {
    assert.equal(retries(value, 9), 9, `retry:${value}`);
  }
  for (const value of ["", "0", "-1", "1.5", "1e3", "Infinity", "12px"]) {
    assert.equal(connection(value, 9), 9, `connection:${value}`);
  }
  for (const value of ["", "-1", "1.5", "1e3", "2147000", "Infinity", "12px"]) {
    assert.equal(idle(value, 9), 9, `idle:${value}`);
  }
});

test("native-only connection control and backend-specific idle/retry labels", () => {
  const runtimeControlsStart = settingsSource.indexOf(".setName(T.settings.timeouts_name)");
  const nativeConnectionBlock = sourceBlock(
    settingsSource,
    'if (eff.backend === "native-agent")',
    runtimeControlsStart,
  );
  assert.match(nativeConnectionBlock.body, /T\.settings\.llmConnectionTimeout_name/);
  assert.match(nativeConnectionBlock.body, /T\.settings\.llmConnectionTimeout_desc/);
  assert.ok(
    nativeConnectionBlock.end < settingsSource.indexOf("T.settings.llmRequestIdleTimeout_name"),
    "shared idle control must remain outside the native-only connection block",
  );
  assert.match(
    settingsSource,
    /eff\.backend === "native-agent"\s*\? T\.settings\.llmRequestIdleTimeout_name\s*:\s*T\.settings\.llmIdleTimeout_name/,
  );
  assert.match(
    settingsSource,
    /eff\.backend === "native-agent"\s*\? T\.settings\.llmRequestIdleTimeout_desc\s*:\s*T\.settings\.llmIdleTimeout_desc/,
  );
  assert.match(
    settingsSource,
    /eff\.backend === "native-agent"\s*\? T\.settings\.llmRequestRetries_name\s*:\s*T\.settings\.llmIdleRetries_name/,
  );
  assert.match(
    settingsSource,
    /eff\.backend === "native-agent"\s*\? T\.settings\.llmRequestRetries_desc\s*:\s*T\.settings\.llmIdleRetries_desc/,
  );
  for (const lang of ["en", "ru", "es"] as const) {
    const labels = i18nFor(lang).settings;
    assert.ok(labels.llmConnectionTimeout_name.length > 0, lang);
    assert.ok(labels.llmRequestIdleTimeout_name.length > 0, lang);
    assert.ok(labels.llmRequestRetries_name.length > 0, lang);
    assert.match(labels.llmConnectionTimeout_desc, /mobile|мобиль|móvil/i, lang);
  }
});

test("EN, RU, and ES settings bundles have identical keys", () => {
  const keys = (lang: "en" | "ru" | "es") =>
    Object.keys(i18nFor(lang).settings).sort();
  assert.deepEqual(keys("ru"), keys("en"));
  assert.deepEqual(keys("es"), keys("en"));
});

test("backend descriptors expose exact Task15 fields and Format exclusions", () => {
  const native = backendModelControlDescriptor("native-agent");
  assert.deepEqual(native.globalFields, [
    "inputBudgetTokens",
    "maxTokens",
    "compressionProfile",
  ]);
  assert.deepEqual(native.operations.ingest, native.globalFields);
  assert.deepEqual(native.operations.query, native.globalFields);
  assert.deepEqual(native.operations.lint, native.globalFields);
  assert.deepEqual(native.operations.init, native.globalFields);
  assert.deepEqual(native.operations.format, ["inputBudgetTokens", "maxTokens"]);
  assert.deepEqual(native.vision, {
    fields: [],
    check: true,
  });

  const claude = backendModelControlDescriptor("claude-agent");
  assert.deepEqual(claude.globalFields, ["inputBudgetTokens", "compressionProfile"]);
  assert.deepEqual(claude.operations.ingest, claude.globalFields);
  assert.deepEqual(claude.operations.query, claude.globalFields);
  assert.deepEqual(claude.operations.lint, claude.globalFields);
  assert.deepEqual(claude.operations.init, claude.globalFields);
  assert.deepEqual(claude.operations.format, ["inputBudgetTokens"]);
  assert.deepEqual(claude.vision, {
    fields: [],
    check: false,
  });
});

test("render-plan executor consumes every descriptor branch exactly", () => {
  for (const backend of ["native-agent", "claude-agent"] as const) {
    const plan = backendModelControlDescriptor(backend);
    const rendered = (fields: typeof plan.globalFields): string[] => {
      const seen: string[] = [];
      renderModelControlFields(fields, {
        inputBudgetTokens: () => { seen.push("inputBudgetTokens"); },
        maxTokens: () => { seen.push("maxTokens"); },
        compressionProfile: () => { seen.push("compressionProfile"); },
      });
      return seen;
    };

    assert.deepEqual(rendered(plan.globalFields), plan.globalFields);
    for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
      assert.deepEqual(rendered(plan.operations[key]), plan.operations[key], `${backend}:${key}`);
    }
    assert.deepEqual(rendered(plan.vision.fields), plan.vision.fields);
  }
});

test("native chat-model block stays localized and structurally valid in both modes", () => {
  const start = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();",
  );
  const end = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_semanticSearch).setHeading();",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const native = settingsSource.slice(start, end);
  const heading = native.indexOf(".setName(T.settings.h3_defaultChatModel)");
  const perOperation = native.indexOf(
    ".setName(T.settings.perOperation_name).setHeading()",
  );
  assert.ok(heading >= 0 && perOperation > heading);
  assertSingleHeading(native.slice(heading, perOperation));

  const falseOnly = sourceBlock(native, "if (!s.nativeAgent.perOperation) {");
  assert.ok(heading < falseOnly.start, "heading must render when perOperation is true");
  assert.match(falseOnly.body, /\.setName\(T\.settings\.model_name\)/);
  assert.doesNotMatch(native, /\.setName\("Thinking budget tokens"\)/);
  assert.doesNotMatch(falseOnly.body, /modelControls\.globalFields/);

  const policy = native.indexOf("modelControls.globalFields,", falseOnly.end);
  assert.ok(policy > falseOnly.end, "fallback policy must render when perOperation is true");
  const temperatureOnly = sourceBlock(
    native,
    "if (!s.nativeAgent.perOperation) {",
    falseOnly.end,
  );
  assert.ok(temperatureOnly.start > policy);
  assert.match(temperatureOnly.body, /\.setName\(T\.settings\.temperature_name\)/);

  assertSourceOrder(native, [
    ".setName(T.settings.baseUrl_name)",
    ".setName(T.settings.apiKey_name)",
    ".setName(T.settings.h3_defaultChatModel)",
    ".setName(T.settings.model_name)",
    "modelControls.globalFields,",
    ".setName(T.settings.temperature_name)",
    ".setName(T.settings.perOperation_name).setHeading()",
    "if (s.nativeAgent.perOperation) {",
  ]);
});

test("Claude chat-model block stays localized and structurally valid in both modes", () => {
  const start = settingsSource.indexOf(
    'if (eff.backend === "claude-agent" && !Platform.isMobile) {',
  );
  const end = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const claude = settingsSource.slice(start, end);
  const heading = claude.indexOf(".setName(T.settings.h3_defaultChatModel)");
  const perOperation = claude.indexOf("if (s.claudeAgent.perOperation) {");
  assert.ok(heading >= 0 && perOperation > heading);
  assertSingleHeading(claude.slice(heading, perOperation));

  const falseOnly = sourceBlock(claude, "if (!s.claudeAgent.perOperation) {");
  assert.ok(heading < falseOnly.start, "heading must render when perOperation is true");
  assert.match(falseOnly.body, /\.setName\(T\.settings\.model_name\)/);
  assert.doesNotMatch(falseOnly.body, /modelControls\.globalFields|Effort level/);

  const policy = claude.indexOf("modelControls.globalFields,", falseOnly.end);
  const effort = claude.indexOf('.setName("Effort level")', policy);
  assert.ok(policy > falseOnly.end, "fallback policy must render when perOperation is true");
  assert.ok(effort > policy && effort < perOperation, "fallback effort must stay in the chat-model block");

  assertSourceOrder(claude, [
    ".setName(T.settings.iclaudePath_name)",
    ".setName(T.settings.allowedTools_name)",
    ".setName(T.settings.h3_defaultChatModel)",
    ".setName(T.settings.model_name)",
    "modelControls.globalFields,",
    '.setName("Effort level")',
    ".setName(T.settings.perOperation_name)",
    "if (s.claudeAgent.perOperation) {",
  ]);
});

test("settings source contains no hardcoded global model heading", () => {
  assert.doesNotMatch(settingsSource, /Global model defaults/);
});

test("Vision Check sends unsaved typed model without mutating persisted settings or vault", async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.vision.model = "persisted-model";
  const original = structuredClone(settings);
  const vault = { writes: [] as string[] };
  const originalVault = structuredClone(vault);
  let saves = 0;
  let sentModel = "";
  const notices: string[] = [];
  const control = createLiveModelControl(
    settings.vision.model,
    async (model) => {
      saves++;
      settings.vision.model = model;
    },
    false,
  );

  await control.type("unsaved-live-model");
  await control.check(async (currentModel) => {
    await runNativeVisionModelCheck({
      baseUrl: "https://provider.example/v1",
      apiKey: "secret",
      model: currentModel,
      timeoutMs: 100,
      request: async ({ body }) => {
        sentModel = JSON.parse(body).model as string;
        return {
          status: 200,
          text: JSON.stringify({ choices: [{ message: { content: "pixel" } }] }),
        };
      },
      messages: {
        missing: "missing",
        success: "success",
        details: {
          timeout: "timeout-detail",
          http: "http-detail",
          malformed: "malformed-detail",
          empty: "empty-detail",
        },
        failure: (message) => `failure:${message}`,
      },
      notify: (message) => { notices.push(message); },
    });
  });

  assert.equal(sentModel, "unsaved-live-model");
  assert.deepEqual(settings, original);
  assert.deepEqual(vault, originalVault);
  assert.equal(saves, 0);
  assert.deepEqual(notices, ["success"]);
});

test("all locales wrap exact localized details for every probe failure code", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
  });
  const expectedDetails = {
    en: {
      timeout: "The Vision request timed out.",
      http: "The Vision endpoint returned an HTTP or transport error.",
      malformed: "The Vision endpoint returned malformed JSON.",
      empty: "The Vision model returned an empty response.",
    },
    ru: {
      timeout: "Время ожидания Vision-запроса истекло.",
      http: "Vision endpoint вернул HTTP-ошибку или ошибку транспорта.",
      malformed: "Vision endpoint вернул некорректный JSON.",
      empty: "Vision-модель вернула пустой ответ.",
    },
    es: {
      timeout: "La solicitud Vision agotó el tiempo de espera.",
      http: "El endpoint Vision devolvió un error HTTP o de transporte.",
      malformed: "El endpoint Vision devolvió JSON no válido.",
      empty: "El modelo Vision devolvió una respuesta vacía.",
    },
  } as const;

  try {
    for (const lang of ["en", "ru", "es"] as const) {
      const T = i18nFor(lang).settings;
      assert.deepEqual({
        timeout: T.visionCheck_timeout,
        http: T.visionCheck_http,
        malformed: T.visionCheck_malformed,
        empty: T.visionCheck_empty,
      }, expectedDetails[lang]);
      const cases = [
      {
        code: "http",
        detail: T.visionCheck_http,
        request: async () => ({ status: 401, text: "denied" }),
        timeoutMs: 100,
      },
      {
        code: "malformed",
        detail: T.visionCheck_malformed,
        request: async () => ({ status: 200, text: "not-json" }),
        timeoutMs: 100,
      },
      {
        code: "empty",
        detail: T.visionCheck_empty,
        request: async () => ({
          status: 200,
          text: JSON.stringify({ choices: [{ message: { content: "" } }] }),
        }),
        timeoutMs: 100,
      },
      {
        code: "timeout",
        detail: T.visionCheck_timeout,
        request: async () => new Promise<never>(() => undefined),
        timeoutMs: 1,
      },
      ] as const;

      for (const item of cases) {
        const notices: string[] = [];
        await runNativeVisionModelCheck({
          baseUrl: "https://provider.example/v1",
          apiKey: "k",
          model: "m",
          request: item.request,
          timeoutMs: item.timeoutMs,
          messages: {
            missing: T.visionCheck_missing,
            success: T.visionCheck_ok("m"),
            details: {
              timeout: T.visionCheck_timeout,
              http: T.visionCheck_http,
              malformed: T.visionCheck_malformed,
              empty: T.visionCheck_empty,
            },
            failure: T.visionCheck_failed,
          },
          notify: (message) => { notices.push(message); },
        });
        assert.deepEqual(
          notices,
          [T.visionCheck_failed(item.detail)],
          `${lang}:${item.code}`,
        );
      }
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("chat, reranker, and vision checks use one localized success format", () => {
  const expected = {
    en: [
      '✅ Chat model responds: "chat-model"',
      '✅ Reranker model responds: "rerank-model"',
      '✅ Vision model responds: "vision-model"',
    ],
    ru: [
      '✅ Chat model отвечает: "chat-model"',
      '✅ Reranker model отвечает: "rerank-model"',
      '✅ Vision model отвечает: "vision-model"',
    ],
    es: [
      '✅ El modelo Chat responde: "chat-model"',
      '✅ El modelo Reranker responde: "rerank-model"',
      '✅ El modelo Vision responde: "vision-model"',
    ],
  } as const;

  for (const lang of ["en", "ru", "es"] as const) {
    const T = i18nFor(lang).settings;
    assert.deepEqual([
      T.chatCheck_ok("chat-model"),
      T.rerankerCheck_ok("rerank-model"),
      T.visionCheck_ok("vision-model"),
    ], expected[lang]);
  }
});

test("model suggestion updates current value and commits through existing callback", async () => {
  let persisted = "old";
  const checked: string[] = [];
  const control = createLiveModelControl(
    persisted,
    async (model) => { persisted = model; },
    false,
  );

  await control.select("suggested");
  await control.check(async (model) => { checked.push(model); });

  assert.equal(persisted, "suggested");
  assert.deepEqual(checked, ["suggested"]);
});

test("Vision compression override is legacy-only and ignored by Format policy", () => {
  const settings: LlmWikiPluginSettings = structuredClone(DEFAULT_SETTINGS);
  settings.vision.compressionProfile = "maximum";
  settings.nativeAgent.compressionProfile = "minimum";
  assert.equal(settings.vision.compressionProfile, "maximum");

  const format = resolveCallPolicy(settings, "format", probeRecord());
  assert.equal(format.policy.compression, undefined);
  assert.equal(format.opts.semanticCompression, undefined);
});

test("Format compression fields are ignored and no compression policy is produced", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.perOperation = true;
  settings.nativeAgent.compressionProfile = "minimum";
  settings.nativeAgent.operations.format.compressionProfile = "maximum";

  normalizePersistedModelControls(settings);
  const format = resolveCallPolicy(settings, "format", probeRecord());
  assert.equal(format.policy.compression, undefined);
  assert.equal(format.opts.semanticCompression, undefined);

  assert.equal(settings.nativeAgent.operations.format.compressionProfile, undefined);
});

test("an automatic budget still renders a control", () => {
  const rendered = renderNativeBudgetControls({ inputBudgetTokens: undefined }, "Automatic");
  assert.equal(rendered.length, 1, "an undefined value must not hide the field");
  assert.equal(rendered[0].value, "");
  assert.equal(rendered[0].placeholder, "Automatic");
});

test("a stored override still renders its number, not the automatic placeholder", () => {
  const rendered = renderNativeBudgetControls({ inputBudgetTokens: 24_000 }, "Automatic");
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].value, "24000");
  assert.equal(rendered[0].placeholder, "24000");
});

test("clearing the field deletes the setting rather than keeping the old number", () => {
  const holder: { inputBudgetTokens?: number } = { inputBudgetTokens: 24_000 };
  applyBudgetInput(holder, "inputBudgetTokens", "");
  assert.equal("inputBudgetTokens" in holder, false);
});

test("a valid edit overwrites the stored override, and an invalid one is ignored", () => {
  const holder: { inputBudgetTokens?: number } = { inputBudgetTokens: 24_000 };
  applyBudgetInput(holder, "inputBudgetTokens", "32000");
  assert.equal(holder.inputBudgetTokens, 32_000);
  applyBudgetInput(holder, "inputBudgetTokens", "not-a-number");
  assert.equal(holder.inputBudgetTokens, 32_000, "an invalid entry must keep the previous value");
  applyBudgetInput(holder, "inputBudgetTokens", "0");
  assert.equal(holder.inputBudgetTokens, 32_000, "0 is not a strictly positive integer");
});

test("native budgets are optional by default, so the settings tab must not hide them", () => {
  assert.equal(DEFAULT_SETTINGS.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(DEFAULT_SETTINGS.nativeAgent.maxTokens, undefined);
  assert.equal(DEFAULT_SETTINGS.nativeAgent.repairInputBudgetTokens, undefined);
});

test("addPolicyControls renders a native automatic field even when its value is undefined", () => {
  // The shared render() helpers (used by both backends) sit before either branch.
  // Task 7 left a guard in addPolicyControls that returned early on `undefined`,
  // hiding the control entirely; it must now only guard the non-automatic (claude) path.
  const start = settingsSource.indexOf("const addAutomaticBudgetControl = (");
  const end = settingsSource.indexOf("const busy = this.plugin.controller.running;", start);
  assert.ok(start >= 0 && end > start);
  const body = settingsSource.slice(start, end);
  assert.match(body, /T\.settings\.budgetAutomatic/);
  assert.match(body, /addAutomaticBudgetControl/);
  assert.match(body, /automatic\?\.updates\.inputBudgetTokens/);
  assert.match(body, /automatic\?\.updates\.maxTokens/);
  // The carried-forward guard must be reachable only after the automatic branch
  // returns — i.e. it still exists, but no longer fires for an automatic field.
  assert.match(body, /values\.inputBudgetTokens === undefined \|\| !updates\.inputBudgetTokens\) return;/);
  // F1: no heading, and no "Advanced" grouping string anywhere — the automatic
  // fields render inline, exactly where the fixed fields used to render, so
  // compressionProfile is never visually grouped under a budgets-only heading.
  assert.doesNotMatch(settingsSource, /advancedBudgets_name/);
  assert.doesNotMatch(settingsSource, /Advanced: manual budgets/);
  // Minor: automaticBudgetPlaceholders is named once per addPolicyControls
  // invocation (assigned to `placeholders`) and both fields read from it, rather
  // than each field spelling out the same {input, output} lookup. It is a thunk so
  // a repaint recomputes it — see the stale-placeholder test below.
  const policyStart = settingsSource.indexOf("const addPolicyControls = (");
  const policyBody = settingsSource.slice(policyStart, end);
  assert.ok(policyStart > start);
  assert.match(policyBody, /const placeholders = automatic\s*\n\s*\? \(\) => automaticBudgetPlaceholders\(/);
  assert.equal(
    (policyBody.match(/automaticBudgetPlaceholders\(/g) ?? []).length,
    1,
    "automaticBudgetPlaceholders must be named once per addPolicyControls invocation",
  );
  assert.match(body, /placeholders!\(\)\.input/);
  assert.match(body, /placeholders!\(\)\.output/);
});

test("a changed context window repaints the dependent placeholders without re-rendering the tab", () => {
  // The defect: placeholders were computed at render time and the window field's
  // onChange never refreshed them, so the derived budget numbers went on showing
  // the old window until the tab was reopened. The fix must not be a re-render:
  // onChange fires once per typed character and this.display() would rebuild the
  // input the user is typing into.
  const start = settingsSource.indexOf("const automaticControls: Array<");
  const end = settingsSource.indexOf("const automaticBudgetPlaceholders = (", start);
  assert.ok(start >= 0 && end > start);
  const body = settingsSource.slice(start, end);

  // Every automatic control registers a repaint, and a committed edit runs them.
  assert.match(body, /automaticControls\.push\(repaint\)/);
  assert.match(body, /text\.setPlaceholder\(rendered\.placeholder\)/);
  assert.match(body, /refreshAutomaticControls\(\);/);
  // A repaint rewrites the value only when explicitly asked to (a model change),
  // never on the placeholder-only path a keystroke takes: rewriting the value while
  // the user types would clobber a half-entered number.
  assert.match(body, /if \(resetValue\) text\.setValue\(rendered\.value\);/);
  assert.doesNotMatch(body, /this\.display\(\)/, "no re-render inside the automatic control");

  // …and the value/placeholder sources are lazy, so a repaint sees current settings.
  assert.match(body, /value: \(\) => number \| undefined/);
  assert.match(body, /placeholder: \(\) => string/);
});

test("the context window renders next to every model field, and never on the claude path", () => {
  const claudeStart = settingsSource.indexOf(
    'if (eff.backend === "claude-agent" && !Platform.isMobile) {',
  );
  const claudeEnd = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();",
    claudeStart,
  );
  const nativeEnd = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_vision).setHeading();",
    claudeEnd,
  );
  assert.ok(claudeStart >= 0 && claudeEnd > claudeStart && nativeEnd > claudeEnd);
  const claudeBlock = settingsSource.slice(claudeStart, claudeEnd);
  const nativeBlock = settingsSource.slice(claudeEnd, nativeEnd);
  const visionBlock = settingsSource.slice(nativeEnd);

  // One helper, rendered through the same automatic-field control as every other
  // budget, keyed by the model the field sits next to, and cleared back to automatic
  // by assigning `undefined` (what applyBudgetInput does on an empty entry).
  const helperStart = settingsSource.indexOf("const addContextWindowControl = (");
  const helperEnd = settingsSource.indexOf("const addCompressionControl = (", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = settingsSource.slice(helperStart, helperEnd);
  assert.match(
    helper,
    /addAutomaticBudgetControl\(\s*\n\s*new Setting\(containerEl\)\s*\n\s*\.setName\(T\.settings\.contextWindowTokens_name\)/,
  );
  assert.match(helper, /configuredContextWindowFor\(s\.nativeAgent, model\(\)\)/);
  assert.match(helper, /setConfiguredContextWindow\(s\.nativeAgent, model\(\), next\)/);
  assert.match(helper, /\)\.contextWindow,/);
  assert.match(helper, /MIN_CONTEXT_WINDOW/);
  // Automatic budgeting — and this field with it — is native-agent only, and the
  // field only exists for a role that names a model of its own.
  assert.match(helper, /if \(eff\.backend !== "native-agent" \|\| !model\(\)\) return;/);

  // Next to the global chat model, next to each per-operation model, next to vision.
  assert.match(nativeBlock, /addContextWindowControl\(\(\) => s\.nativeAgent\.model\)/);
  assert.match(nativeBlock, /addContextWindowControl\(\(\) => effectiveModel\(s, key\)\)/);
  assert.match(visionBlock, /addContextWindowControl\(\(\) => s\.vision\.model\)/);

  assert.doesNotMatch(claudeBlock, /contextWindowTokens/);
  assert.doesNotMatch(claudeBlock, /addContextWindowControl/);
  // The placeholder is still read from the cached record, never probed at render time.
  assert.doesNotMatch(nativeBlock, /probeContextWindow/);
  assert.doesNotMatch(helper, /probeContextWindow/);
});

test("a configured window is honoured by the settings placeholders before any run", async () => {
  const { configuredContextRecord, plausibleContextWindow } = await import("../src/model-context");
  const { resolveBudget } = await import("../src/budget-resolver");

  const record = configuredContextRecord(131_072, { contextWindow: 8_192, source: "default", calibration: 1.2, samples: 3 });
  assert.equal(record.source, "configured");
  assert.equal(record.calibration, 1.2, "calibration measures the estimator, not the window");

  const budget = resolveBudget(record, "init", {});
  assert.equal(budget.contextWindow, 131_072);
  assert.equal(budget.inputBudgetTokens, 110_592);
  assert.equal(budget.outputBudgetTokens, 8_192);
  assert.equal(budget.inputSource, "configured", "the source names the setting, not a probe");

  // Format's x4 output multiplier and the input budget both follow the same window.
  const format = resolveBudget(record, "format", {});
  assert.equal(format.outputBudgetTokens, 32_768);
  assert.equal(format.inputBudgetTokens, 88_473);

  // A stored input override still wins over the derived value, and says so.
  const overridden = resolveBudget(record, "init", { input: 24_000 });
  assert.equal(overridden.inputBudgetTokens, 24_000);
  assert.equal(overridden.inputSource, "override");

  assert.equal(plausibleContextWindow(undefined), null);
  assert.equal(plausibleContextWindow(12), null, "an implausible window falls back to probing");
  assert.equal(plausibleContextWindow(131_072), 131_072);
});

test("the 8192 fallback is never advertised as a model's own context window", async () => {
  const { placeholderContextWindow } = await import("../src/model-context");

  // The defect: every non-configured cached record was treated as authoritative, so a
  // gateway that advertises nothing made the Vision window field show 8192 — the one
  // number `resolveVisionBudget` refuses to size the vision model from. A user who
  // read it as "already known" left the field empty and vision stayed on the Format
  // operation's budget.
  assert.equal(
    placeholderContextWindow({
      contextWindow: 8_192, source: "default", calibration: 1, samples: 0,
      expiresAt: Date.now() + 86_400_000,
    }),
    null,
    "a fallback is not a measurement of this model",
  );
  // Everything the engine does treat as a fact about the model still shows its number.
  for (const source of ["discovered", "configured", "learned"] as const) {
    assert.equal(
      placeholderContextWindow({ contextWindow: 131_072, source, calibration: 1, samples: 0 }),
      131_072,
      `${source} is a fact about the model`,
    );
  }

  // …and the settings placeholder reports the window through it. The derived input
  // and output budgets keep coming from the record, fallback included: those are the
  // numbers the next run will actually use.
  const start = settingsSource.indexOf("const automaticBudgetPlaceholders = (");
  const end = settingsSource.indexOf("const addContextWindowControl = (", start);
  assert.ok(start >= 0 && end > start);
  const body = settingsSource.slice(start, end);
  assert.match(body, /placeholderContextWindow\(record\)/);
  assert.match(body, /contextWindow: window === null \? automatic : String\(window\)/);
  assert.doesNotMatch(body, /contextWindow: String\(record\.contextWindow\)/);
  assert.match(body, /input: String\(budget\.inputBudgetTokens\)/);
});

test("a context window below the engine's floor is refused at entry, not stored and ignored", async () => {
  const { MIN_CONTEXT_WINDOW } = await import("../src/model-context");
  assert.equal(MIN_CONTEXT_WINDOW, 1_024);

  // The engine refuses anything under the floor, so the field must refuse it too:
  // storing 512 would show the user a number nothing is budgeting from.
  const holder: { contextWindowTokens?: number } = { contextWindowTokens: 131_072 };
  applyBudgetInput(holder, "contextWindowTokens", "512", MIN_CONTEXT_WINDOW);
  assert.equal(holder.contextWindowTokens, 131_072, "a sub-floor entry keeps the previous value");
  applyBudgetInput(holder, "contextWindowTokens", "1024", MIN_CONTEXT_WINDOW);
  assert.equal(holder.contextWindowTokens, 1_024, "the floor itself is accepted");
  applyBudgetInput(holder, "contextWindowTokens", "", MIN_CONTEXT_WINDOW);
  assert.equal("contextWindowTokens" in holder, false, "clearing still returns to automatic");

  // Budget fields keep their 1-token floor: only the window control passes a minimum.
  const budgets: { inputBudgetTokens?: number } = {};
  applyBudgetInput(budgets, "inputBudgetTokens", "512");
  assert.equal(budgets.inputBudgetTokens, 512);

  // The control wires the floor through, and the description states the range.
  assert.match(settingsSource, /MIN_CONTEXT_WINDOW/);
  for (const lang of ["en", "ru", "es"] as const) {
    assert.match(i18nFor(lang).settings.contextWindowTokens_desc, /1024/, lang);
  }
});

test("a persisted context window below the floor is dropped, not displayed", () => {
  // Legacy single-value shape: a sub-floor number is dropped rather than migrated
  // onto every model.
  const settings = structuredClone(DEFAULT_SETTINGS);
  (settings.nativeAgent as { contextWindowTokens?: number }).contextWindowTokens = 512;
  normalizePersistedModelControls(settings);
  assert.equal(
    (settings.nativeAgent as { contextWindowTokens?: number }).contextWindowTokens, undefined,
  );
  assert.equal(settings.nativeAgent.contextWindowTokensByModel, undefined);
});

test("a cleared setting stops the placeholder from advertising the old configured window", () => {
  // resolve() already refuses a `configured` record once the setting is gone; the
  // placeholder must refuse it too, or it advertises a window nothing will use.
  const start = settingsSource.indexOf("const automaticBudgetPlaceholders = (");
  const end = settingsSource.indexOf("const addCompressionControl = (", start);
  assert.ok(start >= 0 && end > start);
  const body = settingsSource.slice(start, end);
  assert.match(body, /cached\?\.source === "configured" \? undefined : cached/);
});

test("a persisted context window is normalized like every other optional budget", () => {
  assert.equal(DEFAULT_SETTINGS.nativeAgent.contextWindowTokensByModel, undefined);
  const settings = structuredClone(DEFAULT_SETTINGS);
  const model = settings.nativeAgent.model;
  settings.nativeAgent.contextWindowTokensByModel = { [model]: 0 as unknown as number };
  normalizePersistedModelControls(settings);
  assert.equal(settings.nativeAgent.contextWindowTokensByModel, undefined);
  settings.nativeAgent.contextWindowTokensByModel = { [model]: 131_072 };
  normalizePersistedModelControls(settings);
  assert.deepEqual(settings.nativeAgent.contextWindowTokensByModel, { [model]: 131_072 });
});

test("only the native-agent call sites opt into automatic budgets; claude-agent call sites do not", () => {
  const claudeStart = settingsSource.indexOf(
    'if (eff.backend === "claude-agent" && !Platform.isMobile) {',
  );
  const claudeEnd = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();",
    claudeStart,
  );
  assert.ok(claudeStart >= 0 && claudeEnd > claudeStart);
  const claudeBlock = settingsSource.slice(claudeStart, claudeEnd);
  // Both claude-agent addPolicyControls calls end right after the boolean flag —
  // no 5th "automatic" argument — so the plain, always-required budget path runs.
  const claudeCalls = claudeBlock.match(/addPolicyControls\(\s*modelControls\.[\s\S]*?(?:false|true),\s*\);/g) ?? [];
  assert.equal(claudeCalls.length, 2, "expected exactly the global and per-operation claude calls");

  const nativeEnd = settingsSource.indexOf(
    "new Setting(containerEl).setName(T.settings.h3_vision).setHeading();",
    claudeEnd,
  );
  assert.ok(nativeEnd > claudeEnd);
  const nativeBlock = settingsSource.slice(claudeEnd, nativeEnd);
  // Global native fallback: representative operation "init", the raw configured model.
  assert.match(nativeBlock, /model: \(\) => s\.nativeAgent\.model,\s*\n\s*operation: "init",/);
  // Per-operation native: the model and operation actually used for that operation.
  assert.match(nativeBlock, /model: \(\) => effectiveModel\(s, key\),\s*\n\s*operation: key,/);
  assert.match(nativeBlock, /addAutomaticBudgetControl\(/);
});

test("the settings tab reads the cached model context synchronously, without probing", () => {
  const controllerSource = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");
  const start = controllerSource.indexOf("cachedModelContext(baseUrl: string, model: string)");
  assert.ok(start >= 0, "controller must expose a cachedModelContext pass-through");
  const end = controllerSource.indexOf("\n  }", start);
  const body = controllerSource.slice(start, end);
  assert.doesNotMatch(body, /async/, "the pass-through must not be async");
  assert.doesNotMatch(body, /await/, "the pass-through must not await anything");
  assert.doesNotMatch(body, /\.resolve\(/, "the pass-through must read the cache, never trigger a probe");
  assert.match(body, /this\.modelContextStore\.get\(baseUrl, model\)/);
});

test("Embedding Check uses localized success and failure notices", () => {
  assert.match(settingsSource, /T\.settings\.embeddingCheck_ok\(na\.embeddingModel, result\.probe\.actual\)/);
  assert.match(settingsSource, /T\.settings\.embeddingCheck_failed\(result\.error \?\? "unknown error"\)/);
  assert.match(settingsSource, /T\.settings\.embeddingDimensionCheck_failed\(result\.error \?\? "unknown error"\)/);
  assert.match(settingsSource, /T\.settings\.embeddingDimensionCheck_notSupported\(probe\.actual, nativeStr, requested\)/);
  assert.match(settingsSource, /T\.settings\.embeddingDimensionCheck_native\(native\)/);
  assert.match(settingsSource, /T\.settings\.embeddingDimensionCheck_truncated\(requested, native\)/);
  assert.match(settingsSource, /T\.settings\.embeddingDimensionCheck_ok\(probe\.actual, nativeStr\)/);
  for (const lang of ["en", "ru", "es"] as const) {
    const labels = i18nFor(lang).settings;
    assert.equal(typeof labels.embeddingCheck_ok("embedding-model", 1024), "string");
    assert.equal(typeof labels.embeddingCheck_failed("boom"), "string");
    assert.equal(typeof labels.embeddingDimensionCheck_failed("boom"), "string");
    assert.equal(typeof labels.embeddingDimensionCheck_notSupported(768, "1024", 1536), "string");
    assert.equal(typeof labels.embeddingDimensionCheck_native(1024), "string");
    assert.equal(typeof labels.embeddingDimensionCheck_truncated(512, 1024), "string");
    assert.equal(typeof labels.embeddingDimensionCheck_ok(1024, "1024"), "string");
  }
});

// --- Task 13: the one-shot auto-budget upgrade choice ---------------------------------

test("a stored native budget is detected, a claude one is not", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  assert.equal(hasStoredNativeBudget(settings), false);
  settings.nativeAgent.inputBudgetTokens = 16_384;
  assert.equal(hasStoredNativeBudget(settings), true);
});

test("a stored repair or output budget override is also detected", () => {
  const withMaxTokens = structuredClone(DEFAULT_SETTINGS);
  withMaxTokens.nativeAgent.maxTokens = 4_096;
  assert.equal(hasStoredNativeBudget(withMaxTokens), true);

  const withRepair = structuredClone(DEFAULT_SETTINGS);
  withRepair.nativeAgent.repairInputBudgetTokens = 65_536;
  assert.equal(hasStoredNativeBudget(withRepair), true);
});

test("accepting clears only the native budgets", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.inputBudgetTokens = 24_000;
  settings.nativeAgent.operations.init.maxTokens = 8_192;
  clearNativeBudgets(settings);
  assert.equal(settings.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.operations.init.maxTokens, undefined);
});

test("declining or dismissing keeps the stored native budgets: only clearNativeBudgets rewrites them", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.inputBudgetTokens = 24_000;
  const before = structuredClone(settings);
  // Neither hasStoredNativeBudget nor "not calling clearNativeBudgets" mutates settings.
  hasStoredNativeBudget(settings);
  assert.deepEqual(settings, before);
});

test("clearing wipes every operation's budget override, not just one", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.inputBudgetTokens = 24_000;
  settings.nativeAgent.repairInputBudgetTokens = 65_536;
  settings.nativeAgent.maxTokens = 4_096;
  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    settings.nativeAgent.operations[key].inputBudgetTokens = 12_345;
    settings.nativeAgent.operations[key].maxTokens = 6_789;
  }
  clearNativeBudgets(settings);
  assert.equal(settings.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.repairInputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.maxTokens, undefined);
  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    assert.equal(settings.nativeAgent.operations[key].inputBudgetTokens, undefined, key);
    assert.equal(settings.nativeAgent.operations[key].maxTokens, undefined, key);
  }
});

function mergeLikeMain(persisted: unknown): LlmWikiPluginSettings {
  return hydrateSettings(persisted);
}

test("clearing a per-operation native budget survives a settings round-trip", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.perOperation = true;
  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    settings.nativeAgent.operations[key].inputBudgetTokens = 12_345;
    settings.nativeAgent.operations[key].maxTokens = 6_789;
  }
  clearNativeBudgets(settings);

  // `saveData` writes JSON, so a deleted key is simply absent from data.json.
  const reloaded = mergeLikeMain(JSON.parse(JSON.stringify(settings)));

  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    assert.equal(
      reloaded.nativeAgent.operations[key].inputBudgetTokens, undefined,
      `${key}: a cleared per-operation input budget must not come back from the defaults`,
    );
    assert.equal(
      reloaded.nativeAgent.operations[key].maxTokens, undefined,
      `${key}: a cleared per-operation output budget must not come back from the defaults`,
    );
  }

  // The user-visible consequence: with per-operation models on, the reloaded settings
  // must still budget automatically from the model's context window.
  const resolved = resolveCallPolicy(reloaded, "ingest", probeRecord());
  assert.equal(resolved.budget?.inputSource, "discovered");
  assert.equal(resolved.budget?.outputSource, "default");
  assert.notEqual(resolved.policy.inputBudgetTokens, 16_384);
  assert.notEqual(resolved.policy.outputBudgetTokens, 4_096);
});

test("settleOnce resolves to the first value across any number of later calls", async () => {
  const { promise, settle } = settleOnce<boolean>();
  settle(true);
  settle(false); // must be ignored: the promise already settled to true
  settle(true);  // also ignored
  assert.equal(await promise, true);
});

test("settleOnce settles even when only ever called with the dismissal value", async () => {
  const { promise, settle } = settleOnce<boolean>();
  // Simulates Escape / clicking outside: onClose is the only caller, exactly once.
  settle(false);
  assert.equal(await promise, false);
});

test("settleOnce never leaves the promise pending: every resolver call is idempotent", async () => {
  const { promise, settle } = settleOnce<number>();
  for (let i = 0; i < 5; i++) settle(i);
  assert.equal(await promise, 0, "the first call must win");
});

test("AutoBudgetNoticeModal: dismissal (onClose) resolves the same conservative answer as an explicit keep", () => {
  const block = sourceBlock(modalsSource, "export class AutoBudgetNoticeModal extends Modal {");
  // The switch button explicitly settles true; every other exit (keep button, and
  // onClose which covers Escape / outside click / the built-in close control) settles
  // false. Assert both, and assert onClose settles unconditionally (no branching that
  // could special-case some dismissal path into "true").
  assert.match(block.body, /autoBudgetNotice_switch\)\.setCta\(\)\s*\n\s*\.onClick\(\(\) => \{ this\.resolver\.settle\(true\); this\.close\(\); \}\)/);
  assert.match(block.body, /autoBudgetNotice_keep\)\s*\n\s*\.onClick\(\(\) => \{ this\.resolver\.settle\(false\); this\.close\(\); \}\)/);
  const onCloseBlock = sourceBlock(block.body, "onClose(): void {");
  assert.match(onCloseBlock.body, /this\.resolver\.settle\(false\);/);
  assert.doesNotMatch(onCloseBlock.body, /settle\(true\)/, "onClose must never resolve true");
  // ask() must call open() (which Obsidian guarantees eventually calls onClose()) and
  // return the resolver's promise directly — no separate, never-settled promise.
  const askBlock = sourceBlock(block.body, "ask(): Promise<boolean> {");
  assert.match(askBlock.body, /this\.open\(\);/);
  assert.match(askBlock.body, /return this\.resolver\.promise;/);
  // The class must not call Obsidian's non-existent Modal.openAndWait().
  assert.doesNotMatch(block.body, /openAndWait/);
});

test("offerAutoBudgetMigration has no obsolete backend guard", () => {
  const block = sourceBlock(mainSource, "export async function offerAutoBudgetMigration(");
  const modalIndex = block.body.indexOf("new AutoBudgetNoticeModal(");
  const hasStoredIndex = block.body.indexOf("hasStoredNativeBudget(plugin.settings)");
  assert.doesNotMatch(block.body, /plugin\.settings\.backend/);
  assert.ok(hasStoredIndex >= 0 && hasStoredIndex < modalIndex);
});

test("offerAutoBudgetMigration: a user with nothing stored is never prompted, but the flag is still recorded", () => {
  const block = sourceBlock(mainSource, "export async function offerAutoBudgetMigration(");
  const ifBlock = sourceBlock(block.body, "if (hasStoredNativeBudget(plugin.settings)) {");
  assert.match(ifBlock.body, /new AutoBudgetNoticeModal\(/, "the modal is only constructed inside the hasStoredNativeBudget guard");
  const saveCallIndex = block.body.lastIndexOf('localConfigStore.save({ migrated_auto_budget: true });');
  assert.ok(saveCallIndex > ifBlock.end, "migrated_auto_budget must be recorded after (outside) the stored-budget branch, unconditionally");
});

test("offerAutoBudgetMigration: the prompt is not offered twice, whichever way it was answered", () => {
  const block = sourceBlock(mainSource, "export async function offerAutoBudgetMigration(");
  assert.match(
    block.body.trimStart(),
    /^const local = await localConfigStore\.load\(\);\s*\n\s*if \(local\.migrated_auto_budget\) return;/,
    "must return immediately once migrated_auto_budget was already recorded, before any other check",
  );
});

test("offerAutoBudgetMigration: clearNativeBudgets only runs on an explicit yes", () => {
  const block = sourceBlock(mainSource, "export async function offerAutoBudgetMigration(");
  assert.match(
    block.body,
    /if \(switchToAutomatic\) \{\s*\n\s*clearNativeBudgets\(plugin\.settings\);/,
    "clearNativeBudgets must be gated on switchToAutomatic being true",
  );
});

test("auto-budget-notice strings exist and differ across en/ru/es", () => {
  for (const lang of ["en", "ru", "es"] as const) {
    const s = i18nFor(lang).settings;
    for (const key of [
      "autoBudgetNotice_title",
      "autoBudgetNotice_body",
      "autoBudgetNotice_switch",
      "autoBudgetNotice_keep",
    ] as const) {
      assert.equal(typeof s[key], "string", `${lang}.${key}`);
      assert.ok(s[key].length > 0, `${lang}.${key} must not be empty`);
    }
    assert.notEqual(s.autoBudgetNotice_switch, s.autoBudgetNotice_keep);
  }
});

test("the auto-budget notice body does not point at the removed Advanced heading", () => {
  // F1 from review: commit 00478f49 (immediately before Task 13) dropped the "Advanced"
  // heading over the native budget fields and added a test asserting it appears nowhere
  // in settings.ts. The notice body must not tell an upgrading user to look for it.
  assert.doesNotMatch(i18nFor("en").settings.autoBudgetNotice_body, /\bAdvanced\b/);
  assert.doesNotMatch(i18nFor("ru").settings.autoBudgetNotice_body, /Дополнительно/);
  assert.doesNotMatch(i18nFor("es").settings.autoBudgetNotice_body, /Avanzado/);
  assert.doesNotMatch(settingsSource, /advancedBudgets_name/);
});

test("the auto-budget modal names the settings fields by their real labels, per locale", () => {
  for (const locale of ["en", "ru", "es"] as const) {
    const settings = i18nFor(locale).settings;
    assert.ok(
      settings.autoBudgetNotice_body.includes(settings.inputBudgetTokens_name),
      `${locale}: body must name the input budget field by its own label`,
    );
    assert.ok(
      settings.autoBudgetNotice_body.includes(settings.outputBudgetTokens_name),
      `${locale}: body must name the output budget field by its own label`,
    );
    // The label was renamed to "Max completion tokens"; the modal must not keep
    // sending users looking for a field that no longer exists under that name.
    assert.equal(
      settings.autoBudgetNotice_body.includes("Output budget tokens"), false,
      `${locale}: body still names a field that the settings tab does not show`,
    );
  }
});
