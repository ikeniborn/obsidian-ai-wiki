import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { i18nFor } = await import("../src/i18n");
const { queryDegradeLines } = await import("../src/retrieval-diag");

const LANGS = ["en", "ru", "es"] as const;

test("a reranker fallback produces a labelled line in every locale", () => {
  for (const lang of LANGS) {
    const T = i18nFor(lang).view;
    const lines = queryDegradeLines({ reranker: { fallbackReason: "timeout" } }, T);
    assert.equal(lines.length, 1, `${lang}: expected one line`);
    assert.equal(lines[0].label, T.statsRerankerFallback, `${lang}: wrong label`);
    assert.ok(lines[0].value.length > 0, `${lang}: empty value`);
  }
});

test("every fallback reason is translated in every locale", () => {
  const reasons = ["disabled", "missing-model", "empty-candidates", "timeout", "error", "malformed-response"] as const;
  for (const lang of LANGS) {
    const T = i18nFor(lang).view;
    const rendered = reasons.map((reason) => T.rerankerFallbackReason(reason));
    assert.equal(new Set(rendered).size, reasons.length, `${lang}: reasons are not distinct`);
    assert.ok(rendered.every((text) => text.length > 0), `${lang}: a reason rendered empty`);
  }
});

test("a retrieval degrade produces its own labelled line carrying the provider reason", () => {
  const T = i18nFor("ru").view;
  const lines = queryDegradeLines({ retrievalDegraded: "embedding backend refused the batch" }, T);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, T.statsRetrievalDegraded);
  assert.match(lines[0].value, /refused the batch/);
});

test("both degrades render together, reranker first", () => {
  const T = i18nFor("en").view;
  const lines = queryDegradeLines(
    { reranker: { fallbackReason: "error" }, retrievalDegraded: "provider said no" },
    T,
  );
  assert.deepEqual(lines.map((line) => line.label), [T.statsRerankerFallback, T.statsRetrievalDegraded]);
});

test("a clean run renders no degrade line", () => {
  const T = i18nFor("en").view;
  assert.deepEqual(queryDegradeLines({}, T), []);
  assert.deepEqual(queryDegradeLines({ reranker: { fallbackReason: undefined } }, T), []);
});

test("an over-long provider reason is bounded before display", () => {
  const T = i18nFor("en").view;
  const [line] = queryDegradeLines({ retrievalDegraded: "x".repeat(5_000) }, T);
  assert.ok(line.value.length <= 240, `expected a bounded value, got ${line.value.length}`);
});
