import { describe, it, expect, vi } from "vitest";
import { runIngest, buildEntityTypesBlock, parseJsonPages } from "../../src/phases/ingest";
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

function makeLlm(responseText: string): LlmClient {
  const fakeStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseText } }] };
    },
  };
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue(fakeStream) } },
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
  source_paths: ["Sources/"],
};

describe("runIngest", () => {
  it("yields error when args is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest([], vt, makeLlm(JSON.stringify({ reasoning: "nothing to extract", pages: [] })), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when source file is outside vault", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest(["/external/file.md"], vt, makeLlm(JSON.stringify({ reasoning: "nothing to extract", pages: [] })), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("writes pages returned by LLM", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/Entity.md", "# Entity\n\nFact.");
  });

  it("yields source_path_added when new parent folder encountered", async () => {
    const domainWithoutPath: DomainEntry = { ...domain, source_paths: [] };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/ИИ/subfolder/file.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domainWithoutPath],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("ИИ/subfolder/");
    expect(ev.domainId).toBe("work");
  });

  it("yields source_path_added with direct parent path", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("Sources/");
    expect(ev.domainId).toBe("work");
  });

  it("yields result with count=0 when LLM returns empty array", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("content") });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(JSON.stringify({ reasoning: "nothing to extract", pages: [] })),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toMatch(/новых или изменённых страниц нет/);
  });

  it("writes backlinks frontmatter to raw file after successful ingest", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." }],
    });
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added:");
    expect(writtenContent).toContain("wiki_updated:");
    expect(writtenContent).toContain("wiki_articles:");
    expect(writtenContent).toContain("[[!Wiki/work/entities/Entity.md]]");
  });

  it("preserves wiki_added and unions wiki_articles on repeated ingest", async () => {
    const existingFm =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[!Wiki/work/entities/Old.md]]"\n---\nsource text';
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue(existingFm),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted New.",
      pages: [{ path: "!Wiki/work/entities/New.md", content: "# New" }],
    });
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added: 2026-01-01"); // preserved
    expect(writtenContent).toContain("[[!Wiki/work/entities/Old.md]]");  // union
    expect(writtenContent).toContain("[[!Wiki/work/entities/New.md]]");  // union
  });

  it("does not write backlinks when no wiki pages were written", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(JSON.stringify({ reasoning: "nothing to extract", pages: [] })),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeUndefined();
  });

  it("calls write on _index.md with annotation after page write", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact.", annotation: "описание сущности" }],
    });
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls;
    const indexWrite = writeCalls.find((c: [string, string]) => c[0].endsWith("_index.md"));
    expect(indexWrite).toBeDefined();
    expect(indexWrite![1]).toContain("- [[Entity]] entities/Entity.md — описание сущности");
  });

  it("does not fail ingest when raw file backlink write throws", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      write: vi.fn().mockImplementation((path: string) => {
        if (path === "Sources/doc.md") {
          return Promise.reject(new Error("permission denied"));
        }
        return Promise.resolve();
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    const failEvent = events.find(
      (e: any) =>
        e.kind === "tool_result" &&
        e.ok === false &&
        (e.preview as string)?.includes("backlink write failed"),
    );
    expect(failEvent).toBeDefined();
  });

  it("logs СОЗДАНА for new pages and ОБНОВЛЕНА for existing pages", async () => {
    const existingContent = "---\nwiki_status: developing\n---\n# Existing";
    const existingPaths = new Set(["!Wiki/work/компоненты/existing.md"]);
    let logContent = "";

    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        if (existingPaths.has(path)) return existingContent;
        if (path === "!Wiki/work/_log.md") return logContent;
        throw new Error("not found");
      }),
      write: vi.fn().mockImplementation(async (path: string, content: string) => {
        if (path === "!Wiki/work/_log.md") logContent = content;
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({
      reasoning: "x",
      pages: [
        { path: "!Wiki/work/компоненты/existing.md", content: "---\nwiki_status: mature\n---\n# Existing", annotation: "desc" },
        { path: "!Wiki/work/компоненты/new-page.md", content: "---\nwiki_status: stub\n---\n# New", annotation: "new" },
      ],
    }));
    await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
      new AbortController().signal));
    expect(logContent).toContain("ОБНОВЛЕНА: компоненты/existing.md (developing→mature)");
    expect(logContent).toContain("СОЗДАНА: компоненты/new-page.md (stub)");
  });

  it("reads wiki schema from .config/ subfolder", async () => {
    let schemaReadPath = "";
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("_wiki_schema")) schemaReadPath = path;
        return "";
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "x", pages: [] }));
    await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
      new AbortController().signal));
    expect(schemaReadPath).toContain(".config/_wiki_schema.md");
  });
});

describe("parseJsonPages with annotation", () => {
  it("extracts annotation field when present", () => {
    const json = JSON.stringify([
      { path: "wiki/A.md", content: "# A", annotation: "описание A" },
    ]);
    const pages = parseJsonPages(json);
    expect(pages[0].annotation).toBe("описание A");
  });

  it("annotation is undefined when absent", () => {
    const json = JSON.stringify([{ path: "wiki/A.md", content: "# A" }]);
    expect(parseJsonPages(json)[0].annotation).toBeUndefined();
  });
});

describe("buildEntityTypesBlock — path templates", () => {
  it("emits subfolder path for entity with wiki_subfolder", () => {
    const domain: DomainEntry = {
      id: "ии", name: "ИИ", wiki_folder: "ии",
      entity_types: [{ type: "Технология", description: "d", extraction_cues: ["c"], wiki_subfolder: "Технологии" }],
    };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).toContain("Путь для сущностей этого типа: !Wiki/ии/Технологии/<EntityName>.md");
  });

  it("emits root path for entity without wiki_subfolder", () => {
    const domain: DomainEntry = {
      id: "ии", name: "ИИ", wiki_folder: "ии",
      entity_types: [{ type: "Концепция", description: "d", extraction_cues: ["c"] }],
    };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).toContain("Путь для сущностей этого типа: !Wiki/ии/<EntityName>.md");
    expect(block).not.toMatch(/!Wiki\/ии\/\//);
  });

  it("empty entity_types → no path lines", () => {
    const domain: DomainEntry = { id: "ии", name: "ИИ", wiki_folder: "ии", entity_types: [] };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).not.toContain("Путь для сущностей этого типа");
  });
});

describe("runIngest with WikiPagesOutputSchema format", () => {
  it("writes pages from {reasoning, pages} response", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted one entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/Entity.md", "# Entity\n\nFact.");
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });

  it("yields reasoning as isReasoning assistant_text event", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Two entities found.",
      pages: [{ path: "!Wiki/work/entities/A.md", content: "# A" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const reasoningEv = events.find(
      (e: any) => e.kind === "assistant_text" && e.isReasoning === true && e.delta === "Two entities found.",
    );
    expect(reasoningEv).toBeDefined();
  });

  it("yields error event and result on invalid JSON response", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm("not json at all"),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "structural_error")).toBe(true);
    const errorIdx = events.findIndex((e: any) => e.kind === "error");
    const resultIdx = events.findIndex((e: any) => e.kind === "result");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(errorIdx);
  });
});

describe("runIngest path validation", () => {
  it("skips invalid path and emits tool_result ok:false", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    // Domain wiki_folder "work" → wikiVaultPath = "!Wiki/work"
    // Invalid: domain appears twice in path
    const llmResponse = JSON.stringify({
      reasoning: "Extracted Page.",
      pages: [{ path: "!Wiki/work/work/entity/Page.md", content: "# Page" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    // Page must NOT be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/work/entity/Page.md",
    );
    expect(writeCall).toBeUndefined();
    // Must emit tool_result ok:false for that path
    const failResult = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false && (e.preview as string)?.includes("4-level"),
    );
    expect(failResult).toBeDefined();
  });

  it("retries with feedback when invalid paths returned first", async () => {
    // First call returns invalid path; second call (retry) returns corrected path
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const badResponse = JSON.stringify({
      reasoning: "Extracted Page with bad path.",
      pages: [{ path: "!Wiki/work/work/entity/Page.md", content: "# Page bad" }],
    });
    const goodResponse = JSON.stringify([
      { path: "!Wiki/work/entity/Page.md", content: "# Page good" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const text = callCount === 1 ? badResponse : goodResponse;
            const fakeStream = {
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: text } }] };
              },
            };
            return Promise.resolve(fakeStream);
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        llm,
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    // Corrected page must be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/entity/Page.md",
    );
    expect(writeCall).toBeDefined();
    // LLM called twice (original + retry)
    expect(callCount).toBe(2);
  });

  it("does not retry twice (retry flag prevents second retry)", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const badResponseFirst = JSON.stringify({
      reasoning: "Extracted Page with bad path.",
      pages: [{ path: "!Wiki/work/work/entity/Page.md", content: "# Page bad" }],
    });
    const badResponseRetry = JSON.stringify([
      { path: "!Wiki/work/work/entity/Page.md", content: "# Page bad" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const text = callCount === 1 ? badResponseFirst : badResponseRetry;
            const fakeStream = {
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: text } }] };
              },
            };
            return Promise.resolve(fakeStream);
          }),
        },
      },
    } as unknown as LlmClient;

    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        llm,
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    // Should call LLM at most twice (original + one retry)
    expect(callCount).toBeLessThanOrEqual(2);
  });
});
