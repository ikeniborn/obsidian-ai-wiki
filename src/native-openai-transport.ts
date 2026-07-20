import { buildProxyUrl, parseNoProxy, shouldBypass, type ProxyConfig } from "./proxy";
import type { NativeTransportDiagnostic } from "./types";

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

export function createProxyDispatcher(
  cfg: ProxyConfig,
  connectionTimeoutMs = 15_000,
): import("undici").Dispatcher | null {
  if (!cfg.enabled) return null;
  const undici = require("undici") as typeof import("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  return new undici.ProxyAgent({
    uri: buildProxyUrl(cfg),
    connectTimeout: normalizedTimeout,
    proxyTls: { timeout: normalizedTimeout },
    requestTls: { timeout: normalizedTimeout },
    headersTimeout: 0,
    bodyTimeout: 0,
  });
}

export function createProxyFetch(cfg: ProxyConfig, connectionTimeoutMs = 15_000): typeof fetch | null {
  const dispatcher = createProxyDispatcher(cfg, connectionTimeoutMs);
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

export function createDirectDesktopFetch(connectionTimeoutMs = 15_000): typeof fetch {
  const undici = require("undici") as typeof import("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  let dispatcher = directDispatchers.get(normalizedTimeout);
  if (!dispatcher) {
    dispatcher = new undici.Agent({
      connectTimeout: normalizedTimeout,
      headersTimeout: 0,
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

export function selectNativeFetch(options: {
  isMobile: boolean;
  mobileFetch: typeof fetch;
  proxyFetch: typeof fetch | null;
  directDesktopFetch: () => typeof fetch;
}): typeof fetch {
  return selectNativeTransport(options).fetch;
}

export function selectNativeTransport(options: {
  isMobile: boolean;
  mobileFetch: typeof fetch;
  proxyFetch: typeof fetch | null;
  directDesktopFetch: () => typeof fetch;
}): { fetch: typeof fetch; diagnostic?: NativeTransportDiagnostic } {
  if (options.isMobile) {
    return {
      fetch: options.mobileFetch,
      diagnostic: {
        transport: "mobile-host",
        requestedScope: "dns_tcp_tls_establishment",
        exactConnectTimeoutAvailable: false,
        hostTransportRetained: true,
      },
    };
  }
  if (options.proxyFetch) return { fetch: options.proxyFetch };
  return { fetch: options.directDesktopFetch() };
}

export function createNativeOpenAiFetch(options: {
  baseURL: string;
  isMobile: boolean;
  proxyConfig: ProxyConfig;
  mobileFetch: typeof fetch;
  connectionTimeoutMs: number;
  onProxySelected?: (config: ProxyConfig) => void;
  onProxyError?: (error: unknown) => void;
  onTransportDiagnostic?: (diagnostic: NativeTransportDiagnostic) => void;
}): typeof fetch {
  let proxyFetch: typeof fetch | null = null;
  if (!options.isMobile && options.proxyConfig.enabled) {
    try {
      const baseHost = new URL(options.baseURL).hostname;
      if (!shouldBypass(baseHost, parseNoProxy(options.proxyConfig.noProxy))) {
        proxyFetch = createProxyFetch(options.proxyConfig, options.connectionTimeoutMs);
        if (proxyFetch) options.onProxySelected?.(options.proxyConfig);
      }
    } catch (error) {
      options.onProxyError?.(error);
    }
  }
  const selection = selectNativeTransport({
    isMobile: options.isMobile,
    mobileFetch: options.mobileFetch,
    proxyFetch,
    directDesktopFetch: () => createDirectDesktopFetch(options.connectionTimeoutMs),
  });
  if (selection.diagnostic) options.onTransportDiagnostic?.(selection.diagnostic);
  return selection.fetch;
}

function normalizeConnectionTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 15_000;
}
