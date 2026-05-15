import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import { wipeDomainFolder } from "../../src/phases/init";

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
