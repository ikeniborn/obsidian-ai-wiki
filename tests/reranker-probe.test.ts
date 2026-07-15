import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { probeRerankerModel, normalizeRerankerConfig } = await import("../src/reranker");
import type { RerankerTransport } from "../src/reranker";

const cfg = normalizeRerankerConfig({ enabled: true, model: "rr" });

test("probeRerankerModel returns ok when the transport yields scores", async () => {
  const transport: RerankerTransport = async () => [{ id: "probe", score: 1 }];
  assert.deepEqual(await probeRerankerModel("http://x", "k", cfg, transport), { ok: true });
});

test("probeRerankerModel surfaces the transport error", async () => {
  const transport: RerankerTransport = async () => { throw new Error("rerank 500 provider error"); };
  const r = await probeRerankerModel("http://x", "k", cfg, transport);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /rerank 500 provider error/);
});

test("probeRerankerModel treats an empty score list as failure", async () => {
  const transport: RerankerTransport = async () => [];
  const r = await probeRerankerModel("http://x", "k", cfg, transport);
  assert.equal(r.ok, false);
});
