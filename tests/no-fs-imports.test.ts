import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MOBILE_HOT_PATH_FILES = [
  "src/phases/query.ts",
  "src/main.ts",
];

describe("mobile hot path: no top-level node:* imports", () => {
  for (const f of MOBILE_HOT_PATH_FILES) {
    it(`${f} has no top-level node:* import`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf-8");
      const lines = src.split("\n");
      const offending = lines.filter((l) => /^import\s.*from\s+["']node:/.test(l));
      expect(offending, `Found node:* top-level import in ${f}: ${offending.join(", ")}`).toEqual([]);
    });
  }
});

describe("mobile hot path: controller/agent-runner have no top-level node:* imports", () => {
  // controller and agent-runner may use dynamic imports inside methods;
  // this test catches regressions where someone re-adds a top-level import.
  for (const f of ["src/controller.ts", "src/agent-runner.ts"]) {
    it(`${f} has no top-level node:* import`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf-8");
      const lines = src.split("\n");
      const offending = lines.filter((l) => /^import\s.*from\s+["']node:/.test(l));
      expect(offending).toEqual([]);
    });
  }
});

describe("settings.ts: no child_process spawn", () => {
  it("settings.ts does not import from child_process", () => {
    const src = readFileSync(join(process.cwd(), "src/settings.ts"), "utf-8");
    const lines = src.split("\n");
    const offending = lines.filter((l) => /^import\s.*from\s+["']child_process["']/.test(l));
    expect(offending, `settings.ts imports from child_process: ${offending.join(", ")}`).toEqual([]);
  });
});
