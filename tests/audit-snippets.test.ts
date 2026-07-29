import assert from "node:assert/strict";
import test from "node:test";

import {
  commandStart,
  extractTechnicalSnippets,
  stripTrailingContinuation,
} from "../scripts/loen-dynamic-budget-routing/audit-snippets.mjs";

test("extractTechnicalSnippets does not emit a capitalized prose sentence with no code span as a whole-line snippet", () => {
  const markdown = "Mount the NFS share from the server.";

  assert.deepEqual(extractTechnicalSnippets(markdown), []);
});

test("extractTechnicalSnippets keeps only the inline-code snippet of a capitalized prose sentence, not the whole line", () => {
  const markdown = "Mount all filesystems listed in `/etc/fstab`.";

  assert.deepEqual(extractTechnicalSnippets(markdown), ["/etc/fstab"]);
});

test("extractTechnicalSnippets keeps the inline-code snippet of a prose sentence with a code span", () => {
  const markdown = "Save the `/etc/fstab` file.";

  assert.deepEqual(extractTechnicalSnippets(markdown), ["/etc/fstab"]);
});

test("extractTechnicalSnippets still emits a real lowercase command line", () => {
  const markdown = [
    "mount -a",
    "systemctl daemon-reload",
  ].join("\n");

  assert.deepEqual(extractTechnicalSnippets(markdown), ["mount -a", "systemctl daemon-reload"]);
});

test("commandStart matches a lowercase command head and rejects a capitalized sentence head", () => {
  assert.equal(commandStart.test("mount -a"), true);
  assert.equal(commandStart.test("Mount the NFS share from the server."), false);
});

test("stripTrailingContinuation matches a page line lacking the trailing continuation", () => {
  const snippet = "systemctl daemon-reload && \\";
  const corpus = "See wiki_os-unix_systemd_mount_unit.md: systemctl daemon-reload restarts the unit.";

  assert.ok(corpus.includes(stripTrailingContinuation(snippet)));
  assert.equal(stripTrailingContinuation("systemctl daemon-reload"), "systemctl daemon-reload");
});
