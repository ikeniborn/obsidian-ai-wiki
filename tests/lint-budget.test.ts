import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { contentHash } from "../src/content-hash";
import { estimatePreparedMessages } from "../src/prompt-budget";
import { inspectPatchablePage } from "../src/section-patches";
import type { DomainEntry } from "../src/domain";
import type { LlmClient, RunEvent, RunRequest } from "../src/types";
import type { VaultAdapter } from "../src/vault-tools";
import * as lintBatches from "../src/phases/lint-batches";
import {
  buildLintBatchMessages,
  buildLintWorkItems,
  lintFindingKey,
  mergeLintFindings,
  validateLintBatchOutput,
  validateLintCoverage,
  type LintBatchOutput,
  type LintFinding,
} from "../src/phases/lint-batches";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") {
    return { url: "node:path", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

class MemoryAdapter implements VaultAdapter {
  readonly reads: string[] = [];
  readonly writes: string[] = [];

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    this.reads.push(path);
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.length > 0 ? `${path}/` : "";
    const directFiles: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) {
        directFiles.push(file);
      } else {
        folders.add(`${prefix}${rest.slice(0, slash)}`);
      }
    }
    return { files: directFiles.sort(), folders: [...folders].sort() };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async mkdir(_path: string): Promise<void> {}
}

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(promptTokens: number = 10): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: 3, total_tokens: promptTokens + 3 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function jsonLlm(output: string, seen: Record<string, unknown>[] = []): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          seen.push(params as Record<string, unknown>);
          if ((params as { stream?: boolean }).stream === false) {
            return {
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: output },
              }],
              usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
            };
          }
          return (async function* () {
            yield chunk(output);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

async function collectEvents(generator: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function nextWithOverallTimeout<T>(
  generator: AsyncGenerator<RunEvent, T>,
  label: string,
): Promise<IteratorResult<RunEvent, T>> {
  let resolve!: (value: IteratorResult<RunEvent, T>) => void;
  let reject!: (error: unknown) => void;
  const settled = new Promise<IteratorResult<RunEvent, T>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void generator.next().then(resolve, reject);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(`${label} lifecycle buffered behind request`)), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

test("normal and oversized pages produce complete work-item coverage", () => {
  const pages = new Map([
    ["!Wiki/d/concept/a.md", "# A\n\n## Facts\nshort"],
    ["!Wiki/d/concept/b.md", `# B\n\n## Facts\n${"long line\n".repeat(300)}`],
  ]);
  const items = buildLintWorkItems(pages, 500);
  assert.ok(items.length > 2);
  assert.doesNotThrow(() => validateLintCoverage(pages, items));
  assert.deepEqual(new Set(items.map((item) => item.path)), new Set(pages.keys()));
});

test("oversized H2 and line-window work items expose page hash for valid patches", () => {
  const content = [
    "# A",
    "",
    "## Facts",
    "short fact",
    "",
    "## Logs",
    "long log line\n".repeat(140),
  ].join("\n");
  const pages = new Map([["!Wiki/d/concept/a.md", content]]);
  const items = buildLintWorkItems(pages, 500);
  const h2Item = items.find((item) => item.heading === "## Facts");
  const windowItem = items.find((item) => item.heading === "## Logs");
  assert.ok(h2Item);
  assert.ok(windowItem);

  const output: LintBatchOutput = {
    coveredWorkIds: [h2Item.id, windowItem.id],
    findings: [],
    patches: [
      {
        kind: "patch",
        path: h2Item.path,
        expectedPageHash: (h2Item as LintWorkItemWithPageHash).expectedPageHash,
        sections: [{
          operation: "replace",
          heading: h2Item.heading,
          expectedSectionHash: h2Item.sectionHash,
          content: "changed fact",
        }],
      },
      {
        kind: "patch",
        path: windowItem.path,
        expectedPageHash: (windowItem as LintWorkItemWithPageHash).expectedPageHash,
        sections: [{
          operation: "append",
          heading: windowItem.heading,
          expectedSectionHash: windowItem.sectionHash,
          content: "additional bounded note",
        }],
      },
    ],
    deletes: [],
  };
  assert.doesNotThrow(() => validateLintBatchOutput([h2Item, windowItem], pages, output));
});

test("line-window work item allows append but rejects full-section replace authority", () => {
  const content = [
    "# A",
    "",
    "## Logs",
    "long log line\n".repeat(120),
  ].join("\n");
  const pages = new Map([["!Wiki/d/concept/a.md", content]]);
  const windowItem = buildLintWorkItems(pages, 500).find((item) => item.heading === "## Logs");
  assert.ok(windowItem);

  assert.doesNotThrow(() => validateLintBatchOutput([windowItem], pages, {
    coveredWorkIds: [windowItem.id],
    findings: [],
    patches: [{
      kind: "patch",
      path: windowItem.path,
      expectedPageHash: windowItem.expectedPageHash,
      sections: [{
        operation: "append",
        heading: windowItem.heading,
        expectedSectionHash: windowItem.sectionHash,
        content: "additional bounded note",
      }],
    }],
    deletes: [],
  }));

  assert.throws(() => validateLintBatchOutput([windowItem], pages, {
    coveredWorkIds: [windowItem.id],
    findings: [],
    patches: [{
      kind: "patch",
      path: windowItem.path,
      expectedPageHash: windowItem.expectedPageHash,
      sections: [{
        operation: "replace",
        heading: windowItem.heading,
        expectedSectionHash: windowItem.sectionHash,
        content: "replacement from partial context",
      }],
    }],
    deletes: [],
  }), /replace_context_missing/);
});

type LintWorkItemWithPageHash = ReturnType<typeof buildLintWorkItems>[number] & {
  expectedPageHash: string;
};

test("findings merge once by page, section, rule, severity, and text", () => {
  const finding: LintFinding = {
    path: "!Wiki/d/concept/a.md",
    heading: "## Facts",
    rule: "missing-limit",
    severity: "warning",
    text: "Limit is absent",
    repairInstruction: "Add the documented limit",
  };
  assert.deepEqual(mergeLintFindings([[finding], [finding]]), [finding]);
  assert.equal(
    lintFindingKey({ ...finding, text: "  LIMIT   is absent  " }),
    lintFindingKey(finding),
  );
});

test("missing work IDs fail before reporting success", () => {
  assert.throws(() => validateLintCoverage(
    new Map([["a.md", "# A\n\n## One\na\n\n## Two\nb"]]),
    [{ id: "a:one", path: "a.md", heading: "## One", markdown: "## One\na", sectionHash: "h", expectedPageHash: "h" }],
  ), /Two/);
});

test("batch output must cover each submitted work id exactly once", () => {
  const pages = new Map([["!Wiki/d/concept/a.md", "# A\n\n## Facts\nshort"]]);
  const items = buildLintWorkItems(pages, 500);
  const output: LintBatchOutput = {
    coveredWorkIds: [items[0].id, items[0].id],
    findings: [],
    patches: [],
    deletes: [],
  };
  assert.throws(() => validateLintBatchOutput(items, pages, output), /duplicate.*coveredWorkIds/i);
  assert.throws(() => validateLintBatchOutput(items, pages, { ...output, coveredWorkIds: [] }), /missing.*coveredWorkIds/i);
});

test("patch and delete targets must be submitted paths", () => {
  const pages = new Map([["!Wiki/d/concept/a.md", "# A\n\n## Facts\nshort"]]);
  const items = buildLintWorkItems(pages, 500);
  const output: LintBatchOutput = {
    coveredWorkIds: items.map((item) => item.id),
    findings: [],
    patches: [{
      kind: "patch",
      path: "!Wiki/d/concept/b.md",
      expectedPageHash: contentHash("# B"),
      sections: [{ operation: "add", heading: "## New", content: "text" }],
    }],
    deletes: [],
  };
  assert.throws(() => validateLintBatchOutput(items, pages, output), /not submitted/i);
  assert.throws(() => validateLintBatchOutput(items, pages, {
    ...output,
    patches: [],
    deletes: [{ path: "!Wiki/d/concept/b.md" }],
  }), /not submitted/i);
});

test("replace patches require submitted section authority", () => {
  const content = "# A\n\n## Facts\nshort";
  const pages = new Map([["!Wiki/d/concept/a.md", content]]);
  const items = buildLintWorkItems(pages, 500);
  const inspected = inspectPatchablePage(content);
  const output: LintBatchOutput = {
    coveredWorkIds: items.map((item) => item.id),
    findings: [],
    patches: [{
      kind: "patch",
      path: "!Wiki/d/concept/a.md",
      expectedPageHash: inspected.pageHash,
      sections: [{
        operation: "replace",
        heading: "## Facts",
        expectedSectionHash: "fnv1a:bad",
        content: "changed",
      }],
    }],
    deletes: [],
  };
  assert.throws(() => validateLintBatchOutput(items, pages, output), /section_hash_mismatch/i);
});

test("100-page batches cover every work item once and stay under prompt budget", () => {
  const pages = new Map<string, string>();
  for (let i = 0; i < 100; i++) {
    const body = i === 42 ? "oversized\n".repeat(500) : `fact ${i}`;
    pages.set(`!Wiki/d/concept/wiki_d_page_${i}.md`, `# Page ${i}\n\n## Facts\n${body}`);
  }

  const budget = 1_400;
  const items = buildLintWorkItems(pages, budget);
  validateLintCoverage(pages, items);
  assert.ok(items.length > pages.size);

  const seen = new Set<string>();
  for (const item of items) {
    const messages = buildLintBatchMessages({
      domainName: "Demo",
      schema: "",
      workItems: [item],
      relatedSections: [],
    });
    assert.ok(estimatePreparedMessages(messages) <= budget, item.id);
    assert.equal(seen.has(item.id), false, item.id);
    seen.add(item.id);
  }
  assert.equal(seen.size, items.length);

  const duplicatedFindings = items.slice(0, 5).map((item): LintFinding => ({
    path: item.path,
    heading: item.heading,
    rule: "demo",
    severity: "warning",
    text: "Duplicate text",
    repairInstruction: "Fix duplicate text",
  }));
  assert.equal(mergeLintFindings([duplicatedFindings, duplicatedFindings]).length, 5);
});

test("optional related lint sections are included when budget allows and dropped when tight", () => {
  const pages = new Map([
    ["!Wiki/d/concept/a.md", "# A\n\n## Facts\nalpha duplicate target"],
    ["!Wiki/d/concept/b.md", "# B\n\n## Facts\nalpha duplicate context"],
  ]);
  const items = buildLintWorkItems(pages, 2_000);
  const submitted = [items.find((item) => item.path.endsWith("/a.md"))!];
  const buildRelated = (lintBatches as typeof lintBatches & {
    buildLintRelatedSections?: (
      allItems: readonly typeof items[number][],
      submittedItems: readonly typeof items[number][],
      pages: ReadonlyMap<string, string>,
      budget: number,
    ) => Array<{ path: string; markdown: string }>;
  }).buildLintRelatedSections;
  const roomy = buildRelated?.(items, submitted, pages, 2_000) ?? [];
  assert.ok(roomy.some((section) => section.path.endsWith("/b.md")));
  const tight = buildRelated?.(items, submitted, pages, 10) ?? [];
  assert.deepEqual(tight, []);
  assert.doesNotThrow(() => validateLintBatchOutput(submitted, pages, {
    coveredWorkIds: submitted.map((item) => item.id),
    findings: [],
    patches: [],
    deletes: [],
  }));
});

test("lint-chat lexical selection ignores unrelated paths present only in the full report", async () => {
  const files = new Map<string, string>();
  const reportLines: string[] = [];
  for (let i = 0; i < 12; i++) {
    const path = `!Wiki/d/concept/wiki_d_page_${i}.md`;
    files.set(path, `# Page ${i}\n\n## Facts\n${i === 7 ? "orphan alpha issue" : `unrelated ${i}`}`);
    reportLines.push(`- [warning] ${path} :: ## Facts :: ${i === 7 ? "orphan-alpha" : `other-${i}`} :: ${i === 7 ? "orphan alpha issue" : `other issue ${i}`}`);
  }
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const adapter = new MemoryAdapter(files);
  const seen: Record<string, unknown>[] = [];
  const events = await collectEvents(runLintFixChat(
    {
      operation: "lint-chat",
      context: reportLines.join("\n"),
      chatMessages: [{ role: "user", content: "Fix the orphan alpha issue" }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({ summary: "ok", patches: [] }), seen),
    "m",
    { inputBudgetTokens: 10_000, semanticCompression: { profile: "balanced", operation: "lint" } },
    new AbortController().signal,
  ));
  const readUse = events.find((event): event is Extract<RunEvent, { kind: "tool_use" }> =>
    event.kind === "tool_use" && event.name === "Read"
  );
  assert.deepEqual(readUse?.input, { files: "1" });
  assert.equal(adapter.reads.filter((path) => path.endsWith(".md")).length, 1);
  assert.equal(adapter.reads.some((path) => path.endsWith("wiki_d_page_7.md")), true);
  assert.ok(seen.length > 0);
  assert.equal(seen.every((request) => request.stream === false), true);
  assert.ok(estimatePreparedMessages((seen[0].messages ?? []) as OpenAI.Chat.ChatCompletionMessageParam[]) <= 10_000);
  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle"
        ? [event.action, event.phase]
        : []),
    [
      ["apply_lint_fixes", "preparing"],
      ["apply_lint_fixes", "sent"],
      ["apply_lint_fixes", "waiting"],
      ["apply_lint_fixes", "producing"],
      ["apply_lint_fixes", "validating"],
      ["apply_lint_fixes", "applying"],
      ["apply_lint_fixes", "completed"],
    ],
  );
  assert.equal(events.some((event) => event.kind === "result" && event.text === "ok"), true);
});

test("lint-chat fails closed instead of calling LLM with empty pages after lexical budget shrink", async () => {
  const path = "!Wiki/d/concept/wiki_d_huge.md";
  const files = new Map<string, string>([
    [path, `# Huge\n\n## Facts\nselected oversized issue\n${"large body\n".repeat(2_000)}`],
  ]);
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const adapter = new MemoryAdapter(files);
  const seen: Record<string, unknown>[] = [];
  const events = await collectEvents(runLintFixChat(
    {
      operation: "lint-chat",
      context: `- [warning] ${path} :: ## Facts :: selected-oversized :: selected oversized issue`,
      chatMessages: [{ role: "user", content: "Fix selected oversized issue" }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({ summary: "unexpected", patches: [] }), seen),
    "m",
    { inputBudgetTokens: 5_000, semanticCompression: { profile: "balanced", operation: "lint" } },
    new AbortController().signal,
  ));
  assert.equal(seen.length, 0);
  assert.equal(events.some((event) => event.kind === "error" && /selected referenced page context exceeds input budget/i.test(event.message)), true);
  assert.equal(events.some((event) => event.kind === "result" && event.text === ""), true);
});

test("lint-chat bare-stem explicit refs use boundaries and do not select overlapping stems", async () => {
  const files = new Map<string, string>([
    ["!Wiki/d/concept/wiki_d_page_1.md", "# Page 1\n\n## Facts\nwrong page"],
    ["!Wiki/d/concept/wiki_d_page_10.md", "# Page 10\n\n## Facts\ntarget page"],
  ]);
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const adapter = new MemoryAdapter(files);
  const events = await collectEvents(runLintFixChat(
    {
      operation: "lint-chat",
      context: [
        "- [warning] !Wiki/d/concept/wiki_d_page_1.md :: ## Facts :: wrong :: wrong page",
        "- [warning] !Wiki/d/concept/wiki_d_page_10.md :: ## Facts :: target :: target page",
      ].join("\n"),
      chatMessages: [{ role: "user", content: "Fix wiki_d_page_10" }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({ summary: "ok", patches: [] })),
    "m",
    { inputBudgetTokens: 5_000, semanticCompression: { profile: "balanced", operation: "lint" } },
    new AbortController().signal,
  ));
  const readUse = events.find((event): event is Extract<RunEvent, { kind: "tool_use" }> =>
    event.kind === "tool_use" && event.name === "Read"
  );
  assert.deepEqual(readUse?.input, { files: "1" });
  assert.deepEqual(adapter.reads.filter((path) => path.endsWith(".md")), ["!Wiki/d/concept/wiki_d_page_10.md"]);
});

test("lint-chat fails closed when newest chat message is not a nonblank user instruction", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const events = await collectEvents(runLintFixChat(
    {
      operation: "lint-chat",
      context: "- [warning] !Wiki/d/concept/a.md :: ## Facts :: rule :: text",
      chatMessages: [
        { role: "user", content: "fix text" },
        { role: "assistant", content: "which one?" },
      ],
    } as RunRequest,
    new VaultTools(new MemoryAdapter(new Map([["!Wiki/d/concept/a.md", "# A\n\n## Facts\ntext"]])), ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({ summary: "unexpected", patches: [] })),
    "m",
    {},
    new AbortController().signal,
  ));
  assert.equal(events.some((event) => event.kind === "error" && /newest user instruction/i.test(event.message)), true);
  assert.equal(events.some((event) => event.kind === "tool_use" && event.name === "Read"), false);
});

test("lint prompt describes JSON duplicate deletes without framed output markers", () => {
  const prompt = readFileSync("prompts/lint.md", "utf8");
  assert.equal(prompt.includes("<<<PAGE>>>"), false);
  assert.equal(prompt.includes("<<<DELETE>>>"), false);
  assert.equal(/framed output/i.test(prompt), false);
  assert.match(prompt, /"deletes"/);
  assert.match(prompt, /"redirect_to"/);
});

function lifecycleAttempts(
  events: RunEvent[],
  callSite: string,
): Array<{ action: string; phases: string[] }> {
  const ids = new Set(events.filter((event) =>
    event.kind === "llm_lifecycle" && event.diagnostics?.callSite === callSite));
  const lifecycleIds = new Set([...ids].map((event) => event.kind === "llm_lifecycle" ? event.id : ""));
  const lifecycle = events.filter((event) =>
    event.kind === "llm_lifecycle" && lifecycleIds.has(event.id));
  return [...lifecycleIds].map((id) => {
    const attempt = lifecycle.filter((event) => event.kind === "llm_lifecycle" && event.id === id);
    return {
      action: attempt[0]?.kind === "llm_lifecycle" ? attempt[0].action : "",
      phases: attempt.map((event) => event.kind === "llm_lifecycle" ? event.phase : ""),
    };
  });
}

function lintPatch(path: string, content: string) {
  const inspected = inspectPatchablePage(content);
  const facts = inspected.sections.find((section) => section.heading === "## Facts");
  assert.ok(facts);
  return {
    kind: "patch" as const,
    path,
    expectedPageHash: inspected.pageHash,
    sections: [{
      operation: "append" as const,
      heading: facts.heading,
      expectedSectionHash: facts.hash,
      content: "Lifecycle mutation fix.",
    }],
  };
}

function lintOperationLlm(
  path: string,
  content: string,
  beforeCreate?: (kind: "batch" | "config") => Promise<void>,
): LlmClient {
  const patch = lintPatch(path, content);
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const user = ((params as {
            messages?: Array<{ content?: unknown }>;
          }).messages ?? []).find((message) =>
            typeof message.content === "string"
            && message.content.startsWith("Submitted lint work items:"));
          const match = typeof user?.content === "string"
            ? user.content.match(/Submitted lint work items:\n([\s\S]*?)\n\nOptional related sections:/)
            : null;
          await beforeCreate?.(match ? "batch" : "config");
          const output = match
            ? (() => {
                const items = JSON.parse(match[1]) as Array<{
                  id: string;
                  heading: string;
                }>;
                return {
                  coveredWorkIds: items.map((item) => item.id),
                  findings: [],
                  patches: [patch],
                  deletes: [],
                };
              })()
            : {
                reasoning: "Keep config.",
                entity_types: [],
                language_notes: "",
              };
          return jsonLlm(JSON.stringify(output)).chat.completions.create(params as never);
        },
      },
    },
  } as unknown as LlmClient;
}

test("Lint batch/config lifecycle completes only after a successful patch write", async () => {
  const { runLint } = await import("../src/phases/lint");
  const { VaultTools } = await import("../src/vault-tools");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "---\ntype: concept\ndescription: Alpha.\nresource: [source]\n---\n# Alpha\n\n## Facts\nOld fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  const batchRelease = deferred();
  const configRelease = deferred();
  const llm = lintOperationLlm(path, content, (kind) =>
    kind === "batch" ? batchRelease.promise : configRelease.promise);

  const generator = runLint(
    ["d"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [{ id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry],
    "/vault",
    new AbortController().signal,
    0,
    { inputBudgetTokens: 24_000, maxTokens: 2_000, structuredRetries: 0 },
  );
  const events: RunEvent[] = [];
  for (const [callSite, release] of [
    ["lint.batch", batchRelease],
    ["lint.patch", configRelease],
  ] as const) {
    const livePhases: string[] = [];
    while (livePhases.length < 3) {
      const next = await nextWithOverallTimeout(generator, callSite);
      assert.equal(next.done, false);
      if (!next.done) {
        events.push(next.value);
        if (next.value.kind === "llm_lifecycle"
          && next.value.diagnostics?.callSite === callSite) {
          livePhases.push(next.value.phase);
        }
      }
    }
    assert.deepEqual(livePhases, ["preparing", "sent", "waiting"]);
    release.resolve();
  }
  for await (const event of generator) events.push(event);

  assert.match(adapter.files.get(path) ?? "", /Lifecycle mutation fix/, JSON.stringify(events));
  assert.deepEqual(lifecycleAttempts(events, "lint.batch"), [{
    action: "check_wiki_quality",
    phases: ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
  }]);
  assert.deepEqual(lifecycleAttempts(events, "lint.patch"), [{
    action: "check_wiki_quality",
    phases: ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"],
  }]);
});

test("Lint cancels a validated single batch before applying and performs no write", async () => {
  const { runLint } = await import("../src/phases/lint");
  const { VaultTools } = await import("../src/vault-tools");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "---\ntype: concept\ndescription: Alpha.\nresource: [source]\n---\n# Alpha\n\n## Facts\nOld fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  const controller = new AbortController();
  const generator = runLint(
    ["d"],
    new VaultTools(adapter, "/vault"),
    lintOperationLlm(path, content),
    "m",
    [{ id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry],
    "/vault",
    controller.signal,
    0,
    { inputBudgetTokens: 24_000, maxTokens: 2_000, structuredRetries: 0 },
  );
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (next.done) break;
    events.push(next.value);
    if (next.value.kind === "llm_lifecycle"
      && next.value.diagnostics?.callSite === "lint.batch"
      && next.value.phase === "validating") {
      controller.abort();
      break;
    }
  }
  for await (const event of generator) events.push(event);

  assert.deepEqual(adapter.writes, []);
  assert.deepEqual(lifecycleAttempts(events, "lint.batch"), [{
    action: "check_wiki_quality",
    phases: ["preparing", "sent", "waiting", "producing", "validating", "cancelled"],
  }], JSON.stringify(events));
});

test("Lint cancels prior validated batches when abort prevents the next request", async () => {
  const { runLint } = await import("../src/phases/lint");
  const { VaultTools } = await import("../src/vault-tools");
  const files = new Map<string, string>();
  for (let index = 0; index < 24; index += 1) {
    files.set(
      `!Wiki/d/concept/wiki_d_${index}.md`,
      `---\ntype: concept\ndescription: Page ${index}.\nresource: [source]\n---\n# Page ${index}\n\n## Facts\n${`Fact ${index}. `.repeat(300)}\n`,
    );
  }
  const adapter = new MemoryAdapter(files);
  const controller = new AbortController();
  let calls = 0;
  const llm = {
    chat: { completions: { create: async (params: unknown) => {
      calls += 1;
      const user = ((params as { messages?: Array<{ content?: unknown }> }).messages ?? [])
        .find((message) => typeof message.content === "string"
          && message.content.startsWith("Submitted lint work items:"));
      assert.equal(typeof user?.content, "string");
      const match = (user?.content as string)
        .match(/Submitted lint work items:\n([\s\S]*?)\n\nOptional related sections:/);
      assert.ok(match);
      const items = JSON.parse(match[1]) as Array<{ id: string }>;
      return jsonLlm(JSON.stringify({
        coveredWorkIds: items.map((item) => item.id),
        findings: [],
        patches: [],
        deletes: [],
      })).chat.completions.create(params as never);
    } } },
  } as unknown as LlmClient;
  const generator = runLint(
    ["d"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [{ id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry],
    "/vault",
    controller.signal,
    0,
    { inputBudgetTokens: 24_000, maxTokens: 2_000, structuredRetries: 0 },
  );
  const events: RunEvent[] = [];
  let callsAtAbort = 0;
  while (true) {
    const next = await generator.next();
    if (next.done) assert.fail(`generator completed before validation: ${JSON.stringify(events)}`);
    events.push(next.value);
    if (next.value.kind === "llm_lifecycle"
      && next.value.diagnostics?.callSite === "lint.batch"
      && next.value.phase === "validating") {
      callsAtAbort = calls;
      controller.abort();
      break;
    }
  }
  for await (const event of generator) events.push(event);

  assert.ok(callsAtAbort > 0);
  assert.equal(calls, callsAtAbort, "abort must prevent the next batch request");
  assert.deepEqual(adapter.writes, []);
  const attempts = lifecycleAttempts(events, "lint.batch");
  const validated = attempts.filter((attempt) => attempt.phases.includes("validating"));
  assert.ok(validated.length > 0, JSON.stringify(events));
  assert.ok(validated.every((attempt) =>
    attempt.action === "check_wiki_quality"
    && JSON.stringify(attempt.phases) === JSON.stringify([
      "preparing", "sent", "waiting", "producing", "validating", "cancelled",
    ])), JSON.stringify(events));
  assert.ok(attempts.every((attempt) => attempt.phases.filter((phase) =>
    ["completed", "failed", "cancelled", "retrying"].includes(phase)).length === 1), JSON.stringify(events));
});

test("Lint batch forwards failed lifecycle when model request rejects", async () => {
  const { runLint } = await import("../src/phases/lint");
  const { VaultTools } = await import("../src/vault-tools");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "---\ntype: concept\ndescription: Alpha.\nresource: [source]\n---\n# Alpha\n\n## Facts\nOld fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  const llm = {
    chat: { completions: { create: () => Promise.reject(new Error("lint model denied")) } },
  } as unknown as LlmClient;

  const events = await collectEvents(runLint(
    ["d"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [{ id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry],
    "/vault",
    new AbortController().signal,
    0,
    { inputBudgetTokens: 24_000, maxTokens: 2_000, structuredRetries: 0 },
  ));

  assert.deepEqual(lifecycleAttempts(events, "lint.batch"), [{
    action: "check_wiki_quality",
    phases: ["preparing", "sent", "waiting", "failed"],
  }], JSON.stringify(events));
});

test("Lint batch lifecycle fails exactly once when patch write throws", async () => {
  const { runLint } = await import("../src/phases/lint");
  const { VaultTools } = await import("../src/vault-tools");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "---\ntype: concept\ndescription: Alpha.\nresource: [source]\n---\n# Alpha\n\n## Facts\nOld fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  adapter.write = async (writePath, data) => {
    if (writePath === path) throw new Error("lint write denied");
    adapter.writes.push(writePath);
    adapter.files.set(writePath, data);
  };
  const llm = lintOperationLlm(path, content);

  const events = await collectEvents(runLint(
    ["d"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    [{ id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry],
    "/vault",
    new AbortController().signal,
    0,
    { inputBudgetTokens: 24_000, maxTokens: 2_000, structuredRetries: 0 },
  ));

  assert.deepEqual(lifecycleAttempts(events, "lint.batch"), [{
    action: "check_wiki_quality",
    phases: ["preparing", "sent", "waiting", "producing", "validating", "applying", "failed"],
  }], JSON.stringify(events));
  const batchAttempts = lifecycleAttempts(events, "lint.batch");
  assert.equal(batchAttempts.flatMap((attempt) => attempt.phases).filter((phase) =>
    ["completed", "failed", "cancelled"].includes(phase)).length, 1);
});

test("Lint-chat mutation lifecycle completes on write and fails on write exception", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "# Alpha\n\n## Facts\nOld fact.\n";
  for (const writeFails of [false, true]) {
    const adapter = new MemoryAdapter(new Map([[path, content]]));
    if (writeFails) {
      adapter.write = async () => {
        throw new Error("lint-chat write denied");
      };
    }
    const events = await collectEvents(runLintFixChat(
      {
        operation: "lint-chat",
        context: `- [warning] ${path} :: ## Facts :: stale :: Old fact`,
        chatMessages: [{ role: "user", content: "Fix wiki_d_alpha" }],
      } as RunRequest,
      new VaultTools(adapter, ""),
      "",
      { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
      jsonLlm(JSON.stringify({ summary: "fixed", patches: [lintPatch(path, content)] })),
      "m",
      { inputBudgetTokens: 10_000, structuredRetries: 0 },
      new AbortController().signal,
    ));
    assert.deepEqual(
      events
        .filter((event) => event.kind === "llm_lifecycle")
        .map((event) => event.kind === "llm_lifecycle" ? [event.action, event.phase] : []),
      [
        ["apply_lint_fixes", "preparing"],
        ["apply_lint_fixes", "sent"],
        ["apply_lint_fixes", "waiting"],
        ["apply_lint_fixes", "producing"],
        ["apply_lint_fixes", "validating"],
        ["apply_lint_fixes", "applying"],
        ["apply_lint_fixes", writeFails ? "failed" : "completed"],
      ],
    );
  }
});

test("Lint-chat yields lifecycle while patch helper is pending and closes rejection", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "# Alpha\n\n## Facts\nOld fact.\n";
  const request = {
    operation: "lint-chat",
    context: `- [warning] ${path} :: ## Facts :: stale :: Old fact`,
    chatMessages: [{ role: "user", content: "Fix wiki_d_alpha" }],
  } as RunRequest;
  const args = (llm: LlmClient) => runLintFixChat(
    request,
    new VaultTools(new MemoryAdapter(new Map([[path, content]])), ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    llm,
    "m",
    { inputBudgetTokens: 10_000, structuredRetries: 0 },
    new AbortController().signal,
  );
  const release = deferred();
  const success = jsonLlm(JSON.stringify({ summary: "fixed", patches: [] }));
  const pendingLlm = {
    chat: { completions: { create: async (params: unknown) => {
      await release.promise;
      return success.chat.completions.create(params as never);
    } } },
  } as unknown as LlmClient;
  const generator = args(pendingLlm);
  const events: RunEvent[] = [];
  const phases: string[] = [];
  while (phases.length < 3) {
    const next = await nextWithOverallTimeout(generator, "lint-chat");
    assert.equal(next.done, false);
    if (!next.done) {
      events.push(next.value);
      if (next.value.kind === "llm_lifecycle") phases.push(next.value.phase);
    }
  }
  assert.deepEqual(phases, ["preparing", "sent", "waiting"]);
  release.resolve();
  for await (const event of generator) events.push(event);

  const failedEvents = await collectEvents(args({
    chat: { completions: { create: () => Promise.reject(new Error("lint-chat model denied")) } },
  } as unknown as LlmClient));
  assert.deepEqual(
    failedEvents
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? event.phase : ""),
    ["preparing", "sent", "waiting", "failed"],
  );
});

test("Lint-chat abort after validating cancels once and performs no mutation", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "# Alpha\n\n## Facts\nOld fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  const controller = new AbortController();
  const generator = runLintFixChat(
    {
      operation: "lint-chat",
      context: `- [warning] ${path} :: ## Facts :: stale :: Old fact`,
      chatMessages: [{ role: "user", content: "Fix wiki_d_alpha" }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({
      summary: "fixed",
      patches: [{
        kind: "patch",
        path,
        expectedPageHash: contentHash(content),
        sections: [{
          operation: "replace",
          heading: "## Facts",
          expectedSectionHash: inspectPatchablePage(content).sections[0]?.hash,
          content: "New fact.",
        }],
      }],
    })),
    "m",
    { inputBudgetTokens: 10_000, structuredRetries: 0 },
    controller.signal,
  );
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (next.done) break;
    events.push(next.value);
    if (next.value.kind === "llm_lifecycle" && next.value.phase === "validating") {
      controller.abort();
      break;
    }
  }
  for await (const event of generator) events.push(event);

  assert.deepEqual(adapter.writes, []);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "cancelled",
  ], JSON.stringify(events));
  assert.equal(lifecycle.filter((event) =>
    ["completed", "failed", "cancelled"].includes(event.phase)).length, 1);
});

test("Lint-chat cancels partial work after restoring committed page/index consistency", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const alphaPath = "!Wiki/d/concept/wiki_d_alpha.md";
  const betaPath = "!Wiki/d/concept/wiki_d_beta.md";
  const alphaContent = "# Alpha\n\n## Facts\nOld alpha fact.\n";
  const betaContent = "# Beta\n\n## Facts\nOld beta fact.\n";
  const adapter = new MemoryAdapter(new Map([
    [alphaPath, alphaContent],
    [betaPath, betaContent],
  ]));
  const writeCommitted = deferred();
  const releaseWrite = deferred();
  const baseWrite = adapter.write.bind(adapter);
  adapter.write = async (path, data) => {
    await baseWrite(path, data);
    if (path === alphaPath) {
      writeCommitted.resolve();
      await releaseWrite.promise;
    }
  };
  const controller = new AbortController();
  const generator = runLintFixChat(
    {
      operation: "lint-chat",
      context: [
        `- [warning] ${alphaPath} :: ## Facts :: stale :: Old alpha fact`,
        `- [warning] ${betaPath} :: ## Facts :: stale :: Old beta fact`,
      ].join("\n"),
      chatMessages: [{ role: "user", content: "Fix wiki_d_alpha and wiki_d_beta" }],
    } as RunRequest,
    new VaultTools(adapter, ""),
    "",
    { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
    jsonLlm(JSON.stringify({
      summary: "fixed",
      patches: [
        lintPatch(alphaPath, alphaContent),
        lintPatch(betaPath, betaContent),
      ],
    })),
    "m",
    { inputBudgetTokens: 10_000, structuredRetries: 0 },
    controller.signal,
  );
  const events: RunEvent[] = [];
  const collecting = (async () => {
    for await (const event of generator) events.push(event);
  })();

  await Promise.race([
    writeCommitted.promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("first lint-chat write did not start")), 2_000)),
  ]);
  controller.abort();
  releaseWrite.resolve();
  await collecting;

  assert.match(adapter.files.get(alphaPath) ?? "", /Lifecycle mutation fix/);
  assert.equal(adapter.files.get(betaPath), betaContent);
  assert.match(adapter.files.get("!Wiki/d/index.jsonl") ?? "", /wiki_d_alpha/);
  assert.equal(adapter.writes.includes(betaPath), false, "abort must prevent the next patch write");
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "applying", "cancelled",
  ], JSON.stringify(events));
  assert.equal(lifecycle.filter((event) =>
    ["completed", "failed", "cancelled"].includes(event.phase)).length, 1);
  assert.equal(events.some((event) => event.kind === "eval_meta"), false);
  assert.equal(events.some((event) => event.kind === "result" && event.text === "fixed"), false);
});

test("Lint-chat completes when abort arrives after its final committed patch starts", async () => {
  const { VaultTools } = await import("../src/vault-tools");
  const { runLintFixChat } = await import("../src/phases/lint-chat");
  const path = "!Wiki/d/concept/wiki_d_alpha.md";
  const content = "# Alpha\n\n## Facts\nOld alpha fact.\n";
  const adapter = new MemoryAdapter(new Map([[path, content]]));
  const writeCommitted = deferred();
  const releaseWrite = deferred();
  const baseWrite = adapter.write.bind(adapter);
  adapter.write = async (writePath, data) => {
    await baseWrite(writePath, data);
    if (writePath === path) {
      writeCommitted.resolve();
      await releaseWrite.promise;
    }
  };
  const controller = new AbortController();
  const events: RunEvent[] = [];
  const collecting = (async () => {
    for await (const event of runLintFixChat(
      {
        operation: "lint-chat",
        context: `- [warning] ${path} :: ## Facts :: stale :: Old alpha fact`,
        chatMessages: [{ role: "user", content: "Fix wiki_d_alpha" }],
      } as RunRequest,
      new VaultTools(adapter, ""),
      "",
      { id: "d", name: "Demo", wiki_folder: "d", entity_types: [], language_notes: "" } as DomainEntry,
      jsonLlm(JSON.stringify({ summary: "fixed", patches: [lintPatch(path, content)] })),
      "m",
      { inputBudgetTokens: 10_000, structuredRetries: 0 },
      controller.signal,
    )) events.push(event);
  })();

  await writeCommitted.promise;
  controller.abort();
  releaseWrite.resolve();
  await collecting;

  assert.match(adapter.files.get(path) ?? "", /Lifecycle mutation fix/);
  assert.match(adapter.files.get("!Wiki/d/index.jsonl") ?? "", /wiki_d_alpha/);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.phase, "completed", JSON.stringify(events));
  assert.equal(lifecycle.filter((event) =>
    ["completed", "failed", "cancelled"].includes(event.phase)).length, 1);
  assert.equal(events.some((event) => event.kind === "result" && event.text === "fixed"), true);
});

test("Lint transport and applying boundaries remain explicit", () => {
  const source = readFileSync("src/phases/lint.ts", "utf8");
  const batchRunner = source.slice(
    source.indexOf("async function runLintBatchWithSplit"),
    source.indexOf("export async function* runLint"),
  );
  assert.equal(batchRunner.includes('lifecycle.action, "applying"'), false);
  assert.match(batchRunner, /transport: "non-stream"/);
  assert.match(batchRunner, /createLlmLifecycle\("check_wiki_quality"\)/);

  const write = source.indexOf("await vaultTools.write(path, fixedContent)");
  const applying = source.lastIndexOf("if (!batchApplying)", write);
  const updateTool = source.lastIndexOf('name: "Update"', write);
  assert.ok(updateTool < applying && applying < write);

  const domainUpdate = source.indexOf('kind: "domain_updated"');
  const configApplying = source.lastIndexOf('"applying"', domainUpdate);
  const configCompleted = source.indexOf('"completed"', domainUpdate);
  assert.ok(configApplying < domainUpdate && domainUpdate < configCompleted);
});
