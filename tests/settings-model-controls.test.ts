import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

import {
  backendModelControlDescriptor,
  createLiveModelControl,
  normalizePersistedModelControls,
  parsePositiveBudgetInput,
  renderModelControlFields,
  resolveModelCallPolicy,
} from "../src/model-call-policy";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import { runNativeVisionModelCheck } from "../src/vision-probe";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const { i18nFor } = await import("../src/i18n");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");

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
  delete (settings.claudeAgent as { inputBudgetTokens?: unknown }).inputBudgetTokens;
  delete (settings.nativeAgent as { compressionProfile?: unknown }).compressionProfile;
  delete (settings.claudeAgent as { compressionProfile?: unknown }).compressionProfile;
  delete (settings.nativeAgent.operations.query as { inputBudgetTokens?: unknown }).inputBudgetTokens;
  delete (settings.claudeAgent.operations.query as { inputBudgetTokens?: unknown }).inputBudgetTokens;

  normalizePersistedModelControls(settings);

  assert.equal(settings.nativeAgent.maxTokens, 7777);
  assert.equal(settings.nativeAgent.operations.query.maxTokens, 3333);
  assert.equal(settings.nativeAgent.inputBudgetTokens, 16_384);
  assert.equal(settings.claudeAgent.inputBudgetTokens, 16_384);
  assert.equal(settings.nativeAgent.operations.query.inputBudgetTokens, 16_384);
  assert.equal(settings.claudeAgent.operations.query.inputBudgetTokens, 16_384);
  assert.equal(settings.nativeAgent.compressionProfile, "balanced");
  assert.equal(settings.claudeAgent.compressionProfile, "balanced");
  assert.equal(settings.nativeAgent.operations.query.compressionProfile, undefined);
  assert.equal(settings.claudeAgent.operations.query.compressionProfile, undefined);
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
    fields: ["compressionProfile"],
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
    fields: ["compressionProfile"],
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
  assert.match(falseOnly.body, /\.setName\("Thinking budget tokens"\)/);
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
    '.setName("Thinking budget tokens")',
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

test("Vision compression override is part of persisted settings", () => {
  const settings: LlmWikiPluginSettings = structuredClone(DEFAULT_SETTINGS);
  settings.vision.compressionProfile = "maximum";
  assert.equal(settings.vision.compressionProfile, "maximum");

  const format = resolveModelCallPolicy(settings, "format");
  assert.equal(format.policy.compression, "maximum");
  assert.equal(format.opts.semanticCompression, undefined);
});

test("Format compression fields are ignored and Vision Use global uses the global profile", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.perOperation = true;
  settings.nativeAgent.compressionProfile = "minimum";
  settings.nativeAgent.operations.format.compressionProfile = "maximum";

  normalizePersistedModelControls(settings);
  const format = resolveModelCallPolicy(settings, "format");
  assert.equal(format.policy.compression, "minimum");
  assert.equal(format.opts.semanticCompression, undefined);

  assert.equal(settings.nativeAgent.operations.format.compressionProfile, undefined);
  assert.equal(settings.claudeAgent.operations.format.compressionProfile, undefined);
});
