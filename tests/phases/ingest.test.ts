import { describe, it, expect, vi } from "vitest";
import { runIngest, buildEntityTypesBlock, parseJsonPages } from "../../src/phases/ingest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";
import { WikiPagesOutputSchema } from "../../src/phases/zod-schemas";

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

function makeLlm(responses: string | string[]): LlmClient {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const create = vi.fn().mockImplementation(async () => {
    const text = queue.length > 1 ? queue.shift()! : queue[0];
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: text } }] };
      },
    };
  });
  return { chat: { completions: { create } } } as unknown as LlmClient;
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity\n\nFact." }],
      }),
    ]);
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
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/wiki_work_entity.md", "# Entity\n\nFact.");
  });

  it("yields source_path_added when new parent folder encountered", async () => {
    const domainWithoutPath: DomainEntry = { ...domain, source_paths: [] };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity" }],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/ИИ/subfolder/file.md`],
        vt,
        llm,
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity" }],
      }),
    ]);
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
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("Sources/");
    expect(ev.domainId).toBe("work");
  });

  it("yields result with count=0 when LLM returns empty array", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("content") });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [] }),
      JSON.stringify({ reasoning: "nothing to extract", pages: [] }),
    ]);
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity\n\nFact." }],
      }),
    ]);
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
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added:");
    expect(writtenContent).toContain("wiki_updated:");
    expect(writtenContent).toContain("wiki_articles:");
    expect(writtenContent).toContain("[[wiki_work_entity]]");
  });

  it("preserves wiki_added and unions wiki_articles on repeated ingest", async () => {
    const existingFm =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[wiki_work_old]]"\n---\nsource text';
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return existingFm;
        return "# existing";
      }),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/entities/wiki_work_old.md"], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "Extracted New.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new.md", content: "# New" }],
      }),
    ]);
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
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added: 2026-01-01"); // preserved
    expect(writtenContent).toContain("[[wiki_work_old]]");  // union
    expect(writtenContent).toContain("[[wiki_work_new]]");  // union
  });

  it("does not write backlinks when no wiki pages were written", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [] }),
      JSON.stringify({ reasoning: "nothing to extract", pages: [] }),
    ]);
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity\n\nFact.", annotation: "описание сущности" }],
      }),
    ]);
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
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls;
    const indexWrite = writeCalls.find((c: [string, string]) => c[0].endsWith("_index.md"));
    expect(indexWrite).toBeDefined();
    expect(indexWrite![1]).toContain("- [[wiki_work_entity]] entities/wiki_work_entity.md — описание сущности");
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted Entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity" }],
      }),
    ]);
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
    const existingPaths = new Set(["!Wiki/work/компоненты/wiki_work_existing.md"]);
    let logContent = "";

    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        if (existingPaths.has(path)) return existingContent;
        if (path === "!Wiki/work/_config/_log.md") return logContent;
        throw new Error("not found");
      }),
      write: vi.fn().mockImplementation(async (path: string, content: string) => {
        if (path === "!Wiki/work/_config/_log.md") logContent = content;
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "existing" }, { name: "new-page" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [
          { path: "!Wiki/work/компоненты/wiki_work_existing.md", content: "---\nwiki_status: mature\n---\n# Existing", annotation: "desc" },
          { path: "!Wiki/work/компоненты/wiki_work_new_page.md", content: "---\nwiki_status: stub\n---\n# New", annotation: "new" },
        ],
      }),
    ]);
    await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
      new AbortController().signal));
    expect(logContent).toContain("ОБНОВЛЕНА: компоненты/wiki_work_existing.md (developing→mature)");
    expect(logContent).toContain("СОЗДАНА: компоненты/wiki_work_new_page.md (stub)");
  });

  it("emits tool_use with name 'Create' for new wiki page", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        throw new Error("not found"); // wiki page does not exist yet
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new.md", content: "# New" }],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const tu = events.find(
      (e: any) => e.kind === "tool_use" && (e.input as any)?.path === "!Wiki/work/entities/wiki_work_new.md",
    ) as any;
    expect(tu?.name).toBe("Create");
  });

  it("result text shows 'создано N стр.' when all pages are new", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "A" }, { name: "B" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [
          { path: "!Wiki/work/entities/wiki_work_a.md", content: "# A" },
          { path: "!Wiki/work/entities/wiki_work_b.md", content: "# B" },
        ],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result?.text).toMatch(/создано 2 стр\./);
    expect(result?.text).not.toMatch(/обновлено/);
  });

  it("result text shows 'обновлено N стр.' when all pages exist", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        // all wiki pages exist
        return "# existing content";
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Existing" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [{ path: "!Wiki/work/entities/wiki_work_existing.md", content: "# Updated" }],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result?.text).toMatch(/обновлено 1 стр\./);
    expect(result?.text).not.toMatch(/создано/);
  });

  it("result text shows 'создано C, обновлено U' for mixed ingest", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        if (path === "!Wiki/work/entities/wiki_work_existing.md") return "# Old";
        throw new Error("not found"); // New.md does not exist
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "New" }, { name: "Existing" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [
          { path: "!Wiki/work/entities/wiki_work_new.md", content: "# New" },
          { path: "!Wiki/work/entities/wiki_work_existing.md", content: "# Updated" },
        ],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result?.text).toMatch(/создано 1, обновлено 1/);
  });

  it("emits tool_use with name 'Update' for existing wiki page", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return "source text";
        if (path === "!Wiki/work/entities/wiki_work_existing.md") return "# Old content";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Existing" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [{ path: "!Wiki/work/entities/wiki_work_existing.md", content: "# Updated content" }],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const tu = events.find(
      (e: any) => e.kind === "tool_use" && (e.input as any)?.path === "!Wiki/work/entities/wiki_work_existing.md",
    ) as any;
    expect(tu?.name).toBe("Update");
  });

  it("reads wiki schema from global _config/ folder", async () => {
    let schemaReadPath = "";
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("_wiki_schema")) schemaReadPath = path;
        return "";
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [] }),
      JSON.stringify({ reasoning: "x", pages: [] }),
    ]);
    await collect(runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "model", [domain], VAULT_ROOT,
      new AbortController().signal));
    expect(schemaReadPath).toContain("_config/_wiki_schema.md");
  });

  it("filters stale wiki_articles links after ingest", async () => {
    // wiki_work_gone_page matches GENERIC_WIKI_STEM_REGEX so it is a stale-filter candidate
    const existingFm =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[wiki_work_gone_page]]"\n  - "[[wiki_work_live_page]]"\n---\nsource text';
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return existingFm;
        if (path === "!Wiki/work/wiki_work_live_page.md") return "# Live Page";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_live_page.md"], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "NewPage" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new_page.md", content: "# NewPage" }],
      }),
    ]);
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
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).not.toContain("[[wiki_work_gone_page]]");
    expect(writtenContent).toContain("[[wiki_work_live_page]]");
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted one entity.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: "# Entity\n\nFact." }],
      }),
    ]);
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
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/wiki_work_entity.md", "# Entity\n\nFact.");
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });

  it("yields reasoning as isReasoning assistant_text event", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "A" }] }),
      JSON.stringify({
        reasoning: "Two entities found.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_a.md", content: "# A" }],
      }),
    ]);
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "X" }] }),
      "not json at all",
    ]);
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
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Page" }] }),
      JSON.stringify({
        reasoning: "Extracted Page.",
        pages: [{ path: "!Wiki/work/work/entity/wiki_work_page.md", content: "# Page" }],
      }),
    ]);
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
    // Page must NOT be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/work/entity/wiki_work_page.md",
    );
    expect(writeCall).toBeUndefined();
    // Must emit tool_result ok:false for that path
    const failResult = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false && (e.preview as string)?.includes("4-level"),
    );
    expect(failResult).toBeDefined();
  });

  it("retries with feedback when invalid paths returned first", async () => {
    // Call #1: entities. Call #2: write with bad path. Call #3: path retry.
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const entitiesResponse = JSON.stringify({ reasoning: "entities", entities: [{ name: "Page" }] });
    const badResponse = JSON.stringify({
      reasoning: "Extracted Page with bad path.",
      pages: [{ path: "!Wiki/work/work/entity/wiki_work_page.md", content: "# Page bad" }],
    });
    const goodResponse = JSON.stringify([
      { path: "!Wiki/work/entity/wiki_work_page.md", content: "# Page good" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const text =
              callCount === 1 ? entitiesResponse :
              callCount === 2 ? badResponse :
              goodResponse;
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
      ([path]: [string]) => path === "!Wiki/work/entity/wiki_work_page.md",
    );
    expect(writeCall).toBeDefined();
    // LLM called three times now (entities + write + retry)
    expect(callCount).toBe(3);
  });

  it("does not retry twice (retry flag prevents second retry)", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const entitiesResponse = JSON.stringify({ reasoning: "entities", entities: [{ name: "Page" }] });
    const badResponseFirst = JSON.stringify({
      reasoning: "Extracted Page with bad path.",
      pages: [{ path: "!Wiki/work/work/entity/wiki_work_page.md", content: "# Page bad" }],
    });
    const badResponseRetry = JSON.stringify([
      { path: "!Wiki/work/work/entity/wiki_work_page.md", content: "# Page bad" },
    ]);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const text =
              callCount === 1 ? entitiesResponse :
              callCount === 2 ? badResponseFirst :
              badResponseRetry;
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

    // Should call LLM at most three times (entities + write + one retry)
    expect(callCount).toBeLessThanOrEqual(3);
  });
});

describe("runIngest — entity_types_delta", () => {
  it("emits domain_updated with merged entity_types when LLM returns entity_types_delta", async () => {
    const domainWithTypes: DomainEntry = {
      id: "work",
      name: "Work",
      wiki_folder: "work",
      source_paths: ["Sources/"],
      entity_types: [
        { type: "concept", description: "A concept", extraction_cues: ["concept"] },
      ],
    };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [] }),
      JSON.stringify({
        reasoning: "Found org type",
        pages: [],
        entity_types_delta: [
          { type: "org", description: "Organisation", extraction_cues: ["company"] },
        ],
      }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, llm, "llama3.2",
        [domainWithTypes], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const update = events.find((e: any) => e.kind === "domain_updated") as any;
    expect(update).toBeDefined();
    expect(update.domainId).toBe("work");
    const types = update.patch.entity_types.map((t: any) => t.type);
    expect(types).toContain("concept");
    expect(types).toContain("org");
  });

  it("does NOT emit domain_updated when LLM returns no entity_types_delta", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [] }),
      JSON.stringify({ reasoning: "No new types", pages: [] }),
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, llm, "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const update = events.find((e: any) => e.kind === "domain_updated");
    expect(update).toBeUndefined();
  });
});

describe("WikiPagesOutputSchema — entity_types_delta", () => {
  it("accepts response with entity_types_delta", () => {
    const input = {
      reasoning: "Found new type",
      pages: [],
      entity_types_delta: [
        { type: "org", description: "Organisation", extraction_cues: ["company", "org"] },
      ],
    };
    const result = WikiPagesOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.entity_types_delta).toHaveLength(1);
  });

  it("accepts response without entity_types_delta (backward compat)", () => {
    const input = { reasoning: "ok", pages: [] };
    const result = WikiPagesOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.entity_types_delta).toBeUndefined();
  });
});

describe("runIngest — entity-driven flow", () => {
  const VAULT_ROOT = "/vaults/Work";
  const domain: DomainEntry = {
    id: "work", name: "Work", wiki_folder: "work", source_paths: ["Sources/"],
  };

  it("calls LLM twice: entities then pages", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "found Foo", entities: [{ name: "Foo" }] }),
      JSON.stringify({ reasoning: "new page", pages: [{ path: "!Wiki/work/entities/wiki_work_foo.md", content: "# Foo" }] }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(llm.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  // @lat: [[tests#Stop Rules#Halt on all-entity retrieval failure]]
  it("halts when similarity.selectByEntities reports allFailed with non-empty entities", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source"),
      list: vi.fn().mockImplementation((path: string) =>
        Promise.resolve(
          path.includes("!Wiki/work")
            ? { files: ["!Wiki/work/entities/Foo.md"], folders: [] }
            : { files: [], folders: [] },
        ),
      ),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "", entities: [{ name: "Foo" }] }));
    const similarity = {
      config: { mode: "embedding", topK: 5 },
      loadCache: vi.fn().mockResolvedValue(undefined),
      selectByEntities: vi.fn().mockResolvedValue({ results: new Map(), allFailed: true }),
    } as unknown as import("../../src/page-similarity").PageSimilarityService;

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal, {}, similarity,
    ));

    expect(llm.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(events.some((e: any) =>
      e.kind === "error" && /per-entity retrieval failed/.test(e.message),
    )).toBe(true);
    expect((adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p.startsWith("!Wiki/work/entities/"),
    )).toBeUndefined();
  });

  // @lat: [[tests#Stop Rules#Halt on entity extraction failure]]
  it("halts when entity extraction LLM returns invalid JSON", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("source") });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("not json");

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(events.some((e: any) =>
      e.kind === "structural_error" && e.callSite === "ingest.entities",
    )).toBe(true);
    expect((adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p.startsWith("!Wiki/work/entities/"),
    )).toBeUndefined();
  });

  // @lat: [[tests#Per-Entity Retrieval#Empty top-K is not an error]]
  it("entity with empty top-K still goes to LLM #2 as create signal", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "novel", entities: [{ name: "Brand New" }] }),
      JSON.stringify({ reasoning: "create", pages: [{ path: "!Wiki/work/entities/wiki_work_brandnew.md", content: "# BrandNew" }] }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/wiki_work_brandnew.md", "# BrandNew");
  });

  // @lat: [[tests#Merge Handling#Deletes trigger vault.remove + index cleanup]]
  it("processes deletes: vault.remove + removeIndexAnnotation called", async () => {
    let indexContent = "# Wiki Index\n\n## entities\n- [[wiki_work_old]] entities/wiki_work_old.md — to delete\n";
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (p.endsWith("_index.md")) return indexContent;
        if (p === "!Wiki/work/entities/wiki_work_old.md") return "# Old";
        throw new Error("not found");
      }),
      write: vi.fn().mockImplementation(async (p: string, c: string) => {
        if (p.endsWith("_index.md")) indexContent = c;
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/entities/wiki_work_old.md"], folders: [],
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "merge", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "merge Old → New",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new.md", content: "# New" }],
        deletes: [{ path: "!Wiki/work/entities/wiki_work_old.md" }],
      }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/work/entities/wiki_work_old.md");
    expect(indexContent).not.toContain("[[wiki_work_old]]");
  });

  it("result text shows 'создано C, обновлено U, объединено M'", async () => {
    const existing = new Set([
      "!Wiki/work/entities/wiki_work_existing.md",
      "!Wiki/work/entities/wiki_work_old.md",
    ]);
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (existing.has(p)) return "---\nwiki_status: developing\n---\n# X";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockImplementation(async (dir: string) => {
        if (dir.startsWith("!Wiki/work")) return { files: [...existing], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Existing" }, { name: "New" }] }),
      JSON.stringify({
        reasoning: "merge",
        pages: [
          { path: "!Wiki/work/entities/wiki_work_new.md", content: "---\nwiki_status: stub\n---\n# New" },
          { path: "!Wiki/work/entities/wiki_work_existing.md", content: "---\nwiki_status: mature\n---\n# Existing" },
        ],
        deletes: [{ path: "!Wiki/work/entities/wiki_work_old.md" }],
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result?.text).toMatch(/создано 1, обновлено 1, объединено 1/);
  });

  // @lat: [[tests#Merge Handling#Large-merge warning]]
  it("emits Large merge warning when deletes.length > threshold", async () => {
    const paths = Array.from({ length: 6 }, (_, i) => `!Wiki/work/entities/Old${i}.md`);
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (paths.includes(p)) return "# old";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: paths, folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Bundle" }] }),
      JSON.stringify({
        reasoning: "big merge",
        pages: [{ path: "!Wiki/work/entities/wiki_work_bundle.md", content: "# Bundle" }],
        deletes: paths.map((p) => ({ path: p })),
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const warn = events.find(
      (e: any) => e.kind === "info_text" && (e.summary as string)?.startsWith("Large merge"),
    );
    expect(warn).toBeDefined();
  });

  it("rejects deletes path outside wiki folder", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "X" }] }),
      JSON.stringify({
        reasoning: "bad",
        pages: [{ path: "!Wiki/work/entities/wiki_work_x.md", content: "# X" }],
        deletes: [{ path: "/etc/passwd" }],
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    expect(adapter.remove).not.toHaveBeenCalledWith("/etc/passwd");
    const rej = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false
        && (e.preview as string)?.includes("outside wiki folder"),
    );
    expect(rej).toBeDefined();
  });

  // @lat: [[tests#Merge Handling#Backlinks drop deleted stems]]
  it("source backlinks drop deleted page stems", async () => {
    const existingFm =
      '---\nwiki_articles:\n  - "[[wiki_work_old]]"\n  - "[[Other]]"\n---\nsource';
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return existingFm;
        if (p === "!Wiki/work/entities/wiki_work_old.md") return "# old";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/entities/wiki_work_old.md"], folders: [],
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "merge",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new.md", content: "# New" }],
        deletes: [{ path: "!Wiki/work/entities/wiki_work_old.md" }],
      }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    const sourceWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p === "Sources/doc.md",
    );
    expect(sourceWrite).toBeDefined();
    const updated = sourceWrite![1] as string;
    expect(updated).not.toContain("[[wiki_work_old]]");
    expect(updated).toContain("[[Other]]");
    expect(updated).toContain("[[wiki_work_new]]");
  });

  // @lat: [[tests#Stop Rules#BFS not invoked]]
  it("BFS not invoked: graphCache.get is never called from ingest", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "X" }] }),
      JSON.stringify({ reasoning: "y", pages: [] }),
    ]);

    const { graphCache } = await import("../../src/wiki-graph-cache");
    const spy = vi.spyOn(graphCache, "get");

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runIngest — pre-migration warning", () => {
  it("emits info_text when pageNameVersion < 1 and wiki folder has unprefixed pages", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (p === "!Wiki/work/entities/LegacyPage.md") return "# Legacy";
        throw new Error("not found");
      }),
      list: vi.fn().mockImplementation(async (dir: string) => {
        if (dir.startsWith("!Wiki/work")) return { files: ["!Wiki/work/entities/LegacyPage.md"], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
      JSON.stringify({ reasoning: "ok", pages: [] }),
    ]);
    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const warn = events.find((e: any) => e.kind === "info_text" && /legacy/i.test(e.summary ?? ""));
    expect(warn).toBeDefined();
  });

  it("does not emit migration warning when pageNameVersion >= 1", async () => {
    const migratedDomain: DomainEntry = { ...domain, pageNameVersion: 1 };
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (p === "!Wiki/work/entities/LegacyPage.md") return "# Legacy";
        throw new Error("not found");
      }),
      list: vi.fn().mockImplementation(async (dir: string) => {
        if (dir.startsWith("!Wiki/work")) return { files: ["!Wiki/work/entities/LegacyPage.md"], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
      JSON.stringify({ reasoning: "ok", pages: [] }),
    ]);
    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [migratedDomain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const warn = events.find((e: any) => e.kind === "info_text" && /legacy/i.test(e.summary ?? ""));
    expect(warn).toBeUndefined();
  });

  it("does not emit migration warning when wiki folder only has prefixed pages", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (p === "!Wiki/work/entities/wiki_work_foo.md") return "# Foo";
        throw new Error("not found");
      }),
      list: vi.fn().mockImplementation(async (dir: string) => {
        if (dir.startsWith("!Wiki/work")) return { files: ["!Wiki/work/entities/wiki_work_foo.md"], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
      JSON.stringify({ reasoning: "ok", pages: [] }),
    ]);
    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const warn = events.find((e: any) => e.kind === "info_text" && /legacy/i.test(e.summary ?? ""));
    expect(warn).toBeUndefined();
  });
});

describe("runIngest — stem mask guard", () => {
  it("renders forbidden-stems block from domain.source_paths", async () => {
    const { collectSourceStems } = await import("../../src/phases/ingest");
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources") {
          return { files: ["Sources/NFS.md", "Sources/RAID.md"], folders: [] };
        }
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const stems = await collectSourceStems(domain, vt, VAULT_ROOT);
    expect(stems.has("NFS")).toBe(true);
    expect(stems.has("RAID")).toBe(true);
  });

  it("rejects emitted page whose stem violates the wiki_<domain>_<entity> mask", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    // path passes 4-segment check but stem lacks prefix
    // We have to bypass the zod schema check via parseWithRetry — emit a page
    // with a malformed stem but valid 4-segment path. The schema will reject
    // it at parseWithRetry, surfacing structural_error instead.
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
      JSON.stringify({
        reasoning: "ok",
        pages: [{ path: "!Wiki/work/entities/RawName.md", content: "# Raw" }],
      }),
    ]);
    const events = await collect(
      runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
        new AbortController().signal),
    );
    // Zod schema rejects unprefixed stem → ingest emits error (structural_error after retries)
    const errored = events.some((e: any) => e.kind === "error" && /validation/i.test(e.message ?? ""));
    expect(errored).toBe(true);
  });

  it("rejects emitted page whose stem matches a source filename", async () => {
    // Source NFS.md exists; LLM emits wiki_work_nfs.md which is fine — but we want
    // to assert the runtime collision guard. Force a collision by configuring the
    // domain so a source file shares the wiki stem after prefixing.
    const collidingDomain: DomainEntry = {
      id: "work", name: "Work", wiki_folder: "work",
      source_paths: ["Sources/"],
    };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources") {
          return { files: ["Sources/wiki_work_collide.md"], folders: [] };
        }
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Collide" }] }),
      JSON.stringify({
        reasoning: "ok",
        pages: [{ path: "!Wiki/work/entities/wiki_work_collide.md", content: "# Collide" }],
      }),
    ]);
    const events = await collect(
      runIngest([`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [collidingDomain], VAULT_ROOT,
        new AbortController().signal),
    );
    const failResult = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false && (e.preview as string)?.includes("collides with source"),
    );
    expect(failResult).toBeDefined();
  });
});
