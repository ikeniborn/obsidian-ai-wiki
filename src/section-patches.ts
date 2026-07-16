import { contentHash } from "./content-hash";

export interface CreatePage {
  kind: "create";
  path: string;
  annotation: string;
  content: string;
}

export interface SectionPatch {
  heading: string;
  expectedSectionHash?: string;
  operation: "add" | "append" | "replace";
  content: string;
}

export interface PatchPage {
  kind: "patch";
  path: string;
  expectedPageHash: string;
  annotation?: string;
  sections: SectionPatch[];
}

export interface PatchableSection {
  heading: string;
  span: string;
  hash: string;
}

export interface PatchablePage {
  pageHash: string;
  preamble: string;
  sections: PatchableSection[];
}

export type PatchApplyResult =
  | { ok: true; content: string; changedHeadings: string[] }
  | { ok: false; reason: "page_hash_mismatch" }
  | {
    ok: false;
    reason: "section_hash_mismatch" | "replace_context_missing" | "heading_exists" | "heading_missing";
    heading: string;
  };

interface FenceState {
  marker: "`" | "~";
  length: number;
}

interface ScannedSection extends PatchableSection {
  key: string;
  start: number;
  end: number;
}

interface ScannedPage extends PatchablePage {
  sections: ScannedSection[];
}

export function normalizeSectionHeading(heading: string): string {
  return heading
    .replace(/^#+[ \t]*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function withoutLineEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

function openingFence(line: string): FenceState | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  if (match[1][0] === "`" && match[2].includes("`")) return null;
  return {
    marker: match[1][0] as FenceState["marker"],
    length: match[1].length,
  };
}

function closesFence(line: string, fence: FenceState): boolean {
  const match = /^ {0,3}([`~]+)[ \t]*$/.exec(line);
  return match !== null
    && match[1][0] === fence.marker
    && match[1].length >= fence.length;
}

function leadingFrontmatterEnd(source: string): number {
  const firstNewline = source.indexOf("\n");
  const firstEnd = firstNewline === -1 ? source.length : firstNewline + 1;
  if (withoutLineEnding(source.slice(0, firstEnd)) !== "---") return 0;

  let offset = firstEnd;
  while (offset < source.length) {
    const newline = source.indexOf("\n", offset);
    const end = newline === -1 ? source.length : newline + 1;
    if (withoutLineEnding(source.slice(offset, end)) === "---") return end;
    offset = end;
  }
  return 0;
}

function scanPatchablePage(source: string): ScannedPage {
  const lines: Array<{ end: number; text: string }> = [];
  const starts: Array<{ start: number; heading: string; lineIndex: number }> = [];
  const frontmatterEnd = leadingFrontmatterEnd(source);
  let fence: FenceState | null = null;
  let offset = 0;

  while (offset < source.length) {
    const newline = source.indexOf("\n", offset);
    const end = newline === -1 ? source.length : newline + 1;
    const line = withoutLineEnding(source.slice(offset, end));
    const lineIndex = lines.push({ end, text: line }) - 1;

    if (offset < frontmatterEnd) {
      // Valid leading frontmatter is governed metadata, never patchable body.
    } else if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else {
      const opened = openingFence(line);
      if (opened) {
        fence = opened;
      } else if (/^##[ \t]+/.test(line)) {
        starts.push({ start: offset, heading: line, lineIndex });
      }
    }

    offset = end;
  }

  const sections = starts.map((section, index): ScannedSection => {
    const nextLineIndex = starts[index + 1]?.lineIndex ?? lines.length;
    let end = lines[section.lineIndex].end;
    // Trailing blank lines are separator gaps, not section-owned bytes. This
    // keeps an existing section span and hash stable when a later H2 is added.
    for (let lineIndex = section.lineIndex + 1; lineIndex < nextLineIndex; lineIndex++) {
      if (lines[lineIndex].text.trim().length > 0) end = lines[lineIndex].end;
    }
    const span = source.slice(section.start, end);
    return {
      heading: section.heading,
      span,
      hash: contentHash(span),
      key: normalizeSectionHeading(section.heading),
      start: section.start,
      end,
    };
  });

  return {
    pageHash: contentHash(source),
    preamble: source.slice(0, starts[0]?.start ?? source.length),
    sections,
  };
}

export function inspectPatchablePage(source: string): PatchablePage {
  const inspected = scanPatchablePage(source);
  return {
    pageHash: inspected.pageHash,
    preamble: inspected.preamble,
    sections: inspected.sections.map(({ heading, span, hash }) => ({ heading, span, hash })),
  };
}

function lineEndingFor(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeNewLines(source: string, lineEnding: string): string {
  return source.replace(/\r\n|\r|\n/g, lineEnding);
}

function trimOuterBlankLines(source: string, lineEnding: string): string {
  const lines = normalizeNewLines(source, "\n").split("\n");
  while (lines[0]?.trim().length === 0) lines.shift();
  while (lines.at(-1)?.trim().length === 0) lines.pop();
  return lines.join(lineEnding);
}

function trailingLineEndingCount(source: string): number {
  return source.match(/(?:\r\n|\n|\r)+$/)?.[0].match(/\r\n|\n|\r/g)?.length ?? 0;
}

function sectionSeparatorAfter(source: string, lineEnding: string): string {
  if (source.length === 0) return "";
  const trailingCount = trailingLineEndingCount(source);
  if (trailingCount >= 2) return "";
  if (trailingCount === 1) return lineEnding;
  return `${lineEnding}${lineEnding}`;
}

function finishWithOneTrailingNewline(source: string, lineEnding: string): string {
  return `${source.replace(/(?:\r\n|\n|\r)+$/, "")}${lineEnding}`;
}

function normalizeContentItem(source: string): string {
  return source.trim().replace(/\s+/g, " ");
}

function contentBlocks(source: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];

  for (const line of normalizeNewLines(source, "\n").split("\n")) {
    if (line.trim().length === 0) {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);
  return blocks;
}

function appendableContent(existingSpan: string, incoming: string, lineEnding: string): string {
  const firstNewline = existingSpan.search(/\r\n|\n|\r/);
  const existingBody = firstNewline === -1
    ? ""
    : existingSpan.slice(firstNewline + (existingSpan.startsWith("\r\n", firstNewline) ? 2 : 1));
  const existingLines = new Set(
    contentBlocks(existingBody).flat().map(normalizeContentItem),
  );
  const existingParagraphs = new Set(
    contentBlocks(existingBody).map((block) => normalizeContentItem(block.join("\n"))),
  );
  const additions: string[] = [];

  for (const block of contentBlocks(incoming)) {
    const paragraphKey = normalizeContentItem(block.join("\n"));
    if (existingParagraphs.has(paragraphKey)) continue;

    const newLines = block.filter((line) => {
      const key = normalizeContentItem(line);
      if (existingLines.has(key)) return false;
      existingLines.add(key);
      return true;
    });
    if (newLines.length === 0) continue;

    const newParagraphKey = normalizeContentItem(newLines.join("\n"));
    if (existingParagraphs.has(newParagraphKey)) continue;
    existingParagraphs.add(newParagraphKey);
    additions.push(newLines.join(lineEnding));
  }

  return additions.join(`${lineEnding}${lineEnding}`);
}

function sectionText(heading: string, content: string, lineEnding: string): string {
  const body = trimOuterBlankLines(content, lineEnding);
  return `${heading.trim()}${lineEnding}${body}`;
}

export function applyPagePatch(
  currentPage: string,
  patch: PatchPage,
  allowedReplaceHashes: ReadonlySet<string>,
): PatchApplyResult {
  if (contentHash(currentPage) !== patch.expectedPageHash) {
    return { ok: false, reason: "page_hash_mismatch" };
  }

  const lineEnding = lineEndingFor(currentPage);
  const changedHeadings: string[] = [];
  let content = currentPage;

  for (const requested of patch.sections) {
    const inspected = scanPatchablePage(content);
    const key = normalizeSectionHeading(requested.heading);
    const existing = inspected.sections.find((section) => section.key === key);

    if (requested.operation === "add") {
      if (existing) {
        return { ok: false, reason: "heading_exists", heading: requested.heading };
      }
      content += sectionSeparatorAfter(content, lineEnding);
      content += sectionText(requested.heading, requested.content, lineEnding);
      changedHeadings.push(requested.heading);
      continue;
    }

    if (!existing) {
      return { ok: false, reason: "heading_missing", heading: requested.heading };
    }

    if (requested.operation === "append") {
      const addition = appendableContent(existing.span, requested.content, lineEnding);
      if (addition.length === 0) continue;

      const before = sectionSeparatorAfter(existing.span, lineEnding);
      content = `${content.slice(0, existing.end)}${before}${addition}${lineEnding}${content.slice(existing.end)}`;
      changedHeadings.push(requested.heading);
      continue;
    }

    if (
      requested.expectedSectionHash === undefined
      || !allowedReplaceHashes.has(requested.expectedSectionHash)
    ) {
      return { ok: false, reason: "replace_context_missing", heading: requested.heading };
    }
    if (requested.expectedSectionHash !== existing.hash) {
      return { ok: false, reason: "section_hash_mismatch", heading: requested.heading };
    }

    const replacement = `${sectionText(requested.heading, requested.content, lineEnding)}${lineEnding}`;
    if (replacement !== existing.span) changedHeadings.push(requested.heading);
    content = `${content.slice(0, existing.start)}${replacement}${content.slice(existing.end)}`;
  }

  return {
    ok: true,
    content: finishWithOneTrailingNewline(content, lineEnding),
    changedHeadings,
  };
}
