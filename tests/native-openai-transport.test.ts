import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire, register } from "node:module";
import { setTimeout as nodeSetTimeout } from "node:timers";
import test from "node:test";
import OpenAI from "openai";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

(globalThis as typeof globalThis & { require: NodeJS.Require }).require =
  createRequire(import.meta.url);

const transport = await import("../src/proxy") as typeof import("../src/proxy") & {
  createDirectDesktopFetch?: (headersTimeoutMs?: number) => typeof fetch;
  createDesktopOpenAiFetch?: (options: {
    nonStreamFetch: typeof fetch;
    streamFetch: typeof fetch;
    nonStreamTimeoutMs: number;
  }) => typeof fetch;
  selectNativeFetch?: (options: {
    isMobile: boolean;
    mobileFetch: typeof fetch;
    proxyFetch: typeof fetch | null;
    directDesktopFetch: () => typeof fetch;
    requestTimeoutMs: number;
  }) => typeof fetch;
};
const { buildChatParams } = await import("../src/phases/llm-utils");

test("native OpenAI client disables SDK request retries", () => {
  const source = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");
  const constructorStart = source.indexOf("new OpenAI({");
  assert.ok(constructorStart >= 0, "OpenAI constructor must be present");

  const constructorOptions = source.slice(constructorStart, constructorStart + 700);
  assert.match(constructorOptions, /maxRetries:\s*0/);
});

test("native OpenAI transport uses the configured LLM idle timeout", () => {
  const source = readFileSync(new URL("../src/controller.ts", import.meta.url), "utf8");

  assert.match(source, /requestTimeoutMs\s*=\s*s\.llmIdleTimeoutSec\s*\*\s*1000/);
  assert.match(source, /createDirectDesktopFetch\(requestTimeoutMs\)/);
  assert.match(source, /timeout:\s*requestTimeoutMs/);
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
    requestTimeoutMs: 1_000,
  }), mobileFetch);
  assert.equal(selectNativeFetch({
    isMobile: false,
    mobileFetch,
    proxyFetch,
    directDesktopFetch,
    requestTimeoutMs: 1_000,
  }), proxyFetch);
  assert.equal(directDesktopSelections, 0);
  const desktopRouter = selectNativeFetch({
    isMobile: false,
    mobileFetch,
    proxyFetch: null,
    directDesktopFetch,
    requestTimeoutMs: 1_000,
  });
  assert.notEqual(desktopRouter, desktopFetch);
  assert.equal(directDesktopSelections, 1);
});

test("desktop OpenAI transport routes only stream:true through direct streaming fetch", async () => {
  assert.equal(
    typeof transport.createDesktopOpenAiFetch,
    "function",
    "desktop OpenAI transport router must be exported",
  );

  const calls: Array<{ transport: string; url: string }> = [];
  const nonStreamFetch: typeof fetch = async (input) => {
    calls.push({ transport: "requestUrl", url: String(input) });
    return new Response('{"transport":"requestUrl"}');
  };
  const streamFetch: typeof fetch = async (input) => {
    calls.push({ transport: "undici", url: String(input) });
    return new Response('{"transport":"undici"}');
  };
  const routedFetch = transport.createDesktopOpenAiFetch!({
    nonStreamFetch,
    streamFetch,
    nonStreamTimeoutMs: 1_000,
  });
  const nestedUrl = "https://example.test/url/path/path/v1/chat/completions";

  await routedFetch(nestedUrl, {
    method: "POST",
    body: JSON.stringify({ model: "test", stream: false }),
  });
  await routedFetch(nestedUrl, {
    method: "POST",
    body: JSON.stringify({ model: "test" }),
  });
  await routedFetch(nestedUrl, {
    method: "POST",
    body: JSON.stringify({ model: "test", stream: true }),
  });

  assert.deepEqual(calls, [
    { transport: "requestUrl", url: nestedUrl },
    { transport: "requestUrl", url: nestedUrl },
    { transport: "undici", url: nestedUrl },
  ]);
});

test("desktop non-stream requestUrl route has bounded timeout and preserves abort", async () => {
  assert.equal(
    typeof transport.createDesktopOpenAiFetch,
    "function",
    "desktop OpenAI transport router must be exported",
  );

  const neverSettles: typeof fetch = async () => await new Promise<Response>(() => {});
  const routedFetch = transport.createDesktopOpenAiFetch!({
    nonStreamFetch: neverSettles,
    streamFetch: async () => new Response("stream"),
    nonStreamTimeoutMs: 10,
  });

  await assert.rejects(
    routedFetch("https://example.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ stream: false }),
    }),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );

  const controller = new AbortController();
  const pending = routedFetch("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ stream: false }),
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("desktop non-stream timeout does not depend on Electron renderer timers", async () => {
  assert.equal(
    typeof transport.createDesktopOpenAiFetch,
    "function",
    "desktop OpenAI transport router must be exported",
  );

  const originalSetTimeout = window.setTimeout;
  window.setTimeout = (() => 1) as typeof window.setTimeout;
  try {
    const routedFetch = transport.createDesktopOpenAiFetch!({
      nonStreamFetch: async () => await new Promise<Response>(() => {}),
      streamFetch: async () => new Response("stream"),
      nonStreamTimeoutMs: 5,
    });
    const outcome = await Promise.race([
      routedFetch("https://example.test/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ stream: false }),
      }).then(
        () => "resolved",
        (error: unknown) => error instanceof Error ? error.name : "unknown-error",
      ),
      new Promise<string>((resolve) => nodeSetTimeout(() => resolve("still-pending"), 30)),
    ]);

    assert.equal(outcome, "TimeoutError");
  } finally {
    window.setTimeout = originalSetTimeout;
  }
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
