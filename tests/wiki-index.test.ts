import { describe, it, expect, vi } from "vitest";
import { parseIndexAnnotations, upsertIndexAnnotation } from "../src/wiki-index";
import type { VaultTools } from "../src/vault-tools";

// ─── parseIndexAnnotations ───────────────────────────────────────────────────

describe("parseIndexAnnotations", () => {
  it("parses grouped Markdown format", () => {
    const content = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — WikiController: single-flight",
      "- [[agent-runner]] компоненты/agent-runner.md — AgentRunner: маршрутизация",
      "",
      "## операции",
      "- [[ingest-operation]] операции/ingest-operation.md — Ingest: извлечение",
    ].join("\n");
    const map = parseIndexAnnotations(content);
    expect(map.get("wiki-controller")).toBe("WikiController: single-flight");
    expect(map.get("agent-runner")).toBe("AgentRunner: маршрутизация");
    expect(map.get("ingest-operation")).toBe("Ingest: извлечение");
    expect(map.size).toBe(3);
  });

  it("returns empty map for empty content", () => {
    expect(parseIndexAnnotations("").size).toBe(0);
  });

  it("skips title and blank lines", () => {
    const content = "# Wiki Index\n\n## general\n- [[Page]] general/page.md — desc\n";
    const map = parseIndexAnnotations(content);
    expect(map.size).toBe(1);
    expect(map.get("Page")).toBe("desc");
  });

  it("handles annotation containing em-dash within text", () => {
    const content = "## sec\n- [[P]] sec/p.md — foo — bar\n";
    const map = parseIndexAnnotations(content);
    expect(map.get("P")).toBe("foo — bar");
  });
});

// ─── upsertIndexAnnotation ───────────────────────────────────────────────────

function makeVt(initial = ""): { vt: VaultTools; written: () => string } {
  let stored = initial;
  const vt = {
    read: vi.fn(async () => {
      if (stored === "__throw__") throw new Error("not found");
      return stored;
    }),
    write: vi.fn(async (_p: string, c: string) => { stored = c; }),
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => true), mkdir: vi.fn(async () => {}) },
  } as unknown as VaultTools;
  return { vt, written: () => stored };
}

function throwVt(): VaultTools {
  const vt = {
    read: vi.fn(async () => { throw new Error("not found"); }),
    write: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    adapter: { exists: vi.fn(async () => true), mkdir: vi.fn(async () => {}) },
  } as unknown as VaultTools;
  return vt;
}

describe("upsertIndexAnnotation", () => {
  it("creates fresh grouped index on empty file", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "wiki-controller", "desc",
      "!Wiki/work/компоненты/wiki-controller.md");
    expect(written()).toContain("# Wiki Index");
    expect(written()).toContain("## компоненты");
    expect(written()).toContain("- [[wiki-controller]] компоненты/wiki-controller.md — desc");
  });

  it("creates fresh grouped index when file not found", async () => {
    const vt = throwVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "annotation",
      "!Wiki/work/ops/p.md");
    const c = (vt.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(c).toContain("## ops");
    expect(c).toContain("- [[P]] ops/p.md — annotation");
  });

  it("writes to correct path", async () => {
    const { vt } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "d", "!Wiki/work/ops/p.md");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/.config/_index.md");
  });

  it("appends new entry to existing section", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "agent-runner", "AgentRunner",
      "!Wiki/work/компоненты/agent-runner.md");
    expect(written()).toContain("- [[wiki-controller]]");
    expect(written()).toContain("- [[agent-runner]] компоненты/agent-runner.md — AgentRunner");
  });

  it("replaces existing entry in section", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — old desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "wiki-controller", "new desc",
      "!Wiki/work/компоненты/wiki-controller.md");
    const lines = written().split("\n").filter((l) => l.includes("wiki-controller"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("new desc");
    expect(lines[0]).not.toContain("old desc");
  });

  it("appends new section when section missing", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## компоненты",
      "- [[wiki-controller]] компоненты/wiki-controller.md — desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await upsertIndexAnnotation(vt, "!Wiki/work", "ingest-op", "Ingest",
      "!Wiki/work/операции/ingest-op.md");
    expect(written()).toContain("## операции");
    expect(written()).toContain("- [[ingest-op]] операции/ingest-op.md — Ingest");
    expect(written()).toContain("## компоненты");
  });

  it("uses 'general' section for pages directly in wiki root", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "top-level", "desc",
      "!Wiki/work/top-level.md");
    expect(written()).toContain("## general");
  });

  it("uses 'general' when fullPath absent", async () => {
    const { vt, written } = makeVt();
    await upsertIndexAnnotation(vt, "!Wiki/work", "P", "desc");
    expect(written()).toContain("## general");
    expect(written()).toContain("- [[P]]");
    expect(written()).toContain("desc");
  });
});
