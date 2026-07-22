import type { RunEvent } from "./types";

const PREVIEW_MAX = 200;

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null;
}

export class StreamJsonParseError extends Error {
  constructor() {
    super("Malformed Claude stream JSON");
    this.name = "StreamJsonParseError";
  }
}

export function parseStreamLine(raw: string): RunEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // iclaude.sh wrapper и сторонние логгеры могут писать в stdout не-JSON строки
  // (баннеры, ANSI-цвета). Считаем строкой stream-json только те, что начинаются
  // с '{' — остальное молча игнорируем, чтобы не засорять панель.
  if (!trimmed.startsWith("{")) return [];

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new StreamJsonParseError();
  }

  if (!isRecord(obj)) return [];

  switch (obj.type) {
    case "system": {
      const subtype = typeof obj.subtype === "string" ? obj.subtype : "system";
      const model = typeof obj.model === "string" ? obj.model : "";
      const sessionId = typeof obj.session_id === "string" ? obj.session_id : undefined;
      const msg = `${subtype}${model ? ` (${model})` : ""}`;
      return [{ kind: "system", message: msg, sessionId }];
    }
    case "assistant":
      return mapAssistant(obj);
    case "user": {
      const event = mapUserToolResult(obj);
      return event ? [event] : [];
    }
    case "result":
      return [mapResult(obj)];
    default:
      return [];
  }
}

function mapAssistant(obj: Record<string, unknown>): RunEvent[] {
  const msg = obj.message;
  if (!isRecord(msg)) return [];
  const content = msg.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    isRecord(block) ? mapAssistantBlock(block) : []);
}

function mapAssistantBlock(block: Record<string, unknown>): RunEvent[] {
  if (block?.type === "tool_use") {
    if (block.name === "AskUserQuestion") {
      const input = isRecord(block.input) ? block.input : {};
      return [{
        kind: "ask_user",
        question: typeof input.prompt === "string" ? input.prompt : "",
        options: Array.isArray(input.options)
          ? (input.options as unknown[]).map((o) => typeof o === "string" ? o : String(o))
          : [],
        toolUseId: typeof block.id === "string" ? block.id : "",
      }];
    }
    return [{
      kind: "tool_use",
      name: typeof block.name === "string" ? block.name : "?",
      input: block.input,
    }];
  }
  if (block?.type === "text") {
    return [{
      kind: "assistant_text",
      delta: typeof block.text === "string" ? block.text : "",
    }];
  }
  if (block?.type === "thinking") {
    return [{
      kind: "assistant_text",
      delta: typeof block.thinking === "string" ? block.thinking : "",
      isReasoning: true,
    }];
  }
  return [];
}

function mapUserToolResult(obj: Record<string, unknown>): RunEvent | null {
  const msg = obj.message;
  if (!isRecord(msg)) return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  const block: unknown = (content as unknown[])[0];
  if (!isRecord(block) || block.type !== "tool_result") return null;
  const isErr = Boolean(block.is_error);
  const preview = typeof block.content === "string" ? truncate(block.content, PREVIEW_MAX) : undefined;
  return { kind: "tool_result", ok: !isErr, preview };
}

function mapResult(obj: Record<string, unknown>): RunEvent {
  if (obj.is_error || obj.subtype === "error") {
    const errMsg = typeof obj.result === "string" ? obj.result
      : typeof obj.error === "string" ? obj.error
      : "claude error";
    return { kind: "error", message: errMsg };
  }
  const usage = isRecord(obj.usage) ? obj.usage : null;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  return {
    kind: "result",
    durationMs: Number(obj.duration_ms ?? 0),
    text: typeof obj.result === "string" ? obj.result : "",
    outputTokens,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}
