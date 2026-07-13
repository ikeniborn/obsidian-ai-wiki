import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RERANKER_SETTINGS,
  MAX_RERANKER_CANDIDATE_TEXT_CHARS,
  applyRerankerScores,
  buildRerankerCandidates,
  normalizeRerankerConfig,
  parseRerankerResponseText,
  raceRerankerRequest,
  rerankChunks,
} from "../src/reranker";
import type { SelectedChunk } from "../src/page-similarity";

function chunk(id: string, score: number, ordinal = 0): SelectedChunk {
  return {
    articleId: id,
    path: `!Wiki/demo/${id}.md`,
    heading: "## Section",
    body: `Body for ${id}`,
    score,
    source: "graph",
    ordinal,
  };
}

function installTimerWindow(
  setTimeoutImpl: typeof setTimeout = globalThis.setTimeout,
  clearTimeoutImpl: typeof clearTimeout = globalThis.clearTimeout,
): () => void {
  const root = globalThis as typeof globalThis & { window?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } };
  const previous = root.window;
  root.window = { setTimeout: setTimeoutImpl, clearTimeout: clearTimeoutImpl };
  return () => {
    if (previous === undefined) delete root.window;
    else root.window = previous;
  };
}

test("normalizeRerankerConfig applies disabled legacy defaults", () => {
  assert.deepEqual(normalizeRerankerConfig(undefined), {
    enabled: false,
    model: "",
    rerankerTopN: DEFAULT_RERANKER_SETTINGS.rerankerTopN,
    contextTopN: DEFAULT_RERANKER_SETTINGS.contextTopN,
    timeoutMs: DEFAULT_RERANKER_SETTINGS.timeoutMs,
    candidateTextChars: MAX_RERANKER_CANDIDATE_TEXT_CHARS,
  });
});

test("normalizeRerankerConfig enforces rerankerTopN >= contextTopN and clamps timeout to min 100", () => {
  assert.deepEqual(
    normalizeRerankerConfig({
      enabled: true,
      model: "  custom-reranker  ",
      rerankerTopN: 3,
      contextTopN: 8,
      timeoutMs: 50,
      candidateTextChars: 60,
    }),
    {
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 8,
      contextTopN: 8,
      timeoutMs: 100,
      candidateTextChars: 80,
    },
  );
});

test("normalizeRerankerConfig defaults non-string persisted model values", () => {
  const config = normalizeRerankerConfig({ model: 123 } as unknown as Parameters<typeof normalizeRerankerConfig>[0]);

  assert.equal(config.model, DEFAULT_RERANKER_SETTINGS.model);
});

test("buildRerankerCandidates bounds candidates before adapter call", () => {
  const candidates = buildRerankerCandidates("question", [chunk("a", 3), chunk("b", 2), chunk("c", 1)], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 2,
    contextTopN: 1,
    timeoutMs: 800,
  });

  assert.deepEqual(candidates.map((item) => item.id), ["a::0", "b::0"]);
  assert.match(candidates[0].text, /Title: a/);
  assert.match(candidates[0].text, /Path: !Wiki\/demo\/a\.md/);
  assert.match(candidates[0].text, /Heading: ## Section/);
  assert.match(candidates[0].text, /Text: Body for a/);
});

test("buildRerankerCandidates truncates long candidate text before adapter call", () => {
  const long = chunk("long", 1);
  long.body = "x".repeat(MAX_RERANKER_CANDIDATE_TEXT_CHARS + 100);
  const [candidate] = buildRerankerCandidates("question", [long], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 1,
    contextTopN: 1,
    timeoutMs: 800,
  });

  assert.equal(candidate.text.length, MAX_RERANKER_CANDIDATE_TEXT_CHARS);
});

test("buildRerankerCandidates includes query-aware excerpt when token matches body", () => {
  const source = chunk("orders", 1);
  source.path = "!Wiki/demo/Orders Flow.md";
  source.heading = "## Export";
  source.body = "Intro text. The export endpoint sends orders to ClickHouse consumers. Tail text.";

  const [candidate] = buildRerankerCandidates("How does export work?", [source], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 1,
    contextTopN: 1,
    timeoutMs: 800,
  });

  assert.match(candidate.text, /Title: Orders Flow/);
  assert.match(candidate.text, /Path: !Wiki\/demo\/Orders Flow\.md/);
  assert.match(candidate.text, /Heading: ## Export/);
  assert.match(candidate.text, /Text: .*export endpoint sends orders/);
});

test("applyRerankerScores prevents a distant high-score candidate from taking top rank", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 5), chunk("b", 4), chunk("c", 3), chunk("d", 2)],
    [
      { id: "d::0", score: 1.0 },
      { id: "a::0", score: 0.1 },
      { id: "b::0", score: 0.1 },
      { id: "c::0", score: 0.1 },
    ],
    4,
  );

  assert.equal(ranked[0].articleId, "a");
  assert.notEqual(ranked[0].articleId, "d");
});

test("applyRerankerScores can preserve previous full rerank behavior for eval controls", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 3), chunk("b", 2), chunk("c", 1)],
    [
      { id: "b::0", score: 0.9 },
      { id: "a::0", score: 0.4 },
    ],
    3,
    { mode: "full" },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["b", "a", "c"]);
});

test("applyRerankerScores ignores invalid scores and preserves fallback order", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 3), chunk("b", 2), chunk("c", 1), chunk("d", 0)],
    [
      { id: "c::0", score: 0.5 },
      { id: "b::0", score: Number.NaN },
      { id: "a::0", score: Infinity },
      { id: "d::0", score: -Infinity },
    ],
    4,
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c", "d"]);
});

test("applyRerankerScores tie-breaks scored candidates by original order", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 3), chunk("b", 2), chunk("c", 1)],
    [
      { id: "b::0", score: 0.8 },
      { id: "a::0", score: 0.8 },
      { id: "c::0", score: 0.7 },
    ],
    3,
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c"]);
});

test("applyRerankerScores can promote a page once when page-aware confidence gap passes", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 5), chunk("b", 4), chunk("c", 3)],
    [
      { id: "b::0", score: 0.95 },
      { id: "a::0", score: 0.10 },
      { id: "c::0", score: 0.20 },
    ],
    3,
    {
      mode: "guarded",
      alpha: 0.60,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.50,
      minPromotionBaselineRatio: 0,
    },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["b", "a", "c"]);
});

test("applyRerankerScores blocks page promotion when confidence gap is weak", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 5), chunk("b", 4), chunk("c", 3)],
    [
      { id: "b::0", score: 0.55 },
      { id: "a::0", score: 0.50 },
      { id: "c::0", score: 0.10 },
    ],
    3,
    {
      mode: "guarded",
      alpha: 0.10,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.20,
    },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c"]);
});

test("applyRerankerScores blocks page promotion when baseline evidence is weaker", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 10), chunk("b", 5), chunk("c", 1)],
    [
      { id: "b::0", score: 0.99 },
      { id: "a::0", score: 0.10 },
      { id: "c::0", score: 0.20 },
    ],
    3,
    {
      mode: "guarded",
      alpha: 0.60,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.50,
      minPromotionBaselineRatio: 1.0,
    },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c"]);
});

test("applyRerankerScores allows page promotion when baseline evidence is comparable", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 10), chunk("b", 10), chunk("c", 1)],
    [
      { id: "b::0", score: 0.99 },
      { id: "a::0", score: 0.10 },
      { id: "c::0", score: 0.20 },
    ],
    3,
    {
      mode: "guarded",
      alpha: 0.60,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.50,
      minPromotionBaselineRatio: 1.0,
    },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["b", "a", "c"]);
});

test("applyRerankerScores blocks page promotion outside the high-precision target window", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 10), chunk("b", 10), chunk("c", 10), chunk("d", 10), chunk("e", 10)],
    [
      { id: "e::0", score: 0.99 },
      { id: "d::0", score: 0.10 },
    ],
    5,
    {
      mode: "guarded",
      alpha: 0.60,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.50,
      minPromotionBaselineRatio: 1.0,
      maxPromotionTargetIndex: 2,
    },
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c", "d", "e"]);
});

test("applyRerankerScores promotes pages instead of duplicate chunks in page-aware mode", () => {
  const a0 = chunk("a", 5, 0);
  const a1 = chunk("a", 4, 1);
  const b0 = chunk("b", 3, 0);
  const ranked = applyRerankerScores(
    [a0, a1, b0],
    [
      { id: "a::1", score: 0.99 },
      { id: "b::0", score: 0.98 },
      { id: "a::0", score: 0.10 },
    ],
    3,
    {
      mode: "guarded",
      alpha: 0.10,
      maxPromotion: 1,
      promotionScope: "page",
      minPromotionScoreGap: 0.50,
    },
  );

  assert.deepEqual(ranked.map((item) => `${item.articleId}:${item.ordinal}`), ["a:0", "b:0", "a:1"]);
});

test("rerankChunks falls back when disabled", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: false,
      model: "custom-reranker",
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
  });

  assert.equal(result.fallbackReason, "disabled");
  assert.equal(result.candidates, 0);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks falls back when model is empty", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "",
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
  });

  assert.equal(result.fallbackReason, "missing-model");
  assert.equal(result.candidates, 0);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks applies injected transport scores when adapter succeeds", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1), chunk("c", 0)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 2,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async ({ candidates }) => {
      assert.deepEqual(candidates.map((item) => item.id), ["a::0", "b::0"]);
      return [
        { id: "b::0", score: 0.99 },
        { id: "a::0", score: 0.1 },
      ];
    },
  });

  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.candidates, 2);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks default scoring can promote a comparable page into the high-precision window", async () => {
  const chunks = [chunk("a", 10), chunk("b", 9.5), chunk("c", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 3,
      contextTopN: 3,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async () => [
      { id: "b::0", score: 0.99 },
      { id: "a::0", score: 0.10 },
      { id: "c::0", score: 0.20 },
    ],
  });

  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["b", "a", "c"]);
});

test("rerankChunks sends rerankerTopN candidates while returning contextTopN chunks", async () => {
  const chunks = [
    chunk("a", 5),
    chunk("b", 4),
    chunk("c", 3),
    chunk("d", 2),
    chunk("e", 1),
  ];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 4,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async ({ candidates }) => {
      assert.deepEqual(candidates.map((item) => item.id), ["a::0", "b::0", "c::0", "d::0"]);
      return [
        { id: "d::0", score: 0.9 },
        { id: "c::0", score: 0.8 },
        { id: "b::0", score: 0.7 },
        { id: "a::0", score: 0.6 },
      ];
    },
  });

  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.candidates, 4);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks falls back on transport error preserving order and contextTopN", async () => {
  const chunks = [chunk("a", 3), chunk("b", 2), chunk("c", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 3,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async () => {
      throw new Error("adapter failed");
    },
  });

  assert.equal(result.fallbackReason, "error");
  assert.equal(result.candidates, 3);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks falls back on malformed response for invalid score", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 2,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async () => [{ id: "b::0", score: Number.NaN }],
  });

  assert.equal(result.fallbackReason, "malformed-response");
  assert.equal(result.candidates, 2);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("parseRerankerResponseText rejects malformed raw payloads", () => {
  const candidates = buildRerankerCandidates("question", [chunk("a", 2), chunk("b", 1)], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 2,
    contextTopN: 2,
    timeoutMs: 800,
  });

  for (const payload of [
    "not-json",
    "{}",
    '{"results":null}',
    '{"results":[null]}',
    '{"results":[{"index":2,"score":0.5}]}',
    '{"results":[{"index":0,"score":"0.5"}]}',
    '{"results":[{"index":0,"score":1e999}]}',
  ]) {
    assert.throws(
      () => parseRerankerResponseText(payload, candidates),
      { name: "RerankerMalformedResponseError" },
    );
  }
});

test("rerankChunks maps malformed raw payload to malformed-response", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 2,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async ({ candidates }) => parseRerankerResponseText("{}", candidates),
  });

  assert.equal(result.fallbackReason, "malformed-response");
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a", "b"]);
});

test("rerankChunks classifies timeout adapter errors as timeout", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 2,
      contextTopN: 2,
    }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    signal: new AbortController().signal,
    transport: async () => {
      throw new DOMException("Reranker timeout", "AbortError");
    },
  });

  assert.equal(result.fallbackReason, "timeout");
});

test("raceRerankerRequest rejects on in-flight abort before request settles", async () => {
  const restoreWindow = installTimerWindow();
  const ctrl = new AbortController();
  let removed = 0;
  const add = ctrl.signal.addEventListener.bind(ctrl.signal);
  const remove = ctrl.signal.removeEventListener.bind(ctrl.signal);
  ctrl.signal.addEventListener = ((type, listener, options) => add(type, listener, options)) as typeof ctrl.signal.addEventListener;
  ctrl.signal.removeEventListener = ((type, listener, options) => {
    if (type === "abort") removed += 1;
    remove(type, listener, options);
  }) as typeof ctrl.signal.removeEventListener;

  try {
    const request = raceRerankerRequest(new Promise<never>(() => undefined), ctrl.signal, 1000);
    ctrl.abort();

    await assert.rejects(request, { name: "AbortError" });
    assert.equal(removed, 1);
  } finally {
    restoreWindow();
  }
});

test("raceRerankerRequest clears timeout after fast success", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let cleared = false;

  const setTimeoutSpy = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timer = originalSetTimeout(handler, timeout, ...args);
    return timer;
  }) as typeof globalThis.setTimeout;
  const clearTimeoutSpy = ((id?: ReturnType<typeof globalThis.setTimeout>) => {
    if (id === timer) cleared = true;
    originalClearTimeout(id);
  }) as typeof globalThis.clearTimeout;
  const restoreWindow = installTimerWindow(setTimeoutSpy, clearTimeoutSpy);

  try {
    const result = await raceRerankerRequest(Promise.resolve("ok"), new AbortController().signal, 1000);

    assert.equal(result, "ok");
    assert.equal(cleared, true);
  } finally {
    restoreWindow();
  }
});
