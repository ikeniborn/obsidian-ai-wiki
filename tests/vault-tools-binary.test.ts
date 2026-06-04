import { describe, it, expect, vi } from "vitest";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

function makeAdapter(withBinary = true): VaultAdapter {
  const base: VaultAdapter = {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
  if (withBinary) {
    (base as VaultAdapter & { readBinary: unknown }).readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(4));
  }
  return base;
}

describe("VaultTools.readBinary", () => {
  it("delegates to adapter.readBinary", async () => {
    const buf = new ArrayBuffer(4);
    const adapter = makeAdapter(true);
    (adapter as VaultAdapter & { readBinary: ReturnType<typeof vi.fn> }).readBinary.mockResolvedValue(buf);
    const tools = new VaultTools(adapter, "/vault");
    const result = await tools.readBinary("img.png");
    expect((adapter as VaultAdapter & { readBinary: ReturnType<typeof vi.fn> }).readBinary).toHaveBeenCalledWith("img.png");
    expect(result).toBe(buf);
  });

  it("throws when adapter has no readBinary", async () => {
    const adapter = makeAdapter(false);
    const tools = new VaultTools(adapter, "/vault");
    await expect(tools.readBinary("img.png")).rejects.toThrow("readBinary not supported");
  });
});
