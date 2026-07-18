import { z, type RefinementCtx } from "zod";
import { validateSectionPatches } from "../section-patches";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";

const NonBlankStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "Value must not be blank",
);

const SectionPatchFields = {
  heading: z.string(),
  content: z.string(),
};

const SectionPatchBaseSchema = z.discriminatedUnion("operation", [
  z.object({
    ...SectionPatchFields,
    operation: z.literal("add"),
    expectedSectionHash: z.string().optional(),
  }),
  z.object({
    ...SectionPatchFields,
    operation: z.literal("append"),
    expectedSectionHash: z.string().optional(),
  }),
  z.object({
    ...SectionPatchFields,
    operation: z.literal("replace"),
    expectedSectionHash: z.string().optional(),
    expectedSectionOrdinal: z.number().int().nonnegative().safe().optional(),
  }),
]);

function addSectionPatchIssues(
  sections: unknown[],
  ctx: RefinementCtx,
  includeIndex: boolean,
): void {
  for (const issue of validateSectionPatches(sections)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: includeIndex && issue.index >= 0 ? [issue.index, issue.field] : [issue.field],
      message: issue.message,
    });
  }
}

export const SectionPatchSchema = SectionPatchBaseSchema.superRefine((section, ctx) => {
  addSectionPatchIssues([section], ctx, false);
});

const SectionPatchesSchema = z.array(SectionPatchBaseSchema).superRefine((sections, ctx) => {
  addSectionPatchIssues(sections, ctx, true);
});

export const CreatePageSchema = z.object({
  kind: z.literal("create"),
  path: NonBlankStringSchema,
  annotation: z.string(),
  content: NonBlankStringSchema,
});

export const PatchPageSchema = z.object({
  kind: z.literal("patch"),
  path: NonBlankStringSchema,
  expectedPageHash: NonBlankStringSchema,
  annotation: z.string().optional(),
  sections: SectionPatchesSchema,
});

export const PageActionSchema = z.discriminatedUnion("kind", [
  CreatePageSchema,
  PatchPageSchema,
]);

const SynthesisSectionPatchSchema = z.discriminatedUnion("operation", [
  z.object({
    heading: z.string(),
    content: z.string(),
    operation: z.literal("add"),
  }).strict(),
  z.object({
    heading: z.string(),
    content: z.string(),
    operation: z.literal("append"),
    expectedSectionHash: z.string().optional(),
  }).strict(),
  z.object({
    heading: z.string(),
    content: z.string(),
    operation: z.literal("replace"),
    expectedSectionHash: z.string(),
    expectedSectionOrdinal: z.number().int().nonnegative().safe(),
  }).strict(),
]);

const SynthesisSectionPatchesSchema = z.array(SynthesisSectionPatchSchema).superRefine((sections, ctx) => {
  addSectionPatchIssues(sections, ctx, true);
});

export const SynthesisCreatePageSchema = CreatePageSchema.extend({
  entityKey: NonBlankStringSchema,
}).strict();

export const SynthesisPatchPageSchema = PatchPageSchema.extend({
  entityKey: NonBlankStringSchema,
  sections: SynthesisSectionPatchesSchema,
}).strict();

export const SynthesisActionSchema = z.discriminatedUnion("kind", [
  SynthesisCreatePageSchema,
  SynthesisPatchPageSchema,
]);

export const SynthesisSkipSchema = z.object({
  entityKey: NonBlankStringSchema,
  reason: NonBlankStringSchema,
}).strict();

export const SynthesisOutputSchema = z.object({
  reasoning: z.string(),
  actions: z.array(SynthesisActionSchema),
  skips: z.array(SynthesisSkipSchema),
  entity_types_delta: z.array(z.object({
    type: z.string().min(1),
    description: z.string(),
    extraction_cues: z.array(z.string()),
    min_mentions_for_page: z.number().optional(),
    wiki_subfolder: z.string().optional(),
  }).strict()).optional(),
}).strict().superRefine((output, ctx) => {
  const seenEntities = new Set<string>();
  const seenPaths = new Set<string>();
  for (const [index, action] of output.actions.entries()) {
    const entityKey = action.entityKey.trim().replace(/\s+/g, " ").toLowerCase();
    if (seenEntities.has(entityKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index, "entityKey"], message: "duplicate entity coverage" });
    }
    seenEntities.add(entityKey);
    const path = action.path.normalize("NFC").trim();
    if (seenPaths.has(path)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index, "path"], message: "duplicate action path" });
    }
    seenPaths.add(path);
  }
  for (const [index, skip] of output.skips.entries()) {
    const entityKey = skip.entityKey.trim().replace(/\s+/g, " ").toLowerCase();
    if (seenEntities.has(entityKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skips", index, "entityKey"], message: "duplicate entity coverage" });
    }
    seenEntities.add(entityKey);
  }
});

export type SynthesisAction = z.infer<typeof SynthesisActionSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

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

const EvidenceRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).strict();

export const EvidencePacketSchema = z.object({
  id: NonBlankStringSchema,
  chunkId: NonBlankStringSchema,
  entityKey: NonBlankStringSchema,
  entityType: NonBlankStringSchema.optional(),
  facts: z.array(NonBlankStringSchema).min(1),
  exactSourceRanges: z.array(EvidenceRangeSchema).min(1),
  links: z.array(NonBlankStringSchema),
  sourceAnchor: NonBlankStringSchema,
}).strict();

export const NoEvidenceSchema = z.object({
  chunkId: NonBlankStringSchema,
  reason: NonBlankStringSchema,
}).strict();

export const EvidenceMapperOutputSchema = z.object({
  packets: z.array(EvidencePacketSchema),
  noEvidence: z.array(NoEvidenceSchema),
}).strict();

export const EvidenceMapSchema = z.object({
  chunk: z.object({
    id: NonBlankStringSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).strict(),
  packets: z.array(EvidencePacketSchema),
  noEvidence: z.array(NoEvidenceSchema),
}).strict();

const EntityEvidenceFields = {
  entityKey: NonBlankStringSchema,
  entityType: NonBlankStringSchema.optional(),
  packetIds: z.array(NonBlankStringSchema).min(1),
  facts: z.array(NonBlankStringSchema).min(1),
  exactSourceRanges: z.array(EvidenceRangeSchema).min(1),
  links: z.array(NonBlankStringSchema),
};

export const PreVerifiedEntityEvidenceSchema = z.object(EntityEvidenceFields).strict();

export const EntityEvidenceSchema = z.object({
  ...EntityEvidenceFields,
  exactSource: z.array(z.object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    text: z.string(),
  }).strict()).min(1),
}).strict();

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
  // Extract body only (after frontmatter) — resource in frontmatter is a plain
  // string list and must not be checked against body WikiLink rules.
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

  const stem = val.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Wiki page stem "${stem}" must match wiki_<domain>_<entity>`,
      path: ["path"],
    });
  }
});

export const MergedPageOutputSchema = z.object({
  reasoning: z.string().optional(),
  content: z.string(),
  annotation: z.string().optional(),
});
export type MergedPageOutput = z.infer<typeof MergedPageOutputSchema>;

export const EntitiesOutputSchema = z.object({
  reasoning: z.string(),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    context_snippet: z.string().optional(),
  })).max(50),
});

export const TypeAssignmentsSchema = z.object({
  reasoning: z.string().optional(),
  assignments: z.array(z.object({
    stem: z.string().min(1),
    type: z.string().min(1),
  })),
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

export const LintFindingSchema = z.object({
  path: NonBlankStringSchema,
  heading: NonBlankStringSchema,
  rule: NonBlankStringSchema,
  severity: z.enum(["info", "warning", "error"]),
  text: NonBlankStringSchema,
  repairInstruction: NonBlankStringSchema,
}).strict();

export const LintBatchOutputSchema = z.object({
  coveredWorkIds: z.array(NonBlankStringSchema),
  findings: z.array(LintFindingSchema),
  patches: z.array(PatchPageSchema),
  deletes: z.array(LintDeleteSchema),
}).strict().superRefine((output, ctx) => {
  const covered = new Set<string>();
  for (const [index, id] of output.coveredWorkIds.entries()) {
    if (covered.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coveredWorkIds", index],
        message: "duplicate coveredWorkIds entry",
      });
    }
    covered.add(id);
  }
});

export const LintChatPatchSchema = z.object({
  summary: z.string(),
  patches: z.array(PatchPageSchema),
}).strict();

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

export const FormatSegmentOutputSchema = z.object({
  segmentId: NonBlankStringSchema,
  report: z.string().min(1, "report не должен быть пустым"),
  formatted: z.string().min(1, "formatted не должен быть пустым"),
}).strict();

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

export type TypeAssignments = z.infer<typeof TypeAssignmentsSchema>;
export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
export type LintChatResponse = z.infer<typeof LintChatSchema>;
export type WikiPageResponse = z.infer<typeof WikiPageSchema>;
export type EntitiesOutput = z.infer<typeof EntitiesOutputSchema>;
export type WikiPagesOutput = z.infer<typeof WikiPagesOutputSchema>;
export type LintDelete = z.infer<typeof LintDeleteSchema>;
export type LintFindingResponse = z.infer<typeof LintFindingSchema>;
export type LintBatchOutputResponse = z.infer<typeof LintBatchOutputSchema>;
export type LintChatPatchResponse = z.infer<typeof LintChatPatchSchema>;
export type LintOutput = z.infer<typeof LintOutputSchema>;
export type FormatOutput = z.infer<typeof FormatBaseSchema>;
export type FormatSegmentModelOutput = z.infer<typeof FormatSegmentOutputSchema>;

/**
 * Structured fallback contract for the query answer when deterministic link
 * resolution leaves unresolved stems. `citations` must all be known vault stems;
 * the closure-checked refinement is applied by the caller (parseWithRetry feeds
 * `knownStems` via a factory, mirroring existing WikiLink refinements).
 */
export function makeQueryAnswerSchema(knownStems: Set<string>) {
  return z.object({
    reasoning: z.string(),
    answer_markdown: z.string().min(1),
    citations: z.array(z.string()).default([]),
  }).superRefine((val, ctx) => {
    for (const c of val.citations) {
      if (!knownStems.has(c)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["citations"],
          message: `citation "${c}" is not a known wiki page stem`,
        });
      }
    }
  });
}

export type QueryAnswer = z.infer<ReturnType<typeof makeQueryAnswerSchema>>;
