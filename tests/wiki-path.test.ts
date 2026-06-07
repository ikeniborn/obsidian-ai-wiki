import { describe, it, expect } from "vitest";
import {
  WIKI_ROOT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOMAIN_PATH,
  GLOBAL_AGENT_LOG_PATH,
  GLOBAL_DEV_LOG_PATH,
  domainWikiFolder,
  sanitizeWikiFolder,
  sanitizeWikiSubfolder,
  validateArticlePath,
  domainConfigDir,
  domainIndexPath,
  domainLogPath,
} from "../src/wiki-path";

describe("WIKI_ROOT", () => {
  it("equals !Wiki", () => expect(WIKI_ROOT).toBe("!Wiki"));
});

describe("global constants", () => {
  it("GLOBAL_CONFIG_DIR", () => expect(GLOBAL_CONFIG_DIR).toBe("!Wiki/_config"));
  it("GLOBAL_DOMAIN_PATH", () => expect(GLOBAL_DOMAIN_PATH).toBe("!Wiki/_config/_domain.json"));
  it("GLOBAL_AGENT_LOG_PATH", () => expect(GLOBAL_AGENT_LOG_PATH).toBe("!Wiki/_config/_agent.jsonl"));
  it("GLOBAL_DEV_LOG_PATH", () => expect(GLOBAL_DEV_LOG_PATH).toBe("!Wiki/_config/_dev.jsonl"));
});

describe("domainWikiFolder", () => {
  it("prepends !Wiki/ to subfolder", () => expect(domainWikiFolder("os")).toBe("!Wiki/os"));
  it("handles cyrillic subfolder", () => expect(domainWikiFolder("базы-данных")).toBe("!Wiki/базы-данных"));
  it("handles nested subfolder", () => expect(domainWikiFolder("work/archive")).toBe("!Wiki/work/archive"));
});

describe("sanitizeWikiFolder", () => {
  it("strips vaults/<name>/ prefix", () => expect(sanitizeWikiFolder("vaults/Work/os")).toBe("os"));
  it("strips vaults/<name>/!Wiki/ prefix", () => expect(sanitizeWikiFolder("vaults/Work/!Wiki/os")).toBe("os"));
  it("strips !Wiki/ prefix", () => expect(sanitizeWikiFolder("!Wiki/os")).toBe("os"));
  it("takes last segment when slash remains", () => expect(sanitizeWikiFolder("os/network")).toBe("network"));
  it("returns single-segment as-is", () => expect(sanitizeWikiFolder("os")).toBe("os"));
});

describe("sanitizeWikiSubfolder", () => {
  it("strips domain prefix (os/network → network)", () => expect(sanitizeWikiSubfolder("os/network")).toBe("network"));
  it("returns single word unchanged", () => expect(sanitizeWikiSubfolder("network")).toBe("network"));
  it("takes last segment for multi-level (a/b/c → c)", () => expect(sanitizeWikiSubfolder("a/b/c")).toBe("c"));
});

describe("validateArticlePath", () => {
  const wiki = "!Wiki/os";

  it("valid: exactly 2 segments after domain", () =>
    expect(validateArticlePath("!Wiki/os/network/NFS.md", wiki)).toBe(true));
  it("invalid: domain appears twice (5 segments total)", () =>
    expect(validateArticlePath("!Wiki/os/os/network/NFS.md", wiki)).toBe(false));
  it("invalid: 3 segments after domain (too deep)", () =>
    expect(validateArticlePath("!Wiki/os/network/nfs/NFS.md", wiki)).toBe(false));
  it("valid: _index.md in _config exempt", () =>
    expect(validateArticlePath("!Wiki/os/_config/_index.md", wiki)).toBe(true));
  it("valid: _log.md in _config exempt", () =>
    expect(validateArticlePath("!Wiki/os/_config/_log.md", wiki)).toBe(true));
  it("invalid: _index.md at domain root not exempt", () =>
    expect(validateArticlePath("!Wiki/os/_index.md", wiki)).toBe(false));
  it("invalid: old .config path no longer accepted", () =>
    expect(validateArticlePath("!Wiki/os/.config/_index.md", wiki)).toBe(false));
  it("invalid: wrong domain prefix", () =>
    expect(validateArticlePath("!Wiki/other/network/NFS.md", wiki)).toBe(false));
  it("invalid: only 1 segment after domain (no subfolder)", () =>
    expect(validateArticlePath("!Wiki/os/NFS.md", wiki)).toBe(false));
});

describe("domainConfigDir", () => {
  it("appends /_config to domain folder", () =>
    expect(domainConfigDir("!Wiki/os")).toBe("!Wiki/os/_config"));
});

describe("domainIndexPath", () => {
  it("returns _config/_index.md path", () =>
    expect(domainIndexPath("!Wiki/os")).toBe("!Wiki/os/_config/_index.md"));
});

describe("domainLogPath", () => {
  it("returns _config/_log.md path", () =>
    expect(domainLogPath("!Wiki/os")).toBe("!Wiki/os/_config/_log.md"));
});
