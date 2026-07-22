import assert from "node:assert/strict";
import test from "node:test";

import {
  createReplacementAttemptLifecycle,
  emptyLlmLifecycleState,
  humanLifecycleText,
  lifecycleEvent,
  reduceLlmLifecycle,
} from "../src/llm-lifecycle";
import type {
  LlmLifecycleLabels,
  LlmLifecyclePhase,
} from "../src/llm-lifecycle";

const labels: LlmLifecycleLabels = {
  phases: {
    preparing: "Preparing request",
    sent: "Request sent to model",
    waiting: "Waiting for model response",
    producing: "Model is producing a response",
    validating: "Validating response",
    applying: "Applying result",
    completed: "Completed",
    retrying: "Retrying request",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  actions: {
    bootstrap_domain: "Preparing domain structure",
    extract_source_facts: "Extracting source facts",
    reduce_source_evidence: "Combining source evidence",
    synthesize_wiki_pages: "Creating wiki pages",
    select_relevant_pages: "Selecting relevant pages",
    answer_question: "Answering the question",
    check_wiki_quality: "Checking wiki quality",
    apply_lint_fixes: "Applying quality fixes",
    format_note: "Formatting note",
    analyze_attachments: "Analyzing attachments",
  },
};

test("accepts the complete ordered lifecycle and guards a terminal ID", () => {
  const phases: LlmLifecyclePhase[] = [
    "preparing",
    "sent",
    "waiting",
    "producing",
    "validating",
    "applying",
    "completed",
  ];
  const state = phases.reduce(
    (current, phase) => reduceLlmLifecycle(
      current,
      lifecycleEvent("call-1", "extract_source_facts", phase, 100),
    ),
    emptyLlmLifecycleState(),
  );

  assert.equal(state.calls["call-1"].phase, "completed");
  assert.throws(
    () => reduceLlmLifecycle(
      state,
      lifecycleEvent("call-1", "extract_source_facts", "waiting", 101),
    ),
    /terminal lifecycle/i,
  );
});

test("rejects skipped, reversed, and identity-changing transitions", () => {
  const preparing = reduceLlmLifecycle(
    emptyLlmLifecycleState(),
    lifecycleEvent("call-1", "answer_question", "preparing", 10),
  );

  assert.throws(
    () => reduceLlmLifecycle(
      preparing,
      lifecycleEvent("call-1", "answer_question", "waiting", 11),
    ),
    /ordered lifecycle/i,
  );
  assert.throws(
    () => reduceLlmLifecycle(
      preparing,
      lifecycleEvent("call-1", "format_note", "sent", 11),
    ),
    /stable action/i,
  );
  assert.throws(
    () => reduceLlmLifecycle(
      preparing,
      lifecycleEvent("call-1", "answer_question", "sent", 9),
    ),
    /nondecreasing time/i,
  );
});

for (const terminal of ["retrying", "failed", "cancelled"] as const) {
  test(`${terminal} closes the current lifecycle ID`, () => {
    let state = emptyLlmLifecycleState();
    for (const phase of ["preparing", "sent", "waiting"] as const) {
      state = reduceLlmLifecycle(
        state,
        lifecycleEvent("call-1", "check_wiki_quality", phase, 10),
      );
    }
    state = reduceLlmLifecycle(
      state,
      lifecycleEvent("call-1", "check_wiki_quality", terminal, 10),
    );

    assert.equal(state.calls["call-1"].phase, terminal);
    assert.throws(
      () => reduceLlmLifecycle(
        state,
        lifecycleEvent("call-1", "check_wiki_quality", "producing", 11),
      ),
      /terminal lifecycle/i,
    );
  });
}

test("retry opens a fresh lifecycle ID at preparing", () => {
  let state = emptyLlmLifecycleState();
  for (const phase of ["preparing", "sent", "waiting", "retrying"] as const) {
    state = reduceLlmLifecycle(
      state,
      lifecycleEvent("call-1", "synthesize_wiki_pages", phase, 10),
    );
  }
  state = reduceLlmLifecycle(
    state,
    lifecycleEvent("call-2", "synthesize_wiki_pages", "preparing", 11),
  );

  assert.equal(state.calls["call-1"].phase, "retrying");
  assert.equal(state.calls["call-2"].phase, "preparing");
});

test("replacement attempt gets a fresh ID and localized retry action key", () => {
  const replacement = createReplacementAttemptLifecycle(
    { id: "call-1", action: "answer_question" },
    2,
  );
  assert.deepEqual(
    replacement,
    { id: "call-1:retry-2", action: "retry_model_request" },
  );
  assert.equal(
    humanLifecycleText(
      lifecycleEvent(replacement.id, replacement.action, "sent", 10),
      labels,
    ),
    "Retrying request — Request sent to model",
  );
});

test("human text consumes action and phase but never diagnostics", () => {
  const event = lifecycleEvent(
    "call-secret",
    "synthesize_wiki_pages",
    "waiting",
    50,
    {
      callSite: "ingest.synthesize",
      transport: "stream",
      attempt: 3,
      configuredInputBudget: 32768,
      effectiveInputBudget: 16384,
      provider: "provider secret",
    },
  );
  const rendered = humanLifecycleText(event, labels);

  assert.equal(rendered, "Creating wiki pages — Waiting for model response");
  for (const hidden of [
    "call-secret",
    "ingest.synthesize",
    "stream",
    "3",
    "32768",
    "16384",
    "provider secret",
  ]) {
    assert.equal(rendered.includes(hidden), false);
  }
});
