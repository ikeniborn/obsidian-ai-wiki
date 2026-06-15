import { describe, it, expect, vi } from "vitest";
import { extractParentSourcePath, detectDomain, runIngest } from "../src/phases/ingest";
import type { DomainEntry } from "../src/domain";
import { PageSimilarityService } from "../src/page-similarity";
import { VaultTools } from "../src/vault-tools";
import type { VaultAdapter } from "../src/vault-tools";
import type { RunEvent } from "../src/types";

describe("extractParentSourcePath", () => {
  const VAULT = "/vaults/Work";

  it("returns vault-relative parent from deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/ai/article.md", VAULT))
      .toBe("notes/ai/");
  });

  it("returns vault-relative parent from one-level deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/file.md", VAULT))
      .toBe("notes/");
  });

  it("clamps to vault root when file is directly in vault", () => {
    expect(extractParentSourcePath("/vaults/Work/file.md", VAULT))
      .toBe("./");
  });

  it("clamps to vault root when parent is above vault", () => {
    expect(extractParentSourcePath("/outside/file.md", VAULT))
      .toBe("./");
  });
});

describe("detectDomain", () => {
  const VAULT = "/project";
  const makeD = (id: string, paths: string[]): DomainEntry => ({
    id, name: id, wiki_folder: `!Wiki/${id}`, source_paths: paths,
  });

  it("matches by source_paths prefix", () => {
    const domains = [makeD("d1", ["notes/"]), makeD("d2", ["docs/"])];
    const result = detectDomain("/project/notes/sub/file.md", domains, VAULT);
    expect(result?.id).toBe("d1");
  });

  it("falls back to first domain if no match", () => {
    const domains = [makeD("fallback", []), makeD("other", ["docs/"])];
    const result = detectDomain("/project/unknown/file.md", domains, VAULT);
    expect(result?.id).toBe("fallback");
  });

  it("returns null if domains empty", () => {
    expect(detectDomain("/project/file.md", [], VAULT)).toBeNull();
  });
});

describe("runIngest similarity integration", () => {
  it("exports runIngest with optional similarity and cachedAnnotations params", () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map<string, string>();
    expect(typeof runIngest).toBe("function");
    expect(svc).toBeDefined();
    expect(annotations).toBeDefined();
  });
});

// === Harness ===========================================================
// A SEQUENCED llm mock yields a fresh fake-stream per chat.completions.create
// call, so the three LLM calls runIngest makes (ingest.entities, ingest.pages,
// ingest.merge) can each return a different canned response.

function streamOf(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: text } }] };
    },
  };
}

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
  } as VaultAdapter;
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "work",          // → wikiVaultPath "!Wiki/work"
  source_paths: ["sources"],
  pageNameVersion: 1,           // skip legacy-unprefixed cleanup
};

describe("dedup gate", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Dedup gate merges a near-duplicate create]]
  it("merges a near-duplicate create into the existing page instead of writing a duplicate", async () => {
    const VAULT = "/vault";
    const targetPath = "!Wiki/work/alpha/wiki_work_alpha.md";   // pid wiki_work_alpha
    const dupPath    = "!Wiki/work/alpha/wiki_work_alpha2.md";  // pid wiki_work_alpha2 (the new candidate)
    const sourcePath = "sources/doc.md";
    const existingTarget = "---\nwiki_sources:\n  - \"[[doc]]\"\n---\n# Alpha\n\nOld facts about alpha.";
    const mergedContent  = "---\nwiki_sources:\n  - \"[[doc]]\"\n---\n# Alpha\n\nOld facts about alpha.\n\nNew facts about alpha.";

    const read = vi.fn(async (p: string) => {
      if (p === sourcePath) return "Alpha is a thing. Lots about alpha.";
      if (p === targetPath) return existingTarget;
      if (p === "!Wiki/work/_config/_index.md") return "# Wiki Index\n\n## alpha\n- [[wiki_work_alpha]] alpha/wiki_work_alpha.md — Alpha overview\n";
      // candidate page does not exist yet → throw so existingContent === null
      if (p === dupPath) throw new Error("ENOENT");
      return "";
    });

    const list = vi.fn(async (dir: string) => {
      if (dir === "!Wiki/work") return { files: [targetPath], folders: [] };
      return { files: [], folders: [] };
    });

    const adapter = mockAdapter({ read, list });
    const vt = new VaultTools(adapter, VAULT);

    // SEQUENCED responses: #1 entities, #2 pages, #3 merge.
    const entitiesResp = JSON.stringify({
      reasoning: "found one entity",
      entities: [{ name: "Alpha", type: "concept" }],
    });
    const pagesResp = JSON.stringify({
      reasoning: "one new page",
      pages: [{ path: dupPath, content: "# Alpha\n\nNew facts about alpha.", annotation: "Alpha duplicate draft" }],
    });
    const mergeResp = JSON.stringify({ content: mergedContent, annotation: "Alpha overview merged" });

    const create = vi.fn()
      .mockResolvedValueOnce(streamOf(entitiesResp))
      .mockResolvedValueOnce(streamOf(pagesResp))
      .mockResolvedValueOnce(streamOf(mergeResp));
    const llm = { chat: { completions: { create } } };

    // Stub similarity: fires the gate with a hit on the existing target pid.
    const similarity = {
      config: { mode: "jaccard", topK: 5 },
      loadCache: async () => {},
      selectByEntities: async () => ({ results: new Map<string, string[]>(), allFailed: false }),
      setJaccardCorpus: () => {},
      maxSimilarityToExisting: async () => ({ pid: "wiki_work_alpha", score: 0.92 }),
      refreshCache: async () => ({ updated: 0 }),
    } as unknown as PageSimilarityService;

    const opts = { dedupOnIngest: true, dedupThreshold: 0.85, structuredRetries: 1 };

    const events = await collect(
      runIngest([sourcePath], vt, llm as never, "llama3.2", [domain], VAULT,
        new AbortController().signal, opts, similarity),
    );

    // The three LLM calls happened in order.
    expect(create).toHaveBeenCalledTimes(3);

    // The duplicate path is never written.
    const writes = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(writes).not.toContain(dupPath);

    // The existing target IS written exactly once (the merged content).
    const targetWrites = writes.filter((p) => p === targetPath);
    expect(targetWrites).toHaveLength(1);
    expect(adapter.write).toHaveBeenCalledWith(targetPath, mergedContent);

    // Exactly one dedup event (info_text, icon 🔁, summary starts with "Дубль:").
    const dedupEvents = events.filter(
      (e): e is Extract<RunEvent, { kind: "info_text" }> =>
        e.kind === "info_text" && e.summary.startsWith("Дубль:"),
    );
    expect(dedupEvents).toHaveLength(1);
    expect(dedupEvents[0].icon).toBe("🔁");
  });
});
