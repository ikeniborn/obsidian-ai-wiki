// tests/phases/query-thinking.test.ts
// Regression tests for thinking-model output in llmSelectSeeds (runQuery).
// These tests FAIL until query.ts uses parseStructured() in llmSelectSeeds.
//
// Root cause (spec §4):
//   `llmSelectSeeds` uses raw `text.match(/\{[\s\S]*\}/)`.
//   When LLM returns `<think>{ "seeds": ["x"] }</think>{"seeds":["RealPage"]}`,
//   the greedy regex matches from the first `{` inside <think> to the last `}` —
//   producing invalid JSON. `catch` fires → returns `[]` → fallback to allPageIds.
//   With parseStructured(): <think> is stripped first → correct seeds extracted.
//
// Observable difference:
//   Bug  → seeds=[] → fallback → ALL N pages in context
//   Fix  → seeds=["RealPage"] → only RealPage in context (noise pages absent)
import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../../src/phases/query";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const VAULT_ROOT = "/vaults/Work";
const WIKI_DIR = "!Wiki/Wiki";

const domain: DomainEntry = {
  id: "d",
  name: "D",
  wiki_folder: "Wiki",
  entity_types: [],
  language_notes: "",
  source_paths: [],
};

function makeAdapterWithPages(pages: Record<string, string>): VaultAdapter {
  return mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockImplementation((dir: string) => {
      const files = Object.keys(pages).filter(
        (p) => p.startsWith(dir + "/") || p === dir,
      );
      return Promise.resolve({ files, folders: [] });
    }),
    read: vi.fn().mockImplementation((path: string) => {
      return Promise.resolve(pages[path] ?? "");
    }),
  });
}

/**
 * LLM mock:
 * - First streaming call (llmSelectSeeds via parseWithRetry): yields seeds JSON output.
 * - Second streaming call (final answer): captures message content and yields a short answer.
 */
function makeLlmCapturingContext(seedsOutput: string): {
  llm: LlmClient;
  getCapturedMessages: () => string;
} {
  let capturedMessages = "";
  let callCount = 0;
  const llm: LlmClient = {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params: any) => {
          callCount++;
          if (callCount === 1) {
            // seeds call: yield the thinking-model output as a streaming chunk
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: seedsOutput } }] };
              },
            });
          }
          // final answer call: capture context and yield answer
          capturedMessages = (params.messages ?? [])
            .map((m: any) =>
              typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            )
            .join("\n");
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: "Answer." } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
  return { llm, getCapturedMessages: () => capturedMessages };
}

/** Generates N noise pages that have no keyword overlap with the query. */
function makeNoisePagesRecord(n: number): Record<string, string> {
  const pages: Record<string, string> = {};
  for (let i = 1; i <= n; i++) {
    pages[`${WIKI_DIR}/NoisePage${i}.md`] = `# NoisePage${i}\nContent about noise topic ${i}.`;
  }
  return pages;
}

describe("llmSelectSeeds — thinking model output", () => {
  it("uses RealPage seeds (not all pages) when LLM wraps seeds in <think>{ } tags", async () => {
    // Bug: <think>{ "seeds": [...] }</think>{"seeds":["RealPage"]} → greedy regex
    //   matches {"seeds":[...]}</think>{"seeds":["RealPage"]} → invalid JSON → [] →
    //   fallback allPageIds → ALL noise pages appear in context.
    // Fix: parseStructured strips <think> → {"seeds":["RealPage"]} → only RealPage in context.
    const thinkOutput = `<think>{ "seeds": ["NoisePage1", "NoisePage2"] }</think>\n{"seeds": ["RealPage"]}`;
    const { llm, getCapturedMessages } = makeLlmCapturingContext(thinkOutput);

    // 5 noise pages + 1 real page (total 6 pages)
    const noisePages = makeNoisePagesRecord(5);
    const pages = {
      ...noisePages,
      [`${WIKI_DIR}/RealPage.md`]: "# RealPage\nContent about UNIQUE_REAL_CONTENT.",
    };
    const vt = new VaultTools(makeAdapterWithPages(pages), VAULT_ROOT);

    const events: unknown[] = [];
    // Question uses no keywords matching page names → forces llmSelectSeeds
    for await (const e of runQuery(
      ["zz99unique xyzquery"],
      false, vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal,
    )) {
      events.push(e);
    }

    expect(events.some((e: any) => e.kind === "error")).toBe(false);
    expect(events.some((e: any) => e.kind === "result")).toBe(true);

    const ctx = getCapturedMessages();

    // With bug: seeds=[] → fallback → all 6 pages in context → noise pages PRESENT.
    // With fix: seeds=["RealPage"] → only RealPage in context → noise pages ABSENT.
    expect(ctx, "NoisePage1 should NOT be in context when correct seeds are used").not.toContain("NoisePage1");
    expect(ctx, "RealPage content should be in context").toContain("UNIQUE_REAL_CONTENT");
  });

  it("returns correct seeds even when <think> block contains a JSON object with {}", async () => {
    // Variant: <think>{"draft":{}}</think>{"seeds":["TargetPage"]}
    // The inner {} in <think> creates a nested greedy match problem.
    // Bug: match spans across </think> → invalid JSON → [] → all pages.
    // Fix: strip <think> → parse {"seeds":["TargetPage"]} → correct seeds.
    const thinkOutput = `<think>{"draft": {"analysis": "initial"}}</think>\n{"seeds": ["TargetPage"]}`;
    const { llm, getCapturedMessages } = makeLlmCapturingContext(thinkOutput);

    const noisePages = makeNoisePagesRecord(4);
    const pages = {
      ...noisePages,
      [`${WIKI_DIR}/TargetPage.md`]: "# TargetPage\nContent about UNIQUE_TARGET_CONTENT.",
    };
    const vt = new VaultTools(makeAdapterWithPages(pages), VAULT_ROOT);

    const events: unknown[] = [];
    for await (const e of runQuery(
      ["zz99unique xyzquery"],
      false, vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal,
    )) {
      events.push(e);
    }

    expect(events.some((e: any) => e.kind === "error")).toBe(false);

    const ctx = getCapturedMessages();
    // With fix: TargetPage in context, noise pages absent.
    // With bug: seeds=[] → all noise pages in context.
    expect(ctx, "TargetPage content should be in context (not noise)").toContain("UNIQUE_TARGET_CONTENT");
    expect(ctx, "NoisePage1 should NOT be in context with correct seeds").not.toContain("NoisePage1");
  });
});
