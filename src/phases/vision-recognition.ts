import { PromptBudgetExceededError } from "../prompt-budget";
import { VisionRecognitionRecordSchema } from "./zod-schemas";

export interface VisionRecognitionRecord {
  pageId: string;
  ocr: string[];
  objects: string[];
  relationships: string[];
  layout: string[];
  uncertainty: string[];
}

export interface VisionMediaPage {
  pageId: string;
  dataUrl: string;
}

export interface VisionBatchBudget {
  inputBudgetTokens: number;
  fixedEstimatedTokens: number;
  mediaReservationTokens: number;
}

export function batchPdfPages<T extends VisionMediaPage>(
  pages: readonly T[],
  budget: VisionBatchBudget,
): T[][] {
  if (pages.length === 0) return [];
  const available = budget.inputBudgetTokens - budget.fixedEstimatedTokens;
  const pagesPerBatch = Math.floor(available / budget.mediaReservationTokens);
  if (pagesPerBatch < 1) {
    throw new PromptBudgetExceededError(
      budget.inputBudgetTokens,
      budget.fixedEstimatedTokens + budget.mediaReservationTokens,
      [pages[0].pageId],
    );
  }

  const batches: T[][] = [];
  for (let index = 0; index < pages.length; index += pagesPerBatch) {
    batches.push(pages.slice(index, index + pagesPerBatch));
  }
  return batches;
}

export function validateRecognitionCoverage(
  records: unknown,
  expectedPageIds: readonly string[],
): VisionRecognitionRecord[] {
  const parsed = VisionRecognitionRecordSchema.array().parse(records);
  const expected = new Set(expectedPageIds);
  const seen = new Set<string>();

  for (const record of parsed) {
    if (seen.has(record.pageId)) {
      throw new Error(`Vision recognition contains duplicate page ${record.pageId}`);
    }
    if (!expected.has(record.pageId)) {
      throw new Error(`Vision recognition contains unexpected page ${record.pageId}`);
    }
    seen.add(record.pageId);
  }

  const missing = expectedPageIds.filter((pageId) => !seen.has(pageId));
  if (missing.length > 0) {
    throw new Error(`Vision recognition missing page(s): ${missing.join(", ")}`);
  }
  return parsed;
}

const fieldLabels: Record<keyof Omit<VisionRecognitionRecord, "pageId">, string> = {
  ocr: "OCR",
  objects: "Objects",
  relationships: "Relationships",
  layout: "Layout",
  uncertainty: "Uncertainty",
};

export function mergeRecognitionRecords(
  records: readonly VisionRecognitionRecord[],
): string {
  return records.map((record) => {
    const lines = [`## Page ${record.pageId}`];
    for (const field of Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>) {
      const values = record[field].filter((value) => value.length > 0);
      if (values.length === 0) continue;
      lines.push(`### ${fieldLabels[field]}`, ...values.map((value) => `- ${value}`));
    }
    return lines.join("\n");
  }).join("\n");
}
