import { describe, it, expect, vi } from "vitest";
import {
  extractObsidianEmbedPaths,
  insertDescriptions,
} from "../src/phases/attachment-analyzer";

describe("extractObsidianEmbedPaths", () => {
  it("returns empty array for plain text", () => {
    expect(extractObsidianEmbedPaths("no embeds here")).toEqual([]);
  });

  it("extracts single PNG embed", () => {
    expect(extractObsidianEmbedPaths("![[image.png]]")).toEqual(["image.png"]);
  });

  it("extracts multiple embeds", () => {
    const md = "# Title\n![[a.png]]\nText\n![[b.pdf]]\n![[c.excalidraw]]";
    expect(extractObsidianEmbedPaths(md)).toEqual(["a.png", "b.pdf", "c.excalidraw"]);
  });

  it("ignores standard markdown images", () => {
    expect(extractObsidianEmbedPaths("![alt](image.png)")).toEqual([]);
  });

  it("ignores wiki links without !", () => {
    expect(extractObsidianEmbedPaths("[[note.md]]")).toEqual([]);
  });

  it("trims whitespace in embed path", () => {
    expect(extractObsidianEmbedPaths("![[ image.png ]]")).toEqual(["image.png"]);
  });
});

describe("insertDescriptions", () => {
  it("inserts description immediately after embed line", () => {
    const md = "![[img.png]]\nNext line";
    const descriptions = new Map([["img.png", "A red circle."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("![[img.png]]\n> *[Vision] A red circle.*\nNext line");
  });

  it("is idempotent — skips embed that already has [Vision] marker", () => {
    const md = "![[img.png]]\n> *[Vision] Already described.*\nNext line";
    const descriptions = new Map([["img.png", "New description."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });

  it("skips embed with no matching description", () => {
    const md = "![[unknown.png]]";
    const result = insertDescriptions(md, new Map());
    expect(result).toBe(md);
  });

  it("handles embed at end of file with no trailing newline", () => {
    const md = "Text\n![[img.png]]";
    const descriptions = new Map([["img.png", "A square."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("Text\n![[img.png]]\n> *[Vision] A square.*");
  });

  it("skips empty-line separator before [Vision] marker", () => {
    const md = "![[img.png]]\n\n> *[Vision] Already here.*";
    const descriptions = new Map([["img.png", "New."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });
});
