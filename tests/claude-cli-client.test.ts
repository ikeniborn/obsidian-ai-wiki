import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:readline", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:readline")>();
  return orig;
});
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
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

const cfg = { iclaudePath: "/usr/bin/claude", model: "sonnet", maxTokens: 1024, requestTimeoutSec: 30, tmpDir: "/plugin/tmp" };

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

  it("uses --append-system-prompt-file when userText exceeds 32KB", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);
    const largeText = "x".repeat(33_000); // > 32 768 bytes

    await client.chat.completions.create(
      { model: "sonnet", messages: [{ role: "user", content: largeText }], stream: false } as any,
    );

    const args: string[] = (spawn as any).mock.calls[0][1];
    expect(args).toContain("--append-system-prompt-file");
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe(".");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("llm-wiki-usr-"),
      largeText,
      "utf-8",
    );

    expect(unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("llm-wiki-usr-"),
    );
  });

  it("uses --system-prompt-file when systemContent exceeds 32KB", async () => {
    (spawn as any).mockReturnValue(makeMockProcess([]));

    const client = new ClaudeCliClient(cfg);
    const largeSystem = "s".repeat(33_000);

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

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("llm-wiki-sys-"),
      largeSystem,
      "utf-8",
    );

    expect(unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("llm-wiki-sys-"),
    );
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
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
