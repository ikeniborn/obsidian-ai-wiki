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

  it("write creates all ancestor dirs for deeply nested path", async () => {
    const created: string[] = [];
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockImplementation(async (p: string) => { created.push(p); }),
    });
    const vt = new VaultTools(adapter, "/vault");
    await vt.write("!Wiki/.config/_wiki_schema.md", "content");
    expect(created).toEqual(["!Wiki", "!Wiki/.config"]);
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/.config/_wiki_schema.md", "content");
  });

  it("write continues creating dirs even if exists throws for one segment", async () => {
    const created: string[] = [];
    let call = 0;
    const adapter = mockAdapter({
      exists: vi.fn().mockImplementation(async () => { if (++call === 1) throw new Error("stat error"); return false; }),
      mkdir: vi.fn().mockImplementation(async (p: string) => { created.push(p); }),
    });
    const vt = new VaultTools(adapter, "/vault");
    await vt.write("!Wiki/.config/_wiki_schema.md", "content");
    // first exists throws → treated as false → mkdir("!Wiki") called
    // second exists returns false → mkdir("!Wiki/.config") called
    expect(created).toEqual(["!Wiki", "!Wiki/.config"]);
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/.config/_wiki_schema.md", "content");
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

  it("write falls back to adapter.write when vault.create throws (hidden dir)", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      write: vi.fn().mockResolvedValue(undefined),
    });
    const vault = {
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      create: vi.fn().mockRejectedValue(new Error("File already exists")),
      modify: vi.fn(),
    };
    const vt = new VaultTools(adapter, "/vault", vault);
    await vt.write("!Wiki/.config/_log.md", "new content");
    expect(vault.create).toHaveBeenCalledWith("!Wiki/.config/_log.md", "new content");
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/.config/_log.md", "new content");
  });

  it("renderExcalidrawPng delegates to adapter and returns base64", async () => {
    const adapter = mockAdapter({
      renderExcalidrawPng: vi.fn().mockResolvedValue("BASE64PNG"),
    });
    const vt = new VaultTools(adapter, "/vault");
    expect(await vt.renderExcalidrawPng("draw.excalidraw")).toBe("BASE64PNG");
    expect(adapter.renderExcalidrawPng).toHaveBeenCalledWith("draw.excalidraw");
  });

  it("renderExcalidrawPng returns null when adapter lacks the hook", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    expect(await vt.renderExcalidrawPng("draw.excalidraw")).toBeNull();
  });
});
