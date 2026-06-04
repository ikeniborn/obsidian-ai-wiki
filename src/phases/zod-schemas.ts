import { z } from "zod";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";

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
  const fm = val.content.slice(0, fmEnd);
  const body = val.content.slice(fmEnd);

  // wiki_sources entries must be double-quoted to prevent YAML from parsing [[...]] as a flow sequence.
  const sourcesBlock = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fm);
  if (sourcesBlock) {
    const unquoted = [...sourcesBlock[1].matchAll(/[ \t]+-[ \t]+(\[\[[^\]]+\]\])/g)];
    if (unquoted.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `wiki_sources entries must be double-quoted: "[[...]]" (found unquoted: ${unquoted.map(m => m[1]).join(", ")})`, path: ["content"] });
    }
  }

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

  const stem = val.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Wiki page stem "${stem}" must match wiki_<domain>_<entity>`,
      path: ["path"],
    });
  }
});

export const EntitiesOutputSchema = z.object({
  reasoning: z.string(),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    context_snippet: z.string().optional(),
  })).max(50),
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  deletes: z.array(z.object({ path: z.string() })).optional(),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});

export const LintDeleteSchema = z.object({
  path: z.string(),
  redirect_to: z.string().optional(),
});

export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
  deletes: z.array(LintDeleteSchema).optional(),
});

export const FormatBaseSchema = z.object({
  report: z.string().min(1, "report не должен быть пустым"),
  formatted: z.string().min(10, "formatted слишком короткий"),
});

export const FormatWithVisionSchema = FormatBaseSchema.extend({
  vision_blocks_count: z.number().int().min(0),
  embeds_preserved: z.array(z.string()),
}).superRefine((val, ctx) => {
  if (!val.formatted.startsWith("---\n")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["formatted"],
      message: "formatted должен начинаться с YAML frontmatter (---)",
    });
  }
  if (val.report.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["report"], message: "report пуст" });
  }
  for (const path of val.embeds_preserved) {
    if (!val.formatted.includes(`![[${path}]]`)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formatted"],
        message: `embed ![[${path}]] потерян`,
      });
    }
  }
});

export const FormatOutputSchema = FormatBaseSchema.superRefine((val, ctx) => {
  if (!val.formatted.startsWith("---\n")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["formatted"],
      message: "formatted должен начинаться с YAML frontmatter (---)",
    });
  }
  if (val.report.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["report"], message: "report пуст" });
  }
});

export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
export type LintChatResponse = z.infer<typeof LintChatSchema>;
export type WikiPageResponse = z.infer<typeof WikiPageSchema>;
export type EntitiesOutput = z.infer<typeof EntitiesOutputSchema>;
export type WikiPagesOutput = z.infer<typeof WikiPagesOutputSchema>;
export type LintDelete = z.infer<typeof LintDeleteSchema>;
export type LintOutput = z.infer<typeof LintOutputSchema>;
export type FormatOutput = z.infer<typeof FormatBaseSchema>;
