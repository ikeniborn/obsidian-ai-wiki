import { contentHash } from "./content-hash";
import { inspectPatchablePage } from "./section-patches";
import { cappedTokens, measureText, SYMBOL_RUN_TOKENS } from "./token-estimate";
import type { TextMeasure } from "./token-estimate";

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

export interface CompleteH2Section {
  heading: string;
  markdown: string;
  ordinal: number;
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
  openingMeasure: TextMeasure;
  closingLine: string;
  closingMeasure: TextMeasure;
}

interface HeadingState {
  level: number;
  heading: string;
}

interface ScannedLine {
  raw: string;
  measure: TextMeasure;
  heading?: string;
  headingPath: string[];
  fenceBefore: FenceState | null;
  fenceAfter: FenceState | null;
}

interface SourceRange {
  startIndex: number;
  endIndex: number;
  headingPath: string[];
}

function splitSourceLines(source: string): string[] {
  return source.length === 0 ? [] : source.split("\n");
}

function lineForSyntax(raw: string): string {
  return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
}

function parseOpeningFence(raw: string, openingMeasure: TextMeasure): FenceState | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lineForSyntax(raw));
  if (!match) return null;
  const delimiter = match[2];
  const marker = delimiter[0] as "`" | "~";
  const closingLine = marker.repeat(delimiter.length) + (raw.endsWith("\r") ? "\r" : "");
  return {
    marker,
    length: delimiter.length,
    openingLine: raw,
    openingMeasure,
    closingLine,
    closingMeasure: measureText(closingLine),
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
    const measure = measureText(raw);
    const fenceBefore = activeFence;
    let heading: string | undefined;

    if (activeFence) {
      if (closesFence(raw, activeFence)) activeFence = null;
    } else {
      const openingFence = parseOpeningFence(raw, measure);
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
      measure,
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

/** Running sums of the unrounded, uncapped per-line parts. */
interface LinePrefixes {
  raw: number[];
  bytes: number[];
}

function buildLinePrefixes(lines: ScannedLine[]): LinePrefixes {
  const prefixes: LinePrefixes = { raw: [0], bytes: [0] };
  for (const line of lines) {
    prefixes.raw.push(prefixes.raw[prefixes.raw.length - 1] + line.measure.raw);
    prefixes.bytes.push(prefixes.bytes[prefixes.bytes.length - 1] + line.measure.bytes);
  }
  return prefixes;
}

function rawRangeMeasure(
  prefixes: LinePrefixes,
  startIndex: number,
  endIndex: number,
): TextMeasure {
  // Per-line parts plus the line breaks that join them: a newline costs the
  // estimator's run charge and one UTF-8 byte. Neither part is rounded or
  // capped here. Capping per line and adding would let the sum fall below
  // `estimateText` of the joined text, because a line whose own class sum is
  // capped donates its whole overage to the window — a numeric line next to a
  // prose line is enough — and the window would then render above its budget.
  const breaks = endIndex - startIndex;
  return {
    raw: prefixes.raw[endIndex + 1] - prefixes.raw[startIndex] + breaks * SYMBOL_RUN_TOKENS,
    bytes: prefixes.bytes[endIndex + 1] - prefixes.bytes[startIndex] + breaks,
  };
}

function renderedRangeEstimatedTokens(
  lines: ScannedLine[],
  prefixes: LinePrefixes,
  range: SourceRange,
): number {
  const measure = rawRangeMeasure(prefixes, range.startIndex, range.endIndex);
  const openingFence = lines[range.startIndex].fenceBefore;
  const closingFence = lines[range.endIndex].fenceAfter;
  // A synthetic wrapper line costs its own parts plus the break that joins it.
  if (openingFence) {
    measure.raw += openingFence.openingMeasure.raw + SYMBOL_RUN_TOKENS;
    measure.bytes += openingFence.openingMeasure.bytes + 1;
  }
  if (closingFence) {
    measure.raw += closingFence.closingMeasure.raw + SYMBOL_RUN_TOKENS;
    measure.bytes += closingFence.closingMeasure.bytes + 1;
  }
  // Capped once, over the whole rendered range, exactly as estimateText caps it.
  return Math.ceil(cappedTokens(measure));
}

function renderRangeMarkdown(lines: ScannedLine[], range: SourceRange): string {
  let markdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
  const openingFence = lines[range.startIndex].fenceBefore;
  const closingFence = lines[range.endIndex].fenceAfter;
  if (openingFence) markdown = `${openingFence.openingLine}\n${markdown}`;
  if (closingFence) markdown = `${markdown}\n${closingFence.closingLine}`;
  return markdown;
}

function buildSections(lines: ScannedLine[]): MarkdownSection[] {
  if (lines.length === 0) return [];

  const headingIndexes: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].heading !== undefined) headingIndexes.push(index);
  }

  const starts: Array<{ startIndex: number; headingIndex?: number }> = [];
  const firstHeadingIndex = headingIndexes[0];
  if (firstHeadingIndex === undefined) {
    starts.push({ startIndex: 0 });
  } else if (firstHeadingIndex === 0) {
    starts.push({ startIndex: 0, headingIndex: 0 });
  } else {
    const preambleIsBlank = lines
      .slice(0, firstHeadingIndex)
      .every((line) => lineForSyntax(line.raw).trim().length === 0);
    if (preambleIsBlank) {
      starts.push({ startIndex: 0, headingIndex: firstHeadingIndex });
    } else {
      starts.push({ startIndex: 0 });
      starts.push({ startIndex: firstHeadingIndex, headingIndex: firstHeadingIndex });
    }
  }
  for (const headingIndex of headingIndexes.slice(1)) {
    starts.push({ startIndex: headingIndex, headingIndex });
  }

  return starts.map((start, index) => {
    const endIndex = (starts[index + 1]?.startIndex ?? lines.length) - 1;
    const headingLine = lines[start.headingIndex ?? start.startIndex];
    const markdown = rawRangeMarkdown(lines, start.startIndex, endIndex);
    return {
      heading: headingLine.heading ?? "",
      headingPath: [...headingLine.headingPath],
      startLine: start.startIndex + 1,
      endLine: endIndex + 1,
      markdown,
      contentHash: contentHash(markdown),
    };
  });
}

/**
 * Extracts sections delimited by ATX headings only. Setext underlines remain paragraph text.
 */
export function extractMarkdownSections(source: string): MarkdownSection[] {
  const sourceLines = splitSourceLines(source);
  return sourceLines.length === 0 ? [] : buildSections(scanLines(sourceLines));
}

/** Returns complete, lossless H2-delimited spans, including their original line endings. */
export function extractCompleteH2Sections(source: string): CompleteH2Section[] {
  return inspectPatchablePage(source).sections.map((section) => ({
    heading: section.heading,
    markdown: section.span,
    ordinal: section.ordinal,
    contentHash: section.hash,
  }));
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
  let scanStart = sectionStart;
  while (scanStart <= sectionEnd && isBlankOutsideFence(lines[scanStart])) scanStart += 1;

  for (let index = scanStart; index <= sectionEnd; index++) {
    if (!isBlankOutsideFence(lines[index])) continue;
    let separatorEnd = index;
    while (separatorEnd < sectionEnd && isBlankOutsideFence(lines[separatorEnd + 1])) {
      separatorEnd += 1;
    }
    ranges.push({
      startIndex: paragraphStart,
      endIndex: separatorEnd,
      headingPath: [...section.headingPath],
    });
    paragraphStart = separatorEnd + 1;
    index = separatorEnd;
  }

  if (paragraphStart <= sectionEnd) {
    ranges.push({
      startIndex: paragraphStart,
      endIndex: sectionEnd,
      headingPath: [...section.headingPath],
    });
  }

  return ranges;
}

function splitLineWindows(
  lines: ScannedLine[],
  prefixes: LinePrefixes,
  range: SourceRange,
  options: MarkdownChunkOptions,
): SourceRange[] {
  const windows: SourceRange[] = [];
  let startIndex = range.startIndex;

  while (startIndex <= range.endIndex) {
    const minimumRange = {
      startIndex,
      endIndex: startIndex,
      headingPath: range.headingPath,
    };
    const minimumTokens = renderedRangeEstimatedTokens(lines, prefixes, minimumRange);
    if (minimumTokens > options.maxEstimatedTokens) {
      throw new RangeError(
        `Source range ${startIndex + 1}-${startIndex + 1} requires ${minimumTokens} estimated tokens but budget is ${options.maxEstimatedTokens}`,
      );
    }

    let low = startIndex;
    let high = range.endIndex;
    let endIndex = startIndex;
    while (low <= high) {
      const candidate = low + Math.floor((high - low) / 2);
      const candidateRange = {
        startIndex,
        endIndex: candidate,
        headingPath: range.headingPath,
      };
      if (renderedRangeEstimatedTokens(lines, prefixes, candidateRange) <= options.maxEstimatedTokens) {
        endIndex = candidate;
        low = candidate + 1;
      } else {
        high = candidate - 1;
      }
    }

    windows.push({
      startIndex,
      endIndex,
      headingPath: [...range.headingPath],
    });
    if (endIndex === range.endIndex) break;
    if (options.overlapLines >= endIndex - startIndex + 1) {
      throw new RangeError(
        `overlapLines ${options.overlapLines} prevents progress after source range ${startIndex + 1}-${endIndex + 1}`,
      );
    }
    startIndex = endIndex - options.overlapLines + 1;
  }

  return windows;
}

function coalesceBlankOnlyRanges(
  lines: ScannedLine[],
  prefixes: LinePrefixes,
  inputRanges: SourceRange[],
  budget: number,
): SourceRange[] {
  const ranges = inputRanges.map((range) => ({ ...range, headingPath: [...range.headingPath] }));
  let index = 0;

  while (index < ranges.length) {
    if (renderRangeMarkdown(lines, ranges[index]).trim().length > 0) {
      index += 1;
      continue;
    }
    if (ranges.length === 1 && renderRangeMarkdown(lines, ranges[index]).length > 0) return ranges;

    let runEnd = index;
    while (
      runEnd + 1 < ranges.length
      && renderRangeMarkdown(lines, ranges[runEnd + 1]).trim().length === 0
    ) {
      runEnd += 1;
    }
    const blankStart = ranges[index].startIndex;
    const blankEnd = ranges[runEnd].endIndex;

    if (index > 0) {
      const previous = ranges[index - 1];
      const merged: SourceRange = {
        startIndex: previous.startIndex,
        endIndex: Math.max(previous.endIndex, blankEnd),
        headingPath: [...previous.headingPath],
      };
      if (renderedRangeEstimatedTokens(lines, prefixes, merged) <= budget) {
        ranges.splice(index - 1, runEnd - index + 2, merged);
        index = Math.max(0, index - 1);
        continue;
      }
    }

    const next = ranges[runEnd + 1];
    if (next) {
      const merged: SourceRange = {
        startIndex: Math.min(blankStart, next.startIndex),
        endIndex: next.endIndex,
        headingPath: [...next.headingPath],
      };
      if (renderedRangeEstimatedTokens(lines, prefixes, merged) <= budget) {
        ranges.splice(index, runEnd - index + 2, merged);
        continue;
      }
    }

    throw new RangeError(
      `Blank source range ${blankStart + 1}-${blankEnd + 1} cannot be coalesced with an adjacent range within budget ${budget}`,
    );
  }

  return ranges;
}

function validateOptions(options: MarkdownChunkOptions): void {
  if (!Number.isSafeInteger(options.maxEstimatedTokens) || options.maxEstimatedTokens <= 0) {
    throw new RangeError("maxEstimatedTokens must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.overlapLines) || options.overlapLines < 0) {
    throw new RangeError("overlapLines must be a non-negative safe integer");
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
  const prefixes = buildLinePrefixes(lines);
  let ranges: SourceRange[];

  const fullRange: SourceRange = {
      startIndex: 0,
      endIndex: lines.length - 1,
      headingPath: [...lines[0].headingPath],
  };
  if (renderedRangeEstimatedTokens(lines, prefixes, fullRange) <= options.maxEstimatedTokens) {
    ranges = [fullRange];
  } else {
    ranges = [];
    for (const section of buildSections(lines)) {
      const sectionRange: SourceRange = {
        startIndex: section.startLine - 1,
        endIndex: section.endLine - 1,
        headingPath: [...section.headingPath],
      };
      if (renderedRangeEstimatedTokens(lines, prefixes, sectionRange) <= options.maxEstimatedTokens) {
        ranges.push(sectionRange);
        continue;
      }

      for (const paragraph of splitParagraphRanges(lines, section)) {
        if (renderedRangeEstimatedTokens(lines, prefixes, paragraph) <= options.maxEstimatedTokens) {
          ranges.push(paragraph);
        } else {
          ranges.push(...splitLineWindows(lines, prefixes, paragraph, options));
        }
      }
    }
  }

  ranges = coalesceBlankOnlyRanges(lines, prefixes, ranges, options.maxEstimatedTokens);

  return ranges.map((range, ordinal) => {
    const rawMarkdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
    const markdown = renderRangeMarkdown(lines, range);
    const requiredTokens = renderedRangeEstimatedTokens(lines, prefixes, range);
    if (requiredTokens > options.maxEstimatedTokens) {
      throw new RangeError(
        `Source range ${range.startIndex + 1}-${range.endIndex + 1} requires ${requiredTokens} estimated tokens but budget is ${options.maxEstimatedTokens}`,
      );
    }
    const hash = contentHash(rawMarkdown);
    return {
      id: `${ordinal}:${range.startIndex + 1}-${range.endIndex + 1}:${hash}`,
      headingPath: [...range.headingPath],
      ordinal,
      startLine: range.startIndex + 1,
      endLine: range.endIndex + 1,
      markdown,
      contentHash: hash,
    };
  });
}

export function createSourceChunkRangeFactory(source: string): (
  startLine: number,
  endLine: number,
  ordinal: number,
  headingPath?: string[],
) => SourceChunk {
  const sourceLines = splitSourceLines(source);
  const lines = scanLines(sourceLines);
  return (startLine, endLine, ordinal, headingPath) => {
    if (
      !Number.isInteger(startLine)
      || !Number.isInteger(endLine)
      || !Number.isInteger(ordinal)
      || startLine < 1
      || endLine < startLine
      || endLine > sourceLines.length
    ) {
      throw new RangeError(`Source range ${startLine}-${endLine} is outside source lines 1-${sourceLines.length}`);
    }
    const range: SourceRange = {
      startIndex: startLine - 1,
      endIndex: endLine - 1,
      headingPath: headingPath ?? [...lines[startLine - 1].headingPath],
    };
    const rawMarkdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
    const markdown = renderRangeMarkdown(lines, range);
    const hash = contentHash(rawMarkdown);
    return {
      id: `${ordinal}:${startLine}-${endLine}:${hash}`,
      headingPath: [...range.headingPath],
      ordinal,
      startLine,
      endLine,
      markdown,
      contentHash: hash,
    };
  };
}

export function createSourceChunkForRange(
  source: string,
  startLine: number,
  endLine: number,
  ordinal: number,
  headingPath?: string[],
): SourceChunk {
  return createSourceChunkRangeFactory(source)(startLine, endLine, ordinal, headingPath);
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
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk.ordinal !== index) {
      throw new Error(`Chunk ordinal ${chunk.ordinal} does not match array position ${index}`);
    }

    const range: SourceRange = {
      startIndex: chunk.startLine - 1,
      endIndex: chunk.endLine - 1,
      headingPath: chunk.headingPath,
    };
    const expectedMarkdown = renderRangeMarkdown(lines, range);
    if (chunk.markdown !== expectedMarkdown) {
      throw new Error(
        `Chunk ${index} markdown does not match source range ${chunk.startLine}-${chunk.endLine}`,
      );
    }

    const sourceMarkdown = rawRangeMarkdown(lines, range.startIndex, range.endIndex);
    const expectedHash = contentHash(sourceMarkdown);
    if (chunk.contentHash !== expectedHash) {
      throw new Error(
        `Chunk ${index} content hash ${chunk.contentHash} does not match source range ${chunk.startLine}-${chunk.endLine} hash ${expectedHash}`,
      );
    }

    const expectedId = `${index}:${chunk.startLine}-${chunk.endLine}:${expectedHash}`;
    if (chunk.id !== expectedId) {
      throw new Error(`Chunk id ${chunk.id} does not match expected ${expectedId}`);
    }
  }
}
