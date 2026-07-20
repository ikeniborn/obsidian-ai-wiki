const PROBE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQAAAAA3iMLMAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oHFA0eFj4dl0EAAAAOSURBVAjXY/j/n4EUBAD9Th/hc4umrAAAAABJRU5ErkJggg==";

export type VisionProbeFailureCode = "timeout" | "http" | "malformed" | "empty";

export type VisionProbeResult =
  | { ok: true; content: string }
  | { ok: false; code: VisionProbeFailureCode; message: string };

export interface VisionProbeRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface VisionProbeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  request: (request: VisionProbeRequest) => Promise<{ status: number; text: string }>;
  timeoutMs: number;
}

export interface RequestUrlCompatibleOptions {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  throw: false;
}

export function createRequestUrlVisionTransport(
  requestUrl: (
    options: RequestUrlCompatibleOptions,
  ) => Promise<{ status: number; text: string }>,
): VisionProbeOptions["request"] {
  return async (request) => {
    if (request.signal.aborted) throw new DOMException("Request aborted", "AbortError");
    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      throw: false,
    });
    if (request.signal.aborted) throw new DOMException("Request aborted", "AbortError");
    return { status: response.status, text: response.text };
  };
}

export interface VisionCheckMessages {
  missing: string;
  success: string;
  details: Record<VisionProbeFailureCode, string>;
  failure: (message: string) => string;
}

export async function runNativeVisionModelCheck(
  options: VisionProbeOptions & {
    messages: VisionCheckMessages;
    notify: (message: string) => void;
  },
): Promise<void> {
  if (!options.baseUrl || !options.model) {
    options.notify(options.messages.missing);
    return;
  }
  const result = await probeNativeVisionModel(options);
  options.notify(result.ok
    ? options.messages.success
    : options.messages.failure(options.messages.details[result.code]));
}

export async function probeNativeVisionModel(
  options: VisionProbeOptions,
): Promise<VisionProbeResult> {
  const timeoutError = new Error("Vision probe timeout");
  const controller = new AbortController();
  let timedOut = false;
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => {
        timedOut = true;
        controller.abort();
        reject(timeoutError);
      },
      Math.max(1, options.timeoutMs),
    );
  });

  try {
    const response = await Promise.race([
      options.request({
        url: `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: options.model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Describe the image color in one word." },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${PROBE_PNG}` },
              },
            ],
          }],
          stream: false,
          max_tokens: 16,
        }),
      }),
      timeout,
    ]);

    if (response.status >= 400) {
      return {
        ok: false,
        code: "http",
        message: `Vision probe failed with HTTP ${response.status}.`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      return {
        ok: false,
        code: "malformed",
        message: "Vision probe returned malformed JSON.",
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        code: "malformed",
        message: "Vision probe returned malformed JSON.",
      };
    }

    const content = (
      parsed as { choices?: Array<{ message?: { content?: unknown } }> }
    ).choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        ok: false,
        code: "empty",
        message: "Vision probe returned an empty response.",
      };
    }
    return { ok: true, content: content.trim() };
  } catch (error) {
    if (timedOut || error === timeoutError) {
      return {
        ok: false,
        code: "timeout",
        message: "Vision probe timed out.",
      };
    }
    return {
      ok: false,
      code: "http",
      message: "Vision probe request failed.",
    };
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
