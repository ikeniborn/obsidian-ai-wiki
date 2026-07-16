import { contentHash } from "./content-hash";

export interface SourceChunk {
  id: string;
  headingPath: string[];
  ordinal: number;
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
}

export interface MarkdownSection {
  heading: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
}

export interface MarkdownChunkOptions {
  maxEstimatedTokens: number;
  overlapLines: number;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
  openingLine: string;
  closingLine: string;
}

interface HeadingState {
  level: number;
  heading: string;
}

interface ScannedLine {
  raw: string;
  heading?: string;
  headingPath: string[];
  fenceBefore: FenceState | null;
  fenceAfter: FenceState | null;
}

interface SourceRange {
  startIndex: number;
  endIndex: number;
  headingPath: string[];
  windowed: boolean;
}

const encoder = new TextEncoder();

function splitSourceLines(source: string): string[] {
  return source.length === 0 ? [] : source.split("\n");
}

function lineForSyntax(raw: string): string {
  return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
}

function parseOpeningFence(raw: string): FenceState | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lineForSyntax(raw));
  if (!match) return null;
  const delimiter = match[2];
  const marker = delimiter[0] as "`" | "~";
  return {
    marker,
    length: delimiter.length,
    openingLine: raw,
    closingLine: marker.repeat(delimiter.length) + (raw.endsWith("\r") ? "\r" : ""),
  };
}

function closesFence(raw: string, fence: FenceState): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(lineForSyntax(raw));
  return match !== null
    && match[2][0] === fence.marker
    && match[2].length >= fence.length;
}

function parseHeading(raw: string): HeadingState | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(lineForSyntax(raw));
  if (!match) return null;
  const heading = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { level: match[1].length, heading };
}

function scanLines(lines: string[]): ScannedLine[] {
  const scanned: ScannedLine[] = [];
  const headings: HeadingState[] = [];
  let activeFence: FenceState | null = null;

  for (const raw of lines) {
    const fenceBefore = activeFence;
    let heading: string | undefined;

    if (activeFence) {
      if (closesFence(raw, activeFence)) activeFence = null;
    } else {
      const openingFence = parseOpeningFence(raw);
      if (openingFence) {
        activeFence = openingFence;
      } else {
        const parsedHeading = parseHeading(raw);
        if (parsedHeading) {
          while (headings.length > 0 && headings[headings.length - 1].level >= parsedHeading.level) {
            headings.pop();
          }
          headings.push(parsedHeading);
          heading = parsedHeading.heading;
        }
      }
    }

    scanned.push({
      raw,
      heading,
      headingPath: headings.map((entry) => entry.heading),
      fenceBefore,
      fenceAfter: activeFence,
    });
  }

  return scanned;
}

function rawRangeMarkdown(lines: ScannedLine[], startIndex: number, endIndex: number): string {
  return lines.slice(startIndex, endIndex + 1).map((line) => line.raw).join("\n");
}

function renderRangeMarkdown(lines: ScannedLine[], range: SourceRange): string {
  let markdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
  if (!range.windowed) return markdown;

  const openingFence = lines[range.startIndex].fenceBefore;
  const closingFence = lines[range.endIndex].fenceAfter;
  if (openingFence) markdown = `${openingFence.openingLine}\n${markdown}`;
  if (closingFence) markdown = `${markdown}\n${closingFence.closingLine}`;
  return markdown;
}

function estimateTokens(markdown: string): number {
  return encoder.encode(markdown).byteLength;
}

function buildSections(lines: ScannedLine[]): MarkdownSection[] {
  if (lines.length === 0) return [];

  const starts = [0];
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].heading !== undefined) starts.push(index);
  }

  return starts.map((startIndex, index) => {
    const endIndex = (starts[index + 1] ?? lines.length) - 1;
    const markdown = rawRangeMarkdown(lines, startIndex, endIndex);
    return {
      heading: lines[startIndex].heading ?? "",
      headingPath: [...lines[startIndex].headingPath],
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      markdown,
      contentHash: contentHash(markdown),
    };
  });
}

function isBlankOutsideFence(line: ScannedLine): boolean {
  return line.fenceBefore === null
    && line.fenceAfter === null
    && lineForSyntax(line.raw).trim().length === 0;
}

function splitParagraphRanges(
  lines: ScannedLine[],
  section: MarkdownSection,
): SourceRange[] {
  const ranges: SourceRange[] = [];
  const sectionStart = section.startLine - 1;
  const sectionEnd = section.endLine - 1;
  let paragraphStart = sectionStart;

  for (let index = sectionStart; index <= sectionEnd; index++) {
    if (!isBlankOutsideFence(lines[index])) continue;
    let separatorEnd = index;
    while (separatorEnd < sectionEnd && isBlankOutsideFence(lines[separatorEnd + 1])) {
      separatorEnd += 1;
    }
    ranges.push({
      startIndex: paragraphStart,
      endIndex: separatorEnd,
      headingPath: [...section.headingPath],
      windowed: false,
    });
    paragraphStart = separatorEnd + 1;
    index = separatorEnd;
  }

  if (paragraphStart <= sectionEnd) {
    ranges.push({
      startIndex: paragraphStart,
      endIndex: sectionEnd,
      headingPath: [...section.headingPath],
      windowed: false,
    });
  }

  return ranges;
}

function splitLineWindows(
  lines: ScannedLine[],
  range: SourceRange,
  options: MarkdownChunkOptions,
): SourceRange[] {
  const windows: SourceRange[] = [];
  let startIndex = range.startIndex;

  while (startIndex <= range.endIndex) {
    let endIndex = startIndex;
    for (let candidate = startIndex; candidate <= range.endIndex; candidate++) {
      const candidateRange = {
        startIndex,
        endIndex: candidate,
        headingPath: range.headingPath,
        windowed: true,
      };
      if (estimateTokens(renderRangeMarkdown(lines, candidateRange)) > options.maxEstimatedTokens) {
        if (candidate === startIndex) endIndex = candidate;
        break;
      }
      endIndex = candidate;
    }

    windows.push({
      startIndex,
      endIndex,
      headingPath: [...range.headingPath],
      windowed: true,
    });
    if (endIndex === range.endIndex) break;
    startIndex = Math.max(startIndex + 1, endIndex - options.overlapLines + 1);
  }

  return windows;
}

function validateOptions(options: MarkdownChunkOptions): void {
  if (!Number.isFinite(options.maxEstimatedTokens) || options.maxEstimatedTokens <= 0) {
    throw new RangeError("maxEstimatedTokens must be a positive finite number");
  }
  if (!Number.isInteger(options.overlapLines) || options.overlapLines < 0) {
    throw new RangeError("overlapLines must be a non-negative integer");
  }
}

export function chunkMarkdownSource(
  source: string,
  options: MarkdownChunkOptions,
): SourceChunk[] {
  validateOptions(options);
  const sourceLines = splitSourceLines(source);
  if (sourceLines.length === 0) return [];

  const lines = scanLines(sourceLines);
  let ranges: SourceRange[];

  if (estimateTokens(source) <= options.maxEstimatedTokens) {
    ranges = [{
      startIndex: 0,
      endIndex: lines.length - 1,
      headingPath: [...lines[0].headingPath],
      windowed: false,
    }];
  } else {
    ranges = [];
    for (const section of buildSections(lines)) {
      const sectionRange: SourceRange = {
        startIndex: section.startLine - 1,
        endIndex: section.endLine - 1,
        headingPath: [...section.headingPath],
        windowed: false,
      };
      if (estimateTokens(section.markdown) <= options.maxEstimatedTokens) {
        ranges.push(sectionRange);
        continue;
      }

      for (const paragraph of splitParagraphRanges(lines, section)) {
        const markdown = renderRangeMarkdown(lines, paragraph);
        if (estimateTokens(markdown) <= options.maxEstimatedTokens) {
          ranges.push(paragraph);
        } else {
          ranges.push(...splitLineWindows(lines, paragraph, options));
        }
      }
    }
  }

  return ranges.map((range, ordinal) => {
    const rawMarkdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
    const hash = contentHash(rawMarkdown);
    return {
      id: `${ordinal}:${range.startIndex + 1}-${range.endIndex + 1}:${hash}`,
      headingPath: [...range.headingPath],
      ordinal,
      startLine: range.startIndex + 1,
      endLine: range.endIndex + 1,
      markdown: renderRangeMarkdown(lines, range),
      contentHash: hash,
    };
  });
}

function markdownWithoutSyntheticFenceWrappers(
  lines: ScannedLine[],
  chunk: SourceChunk,
): string {
  let markdown = chunk.markdown;
  const startIndex = chunk.startLine - 1;
  const endIndex = chunk.endLine - 1;
  const openingFence = lines[startIndex].fenceBefore;
  const closingFence = lines[endIndex].fenceAfter;

  if (openingFence) {
    const prefix = `${openingFence.openingLine}\n`;
    if (markdown.startsWith(prefix)) markdown = markdown.slice(prefix.length);
  }
  if (closingFence) {
    const suffix = `\n${closingFence.closingLine}`;
    if (markdown.endsWith(suffix)) markdown = markdown.slice(0, -suffix.length);
  }
  return markdown;
}

export function assertCompleteSourceCoverage(source: string, chunks: SourceChunk[]): void {
  const sourceLines = splitSourceLines(source);
  const covered = Array.from({ length: sourceLines.length }, () => false);

  for (const chunk of chunks) {
    if (
      !Number.isInteger(chunk.startLine)
      || !Number.isInteger(chunk.endLine)
      || chunk.startLine < 1
      || chunk.endLine < chunk.startLine
      || chunk.endLine > sourceLines.length
    ) {
      throw new Error(
        `Chunk ${chunk.id} range ${chunk.startLine}-${chunk.endLine} is outside source lines 1-${sourceLines.length}`,
      );
    }
    for (let line = chunk.startLine; line <= chunk.endLine; line++) covered[line - 1] = true;
  }

  const missingIndex = covered.indexOf(false);
  if (missingIndex !== -1) throw new Error(`Missing source coverage at line ${missingIndex + 1}`);

  const lines = scanLines(sourceLines);
  for (const chunk of chunks) {
    const markdown = markdownWithoutSyntheticFenceWrappers(lines, chunk);
    if (contentHash(markdown) !== chunk.contentHash) {
      throw new Error(`Content hash mismatch for chunk ${chunk.id}`);
    }
  }
}
