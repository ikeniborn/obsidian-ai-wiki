import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { ensureSourcesSection } = await import("../src/utils/raw-frontmatter");

const FM = "---\ntype: HowTo\nresource:\n  - Настройка прокси\n---\n";
const body = `${FM}# Title\n\n## Основные характеристики\n\n- x\n`;

test("appends a ## Sources section with a wikilink when absent", () => {
  const out = ensureSourcesSection(body, ["Настройка прокси"]);
  assert.match(out, /## Sources/);
  assert.match(out, /- \[\[Настройка прокси\]\]/);
  // original content preserved
  assert.match(out, /## Основные характеристики/);
});

test("no source stems → content unchanged", () => {
  assert.equal(ensureSourcesSection(body, []), body);
});

test("idempotent — existing link is not duplicated", () => {
  const once = ensureSourcesSection(body, ["Настройка прокси"]);
  const twice = ensureSourcesSection(once, ["Настройка прокси"]);
  assert.equal(twice, once);
  assert.equal((twice.match(/\[\[Настройка прокси\]\]/g) ?? []).length, 1);
});

test("unions a new source into an existing ## Sources section", () => {
  const once = ensureSourcesSection(body, ["Source A"]);
  const both = ensureSourcesSection(once, ["Source A", "Source B"]);
  assert.match(both, /- \[\[Source A\]\]/);
  assert.match(both, /- \[\[Source B\]\]/);
  assert.equal((both.match(/## Sources/g) ?? []).length, 1, "only one Sources section");
});

test("lists multiple stems", () => {
  const out = ensureSourcesSection(body, ["A", "B", "C"]);
  for (const s of ["A", "B", "C"]) assert.match(out, new RegExp(`- \\[\\[${s}\\]\\]`));
});
