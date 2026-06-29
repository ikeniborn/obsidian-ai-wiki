import type { DomainEntry } from "./domain";
import type { RunHistoryEntry } from "./types";

export type RerunDomainResult =
  | { ok: true; domainId: string }
  | { ok: false; reason: "missing" | "not-found" };

/**
 * Resolve the domain a history entry should re-run against. The entry's stored
 * domainId is authoritative — this never falls back to the first domain. Returns
 * an explicit failure (not a default) when the id is absent or no longer exists,
 * so callers surface an error instead of querying the wrong domain.
 */
export function resolveRerunDomain(
  entry: RunHistoryEntry,
  domains: DomainEntry[],
): RerunDomainResult {
  const id = entry.domainId;
  if (!id) return { ok: false, reason: "missing" };
  if (id === "*") return { ok: true, domainId: "*" };   // cross-domain sentinel: search all domains
  if (!domains.some((d) => d.id === id)) return { ok: false, reason: "not-found" };
  return { ok: true, domainId: id };
}
