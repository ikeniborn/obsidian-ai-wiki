import { describe, it, expect } from "vitest";
import { WIKI_ROOT, domainWikiFolder } from "../src/wiki-path";

describe("WIKI_ROOT", () => {
  it("equals !Wiki", () => {
    expect(WIKI_ROOT).toBe("!Wiki");
  });
});

describe("domainWikiFolder", () => {
  it("prepends !Wiki/ to subfolder", () => {
    expect(domainWikiFolder("os")).toBe("!Wiki/os");
  });

  it("handles cyrillic subfolder", () => {
    expect(domainWikiFolder("базы-данных")).toBe("!Wiki/базы-данных");
  });

  it("handles nested subfolder", () => {
    expect(domainWikiFolder("work/archive")).toBe("!Wiki/work/archive");
  });
});
