import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const lintTemplate = readFileSync(join(__dirname, "../prompts/lint.md"), "utf8");
const ingestTemplate = readFileSync(join(__dirname, "../prompts/ingest.md"), "utf8");
const ingestEntitiesTemplate = readFileSync(join(__dirname, "../prompts/ingest-entities.md"), "utf8");

describe("lint.md prompt", () => {
  it("instructs LLM to return JSON with required fields", () => {
    expect(lintTemplate).toMatch(/Верни ТОЛЬКО JSON/);
    expect(lintTemplate).toMatch(/"reasoning"/);
    expect(lintTemplate).toMatch(/"report"/);
    expect(lintTemplate).toMatch(/"fixes"/);
  });
});

describe("prompts/ingest-entities.md", () => {
  it("contains the required template placeholders", () => {
    expect(ingestEntitiesTemplate).toContain("{{domain_name}}");
    expect(ingestEntitiesTemplate).toContain("{{entity_types_block}}");
    expect(ingestEntitiesTemplate).toContain("{{lang_notes}}");
  });

  it("instructs the model to return JSON with reasoning + entities", () => {
    expect(ingestEntitiesTemplate).toMatch(/reasoning/);
    expect(ingestEntitiesTemplate).toMatch(/entities/);
    expect(ingestEntitiesTemplate).toMatch(/name/);
  });
});

describe("prompts/ingest.md — merge block", () => {
  it("instructs the model how to express merges via pages + deletes", () => {
    expect(ingestTemplate).toMatch(/ОБЪЕДИНЕНИЕ ДУБЛИКАТОВ/);
    expect(ingestTemplate).toMatch(/deletes/);
  });
});

describe("prompts/ingest.md — source-stem collision rule", () => {
  it("forbids wiki page name colliding with source stem", () => {
    expect(ingestTemplate).toMatch(/НЕ должно совпадать с именем текущего источника/);
    expect(ingestTemplate).toContain("{{source_stem}}");
  });
});

describe("prompts/ingest.md — wiki stem prefix mask", () => {
  it("declares the wiki_<domain>_<entity> mask rule", () => {
    expect(ingestTemplate).toMatch(/wiki_\{\{domain_id\}\}_<entity_slug>/);
    expect(ingestTemplate).toContain("{{domain_id}}");
  });

  it("includes the forbidden-stems placeholder", () => {
    expect(ingestTemplate).toContain("{{forbidden_stems_block}}");
    expect(ingestTemplate).toMatch(/ЗАПРЕЩЁННЫЕ ИМЕНА/);
  });
});
