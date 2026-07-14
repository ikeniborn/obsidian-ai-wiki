import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnswerFrames,
  parseContentFrame,
  parseFormatFrames,
  parseLintChatFrames,
  parseLintFrames,
  parsePageFrames,
  parseWikiPagesFrames,
} from "../src/phases/framed-output";
import { LintChatSchema, LintOutputSchema, WikiPagesOutputSchema } from "../src/phases/zod-schemas";

test("parseFormatFrames parses report and formatted sentinel output", () => {
  const parsed = parseFormatFrames([
    "<<<REPORT>>>",
    "- changed",
    "<<<FORMATTED>>>",
    "---",
    "tags: []",
    "---",
    "# Title",
    "<<<END>>>",
  ].join("\n"), false);

  assert.equal(parsed.truncated, false);
  assert.equal(parsed.raw.report, "- changed");
  assert.match(parsed.raw.formatted, /^---\n/);
});

test("parseContentFrame parses reasoning, annotation, and content", () => {
  const parsed = parseContentFrame([
    "<<<REASONING>>>",
    "merged related notes",
    "<<<ANNOTATION>>>",
    "Short description",
    "<<<CONTENT>>>",
    "# Entity",
    "",
    "Body",
    "<<<END>>>",
  ].join("\n"));

  assert.equal(parsed.reasoning, "merged related notes");
  assert.equal(parsed.annotation, "Short description");
  assert.equal(parsed.content, "# Entity\n\nBody");
});

test("parseAnswerFrames parses citations and defaults missing reasoning", () => {
  const parsed = parseAnswerFrames([
    "<<<ANSWER>>>",
    "Answer with [[wiki_demo_a]].",
    "<<<CITATIONS>>>",
    "- wiki_demo_a",
    "- wiki_demo_b",
    "<<<END>>>",
  ].join("\n"));

  assert.equal(parsed.reasoning, "");
  assert.equal(parsed.answer_markdown, "Answer with [[wiki_demo_a]].");
  assert.deepEqual(parsed.citations, ["wiki_demo_a", "wiki_demo_b"]);
});

test("parsePageFrames parses pages and deletes", () => {
  const parsed = parsePageFrames(pageFramesFixture());

  assert.equal(parsed.reasoning, "reasoning text");
  assert.equal(parsed.pages[0].path, "!Wiki/demo/entities/wiki_demo_a.md");
  assert.equal(parsed.pages[0].annotation, "A page");
  assert.match(parsed.pages[0].content, /^---\n/);
  assert.deepEqual(parsed.deletes, [{
    path: "!Wiki/demo/entities/wiki_demo_old.md",
    redirect_to: "!Wiki/demo/entities/wiki_demo_a.md",
  }]);
});

test("parsePageFrames preserves marker text inside content lines", () => {
  const parsed = parsePageFrames([
    "<<<REPORT>>>",
    "reasoning text",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_a.md",
    "<<<CONTENT>>>",
    "# A",
    "",
    "Example text with literal <<<END_PAGE>>> marker text.",
    "```",
    "<<<END_PAGE>>>",
    "```",
    "<<<END_PAGE>>>",
    "<<<END>>>",
  ].join("\n"));

  assert.equal(parsed.pages[0].content, [
    "# A",
    "",
    "Example text with literal <<<END_PAGE>>> marker text.",
    "```",
    "<<<END_PAGE>>>",
    "```",
  ].join("\n"));
});

test("parsePageFrames throws on trailing malformed page frame", () => {
  const raw = [
    "<<<REPORT>>>",
    "reasoning text",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_a.md",
    "<<<CONTENT>>>",
    "# A",
    "<<<END_PAGE>>>",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_b.md",
    "<<<CONTENT>>>",
    "# B",
    "<<<END>>>",
  ].join("\n");

  assert.throws(() => parsePageFrames(raw), /missing <<<END_PAGE>>>/i);
});

test("parsePageFrames throws when required markers are missing", () => {
  assert.throws(() => parsePageFrames("<<<PAGE>>>\npath: x\n"), /missing <<<END>>>/i);
});

test("schema adapters map frames to expected zod fields", () => {
  const raw = pageFramesFixture();

  const wikiPages = WikiPagesOutputSchema.parse(parseWikiPagesFrames(raw));
  assert.equal(wikiPages.reasoning, "reasoning text");
  assert.equal(wikiPages.pages[0].path, "!Wiki/demo/entities/wiki_demo_a.md");
  assert.deepEqual(wikiPages.deletes, [{ path: "!Wiki/demo/entities/wiki_demo_old.md" }]);

  const lint = LintOutputSchema.parse(parseLintFrames(raw));
  assert.equal(lint.report, "reasoning text");
  assert.equal(lint.fixes[0].path, "!Wiki/demo/entities/wiki_demo_a.md");
  assert.equal("pages" in lint, false);

  const lintChat = LintChatSchema.parse(parseLintChatFrames(raw));
  assert.equal(lintChat.summary, "reasoning text");
  assert.equal(lintChat.pages[0].path, "!Wiki/demo/entities/wiki_demo_a.md");
});

function pageFramesFixture(): string {
  return [
    "<<<REPORT>>>",
    "reasoning text",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_a.md",
    "annotation: A page",
    "<<<CONTENT>>>",
    "---",
    "type: Entity",
    "---",
    "# A",
    "<<<END_PAGE>>>",
    "<<<DELETE>>>",
    "path: !Wiki/demo/entities/wiki_demo_old.md",
    "redirect_to: !Wiki/demo/entities/wiki_demo_a.md",
    "<<<END_DELETE>>>",
    "<<<END>>>",
  ].join("\n");
}
