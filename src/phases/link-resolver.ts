// Deterministic resolver for broken WikiLink stems emitted by the query answer.
// No LLM. Maps an abbreviated / mis-formatted stem (e.g. "DWM-88393") to its
// canonical wiki page stem (e.g. "wiki_rtk-task_dwm_88393") by id fragment.
//
// Entity grouping: a source note ("DWM-88393 ...") and its generated wiki page
// ("wiki_rtk-task_dwm_88393") share the same id and are ONE entity, not an
// ambiguity. Two DIFFERENT ids that share a digit substring are distinct
// entities -> ambiguous (we never guess).

export type ResolveResult =
  | { kind: "resolved"; stem: string }
  | { kind: "ambiguous" }
  | { kind: "unresolved" };

interface IdParts {
  prefix: string; // letters before the number, lowercased ("dwm", "dg", "" )
  digits: string; // the numeric run ("88393")
}

/** Extract the first id-like token: optional letter prefix + a run of >=2 digits. */
export function extractId(stem: string): IdParts | null {
  const m = stem.match(/([a-z]{1,8})?[-_ ]?(\d{2,})/i);
  if (!m) return null;
  return { prefix: (m[1] ?? "").toLowerCase(), digits: m[2] };
}

/** Canonical entity key for grouping: prefix + digits ("dwm88393", "88393"). */
function entityKey(p: IdParts): string {
  return `${p.prefix}${p.digits}`;
}

/**
 * Resolve a broken stem against candidate stems.
 * - candidates whose digits CONTAIN the broken digits and whose prefix is
 *   compatible (broken prefix empty, or equal) are matches.
 * - matches grouped by entityKey:
 *     1 distinct entity   -> resolved (prefer a `wiki_` candidate)
 *     >=2 distinct entity -> ambiguous
 *     0                   -> unresolved
 */
export function resolveLink(brokenStem: string, candidates: string[]): ResolveResult {
  const broken = extractId(brokenStem);
  if (!broken) return { kind: "unresolved" };

  const matches: { stem: string; key: string }[] = [];
  for (const cand of candidates) {
    const id = extractId(cand);
    if (!id) continue;
    // Substring match (candidate CONTAINS broken) is intentional: it makes
    // 88393 match both 88393 and 188393, so distinct ids surface as ambiguous
    // rather than a silent guess. The single-candidate superstring false
    // positive (broken 88393 matching a lone 188393) is an accepted limitation
    // -- real-vault ticket ids (DWM-NNNNN) are unique and not substrings of one
    // another.
    const digitsOk = id.digits.includes(broken.digits);
    const prefixOk = broken.prefix === "" || broken.prefix === id.prefix;
    if (digitsOk && prefixOk) matches.push({ stem: cand, key: entityKey(id) });
  }

  if (matches.length === 0) return { kind: "unresolved" };

  const distinctKeys = new Set(matches.map((m) => m.key));
  if (distinctKeys.size > 1) return { kind: "ambiguous" };

  // Single entity: prefer the wiki_* representation, else the first match.
  const wiki = matches.find((m) => m.stem.startsWith("wiki_"));
  return { kind: "resolved", stem: (wiki ?? matches[0]).stem };
}
