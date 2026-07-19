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
  LlmLifecycleWaitingTimers,
  popToolRenderFrame,
  pushToolRenderFrame,
  reduceLlmLifecycle,
  renderLifecycleScale,
  resetReasoningForLifecycle,
  shouldSuppressLegacyLlmTool,
} = await import("../src/llm-lifecycle");

class FakeScheduler {
  nowMs = 0;
  nextId = 1;
  tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.tasks.delete(id);
  };

  advance(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.nowMs = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.nowMs = target;
  }
}

class FakeNode {
  text = "";
  classes: string[] = [];
  children: FakeNode[] = [];
  htmlWrites = 0;

  empty(): void {
    this.text = "";
    this.children = [];
  }

  createDiv(arg?: string | { cls?: string; text?: string }): FakeNode {
    return this.create(arg);
  }

  createSpan(arg?: string | { cls?: string; text?: string }): FakeNode {
    return this.create(arg);
  }

  setText(text: string): void {
    this.text = text;
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  private create(arg?: string | { cls?: string; text?: string }): FakeNode {
    const child = new FakeNode();
    const cls = typeof arg === "string" ? arg : arg?.cls;
    if (cls) child.classes = cls.split(/\s+/);
    if (typeof arg === "object" && arg.text) child.text = arg.text;
    this.children.push(child);
    return child;
  }
}

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

test("two lifecycle IDs keep independent waiting timers and final durations", () => {
  const scheduler = new FakeScheduler();
  const ticks: string[] = [];
  const timers = new LlmLifecycleWaitingTimers<number>(
    {
      now: () => scheduler.nowMs,
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
    },
    (id) => ticks.push(id),
  );

  timers.start("call-1");
  scheduler.advance(500);
  timers.start("call-2");
  scheduler.advance(500);
  assert.equal(timers.elapsedMs("call-1"), 1000);
  assert.equal(timers.elapsedMs("call-2"), 500);

  timers.stop("call-1");
  scheduler.advance(500);
  assert.equal(timers.elapsedMs("call-1"), 1000);
  assert.equal(timers.elapsedMs("call-2"), 1000);
  timers.stop("call-1");
  assert.equal(timers.elapsedMs("call-1"), 1000);
  assert.equal(timers.activeCount(), 1);
  assert.ok(ticks.includes("call-1") && ticks.includes("call-2"));
});

test("retry lifecycle gets its own timer and clearAll cancels every scheduled tick", () => {
  const scheduler = new FakeScheduler();
  const timers = new LlmLifecycleWaitingTimers<number>({
    now: () => scheduler.nowMs,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });

  timers.start("call-1");
  scheduler.advance(300);
  timers.stop("call-1");
  timers.start("call-2");
  scheduler.advance(200);
  assert.equal(timers.elapsedMs("call-1"), 300);
  assert.equal(timers.elapsedMs("call-2"), 200);

  timers.clearAll();
  assert.equal(timers.activeCount(), 0);
  assert.equal(scheduler.tasks.size, 0);
});

test("new preparing lifecycle cancels pending reasoning render and starts a separate context", () => {
  const cancelled: number[] = [];
  const old = { block: { call: "call-1" }, buffer: "old reasoning", rafHandle: 7 };
  const reset = resetReasoningForLifecycle(
    lifecycleEvent("call-2", "answer_question", "preparing", 10),
    old,
    (handle) => cancelled.push(handle),
  );

  assert.deepEqual(cancelled, [7]);
  assert.deepEqual(reset, { block: null, buffer: "", rafHandle: null });
  assert.notEqual(reset, old);
});

test("suppressed nested Evidence result cannot consume unrelated visible tool result", () => {
  let frames = [] as Array<{ step: string | null; startedAt: number }>;
  frames = pushToolRenderFrame(frames, { step: null, startedAt: 10 });
  frames = pushToolRenderFrame(frames, { step: "Read", startedAt: 20 });

  const readResult = popToolRenderFrame(frames);
  assert.equal(readResult.frame?.step, "Read");
  const evidenceResult = popToolRenderFrame(readResult.frames);
  assert.equal(evidenceResult.frame?.step, null);
});

test("fake DOM renderer exposes only localized human text and uses text nodes", () => {
  const root = new FakeNode();
  const labels = i18nFor("en").llmLifecycle;
  const event = lifecycleEvent("call-secret", "answer_question", "waiting", 100, {
    callSite: "query.answer",
    transport: "stream",
    attempt: 9,
    configuredInputBudget: 32768,
    provider: '<img src=x onerror="steal()">',
  });

  renderLifecycleScale(root, lifecycleScale(event, labels, 1200));

  assert.match(root.textContent, /Answering the question/);
  assert.match(root.textContent, /Waiting for model response · 1\.2s/);
  for (const hidden of ["call-secret", "query.answer", "stream", "32768", "onerror", "steal"]) {
    assert.equal(root.textContent.includes(hidden), false);
  }
  assert.equal(root.htmlWrites, 0);
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
  assert.doesNotMatch(appendEvent, /suppressNextToolResult/);
  assert.match(appendEvent, /pushToolRenderFrame/);
  assert.match(appendEvent, /popToolRenderFrame/);
});

test("view clears all lifecycle timers at reset, finish, and close", () => {
  const source = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  for (const [start, end] of [
    ["async onClose(): Promise<void>", "private buildDomainRow"],
    ["setRunning(operation: WikiOperation", "appendEvent(ev: RunEvent)"],
    ["async finish(entry: RunHistoryEntry)", "private showChatSection"],
  ]) {
    const block = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(block, /llmWaitingTimers\.clearAll\(\)/, `${start} must clear timers`);
  }
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
