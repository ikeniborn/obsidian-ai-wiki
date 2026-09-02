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

test("a context error without a token count never shrinks the window", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    (async () => json({})) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);

  // The callback fires once per failed attempt and once per repack boundary. A
  // -25% guess would compound to 55_112 after four of them, permanently, because
  // a learned record never expires and nothing raises it again.
  for (let attempt = 0; attempt < 4; attempt++) {
    store.observeContextError("http://x/v1", "m1", undefined);
    store.observeContextError("http://x/v1", "m1", 0);
  }

  const record = store.get("http://x/v1", "m1")!;
  assert.equal(record.contextWindow, 131_072);
  assert.equal(record.source, "discovered");
});

test("a configured window is used verbatim and no probe fires", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 8_192 }] }); }) as typeof fetch;
  const store = storeWith({}, fetchFn);

  const record = await store.resolve("http://x/v1", "m1", "", 0, undefined, undefined, 131_072);

  assert.equal(record.contextWindow, 131_072);
  assert.equal(record.source, "configured");
  assert.equal(record.expiresAt, undefined, "a user-supplied window never expires into a re-probe");
  assert.equal(probes, 0, "a user-supplied window is authoritative: the network is skipped");
});

test("a configured window replaces a stale cached record but keeps its calibration", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 8_192, source: "learned", calibration: 1.25, samples: 4 } },
    (async () => { throw new Error("must not probe"); }) as typeof fetch,
  );

  const record = await store.resolve("http://x/v1", "m1", "", 0, undefined, undefined, 131_072);

  assert.equal(record.contextWindow, 131_072);
  assert.equal(record.source, "configured");
  assert.equal(record.calibration, 1.25, "calibration is a measurement of the estimator, not of the window");
  assert.equal(record.samples, 4);
});

test("clearing the configured window restores probing", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "configured", calibration: 1, samples: 0 } },
    fetchFn,
  );

  const record = await store.resolve("http://x/v1", "m1", "", 9_999_999);

  assert.equal(probes, 1, "a cleared setting must not stay pinned by the record it wrote");
  assert.equal(record.source, "discovered");
  assert.equal(record.contextWindow, 65_536);
});

test("an implausible configured window is ignored and the probe runs", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith({}, fetchFn);

  const record = await store.resolve("http://x/v1", "m1", "", 0, undefined, undefined, 12);

  assert.equal(probes, 1);
  assert.equal(record.source, "discovered");
  assert.equal(record.contextWindow, 65_536);
});

test("a context error never shrinks a user-supplied window, and says so", async () => {
  const store = storeWith({}, (async () => { throw new Error("must not probe"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0, undefined, undefined, 131_072);

  const outcome = store.observeContextError("http://x/v1", "m1", 8_192);

  assert.deepEqual(outcome, {
    applied: false,
    reason: "configured",
    contextWindow: 131_072,
    reportedWindow: 8_192,
  });
  const record = store.get("http://x/v1", "m1")!;
  assert.equal(record.contextWindow, 131_072, "an explicit instruction is not overwritten behind the user's back");
  assert.equal(record.source, "configured");
});

test("observeContextError reports what it did to a discovered window", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    (async () => json({})) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);

  assert.deepEqual(
    store.observeContextError("http://x/v1", "m1", undefined),
    { applied: false, reason: "no-reported-window" },
  );
  assert.deepEqual(
    store.observeContextError("http://x/v1", "m1", 8_192),
    { applied: true, reason: "learned", contextWindow: 8_192, reportedWindow: 8_192 },
  );
  assert.deepEqual(
    store.observeContextError("http://x/v1", "m1", 65_536),
    { applied: false, reason: "not-smaller" },
  );
});

test("the probe separates 'no such model' from 'model found, no window advertised'", async () => {
  const events: Array<{ endpoint: string; matchedById?: boolean; contextLength?: number }> = [];
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).endsWith("/models")
      ? json({ data: [{ id: "m1", owned_by: "gateway" }, { id: "other", context_length: 131_072 }] })
      : json({})) as typeof fetch;

  assert.equal(
    await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000, undefined, (event) => events.push(event)),
    null,
  );

  const models = events.find((event) => event.endpoint.endsWith("/models"))!;
  assert.equal(models.matchedById, true, "the entry WAS matched by id — it just advertises no window");
  assert.equal(models.contextLength, undefined);

  const missing: Array<{ endpoint: string; matchedById?: boolean }> = [];
  await probeContextWindow(fetchFn, "http://x/v1", "", "absent", 2000, undefined, (event) => missing.push(event));
  assert.equal(missing.find((event) => event.endpoint.endsWith("/models"))!.matchedById, false);
});

test("an unreadable listing omits matchedById instead of reporting a non-match", async () => {
  const unreachable: Array<{ endpoint: string; ok: boolean; matchedById?: boolean }> = [];
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).endsWith("/models")
      ? new Response("gateway is down", { status: 502 })
      : json({})) as typeof fetch;

  await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000, undefined, (event) => unreachable.push(event));

  const models = unreachable.find((event) => event.endpoint.endsWith("/models"))!;
  assert.equal(models.ok, false, "the listing request failed");
  assert.equal(
    "matchedById" in models,
    false,
    "a listing that could not be read says nothing about whether the model exists",
  );
});

test("a listing that throws also omits matchedById", async () => {
  const thrown: Array<{ endpoint: string; ok: boolean; matchedById?: boolean }> = [];
  const fetchFn = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/models")) throw new Error("connection refused");
    return json({});
  }) as typeof fetch;

  await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000, undefined, (event) => thrown.push(event));

  const models = thrown.find((event) => event.endpoint.endsWith("/models"))!;
  assert.equal(models.ok, false);
  assert.equal("matchedById" in models, false);
});

test("a cache write failure while resolving does not fail the caller", async () => {
  const store = new ModelContextStore({
    read: async () => ({}),
    write: async () => { throw new Error("disk full"); },
    fetchFn: (async () => json({ data: [{ id: "m1", context_length: 40_960 }] })) as typeof fetch,
  });

  const record = await store.resolve("http://x/v1", "m1", "", 0);

  assert.equal(record.contextWindow, 40_960);
  assert.equal(record.source, "discovered");
  assert.equal(store.get("http://x/v1", "m1")?.contextWindow, 40_960);
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
    store.observeUsage("http://x/v1", "m1", 1_000, 2_000, 1);
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
    const applied = store.get("http://x/v1", "m1")!.calibration;
    store.observeUsage("http://x/v1", "m1", RAW * applied, RAW * TRUE_FACTOR, applied);
  }
  const settled = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    Math.abs(settled - TRUE_FACTOR) < 0.05,
    `converged on ${settled.toFixed(3)}; averaging the ratio would settle at `
    + `${Math.sqrt(TRUE_FACTOR).toFixed(3)}`,
  );
});

test("samples measured at a stale factor converge on the true bias instead of compounding", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0);
  const RAW = 4_000;
  const TRUE_FACTOR = 1.1;
  // `LlmCallOptions.tokenCalibration` is resolved ONCE per run, so every estimate a
  // run produces carries the factor the record held when that run started — earlier
  // samples of the same run move the record but never the factor already in flight.
  const applied = store.get("http://x/v1", "m1")!.calibration;
  for (let step = 0; step < 8; step++) {
    store.observeUsage("http://x/v1", "m1", RAW * applied, RAW * TRUE_FACTOR, applied);
  }
  const settled = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    Math.abs(settled - TRUE_FACTOR) < 0.01,
    `eight samples measured at factor ${applied} settled on ${settled.toFixed(4)}; the true `
    + `bias is ${TRUE_FACTOR}. Correcting against the record's CURRENT factor instead of the `
    + `one that produced the estimate multiplies the same bias in again on every sample.`,
  );
});

test("a factor left too high by an earlier session decays back over one window", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1.25, samples: 8 } },
    (async () => { throw new Error("offline"); }) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);
  const RAW = 4_000;
  const TRUE_FACTOR = 1.02;
  // One run: eight samples, all measured at the factor the run started with.
  const firstRun = store.get("http://x/v1", "m1")!.calibration;
  for (let step = 0; step < 8; step++) {
    store.observeUsage("http://x/v1", "m1", RAW * firstRun, RAW * TRUE_FACTOR, firstRun);
  }
  // A full window at weight 7 keeps (7/8)^8 ≈ 34% of the starting error, so one run's
  // worth of samples takes 1.25 to roughly 1.10.
  const afterOneRun = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    afterOneRun > TRUE_FACTOR && afterOneRun < 1.11,
    `an inherited 1.25 must decay toward ${TRUE_FACTOR}; after one window it is ${afterOneRun.toFixed(4)}`,
  );

  // Two more runs, each measured at the factor its own run started with.
  for (let run = 0; run < 2; run++) {
    const applied = store.get("http://x/v1", "m1")!.calibration;
    for (let step = 0; step < 8; step++) {
      store.observeUsage("http://x/v1", "m1", RAW * applied, RAW * TRUE_FACTOR, applied);
    }
  }
  const settled = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    Math.abs(settled - TRUE_FACTOR) < 0.01,
    `an inherited factor must settle ON the true bias, not drift past it; landed on ${settled.toFixed(4)}`,
  );
});

test("calibration is a moving average that discards anomalies", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0);
  store.observeUsage("http://x/v1", "m1", 1_000, 2_000, 1);
  assert.ok(store.get("http://x/v1", "m1")!.calibration > 1);
  const beforeAnomaly = store.get("http://x/v1", "m1")!.calibration;
  store.observeUsage("http://x/v1", "m1", 1_000, 100_000, 1);
  assert.equal(
    store.get("http://x/v1", "m1")!.calibration, beforeAnomaly,
    "an out-of-range ratio must leave the calibration unchanged",
  );
  assert.equal(store.get("http://x/v1", "m1")!.samples, 1, "the anomaly must not count as a sample");
});

test("the anomaly gate judges the implied factor, so a record at the clamp can still recover", async () => {
  // A record parked at the top of the band: every estimate it produces is three
  // times the truth, so every corrective sample has a RAW ratio of 1/3 — below the
  // 0.5 floor. Gating on the raw ratio throws all of them away and the record can
  // never come back down; gating on the IMPLIED factor (applied x ratio = 1.0)
  // accepts them.
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 3, samples: 8 } },
    (async () => { throw new Error("offline"); }) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);
  const RAW = 1_000;
  const TRUE_FACTOR = 1;

  const first = store.observeUsage("http://x/v1", "m1", RAW * 3, RAW * TRUE_FACTOR, 3);
  assert.equal(first.applied, true, "a sample implying a factor of 1.0 is plausible");
  assert.equal(first.clamped, false);

  for (let run = 0; run < 10; run++) {
    const applied = store.get("http://x/v1", "m1")!.calibration;
    for (let step = 0; step < 8; step++) {
      store.observeUsage("http://x/v1", "m1", RAW * applied, RAW * TRUE_FACTOR, applied);
    }
  }
  const settled = store.get("http://x/v1", "m1")!.calibration;
  assert.ok(
    Math.abs(settled - TRUE_FACTOR) < 0.01,
    `a record stuck at the clamp must decay back to ${TRUE_FACTOR}; it settled on ${settled.toFixed(4)}`,
  );
});

test("an implausible implied factor is still discarded even at a corrected calibration", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 2, samples: 8 } },
    (async () => { throw new Error("offline"); }) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);
  const before = store.get("http://x/v1", "m1")!.calibration;
  // Raw ratio 2.5 sits inside the old [0.5, 3] band, but it was measured through a
  // factor of 2, so it implies a factor of 5 — the estimator is not off by 5x.
  const outcome = store.observeUsage("http://x/v1", "m1", 1_000, 2_500, 2);
  assert.equal(outcome.applied, false);
  assert.equal(outcome.clamped, true);
  assert.equal(store.get("http://x/v1", "m1")!.calibration, before);
  assert.equal(store.get("http://x/v1", "m1")!.samples, 8);
});
