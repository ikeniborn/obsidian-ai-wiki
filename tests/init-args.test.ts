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

describe("parseSourcesFromArgs", () => {
  function parseSourcesFromArgs(args: string[]): string[] {
    const idx = args.indexOf("--sources");
    return idx >= 0 ? args.slice(idx + 1) : [];
  }

  it("returns empty array when no --sources flag", () => {
    expect(parseSourcesFromArgs(["domainId"])).toEqual([]);
  });

  it("returns paths after --sources flag", () => {
    expect(parseSourcesFromArgs(["domainId", "--sources", "Notes/AI/", "Sources/"])).toEqual([
      "Notes/AI/",
      "Sources/",
    ]);
  });

  it("handles --dry-run before --sources", () => {
    expect(parseSourcesFromArgs(["domainId", "--dry-run", "--sources", "Notes/"])).toEqual([
      "Notes/",
    ]);
  });
});
