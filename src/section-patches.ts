import { contentHash } from "./content-hash";

export interface CreatePage {
  kind: "create";
  path: string;
  annotation: string;
  content: string;
}

interface SectionPatchFields {
  heading: string;
  content: string;
}

export type SectionPatch =
  | (SectionPatchFields & {
    operation: "add";
    expectedSectionHash?: never;
  })
  | (SectionPatchFields & {
    operation: "append";
    expectedSectionHash?: string;
  })
  | (SectionPatchFields & {
    operation: "replace";
    expectedSectionHash: string;
    expectedSectionOrdinal?: number;
  });

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
  ordinal: number;
}

export interface ReplaceSectionAuthority {
  path: string;
  heading: string;
  sectionOrdinal: number;
  sectionHash: string;
  exactSection: string;
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

export interface SectionPatchValidationIssue {
  index: number;
  field: "sections" | "heading" | "content" | "operation" | "expectedSectionHash" | "expectedSectionOrdinal";
  message: string;
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

function isSingleH2Heading(value: string): boolean {
  return !/[\r\n]/.test(value)
    && /^##[ \t]+/.test(value)
    && normalizeSectionHeading(value).length > 0;
}

function nextLineEnd(source: string, offset: number): number {
  for (let index = offset; index < source.length; index++) {
    if (source[index] === "\n") return index + 1;
    if (source[index] === "\r") return source[index + 1] === "\n" ? index + 2 : index + 1;
  }
  return source.length;
}

function hasTopLevelH2OutsideFences(source: string): boolean {
  let fence: FenceState | null = null;
  let h2InUnclosedFence = false;
  let offset = 0;

  while (offset < source.length) {
    const end = nextLineEnd(source, offset);
    const line = withoutLineEnding(source.slice(offset, end));

    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
        h2InUnclosedFence = false;
      } else if (/^##[ \t]+/.test(line)) {
        h2InUnclosedFence = true;
      }
    } else {
      const opened = openingFence(line);
      if (opened) {
        fence = opened;
      } else if (/^##[ \t]+/.test(line)) {
        return true;
      }
    }

    offset = end;
  }

  return fence !== null && h2InUnclosedFence;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function validateSectionPatches(sections: unknown): SectionPatchValidationIssue[] {
  if (!Array.isArray(sections)) {
    return [{ index: -1, field: "sections", message: "sections must be an array" }];
  }

  const issues: SectionPatchValidationIssue[] = [];
  const headings = new Map<string, number>();

  sections.forEach((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ index, field: "sections", message: "section patch must be an object" });
      return;
    }
    const patch = value as Record<string, unknown>;

    if (typeof patch.heading !== "string" || !isSingleH2Heading(patch.heading)) {
      issues.push({
        index,
        field: "heading",
        message: 'heading must be one single-line H2 in the form "## <nonblank>"',
      });
    } else {
      const normalized = normalizeSectionHeading(patch.heading);
      const previousIndex = headings.get(normalized);
      if (previousIndex !== undefined) {
        issues.push({
          index,
          field: "heading",
          message: `duplicate normalized heading "${normalized}" (first used at sections[${previousIndex}])`,
        });
      } else {
        headings.set(normalized, index);
      }
    }

    if (typeof patch.content !== "string" || patch.content.trim().length === 0) {
      issues.push({ index, field: "content", message: "content must not be blank" });
    } else if (hasTopLevelH2OutsideFences(patch.content)) {
      issues.push({
        index,
        field: "content",
        message: "content must not contain a top-level H2 outside a valid fence",
      });
    }

    if (patch.operation !== "add" && patch.operation !== "append" && patch.operation !== "replace") {
      issues.push({ index, field: "operation", message: "operation must be add, append, or replace" });
      return;
    }

    if (patch.operation === "add" && hasOwn(patch, "expectedSectionHash")) {
      issues.push({
        index,
        field: "expectedSectionHash",
        message: "expectedSectionHash is forbidden for add",
      });
    }
    if (patch.operation !== "replace" && hasOwn(patch, "expectedSectionOrdinal")) {
      issues.push({
        index,
        field: "expectedSectionOrdinal",
        message: "expectedSectionOrdinal is only valid for replace",
      });
    }
    if (
      patch.operation === "append"
      && hasOwn(patch, "expectedSectionHash")
      && (typeof patch.expectedSectionHash !== "string" || patch.expectedSectionHash.trim().length === 0)
    ) {
      issues.push({
        index,
        field: "expectedSectionHash",
        message: "append expectedSectionHash must be a nonblank string when supplied",
      });
    }
    if (
      patch.operation === "replace"
      && (typeof patch.expectedSectionHash !== "string" || patch.expectedSectionHash.trim().length === 0)
    ) {
      issues.push({
        index,
        field: "expectedSectionHash",
        message: "replace requires a nonblank expectedSectionHash",
      });
    }
    if (
      patch.operation === "replace"
      && hasOwn(patch, "expectedSectionOrdinal")
      && (typeof patch.expectedSectionOrdinal !== "number"
        || !Number.isSafeInteger(patch.expectedSectionOrdinal)
        || patch.expectedSectionOrdinal < 0)
    ) {
      issues.push({
        index,
        field: "expectedSectionOrdinal",
        message: "expectedSectionOrdinal must be a nonnegative safe integer when supplied",
      });
    }
  });

  return issues;
}

function assertValidSectionPatches(sections: unknown): asserts sections is SectionPatch[] {
  const issues = validateSectionPatches(sections);
  if (issues.length === 0) return;
  const details = issues.map((issue) => {
    const location = issue.index < 0 ? issue.field : `sections[${issue.index}].${issue.field}`;
    return `${location}: ${issue.message}`;
  }).join("; ");
  throw new TypeError(`Invalid section patch input: ${details}`);
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
      ordinal: index,
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
    sections: inspected.sections.map(({ heading, span, hash, ordinal }) => ({ heading, span, hash, ordinal })),
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

function hasListMarker(block: string[]): boolean {
  return block.some((line) => /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line));
}

function hasIndentedContinuation(lines: string[], offset: number): boolean {
  for (let index = offset; index < lines.length; index++) {
    if (lines[index].trim().length === 0) continue;
    return /^(?: {2,}|\t)\S/.test(lines[index]);
  }
  return false;
}

function contentBlocks(source: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  let fence: FenceState | null = null;
  const lines = normalizeNewLines(source, "\n").split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      block.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const opened = openingFence(line);
    if (opened) {
      block.push(line);
      fence = opened;
      continue;
    }

    if (line.trim().length === 0) {
      if (hasListMarker(block) && hasIndentedContinuation(lines, index + 1)) {
        block.push(line);
        continue;
      }
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);
  return blocks;
}

function isStructuralBlock(block: string[]): boolean {
  if (block.some((line) => openingFence(line) !== null)) return true;
  if (block.length > 1 && block.some((line) => line.includes("|"))) return true;
  return block.some((line) => (
    /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(line)
    || /^ {0,3}>/.test(line)
    || /^#{3,6}[ \t]+/.test(line)
    || /^(?: {4,}|\t)[ \t]*\S/.test(line)
  ));
}

function normalizeStructuralBlock(block: string[]): string {
  return block.map((line) => line.replace(/[ \t]+$/, "")).join("\n");
}

function appendableContent(existingSpan: string, incoming: string, lineEnding: string): string {
  const firstNewline = existingSpan.search(/\r\n|\n|\r/);
  const existingBody = firstNewline === -1
    ? ""
    : existingSpan.slice(firstNewline + (existingSpan.startsWith("\r\n", firstNewline) ? 2 : 1));
  const existingBlocks = contentBlocks(existingBody);
  const existingLines = new Set(existingBlocks.flat().map(normalizeContentItem));
  const existingParagraphs = new Set(
    existingBlocks.map((block) => normalizeContentItem(block.join("\n"))),
  );
  const existingStructuralBlocks = new Set(
    existingBlocks.filter(isStructuralBlock).map(normalizeStructuralBlock),
  );
  const additions: string[] = [];

  for (const block of contentBlocks(incoming)) {
    if (isStructuralBlock(block)) {
      const structuralKey = normalizeStructuralBlock(block);
      if (existingStructuralBlocks.has(structuralKey)) continue;
      existingStructuralBlocks.add(structuralKey);
      for (const line of block) {
        if (line.trim().length > 0) existingLines.add(normalizeContentItem(line));
      }
      additions.push(block.join(lineEnding));
      continue;
    }

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

function resolveExistingSection(
  sections: ScannedSection[],
  requested: SectionPatch,
): ScannedSection | undefined {
  const key = normalizeSectionHeading(requested.heading);
  const matches = sections.filter((section) => section.key === key);
  if (requested.operation === "replace" && requested.expectedSectionOrdinal !== undefined) {
    const ordinalMatches = matches.filter((section) => section.ordinal === requested.expectedSectionOrdinal);
    return ordinalMatches.length === 1 ? ordinalMatches[0] : undefined;
  }
  if (matches.length <= 1) return matches[0];

  if (requested.operation === "replace") {
    const hashMatches = matches.filter((section) => section.hash === requested.expectedSectionHash);
    if (hashMatches.length === 1) return hashMatches[0];
  }

  throw new TypeError(
    `Ambiguous existing heading "${requested.heading}": ${matches.length} normalized matches`,
  );
}

function authorityMatches(
  authority: ReplaceSectionAuthority,
  path: string,
  requested: SectionPatch,
  existing: ScannedSection,
): boolean {
  const expectedOrdinal = requested.operation === "replace"
    ? requested.expectedSectionOrdinal
    : undefined;
  return authority.path === path
    && normalizeSectionHeading(authority.heading) === existing.key
    && (expectedOrdinal === undefined || authority.sectionOrdinal === expectedOrdinal)
    && authority.sectionOrdinal === existing.ordinal
    && authority.sectionHash === requested.expectedSectionHash
    && authority.sectionHash === existing.hash
    && authority.exactSection === existing.span;
}

function findReplaceAuthority(
  authorities: readonly ReplaceSectionAuthority[],
  path: string,
  requested: SectionPatch,
  existing: ScannedSection,
): ReplaceSectionAuthority | undefined {
  return authorities.find((authority) => authorityMatches(authority, path, requested, existing));
}

export function applyPagePatch(
  currentPage: string,
  patch: PatchPage,
  replaceAuthorities: readonly ReplaceSectionAuthority[],
): PatchApplyResult {
  assertValidSectionPatches(patch.sections);
  if (contentHash(currentPage) !== patch.expectedPageHash) {
    return { ok: false, reason: "page_hash_mismatch" };
  }

  const original = scanPatchablePage(currentPage);
  for (const requested of patch.sections) {
    if (requested.operation === "add") continue;
    const existing = resolveExistingSection(original.sections, requested);
    if (requested.operation === "replace") {
      if (!existing) return { ok: false, reason: "heading_missing", heading: requested.heading };
      if (!findReplaceAuthority(replaceAuthorities, patch.path, requested, existing)) {
        return { ok: false, reason: "replace_context_missing", heading: requested.heading };
      }
    }
  }

  const lineEnding = lineEndingFor(currentPage);
  const changedHeadings: string[] = [];
  let content = currentPage;

  for (const requested of patch.sections) {
    const inspected = scanPatchablePage(content);
    const key = normalizeSectionHeading(requested.heading);
    const matches = inspected.sections.filter((section) => section.key === key);

    if (requested.operation === "add") {
      if (matches.length > 0) {
        return { ok: false, reason: "heading_exists", heading: requested.heading };
      }
      content += sectionSeparatorAfter(content, lineEnding);
      content += sectionText(requested.heading, requested.content, lineEnding);
      changedHeadings.push(requested.heading);
      continue;
    }

    const existing = resolveExistingSection(inspected.sections, requested);
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

    if (requested.expectedSectionHash === undefined || !findReplaceAuthority(
      replaceAuthorities,
      patch.path,
      requested,
      existing,
    )) {
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
