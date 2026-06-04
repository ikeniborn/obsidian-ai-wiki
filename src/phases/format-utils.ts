export interface FormatResponse {
  report: string;
  formatted: string;
}

export function extractJsonObject(text: string): FormatResponse | null {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        const parsed = tryParseJson(slice);
        if (!parsed) return null;
        if (typeof parsed.report !== "string" || typeof parsed.formatted !== "string") return null;
        return { report: parsed.report, formatted: parsed.formatted };
      }
    }
  }
  return null;
}

export function looksTruncated(text: string): boolean {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let sawOpen = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") { depth++; sawOpen = true; }
    else if (ch === "}") {
      depth--;
      if (depth === 0) return false;
    }
  }
  return sawOpen && (depth > 0 || inString);
}

function stripCodeFence(text: string): string {
  // Strip ONLY if the entire response is wrapped in a fence — anchored.
  // Inner ```sql / ```bash etc. внутри `formatted` строки JSON НЕ должны срабатывать.
  const fence = text.match(/^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) return fence[1];
  return text;
}

function tryParseJson(slice: string): Record<string, unknown> | null {
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(repairJson(slice)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function repairJson(s: string): string {
  const noTrailing = s.replace(/,(\s*[}\]])/g, "$1");
  return escapeRawControlsInStrings(noTrailing);
}

function escapeRawControlsInStrings(src: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const code = ch.charCodeAt(0);
    if (escape) { out += ch; escape = false; continue; }
    if (inString && ch === "\\") { out += ch; escape = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

const STOP_WORDS = new Set([
  "The", "This", "That", "These", "Those", "And", "Or", "But", "If", "When",
]);

export function significantTokens(text: string): Set<string> {
  const out = new Set<string>();

  let residual = text;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out.add(m[0].replace(/[.,;:!?)\]}>"']+$/, ""));
  }
  residual = residual.replace(/https?:\/\/\S+/g, " ");

  // Числа: только standalone (с word-boundary) — иначе из "2025" извлекаем "025".
  for (const m of residual.matchAll(/\b\d+(?:\.\d+)?\b/g)) out.add(m[0]);
  // Latin-имена: \b перед заглавной — НЕ извлекать suffix из camelCase
  // (раньше из "socketTimeout" доставали "Timeout" → false-positive в формат-валидаторе).
  for (const m of residual.matchAll(/\b[A-Z][A-Za-z0-9-]{2,}/g)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0]);
  }
  for (const m of residual.matchAll(/\b[A-Z]{2,}\b/g)) out.add(m[0]);

  // Идентификаторы из inline `code` и fenced ```blocks``` — целое слово,
  // word-boundary защищает от извлечения подстрок.
  for (const m of residual.matchAll(/`([^`\n]+)`/g)) {
    for (const id of m[1].matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) out.add(id[0]);
  }
  for (const m of residual.matchAll(/```[\s\S]*?```/g)) {
    for (const id of m[0].matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) out.add(id[0]);
  }

  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Obsidian embed pattern: ![[path]] or ![[path|alias]]
const OBSIDIAN_EMBED_RE = /!\[\[[^\]]+\]\]/g;

/**
 * Restores Obsidian embed links (![[...]]) that LLM converted to standard Markdown (![...](path)).
 * Matches by inner path: if formatted has ![any](path) where path === embed inner path, restores.
 */
export function restoreObsidianEmbeds(original: string, formatted: string): string {
  let result = formatted;
  for (const m of original.matchAll(OBSIDIAN_EMBED_RE)) {
    const embedSrc = m[0];
    if (result.includes(embedSrc)) continue;
    const innerPath = embedSrc.slice(3, -2); // strip ![[  and  ]]
    const pipeIdx = innerPath.indexOf("|");
    const filePath = pipeIdx >= 0 ? innerPath.slice(0, pipeIdx) : innerPath;
    const stdRe = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(filePath)}\\)`, "g");
    result = result.replace(stdRe, embedSrc);
  }
  return result;
}

/** Returns ![[...]] embeds from original that are absent in formatted after restoration. */
export function missingObsidianEmbeds(original: string, formatted: string): string[] {
  const missing: string[] = [];
  for (const m of original.matchAll(OBSIDIAN_EMBED_RE)) {
    if (!formatted.includes(m[0])) missing.push(m[0]);
  }
  return missing;
}

export function missingTokens(original: string, formatted: string): string[] {
  return missingTokensWithContext(original, formatted).map((m) => m.token);
}

export interface MissingToken {
  token: string;
  context: string;
}

function lemmas(token: string): string[] {
  const out = [token];
  // Plural → singular: aggregations → aggregation, entries → entry, boxes → box.
  if (/ies$/i.test(token) && token.length > 4) out.push(token.slice(0, -3) + "y");
  else if (/(?:s|x|z|ch|sh)es$/i.test(token) && token.length > 4) out.push(token.slice(0, -2));
  else if (/s$/i.test(token) && !/ss$/i.test(token) && token.length > 3) out.push(token.slice(0, -1));
  // Singular → plural: aggregation → aggregations, box → boxes, entry → entries.
  else if (/[^aeiou]y$/i.test(token) && token.length > 2) out.push(token.slice(0, -1) + "ies");
  else if (/(?:s|x|z|ch|sh)$/i.test(token) && token.length > 2) out.push(token + "es");
  else if (token.length > 2) out.push(token + "s");
  return out;
}

export function appendMissingLines(formatted: string, missing: MissingToken[]): string {
  const lines = [...new Set(missing.filter((m) => m.context !== "").map((m) => m.context))];
  if (lines.length === 0) return formatted;
  return `${formatted}\n\n---\n<!-- restored-lines: token loss after retry -->\n${lines.join("\n")}`;
}

export function missingTokensWithContext(original: string, formatted: string): MissingToken[] {
  const orig = significantTokens(original);
  const fmtLower = formatted.toLowerCase();
  const lines = original.split(/\r?\n/);
  const out: MissingToken[] = [];
  for (const t of orig) {
    const variants = lemmas(t).map((v) => v.toLowerCase());
    const found = variants.some((v) => {
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(v)}(?:[^A-Za-z0-9_]|$)`);
      return re.test(fmtLower);
    });
    if (found) continue;
    const lineRe = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(t)}(?:[^A-Za-z0-9_]|$)`);
    let context = "";
    for (const line of lines) {
      if (lineRe.test(line)) {
        const trimmed = line.trim();
        context = trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed;
        break;
      }
    }
    out.push({ token: t, context });
  }
  return out;
}

export interface SentinelOutput {
  report: string;
  formatted: string;
  visionCount?: number;
  embeds?: string[];
  truncated: boolean;
}

export function parseSentinelOutput(text: string, hasVisionDescriptions: boolean): SentinelOutput | null {
  const reportIdx = text.indexOf("<<<REPORT>>>");
  const formattedIdx = text.indexOf("<<<FORMATTED>>>");
  if (reportIdx === -1 || formattedIdx === -1) return null;

  const report = text.slice(reportIdx + "<<<REPORT>>>".length, formattedIdx).trim();
  const endIdx = text.indexOf("<<<END>>>");

  let formattedEnd: number;
  let truncated = false;
  let visionCount: number | undefined;
  let embeds: string[] | undefined;

  if (hasVisionDescriptions) {
    const visionIdx = text.indexOf("<<<VISION_COUNT>>>", formattedIdx);
    const embedsIdx = text.indexOf("<<<EMBEDS>>>", formattedIdx);
    if (visionIdx === -1 || embedsIdx === -1) return null;
    formattedEnd = visionIdx;
    visionCount = parseInt(text.slice(visionIdx + "<<<VISION_COUNT>>>".length, embedsIdx).trim(), 10);
    const embedsEnd = endIdx === -1 ? text.length : endIdx;
    embeds = text
      .slice(embedsIdx + "<<<EMBEDS>>>".length, embedsEnd)
      .trim()
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    truncated = endIdx === -1;
  } else {
    formattedEnd = endIdx === -1 ? text.length : endIdx;
    truncated = endIdx === -1;
  }

  const formatted = text.slice(formattedIdx + "<<<FORMATTED>>>".length, formattedEnd).trim();
  return { report, formatted, visionCount, embeds, truncated };
}
