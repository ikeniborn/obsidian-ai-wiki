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
  analyzed_sources?: string[];
  analyzed_sources_v2?: boolean;
  pageNameVersion?: number;
}

export function migrateDomainsV2(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean } {
  let migrated = false;
  for (const d of domains) {
    if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
      d.analyzed_sources = [];
      d.analyzed_sources_v2 = true;
      migrated = true;
    }
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

type DomainPersistEvent = Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" }>;

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
