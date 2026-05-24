import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("lint.md prompt", () => {
  it("instructs LLM to return JSON with required fields", () => {
    const content = readFileSync(join(__dirname, "../prompts/lint.md"), "utf8");
    expect(content).toMatch(/Верни ТОЛЬКО JSON/);
    expect(content).toMatch(/"reasoning"/);
    expect(content).toMatch(/"report"/);
    expect(content).toMatch(/"fixes"/);
  });
});
