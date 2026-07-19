import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
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
const {
  createLlmLifecycle,
  runStructuredWithRetry,
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

function assistantLine(block: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [block] },
  });
}

async function withClaudeCli<T>(
  lines: string[],
  work: (client: InstanceType<typeof ClaudeCliClient>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-ai-wiki-claude-"));
  const executable = join(dir, "claude-fixture.mjs");
  const payload = `${lines.join("\n")}\n`;
  await writeFile(
    executable,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(payload)});\n`,
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

test("Claude streaming exposes thinking and final text as separate OpenAI deltas", async () => {
  await withClaudeCli([
    assistantLine({ type: "thinking", thinking: "Inspect context." }),
    assistantLine({ type: "text", text: "Final answer." }),
  ], async (client) => {
    const response = await client.chat.completions.create(request(true));
    const deltas: Array<Record<string, unknown>> = [];
    for await (const chunk of response as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      deltas.push(chunk.choices[0]?.delta as Record<string, unknown>);
    }

    assert.equal(deltas.map((delta) => delta.reasoning ?? "").join(""), "Inspect context.");
    assert.equal(deltas.map((delta) => delta.content ?? "").join(""), "Final answer.");
  });
});

test("Claude non-stream completion retains reasoning separately from content", async () => {
  await withClaudeCli([
    assistantLine({ type: "thinking", thinking: "Check evidence." }),
    assistantLine({ type: "text", text: "Separate final." }),
  ], async (client) => {
    const response = await client.chat.completions.create(request(false));
    const message = (
      response as OpenAI.Chat.ChatCompletion
    ).choices[0]?.message as OpenAI.Chat.ChatCompletionMessage & Record<string, unknown>;

    assert.equal(message.reasoning, "Check evidence.");
    assert.equal(message.content, "Separate final.");
    assert.equal(String(message.content).includes("Check evidence."), false);
  });
});

function nativeClient(reasoning: string, content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: async () => (async function* () {
          yield {
            id: "reasoning",
            object: "chat.completion.chunk",
            created: 0,
            model: "native-test",
            choices: [{ index: 0, delta: { reasoning }, finish_reason: null }],
          };
          yield {
            id: "content",
            object: "chat.completion.chunk",
            created: 0,
            model: "native-test",
            choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
          };
        })(),
      },
    },
  } as unknown as LlmClient;
}

async function structuredEvents(llm: LlmClient): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  await runStructuredWithRetry({
    llm,
    model: "fixture",
    baseMessages: [{ role: "user", content: "Return value." }],
    opts: { jsonMode: false },
    profile: { kind: "json-zod", schema: z.object({ value: z.string() }) },
    maxRetries: 0,
    callSite: "query.answer",
    lifecycle: createLlmLifecycle("answer_question"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  return events;
}

test("native and Claude transports share lifecycle human semantics and isolate diagnostics", async () => {
  const finalJson = JSON.stringify({ value: "ok" });
  const nativeEvents = await structuredEvents(nativeClient("Native thought.", finalJson));
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
    assert.equal(event.diagnostics?.transport, "stream");
  }
});
