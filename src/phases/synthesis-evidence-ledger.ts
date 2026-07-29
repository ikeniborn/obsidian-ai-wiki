import type { EntityContextBundle } from "../ingest-context";
import type { OutputLanguage } from "../types";
import { contentHash } from "../content-hash";

export type SynthesisEvidenceLedgerKind = "code" | "url";

export interface SynthesisEvidenceLedgerItem {
  id: string;
  kind: SynthesisEvidenceLedgerKind;
  startLine: number;
  endLine: number;
  markdown: string;
  coverageUnits: string[];
}

export interface SynthesisEvidenceReconciliation {
  content: string;
  removedUnits: number;
  appendedItems: number;
}

interface Fence {
  marker: "`" | "~";
  length: number;
  opening: string;
  containerPrefix: string;
}

const RESERVED_PROTOCOL_MARKER_RE = /^<<<[A-Z][A-Z0-9_]*>>>$/;
const URL_RE = /https?:\/\/[^\s<>)\]}"'`]+/g;

function normalizedMarkdown(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

function normalizedCoverage(value: string): string {
  return normalizedMarkdown(value).replace(/\s+/g, " ").trim();
}

function splitMarkdownContainer(line: string): { prefix: string; content: string } {
  let cursor = 0;
  while (cursor < line.length) {
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
    if (line[cursor] !== ">") break;
    cursor += 1;
    if (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
  }
  while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
  return { prefix: line.slice(0, cursor), content: line.slice(cursor) };
}

function openingFence(line: string): Fence | undefined {
  const container = splitMarkdownContainer(line);
  const match = /^(`{3,}|~{3,})(.*)$/.exec(container.content);
  if (match === null) return undefined;
  return {
    marker: match[1][0] as "`" | "~",
    length: match[1].length,
    opening: container.content,
    containerPrefix: container.prefix,
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const content = splitMarkdownContainer(line).content;
  return new RegExp(`^${fence.marker}{${fence.length},}[ \\t]*$`).test(content);
}

function stripFenceContainer(line: string, fence: Fence): string {
  return line.startsWith(fence.containerPrefix)
    ? line.slice(fence.containerPrefix.length)
    : line;
}

function bodyStartLine(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end < 0 ? 0 : end + 1;
}

function urlsIn(value: string): string[] {
  return [...normalizedMarkdown(value).matchAll(URL_RE)]
    .map((match) => match[0].replace(/[.,;:!?]+$/g, ""));
}

const UNFENCED_ASSIGNMENT_RE = /^(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_.-]*[ \t]*=[ \t]*\S/;
const STRONG_SHELL_SIGNAL_RE = /(?:https?:\/\/|(?:^|[ \t])-{1,2}[A-Za-z0-9]|(?:^|[ \t])(?:~|\.{1,2})?\/[^\s]|(?:^|[ \t])[A-Za-z_][A-Za-z0-9_]*=|[|&;<>]|\$[A-Za-z_{(]|(?:^|[ \t])@[A-Za-z0-9]|[*?]|['"])/;
const NUMERIC_ARGUMENT_RE = /(?:^|[ \t])v?\d+(?:\.\d+){0,3}(?:[ \t]|$)/i;

function unfencedTechnicalLine(line: string): string | undefined {
  const text = normalizedMarkdown(line).trim().replace(/^\$[ \t]+/, "");
  if (!text || text.length > 1000) return undefined;
  if (/^(?:#{1,6}|[-+*][ \t]|\d+[.)][ \t]|>|\||```|~~~|<!--)/.test(text)) return undefined;
  if (UNFENCED_ASSIGNMENT_RE.test(text)) return text;

  const head = /^([^\s]+)/.exec(text)?.[1] ?? "";
  const commandLikeHead = /^[a-z][A-Za-z0-9_.+-]*$/.test(head)
    || /^(?:~|\.{1,2})\//.test(head);
  if (!commandLikeHead) return undefined;
  if (STRONG_SHELL_SIGNAL_RE.test(text)) return text;

  const tokens = text.split(/\s+/);
  if (tokens.length >= 2 && tokens.length <= 4
    && NUMERIC_ARGUMENT_RE.test(text)
    && !/[.,:!?]$/.test(text)) {
    return text;
  }
  return undefined;
}

function extractLedger(source: string, rejectReservedMarkers: boolean): SynthesisEvidenceLedgerItem[] {
  const lines = normalizedMarkdown(source).split("\n");
  const firstBodyLine = bodyStartLine(lines);
  const items: SynthesisEvidenceLedgerItem[] = [];
  const fencedLines = new Set<number>();
  const claimedTechnicalLines = new Set<number>();

  for (let index = firstBodyLine; index < lines.length; index++) {
    if (RESERVED_PROTOCOL_MARKER_RE.test(lines[index].trim()) && rejectReservedMarkers) {
      throw new TypeError(`reserved protocol marker in source technical evidence at line ${index + 1}`);
    }
  }

  for (let index = firstBodyLine; index < lines.length; index++) {
    const fence = openingFence(lines[index]);
    if (fence === undefined) continue;
    fencedLines.add(index);
    const body: Array<{ line: string; index: number }> = [];
    index += 1;
    while (index < lines.length && !closesFence(lines[index], fence)) {
      fencedLines.add(index);
      body.push({ line: stripFenceContainer(lines[index], fence), index });
      index += 1;
    }
    if (index < lines.length) fencedLines.add(index);

    let segmentStart = 0;
    while (segmentStart < body.length) {
      while (segmentStart < body.length && body[segmentStart].line.trim().length === 0) segmentStart += 1;
      if (segmentStart >= body.length) break;
      let segmentEnd = segmentStart;
      while (segmentEnd + 1 < body.length && body[segmentEnd + 1].line.trim().length > 0) segmentEnd += 1;
      const segment = body.slice(segmentStart, segmentEnd + 1);
      const reserved = segment.find(({ line }) => RESERVED_PROTOCOL_MARKER_RE.test(line.trim()));
      if (rejectReservedMarkers && reserved !== undefined) {
        throw new TypeError(`reserved protocol marker in source technical evidence at line ${reserved.index + 1}`);
      }
      const coverageUnits = segment.map(({ line }) => normalizedCoverage(line)).filter(Boolean);
      if (coverageUnits.length > 0) {
        const close = fence.marker.repeat(fence.length);
        const markdown = `${fence.opening}\n${segment.map(({ line }) => line).join("\n")}\n${close}`;
        const startLine = segment[0].index + 1;
        const endLine = segment.at(-1)!.index + 1;
        items.push({
          id: `code:${startLine}-${endLine}:${contentHash(markdown).slice(0, 12)}`,
          kind: "code",
          startLine,
          endLine,
          markdown,
          coverageUnits,
        });
      }
      segmentStart = segmentEnd + 1;
    }
    if (index >= lines.length) index = lines.length - 1;
  }

  for (let index = firstBodyLine; index < lines.length;) {
    if (fencedLines.has(index)) {
      index += 1;
      continue;
    }
    const first = unfencedTechnicalLine(lines[index]);
    if (first === undefined) {
      index += 1;
      continue;
    }
    const segment = [{ line: first, index }];
    let cursor = index + 1;
    while (cursor < lines.length && !fencedLines.has(cursor)) {
      const next = unfencedTechnicalLine(lines[cursor]);
      if (next === undefined) break;
      segment.push({ line: next, index: cursor });
      cursor += 1;
    }
    for (const entry of segment) claimedTechnicalLines.add(entry.index);
    const markdown = `\`\`\`text\n${segment.map(({ line }) => line).join("\n")}\n\`\`\``;
    const startLine = segment[0].index + 1;
    const endLine = segment.at(-1)!.index + 1;
    items.push({
      id: `code:${startLine}-${endLine}:${contentHash(markdown).slice(0, 12)}`,
      kind: "code",
      startLine,
      endLine,
      markdown,
      coverageUnits: segment.map(({ line }) => normalizedCoverage(line)).filter(Boolean),
    });
    index = cursor;
  }

  for (let index = firstBodyLine; index < lines.length; index++) {
    if (fencedLines.has(index) || claimedTechnicalLines.has(index)) continue;
    for (const url of urlsIn(lines[index])) {
      items.push({
        id: `url:${index + 1}:${contentHash(url).slice(0, 12)}`,
        kind: "url",
        startLine: index + 1,
        endLine: index + 1,
        markdown: `- <${url}>`,
        coverageUnits: [url],
      });
    }
  }

  return items.sort((left, right) => left.startLine - right.startLine
    || left.endLine - right.endLine
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id));
}

export function extractSynthesisEvidenceLedger(source: string): SynthesisEvidenceLedgerItem[] {
  return extractLedger(source, true);
}

function overlapLength(
  item: SynthesisEvidenceLedgerItem,
  bundle: EntityContextBundle,
): number {
  return bundle.evidence.exactSourceRanges.reduce((sum, range) => {
    const start = Math.max(item.startLine, range.startLine);
    const end = Math.min(item.endLine, range.endLine);
    return sum + Math.max(0, end - start + 1);
  }, 0);
}

export function assignSynthesisEvidenceLedger(
  ledger: readonly SynthesisEvidenceLedgerItem[],
  bundles: readonly EntityContextBundle[],
  sourcePrimaryEntityKeys: ReadonlySet<string>,
): Map<string, SynthesisEvidenceLedgerItem[]> {
  if (ledger.length > 0 && bundles.length === 0) {
    throw new TypeError("source technical evidence has no synthesis carrier");
  }
  const assigned = new Map<string, SynthesisEvidenceLedgerItem[]>();
  for (const item of ledger) {
    const ranked = bundles.map((bundle, ordinal) => ({
      bundle,
      ordinal,
      overlap: overlapLength(item, bundle),
      primary: sourcePrimaryEntityKeys.has(bundle.entityKey),
    })).sort((left, right) => right.overlap - left.overlap
      || Number(right.primary) - Number(left.primary)
      || left.ordinal - right.ordinal);
    const maxOverlap = ranked[0]?.overlap ?? 0;
    const target = maxOverlap > 0
      ? ranked[0]?.bundle
      : ranked.find((candidate) => candidate.primary)?.bundle ?? ranked[0]?.bundle;
    if (target === undefined) continue;
    const items = assigned.get(target.entityKey) ?? [];
    items.push({ ...item, coverageUnits: [...item.coverageUnits] });
    assigned.set(target.entityKey, items);
  }
  return assigned;
}

const TRAILING_CONTINUATION_RE = /[ \t]*(?:&&[ \t]*)?\\[ \t]*$/;

function stripTrailingContinuation(value: string): string {
  return value.replace(TRAILING_CONTINUATION_RE, "").trimEnd();
}

export function findMissingSynthesisEvidence(
  ledger: readonly SynthesisEvidenceLedgerItem[],
  contents: readonly string[],
): SynthesisEvidenceLedgerItem[] {
  const corpus = normalizedCoverage(contents.join("\n"));
  return ledger.filter((item) => {
    const raw = item.kind === "code"
      ? normalizedCoverage(item.coverageUnits.join("\n"))
      : normalizedCoverage(item.coverageUnits[0] ?? "");
    const required = stripTrailingContinuation(raw);
    return required.length > 0 && !corpus.includes(required);
  });
}

function technicalHeading(language: OutputLanguage | undefined): string {
  if (language === "ru") return "## Точные технические данные";
  if (language === "es") return "## Evidencia técnica exacta";
  return "## Exact technical evidence";
}

function allowedEvidence(ledger: readonly SynthesisEvidenceLedgerItem[], existing: string): {
  code: Set<string>;
  urls: Set<string>;
} {
  const existingLedger = extractLedger(existing, false);
  const all = [...ledger, ...existingLedger];
  return {
    code: new Set(all.filter((item) => item.kind === "code")
      .flatMap((item) => item.coverageUnits.map(normalizedCoverage))),
    urls: new Set([
      ...urlsIn(existing),
      ...ledger.flatMap((item) => urlsIn(item.markdown)),
    ]),
  };
}

function sanitizeUnsupportedEvidence(
  content: string,
  allowed: ReturnType<typeof allowedEvidence>,
): { content: string; removedUnits: number } {
  const normalized = normalizedMarkdown(content);
  const frontmatter = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(normalized)?.[0] ?? "";
  const lines = normalized.slice(frontmatter.length).split("\n");
  const keep = lines.map(() => true);
  const fenceRanges: Array<{ start: number; end: number }> = [];
  let fence: Fence | undefined;
  let fenceStart = -1;
  let removedUnits = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence !== undefined) {
      if (closesFence(line, fence)) {
        fenceRanges.push({ start: fenceStart, end: index });
        fence = undefined;
        fenceStart = -1;
        continue;
      }
      const unit = normalizedCoverage(line);
      if (unit && !allowed.code.has(unit)) {
        keep[index] = false;
        removedUnits += 1;
      }
      continue;
    }

    const opening = openingFence(line);
    if (opening !== undefined) {
      fence = opening;
      fenceStart = index;
      continue;
    }

    lines[index] = line.replace(URL_RE, (raw) => {
      const url = raw.replace(/[.,;:!?]+$/g, "");
      if (allowed.urls.has(url)) return raw;
      removedUnits += 1;
      return raw.slice(url.length);
    }).replace(/\[([^\]]+)]\([ \t]*\)/g, "$1")
      .replace(/[ \t]+([,.;:!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd();
  }
  if (fence !== undefined) fenceRanges.push({ start: fenceStart, end: lines.length - 1 });

  for (const range of fenceRanges) {
    const hasContent = lines.slice(range.start + 1, range.end)
      .some((line, offset) => keep[range.start + 1 + offset] && line.trim().length > 0);
    if (hasContent) continue;
    for (let index = range.start; index <= range.end; index++) keep[index] = false;
  }

  if (removedUnits === 0) return { content, removedUnits: 0 };
  const body = lines.filter((_, index) => keep[index]).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n");
  return { content: `${frontmatter}${body}`, removedUnits };
}

function headingIndexes(lines: readonly string[]): Array<{ index: number; heading: string }> {
  const headings: Array<{ index: number; heading: string }> = [];
  let fence: Fence | undefined;
  for (let index = 0; index < lines.length; index++) {
    if (fence !== undefined) {
      if (closesFence(lines[index], fence)) fence = undefined;
      continue;
    }
    const opening = openingFence(lines[index]);
    if (opening !== undefined) {
      fence = opening;
      continue;
    }
    if (/^##[ \t]+\S/.test(lines[index])) headings.push({ index, heading: lines[index].trim() });
  }
  return headings;
}

const EVIDENCE_HEADINGS = new Set([
  "## Точные технические данные",
  "## Evidencia técnica exacta",
  "## Exact technical evidence",
]);

function existingEvidenceSection(existing: string): string {
  const lines = normalizedMarkdown(existing).split("\n");
  const headings = headingIndexes(lines);
  const start = headings.find((candidate) => EVIDENCE_HEADINGS.has(candidate.heading));
  if (start === undefined) return "";
  const end = headings.find((candidate) => candidate.index > start.index)?.index ?? lines.length;
  return lines.slice(start.index + 1, end).join("\n");
}

function appendEvidenceSection(
  content: string,
  missing: readonly SynthesisEvidenceLedgerItem[],
  language: OutputLanguage | undefined,
): string {
  if (missing.length === 0) return content;
  const heading = technicalHeading(language);
  const lines = normalizedMarkdown(content).split("\n");
  const headings = headingIndexes(lines);
  const existing = headings.find((candidate) => candidate.heading === heading);
  const sources = headings.find((candidate) => candidate.heading.toLowerCase() === "## sources");
  const block = missing.map((item) => item.markdown).join("\n\n");

  if (existing !== undefined) {
    const next = headings.find((candidate) => candidate.index > existing.index)?.index ?? lines.length;
    lines.splice(next, 0, "", block, "");
  } else {
    const index = sources?.index ?? lines.length;
    lines.splice(index, 0, heading, "", block, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function reconcileSynthesisEvidence(
  content: string,
  existing: string | null,
  ledger: readonly SynthesisEvidenceLedgerItem[],
  language: OutputLanguage | undefined,
): SynthesisEvidenceReconciliation {
  const sanitized = sanitizeUnsupportedEvidence(content, allowedEvidence(ledger, existing ?? ""));
  const carryOver = existing === null
    ? []
    : findMissingSynthesisEvidence(extractLedger(existingEvidenceSection(existing), false), [sanitized.content]);
  const missing = findMissingSynthesisEvidence(ledger, [sanitized.content]);
  const appended = [...carryOver, ...missing];
  const reconciled = appendEvidenceSection(sanitized.content, appended, language);
  const unresolved = findMissingSynthesisEvidence(ledger, [reconciled]);
  if (unresolved.length > 0) {
    throw new TypeError(`source technical evidence reconciliation left ${unresolved.length} item(s) unresolved`);
  }
  return {
    content: reconciled,
    removedUnits: sanitized.removedUnits,
    appendedItems: appended.length,
  };
}
