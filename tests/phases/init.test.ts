import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
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
  wiki_folder: "vaults/Test/!Wiki/existing",
  source_paths: [],
};

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
      runInit([], vt, makeLlm("{}"), "model", [], "/vault", "TestVault", new AbortController().signal),
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
        "/vault",
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
        "/vault",
        "TestVault",
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("Dry run");
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });

  it("yields domain_created event with parsed entry on success", async () => {
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
        "/vault",
        "TestVault",
        new AbortController().signal,
      ),
    );
    const domainCreated = events.find((e: any) => e.kind === "domain_created") as any;
    expect(domainCreated).toBeDefined();
    expect(domainCreated.entry.id).toBe("newdomain");
    expect(domainCreated.entry.wiki_folder).toBe("vaults/TestVault/!Wiki/newdomain");
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
        "/vault",
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
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "/vault", "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaCall = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    expect(schemaCall).toBeDefined();
    expect(schemaCall![1]).toContain("# Wiki Schema");
  });

  it("создаёт _index.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "/vault", "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const indexCall = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(indexCall).toBeDefined();
    expect(indexCall![1]).toContain("# Wiki Index");
  });

  it("создаёт _log.md когда файл отсутствует", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "/vault", "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const logCall = writeCalls.find(([path]) => path.endsWith("_log.md"));
    expect(logCall).toBeDefined();
    expect(logCall![1]).toContain("# Wiki Log");
  });

  it("не перезаписывает существующие корневые файлы", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(true) });
    const vt = new VaultTools(adapter, "/vault");
    await collect(
      runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "/vault", "TestVault", new AbortController().signal),
    );
    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const schemaWrite = writeCalls.find(([path]) => path.endsWith("_schema.md"));
    const indexWrite = writeCalls.find(([path]) => path.endsWith("_index.md"));
    expect(schemaWrite).toBeUndefined();
    expect(indexWrite).toBeUndefined();
  });
});
