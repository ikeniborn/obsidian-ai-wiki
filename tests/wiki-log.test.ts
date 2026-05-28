import { describe, it, expect, vi } from "vitest";
import { appendWikiLog } from "../src/wiki-log";
import type { VaultTools } from "../src/vault-tools";

function makeVt(initial = ""): { vt: VaultTools; written: string[] } {
  let stored = initial;
  const written: string[] = [];
  const vt = {
    read: vi.fn(async (_p: string) => {
      if (stored === "__throw__") throw new Error("not found");
      return stored;
    }),
    write: vi.fn(async (_p: string, c: string) => { stored = c; written.push(c); }),
  } as unknown as VaultTools;
  return { vt, written };
}

const DOMAIN_FOLDER = "!Wiki/work";

describe("appendWikiLog — ingest", () => {
  it("writes ingest entry with СОЗДАНА line", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "ingest",
      sourcePath: "docs/foo.md",
      entries: [{ path: "компоненты/foo.md", action: "СОЗДАНА", statusTo: "stub" }],
      outputTokens: 100,
    });
    expect(written[0]).toContain("ingest");
    expect(written[0]).toContain("work");
    expect(written[0]).toContain("СОЗДАНА: компоненты/foo.md (stub)");
    expect(written[0]).toContain("**Источник:** docs/foo.md");
    expect(written[0]).toContain("**Токены:** 100");
    expect(written[0]).toContain("---");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe("!Wiki/work/_config/_log.md");
  });

  it("writes ОБНОВЛЕНА with status transition", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "ingest",
      sourcePath: "docs/bar.md",
      entries: [{ path: "ops/bar.md", action: "ОБНОВЛЕНА", statusFrom: "stub", statusTo: "developing" }],
      outputTokens: 50,
    });
    expect(written[0]).toContain("ОБНОВЛЕНА: ops/bar.md (stub→developing)");
  });

  it("appends to existing log content", async () => {
    const { vt, written } = makeVt("## prior entry\n---\n");
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "ingest",
      sourcePath: "docs/x.md",
      entries: [],
      outputTokens: 0,
    });
    expect(written[0]).toContain("prior entry");
    expect(written[0]).toContain("ingest");
  });
});

describe("appendWikiLog — lint", () => {
  it("writes lint entry", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "lint",
      domainId: "work",
      fixed: ["компоненты/foo.md", "ops/bar.md"],
      checkedCount: 10,
      outputTokens: 200,
    });
    expect(written[0]).toContain("lint");
    expect(written[0]).toContain("**Проверено:** 10 | **Исправлено:** 2");
    expect(written[0]).toContain("ИСПРАВЛЕНА: компоненты/foo.md");
    expect(written[0]).toContain("ИСПРАВЛЕНА: ops/bar.md");
  });
});

describe("appendWikiLog — fix", () => {
  it("writes fix entry", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "fix",
      filePath: "компоненты/foo.md",
      fixed: ["компоненты/foo.md"],
      outputTokens: 42,
    });
    expect(written[0]).toContain("fix");
    expect(written[0]).toContain("**Файл:** компоненты/foo.md");
    expect(written[0]).toContain("ИСПРАВЛЕНА: компоненты/foo.md");
  });
});

describe("appendWikiLog — УДАЛЕНА action", () => {
  it("emits 'УДАЛЕНА: <path>' line for merge-delete entries", async () => {
    const { vt, written } = makeVt();
    await appendWikiLog(vt, DOMAIN_FOLDER, "work", {
      op: "ingest",
      sourcePath: "Sources/doc.md",
      outputTokens: 42,
      entries: [
        { path: "entities/New.md", action: "СОЗДАНА", statusTo: "stub" },
        { path: "entities/Old.md", action: "УДАЛЕНА" },
      ],
    });
    expect(written[0]).toContain("СОЗДАНА: entities/New.md (stub)");
    expect(written[0]).toMatch(/^- УДАЛЕНА: entities\/Old\.md$/m);
  });
});
