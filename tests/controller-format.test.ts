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
    manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
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

  it("файл внутри wiki-домена — НЕ диспатчит, открывает ConfirmModal", async () => {
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
    (app.vault.adapter.read as ReturnType<typeof vi.fn>).mockResolvedValueOnce("ОТФОРМАТИРОВАНО");
    await ctrl.formatApply();
    expect(app.vault.adapter.write).toHaveBeenCalledWith("x.md", "ОТФОРМАТИРОВАНО");
    expect(app.vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
    expect((ctrl as unknown as { _pendingFormat: unknown })._pendingFormat).toBeNull();
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
});
