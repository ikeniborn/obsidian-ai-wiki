import type { z } from "zod";
import { parseSentinelOutput } from "./format-utils";
import type { StructuredProfile } from "./structured-output";
import type { FormatOutput, LintChatResponse, LintOutput, QueryAnswer, SynthesisOutput } from "./zod-schemas";
import { LintChatSchema, LintOutputSchema, MergedPageOutputSchema, WikiPagesOutputSchema } from "./zod-schemas";

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

export const sentinelJsonFrameInstruction = [
  "Return sentinel-framed JSON only.",
  "Put <<<JSON>>> on its own first line.",
  "Put exactly one JSON object after it.",
  "Put <<<END>>> on its own final line.",
  "Do not add markdown fences or text outside the markers.",
].join("\n");

export const synthesisFrameInstruction = [
  "Return field-framed synthesis output only.",
  "The entire response is plain-text frames; never return a JSON object or a response wrapper.",
  "Protocol markers are exact literal lines such as <<<CREATE>>>; never replace them with Markdown headings such as ## CREATE.",
  "Optional reasoning: <<<REASONING>>> followed by plain text.",
  "Create: <<<CREATE>>>, entityKey/path/annotation headers, <<<CONTENT>>>, raw Markdown, <<<END_CONTENT>>>, <<<END_CREATE>>>.",
  "Patch: <<<PATCH>>>, entityKey/path/expectedPageHash headers, one or more <<<SECTION>>> blocks, then <<<END_PATCH>>>.",
  "Section: operation/heading headers, optional expectedSectionOrdinal/expectedSectionHash headers, <<<CONTENT>>>, raw Markdown, <<<END_CONTENT>>>, <<<END_SECTION>>>.",
  "Section CONTENT is body-only Markdown; never repeat its heading inside CONTENT.",
  "Skip: <<<SKIP>>>, entityKey/reason headers, <<<END_SKIP>>>.",
  "Optional entity type updates: <<<ENTITY_TYPES_DELTA_JSON>>>, one compact JSON array, <<<END_ENTITY_TYPES_DELTA_JSON>>>.",
  "Finish with <<<END>>>. Do not wrap Markdown content in JSON or code fences. Never put any <<<...>>> protocol marker inside Markdown.",
].join("\n");

export function sentinelJsonProfile<T>(
  schema: z.ZodSchema<T>,
  repairInstruction?: string,
  compactRepairThresholdTokens?: number,
): StructuredProfile<T> {
  return {
    kind: "framed-zod",
    schema,
    parse: parseSentinelJson,
    repairInstruction: repairInstruction
      ? `${sentinelJsonFrameInstruction}\n${repairInstruction}`
      : sentinelJsonFrameInstruction,
    ...(compactRepairThresholdTokens === undefined ? {} : { compactRepairThresholdTokens }),
  };
}

export function synthesisFrameProfile<T>(
  schema: z.ZodSchema<T>,
  repairInstruction?: string,
  compactRepairThresholdTokens?: number,
): StructuredProfile<T> {
  return {
    kind: "framed-zod",
    schema,
    parse: parseSynthesisFrames,
    repairInstruction: repairInstruction
      ? `${synthesisFrameInstruction}\n${repairInstruction}`
      : synthesisFrameInstruction,
    ...(compactRepairThresholdTokens === undefined ? {} : { compactRepairThresholdTokens }),
  };
}

export function parseSentinelJson(text: string): unknown {
  const payload = hasMarker(text, "<<<JSON>>>")
    ? between(text, "<<<JSON>>>", END)
    : text.trim();
  const fenced = payload.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return JSON.parse((fenced?.[1] ?? payload).trim());
}

export function parseSynthesisFrames(text: string): SynthesisOutput {
  if (!hasMarker(text, "<<<CREATE>>>")
    && !hasMarker(text, "<<<PATCH>>>")
    && !hasMarker(text, "<<<SKIP>>>")) {
    const heading = /^\s{0,3}#{1,6}\s+(CREATE|PATCH|SKIP|CONTENT|SECTION|END_CREATE|END_PATCH|END_SKIP)\s*$/im.exec(text)?.[1];
    if (heading !== undefined) {
      throw new Error(`missing exact <<<${heading}>>> field-frame marker; use the literal marker on its own line, not a Markdown heading`);
    }
    const synthesisMarker = /^\s*<<<(?:REASONING|CONTENT|END_CONTENT|END_CREATE|END_PATCH|SECTION|END_SECTION|END_SKIP|ENTITY_TYPES_DELTA_JSON|END_ENTITY_TYPES_DELTA_JSON|END)>>>\s*$/m.exec(text)?.[0];
    if (synthesisMarker !== undefined && !hasMarker(text, "<<<JSON>>>")) {
      throw new Error("field-framed synthesis output is missing an action frame; expected <<<CREATE>>>, <<<PATCH>>>, or <<<SKIP>>>");
    }
    return parseSentinelJson(text) as SynthesisOutput;
  }
  requireMarker(text, END);
  const entityTypesDelta = parseEntityTypesDelta(text);
  return {
    reasoning: parseReasoning(text),
    actions: [...parseSynthesisCreates(text), ...parseSynthesisPatches(text)],
    skips: parseSynthesisSkips(text),
    ...(entityTypesDelta === undefined ? {} : { entity_types_delta: entityTypesDelta as SynthesisOutput["entity_types_delta"] }),
  };
}

function parseSynthesisCreates(text: string): SynthesisOutput["actions"] {
  const lines = linesOf(text);
  const actions: SynthesisOutput["actions"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarkerLine(lines[i], "<<<CREATE>>>")) continue;
    const contentIdx = markerLineIndex(lines, "<<<CONTENT>>>", i + 1);
    const endIdx = contentIdx < 0 ? -1 : markerLineIndex(lines, "<<<END_CREATE>>>", contentIdx + 1);
    if (contentIdx < 0 || endIdx < 0) throw new Error("incomplete create frame");
    const header = parseHeader(lines.slice(i + 1, contentIdx).join("\n"));
    actions.push({
      kind: "create",
      entityKey: header.entityKey ?? "",
      path: header.path ?? "",
      annotation: header.annotation ?? "",
      content: parseSynthesisContent(lines, contentIdx + 1, endIdx),
    });
    i = endIdx;
  }
  return actions;
}

function parseSynthesisPatches(text: string): SynthesisOutput["actions"] {
  const lines = linesOf(text);
  const actions: SynthesisOutput["actions"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarkerLine(lines[i], "<<<PATCH>>>")) continue;
    const endPatchIdx = markerLineIndex(lines, "<<<END_PATCH>>>", i + 1);
    if (endPatchIdx < 0) throw new Error("incomplete patch frame");
    const firstSectionIdx = markerLineIndex(lines, "<<<SECTION>>>", i + 1);
    const headerEnd = firstSectionIdx >= 0 && firstSectionIdx < endPatchIdx ? firstSectionIdx : endPatchIdx;
    const header = parseHeader(lines.slice(i + 1, headerEnd).join("\n"));
    const sections: Extract<SynthesisOutput["actions"][number], { kind: "patch" }>["sections"] = [];
    for (let j = headerEnd; j < endPatchIdx; j++) {
      if (!isMarkerLine(lines[j], "<<<SECTION>>>")) continue;
      const contentIdx = markerLineIndex(lines, "<<<CONTENT>>>", j + 1);
      const endSectionIdx = contentIdx < 0 ? -1 : markerLineIndex(lines, "<<<END_SECTION>>>", contentIdx + 1);
      if (contentIdx < 0 || endSectionIdx < 0 || endSectionIdx > endPatchIdx) throw new Error("incomplete patch section frame");
      const sectionHeader = parseHeader(lines.slice(j + 1, contentIdx).join("\n"));
      const heading = sectionHeader.heading ?? "";
      sections.push({
        operation: sectionHeader.operation as "add" | "append" | "replace",
        heading,
        content: stripRepeatedSectionHeading(
          heading,
          parseSynthesisContent(lines, contentIdx + 1, endSectionIdx),
        ),
        ...(sectionHeader.expectedSectionOrdinal === undefined
          ? {}
          : { expectedSectionOrdinal: Number(sectionHeader.expectedSectionOrdinal) }),
        ...(sectionHeader.expectedSectionHash === undefined ? {} : { expectedSectionHash: sectionHeader.expectedSectionHash }),
      } as typeof sections[number]);
      j = endSectionIdx;
    }
    actions.push({
      kind: "patch",
      entityKey: header.entityKey ?? "",
      path: header.path ?? "",
      expectedPageHash: header.expectedPageHash ?? "",
      sections,
    });
    i = endPatchIdx;
  }
  return actions;
}

function stripRepeatedSectionHeading(heading: string, content: string): string {
  const [first, ...rest] = content.split("\n");
  if (first?.trim() !== heading.trim()) return content;
  return rest.join("\n").trim();
}

const RESERVED_PROTOCOL_MARKER_RE = /^<<<[A-Z][A-Z0-9_]*>>>$/;

function parseSynthesisContent(lines: string[], start: number, end: number): string {
  const contentLines = lines.slice(start, end);
  let last = contentLines.length - 1;
  while (last >= 0 && contentLines[last].trim() === "") last -= 1;
  if (last >= 0 && isMarkerLine(contentLines[last], "<<<END_CONTENT>>>")) {
    contentLines.splice(last, 1);
  }
  const reserved = contentLines.find((line) => RESERVED_PROTOCOL_MARKER_RE.test(line.trim()));
  if (reserved !== undefined) {
    throw new Error(`reserved protocol marker inside synthesis Markdown: ${reserved.trim()}`);
  }
  return contentLines.join("\n").trim();
}

function parseSynthesisSkips(text: string): SynthesisOutput["skips"] {
  const lines = linesOf(text);
  const skips: SynthesisOutput["skips"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarkerLine(lines[i], "<<<SKIP>>>")) continue;
    const endIdx = markerLineIndex(lines, "<<<END_SKIP>>>", i + 1);
    if (endIdx < 0) throw new Error("incomplete skip frame");
    const header = parseHeader(lines.slice(i + 1, endIdx).join("\n"));
    skips.push({ entityKey: header.entityKey ?? "", reason: header.reason ?? "" });
    i = endIdx;
  }
  return skips;
}

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

export const lintOutputFrameInstruction = [
  "Return framed lint output only.",
  "Start with <<<REPORT>>> followed by the markdown lint report.",
  "For each changed page use <<<PAGE>>> followed by path:, optional annotation:, <<<CONTENT>>>, full markdown body, and <<<END_PAGE>>>.",
  "For deletes use <<<DELETE>>> followed by path:, optional redirect_to:, and <<<END_DELETE>>>.",
  "Finish with <<<END>>>.",
].join("\n");

export const lintChatFrameInstruction = [
  "Return framed lint-chat output only.",
  "Start with <<<REPORT>>> followed by the markdown summary.",
  "For each changed page use <<<PAGE>>> followed by path:, optional annotation:, <<<CONTENT>>>, full markdown body, and <<<END_PAGE>>>.",
  "Finish with <<<END>>>.",
].join("\n");

export const queryAnswerFrameInstruction = [
  "Return framed answer repair output only.",
  "Put the full repaired markdown answer in <<<ANSWER>>>.",
  "Put citations in <<<CITATIONS>>> as one stem per bullet line.",
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

export function lintOutputProfile(): StructuredProfile<LintOutput> {
  return {
    kind: "framed-zod" as const,
    schema: LintOutputSchema,
    parse: parseLintFrames,
    repairInstruction: lintOutputFrameInstruction,
  };
}

export function lintChatProfile(): StructuredProfile<LintChatResponse> {
  return {
    kind: "framed-zod" as const,
    schema: outputSchema(LintChatSchema),
    parse: parseLintChatFrames,
    repairInstruction: lintChatFrameInstruction,
  };
}

export function queryAnswerProfile<T extends QueryAnswer>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): StructuredProfile<T> {
  return {
    kind: "framed-zod" as const,
    schema: outputSchema(schema),
    parse: parseAnswerFrames,
    repairInstruction: queryAnswerFrameInstruction,
  };
}

function outputSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): z.ZodSchema<T> {
  return schema as unknown as z.ZodSchema<T>;
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
  requireMarker(text, END);
  const parsed = {
    reasoning: parseReasoning(text),
    pages: parsePages(text),
    deletes: parseDeletes(text),
  };
  return {
    reasoning: parsed.reasoning,
    report: parsed.reasoning,
    fixes: parsed.pages,
    deletes: parsed.deletes.length ? parsed.deletes : undefined,
  };
}

export function parseLintChatFrames(text: string): LintChatFramesOutput {
  requireMarker(text, END);
  const parsed = {
    reasoning: parseReasoning(text),
    pages: parsePages(text),
  };
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
    "<<<CREATE>>>",
    "<<<PATCH>>>",
    "<<<SKIP>>>",
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
