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
    // Check if next non-empty line already has [Vision] marker (matches both the
    // single-line `> *[Vision] ...*` and the multi-line `> *[Vision]*` shapes).
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "") { nextNonEmpty = lines[j]; break; }
    }
    if (nextNonEmpty.startsWith("> *[Vision]")) continue;
    const desc = descriptions.get(path)!;
    if (desc.includes("\n")) {
      // Multi-line (prose + mermaid/table): a marker line, a blank line, then the
      // description verbatim at top level so the fence/table renders.
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
  return resp.choices[0]?.message?.content ?? "";
}

export type VisionLanguage = "auto" | "ru" | "en" | "es";

function langInstruction(language: VisionLanguage): string {
  switch (language) {
    case "ru": return "Always reply in Russian.";
    case "en": return "Always reply in English.";
    case "es": return "Always reply in Spanish.";
    default:   return "Reply in Russian if the note is in Russian, otherwise in English.";
  }
}

const STRUCTURE_RULES = `Return STRUCTURED markdown matching the content type. Choose ONE form:
- Table data (rows × columns, comparison, matrix) → markdown table with header row and separator.
- Ordered steps / sequence / pipeline → numbered list.
- Unordered items / enumeration / set of features → bullet list with "- ".
- Hierarchy / tree / nested structure → nested bullet list with indentation.
- Diagram / flow / architecture (boxes + arrows) → FIRST a short prose description (what it depicts, the key nodes and how they connect), THEN a mermaid code block (\`\`\`mermaid ... \`\`\`) recreating it.
- Math / formula / equation → LaTeX inside $...$ or $$...$$.
- Code / config / terminal → fenced code block with language tag.
- Single concept / photo / illustration → 1–3 plain sentences.
Do NOT add boilerplate intros ("Here is...", "This image shows..."). Output ONLY the requested content (diagrams: the description + mermaid; other types: the single structured form).
Do NOT add headings (# or ##) — caller controls section structure.
Do NOT add the marker "[Vision]" or any prefix — caller adds it if needed.
Preserve any text visible in the source verbatim where it is data; transcribe — do not paraphrase.`;

function imageSystem(language: VisionLanguage): string {
  return `You are a precise image analyst. Extract the content of the image as STRUCTURED markdown.\n${STRUCTURE_RULES}\n${langInstruction(language)}`;
}

function pdfSystem(language: VisionLanguage): string {
  return `You are a precise document analyst. Extract the content of this multi-page document as STRUCTURED markdown.\nCover key sections, data tables, lists, and conclusions. Preserve table structure as markdown tables.\n${STRUCTURE_RULES}\n${langInstruction(language)}`;
}

export async function analyzeImage(
  buffer: ArrayBuffer,
  mimeType: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: VisionLanguage = "auto",
): Promise<string> {
  const b64 = arrayBufferToBase64(buffer);
  return callVisionLlm(llm, model, imageSystem(language), [
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
  language: VisionLanguage = "auto",
): Promise<string> {
  const pdfjs = (window as unknown as { pdfjsLib?: PdfjsLib }).pdfjsLib;
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

  return callVisionLlm(llm, model, pdfSystem(language), parts, signal);
}

export async function analyzeExcalidraw(
  b64: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  language: VisionLanguage = "auto",
): Promise<string> {
  return callVisionLlm(llm, model, imageSystem(language), [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
  ], signal);
}

/** Route a single embed path to the right analyzer. Returns description or null for unknown ext. */
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: VisionLanguage = "auto",
): Promise<string | null> {
  const resolved = vaultTools.resolveLink(path, sourcePath);
  // Skip embeds Obsidian can't resolve to an indexed vault file — a traversal
  // payload (`![[../../secret.png]]`) never resolves, so this blocks the read.
  if (resolved === null) return null;
  const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
  const isExcalidraw = ext === "excalidraw" || resolved.endsWith(".excalidraw.md");

  if (isExcalidraw) {
    const b64 = await vaultTools.renderExcalidrawPng(resolved);
    if (!b64) return null;            // no host plugin / render failed → skip
    return analyzeExcalidraw(b64, llm, model, signal, language);
  }
  if (ext === "pdf") {
    const buf = await vaultTools.readBinary(resolved);
    return analyzePdf(buf, llm, model, signal, language);
  }
  const mimeType = getMimeType(resolved);
  if (mimeType) {
    const buf = await vaultTools.readBinary(resolved);
    return analyzeImage(buf, mimeType, llm, model, signal, language);
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
  language: VisionLanguage = "auto",
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of [...new Set(embedPaths)]) {
    if (signal.aborted) break;
    try {
      const description = await analyzeSingleAttachment(path, vaultTools, llm, model, signal, sourcePath, language);
      if (description !== null) result.set(path, description);
    } catch {
      // Per-attachment failure — skip, don't block format
    }
  }
  return result;
}
