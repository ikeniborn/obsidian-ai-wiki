import { describe, it, expect, beforeEach } from "vitest";
import { GraphCache } from "../src/wiki-graph-cache";

function pages(entries: [string, string][]): Map<string, string> {
  return new Map(entries);
}

describe("GraphCache", () => {
  let cache: GraphCache;
  beforeEach(() => { cache = new GraphCache(); });

  it("returns fromCache=false on first get", () => {
    const r = cache.get("d1", pages([["a.md", "x"]]));
    expect(r.fromCache).toBe(false);
    expect(r.graph.has("a")).toBe(true);
  });

  it("returns fromCache=true on second get with same pages", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    const r = cache.get("d1", p);
    expect(r.fromCache).toBe(true);
  });

  it("rebuilds after invalidate", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    cache.invalidate("d1");
    expect(cache.get("d1", p).fromCache).toBe(false);
  });

  it("rebuilds when page content length changes", () => {
    cache.get("d1", pages([["a.md", "x"]]));
    const r = cache.get("d1", pages([["a.md", "xx"]]));
    expect(r.fromCache).toBe(false);
  });

  it("rebuilds when pages added", () => {
    cache.get("d1", pages([["a.md", "x"]]));
    const r = cache.get("d1", pages([["a.md", "x"], ["b.md", "y"]]));
    expect(r.fromCache).toBe(false);
  });

  it("rebuilds when pages removed", () => {
    cache.get("d1", pages([["a.md", "x"], ["b.md", "y"]]));
    const r = cache.get("d1", pages([["a.md", "x"]]));
    expect(r.fromCache).toBe(false);
  });

  it("clear empties all entries", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    cache.clear();
    expect(cache.get("d1", p).fromCache).toBe(false);
  });

  it("different domainIds do not collide", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    expect(cache.get("d2", p).fromCache).toBe(false);
  });

  it("invalidate of missing key is a no-op", () => {
    expect(() => cache.invalidate("missing")).not.toThrow();
  });
});
