import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("VaultTools", () => {
  it("read delegates to adapter", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("hello") });
    const vt = new VaultTools(adapter, "/vault");
    expect(await vt.read("notes/a.md")).toBe("hello");
    expect(adapter.read).toHaveBeenCalledWith("notes/a.md");
  });

  it("write creates missing dir then writes", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    await vt.write("notes/sub/a.md", "content");
    expect(adapter.mkdir).toHaveBeenCalledWith("notes/sub");
    expect(adapter.write).toHaveBeenCalledWith("notes/sub/a.md", "content");
  });

  it("write skips mkdir when dir exists", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(true) });
    const vt = new VaultTools(adapter, "/vault");
    await vt.write("notes/a.md", "content");
    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(adapter.write).toHaveBeenCalledWith("notes/a.md", "content");
  });

  it("listFiles returns empty for non-existent dir", async () => {
    const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(false) });
    const vt = new VaultTools(adapter, "/vault");
    expect(await vt.listFiles("!Wiki/domain")).toEqual([]);
  });

  it("listFiles returns files from adapter", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/d/a.md", "!Wiki/d/b.md"], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    expect(await vt.listFiles("!Wiki/d")).toEqual(["!Wiki/d/a.md", "!Wiki/d/b.md"]);
  });

  it("readAll skips unreadable files", async () => {
    const adapter = mockAdapter({
      read: vi.fn()
        .mockResolvedValueOnce("content-a")
        .mockRejectedValueOnce(new Error("not found")),
    });
    const vt = new VaultTools(adapter, "/vault");
    const result = await vt.readAll(["a.md", "missing.md"]);
    expect(result.size).toBe(1);
    expect(result.get("a.md")).toBe("content-a");
  });

  it("toVaultPath converts absolute to vault-relative", () => {
    const vt = new VaultTools(mockAdapter(), "/home/user/vault");
    expect(vt.toVaultPath("/home/user/vault/notes/a.md")).toBe("notes/a.md");
  });

  it("toVaultPath returns null for paths outside vault", () => {
    const vt = new VaultTools(mockAdapter(), "/home/user/vault");
    expect(vt.toVaultPath("/other/path")).toBeNull();
  });

  it("vaultRoot returns the absolute vault base path", () => {
    const vt = new VaultTools(mockAdapter(), "/home/user/vault");
    expect(vt.vaultRoot).toBe("/home/user/vault");
  });
});
