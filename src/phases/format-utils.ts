export interface FormatResponse {
  report: string;
  formatted: string;
}

export function extractJsonObject(text: string): FormatResponse | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          if (typeof parsed.report !== "string" || typeof parsed.formatted !== "string") return null;
          return { report: parsed.report, formatted: parsed.formatted };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const STOP_WORDS = new Set([
  "The", "This", "That", "These", "Those", "And", "Or", "But", "If", "When",
  "Это", "Этот", "Эти", "Тот", "Если", "Когда", "Однако", "Также",
]);

export function significantTokens(text: string): Set<string> {
  const out = new Set<string>();

  for (const m of text.matchAll(/https?:\/\/\S+/g)) out.add(m[0]);
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const m of text.matchAll(/[A-ZА-Я][\wА-Яа-я-]{2,}/g)) {
    if (!STOP_WORDS.has(m[0])) out.add(m[0]);
  }

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
