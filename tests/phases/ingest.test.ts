import { describe, it, expect, vi } from "vitest";
import { runIngest } from "../../src/phases/ingest";
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

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "!Wiki/work",
  source_paths: ["Sources/"],
};

describe("runIngest", () => {
  it("yields error when args is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest([], vt, makeLlm("[]"), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields error when source file is outside vault", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runIngest(["/external/file.md"], vt, makeLlm("[]"), "llama3.2", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("writes pages returned by LLM", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity\n\nFact." },
    ]);
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
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/Entity.md", "# Entity\n\nFact.");
  });

  it("yields source_path_added when new parent folder encountered", async () => {
    const domainWithoutPath: DomainEntry = { ...domain, source_paths: [] };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity" },
    ]);
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
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity" },
    ]);
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
        makeLlm("[]"),
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
});
