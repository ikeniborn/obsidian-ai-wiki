import type OpenAI from "openai";
import { z } from "zod";
import { classifyContextError, estimatePreparedMessages, PromptBudgetExceededError } from "../prompt-budget";
import type { LlmCallOptions, RunEvent } from "../types";
import type { EntityEvidence, EvidencePolicy, EvidenceRuntime } from "./ingest-evidence";
import { sentinelJsonProfile } from "./framed-output";
import { prepareChatMessages } from "./llm-utils";
import {
  createLlmLifecycle,
  runStructuredWithRetry,
  StructuredOutputTruncatedError,
  StructuredValidationError,
} from "./structured-output";
import typePrompt from "../../prompts/init-evidence-types.md";

interface EvidenceTypeUnit {
  entityKey: string;
  facts: string[];
}

export interface EvidenceTypeAssignment {
  entityKey: string;
  entityType: string;
}

const EvidenceTypeAssignmentSchema = z.object({
  entityKey: z.string().min(1),
  entityType: z.string().min(1),
}).strict();

function assignmentSchemaFor(
  units: readonly EvidenceTypeUnit[],
  allowedTypes: ReadonlySet<string>,
): z.ZodSchema<{ assignments: EvidenceTypeAssignment[] }> {
  const expectedKeys = new Set(units.map((unit) => unit.entityKey));
  return z.object({
    assignments: z.array(EvidenceTypeAssignmentSchema),
  }).strict().superRefine((value, ctx) => {
    const returnedKeys = new Set<string>();
    for (const assignment of value.assignments) {
      if (returnedKeys.has(assignment.entityKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate evidence type assignment for ${assignment.entityKey}` });
      }
      returnedKeys.add(assignment.entityKey);
      if (!expectedKeys.has(assignment.entityKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Foreign evidence type assignment for ${assignment.entityKey}` });
      }
      if (!allowedTypes.has(assignment.entityType)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown evidence type assignment ${assignment.entityType}` });
      }
    }
    if (returnedKeys.size !== expectedKeys.size
      || [...expectedKeys].some((entityKey) => !returnedKeys.has(entityKey))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence type assignment coverage mismatch" });
    }
  });
}

function classifierOptions(policy: EvidencePolicy, runtime: EvidenceRuntime): LlmCallOptions {
  const opts: LlmCallOptions = {
    ...(runtime.opts ?? {}),
    inputBudgetTokens: policy.inputBudgetTokens,
    semanticCompression: {
      profile: policy.compressionProfile ?? policy.compression ?? "balanced",
      operation: "ingest",
    },
  };
  if (policy.outputBudgetTokens !== undefined) opts.maxTokens = policy.outputBudgetTokens;
  return opts;
}

function messagesForUnits(
  units: readonly EvidenceTypeUnit[],
  allowedTypes: ReadonlySet<string>,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: "system", content: typePrompt },
    { role: "user", content: `ALLOWED_ENTITY_TYPES ${JSON.stringify([...allowedTypes])}\nEVIDENCE_TYPE_UNITS ${JSON.stringify(units)}` },
  ];
}

function estimateUnits(
  units: readonly EvidenceTypeUnit[],
  allowedTypes: ReadonlySet<string>,
  opts: LlmCallOptions,
): number {
  return estimatePreparedMessages(prepareChatMessages(messagesForUnits(units, allowedTypes), opts));
}

function partitionTypeUnits(
  units: readonly EvidenceTypeUnit[],
  allowedTypes: ReadonlySet<string>,
  opts: LlmCallOptions,
  budget: number,
): EvidenceTypeUnit[][] {
  const batches: EvidenceTypeUnit[][] = [];
  let current: EvidenceTypeUnit[] = [];
  for (const unit of units) {
    const candidate = [...current, unit];
    if (estimateUnits(candidate, allowedTypes, opts) <= budget) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw new PromptBudgetExceededError(budget, estimateUnits([unit], allowedTypes, opts), [unit.entityKey]);
    }
    batches.push(current);
    current = [unit];
    const estimate = estimateUnits(current, allowedTypes, opts);
    if (estimate > budget) throw new PromptBudgetExceededError(budget, estimate, [unit.entityKey]);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function forwardClassifierEvent(runtime: EvidenceRuntime, event: RunEvent): void {
  runtime.onEvent?.(event);
}

async function classifyBatch(
  units: readonly EvidenceTypeUnit[],
  allowedTypes: ReadonlySet<string>,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
  opts: LlmCallOptions,
): Promise<EvidenceTypeAssignment[]> {
  const messages = messagesForUnits(units, allowedTypes);
  const estimated = estimatePreparedMessages(prepareChatMessages(messages, opts));
  if (estimated > policy.inputBudgetTokens) {
    throw new PromptBudgetExceededError(policy.inputBudgetTokens, estimated, units.map((unit) => unit.entityKey));
  }
  const result = await runStructuredWithRetry({
    llm: runtime.llm,
    model: runtime.model,
    baseMessages: messages,
    opts,
    profile: sentinelJsonProfile(
      assignmentSchemaFor(units, allowedTypes),
      "Return every supplied entityKey exactly once with one allowed entityType.",
      1,
    ),
    maxRetries: policy.mapperRetries ?? 1,
    callSite: "init.bootstrap-type-map",
    lifecycle: createLlmLifecycle("extract_source_facts"),
    signal: runtime.signal ?? new AbortController().signal,
    onEvent: (event) => forwardClassifierEvent(runtime, event),
    transport: "non-stream",
    contextErrorsRetry: true,
  });
  return result.value.assignments;
}

function isSizeFailure(error: unknown): boolean {
  if (error instanceof StructuredValidationError) return error.errorType === "output_limit";
  return error instanceof StructuredOutputTruncatedError
    || classifyContextError(error) !== null;
}

export function applyEvidenceTypeAssignments(
  evidence: EntityEvidence[],
  assignments: EvidenceTypeAssignment[],
  allowedTypes: ReadonlySet<string>,
): EntityEvidence[] {
  const byKey = new Map(assignments.map((item) => [item.entityKey, item.entityType]));
  if (byKey.size !== assignments.length || byKey.size !== evidence.length) {
    throw new Error("Evidence type assignment coverage mismatch");
  }
  return evidence.map((item) => {
    const entityType = byKey.get(item.entityKey);
    if (!entityType || !allowedTypes.has(entityType)) {
      throw new Error(`Invalid evidence type assignment for ${item.entityKey}`);
    }
    return { ...item, entityType };
  });
}

export async function enrichEvidenceTypes(
  evidence: EntityEvidence[],
  allowedTypes: ReadonlySet<string>,
  policy: EvidencePolicy,
  runtime: EvidenceRuntime,
): Promise<EntityEvidence[]> {
  if (evidence.length === 0) return [];
  if (allowedTypes.size === 0) throw new Error("Evidence type enrichment requires at least one allowed type");

  const units = evidence.map(({ entityKey, facts }) => ({ entityKey, facts: [...facts] }));
  const opts = classifierOptions(policy, runtime);
  const queue = partitionTypeUnits(units, allowedTypes, opts, policy.inputBudgetTokens);
  const assignments: EvidenceTypeAssignment[] = [];

  while (queue.length > 0) {
    const batch = queue.shift();
    if (!batch) break;
    try {
      assignments.push(...await classifyBatch(batch, allowedTypes, policy, runtime, opts));
    } catch (error) {
      if (!isSizeFailure(error) || batch.length < 2) throw error;
      const midpoint = Math.ceil(batch.length / 2);
      queue.unshift(batch.slice(0, midpoint), batch.slice(midpoint));
    }
  }

  return applyEvidenceTypeAssignments(evidence, assignments, allowedTypes);
}
