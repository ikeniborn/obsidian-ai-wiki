import { describe, it, expect } from "vitest";
import type { RunEvent } from "../src/types";

describe("RunEvent assistant_replace type safety", () => {
  it("assistant_replace is a valid RunEvent kind", () => {
    const ev: RunEvent = { kind: "assistant_replace", text: "fixed answer" };
    expect(ev.kind).toBe("assistant_replace");
    expect((ev as { text: string }).text).toBe("fixed answer");
  });
});
