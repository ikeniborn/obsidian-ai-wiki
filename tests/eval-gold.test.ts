import { describe, it, expect } from "vitest";
import { parseGold } from "../scripts/eval-gold";

describe("parseGold", () => {
  it("parses an array of {q, gold} pairs", () => {
    const raw = JSON.stringify([
      { q: "как работает ingest", gold: ["Ingest", "Embedding-Cache"] },
      { q: "что делает BFS", gold: ["Query-Graph-Traversal"] },
    ]);
    const pairs = parseGold(raw);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].q).toBe("как работает ingest");
    expect(pairs[0].gold).toEqual(["Ingest", "Embedding-Cache"]);
  });

  it("throws on an empty gold set", () => {
    expect(() => parseGold("[]")).toThrow(/empty/i);
  });

  it("throws when a pair is missing q or has empty gold", () => {
    expect(() => parseGold(JSON.stringify([{ gold: ["A"] }]))).toThrow(/q/i);
    expect(() => parseGold(JSON.stringify([{ q: "x", gold: [] }]))).toThrow(/gold/i);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseGold("{not json")).toThrow();
  });
});
