import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { DEFAULT_SETTINGS, type CompressionProfile, type LlmClient } from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { runFormat } = await import("../src/phases/format");
const { resolveModelCallPolicy } = await import("../src/model-call-policy");

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function llmWithSeenParams(text: string, seenParams: Record<string, unknown>[]): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          seenParams.push(params as Record<string, unknown>);
          return (async function* () {
            yield chunk(text);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

class MemoryAdapter implements VaultAdapter {
  private files = new Map<string, string>();

  constructor(entries: Record<string, string>) {
    for (const [path, content] of Object.entries(entries)) this.files.set(path, content);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ""}${data}`);
  }

  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || path === "notes";
  }

  async mkdir(): Promise<void> {}
}

async function capturedFormatParams(profile: CompressionProfile): Promise<Record<string, unknown>> {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: []",
    "---",
    "# Title",
    "",
    "Keep this token.",
  ].join("\n");
  const formatted = [
    "<<<REPORT>>>",
    "- formatted",
    "<<<FORMATTED>>>",
    original,
    "<<<END>>>",
  ].join("\n");
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.backend = "native-agent";
  settings.nativeAgent.compressionProfile = profile;
  const { opts } = resolveModelCallPolicy(settings, "format");
  const vaultTools = new VaultTools(new MemoryAdapter({ "notes/source.md": original }), "/vault");

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llmWithSeenParams(formatted, seenParams),
    "m",
    false,
    [],
    new AbortController().signal,
    opts,
  )) {
    void event;
  }

  assert.equal(seenParams.length, 1);
  return seenParams[0];
}

test("format output disables response_format even when caller opts request JSON mode", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: []",
    "---",
    "# Title",
    "",
    "Keep this token.",
  ].join("\n");
  const formatted = [
    "<<<REPORT>>>",
    "- formatted",
    "<<<FORMATTED>>>",
    "---",
    "tags: []",
    "---",
    "# Title",
    "",
    "Keep this token.",
    "<<<END>>>",
  ].join("\n");
  const vaultTools = new VaultTools(new MemoryAdapter({ "notes/source.md": original }), "/vault");
  const events = [];

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llmWithSeenParams(formatted, seenParams),
    "m",
    false,
    [],
    new AbortController().signal,
    { jsonMode: "json_object" },
  )) {
    events.push(event);
  }

  assert.ok(seenParams.length > 0);
  assert.equal(seenParams[0]?.response_format, undefined);
  assert.ok(events.some((event) => event.kind === "format_preview"));
});

test("format prepared params are independent of global semantic compression profiles", async () => {
  const maximum = await capturedFormatParams("maximum");
  const minimum = await capturedFormatParams("minimum");

  assert.deepEqual(maximum, minimum);
  const messages = maximum.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const firstSystem = messages.find((message) => message.role === "system");
  assert.ok(firstSystem && typeof firstSystem.content === "string");
  assert.doesNotMatch(firstSystem.content, /^## Semantic compression$/m);
});
