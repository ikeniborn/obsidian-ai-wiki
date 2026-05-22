import { describe, it, expect } from "vitest";
import {
  WIKI_ROOT,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
  validateArticlePath,
  domainConfigDir,
  domainIndexPath,
  domainLogPath,
} from "../src/wiki-path";

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

describe("sanitizeWikiFolder", () => {
  it("strips vaults/<name>/ prefix", () => {
    expect(sanitizeWikiFolder("vaults/Work/os")).toBe("os");
  });
  it("strips vaults/<name>/!Wiki/ prefix", () => {
    expect(sanitizeWikiFolder("vaults/Work/!Wiki/os")).toBe("os");
  });
  it("strips !Wiki/ prefix", () => {
    expect(sanitizeWikiFolder("!Wiki/os")).toBe("os");
  });
  it("takes last segment when slash remains", () => {
    expect(sanitizeWikiFolder("os/network")).toBe("network");
  });
  it("returns single-segment as-is", () => {
    expect(sanitizeWikiFolder("os")).toBe("os");
  });
});

describe("sanitizeWikiSubfolder", () => {
  it("strips domain prefix (os/network → network)", () => {
    expect(sanitizeWikiSubfolder("os/network")).toBe("network");
  });
  it("returns single word unchanged", () => {
    expect(sanitizeWikiSubfolder("network")).toBe("network");
  });
  it("takes last segment for multi-level (a/b/c → c)", () => {
    expect(sanitizeWikiSubfolder("a/b/c")).toBe("c");
  });
});

describe("validateArticlePath", () => {
  const wiki = "!Wiki/os";

  it("valid: exactly 2 segments after domain", () => {
    expect(validateArticlePath("!Wiki/os/network/NFS.md", wiki)).toBe(true);
  });
  it("invalid: domain appears twice (5 segments total)", () => {
    expect(validateArticlePath("!Wiki/os/os/network/NFS.md", wiki)).toBe(false);
  });
  it("invalid: 3 segments after domain (too deep)", () => {
    expect(validateArticlePath("!Wiki/os/network/nfs/NFS.md", wiki)).toBe(false);
  });
  it("valid: _index.md in .config exempt", () => {
    expect(validateArticlePath("!Wiki/os/.config/_index.md", wiki)).toBe(true);
  });
  it("valid: _log.md in .config exempt", () => {
    expect(validateArticlePath("!Wiki/os/.config/_log.md", wiki)).toBe(true);
  });
  it("invalid: _index.md at domain root no longer exempt", () => {
    expect(validateArticlePath("!Wiki/os/_index.md", wiki)).toBe(false);
  });
  it("invalid: _log.md at domain root no longer exempt", () => {
    expect(validateArticlePath("!Wiki/os/_log.md", wiki)).toBe(false);
  });
  it("valid: _wiki_schema.md exempt", () => {
    expect(validateArticlePath("!Wiki/os/.config/_wiki_schema.md", wiki)).toBe(true);
  });
  it("invalid: wrong domain prefix", () => {
    expect(validateArticlePath("!Wiki/other/network/NFS.md", wiki)).toBe(false);
  });
  it("invalid: only 1 segment after domain (no subfolder)", () => {
    expect(validateArticlePath("!Wiki/os/NFS.md", wiki)).toBe(false);
  });
});

describe("domainConfigDir", () => {
  it("appends /.config to domain folder", () => {
    expect(domainConfigDir("!Wiki/ии")).toBe("!Wiki/ии/.config");
  });
});

describe("domainIndexPath", () => {
  it("returns .config/_index.md path", () => {
    expect(domainIndexPath("!Wiki/ии")).toBe("!Wiki/ии/.config/_index.md");
  });
});

describe("domainLogPath", () => {
  it("returns .config/_log.md path", () => {
    expect(domainLogPath("!Wiki/ии")).toBe("!Wiki/ии/.config/_log.md");
  });
});
