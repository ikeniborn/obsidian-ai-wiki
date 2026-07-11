import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBoilerplateScoreDemotion,
  demoteBoilerplateRankedItems,
  isBoilerplatePath,
  normalizeBoilerplateDemotionConfig,
} from "../src/boilerplate-demotion";

test("isBoilerplatePath detects only known boilerplate templates", () => {
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-readme.md"), true);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-hld-v2-standard.md"), true);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/normal-template-analysis.md"), false);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-not-hld.md"), false);
  assert.equal(isBoilerplatePath(""), false);
});

test("normalizeBoilerplateDemotionConfig applies defaults and clamps factor", () => {
  assert.deepEqual(normalizeBoilerplateDemotionConfig(undefined), { enabled: true, factor: 0.15 });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ enabled: false, factor: 0.8 }), {
    enabled: false,
    factor: 0.8,
  });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ factor: -1 }), { enabled: true, factor: 0 });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ factor: 2 }), { enabled: true, factor: 1 });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ factor: Number.NaN }), { enabled: true, factor: 0.15 });
});

test("applyBoilerplateScoreDemotion lowers only enabled boilerplate scores", () => {
  const config = { enabled: true, factor: 0.15 };
  assert.equal(applyBoilerplateScoreDemotion(10, "!Wiki/hld/pages/template-readme.md", config), 8.5);
  assert.equal(applyBoilerplateScoreDemotion(10, "!Wiki/hld/pages/owner.md", config), 10);
  assert.equal(
    applyBoilerplateScoreDemotion(10, "!Wiki/hld/pages/template-readme.md", { enabled: false, factor: 0.15 }),
    10,
  );
});

test("demoteBoilerplateRankedItems moves boilerplate behind stable candidates", () => {
  const ranked = [
    { path: "!Wiki/hld/pages/template-readme.md", score: 10 },
    { path: "!Wiki/hld/pages/owner.md", score: 9 },
    { path: "!Wiki/hld/pages/service.md", score: 8 },
    { path: "!Wiki/hld/pages/template-hld-v2-standard.md", score: 7 },
    { path: "!Wiki/hld/pages/normal-template-analysis.md", score: 6 },
  ];

  const demoted = demoteBoilerplateRankedItems(ranked, { enabled: true, factor: 0.25 }, 5);

  assert.deepEqual(
    demoted.map((item) => item.path),
    [
      "!Wiki/hld/pages/owner.md",
      "!Wiki/hld/pages/service.md",
      "!Wiki/hld/pages/template-readme.md",
      "!Wiki/hld/pages/normal-template-analysis.md",
      "!Wiki/hld/pages/template-hld-v2-standard.md",
    ],
  );
});
