import { describe, it, expect, vi } from "vitest";
import { ensureDomainConfig } from "../src/domain-config";
import type { VaultTools } from "../src/vault-tools";

function makeVt(opts: {
  existsMap?: Record<string, boolean>;
  readMap?: Record<string, string>;
} = {}): {
  vt: VaultTools;
  mkdirCalls: string[];
  writeCalls: Array<[string, string]>;
  removeCalls: string[];
} {
  const existsMap = opts.existsMap ?? {};
  const readMap = opts.readMap ?? {};
  const mkdirCalls: string[] = [];
  const writeCalls: Array<[string, string]> = [];
  const removeCalls: string[] = [];

  const vt = {
    exists: vi.fn(async (p: string) => existsMap[p] ?? false),
    mkdir: vi.fn(async (p: string) => { mkdirCalls.push(p); }),
    read: vi.fn(async (p: string) => {
      if (readMap[p] !== undefined) return readMap[p];
      throw new Error("not found");
    }),
    write: vi.fn(async (p: string, c: string) => { writeCalls.push([p, c]); }),
    remove: vi.fn(async (p: string) => { removeCalls.push(p); }),
  } as unknown as VaultTools;
  return { vt, mkdirCalls, writeCalls, removeCalls };
}

describe("ensureDomainConfig", () => {
  it("creates _config directory", async () => {
    const { vt, mkdirCalls } = makeVt();
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(mkdirCalls).toContain("!Wiki/ии/_config");
  });

  it("migrates _index.md when old exists and new does not", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_index.md": true,
        "!Wiki/ии/_config/_index.md": false,
      },
      readMap: { "!Wiki/ии/_index.md": "# Index content" },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toContainEqual(["!Wiki/ии/_config/_index.md", "# Index content"]);
    expect(removeCalls).toContain("!Wiki/ии/_index.md");
  });

  it("migrates _log.md when old exists and new does not", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_log.md": true,
        "!Wiki/ии/_config/_log.md": false,
      },
      readMap: { "!Wiki/ии/_log.md": "## log entry" },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toContainEqual(["!Wiki/ии/_config/_log.md", "## log entry"]);
    expect(removeCalls).toContain("!Wiki/ии/_log.md");
  });

  it("removes old file when new already exists (idempotent)", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {
        "!Wiki/ии/_index.md": true,
        "!Wiki/ии/_config/_index.md": true,
      },
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toHaveLength(0);
    expect(removeCalls).toContain("!Wiki/ии/_index.md");
  });

  it("does nothing when old files do not exist", async () => {
    const { vt, writeCalls, removeCalls } = makeVt({
      existsMap: {},
    });
    await ensureDomainConfig(vt, "!Wiki/ии");
    expect(writeCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });
});
