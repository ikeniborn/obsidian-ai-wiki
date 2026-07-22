import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/content-hash";
import {
  batchEntityContexts,
  buildEntityContext,
  ContextSplitRequiredError,
  DuplicateEntityContextError,
  renderEntityContextMessages,
  type EntityContextBundle,
} from "../src/ingest-context";
import type { EntityEvidence } from "../src/phases/ingest-evidence";
import type { LlmCallOptions } from "../src/types";
import { PageSimilarityService } from "../src/page-similarity";
import { estimatePreparedMessages } from "../src/prompt-budget";
import { applyPagePatch, inspectPatchablePage } from "../src/section-patches";

const evidence: EntityEvidence = {
  entityKey: "entity",
  packetIds: ["p1"],
  facts: ["shared fact"],
  exactSourceRanges: [],
  exactSource: [],
  links: [],
};

function pages(count: number): Map<string, string> {
  return new Map(Array.from({ length: count }, (_, i) => [
    `!Wiki/d/concept/wiki_d_page_${i}.md`,
    `# Page ${i}\n\n## Facts\nentity shared fact ${i}\n\n## Details\ndetail ${"x".repeat(80)}`,
  ]));
}

function build(count: number, budget = 1200, targetPath?: string) {
  return buildEntityContext({
    evidence,
    candidatePages: pages(count),
    targetPath,
    inputBudgetTokens: budget,
    fixedMessages: [{ role: "system", content: "contract" }],
    opts: {},
  });
}

for (const count of [1, 15, 100]) {
  test(`${count}-page domain stays globally bounded`, () => {
    const result = build(count, 1200, count === 1 ? "!Wiki/d/concept/wiki_d_page_0.md" : undefined);
    assert.ok(result.estimatedInputTokens <= 1200);
    assert.ok(result.units.every((unit) => !unit.text.includes('"vector"')));
    if (count === 1) assert.ok(result.units.some((unit) => unit.id.includes("## Facts")));
  });
}

test("optional selection includes more than one page before a second low-score section", () => {
  const result = build(4, 650);
  assert.ok(new Set(result.units.filter((unit) => unit.source === "wiki").map((unit) => unit.pageId)).size >= 2);
});

test("diversity rounds survive packer ordering: A1, B1, then A2", () => {
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["entity"] },
    candidatePages: new Map([
      ["!Wiki/d/a.md", "## Entity A1\nentity entity entity\n## A2\nentity entity"],
      ["!Wiki/d/b.md", "## B1\nentity\n## B2\nquiet"],
    ]),
    inputBudgetTokens: 600,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(result.units.map((unit) => unit.heading), ["## Entity A1", "## B1", "## A2"]);
  assert.ok(result.units[0].score > result.units[1].score);
});

test("equal lexical scores use stable code-point path then source ordinal", () => {
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["q"] },
    candidatePages: new Map([
      ["!Wiki/d/z.md", "## Same\nsame\n## Same Again\nsame"],
      ["!Wiki/d/a.md", "## Same\nsame"],
    ]),
    inputBudgetTokens: 600,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(result.units.map((unit) => unit.path), ["!Wiki/d/a.md", "!Wiki/d/z.md", "!Wiki/d/z.md"]);
  assert.deepEqual(result.units.map((unit) => unit.sourceOrdinal), [0, 0, 1]);
});

test("scores before dedupe and keeps relevant duplicate provenance", () => {
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["kubernetes"] },
    candidatePages: new Map([
      ["!Wiki/d/a.md", "## Facts\nshared section"],
      ["!Wiki/d/kubernetes.md", "## Facts\nshared section"],
    ]),
    inputBudgetTokens: 600,
    fixedMessages: [],
    opts: {},
  });
  assert.equal(result.units[0].path, "!Wiki/d/kubernetes.md");
  assert.deepEqual(result.units[0].duplicatePaths, ["!Wiki/d/a.md", "!Wiki/d/kubernetes.md"]);
});

test("target duplicate wins even when its lexical score is lower", () => {
  const targetPath = "!Wiki/d/target.md";
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["kubernetes"] },
    candidatePages: new Map([
      ["!Wiki/d/kubernetes.md", "## Facts\nshared section kubernetes"],
      [targetPath, "## Facts\nshared section kubernetes"],
    ]),
    targetPath,
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.equal(result.units.find((unit) => unit.required)?.path, targetPath);
  assert.equal(result.units.find((unit) => unit.required)?.duplicatePaths.includes("!Wiki/d/kubernetes.md"), true);
});

test("entity type participates in evidence lexical query", () => {
  const input = {
    candidatePages: new Map([["!Wiki/d/p.md", "## Facts\nKubernetes deployment"]]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  };
  const withoutType = buildEntityContext({ ...input, evidence: { ...evidence, facts: ["deployment"] } });
  const withType = buildEntityContext({ ...input, evidence: { ...evidence, facts: ["deployment"], entityType: "Kubernetes" } });
  assert.ok(withType.units[0].score > withoutType.units[0].score);
});

test("required target occupies round zero before optional target-page sections", () => {
  const targetPath = "!Wiki/d/a.md";
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["entity"] },
    candidatePages: new Map([
      [targetPath, "## A1\nentity entity\n## A2\nentity entity"],
      ["!Wiki/d/b.md", "## B1\nentity\n## B2\nquiet"],
    ]),
    targetPath,
    inputBudgetTokens: 600,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(result.units.map((unit) => unit.heading), ["## A1", "## B1", "## A2"]);
});

test("required target keeps complete Facts bytes and hash", () => {
  const targetPath = "!Wiki/d/concept/wiki_d_page_0.md";
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["entity shared fact 0"] },
    candidatePages: new Map([[targetPath, "# Page\r\n\r\n## Facts\r\nkeep\r\n\r\n## Details\r\nother\r\n"]]),
    targetPath,
    inputBudgetTokens: 400,
    fixedMessages: [{ role: "system", content: "contract" }],
    opts: {},
  });
  const facts = result.units.find((unit) => unit.required);
  assert.ok(facts);
  assert.equal(facts.text, "## Facts\r\nkeep\r\n");
  assert.equal(facts.sectionHash, contentHash(facts.text));
  assert.equal(result.replaceAuthorities[0].sectionHash, facts.sectionHash);
});

test("canonical renderer includes metadata and exact section bytes", () => {
  const result = build(1, 1200, "!Wiki/d/concept/wiki_d_page_0.md");
  const messages = renderEntityContextMessages(result.units, {}, [{ role: "system", content: "contract" }]);
  const content = messages.at(-1)?.content;
  assert.equal(typeof content, "string");
  assert.match(content as string, /Path:/);
  assert.match(content as string, /Section hash:/);
  assert.match(content as string, /## Facts/);
});

test("authoritative custom renderer controls final exact estimate", () => {
  const render = (units: readonly import("../src/ingest-context").WikiSectionUnit[], _opts: LlmCallOptions, fixed: readonly import("openai").default.Chat.ChatCompletionMessageParam[]) => [
    ...fixed,
    { role: "user" as const, content: units.map((unit) => `meta:${unit.path}:${"m".repeat(45)}\n${unit.text}`).join("\n") },
  ];
  const fixed = [{ role: "system" as const, content: "contract" }];
  const result = buildEntityContext({
    evidence,
    candidatePages: pages(3),
    inputBudgetTokens: 180,
    fixedMessages: fixed,
    opts: {},
    render,
  });
  assert.equal(result.estimatedInputTokens, estimatePreparedMessages(render(result.units, {}, fixed)));
  assert.ok(result.units.length < 6);
});

for (const lineEnding of ["\n", "\r\n"]) {
  test(`target authority replaces exact section with ${JSON.stringify(lineEnding)}`, () => {
    const targetPath = "!Wiki/d/concept/wiki_d_target.md";
    const current = `---${lineEnding}type: concept${lineEnding}---${lineEnding}# Target${lineEnding}${lineEnding}## Facts${lineEnding}old${lineEnding}${lineEnding}## Related${lineEnding}links${lineEnding}`;
    const result = buildEntityContext({
      evidence: { ...evidence, facts: ["old"] },
      candidatePages: new Map([[targetPath, current]]),
      targetPath,
      inputBudgetTokens: 500,
      fixedMessages: [],
      opts: {},
    });
    const inspected = inspectPatchablePage(current);
    assert.equal(result.units[0].sectionHash, inspected.sections[0].hash);
    assert.equal(result.replaceAuthorities[0].exactSection, inspected.sections[0].span);
    const patchResult = applyPagePatch(current, {
      kind: "patch",
      path: targetPath,
      expectedPageHash: contentHash(current),
      sections: [{ heading: "## Facts", operation: "replace", expectedSectionHash: result.units[0].sectionHash, content: "new" }],
    }, result.replaceAuthorities);
    assert.equal(patchResult.ok, true);
  });
}

test("target missing from candidates fails loudly", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map(),
    targetPath: "!Wiki/d/missing.md",
    inputBudgetTokens: 100,
    fixedMessages: [],
    opts: {},
  }), { name: "TargetContextMissingError" });
});

test("candidate context rejects non-page paths before extraction", () => {
  for (const path of [
    "!Wiki/d/index.jsonl",
    "!Wiki/d/_index.md",
    "outside/d/page.md",
    "!Wiki/../../outside.md",
    "!Wiki/a/../b.md",
    "!Wiki//b.md",
    "!Wiki/./b.md",
    "!Wiki\\d\\b.md",
    "!Wiki/d\\b.md",
  ]) {
    assert.throws(() => buildEntityContext({
      evidence,
      candidatePages: new Map([[path, "## Facts\nshould not be scanned"]]),
      inputBudgetTokens: 200,
      fixedMessages: [],
      opts: {},
    }), (error: unknown) => error instanceof Error && error.name === "InvalidWikiContextPathError" &&
      !error.message.includes("should not be scanned") &&
      "path" in error && (error as { path: string }).path === path);
  }
});

test("target path uses the same governed path boundary", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/concept/a.md", "## Facts\nvalid page"]]),
    targetPath: "!Wiki/d/../outside.md",
    inputBudgetTokens: 200,
    fixedMessages: [],
    opts: {},
  }), (error: unknown) => error instanceof Error && error.name === "InvalidWikiContextPathError" &&
    "path" in error && (error as { path: string }).path === "!Wiki/d/../outside.md");
});

test("target with no patchable H2 fails loudly", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/no-h2.md", "---\ntype: concept\n---\n# Only title\n\nplain text with ## fake in text"]]),
    targetPath: "!Wiki/d/no-h2.md",
    inputBudgetTokens: 200,
    fixedMessages: [],
    opts: {},
  }), { name: "TargetContextMissingError" });
});

test("H2 spans preserve CRLF and exclude Related and External links", () => {
  const result = buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/p.md", "# P\r\n\r\n## Facts\r\nA\r\n### H3\r\nB\r\n## Related\r\nR\r\n## External links\r\nE\r\n"]]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(result.units.map((unit) => unit.heading), ["## Facts"]);
  assert.equal(result.units[0].text, "## Facts\r\nA\r\n### H3\r\nB\r\n");
});

test("legitimate prose containing vector remains governed page content", () => {
  const result = buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/p.md", "## Facts\nA vector is a legitimate fact."]]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.match(result.units[0].text, /vector/);
});

test("candidate boundary accepts only governed Markdown and preserves vector prose", () => {
  const result = buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/p.md", "## Facts\nThe vector is a legitimate fact."]]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.equal(result.units[0].path, "!Wiki/d/p.md");
  assert.match(result.units[0].text, /vector/);
});

test("duplicate-merge explicitly authorizes link sections", () => {
  const result = buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/p.md", "## Related\nR\n## External links\nE\n"]]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
    linkSectionPurpose: "duplicate-merge",
  });
  assert.deepEqual(result.units.map((unit) => unit.heading), ["## Related", "## External links"]);
});

test("unknown link-section purpose is rejected at runtime", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map(),
    inputBudgetTokens: 100,
    fixedMessages: [],
    opts: {},
    linkSectionPurpose: "other-purpose" as never,
  }), RangeError);
});

test("normalized duplicate section text is emitted once and ties are stable", () => {
  const result = buildEntityContext({
    evidence: { ...evidence, facts: ["same"] },
    candidatePages: new Map([
      ["!Wiki/d/b.md", "## Same\n same\n"],
      ["!Wiki/d/a.md", "## Same\r\n same\r\n"],
    ]),
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].path, "!Wiki/d/a.md");
});

test("fixed and rendered overhead overflow is rejected", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map(),
    inputBudgetTokens: 10,
    fixedMessages: [{ role: "system", content: "fixed overhead" }],
    opts: {},
  }), ContextSplitRequiredError);
  assert.throws(() => build(1, 0), RangeError);
});

test("required target overflow is typed and never partial", () => {
  assert.throws(() => buildEntityContext({
    evidence,
    candidatePages: new Map([["!Wiki/d/target.md", "## Facts\n" + "x".repeat(1000)]]),
    targetPath: "!Wiki/d/target.md",
    inputBudgetTokens: 100,
    fixedMessages: [],
    opts: {},
  }), ContextSplitRequiredError);
});

function bundle(entityKey: string, estimatedInputTokens: number): EntityContextBundle {
  return {
    entityKey,
    evidence: { ...evidence, entityKey },
    units: [],
    replaceAuthorities: [],
    estimatedInputTokens,
  };
}

test("bundles batch exactly once in stable order and within rendered bounds", () => {
  const renderForTest = (items: EntityContextBundle[]) => [{
    role: "user" as const,
    content: items.map((item) => `bundle:${item.entityKey}:${"x".repeat(20)}`).join("|"),
  }];
  const budget = estimatePreparedMessages(renderForTest([bundle("a", 1), bundle("m", 1)]));
  const result = batchEntityContexts([bundle("z", 1), bundle("a", 1), bundle("m", 1)], budget, renderForTest, {} as LlmCallOptions);
  assert.deepEqual(result.map((batch) => batch.map((item) => item.entityKey)), [["a", "m"], ["z"]]);
  assert.equal(result.flat().length, 3);
  assert.deepEqual(new Set(result.flat().map((item) => item.entityKey)), new Set(["a", "m", "z"]));
  assert.ok(result.every((batch) => estimatePreparedMessages(renderForTest(batch)) <= budget));
});

test("oversized bundle directs caller to evidence reducer", () => {
  assert.throws(() => batchEntityContexts([bundle("a", 100)], 10, () => [{ role: "user", content: "oversized" }], {}), ContextSplitRequiredError);
});

test("oversized singleton evidence is compressed before batching fails", () => {
  const source = bundle("a", 100);
  source.evidence = {
    ...source.evidence,
    packetIds: ["p1", "p2", "p3"],
    facts: ["primary fact", "secondary fact", "third fact"],
    exactSourceRanges: [
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
      { startLine: 3, endLine: 3 },
    ],
    exactSource: [
      { startLine: 1, endLine: 1, text: "primary source " + "x".repeat(2000) },
      { startLine: 2, endLine: 2, text: "secondary source " + "y".repeat(2000) },
      { startLine: 3, endLine: 3, text: "third source " + "z".repeat(2000) },
    ],
    links: ["https://example.invalid/a", "https://example.invalid/b"],
  };
  const renderForTest = (items: EntityContextBundle[]) => [{
    role: "user" as const,
    content: JSON.stringify(items.map((item) => item.evidence)),
  }];
  const budget = estimatePreparedMessages(renderForTest([{ ...source, evidence: { ...source.evidence, exactSource: [source.evidence.exactSource[0]], facts: ["primary fact"], packetIds: ["p1"], links: [] } }])) + 20;

  const result = batchEntityContexts([source], budget, renderForTest, {});

  assert.equal(result.length, 1);
  assert.equal(result[0][0].entityKey, "a");
  assert.ok(estimatePreparedMessages(renderForTest(result[0])) <= budget);
  assert.equal(result[0][0].evidence.exactSource.length, 1);
  assert.equal(source.evidence.exactSource.length, 3);
});

test("oversized singleton batching drops optional units before failing", () => {
  const source = bundle("guide", 100);
  source.units = [
    {
      id: "required", source: "wiki", text: "required target context", required: true, priority: 10, estimatedTokens: 10,
      pageId: "required", path: "!Wiki/d/concept/wiki_d_required.md", heading: "## Required", sectionHash: "required",
      score: 1, sourceOrdinal: 0, duplicatePaths: ["!Wiki/d/concept/wiki_d_required.md"],
    },
    {
      id: "optional", source: "wiki", text: "optional context " + "x".repeat(4000), required: false, priority: 1, estimatedTokens: 4000,
      pageId: "optional", path: "!Wiki/d/concept/wiki_d_optional.md", heading: "## Optional", sectionHash: "optional",
      score: 0.1, sourceOrdinal: 1, duplicatePaths: ["!Wiki/d/concept/wiki_d_optional.md"],
    },
  ];
  const renderForTest = (items: EntityContextBundle[]) => [{
    role: "user" as const,
    content: JSON.stringify(items.map((item) => ({
      evidence: item.evidence,
      units: item.units,
      replaceAuthorities: item.replaceAuthorities,
    }))),
  }];
  const withoutOptional = { ...source, units: source.units.filter((unit) => unit.required) };
  const budget = estimatePreparedMessages(renderForTest([withoutOptional])) + 20;

  const result = batchEntityContexts([source], budget, renderForTest, {});

  assert.equal(result.length, 1);
  assert.deepEqual(result[0][0].units.map((unit) => unit.id), ["required"]);
  assert.equal(source.units.length, 2);
  assert.ok(estimatePreparedMessages(renderForTest(result[0])) <= budget);
});

test("duplicate entity keys are rejected before rendering", () => {
  assert.throws(() => batchEntityContexts([bundle("a", 1), bundle("a", 1)], 500, () => {
    throw new Error("renderer must not run");
  }, {}), DuplicateEntityContextError);
});

test("batch renderer receives deep-cloned snapshots", () => {
  const source = [bundle("a", 1), bundle("b", 1), bundle("c", 1)];
  const before = JSON.stringify(source, (_key, value) => value instanceof Set ? [...value] : value);
  const render = (items: EntityContextBundle[]) => {
    items[0].evidence.facts[0] = "mutated";
    items[0].units.push({
      id: "mutated", source: "wiki", text: "mutated", required: false, priority: 0, estimatedTokens: 1,
      pageId: "mutated", path: "mutated", heading: "## Mutated", sectionHash: "mutated", score: 0,
      sourceOrdinal: 0, duplicatePaths: [],
    });
    items[0].replaceAuthorities.push({
      path: "mutated", heading: "## Mutated", sectionOrdinal: 0, sectionHash: "mutated", exactSection: "mutated",
    });
    return [{ role: "user" as const, content: items.map((item) => item.entityKey).join(" ") }];
  };
  const result = batchEntityContexts(source, 100, render, {});
  assert.equal(result.length, 1);
  assert.equal(JSON.stringify(source, (_key, value) => value instanceof Set ? [...value] : value), before);
});

test("page similarity returns candidate paths; context inclusion stays delegated", async () => {
  const service = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  const candidatePages = new Map([["!Wiki/d/wiki_d_k8s.md", "# Kubernetes\n\n## Facts\ncluster deployment"]]);
  const result = await service.selectByEntities(
    [{ name: "Kubernetes" }],
    new Map([["wiki_d_k8s", "kubernetes cluster deployment"]]),
    ["!Wiki/d/wiki_d_k8s.md"],
  );
  assert.deepEqual(result.results.get("Kubernetes::"), ["!Wiki/d/wiki_d_k8s.md"]);
  const context = buildEntityContext({
    evidence,
    candidatePages,
    inputBudgetTokens: 500,
    fixedMessages: [],
    opts: {},
  });
  assert.deepEqual(context.units.map((unit) => unit.path), ["!Wiki/d/wiki_d_k8s.md"]);
  assert.doesNotMatch(context.units[0].text, /(?:index|embedding|vector)\.json/i);
});
