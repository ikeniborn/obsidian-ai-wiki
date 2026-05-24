import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
import { mergeEntityTypes } from "../../src/domain";
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

describe("runInitWithSources — Phase 1 incremental (entity types via ingest delta)", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  // Ingest responses that carry entity_types_delta
  const ingestWithPersonDelta = JSON.stringify({
    reasoning: "ok",
    pages: [],
    entity_types_delta: [
      { type: "concept", description: "Refined concept", extraction_cues: ["refined"] },
      { type: "person", description: "A person", extraction_cues: ["person"] },
    ],
  });

  const ingestWithPlaceDelta = JSON.stringify({
    reasoning: "ok",
    pages: [],
    entity_types_delta: [
      { type: "place", description: "A place", extraction_cues: ["location"] },
    ],
  });

  const ingestEmpty = JSON.stringify({ reasoning: "ok", pages: [] });

  const sourceFiles = {
    "src/a.md": "content a",
    "src/b.md": "content b",
    "src/c.md": "content c",
  };

  it("emits domain_updated with merged entity_types when ingest returns delta", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    // Call sequence for 3 files: bootstrap(a), ingest(a), ingest(b with person), ingest(c with place)
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithPersonDelta, ingestWithPlaceDelta]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    const updates = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types,
    ) as any[];
    // At minimum the loop-end domain_updated events for b and c (both have deltas intercepted)
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("entity_types accumulate correctly — later files merge on top of earlier", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    // Call sequence: bootstrap(a), ingest(a no-delta), ingest(b with person+refined-concept), ingest(c with place)
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithPersonDelta, ingestWithPlaceDelta]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    // Find last domain_updated with entity_types (loop-end after c.md)
    const updatesWithTypes = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined,
    ) as any[];
    const last = updatesWithTypes[updatesWithTypes.length - 1];
    const types = last.patch.entity_types.map((e: any) => e.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
    expect(types).toContain("place");
    // concept should be refined (from ingestWithPersonDelta)
    const concept = last.patch.entity_types.find((e: any) => e.type === "concept");
    expect(concept.description).toBe("Refined concept");
  });

  it("emits file_start and file_done for each file", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestEmpty, ingestEmpty]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start") as any[];
    const fileDones = events.filter((e: any) => e.kind === "file_done") as any[];
    expect(fileStarts).toHaveLength(3);
    expect(fileDones).toHaveLength(3);
    for (const fs of fileStarts) expect(fs.phase).toBeUndefined();
    for (const fd of fileDones) expect(fd.phase).toBeUndefined();
  });

  it("emits a single init_start", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestEmpty, ingestEmpty]),
        "model", [], "TestVault", new AbortController().signal,
      ),
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

  it("skips bootstrap file when LLM returns invalid JSON and does NOT emit domain_created", async () => {
    const adapter = mockAdapterWithSources({ "src/a.md": "content a" });
    const vt = new VaultTools(adapter, "/vault");
    const invalidJson = "not json at all";
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([invalidJson]), "model", [], "TestVault", new AbortController().signal),
    );
    // Bootstrap failed — domain should not be created
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
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

    // Calls: [0]=bootstrap(a), [1]=ingest(a), [2]=ingest(b), [3]=ingest(c)
    const llm = makeOrderedLlm(
      [
        [bootstrapJson],
        [ingestPagesJson("A")],
        [ingestPagesJson("B")],
        [ingestPagesJson("C")],
      ],
      (idx) => llmCallLog.push(idx),
    );

    await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", new AbortController().signal),
    );

    // The article A.md must have been written before the 3rd LLM call (ingest-b)
    const writeAIdx = writeLog.findIndex((w) => w.startsWith("write:!Wiki/dom/concepts/A.md"));
    expect(writeAIdx).toBeGreaterThanOrEqual(0);
    const writeACallCount = Number(writeLog[writeAIdx].split("@call=")[1]);
    // call=2 means after 2 LLM calls (bootstrap + ingest-a) — the 3rd call (ingest-b) hasn't happened yet
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
            // All non-bootstrap calls are ingest calls — return valid ingest format
            const body = JSON.stringify({ reasoning: "ok", pages: [{ path: `!Wiki/dom/concepts/X.md`, content: "x" }] });
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
            // 0: bootstrap(a), 1: ingest(a), 2: ingest(b) — abort here AFTER returning JSON
            if (idx === 2) {
              return Promise.resolve({
                [Symbol.asyncIterator]: async function* () {
                  yield { choices: [{ delta: { content: JSON.stringify({ reasoning: "ok", pages: [] }) } }] };
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

describe("runInitWithSources — domain_updated intercept from ingest", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  it("intercepts domain_updated from ingest and merged entity_types visible in loop-end domain_updated", async () => {
    // 2 source files: a.md (bootstrap + ingest-no-delta), b.md (ingest-with-delta)
    // After b.md ingest: loop-end domain_updated should have both concept + person
    const files = { "src/a.md": "content a", "src/b.md": "content b" };
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");

    const ingestEmpty = JSON.stringify({ reasoning: "ok", pages: [] });
    const ingestWithDelta = JSON.stringify({
      reasoning: "Found person type",
      pages: [],
      entity_types_delta: [
        { type: "person", description: "A person", extraction_cues: ["person"] },
      ],
    });

    // Call sequence: 0=bootstrap(a), 1=ingest(a), 2=ingest(b)
    const llm = makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithDelta]);

    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", new AbortController().signal),
    );

    // Find all domain_updated events with entity_types
    const allUpdates = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined,
    ) as any[];
    expect(allUpdates.length).toBeGreaterThan(0);
    // The last one should have both concept (bootstrap) and person (from b's ingest delta)
    const last = allUpdates[allUpdates.length - 1];
    const types = last.patch.entity_types.map((t: any) => t.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
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
