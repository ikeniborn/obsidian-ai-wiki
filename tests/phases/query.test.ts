import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../../src/phases/query";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";
import { PageSimilarityService } from "../../src/page-similarity";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(answer: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: answer } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "work",
  source_paths: [],
};

describe("runQuery", () => {
  it("yields error when question is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery([], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields result with LLM answer", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Page]] Page.md — the answer to everything";
        return "# Page\n\nThis is the answer to everything.";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(
        ["What is the answer?"],
        false,
        vt,
        makeLlm("The answer is 42."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("42");
  });

  it("saves answer page when save=true", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Topic.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Topic]] Topic.md — topic details";
        if (p.includes("Topic.md")) return "topic details description";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runQuery(
        ["What is topic?"],
        true,
        vt,
        makeLlm("Topic is something."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(adapter.write).toHaveBeenCalled();
    const [savedPath] = (adapter.write as any).mock.calls[0];
    expect(savedPath).toMatch(/\.md$/);
  });

  it("emits graph_stats event with correct shape", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] Alpha.md — alpha content\n- [[Beta]] Beta.md — beta";
        if (p.endsWith("Alpha.md")) return "alpha content";
        if (p.endsWith("Beta.md")) return "beta [[Alpha]]";
        return "";
      }),
      exists: vi.fn().mockResolvedValue(true),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(["alpha"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.05),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    expect(stats.seeds).toContain("Alpha");
    expect(stats.total).toBe(2);
    expect(stats.expanded).toBeGreaterThanOrEqual(stats.seeds.length);
    expect(typeof stats.fromCache).toBe("boolean");
  });

  it("parses _index.md annotations and passes them to selectSeeds (Jaccard finds seed, no LLM seed call)", async () => {
    // DeepSeek.md content has some text; _index.md has annotation matching question tokens
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/DeepSeek.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("DeepSeek.md")) return "# DeepSeek\nA language model.";
        if (p.endsWith("_index.md")) return "- [[DeepSeek]] DeepSeek.md — быстрая языковая модель";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("DeepSeek is a fast model.");
    await collect(
      runQuery(
        ["deepseek модель"],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        1,   // graphDepth
        {},  // opts
        5,   // seedTopK
        0.0, // seedMinScore — low threshold so Jaccard hits
      ),
    );
    // LLM should be called exactly ONCE (main answer only), NOT twice (seed LLM call skipped)
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does not read _wiki_schema.md for query", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Page]] Page.md — content";
        return "# Page\n\nContent.";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runQuery(["what is X?"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const readMock = adapter.read as ReturnType<typeof vi.fn>;
    const schemaRead = readMock.mock.calls.find(([path]: [string]) =>
      path.endsWith("_wiki_schema.md"),
    );
    expect(schemaRead).toBeUndefined();
  });

  it("graph_stats event includes seedScores", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] !Wiki/work/Alpha.md — machine learning\n- [[Beta]] !Wiki/work/Beta.md — cooking";
        if (p.endsWith("Alpha.md")) return "# Alpha\n[[Beta]]\nmachine learning content";
        if (p.endsWith("Beta.md")) return "# Beta\ncooking content";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(
        ["machine learning"],
        false,
        vt,
        makeLlm("answer"),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        1, // graphDepth=1 so BFS expands
      ),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    expect(stats.seedScores).toBeDefined();
    expect(typeof stats.seedScores).toBe("object");
    // At least one seed should have a score
    const scoreValues = Object.values(stats.seedScores) as number[];
    expect(scoreValues.some(s => s > 0)).toBe(true);
    expect(stats.expandedByHop).toBeUndefined();
  });

  it("excludes files under _config/ directory from BFS graph", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: [
          "!Wiki/work/Page.md",
          "!Wiki/work/_config/_index.md",
          "!Wiki/work/_config/future-config.md",
        ],
        folders: [],
      }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Page]] Page.md — content";
        if (p.endsWith("Page.md")) return "# Page\nContent.";
        if (p.endsWith("future-config.md")) return "# Config\nConfig file.";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(["content"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    // _config/ files must not appear in the total page count sent to graph
    expect(stats.total).toBe(1); // only Page.md
  });

  it("excludes pages not reached by BFS when keyword seed found (graphDepth=0)", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/Neural-network.md", "!Wiki/work/Unrelated.md"],
        folders: [],
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith("_index.md"))
          return Promise.resolve("- [[Neural-network]] Neural-network.md — neural learning\n- [[Unrelated]] Unrelated.md — unrelated topic");
        if (path.endsWith("Neural-network.md"))
          return Promise.resolve("# Neural network\nA learning system.");
        if (path.endsWith("Unrelated.md"))
          return Promise.resolve("# Unrelated\nSomething else entirely.");
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("answer");
    await collect(
      runQuery(
        ["neural network question"],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        0, // graphDepth=0: seeds only, no BFS expansion
      ),
    );
    // Find the streaming LLM call (main query call)
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    // "neural" keyword matches "Neural-network" page; "Unrelated" excluded at depth=0
    expect(userContent).toContain("Neural-network");
    expect(userContent).not.toContain("Unrelated");
  });
});

describe("runQuery — seed threshold gate", () => {
  function embeddingSim(): PageSimilarityService {
    // embedding mode with no baseUrl/model → selectRelevantScored degrades to
    // deterministic Jaccard scoring. Good enough to exercise the gate branches.
    return new PageSimilarityService({ mode: "embedding", topK: 5 });
  }

  function vaultAdapter() {
    return mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] Alpha.md — machine learning\n- [[Beta]] Beta.md — cooking";
        if (p.endsWith("Alpha.md")) return "# Alpha\nmachine learning content";
        if (p.endsWith("Beta.md")) return "# Beta\ncooking content";
        return "";
      }),
    });
  }

  // @lat: [[tests#Tier 2 — Query Fusion#Threshold gate falls back from weak seeds]]
  it("threshold 0 keeps embedding seeds (seedFallback none)", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["machine learning"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 0 /* threshold */),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats.seedFallback).toBe("none");
    expect(stats.seeds).toContain("Alpha");
  });

  it("threshold above max score falls back to Jaccard seeds", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["machine learning"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 2.0 /* threshold > any score */),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats.seedFallback).toBe("jaccard");
    expect(stats.seeds).toContain("Alpha");
  });

  it("threshold high + non-matching question falls through to llmSelectSeeds", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["zzzznomatch"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 2.0),
    );
    // Jaccard returns nothing → empty-seeds guard emits the SelectSeeds tool_use.
    const selectSeedsUse = events.find((e: any) => e.kind === "tool_use" && e.name === "SelectSeeds");
    expect(selectSeedsUse).toBeDefined();
  });
});
