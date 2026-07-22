import assert from "node:assert/strict";
import test from "node:test";

import { stripDeadLinks } from "../src/wiki-link-validator";

test("stripDeadLinks removes empty bullets left in Related after dead link removal", () => {
  const input = [
    "---",
    "type: concept",
    "---",
    "# Page",
    "",
    "## Related",
    "",
    "- [[Missing A]]",
    "-",
    "- [[Obsidian]]",
    "- [[Missing B]]",
    "-   ",
    "",
    "## External links",
    "- [Docs](https://example.com)",
    "",
  ].join("\n");

  const out = stripDeadLinks(input, new Set(["Obsidian"]));

  assert.match(out, /## Related\n- \[\[Obsidian\]\]/);
  assert.doesNotMatch(out, /## Related\n(?:\s*-\s*\n)+/);
  assert.doesNotMatch(out, /^\s*-\s*$/m);
  assert.match(out, /## External links\n- \[Docs\]\(https:\/\/example\.com\)/);
});

test("stripDeadLinks removes empty Related section after all bullets become dead", () => {
  const input = [
    "# Page",
    "",
    "## Facts",
    "Body",
    "",
    "## Related",
    "- [[Missing A]]",
    "- [[Missing B]]",
    "",
    "## External links",
    "- [Docs](https://example.com)",
    "",
  ].join("\n");

  const out = stripDeadLinks(input, new Set());

  assert.doesNotMatch(out, /## Related/);
  assert.match(out, /## Facts\nBody\n\n## External links/);
});
