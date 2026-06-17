import { Platform } from "obsidian";
import { join, isAbsolute } from "path-browserify";
import type OpenAI from "openai";
import { parseStreamLine } from "./stream";
import type { LlmClient } from "./types";

export interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
  tmpDir: string;
  resumeSessionId?: string;
  tmpWrite: (absPath: string, content: string) => Promise<void>;
  tmpRemove: (absPath: string) => void;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

const SIGTERM_GRACE_MS = 3000;

export function validateIclaudePath(p: string): void {
  if (!p) throw new Error("iclaudePath is empty");
  if (!isAbsolute(p)) throw new Error(`iclaudePath must be absolute: "${p}"`);
  if (p.split("/").includes("..")) throw new Error(`iclaudePath contains path traversal: "${p}"`);
}

export class ClaudeCliClient implements LlmClient {
  /** Session ID of the last completed turn, populated from the system init event. */
  lastSessionId?: string;

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

  private async _create(
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

    const LARGE_THRESHOLD = 262_144;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpFiles: string[] = [];

    const isResume = Boolean(this.cfg.resumeSessionId);
    const args: string[] = [];
    args.push("--");

    // --model, --effort и --resume идут после -- как claude-флаги (не iclaude-флаги),
    // чтобы iclaude.sh не вызывал save_model_to_config и не мутировал .claude_config
    if (model) args.push("--model", model);
    if (this.cfg.effort) args.push("--effort", this.cfg.effort);
    if (isResume) {
      args.push("--resume", this.cfg.resumeSessionId!);
    }

    try {
      const isLargeUser = Buffer.byteLength(userText, "utf8") > LARGE_THRESHOLD;
      if (isLargeUser) {
        const tmpUsrFile = join(this.cfg.tmpDir, `ai-wiki-usr-${id}.txt`);
        const wrapped = `<user_input>\n${userText}\n</user_input>`;
        await this.cfg.tmpWrite(tmpUsrFile, wrapped);
        tmpFiles.push(tmpUsrFile);
        args.push("-p", "Process the content from <user_input> according to the system prompt.");
        args.push("--append-system-prompt-file", tmpUsrFile);
      } else {
        args.push("-p", userText);
      }

      args.push("--output-format", "stream-json", "--verbose");
      args.push("--disable-slash-commands");
      args.push("--dangerously-skip-permissions");

      if (this.cfg.allowedTools) args.push("--tools", this.cfg.allowedTools);

      // При resume системный промпт уже хранится в сессии claude —
      // повторная передача может перезаписать исходный контекст операции.
      if (!isResume && systemContent) {
        const isLargeSys = Buffer.byteLength(systemContent, "utf8") > LARGE_THRESHOLD;
        if (isLargeSys) {
          const tmpSysFile = join(this.cfg.tmpDir, `ai-wiki-sys-${id}.txt`);
          await this.cfg.tmpWrite(tmpSysFile, systemContent);
          tmpFiles.push(tmpSysFile);
          args.push("--system-prompt-file", tmpSysFile);
        } else {
          args.push("--system-prompt", systemContent);
        }
      }
    } catch (err) {
      for (const f of tmpFiles) { try { this.cfg.tmpRemove(f); } catch { /* ignore */ } }
      throw err;
    }

    if ((params as { stream?: boolean }).stream) {
      return this._makeIterable(args, opts?.signal, requestTimeoutSec, tmpFiles);
    }
    return this._collect(args, opts?.signal, requestTimeoutSec, tmpFiles);
  }

  private _makeIterable(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
    tmpFiles: string[],
  ): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    return { [Symbol.asyncIterator]: () => this._generate(args, signal, timeoutSec, tmpFiles) };
  }

  private async *_generate(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
    tmpFiles: string[],
  ): AsyncGenerator<OpenAI.Chat.ChatCompletionChunk> {
    validateIclaudePath(this.cfg.iclaudePath);
    if (!Platform.isDesktopApp) throw new Error("Claude CLI backend is desktop-only");
    // Lazily loaded so the Node builtin never executes on mobile, where this
    // code path is unreachable but the module would still fail to load.
    const { spawn } = await import("node:child_process");
    const child = spawn(this.cfg.iclaudePath, args, { stdio: ["ignore", "pipe", "pipe"], cwd: this.cfg.cwd || undefined });
    if (!child.stdout || !child.stderr) throw new Error("spawn: missing stdio");
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const onAbort = () => {
      child.kill("SIGTERM");
      window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutHandle = timeoutSec > 0
      ? window.setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
        }, timeoutSec * 1000)
      : null;

    let timedOut = false;
    const queue: OpenAI.Chat.ChatCompletionChunk[] = [];
    let resolveNext: ((v: void) => void) | null = null;
    const wake = () => { if (resolveNext) { resolveNext(); resolveNext = null; } };

    let id = 0;
    let buf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const ev = parseStreamLine(line);
        if (ev?.kind === "system" && ev.sessionId) {
          this.lastSessionId = ev.sessionId;
        }
        if (ev?.kind === "assistant_text") {
          const delta: Record<string, unknown> = ev.isReasoning
            ? { reasoning: ev.delta }
            : { content: ev.delta };
          queue.push({
            id: `cc-${++id}`,
            object: "chat.completion.chunk",
            model: this.cfg.model || "claude",
            created: 0,
            choices: [{ index: 0, delta: delta, finish_reason: null }],
          });
          wake();
        }
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
      // Flush partial last line (no trailing \n — edge case on some environments)
      if (buf.trim()) {
        const ev = parseStreamLine(buf.trim());
        if (ev?.kind === "system" && ev.sessionId) this.lastSessionId = ev.sessionId;
      }
      const stderr = () => Buffer.concat(stderrChunks).toString("utf8").trim();
      if (spawnError) throw new Error(`claude spawn failed: ${spawnError.message}${stderr() ? `\n${stderr()}` : ""}`);
      if (signal?.aborted) return;
      const ec = exitCode;
      if (ec !== null && ec !== 0) throw new Error(`claude exited with code ${String(ec)}${stderr() ? `\n${stderr()}` : ""}`);
      if (timedOut) throw new Error(`claude process timed out after ${timeoutSec}s`);
      yield {
        id: `cc-${++id}`,
        object: "chat.completion.chunk",
        model: this.cfg.model || "claude",
        created: 0,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
    } finally {
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      for (const f of tmpFiles) { try { this.cfg.tmpRemove(f); } catch { /* already gone */ } }
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
      }
    }
  }

  private async _collect(
    args: string[],
    signal: AbortSignal | undefined,
    timeoutSec: number,
    tmpFiles: string[],
  ): Promise<OpenAI.Chat.ChatCompletion> {
    let text = "";
    for await (const chunk of this._generate(args, signal, timeoutSec, tmpFiles)) {
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
