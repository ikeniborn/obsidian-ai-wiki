// Gold-set fixture loader (Component 3). A gold set is a vault-specific JSON
// array of { q, gold } pairs, where `gold` lists 1+ relevant pageId stems.

export interface GoldPair {
  q: string;
  gold: string[];
}

/** Parse + validate a gold-set JSON string. Throws a descriptive Error on any defect. */
export function parseGold(raw: string): GoldPair[] {
  const data = JSON.parse(raw) as unknown; // throws on malformed JSON
  if (!Array.isArray(data)) {
    throw new Error("gold set must be a JSON array of { q, gold } pairs");
  }
  if (data.length === 0) {
    throw new Error("gold set is empty — nothing to evaluate");
  }
  return data.map((entry, i) => {
    const e = entry as { q?: unknown; gold?: unknown };
    if (typeof e.q !== "string" || e.q.trim() === "") {
      throw new Error(`gold[${i}]: "q" must be a non-empty string`);
    }
    if (!Array.isArray(e.gold) || e.gold.length === 0 || !e.gold.every((g) => typeof g === "string")) {
      throw new Error(`gold[${i}]: "gold" must be a non-empty array of pageId strings`);
    }
    return { q: e.q, gold: e.gold as string[] };
  });
}
