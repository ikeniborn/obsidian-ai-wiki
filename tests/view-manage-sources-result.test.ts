// tests/view-manage-sources-result.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmWikiView } from "../src/view";
import type LlmWikiPlugin from "../src/main";
import type { DomainEntry } from "../src/domain";
import { __clearNotices, __getNotices } from "obsidian";
import { ConfirmModal, IngestScopeModal } from "../src/modals";

// Captured onConfirm from the most-recently opened ConfirmModal
let lastOnConfirm: (() => Promise<void>) | null = null;

vi.mock("../src/modals", () => ({
  ConfirmModal: vi.fn().mockImplementation(
    function (_app: any, _title: string, _lines: string[], onConfirm: () => Promise<void>) {
      return { open: vi.fn(() => { lastOnConfirm = onConfirm; }) };
    },
  ),
  IngestScopeModal: vi.fn().mockImplementation(
    function (_app: any, _added: number, _total: number, _onChoice: (s: string) => void) {
      return { open: vi.fn() };
    },
  ),
  ManageSourcesModal: vi.fn(),
  AddDomainModal: vi.fn(),
  BusyCloseModal: vi.fn(),
}));

vi.mock("../src/utils/vault-walk", () => ({
  collectMdInPaths: vi.fn().mockReturnValue([]),
  walkFolder: vi.fn().mockReturnValue([]),
}));

const BASE_DOMAIN: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/src1", "/home/src2"],
  entity_types: [],
  language_notes: "",
};

function makeController() {
  return {
    updateDomainSources: vi.fn().mockResolvedValue(undefined),
    cleanupRemovedSources: vi.fn().mockResolvedValue(0),
    init: vi.fn().mockResolvedValue(undefined),
    cwdOrEmpty: vi.fn().mockReturnValue(""),
    loadDomains: vi.fn().mockResolvedValue([BASE_DOMAIN]),
    isBusy: vi.fn().mockReturnValue(false),
    currentOp: null,
  };
}

function makeView(ctrl: ReturnType<typeof makeController>) {
  const appMock = { vault: { getFolderByPath: vi.fn().mockReturnValue(null) } };
  const plugin = {
    controller: ctrl,
    settings: { history: [], historyLimit: 20 },
    app: appMock,
  } as unknown as LlmWikiPlugin;
  const leaf = { view: null, app: appMock } as any;
  return new LlmWikiView(leaf, plugin);
}

describe("handleManageSourcesResult", () => {
  let ctrl: ReturnType<typeof makeController>;
  let view: LlmWikiView;

  beforeEach(() => {
    vi.clearAllMocks();
    lastOnConfirm = null;
    __clearNotices();
    ctrl = makeController();
    view = makeView(ctrl);
  });

  it("Branch 1 — shows ConfirmModal when source removed and paths remain", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).toHaveBeenCalledTimes(1);
    expect(ctrl.updateDomainSources).not.toHaveBeenCalled();
  });

  it("Branch 1 confirm — saves, cleans up, reinits with remaining paths in order", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    ctrl.cleanupRemovedSources.mockResolvedValue(1);
    await (view as any).handleManageSourcesResult(original, result);
    expect(lastOnConfirm).not.toBeNull();
    await lastOnConfirm!();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", ["/home/src1"]);
    expect(ctrl.cleanupRemovedSources).toHaveBeenCalledWith("ai", ["/home/src2"]);
    expect(ctrl.init).toHaveBeenCalledWith("ai", false, ["/home/src1"], true);
    expect(__getNotices()).toContain("Удалено статей: 1");
    // updateDomainSources must be called before cleanupRemovedSources
    const updateOrder = ctrl.updateDomainSources.mock.invocationCallOrder[0];
    const cleanupOrder = ctrl.cleanupRemovedSources.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(cleanupOrder);
    // cleanupRemovedSources must be called before init
    const initOrder = ctrl.init.mock.invocationCallOrder[0];
    expect(cleanupOrder).toBeLessThan(initOrder);
  });

  it("Branch 1 cancel — nothing saved when user dismisses", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1"] }; // src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    // don't invoke lastOnConfirm — simulates cancel
    expect(ctrl.updateDomainSources).not.toHaveBeenCalled();
    expect(ctrl.cleanupRemovedSources).not.toHaveBeenCalled();
    expect(ctrl.init).not.toHaveBeenCalled();
  });

  it("Branch 2 — removes all sources: saves + cleans immediately, no confirm, no init", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: [] }; // both removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).not.toHaveBeenCalled();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", []);
    expect(ctrl.cleanupRemovedSources).toHaveBeenCalledWith("ai", ["/home/src1", "/home/src2"]);
    expect(ctrl.init).not.toHaveBeenCalled();
    expect(__getNotices()).not.toContain("Удалено статей:");
  });

  it("Branch 3 — add only: saves + shows IngestScopeModal, no confirm", async () => {
    const original = { ...BASE_DOMAIN, source_paths: ["/home/src1"] };
    const result = { sourcePaths: ["/home/src1", "/home/src3"] }; // src3 added
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).not.toHaveBeenCalled();
    expect(ctrl.updateDomainSources).toHaveBeenCalledWith("ai", ["/home/src1", "/home/src3"]);
    expect(IngestScopeModal).toHaveBeenCalledTimes(1);
  });

  it("Branch 1 — add+remove simultaneously: confirm path, not IngestScopeModal", async () => {
    const original = { ...BASE_DOMAIN };
    const result = { sourcePaths: ["/home/src1", "/home/src3"] }; // src3 added, src2 removed
    await (view as any).handleManageSourcesResult(original, result);
    expect(ConfirmModal).toHaveBeenCalledTimes(1);
    expect(IngestScopeModal).not.toHaveBeenCalled();
  });
});
