import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateBroken,
  extractAnswerLinks,
  replaceAnswerLink,
} from "../src/phases/query-link-validator";

test("extractAnswerLinks ignores WikiLink-shaped syntax inside Markdown code", () => {
  const answer = [
    "Use [[wiki_os-unix_gitlab_runner]].",
    "",
    "The TOML table is `[[runners]]`.",
    "",
    "```toml",
    "[[runners]]",
    "name = \"shell\"",
    "```",
    "",
    "A real unresolved link remains [[missing_page]].",
  ].join("\n");

  assert.deepEqual(extractAnswerLinks(answer), [
    "wiki_os-unix_gitlab_runner",
    "missing_page",
  ]);
});

test("annotateBroken leaves inline and fenced code byte-identical", () => {
  const answer = [
    "Outside [[runners]].",
    "Inline `[[runners]]`.",
    "~~~toml",
    "[[runners]]",
    "~~~",
  ].join("\n");

  assert.equal(annotateBroken(answer, new Set(["runners"])), [
    "Outside [[runners]] *(not in wiki)*.",
    "Inline `[[runners]]`.",
    "~~~toml",
    "[[runners]]",
    "~~~",
  ].join("\n"));
});

test("replaceAnswerLink rewrites only semantic WikiLinks", () => {
  const answer = [
    "See [[DWM-88393]].",
    "Do not change `[[DWM-88393]]`.",
    "```text",
    "[[DWM-88393]]",
    "```",
  ].join("\n");

  assert.equal(
    replaceAnswerLink(answer, "DWM-88393", "wiki_rtk-task_dwm_88393"),
    [
      "See [[wiki_rtk-task_dwm_88393]].",
      "Do not change `[[DWM-88393]]`.",
      "```text",
      "[[DWM-88393]]",
      "```",
    ].join("\n"),
  );
});

test("code masking supports CRLF fences and multiline code spans", () => {
  const answer = [
    "Multiline ``code",
    "[[runners]]`` keeps syntax.",
    "~~~toml",
    "[[runners]]",
    "~~~",
    "Real [[wiki_os-unix_gitlab_runner]].",
  ].join("\r\n");

  assert.deepEqual(extractAnswerLinks(answer), ["wiki_os-unix_gitlab_runner"]);
});
