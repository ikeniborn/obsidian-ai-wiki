import { describe, it, expect, vi } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";

function makeView() {
  const plugin = {
    controller: {
      loadDomains: vi.fn().mockResolvedValue([]),
      isBusy: vi.fn().mockReturnValue(false),
      currentOp: null,
    },
    localConfigStore: {
      load: vi.fn().mockResolvedValue({ iclaudePath: "" }),
      save: vi.fn().mockResolvedValue(undefined),
    },
    settings: { history: [], historyLimit: 20 },
    app: {},
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null } as any;
  return new LlmWikiView(leaf, plugin);
}

function makeRow() {
  const listeners: Array<[string, EventListener]> = [];
  const els: Array<{ tag: string; opts: any; el: any }> = [];
  const row: any = {
    createSpan: vi.fn(() => ({ setText: vi.fn() })),
    createEl: vi.fn((tag: string, opts?: any) => {
      const el: any = {
        addEventListener: vi.fn((evt: string, cb: EventListener) => listeners.push([`btn:${evt}`, cb])),
      };
      els.push({ tag, opts, el });
      return el;
    }),
    addEventListener: vi.fn((evt: string, cb: EventListener) => listeners.push([`row:${evt}`, cb])),
  };
  return { row, listeners, els };
}

const queryItem = {
  id: "1", operation: "query" as const, args: ["test query"],
  domainId: "ai", startedAt: 0, finishedAt: 100,
  status: "done" as const, finalText: "answer", steps: [],
};

const ingestItem = {
  id: "2", operation: "ingest" as const, args: ["/some/path"],
  domainId: "ai", startedAt: 0, finishedAt: 100,
  status: "done" as const, finalText: "", steps: [],
};

describe("renderHistory — rerun button", () => {
  it("adds ↺ button for query items", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [queryItem];

    const { row, els } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const rerunBtn = els.find((e) => e.opts?.text === "↺");
    expect(rerunBtn).toBeDefined();
  });

  it("does NOT add ↺ button for non-query items", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [ingestItem];

    const { row, els } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const rerunBtn = els.find((e) => e.opts?.text === "↺");
    expect(rerunBtn).toBeUndefined();
  });

  it("↺ click sets domainSelect.value, dispatches change, sets queryInput.value, calls submitQuery", () => {
    const v = makeView();
    (v as any).plugin.settings.history = [queryItem];

    const domainSelect = { value: "", dispatchEvent: vi.fn() };
    const queryInput = { value: "" };
    (v as any).domainSelect = domainSelect;
    (v as any).queryInput = queryInput;
    const submitQuery = vi.spyOn(v as any, "submitQuery").mockImplementation(() => {});

    const { row, listeners } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const btnClick = listeners.find(([evt]) => evt === "btn:click");
    expect(btnClick).toBeDefined();
    const fakeEvent = { stopPropagation: vi.fn() };
    btnClick![1](fakeEvent as any);

    expect(fakeEvent.stopPropagation).toHaveBeenCalled();
    expect(domainSelect.value).toBe("ai");
    expect(domainSelect.dispatchEvent).toHaveBeenCalledWith(expect.any(Object));
    expect(queryInput.value).toBe("test query");
    expect(submitQuery).toHaveBeenCalled();
  });

  it("↺ click uses empty string when domainId is undefined", () => {
    const v = makeView();
    const itemNoDomain = { ...queryItem, domainId: undefined };
    (v as any).plugin.settings.history = [itemNoDomain];

    const domainSelect = { value: "prev", dispatchEvent: vi.fn() };
    (v as any).domainSelect = domainSelect;
    (v as any).queryInput = { value: "" };
    vi.spyOn(v as any, "submitQuery").mockImplementation(() => {});

    const { row, listeners } = makeRow();
    (v as any).historyEl = { empty: vi.fn(), createDiv: vi.fn(() => row) };
    (v as any).historySection = { removeClass: vi.fn(), addClass: vi.fn() };

    (v as any).renderHistory();

    const btnClick = listeners.find(([evt]) => evt === "btn:click");
    btnClick![1]({ stopPropagation: vi.fn() } as any);

    expect(domainSelect.value).toBe("");
  });
});
