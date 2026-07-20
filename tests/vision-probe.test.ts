import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  createRequestUrlVisionTransport,
  probeNativeVisionModel,
  runNativeVisionModelCheck,
} from "../src/vision-probe";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  },
});
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("probe sends selected model, auth, inline PNG, and small output cap", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1/",
    apiKey: "secret",
    model: "vision-model",
    request: async (request) => {
      seen.push(request);
      return {
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content: "pixel" } }] }),
      };
    },
    timeoutMs: 100,
  });

  assert.deepEqual(result, { ok: true, content: "pixel" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(seen[0].method, "POST");
  assert.equal((seen[0].signal as AbortSignal).aborted, false);
  assert.equal((seen[0].headers as Record<string, string>).Authorization, "Bearer secret");
  const body = JSON.parse(String(seen[0].body));
  assert.equal(body.model, "vision-model");
  assert.equal(body.max_tokens, 16);
  assert.equal(body.stream, false);
  const dataUrl = body.messages[0].content[1].image_url.url as string;
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const png = Buffer.from(dataUrl.split(",", 2)[1], "base64");
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.ok(png.readUInt32BE(16) >= 16);
  assert.ok(png.readUInt32BE(20) >= 16);
});

test("HTTP, malformed, and empty responses are distinct failures", async () => {
  const cases = [
    { response: { status: 401, text: "denied" }, code: "http" },
    { response: { status: 200, text: "not-json" }, code: "malformed" },
    {
      response: {
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content: "" } }] }),
      },
      code: "empty",
    },
  ] as const;

  for (const item of cases) {
    const result = await probeNativeVisionModel({
      baseUrl: "https://provider.example/v1",
      apiKey: "k",
      model: "m",
      request: async () => item.response,
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, item.code);
  }
});

test("probe timeout is reported separately", async () => {
  let observedAbort = false;
  let lateSideEffect = false;
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "m",
    request: async ({ signal }) => new Promise<never>((_, reject) => {
      const lateTimer = setTimeout(() => {
        lateSideEffect = true;
      }, 20);
      signal.addEventListener("abort", () => {
        observedAbort = signal.aborted;
        clearTimeout(lateTimer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
    timeoutMs: 1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "timeout");
  assert.equal(observedAbort, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(lateSideEffect, false);
});

test("valid JSON primitives, null, and arrays are malformed responses", async () => {
  for (const text of ["null", "42", '"text"', "true", "[]"]) {
    const result = await probeNativeVisionModel({
      baseUrl: "https://provider.example/v1",
      apiKey: "k",
      model: "m",
      request: async () => ({ status: 200, text }),
      timeoutMs: 100,
    });
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.code, "malformed", text);
  }
});

test("an unrelated transport AbortError remains a transport failure", async () => {
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "m",
    request: async () => {
      throw new DOMException("provider aborted", "AbortError");
    },
    timeoutMs: 100,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "http");
});

test("transport failures do not expose the API key or image payload", async () => {
  const apiKey = "TOP_SECRET_API_KEY";
  const leakedImage = "iVBORw0KGgoAAAANSUhEUg";
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1",
    apiKey,
    model: "m",
    request: async () => {
      throw new Error(`${apiKey}:${leakedImage}`);
    },
    timeoutMs: 100,
  });

  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(leakedImage));
});

test("localized check helper selects missing, success, and failure notices", async () => {
  const notices: string[] = [];
  const messages = {
    missing: "missing",
    success: "success",
    details: {
      timeout: "timeout-detail",
      http: "http-detail",
      malformed: "malformed-detail",
      empty: "empty-detail",
    },
    failure: (message: string) => `failure:${message}`,
  };
  const request = async () => ({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "pixel" } }] }),
  });

  await runNativeVisionModelCheck({
    baseUrl: "",
    apiKey: "k",
    model: "m",
    request,
    timeoutMs: 100,
    messages,
    notify: (message) => { notices.push(message); },
  });
  await runNativeVisionModelCheck({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "m",
    request,
    timeoutMs: 100,
    messages,
    notify: (message) => { notices.push(message); },
  });
  await runNativeVisionModelCheck({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "m",
    request: async () => ({ status: 401, text: "denied" }),
    timeoutMs: 100,
    messages,
    notify: (message) => { notices.push(message); },
  });

  assert.deepEqual(notices, [
    "missing",
    "success",
    "failure:http-detail",
  ]);
});

test("requestUrl adapter sends compatible options and checks abort around the host await", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const transport = createRequestUrlVisionTransport(async (options) => {
    calls.push(options);
    return { status: 200, text: "ok" };
  });
  const controller = new AbortController();
  const response = await transport({
    url: "https://provider.example/v1/chat/completions",
    method: "POST",
    headers: { Authorization: "Bearer k" },
    body: "{}",
    signal: controller.signal,
  });

  assert.deepEqual(response, { status: 200, text: "ok" });
  assert.deepEqual(calls, [{
    url: "https://provider.example/v1/chat/completions",
    method: "POST",
    headers: { Authorization: "Bearer k" },
    body: "{}",
    throw: false,
  }]);

  controller.abort();
  await assert.rejects(
    transport({
      url: "https://provider.example/v1/chat/completions",
      method: "POST",
      headers: {},
      body: "{}",
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls.length, 1);
});

test("requestUrl late completion is ignored after timeout without later side effects", async () => {
  let completeHost!: (response: { status: number; text: string }) => void;
  let requests = 0;
  const transport = createRequestUrlVisionTransport(async () => {
    requests++;
    return new Promise((resolve) => { completeHost = resolve; });
  });
  const notices: string[] = [];
  const settings = { model: "persisted" };
  const vault = { writes: 0 };
  let saves = 0;

  await runNativeVisionModelCheck({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "live-unsaved",
    request: transport,
    timeoutMs: 1,
    messages: {
      missing: "missing",
      success: "success",
      details: {
        timeout: "timeout-detail",
        http: "http-detail",
        malformed: "malformed-detail",
        empty: "empty-detail",
      },
      failure: (detail) => `failure:${detail}`,
    },
    notify: (message) => { notices.push(message); },
  });

  assert.equal(requests, 1);
  assert.deepEqual(notices, ["failure:timeout-detail"]);
  assert.deepEqual(settings, { model: "persisted" });
  assert.deepEqual(vault, { writes: 0 });
  assert.equal(saves, 0);

  completeHost({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "late" } }] }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(notices, ["failure:timeout-detail"]);
  assert.deepEqual(settings, { model: "persisted" });
  assert.deepEqual(vault, { writes: 0 });
  assert.equal(saves, 0);
});
