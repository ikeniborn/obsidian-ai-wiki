import { contentHash } from "../content-hash";

export interface FormatSegment {
  id: string;
  ordinal: number;
  headingPath: string[];
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
  visionDescriptions: Map<string, string>;
}

export interface FormatSegmentOutput {
  segmentId: string;
  report: string;
  formatted: string;
}

interface FrontmatterSplit {
  frontmatter: string;
  body: string;
  bodyStartLine: number;
}

const FRONTMATTER_RE = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export function segmentFormatInput(
  source: string,
  visionDescriptions: Map<string, string>,
  maxMarkdownChars: number,
): FormatSegment[] {
  if (source.length <= maxMarkdownChars) {
    return [makeSegment("segment-0", 0, [], 1, lineCount(source), source, visionDescriptions)];
  }

  const split = splitFrontmatter(source);
  const bodySegments = splitMarkdownBody(split.body, maxMarkdownChars, split.bodyStartLine);
  return bodySegments.map((body, index) => makeSegment(
    `segment-${index}`,
    index,
    headingPathOf(body.markdown),
    body.startLine,
    body.endLine,
    body.markdown,
    routedVision(body.markdown, visionDescriptions),
  ));
}

export function splitFormatSegment(segment: FormatSegment, maxMarkdownChars: number): FormatSegment[] {
  if (segment.markdown.length <= maxMarkdownChars) return [segment];
  return splitMarkdownBody(segment.markdown, maxMarkdownChars, segment.startLine).map((body, index) => makeSegment(
    `${segment.id}-${index}`,
    index,
    headingPathOf(body.markdown),
    body.startLine,
    body.endLine,
    body.markdown,
    routedVision(body.markdown, segment.visionDescriptions),
  ));
}

export function reassembleFormatSegments(
  source: string,
  segments: readonly FormatSegment[],
  outputs: readonly FormatSegmentOutput[],
): { report: string; formatted: string } {
  const byId = new Map<string, FormatSegmentOutput>();
  for (const output of outputs) {
    if (byId.has(output.segmentId)) throw new Error(`duplicate segment output: ${output.segmentId}`);
    byId.set(output.segmentId, output);
  }

  const ordered = [...segments].sort((a, b) => a.ordinal - b.ordinal);
  const missing = ordered.filter((segment) => !byId.has(segment.id));
  if (missing.length > 0) throw new Error(`missing segment output: ${missing.map((s) => s.id).join(", ")}`);
  if (byId.size !== ordered.length) throw new Error("unexpected segment output count");

  if (ordered.length === 1 && ordered[0].markdown === source) {
    const only = byId.get(ordered[0].id)!;
    return { report: only.report, formatted: only.formatted };
  }

  const reports: string[] = [];
  const bodies: string[] = [];
  for (const segment of ordered) {
    if (contentHash(segment.markdown) !== segment.contentHash) {
      throw new Error(`segment source changed before reassembly: ${segment.id}`);
    }
    const output = byId.get(segment.id)!;
    reports.push(output.report);
    bodies.push(stripModelAddedLeadingYamlFrontmatter(output.formatted, segment.markdown));
  }

  const { frontmatter } = splitFrontmatter(source);
  return {
    report: reports.join("\n"),
    formatted: `${frontmatter}${bodies.join("")}`,
  };
}

function makeSegment(
  id: string,
  ordinal: number,
  headingPath: string[],
  startLine: number,
  endLine: number,
  markdown: string,
  allVisionDescriptions: Map<string, string>,
): FormatSegment {
  return {
    id,
    ordinal,
    headingPath,
    startLine,
    endLine,
    markdown,
    contentHash: contentHash(markdown),
    visionDescriptions: routedVision(markdown, allVisionDescriptions),
  };
}

function splitFrontmatter(source: string): FrontmatterSplit {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { frontmatter: "", body: source, bodyStartLine: 1 };
  return {
    frontmatter: match[0],
    body: source.slice(match[0].length),
    bodyStartLine: lineCount(match[0]) + 1,
  };
}

function stripModelAddedLeadingYamlFrontmatter(markdown: string, sourceSegment: string): string {
  const sourceLeadingBlock = leadingDelimiterBlock(sourceSegment);
  if (sourceLeadingBlock && markdown.startsWith(sourceLeadingBlock)) return markdown;
  const match = leadingDelimiterBlock(markdown);
  if (!match) return markdown;
  if (!looksLikeYamlFrontmatter(match)) return markdown;
  return markdown.slice(match.length);
}

function leadingDelimiterBlock(markdown: string): string | null {
  const match = /^(?:\uFEFF)?---(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)---(?:\r\n|\n|\r|$)/.exec(markdown);
  return match?.[0] ?? null;
}

function looksLikeYamlFrontmatter(block: string): boolean {
  return /(?:^|\r\n|\n|\r)[A-Za-z0-9_-]+:\s*/.test(block);
}

interface BodyChunk {
  markdown: string;
  startLine: number;
  endLine: number;
}

function splitMarkdownBody(body: string, maxMarkdownChars: number, startLine: number): BodyChunk[] {
  const lines = splitLines(body);
  if (lines.length === 0) return [{ markdown: "", startLine, endLine: startLine }];

  const blocks = sectionBlocks(lines, startLine);
  const chunks: BodyChunk[] = [];
  for (const block of blocks) {
    if (block.markdown.length <= maxMarkdownChars) {
      chunks.push(block);
    } else {
      chunks.push(...lineWindows(block, maxMarkdownChars));
    }
  }
  return chunks;
}

function sectionBlocks(lines: string[], startLine: number): BodyChunk[] {
  const starts: number[] = [];
  let fence: Fence | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lineForSyntax(lines[index]);
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = openingFence(line);
    if (opening) {
      fence = opening;
      continue;
    }
    if (/^##\s+/.test(line)) starts.push(index);
  }
  if (starts.length === 0) return [chunkFromLines(lines, 0, lines.length, startLine)];

  const chunks: BodyChunk[] = [];
  if (starts[0] > 0) chunks.push(chunkFromLines(lines, 0, starts[0], startLine));
  for (let i = 0; i < starts.length; i++) {
    chunks.push(chunkFromLines(lines, starts[i], starts[i + 1] ?? lines.length, startLine));
  }
  return chunks.filter((chunk) => chunk.markdown.length > 0);
}

function lineWindows(block: BodyChunk, maxMarkdownChars: number): BodyChunk[] {
  const lines = splitLines(block.markdown);
  const chunks: BodyChunk[] = [];
  const units = atomicLineUnits(lines);
  let startUnit = 0;
  let size = 0;
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (index > startUnit && size + unitLength(lines, unit) > maxMarkdownChars) {
      chunks.push(chunkFromLines(lines, units[startUnit].start, units[index - 1].end, block.startLine));
      startUnit = index;
      size = 0;
    }
    size += unitLength(lines, unit);
  }
  if (startUnit < units.length) {
    chunks.push(chunkFromLines(lines, units[startUnit].start, units[units.length - 1].end, block.startLine));
  }
  return chunks;
}

function chunkFromLines(lines: string[], start: number, end: number, baseLine: number): BodyChunk {
  return {
    markdown: lines.slice(start, end).join(""),
    startLine: baseLine + start,
    endLine: baseLine + Math.max(start, end - 1),
  };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function headingPathOf(markdown: string): string[] {
  const heading = markdown.match(/^##\s+(.+?)(?:\r)?$/m)?.[1]?.trim();
  return heading ? [heading] : [];
}

function routedVision(markdown: string, descriptions: Map<string, string>): Map<string, string> {
  const routed = new Map<string, string>();
  for (const [path, description] of descriptions) {
    if (markdown.includes(`![[${path}]]`)) routed.set(path, description);
  }
  return routed;
}

interface Fence {
  marker: "`" | "~";
  length: number;
}

interface LineUnit {
  start: number;
  end: number;
}

function lineForSyntax(raw: string): string {
  return raw.replace(/\r?\n$|\r$/u, "");
}

function openingFence(raw: string): Fence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(raw);
  if (!match) return null;
  const delimiter = match[2];
  return { marker: delimiter[0] as "`" | "~", length: delimiter.length };
}

function closesFence(raw: string, fence: Fence): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(raw);
  return match !== null
    && match[2][0] === fence.marker
    && match[2].length >= fence.length;
}

function atomicLineUnits(lines: string[]): LineUnit[] {
  const units: LineUnit[] = [];
  let index = 0;
  while (index < lines.length) {
    const opening = openingFence(lineForSyntax(lines[index]));
    if (!opening) {
      units.push({ start: index, end: index + 1 });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length) {
      if (closesFence(lineForSyntax(lines[end]), opening)) {
        end += 1;
        break;
      }
      end += 1;
    }
    units.push({ start: index, end });
    index = end;
  }
  return units;
}

function unitLength(lines: string[], unit: LineUnit): number {
  return lines.slice(unit.start, unit.end).join("").length;
}
