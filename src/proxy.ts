import { Platform } from "obsidian";
import type { ProxyConfig } from "./local-config";

declare const require: NodeJS.Require;

const directDispatchers = new Map<number, import("undici").Dispatcher>();

function closeAtOpenAiDone(
  response: import("undici").Response,
  undici: typeof import("undici"),
): import("undici").Response {
  if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          closed = true;
          controller.close();
          return;
        }
        const value = next.value as Uint8Array;
        controller.enqueue(value);
        const scan = tail + decoder.decode(value, { stream: true });
        tail = scan.slice(-64);
        if (/(?:^|\r?\n)data:\s*\[DONE\](?:\r?\n|$)/.test(scan)) {
          closed = true;
          controller.close();
          void reader.cancel();
        }
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (!closed) await reader.cancel(reason);
    },
  });
  return new undici.Response(body as unknown as ConstructorParameters<typeof undici.Response>[0], {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createProxyDispatcher(cfg: ProxyConfig): import("undici").Dispatcher | null {
  if (!cfg.enabled) return null;
  if (Platform.isMobile) return null;
  const undici = require("undici") as typeof import("undici");
  return new undici.ProxyAgent(buildProxyUrl(cfg));
}

export function createProxyFetch(cfg: ProxyConfig): typeof fetch | null {
  const dispatcher = createProxyDispatcher(cfg);
  if (!dispatcher) return null;
  const undici = require("undici") as typeof import("undici");
  const wrapped: typeof fetch = (input, init) => {
    return undici.fetch(
      input as Parameters<typeof undici.fetch>[0],
      { ...(init as Parameters<typeof undici.fetch>[1]), dispatcher },
    ) as unknown as Promise<Response>;
  };
  return wrapped;
}

export function createDirectDesktopFetch(headersTimeoutMs = 300_000): typeof fetch {
  const undici = require("undici") as typeof import("undici");
  const normalizedTimeout = Number.isFinite(headersTimeoutMs) && headersTimeoutMs > 0
    ? Math.floor(headersTimeoutMs)
    : 300_000;
  let dispatcher = directDispatchers.get(normalizedTimeout);
  if (!dispatcher) {
    dispatcher = new undici.Agent({
      headersTimeout: normalizedTimeout,
      bodyTimeout: 0,
    });
    directDispatchers.set(normalizedTimeout, dispatcher);
  }
  const wrapped: typeof fetch = (input, init) => {
    return undici.fetch(
      input as Parameters<typeof undici.fetch>[0],
      { ...(init as Parameters<typeof undici.fetch>[1]), dispatcher },
    ).then((response) => closeAtOpenAiDone(response, undici)) as unknown as Promise<Response>;
  };
  return wrapped;
}

export function createDesktopOpenAiFetch(options: {
  nonStreamFetch: typeof fetch;
  streamFetch: typeof fetch;
  nonStreamTimeoutMs: number;
}): typeof fetch {
  const timeoutMs = normalizeTimeout(options.nonStreamTimeoutMs);
  return async (input, init) => {
    if (requestUsesStreaming(init?.body)) {
      return options.streamFetch(input, init);
    }
    return boundedFetch(options.nonStreamFetch, input, init, timeoutMs);
  };
}

export function selectNativeFetch(options: {
  isMobile: boolean;
  mobileFetch: typeof fetch;
  proxyFetch: typeof fetch | null;
  directDesktopFetch: () => typeof fetch;
  requestTimeoutMs: number;
}): typeof fetch {
  if (options.isMobile) return options.mobileFetch;
  if (options.proxyFetch) return options.proxyFetch;
  return createDesktopOpenAiFetch({
    nonStreamFetch: options.mobileFetch,
    streamFetch: options.directDesktopFetch(),
    nonStreamTimeoutMs: options.requestTimeoutMs,
  });
}

function requestUsesStreaming(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const parsed = JSON.parse(body) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

function boundedFetch(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
): Promise<Response> {
  // eslint-disable-next-line import/no-nodejs-modules -- Must survive Electron renderer timer suspension.
  const timers = require("node:timers") as typeof import("node:timers");
  if (init?.signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      init?.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    };
    const timer = timers.setTimeout(() => {
      finish(() => reject(new DOMException("Request timed out", "TimeoutError")));
    }, timeoutMs);

    init?.signal?.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve().then(() => fetchImpl(input, init)).then(
      (response) => finish(() => resolve(response)),
      (error: unknown) => finish(() => reject(
        error instanceof Error ? error : new Error(String(error)),
      )),
    );
  });
}

function normalizeTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 300_000;
}

export function buildProxyUrl(cfg: ProxyConfig): string {
  const u = new URL(cfg.url);
  if (cfg.username) u.username = encodeURIComponent(cfg.username);
  if (cfg.password) u.password = encodeURIComponent(cfg.password);
  return u.toString();
}

export function shouldBypass(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of list) {
    const entry = raw.toLowerCase();
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      if (h.endsWith(suffix)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

export function parseNoProxy(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.password) return url;
    u.password = "****";
    return u.toString();
  } catch {
    return url;
  }
}
