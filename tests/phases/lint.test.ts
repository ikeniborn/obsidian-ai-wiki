import { describe, it, expect, vi } from "vitest";
import { runLint, checkStructure } from "../../src/phases/lint";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

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

function makeLlm(reportJson: string, configJson = "{}"): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((_params: any) => {
          const call = ++callCount;
          // call 1: combined assess+fix (LintOutputSchema JSON)
          // call 2: actualizeDomainConfig (EntityTypesDeltaSchema JSON via parseWithRetry)
          const content = call === 2 ? configJson : reportJson;
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
    expect(writtenContent).toContain("[[!Wiki/work/Entity.md]]");
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
      runLint([], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] })), "model", [domainA, domainB], VAULT_ROOT, new AbortController().signal),
    );

    expect(rawContent).toContain("[[!Wiki/A/EntityA.md]]");
    expect(rawContent).toContain("[[!Wiki/B/EntityB.md]]");
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
          return Promise.resolve({ files: ["!Wiki/work/Page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") {
          return Promise.resolve(fixPassCalled ? fixedContent : originalContent);
        }
        if (path === "Sources/raw.md") return Promise.resolve("# Raw source");
        return Promise.resolve("");
      }),
      write: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") fixPassCalled = true;
        return Promise.resolve();
      }),
    });

    const fixLlm = makeLlm(
      JSON.stringify({ reasoning: "fix", report: "Fixed page.", fixes: [{ path: "!Wiki/work/Page.md", content: fixedContent }] }),
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
    expect(writtenContent).toContain("[[!Wiki/work/Page.md]]");
  });

  it("does not append backlink sync line when no wiki pages have wiki_sources", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
      runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
});

describe("runLint with merged assess+fix (LintOutputSchema)", () => {
  it("writes pages from fixes field", async () => {
    const wikiContent = "---\ntags: []\n---\n# Page\n\nContent with [[DeadLink]].";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(wikiContent);
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
                  fixes: [{ path: "!Wiki/work/Page.md", content: "---\ntags: []\n---\n# Page\n\nContent." }],
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
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    expect(callCount).toBe(2);
  });

  it("yields report as assistant_text before write loop", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
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
                  fixes: [{ path: "!Wiki/work/Page.md", content: "# Page\n\nFixed." }],
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
