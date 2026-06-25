// src/prompt-version.ts
// Deterministic short content-hash of a prompt/template string, used as
// `promptVersion` provenance in eval.jsonl. FNV-1a → 8 hex chars. Pure JS,
// mobile-safe, captures the exact bytes that produced an LLM output.

const _cache = new Map<string, string>();

/** FNV-1a 32-bit hash of `s`, rendered as 8 lowercase hex chars. */
export function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Memoized hash8 of a prompt template string. */
export function promptVersionOf(template: string): string {
  let v = _cache.get(template);
  if (v === undefined) {
    v = hash8(template);
    _cache.set(template, v);
  }
  return v;
}

/**
 * Version of a set of vision templates the run invoked: sort the template
 * strings deterministically, hash each, join with "|", hash the join. The
 * per-template hash removes any concatenation-boundary ambiguity.
 */
export function visionPromptVersionOf(templates: string[]): string {
  if (templates.length === 0) return "";
  const joined = templates.map(hash8).sort().join("|");
  return hash8(joined);
}
