import type { RunEvent } from "./types";
import { consolidateSourcePaths } from "./source-paths";

export interface EntityType {
  type: string;
  description: string;
  extraction_cues: string[];
  min_mentions_for_page?: number;
  wiki_subfolder?: string;
}

export interface DomainEntry {
  id: string;
  name: string;
  wiki_folder: string;
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
  analyzed_sources?: Record<string, string>;  // source vault path → body hash ("" = baseline pending)
  analyzed_sources_v2?: boolean;
  analyzed_sources_v3?: boolean;               // list → map migration flag
  pageNameVersion?: number;
}

export function migrateDomainsV2(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean } {
  let migrated = false;
  for (const d of domains) {
    if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
      d.analyzed_sources = {};
      d.analyzed_sources_v2 = true;
      migrated = true;
    }
  }
  return { domains, migrated };
}

/**
 * v3: convert legacy `analyzed_sources` (string[]) → map (path → ""), so the
 * value can hold the source body hash. Empty hashes are filled by the silent
 * baseline on the first incremental plan. Pure (no vault access).
 */
export function migrateDomainsV3(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean } {
  let migrated = false;
  for (const d of domains) {
    if (d.analyzed_sources_v3) continue;
    const cur = d.analyzed_sources as unknown;
    if (Array.isArray(cur)) {
      const map: Record<string, string> = {};
      for (const p of cur) map[String(p)] = "";
      d.analyzed_sources = map;
    }
    // when cur is already an object (or undefined) there is nothing to convert
    d.analyzed_sources_v3 = true;
    migrated = true;
  }
  return { domains, migrated };
}

export interface AddDomainInput {
  id: string;
  name: string;
  wikiFolder: string;  // domain subfolder within !Wiki/, e.g. "os"
  sourcePaths: string[];
}

/** Returns null if id is valid, or an error message string. */
export function validateDomainId(id: string): string | null {
  if (!id) return "ID домена пуст";
  if (!/^[\p{L}\p{N}_-]+$/u.test(id)) return "ID допускает только буквы/цифры/_/-";
  return null;
}

export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}

type DomainPersistEvent = Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" | "source_path_removed" }>;

export function applyDomainEvent(
  domains: DomainEntry[],
  ev: DomainPersistEvent,
  opts?: { vaultRoot?: string },
): DomainEntry[] {
  const next = [...domains];
  if (ev.kind === "domain_created") {
    if (next.some((d) => d.id === ev.entry.id)) return next;
    next.push(ev.entry);
    return next;
  }
  const i = next.findIndex((d) => d.id === ev.domainId);
  if (i < 0) return next;
  if (ev.kind === "domain_updated") {
    next[i] = { ...next[i], ...ev.patch };
    return next;
  }
  if (ev.kind === "source_path_removed") {
    const existing = next[i].source_paths ?? [];
    const updated = existing.filter((p) => p !== ev.path);
    if (updated.length === existing.length) return domains; // no exact entry (folder-based source) → unchanged
    next[i] = { ...next[i], source_paths: updated };
    return next;
  }
  // source_path_added
  const existing = next[i].source_paths ?? [];
  let updated: string[];
  if (opts?.vaultRoot !== undefined) {
    updated = consolidateSourcePaths(existing, ev.path, opts.vaultRoot);
    if (updated === existing) return domains;
  } else {
    if (existing.includes(ev.path)) return domains;
    updated = [...existing, ev.path];
  }
  next[i] = { ...next[i], source_paths: updated };
  return next;
}
