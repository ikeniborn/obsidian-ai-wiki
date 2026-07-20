import OpenAI from "openai";

import { wrapMobileNoStream } from "./mobile-llm-wrap";
import { createNativeLlmClient } from "./native-llm-executor";
import { createNativeOpenAiFetch } from "./native-openai-transport";
import type { ProxyConfig } from "./proxy";
import type { LlmClient, NativeChatCompletionCreate } from "./types";

export interface NativeOpenAiClientOptions {
  baseURL: string;
  apiKey: string;
  requestTimeoutMs: number;
  isMobile: boolean;
  proxyConfig: ProxyConfig;
  mobileFetch: typeof fetch;
  onProxySelected?: (config: ProxyConfig) => void;
  onProxyError?: (error: unknown) => void;
}

/** Node-safe production seam shared by the controller and later live evaluation. */
export function createNativeOpenAiClient(options: NativeOpenAiClientOptions): LlmClient {
  const nativeFetch = createNativeOpenAiFetch({
    baseURL: options.baseURL,
    isMobile: options.isMobile,
    proxyConfig: options.proxyConfig,
    mobileFetch: options.mobileFetch,
    requestTimeoutMs: options.requestTimeoutMs,
    onProxySelected: options.onProxySelected,
    onProxyError: options.onProxyError,
  });
  const raw = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.requestTimeoutMs,
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    fetch: nativeFetch,
  });
  const rawCreate = raw.chat.completions.create.bind(
    raw.chat.completions,
  ) as NativeChatCompletionCreate;
  const executorClient = createNativeLlmClient(rawCreate);
  return options.isMobile ? wrapMobileNoStream(executorClient) : executorClient;
}
