import type { EntityType } from "../domain";

// ─── Bootstrap (init file 0, init без --sources) ─────────────────────────────

export interface DomainEntryResponse {
  reasoning: string;
  id: string;
  name: string;
  wiki_folder: string;
  entity_types: EntityType[];
  language_notes: string;
}

// ─── Incremental delta (init files 1+, lint patch) ───────────────────────────

export interface EntityTypesDeltaResponse {
  reasoning: string;
  entity_types?: EntityType[];
  language_notes?: string;
}

// ─── Seed extraction (query) ─────────────────────────────────────────────────

export interface SeedsResponse {
  reasoning?: string;
  seeds: string[];
}
