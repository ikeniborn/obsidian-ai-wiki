import { describe, it, expect, vi } from "vitest";
import { parseIndexAnnotations, upsertIndexAnnotation } from "../src/wiki-index";
import type { VaultTools } from "../src/vault-tools";

describe("parseIndexAnnotations", () => {
  it("parses PageId: annotation lines", () => {
    const content = "DeepSeek: языковая модель для инференса в облаке\nКластеризация: алгоритм группировки";
    const map = parseIndexAnnotations(content);
    expect(map.get("DeepSeek")).toBe("языковая модель для инференса в облаке");
    expect(map.get("Кластеризация")).toBe("алгоритм группировки");
  });

  it("ignores lines without colon", () => {
    const content = "# Wiki Index\n- [[PageA]]\nPageB: annotation";
    const map = parseIndexAnnotations(content);
    expect(map.size).toBe(1);
    expect(map.get("PageB")).toBe("annotation");
  });

  it("returns empty map for empty content", () => {
    expect(parseIndexAnnotations("").size).toBe(0);
  });

  it("ignores blank lines and headers", () => {
    const content = "\n## Section\nPage: info\n\n";
    const map = parseIndexAnnotations(content);
    expect(map.get("Page")).toBe("info");
    expect(map.size).toBe(1);
  });

  it("handles annotation with colons", () => {
    const content = "Model: fast: low-latency model";
    const map = parseIndexAnnotations(content);
    expect(map.get("Model")).toBe("fast: low-latency model");
  });
});

describe("upsertIndexAnnotation", () => {
  function makeVaultTools(initial: string): {
    vt: Pick<VaultTools, "read" | "write">;
    written: string[];
  } {
    const written: string[] = [];
    const vt = {
      read: vi.fn(async () => initial),
      write: vi.fn(async (_path: string, content: string) => { written.push(content); }),
    } as unknown as Pick<VaultTools, "read" | "write">;
    return { vt, written };
  }

  it("appends new annotation when pageId absent", async () => {
    const { vt, written } = makeVaultTools("Existing: existing annotation");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "NewPage", "новая страница");
    expect(written[0]).toContain("NewPage: новая страница");
    expect(written[0]).toContain("Existing: existing annotation");
  });

  it("replaces existing annotation for same pageId", async () => {
    const { vt, written } = makeVaultTools("OldPage: старое описание");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "OldPage", "новое описание");
    expect(written[0]).toBe("OldPage: новое описание");
  });

  it("creates fresh index when file does not exist", async () => {
    const vt = {
      read: vi.fn(async () => { throw new Error("not found"); }),
      write: vi.fn(async () => {}),
    } as unknown as VaultTools;
    await upsertIndexAnnotation(vt, "!Wiki/work", "Page", "описание");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("Page: описание");
  });

  it("writes to correct path", async () => {
    const { vt } = makeVaultTools("");
    await upsertIndexAnnotation(vt as unknown as VaultTools, "!Wiki/work", "P", "desc");
    expect((vt.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("!Wiki/work/_index.md");
  });
});
