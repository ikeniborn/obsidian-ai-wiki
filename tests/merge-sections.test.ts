import assert from "node:assert/strict";
import test from "node:test";
import { ensureIncomingSections } from "../src/merge-sections";

test("appends an incoming section missing from the merged page", () => {
  const merged = "# Title\n\n## Overview\nkept\n";
  const incoming = "# Title\n\n## Overview\nold\n\n## Pricing\n$5/mo\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.match(out, /## Pricing/);
  assert.match(out, /\$5\/mo/);
  // The already-present section is not duplicated.
  assert.equal(out.match(/## Overview/g)?.length, 1);
});

test("does not duplicate a section already present (case/space-insensitive heading)", () => {
  const merged = "## Details\nfull\n";
  const incoming = "##  details\nshort\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.equal(out.match(/## Details/gi)?.length, 1);
  assert.doesNotMatch(out, /short/);
});

test("skips ## Related and ## External links", () => {
  const merged = "## Overview\nx\n";
  const incoming = "## Related\n- [[a]]\n\n## External links\n- [t](u)\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.doesNotMatch(out, /## Related/);
  assert.doesNotMatch(out, /## External links/);
});

test("returns the merged page unchanged when nothing is missing", () => {
  const merged = "## A\n1\n\n## B\n2\n";
  const incoming = "## A\nx\n\n## B\ny\n";
  assert.equal(ensureIncomingSections(merged, incoming), merged);
});

test("ignores ### subsections as section boundaries", () => {
  const merged = "## A\ntext\n### Sub\ndeep\n";
  const incoming = "## A\nother\n### Sub\ndeep2\n";
  // "### Sub" is not a top-level ## section, so no append happens.
  assert.equal(ensureIncomingSections(merged, incoming), merged);
});
