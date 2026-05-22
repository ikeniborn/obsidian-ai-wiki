import { describe, it, expect, vi } from "vitest";
import { IngestScopeModal } from "../src/modals";

describe("IngestScopeModal", () => {
  it("calls onChoice('new') when pickNew is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("new");
    expect(onChoice).toHaveBeenCalledWith("new");
  });

  it("calls onChoice('all') when pickAll is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("all");
    expect(onChoice).toHaveBeenCalledWith("all");
  });

  it("calls onChoice('skip') when pickSkip is called", () => {
    const onChoice = vi.fn();
    const m = new IngestScopeModal({} as any, 2, 5, onChoice);
    (m as any).pick("skip");
    expect(onChoice).toHaveBeenCalledWith("skip");
  });

  it("stores addedCount and totalCount", () => {
    const m = new IngestScopeModal({} as any, 3, 7, vi.fn());
    expect((m as any).addedCount).toBe(3);
    expect((m as any).totalCount).toBe(7);
  });
});
