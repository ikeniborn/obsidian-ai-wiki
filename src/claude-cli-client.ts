import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type OpenAI from "openai";
import { parseStreamLine } from "./stream";
import type { LlmClient } from "./types";

export interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
}

const SIGTERM_GRACE_MS = 3000;

export class ClaudeCliClient implements LlmClient {
  constructor(private cfg: ClaudeCliConfig) {}

  readonly chat = {
    completions: {
      create: (
        params:
          | OpenAI.Chat.ChatCompletionCreateParamsStreaming
          | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        opts?: { signal?: AbortSignal },
      ) => this._create(params, opts),
    },
  };

  private _create(
    params:
      | OpenAI.Chat.ChatCompletionCreateParamsStreaming
      | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    opts?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion> {
    const messages = params.messages;
    const systemContent = messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n\n");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = typeof lastUser?.content === "string" ? lastUser.content : "";

    const model = (params as { model?: string }).model || this.cfg.model;
    const { requestTimeoutSec } = this.cfg;
    const args: string[] = [];
    if (model) args.push("--model", model);
    args.push("--", "-p", userText, "--output-format", "stream-json", "--verbose");
    args.push("--disable-slash-commands");
    args.push("--dangerously-skip-permissions");
    if (this.cfg.allowedTools) args.push("--tools", this.cfg.allowedTools);
    if (systemContent) args.push("--system-prompt", systemContent);

    if ((params as { stream?: boolean }).stream) {
      return Promise.resolve(this._makeIterable(args, opts?.signal, requestTimeoutSec));
    }
    return this._collect(args, opts?.signal, requestTimeoutSec);
  }

  private _makeIterable(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
  ): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    return { [Symbol.asyncIterator]: () => this._generate(args, signal, timeoutSec) };
  }

  private async *_generate(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
  ): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
    const child = spawn(this.cfg.iclaudePath, args, { stdio: ["ignore", "pipe", "pipe"], cwd: this.cfg.cwd || undefined });
    if (!child.stdout || !child.stderr) throw new Error("spawn: missing stdio");
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
    }, timeoutSec * 1000);

    let timedOut = false;
    const queue: OpenAI.Chat.ChatCompletionChunk[] = [];
    let resolveNext: ((v: void) => void) | null = null;
    const wake = () => { if (resolveNext) { resolveNext(); resolveNext = null; } };

    let id = 0;
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const ev = parseStreamLine(line);
      if (ev?.kind === "assistant_text") {
        const delta: Record<string, unknown> = ev.isReasoning
          ? { reasoning: ev.delta }
          : { content: ev.delta };
        queue.push({
          id: `cc-${++id}`,
          object: "chat.completion.chunk",
          model: this.cfg.model || "claude",
          created: 0,
          choices: [{ index: 0, delta: delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: null }],
        });
        wake();
      }
    });

    let exited = false;
    let exitCode: number | null = null;
    let spawnError: Error | null = null;
    child.on("close", (code) => { exitCode = code; exited = true; wake(); });
    child.on("error", (err) => { spawnError = err; exited = true; wake(); });

    try {
      while (true) {
        if (queue.length > 0) { yield queue.shift()!; continue; }
        if (exited) break;
        await new Promise<void>((r) => (resolveNext = r));
      }
      const stderr = () => Buffer.concat(stderrChunks).toString("utf8").trim();
      if (spawnError) throw new Error(`claude spawn failed: ${spawnError.message}${stderr() ? `\n${stderr()}` : ""}`);
      const ec = exitCode;
      if (ec !== null && ec !== 0) throw new Error(`claude exited with code ${ec}${stderr() ? `\n${stderr()}` : ""}`);
      if (timedOut) throw new Error(`claude process timed out after ${timeoutSec}s`);
      yield {
        id: `cc-${++id}`,
        object: "chat.completion.chunk",
        model: this.cfg.model || "claude",
        created: 0,
        choices: [{ index: 0, delta: {} as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: "stop" }],
      };
    } finally {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      rl.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
      }
    }
  }

  private async _collect(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    let text = "";
    for await (const chunk of this._generate(args, signal, timeoutSec)) {
      text += (chunk.choices[0]?.delta as { content?: string })?.content ?? "";
    }
    return {
      id: "cc-0",
      object: "chat.completion",
      model: this.cfg.model || "claude",
      created: 0,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}
