import { describe, it, expect, vi } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";

function makePlugin(lastDomain?: string) {
  return {
    controller: {
      loadDomains: vi.fn().mockResolvedValue([
        { id: "ai", name: "AI", wiki_folder: "wiki/ai" },
        { id: "db", name: "DB", wiki_folder: "wiki/db" },
      ]),
      isBusy: vi.fn().mockReturnValue(false),
      currentOp: null,
    },
    localConfigStore: {
      load: vi.fn().mockResolvedValue({ iclaudePath: "", lastDomain }),
      save: vi.fn().mockResolvedValue(undefined),
    },
    settings: { history: [], historyLimit: 20 },
    app: { workspace: { on: vi.fn().mockReturnValue({}), getActiveFile: vi.fn().mockReturnValue(null) } },
  } as unknown as LlmWikiPlugin;
}

function makeView(lastDomain?: string) {
  const plugin = makePlugin(lastDomain);
  const leaf = { view: null } as any;
  return { v: new LlmWikiView(leaf, plugin), plugin };
}

describe("buildDomainRow — save lastDomain on change", () => {
  it("change listener calls localConfigStore.save with domainSelect value", () => {
    const { v, plugin } = makeView();

    const saveListeners: EventListener[] = [];
    const domainSelect: any = {
      value: "ai",
      createEl: vi.fn(() => ({})),
      empty: vi.fn(),
      options: [],
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn((evt: string, cb: EventListener) => {
        if (evt === "change") saveListeners.push(cb);
      }),
    };
    (v as any).domainSelect = domainSelect;

    const domainRow: any = {
      createSpan: vi.fn(() => ({})),
      createEl: vi.fn((tag: string, opts?: any) => {
        if (tag === "select") return domainSelect;
        const el: any = { addEventListener: vi.fn(), disabled: false };
        return el;
      }),
      addEventListener: vi.fn(),
    };
    const parent: any = {
      createDiv: vi.fn(() => ({
        createDiv: vi.fn(() => domainRow),
      })),
    };

    (v as any).buildDomainRow(parent, { withActions: false });

    // Trigger all change listeners captured by domainSelect.addEventListener
    domainSelect.value = "db";
    saveListeners.forEach((cb) => cb(new Event("change")));

    expect(plugin.localConfigStore.save).toHaveBeenCalledWith({ lastDomain: "db" });
  });
});

describe("refreshDomains — restore lastDomain", () => {
  it("restores lastDomain from localConfigStore when domainSelect.value is empty", async () => {
    const { v, plugin } = makeView("db");

    // Simulate options array with real value-matching
    const options = [
      { value: "" },
      { value: "ai" },
      { value: "db" },
    ];
    const domainSelect: any = {
      value: "",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("db");
  });

  it("does NOT override existing selection with lastDomain", async () => {
    const { v, plugin } = makeView("db");

    const options = [
      { value: "" },
      { value: "ai" },
      { value: "db" },
    ];
    const domainSelect: any = {
      value: "ai",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("ai");
  });

  it("does not restore lastDomain if domain no longer exists", async () => {
    const { v, plugin } = makeView("deleted-domain");

    const options = [
      { value: "" },
      { value: "ai" },
    ];
    const domainSelect: any = {
      value: "",
      empty: vi.fn(),
      createEl: vi.fn(() => ({})),
      options,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };
    (v as any).domainSelect = domainSelect;
    (v as any).domains = [];

    await (v as any).refreshDomains();

    expect(domainSelect.value).toBe("");
  });
});
