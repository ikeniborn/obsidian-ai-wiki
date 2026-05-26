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
    annotation: z.string().optional(),
  })).default([]),
});

export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
}).superRefine((val, ctx) => {
  // Extract body only (after frontmatter) — wiki_sources in frontmatter
  // intentionally uses [[path/to/source]] format and must not be checked.
  const fmEnd = val.content.startsWith("---\n")
    ? (() => { const i = val.content.indexOf("\n---", 4); return i >= 0 ? i + 4 : 0; })()
    : 0;
  const body = val.content.slice(fmEnd);

  if (/\[\[[^\]]+\|[^\]]+\]\]/.test(body)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WikiLink aliases not allowed", path: ["content"] });
  }
  const linkRe = /\[\[([^\]|]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(body)) !== null) {
    if (m[1].includes("/")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WikiLink with path", path: ["content"] });
      break;
    }
  }
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});

export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
});

export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});

export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
export type LintChatResponse = z.infer<typeof LintChatSchema>;
export type WikiPageResponse = z.infer<typeof WikiPageSchema>;
export type WikiPagesOutput = z.infer<typeof WikiPagesOutputSchema>;
export type LintOutput = z.infer<typeof LintOutputSchema>;
export type FormatOutput = z.infer<typeof FormatOutputSchema>;
