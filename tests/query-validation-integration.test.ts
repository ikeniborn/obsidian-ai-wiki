import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../src/phases/query";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient } from "../src/types";
import type { DomainEntry } from "../src/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "work",
  source_paths: [],
};

/** Build a minimal VaultAdapter.
 *
 * The adapter exposes one real wiki page (RealPage.md) under the wiki folder.
 * `list("")` is called by ValidateLinks (listFiles("")) and must return all vault files.
 * `list("!Wiki/work")` is called by Phase 3 (glob) and returns wiki pages.
 */
function makeAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  const defaultList = vi.fn().mockImplementation(async (path: string) => {
    // ValidateLinks calls listFiles("") which resolves to list("")
    if (path === "") return { files: ["!Wiki/work/RealPage.md"], folders: [] };
    // Phase 3 wiki glob
    return { files: ["!Wiki/work/RealPage.md"], folders: [] };
  });

  return {
    read: vi.fn().mockImplementation(async (p: string) => {
      if (p.endsWith("_index.md")) return "- [[RealPage]] RealPage.md — real content";
      if (p.endsWith("RealPage.md")) return "# RealPage\nThis is the real page.";
      return "";
    }),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: defaultList,
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Build a streaming LLM response (used for main answer).
 * Also supports a non-streaming response for the rewrite (FixingLinks) call.
 */
function makeLlm(streamAnswer: string, rewriteAnswer?: string): LlmClient {
  const create = vi.fn().mockImplementation(async (params: any) => {
    if (params.stream) {
      // Streaming response for the main answer
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: streamAnswer } }] };
        },
      };
    } else {
      // Non-streaming response for rewriteWithValidLinks
      const text = rewriteAnswer ?? streamAnswer;
      return {
        choices: [{ message: { content: text } }],
        usage: { completion_tokens: 10, prompt_tokens: 20 },
      };
    }
  });

  return {
    chat: {
      completions: { create },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** A question that matches the _index.md annotation "real content" via Jaccard. */
const MATCHING_QUESTION = "real content page";

function runQ(
  question: string,
  llm: LlmClient,
  adapterOverrides: Partial<VaultAdapter> = {},
  validationRetries = 3,
  signal?: AbortSignal,
) {
  const adapter = makeAdapter(adapterOverrides);
  const vt = new VaultTools(adapter, VAULT_ROOT);
  return {
    adapter,
    events: collect(
      runQuery(
        [question],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        signal ?? new AbortController().signal,
        1,   // graphDepth
        {},  // opts
        5,   // seedTopK
        0.0, // seedMinScore — low so Jaccard finds seeds
        10,  // bfsTopK
        undefined, // similarity
        validationRetries,
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runQuery — link validation integration", () => {
  // @lat: [[tests/query-sentinel#All links valid]]
  it("all links valid: answer unchanged, FixingLinks not emitted", async () => {
    // Answer references only [[RealPage]] which exists in the vault
    const llm = makeLlm("The answer is [[RealPage]].");
    const { events } = runQ("what is real?", llm);
    const all = await events;

    const result = all.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("[[RealPage]]");
    // No *(нет в wiki)* annotation
    expect(result.text).not.toContain("*(нет в wiki)*");

    const fixingLinks = all.find(
      (e: any) => e.kind === "tool_use" && e.name === "FixingLinks",
    );
    expect(fixingLinks).toBeUndefined();
  });

  // @lat: [[tests/query-sentinel#Broken links with retries]]
  it("broken links + retries>0: FixingLinks emitted, fixed answer used when rewrite has no broken", async () => {
    // Initial answer has [[FakePage]] (doesn't exist); rewrite returns clean answer
    const llm = makeLlm(
      "See [[FakePage]] for details.",
      "See [[RealPage]] for details.",
    );
    const { events } = runQ(MATCHING_QUESTION, llm, {}, 3);
    const all = await events;

    const fixingLinks = all.find(
      (e: any) => e.kind === "tool_use" && e.name === "FixingLinks",
    );
    expect(fixingLinks).toBeDefined();

    const assistantReplace = all.find((e: any) => e.kind === "assistant_replace") as any;
    expect(assistantReplace).toBeDefined();
    expect(assistantReplace.text).toContain("[[RealPage]]");
    expect(assistantReplace.text).not.toContain("*(нет в wiki)*");

    const result = all.find((e: any) => e.kind === "result") as any;
    expect(result.text).not.toContain("*(нет в wiki)*");
  });

  // @lat: [[tests/query-sentinel#Broken links retries zero]]
  it("broken links + retries=0: annotate without retry, FixingLinks not emitted", async () => {
    const llm = makeLlm("See [[FakePage]] for details.");
    const { events } = runQ(MATCHING_QUESTION, llm, {}, 0);
    const all = await events;

    const fixingLinks = all.find(
      (e: any) => e.kind === "tool_use" && e.name === "FixingLinks",
    );
    expect(fixingLinks).toBeUndefined();

    const result = all.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    // Broken link annotated
    expect(result.text).toContain("*(нет в wiki)*");
  });

  // @lat: [[tests/query-sentinel#Broken links retry still broken]]
  it("broken links + retry also broken: annotate fallback", async () => {
    // Both initial and retry answer contain [[FakePage]]
    const llm = makeLlm(
      "See [[FakePage]] for details.",
      "See [[FakePage]] still.",
    );
    const { events } = runQ(MATCHING_QUESTION, llm, {}, 3);
    const all = await events;

    const fixingLinks = all.find(
      (e: any) => e.kind === "tool_use" && e.name === "FixingLinks",
    );
    expect(fixingLinks).toBeDefined();

    const result = all.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("*(нет в wiki)*");
  });

  // @lat: [[tests/query-sentinel#Retry throws annotate fallback]]
  it("retry throws: annotate fallback on initial broken links", async () => {
    const create = vi.fn().mockImplementation(async (params: any) => {
      if (params.stream) {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "See [[FakePage]] here." } }] };
          },
        };
      }
      // Non-streaming rewrite call throws
      throw new Error("LLM rewrite failed");
    });
    const llm = { chat: { completions: { create } } } as unknown as LlmClient;

    const { events } = runQ(MATCHING_QUESTION, llm, {}, 3);
    const all = await events;

    const result = all.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    // Should annotate with the initial broken links
    expect(result.text).toContain("*(нет в wiki)*");
  });

  // @lat: [[tests/query-sentinel#Signal aborted before retry]]
  it("signal aborted before retry: return without annotate (AbortError)", async () => {
    const controller = new AbortController();

    const create = vi.fn().mockImplementation(async (params: any) => {
      if (params.stream) {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "See [[FakePage]] here." } }] };
          },
        };
      }
      // Abort when retry is attempted
      controller.abort();
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    });
    const llm = { chat: { completions: { create } } } as unknown as LlmClient;

    const adapter = makeAdapter();
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const all = await collect(
      runQuery(
        [MATCHING_QUESTION],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        controller.signal,
        1,
        {},
        5,
        0.0,
        10,
        undefined,
        3,
      ),
    );

    // When aborted during retry, the generator returns without emitting result
    const result = all.find((e: any) => e.kind === "result");
    expect(result).toBeUndefined();

    // No annotation should have been added
    const assistantReplace = all.find((e: any) => e.kind === "assistant_replace");
    expect(assistantReplace).toBeUndefined();
  });

  // @lat: [[tests/query-sentinel#Empty answer no validate]]
  it("empty answer: ValidateLinks not emitted", async () => {
    // LLM returns empty string
    const llm = makeLlm("");
    const { events } = runQ("question", llm);
    const all = await events;

    const validateLinks = all.find(
      (e: any) => e.kind === "tool_use" && e.name === "ValidateLinks",
    );
    expect(validateLinks).toBeUndefined();
  });
});
