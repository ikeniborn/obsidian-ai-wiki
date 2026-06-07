import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { render } from "../src/phases/template";

const read = (name: string): string => readFileSync(join(__dirname, "../prompts", name), "utf8");

const lintTemplate = read("lint.md");
const ingestTemplate = read("ingest.md");
const ingestEntitiesTemplate = read("ingest-entities.md");

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

describe("extracted prompt files — content + placeholder contract", () => {
  it("vision-structure.md holds the shared structure rules", () => {
    const t = read("vision-structure.md");
    expect(t).toMatch(/Return STRUCTURED markdown/);
    expect(t).not.toContain("{{");
  });

  it("vision-image.md exposes structure_rules + lang", () => {
    const t = read("vision-image.md");
    expect(t).toMatch(/image analyst/);
    expect(t).toContain("{{structure_rules}}");
    expect(t).toContain("{{lang}}");
  });

  it("vision-pdf.md exposes structure_rules + lang", () => {
    const t = read("vision-pdf.md");
    expect(t).toMatch(/document analyst/);
    expect(t).toContain("{{structure_rules}}");
    expect(t).toContain("{{lang}}");
  });

  it("vision-excalidraw.md exposes lang", () => {
    const t = read("vision-excalidraw.md");
    expect(t).toMatch(/Excalidraw/);
    expect(t).toContain("{{lang}}");
  });

  it("lint-actualize.md is the static config-update prompt", () => {
    const t = read("lint-actualize.md");
    expect(t).toMatch(/архитектор wiki-базы знаний/);
    expect(t).toMatch(/Верни ТОЛЬКО валидный JSON/);
    expect(t).not.toContain("{{");
  });

  it("query-seeds.md exposes question/annotated/unindexed/example", () => {
    const t = read("query-seeds.md");
    expect(t).toMatch(/Return JSON only matching this shape/);
    for (const p of ["{{question}}", "{{annotated}}", "{{unindexed}}", "{{example}}"]) expect(t).toContain(p);
  });

  it("query-fix-links.md exposes broken + available", () => {
    const t = read("query-fix-links.md");
    expect(t).toContain("{{broken}}");
    expect(t).toContain("{{available}}");
  });

  it("repair-json.md exposes detail + JSON-only instruction", () => {
    const t = read("repair-json.md");
    expect(t).toContain("{{detail}}");
    expect(t).toMatch(/Return ONLY a single valid JSON object/);
  });

  it("format-restore-tokens.md exposes tokens", () => {
    const t = read("format-restore-tokens.md");
    expect(t).toMatch(/ВОССТАНОВИ ТОКЕНЫ/);
    expect(t).toContain("{{tokens}}");
  });

  it("ingest-fix-paths.md exposes paths", () => {
    const t = read("ingest-fix-paths.md");
    expect(t).toMatch(/4 сегментов/);
    expect(t).toContain("{{paths}}");
  });

  it("render fills every placeholder — no leftover braces", () => {
    const cases: Array<[string, Record<string, string>]> = [
      ["vision-image.md", { structure_rules: "RULES", lang: "L" }],
      ["vision-pdf.md", { structure_rules: "RULES", lang: "L" }],
      ["vision-excalidraw.md", { lang: "L" }],
      ["query-seeds.md", { question: "q", annotated: "a", unindexed: "", example: "{}" }],
      ["query-fix-links.md", { broken: "X", available: "Y" }],
      ["repair-json.md", { detail: "D" }],
      ["format-restore-tokens.md", { tokens: "`t`" }],
      ["ingest-fix-paths.md", { paths: "p" }],
    ];
    for (const [name, vars] of cases) {
      expect(render(read(name), vars)).not.toContain("{{");
    }
  });
});
