import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire, register } from "node:module";
import { createServer as createNetServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as nodeSetTimeout } from "node:timers";
import test from "node:test";
import OpenAI from "openai";
import ts from "typescript";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";

import { createNativeOpenAiClient } from "../src/native-openai-client";
import {
  createNativeLlmClient,
  createNativeRequestLifecycle,
  createNativeRequestRetryContext,
} from "../src/native-llm-executor";
import type { RunEvent } from "../src/types";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

(globalThis as typeof globalThis & { require: NodeJS.Require }).require =
  createRequire(import.meta.url);

const transport = await import("../src/native-openai-transport");
const nativeClientModule = await import("../src/native-openai-client") as unknown as Record<string, unknown>;
const typesModule = await import("../src/types") as unknown as Record<string, unknown>;
const { buildChatParams } = await import("../src/phases/llm-utils");

type NativeTraceEvent = {
  kind: "native_transport_trace";
  stage: string;
  logicalRequestId: string;
  lifecycleId: string;
  callSite: string;
  transport: "stream" | "non-stream";
  attempt: number;
  networkTransport: string;
  endpointPath: string;
  diagnosticMode: string;
  elapsedMs: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  status?: number;
  contentType?: string;
  contentLength?: number;
  bodyBytes?: number;
  bodyChunks?: number;
  errorClass?: string;
  clientRequestId?: string;
  traceparent?: string;
};

type NativeCorrelationEvent = {
  kind: "native_transport_correlation";
  logicalRequestId: string;
  lifecycleId: string;
  callSite: string;
  transport: "stream" | "non-stream";
  attempt: number;
  networkTransport: string;
  endpointPath: string;
  diagnosticMode: string;
  clientRequestId: string;
  traceparent: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
};

function nativeTraceEvents(events: RunEvent[]): NativeTraceEvent[] {
  return events.filter((event) => event.kind === "native_transport_trace") as unknown as NativeTraceEvent[];
}

function chatCompletionJson(content: string, model: string): string {
  return JSON.stringify({
    id: `chatcmpl-${content.length}`,
    object: "chat.completion",
    created: 0,
    model,
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content },
    }],
  });
}

function localImportGraph(entry: string): string[] {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const candidate = resolve(dirname(file), `${specifier}.ts`);
      if (existsSync(candidate)) visit(candidate);
    }
  };
  visit(entry);
  return [...visited];
}

test("production native factory owns Node-safe transport construction", () => {
  const factoryPath = resolve(new URL("../src/native-openai-client.ts", import.meta.url).pathname);
  const factorySource = readFileSync(factoryPath, "utf8");
  const controllerSource = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");

  assert.match(factorySource, /createNativeOpenAiFetch/);
  assert.match(factorySource, /proxyConfig:\s*ProxyConfig/);
  assert.match(factorySource, /mobileFetch:\s*typeof fetch/);
  assert.match(factorySource, /isMobile:\s*boolean/);
  assert.doesNotMatch(
    controllerSource,
    /\b(?:createProxyFetch|createDirectDesktopFetch|selectNativeFetch)\b/,
  );

  const obsidianImports = localImportGraph(factoryPath).flatMap((file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    return source.statements.flatMap((statement) => (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === "obsidian"
        ? [`${file}:${source.getLineAndCharacterOfPosition(statement.getStart()).line + 1}`]
        : []
    ));
  });
  assert.deepEqual(obsidianImports, []);
});

test("production native factory runs idle timing and retry delay without window", async () => {
  let attempts = 0;
  const events: RunEvent[] = [];
  const runtime = globalThis as typeof globalThis & { window?: typeof globalThis };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  await withServer(async (response) => {
    attempts += 1;
    response.writeHead(attempts === 1 ? 502 : 200, {
      "content-type": "application/json",
      ...(attempts === 1 ? { "retry-after-ms": "1" } : {}),
    });
    response.end(JSON.stringify(attempts === 1
      ? { error: { message: "temporary", type: "server_error" } }
      : {
          id: "chatcmpl-clean-node",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          }],
        }));
  }, async (url) => {
    delete runtime.window;
    try {
      const signal = new AbortController().signal;
      const client = createNativeOpenAiClient({
        baseURL: new URL(url).origin,
        apiKey: "test-key",
        connectionTimeoutMs: 1_000,
        idleTimeoutMs: 1_000,
        isMobile: false,
        proxyConfig: { enabled: false, url: "" },
        mobileFetch: fetch,
      });
      const lifecycle = createNativeRequestLifecycle({
        initial: { id: "clean-node", action: "synthesize_wiki_pages" },
        callSite: "ingest.synthesize",
        onEvent: (event) => events.push(event),
      });
      const response = await client.chat.completions.create(
        {
          model: "test-model",
          messages: [{ role: "user", content: "test" }],
          stream: false,
        },
        {
          signal,
          retry: createNativeRequestRetryContext({
            llm: client,
            callSite: "ingest.synthesize",
            opts: {
              nativeRequestRetries: 1,
              nativeRequestIdleTimeoutMs: 500,
            },
            signal,
            onEvent: (event) => events.push(event),
            lifecycle,
          }),
        },
      );

      assert.equal(response.choices[0]?.message.content, "ok");
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else delete runtime.window;
    }
  });

  assert.equal(attempts, 2);
  assert.equal(events.some((event) => event.kind === "transport_retry_scheduled"), true);
  assert.equal(events.some((event) => event.kind === "transport_retry_recovered"), true);
  assert.equal(
    events
      .filter((event) => event.kind.startsWith("transport_retry_"))
      .every((event) => "connectionTimeoutMs" in event && event.connectionTimeoutMs === 1_000),
    true,
  );
});

test("native request emits sanitized HTTP response diagnostics in Obsidian runtime", async () => {
  const events: RunEvent[] = [];
  let observedAuthorization = "";

  await withServer(async (response, _requestPath, request) => {
    observedAuthorization = request.headers.authorization ?? "";
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "provider-request-123",
    });
    response.end(JSON.stringify({
      id: "chatcmpl-transport-diag",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: "ok" },
      }],
    }));
  }, async (url) => {
    const signal = new AbortController().signal;
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-test-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "http-diag", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });

    await client.chat.completions.create(
      {
        model: "test-model",
        messages: [{ role: "user", content: "test" }],
        stream: false,
      },
      {
        signal,
        retry: createNativeRequestRetryContext({
          llm: client,
          callSite: "ingest.synthesize",
          opts: {
            nativeRequestRetries: 0,
            nativeRequestIdleTimeoutMs: 500,
          },
          signal,
          onEvent: (event) => events.push(event),
          lifecycle,
        }),
      },
    );
  });

  assert.equal(observedAuthorization, "Bearer secret-test-key");
  const diagnostic = events.find((event) => event.kind === "native_http_response");
  assert.ok(diagnostic && diagnostic.kind === "native_http_response");
  assert.equal(diagnostic.logicalRequestId, "http-diag");
  assert.equal(diagnostic.lifecycleId, "http-diag");
  assert.equal(diagnostic.callSite, "ingest.synthesize");
  assert.equal(diagnostic.transport, "non-stream");
  assert.equal(diagnostic.attempt, 0);
  assert.equal(diagnostic.status, 200);
  assert.equal(diagnostic.providerRequestId, "provider-request-123");
  assert.match(diagnostic.endpointPath, /\/chat\/completions$/);
  assert.equal(JSON.stringify(diagnostic).includes("secret-test-key"), false);
  assert.equal(JSON.stringify(diagnostic).includes("test-model"), false);
  assert.equal(JSON.stringify(diagnostic).includes("content"), false);
});

test("native request emits exact-attempt correlation before response body consumption", async () => {
  const events: RunEvent[] = [];
  let observedClientAttemptId = "";
  let observedLegacyClientRequestId = "";
  let observedTraceparent = "";

  await withServer(async (response, _requestPath, request) => {
    observedClientAttemptId = String(request.headers["x-client-attempt-id"] ?? "");
    observedLegacyClientRequestId = String(request.headers["x-ai-wiki-client-request-id"] ?? "");
    observedTraceparent = String(request.headers.traceparent ?? "");
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "provider-correlation-123",
    });
    response.end(chatCompletionJson("ok", "test-model"));
  }, async (url) => {
    const signal = new AbortController().signal;
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-test-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "correlation", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });

    await client.chat.completions.create(
      {
        model: "test-model",
        messages: [{ role: "user", content: "test" }],
        stream: false,
      },
      {
        signal,
        retry: createNativeRequestRetryContext({
          llm: client,
          callSite: "ingest.synthesize",
          opts: {
            nativeRequestRetries: 0,
            nativeRequestIdleTimeoutMs: 500,
          },
          signal,
          onEvent: (event) => events.push(event),
          lifecycle,
        }),
      },
    );
  });

  const correlation = events.find(
    (event) => event.kind === "native_transport_correlation",
  ) as unknown as NativeCorrelationEvent | undefined;
  assert.ok(correlation);
  assert.equal(correlation.logicalRequestId, "correlation");
  assert.equal(correlation.lifecycleId, "correlation");
  assert.equal(correlation.callSite, "ingest.synthesize");
  assert.equal(correlation.transport, "non-stream");
  assert.equal(correlation.attempt, 0);
  assert.equal(correlation.networkTransport, "desktop-direct");
  assert.match(correlation.endpointPath, /\/chat\/completions$/);
  assert.equal(correlation.diagnosticMode, "off");
  assert.match(correlation.clientRequestId, /^[A-Za-z0-9_.:-]{1,128}$/);
  assert.equal(observedClientAttemptId, correlation.clientRequestId);
  assert.equal(observedLegacyClientRequestId, "");
  assert.match(correlation.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  assert.equal(observedTraceparent, correlation.traceparent);
  assert.equal(correlation.connectionTimeoutMs, 1_000);
  assert.equal(correlation.idleTimeoutMs, 500);
  const httpResponse = events.find((event) => event.kind === "native_http_response");
  assert.ok(httpResponse && httpResponse.kind === "native_http_response");
  assert.equal(httpResponse.clientRequestId, correlation.clientRequestId);
  const trace = nativeTraceEvents(events);
  assert.equal(trace.length > 0, true);
  assert.equal(trace.every((event) => event.clientRequestId === correlation.clientRequestId), true);
  assert.equal(trace.every((event) => event.traceparent === correlation.traceparent), true);
  assert.equal(JSON.stringify(correlation).includes("secret-test-key"), false);
  assert.equal(JSON.stringify(correlation).includes("test-model"), false);
  assert.equal(JSON.stringify(correlation).includes("content"), false);
});

test("native diagnostics bound hostile provider IDs and endpoint paths", async () => {
  const events: RunEvent[] = [];
  const hostileProviderRequestId = `<script>${"x".repeat(512)}`;

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": hostileProviderRequestId,
    });
    response.end(chatCompletionJson("ok", "test-model"));
  }, async (url) => {
    const signal = new AbortController().signal;
    const longBasePath = `/${"diagnostic-segment/".repeat(32)}`;
    const client = createNativeOpenAiClient({
      baseURL: `${new URL(url).origin}${longBasePath}`,
      apiKey: "secret-test-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "bounded-http-diag", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });

    assert.ok(client.nativeTransportDiagnostic?.endpointPath);
    assert.ok(client.nativeTransportDiagnostic.endpointPath.length <= 256);

    await client.chat.completions.create({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      stream: false,
    }, {
      signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 500 },
        signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });
  });

  const diagnostic = events.find((event) => event.kind === "native_http_response");
  assert.ok(diagnostic && diagnostic.kind === "native_http_response");
  assert.match(diagnostic.providerRequestId ?? "", /^[A-Za-z0-9_.:-]{1,128}$/);
  assert.ok((diagnostic.endpointPath?.length ?? Number.POSITIVE_INFINITY) <= 256);
});

test("non-stream trace records delayed body boundaries, cumulative bytes, and safe metadata", async () => {
  const events: RunEvent[] = [];
  const secretModel = "secret-model-transport-trace";
  const secretPrompt = "secret prompt transport trace";
  const secretResponse = "secret response transport trace";
  const secretApiKey = "secret-api-key-transport-trace";
  const payload = chatCompletionJson(secretResponse, secretModel);
  const payloadBytes = Buffer.byteLength(payload);

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(payloadBytes),
      "x-secret-header": "must-not-be-logged",
    });
    const split = Math.floor(payload.length / 2);
    response.write(payload.slice(0, split));
    await new Promise<void>((resolve) => nodeSetTimeout(resolve, 20));
    response.end(payload.slice(split));
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: secretApiKey,
      connectionTimeoutMs: 1_234,
      idleTimeoutMs: 5_678,
      nativeTransportDiagnosticMode: "off",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-success", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });

    await client.chat.completions.create({
      model: secretModel,
      messages: [{ role: "user", content: secretPrompt }],
      stream: false,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 5_678 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });

    const trace = nativeTraceEvents(events);
    const stages = trace.map((event) => event.stage);
    assert.deepEqual(stages.slice(0, 3), ["fetch_start", "fetch_headers", "body_start"]);
    assert.equal(stages.at(-2), "body_end");
    assert.equal(stages.at(-1), "sdk_complete");
    assert.ok(stages.filter((stage) => stage === "body_chunk").length >= 2);

    const headers = trace.find((event) => event.stage === "fetch_headers");
    const bodyEnd = trace.find((event) => event.stage === "body_end");
    assert.equal(headers?.status, 200);
    assert.equal(headers?.contentType, "application/json; charset=utf-8");
    assert.equal(headers?.contentLength, payloadBytes);
    assert.equal(bodyEnd?.bodyBytes, payloadBytes);
    assert.ok((bodyEnd?.bodyChunks ?? 0) >= 2);
    assert.equal(trace.every((event) => event.logicalRequestId === "trace-success"), true);
    assert.equal(trace.every((event) => event.lifecycleId === "trace-success"), true);
    assert.equal(trace.every((event) => event.callSite === "ingest.synthesize"), true);
    assert.equal(trace.every((event) => event.transport === "non-stream"), true);
    assert.equal(trace.every((event) => event.attempt === 0), true);
    assert.equal(trace.every((event) => event.networkTransport === "desktop-direct"), true);
    assert.equal(trace.every((event) => event.endpointPath === "/chat/completions"), true);
    assert.equal(trace.every((event) => event.diagnosticMode === "off"), true);
    assert.equal(trace.every((event) => event.connectionTimeoutMs === 1_234), true);
    assert.equal(trace.every((event) => event.idleTimeoutMs === 5_678), true);
    assert.equal(trace.every((event) => Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0), true);

    const safeKeys = new Set([
      "kind", "stage", "logicalRequestId", "lifecycleId", "callSite", "transport",
      "attempt", "networkTransport", "endpointPath", "diagnosticMode", "elapsedMs",
      "connectionTimeoutMs", "idleTimeoutMs", "status", "contentType", "contentLength",
      "bodyBytes", "bodyChunks", "errorClass", "clientRequestId", "traceparent",
    ]);
    for (const event of trace) {
      for (const key of Object.keys(event)) assert.equal(safeKeys.has(key), true, `unsafe trace key: ${key}`);
    }
    const serialized = JSON.stringify(trace);
    for (const secret of [
      new URL(url).host,
      secretApiKey,
      secretModel,
      secretPrompt,
      secretResponse,
      "must-not-be-logged",
      "authorization",
      "messages",
    ]) {
      assert.equal(serialized.includes(secret), false, `trace leaked: ${secret}`);
    }
  });
});

test("connection-close finalizes a known-empty JSON response without an SDK body read", async () => {
  const events: RunEvent[] = [];
  let socketClosed!: () => void;
  const socketClosedPromise = new Promise<void>((resolve) => { socketClosed = resolve; });

  await withServer(async (response, _requestPath, request) => {
    request.socket.once("close", socketClosed);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "0",
    });
    response.end();
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "empty-json-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-empty-json", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });
    const outcome = await client.chat.completions.create({
      model: "empty-json-model",
      messages: [{ role: "user", content: "empty-json-prompt" }],
      stream: false,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 1_000 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    }).then(
      (value: unknown) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    const socketDidClose = await Promise.race([
      socketClosedPromise.then(() => true),
      new Promise<false>((resolve) => nodeSetTimeout(() => resolve(false), 250)),
    ]);
    const trace = nativeTraceEvents(events);
    const bodyEvents = trace.filter((event) => event.stage === "body_start" || event.stage === "body_end");

    assert.deepEqual({
      stages: trace.map((event) => event.stage),
      socketDidClose,
    }, {
      stages: ["fetch_start", "fetch_headers", "body_start", "body_end", "sdk_complete"],
      socketDidClose: true,
    });
    assert.deepEqual(bodyEvents.map((event) => [event.bodyBytes, event.bodyChunks]), [[0, 0], [0, 0]]);
    assert.equal(outcome.error === undefined || outcome.error instanceof TypeError, true);
    assert.equal(outcome.error === undefined ? outcome.value === undefined : true, true);
  });
});

test("undici-request-adapter uses undici.request and preserves SDK response plus metadata traces", async () => {
  const undici = createRequire(import.meta.url)("undici") as typeof import("undici") & {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const originalRequest = undici.request;
  const calls: Array<{
    input: unknown;
    options: Record<string, unknown>;
    body: string;
  }> = [];
  const events: RunEvent[] = [];

  undici.request = (async (input: unknown, options: Record<string, unknown>) => {
    const body = String(options.body ?? "");
    calls.push({ input, options, body });
    return {
      statusCode: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(chatCompletionJson("adapter-ok", "adapter-model"))),
        "x-request-id": "provider-adapter-123",
      },
      body: Readable.from([chatCompletionJson("adapter-ok", "adapter-model")]),
    };
  }) as typeof undici.request;

  try {
    await withServer(async (response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fetch path must not be used" } }));
    }, async (url) => {
      const client = createNativeOpenAiClient({
        baseURL: new URL(url).origin,
        apiKey: "adapter-key",
        connectionTimeoutMs: 1_234,
        idleTimeoutMs: 2_345,
        nativeTransportDiagnosticMode: "undici-request-adapter",
        isMobile: false,
        proxyConfig: { enabled: false, url: "" },
        mobileFetch: fetch,
      });
      const lifecycle = createNativeRequestLifecycle({
        initial: { id: "trace-undici-adapter", action: "synthesize_wiki_pages" },
        callSite: "ingest.synthesize",
        onEvent: (event) => events.push(event),
      });
      const response = await client.chat.completions.create({
        model: "adapter-model",
        messages: [{ role: "user", content: "adapter prompt" }],
        stream: false,
      }, {
        signal: new AbortController().signal,
        retry: createNativeRequestRetryContext({
          llm: client,
          callSite: "ingest.synthesize",
          opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 2_345 },
          signal: new AbortController().signal,
          onEvent: (event) => events.push(event),
          lifecycle,
        }),
      });

      assert.equal(response.choices[0]?.message.content, "adapter-ok");
    });
  } finally {
    undici.request = originalRequest;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.input), /\/chat\/completions$/);
  assert.equal(calls[0]!.options.method, "POST");
  assert.equal(typeof (calls[0]!.options.dispatcher as { close?: unknown }).close, "function");
  const requestHeaders = new Headers(calls[0]!.options.headers as HeadersInit);
  assert.equal(requestHeaders.get("authorization"), "Bearer adapter-key");
  assert.match(requestHeaders.get("x-client-attempt-id") ?? "", /^[A-Za-z0-9_.:-]{1,128}$/);
  assert.match(requestHeaders.get("traceparent") ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  assert.equal(requestHeaders.has("x-ai-wiki-client-request-id"), false);
  assert.equal((JSON.parse(calls[0]!.body) as { model: string; stream?: boolean }).model, "adapter-model");
  const trace = nativeTraceEvents(events);
  assert.deepEqual(trace.map((event) => event.stage), [
    "fetch_start", "fetch_headers", "body_start", "body_chunk", "body_end", "sdk_complete",
  ]);
  assert.equal(trace.every((event) => event.diagnosticMode === "undici-request-adapter"), true);
  assert.equal(trace.every((event) => event.networkTransport === "desktop-direct"), true);
});

test("undici-request-adapter closes its per-request dispatcher after body end", async () => {
  let socketClosed!: () => void;
  const socketClosedPromise = new Promise<void>((resolve) => { socketClosed = resolve; });

  await withServer(async (response, _requestPath, request) => {
    request.socket.once("close", socketClosed);
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": "2",
    });
    response.end("ok");
  }, async (url) => {
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "undici-request-adapter",
    });
    const response = await nativeFetch(url, { signal: new AbortController().signal });
    assert.equal(await response.text(), "ok");
    const socketDidClose = await Promise.race([
      socketClosedPromise.then(() => true),
      new Promise<false>((resolve) => nodeSetTimeout(() => resolve(false), 250)),
    ]);
    assert.equal(socketDidClose, true);
  });
});

test("undici-request-adapter preserves SSE stream consumption and trace semantics", async () => {
  const undici = createRequire(import.meta.url)("undici") as typeof import("undici") & {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const originalRequest = undici.request;
  const calls: Array<{ body: string; headers: Headers }> = [];
  const events: RunEvent[] = [];
  const sse = (content: string) => `data: ${JSON.stringify({
    id: `chatcmpl-stream-${content}`,
    object: "chat.completion.chunk",
    created: 0,
    model: "adapter-stream-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;

  undici.request = (async (_input: unknown, options: Record<string, unknown>) => {
    calls.push({
      body: String(options.body ?? ""),
      headers: new Headers(options.headers as HeadersInit),
    });
    return {
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/event-stream" },
      body: Readable.from([sse("hel"), sse("lo"), "data: [DONE]\n\n"]),
    };
  }) as typeof undici.request;

  try {
    const client = createNativeOpenAiClient({
      baseURL: "https://adapter-stream.invalid/v1",
      apiKey: "adapter-stream-key",
      connectionTimeoutMs: 1_234,
      idleTimeoutMs: 2_345,
      nativeTransportDiagnosticMode: "undici-request-adapter",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const caller = new AbortController();
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-undici-adapter-stream", action: "answer_question" },
      callSite: "query.answer",
      onEvent: (event) => events.push(event),
    });
    const stream = await client.chat.completions.create({
      model: "adapter-stream-model",
      messages: [{ role: "user", content: "adapter stream prompt" }],
      stream: true,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "query.answer",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 2_345 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });
    const contents: string[] = [];
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta.content;
      if (content) contents.push(content);
    }

    assert.deepEqual(contents, ["hel", "lo"]);
  } finally {
    undici.request = originalRequest;
  }

  assert.equal(calls.length, 1);
  assert.equal((JSON.parse(calls[0]!.body) as { stream?: boolean }).stream, true);
  assert.match(calls[0]!.headers.get("x-client-attempt-id") ?? "", /^[A-Za-z0-9_.:-]{1,128}$/);
  assert.match(calls[0]!.headers.get("traceparent") ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  const trace = nativeTraceEvents(events);
  assert.deepEqual(trace.map((event) => event.stage), [
    "fetch_start", "fetch_headers", "body_start", "body_chunk", "body_chunk", "body_chunk", "body_end", "sdk_complete",
  ]);
  assert.equal(trace.every((event) => event.diagnosticMode === "undici-request-adapter"), true);
  assert.equal(trace.every((event) => event.networkTransport === "desktop-direct"), true);
  assert.equal(trace.at(-1)?.stage, "sdk_complete");
});

test("undici-request-adapter closes its dispatcher after body_error", async () => {
  const undici = createRequire(import.meta.url)("undici") as typeof import("undici") & {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const originalRequest = undici.request;
  const stages: string[] = [];
  let closeCalls = 0;

  undici.request = (async (_input: unknown, options: Record<string, unknown>) => {
    const dispatcher = options.dispatcher as { close: () => Promise<void> };
    dispatcher.close = async () => {
      closeCalls += 1;
    };
    return {
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      body: (async function* () {
        yield Buffer.from("partial");
        throw new Error("adapter body failure");
      })(),
    };
  }) as typeof undici.request;

  try {
    const exactAttempt = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: "https://adapter-body-error.invalid/v1",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "undici-request-adapter",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => stages.push(event.stage),
    });
    const response = await nativeFetch("https://adapter-body-error.invalid/v1/chat/completions", {
      [exactSignalKey]: exactAttempt.signal,
    } as RequestInit);

    await assert.rejects(response.text(), /adapter body failure/);
  } finally {
    undici.request = originalRequest;
  }

  assert.equal(closeCalls, 1);
  assert.deepEqual(stages, ["fetch_start", "fetch_headers", "body_start", "body_chunk", "body_error"]);
});

test("undici-request-adapter closes its dispatcher after body cancel", async () => {
  const undici = createRequire(import.meta.url)("undici") as typeof import("undici") & {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const originalRequest = undici.request;
  let closeCalls = 0;
  let bodyReturnCalls = 0;
  const body = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false, value: Buffer.from("pending") };
        },
        async return() {
          bodyReturnCalls += 1;
          return { done: true, value: undefined };
        },
      };
    },
  };

  undici.request = (async (_input: unknown, options: Record<string, unknown>) => {
    const dispatcher = options.dispatcher as { close: () => Promise<void> };
    dispatcher.close = async () => {
      closeCalls += 1;
    };
    return {
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      body,
    };
  }) as typeof undici.request;

  try {
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: "https://adapter-cancel.invalid/v1",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "undici-request-adapter",
    });
    const response = await nativeFetch("https://adapter-cancel.invalid/v1/chat/completions");
    await response.body?.cancel("test cancel");
  } finally {
    undici.request = originalRequest;
  }

  assert.equal(closeCalls, 1);
  assert.equal(bodyReturnCalls, 1);
});

test("undici-request-adapter closes its dispatcher after request failure", async () => {
  const undici = createRequire(import.meta.url)("undici") as typeof import("undici") & {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const originalRequest = undici.request;
  const stages: string[] = [];
  let closeCalls = 0;

  undici.request = (async (_input: unknown, options: Record<string, unknown>) => {
    const dispatcher = options.dispatcher as { close: () => Promise<void> };
    dispatcher.close = async () => {
      closeCalls += 1;
    };
    throw new Error("adapter fetch failure");
  }) as typeof undici.request;

  try {
    const exactAttempt = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: "https://adapter-fetch-failure.invalid/v1",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "undici-request-adapter",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => stages.push(event.stage),
    });

    await assert.rejects(
      nativeFetch("https://adapter-fetch-failure.invalid/v1/chat/completions", {
        [exactSignalKey]: exactAttempt.signal,
      } as RequestInit),
      /adapter fetch failure/,
    );
  } finally {
    undici.request = originalRequest;
  }

  assert.equal(closeCalls, 1);
  assert.deepEqual(stages, ["fetch_start", "fetch_error"]);
});

test("undici-request-adapter is ignored for mobile and proxy transports", () => {
  const diagnostics: unknown[] = [];
  const mobileFetch = async () => new Response("mobile");

  transport.createNativeOpenAiFetch!({
    baseURL: "https://example.invalid/v1",
    isMobile: true,
    proxyConfig: { enabled: false, url: "" },
    mobileFetch,
    connectionTimeoutMs: 1_000,
    nativeTransportDiagnosticMode: "undici-request-adapter",
    onTransportDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
  });
  transport.createNativeOpenAiFetch!({
    baseURL: "https://example.invalid/v1",
    isMobile: false,
    proxyConfig: { enabled: true, url: "http://127.0.0.1:9" },
    mobileFetch,
    connectionTimeoutMs: 1_000,
    nativeTransportDiagnosticMode: "undici-request-adapter",
    onTransportDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
  });

  assert.deepEqual(diagnostics.map((diagnostic) => (diagnostic as { diagnosticMode: string }).diagnosticMode), [
    "off", "off",
  ]);
  assert.deepEqual(diagnostics.map((diagnostic) => (diagnostic as { transport: string }).transport), [
    "mobile-host", "desktop-proxy",
  ]);
});

test("delayed SSE trace keeps elapsedMs monotonic through sdk_complete", async () => {
  const events: RunEvent[] = [];
  const sseChunk = JSON.stringify({
    id: "chatcmpl-delayed-sse",
    object: "chat.completion.chunk",
    created: 0,
    model: "delayed-sse-model",
    choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
  });

  await withServer(async (response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${sseChunk}\n\n`);
    await new Promise<void>((resolve) => nodeSetTimeout(resolve, 30));
    response.end("data: [DONE]\n\n");
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "delayed-sse-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-delayed-sse", action: "answer_question" },
      callSite: "query.answer",
      onEvent: (event) => events.push(event),
    });
    const stream = await client.chat.completions.create({
      model: "delayed-sse-model",
      messages: [{ role: "user", content: "delayed-sse-prompt" }],
      stream: true,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "query.answer",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 1_000 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });
    const contents: string[] = [];
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta.content;
      if (content) contents.push(content);
    }

    const trace = nativeTraceEvents(events);
    const bodyEnd = trace.find((event) => event.stage === "body_end");
    const sdkComplete = trace.find((event) => event.stage === "sdk_complete");
    assert.deepEqual(contents, ["ok"]);
    assert.ok(bodyEnd);
    assert.ok(sdkComplete);
    for (let index = 1; index < trace.length; index++) {
      assert.ok(
        trace[index]!.elapsedMs >= trace[index - 1]!.elapsedMs,
        `${trace[index]!.stage} elapsedMs regressed after ${trace[index - 1]!.stage}`,
      );
    }
    assert.ok(sdkComplete.elapsedMs >= bodyEnd.elapsedMs);
    assert.equal(trace.at(-1)?.stage, "sdk_complete");
  });
});

test("non-stream trace terminates with bounded body_error when the response socket fails", async () => {
  const events: RunEvent[] = [];

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "4096",
    });
    response.write('{"secret-response-fragment":"must-not-be-logged"');
    await new Promise<void>((resolve) => nodeSetTimeout(resolve, 20));
    response.socket?.destroy();
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-body-error-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "off",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-body-error", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });

    await assert.rejects(client.chat.completions.create({
      model: "secret-body-error-model",
      messages: [{ role: "user", content: "secret-body-error-prompt" }],
      stream: false,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 1_000 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    }));

    const trace = nativeTraceEvents(events);
    assert.deepEqual(trace.slice(0, 3).map((event) => event.stage), [
      "fetch_start", "fetch_headers", "body_start",
    ]);
    const terminal = trace.at(-1);
    assert.equal(terminal?.stage, "body_error");
    assert.match(terminal?.errorClass ?? "", /^[A-Za-z0-9_.:-]{1,64}$/);
    assert.equal(Object.hasOwn(terminal ?? {}, "errorName"), false);
    assert.equal(JSON.stringify(trace).includes("must-not-be-logged"), false);
    assert.equal(trace.some((event) => event.stage === "sdk_complete"), false);
  });
});

test("non-stream trace records body abort without leaking the abort reason", async () => {
  const events: RunEvent[] = [];
  let bodyStarted!: () => void;
  const bodyStartedPromise = new Promise<void>((resolve) => { bodyStarted = resolve; });

  await withServer(async (response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"partial":"secret-abort-body"');
    bodyStarted();
    await new Promise<void>((resolve) => response.once("close", resolve));
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-abort-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 5_000,
      nativeTransportDiagnosticMode: "off",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-body-abort", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });
    const operation = client.chat.completions.create({
      model: "secret-abort-model",
      messages: [{ role: "user", content: "secret-abort-prompt" }],
      stream: false,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 5_000 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });

    await bodyStartedPromise;
    await new Promise<void>((resolve) => nodeSetTimeout(resolve, 20));
    caller.abort(new DOMException("secret abort reason", "AbortError"));
    await assert.rejects(operation, (error: unknown) => error instanceof Error && error.name === "AbortError");

    const trace = nativeTraceEvents(events);
    const terminal = trace.at(-1);
    assert.equal(terminal?.stage, "body_error");
    assert.match(terminal?.errorClass ?? "", /^[A-Za-z0-9_.:-]{1,64}$/);
    assert.equal(Object.hasOwn(terminal ?? {}, "errorName"), false);
    assert.equal(JSON.stringify(trace).includes("secret abort reason"), false);
    assert.equal(JSON.stringify(trace).includes("secret-abort-body"), false);
  });
});

test("non-stream trace records fetch_abort when cancellation happens before headers", async () => {
  const events: RunEvent[] = [];
  let requestStarted!: () => void;
  const requestStartedPromise = new Promise<void>((resolve) => { requestStarted = resolve; });

  await withServer(async (_response, _requestPath, request) => {
    requestStarted();
    await new Promise<void>((resolve) => request.once("close", resolve));
  }, async (url) => {
    const caller = new AbortController();
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-fetch-abort-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 5_000,
      nativeTransportDiagnosticMode: "off",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const lifecycle = createNativeRequestLifecycle({
      initial: { id: "trace-fetch-abort", action: "synthesize_wiki_pages" },
      callSite: "ingest.synthesize",
      onEvent: (event) => events.push(event),
    });
    const operation = client.chat.completions.create({
      model: "secret-fetch-abort-model",
      messages: [{ role: "user", content: "secret-fetch-abort-prompt" }],
      stream: false,
    }, {
      signal: caller.signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 5_000 },
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle,
      }),
    });

    await requestStartedPromise;
    caller.abort(new DOMException("secret fetch abort reason", "AbortError"));
    await assert.rejects(operation, (error: unknown) => error instanceof Error && error.name === "AbortError");

    const trace = nativeTraceEvents(events);
    assert.deepEqual(trace.map((event) => event.stage), ["fetch_start", "fetch_abort"]);
    assert.match(trace.at(-1)?.errorClass ?? "", /^[A-Za-z0-9_.:-]{1,64}$/);
    assert.equal(Object.hasOwn(trace.at(-1) ?? {}, "errorName"), false);
    assert.equal(JSON.stringify(trace).includes("secret fetch abort reason"), false);
  });
});

test("immediate exact-signal abort is terminal and closes an isolated dispatcher", async () => {
  const stages: string[] = [];
  let socketClosed!: () => void;
  const socketClosedPromise = new Promise<void>((resolve) => { socketClosed = resolve; });

  await withServer(async (response, _requestPath, request) => {
    request.socket.once("close", socketClosed);
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": "2",
    });
    response.end("ok");
  }, async (url) => {
    const exactAttempt = new AbortController();
    const forwardedRequest = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => stages.push(event.stage),
    });
    const pending = nativeFetch(url, {
      signal: forwardedRequest.signal,
      [exactSignalKey]: exactAttempt.signal,
    } as RequestInit);

    exactAttempt.abort(new DOMException("secret immediate abort reason", "AbortError"));
    const outcome = await pending.then(
      (response) => ({ response, error: undefined }),
      (error: unknown) => ({ response: undefined, error }),
    );
    await outcome.response?.body?.cancel();
    const closed = await Promise.race([
      socketClosedPromise.then(() => true),
      new Promise<false>((resolve) => nodeSetTimeout(() => resolve(false), 250)),
    ]);

    assert.equal(closed, true);
    assert.deepEqual(stages, ["fetch_start", "fetch_abort"]);
    assert.equal(outcome.error instanceof Error && outcome.error.name === "AbortError", true);
    assert.equal(JSON.stringify(stages).includes("secret immediate abort reason"), false);
  });
});

test("post-header abort before first read leaves body_error terminal", async () => {
  const stages: string[] = [];
  let socketClosed!: () => void;
  const socketClosedPromise = new Promise<void>((resolve) => { socketClosed = resolve; });

  await withServer(async (response, _requestPath, request) => {
    request.socket.once("close", socketClosed);
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": "2",
    });
    response.end("ok");
  }, async (url) => {
    const exactAttempt = new AbortController();
    const forwardedRequest = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => stages.push(event.stage),
    });
    const response = await nativeFetch(url, {
      signal: forwardedRequest.signal,
      [exactSignalKey]: exactAttempt.signal,
    } as RequestInit);

    assert.deepEqual(stages, ["fetch_start", "fetch_headers"]);
    exactAttempt.abort(new DOMException("post-header abort", "AbortError"));
    await assert.rejects(
      response.text(),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    const closed = await Promise.race([
      socketClosedPromise.then(() => true),
      new Promise<false>((resolve) => nodeSetTimeout(() => resolve(false), 250)),
    ]);

    assert.equal(closed, true);
    assert.deepEqual(stages, ["fetch_start", "fetch_headers", "body_error"]);
  });
});

test("cancel after body_error does not emit body_start", async () => {
  const stages: string[] = [];

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": "2",
    });
    response.end("ok");
  }, async (url) => {
    const exactAttempt = new AbortController();
    const forwardedRequest = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => stages.push(event.stage),
    });
    const response = await nativeFetch(url, {
      signal: forwardedRequest.signal,
      [exactSignalKey]: exactAttempt.signal,
    } as RequestInit);

    exactAttempt.abort(new DOMException("cancel-after-terminal", "AbortError"));
    await response.body?.cancel();
    assert.deepEqual(stages, ["fetch_start", "fetch_headers", "body_error"]);
  });
});

test("abort during first body read leaves body_error terminal and rejects", async () => {
  const stages: string[] = [];
  let bodyStarted!: () => void;
  const bodyStartedPromise = new Promise<void>((resolve) => { bodyStarted = resolve; });

  await withServer(async (response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.flushHeaders();
    await new Promise<void>((resolve) => response.once("close", resolve));
  }, async (url) => {
    const exactAttempt = new AbortController();
    const forwardedRequest = new AbortController();
    const exactSignalKey = typesModule.NATIVE_TRANSPORT_ATTEMPT_SIGNAL as symbol;
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "connection-close",
      onTraceEvent: (_signal: AbortSignal, event: { stage: string }) => {
        stages.push(event.stage);
        if (event.stage === "body_start") bodyStarted();
      },
    });
    const response = await nativeFetch(url, {
      signal: forwardedRequest.signal,
      [exactSignalKey]: exactAttempt.signal,
    } as RequestInit);
    const reading = response.text();

    await bodyStartedPromise;
    exactAttempt.abort(new DOMException("in-read abort", "AbortError"));
    await assert.rejects(
      reading,
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.deepEqual(stages, ["fetch_start", "fetch_headers", "body_start", "body_error"]);
  });
});

test("concurrent native attempts flush only the trace keyed by their exact signal", async () => {
  const slowEvents: RunEvent[] = [];
  const fastEvents: RunEvent[] = [];
  const expectedBytes = new Map<string, number>();

  await withServer(async (response, _requestPath, request) => {
    const requestBody = JSON.parse(await readRequestBody(request)) as { model: string };
    const content = requestBody.model === "slow-secret-model"
      ? "slow-secret-response-with-more-bytes"
      : "fast";
    const payload = chatCompletionJson(content, requestBody.model);
    expectedBytes.set(requestBody.model, Buffer.byteLength(payload));
    if (requestBody.model === "slow-secret-model") {
      await new Promise<void>((resolve) => nodeSetTimeout(resolve, 40));
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
    });
    response.end(payload);
  }, async (url) => {
    const client = createNativeOpenAiClient({
      baseURL: new URL(url).origin,
      apiKey: "secret-concurrent-key",
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: "off",
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
    });
    const invoke = (id: string, model: string, events: RunEvent[]) => {
      const caller = new AbortController();
      const lifecycle = createNativeRequestLifecycle({
        initial: { id, action: "synthesize_wiki_pages" },
        callSite: "ingest.synthesize",
        onEvent: (event) => events.push(event),
      });
      return client.chat.completions.create({
        model,
        messages: [{ role: "user", content: `secret prompt ${model}` }],
        stream: false,
      }, {
        signal: caller.signal,
        retry: createNativeRequestRetryContext({
          llm: client,
          callSite: "ingest.synthesize",
          opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 1_000 },
          signal: caller.signal,
          onEvent: (event) => events.push(event),
          lifecycle,
        }),
      });
    };

    await Promise.all([
      invoke("trace-slow", "slow-secret-model", slowEvents),
      invoke("trace-fast", "fast-secret-model", fastEvents),
    ]);

    const slowTrace = nativeTraceEvents(slowEvents);
    const fastTrace = nativeTraceEvents(fastEvents);
    assert.equal(slowTrace.every((event) => event.logicalRequestId === "trace-slow"), true);
    assert.equal(fastTrace.every((event) => event.logicalRequestId === "trace-fast"), true);
    assert.equal(
      slowTrace.find((event) => event.stage === "body_end")?.bodyBytes,
      expectedBytes.get("slow-secret-model"),
    );
    assert.equal(
      fastTrace.find((event) => event.stage === "body_end")?.bodyBytes,
      expectedBytes.get("fast-secret-model"),
    );
  });
});

test("native OpenAI client disables SDK request retries", () => {
  const source = readFileSync(new URL("../src/native-openai-client.ts", import.meta.url), "utf8");
  const constructorStart = source.indexOf("new OpenAI({");
  assert.ok(constructorStart >= 0, "OpenAI constructor must be present");

  const constructorOptions = source.slice(constructorStart, constructorStart + 700);
  assert.match(constructorOptions, /maxRetries:\s*0/);
});

test("native OpenAI client keeps SDK timeout above executor idle and disables SDK retries", () => {
  const controllerSource = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");
  const factorySource = readFileSync(new URL("../src/native-openai-client.ts", import.meta.url), "utf8");
  const transportSource = readFileSync(new URL("../src/native-openai-transport.ts", import.meta.url), "utf8");
  const sdkTimeout = nativeClientModule.sdkTimeoutForIdleMs;

  assert.equal(typeof sdkTimeout, "function");
  assert.equal(typesModule.MAX_SAFE_TIMER_MS, 2_147_000_000);
  assert.equal((sdkTimeout as (idleMs: number) => number)(0), 2_147_000_000);
  assert.equal((sdkTimeout as (idleMs: number) => number)(601_000), 602_000);
  assert.equal((sdkTimeout as (idleMs: number) => number)(2_146_999_000), 2_147_000_000);
  assert.match(controllerSource, /connectionTimeoutMs:\s*s\.llmConnectionTimeoutSec\s*\*\s*1000/);
  assert.match(controllerSource, /idleTimeoutMs:\s*s\.llmIdleTimeoutSec\s*\*\s*1000/);
  assert.match(factorySource, /timeout:\s*sdkTimeoutForIdleMs\(options\.idleTimeoutMs\)/);
  assert.match(transportSource, /createDirectDesktopFetch\(options\.connectionTimeoutMs\)/);
  assert.match(transportSource, /new undici\.Agent\(\{[\s\S]*?connectTimeout:\s*normalizedTimeout/);
  assert.match(transportSource, /new undici\.ProxyAgent\(\{[\s\S]*?connectTimeout:\s*normalizedTimeout/);
  assert.match(transportSource, /proxyTls:\s*\{\s*timeout:\s*normalizedTimeout\s*\}/);
  assert.match(transportSource, /requestTls:\s*\{\s*timeout:\s*normalizedTimeout\s*\}/);
  assert.doesNotMatch(transportSource, /headersTimeout:\s*options\.connectionTimeoutMs/);
  assert.doesNotMatch(transportSource, /bodyTimeout:\s*options\.connectionTimeoutMs/);
});

test("executor idle deadline wins before a later request deadline", async () => {
  const signal = new AbortController().signal;
  const lifecycle = createNativeRequestLifecycle({
    initial: { id: "idle-wins", action: "synthesize_wiki_pages" },
    callSite: "ingest.synthesize",
    onEvent: () => undefined,
  });
  const client = createNativeLlmClient((async (_params, options) => {
    return await new Promise((_resolve, reject) => {
      const laterDeadline = nodeSetTimeout(() => reject(new Error("request deadline")), 100);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(laterDeadline);
        reject(options.signal?.reason);
      }, { once: true });
    });
  }) as never);

  await assert.rejects(
    client.chat.completions.create({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      stream: false,
    }, {
      signal,
      retry: createNativeRequestRetryContext({
        llm: client,
        callSite: "ingest.synthesize",
        opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 10 },
        signal,
        onEvent: () => undefined,
        lifecycle,
      }),
    }),
    /LLM idle timeout after 10ms/,
  );
});

test("agent logger bounds backend and model envelope fields before serialization", () => {
  const source = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");
  const start = source.indexOf("private async logEvent");
  const logEvent = source.slice(
    start,
    source.indexOf("private async dispatch(", start),
  );

  assert.match(logEvent, /boundAgentLogField\(this\._currentLogMeta\?\.backend/);
  assert.match(logEvent, /boundAgentLogField\(this\._currentLogMeta\?\.model/);
  assert.match(logEvent, /AGENT_LOG_LINE_MAX_BYTES/);
  assert.match(logEvent, /encoded.*byte|byteLength|TextEncoder/i);
});

test("native client selects mobile, proxy, and direct desktop transports", () => {
  assert.equal(
    typeof transport.selectNativeFetch,
    "function",
    "native transport selector must be exported",
  );

  const mobileFetch = async () => new Response("mobile");
  const proxyFetch = async () => new Response("proxy");
  const desktopFetch = async () => new Response("desktop");
  let directDesktopSelections = 0;
  const directDesktopFetch = (): typeof fetch => {
    directDesktopSelections += 1;
    return desktopFetch;
  };
  const selectNativeFetch = transport.selectNativeFetch!;

  assert.equal(selectNativeFetch({
    isMobile: true,
    mobileFetch,
    proxyFetch,
    directDesktopFetch,
  }), mobileFetch);
  assert.equal(selectNativeFetch({
    isMobile: false,
    mobileFetch,
    proxyFetch,
    directDesktopFetch,
  }), proxyFetch);
  assert.equal(directDesktopSelections, 0);
  const desktopRouter = selectNativeFetch({
    isMobile: false,
    mobileFetch,
    proxyFetch: null,
    directDesktopFetch,
  });
  assert.equal(desktopRouter, desktopFetch);
  assert.equal(directDesktopSelections, 1);
});

test("mobile transport selection returns mandatory connection-scope diagnostic metadata", () => {
  const selectNativeTransport = (transport as Record<string, unknown>).selectNativeTransport;
  assert.equal(typeof selectNativeTransport, "function");

  const mobileFetch = async () => new Response("mobile");
  const selection = (selectNativeTransport as (options: {
    isMobile: boolean;
    mobileFetch: typeof fetch;
    proxyFetch: typeof fetch | null;
    directDesktopFetch: () => typeof fetch;
  }) => { fetch: typeof fetch; diagnostic: unknown })({
    isMobile: true,
    mobileFetch,
    proxyFetch: async () => new Response("proxy"),
    directDesktopFetch: () => async () => new Response("desktop"),
  });

  assert.equal(selection.fetch, mobileFetch);
  assert.deepEqual(selection.diagnostic, {
    transport: "mobile-host",
    diagnosticMode: "off",
    requestedScope: "dns_tcp_tls_establishment",
    exactConnectTimeoutAvailable: false,
    hostTransportRetained: true,
  });
});

test("mobile native client exposes transport diagnostic for run metadata", () => {
  const client = createNativeOpenAiClient({
    baseURL: "https://example.invalid/v1",
    apiKey: "test-key",
    connectionTimeoutMs: 15_000,
    idleTimeoutMs: 300_000,
    isMobile: true,
    proxyConfig: { enabled: false, url: "" },
    mobileFetch: async () => new Response("unused"),
  });

  assert.deepEqual((client as unknown as { nativeTransportDiagnostic?: unknown }).nativeTransportDiagnostic, {
    transport: "mobile-host",
    diagnosticMode: "off",
    requestedScope: "dns_tcp_tls_establishment",
    exactConnectTimeoutAvailable: false,
    hostTransportRetained: true,
    endpointPath: "/v1/chat/completions",
  });
});

test("controller enriches metadata-only run configuration before logging or view delivery", () => {
  const controllerSource = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");
  const viewSource = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  const logEventStart = controllerSource.indexOf("private async logEvent");
  const logEvent = controllerSource.slice(
    logEventStart,
    controllerSource.indexOf("private async dispatch(", logEventStart),
  );
  const enrichment = logEvent.indexOf('ev.kind === "run_config"');
  const loggingOptOut = logEvent.indexOf("agentLogEnabled)) return");

  assert.match(
    controllerSource,
    /this\._currentNativeTransportDiagnostic\s*=\s*llm\.nativeTransportDiagnostic/,
  );
  assert.ok(enrichment >= 0 && enrichment < loggingOptOut);
  assert.match(logEvent, /ev\.nativeTransport\s*=\s*this\._currentNativeTransportDiagnostic/);
  assert.match(
    viewSource,
    /isTelemetryOnlyRunEvent[\s\S]*?event\.kind === "run_config"/,
  );
});

test("healthy desktop non-stream generation beyond 15 seconds survives connection timeout", { timeout: 20_000 }, async () => {
  await withServer(async (response) => {
    await new Promise<void>((resolve) => nodeSetTimeout(resolve, 15_100));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  }, async (url) => {
    const desktopFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: async () => { throw new Error("desktop used mobile transport"); },
      connectionTimeoutMs: 15_000,
    });
    const response = await desktopFetch(url, {
      method: "POST",
      body: JSON.stringify({ stream: false }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("direct desktop TLS establishment is bounded by connectTimeout", async () => {
  await withNetServer(() => undefined, async (port) => {
    const controller = new AbortController();
    const outcome = await settleBeforeAbort(
      transport.createDirectDesktopFetch!(25)(`https://localhost:${port}/`, {
        signal: controller.signal,
      }),
      controller,
    );
    assert.notEqual(outcome, "still-pending");
  });
});

test("proxy TLS establishment has its own bounded timeout", async () => {
  await withNetServer(() => undefined, async (port) => {
    const controller = new AbortController();
    const proxyFetch = transport.createProxyFetch!({
      enabled: true,
      url: `https://localhost:${port}`,
    }, 25);
    assert.ok(proxyFetch);
    const outcome = await settleBeforeAbort(
      proxyFetch("https://target.example/v1/chat/completions", { signal: controller.signal }),
      controller,
    );
    assert.notEqual(outcome, "still-pending");
  });
});

test("target TLS establishment through proxy has its own bounded timeout", async () => {
  await withNetServer((socket) => {
    socket.once("data", () => socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"));
  }, async (port) => {
    const controller = new AbortController();
    const proxyFetch = transport.createProxyFetch!({
      enabled: true,
      url: `http://localhost:${port}`,
    }, 25);
    assert.ok(proxyFetch);
    const outcome = await settleBeforeAbort(
      proxyFetch("https://target.example/v1/chat/completions", { signal: controller.signal }),
      controller,
    );
    assert.notEqual(outcome, "still-pending");
  });
});

test("direct desktop transport exposes the first SSE chunk before completion", async () => {
  assert.equal(
    typeof transport.createDirectDesktopFetch,
    "function",
    "direct desktop transport must be exported",
  );

  let releaseCompletion!: () => void;
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  let completed = false;

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.write("data: first\n\n");
    await completionGate;
    completed = true;
    response.end("data: done\n\n");
  }, async (url) => {
    const response = await transport.createDirectDesktopFetch!()(url);
    assert.ok(response.body, "streaming response body must be preserved");

    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
    assert.equal(completed, false, "request must still be in progress");

    releaseCompletion();
    const second = await reader.read();
    assert.equal(new TextDecoder().decode(second.value), "data: done\n\n");
    assert.equal((await reader.read()).done, true);
  });
});

test("direct desktop transport preserves AbortSignal for a streaming body", async () => {
  assert.equal(
    typeof transport.createDirectDesktopFetch,
    "function",
    "direct desktop transport must be exported",
  );

  await withServer(async (response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.write("data: first\n\n");
    await new Promise<void>((resolve) => response.once("close", resolve));
  }, async (url) => {
    const controller = new AbortController();
    const response = await transport.createDirectDesktopFetch!()(url, {
      signal: controller.signal,
    });
    assert.ok(response.body, "streaming response body must be preserved");

    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    const pendingChunk = reader.read();
    controller.abort();

    await assert.rejects(pendingChunk, (error: unknown) => {
      return error instanceof Error && error.name === "AbortError";
    });
  });
});

test("direct desktop transport closes an SSE body at the OpenAI done sentinel", async () => {
  assert.equal(
    typeof transport.createDirectDesktopFetch,
    "function",
    "direct desktop transport must be exported",
  );

  let releaseSocket!: () => void;
  const socketGate = new Promise<void>((resolve) => {
    releaseSocket = resolve;
  });

  try {
    await withServer(async (response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      response.write("data: [DONE]\n\n");
      await socketGate;
      response.end();
    }, async (url) => {
      const response = await transport.createDirectDesktopFetch!()(url);
      assert.ok(response.body, "streaming response body must be preserved");

      const reader = response.body.getReader();
      const completed = (async () => {
        while (!(await reader.read()).done) {
          // Drain through the done sentinel.
        }
      })();
      const outcome = await Promise.race([
        completed.then(() => "complete"),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 250)),
      ]);
      assert.equal(outcome, "complete");
    });
  } finally {
    releaseSocket();
  }
});

test("direct desktop transport does not inherit the process-global dispatcher", async () => {
  assert.equal(
    typeof transport.createDirectDesktopFetch,
    "function",
    "direct desktop transport must be exported",
  );

  const originalDispatcher = getGlobalDispatcher();
  const poisonedDispatcher = new MockAgent();
  poisonedDispatcher.disableNetConnect();
  setGlobalDispatcher(poisonedDispatcher);
  try {
    await withServer(async (response) => {
      response.writeHead(200, {"content-type": "text/plain"});
      response.end("ok");
    }, async (url) => {
      const response = await transport.createDirectDesktopFetch!(1_000)(url);
      assert.equal(await response.text(), "ok");
    });
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await poisonedDispatcher.close();
  }
});

test("diagnostic mode off preserves pooled desktop-direct connection reuse", async () => {
  assert.equal(await sequentialRequestsReuseConnection("off"), true);
});

test("connection-close gives each desktop-direct request an isolated connection", async () => {
  assert.equal(await sequentialRequestsReuseConnection("connection-close"), false);
});

test("OpenAI client preserves nested base URL paths", async () => {
  let observedPath = "";

  await withServer(async (response, requestPath) => {
    observedPath = requestPath;
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {role: "assistant", content: "ok"},
      }],
    }));
  }, async (url) => {
    const origin = new URL(url).origin;
    const client = new OpenAI({
      apiKey: "test-key",
      baseURL: `${origin}/url/path/path/v1`,
      maxRetries: 0,
    });

    await client.chat.completions.create({
      model: "test-model",
      messages: [{role: "user", content: "hello"}],
    });
  });

  assert.equal(observedPath, "/url/path/path/v1/chat/completions");
});

test("OpenAI client omits disabled reasoning controls from stream and non-stream request bodies", async () => {
  const observedBodies: Array<Record<string, unknown>> = [];

  await withServer(async (response, _requestPath, request) => {
    observedBodies.push(JSON.parse(await readRequestBody(request)) as Record<string, unknown>);
    response.writeHead(200, {
      "content-type": request.headers.accept === "text/event-stream"
        ? "text/event-stream"
        : "application/json",
    });
    if (request.headers.accept === "text/event-stream") {
      response.end("data: [DONE]\n\n");
      return;
    }
    response.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {role: "assistant", content: "ok"},
      }],
    }));
  }, async (url) => {
    const client = new OpenAI({ apiKey: "test-key", baseURL: new URL(".", url).href, maxRetries: 0 });
    const messages = [{ role: "user" as const, content: "hello" }];

    for (const thinkingBudgetTokens of [undefined, 0]) {
      for (const stream of [false, true] as const) {
        const params = buildChatParams("test-model", messages, { thinkingBudgetTokens }, stream);
        const response = await client.chat.completions.create({ ...params, stream } as never);
        if (stream) {
          for await (const _chunk of response as AsyncIterable<unknown>) {
            // Drain the stream so the serialized request completes.
          }
        }
      }
    }
  });

  assert.equal(observedBodies.length, 4);
  for (const body of observedBodies) {
    assert.equal("reasoning_effort" in body, false);
    assert.equal("extra_body" in body, false);
    assert.equal("thinking" in body, false);
  }
  assert.deepEqual(observedBodies.map((body) => body.stream), [false, true, false, true]);
});

async function withServer(
  handle: (response: ServerResponse, requestPath: string, request: IncomingMessage) => Promise<void>,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    void handle(response, request.url ?? "", request);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}/chat/completions`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function sequentialRequestsReuseConnection(
  diagnosticMode: "off" | "connection-close",
): Promise<boolean> {
  const sockets: IncomingMessage["socket"][] = [];
  await withServer(async (response, _requestPath, request) => {
    sockets.push(request.socket);
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-length": "2",
    });
    response.end("ok");
  }, async (url) => {
    const nativeFetch = transport.createNativeOpenAiFetch!({
      baseURL: new URL(url).origin,
      isMobile: false,
      proxyConfig: { enabled: false, url: "" },
      mobileFetch: fetch,
      connectionTimeoutMs: 1_000,
      nativeTransportDiagnosticMode: diagnosticMode,
    });
    for (let index = 0; index < 2; index++) {
      const response = await nativeFetch(url, { signal: new AbortController().signal });
      assert.equal(await response.text(), "ok");
      if (index === 0) {
        await new Promise<void>((resolve) => nodeSetTimeout(resolve, 20));
      }
    }
  });
  assert.equal(sockets.length, 2);
  return sockets[0] === sockets[1];
}

async function withNetServer(
  onConnection: (socket: Socket) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(address.port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function settleBeforeAbort(
  request: Promise<Response>,
  controller: AbortController,
): Promise<string> {
  const outcome = await Promise.race([
    request.then(
      () => "resolved",
      (error: unknown) => error instanceof Error ? error.name : "unknown-error",
    ),
    new Promise<string>((resolve) => nodeSetTimeout(() => resolve("still-pending"), 1_500)),
  ]);
  if (outcome === "still-pending") {
    controller.abort();
    await request.catch(() => undefined);
  }
  return outcome;
}
