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

describe("prompts/ingest-entities.md", () => {
  it("contains the required template placeholders", () => {
    const content = readFileSync(join(__dirname, "../prompts/ingest-entities.md"), "utf8");
    expect(content).toContain("{{domain_name}}");
    expect(content).toContain("{{entity_types_block}}");
    expect(content).toContain("{{lang_notes}}");
  });

  it("instructs the model to return JSON with reasoning + entities", () => {
    const content = readFileSync(join(__dirname, "../prompts/ingest-entities.md"), "utf8");
    expect(content).toMatch(/reasoning/);
    expect(content).toMatch(/entities/);
    expect(content).toMatch(/name/);
  });
});
