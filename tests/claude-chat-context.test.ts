import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { Readable } from "node:stream";
import test from "node:test";
import type OpenAI from "openai";
import { z } from "zod";
import type { LlmLifecycleLabels } from "../src/llm-lifecycle";
import type { LlmClient, RunEvent } from "../src/types";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  configurable: true,
});

const { ClaudeCliClient } = await import("../src/claude-cli-client");
const { Platform } = await import("obsidian");
const {
  createLlmLifecycle,
  runStructuredStreaming,
} = await import("../src/phases/structured-output");
const { humanLifecycleText } = await import("../src/llm-lifecycle");

const labels = {
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
} satisfies LlmLifecycleLabels;

function assistantBlocks(blocks: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: blocks },
  });
}

function assistantLine(block: Record<string, unknown>): string {
  return assistantBlocks([block]);
}

async function withClaudeCli<T>(
  lines: string[],
  work: (client: InstanceType<typeof ClaudeCliClient>) => Promise<T>,
  trailingNewline = true,
  processOutput: { stderr?: string; exitCode?: number } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-ai-wiki-claude-"));
  const executable = join(dir, "claude-fixture.mjs");
  const payload = `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      `process.stdout.write(${JSON.stringify(payload)});`,
      processOutput.stderr
        ? `process.stderr.write(${JSON.stringify(processOutput.stderr)});`
        : "",
      `process.exitCode = ${processOutput.exitCode ?? 0};`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(executable, 0o700);
  const client = new ClaudeCliClient({
    iclaudePath: executable,
    model: "claude-test",
    requestTimeoutSec: 5,
    tmpDir: dir,
    tmpWrite: async () => {},
    tmpRemove: () => {},
  });
  try {
    return await work(client);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function request(stream: boolean) {
  return {
    model: "claude-test",
    stream,
    messages: [{ role: "user" as const, content: "Answer." }],
  };
}

async function collectStream(
  client: InstanceType<typeof ClaudeCliClient>,
): Promise<OpenAI.Chat.ChatCompletionChunk[]> {
  const response = await client.chat.completions.create(request(true));
  const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
  for await (const chunk of response as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
    chunks.push(chunk);
  }
  return chunks;
}

async function captureRejection(work: () => Promise<unknown>): Promise<Error> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail("Missing expected rejection.");
}

test("Claude streaming preserves every ordered text and thinking block", async () => {
  await withClaudeCli([
    assistantBlocks([
      { type: "thinking", thinking: "reason-1" },
      { type: "text", text: "text-1" },
      { type: "tool_use", name: "HiddenTool", input: { secret: "tool-secret" } },
      { type: "thinking", thinking: "reason-2" },
      { type: "text", text: "text-2" },
    ]),
    assistantBlocks([
      { type: "text", text: "text-3" },
      { type: "thinking", thinking: "reason-3" },
    ]),
  ], async (client) => {
    const chunks = await collectStream(client);
    const deltas = chunks
      .map((chunk) => chunk.choices[0]?.delta as Record<string, unknown>)
      .filter((delta) => Object.keys(delta).length > 0);

    assert.deepEqual(deltas, [
      { reasoning: "reason-1" },
      { content: "text-1" },
      { reasoning: "reason-2" },
      { content: "text-2" },
      { content: "text-3" },
      { reasoning: "reason-3" },
    ]);
    assert.equal(JSON.stringify(deltas).includes("tool-secret"), false);
  });
});

test("Claude non-stream preserves multiple blocks and keeps redacted thinking opaque", async () => {
  await withClaudeCli([
    assistantBlocks([
      { type: "redacted_thinking", data: "redacted-secret" },
      { type: "text", text: "text-a" },
      { type: "thinking", thinking: "reason-a" },
      { type: "text", text: "text-b" },
      { type: "thinking", thinking: "reason-b" },
      { type: "tool_use", name: "HiddenTool", input: { secret: "tool-secret" } },
    ]),
  ], async (client) => {
    const response = await client.chat.completions.create(request(false));
    const message = (
      response as OpenAI.Chat.ChatCompletion
    ).choices[0]?.message as OpenAI.Chat.ChatCompletionMessage & Record<string, unknown>;

    assert.equal(message.content, "text-atext-b");
    assert.equal(message.reasoning, "reason-areason-b");
    assert.equal(JSON.stringify(message).includes("redacted-secret"), false);
    assert.equal(JSON.stringify(message).includes("tool-secret"), false);
  });
});

test("Claude streaming exposes thinking and final text as separate OpenAI deltas", async () => {
  await withClaudeCli([
    assistantLine({ type: "thinking", thinking: "Inspect context." }),
    assistantLine({ type: "redacted_thinking", data: "opaque-redacted-stream" }),
    assistantLine({ type: "text", text: "Final answer." }),
  ], async (client) => {
    const response = await client.chat.completions.create(request(true));
    const deltas: Array<Record<string, unknown>> = [];
    for await (const chunk of response as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      deltas.push(chunk.choices[0]?.delta as Record<string, unknown>);
    }

    assert.equal(deltas.map((delta) => delta.reasoning ?? "").join(""), "Inspect context.");
    assert.equal(deltas.map((delta) => delta.content ?? "").join(""), "Final answer.");
    assert.equal(JSON.stringify(deltas).includes("opaque-redacted-stream"), false);
  }, false);
});

test("malformed midstream JSON rejects with neutral line metadata", async () => {
  await withClaudeCli([
    assistantLine({ type: "text", text: "partial-before-error" }),
    "{\"type\":\"assistant\",\"sensitive\":\"MIDSTREAM_SECRET\"",
    assistantLine({ type: "text", text: "must-not-complete" }),
  ], async (client) => {
    const error = await captureRejection(() => collectStream(client));
    assert.match(error.message, /line 2.*bytes/i);
    assert.doesNotMatch(error.message, /MIDSTREAM_SECRET|partial-before-error|must-not-complete/);
  });
});

test("malformed EOF JSON rejects non-stream completion with neutral metadata", async () => {
  await withClaudeCli([
    assistantLine({ type: "text", text: "partial-before-eof" }),
    "{\"type\":\"assistant\",\"sensitive\":\"EOF_SECRET\"",
  ], async (client) => {
    const error = await captureRejection(
      () => client.chat.completions.create(request(false)),
    );
    assert.match(error.message, /line 2.*bytes/i);
    assert.doesNotMatch(error.message, /EOF_SECRET|partial-before-eof/);
  }, false);
});

test("Claude non-stream completion retains reasoning separately from content", async () => {
  await withClaudeCli([
    assistantLine({ type: "text", text: "Separate final." }),
    assistantLine({ type: "redacted_thinking", data: "opaque-redacted-completion" }),
    assistantLine({ type: "thinking", thinking: "Check evidence." }),
  ], async (client) => {
    const response = await client.chat.completions.create(request(false));
    const message = (
      response as OpenAI.Chat.ChatCompletion
    ).choices[0]?.message as OpenAI.Chat.ChatCompletionMessage & Record<string, unknown>;

    assert.equal(message.reasoning, "Check evidence.");
    assert.equal(message.content, "Separate final.");
    assert.equal(String(message.content).includes("Check evidence."), false);
    assert.equal(JSON.stringify(message).includes("opaque-redacted-completion"), false);
  }, false);
});

test("slow Claude stream applies stdout backpressure and emits one completion", async () => {
  const lines = Array.from({ length: 256 }, (_, index) =>
    assistantLine({ type: "text", text: `${index},` }));
  const originalPause = Readable.prototype.pause;
  const originalResume = Readable.prototype.resume;
  let pauses = 0;
  let resumes = 0;
  Readable.prototype.pause = function patchedPause() {
    if (new Error().stack?.includes("claude-cli-client.ts")) pauses += 1;
    return originalPause.call(this);
  };
  Readable.prototype.resume = function patchedResume() {
    if (new Error().stack?.includes("claude-cli-client.ts")) resumes += 1;
    return originalResume.call(this);
  };
  try {
    await withClaudeCli(lines, async (client) => {
      const response = await client.chat.completions.create(request(true));
      const iterator = (
        response as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
      )[Symbol.asyncIterator]();
      const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
      chunks.push((await iterator.next()).value);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      assert.ok(pauses >= 1, "stdout must pause at the queue high-water mark");
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        chunks.push(next.value);
      }

      const content = chunks.map((chunk) =>
        (chunk.choices[0]?.delta as { content?: string })?.content ?? ""
      ).join("");
      assert.equal(content, Array.from({ length: 256 }, (_, index) => `${index},`).join(""));
      assert.equal(chunks.filter((chunk) =>
        chunk.choices[0]?.finish_reason === "stop").length, 1);
      assert.ok(pauses >= 2, "stdout must pause repeatedly while the consumer drains");
      assert.ok(resumes >= 2, "stdout must resume repeatedly below the queue low-water mark");
    });
  } finally {
    Readable.prototype.pause = originalPause;
    Readable.prototype.resume = originalResume;
  }
});

test("large sensitive stderr is bounded and absent from thrown errors", async () => {
  const sensitive = `AUTH_TOKEN_DO_NOT_EXPOSE_${"x".repeat(1024)}`;
  await withClaudeCli([], async (client) => {
    const error = await captureRejection(
      () => client.chat.completions.create(request(false)),
    );
    assert.equal(error.message.includes("AUTH_TOKEN_DO_NOT_EXPOSE"), false);
    assert.equal(error.message.includes("xxx"), false);
    assert.ok(error.message.length < 200);
  }, true, {
    stderr: sensitive.repeat(1024),
    exitCode: 7,
  });
});

test("pre-aborted non-stream request rejects before spawn and removes temp prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-ai-wiki-pre-abort-"));
  const marker = join(dir, "spawned.marker");
  const executable = join(dir, "claude-pre-abort.mjs");
  const removed: string[] = [];
  await writeFile(executable, [
    "#!/usr/bin/env node",
    `await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(marker)}, "spawned"));`,
    "",
  ].join("\n"), "utf8");
  await chmod(executable, 0o700);
  const client = new ClaudeCliClient({
    iclaudePath: executable,
    model: "claude-test",
    requestTimeoutSec: 5,
    tmpDir: dir,
    tmpWrite: (path, content) => writeFile(path, content, "utf8"),
    tmpRemove: (path) => {
      removed.push(path);
      if (existsSync(path)) unlinkSync(path);
    },
  });
  const controller = new AbortController();
  controller.abort("pre-aborted");
  try {
    const error = await captureRejection(
      () => client.chat.completions.create({
        model: "claude-test",
        stream: false,
        messages: [
          { role: "system", content: "s".repeat(262_145) },
          { role: "user", content: "Answer." },
        ],
      }, { signal: controller.signal }),
    );
    assert.equal(error.name, "AbortError");
    assert.equal(existsSync(marker), false);
    assert.equal(removed.length, 1);
    assert.equal(existsSync(removed[0]), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function withLargeSystemClient<T>(
  iclaudePath: string,
  work: (
    client: InstanceType<typeof ClaudeCliClient>,
    removed: string[],
  ) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-ai-wiki-startup-cleanup-"));
  const removed: string[] = [];
  const client = new ClaudeCliClient({
    iclaudePath,
    model: "claude-test",
    requestTimeoutSec: 5,
    tmpDir: dir,
    tmpWrite: (path, content) => writeFile(path, content, "utf8"),
    tmpRemove: (path) => {
      removed.push(path);
      if (existsSync(path)) unlinkSync(path);
    },
  });
  try {
    return await work(client, removed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function largeSystemRequest() {
  return {
    model: "claude-test",
    stream: false as const,
    messages: [
      { role: "system" as const, content: "s".repeat(262_145) },
      { role: "user" as const, content: "Answer." },
    ],
  };
}

test("invalid Claude path removes temporary system prompt before spawn", async () => {
  await withLargeSystemClient("relative-claude", async (client, removed) => {
    const error = await captureRejection(
      () => client.chat.completions.create(largeSystemRequest()),
    );

    assert.equal(error.message, 'iclaudePath must be absolute: "relative-claude"');
    assert.equal(removed.length, 1);
    assert.equal(existsSync(removed[0]), false);
  });
});

test("mobile Claude rejection removes temporary system prompt without spawning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-ai-wiki-mobile-cleanup-"));
  const marker = join(dir, "spawned.marker");
  const executable = join(dir, "claude-mobile-fixture.mjs");
  await writeFile(executable, [
    "#!/usr/bin/env node",
    `await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(marker)}, "spawned"));`,
    "",
  ].join("\n"), "utf8");
  await chmod(executable, 0o700);
  const previousDesktop = Platform.isDesktopApp;
  Platform.isDesktopApp = false;
  try {
    await withLargeSystemClient(executable, async (client, removed) => {
      const error = await captureRejection(
        () => client.chat.completions.create(largeSystemRequest()),
      );

      assert.equal(error.message, "Claude CLI backend is desktop-only");
      assert.equal(existsSync(marker), false);
      assert.equal(removed.length, 1);
      assert.equal(existsSync(removed[0]), false);
    });
  } finally {
    Platform.isDesktopApp = previousDesktop;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude spawn failure removes temporary system prompt exactly once", async () => {
  const missingExecutable = join(
    tmpdir(),
    `missing-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await withLargeSystemClient(missingExecutable, async (client, removed) => {
    const error = await captureRejection(
      () => client.chat.completions.create(largeSystemRequest()),
    );

    assert.equal(error.message, "Claude CLI process failed to start");
    assert.equal(removed.length, 1);
    assert.equal(existsSync(removed[0]), false);
  });
});

function nativeNonStreamClient(reasoning: string, content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          id: "completion",
          object: "chat.completion",
          created: 0,
          model: "native-test",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content,
              refusal: null,
              reasoning,
            },
            finish_reason: "stop",
            logprobs: null,
          }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function structuredEvents(llm: LlmClient): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const sink: { value?: { value: string } } = {};
  for await (const event of runStructuredStreaming({
    llm,
    model: "fixture",
    baseMessages: [{ role: "user", content: "Return value." }],
    opts: { jsonMode: false },
    profile: { kind: "json-zod", schema: z.object({ value: z.string() }) },
    maxRetries: 0,
    callSite: "query.answer",
    lifecycle: createLlmLifecycle("answer_question"),
    signal: new AbortController().signal,
    onEvent: () => {},
    transport: "non-stream",
  }, sink)) {
    events.push(event);
  }
  assert.deepEqual(sink.value, { value: "ok" });
  return events;
}

test("native and Claude non-stream runners share lifecycle human semantics and isolate diagnostics", async () => {
  const finalJson = JSON.stringify({ value: "ok" });
  const nativeEvents = await structuredEvents(
    nativeNonStreamClient("Native thought.", finalJson),
  );
  const claudeEvents = await withClaudeCli([
    assistantLine({ type: "thinking", thinking: "Claude thought." }),
    assistantLine({ type: "text", text: finalJson }),
  ], (client) => structuredEvents(client));

  const lifecycle = (events: RunEvent[]) => events.filter(
    (event): event is Extract<RunEvent, { kind: "llm_lifecycle" }> =>
      event.kind === "llm_lifecycle",
  );
  const semanticShape = (events: RunEvent[]) => lifecycle(events).map((event) => ({
    action: event.action,
    phase: event.phase,
    human: humanLifecycleText(event, labels),
  }));

  assert.deepEqual(semanticShape(claudeEvents), semanticShape(nativeEvents));
  assert.deepEqual(
    lifecycle(claudeEvents).map((event) => event.phase),
    ["preparing", "sent", "waiting", "producing", "validating"],
  );
  assert.ok(claudeEvents.some((event) =>
    event.kind === "assistant_text"
    && event.isReasoning === true
    && event.delta === "Claude thought."));

  for (const event of lifecycle(claudeEvents)) {
    const human = humanLifecycleText(event, labels);
    assert.doesNotMatch(human, /claude|native|cli|--|\/tmp\//i);
    assert.deepEqual(
      Object.keys(event.diagnostics ?? {}).sort(),
      event.phase === "preparing"
        ? ["attempt", "callSite", "transport"]
        : ["callSite", "transport"],
    );
    assert.equal(event.diagnostics?.callSite, "query.answer");
    assert.equal(event.diagnostics?.transport, "non-stream");
  }
});
