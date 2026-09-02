import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { i18nFor } = await import("../src/i18n");
const { visionSizeSkipReason } = await import("../src/phases/format");
const { PromptBudgetExceededError } = await import("../src/prompt-budget");

const LANGS = ["en", "ru", "es"] as const;

function tooBig(): Error {
  return new PromptBudgetExceededError(3_686, 9_000, ["page"]);
}

test("every locale carries the vision skip strings", () => {
  for (const lang of LANGS) {
    const progress = i18nFor(lang).formatProgress;
    assert.equal(typeof progress.visionWindowField, "string", `${lang}: missing visionWindowField`);
    assert.equal(typeof progress.visionSkipped, "string", `${lang}: missing visionSkipped`);
    assert.equal(typeof progress.visionUnsupportedOnMobile, "string", `${lang}: missing mobile reason`);
    assert.equal(typeof progress.visionUnknownExtension, "string", `${lang}: missing extension reason`);
    assert.equal(typeof progress.visionNoAdvertisedWindow, "function", `${lang}: missing default-source text`);
    assert.equal(typeof progress.visionWindowTooSmall, "function", `${lang}: missing sized-window text`);
  }
});

test("the non-English bundles translate the skip strings rather than copying English", () => {
  const en = i18nFor("en").formatProgress;
  for (const lang of ["ru", "es"] as const) {
    const other = i18nFor(lang).formatProgress;
    assert.notEqual(other.visionWindowField, en.visionWindowField, `${lang}: settings path not translated`);
    assert.notEqual(other.visionSkipped, en.visionSkipped, `${lang}: summary not translated`);
  }
});

test("the size refusal is rendered in the caller's language", () => {
  const ru = i18nFor("ru").formatProgress;
  const reason = visionSizeSkipReason(
    tooBig(),
    { model: "vision-model", contextWindow: 8_192, contextWindowSource: "configured" },
    ru,
  );
  assert.ok(reason, "expected a size reason");
  assert.ok(reason.includes("vision-model"), "the model name stays verbatim");
  assert.ok(reason.includes("8192") || reason.includes("8 192"), "the window is named");
  assert.ok(reason.includes(ru.visionWindowField), "the localized settings path is named");
  assert.equal(/Settings →/.test(reason), false, `expected no English settings path in: ${reason}`);
});

test("the default-window refusal is localized too", () => {
  const es = i18nFor("es").formatProgress;
  const reason = visionSizeSkipReason(
    tooBig(),
    { model: "vision-model", contextWindow: 4_096, contextWindowSource: "default" },
    es,
  );
  assert.ok(reason);
  assert.ok(reason.includes(es.visionWindowField));
  assert.equal(/Settings →/.test(reason), false, `expected no English settings path in: ${reason}`);
});

test("a non-size failure and a missing window still produce no reason", () => {
  const en = i18nFor("en").formatProgress;
  assert.equal(
    visionSizeSkipReason(new Error("fetch failed"), {
      model: "vision-model",
      contextWindow: 8_192,
      contextWindowSource: "configured",
    }, en),
    null,
  );
  assert.equal(visionSizeSkipReason(tooBig(), { model: "vision-model" }, en), null);
});
