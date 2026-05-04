import { describe, it, expect } from "vitest";
import { parseEvalResponse } from "../src/phases/evaluator";

describe("parseEvalResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseEvalResponse('{"score": 8, "reasoning": "Good result."}');
    expect(result).toEqual({ score: 8, reasoning: "Good result." });
  });

  it("parses JSON embedded in text", () => {
    const result = parseEvalResponse('Here is my assessment:\n{"score": 7, "reasoning": "Ok."}');
    expect(result).toEqual({ score: 7, reasoning: "Ok." });
  });

  it("returns null for invalid JSON", () => {
    expect(parseEvalResponse("not json")).toBeNull();
  });

  it("returns null for missing fields", () => {
    expect(parseEvalResponse('{"score": 8}')).toBeNull();
  });

  it("clamps score to 0-10", () => {
    const result = parseEvalResponse('{"score": 15, "reasoning": "x"}');
    expect(result?.score).toBe(10);
  });
});
