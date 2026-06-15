import { describe, it, expect } from "vitest";
import { formatTable } from "../scripts/eval-report";
import type { Snapshot } from "../scripts/eval-report";

const snap: Snapshot = {
  vault: "/v",
  k: [3, 5, 8],
  configs: [
    {
      name: "dense",
      seed: { recall: { 3: 0.5, 5: 0.6, 8: 0.7 }, mrr: 0.4 },
      union: { recall: { 3: 0.55, 5: 0.65, 8: 0.75 }, mrr: 0.45 },
    },
  ],
};

// @lat: [[tests#Retrieval Eval Harness#Report table renders metrics and baseline deltas]]
describe("formatTable", () => {
  it("renders a header and one row per config with all 8 metric cells", () => {
    const out = formatTable(snap);
    expect(out).toContain("sR@3");
    expect(out).toContain("uMRR");
    expect(out).toContain("dense");
    expect(out).toContain("0.500"); // sR@3
    expect(out).toContain("0.750"); // uR@8
  });

  it("annotates deltas against a baseline", () => {
    const baseline: Snapshot = {
      ...snap,
      configs: [
        {
          name: "dense",
          seed: { recall: { 3: 0.4, 5: 0.6, 8: 0.7 }, mrr: 0.4 },
          union: { recall: { 3: 0.55, 5: 0.65, 8: 0.75 }, mrr: 0.45 },
        },
      ],
    };
    const out = formatTable(snap, baseline);
    expect(out).toContain("▲"); // sR@3 went 0.4 → 0.5
    expect(out).toMatch(/\+0\.100/);
  });
});
