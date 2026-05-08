import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../vitest.mock";

async function logEvent(adapter: ReturnType<typeof createMockAdapter>, line: string): Promise<void> {
  const dir = "!Logs";
  const path = `${dir}/agent.jsonl`;
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  if (await adapter.exists(path)) await adapter.append(path, line);
  else await adapter.write(path, line);
}

describe("logEvent — vault adapter writer", () => {
  it("creates !Logs and writes agent.jsonl on first event", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    expect(a.dirs.has("!Logs")).toBe(true);
    expect(a.files.get("!Logs/agent.jsonl")).toBe('{"a":1}\n');
  });

  it("appends on subsequent events", async () => {
    const a = createMockAdapter();
    await logEvent(a, '{"a":1}\n');
    await logEvent(a, '{"b":2}\n');
    expect(a.files.get("!Logs/agent.jsonl")).toBe('{"a":1}\n{"b":2}\n');
  });
});
