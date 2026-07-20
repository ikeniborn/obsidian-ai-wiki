import assert from "node:assert/strict";
import test from "node:test";

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";

import { classifyNativeRetry, retryDelay } from "../src/native-request-retry";
import type { RunEvent } from "../src/types";

function apiError(status: number, headers: Record<string, string> = {}, code?: string): APIError {
  return APIError.generate(
    status,
    code === undefined ? {} : { error: { code, message: code, type: "invalid_request_error" } },
    undefined,
    new Headers(headers),
  );
}

function codedError(code: string, cause?: unknown): Error {
  const error = new Error(code, cause === undefined ? undefined : { cause });
  Object.assign(error, { code });
  return error;
}

test("retries real OpenAI connection and timeout errors", () => {
  for (const error of [
    new APIConnectionError({ message: "connection failed" }),
    new APIConnectionTimeoutError({ message: "connection timed out" }),
  ]) {
    assert.equal(classifyNativeRetry(error).retryable, true);
  }
});

test("classifies the HTTP retry matrix from real SDK API errors", () => {
  for (const [status, expected] of [
    [408, true], [409, true], [429, true], [500, true], [501, true], [502, true], [503, true], [504, true], [599, true],
    [400, false], [401, false], [403, false], [404, false], [422, false],
  ] as const) {
    assert.equal(classifyNativeRetry(apiError(status)).retryable, expected, `HTTP ${status}`);
  }
});

test("returns typed HTTP metadata", () => {
  const decision = classifyNativeRetry(apiError(503, { "x-request-id": "req_123" }));
  assert.equal(decision.status, 503);
  assert.equal(decision.providerRequestId, "req_123");
});

test("x-should-retry false overrides retryable status and true overrides status matrix", () => {
  assert.equal(classifyNativeRetry(apiError(502, { "x-should-retry": "false" })).retryable, false);
  assert.equal(classifyNativeRetry(apiError(400, { "x-should-retry": "true" })).retryable, true);
});

test("retries temporary socket and DNS codes through nested causes", () => {
  for (const code of ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"]) {
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: codedError(code) }) });
    assert.equal(classifyNativeRetry(wrapped).retryable, true, code);
  }
});

test("never retries permanent TLS, certificate, hostname, or protocol codes", () => {
  for (const code of [
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "EPROTO",
  ]) {
    const wrapped = new APIConnectionError({
      message: "connection failed",
      cause: new Error("middle", { cause: codedError(code) }),
    });
    assert.equal(classifyNativeRetry(wrapped).retryable, false, code);
  }
});

test("cause traversal is bounded and cycle-safe", () => {
  const cycle = codedError("UNKNOWN");
  Object.assign(cycle, { cause: cycle });
  assert.equal(classifyNativeRetry(cycle).retryable, false);

  let deep: unknown = codedError("ECONNRESET");
  for (let index = 0; index < 40; index += 1) deep = new Error(`wrapper-${index}`, { cause: deep });
  assert.equal(classifyNativeRetry(deep).retryable, false);
});

test("never retries cancellation, context, repair, application, or unknown failures", () => {
  const failures: unknown[] = [
    new APIUserAbortError(),
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
    apiError(400, {}, "context_length_exceeded"),
    apiError(400, {}, "max_context_length_exceeded"),
    new SyntaxError("invalid JSON"),
    Object.assign(new Error("schema repair"), { name: "SchemaRepairError" }),
    Object.assign(new Error("empty output"), { name: "EmptyOutputError" }),
    Object.assign(new Error("application"), { name: "ApplicationError" }),
    Object.assign(new Error("index"), { name: "IndexError" }),
    Object.assign(new Error("embedding"), { name: "EmbeddingError" }),
    new Error("ECONNRESET appears only in message"),
    "unknown",
  ];
  for (const error of failures) assert.equal(classifyNativeRetry(error).retryable, false);
});

test("semantic and application failures remain non-retryable inside real connection errors", () => {
  for (const name of [
    "SchemaRepairError",
    "EmptyOutputError",
    "ApplicationError",
    "IndexError",
    "EmbeddingError",
  ]) {
    const semantic = Object.assign(new Error(name), { name });
    const wrapped = new APIConnectionError({
      message: "connection failed",
      cause: new Error("middle", { cause: semantic }),
    });
    assert.equal(classifyNativeRetry(wrapped).retryable, false, name);
  }
});

test("semantic failures remain non-retryable inside a real timeout error", () => {
  const semantic = Object.assign(new Error("schema repair"), {
    name: "SchemaRepairError",
    code: "SCHEMA_REPAIR",
  });
  const timeout = new APIConnectionTimeoutError({ message: "connection timed out" });
  Object.assign(timeout, { cause: semantic });
  assert.equal(classifyNativeRetry(timeout).retryable, false);
});

const fixedClock = { now: () => Date.parse("2026-07-21T12:00:00.000Z"), random: () => 1 };

test("retry-after-ms takes precedence and is capped at eight seconds", () => {
  assert.deepEqual(retryDelay(new Headers({ "retry-after-ms": "1250", "retry-after": "7" }), 1, fixedClock), {
    delayMs: 1250,
    source: "retry-after-ms",
  });
  assert.equal(retryDelay(new Headers({ "retry-after-ms": "9000" }), 1, fixedClock).delayMs, 8000);
});

test("supports numeric and HTTP-date Retry-After without sleeping", () => {
  assert.deepEqual(retryDelay(new Headers({ "retry-after": "2.5" }), 1, fixedClock), {
    delayMs: 2500,
    source: "retry-after",
  });
  assert.deepEqual(retryDelay(new Headers({ "retry-after": "Tue, 21 Jul 2026 12:00:03 GMT" }), 1, fixedClock), {
    delayMs: 3000,
    source: "retry-after",
  });
});

test("uses exponential jittered backoff with an eight-second cap", () => {
  assert.deepEqual(retryDelay(undefined, 1, fixedClock), { delayMs: 500, source: "backoff" });
  assert.deepEqual(retryDelay(undefined, 3, fixedClock), { delayMs: 2000, source: "backoff" });
  assert.deepEqual(retryDelay(undefined, 3, { ...fixedClock, random: () => 0 }), {
    delayMs: 1500,
    source: "backoff",
  });
  assert.deepEqual(retryDelay(undefined, 20, fixedClock), { delayMs: 8000, source: "backoff" });
});

test("transport retry RunEvents contain metadata-only fields", () => {
  const common = {
    logicalRequestId: "logical-1",
    lifecycleId: "lifecycle-1",
    callSite: "ingest.synthesize",
    attempt: 1,
    maxRetries: 2,
    meaningfulOutputSeen: false,
    connectionTimeoutMs: 15_000,
    idleTimeoutMs: 60_000,
  };
  const scheduled: Extract<RunEvent, { kind: "transport_retry_scheduled" }> = {
    kind: "transport_retry_scheduled", ...common, errorClass: "http", status: 503,
    delayMs: 500, delaySource: "backoff", providerRequestId: "req_1",
  };
  const recovered: Extract<RunEvent, { kind: "transport_retry_recovered" }> = {
    kind: "transport_retry_recovered", ...common,
  };
  const exhausted: Extract<RunEvent, { kind: "transport_retry_exhausted" }> = {
    kind: "transport_retry_exhausted", ...common, errorClass: "connection",
  };
  const events = [scheduled, recovered, exhausted] satisfies RunEvent[];
  const forbidden = ["prompt", "body", "authorization", "apiKey", "source"];
  for (const event of events) {
    assert.equal(forbidden.some((field) => field in event), false);
  }
});
