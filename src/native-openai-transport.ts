import { buildProxyUrl, parseNoProxy, shouldBypass, type ProxyConfig } from "./proxy";
import {
  NATIVE_TRANSPORT_ATTEMPT_SIGNAL,
  NATIVE_TRANSPORT_CLIENT_REQUEST_ID,
  NATIVE_TRANSPORT_TRACEPARENT,
  type NativeTransportDiagnostic,
  type NativeTransportDiagnosticMode,
  type NativeTransportTraceRecord,
} from "./types";

declare const require: NodeJS.Require;

const directDispatchers = new Map<number, import("undici").Dispatcher>();
const MAX_TRACE_BODY_CHUNK_EVENTS = 48;
const MAX_TRACE_PATH_LENGTH = 256;
const MAX_TRACE_CONTENT_TYPE_LENGTH = 128;
const MAX_TRACE_ERROR_CLASS_LENGTH = 64;
const MAX_PROVIDER_REQUEST_ID_LENGTH = 128;

type TaggedRequestInit = RequestInit & {
  [NATIVE_TRANSPORT_ATTEMPT_SIGNAL]?: AbortSignal;
  [NATIVE_TRANSPORT_CLIENT_REQUEST_ID]?: string;
  [NATIVE_TRANSPORT_TRACEPARENT]?: string;
};

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

function createIsolatedDirectDesktopFetch(
  connectionTimeoutMs: number,
  finalizers: WeakMap<Response, () => void>,
): typeof fetch {
  const undici = require("undici") as typeof import("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  const wrapped: typeof fetch = async (input, init) => {
    const dispatcher = new undici.Agent({
      connectTimeout: normalizedTimeout,
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      void dispatcher.close().catch(() => {});
    };
    try {
      const response = await undici.fetch(
        input as Parameters<typeof undici.fetch>[0],
        { ...(init as Parameters<typeof undici.fetch>[1]), dispatcher },
      ).then((value) => closeAtOpenAiDone(value, undici));
      finalizers.set(response as unknown as Response, close);
      return response as unknown as Response;
    } catch (error) {
      close();
      throw error;
    }
  };
  return wrapped;
}

function createUndiciRequestAdapterFetch(
  connectionTimeoutMs: number,
  finalizers: WeakMap<Response, () => void>,
): typeof fetch {
  const undici = require("undici") as typeof import("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  const wrapped: typeof fetch = async (input, init) => {
    const dispatcher = new undici.Agent({
      connectTimeout: normalizedTimeout,
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      void dispatcher.close().catch(() => {});
    };
    try {
      const request = requestParts(input, init);
      const response = await undici.request(request.url, {
        method: request.method as NonNullable<Parameters<typeof undici.request>[1]>["method"],
        headers: request.headers,
        body: request.body as NonNullable<Parameters<typeof undici.request>[1]>["body"],
        signal: request.signal,
        dispatcher,
        headersTimeout: 0,
        bodyTimeout: 0,
      });
      const webBody = toWebReadableStream(response.body);
      const adaptedResponse = closeAtOpenAiDone(new undici.Response(
        webBody as ConstructorParameters<typeof undici.Response>[0],
        {
          status: response.statusCode,
          statusText: (response as { statusText?: string }).statusText,
          headers: responseHeaders(response.headers),
        },
      ), undici);
      finalizers.set(adaptedResponse as unknown as Response, close);
      return adaptedResponse as unknown as Response;
    } catch (error) {
      close();
      throw error;
    }
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
        diagnosticMode: "off",
        requestedScope: "dns_tcp_tls_establishment",
        exactConnectTimeoutAvailable: false,
        hostTransportRetained: true,
      },
    };
  }
  if (options.proxyFetch) {
    return { fetch: options.proxyFetch, diagnostic: { transport: "desktop-proxy", diagnosticMode: "off" } };
  }
  return {
    fetch: options.directDesktopFetch(),
    diagnostic: { transport: "desktop-direct", diagnosticMode: "off" },
  };
}

export function createNativeOpenAiFetch(options: {
  baseURL: string;
  isMobile: boolean;
  proxyConfig: ProxyConfig;
  mobileFetch: typeof fetch;
  connectionTimeoutMs: number;
  nativeTransportDiagnosticMode?: NativeTransportDiagnosticMode;
  onProxySelected?: (config: ProxyConfig) => void;
  onProxyError?: (error: unknown) => void;
  onTransportDiagnostic?: (diagnostic: NativeTransportDiagnostic) => void;
  onHttpResponse?: (signal: AbortSignal, diagnostic: NativeTransportDiagnostic) => void;
  onTraceEvent?: (signal: AbortSignal, event: NativeTransportTraceRecord) => void;
}): typeof fetch {
  const requestedDiagnosticMode = options.nativeTransportDiagnosticMode === "connection-close"
    || options.nativeTransportDiagnosticMode === "undici-request-adapter"
      ? options.nativeTransportDiagnosticMode
      : "off";
  const isolatedFinalizers = new WeakMap<Response, () => void>();
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
    directDesktopFetch: () => {
      if (requestedDiagnosticMode === "connection-close") {
        return createIsolatedDirectDesktopFetch(options.connectionTimeoutMs, isolatedFinalizers);
      }
      if (requestedDiagnosticMode === "undici-request-adapter") {
        return createUndiciRequestAdapterFetch(options.connectionTimeoutMs, isolatedFinalizers);
      }
      return createDirectDesktopFetch(options.connectionTimeoutMs);
    },
  });
  const effectiveDiagnosticMode: NativeTransportDiagnosticMode =
    selection.diagnostic?.transport === "desktop-direct"
      ? requestedDiagnosticMode
      : "off";
  const selectedDiagnostic = selection.diagnostic
    ? { ...selection.diagnostic, diagnosticMode: effectiveDiagnosticMode }
    : undefined;
  if (selectedDiagnostic) options.onTransportDiagnostic?.(selectedDiagnostic);
  const transportKind = selectedDiagnostic?.transport ?? "desktop-direct";
  const wrapped: typeof fetch = async (input, init) => {
    const taggedInit: TaggedRequestInit | undefined = init;
    const attemptSignal = taggedInit?.[NATIVE_TRANSPORT_ATTEMPT_SIGNAL]
      ?? taggedInit?.signal
      ?? undefined;
    const clientRequestId = sanitizeClientRequestId(taggedInit?.[NATIVE_TRANSPORT_CLIENT_REQUEST_ID]);
    const traceparent = sanitizeTraceparent(taggedInit?.[NATIVE_TRANSPORT_TRACEPARENT]);
    let forwardedInit = init;
    if (taggedInit && (
      NATIVE_TRANSPORT_ATTEMPT_SIGNAL in taggedInit
      || NATIVE_TRANSPORT_CLIENT_REQUEST_ID in taggedInit
      || NATIVE_TRANSPORT_TRACEPARENT in taggedInit
    )) {
      const clonedInit: TaggedRequestInit = { ...taggedInit };
      delete clonedInit[NATIVE_TRANSPORT_ATTEMPT_SIGNAL];
      delete clonedInit[NATIVE_TRANSPORT_CLIENT_REQUEST_ID];
      delete clonedInit[NATIVE_TRANSPORT_TRACEPARENT];
      if (clientRequestId || traceparent) {
        clonedInit.headers = headersWithCorrelation(clonedInit.headers, { clientRequestId, traceparent });
      }
      forwardedInit = clonedInit;
    }
    const startedAtMs = Date.now();
    const path = endpointPath(input);
    const emit = (event: Omit<NativeTransportTraceRecord,
      "networkTransport" | "endpointPath" | "diagnosticMode" | "elapsedMs">
      & { elapsedMs?: number }): void => {
      if (!attemptSignal) return;
      options.onTraceEvent?.(attemptSignal, {
        networkTransport: transportKind,
        endpointPath: path,
        diagnosticMode: effectiveDiagnosticMode,
        elapsedMs: event.elapsedMs ?? elapsedSince(startedAtMs),
        ...(clientRequestId ? { clientRequestId } : {}),
        ...(traceparent ? { traceparent } : {}),
        ...event,
      });
    };
    emit({ stage: "fetch_start", elapsedMs: 0 });
    let fetchTerminalRecorded = false;
    const onFetchAbort = (): void => {
      if (fetchTerminalRecorded) return;
      fetchTerminalRecorded = true;
      emit({
        stage: "fetch_abort",
        ...safeErrorMetadata(new DOMException("The operation was aborted", "AbortError")),
      });
    };
    if (attemptSignal?.aborted) onFetchAbort();
    else attemptSignal?.addEventListener("abort", onFetchAbort, { once: true });
    let response: Response;
    try {
      response = await selection.fetch(input, forwardedInit);
    } catch (error) {
      attemptSignal?.removeEventListener("abort", onFetchAbort);
      const aborted = Boolean(attemptSignal?.aborted || forwardedInit?.signal?.aborted)
        || (error instanceof Error && error.name === "AbortError");
      if (!fetchTerminalRecorded) {
        fetchTerminalRecorded = true;
        emit({
          stage: aborted ? "fetch_abort" : "fetch_error",
          ...safeErrorMetadata(error),
        });
      }
      throw error;
    }
    attemptSignal?.removeEventListener("abort", onFetchAbort);
    if (fetchTerminalRecorded) {
      void response.body?.cancel().catch(() => {});
      isolatedFinalizers.get(response)?.();
      throw attemptSignal?.reason instanceof Error
        ? attemptSignal.reason
        : new DOMException("The operation was aborted", "AbortError");
    }
    if (attemptSignal) {
      options.onHttpResponse?.(attemptSignal, {
        transport: transportKind,
        diagnosticMode: effectiveDiagnosticMode,
        endpointPath: path,
        status: response.status,
        providerRequestId: providerRequestId(response.headers),
        ...(clientRequestId ? { clientRequestId } : {}),
        ...(traceparent ? { traceparent } : {}),
      });
    }
    emit({
      stage: "fetch_headers",
      status: response.status,
      ...selectedResponseHeaders(response.headers),
    });
    return observeResponseBody(
      response,
      attemptSignal,
      emit,
      isolatedFinalizers.get(response),
    );
  };
  return wrapped;
}

function normalizeConnectionTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 15_000;
}

function requestParts(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): {
  url: string | URL;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
  signal: AbortSignal | undefined;
} {
  const request = input instanceof Request ? input : undefined;
  const headers = new Headers(request?.headers);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  const method = init?.method ?? request?.method ?? "GET";
  const body = init && "body" in init ? init.body : request?.body;
  return {
    url: request ? request.url : input as string | URL,
    method,
    headers: headersRecord(headers),
    body: method === "GET" || method === "HEAD" ? undefined : body,
    signal: init?.signal ?? request?.signal ?? undefined,
  };
}

function headersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => { record[key] = value; });
  return record;
}

function responseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    next[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return next;
}

function toWebReadableStream(body: unknown): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    return body as ReadableStream<Uint8Array>;
  }
  const iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]?.();
  if (!iterator) return null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(chunkToUint8Array(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.();
      (body as { destroy?: (error?: Error) => void }).destroy?.(
        reason instanceof Error ? reason : undefined,
      );
    },
  });
}

function chunkToUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return new TextEncoder().encode(String(chunk));
}

function endpointPath(input: Parameters<typeof fetch>[0]): string {
  const raw =
    typeof input === "string" ? input
    : input instanceof URL ? input.href
    : input.url;
  try {
    const url = new URL(raw);
    return sanitizeNativeDiagnosticPath(url.pathname);
  } catch {
    return "";
  }
}

export function sanitizeNativeDiagnosticPath(value: string): string {
  return boundedString(value, MAX_TRACE_PATH_LENGTH) ?? "";
}

function observeResponseBody(
  response: Response,
  signal: AbortSignal | undefined,
  emit: (event: Omit<NativeTransportTraceRecord,
    "networkTransport" | "endpointPath" | "diagnosticMode" | "elapsedMs">
    & { elapsedMs?: number }) => void,
  finalize: (() => void) | undefined,
): Response {
  let finalized = false;
  const finalizeOnce = (): void => {
    if (finalized) return;
    finalized = true;
    finalize?.();
  };
  const knownEmptyBody = response.status === 204
    || response.headers.get("content-length")?.trim() === "0";
  if (!response.body || knownEmptyBody) {
    emit({ stage: "body_start", bodyBytes: 0, bodyChunks: 0 });
    emit({ stage: "body_end", bodyBytes: 0, bodyChunks: 0 });
    if (response.body) void response.body.cancel().catch(() => {});
    finalizeOnce();
    return response;
  }

  const reader = response.body.getReader();
  let bodyStarted = false;
  let bodyBytes = 0;
  let bodyChunks = 0;
  let emittedChunkEvents = 0;
  let terminal = false;
  let terminalError: unknown;
  const startBody = (): void => {
    if (bodyStarted) return;
    bodyStarted = true;
    emit({ stage: "body_start", bodyBytes, bodyChunks });
  };
  const finish = (stage: "body_end" | "body_error", error?: unknown): void => {
    if (terminal) return;
    terminal = true;
    terminalError = error;
    signal?.removeEventListener("abort", onAbort);
    emit({
      stage,
      bodyBytes,
      bodyChunks,
      ...(stage === "body_error" ? safeErrorMetadata(error) : {}),
    });
    finalizeOnce();
  };
  const onAbort = (): void => {
    const error = new DOMException("The operation was aborted", "AbortError");
    finish("body_error", error);
    void reader.cancel().catch(() => {});
  };
  const errorIfTerminal = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): boolean => {
    if (!terminal) return false;
    controller.error(terminalError ?? new DOMException("The operation was aborted", "AbortError"));
    return true;
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (errorIfTerminal(controller)) return;
      startBody();
      try {
        const next = await reader.read();
        if (errorIfTerminal(controller)) return;
        if (next.done) {
          finish("body_end");
          controller.close();
          return;
        }
        bodyBytes = Math.min(Number.MAX_SAFE_INTEGER, bodyBytes + next.value.byteLength);
        bodyChunks = Math.min(Number.MAX_SAFE_INTEGER, bodyChunks + 1);
        if (emittedChunkEvents < MAX_TRACE_BODY_CHUNK_EVENTS) {
          emittedChunkEvents += 1;
          emit({ stage: "body_chunk", bodyBytes, bodyChunks });
        }
        controller.enqueue(next.value);
      } catch (error) {
        if (errorIfTerminal(controller)) return;
        finish("body_error", error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (terminal) {
        await reader.cancel(reason);
        return;
      }
      startBody();
      try {
        await reader.cancel(reason);
      } finally {
        finish("body_error", new DOMException("Response body cancelled", "AbortError"));
      }
    },
  }, { highWaterMark: 0 });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function elapsedSince(startedAtMs: number): number {
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Date.now() - startedAtMs)));
}

function selectedResponseHeaders(headers: Headers): Pick<
  NativeTransportTraceRecord,
  "contentType" | "contentLength"
> {
  const contentType = boundedString(headers.get("content-type"), MAX_TRACE_CONTENT_TYPE_LENGTH);
  const rawContentLength = headers.get("content-length")?.trim();
  const parsedContentLength = rawContentLength && /^\d+$/.test(rawContentLength)
    ? Number(rawContentLength)
    : undefined;
  return {
    ...(contentType ? { contentType } : {}),
    ...(Number.isSafeInteger(parsedContentLength) && parsedContentLength! >= 0
      ? { contentLength: parsedContentLength }
      : {}),
  };
}

function safeErrorMetadata(error: unknown): Pick<
  NativeTransportTraceRecord,
  "errorClass"
> {
  const record = error !== null && typeof error === "object"
    ? error as { constructor?: { name?: unknown } }
    : undefined;
  const errorClass = boundedErrorClass(record?.constructor?.name) ?? "Error";
  return { errorClass };
}

function headersWithCorrelation(
  headers: HeadersInit | undefined,
  ids: { clientRequestId?: string; traceparent?: string },
): Headers {
  const next = new Headers(headers);
  if (ids.clientRequestId) next.set("x-client-attempt-id", ids.clientRequestId);
  if (ids.traceparent) next.set("traceparent", ids.traceparent);
  return next;
}

function sanitizeClientRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, MAX_PROVIDER_REQUEST_ID_LENGTH);
  return sanitized || undefined;
}

function sanitizeTraceparent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(value) ? value : undefined;
}

function boundedErrorClass(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, MAX_TRACE_ERROR_CLASS_LENGTH);
  return sanitized || undefined;
}

function boundedString(value: string | null, maxLength: number): string | undefined {
  if (value === null) return undefined;
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("").trim();
  return sanitized ? sanitized.slice(0, maxLength) : undefined;
}

function providerRequestId(headers: Headers): string | undefined {
  const raw = headers.get("x-request-id")
    ?? headers.get("x-requestid")
    ?? headers.get("request-id")
    ?? headers.get("cf-ray")
    ?? undefined;
  if (raw === undefined) return undefined;
  const bounded = boundedString(raw, MAX_PROVIDER_REQUEST_ID_LENGTH);
  if (!bounded) return undefined;
  const sanitized = bounded.replace(/[^A-Za-z0-9_.:-]/g, "_");
  return sanitized || undefined;
}
