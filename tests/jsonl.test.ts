import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonl, stringifyJsonl } from "../src/jsonl";

test("parseJsonl returns one object per non-empty line", () => {
  assert.deepEqual(parseJsonl('{"a":1}\n\n{"b":2}\n', "sample.jsonl"), [{ a: 1 }, { b: 2 }]);
});

test("parseJsonl reports path and line for malformed JSON", () => {
  assert.throws(
    () => parseJsonl('{"a":1}\n{bad}\n', "sample.jsonl"),
    /sample\.jsonl:2:/,
  );
});

test("stringifyJsonl writes one complete JSON record per line", () => {
  assert.equal(stringifyJsonl([{ a: 1 }, { b: "x" }]), '{"a":1}\n{"b":"x"}\n');
});
