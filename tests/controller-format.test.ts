import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setPlatformMobile, __clearNotices, Notice } from "obsidian";
import { WikiController } from "../src/controller";
import type { DomainEntry } from "../src/domain";

function makeApp(activeFile: { path: string; extension?: string; name?: string } | null = { path: "notes/x.md", extension: "md", name: "x.md" }) {
  return {
    vault: {
      adapter: {
        getBasePath: () => "/tmp/vault",
        getFullPath: (p: string) => `/tmp/vault/${p}`,
        read: vi.fn().mockResolvedValue(""),
        write: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
      },
      configDir: ".obsidian",
      getName: () => "vault",
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      modify: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue(activeFile),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makePlugin(app: ReturnType<typeof makeApp>) {
  return {
    settings: { backend: "native-agent", nativeAgent: { baseUrl: "https://api.x", apiKey: "k" } },
    saveSettings: vi.fn(),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app,
  } as unknown as Parameters<typeof WikiController>[1];
}

function makeDomainStore(domains: DomainEntry[] = []) {
  return { load: vi.fn().mockResolvedValue(domains), save: vi.fn() } as unknown as Parameters<typeof WikiController>[2];
}

function makeLocalConfigStore() {
  return { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as unknown as Parameters<typeof WikiController>[3];
}

function build(activeFile: ReturnType<typeof makeApp>["workspace"]["getActiveFile"] extends () => infer R ? R : never = { path: "notes/x.md", extension: "md", name: "x.md" }, domains: DomainEntry[] = []) {
  const app = makeApp(activeFile);
  const plugin = makePlugin(app);
  const ctrl = new WikiController(app, plugin, makeDomainStore(domains), makeLocalConfigStore());
  const dispatchSpy = vi.spyOn(ctrl as unknown as { dispatch: (...a: unknown[]) => Promise<void> }, "dispatch")
    .mockResolvedValue(undefined);
  return { ctrl, app, plugin, dispatchSpy };
}

describe("WikiController format()", () => {
  beforeEach(() => {
    __setPlatformMobile(false);
    __clearNotices();
  });

  it("Notice если нет активного файла", async () => {
    const { ctrl } = build(null);
    await ctrl.format();
    expect(Notice.__messages.length).toBeGreaterThan(0);
  });

  it("Notice если файл не markdown", async () => {
    const { ctrl } = build({ path: "x.txt", extension: "txt", name: "x.txt" });
    await ctrl.format();
    expect(Notice.__messages.some((m) => m.toLowerCase().includes("markdown"))).toBe(true);
  });

  it("файл вне wiki — диспатчит format", async () => {
    const { ctrl, dispatchSpy } = build({ path: "notes/x.md", extension: "md", name: "x.md" }, []);
    await ctrl.format();
    expect(dispatchSpy).toHaveBeenCalledWith("format", ["notes/x.md"]);
  });

  it("файл внутри wiki-домена — НЕ диспатчит (InfoModal), не вызывает ingest", async () => {
    const domain: DomainEntry = { id: "ai", name: "AI", wiki_folder: "ии", source_paths: [], entity_types: [], language_notes: "" };
    const { ctrl, dispatchSpy } = build({ path: "!Wiki/ии/note.md", extension: "md", name: "note.md" }, [domain]);
    await ctrl.format();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("WikiController formatApply / formatCancel / formatRefine", () => {
  beforeEach(() => {
    __setPlatformMobile(false);
    __clearNotices();
  });

  it("formatApply переносит content из temp в оригинал, удаляет temp", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    // First read: original (no wiki fields) → patch is no-op
    // Second read: temp (formatted content)
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("ОТФОРМАТИРОВАНО");
    await ctrl.formatApply(false);
    expect(app.vault.adapter.write).toHaveBeenCalledWith("x.md", "ОТФОРМАТИРОВАНО");
    expect(app.vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
    expect((ctrl as unknown as { _pendingFormat: unknown })._pendingFormat).toBeNull();
  });

  it("formatApply(replace) сохраняет wiki_* поля из оригинала", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = [
      "---",
      "wiki_added: 2026-01-01",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[AI]]"',
      "---",
      "Старый текст",
    ].join("\n");
    const formatted = "---\ntags:\n  - note\n---\nНовый текст";
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain("wiki_updated: 2026-05-01");
    expect(written).toContain("wiki_added: 2026-01-01");
    expect(written).toContain("[[AI]]");
    expect(written).toContain("Новый текст");
  });

  it("formatApply(replace) без wiki_* в оригинале — контент без изменений", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = "---\ntags:\n  - note\n---\nОригинал";
    const formatted = "---\ntags:\n  - note\n---\nОтформатировано";
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    expect(app.vault.adapter.write).toHaveBeenCalledWith("x.md", formatted);
  });

  it("formatApply(keepOld) сохраняет wiki_* поля (fallback read+write+remove)", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    (app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const original = [
      "---",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[AI]]"',
      "---",
      "Старый",
    ].join("\n");
    const formatted = "---\ntags:\n  - note\n---\nНовый";
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)   // p.originalPath
      .mockResolvedValueOnce(formatted); // p.tempPath
    await ctrl.formatApply(true);
    const writeCalls = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const toOriginal = writeCalls.find(([path]) => path === "x.md");
    expect(toOriginal?.[1]).toContain("wiki_updated: 2026-05-01");
    expect(toOriginal?.[1]).toContain("[[AI]]");
    expect(toOriginal?.[1]).toContain("Новый");
    // deprecated file gets the unmodified original
    const toDeprecated = writeCalls.find(([path]) => path === "x.deprecated.md");
    expect(toDeprecated?.[1]).toBe(original);
  });

  it("formatCancel удаляет temp без изменения оригинала", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    await ctrl.formatCancel();
    expect(app.vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
    expect(app.vault.adapter.write).not.toHaveBeenCalledWith("x.md", expect.anything());
    expect((ctrl as unknown as { _pendingFormat: unknown })._pendingFormat).toBeNull();
  });

  it("formatApply без _pendingFormat — Notice + no-op", async () => {
    const { ctrl, app } = build();
    await ctrl.formatApply();
    expect(app.vault.adapter.write).not.toHaveBeenCalled();
    expect(Notice.__messages.length).toBeGreaterThan(0);
  });

  it("formatRefine добавляет user в chat и редиспатчит format", async () => {
    const { ctrl, dispatchSpy } = build();
    (ctrl as unknown as { _pendingFormat: { originalPath: string; tempPath: string; chat: Array<{ role: string; content: string }> } })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    await ctrl.formatRefine("сделай таблицу");
    const pending = (ctrl as unknown as { _pendingFormat: { chat: Array<{ role: string; content: string }> } })._pendingFormat;
    expect(pending.chat).toEqual([{ role: "user", content: "сделай таблицу" }]);
    expect(dispatchSpy).toHaveBeenCalledWith("format", ["x.md"]);
  });

  // @lat: [[tests#Controller Format Cleanup#formatApply strips forbidden wiki fields]]
  it("formatApply strips forbidden wiki_* fields (e.g. wiki_outgoing_links) added by LLM", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = [
      "---",
      "wiki_added: 2026-01-01",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[wiki_health]]"',
      "---",
      "Old",
    ].join("\n");
    // LLM output includes a forbidden wiki_outgoing_links field
    const formatted = [
      "---",
      "tags:",
      "  - note",
      "wiki_outgoing_links:",
      '  - "[[wiki_other]]"',
      "---",
      "New",
    ].join("\n");
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).not.toContain("wiki_outgoing_links:");
    expect(written).toContain("wiki_updated: 2026-05-01");
    expect(written).toContain("[[wiki_health]]");
    expect(written).toContain("New");
  });

  // @lat: [[tests#Controller Format Cleanup#formatApply strips path-style wiki_articles entries]]
  it("formatApply strips path-style entries from wiki_articles", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = [
      "---",
      "wiki_added: 2026-01-01",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[wiki_health]]"',
      '  - "[[!Wiki/health/procedures/file.md]]"',
      "---",
      "Old",
    ].join("\n");
    const formatted = "---\ntags:\n  - note\n---\nNew";
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain("[[wiki_health]]");
    expect(written).not.toContain("[[!Wiki/health/procedures/file.md]]");
  });
});
