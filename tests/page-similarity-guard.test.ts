import assert from "node:assert/strict";
import test from "node:test";
import { PageSimilarityService } from "../src/page-similarity";

test("selectByEntities: empty index is not a retrieval failure", async () => {
  const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  const { allFailed } = await svc.selectByEntities(
    [{ name: "Safari" }, { name: "macOS" }],
    new Map(),                       // no index annotations (fresh domain)
    ["!Wiki/os/wiki_os_safari.md"],  // a page exists on disk
  );
  assert.equal(allFailed, false);
});

test("selectByEntities: annotated pages with no overlap do not fail", async () => {
  const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  const { allFailed } = await svc.selectByEntities(
    [{ name: "Kubernetes" }],
    new Map([["wiki_os_safari", "safari proxy macos"]]), // unrelated annotation
    ["!Wiki/os/wiki_os_safari.md"],
  );
  assert.equal(allFailed, false);
});
