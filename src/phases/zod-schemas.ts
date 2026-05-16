import { z } from "zod";

const EntityTypeSchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  extraction_cues: z.array(z.string()),
  min_mentions_for_page: z.number().optional(),
  wiki_subfolder: z.string().optional(),
});

export const DomainEntrySchema = z.object({
  reasoning: z.string(),
  id: z.string().min(1),
  name: z.string(),
  wiki_folder: z.string().min(1),
  entity_types: z.array(EntityTypeSchema),
  language_notes: z.string(),
});

export const EntityTypesDeltaSchema = z.object({
  reasoning: z.string(),
  entity_types: z.array(EntityTypeSchema).optional(),
  language_notes: z.string().optional(),
});

export const SeedsSchema = z.object({
  reasoning: z.string().optional(),
  seeds: z.array(z.string()),
});

export const LintChatSchema = z.object({
  summary: z.string(),
  pages: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).default([]),
});

export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
export type LintChatResponse = z.infer<typeof LintChatSchema>;
