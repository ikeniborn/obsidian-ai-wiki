import { describe, it, expect, vi } from "vitest";
import { runLint, checkStructure } from "../../src/phases/lint";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";
import { LintOutputSchema } from "../../src/phases/zod-schemas";

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

function makeLlm(reportJson: string, configJson = "{}", lintCallCount = 1): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((_params: any) => {
          const call = ++callCount;
          const content = call <= lintCallCount ? reportJson : configJson;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content } }] };
            },
          });
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

describe("runLint", () => {
  it("yields error when domains is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "", fixes: [] })), "model", [], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when specified domain not found", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runLint(["unknown-domain"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields result with report for existing domain", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues found.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
  });

  it("syncs wiki_articles backlinks to raw files during lint", async () => {
    const wikiContent =
      '---\nwiki_sources:\n  - "[[Sources/raw.md]]"\nwiki_status: stub\n---\n# Entity\n\nContent.';
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Entity.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Entity.md") return Promise.resolve(wikiContent);
        if (path === "Sources/raw.md") return Promise.resolve("# Raw\n\nContent.");
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/raw.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_articles:");
    expect(writtenContent).toContain("[[Entity]]");
  });

  it("does not fail lint when raw file read throws during sync", async () => {
    const wikiContent =
      '---\nwiki_sources:\n  - "[[Sources/missing.md]]"\nwiki_status: stub\n---\n# Entity';
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Entity.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Entity.md") return Promise.resolve(wikiContent);
        if (path === "Sources/missing.md") return Promise.reject(new Error("not found"));
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });

  it("unions wiki_articles across two domain lint runs on same raw file", async () => {
    const wikiContentA =
      '---\nwiki_sources:\n  - "[[Sources/shared.md]]"\nwiki_status: stub\n---\n# EntityA';
    const wikiContentB =
      '---\nwiki_sources:\n  - "[[Sources/shared.md]]"\nwiki_status: stub\n---\n# EntityB';
    const domainA: DomainEntry = {
      id: "domainA", name: "Domain A", wiki_folder: "A", source_paths: [],
    };
    const domainB: DomainEntry = {
      id: "domainB", name: "Domain B", wiki_folder: "B", source_paths: [],
    };

    let rawContent = "# Shared source";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki/A")) return Promise.resolve({ files: ["!Wiki/A/EntityA.md"], folders: [] });
        if (path.includes("!Wiki/B")) return Promise.resolve({ files: ["!Wiki/B/EntityB.md"], folders: [] });
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/A/EntityA.md") return Promise.resolve(wikiContentA);
        if (path === "!Wiki/B/EntityB.md") return Promise.resolve(wikiContentB);
        if (path === "Sources/shared.md") return Promise.resolve(rawContent);
        return Promise.resolve("");
      }),
      write: vi.fn().mockImplementation((path: string, content: string) => {
        if (path === "Sources/shared.md") rawContent = content;
        return Promise.resolve();
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2), "model", [domainA, domainB], VAULT_ROOT, new AbortController().signal),
    );

    expect(rawContent).toContain("[[EntityA]]");
    expect(rawContent).toContain("[[EntityB]]");
  });

  it("refreshes pages map after fix-pass so backlink sync uses updated wiki_sources", async () => {
    const originalContent = "---\nwiki_status: stub\n---\n# Page";
    const fixedContent =
      '---\nwiki_sources:\n  - "[[Sources/raw.md]]"\nwiki_status: stub\n---\n# Page';

    let fixPassCalled = false;
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_page.md") {
          return Promise.resolve(fixPassCalled ? fixedContent : originalContent);
        }
        if (path === "Sources/raw.md") return Promise.resolve("# Raw source");
        return Promise.resolve("");
      }),
      write: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_page.md") fixPassCalled = true;
        return Promise.resolve();
      }),
    });

    const fixLlm = makeLlm(
      JSON.stringify({ reasoning: "fix", report: "Fixed page.", fixes: [{ path: "!Wiki/work/wiki_work_page.md", content: fixedContent }] }),
    );
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, fixLlm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/raw.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("[[wiki_work_page]]");
  });

  it("does not append backlink sync line when no wiki pages have wiki_sources", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\nwiki_status: stub\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result.text).not.toContain("Backlinks synced:");
  });

  it("yields domain_updated with entity_types from second LLM call", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const configJson = JSON.stringify({
      reasoning: "Updated entity types.",
      entity_types: [{ type: "концепция", description: "updated", extraction_cues: ["тест"], min_mentions_for_page: 1, wiki_subfolder: "work/концепции" }],
      language_notes: "Updated notes.",
    });
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Report.", fixes: [] }), configJson), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const ev = events.find((e: any) => e.kind === "domain_updated") as any;
    expect(ev).toBeDefined();
    expect(ev.domainId).toBe("work");
    expect(ev.patch.entity_types).toHaveLength(1);
    expect(ev.patch.language_notes).toBe("Updated notes.");
  });

  it("does not rewrite _index.md with flat links after fix phase", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/Entity.md", "!Wiki/work/Concept.md"],
        folders: [],
      }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }), "{}", 2), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const flatIndexWrite = writeCalls.find(
      ([path, content]) => path === "!Wiki/work/_index.md" && (content as string).includes("- [["),
    );
    expect(flatIndexWrite).toBeUndefined();
  });

  it("appends lint entry to _log.md after fix pass", async () => {
    let logContent = "";
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/_config/_log.md") return Promise.resolve(logContent);
        return Promise.resolve("---\nwiki_status: stub\n---\n# Page");
      }),
      write: vi.fn().mockImplementation((path: string, content: string) => {
        if (path === "!Wiki/work/_config/_log.md") logContent = content;
        return Promise.resolve();
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(logContent).toContain("## ");
    expect(logContent).toContain("lint");
    expect(logContent).toContain("work");
  });

  it("second runLint call hits GraphCache for the same domain", async () => {
    const { graphCache } = await import("../../src/wiki-graph-cache");
    graphCache.clear();
    const adapter = {
      read: vi.fn().mockResolvedValue("---\n---\n# X"),
      write: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/X.md"], folders: [] }),
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
    } as any;
    const vt = new (await import("../../src/vault-tools")).VaultTools(adapter, "/v");
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "", fixes: [] }));
    const dom = { id: "work", name: "Work", wiki_folder: "work", source_paths: [] };
    await collect(runLint([], vt, llm, "model", [dom], "/v", new AbortController().signal, 20, {}));
    const pages = new Map([["!Wiki/work/X.md", "---\n---\n# X"]]);
    expect(graphCache.get("work", pages).fromCache).toBe(true);
  });

  it("includes isolated node graph issue in LLM prompt", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Orphan.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Orphan\nNo links."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "no issues", fixes: [] }));
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    // Orphan has no links in or out → checkGraphStructure adds "isolated node" to allIssues
    expect(userContent).toContain("isolated node");
  });

  it("passes schema_block to LLM system message when schema file present", async () => {
    const schemaContent = "# Wiki Schema\n- use lowercase tags";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/_config/_wiki_schema.md") return Promise.resolve(schemaContent);
        return Promise.resolve("---\ntags: []\n---\n# Page\n\nContent.");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }));
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const firstCall = createMock.mock.calls[0];
    const systemMsg = firstCall?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Конвенции (_wiki_schema.md):");
    expect(systemMsg?.content).toContain(schemaContent);
  });

  it("passes empty schema_block when schema file absent", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/_config/_wiki_schema.md") return Promise.reject(new Error("not found"));
        return Promise.resolve("---\ntags: []\n---\n# Page\n\nContent.");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }));
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const firstCall = createMock.mock.calls[0];
    const systemMsg = firstCall?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).not.toContain("Конвенции (_wiki_schema.md):");
  });

  it("emits vector info_text events in embedding mode", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const similarity = {
      config: { mode: "embedding" as const },
      loadCache: vi.fn().mockResolvedValue(undefined),
      refreshCache: vi.fn().mockResolvedValue({ updated: 3 }),
      selectRelevant: vi.fn().mockResolvedValue([]),
    };
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal, 20, 3, {}, similarity as any),
    );
    const infoEvents = events.filter((e: any) => e.kind === "info_text") as any[];
    expect(similarity.loadCache).toHaveBeenCalled();
    expect(similarity.refreshCache).toHaveBeenCalled();
    expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
    expect(infoEvents.some((e) => e.summary.includes("обновлено векторов: 3"))).toBe(true);
  });

  it("does not emit vector events in jaccard mode", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const similarity = {
      config: { mode: "jaccard" as const },
      loadCache: vi.fn().mockResolvedValue(undefined),
      refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
      selectRelevant: vi.fn().mockResolvedValue([]),
    };
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal, 20, {}, similarity as any),
    );
    const vectorEvents = (events as any[]).filter(
      (e) => e.kind === "info_text" && (e.summary.includes("векторов") || e.summary.includes("кэша")),
    );
    expect(vectorEvents).toHaveLength(0);
  });

  it("does not emit write event when updated is 0", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const similarity = {
      config: { mode: "embedding" as const },
      loadCache: vi.fn().mockResolvedValue(undefined),
      refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
      selectRelevant: vi.fn().mockResolvedValue([]),
    };
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal, 20, 3, {}, similarity as any),
    );
    const infoEvents = (events as any[]).filter((e) => e.kind === "info_text");
    expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
    expect(infoEvents.some((e) => e.summary.includes("обновлено векторов"))).toBe(false);
  });

  it("emits per-article info_text progress events", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const infoEvents = (events as any[]).filter(e => e.kind === "info_text" && e.summary?.includes("Checking"));
    expect(infoEvents.length).toBeGreaterThanOrEqual(1);
    expect(infoEvents[0].summary).toMatch(/Checking 1\/1:/);
  });

  it("calls vaultTools.remove when LLM returns deletes", async () => {
    const wikiContent = "---\ntags: []\n---\n# Original\n\nContent.";
    const dupContent = "---\ntags: []\n---\n# Duplicate\n\nSame content.";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki"))
          return Promise.resolve({ files: ["!Wiki/work/wiki_work_original.md", "!Wiki/work/wiki_work_duplicate.md"], folders: [] });
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_original.md") return Promise.resolve(wikiContent);
        if (path === "!Wiki/work/wiki_work_duplicate.md") return Promise.resolve(dupContent);
        return Promise.resolve("");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const lintJson = JSON.stringify({
      reasoning: "found duplicate",
      report: "Merged Duplicate into Original.",
      fixes: [{ path: "!Wiki/work/wiki_work_original.md", content: wikiContent + "\n\nSame content." }],
      deletes: [{ path: "!Wiki/work/wiki_work_duplicate.md", redirect_to: "!Wiki/work/wiki_work_original.md" }],
    });
    // 2 articles → 2 lint calls, then actualize
    const llm = makeLlm(lintJson, "{}", 2);
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/work/wiki_work_duplicate.md");
  });

  it("rewrites [[Deleted]] links in wiki pages when delete has redirect_to", async () => {
    const originalContent = "---\ntags: []\n---\n# Original\n\nContent.";
    const linkedContent = "---\ntags: []\n---\n# Linker\n\nSee [[wiki_work_duplicate]] for more.";
    const dupContent = "---\ntags: []\n---\n# Duplicate\n\nDuplicated.";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki"))
          return Promise.resolve({
            files: ["!Wiki/work/wiki_work_original.md", "!Wiki/work/wiki_work_linker.md", "!Wiki/work/wiki_work_duplicate.md"],
            folders: [],
          });
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_original.md") return Promise.resolve(originalContent);
        if (path === "!Wiki/work/wiki_work_linker.md") return Promise.resolve(linkedContent);
        if (path === "!Wiki/work/wiki_work_duplicate.md") return Promise.resolve(dupContent);
        return Promise.resolve("");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const lintJson = JSON.stringify({
      reasoning: "merged",
      report: "ok",
      fixes: [],
      deletes: [{ path: "!Wiki/work/wiki_work_duplicate.md", redirect_to: "!Wiki/work/wiki_work_original.md" }],
    });
    const llm = makeLlm(lintJson, "{}", 3);
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const linkerWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path, content]: [string, string]) => path === "!Wiki/work/wiki_work_linker.md" && content.includes("[[wiki_work_original]]"),
    );
    expect(linkerWrite).toBeDefined();
  });

  it("continues processing remaining articles when one LLM call fails", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/A.md", "!Wiki/work/B.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    // First lint call returns invalid JSON (will fail parseWithRetry), second returns valid
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? "NOT VALID JSON {{{"  // will fail LintOutputSchema parse
              : callCount === 2
              ? JSON.stringify({ reasoning: "ok", report: "B is fine.", fixes: [] })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;
    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    // Should reach result event (not crash)
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    // Report should mention B is fine
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result.text).toContain("B is fine");
  });
});

describe("runLint with merged assess+fix (LintOutputSchema)", () => {
  it("writes pages from fixes field", async () => {
    const wikiContent = "---\ntags: []\n---\n# Page\n\nContent with [[DeadLink]].";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_page.md") return Promise.resolve(wikiContent);
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({
                  reasoning: "Found dead link.",
                  report: "## Lint\n- dead link [[DeadLink]] in Page.md",
                  fixes: [{ path: "!Wiki/work/wiki_work_page.md", content: "---\ntags: []\n---\n# Page\n\nContent." }],
                })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/wiki_work_page.md",
    );
    expect(writeCall).toBeDefined();
    expect(callCount).toBe(2);
  });

  it("yields report as assistant_text before write loop", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const reportText = "## Lint\nNo issues.";
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({ reasoning: "ok", report: reportText, fixes: [] })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const reportEv = events.find(
      (e: any) => e.kind === "assistant_text" && typeof e.delta === "string" && e.delta.includes("No issues"),
    );
    expect(reportEv).toBeDefined();
  });

  it("yields per-page progress assistant_text before each write", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({
                  reasoning: "fix",
                  report: "## Lint\n- fix Page.md",
                  fixes: [{ path: "!Wiki/work/wiki_work_page.md", content: "# Page\n\nFixed." }],
                })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const progressEv = events.find(
      (e: any) => e.kind === "assistant_text" && typeof e.delta === "string" && e.delta.includes("Page.md"),
    );
    expect(progressEv).toBeDefined();
  });
});

describe("LintOutputSchema", () => {
  it("accepts deletes as optional array of { path, redirect_to? }", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "found duplicate",
      report: "merged B into A",
      fixes: [],
      deletes: [
        { path: "!Wiki/work/wiki_work_duplicate.md", redirect_to: "!Wiki/work/wiki_work_original.md" },
        { path: "!Wiki/work/wiki_work_dead.md" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.deletes).toHaveLength(2);
    expect(result.data?.deletes?.[0].redirect_to).toBe("!Wiki/work/wiki_work_original.md");
    expect(result.data?.deletes?.[1].redirect_to).toBeUndefined();
  });

  it("accepts missing deletes (backwards compat)", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "ok", report: "no issues", fixes: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.deletes).toBeUndefined();
  });
});

describe("checkStructure", () => {
  it("reports each dead link at most once per file even when repeated", () => {
    const pages = new Map([
      ["wiki/A.md", "---\n---\n# A\n\n[[Missing]] and [[Missing]] again."],
    ]);
    const result = checkStructure(pages);
    const matches = result.match(/dead link \[\[Missing\]\]/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("lint — filterStaleWikiLinks integration", () => {
  it("removes stale wiki_outgoing_links from wiki pages after lint", async () => {
    // @lat: [[tests#Lint Stale Link Cleanup#Stale wiki_outgoing_links cleanup]]
    const targetContent =
      '---\nwiki_outgoing_links:\n  - "[[wiki_work_dead_page]]"\n  - "[[wiki_work_alive_page]]"\n---\n# Target\n\nContent.';
    const aliveContent = '---\nwiki_status: stub\n---\n# Alive\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/wiki_work_target_page.md", "!Wiki/work/wiki_work_alive_page.md"],
            folders: [],
          });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_target_page.md") return Promise.resolve(targetContent);
        if (path === "!Wiki/work/wiki_work_alive_page.md") return Promise.resolve(aliveContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const targetWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/wiki_work_target_page.md",
    );
    expect(targetWrite).toBeDefined();
    const writtenContent = targetWrite![1] as string;
    expect(writtenContent).not.toContain("[[wiki_work_dead_page]]");
    expect(writtenContent).toContain("[[wiki_work_alive_page]]");
  });

  it("removes stale wiki_articles from source files not referenced by any wiki page", async () => {
    // @lat: [[tests#Lint Stale Link Cleanup#Stale wiki_articles cleanup in sources]]
    const sourceContent =
      '---\nwiki_articles:\n  - "[[DeletedWiki]]"\n  - "[[LiveWiki]]"\n---\n# Source\n\nContent.';
    const wikiContent = '---\nwiki_status: stub\n---\n# LiveWiki\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/LiveWiki.md"],
            folders: [],
          });
        }
        // vault-wide list returns wiki pages + the source file
        return Promise.resolve({
          files: ["!Wiki/work/LiveWiki.md", "Sources/source.md"],
          folders: [],
        });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/LiveWiki.md") return Promise.resolve(wikiContent);
        if (path === "Sources/source.md") return Promise.resolve(sourceContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const sourceWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/source.md",
    );
    expect(sourceWrite).toBeDefined();
    const writtenContent = sourceWrite![1] as string;
    expect(writtenContent).not.toContain("[[DeletedWiki]]");
    expect(writtenContent).toContain("[[LiveWiki]]");
  });
});

describe("lint — bucket repair", () => {
  it("repairs wiki stem in wiki_sources and emits info_text warning", async () => {
    // @lat: [[tests#Lint Bucket Repair#Wiki stem in wiki_sources repaired]]
    const badContent =
      '---\nwiki_sources:\n  - "[[wiki_work_foo]]"\nwiki_status: stub\n---\n# Page\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/Page.md"],
            folders: [],
          });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(badContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(
        [],
        vt,
        makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).not.toContain("[[wiki_work_foo]]");

    const infoEvent = events.find(
      (e: any) => e.kind === "info_text" && e.summary?.includes("Frontmatter repaired"),
    );
    expect(infoEvent).toBeDefined();
    expect((infoEvent as any).details?.some((d: string) => d.includes("wiki stem"))).toBe(true);
  });

  it("repairs source stem in wiki_outgoing_links and emits info_text warning", async () => {
    // @lat: [[tests#Lint Bucket Repair#Source stem in wiki_outgoing_links repaired]]
    const badContent =
      '---\nwiki_outgoing_links:\n  - "[[my_note]]"\nwiki_status: stub\n---\n# Page\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/Page.md"],
            folders: [],
          });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(badContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(
        [],
        vt,
        makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).not.toContain("[[my_note]]");

    const infoEvent = events.find(
      (e: any) => e.kind === "info_text" && e.summary?.includes("Frontmatter repaired"),
    );
    expect(infoEvent).toBeDefined();
    expect((infoEvent as any).details?.some((d: string) => d.includes("non-wiki stem"))).toBe(true);
  });
});
