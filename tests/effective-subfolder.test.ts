import assert from "node:assert/strict";
import test from "node:test";

import { effectiveSubfolder } from "../src/wiki-path";

test("effectiveSubfolder returns wiki_subfolder when present", () => {
  assert.equal(
    effectiveSubfolder({ type: "Concept", description: "", extraction_cues: [], wiki_subfolder: "concepts" }),
    "concepts",
  );
});

test("effectiveSubfolder falls back to sanitized type name when empty", () => {
  assert.equal(
    effectiveSubfolder({ type: "Concept", description: "", extraction_cues: [], wiki_subfolder: "" }),
    "Concept",
  );
  assert.equal(
    effectiveSubfolder({ type: "Data Mart", description: "", extraction_cues: [] }),
    "Data Mart",
  );
});

test("effectiveSubfolder strips slashes from a type-name fallback", () => {
  assert.equal(
    effectiveSubfolder({ type: "a/b", description: "", extraction_cues: [], wiki_subfolder: "" }),
    "b",
  );
});
