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
    settings: { history: [], historyLimit: 20 },
    app: {},
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null } as any;
  const v = new LlmWikiView(leaf, plugin);
  return v;
}

describe("LlmWikiView addSourceBtn disabled state", () => {
  it("addSourceBtn is undefined initially (before buildDomainRow)", () => {
    const v = makeView();
    expect((v as any).addSourceBtn).toBeUndefined();
  });

  it("setRunning disables addSourceBtn when it exists", () => {
    const v = makeView();
    const btn = { disabled: false } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    // also set required fields that setRunning touches
    (v as any).state = "idle";
    (v as any).stepsEl = { empty: vi.fn(), removeClass: vi.fn(), addClass: vi.fn(), scrollTop: 0, scrollHeight: 0 };
    (v as any).finalEl = { empty: vi.fn() };
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: false };
    (v as any).askBtn = { disabled: false };
    (v as any).askSaveBtn = { disabled: false };
    (v as any).progressToggle = { setText: vi.fn() };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).liveStatusSection = { removeClass: vi.fn() };
    (v as any).liveStatusIconEl = { setText: vi.fn() };
    (v as any).liveStatusTextEl = { setText: vi.fn() };

    v.setRunning("ingest", []);
    expect(btn.disabled).toBe(true);
  });

  it("finish re-enables addSourceBtn when domainSelect has a value", async () => {
    const v = makeView();
    const btn = { disabled: true } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    const select = { value: "ai" } as HTMLSelectElement;
    (v as any).domainSelect = select;

    const entry = {
      id: "1", operation: "ingest" as const, args: [],
      startedAt: 0, finishedAt: 100, status: "done" as const, finalText: "",
      steps: [],
    };
    (v as any).state = "running";
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: true };
    (v as any).askBtn = { disabled: true };
    (v as any).askSaveBtn = { disabled: true };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn(), removeClass: vi.fn(), createDiv: vi.fn() };
    (v as any).resultToggle = { setText: vi.fn() };
    (v as any).historyEl = { empty: vi.fn() };
    (v as any).historySection = { addClass: vi.fn(), removeClass: vi.fn() };
    (v as any).liveStatusSection = { addClass: vi.fn() };
    (v as any).stepsEl = { addClass: vi.fn() };
    (v as any).progressToggle = { setText: vi.fn() };
    (v as any).tickHandle = null;

    await v.finish(entry);
    expect(btn.disabled).toBe(false);
  });

  it("finish keeps addSourceBtn disabled when domainSelect has no value", async () => {
    const v = makeView();
    const btn = { disabled: true } as HTMLButtonElement;
    (v as any).addSourceBtn = btn;
    const select = { value: "" } as HTMLSelectElement;
    (v as any).domainSelect = select;

    const entry = {
      id: "1", operation: "ingest" as const, args: [],
      startedAt: 0, finishedAt: 100, status: "done" as const, finalText: "",
      steps: [],
    };
    (v as any).state = "running";
    (v as any).statusEl = { setText: vi.fn() };
    (v as any).cancelBtn = { disabled: true };
    (v as any).askBtn = { disabled: true };
    (v as any).askSaveBtn = { disabled: true };
    (v as any).progressCount = { setText: vi.fn() };
    (v as any).resultSpeedEl = { setText: vi.fn() };
    (v as any).finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    (v as any).resultSection = { addClass: vi.fn(), removeClass: vi.fn(), createDiv: vi.fn() };
    (v as any).resultToggle = { setText: vi.fn() };
    (v as any).historyEl = { empty: vi.fn() };
    (v as any).historySection = { addClass: vi.fn(), removeClass: vi.fn() };
    (v as any).liveStatusSection = { addClass: vi.fn() };
    (v as any).stepsEl = { addClass: vi.fn() };
    (v as any).progressToggle = { setText: vi.fn() };
    (v as any).tickHandle = null;

    await v.finish(entry);
    expect(btn.disabled).toBe(true);
  });
});
