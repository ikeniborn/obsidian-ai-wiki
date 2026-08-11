import OpenAI from "openai";

import { wrapBufferedNoStream } from "./mobile-llm-wrap";
import { createNativeLlmClient } from "./native-llm-executor";
import {
  createDirectDesktopFetch,
  createNativeOpenAiFetch,
  createProxyFetch,
  sanitizeNativeDiagnosticPath,
  selectNativeFetch,
} from "./native-openai-transport";
import { parseNoProxy, shouldBypass, type ProxyConfig } from "./proxy";
import {
  MAX_SAFE_TIMER_MS,
  type LlmClient,
  type NativeChatCompletionCreate,
  type NativeTransportDiagnostic,
  type NativeTransportDiagnosticMode,
  type NativeTransportTraceRecord,
  type NativeTransportTraceSnapshot,
} from "./types";

export interface NativeOpenAiClientOptions {
  baseURL: string;
  apiKey: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  nativeTransportDiagnosticMode?: NativeTransportDiagnosticMode;
  isMobile: boolean;
  proxyConfig: ProxyConfig;
  mobileFetch: typeof fetch;
  onProxySelected?: (config: ProxyConfig) => void;
  onProxyError?: (error: unknown) => void;
}

export function sdkTimeoutForIdleMs(idleTimeoutMs: number): number {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return MAX_SAFE_TIMER_MS;
  return Math.min(MAX_SAFE_TIMER_MS, Math.floor(idleTimeoutMs) + 1_000);
}

function chatCompletionsPath(baseURL: string): string {
  try {
    const url = new URL(baseURL);
    const prefix = url.pathname.replace(/\/+$/, "");
    return sanitizeNativeDiagnosticPath(
      `${prefix}/chat/completions`.replace(/\/{2,}/g, "/"),
    );
  } catch {
    return "/chat/completions";
  }
}

export interface NativeProbeFetchOptions {
  baseURL: string;
  isMobile: boolean;
  proxyConfig: ProxyConfig;
  mobileFetch: typeof fetch;
  connectionTimeoutMs: number;
}

/**
 * The transport for a context-window probe. It makes the same route decision this
 * factory makes for completions against the same base URL — mobile host, proxy, or
 * direct desktop, with the no-proxy bypass honoured — so a probe never travels a
 * route the completion would not. It is pinned to the direct desktop route rather
 * than the hybrid one because a probe is a plain non-streaming GET/POST.
 */
export function createNativeProbeFetch(options: NativeProbeFetchOptions): typeof fetch {
  let proxyFetch: typeof fetch | null = null;
  if (!options.isMobile && options.proxyConfig.enabled) {
    try {
      const baseHost = new URL(options.baseURL).hostname;
      if (!shouldBypass(baseHost, parseNoProxy(options.proxyConfig.noProxy))) {
        proxyFetch = createProxyFetch(options.proxyConfig, options.connectionTimeoutMs);
      }
    } catch { /* an unparseable base URL leaves the probe on the direct route */ }
  }
  return selectNativeFetch({
    isMobile: options.isMobile,
    mobileFetch: options.mobileFetch,
    proxyFetch,
    directDesktopFetch: () => createDirectDesktopFetch(options.connectionTimeoutMs),
    preferDesktopHostForNonStream: false,
  });
}

/** Node-safe production seam shared by the controller and later live evaluation. */
export function createNativeOpenAiClient(options: NativeOpenAiClientOptions): LlmClient {
  let nativeTransportDiagnostic: NativeTransportDiagnostic | undefined;
  const nativeHttpResponseDiagnostics = new WeakMap<AbortSignal, NativeTransportDiagnostic>();
  const nativeTransportTraces = new WeakMap<AbortSignal, {
    startedAtMs: number;
    events: NativeTransportTraceRecord[];
  }>();
  const nativeFetch = createNativeOpenAiFetch({
    baseURL: options.baseURL,
    isMobile: options.isMobile,
    proxyConfig: options.proxyConfig,
    mobileFetch: options.mobileFetch,
    connectionTimeoutMs: options.connectionTimeoutMs,
    nativeTransportDiagnosticMode: options.nativeTransportDiagnosticMode ?? "off",
    onProxySelected: options.onProxySelected,
    onProxyError: options.onProxyError,
    onTransportDiagnostic: (diagnostic) => { nativeTransportDiagnostic = diagnostic; },
    onHttpResponse: (signal, diagnostic) => {
      nativeHttpResponseDiagnostics.set(signal, diagnostic);
    },
    onTraceEvent: (signal, event) => {
      if (event.stage === "fetch_start") {
        nativeTransportTraces.set(signal, { startedAtMs: Date.now(), events: [event] });
        return;
      }
      const trace = nativeTransportTraces.get(signal);
      if (!trace) return;
      appendBoundedTraceEvent(trace.events, event);
    },
  });
  const endpointPath = chatCompletionsPath(options.baseURL);
  if (nativeTransportDiagnostic) {
    nativeTransportDiagnostic = { ...nativeTransportDiagnostic, endpointPath };
  }
  const raw = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: sdkTimeoutForIdleMs(options.idleTimeoutMs),
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    fetch: nativeFetch,
  });
  const rawCreate = raw.chat.completions.create.bind(
    raw.chat.completions,
  ) as NativeChatCompletionCreate;
  const executorClient = createNativeLlmClient(rawCreate, options.connectionTimeoutMs);
  const bufferedCompletions = options.isMobile
    || nativeTransportDiagnostic?.transport === "desktop-hybrid";
  const client = bufferedCompletions ? wrapBufferedNoStream(executorClient) : executorClient;
  if (nativeTransportDiagnostic) client.nativeTransportDiagnostic = nativeTransportDiagnostic;
  client.consumeNativeHttpResponseDiagnostic = (signal) => {
    const diagnostic = nativeHttpResponseDiagnostics.get(signal);
    nativeHttpResponseDiagnostics.delete(signal);
    return diagnostic;
  };
  client.consumeNativeTransportTrace = (signal): NativeTransportTraceSnapshot | undefined => {
    const trace = nativeTransportTraces.get(signal);
    nativeTransportTraces.delete(signal);
    if (!trace) return undefined;
    return { startedAtMs: trace.startedAtMs, events: trace.events };
  };
  return client;
}

function appendBoundedTraceEvent(
  events: NativeTransportTraceRecord[],
  event: NativeTransportTraceRecord,
): void {
  const maxEvents = 64;
  if (events.length < maxEvents) {
    events.push(event);
    return;
  }
  if (event.stage === "body_chunk") return;
  const chunkIndex = events.findIndex((candidate) => candidate.stage === "body_chunk");
  if (chunkIndex >= 0) events.splice(chunkIndex, 1);
  else events.shift();
  events.push(event);
}
