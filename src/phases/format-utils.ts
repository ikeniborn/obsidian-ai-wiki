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

function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
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

  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out.add(m[0].replace(/[.,;:!?)\]}>"']+$/, ""));
  }
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const m of text.matchAll(/[A-Z][A-Za-z0-9-]{2,}/g)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0]);
  }
  for (const m of text.matchAll(/\b[A-Z]{2,}\b/g)) out.add(m[0]);

  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(id[0]);
  }
  for (const m of text.matchAll(/```[\s\S]*?```/g)) {
    for (const id of m[0].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(id[0]);
  }

  return out;
}

export function missingTokens(original: string, formatted: string): string[] {
  const orig = significantTokens(original);
  const fmt = significantTokens(formatted);
  const missing: string[] = [];
  for (const t of orig) if (!fmt.has(t)) missing.push(t);
  return missing;
}
