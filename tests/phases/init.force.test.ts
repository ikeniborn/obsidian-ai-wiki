import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import { wipeDomainFolder, runInitWithSources } from "../../src/phases/init";
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

function makeMultiLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: { completions: { create: vi.fn().mockImplementation(() => {
      const json = responses[i] ?? responses[responses.length - 1];
      i++;
      return Promise.resolve({ [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: json } }] };
      }});
    })}},
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function adapterWithSourceFiles(files: string[]): VaultAdapter {
  return mockAdapter({
    list: vi.fn().mockImplementation(async (p: string) => {
      if (p === "docs") return { files, folders: [] };
      return { files: [], folders: [] };
    }),
    read: vi.fn().mockResolvedValue("content"),
  });
}

const validBootstrapResponse = (id: string, wikiFolder: string) =>
  JSON.stringify({
    reasoning: "test",
    id,
    name: id.toUpperCase(),
    wiki_folder: wikiFolder,
    entity_types: [{ type: "concept", description: "c", extraction_cues: ["cue"], min_mentions_for_page: 1 }],
    language_notes: "fresh",
  });

const validDeltaResponse = () =>
  JSON.stringify({
    reasoning: "test",
    entity_types: [{ type: "concept2", description: "c2", extraction_cues: ["cue2"] }],
    language_notes: "fresh",
  });

describe("runInitWithSources force", () => {
  it("force=true ignores analyzed_sources and re-bootstraps from first file", async () => {
    const files = ["docs/a.md", "docs/b.md"];
    const adapter = adapterWithSourceFiles(files);
    const vt = new VaultTools(adapter, "");
    const existing: DomainEntry = {
      id: "ai", name: "AI", wiki_folder: "ai",
      source_paths: ["docs"],
      analyzed_sources: ["docs/a.md", "docs/b.md"],
      entity_types: [{ type: "stale", description: "old", extraction_cues: [] }],
      language_notes: "old notes",
    };
    const llm = makeMultiLlm([
      validBootstrapResponse("ai", "ai"),
      validDeltaResponse(),
      // ingest calls for each file (seeds + article) — return minimal valid JSON
      JSON.stringify({ reasoning: "r", seeds: [] }),
      JSON.stringify({ reasoning: "r", seeds: [] }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInitWithSources("ai", ["docs"], false, vt, llm, "x", [existing], "vault", signal, {}, undefined, true));
    const initStart = events.find((e) => e.kind === "init_start");
    expect(initStart).toEqual({ kind: "init_start", totalFiles: 2 });
    const firstUpdate = events.find((e) => e.kind === "domain_updated") as { patch: Record<string, unknown> } | undefined;
    expect(firstUpdate?.patch.analyzed_sources).toEqual([]);
  });

  it("force=true without existing domain falls through to bootstrap path", async () => {
    const files = ["docs/a.md"];
    const adapter = adapterWithSourceFiles(files);
    const vt = new VaultTools(adapter, "");
    const llm = makeMultiLlm([
      validBootstrapResponse("new", "new"),
      // ingest seeds call
      JSON.stringify({ reasoning: "r", seeds: [] }),
    ]);
    const signal = new AbortController().signal;
    const events = await collect(runInitWithSources("new", ["docs"], false, vt, llm, "x", [], "vault", signal, {}, undefined, true));
    const created = events.find((e) => e.kind === "domain_created");
    expect(created).toBeDefined();
  });
});

describe("wipeDomainFolder", () => {
  it("removes every file under !Wiki/<folder>/ and returns them", async () => {
    const files = [
      "!Wiki/ai/_index.md",
      "!Wiki/ai/concepts/foo.md",
      "!Wiki/ai/concepts/bar.md",
    ];
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (p: string) => {
        if (p === "!Wiki/ai") return { files: ["!Wiki/ai/_index.md"], folders: ["!Wiki/ai/concepts"] };
        if (p === "!Wiki/ai/concepts") return { files: ["!Wiki/ai/concepts/foo.md", "!Wiki/ai/concepts/bar.md"], folders: [] };
        return { files: [], folders: [] };
      }),
    });
    const vt = new VaultTools(adapter, "");
    const removed = await wipeDomainFolder(vt, "ai");
    expect(removed.sort()).toEqual(files.sort());
    for (const f of files) expect(adapter.remove).toHaveBeenCalledWith(f);
  });

  it("does not touch files outside !Wiki/<folder>/", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "");
    await wipeDomainFolder(vt, "ai");
    expect(adapter.remove).not.toHaveBeenCalledWith("!Wiki/_wiki_schema.md");
    expect(adapter.remove).not.toHaveBeenCalledWith("!Wiki/_log.md");
  });

  it("skips files that fail to remove and continues", async () => {
    let calls = 0;
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/ai/a.md", "!Wiki/ai/b.md"], folders: [] }),
      remove: vi.fn().mockImplementation(async (p: string) => {
        calls++;
        if (p === "!Wiki/ai/a.md") throw new Error("locked");
      }),
    });
    const vt = new VaultTools(adapter, "");
    const removed = await wipeDomainFolder(vt, "ai");
    expect(calls).toBe(2);
    expect(removed.sort()).toEqual(["!Wiki/ai/a.md", "!Wiki/ai/b.md"].sort());
  });
});
