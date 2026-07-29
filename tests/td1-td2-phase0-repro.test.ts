import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { SelectedChunk } from "../src/page-similarity";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { selectQueryContextChunks } = await import("../src/phases/query-budget");
const { reconcileSynthesisEvidence } = await import("../src/phases/synthesis-evidence-ledger");
const {
  findUnsupportedTechnicalUnits,
  sanitizeUnsupportedTechnicalLines,
} = await import("../src/phases/query-grounding-validator");

function selectedChunk(index: number, score: number): SelectedChunk {
  return {
    articleId: `wiki_d_${index}`,
    path: `!Wiki/d/concept/wiki_d_${index}.md`,
    heading: `## Section ${index}`,
    body: `COMPLETE_CHUNK_${index}_START\n${String(index).repeat(180)}\nCOMPLETE_CHUNK_${index}_END`,
    score,
    source: index % 2 === 0 ? "seed" : "graph",
    ordinal: index,
  };
}

test("Phase 0 class 1: evidence erosion on cross-source page update", () => {
  const existing = [
    "# Article",
    "",
    "## Точные технические данные",
    "",
    "```bash",
    "sudo earlier-command",
    "```",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
  ].join("\n");
  const candidate = [
    "# Article",
    "",
    "## Sources",
    "",
    "- [[Source A]]",
    "- [[Source B]]",
  ].join("\n");

  const reconciled = reconcileSynthesisEvidence(candidate, existing, [], "ru");

  assert.match(reconciled.content, /sudo earlier-command/);
});

test("Phase 0 class 4: facet omission in context selection", () => {
  const anchors = Array.from({ length: 3 }, (_, index) => selectedChunk(index, 100 - index));
  const filler = { ...selectedChunk(3, 97), body: "No relevant keyword here." };
  const facetChunk = { ...selectedChunk(4, 90), body: "Ask about the storage quota limit." };
  const ranked = [...anchors, filler, facetChunk];

  const selected = selectQueryContextChunks(ranked, 4, "What is the storage quota limit?");

  assert.ok(selected.includes(facetChunk));
});

test("Phase 0 class 5: false unsupported path with trailing sentence period", () => {
  const context = "Edit /etc/modprobe.d/amdgpu.conf to disable the driver.";
  const answer = "See /etc/modprobe.d/amdgpu.conf.";

  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);

  assert.deepEqual(unsupported, []);
});

test("Phase 0 class 6: malformed sanitation leaves an empty emphasis span", () => {
  const context = "sysctl controls memory pressure settings.";
  const answer = "- **`vm.dirty_expire_centisecs`** – максимальное время жизни грязных страниц.";

  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);
  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.doesNotMatch(sanitized.answer, /\*\*\*\*/);
});

test("Phase 0 class 7: title-only support for a page's own H1", () => {
  const context = ["Раздел объясняет настройку параметров ядра памяти без упоминания точного имени параметра."];
  const answer = "Параметр `vm.dirty_expire_centisecs` управляет временем жизни грязных страниц.";
  const articleIds = ["wiki_linux_vm_dirty_expire_centisecs"];

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, context, articleIds), []);
});
