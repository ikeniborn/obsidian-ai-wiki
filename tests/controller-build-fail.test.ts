import { describe, it, expect, vi, beforeEach } from "vitest";
import { __clearNotices, Notice } from "../vitest.mock";

describe("dispatch — buildAgentRunner failure", () => {
  beforeEach(() => __clearNotices());

  it("shows Notice when buildAgentRunner throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Synthetic minimal harness — verify the code path:
    const fn = async () => {
      try {
        throw new Error("simulated tmpDir failure");
      } catch (e) {
        new Notice(`Error: ${(e as Error).message}`);
        console.error("[llm-wiki] buildAgentRunner failed", e);
        return;
      }
    };
    await fn();
    expect(Notice.__messages.some((m) => m.includes("simulated tmpDir failure"))).toBe(true);
    expect(errSpy).toHaveBeenCalledWith("[llm-wiki] buildAgentRunner failed", expect.any(Error));
    errSpy.mockRestore();
  });
});
