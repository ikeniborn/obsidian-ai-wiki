import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../vitest.mock";

async function logEvent(adapter: ReturnType<typeof createMockAdapter>, line: string): Promise<void> {
  if (!(await adapter.exists("!Wiki"))) await adapter.mkdir("!Wiki");
  if (!(await adapter.exists("!Wiki/.config"))) await adapter.mkdir("!Wiki/.config");
  const path = "!Wiki/.config/_agent.jsonl";
  if (await adapter.exists(path)) await adapter.append(path, line);
  else await adapter.write(path, line);
}

describe("logEvent — vault adapter writer", () => {
  it("creates !Wiki/.config and writes _agent.jsonl on first event", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    expect(a.dirs.has("!Wiki")).toBe(true);
    expect(a.dirs.has("!Wiki/.config")).toBe(true);
    expect(a.files.get("!Wiki/.config/_agent.jsonl")).toBe('{"a":1}\n');
  });

  it("appends on subsequent events", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    await logEvent(a, '{"b":2}\n');
    expect(a.files.get("!Wiki/.config/_agent.jsonl")).toBe('{"a":1}\n{"b":2}\n');
  });
});
