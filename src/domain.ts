import type { RunEvent } from "./types";

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
  wiki_folder: string;  // domain subfolder within !Wiki/, e.g. "os" (without "!Wiki/" prefix)
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
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

type DomainPersistEvent = Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" }>;

export function applyDomainEvent(domains: DomainEntry[], ev: DomainPersistEvent): DomainEntry[] {
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
  const paths = new Set(next[i].source_paths ?? []);
  paths.add(ev.path);
  next[i] = { ...next[i], source_paths: [...paths] };
  return next;
}
