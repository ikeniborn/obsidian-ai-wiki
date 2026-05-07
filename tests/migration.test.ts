import { describe, it, expect } from "vitest";
import { migrateDomainWikiFolder } from "../src/main";
import type { DomainEntry } from "../src/domain";

function makeDomain(wiki_folder: string): DomainEntry {
  return { id: "d", name: "D", wiki_folder };
}

describe("migrateDomainWikiFolder", () => {
  it("strips !Wiki/ prefix", () => {
    const domains = [makeDomain("!Wiki/os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(true);
    expect(domains[0].wiki_folder).toBe("os");
  });

  it("strips !Wiki/ from multiple domains", () => {
    const domains = [makeDomain("!Wiki/os"), makeDomain("!Wiki/базы-данные")];
    migrateDomainWikiFolder(domains);
    expect(domains[0].wiki_folder).toBe("os");
    expect(domains[1].wiki_folder).toBe("базы-данные");
  });

  it("does not change domains without !Wiki/ prefix", () => {
    const domains = [makeDomain("os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(false);
    expect(domains[0].wiki_folder).toBe("os");
  });

  it("does not touch non-standard paths", () => {
    const domains = [makeDomain("CustomWiki/os")];
    const changed = migrateDomainWikiFolder(domains);
    expect(changed).toBe(false);
    expect(domains[0].wiki_folder).toBe("CustomWiki/os");
  });

  it("returns false for empty array", () => {
    expect(migrateDomainWikiFolder([])).toBe(false);
  });
});
