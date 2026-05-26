import { describe, it, expect } from "vitest";
import { LintChatSchema, WikiPageSchema } from "../src/phases/zod-schemas";

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

  it("accepts pages with annotation field", () => {
    const input = {
      summary: "done",
      pages: [{ path: "a/B.md", content: "# B", annotation: "описание страницы" }],
    };
    const result = LintChatSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.pages[0].annotation).toBe("описание страницы");
  });

  it("accepts pages without annotation (optional)", () => {
    const input = { summary: "done", pages: [{ path: "a/B.md", content: "# B" }] };
    expect(LintChatSchema.safeParse(input).success).toBe(true);
  });
});

describe("WikiPageSchema superRefine", () => {
  it("rejects alias links", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[Other|alias]].",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("aliases not allowed");
  });

  it("rejects path links", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[folder/page]].",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("WikiLink with path");
  });

  it("accepts clean content", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[OtherPage]].",
    });
    expect(result.success).toBe(true);
  });
});
