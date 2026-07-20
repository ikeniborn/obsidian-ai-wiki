import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire, register } from "node:module";
import { createServer as createNetServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
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
