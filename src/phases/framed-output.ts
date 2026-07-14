import { parseSentinelOutput } from "./format-utils";
import type { FormatOutput } from "./zod-schemas";
import { MergedPageOutputSchema, WikiPagesOutputSchema } from "./zod-schemas";

export interface FramedParseResult<T> {
  raw: T;
  truncated: boolean;
}

export type FormatFrameOutput = FormatOutput & {
  vision_blocks_count?: number;
  embeds_preserved?: string[];
};

export interface PageFrame {
  path: string;
  content: string;
  annotation?: string;
}

export interface DeleteFrame {
  path: string;
  redirect_to?: string;
}

export interface PageFramesOutput {
  reasoning: string;
  pages: PageFrame[];
  deletes?: DeleteFrame[];
}

export interface WikiPagesFramesOutput {
  reasoning: string;
  pages: PageFrame[];
  deletes?: Array<{ path: string }>;
  entity_types_delta?: unknown;
}

export interface LintFramesOutput {
  reasoning: string;
  report: string;
  fixes: PageFrame[];
  deletes?: DeleteFrame[];
}

export interface LintChatFramesOutput {
  summary: string;
  pages: PageFrame[];
}

export interface ContentFrameOutput {
  reasoning?: string;
  content: string;
  annotation?: string;
}

export interface AnswerFrameOutput {
  reasoning: string;
  answer_markdown: string;
  citations: string[];
}

const END = "<<<END>>>";

export const wikiPagesFrameInstruction = [
  "Return framed wiki pages only.",
  "Start with <<<REPORT>>> and concise reasoning.",
  "For each page use <<<PAGE>>> followed by path:, optional annotation:, <<<CONTENT>>>, markdown body, and <<<END_PAGE>>>.",
  "For deletes use <<<DELETE>>> with path: and <<<END_DELETE>>>.",
  "For entity type updates use <<<ENTITY_TYPES_DELTA_JSON>>> with a JSON array and <<<END_ENTITY_TYPES_DELTA_JSON>>>.",
  "Finish with <<<END>>>.",
].join("\n");

export const mergeContentFrameInstruction = [
  "Return exactly one merged page content frame.",
  "Optional: <<<REASONING>>> followed by concise reasoning.",
  "Optional: <<<ANNOTATION>>> followed by one line for the index.",
  "Required: <<<CONTENT>>> followed by the full markdown page.",
  "Finish with <<<END>>>.",
].join("\n");

export function wikiPagesProfile() {
  return {
    kind: "framed-zod" as const,
    schema: WikiPagesOutputSchema,
    parse: parseWikiPagesFrames,
    repairInstruction: wikiPagesFrameInstruction,
  };
}

export function mergedPageProfile() {
  return {
    kind: "framed-zod" as const,
    schema: MergedPageOutputSchema,
    parse: parseContentFrame,
    repairInstruction: mergeContentFrameInstruction,
  };
}

export function parseFormatFrames(text: string, hasVisionDescriptions: boolean): FramedParseResult<FormatFrameOutput> {
  const protectedText = protectInlineMarkers(text, [
    "<<<REPORT>>>",
    "<<<FORMATTED>>>",
    "<<<VISION_COUNT>>>",
    "<<<EMBEDS>>>",
    END,
  ]);
  const parsed = parseSentinelOutput(protectedText.text, hasVisionDescriptions);
  if (!parsed) throw new Error("sentinel markers not found");

  return {
    raw: {
      report: protectedText.restore(parsed.report),
      formatted: protectedText.restore(parsed.formatted),
      ...(hasVisionDescriptions
        ? {
            vision_blocks_count: parsed.visionCount ?? 0,
            embeds_preserved: parsed.embeds?.map((entry) => protectedText.restore(entry)) ?? [],
          }
        : {}),
    },
    truncated: parsed.truncated,
  };
}

export function parseContentFrame(text: string): ContentFrameOutput {
  requireMarker(text, END);
  const content = between(text, "<<<CONTENT>>>", END);
  const annotation = hasMarker(text, "<<<ANNOTATION>>>")
    ? between(text, "<<<ANNOTATION>>>", "<<<CONTENT>>>")
    : undefined;
  const reasoning = hasMarker(text, "<<<REASONING>>>")
    ? between(text, "<<<REASONING>>>", hasMarker(text, "<<<ANNOTATION>>>") ? "<<<ANNOTATION>>>" : "<<<CONTENT>>>")
    : undefined;

  return {
    reasoning,
    content,
    annotation,
  };
}

export function parseAnswerFrames(text: string): AnswerFrameOutput {
  requireMarker(text, END);
  const answerEnd = hasMarker(text, "<<<CITATIONS>>>") ? "<<<CITATIONS>>>" : END;
  const answer = between(text, "<<<ANSWER>>>", answerEnd);
  const citations = hasMarker(text, "<<<CITATIONS>>>")
    ? parseCitations(between(text, "<<<CITATIONS>>>", END))
    : [];
  const reasoning = hasMarker(text, "<<<REASONING>>>")
    ? between(text, "<<<REASONING>>>", "<<<ANSWER>>>")
    : "";

  return {
    reasoning,
    answer_markdown: answer,
    citations,
  };
}

export function parsePageFrames(text: string): PageFramesOutput {
  requireMarker(text, END);

  const reasoning = parseReasoning(text);
  const pages = parsePages(text);
  const deletes = parseDeletes(text);

  if (pages.length === 0 && deletes.length === 0) {
    throw new Error("no page or delete frames found");
  }

  return {
    reasoning,
    pages,
    deletes: deletes.length ? deletes : undefined,
  };
}

export function parseWikiPagesFrames(text: string): WikiPagesFramesOutput {
  requireMarker(text, END);
  const reasoning = parseReasoning(text);
  const pages = parsePages(text);
  const deletes = parseDeletes(text);
  const entityTypesDelta = parseEntityTypesDelta(text);
  return {
    reasoning,
    pages,
    deletes: deletes.length ? deletes.map((entry) => ({ path: entry.path })) : undefined,
    ...(entityTypesDelta !== undefined ? { entity_types_delta: entityTypesDelta } : {}),
  };
}

export function parseWikiPageRepairFramesOrJson(text: string): PageFrame[] {
  try {
    return parseWikiPagesFrames(text).pages;
  } catch {
    return parseLegacyJsonPages(text);
  }
}

export function parseLintFrames(text: string): LintFramesOutput {
  const parsed = parsePageFrames(text);
  return {
    reasoning: parsed.reasoning,
    report: parsed.reasoning,
    fixes: parsed.pages,
    deletes: parsed.deletes,
  };
}

export function parseLintChatFrames(text: string): LintChatFramesOutput {
  const parsed = parsePageFrames(text);
  return {
    summary: parsed.reasoning,
    pages: parsed.pages,
  };
}

function requireMarker(text: string, marker: string): number {
  const idx = markerLineIndex(linesOf(text), marker);
  if (idx < 0) throw new Error(`missing ${marker}`);
  return idx;
}

function hasMarker(text: string, marker: string): boolean {
  return markerLineIndex(linesOf(text), marker) >= 0;
}

function between(text: string, start: string, end: string): string {
  const lines = linesOf(text);
  const startIdx = markerLineIndex(lines, start);
  if (startIdx < 0) throw new Error(`missing ${start}`);
  const endIdx = markerLineIndex(lines, end, startIdx + 1);
  if (endIdx < 0) throw new Error(`missing ${end}`);
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

function parseReasoning(text: string): string {
  const marker = hasMarker(text, "<<<REPORT>>>") ? "<<<REPORT>>>" : hasMarker(text, "<<<REASONING>>>") ? "<<<REASONING>>>" : null;
  if (!marker) return "";

  const lines = linesOf(text);
  const startIdx = markerLineIndex(lines, marker);
  const endIdx = firstMarkerLineAfter(lines, startIdx + 1, [
    "<<<PAGE>>>",
    "<<<DELETE>>>",
    "<<<ENTITY_TYPES_DELTA_JSON>>>",
    END,
  ]);
  if (endIdx < 0) throw new Error(`missing ${END}`);
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

function firstMarkerLineAfter(lines: string[], from: number, markers: string[]): number {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (i >= from && !inFence && markers.some((marker) => isMarkerLine(lines[i], marker))) return i;
    if (isFenceToggleLine(lines[i])) inFence = !inFence;
  }
  return -1;
}

function parsePages(text: string): PageFrame[] {
  const lines = linesOf(text);
  const pages: PageFrame[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isMarkerLine(lines[i], "<<<PAGE>>>")) continue;

    const contentIdx = markerLineIndex(lines, "<<<CONTENT>>>", i + 1);
    if (contentIdx < 0) throw new Error("missing <<<CONTENT>>>");
    const endPageIdx = markerLineIndex(lines, "<<<END_PAGE>>>", contentIdx + 1);
    if (endPageIdx < 0) throw new Error("missing <<<END_PAGE>>>");

    const header = parseHeader(lines.slice(i + 1, contentIdx).join("\n"));
    if (!header.path) throw new Error("page frame missing path");
    pages.push({
      path: header.path,
      content: lines.slice(contentIdx + 1, endPageIdx).join("\n").trim(),
      annotation: header.annotation || undefined,
    });

    i = endPageIdx;
  }

  return pages;
}

function parseDeletes(text: string): DeleteFrame[] {
  const lines = linesOf(text);
  const deletes: DeleteFrame[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isMarkerLine(lines[i], "<<<DELETE>>>")) continue;

    const endDeleteIdx = markerLineIndex(lines, "<<<END_DELETE>>>", i + 1);
    if (endDeleteIdx < 0) throw new Error("missing <<<END_DELETE>>>");

    const header = parseHeader(lines.slice(i + 1, endDeleteIdx).join("\n"));
    if (!header.path) throw new Error("delete frame missing path");
    deletes.push({
      path: header.path,
      redirect_to: header.redirect_to || undefined,
    });

    i = endDeleteIdx;
  }

  return deletes;
}

function parseHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function parseCitations(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
    throw new Error("citations frame must contain strings");
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function parseLegacyJsonPages(text: string): PageFrame[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is PageFrame =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as { path?: unknown }).path === "string" &&
        typeof (x as { content?: unknown }).content === "string",
    );
  } catch {
    return [];
  }
}

function parseEntityTypesDelta(text: string): unknown {
  if (!hasMarker(text, "<<<ENTITY_TYPES_DELTA_JSON>>>")) return undefined;
  const raw = between(text, "<<<ENTITY_TYPES_DELTA_JSON>>>", "<<<END_ENTITY_TYPES_DELTA_JSON>>>");
  return JSON.parse(raw) as unknown;
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

function markerLineIndex(lines: string[], marker: string, from = 0): number {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (i >= from && !inFence && isMarkerLine(lines[i], marker)) return i;
    if (isFenceToggleLine(lines[i])) inFence = !inFence;
  }
  return -1;
}

function isMarkerLine(line: string, marker: string): boolean {
  return line.trim() === marker;
}

function isFenceToggleLine(line: string): boolean {
  return /^\s*(?:```|~~~)/.test(line);
}

function protectInlineMarkers(text: string, markers: string[]): { text: string; restore: (value: string) => string } {
  const replacements = new Map<string, string>();
  let nextId = 0;
  let inFence = false;

  const protectedLines = linesOf(text).map((line) => {
    const isBoundaryMarker = !inFence && markers.some((marker) => isMarkerLine(line, marker));
    const togglesFence = isFenceToggleLine(line);
    if (isBoundaryMarker) {
      return line;
    }
    let protectedLine = line;
    for (const marker of markers) {
      let markerIdx = protectedLine.indexOf(marker);
      while (markerIdx >= 0) {
        const token = `__FRAMED_OUTPUT_MARKER_${nextId++}__`;
        replacements.set(token, marker);
        protectedLine = `${protectedLine.slice(0, markerIdx)}${token}${protectedLine.slice(markerIdx + marker.length)}`;
        markerIdx = protectedLine.indexOf(marker, markerIdx + token.length);
      }
    }
    if (togglesFence) inFence = !inFence;
    return protectedLine;
  });

  return {
    text: protectedLines.join("\n"),
    restore: (value: string) => {
      let restored = value;
      for (const [token, marker] of replacements) {
        restored = restored.split(token).join(marker);
      }
      return restored;
    },
  };
}
