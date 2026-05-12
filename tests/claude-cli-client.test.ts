import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { ClaudeCliClient } from "../src/claude-cli-client";

function makeMockProcess(lines: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: null,
    exitCode: null as number | null,
    kill: vi.fn(),
  });
  process.nextTick(() => {
    for (const line of lines) stdout.write(line + "\n");
    stdout.end();
    (proc as any).exitCode = 0;
    proc.emit("close", 0);
  });
  return proc;
}

const tmpWrite = vi.fn().mockResolvedValue(undefined);
const tmpRemove = vi.fn();
const cfg = {
  iclaudePath: "/usr/bin/claude",
  model: "sonnet",
  maxTokens: 1024,
  requestTimeoutSec: 30,
  tmpDir: "/plugin/tmp",
  tmpWrite,
  tmpRemove,
};

describe("ClaudeCliClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("yields text chunks from assistant_text stream-json lines", async () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", duration_ms: 100, total_cost_usd: 0, result: "hello", is_error: false }),
    ];
    (spawn as any).mockReturnValue(makeMockProcess(lines));

    const client = new ClaudeCliClient(cfg);
    const stream = await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: true } as any,
      { signal: new AbortController().signal },
    );

    const chunks: string[] = [];
    for await (const chunk of stream) {
      const c = (chunk as any).choices[0]?.delta?.content;
      if (c) chunks.push(c);
    }
    expect(chunks).toContain("hello");
  });

  it("non-streaming returns ChatCompletion with accumulated text", async () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "world" }] } }),
      JSON.stringify({ type: "result", duration_ms: 100, total_cost_usd: 0, result: "world", is_error: false }),
    ];
    (spawn as any).mockReturnValue(makeMockProcess(lines));

    const client = new ClaudeCliClient(cfg);
    const resp = await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: false } as any,
    );
    expect((resp as any).choices[0].message.content).toBe("world");
  });

  it("passes --system flag when system message present", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);
    await client.chat.completions.create(
      {
        model: "sonnet",
        messages: [
          { role: "system", content: "be helpful" },
          { role: "user", content: "hello" },
        ],
        stream: false,
      } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    expect(args).toContain("--system-prompt");
    const sysIdx = args.indexOf("--system-prompt");
    expect(args[sysIdx + 1]).toContain("be helpful");
  });

  it("aborts subprocess on signal", async () => {
    const proc = makeMockProcess([]);
    (spawn as any).mockReturnValue(proc);
    const ctrl = new AbortController();
    ctrl.abort();

    const client = new ClaudeCliClient(cfg);
    await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: false } as any,
      { signal: ctrl.signal },
    );
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("aborts non-streaming call mid-flight via signal", async () => {
    // Process that stays open until killed
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin: null,
      exitCode: null as number | null,
      kill: vi.fn((sig: string) => {
        // Simulate process dying on SIGTERM
        (proc as any).exitCode = 1;
        proc.emit("close", 1);
      }),
    });
    (spawn as any).mockReturnValue(proc);

    const ctrl = new AbortController();
    const client = new ClaudeCliClient(cfg);

    // Start the non-streaming call (it will block waiting for process to close)
    const createPromise = client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: false } as any,
      { signal: ctrl.signal },
    );

    // Abort after a tick (mid-flight)
    await Promise.resolve();
    ctrl.abort();

    await createPromise;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses --append-system-prompt-file when userText exceeds 256KB", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);
    const largeText = "x".repeat(300_000); // > 262 144 bytes

    await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: largeText }], stream: false } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    expect(args).toContain("--append-system-prompt-file");
    expect(args).toContain("-p");
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toContain("user_input");

    // Check tmpWrite was called with absolute path and wrapped content
    const writtenUsrPath = (tmpWrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writtenUsrPath).toContain("ai-wiki-usr-");
    expect(writtenUsrPath).toContain("/plugin/tmp");
    const writtenContent = (tmpWrite as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(writtenContent).toContain("<user_input>");
    expect(writtenContent).toContain(largeText);

    // Check tmpRemove was called with the same path
    expect(tmpRemove).toHaveBeenCalledWith(writtenUsrPath);
  });

  it("uses --system-prompt-file when systemContent exceeds 256KB", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);
    const largeSystem = "s".repeat(300_000);

    await client.chat.completions.create(
      {
        model: "sonnet",
        messages: [
          { role: "system", content: largeSystem },
          { role: "user", content: "hi" },
        ],
        stream: false,
      } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    expect(args).toContain("--system-prompt-file");
    expect(args).not.toContain("--system-prompt");

    // Check tmpWrite was called with absolute path and system content
    const writtenSysPath = (tmpWrite as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writtenSysPath).toContain("ai-wiki-sys-");
    expect(writtenSysPath).toContain("/plugin/tmp");
    expect(tmpWrite).toHaveBeenCalledWith(writtenSysPath, largeSystem);

    // Check tmpRemove was called with the same path
    expect(tmpRemove).toHaveBeenCalledWith(writtenSysPath);
  });

  it("keeps small userText and systemContent inline in argv", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);

    await client.chat.completions.create(
      {
        model: "sonnet",
        messages: [
          { role: "system", content: "be helpful" },
          { role: "user", content: "short question" },
        ],
        stream: false,
      } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe("short question");
    expect(args).toContain("--system-prompt");
    expect(args).not.toContain("--system-prompt-file");
    expect(args).not.toContain("--append-system-prompt-file");
    expect(tmpWrite).not.toHaveBeenCalled();
  });

  it("passes --resume after -- and skips --system-prompt when resumeSessionId is set", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient({ ...cfg, resumeSessionId: "session-xyz" });
    await client.chat.completions.create(
      {
        model: "sonnet",
        messages: [
          { role: "system", content: "operation context" },
          { role: "user", content: "первый вопрос" },
          { role: "assistant", content: "первый ответ" },
          { role: "user", content: "второй вопрос" },
        ],
        stream: false,
      } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    const separatorIdx = args.indexOf("--");
    expect(separatorIdx).toBeGreaterThan(-1);

    // --resume должен идти после --
    const resumeIdx = args.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThan(separatorIdx);
    expect(args[resumeIdx + 1]).toBe("session-xyz");

    // --system-prompt не должен присутствовать при resume
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--system-prompt-file");

    // -p содержит только последнее user-сообщение
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe("второй вопрос");
  });

  it("populates lastSessionId from system init event in stream", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc-123", model: "claude-sonnet" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", duration_ms: 100, total_cost_usd: 0, result: "hello", is_error: false }),
    ];
    (spawn as any).mockReturnValue(makeMockProcess(lines));

    const client = new ClaudeCliClient(cfg);
    const stream = await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: true } as any,
      { signal: new AbortController().signal },
    );
    for await (const _ of stream) { /* drain */ }

    expect(client.lastSessionId).toBe("sess-abc-123");
  });

  it("does not populate lastSessionId when no system init event present", async () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", duration_ms: 100, total_cost_usd: 0, result: "hello", is_error: false }),
    ];
    (spawn as any).mockReturnValue(makeMockProcess(lines));

    const client = new ClaudeCliClient(cfg);
    const stream = await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: "hi" }], stream: true } as any,
      { signal: new AbortController().signal },
    );
    for await (const _ of stream) { /* drain */ }

    expect(client.lastSessionId).toBeUndefined();
  });

  it("does not pass --resume and does pass --system-prompt when resumeSessionId is absent", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg); // resumeSessionId не задан
    await client.chat.completions.create(
      {
        model: "sonnet",
        messages: [
          { role: "system", content: "operation context" },
          { role: "user", content: "первый вопрос" },
        ],
        stream: false,
      } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    expect(args).not.toContain("--resume");
    expect(args).toContain("--system-prompt");
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe("первый вопрос");
  });
});
