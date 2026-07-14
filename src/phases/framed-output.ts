import { parseSentinelOutput } from "./format-utils";
import type { FormatOutput } from "./zod-schemas";

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

export function parseFormatFrames(text: string, hasVisionDescriptions: boolean): FramedParseResult<FormatFrameOutput> {
  const parsed = parseSentinelOutput(text, hasVisionDescriptions);
  if (!parsed) throw new Error("sentinel markers not found");

  return {
    raw: {
      report: parsed.report,
      formatted: parsed.formatted,
      ...(hasVisionDescriptions
        ? {
            vision_blocks_count: parsed.visionCount ?? 0,
            embeds_preserved: parsed.embeds ?? [],
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
  const parsed = parsePageFrames(text);
  return {
    reasoning: parsed.reasoning,
    pages: parsed.pages,
    deletes: parsed.deletes?.map((entry) => ({ path: entry.path })),
    ...(parseEntityTypesDelta(text) !== undefined ? { entity_types_delta: parseEntityTypesDelta(text) } : {}),
  };
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
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error(`missing ${marker}`);
  return idx;
}

function hasMarker(text: string, marker: string): boolean {
  return text.includes(marker);
}

function between(text: string, start: string, end: string): string {
  const startIdx = requireMarker(text, start) + start.length;
  const endIdx = text.indexOf(end, startIdx);
  if (endIdx < 0) throw new Error(`missing ${end}`);
  return text.slice(startIdx, endIdx).trim();
}

function parseReasoning(text: string): string {
  const marker = hasMarker(text, "<<<REPORT>>>") ? "<<<REPORT>>>" : hasMarker(text, "<<<REASONING>>>") ? "<<<REASONING>>>" : null;
  if (!marker) return "";

  const startIdx = requireMarker(text, marker) + marker.length;
  const endIdx = firstMarkerAfter(text, startIdx, [
    "<<<PAGE>>>",
    "<<<DELETE>>>",
    "<<<ENTITY_TYPES_DELTA_JSON>>>",
    END,
  ]);
  if (endIdx < 0) throw new Error(`missing ${END}`);
  return text.slice(startIdx, endIdx).trim();
}

function firstMarkerAfter(text: string, from: number, markers: string[]): number {
  const indexes = markers
    .map((marker) => text.indexOf(marker, from))
    .filter((idx) => idx >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function parsePages(text: string): PageFrame[] {
  const pages: PageFrame[] = [];
  const pageRe = /<<<PAGE>>>\s*([\s\S]*?)<<<CONTENT>>>\s*([\s\S]*?)<<<END_PAGE>>>/g;
  let match: RegExpExecArray | null;

  while ((match = pageRe.exec(text)) !== null) {
    const header = parseHeader(match[1]);
    if (!header.path) throw new Error("page frame missing path");
    pages.push({
      path: header.path,
      content: match[2].trim(),
      annotation: header.annotation || undefined,
    });
  }

  return pages;
}

function parseDeletes(text: string): DeleteFrame[] {
  const deletes: DeleteFrame[] = [];
  const deleteRe = /<<<DELETE>>>\s*([\s\S]*?)<<<END_DELETE>>>/g;
  let match: RegExpExecArray | null;

  while ((match = deleteRe.exec(text)) !== null) {
    const header = parseHeader(match[1]);
    if (!header.path) throw new Error("delete frame missing path");
    deletes.push({
      path: header.path,
      redirect_to: header.redirect_to || undefined,
    });
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

function parseEntityTypesDelta(text: string): unknown {
  if (!hasMarker(text, "<<<ENTITY_TYPES_DELTA_JSON>>>")) return undefined;
  const raw = between(text, "<<<ENTITY_TYPES_DELTA_JSON>>>", "<<<END_ENTITY_TYPES_DELTA_JSON>>>");
  return JSON.parse(raw) as unknown;
}
