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

  it("extracts annotation from new format (pid: [[pid]] path | annotation)", () => {
    const content =
      "metadata-driven-моделирование: [[metadata-driven-моделирование]] ии/концепции/metadata-driven-моделирование.md | Подход через YAML-модели";
    const map = parseIndexAnnotations(content);
    expect(map.get("metadata-driven-моделирование")).toBe("Подход через YAML-модели");
  });

  it("handles annotation containing pipe character after first ' | '", () => {
    const content = "Page: [[Page]] domain/cat/page.md | annotation | with | pipes";
    const map = parseIndexAnnotations(content);
    expect(map.get("Page")).toBe("annotation | with | pipes");
  });

  it("old format entries still work alongside new format entries", () => {
    const content = [
      "OldPage: старая аннотация",
      "NewPage: [[NewPage]] domain/cat/new-page.md | новая аннотация",
    ].join("\n");
    const map = parseIndexAnnotations(content);
    expect(map.get("OldPage")).toBe("старая аннотация");
    expect(map.get("NewPage")).toBe("новая аннотация");
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

  it("writes new format when fullPath provided", async () => {
    const { vt, written } = makeVaultTools("");
    await upsertIndexAnnotation(
      vt as unknown as VaultTools,
      "!Wiki/work",
      "NewPage",
      "описание страницы",
      "!Wiki/work/domain/cat/new-page.md",
    );
    expect(written[0]).toBe("NewPage: [[NewPage]] domain/cat/new-page.md | описание страницы");
  });

  it("writes old format when fullPath absent", async () => {
    const { vt, written } = makeVaultTools("");
    await upsertIndexAnnotation(
      vt as unknown as VaultTools,
      "!Wiki/work",
      "Page",
      "аннотация",
    );
    expect(written[0]).toBe("Page: аннотация");
  });

  it("replaces existing entry with new format", async () => {
    const { vt, written } = makeVaultTools("Page: старая аннотация");
    await upsertIndexAnnotation(
      vt as unknown as VaultTools,
      "!Wiki/work",
      "Page",
      "новая аннотация",
      "!Wiki/work/domain/cat/page.md",
    );
    expect(written[0]).toBe("Page: [[Page]] domain/cat/page.md | новая аннотация");
  });

  it("strips wikiFolder prefix from fullPath to produce relative path", async () => {
    const { vt, written } = makeVaultTools("");
    await upsertIndexAnnotation(
      vt as unknown as VaultTools,
      "/abs/vault",
      "MyPage",
      "desc",
      "/abs/vault/sub/folder/my-page.md",
    );
    expect(written[0]).toBe("MyPage: [[MyPage]] sub/folder/my-page.md | desc");
  });
});
