import { describe, it, expect, vi } from "vitest";
import { runLintFixChat } from "../../src/phases/lint-chat";
import type { RunRequest } from "../../src/types";

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function makeVaultTools(pages: Record<string, string> = {}) {
  return {
    listFiles: vi.fn(async () => Object.keys(pages)),
    readAll: vi.fn(async (files: string[]) => new Map(files.map((f) => [f, pages[f] ?? ""]))),
    read: vi.fn(async (_p: string) => { throw new Error("not found"); }),
    write: vi.fn(async () => {}),
    toVaultPath: vi.fn((p: string) => p),
  };
}

function makeLlm(responseJson: object) {
  const content = JSON.stringify(responseJson);
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown, _opts?: unknown) => ({
          choices: [{ message: { content } }],
          usage: { completion_tokens: 10 },
        })),
      },
    },
  };
}

describe("runLintFixChat", () => {
  it("yields tool_use/tool_result for each page and result with summary", async () => {
    const wikiPath = "!Wiki/test";
    const pages = { [`${wikiPath}/X.md`]: "# X\nOld content" };
    const vaultTools = makeVaultTools(pages);
    const llmResponse = {
      summary: "## Исправлено\n- Убрано дублирование",
      pages: [{ path: `${wikiPath}/X.md`, content: "# X\nFixed content" }],
    };
    const llm = makeLlm(llmResponse) as any;

    const req: RunRequest = {
      operation: "lint-chat",
      args: [],
      cwd: "/vault",
      signal: makeSignal(),
      timeoutMs: 30000,
      domainId: "test",
      context: "## Отчёт lint",
      chatMessages: [
        { role: "user", content: "убери дублирование" },
      ],
    };

    const domain = { id: "test", name: "Test", wiki_folder: "test", entity_types: [], language_notes: "", source_paths: [] };

    const events: any[] = [];
    for await (const ev of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "test-model", {}, makeSignal())) {
      events.push(ev);
    }

    const toolUseEvents = events.filter((e) => e.kind === "tool_use");
    const toolResultEvents = events.filter((e) => e.kind === "tool_result");
    const resultEvent = events.find((e) => e.kind === "result");

    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0].name).toBe("Write");
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].ok).toBe(true);
    expect(resultEvent).toBeDefined();
    expect(resultEvent.text).toBe("## Исправлено\n- Убрано дублирование");
    expect(vaultTools.write).toHaveBeenCalledWith(`${wikiPath}/X.md`, "# X\nFixed content");
  });

  it("blocks pages outside wikiVaultPath", async () => {
    const wikiPath = "!Wiki/test";
    const vaultTools = makeVaultTools({ [`${wikiPath}/safe.md`]: "content" });
    const llmResponse = {
      summary: "tried to escape",
      pages: [{ path: "!Wiki/other/evil.md", content: "evil" }],
    };
    const llm = makeLlm(llmResponse) as any;

    const req: RunRequest = {
      operation: "lint-chat",
      args: [],
      cwd: "/vault",
      signal: makeSignal(),
      timeoutMs: 30000,
      domainId: "test",
      context: "report",
      chatMessages: [{ role: "user", content: "bad request" }],
    };
    const domain = { id: "test", name: "Test", wiki_folder: "test", entity_types: [], language_notes: "", source_paths: [] };

    const events: any[] = [];
    for await (const ev of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "model", {}, makeSignal())) {
      events.push(ev);
    }

    const blocked = events.filter((e) => e.kind === "tool_result" && !e.ok);
    expect(blocked).toHaveLength(1);
    expect(vaultTools.write).not.toHaveBeenCalled();
  });

  it("calls upsertIndexAnnotation for pages that have annotation", async () => {
    const wikiPath = "!Wiki/test";
    const pages = { [`${wikiPath}/MyPage.md`]: "# MyPage\nOld" };
    const vaultTools = makeVaultTools(pages);
    const llmResponse = {
      summary: "done",
      pages: [{ path: `${wikiPath}/MyPage.md`, content: "# MyPage\nFixed", annotation: "summary of MyPage" }],
    };
    const llm = makeLlm(llmResponse) as any;

    const req: RunRequest = {
      operation: "lint-chat",
      args: [],
      cwd: "/vault",
      signal: makeSignal(),
      timeoutMs: 30000,
      domainId: "test",
      context: "report",
      chatMessages: [{ role: "user", content: "fix it" }],
    };
    const domain = { id: "test", name: "Test", wiki_folder: "test", entity_types: [], language_notes: "", source_paths: [] };

    for await (const _ of runLintFixChat(req, vaultTools as any, "/vault", domain, llm, "model", {}, makeSignal())) {
      // drain
    }

    const writeCalls = (vaultTools.write as ReturnType<typeof vi.fn>).mock.calls;
    const indexCall = writeCalls.find(([p]: [string]) => p.endsWith("_index.md"));
    expect(indexCall).toBeDefined();
    expect(indexCall![0]).toBe(`${wikiPath}/_index.md`);
    expect(indexCall![1]).toContain("MyPage: summary of MyPage");
  });
});
