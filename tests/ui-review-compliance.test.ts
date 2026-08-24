import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sources = {
  settings: readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8"),
  modals: readFileSync(new URL("../src/modals.ts", import.meta.url), "utf8"),
  main: readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"),
  view: readFileSync(new URL("../src/view.ts", import.meta.url), "utf8"),
};

test("UI sources use supported destructive controls", () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\.setWarning\(\)/, name);
    assert.doesNotMatch(source, /\.setDynamicTooltip\(\)/, name);
  }
  assert.match(sources.settings, /\.setDestructive\(\)/);
  assert.match(sources.modals, /\.setDestructive\(\)/);
});

test("reviewer-facing UI labels preserve AI Wiki and use sentence case", () => {
  assert.match(sources.view, /export const AI_WIKI_DISPLAY_NAME = "AI Wiki";/);
  assert.match(sources.main, /addRibbonIcon\("brain-circuit", AI_WIKI_DISPLAY_NAME,/);
  assert.match(sources.view, /getDisplayText\(\): string \{ return AI_WIKI_DISPLAY_NAME; \}/);
  for (const label of [
    "Set base URL first",
    "Set base URL and embedding model first",
    "Enter a dimension value to check, or use default",
    "Set base URL and reranker model first",
    "Set base URL and model first",
    "HTTP://proxy.example.com:8080",
    "Schema: 0/0",
    "Validation: 0 ok, 0 retried, 0 failed",
  ]) {
    assert.ok(
      Object.values(sources).some((source) => source.includes(label)),
      `missing sentence-case label: ${label}`,
    );
  }
  assert.match(sources.main, /`Schema: \$\{s\.failed\}\/\$\{total\}`/);
  assert.match(
    sources.main,
    /`Validation: \$\{s\.ok\} ok, \$\{s\.retried\} retried, \$\{s\.failed\} failed`/,
  );
});
