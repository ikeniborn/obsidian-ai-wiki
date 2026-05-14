import { describe, it, expect, vi } from "vitest";
import { runInit, mergeEntityTypes } from "../../src/phases/init";
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
    const schemaWrite = writeCalls.find(([path]) => path === "!Wiki/_wiki_schema.md");
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

  it("emits init_start { phase: 'analysis' } before bootstrap", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStart = events.find((e: any) => e.kind === "init_start") as any;
    expect(initStart).toBeDefined();
    expect(initStart.phase).toBe("analysis");
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

  it("emits file_start { index: 0, phase: 'analysis' } and file_done { phase: 'analysis' } for file_0", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStart = events.find((e: any) => e.kind === "file_start") as any;
    const fileDone = events.find((e: any) => e.kind === "file_done") as any;
    expect(fileStart?.index).toBe(0);
    expect(fileStart?.phase).toBe("analysis");
    expect(fileDone?.phase).toBe("analysis");
  });
});

describe("runInitWithSources — Phase 1 incremental", () => {
  const bootstrapJson = JSON.stringify({
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  const incrementalJson1 = JSON.stringify({
    entity_types: [
      { type: "concept", description: "Refined concept", extraction_cues: ["refined"] },
      { type: "person", description: "A person", extraction_cues: ["person"] },
    ],
  });

  const incrementalJson2 = JSON.stringify({
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
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
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

  it("emits file_start { phase: 'analysis' } and file_done { phase: 'analysis' } for each incremental file", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start" && e.phase === "analysis") as any[];
    const fileDones = events.filter((e: any) => e.kind === "file_done" && e.phase === "analysis") as any[];
    expect(fileStarts).toHaveLength(3);
    expect(fileDones).toHaveLength(3);
  });

  it("emits init_start { phase: 'ingest' } before Phase 2 loop", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStarts = events.filter((e: any) => e.kind === "init_start") as any[];
    expect(initStarts).toHaveLength(2);
    expect(initStarts[0].phase).toBe("analysis");
    expect(initStarts[1].phase).toBe("ingest");
  });
});

describe("runInitWithSources — error handling", () => {
  const bootstrapJson = JSON.stringify({
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

  it("emits assistant_text truncation warning when file exceeds 8000 chars", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const warning = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("truncated to 8 000 chars")
    ) as any;
    expect(warning).toBeDefined();
    expect(warning.delta).toContain("src/a.md");
  });

  it("does NOT emit truncation warning when file is exactly 8000 chars", async () => {
    const exactContent = "x".repeat(8_000);
    const adapter = mockAdapterWithSources({ "src/a.md": exactContent });
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
