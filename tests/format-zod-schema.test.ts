import { describe, it, expect } from "vitest";
import { FormatOutputSchema, FormatWithVisionSchema, FormatBaseSchema } from "../src/phases/zod-schemas";

const goodFormatted = "---\ntags: []\n---\n\n# Page content here.";

describe("FormatOutputSchema — base", () => {
  it("rejects empty report", () => {
    const result = FormatOutputSchema.safeParse({ report: "", formatted: goodFormatted });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("report");
  });

  it("rejects formatted shorter than 10 chars", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok", formatted: "---\nX" });
    expect(result.success).toBe(false);
  });

  it("superRefine: formatted without frontmatter → error", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok", formatted: "# Page\nno frontmatter" });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("frontmatter");
  });

  it("accepts valid base output", () => {
    const result = FormatOutputSchema.safeParse({ report: "- added tags", formatted: goodFormatted });
    expect(result.success).toBe(true);
  });
});

describe("FormatOutputSchema — vision", () => {
  it("vision variant: missing embed → error with path", () => {
    const result = FormatWithVisionSchema.safeParse({
      report: "ok",
      formatted: goodFormatted,
      vision_blocks_count: 1,
      embeds_preserved: ["img/photo.png"],
    });
    expect(result.success).toBe(false);
    const msgs = JSON.stringify(result.error?.issues);
    expect(msgs).toContain("img/photo.png");
    expect(msgs).toContain("потерян");
  });

  it("vision variant: embed present → passes", () => {
    const fmtWithEmbed = `${goodFormatted}\n\n![[img/photo.png]]\n\n| col1 | col2 |\n|---|---|\n| a | b |`;
    const result = FormatWithVisionSchema.safeParse({
      report: "ok",
      formatted: fmtWithEmbed,
      vision_blocks_count: 1,
      embeds_preserved: ["img/photo.png"],
    });
    expect(result.success).toBe(true);
  });

  it("vision variant requires vision_blocks_count and embeds_preserved", () => {
    const result = FormatWithVisionSchema.safeParse({ report: "ok", formatted: goodFormatted });
    expect(result.success).toBe(false);
  });
});
