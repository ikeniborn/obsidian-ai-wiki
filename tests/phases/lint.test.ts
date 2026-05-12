import { describe, it, expect, vi } from "vitest";
import { runLint } from "../../src/phases/lint";
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

function makeLlm(report: string, configJson = "{}"): LlmClient {
  const streamResponse = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: report } }] };
    },
  };
  const nonStreamResponse = { choices: [{ message: { content: configJson } }] };
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params: any) =>
          Promise.resolve(params.stream ? streamResponse : nonStreamResponse)
        ),
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
      runLint([], vt, makeLlm(""), "model", [], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when specified domain not found", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runLint(["unknown-domain"], vt, makeLlm(""), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      runLint(["work"], vt, makeLlm("No issues found."), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      runLint([], vt, makeLlm("Lint OK"), "model", [domainA, domainB], VAULT_ROOT, new AbortController().signal),
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
      JSON.stringify([{ path: "!Wiki/work/Page.md", content: fixedContent }]),
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
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
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
      entity_types: [{ type: "концепция", description: "updated", extraction_cues: ["тест"], min_mentions_for_page: 1, wiki_subfolder: "work/концепции" }],
      language_notes: "Updated notes.",
    });
    const events = await collect(
      runLint(["work"], vt, makeLlm("Report.", configJson), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const ev = events.find((e: any) => e.kind === "domain_updated") as any;
    expect(ev).toBeDefined();
    expect(ev.domainId).toBe("work");
    expect(ev.patch.entity_types).toHaveLength(1);
    expect(ev.patch.language_notes).toBe("Updated notes.");
  });
});
