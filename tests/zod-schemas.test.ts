import { describe, it, expect } from "vitest";
import { LintChatSchema } from "../src/phases/zod-schemas";

describe("LintChatSchema", () => {
  it("parses valid response with pages", () => {
    const result = LintChatSchema.parse({
      summary: "## Исправлено\n- Убрана мёртвая ссылка",
      pages: [{ path: "Wiki/X.md", content: "# X\ncontent" }],
    });
    expect(result.summary).toBe("## Исправлено\n- Убрана мёртвая ссылка");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].path).toBe("Wiki/X.md");
  });

  it("defaults pages to empty array when omitted", () => {
    const result = LintChatSchema.parse({ summary: "Нет правок." });
    expect(result.pages).toEqual([]);
  });

  it("rejects missing summary", () => {
    expect(() => LintChatSchema.parse({ pages: [] })).toThrow();
  });
});
