import { describe, it, expect } from "vitest";

function deriveWikiRoot(wikiFolder: string): string {
  const raw = wikiFolder.replace(/\/[^/]+$/, "") || "!Wiki";
  return raw.replace(/^vaults\/[^/]+\//, "");
}

describe("deriveWikiRoot", () => {
  it("strips vault prefix from old-format wiki_folder", () => {
    expect(deriveWikiRoot("vaults/work/!Wiki/ai")).toBe("!Wiki");
  });

  it("leaves clean vault-relative path unchanged", () => {
    expect(deriveWikiRoot("!Wiki/ai")).toBe("!Wiki");
  });

  it("defaults to !Wiki when folder has no parent", () => {
    expect(deriveWikiRoot("!Wiki")).toBe("!Wiki");
  });

  it("handles nested path without vault prefix", () => {
    expect(deriveWikiRoot("Notes/wiki/ai")).toBe("Notes/wiki");
  });
});
