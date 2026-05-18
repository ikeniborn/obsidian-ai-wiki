import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("lint.md prompt", () => {
  it("does not instruct LLM to return JSON", () => {
    const content = readFileSync(join(__dirname, "../prompts/lint.md"), "utf8");
    expect(content).not.toMatch(/Верни \*\*JSON\*\*/);
    expect(content).toMatch(/Markdown/i);
  });
});
