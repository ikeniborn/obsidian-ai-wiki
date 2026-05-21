import { describe, it, expect, vi } from "vitest";
import { runInit, mergeEntityTypes } from "../../src/phases/init";
import { sanitizeWikiFolder, sanitizeWikiSubfolder } from "../../src/wiki-path";
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

function makeLlm(json: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: json } }] };
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

function makeMultiLlm(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const json = responses[callIndex] ?? responses[responses.length - 1];
          callIndex++;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: json } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

function mockAdapterWithSources(files: Record<string, string>): VaultAdapter {
  return mockAdapter({
    list: vi.fn().mockImplementation(async (path: string) => {
      const all = Object.keys(files);
      const filtered = path === "" ? all : all.filter(f => f.startsWith(path));
      return { files: filtered, folders: [] };
    }),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path in files) return files[path];
      return "";
    }),
  });
}

const existingDomain: DomainEntry = {
  id: "existing",
  name: "Existing",
  wiki_folder: "existing",
  source_paths: [],
};

// LLM may return old-format wiki_folder — normalization should strip prefix
const validDomainJson = JSON.stringify({
  reasoning: "",
  id: "newdomain",
  name: "New Domain",
  wiki_folder: "vaults/TestVault/!Wiki/newdomain",
  source_paths: [],
  entity_types: [],
  language_notes: "",
});

describe("runInit", () => {
  it("yields error when domainId is empty", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit([], vt, makeLlm("{}"), "model", [], "TestVault", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when domainId not found in domains", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["unknown"], vt, makeLlm("{}"), "model", [], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("domain not found");
  });

  it("yields error when domain already initialised (has entity_types)", async () => {
    const initialised: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: ["src/docs"],
      entity_types: [{ type: "concept", description: "c", extraction_cues: [] }],
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm("{}"), "model", [initialised], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("already initialised");
  });

  it("yields error when domain has no source_paths configured", async () => {
    const noSources: DomainEntry = { id: "dom", name: "Dom", wiki_folder: "dom", source_paths: [] };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm("{}"), "model", [noSources], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("no source_paths");
  });

  it("delegates to runInitWithSources when domain has source_paths — emits init_start", async () => {
    const domainWithSources: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: ["sources"],
    };
    const bootstrapJson = JSON.stringify({
      reasoning: "", id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: [], entity_types: [], language_notes: "",
    });
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (path: string) =>
        path === "sources" || path === ""
          ? { files: ["sources/a.md"], folders: [] }
          : { files: [], folders: [] },
      ),
      read: vi.fn().mockResolvedValue("content"),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm(bootstrapJson), "model", [domainWithSources], "TestVault", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "init_start")).toBe(true);
  });

  it("yields error when domain already exists", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(
        ["existing"],
        vt,
        makeLlm("{}"),
        "model",
        [existingDomain],
        "TestVault",
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("dry-run returns JSON preview without domain_created event", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain", "--dry-run"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("Dry run");
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });

  it("yields domain_created with vault-relative wiki_folder (normalization applied)", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const domainCreated = events.find((e: any) => e.kind === "domain_created") as any;
    expect(domainCreated).toBeDefined();
    expect(domainCreated.entry.id).toBe("newdomain");
    expect(domainCreated.entry.wiki_folder).toBe("newdomain");
  });

  it("yields result event after domain_created", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["newdomain"],
        vt,
        makeLlm(validDomainJson),
        "model",
        [],
        "TestVault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("newdomain");
  });
});

describe("runInit — ensureRootFiles", () => {
  it("создаёт _schema.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaCall = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    expect(schemaCall).toBeDefined();
    expect(schemaCall![1]).toContain("# Wiki Schema");
  });

  it("не перезаписывает существующую корневую схему", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(true) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaWrite = writeCalls.find(([path]) => path === "!Wiki/.config/_wiki_schema.md");
    expect(schemaWrite).toBeUndefined(); // exists=true → not written
  });

  it("удаляет !Wiki/_index.md если существует (миграция)", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockImplementation((path: string) =>
        Promise.resolve(path === "!Wiki/_index.md"),
      ),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/_index.md");
  });

  it("appendLog пишет в папку домена, а не в корень !Wiki", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const logWrite = writeCalls.find(([path]) => path.includes("_log.md") && path !== "!Wiki/_log.md");
    expect(logWrite).toBeDefined();
    expect(logWrite![0]).toBe("!Wiki/newdomain/_log.md");
  });

  it("удаляет !Wiki/_log.md если существует (миграция)", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockImplementation((path: string) =>
        Promise.resolve(path === "!Wiki/_log.md"),
      ),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
    );
    const removeMock = adapter.remove as ReturnType<typeof vi.fn>;
    expect(removeMock).toHaveBeenCalledWith("!Wiki/_log.md");
  });
});

describe("mergeEntityTypes", () => {
  it("appends new type from incoming", () => {
    const current = [{ type: "person", description: "A person", extraction_cues: [] }];
    const incoming = [{ type: "company", description: "A company", extraction_cues: [] }];
    const result = mergeEntityTypes(current, incoming);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.type)).toContain("company");
  });

  it("overrides existing type when incoming has same type id", () => {
    const current = [{ type: "person", description: "Old", extraction_cues: ["old cue"] }];
    const incoming = [{ type: "person", description: "New", extraction_cues: ["new cue"] }];
    const result = mergeEntityTypes(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("New");
    expect(result[0].extraction_cues).toEqual(["new cue"]);
  });

  it("returns current unchanged when incoming is empty", () => {
    const current = [{ type: "person", description: "A person", extraction_cues: [] }];
    const result = mergeEntityTypes(current, []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("person");
  });

  it("returns incoming when current is empty", () => {
    const incoming = [{ type: "company", description: "A company", extraction_cues: [] }];
    const result = mergeEntityTypes([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("company");
  });
});

describe("runInitWithSources — Phase 1 bootstrap", () => {
  const bootstrapDomainJson = JSON.stringify({
    reasoning: "",
    id: "testdomain",
    name: "Test Domain",
    wiki_folder: "testdomain",
    source_paths: [],
    entity_types: [{ type: "concept", description: "A concept", extraction_cues: ["concept"] }],
    language_notes: "English",
  });

  const sourceFiles = {
    "sources/file0.md": "Content of file 0",
  };

  it("emits init_start with totalFiles count before bootstrap", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStart = events.find((e: any) => e.kind === "init_start") as any;
    expect(initStart).toBeDefined();
    expect(initStart.phase).toBeUndefined();
    expect(initStart.totalFiles).toBe(1);
  });

  it("new domain → emits domain_created with full entry and source_paths from args", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const created = events.find((e: any) => e.kind === "domain_created") as any;
    expect(created).toBeDefined();
    expect(created.entry.id).toBe("testdomain");
    expect(created.entry.source_paths).toContain("sources");
    expect(created.entry.entity_types).toHaveLength(1);
  });

  it("existing domain → emits domain_updated with patch { entity_types, language_notes, wiki_folder, analyzed_sources: [] }", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const existing: DomainEntry = { id: "testdomain", name: "Existing", wiki_folder: "old" };
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [existing], "TestVault", new AbortController().signal),
    );
    // First domain_updated is the bootstrap patch (before clear event)
    const bootstrapUpdate = events.find((e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)) as any;
    expect(bootstrapUpdate).toBeDefined();
    expect(bootstrapUpdate.patch.entity_types).toBeDefined();
    expect(bootstrapUpdate.patch.language_notes).toBeDefined();
    expect(bootstrapUpdate.patch.wiki_folder).toBeDefined();
    expect(bootstrapUpdate.patch.analyzed_sources).toEqual([]);
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });

  it("emits file_start { index: 0 } and file_done for file_0 (no phase field)", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStart = events.find((e: any) => e.kind === "file_start") as any;
    const fileDone = events.find((e: any) => e.kind === "file_done") as any;
    expect(fileStart?.index).toBe(0);
    expect(fileStart?.phase).toBeUndefined();
    expect(fileDone?.phase).toBeUndefined();
  });
});

describe("runInitWithSources — Phase 1 incremental", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  const incrementalJson1 = JSON.stringify({
    reasoning: "",
    entity_types: [
      { type: "concept", description: "Refined concept", extraction_cues: ["refined"] },
      { type: "person", description: "A person", extraction_cues: ["person"] },
    ],
  });

  const incrementalJson2 = JSON.stringify({
    reasoning: "",
    entity_types: [
      { type: "place", description: "A place", extraction_cues: ["location"] },
    ],
    language_notes: "Russian",
  });

  const sourceFiles = {
    "src/a.md": "content a",
    "src/b.md": "content b",
    "src/c.md": "content c",
  };

  it("emits domain_updated after each incremental file with merged entity_types", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const updates = events.filter((e: any) => e.kind === "domain_updated" && e.patch?.entity_types) as any[];
    // 2 incremental updates + final clear
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("entity_types accumulate correctly — later files merge on top of earlier", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const ingestEmpty = JSON.stringify({ reasoning: "ok", pages: [] });
    // Per-file pipeline: bootstrap(a), ingest(a), incremental(b), ingest(b), incremental(c), ingest(c)
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, ingestEmpty, incrementalJson1, ingestEmpty, incrementalJson2, ingestEmpty]), "model", [], "TestVault", new AbortController().signal),
    );
    // Find last domain_updated with entity_types before clear (analyzed_sources: undefined)
    const updatesWithTypes = events.filter((e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined) as any[];
    const last = updatesWithTypes[updatesWithTypes.length - 1];
    const types = last.patch.entity_types.map((e: any) => e.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
    expect(types).toContain("place");
    // concept should be refined (from incrementalJson1)
    const concept = last.patch.entity_types.find((e: any) => e.type === "concept");
    expect(concept.description).toBe("Refined concept");
  });

  it("emits file_start and file_done for each file (no phase field)", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start") as any[];
    const fileDones = events.filter((e: any) => e.kind === "file_done") as any[];
    expect(fileStarts).toHaveLength(3);
    expect(fileDones).toHaveLength(3);
    for (const fs of fileStarts) expect(fs.phase).toBeUndefined();
    for (const fd of fileDones) expect(fd.phase).toBeUndefined();
  });

  it("emits a single init_start (per-file pipeline, no separate ingest phase)", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStarts = events.filter((e: any) => e.kind === "init_start") as any[];
    expect(initStarts).toHaveLength(1);
    expect(initStarts[0].phase).toBeUndefined();
  });
});

describe("runInitWithSources — error handling", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
    language_notes: "",
  });

  it("skips unreadable file in Phase 1 and continues with next file", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["src/a.md", "src/b.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "src/a.md") return "content a";
        if (path === "src/b.md") throw new Error("Permission denied");
        return "";
      }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    // Should complete (reach result) and emit warning for b.md
    const warnings = events.filter((e: any) => e.kind === "assistant_text" && e.delta?.includes("src/b.md")) as any[];
    expect(warnings.length).toBeGreaterThan(0);
    // Phase 1 should not abort — a result event must be present
    const resultEvent = events.find((e: any) => e.kind === "result");
    expect(resultEvent).toBeDefined();
  });

  it("skips file when LLM returns invalid JSON and does NOT add it to analyzed_sources", async () => {
    const adapter = mockAdapterWithSources({ "src/a.md": "content a", "src/b.md": "content b" });
    const vt = new VaultTools(adapter, "/vault");
    const invalidJson = "not json at all";
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, invalidJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const domainUpdatesWithSources = events.filter(
      (e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)
    ) as any[];
    // b.md (invalid JSON) should NOT be in analyzed_sources
    for (const upd of domainUpdatesWithSources) {
      expect(upd.patch.analyzed_sources).not.toContain("src/b.md");
    }
  });

  it("emits informational size log for every file processed", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const info = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("ℹ src/a.md:") && e.delta?.includes("chars")
    ) as any;
    expect(info).toBeDefined();
  });

  it("does NOT emit truncation warning for large files", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const warning = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("truncated to 8 000 chars")
    );
    expect(warning).toBeUndefined();
  });
});

describe("runInitWithSources — resume logic", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
    language_notes: "",
  });

  const incrementalJson = JSON.stringify({
    entity_types: [{ type: "person", description: "Person", extraction_cues: [] }],
  });

  it("skips files already in analyzed_sources and resumes from next file", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");
    // Domain already has a.md and b.md analyzed
    const existingWithProgress: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
      analyzed_sources: ["src/a.md", "src/b.md"],
    };
    const llm = makeMultiLlm([incrementalJson]); // only 1 call expected (c.md)
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [existingWithProgress], "TestVault", new AbortController().signal),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start") as any[];
    expect(fileStarts).toHaveLength(1);
    expect(fileStarts[0].file).toBe("src/c.md");
  });

  it("abort during Phase 1 stops loop and persists current analyzed_sources", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const ac = new AbortController();
    let callCount = 0;
    // Abort after bootstrap call (a.md), before b.md
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                [Symbol.asyncIterator]: async function* () {
                  yield { choices: [{ delta: { content: bootstrapJson } }] };
                },
              });
            }
            // Second call (b.md incremental) — abort before returning
            ac.abort();
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: incrementalJson } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", ac.signal),
    );
    // No final result event (aborted before Phase 2)
    expect(events.some((e: any) => e.kind === "result")).toBe(false);
    // No Phase 2 init_start event
    expect(events.filter((e: any) => e.kind === "init_start" && e.phase === "ingest")).toHaveLength(0);
    // analyzed_sources persisted at abort point — either via domain_created (new domain) or domain_updated (existing domain)
    const persistEvent = events.find(
      (e: any) =>
        (e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)) ||
        (e.kind === "domain_created" && Array.isArray(e.entry?.analyzed_sources))
    ) as any;
    expect(persistEvent).toBeDefined();
  });
});

describe("runInitWithSources — per-file pipeline", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
    language_notes: "",
  });

  const incrementalJson = JSON.stringify({
    entity_types: [{ type: "person", description: "Person", extraction_cues: [] }],
  });

  // Ingest returns WikiPagesOutputSchema format: { reasoning, pages }.
  // Path must start with `!Wiki/dom/`.
  function ingestPagesJson(name: string): string {
    return JSON.stringify({ reasoning: "Extracted entities.", pages: [{ path: `!Wiki/dom/concepts/${name}.md`, content: `# ${name}\nbody` }] });
  }

  function makeOrderedLlm(events: string[][], onCall: (idx: number) => void): LlmClient {
    let callIndex = 0;
    return {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const idx = callIndex;
            onCall(idx);
            const chunks = events[idx] ?? events[events.length - 1];
            callIndex++;
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;
  }

  it("writes articles for file[0] before LLM is called for file[1]", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const writeLog: string[] = [];
    const llmCallLog: number[] = [];

    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (path: string) => {
        const all = Object.keys(files);
        const filtered = path === "" ? all : all.filter((f) => f.startsWith(path));
        return { files: filtered, folders: [] };
      }),
      read: vi.fn().mockImplementation(async (path: string) => files[path as keyof typeof files] ?? ""),
      write: vi.fn().mockImplementation(async (path: string) => {
        writeLog.push(`write:${path}@call=${llmCallLog.length}`);
      }),
    });
    const vt = new VaultTools(adapter, "/vault");

    // Calls expected: [0]=bootstrap(a), [1]=ingest(a), [2]=incremental(b), [3]=ingest(b), [4]=incremental(c), [5]=ingest(c)
    const llm = makeOrderedLlm(
      [
        [bootstrapJson],
        [ingestPagesJson("A")],
        [incrementalJson],
        [ingestPagesJson("B")],
        [incrementalJson],
        [ingestPagesJson("C")],
      ],
      (idx) => llmCallLog.push(idx),
    );

    await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", new AbortController().signal),
    );

    // The article A.md must have been written before the 3rd LLM call (incremental for b)
    const writeAIdx = writeLog.findIndex((w) => w.startsWith("write:!Wiki/dom/concepts/A.md"));
    expect(writeAIdx).toBeGreaterThanOrEqual(0);
    const writeACallCount = Number(writeLog[writeAIdx].split("@call=")[1]);
    // call=2 means after 2 LLM calls (bootstrap + ingest-a) — the 3rd call (incremental b) hasn't happened yet
    expect(writeACallCount).toBeLessThanOrEqual(2);
  });

  it("resume: skips files already in analyzed_sources_v2 domain", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const llmCalls: string[] = [];

    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");

    const existing: DomainEntry = {
      id: "dom",
      name: "Dom",
      wiki_folder: "dom",
      entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
      analyzed_sources: ["src/a.md"],
      analyzed_sources_v2: true,
    };

    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params: any) => {
            // Record user message to identify which file was sent
            const userMsg = params.messages?.find((m: any) => m.role === "user")?.content ?? "";
            llmCalls.push(userMsg as string);
            // alternate: incremental → ingest pages
            const isIngest = String(userMsg).includes("Wiki schema") || String(userMsg).includes("!Wiki");
            const body = isIngest
              ? JSON.stringify([{ path: `!Wiki/dom/concepts/X.md`, content: "x" }])
              : incrementalJson;
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: body } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [existing], "TestVault", new AbortController().signal),
    );

    // No LLM call should reference "src/a.md" as the analysis file (it might appear in ingest of b/c indirectly? — no, ingest only reads one file at a time)
    const refsToA = llmCalls.filter((m) => m.includes("src/a.md"));
    expect(refsToA).toHaveLength(0);
  });

  it("abort mid-file: analyzed_sources NOT updated for that file", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b" };
    const ac = new AbortController();
    let callIndex = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const idx = callIndex++;
            // 0: bootstrap(a), 1: ingest(a), 2: incremental(b) — abort here AFTER returning JSON
            if (idx === 2) {
              return Promise.resolve({
                [Symbol.asyncIterator]: async function* () {
                  yield { choices: [{ delta: { content: incrementalJson } }] };
                  // After yielding the chunk, signal abort so the post-stream check returns
                  ac.abort();
                },
              });
            }
            const body =
              idx === 0 ? bootstrapJson : JSON.stringify({ reasoning: "ok", pages: [{ path: "!Wiki/dom/concepts/A.md", content: "a" }] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: body } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");

    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", ac.signal),
    );

    // Collect all domain_updated events with analyzed_sources array
    const sourceUpdates = events.filter(
      (e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources),
    ) as any[];
    // Last analyzed_sources snapshot should contain "src/a.md" but NOT "src/b.md"
    const lastSnapshot = sourceUpdates[sourceUpdates.length - 1]?.patch?.analyzed_sources ?? [];
    expect(lastSnapshot).toContain("src/a.md");
    expect(lastSnapshot).not.toContain("src/b.md");
  });

  it("repeated init: no new sources → toAnalyze empty → no LLM calls", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    let llmCallCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            llmCallCount++;
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: "{}" } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const existing: DomainEntry = {
      id: "dom",
      name: "Dom",
      wiki_folder: "dom",
      entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
      analyzed_sources: ["src/a.md", "src/b.md", "src/c.md"],
      analyzed_sources_v2: true,
    };

    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");

    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [existing], "TestVault", new AbortController().signal),
    );

    expect(llmCallCount).toBe(0);
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("no new sources");
  });
});

describe("sanitizeWikiFolder applied in init bootstrap", () => {
  it("returns last segment when wiki_folder contains slash", () => {
    expect(sanitizeWikiFolder("os/network")).toBe("network");
    expect(sanitizeWikiFolder("vaults/MyVault/!Wiki/os")).toBe("os");
  });

  it("sanitizeWikiSubfolder strips domain prefix", () => {
    expect(sanitizeWikiSubfolder("os/network")).toBe("network");
    expect(sanitizeWikiSubfolder("processes")).toBe("processes");
  });
});
