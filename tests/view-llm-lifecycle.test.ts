import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { i18nFor } = await import("../src/i18n");
const {
  emptyLlmLifecycleState,
  lifecycleEvent,
  lifecycleScale,
  reduceLlmLifecycle,
  shouldSuppressLegacyLlmTool,
} = await import("../src/llm-lifecycle");

test("EN RU ES lifecycle labels have identical phase and action shapes", () => {
  const locales = ["en", "ru", "es"] as const;
  const bundles = locales.map((locale) => i18nFor(locale).llmLifecycle);
  const phaseKeys = Object.keys(bundles[0].phases);
  const actionKeys = Object.keys(bundles[0].actions);

  for (const bundle of bundles) {
    assert.deepEqual(Object.keys(bundle.phases), phaseKeys);
    assert.deepEqual(Object.keys(bundle.actions), actionKeys);
    assert.equal(Object.values(bundle.phases).every(Boolean), true);
    assert.equal(Object.values(bundle.actions).every(Boolean), true);
  }
});

test("scale contains every human phase and one terminal slot in place", () => {
  const labels = i18nFor("en").llmLifecycle;
  const waiting = lifecycleScale(
    lifecycleEvent("call-1", "answer_question", "waiting", 100, {
      callSite: "query.answer",
      transport: "stream",
      attempt: 3,
      configuredInputBudget: 32768,
      provider: "provider secret",
    }),
    labels,
    2300,
  );

  assert.deepEqual(
    waiting.items.map((item) => item.key),
    ["preparing", "sent", "waiting", "producing", "validating", "applying", "terminal"],
  );
  assert.deepEqual(
    waiting.items.map((item) => item.state),
    ["completed", "completed", "current", "pending", "pending", "pending", "pending"],
  );
  assert.match(waiting.items[2].text, /2\.3s/);

  const completed = lifecycleScale(
    lifecycleEvent("call-1", "answer_question", "completed", 200),
    labels,
  );
  assert.equal(completed.items.at(-1)?.text, labels.phases.completed);
  assert.equal(completed.items.at(-1)?.state, "completed");

  const rendered = JSON.stringify(waiting);
  for (const hidden of [
    "call-1",
    "query.answer",
    "stream",
    "attempt",
    "32768",
    "provider secret",
  ]) {
    assert.equal(rendered.includes(hidden), false);
  }
});

test("early failure leaves unvisited phases pending", () => {
  const labels = i18nFor("en").llmLifecycle;
  const failed = lifecycleScale(
    lifecycleEvent("call-1", "answer_question", "failed", 200),
    labels,
    undefined,
    "waiting",
  );

  assert.deepEqual(
    failed.items.map((item) => item.state),
    ["completed", "completed", "completed", "pending", "pending", "pending", "failed"],
  );
});

test("legacy Evidence tools are hidden only while their lifecycle action is active", () => {
  const empty = emptyLlmLifecycleState();
  const mapping = reduceLlmLifecycle(
    empty,
    lifecycleEvent("call-1", "extract_source_facts", "preparing", 10),
  );

  assert.equal(shouldSuppressLegacyLlmTool("Evidence mapping", empty), false);
  assert.equal(shouldSuppressLegacyLlmTool("Evidence mapping", mapping), true);
  assert.equal(shouldSuppressLegacyLlmTool("Evidence reduction", mapping), false);
  assert.equal(shouldSuppressLegacyLlmTool("Read", mapping), false);
});

test("view routes lifecycle before tools and no longer starts waiting from tool_result", () => {
  const source = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  const appendEvent = source.slice(
    source.indexOf("appendEvent(ev: RunEvent): void"),
    source.indexOf("private renderQueryStats"),
  );
  const lifecycleBranch = appendEvent.indexOf('ev.kind === "llm_lifecycle"');
  const toolBranch = appendEvent.indexOf('ev.kind === "tool_use"');
  const toolResultBranch = appendEvent.slice(
    appendEvent.indexOf('ev.kind === "tool_result"'),
    appendEvent.indexOf('ev.kind === "ask_user"'),
  );

  assert.ok(lifecycleBranch >= 0 && lifecycleBranch < toolBranch);
  assert.doesNotMatch(toolResultBranch, /startWaiting/);
  assert.match(appendEvent, /renderLlmLifecycle/);
  assert.match(appendEvent, /shouldSuppressLegacyLlmTool/);
});

test("lifecycle CSS uses only the approved presentation states", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const states = [...css.matchAll(/ai-wiki-llm-phase--([a-z-]+)/g)]
    .map((match) => match[1]);

  assert.deepEqual(
    [...new Set(states)].sort(),
    ["completed", "current", "failed", "pending"],
  );
});
