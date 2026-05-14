import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
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
