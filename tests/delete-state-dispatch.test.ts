import assert from "node:assert/strict";
import test from "node:test";
import type { DeleteStateCommitEvent, RunEvent } from "../src/types";
import { processDeleteStateCommitForDispatch } from "../src/delete-state-dispatch";

const event: DeleteStateCommitEvent = {
  kind: "delete_state_commit",
  domainId: "d",
  journalPath: "!Wiki/d/delete-journal.json",
  journalHash: "sha256:placeholder",
  metadataPath: "!Wiki/d/metadata.jsonl",
  sourcePathAdds: [],
  sourcePathRemoved: "sources/source.md",
  analyzedRemoval: { path: "sources/source.md", beforeHash: "old-hash" },
  entityTypeDeltas: [],
};

test("delete state commit is persisted before it is logged or displayed", async () => {
  const order: string[] = [];
  const result = await processDeleteStateCommitForDispatch(event, {
    async persist() {
      order.push("persist");
      return { journalHash: `sha256:${"b".repeat(64)}` };
    },
    async log(record: RunEvent) {
      order.push(`log:${record.kind}`);
    },
    append(record: RunEvent) {
      order.push(`append:${record.kind}`);
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(order, [
    "persist",
    "log:delete_state_commit",
    "append:delete_state_commit",
  ]);
});

test("delete publication failure emits a concrete error without exposing commit event", async () => {
  const order: string[] = [];
  const result = await processDeleteStateCommitForDispatch(event, {
    async persist() {
      order.push("persist");
      throw new Error("metadata expected-before conflict");
    },
    async log(record: RunEvent) {
      order.push(`log:${record.kind}:${record.kind === "error" ? record.message : ""}`);
    },
    append(record: RunEvent) {
      order.push(`append:${record.kind}:${record.kind === "error" ? record.message : ""}`);
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /metadata expected-before conflict/);
  }
  assert.deepEqual(order, [
    "persist",
    "log:error:Delete state publication failed: metadata expected-before conflict",
    "append:error:Delete state publication failed: metadata expected-before conflict",
  ]);
});

test("successful dispatch binds the live event to the exact published receipt", async () => {
  const liveEvent = { ...event };
  const receiptHash = `sha256:${"a".repeat(64)}`;
  const result = await processDeleteStateCommitForDispatch(liveEvent, {
    async persist() {
      return { journalHash: receiptHash } as never;
    },
    async log() {},
    append() {},
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(liveEvent.receiptHash, receiptHash);
});
