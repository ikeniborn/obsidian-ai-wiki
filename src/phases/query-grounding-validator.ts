export type QueryTechnicalUnitKind =
  | "fenced_code"
  | "inline_code"
  | "url"
  | "ipv4"
  | "uuid"
  | "path"
  | "assignment"
  | "flag"
  | "number";

export interface QueryTechnicalUnit {
  kind: QueryTechnicalUnitKind;
  text: string;
}

export interface QueryGroundingSanitization {
  answer: string;
  removedLines: number;
  removedUnits: number;
}

interface MarkdownFence {
  marker: "`" | "~";
  length: number;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

function technicalLine(line: string): string | undefined {
  const text = normalizeText(line).trim();
  if (text.length === 0 || /^(?:#(?![!])|\/\/|;)/.test(text)) return undefined;
  return text;
}

function uniqueUnits(units: readonly QueryTechnicalUnit[]): QueryTechnicalUnit[] {
  const seen = new Set<string>();
  return units.filter((unit) => {
    const identity = `${unit.kind}\u0000${unit.text}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function openingFence(line: string): MarkdownFence | undefined {
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return opening === null
    ? undefined
    : { marker: opening[1][0] as "`" | "~", length: opening[1].length };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  return new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*(?:\\n)?$`).test(line);
}

function extractFencedCode(markdown: string): { units: QueryTechnicalUnit[]; prose: string } {
  const lines = normalizeText(markdown).match(/[^\n]*(?:\n|$)/g) ?? [];
  let fence: MarkdownFence | undefined;
  const units: QueryTechnicalUnit[] = [];
  let prose = "";

  for (const line of lines) {
    if (line.length === 0) continue;
    if (fence !== undefined) {
      if (closesFence(line, fence)) {
        fence = undefined;
      } else {
        const text = technicalLine(line);
        if (text !== undefined) units.push({ kind: "fenced_code", text });
      }
      prose += "\n";
      continue;
    }

    const opening = openingFence(line);
    if (opening !== undefined) {
      fence = opening;
      prose += "\n";
      continue;
    }
    prose += line;
  }

  return { units, prose };
}

function extractInlineCode(prose: string): { units: QueryTechnicalUnit[]; prose: string } {
  const units: QueryTechnicalUnit[] = [];
  let output = "";
  let cursor = 0;

  while (cursor < prose.length) {
    const opener = prose.indexOf("`", cursor);
    if (opener < 0) {
      output += prose.slice(cursor);
      break;
    }
    let openerEnd = opener + 1;
    while (prose[openerEnd] === "`") openerEnd += 1;
    const delimiter = "`".repeat(openerEnd - opener);
    const closer = prose.indexOf(delimiter, openerEnd);
    if (closer < 0) {
      output += prose.slice(cursor, openerEnd);
      cursor = openerEnd;
      continue;
    }

    output += prose.slice(cursor, opener);
    const body = prose.slice(openerEnd, closer);
    for (const line of body.split("\n")) {
      const text = technicalLine(line);
      if (text !== undefined) units.push({ kind: "inline_code", text });
    }
    output += " ".repeat(closer + delimiter.length - opener);
    cursor = closer + delimiter.length;
  }

  return { units, prose: output };
}

function collectMatches(
  input: string,
  pattern: RegExp,
  kind: QueryTechnicalUnitKind,
  clean: (value: string) => string = (value) => value,
): { units: QueryTechnicalUnit[]; prose: string } {
  const units: QueryTechnicalUnit[] = [];
  const prose = input.replace(pattern, (raw: string) => {
    const text = clean(raw);
    if (text.length > 0) units.push({ kind, text });
    return " ".repeat(raw.length);
  });
  return { units, prose };
}

export function extractTechnicalUnits(markdown: string): QueryTechnicalUnit[] {
  const fenced = extractFencedCode(markdown);
  const inline = extractInlineCode(fenced.prose);
  const units = [...fenced.units, ...inline.units];
  let prose = inline.prose
    .replace(
      /^ {0,3}#{1,6}[ \t]+\d{1,9}[.)](?=[ \t]+)/gm,
      (marker) => " ".repeat(marker.length),
    )
    .replace(
      /^ {0,3}\d{1,9}[.)](?=[ \t]+)/gm,
      (marker) => " ".repeat(marker.length),
    );

  const collectors: Array<[RegExp, QueryTechnicalUnitKind, ((value: string) => string)?]> = [
    [/\bhttps?:\/\/[^\s<>"'`]+/giu, "url", (value) => value.replace(/[.,;:!?)}\]]+$/g, "")],
    [/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, "ipv4"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "uuid"],
    [/(?<![\p{L}\p{N}])(?:~|\.{1,2})?\/(?:[A-Za-z0-9._~+@%=-]+\/)*[A-Za-z0-9._~+@%=-]+/gu, "path"],
    [/\b[A-Za-z_][A-Za-z0-9_.-]*[ \t]*=[ \t]*[^\s,;]+/g, "assignment"],
    [/(?:^|[\s(])--[A-Za-z0-9][A-Za-z0-9-]*/g, "flag", (value) =>
      /--[A-Za-z0-9][A-Za-z0-9-]*/.exec(value)?.[0] ?? ""],
    [/\bv?\d+(?:\.\d+){1,3}\b/giu, "number"],
    [/\b\d+(?:,\d+)?\b/g, "number"],
  ];
  for (const [pattern, kind, clean] of collectors) {
    const collected = collectMatches(prose, pattern, kind, clean);
    units.push(...collected.units);
    prose = collected.prose;
  }

  return uniqueUnits(units);
}

function containsExactNumber(context: string, value: string): boolean {
  let offset = 0;
  while (offset <= context.length - value.length) {
    const index = context.indexOf(value, offset);
    if (index < 0) return false;
    const before = context[index - 1] ?? "";
    const after = context[index + value.length] ?? "";
    const joinsPreviousNumber = /\d/.test(before)
      || ((before === "." || before === ",") && /\d/.test(context[index - 2] ?? ""));
    const joinsNextNumber = /\d/.test(after)
      || ((after === "." || after === ",") && /\d/.test(context[index + value.length + 1] ?? ""));
    if (!joinsPreviousNumber && !joinsNextNumber) return true;
    offset = index + 1;
  }
  return false;
}

export function findUnsupportedTechnicalUnits(
  answer: string,
  selectedContext: readonly string[],
): QueryTechnicalUnit[] {
  const context = normalizeText(selectedContext.join("\n"));
  return extractTechnicalUnits(answer).filter((unit) => {
    const value = normalizeText(unit.text);
    return unit.kind === "number"
      ? !containsExactNumber(context, value)
      : !context.includes(value);
  });
}

function unitIdentity(unit: QueryTechnicalUnit): string {
  return `${unit.kind}\u0000${normalizeText(unit.text).trim()}`;
}

function removeInlineCodeUnit(line: string, target: string): { line: string; removed: boolean } {
  let output = "";
  let cursor = 0;
  let removed = false;
  while (cursor < line.length) {
    const opener = line.indexOf("`", cursor);
    if (opener < 0) {
      output += line.slice(cursor);
      break;
    }
    let openerEnd = opener + 1;
    while (line[openerEnd] === "`") openerEnd += 1;
    const delimiter = "`".repeat(openerEnd - opener);
    const closer = line.indexOf(delimiter, openerEnd);
    if (closer < 0) {
      output += line.slice(cursor);
      break;
    }
    output += line.slice(cursor, opener);
    const body = line.slice(openerEnd, closer);
    if (normalizeText(body).trim() === target) {
      removed = true;
    } else {
      output += line.slice(opener, closer + delimiter.length);
    }
    cursor = closer + delimiter.length;
  }
  return { line: output, removed };
}

function cleanSanitizedProseLine(line: string): string {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  const body = line.slice(leading.length)
    .replace(/\[([^\]]+)]\([ \t]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([([])[ \t]+/g, "$1")
    .replace(/[ \t]+([)\]])/g, "$1")
    .trim();
  if (!/[\p{L}\p{N}`\]]/u.test(body)) return "";
  return `${leading}${body}`;
}

export function sanitizeUnsupportedTechnicalLines(
  answer: string,
  unsupported: readonly QueryTechnicalUnit[],
): QueryGroundingSanitization {
  if (unsupported.length === 0) return { answer, removedLines: 0, removedUnits: 0 };

  const lines = normalizeText(answer).split("\n");
  const keep = lines.map(() => true);
  const unsupportedIds = new Set(unsupported.map(unitIdentity));
  const fenceRanges: Array<{ start: number; end: number }> = [];
  let fence: MarkdownFence | undefined;
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
      const text = technicalLine(line);
      if (text !== undefined && unsupportedIds.has(unitIdentity({ kind: "fenced_code", text }))) {
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
    const lineUnsupported = extractTechnicalUnits(line)
      .filter((unit) => unsupportedIds.has(unitIdentity(unit)))
      .sort((left, right) => right.text.length - left.text.length);
    if (lineUnsupported.length > 0) {
      let sanitizedLine = line;
      for (const unit of lineUnsupported) {
        if (unit.kind === "inline_code") {
          const result = removeInlineCodeUnit(sanitizedLine, normalizeText(unit.text).trim());
          sanitizedLine = result.line;
          if (result.removed) removedUnits += 1;
          continue;
        }
        if (!sanitizedLine.includes(unit.text)) continue;
        sanitizedLine = sanitizedLine.split(unit.text).join("");
        removedUnits += 1;
      }
      lines[index] = cleanSanitizedProseLine(sanitizedLine);
      if (lines[index].length === 0) keep[index] = false;
    }
  }
  if (fence !== undefined) fenceRanges.push({ start: fenceStart, end: lines.length - 1 });

  for (const range of fenceRanges) {
    const hasGroundedContent = lines.slice(range.start + 1, range.end)
      .some((line, offset) => keep[range.start + 1 + offset] && technicalLine(line) !== undefined);
    if (hasGroundedContent) continue;
    for (let index = range.start; index <= range.end; index++) keep[index] = false;
  }

  return {
    answer: lines.filter((_, index) => keep[index]).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removedLines: keep.filter((value) => !value).length,
    removedUnits,
  };
}
