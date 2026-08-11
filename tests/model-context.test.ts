import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKEND_DEFAULT_CONTEXT,
  ModelContextStore,
  probeContextWindow,
  type ModelContextMap,
} from "../src/model-context";

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

const storeWith = (
  initial: ModelContextMap,
  fetchFn: typeof fetch,
  onWrite?: (next: ModelContextMap) => void,
): ModelContextStore => new ModelContextStore({
  read: async () => initial,
  write: async (next) => { onWrite?.(next); },
  fetchFn,
});

test("the probe reads the context length of the requested model only", async () => {
  const fetchFn = (async () => json({ data: [
    { id: "other", context_length: 999_999 },
    { id: "m1", context_length: 131_072 },
  ] })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), 131_072);
});

test("a context length under a different model is ignored", async () => {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (String(input).endsWith("/models")) return json({ data: [{ id: "other", context_length: 999_999 }] });
    return json({});
  }) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), null);
  assert.ok(calls.some((url) => url.endsWith("/api/show")), "must fall through to /api/show");
});

test("an unscoped /models payload is never used, even if it carries a context length", async () => {
  // No `data` array at all — this must not fall back to an unscoped scan of
  // the whole payload, which would risk returning a length that belongs to
  // some other field entirely. It must fall through to /api/show instead,
  // which here reports nothing usable either.
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).endsWith("/models")
      ? json({ model: "m1", context_length: 999_999 })
      : json({})) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), null);
});

test("the probe falls through to /api/show", async () => {
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).endsWith("/models")
      ? json({ data: [{ id: "m1" }] })
      : json({ model_info: { "llama.context_length": 32_768 } })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), 32_768);
});

test("implausible values are rejected", async () => {
  const fetchFn = (async () => json({ data: [{ id: "m1", context_length: 12 }] })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), null);
});

test("a caller abort cancels the probe and caches nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const writes: ModelContextMap[] = [];
  const store = storeWith({}, (async () => json({})) as typeof fetch, (next) => writes.push(next));
  await assert.rejects(() => store.resolve("http://x/v1", "m1", "", 0, controller.signal));
  assert.equal(writes.length, 0);
});

test("concurrent resolves share one probe", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith({}, fetchFn);
  const [a, b] = await Promise.all([
    store.resolve("http://x/v1", "m1", "", 0),
    store.resolve("http://x/v1", "m1", "", 0),
  ]);
  assert.equal(a.contextWindow, 65_536);
  assert.equal(b.contextWindow, 65_536);
  assert.equal(probes, 1, "the second caller must join the in-flight probe");
});

test("resolve falls back to the backend default and marks it expiring", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  const record = await store.resolve("http://x/v1", "m1", "", 1_000);
  assert.equal(record.contextWindow, BACKEND_DEFAULT_CONTEXT);
  assert.equal(record.source, "default");
  assert.ok((record.expiresAt ?? 0) > 1_000);
});

test("an expired default is re-probed", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 8_192, source: "default", calibration: 1, samples: 0, expiresAt: 500 } },
    fetchFn,
  );
  const record = await store.resolve("http://x/v1", "m1", "", 1_000);
  assert.equal(probes, 1);
  assert.equal(record.source, "discovered");
});

test("a discovered record is never re-probed", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({}); }) as typeof fetch;
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    fetchFn,
  );
  await store.resolve("http://x/v1", "m1", "", 9_999_999);
  assert.equal(probes, 0);
});

test("a context error shrinks the window and marks it learned", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    (async () => json({})) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);
  store.observeContextError("http://x/v1", "m1", 8_192);
  const record = store.get("http://x/v1", "m1")!;
  assert.equal(record.contextWindow, 8_192);
  assert.equal(record.source, "learned");
});

test("a persistence failure after observeUsage does not surface as an unhandled rejection", async () => {
  const store = new ModelContextStore({
    read: async () => ({
      "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 },
    }),
    write: async () => { throw new Error("disk full"); },
    fetchFn: (async () => json({})) as typeof fetch,
  });
  await store.resolve("http://x/v1", "m1", "", 0);

  let unhandled: unknown;
  const onUnhandledRejection = (reason: unknown): void => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    store.observeUsage("http://x/v1", "m1", 1_000, 2_000);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }

  assert.equal(unhandled, undefined, "the failed write must not become an unhandled rejection");
  assert.ok(
    store.get("http://x/v1", "m1")!.calibration > 1,
    "the in-memory record keeps the new calibration despite the failed write",
  );
});

test("calibration converges on the true factor, not its square root", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0);
  const RAW = 1_000;
  const TRUE_FACTOR = 2;
  for (let step = 0; step < 20; step++) {
    const calibrated = RAW * store.get("http://x/v1", "m1")!.calibration;
    store.observeUsage("http://x/v1", "m1", calibrated, RAW * TRUE_FACTOR);
  }
  const settled = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    Math.abs(settled - TRUE_FACTOR) < 0.05,
    `converged on ${settled.toFixed(3)}; averaging the ratio would settle at `
    + `${Math.sqrt(TRUE_FACTOR).toFixed(3)}`,
  );
});

test("calibration is a moving average that discards anomalies", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0);
  store.observeUsage("http://x/v1", "m1", 1_000, 2_000);
  assert.ok(store.get("http://x/v1", "m1")!.calibration > 1);
  const beforeAnomaly = store.get("http://x/v1", "m1")!.calibration;
  store.observeUsage("http://x/v1", "m1", 1_000, 100_000);
  assert.equal(
    store.get("http://x/v1", "m1")!.calibration, beforeAnomaly,
    "an out-of-range ratio must leave the calibration unchanged",
  );
  assert.equal(store.get("http://x/v1", "m1")!.samples, 1, "the anomaly must not count as a sample");
});
