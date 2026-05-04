import { describe, it, expect } from "vitest";
import { render } from "../src/phases/template";

describe("render", () => {
  it("substitutes known variables", () => {
    expect(render("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("leaves unknown placeholders as-is", () => {
    expect(render("Hello {{unknown}}!", {})).toBe("Hello {{unknown}}!");
  });

  it("handles multiple occurrences of same variable", () => {
    expect(render("{{x}} and {{x}}", { x: "A" })).toBe("A and A");
  });

  it("handles empty template", () => {
    expect(render("", { x: "A" })).toBe("");
  });

  it("does not replace partial-match patterns", () => {
    expect(render("{{ name }}", { name: "X" })).toBe("{{ name }}");
  });
});
