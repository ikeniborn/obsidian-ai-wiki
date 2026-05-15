import { describe, it, expect } from "vitest";
import { parseTimeoutString } from "../src/settings";

describe("parseTimeoutString", () => {
  it("valid 5-part string → all values", () => {
    const r = parseTimeoutString("300/300/900/3600/600");
    expect(r).toEqual({ ingest: 300, query: 300, lint: 900, init: 3600, format: 600 });
  });

  it("4-part string → null (rejected)", () => {
    expect(parseTimeoutString("300/300/900/3600")).toBeNull();
  });

  it("non-numeric part → null", () => {
    expect(parseTimeoutString("300/300/900/abc/600")).toBeNull();
  });

  it("zero value → null", () => {
    expect(parseTimeoutString("300/300/900/0/600")).toBeNull();
  });
});
