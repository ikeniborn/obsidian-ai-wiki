import type { EntityType } from "../domain";
import type { StructuredOutputSchema } from "./llm-utils";

// ─── Shared sub-schema ───────────────────────────────────────────────────────

const ENTITY_TYPE_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    type:                  { type: "string" },
    description:           { type: "string" },
    extraction_cues:       { type: "array", items: { type: "string" } },
    min_mentions_for_page: { type: "number" },
    wiki_subfolder:        { type: "string" },
  },
  required: ["type", "description", "extraction_cues", "wiki_subfolder"],
  additionalProperties: false,
};

// ─── Bootstrap (init file 0, init без --sources) ─────────────────────────────

export interface DomainEntryResponse {
  reasoning: string;
  id: string;
  name: string;
  wiki_folder: string;
  entity_types: EntityType[];
  language_notes: string;
}

export const DOMAIN_ENTRY_SCHEMA: StructuredOutputSchema = {
  name: "domain_entry",
  schema: {
    type: "object",
    properties: {
      reasoning:      { type: "string" },
      id:             { type: "string" },
      name:           { type: "string" },
      wiki_folder:    { type: "string" },
      entity_types:   { type: "array", items: ENTITY_TYPE_ITEM_SCHEMA },
      language_notes: { type: "string" },
    },
    required: ["reasoning", "id", "name", "wiki_folder", "entity_types", "language_notes"],
    additionalProperties: false,
  },
};

// ─── Incremental delta (init files 1+, lint patch) ───────────────────────────

export interface EntityTypesDeltaResponse {
  reasoning: string;
  entity_types?: EntityType[];
  language_notes?: string;
}

export const ENTITY_TYPES_DELTA_SCHEMA: StructuredOutputSchema = {
  name: "entity_types_delta",
  schema: {
    type: "object",
    properties: {
      reasoning:      { type: "string" },
      entity_types:   { type: "array", items: ENTITY_TYPE_ITEM_SCHEMA },
      language_notes: { type: "string" },
    },
    required: ["reasoning"],
    additionalProperties: false,
  },
};

// ─── Seed extraction (query) ─────────────────────────────────────────────────

export interface SeedsResponse {
  reasoning?: string;
  seeds: string[];
}

export const SEEDS_SCHEMA: StructuredOutputSchema = {
  name: "seeds",
  schema: {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      seeds:     { type: "array", items: { type: "string" } },
    },
    required: ["reasoning", "seeds"],
    additionalProperties: false,
  },
};
