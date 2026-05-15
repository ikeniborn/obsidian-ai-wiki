import { describe, it, expect, beforeEach } from "vitest";
import { structuralErrorCounter } from "../src/structural-error-counter";

describe("structuralErrorCounter", () => {
  beforeEach(() => structuralErrorCounter.reset());

  it("starts zeroed", () => {
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("records ok for first-attempt success", () => {
    structuralErrorCounter.record(true, 0);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 1 });
  });

  it("records retried for success after retry", () => {
    structuralErrorCounter.record(true, 1);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 1, ok: 0 });
  });

  it("records failed for exhausted attempts", () => {
    structuralErrorCounter.record(false, 1);
    expect(structuralErrorCounter.get()).toEqual({ failed: 1, retried: 0, ok: 0 });
  });

  it("noop on succeeded=null", () => {
    structuralErrorCounter.record(null, 0);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("notifies subscribers on each record", () => {
    const calls: Array<{ failed: number; retried: number; ok: number }> = [];
    structuralErrorCounter.subscribe((s) => calls.push(s));
    structuralErrorCounter.record(true, 0);
    structuralErrorCounter.record(false, 1);
    expect(calls).toEqual([
      { failed: 0, retried: 0, ok: 1 },
      { failed: 1, retried: 0, ok: 1 },
    ]);
  });

  it("unsubscribe stops notifications", () => {
    let count = 0;
    const unsub = structuralErrorCounter.subscribe(() => count++);
    structuralErrorCounter.record(true, 0);
    unsub();
    structuralErrorCounter.record(true, 0);
    expect(count).toBe(1);
  });

  it("reset clears stats", () => {
    structuralErrorCounter.record(true, 0);
    structuralErrorCounter.record(false, 1);
    structuralErrorCounter.reset();
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("subscribers receive snapshot copies (no mutation leak)", () => {
    let snap: { failed: number; retried: number; ok: number } | null = null;
    structuralErrorCounter.subscribe((s) => { snap = s; });
    structuralErrorCounter.record(true, 0);
    const internal = structuralErrorCounter.get();
    expect(snap).not.toBe(internal);
  });
});
