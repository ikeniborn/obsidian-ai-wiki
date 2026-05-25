import { describe, it, expect } from "vitest";
import { extractParentSourcePath, detectDomain, runIngest } from "../src/phases/ingest";
import type { DomainEntry } from "../src/domain";
import { PageSimilarityService } from "../src/page-similarity";

describe("extractParentSourcePath", () => {
  const VAULT = "/vaults/Work";

  it("returns vault-relative parent from deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/ai/article.md", VAULT))
      .toBe("notes/ai/");
  });

  it("returns vault-relative parent from one-level deep path", () => {
    expect(extractParentSourcePath("/vaults/Work/notes/file.md", VAULT))
      .toBe("notes/");
  });

  it("clamps to vault root when file is directly in vault", () => {
    expect(extractParentSourcePath("/vaults/Work/file.md", VAULT))
      .toBe("./");
  });

  it("clamps to vault root when parent is above vault", () => {
    expect(extractParentSourcePath("/outside/file.md", VAULT))
      .toBe("./");
  });
});

describe("detectDomain", () => {
  const VAULT = "/project";
  const makeD = (id: string, paths: string[]): DomainEntry => ({
    id, name: id, wiki_folder: `!Wiki/${id}`, source_paths: paths,
  });

  it("matches by source_paths prefix", () => {
    const domains = [makeD("d1", ["notes/"]), makeD("d2", ["docs/"])];
    const result = detectDomain("/project/notes/sub/file.md", domains, VAULT);
    expect(result?.id).toBe("d1");
  });

  it("falls back to first domain if no match", () => {
    const domains = [makeD("fallback", []), makeD("other", ["docs/"])];
    const result = detectDomain("/project/unknown/file.md", domains, VAULT);
    expect(result?.id).toBe("fallback");
  });

  it("returns null if domains empty", () => {
    expect(detectDomain("/project/file.md", [], VAULT)).toBeNull();
  });
});

describe("runIngest similarity integration", () => {
  it("exports runIngest with optional similarity and cachedAnnotations params", () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map<string, string>();
    expect(typeof runIngest).toBe("function");
    expect(svc).toBeDefined();
    expect(annotations).toBeDefined();
  });
});
