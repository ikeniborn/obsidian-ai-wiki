import type { VaultTools } from "../vault-tools";
import type { LlmClient } from "../types";
import type OpenAI from "openai";

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
    // Check if next non-empty line already has [Vision] marker
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "") { nextNonEmpty = lines[j]; break; }
    }
    if (nextNonEmpty.startsWith("> *[Vision]")) continue;
    out.push(`> *[Vision] ${descriptions.get(path)!}*`);
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

export function getMimeType(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return null;
  }
}

async function callVisionLlm(
  llm: LlmClient,
  model: string,
  systemPrompt: string,
  contentParts: OpenAI.Chat.ChatCompletionContentPart[],
  signal: AbortSignal,
): Promise<string> {
  const resp = await llm.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts },
    ],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
  return (resp as OpenAI.Chat.ChatCompletion).choices[0]?.message?.content ?? "";
}

const IMAGE_SYSTEM = "You are a precise image analyst. Describe the visual content in 1-3 sentences.\nFocus on: structure, key elements, relationships, any text visible in the image.\nReply in Russian if the note is in Russian, otherwise in English.";

const PDF_SYSTEM = "You are a precise document analyst. Summarize this multi-page document.\nCover: main topic, key sections, structure, important data or conclusions.\nBe comprehensive but concise — up to 10 sentences.\nReply in Russian if the note is in Russian, otherwise in English.";

export async function analyzeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const b64 = arrayBufferToBase64(buffer);
  return callVisionLlm(llm, model, IMAGE_SYSTEM, [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
  ], signal);
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

export async function analyzePdf(
  buffer: ArrayBuffer,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const pdfjs = (globalThis as unknown as { pdfjsLib?: PdfjsLib }).pdfjsLib;
  if (!pdfjs) throw new Error("pdfjsLib unavailable");

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const pageBuf = await blob.arrayBuffer();
    const b64 = arrayBufferToBase64(pageBuf);
    parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }

  return callVisionLlm(llm, model, PDF_SYSTEM, parts, signal);
}

export async function analyzeExcalidraw(
  text: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const { exportToBlob } = await import("@excalidraw/utils");
  const { elements, appState, files } = JSON.parse(text) as {
    elements: unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };
  const blob = await exportToBlob({
    elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
    appState,
    files: files as Parameters<typeof exportToBlob>[0]["files"],
    mimeType: "image/png",
    exportPadding: 10,
  });
  const buf = await blob.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  return callVisionLlm(llm, model, IMAGE_SYSTEM, [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
  ], signal);
}

export async function analyzeAttachments(
  embedPaths: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (const path of [...new Set(embedPaths)]) {
    if (signal.aborted) break;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    try {
      if (ext === "excalidraw") {
        const text = await vaultTools.read(path);
        result.set(path, await analyzeExcalidraw(text, llm, model, signal));
        continue;
      }

      if (ext === "pdf") {
        const buf = await vaultTools.readBinary(path);
        result.set(path, await analyzePdf(buf, llm, model, signal));
        continue;
      }

      const mimeType = getMimeType(path);
      if (mimeType) {
        const buf = await vaultTools.readBinary(path);
        result.set(path, await analyzeImage(buf, mimeType, llm, model, signal));
        continue;
      }

      // Unknown extension — skip; caller (runFormat) emits warning event
    } catch {
      // Per-attachment failure — skip, don't block format
    }
  }

  return result;
}
