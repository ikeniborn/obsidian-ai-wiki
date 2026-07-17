import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

import {
  SynthesisActionSchema,
  SynthesisOutputSchema,
} from "../src/phases/zod-schemas";
import { inspectPatchablePage } from "../src/section-patches";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const synthesisModule = await import("../src/phases/ingest-synthesis");
const {
  validateSynthesisActions,
  validateSynthesisCoverage,
  synthesizeEntityBatch,
  regenerateConflictedPatch,
  SynthesisStructuredError,
  SynthesisSplitRequiredError,
  ConflictRegenerationExhaustedError,
  ConflictStillStaleError,
} = synthesisModule;
import type OpenAI from "openai";
import type { EntityContextBundle, WikiSectionUnit } from "../src/ingest-context";
import type { ContextUnit } from "../src/prompt-budget";
import type { LlmClient, RunEvent } from "../src/types";
import type { SynthesisOutput } from "../src/phases/zod-schemas";
import { estimatePreparedMessages } from "../src/prompt-budget";

const existingPath = "!Wiki/d/concept/wiki_d_a.md";
const absentPath = "!Wiki/d/concept/wiki_d_b.md";
const testPathPolicy = { domainRoot: "!Wiki/d", allowedSubfolders: ["concept"] };

function create(entityKey = "a", path?: string) {
  return {
    kind: "create" as const,
    entityKey,
    path: path ?? `!Wiki/d/concept/wiki_d_${entityKey}.md`,
    annotation: "A",
    content: "# A\n\n## Facts\nnew",
  };
}

function inspectedPage() {
  const inspected = inspectPatchablePage("# A\n\n## Facts\nold\n");
  return { inspected, section: inspected.sections[0] };
}

function patchFor(
  section: { hash: string; ordinal: number; span: string },
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    kind: "patch" as const,
    entityKey: "a",
    path: existingPath,
    expectedPageHash: inspectedPage().inspected.pageHash,
    sections: [{
      heading: "## Facts",
      operation: "replace" as const,
      expectedSectionOrdinal: section.ordinal,
      expectedSectionHash: section.hash,
      content: "new",
    }],
    ...overrides,
  };
}

function authority(section: { hash: string; ordinal: number; span: string }) {
  return {
    path: existingPath,
    heading: "## Facts",
    sectionOrdinal: section.ordinal,
    sectionHash: section.hash,
    exactSection: section.span,
  };
}

function bundle(entityKey: string, path?: string, section?: { hash: string; ordinal: number; span: string }): EntityContextBundle {
  const target = path ?? `!Wiki/d/concept/wiki_d_${entityKey}.md`;
  const unit: WikiSectionUnit = {
    id: `${target}::Facts`, source: "wiki", text: section?.span ?? `## Facts\n${entityKey} evidence\n`,
    required: Boolean(section), priority: 1, estimatedTokens: 8, pageId: entityKey,
    path: target, heading: "## Facts", sectionHash: section?.hash ?? "", score: 1,
    sourceOrdinal: section?.ordinal ?? 0, duplicatePaths: [target],
  };
  return {
    entityKey,
    evidence: {
      entityKey, entityType: "concept", packetIds: [`p-${entityKey}`], facts: [`fact-${entityKey}`],
      exactSourceRanges: [{ startLine: 1, endLine: 1 }], exactSource: [{ startLine: 1, endLine: 1, text: `source-${entityKey}` }], links: [],
    },
    units: [unit],
    replaceAuthorities: section ? [authority({ ...section })] : [],
    estimatedInputTokens: 8,
  };
}

function outputFor(keys: string[], existing = new Set<string>()) {
  return JSON.stringify({
    reasoning: "ok",
    actions: keys.filter((key) => !existing.has(key)).map((key) => create(key)),
    skips: keys.filter((key) => existing.has(key)).map((key) => ({ entityKey: key, reason: "no change" })),
  });
}

function streamOutput(text: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield {
      id: "synthesis", object: "chat.completion.chunk", created: 0, model: "m",
      choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
    yield {
      id: "usage", object: "chat.completion.chunk", created: 0, model: "m", choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}

function mockLlm(next: (params: Record<string, unknown>) => string | Error, seen: Record<string, unknown>[], events: RunEvent[]): LlmClient {
  return {
    chat: { completions: { create: async (params: unknown) => {
      seen.push(params as Record<string, unknown>);
      const value = next(params as Record<string, unknown>);
      if (value instanceof Error) throw value;
      return streamOutput(value);
    } } },
  } as unknown as LlmClient;
}

function synthesisArgs(bundles: EntityContextBundle[], llm: LlmClient, overrides: Record<string, unknown> = {}) {
  return {
    bundles,
    existingPaths: new Set<string>(),
    existingPageHashes: new Map(bundles
      .filter((candidate) => candidate.replaceAuthorities.length > 0)
      .map((candidate) => [candidate.replaceAuthorities[0].path, inspectPatchablePage("# A\n\n## Facts\nold\n").pageHash])),
    existingPageDescriptions: [],
    tagRegistryUnits: [],
    pathPolicy: { domainRoot: "!Wiki/d", allowedSubfolders: ["concept"] },
    domainContract: "domain d",
    schemaContract: "schema synthesis",
    pathContract: "canonical wiki path",
    llm, model: "m",
    policy: { inputBudgetTokens: 10000, outputBudgetTokens: 300, compression: "balanced" as const },
    opts: {}, signal: new AbortController().signal, onEvent: () => {},
    ...overrides,
  };
}

function regenerationArgs(
  entityKey: string,
  evidence: EntityContextBundle["evidence"],
  targetPath: string,
  pageHash: string,
  targetSections: readonly WikiSectionUnit[],
  replaceAuthorities: EntityContextBundle["replaceAuthorities"],
  llm: LlmClient,
  overrides: Record<string, unknown> = {},
) {
  return {
    entityKey, evidence, targetPath, pageHash, targetSections, replaceAuthorities,
    pathPolicy: { domainRoot: "!Wiki/d", allowedSubfolders: ["concept"] },
    domainContract: "domain d", schemaContract: "schema synthesis", pathContract: "canonical wiki path",
    llm, model: "m",
    policy: { inputBudgetTokens: 10000, outputBudgetTokens: 300, compression: "balanced" as const },
    opts: {}, signal: new AbortController().signal, onEvent: () => {},
    ...overrides,
  };
}

test("synthesizeEntityBatch emits create, patch-safe skip, and bounded prompt telemetry", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const existing = bundle("a", existingPath, section);
  const seen: Record<string, unknown>[] = [];
  const events: RunEvent[] = [];
  const llm = mockLlm((params) => {
    const content = JSON.stringify(params.messages);
    assert.doesNotMatch(content, /987654321\.125|WikiIndexRecord|index\.jsonl|vector/i);
    const messageContent = (params.messages as Array<{ role?: string; content?: unknown }>).find((message) => message.role === "user" && typeof message.content === "string")?.content as string;
    const targetMatch = messageContent.match(/"targets":\s*\[\s*\{\s*"path":\s*"!Wiki\/d\/concept\/wiki_d_a\.md",\s*"pageHash":\s*"([^"]+)"/);
    assert.ok(targetMatch, "initial prompt must expose server-owned target hash");
    const expectedPageHash = targetMatch[1];
    return JSON.stringify({
      reasoning: "ok",
      actions: [create("b"), {
        kind: "patch", entityKey: "a", path: existingPath, expectedPageHash,
        sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal, expectedSectionHash: section.hash, content: "new" }],
      }],
      skips: [],
    });
  }, seen, events);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("b"), existing], llm, {
    existingPaths: new Set([existingPath]),
    existingPageDescriptions: [{ entityKey: "a", path: existingPath, description: "A" }],
    tagRegistryUnits: [{ id: "tag", source: "registry", text: "tag", required: false, priority: 1, estimatedTokens: 1 }],
    policy: { inputBudgetTokens: 10000, outputBudgetTokens: 300, compression: "balanced" as const },
    onEvent: (event: RunEvent) => events.push(event),
  }));
  assert.equal(result.actions.length, 2);
  assert.equal(seen[0].max_tokens, 300);
  assert.equal(estimatePreparedMessages(seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[]) <= 10000, true);
  assert.equal(events.filter((event) => event.kind === "prompt_budget").length >= 1, true);
});

test("no-change entity returns skip and input-only policy omits output cap", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => JSON.stringify({ reasoning: "unchanged", actions: [], skips: [{ entityKey: "a", reason: "no change" }] }), seen, []);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("a", existingPath, current.sections[0])], llm, {
    existingPaths: new Set([existingPath]),
    policy: { inputBudgetTokens: 10000, compression: "balanced" as const },
  }));
  assert.equal(result.skips[0].entityKey, "a");
  assert.equal("max_tokens" in seen[0], false);
});

test("four bundles split into stable whole-bundle halves after provider context failure", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm((params) => {
    const text = JSON.stringify(params.messages);
    if (/entity-a/.test(text) && /entity-d/.test(text)) {
      throw new Error("prompt 20000 exceeds maximum context 10000");
    }
    const keys = ["a", "b", "c", "d"].filter((key) => text.includes(`entity-${key}`));
    return outputFor(keys);
  }, seen, []);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("a"), bundle("b"), bundle("c"), bundle("d")], llm));
  assert.deepEqual(result.actions.map((action) => action.entityKey), ["a", "b", "c", "d"]);
  assert.equal(new Set(result.actions.map((action) => action.entityKey)).size, 4);
  assert.equal(seen.length >= 1, true);
  const successfulPrompts = seen.slice(-2).map((params) => JSON.stringify(params.messages));
  assert.equal(successfulPrompts.every((text) => !(text.includes("entity-a") && text.includes("entity-d"))), true);
});

test("context repack drops optional units, changes prompt hash, preserves required context, and does not mutate bundles", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const a = bundle("a", existingPath, current.sections[0]);
  const b = bundle("b");
  const optional = {
    id: "optional-a", source: "wiki" as const, text: "OPTIONAL-A-SENTINEL", required: false,
    priority: 0, estimatedTokens: 20, pageId: "a", path: existingPath, heading: "## Optional",
    sectionHash: "", score: 0, sourceOrdinal: 1, duplicatePaths: [existingPath],
  };
  a.units = [...a.units, optional];
  const before = structuredClone([a, b]);
  const seen: Record<string, unknown>[] = [];
  let calls = 0;
  const llm = mockLlm((params) => {
    calls++;
    if (calls === 1) throw new Error("prompt 12000 exceeds maximum context 10000");
    const text = JSON.stringify(params.messages);
    assert.match(text, /## Facts|old/);
    assert.match(text, /entity-a/);
    assert.doesNotMatch(text, /OPTIONAL-A-SENTINEL/);
    return JSON.stringify({
      reasoning: "ok",
      actions: [
        patchFor(current.sections[0]),
        create("b"),
      ],
      skips: [],
    });
  }, seen, []);
  const result = await synthesizeEntityBatch(synthesisArgs([a, b], llm, {
    policy: { inputBudgetTokens: 100000, outputBudgetTokens: 300, compression: "balanced" as const },
  }));
  assert.equal(result.actions.length, 2);
  assert.equal(seen.length, 2);
  const firstMessages = seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const secondMessages = seen[1].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  assert.notEqual(JSON.stringify(firstMessages), JSON.stringify(secondMessages));
  assert.equal(estimatePreparedMessages(secondMessages) < estimatePreparedMessages(firstMessages), true);
  assert.deepEqual([a, b], before);
});

test("context repack never drops required registry units while dropping optional auxiliary units", async () => {
  const calls: Record<string, unknown>[] = [];
  const requiredRegistry = { id: "required-registry", source: "registry" as const, text: "REQUIRED-REGISTRY", required: true, priority: 1, estimatedTokens: 1 };
  const optionalRegistry = { id: "optional-registry", source: "registry" as const, text: "OPTIONAL-REGISTRY-".repeat(200), required: false, priority: 1, estimatedTokens: 40 };
  const llm = mockLlm((params) => {
    calls.push(params);
    if (calls.length === 1) throw new Error("prompt 12000 exceeds maximum context 10000");
    const prompt = JSON.stringify(params.messages);
    assert.match(prompt, /REQUIRED-REGISTRY/);
    assert.doesNotMatch(prompt, /OPTIONAL-REGISTRY|OPTIONAL-DESCRIPTION/);
    return outputFor(["a"]);
  }, [], []);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("a")], llm, {
    existingPageDescriptions: [{ entityKey: "a", path: absentPath, description: "OPTIONAL-DESCRIPTION-".repeat(100) }],
    tagRegistryUnits: [requiredRegistry, optionalRegistry],
  }));
  assert.equal(result.actions.length, 1);
  assert.equal(calls.length, 2);
});

test("batch-local partial structured output splits again before merging", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm((params) => {
    const text = JSON.stringify(params.messages);
    const keys = ["a", "b", "c", "d"].filter((key) => text.includes(`entity-${key}`));
    if (keys.length > 2) return outputFor([keys[0]]);
    if (keys.length === 2) return outputFor([keys[0]]);
    return outputFor(keys);
  }, seen, []);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("a"), bundle("b"), bundle("c"), bundle("d")], llm));
  assert.deepEqual(result.actions.map((action) => action.entityKey), ["a", "b", "c", "d"]);
  assert.equal(seen.length, 7);
});

test("synthesis replace rejects wrong ordinal despite matching hash and span", () => {
  const { inspected, section } = inspectedPage();
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspectedPage().inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map([[existingPath, [authority(section)]]]),
    actions: [patchFor(section, {
      sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal + 1, expectedSectionHash: section.hash, content: "new" }],
    })],
  }), /authority|ordinal|replace/i);
});

test("multi-bundle truncated JSON falls back to single-bundle calls", async () => {
  const seen: Record<string, unknown>[] = [];
  let calls = 0;
  const llm = mockLlm((params) => {
    calls++;
    const text = JSON.stringify(params.messages);
    if (calls === 1) return '{"reasoning":"cut';
    const key = ["a", "b"].find((value) => text.includes(`entity-${value}`))!;
    return outputFor([key]);
  }, seen, []);
  const result = await synthesizeEntityBatch(synthesisArgs([bundle("a"), bundle("b")], llm));
  assert.deepEqual(result.actions.map((action) => action.entityKey), ["a", "b"]);
  assert.equal(calls, 3);
});

test("single-bundle structured exhaustion is typed", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => "{\"reasoning\":\"cut", seen, []);
  await assert.rejects(
    synthesizeEntityBatch(synthesisArgs([bundle("a")], llm, { opts: { structuredRetries: 1 } })),
    SynthesisStructuredError,
  );
});

test("single bundle that cannot fit is typed as split-required", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => outputFor(["a"]), seen, []);
  await assert.rejects(
    synthesizeEntityBatch(synthesisArgs([bundle("a")], llm, { policy: { inputBudgetTokens: 1, compression: "balanced" as const } })),
    SynthesisSplitRequiredError,
  );
});

test("conflict regeneration permits exactly one guarded patch and never writes", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => JSON.stringify({
    reasoning: "regenerated",
    actions: [{ kind: "patch", entityKey: "a", path: existingPath, expectedPageHash: current.pageHash,
      sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal, expectedSectionHash: section.hash, content: "fresh" }] }],
    skips: [],
  }), seen, []);
  const result = await regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], llm,
  ));
  assert.equal(result.kind, "patch");
  assert.equal(seen.length, 1);
});

test("conflict regeneration rejects create, wrong entity/path, and repeated stale output", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const base = { entityKey: "a", evidence: bundle("a", existingPath, section).evidence, targetPath: existingPath,
    pageHash: current.pageHash, targetSections: bundle("a", existingPath, section).units, replaceAuthorities: [authority(section)] };
  for (const invalid of [
    { ...create("a", existingPath) },
    { ...create("b", existingPath), kind: "patch", expectedPageHash: current.pageHash, sections: [] },
  ]) {
    const seen: Record<string, unknown>[] = [];
    const llm = mockLlm(() => JSON.stringify({ reasoning: "bad", actions: [invalid], skips: [] }), seen, []);
    await assert.rejects(regenerateConflictedPatch(regenerationArgs(base.entityKey, base.evidence, base.targetPath, base.pageHash, base.targetSections, base.replaceAuthorities, llm)), ConflictRegenerationExhaustedError);
    assert.equal(seen.length, 1);
  }
  const seen: Record<string, unknown>[] = [];
  const staleLlm = mockLlm(() => JSON.stringify({ reasoning: "stale", actions: [{
    kind: "patch", entityKey: "a", path: existingPath, expectedPageHash: "stale",
    sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal, expectedSectionHash: section.hash, content: "fresh" }],
  }], skips: [] }), seen, []);
  await assert.rejects(regenerateConflictedPatch(regenerationArgs(base.entityKey, base.evidence, base.targetPath, base.pageHash, base.targetSections, base.replaceAuthorities, staleLlm, { conflictCount: 1 })), ConflictStillStaleError);
});

test("dedicated regeneration payload excludes descriptions/tags and second conflict makes zero requests", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => { throw new Error("must not call"); }, seen, []);
  await assert.rejects(regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], llm,
    { conflictCount: 1, oldDescription: "OLD-DESCRIPTION-SENTINEL", tagRegistryUnits: [{ text: "OLD-TAG-SENTINEL" }] },
  )), ConflictStillStaleError);
  assert.equal(seen.length, 0);
});

test("regeneration prompt contains only fresh bounded target context and page hash", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const seen: Record<string, unknown>[] = [];
  const events: RunEvent[] = [];
  const llm = mockLlm((params) => {
    const text = JSON.stringify(params.messages);
    assert.match(text, new RegExp(current.pageHash));
    assert.match(text, new RegExp(section.hash));
    assert.match(text, /ordinal/i);
    assert.doesNotMatch(text, /OLD-DESCRIPTION-SENTINEL|OLD-TAG-SENTINEL|WikiIndexRecord|index\.jsonl|vector/i);
    return JSON.stringify({ reasoning: "ok", actions: [{ kind: "patch", entityKey: "a", path: existingPath,
      expectedPageHash: current.pageHash, sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal, expectedSectionHash: section.hash, content: "fresh" }] }], skips: [] });
  }, seen, []);
  await regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], llm,
    { oldDescription: "OLD-DESCRIPTION-SENTINEL", tagRegistryUnits: [{ text: "OLD-TAG-SENTINEL" }], onEvent: (event: RunEvent) => events.push(event) },
  ));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].response_format, undefined);
  assert.equal(events.filter((event) => event.kind === "prompt_budget").length, 1);
});

test("regeneration budget telemetry is serialized after provider usage and matches forwarded messages", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const seen: Record<string, unknown>[] = [];
  const events: RunEvent[] = [];
  const llm = mockLlm(() => JSON.stringify({
    reasoning: "ok", actions: [{ kind: "patch", entityKey: "a", path: existingPath, expectedPageHash: current.pageHash,
      sections: [{ operation: "replace", heading: "## Facts", expectedSectionOrdinal: section.ordinal, expectedSectionHash: section.hash, content: "fresh" }] }], skips: [],
  }), seen, []);
  await regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], llm,
    { opts: { outputLanguage: "en" }, onEvent: (event: RunEvent) => events.push(JSON.parse(JSON.stringify(event))) },
  ));
  const budget = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.actualInputTokens, 5);
  assert.equal(budget.estimatedInputTokens, estimatePreparedMessages(seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[]));
  const prompt = JSON.stringify(seen[0].messages);
  assert.equal((prompt.match(/You are a wiki agent/g) ?? []).length, 1);
  assert.equal((prompt.match(/## Semantic compression/g) ?? []).length, 1);
  assert.equal((prompt.match(/Write the entire response in English/g) ?? []).length, 1);
});

test("regeneration blocks transport fallback and forwards exactly one underlying request", async () => {
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  let forwarded = 0;
  const llm = {
    chat: { completions: { create: async () => {
      forwarded++;
      throw new Error("temporary transport failure");
    } } },
  } as unknown as LlmClient;
  await assert.rejects(regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], llm,
  )), ConflictRegenerationExhaustedError);
  assert.equal(forwarded, 1);
});

test("every entity bundle receives exactly one action or explicit skip", () => {
  assert.throws(() => validateSynthesisCoverage(["a", "b"], {
    actions: [create("a", absentPath)],
    skips: [],
  }), /b/);

  assert.throws(() => validateSynthesisCoverage(["a"], {
    actions: [create("a", absentPath)],
    skips: [{ entityKey: " a ", reason: "already covered" }],
  }), /duplicate/i);
});

test("coverage rejects unknown keys, blank values, and duplicate action paths", () => {
  assert.throws(() => validateSynthesisCoverage(["a"], {
    actions: [create("unknown", absentPath)],
    skips: [],
  }), /unknown/i);
  assert.throws(() => validateSynthesisCoverage(["a"], {
    actions: [create(" ", absentPath)],
    skips: [],
  }), /entity key/i);
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set<string>(),
    existingPageHashes: new Map(),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [create("a", absentPath), create("b", absentPath)],
  }), /duplicate.*path/i);
});

test("existing paths reject complete-page create output", () => {
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspectedPage().inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [create("a", existingPath)],
  }), /existing page/i);
});

test("server-owned hash keys establish existence and mismatched patch hashes fail closed", () => {
  const hash = inspectedPage().inspected.pageHash;
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set(), existingPageHashes: new Map([[existingPath, hash]]), pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(), actions: [create("a", existingPath)],
  }), /existing page/i);
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set(), existingPageHashes: new Map([[existingPath, hash]]), pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(), actions: [patchFor(inspectedPage().section, { expectedPageHash: "wrong" })],
  }), /server-owned|hash/i);
});

test("absent paths reject patch output", () => {
  const { section } = inspectedPage();
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set<string>(),
    existingPageHashes: new Map(),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [patchFor(section, { path: absentPath })],
  }), /absent/i);
});

test("authorized replace requires exact path, heading, ordinal, hash, and span", () => {
  const { inspected, section } = inspectedPage();
  const valid = {
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map([[existingPath, [authority(section)]]]),
    actions: [patchFor(section)],
  };
  assert.doesNotThrow(() => validateSynthesisActions(valid));

  for (const change of [
    { path: "!Wiki/other/concept/wiki_other_a.md" },
    { heading: "## Other" },
    { sectionOrdinal: section.ordinal + 1 },
    { sectionHash: "00000000" },
    { exactSection: "## Facts\nwrong" },
  ]) {
    const bad = { ...authority(section), ...change };
    const records = [bad];
    assert.throws(() => validateSynthesisActions({
      ...valid,
      replaceAuthorities: new Map([[existingPath, records]]),
    }), /authority|replace|section|path/i);
  }
});

test("add and append do not require replace authority", () => {
  const { inspected } = inspectedPage();
  assert.doesNotThrow(() => validateSynthesisActions({
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [{
      kind: "patch", entityKey: "a", path: existingPath,
      expectedPageHash: inspected.pageHash,
      sections: [{ operation: "add", heading: "## New", content: "new" }],
    }],
  }));
  assert.doesNotThrow(() => validateSynthesisActions({
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [{
      kind: "patch", entityKey: "a", path: existingPath,
      expectedPageHash: inspected.pageHash,
      sections: [{ operation: "append", heading: "## Facts", content: "more" }],
    }],
  }));
});

test("malformed patch actions and non-canonical paths fail", () => {
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set([existingPath]),
    existingPageHashes: new Map([[existingPath, inspectedPage().inspected.pageHash]]),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [{ ...create("a", existingPath), kind: "patch", sections: [] }],
  }), /patch|expectedPageHash|sections/i);
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set(),
    existingPageHashes: new Map(),
    pathPolicy: testPathPolicy,
    replaceAuthorities: new Map(),
    actions: [create("a", "notes/a.md")],
  }), /canonical|wiki|path/i);
});

test("governed path policy rejects traversal, foreign domains, and unauthorized folders", () => {
  const invalid = [
    "!Wiki/d/../concept/wiki_d_a.md",
    "!Wiki/d/./concept/wiki_d_a.md",
    "!Wiki/d//concept/wiki_d_a.md",
    "!Wiki/other/concept/wiki_other_a.md",
    "!Wiki/d/private/wiki_d_a.md",
  ];
  for (const path of invalid) {
    assert.throws(() => validateSynthesisActions({
      existingPaths: new Set(), existingPageHashes: new Map(), pathPolicy: testPathPolicy, replaceAuthorities: new Map(), actions: [create("a", path)],
    }), /canonical|path/i);
  }
  assert.doesNotThrow(() => validateSynthesisActions({
    existingPaths: new Set(), existingPageHashes: new Map(), pathPolicy: testPathPolicy, replaceAuthorities: new Map(), actions: [create("a", absentPath)],
  }));
});

test("synthesis prompt projects allowlisted DTO fields only", async () => {
  const candidate = bundle("a") as EntityContextBundle & { vector?: string; rawRecord?: string };
  candidate.vector = "RAW-VECTOR-SENTINEL";
  candidate.rawRecord = "RAW-RECORD-SENTINEL";
  const registry = { id: "registry", source: "registry" as const, text: "legitimate vector prose", required: false, priority: 1, estimatedTokens: 1, vector: "RAW-REGISTRY-VECTOR" } as unknown as ContextUnit;
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm((params) => {
    const prompt = JSON.stringify(params.messages);
    assert.doesNotMatch(prompt, /RAW-VECTOR-SENTINEL|RAW-RECORD-SENTINEL|RAW-REGISTRY-VECTOR/);
    assert.match(prompt, /legitimate vector prose/);
    return outputFor(["a"]);
  }, seen, []);
  await synthesizeEntityBatch(synthesisArgs([candidate], llm, { tagRegistryUnits: [registry] }));
});

test("synthesis and regeneration prompts project path policy allowlists only", async () => {
  const policy = {
    domainRoot: "!Wiki/d",
    allowedSubfolders: ["concept"],
    allowedPaths: ["!Wiki/d/concept/wiki_d_a.md", absentPath],
    rawRecord: "RAW-POLICY-RECORD",
    vector: "RAW-POLICY-VECTOR",
    apiKey: "RAW-POLICY-API-KEY",
  } as unknown as { domainRoot: string; allowedSubfolders: string[]; allowedPaths: string[] };
  const policySnapshot = structuredClone(policy);
  const synthesisSeen: Record<string, unknown>[] = [];
  const synthesisLlm = mockLlm(() => outputFor(["a"]), synthesisSeen, []);
  await synthesizeEntityBatch(synthesisArgs([bundle("a")], synthesisLlm, { pathPolicy: policy }));
  const current = inspectPatchablePage("# A\n\n## Facts\nold\n");
  const section = current.sections[0];
  const regenSeen: Record<string, unknown>[] = [];
  const regenLlm = mockLlm(() => JSON.stringify({
    reasoning: "ok",
    actions: [patchFor(section)],
    skips: [],
  }), regenSeen, []);
  await regenerateConflictedPatch(regenerationArgs(
    "a", bundle("a", existingPath, section).evidence, existingPath, current.pageHash,
    bundle("a", existingPath, section).units, [authority(section)], regenLlm,
    { pathPolicy: policy },
  ));
  const prompts = [...synthesisSeen, ...regenSeen].map((params) =>
    (params.messages as Array<{ content?: unknown }>).map((message) => String(message.content ?? "")).join("\n"));
  assert.ok(prompts.length >= 2);
  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /RAW-POLICY-RECORD|RAW-POLICY-VECTOR|RAW-POLICY-API-KEY/);
    assert.match(prompt, /"domainRoot"\s*:\s*"!Wiki\/d"/);
    assert.match(prompt, /"allowedSubfolders"\s*:\s*\[\s*"concept"\s*\]/);
  }
  assert.deepEqual(policy, policySnapshot);
});

test("accepted synthesis decisions follow bundle order and sort deltas deterministically", async () => {
  const llm = mockLlm(() => JSON.stringify({
    reasoning: "ok",
    actions: [create("c"), create("a")],
    skips: [{ entityKey: "d", reason: "unchanged" }, { entityKey: "b", reason: "unchanged" }],
    entity_types_delta: [
      { type: "Zeta", description: "z", extraction_cues: [] },
      { type: "alpha", description: "a", extraction_cues: [] },
    ],
  }), [], []);
  const result = await synthesizeEntityBatch(synthesisArgs(
    [bundle("a"), bundle("b"), bundle("c"), bundle("d")], llm,
  ));
  assert.deepEqual(result.actions.map((action) => action.entityKey), ["a", "c"]);
  assert.deepEqual(result.skips.map((skip) => skip.entityKey), ["b", "d"]);
  assert.deepEqual(result.entity_types_delta?.map((delta) => delta.type), ["alpha", "zeta"]);
});

test("recursive synthesis keeps stable bundle order after split", async () => {
  let calls = 0;
  const llm = mockLlm((params) => {
    calls++;
    const keys = ["a", "b", "c", "d"].filter((key) => JSON.stringify(params.messages).includes(`entity-${key}`));
    if (keys.length > 1) return JSON.stringify({ reasoning: "partial", actions: [create(keys.at(-1)!)], skips: [] });
    return outputFor(keys);
  }, [], []);
  const result = await synthesizeEntityBatch(synthesisArgs(
    [bundle("a"), bundle("b"), bundle("c"), bundle("d")], llm,
  ));
  assert.deepEqual(result.actions.map((action) => action.entityKey), ["a", "b", "c", "d"]);
  assert.equal(calls > 1, true);
});

test("synthesis schemas are strict and reject malformed discriminants and duplicate coverage", () => {
  assert.equal(SynthesisActionSchema.safeParse({ ...create(), kind: "remove" }).success, false);
  assert.equal(SynthesisActionSchema.safeParse({
    ...create(),
    extra: true,
  }).success, false);
  assert.equal(SynthesisOutputSchema.safeParse({
    reasoning: "r",
    actions: [create("a", absentPath)],
    skips: [{ entityKey: " a ", reason: "skip" }],
  }).success, false);
});

test("synthesis prompt exposes bounded contracts without raw index or vector data", async () => {
  const prompt = await readFile(new URL("../prompts/ingest-synthesis.md", import.meta.url), "utf8");
  assert.match(prompt, /domain|schema|path/i);
  assert.match(prompt, /EntityContextBundle|evidence|ReplaceSectionAuthority/);
  assert.match(prompt, /ordinal/i);
  assert.match(prompt, /page description|tag registry/i);
  assert.doesNotMatch(prompt, /WikiIndexRecord|index\.jsonl|vector|embedding vector/i);
});

test("entity type delta identity is locale-stable and equivalent duplicates dedupe", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = mockLlm(() => JSON.stringify({
    reasoning: "ok",
    actions: [create("a")],
    skips: [],
    entity_types_delta: [
      { type: "  Café ", description: "A", extraction_cues: [" cue "], min_mentions_for_page: 1 },
      { type: "café", description: "A", extraction_cues: ["cue"], min_mentions_for_page: 1 },
    ],
  }), seen, []);
  const output = await synthesizeEntityBatch(synthesisArgs([bundle("a")], llm));
  assert.equal(output.entity_types_delta?.length, 1);
});

test("conflicting normalized entity type deltas fail closed", async () => {
  const llm = mockLlm(() => JSON.stringify({
    reasoning: "ok", actions: [create("a")], skips: [],
    entity_types_delta: [
      { type: "Concept", description: "A", extraction_cues: [] },
      { type: " concept ", description: "B", extraction_cues: [] },
    ],
  }), [], []);
  await assert.rejects(synthesizeEntityBatch(synthesisArgs([bundle("a")], llm)), /conflicting entity type delta/i);
});

test("conflicting entity type deltas from recursively split outputs fail final merge", async () => {
  let calls = 0;
  const llm = mockLlm(() => {
    calls++;
    const key = calls === 1 || calls === 2 ? "a" : "b";
    const description = calls === 2 ? "A" : "B";
    return JSON.stringify({ reasoning: "ok", actions: [create(key)], skips: [], entity_types_delta: [
      { type: "Concept", description, extraction_cues: [] },
    ] });
  }, [], []);
  await assert.rejects(synthesizeEntityBatch(synthesisArgs([bundle("a"), bundle("b")], llm)), /conflicting entity type delta/i);
  assert.equal(calls, 3);
});

test("cross-batch synthesis aggregation is deterministic and rejects conflicting deltas", () => {
  const merge = (
    synthesisModule as unknown as {
      mergeSynthesisBatchOutputs?: (outputs: readonly SynthesisOutput[]) => SynthesisOutput;
    }
  ).mergeSynthesisBatchOutputs;
  assert.equal(typeof merge, "function");
  const output = (type: string, description: string, entityKey: string): SynthesisOutput => ({
    reasoning: entityKey,
    actions: [create(entityKey)],
    skips: [],
    entity_types_delta: [{ type, description, extraction_cues: [] }],
  });

  const merged = merge!([
    output("Zeta", "z", "b"),
    output("alpha", "a", "a"),
  ]);
  assert.deepEqual(merged.entity_types_delta?.map((delta) => delta.type), ["alpha", "zeta"]);
  assert.throws(
    () => merge!([
      output("Concept", "first", "a"),
      output(" concept ", "second", "b"),
    ]),
    /conflicting entity type delta/i,
  );
});
