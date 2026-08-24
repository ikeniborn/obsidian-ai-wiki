import assert from "node:assert/strict";
import test from "node:test";
import { describeUnknown } from "../src/utils/describe-unknown";

test("describeUnknown formats errors, primitives, and serializable objects", () => {
  assert.equal(describeUnknown(new Error("broken")), "broken");
  assert.equal(describeUnknown("plain"), "plain");
  assert.equal(describeUnknown(7), "7");
  assert.equal(describeUnknown(true), "true");
  assert.equal(describeUnknown(7n), "7");
  assert.equal(describeUnknown(Symbol("tag")), "tag");
  assert.equal(describeUnknown(Symbol()), "Symbol");
  assert.equal(describeUnknown(null), "null");
  assert.equal(describeUnknown(undefined), "undefined");
  assert.equal(describeUnknown({ key: "value" }), '{"key":"value"}');
});

test("describeUnknown uses a fallback for circular values", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.equal(describeUnknown(circular), "Unknown value");
});
