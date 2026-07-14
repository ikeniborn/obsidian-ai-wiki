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
  parseWikiPageRepairFramesOrJson,
  lintChatProfile,
  lintOutputProfile,
  mergeContentFrameInstruction,
  mergedPageProfile,
  queryAnswerProfile,
  wikiPagesFrameInstruction,
  wikiPagesProfile,
} from "../src/phases/framed-output";
import { LintChatSchema, LintOutputSchema, MergedPageOutputSchema, WikiPagesOutputSchema, makeQueryAnswerSchema } from "../src/phases/zod-schemas";

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

test("lint framed parsers accept report-only no-op output", () => {
  const raw = [
    "<<<REPORT>>>",
    "No edits needed.",
    "<<<END>>>",
  ].join("\n");

  const lint = LintOutputSchema.parse(parseLintFrames(raw));
  assert.equal(lint.report, "No edits needed.");
  assert.deepEqual(lint.fixes, []);
  assert.equal(lint.deletes, undefined);

  const lintChat = LintChatSchema.parse(parseLintChatFrames(raw));
  assert.equal(lintChat.summary, "No edits needed.");
  assert.deepEqual(lintChat.pages, []);
});

test("parseWikiPagesFrames parses entity type delta JSON frame", () => {
  const parsed = WikiPagesOutputSchema.parse(parseWikiPagesFrames([
    "<<<REPORT>>>",
    "reasoning text",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_a.md",
    "<<<CONTENT>>>",
    "# A",
    "<<<END_PAGE>>>",
    "<<<ENTITY_TYPES_DELTA_JSON>>>",
    "[{\"type\":\"Concept\",\"description\":\"Knowledge concept\",\"extraction_cues\":[\"concept\"]}]",
    "<<<END_ENTITY_TYPES_DELTA_JSON>>>",
    "<<<END>>>",
  ].join("\n")));

  assert.equal(parsed.entity_types_delta?.[0]?.type, "Concept");
});

test("parseWikiPagesFrames accepts report-only no-op output", () => {
  const parsed = WikiPagesOutputSchema.parse(parseWikiPagesFrames([
    "<<<REPORT>>>",
    "No page changes needed.",
    "<<<END>>>",
  ].join("\n")));

  assert.equal(parsed.reasoning, "No page changes needed.");
  assert.deepEqual(parsed.pages, []);
  assert.equal(parsed.deletes, undefined);
});

test("ingest framed profiles wire parser, schema, and repair instructions", () => {
  const pagesProfile = wikiPagesProfile();
  assert.equal(pagesProfile.kind, "framed-zod");
  assert.equal(pagesProfile.schema, WikiPagesOutputSchema);
  assert.match(wikiPagesFrameInstruction, /<<<PAGE>>>/);
  assert.equal(
    pagesProfile.parse("<<<REPORT>>>\nok\n<<<PAGE>>>\npath: !Wiki/demo/entities/wiki_demo_a.md\n<<<CONTENT>>>\n# A\n<<<END_PAGE>>>\n<<<END>>>").pages[0].path,
    "!Wiki/demo/entities/wiki_demo_a.md",
  );

  const mergeProfile = mergedPageProfile();
  assert.equal(mergeProfile.kind, "framed-zod");
  assert.equal(mergeProfile.schema, MergedPageOutputSchema);
  assert.match(mergeContentFrameInstruction, /<<<CONTENT>>>/);
  assert.equal(
    mergeProfile.parse("<<<ANNOTATION>>>\nA page\n<<<CONTENT>>>\n# A\n<<<END>>>").content,
    "# A",
  );
});

test("large text repair profiles wire parser, schema, and repair instructions", () => {
  const lintProfile = lintOutputProfile();
  assert.equal(lintProfile.kind, "framed-zod");
  assert.equal(lintProfile.schema, LintOutputSchema);
  assert.match(lintProfile.repairInstruction, /<<<REPORT>>>/);
  assert.equal(lintProfile.parse(pageFramesFixture()).fixes[0].path, "!Wiki/demo/entities/wiki_demo_a.md");

  const chatProfile = lintChatProfile();
  assert.equal(chatProfile.kind, "framed-zod");
  assert.equal(chatProfile.schema, LintChatSchema);
  assert.match(chatProfile.repairInstruction, /<<<PAGE>>>/);
  assert.equal(chatProfile.parse(pageFramesFixture()).pages[0].annotation, "A page");

  const answerSchema = makeQueryAnswerSchema(new Set(["wiki_demo_a"]));
  const answerProfile = queryAnswerProfile(answerSchema);
  assert.equal(answerProfile.kind, "framed-zod");
  assert.equal(answerProfile.schema, answerSchema);
  assert.match(answerProfile.repairInstruction, /<<<ANSWER>>>/);
  assert.equal(
    answerProfile.parse("<<<ANSWER>>>\nSee [[wiki_demo_a]].\n<<<CITATIONS>>>\n- wiki_demo_a\n<<<END>>>").answer_markdown,
    "See [[wiki_demo_a]].",
  );
});

test("parseWikiPageRepairFramesOrJson accepts framed page repair output", () => {
  const pages = parseWikiPageRepairFramesOrJson([
    "<<<REPORT>>>",
    "Corrected path depth.",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_fixed.md",
    "annotation: Fixed page",
    "<<<CONTENT>>>",
    "# Fixed",
    "<<<END_PAGE>>>",
    "<<<END>>>",
  ].join("\n"));

  assert.equal(pages[0].path, "!Wiki/demo/entities/wiki_demo_fixed.md");
  assert.equal(pages[0].annotation, "Fixed page");
  assert.equal(pages[0].content, "# Fixed");
});

test("parseWikiPageRepairFramesOrJson returns empty array for report-only repair output", () => {
  const pages = parseWikiPageRepairFramesOrJson([
    "<<<REPORT>>>",
    "No corrected pages.",
    "<<<END>>>",
  ].join("\n"));

  assert.deepEqual(pages, []);
});

test("parseWikiPageRepairFramesOrJson keeps legacy JSON repair output", () => {
  const pages = parseWikiPageRepairFramesOrJson(JSON.stringify([{
    path: "!Wiki/demo/entities/wiki_demo_fixed.md",
    annotation: "Fixed page",
    content: "# Fixed",
  }]));

  assert.equal(pages[0].path, "!Wiki/demo/entities/wiki_demo_fixed.md");
  assert.equal(pages[0].annotation, "Fixed page");
  assert.equal(pages[0].content, "# Fixed");
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
