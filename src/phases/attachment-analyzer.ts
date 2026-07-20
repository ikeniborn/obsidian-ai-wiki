import type { VaultTools } from "../vault-tools";
import type {
  CompressionProfile,
  LlmClient,
  OutputLanguage,
  RunEvent,
} from "../types";
import {
  buildChatParams,
  completionReasoning,
  langInstruction,
  parseStructured,
  prepareChatMessages,
} from "./llm-utils";
import { resolveLang } from "../i18n";
import type OpenAI from "openai";
import { render } from "./template";
import visionImage from "../../prompts/vision-image.md";
import visionPdf from "../../prompts/vision-pdf.md";
import visionExcalidraw from "../../prompts/vision-excalidraw.md";
import type { VisionTempStore } from "./vision-temp-store";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  classifyContextError,
  createPromptBudgetEvent,
  estimatePreparedMessages,
  shrinkInputBudget,
  type ContextErrorDetails,
} from "../prompt-budget";
import { createLlmLifecycle } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import { VisionRecognitionBatchSchema } from "./zod-schemas";
import {
  createNativeRequestLifecycle,
  createNativeRequestRetryContext,
  isNativeLlmClient,
} from "../native-llm-executor";
import {
  batchPdfPages,
  mergeRecognitionRecords,
  validateRecognitionCoverage,
  type VisionMediaPage,
  type VisionRecognitionRecord,
} from "./vision-recognition";

export function extractObsidianEmbedPaths(md: string): string[] {
  const paths: string[] = [];
  for (const m of md.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    paths.push(m[1].trim());
  }
  return paths;
}

export function insertDescriptions(md: string, descriptions: Map<string, string>): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const embedMatch = lines[i].match(/^!\[\[([^\]]+)\]\]/);
    if (!embedMatch) continue;
    const path = embedMatch[1].trim();
    if (!descriptions.has(path)) continue;
    // Check if next non-empty line already has [Vision] marker (matches both the
    // single-line `> *[Vision] ...*` and the multi-line `> *[Vision]*` shapes).
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "") { nextNonEmpty = lines[j]; break; }
    }
    if (nextNonEmpty.startsWith("> *[Vision]")) continue;
    const desc = descriptions.get(path)!;
    if (desc.includes("\n")) {
      // Multi-line (verbatim diagram description + mermaid/table, or fenced code):
      // a marker line, a blank line, then the description verbatim at top level so
      // any fence/table/list renders.
      out.push("> *[Vision]*");
      out.push("");
      out.push(desc);
    } else {
      out.push(`> *[Vision] ${desc}*`);
    }
  }
  return out.join("\n");
}

// Internal helpers — exported for testing
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Strip a leading `data:image/<type>;base64,` prefix, returning raw base64. */
export function stripImageDataUriPrefix(s: string): string {
  return s.replace(/^data:image\/[a-zA-Z.+-]+;base64,/, "");
}

export function getMimeType(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return null;
  }
}

/** True when the embed is a raster image vision can read without rendering (mobile-safe). */
export function isVisionSupportedOnMobile(path: string): boolean {
  return getMimeType(path) !== null; // png/jpg/jpeg/webp; PDF/Excalidraw need rendering
}

export interface VisionAnalysisOptions {
  inputBudgetTokens?: number;
  maxTokens?: number;
  compressionProfile?: CompressionProfile;
  onEvent?: (event: RunEvent) => void;
  nativeRequestRetries?: number;
  nativeRequestIdleTimeoutMs?: number;
}

interface ResolvedVisionAnalysisOptions {
  inputBudgetTokens: number;
  maxTokens?: number;
  compressionProfile: CompressionProfile;
  onEvent?: (event: RunEvent) => void;
  nativeRequestRetries?: number;
  nativeRequestIdleTimeoutMs?: number;
}

function resolveVisionOptions(
  options: VisionAnalysisOptions | undefined,
): ResolvedVisionAnalysisOptions {
  return {
    inputBudgetTokens: options?.inputBudgetTokens ?? 16_384,
    maxTokens: options?.maxTokens,
    compressionProfile: options?.compressionProfile ?? "balanced",
    onEvent: options?.onEvent,
    nativeRequestRetries: options?.nativeRequestRetries,
    nativeRequestIdleTimeoutMs: options?.nativeRequestIdleTimeoutMs,
  };
}

function visionContextRecoveryError(
  options: ResolvedVisionAnalysisOptions,
  effectiveInputBudget: number,
  details: ContextErrorDetails,
): Error {
  const facts: string[] = [];
  if (details.promptTokens !== undefined) {
    facts.push(`promptTokens=${details.promptTokens}`);
  }
  if (details.maxContextTokens !== undefined) {
    facts.push(`maxContextTokens=${details.maxContextTokens}`);
  }
  const reason = facts.length > 0
    ? `provider context limit (${facts.join(", ")})`
    : "provider context limit";
  return new Error(
    "vision.analysis context recovery exhausted "
    + `(configuredInputBudget=${options.inputBudgetTokens}, `
    + `finalEffectiveInputBudget=${effectiveInputBudget}): ${reason}`,
  );
}

function visionMessages(
  systemPrompt: string,
  pages: readonly VisionMediaPage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const pageIds = pages.map((page) => page.pageId);
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Return one recognition record for each exact pageId: ${pageIds.join(", ")}`,
    },
    ...pages.map((page) => ({
      type: "image_url" as const,
      image_url: { url: page.dataUrl },
    })),
  ];
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ];
}

function visionCallOptions(
  options: ResolvedVisionAnalysisOptions,
  language: OutputLanguage,
  reasoningLanguage: OutputLanguage,
  effectiveInputBudget: number = options.inputBudgetTokens,
) {
  return {
    inputBudgetTokens: effectiveInputBudget,
    maxTokens: options.maxTokens,
    outputLanguage: language,
    reasoningLanguage,
    nativeRequestRetries: options.nativeRequestRetries,
    nativeRequestIdleTimeoutMs: options.nativeRequestIdleTimeoutMs,
    semanticCompression: {
      profile: options.compressionProfile,
      operation: "vision" as const,
    },
    jsonMode: "json_schema" as const,
    jsonSchema: {
      name: "vision_analysis",
      schema: zodToJsonSchema(VisionRecognitionBatchSchema, { $refStrategy: "none" }),
    },
  };
}

async function callVisionLlm(
  llm: LlmClient,
  model: string,
  systemPrompt: string,
  pages: readonly VisionMediaPage[],
  signal: AbortSignal,
  language: OutputLanguage,
  reasoningLanguage: OutputLanguage,
  options: ResolvedVisionAnalysisOptions,
  effectiveInputBudget: number = options.inputBudgetTokens,
  attempt = 0,
): Promise<VisionRecognitionRecord[]> {
  if (signal.aborted) {
    signal.throwIfAborted();
  }
  const callOptions = visionCallOptions(
    options,
    language,
    reasoningLanguage,
    effectiveInputBudget,
  );
  const params = buildChatParams(model, visionMessages(systemPrompt, pages), callOptions);

  let lifecycle = createLlmLifecycle("analyze_attachments");
  const onEvent = options.onEvent ?? (() => {});
  if (!isNativeLlmClient(llm)) {
    options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "preparing", Date.now(), {
      callSite: "vision.analysis",
      transport: "non-stream",
      attempt,
    }));
  }
  const requestLifecycle = createNativeRequestLifecycle({
    initial: lifecycle,
    callSite: "vision.analysis",
    onEvent,
    attemptOffset: attempt,
  });
  const estimatedInputTokens = estimatePreparedMessages(
    params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
  );
  let providerDispatched = false;
  let response: OpenAI.Chat.ChatCompletion;
  try {
    signal.throwIfAborted();
    if (!isNativeLlmClient(llm)) {
      options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "sent"));
      options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "waiting"));
    }
    providerDispatched = true;
    const request = llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      {
        signal,
        retry: createNativeRequestRetryContext({
          callSite: "vision.analysis",
          opts: callOptions,
          signal,
          onEvent,
          lifecycle: requestLifecycle,
        }),
      },
    );
    response = await request;
    if (isNativeLlmClient(llm)) lifecycle = requestLifecycle.current();
  } catch (error) {
    if (!isNativeLlmClient(llm)) {
      options.onEvent?.(lifecycleEvent(
        lifecycle.id,
        lifecycle.action,
        signal.aborted || (error as Error).name === "AbortError"
          ? "cancelled"
          : classifyContextError(error) !== null
            ? "retrying"
            : "failed",
      ));
    }
    if (providerDispatched) {
      options.onEvent?.(createPromptBudgetEvent({
        requestId: lifecycle.id,
        callSite: "vision.analysis",
        configuredInputBudget: options.inputBudgetTokens,
        effectiveInputBudget,
        estimatedInputTokens,
        outputBudget: options.maxTokens,
        compressionProfile: options.compressionProfile,
        contextUnits: pages.length,
        retryReason: classifyContextError(error) === null
          ? undefined
          : "provider_context_error",
      }));
    }
    throw error;
  }

  options.onEvent?.(createPromptBudgetEvent({
    requestId: lifecycle.id,
    callSite: "vision.analysis",
    configuredInputBudget: options.inputBudgetTokens,
    effectiveInputBudget,
    estimatedInputTokens,
    actualInputTokens: response.usage?.prompt_tokens,
    outputBudget: options.maxTokens,
    compressionProfile: options.compressionProfile,
    contextUnits: pages.length,
  }));
  if (signal.aborted) {
    options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "cancelled"));
    signal.throwIfAborted();
  }
  const message = response.choices[0]?.message;
  const reasoning = completionReasoning(message);
  const content = message?.content ?? "";
  if ((reasoning.trim() || content.trim()) && !isNativeLlmClient(llm)) {
    options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "producing"));
  }
  if (reasoning) {
    options.onEvent?.({ kind: "assistant_text", delta: reasoning, isReasoning: true });
  }
  options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "validating"));
  let records: VisionRecognitionRecord[];
  try {
    const parsed = VisionRecognitionBatchSchema.parse(parseStructured(content));
    records = validateRecognitionCoverage(parsed.records, pages.map((page) => page.pageId));
  } catch (error) {
    options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "failed"));
    throw error;
  }
  options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "applying"));
  options.onEvent?.(lifecycleEvent(lifecycle.id, lifecycle.action, "completed"));
  return records;
}

function imageSystem(language: OutputLanguage): string {
  return render(visionImage, { lang: langInstruction(resolveLang(language)) });
}

function pdfSystem(language: OutputLanguage): string {
  return render(visionPdf, { lang: langInstruction(resolveLang(language)) });
}

function excalidrawSystem(language: OutputLanguage): string {
  return render(visionExcalidraw, { lang: langInstruction(resolveLang(language)) });
}

export async function analyzeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  options?: VisionAnalysisOptions,
): Promise<string> {
  const b64 = arrayBufferToBase64(buffer);
  const resolved = resolveVisionOptions(options);
  const records = await callVisionLlm(
    llm,
    model,
    imageSystem(language),
    [{ pageId: "image", dataUrl: `data:${mimeType};base64,${b64}` }],
    signal,
    language,
    reasoningLanguage,
    resolved,
  );
  return mergeRecognitionRecords(records, resolved.compressionProfile);
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(ctx: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}
interface PdfjsDoc {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}
interface PdfjsLib {
  getDocument(opts: { data: ArrayBuffer }): { promise: Promise<PdfjsDoc> };
}

export interface PdfDocumentRenderer {
  numPages: number;
  renderPage(
    pageNumber: number,
    options: { scale: number; quality: number },
  ): Promise<VisionMediaPage>;
}

export interface PdfAnalysisDependencies {
  loadPdf?: (buffer: ArrayBuffer) => Promise<PdfDocumentRenderer>;
}

async function loadBrowserPdf(buffer: ArrayBuffer): Promise<PdfDocumentRenderer> {
  const pdfjs = (window as unknown as { pdfjsLib?: PdfjsLib }).pdfjsLib;
  if (!pdfjs) throw new Error("pdfjsLib unavailable");
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  return {
    numPages: doc.numPages,
    renderPage: async (pageNumber, options) => {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: options.scale });
      const canvas = new OffscreenCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: options.quality,
      });
      return {
        pageId: `p${pageNumber}`,
        dataUrl: `data:image/jpeg;base64,${arrayBufferToBase64(await blob.arrayBuffer())}`,
      };
    },
  };
}

export async function analyzePdf(
  buffer: ArrayBuffer,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  options?: VisionAnalysisOptions,
  dependencies: PdfAnalysisDependencies = {},
): Promise<string> {
  const resolved = resolveVisionOptions(options);
  signal.throwIfAborted();
  const renderer = await (dependencies.loadPdf ?? loadBrowserPdf)(buffer);
  signal.throwIfAborted();
  const pages: VisionMediaPage[] = [];
  const pageNumbers = new Map<string, number>();
  for (let pageNumber = 1; pageNumber <= renderer.numPages; pageNumber++) {
    signal.throwIfAborted();
    const page = await renderer.renderPage(pageNumber, { scale: 1.5, quality: 0.85 });
    signal.throwIfAborted();
    pages.push(page);
    pageNumbers.set(page.pageId, pageNumber);
  }

  const systemPrompt = pdfSystem(language);
  const fixedMessages = prepareChatMessages(
    visionMessages(systemPrompt, []).map((message) => {
      if (message.role !== "user") return message;
      return {
        ...message,
        content: [{
          type: "text" as const,
          text: `Return one recognition record for each exact pageId: ${pages.map((page) => page.pageId).join(", ")}`,
        }],
      };
    }),
    visionCallOptions(resolved, language, reasoningLanguage),
  );
  const fixedEstimatedTokens = estimatePreparedMessages(fixedMessages);
  const resizedPages = new Set<string>();
  let visionAttempt = 0;

  const recognize = (
    batch: readonly VisionMediaPage[],
    effectiveInputBudget: number,
  ) => callVisionLlm(
    llm,
    model,
    systemPrompt,
    batch,
    signal,
    language,
    reasoningLanguage,
    resolved,
    effectiveInputBudget,
    visionAttempt++,
  );
  const resize = async (
    page: VisionMediaPage,
  ): Promise<VisionMediaPage> => {
    if (resizedPages.has(page.pageId)) {
      throw new Error(`Vision page ${page.pageId} cannot be resized twice`);
    }
    resizedPages.add(page.pageId);
    const pageNumber = pageNumbers.get(page.pageId);
    if (pageNumber === undefined) throw new Error(`Unknown PDF page ${page.pageId}`);
    signal.throwIfAborted();
    const resized = await renderer.renderPage(pageNumber, { scale: 1, quality: 0.65 });
    signal.throwIfAborted();
    if (resized.pageId !== page.pageId) {
      throw new Error(`Resized PDF page identity changed from ${page.pageId} to ${resized.pageId}`);
    }
    return resized;
  };

  const records: VisionRecognitionRecord[] = [];
  let pending = [...pages];
  let effectiveInputBudget = resolved.inputBudgetTokens;
  let repacks = 0;
  let failedSignature: string | undefined;
  let originalContextDetails: ContextErrorDetails | undefined;
  let lastContextDetails: ContextErrorDetails = {};
  const signature = (batch: readonly VisionMediaPage[]) =>
    batch.map((page) => `${page.pageId}:${page.dataUrl}`).join("\n");

  while (pending.length > 0) {
    signal.throwIfAborted();
    let batches: VisionMediaPage[][];
    try {
      batches = batchPdfPages(pending, {
        inputBudgetTokens: effectiveInputBudget,
        fixedEstimatedTokens,
        mediaReservationTokens: 4096,
      });
    } catch (error) {
      if (originalContextDetails !== undefined) {
        throw visionContextRecoveryError(
          resolved,
          effectiveInputBudget,
          originalContextDetails,
        );
      }
      throw error;
    }

    if (failedSignature !== undefined && signature(batches[0]) === failedSignature) {
      if (repacks >= 2) {
        throw visionContextRecoveryError(
          resolved,
          effectiveInputBudget,
          originalContextDetails ?? lastContextDetails,
        );
      }
      effectiveInputBudget = shrinkInputBudget(effectiveInputBudget, lastContextDetails);
      repacks++;
      continue;
    }

    let repack = false;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      signal.throwIfAborted();
      try {
        records.push(...await recognize(batch, effectiveInputBudget));
        signal.throwIfAborted();
      } catch (error) {
        const details = classifyContextError(error);
        if (details === null) throw error;
        originalContextDetails ??= details;
        if (repacks >= 2) {
          throw visionContextRecoveryError(
            resolved,
            effectiveInputBudget,
            originalContextDetails,
          );
        }

        const remaining = batches.slice(batchIndex).flat();
        failedSignature = signature(batch);
        lastContextDetails = details;
        if (batch.length === 1) {
          if (resizedPages.has(batch[0].pageId)) {
            throw visionContextRecoveryError(
              resolved,
              effectiveInputBudget,
              originalContextDetails,
            );
          }
          remaining[0] = await resize(batch[0]);
        }
        pending = remaining;
        effectiveInputBudget = shrinkInputBudget(effectiveInputBudget, details);
        repacks++;
        repack = true;
        break;
      }
    }
    if (!repack) pending = [];
  }

  signal.throwIfAborted();
  const complete = validateRecognitionCoverage(
    records,
    pages.map((page) => page.pageId),
  );
  return mergeRecognitionRecords(complete, resolved.compressionProfile);
}

export async function analyzeExcalidraw(
  b64: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  options?: VisionAnalysisOptions,
): Promise<string> {
  const resolved = resolveVisionOptions(options);
  const records = await callVisionLlm(
    llm,
    model,
    excalidrawSystem(language),
    [{ pageId: "excalidraw", dataUrl: `data:image/png;base64,${b64}` }],
    signal,
    language,
    reasoningLanguage,
    resolved,
  );
  return mergeRecognitionRecords(records, resolved.compressionProfile);
}

/** Route a single embed path to the right analyzer. Returns description or null for unknown ext. */
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  visionTempStore?: VisionTempStore,
  imageOnly: boolean = false,
  usedTemplates?: Set<string>,
  visionOptions?: VisionAnalysisOptions,
): Promise<string | null> {
  const resolved = vaultTools.resolveLink(path, sourcePath);
  // Skip embeds Obsidian can't resolve to an indexed vault file — a traversal
  // payload (`![[../../secret.png]]`) never resolves, so this blocks the read.
  if (resolved === null) return null;
  if (imageOnly && !isVisionSupportedOnMobile(resolved)) return null; // PDF/Excalidraw skipped on mobile
  const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
  const isExcalidraw = ext === "excalidraw" || resolved.endsWith(".excalidraw.md");

  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;            // no host plugin / render failed → skip
    await visionTempStore?.putPng(path, b64);
    usedTemplates?.add(visionExcalidraw);
    return analyzeExcalidraw(
      b64,
      llm,
      model,
      signal,
      language,
      reasoningLanguage,
      visionOptions,
    );
  }
  if (ext === "pdf") {
    const buf = await vaultTools.readBinary(resolved);
    usedTemplates?.add(visionPdf);
    return analyzePdf(
      buf,
      llm,
      model,
      signal,
      language,
      reasoningLanguage,
      visionOptions,
    );
  }
  const mimeType = getMimeType(resolved);
  if (mimeType) {
    const buf = await vaultTools.readBinary(resolved);
    usedTemplates?.add(visionImage);
    return analyzeImage(
      buf,
      mimeType,
      llm,
      model,
      signal,
      language,
      reasoningLanguage,
      visionOptions,
    );
  }
  return null;
}

export async function analyzeAttachments(
  embedPaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: OutputLanguage = "auto",
  reasoningLanguage: OutputLanguage = "auto",
  visionOptions?: VisionAnalysisOptions,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of [...new Set(embedPaths)]) {
    if (signal.aborted) break;
    const description = await analyzeSingleAttachment(
      path,
      vaultTools,
      llm,
      model,
      signal,
      sourcePath,
      language,
      reasoningLanguage,
      undefined,
      false,
      undefined,
      visionOptions,
    );
    if (description !== null) result.set(path, description);
  }
  return result;
}
