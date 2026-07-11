import type { DomainEntry, EntityType } from "./domain";
import { parseJsonl, stringifyJsonl } from "./jsonl";

export interface DomainMetadataRecord {
  kind: "domain";
  schemaVersion: 1;
  id: string;
  name: string;
  wiki_folder: string;
  source_paths: string[];
  language_notes?: string;
  max_tag_categories?: number;
  pageNameVersion?: number;
}

export interface EntityTypeMetadataRecord extends EntityType {
  kind: "entity_type";
}

export interface SourceStateMetadataRecord {
  kind: "source_state";
  path: string;
  hash: string;
}

export type MetadataRecord =
  | DomainMetadataRecord
  | EntityTypeMetadataRecord
  | SourceStateMetadataRecord
  | Record<string, unknown>;

function setIfDefined<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): asserts target is T & Record<K, V> {
  if (value !== undefined) {
    (target as T & Record<K, V>)[key] = value;
  }
}

export function domainEntryToMetadataRecords(entry: DomainEntry): MetadataRecord[] {
  const domain: DomainMetadataRecord = {
    kind: "domain",
    schemaVersion: 1,
    id: entry.id,
    name: entry.name,
    wiki_folder: entry.wiki_folder,
    source_paths: entry.source_paths ?? [],
  };
  setIfDefined(domain, "language_notes", entry.language_notes);
  setIfDefined(domain, "max_tag_categories", entry.max_tag_categories);
  setIfDefined(domain, "pageNameVersion", entry.pageNameVersion);

  const types = (entry.entity_types ?? []).map((type) => ({ kind: "entity_type" as const, ...type }));
  const sources = Object.entries(entry.analyzed_sources ?? {})
    .map(([path, hash]) => ({ kind: "source_state" as const, path, hash }));
  return [domain, ...types, ...sources];
}

export function metadataRecordsToDomainEntry(records: MetadataRecord[], fallbackFolder: string): DomainEntry {
  const domain = records.find((r): r is DomainMetadataRecord => r.kind === "domain");
  if (!domain) throw new Error(`${fallbackFolder}: missing domain record`);

  const entityTypes = records
    .filter((r): r is EntityTypeMetadataRecord => r.kind === "entity_type")
    .map(({ kind: _kind, ...type }) => type);

  const analyzedSources: Record<string, string> = {};
  for (const record of records) {
    if (
      record.kind === "source_state" &&
      typeof record.path === "string" &&
      typeof record.hash === "string"
    ) {
      analyzedSources[record.path] = record.hash;
    }
  }

  const entry: DomainEntry = {
    id: domain.id,
    name: domain.name,
    wiki_folder: domain.wiki_folder || fallbackFolder,
    source_paths: domain.source_paths ?? [],
    entity_types: entityTypes,
    analyzed_sources: analyzedSources,
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  };
  setIfDefined(entry, "language_notes", domain.language_notes);
  setIfDefined(entry, "pageNameVersion", domain.pageNameVersion);
  setIfDefined(entry, "max_tag_categories", domain.max_tag_categories);
  return entry;
}

export function parseDomainMetadata(text: string, path: string, fallbackFolder: string): DomainEntry {
  return metadataRecordsToDomainEntry(parseJsonl<MetadataRecord>(text, path), fallbackFolder);
}

export function stringifyDomainMetadata(records: MetadataRecord[]): string {
  return stringifyJsonl(records);
}
