import { describe, it, expect } from "vitest";
import {
  extractAnswerLinks,
  findBrokenLinks,
  annotateBroken,
} from "../src/phases/query-link-validator";

describe("extractAnswerLinks", () => {
  it("extracts [[X]] from markdown", () => {
    const links = extractAnswerLinks("Смотри [[Костный бульон]] и [[Харчо]].");
    expect(links).toEqual(["Костный бульон", "Харчо"]);
  });

  it("ignores [[X|alias]]", () => {
    const links = extractAnswerLinks("[[Борщ|рецепт борща]]");
    expect(links).toHaveLength(0);
  });

  it("ignores [[path/X]]", () => {
    const links = extractAnswerLinks("[[folder/Page]]");
    expect(links).toHaveLength(0);
  });

  it("ignores [[#anchor]]", () => {
    const links = extractAnswerLinks("[[#Раздел]]");
    expect(links).toHaveLength(0);
  });
});

describe("findBrokenLinks", () => {
  it("returns only stems absent in knownStems", () => {
    const known = new Set(["Борщ", "Щи"]);
    expect(findBrokenLinks(["Борщ", "Харчо"], known)).toEqual(["Харчо"]);
  });

  it("deduplicates broken links", () => {
    const known = new Set(["Борщ"]);
    expect(findBrokenLinks(["Харчо", "Харчо", "Харчо"], known)).toEqual(["Харчо"]);
  });
});

describe("annotateBroken", () => {
  it("annotates only broken links, leaves valid untouched", () => {
    const text = "Смотри [[Борщ]] и [[Харчо]].";
    const result = annotateBroken(text, new Set(["Харчо"]));
    expect(result).toBe("Смотри [[Борщ]] и [[Харчо]] *(нет в wiki)*.");
  });

  it("does not double-annotate when broken stem appears multiple times", () => {
    const text = "[[Харчо]] — это [[Харчо]].";
    const result = annotateBroken(text, new Set(["Харчо"]));
    expect(result).toBe("[[Харчо]] *(нет в wiki)* — это [[Харчо]] *(нет в wiki)*.");
  });

  it("does not annotate valid [[X|alias]] links", () => {
    const text = "Смотри [[Борщ|рецепт]].";
    const result = annotateBroken(text, new Set(["Борщ"]));
    expect(result).toBe("Смотри [[Борщ|рецепт]].");
  });
});
