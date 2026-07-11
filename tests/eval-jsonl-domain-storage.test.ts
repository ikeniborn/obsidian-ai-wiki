import assert from "node:assert/strict";
import test from "node:test";
import { buildHldQueries, classifyAggregateVerdict } from "../scripts/eval-jsonl-domain-storage";

test("HLD eval defines five fixed query themes", () => {
  assert.equal(buildHldQueries().length, 5);
});

test("aggregate verdict cannot be accepted without baseline", () => {
  assert.equal(classifyAggregateVerdict({ baselineAvailable: false, regressions: [], formatWorked: true }), "needs_tuning");
});
