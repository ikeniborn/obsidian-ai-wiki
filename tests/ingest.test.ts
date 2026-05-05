import { describe, it, expect } from "vitest";
import { extractParentSourcePath, detectDomain } from "../src/phases/ingest";
import type { DomainEntry } from "../src/domain-map";

describe("extractParentSourcePath", () => {
  it("returns direct parent relative to repoRoot", () => {
    expect(extractParentSourcePath(
      "/project/notes/sub/file.md",
      "/project",
      "/project",
    )).toBe("notes/sub/");
  });

  it("returns direct parent when file is one level deep", () => {
    expect(extractParentSourcePath(
      "/project/notes/file.md",
      "/project",
      "/project",
    )).toBe("notes/");
  });

  it("returns vault root path when file is directly in vault", () => {
    // родитель = vault root → "./"
    expect(extractParentSourcePath(
      "/project/file.md",
      "/project",
      "/project",
    )).toBe("./");
  });

  it("works when repoRoot differs from vaultRoot (vaults/ structure)", () => {
    expect(extractParentSourcePath(
      "/project/vaults/MyVault/folder/file.md",
      "/project",
      "/project/vaults/MyVault",
    )).toBe("vaults/MyVault/folder/");
  });

  it("returns vault root path when file is directly in vault (vaults/ structure)", () => {
    expect(extractParentSourcePath(
      "/project/vaults/MyVault/file.md",
      "/project",
      "/project/vaults/MyVault",
    )).toBe("vaults/MyVault/");
  });
});

describe("detectDomain", () => {
  const makeD = (id: string, paths: string[]): DomainEntry => ({
    id, name: id, wiki_folder: `!Wiki/${id}`, source_paths: paths,
  });

  it("matches by source_paths prefix", () => {
    const domains = [makeD("d1", ["notes/"]), makeD("d2", ["docs/"])];
    const result = detectDomain("/project/notes/sub/file.md", domains, "/project");
    expect(result?.id).toBe("d1");
  });

  it("falls back to first domain if no match", () => {
    const domains = [makeD("fallback", []), makeD("other", ["docs/"])];
    const result = detectDomain("/project/unknown/file.md", domains, "/project");
    expect(result?.id).toBe("fallback");
  });

  it("returns null if domains empty", () => {
    expect(detectDomain("/project/file.md", [], "/project")).toBeNull();
  });
});
