import { buildProxyUrl, parseNoProxy, shouldBypass, type ProxyConfig } from "./proxy";
import { cancelRuntimeTimeout, scheduleRuntimeTimeout } from "./runtime-timers";
import {
  NATIVE_TRANSPORT_ATTEMPT_SIGNAL,
  NATIVE_TRANSPORT_CLIENT_REQUEST_ID,
  NATIVE_TRANSPORT_FRESH_CONNECTION,
  NATIVE_TRANSPORT_TRACEPARENT,
  type NativeTransportDiagnostic,
  type NativeTransportDiagnosticMode,
  type NativeTransportTraceRecord,
} from "./types";

declare const require: (id: "undici") => typeof import("undici");

const directDispatchers = new Map<number, import("undici").Dispatcher>();
const MAX_TRACE_BODY_CHUNK_EVENTS = 48;
const MAX_TRACE_PATH_LENGTH = 256;
const MAX_TRACE_CONTENT_TYPE_LENGTH = 128;
const MAX_TRACE_ERROR_CLASS_LENGTH = 64;
const MAX_PROVIDER_REQUEST_ID_LENGTH = 128;
const MAX_HTTP_ERROR_BODY_WAIT_MS = 5_000;

type TaggedRequestInit = RequestInit & {
  [NATIVE_TRANSPORT_ATTEMPT_SIGNAL]?: AbortSignal;
  [NATIVE_TRANSPORT_CLIENT_REQUEST_ID]?: string;
  [NATIVE_TRANSPORT_TRACEPARENT]?: string;
  [NATIVE_TRANSPORT_FRESH_CONNECTION]?: boolean;
};

function createProxyDispatcher(
  cfg: ProxyConfig,
  connectionTimeoutMs = 15_000,
): import("undici").Dispatcher | null {
  if (!cfg.enabled) return null;
  const undici = require("undici");
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
  const undici = require("undici");
  const wrapped: typeof fetch = (input, init) => {
    return undici.fetch(
      input as Parameters<typeof undici.fetch>[0],
      { ...(init as Parameters<typeof undici.fetch>[1]), dispatcher },
    ) as unknown as Promise<Response>;
  };
  return wrapped;
}

export function createDirectDesktopFetch(connectionTimeoutMs = 15_000): typeof fetch {
  const undici = require("undici");
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
    ) as unknown as Promise<Response>;
  };
  return wrapped;
}

function createIsolatedDirectDesktopFetch(
  connectionTimeoutMs: number,
  finalizers: WeakMap<Response, () => Promise<void>>,
): typeof fetch {
  const undici = require("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  const wrapped: typeof fetch = async (input, init) => {
    const dispatcher = new undici.Agent({
      connectTimeout: normalizedTimeout,
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await dispatcher.close().catch(() => {});
    };
    try {
      const response = await undici.fetch(
        input as Parameters<typeof undici.fetch>[0],
        { ...(init as Parameters<typeof undici.fetch>[1]), dispatcher },
      );
      finalizers.set(response as unknown as Response, close);
      return response as unknown as Response;
    } catch (error) {
      void close();
      throw error;
    }
  };
  return wrapped;
}

function createUndiciRequestAdapterFetch(
  connectionTimeoutMs: number,
  finalizers: WeakMap<Response, () => Promise<void>>,
): typeof fetch {
  const undici = require("undici");
  const normalizedTimeout = normalizeConnectionTimeout(connectionTimeoutMs);
  const wrapped: typeof fetch = async (input, init) => {
    const dispatcher = new undici.Agent({
      connectTimeout: normalizedTimeout,
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await dispatcher.close().catch(() => {});
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
      const adaptedResponse = new undici.Response(
        webBody as ConstructorParameters<typeof undici.Response>[0],
        {
          status: response.statusCode,
          statusText: (response as { statusText?: string }).statusText,
          headers: responseHeaders(response.headers),
        },
      );
      finalizers.set(adaptedResponse as unknown as Response, close);
      return adaptedResponse as unknown as Response;
    } catch (error) {
      void close();
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
  preferDesktopHostForNonStream?: boolean;
}): typeof fetch {
  return selectNativeTransport(options).fetch;
}

export function selectNativeTransport(options: {
  isMobile: boolean;
  mobileFetch: typeof fetch;
  proxyFetch: typeof fetch | null;
  directDesktopFetch: () => typeof fetch;
  preferDesktopHostForNonStream?: boolean;
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
  const directDesktopFetch = options.directDesktopFetch();
  if (options.preferDesktopHostForNonStream === false) {
    return {
      fetch: directDesktopFetch,
      diagnostic: { transport: "desktop-direct", diagnosticMode: "off" },
    };
  }
  return {
    fetch: async (input, init) => await requestUsesStreaming(input, init)
      ? directDesktopFetch(input, init)
      : options.mobileFetch(input, init),
    diagnostic: {
      transport: "desktop-hybrid",
      diagnosticMode: "off",
      requestedScope: "dns_tcp_tls_establishment",
      exactConnectTimeoutAvailable: false,
      hostTransportRetained: true,
    },
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
  const isolatedFinalizers = new WeakMap<Response, () => Promise<void>>();
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
    preferDesktopHostForNonStream: requestedDiagnosticMode === "off",
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
      || NATIVE_TRANSPORT_FRESH_CONNECTION in taggedInit
    )) {
      const clonedInit: TaggedRequestInit = { ...taggedInit };
      delete clonedInit[NATIVE_TRANSPORT_ATTEMPT_SIGNAL];
      delete clonedInit[NATIVE_TRANSPORT_CLIENT_REQUEST_ID];
      delete clonedInit[NATIVE_TRANSPORT_TRACEPARENT];
      delete clonedInit[NATIVE_TRANSPORT_FRESH_CONNECTION];
      if (clientRequestId || traceparent) {
        clonedInit.headers = headersWithCorrelation(clonedInit.headers, { clientRequestId, traceparent });
      }
      forwardedInit = clonedInit;
    }
    const transportKind = selectedDiagnostic?.transport === "desktop-hybrid"
      ? await requestUsesStreaming(input, forwardedInit) ? "desktop-direct" : "desktop-host"
      : selectedDiagnostic?.transport ?? "desktop-direct";
    const freshConnection = taggedInit?.[NATIVE_TRANSPORT_FRESH_CONNECTION] === true
      && transportKind === "desktop-direct"
      && effectiveDiagnosticMode === "off";
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
      response = await (freshConnection
        ? createIsolatedDirectDesktopFetch(options.connectionTimeoutMs, isolatedFinalizers)(input, forwardedInit)
        : selection.fetch(input, forwardedInit));
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
      void isolatedFinalizers.get(response)?.();
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
    const responseFinalizer = isolatedFinalizers.get(response);
    if (transportKind === "desktop-direct" && !response.ok && response.body) {
      try {
        response = await bufferDirectHttpErrorResponse(
          response,
          attemptSignal,
          Math.min(MAX_HTTP_ERROR_BODY_WAIT_MS, normalizeConnectionTimeout(options.connectionTimeoutMs)),
        );
      } catch (error) {
        emit({ stage: "body_start", bodyBytes: 0, bodyChunks: 0 });
        emit({
          stage: "body_error",
          bodyBytes: 0,
          bodyChunks: 0,
          ...safeErrorMetadata(error),
        });
        await responseFinalizer?.();
        throw error;
      }
    }
    const rawDesktopSse = transportKind === "desktop-direct"
      && effectiveDiagnosticMode === "off"
      && response.ok
      && response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") === true;
    if (rawDesktopSse) {
      // Keep the Undici response and body in one runtime. Reconstructing either in
      // Electron can detach the provider stream immediately after HTTP headers.
      void responseFinalizer?.();
      return response;
    }
    return observeResponseBody(
      response,
      attemptSignal,
      emit,
      responseFinalizer,
    );
  };
  return wrapped;
}

async function bufferDirectHttpErrorResponse(
  response: Response,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const body = await readResponseBodyWithin(
    response.body!,
    signal,
    timeoutMs,
    response.headers.get("content-type")?.toLowerCase().includes("json") === true,
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  if (body !== null) {
    headers.set("content-length", String(body.byteLength));
    const responseBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(responseBody).set(body);
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const fallback = JSON.stringify({
    error: {
      message: `HTTP ${response.status} response body timed out after ${timeoutMs}ms.`,
      type: "transport_error",
      code: "response_body_timeout",
    },
  });
  headers.set("content-type", "application/json");
  headers.set("content-length", String(new TextEncoder().encode(fallback).byteLength));
  headers.set("x-aiwiki-error-body-timeout", "1");
  return new Response(fallback, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function readResponseBodyWithin(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  stopAtCompleteJson: boolean,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  return new Promise<Uint8Array | null>((resolve, reject) => {
    let settled = false;
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const cleanup = (): void => {
      cancelRuntimeTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (complete: () => void): boolean => {
      if (settled) return false;
      settled = true;
      cleanup();
      complete();
      return true;
    };
    const combinedBody = (): Uint8Array => {
      const combined = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return combined;
    };
    const completeJsonBody = (): Uint8Array | null => {
      if (!stopAtCompleteJson || byteLength === 0) return null;
      const combined = combinedBody();
      try {
        JSON.parse(new TextDecoder().decode(combined));
        return combined;
      } catch {
        return null;
      }
    };
    const onAbort = (): void => {
      if (!finish(() => reject(signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted", "AbortError")))) return;
      void reader.cancel().catch(() => {});
    };
    const timer = scheduleRuntimeTimeout(() => {
      const partial = byteLength > 0 ? combinedBody() : null;
      if (!finish(() => resolve(partial))) return;
      void reader.cancel().catch(() => {});
    }, timeoutMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      try {
        while (true) {
          const next = await reader.read();
          if (settled) return;
          if (next.done) break;
          chunks.push(next.value);
          byteLength += next.value.byteLength;
          const completeJson = completeJsonBody();
          if (completeJson && finish(() => resolve(completeJson))) {
            void reader.cancel().catch(() => {});
            return;
          }
        }
        finish(() => resolve(combinedBody()));
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        finish(() => reject(reason));
      }
    })();
  });
}

function normalizeConnectionTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 15_000;
}

async function requestUsesStreaming(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<boolean> {
  let bodyText: string | undefined;
  const body = init && "body" in init ? init.body : undefined;
  if (typeof body === "string") {
    bodyText = body;
  } else if (body instanceof URLSearchParams) {
    bodyText = body.toString();
  } else if (body instanceof ArrayBuffer) {
    bodyText = new TextDecoder().decode(body);
  } else if (ArrayBuffer.isView(body)) {
    bodyText = new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  } else if (body instanceof Blob) {
    bodyText = await body.text();
  } else if (body === undefined && input instanceof Request) {
    try {
      bodyText = await input.clone().text();
    } catch {
      return false;
    }
  }
  if (!bodyText) return false;
  try {
    const parsed = JSON.parse(bodyText) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
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
  finalize: (() => Promise<void>) | undefined,
): Response {
  let finalized = false;
  const finalizeOnce = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    await finalize?.();
  };
  const knownEmptyBody = response.status === 204
    || response.headers.get("content-length")?.trim() === "0";
  if (!response.body || knownEmptyBody) {
    emit({ stage: "body_start", bodyBytes: 0, bodyChunks: 0 });
    emit({ stage: "body_end", bodyBytes: 0, bodyChunks: 0 });
    if (response.body) void response.body.cancel().catch(() => {});
    void finalizeOnce();
    return response;
  }

  const reader = response.body.getReader();
  const closesAtOpenAiDone = response.headers.get("content-type")
    ?.toLowerCase().includes("text/event-stream") === true;
  const sseDecoder = closesAtOpenAiDone ? new TextDecoder() : undefined;
  let sseTail = "";
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
  const finish = async (stage: "body_end" | "body_error", error?: unknown): Promise<void> => {
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
    await finalizeOnce();
  };
  const onAbort = (): void => {
    const error = new DOMException("The operation was aborted", "AbortError");
    void finish("body_error", error);
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
          await finish("body_end");
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
        if (sseDecoder) {
          const scan = sseTail + sseDecoder.decode(next.value, { stream: true });
          sseTail = scan.slice(-64);
          if (/(?:^|\r?\n)data:\s*\[DONE\](?:\r?\n|$)/.test(scan)) {
            await reader.cancel();
            await finish("body_end");
            controller.close();
          }
        }
      } catch (error) {
        if (errorIfTerminal(controller)) return;
        await finish("body_error", error);
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
        await finish("body_error", new DOMException("Response body cancelled", "AbortError"));
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
  "errorClass" | "errorCode" | "causeClass" | "causeCode"
> {
  const record = errorRecord(error);
  const cause = errorRecord(record?.cause);
  const errorClass = boundedErrorClass(record?.constructor?.name) ?? "Error";
  const errorCode = boundedErrorClass(record?.code);
  const causeClass = boundedErrorClass(cause?.constructor?.name);
  const causeCode = boundedErrorClass(cause?.code);
  return {
    errorClass,
    ...(errorCode ? { errorCode } : {}),
    ...(causeClass ? { causeClass } : {}),
    ...(causeCode ? { causeCode } : {}),
  };
}

function errorRecord(value: unknown): {
  constructor?: { name?: unknown };
  code?: unknown;
  cause?: unknown;
} | undefined {
  return value !== null && typeof value === "object" ? value : undefined;
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
