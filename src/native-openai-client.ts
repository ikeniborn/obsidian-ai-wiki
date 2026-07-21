import OpenAI from "openai";

import { wrapMobileNoStream } from "./mobile-llm-wrap";
import { createNativeLlmClient } from "./native-llm-executor";
import { createNativeOpenAiFetch } from "./native-openai-transport";
import type { ProxyConfig } from "./proxy";
import {
  MAX_SAFE_TIMER_MS,
  type LlmClient,
  type NativeChatCompletionCreate,
  type NativeTransportDiagnostic,
} from "./types";

export interface NativeOpenAiClientOptions {
  baseURL: string;
  apiKey: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
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

/** Node-safe production seam shared by the controller and later live evaluation. */
export function createNativeOpenAiClient(options: NativeOpenAiClientOptions): LlmClient {
  let nativeTransportDiagnostic: NativeTransportDiagnostic | undefined;
  const nativeFetch = createNativeOpenAiFetch({
    baseURL: options.baseURL,
    isMobile: options.isMobile,
    proxyConfig: options.proxyConfig,
    mobileFetch: options.mobileFetch,
    connectionTimeoutMs: options.connectionTimeoutMs,
    onProxySelected: options.onProxySelected,
    onProxyError: options.onProxyError,
    onTransportDiagnostic: (diagnostic) => { nativeTransportDiagnostic = diagnostic; },
  });
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
  const client = options.isMobile ? wrapMobileNoStream(executorClient) : executorClient;
  if (nativeTransportDiagnostic) client.nativeTransportDiagnostic = nativeTransportDiagnostic;
  return client;
}
