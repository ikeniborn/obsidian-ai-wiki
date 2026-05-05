import { describe, it, expect, vi } from "vitest";
import { runIngest, extractParentSourcePath } from "../../src/phases/ingest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain-map";

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

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "vaults/Work/!Wiki/work",
  source_paths: ["vaults/Work/Sources"],
};

describe("extractParentSourcePath", () => {
  it("returns direct parent from deep path", () => {
    expect(extractParentSourcePath("/root/vaults/Work/ИИ/sub/file.md", "/root", "/root")).toBe("vaults/Work/ИИ/sub/");
  });
  it("returns direct parent from one-level deep path", () => {
    expect(extractParentSourcePath("/root/vaults/Work/ИИ/file.md", "/root", "/root")).toBe("vaults/Work/ИИ/");
  });
  it("returns vault root when file is directly in vault", () => {
    expect(extractParentSourcePath("/root/file.md", "/root", "/root")).toBe("./");
  });
});

describe("runIngest", () => {
  it("yields error when args is empty", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runIngest([], vt, makeLlm("[]"), "llama3.2", [domain], "/repo", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when source file is outside vault", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runIngest(["/external/file.md"], vt, makeLlm("[]"), "llama3.2", [domain], "/repo", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("writes pages returned by LLM", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const llmResponse = JSON.stringify([
      { path: "vaults/Work/!Wiki/work/Entity.md", content: "# Entity\n\nFact." },
    ]);
    const events = await collect(
      runIngest(
        ["vaults/Work/Sources/doc.md"],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        "/vault",
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    expect(adapter.write).toHaveBeenCalledWith(
      "vaults/Work/!Wiki/work/Entity.md",
      "# Entity\n\nFact.",
    );
  });

  it("yields source_path_added when new parent folder encountered", async () => {
    const domainWithoutPath: DomainEntry = { ...domain, source_paths: [] };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/workspace/vault");
    const llmResponse = JSON.stringify([
      { path: "vaults/Work/!Wiki/work/Entity.md", content: "# Entity" },
    ]);
    const events = await collect(
      runIngest(
        ["/workspace/vault/vaults/Work/ИИ/subfolder/file.md"],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domainWithoutPath],
        "/workspace/vault",
        new AbortController().signal,
      ),
    );
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("vaults/Work/ИИ/subfolder/");
    expect(ev.domainId).toBe("work");
  });

  it("yields source_path_added with direct parent even if ancestor path exists", async () => {
    // Domain has source_paths: ["vaults/Work/Sources"]
    // File is at: /workspace/vault/vaults/Work/Sources/doc.md
    // Direct parent: vaults/Work/Sources/
    // Should yield with the direct parent path (consolidation happens in controller)
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/workspace/vault");
    const llmResponse = JSON.stringify([
      { path: "vaults/Work/!Wiki/work/Entity.md", content: "# Entity" },
    ]);
    const events = await collect(
      runIngest(
        ["/workspace/vault/vaults/Work/Sources/doc.md"],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        "/workspace/vault",
        new AbortController().signal,
      ),
    );
    const ev = events.find((e: any) => e.kind === "source_path_added") as any;
    expect(ev).toBeDefined();
    expect(ev.path).toBe("vaults/Work/Sources/");
    expect(ev.domainId).toBe("work");
  });

  it("yields result with count=0 when LLM returns empty array", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("content") });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runIngest(
        ["vaults/Work/Sources/doc.md"],
        vt,
        makeLlm("[]"),
        "llama3.2",
        [domain],
        "/vault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toMatch(/новых или изменённых страниц нет/);
  });
});
