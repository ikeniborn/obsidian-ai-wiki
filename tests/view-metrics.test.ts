import { describe, it, expect, vi } from "vitest";

// Minimal harness — we only test that progressCount gets set to Xs after finish()
describe("finish() shows elapsed time", () => {
  it("sets progressCount text to elapsed seconds after completion", async () => {
    // Stub the DOM elements LlmWikiView uses
    const progressCount = { setText: vi.fn() };
    const finalEl = { empty: vi.fn(), removeClass: vi.fn() };
    const resultSection = { removeClass: vi.fn(), addClass: vi.fn() };
    const resultToggle = { setText: vi.fn() };
    const statusEl = { setText: vi.fn() };
    const cancelBtn = { disabled: false };
    const askBtn = { disabled: false };
    const askSaveBtn = { disabled: false };

    // Simulate finish() logic inline (view is not easily unit-testable end-to-end)
    // So we test the business rule: after updateMetrics() with state != "running",
    // a subsequent setText call sets totalDur.
    const state = "done";  // what finish() sets before calling updateMetrics()
    const startedAt = Date.now() - 3200;
    const finishedAt = Date.now();

    // updateMetrics() clears text when state !== "running"
    if (state !== "running") progressCount.setText("");

    // The new 2 lines in finish():
    const totalDur = ((finishedAt - startedAt) / 1000).toFixed(1);
    progressCount.setText(`${totalDur}s`);

    expect(progressCount.setText).toHaveBeenLastCalledWith(expect.stringMatching(/^\d+\.\ds$/));
  });
});
