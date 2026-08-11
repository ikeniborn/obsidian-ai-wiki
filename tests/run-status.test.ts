import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "../src/types";
import {
  finalizeRunStatus,
  reduceRunStatus,
  type RunTerminalStatus,
} from "../src/run-status";

function reduceEvents(events: RunEvent[]): RunTerminalStatus {
  return events.reduce(reduceRunStatus, "done" as RunTerminalStatus);
}

test("initial and successful file outcomes remain done", () => {
  assert.equal(reduceEvents([]), "done");
  assert.equal(reduceEvents([
    { kind: "file_outcome", file: "a.md", status: "done" },
  ]), "done");
});

test("failed file attempt followed by Retry recovery remains done", () => {
  assert.equal(reduceEvents([
    {
      kind: "file_attempt",
      file: "a.md",
      attempt: 1,
      state: "failed",
      retryable: true,
      message: "synthetic failure",
    },
    {
      kind: "file_attempt",
      file: "a.md",
      attempt: 1,
      state: "retry_scheduled",
      retryable: true,
    },
    {
      kind: "file_attempt",
      file: "a.md",
      attempt: 2,
      state: "recovered",
      retryable: false,
    },
    { kind: "file_outcome", file: "a.md", status: "done" },
  ]), "done");
});

test("skipped and exhausted file outcomes are errors", () => {
  for (const status of ["skipped", "exhausted"] as const) {
    assert.equal(reduceEvents([
      { kind: "file_outcome", file: "a.md", status },
    ]), "error");
  }
});

test("stopped file outcome and user abort are cancelled", () => {
  assert.equal(reduceEvents([
    { kind: "file_outcome", file: "a.md", status: "stopped" },
  ]), "cancelled");
  assert.equal(
    finalizeRunStatus("done", { aborted: true, timedOut: false }),
    "cancelled",
  );
});

test("global error is monotonic and dominates later success and abort", () => {
  const status = reduceEvents([
    { kind: "error", message: "global failure" },
    { kind: "file_outcome", file: "a.md", status: "done" },
    { kind: "exit", code: 0 },
  ]);
  assert.equal(status, "error");
  assert.equal(
    finalizeRunStatus(status, { aborted: true, timedOut: false }),
    "error",
  );
});

test("non-zero exit is an error and zero exit preserves status", () => {
  assert.equal(reduceEvents([{ kind: "exit", code: 1 }]), "error");
  assert.equal(reduceEvents([{ kind: "exit", code: 0 }]), "done");
  assert.equal(
    reduceRunStatus("cancelled", { kind: "exit", code: 0 }),
    "cancelled",
  );
});

test("timeout is an error regardless of prior status or abort", () => {
  assert.equal(
    finalizeRunStatus("done", { aborted: true, timedOut: true }),
    "error",
  );
  assert.equal(
    finalizeRunStatus("cancelled", { aborted: true, timedOut: true }),
    "error",
  );
});

test("file_attempt is non-terminal for every current status", () => {
  const attempt: RunEvent = {
    kind: "file_attempt",
    file: "a.md",
    attempt: 1,
    state: "failed",
    retryable: false,
  };
  for (const status of ["done", "cancelled", "error"] as const) {
    assert.equal(reduceRunStatus(status, attempt), status);
  }
});
