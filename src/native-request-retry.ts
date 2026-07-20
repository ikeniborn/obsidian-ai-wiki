import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";

export interface NativeRetryDecision {
  retryable: boolean;
  errorClass: string;
  status?: number;
  providerRequestId?: string;
}

const MAX_CAUSE_NODES = 16;
const MAX_DELAY_MS = 8_000;
const TEMPORARY_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);
const PERMANENT_TRANSPORT_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EPROTO",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const CONTEXT_CODES = new Set([
  "context_length_exceeded",
  "max_context_length_exceeded",
]);

function causeNodes(error: unknown): unknown[] {
  const nodes: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== null && typeof current === "object" && nodes.length < MAX_CAUSE_NODES) {
    if (seen.has(current)) break;
    seen.add(current);
    nodes.push(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return nodes;
}

function errorCode(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function decision(
  retryable: boolean,
  errorClass: string,
  error?: APIError,
): NativeRetryDecision {
  return {
    retryable,
    errorClass,
    ...(error?.status === undefined ? {} : { status: error.status }),
    ...(error?.requestID == null ? {} : { providerRequestId: error.requestID }),
  };
}

export function classifyNativeRetry(error: unknown): NativeRetryDecision {
  if (error instanceof APIUserAbortError
    || (error instanceof Error && error.name === "AbortError")) {
    return decision(false, "user_cancellation");
  }

  const nodes = causeNodes(error);
  for (const node of nodes) {
    const code = errorCode(node);
    if (code !== undefined && PERMANENT_TRANSPORT_CODES.has(code)) {
      return decision(false, `permanent_transport:${code}`);
    }
  }

  if (error instanceof APIError) {
    if (error.code !== null && error.code !== undefined && CONTEXT_CODES.has(error.code)) {
      return decision(false, "context_limit", error);
    }
    const shouldRetry = error.headers?.get("x-should-retry")?.trim().toLowerCase();
    if (shouldRetry === "false") return decision(false, "provider_no_retry", error);
    if (shouldRetry === "true") return decision(true, "provider_retry", error);
  }

  if (error instanceof APIConnectionTimeoutError) return decision(true, "connection_timeout");
  if (error instanceof APIConnectionError) return decision(true, "connection");

  for (const node of nodes) {
    const code = errorCode(node);
    if (code !== undefined && TEMPORARY_CODES.has(code)) {
      return decision(true, `temporary_transport:${code}`);
    }
  }

  if (error instanceof APIError && error.status !== undefined) {
    const retryable = error.status === 408
      || error.status === 409
      || error.status === 429
      || (error.status >= 500 && error.status <= 599);
    return decision(retryable, retryable ? "retryable_http" : "permanent_http", error);
  }

  return decision(false, "unknown");
}

export function retryDelay(
  headers: Headers | undefined,
  retryOrdinal: number,
  env: { now: () => number; random: () => number } = {
    now: Date.now,
    random: Math.random,
  },
): { delayMs: number; source: "retry-after-ms" | "retry-after" | "backoff" } {
  const retryAfterMs = headers?.get("retry-after-ms");
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    const parsed = Number(retryAfterMs);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { delayMs: Math.min(Math.round(parsed), MAX_DELAY_MS), source: "retry-after-ms" };
    }
  }

  const retryAfter = headers?.get("retry-after");
  if (retryAfter !== null && retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    const parsed = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(retryAfter) - env.now();
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { delayMs: Math.min(Math.round(parsed), MAX_DELAY_MS), source: "retry-after" };
    }
  }

  const ordinal = Math.max(1, Math.floor(retryOrdinal));
  const exponential = Math.min(500 * 2 ** (ordinal - 1), MAX_DELAY_MS);
  const random = Math.min(1, Math.max(0, env.random()));
  return {
    delayMs: Math.round(exponential * (0.75 + random * 0.25)),
    source: "backoff",
  };
}
