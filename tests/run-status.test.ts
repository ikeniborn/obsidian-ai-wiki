import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "../src/types";
import {
  finalizeRunStatus,
  hardRunError,
  INITIAL_RUN_STATUS,
  reduceRunStatus,
  type RunStatusState,
  type RunTerminalStatus,
} from "../src/run-status";

function reduceState(events: RunEvent[]): RunStatusState {
  return events.reduce(reduceRunStatus, INITIAL_RUN_STATUS);
}

function reduceEvents(
  events: RunEvent[],
  options: { aborted: boolean; timedOut: boolean } = { aborted: false, timedOut: false },
): RunTerminalStatus {
  return finalizeRunStatus(reduceState(events), options);
}

function attempt(
  state: "failed" | "retry_scheduled" | "recovered",
  file = "a.md",
): RunEvent {
  return { kind: "file_attempt", file, attempt: 1, state, retryable: true };
}

test("initial and successful file outcomes remain done", () => {
  assert.equal(reduceEvents([]), "done");
  assert.equal(reduceEvents([
    { kind: "file_outcome", file: "a.md", status: "done" },
  ]), "done");
});

test("failed file attempt followed by Retry recovery remains done", () => {
  assert.equal(reduceEvents([
    attempt("failed"),
    attempt("retry_scheduled"),
    attempt("recovered"),
    { kind: "file_outcome", file: "a.md", status: "done" },
  ]), "done");
});

test("an error raised by a failed attempt is superseded by a successful Retry", () => {
  assert.equal(reduceEvents([
    { kind: "error", message: "synthetic source failure" },
    attempt("failed"),
    attempt("retry_scheduled"),
    attempt("recovered"),
    { kind: "file_outcome", file: "a.md", status: "done" },
  ]), "done");
});

test("an error with no recovery still finishes error", () => {
  assert.equal(reduceEvents([
    { kind: "error", message: "synthetic source failure" },
    { kind: "file_outcome", file: "a.md", status: "done" },
    { kind: "exit", code: 0 },
  ]), "error");
});

test("recovery of one file does not clear a later unrecovered error", () => {
  assert.equal(reduceEvents([
    { kind: "error", message: "a.md failed" },
    attempt("recovered"),
    { kind: "file_outcome", file: "a.md", status: "done" },
    { kind: "error", message: "b.md failed" },
    { kind: "file_outcome", file: "b.md", status: "skipped" },
  ]), "error");
});

test("skipped and exhausted file outcomes are errors that recovery cannot clear", () => {
  for (const status of ["skipped", "exhausted"] as const) {
    assert.equal(reduceEvents([
      { kind: "file_outcome", file: "a.md", status },
    ]), "error");
    assert.equal(reduceEvents([
      { kind: "file_outcome", file: "a.md", status },
      attempt("recovered", "b.md"),
      { kind: "file_outcome", file: "b.md", status: "done" },
    ]), "error");
  }
});

test("stopped file outcome and user abort are cancelled", () => {
  assert.equal(reduceEvents([
    { kind: "file_outcome", file: "a.md", status: "stopped" },
  ]), "cancelled");
  assert.equal(
    finalizeRunStatus(INITIAL_RUN_STATUS, { aborted: true, timedOut: false }),
    "cancelled",
  );
});

test("an unrecovered error dominates a later abort", () => {
  assert.equal(reduceEvents(
    [{ kind: "error", message: "global failure" }],
    { aborted: true, timedOut: false },
  ), "error");
});

test("a hard error is monotonic and dominates later success and abort", () => {
  const state = hardRunError(reduceState([]));
  assert.equal(finalizeRunStatus(state, { aborted: true, timedOut: false }), "error");
  assert.equal(
    finalizeRunStatus(
      [attempt("recovered"), { kind: "file_outcome", file: "a.md", status: "done" } as RunEvent]
        .reduce(reduceRunStatus, state),
      { aborted: false, timedOut: false },
    ),
    "error",
  );
});

test("non-zero exit is an error and zero exit preserves status", () => {
  assert.equal(reduceEvents([{ kind: "exit", code: 1 }]), "error");
  assert.equal(reduceEvents([{ kind: "exit", code: 0 }]), "done");
  assert.equal(
    reduceEvents([
      { kind: "file_outcome", file: "a.md", status: "stopped" },
      { kind: "exit", code: 0 },
    ]),
    "cancelled",
  );
});

test("a non-zero exit cannot be cleared by a later recovery", () => {
  assert.equal(reduceEvents([
    { kind: "exit", code: 1 },
    attempt("recovered"),
  ]), "error");
});

test("timeout is an error regardless of prior status or abort", () => {
  assert.equal(
    finalizeRunStatus(INITIAL_RUN_STATUS, { aborted: true, timedOut: true }),
    "error",
  );
  assert.equal(
    finalizeRunStatus(
      reduceState([{ kind: "file_outcome", file: "a.md", status: "stopped" }]),
      { aborted: true, timedOut: true },
    ),
    "error",
  );
});

test("a failed file_attempt is non-terminal on its own", () => {
  assert.equal(reduceEvents([attempt("failed")]), "done");
});
