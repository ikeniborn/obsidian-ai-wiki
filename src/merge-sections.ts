interface Section {
  headingKey: string; // normalized heading text (no leading #, lowercased)
  block: string;      // heading line + body, trimmed
}

/** Normalized comparison key for a `##` heading line. */
function headingKey(headingLine: string): string {
  return headingLine.replace(/^#+\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split markdown into top-level `##` sections. Content before the first
 *  `## ` heading (title, intro) is ignored — only `##` sections are compared. */
function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (heading !== null) {
      sections.push({ headingKey: headingKey(heading), block: `${heading}\n${body.join("\n")}`.trim() });
    }
  };
  for (const line of md.split("\n")) {
    if (/^##\s+/.test(line)) {
      flush();
      heading = line.trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

const SKIP_HEADINGS = new Set(["related", "external links"]);

/**
 * Deterministic floor for the LLM ingest merge: append any `##` section that
 * exists in `incoming` but is missing from `merged`, verbatim. Structural
 * sections (`## Related`, `## External links`) are skipped — the merge prompt
 * already unions those bullet lists.
 */
export function ensureIncomingSections(merged: string, incoming: string): string {
  const mergedKeys = new Set(parseSections(merged).map((s) => s.headingKey));
  const missing = parseSections(incoming).filter(
    (s) => !SKIP_HEADINGS.has(s.headingKey) && !mergedKeys.has(s.headingKey),
  );
  if (missing.length === 0) return merged;
  const appendix = missing.map((s) => s.block).join("\n\n");
  return `${merged.replace(/\s*$/, "")}\n\n${appendix}\n`;
}
