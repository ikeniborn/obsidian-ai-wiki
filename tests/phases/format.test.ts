import { describe, it, expect, vi } from "vitest";
import { runFormat } from "../../src/phases/format";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient, ChatMessage } from "../../src/types";
import { structuralErrorCounter } from "../../src/structural-error-counter";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VAULT = "/vault";
const FILE = "note.md";
const SAMPLE = readFileSync(join(__dirname, "../fixtures/format-sample.md"), "utf-8");

function mockAdapter(files: Record<string, string> = {}): VaultAdapter {
  return {
    read: vi.fn().mockImplementation((p: string) => Promise.resolve(files[p] ?? "")),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLlm(responseJson: string): LlmClient {
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseJson } }] };
    },
  };
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue(stream) } },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []; for await (const e of gen) out.push(e); return out;
}

function makeLlmSequence(responses: string[]): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const response = responses[Math.min(callCount, responses.length - 1)];
          callCount++;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: response }, finish_reason: null }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeLlmTruncated(): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "not json {" }, finish_reason: "length" }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

describe("runFormat", () => {
  it("парсит JSON, пишет temp, эмитит format_preview", async () => {
    const formatted = "---\ntags: [db]\n---\n\n# Заметка про ClickHouse\n\nClickHouse 23.8 SQL-диалект https://clickhouse.com/docs `insertBatch`. Яндекс. Replicated движок.";
    const json = JSON.stringify({ report: "## Изменения\n- frontmatter", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview");
    expect(preview).toBeDefined();
    expect((preview as { tempPath: string }).tempPath).toBe("note.formatted.md");
    expect((preview as { report: string }).report).toContain("frontmatter");
    expect(adapter.write).toHaveBeenCalledWith("note.formatted.md", formatted);
  });

  it("при невалидном JSON эмитит error и не пишет temp", async () => {
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm("not json"), "model", false, [], new AbortController().signal),
    );
    expect(events.some((e: unknown) => (e as { kind: string }).kind === "error")).toBe(true);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("validator: при потере значимых токенов — appendMissingLines восстанавливает их в файл", async () => {
    const formatted = "# Заметка";
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    // После token-retry + appendMissingLines токены восстановлены в файл
    const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain("<!-- restored-lines: token loss after retry -->");
    expect(written).toContain("https://clickhouse.com/docs");
  });

  it("сохраняет formatted рядом с исходником (вложенный путь)", async () => {
    const NESTED = "wiki/notes/page.md";
    const json = JSON.stringify({ report: "r", formatted: SAMPLE });
    const adapter = mockAdapter({ [NESTED]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(runFormat([NESTED], vt, makeLlm(json), "model", false, [], new AbortController().signal));
    const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview") as { tempPath: string };
    expect(preview.tempPath).toBe("wiki/notes/page.formatted.md");
    expect(adapter.write).toHaveBeenCalledWith("wiki/notes/page.formatted.md", SAMPLE);
  });

  it("abort прекращает работу без записи temp", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, makeLlm("{}"), "model", false, [], ctrl.signal));
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("при hasVision=true и наличии image-ссылки добавляет image_url content blocks", async () => {
    const sampleWithImg = SAMPLE + "\n\n![схема](images/diagram.png)\n";
    const formatted = sampleWithImg;
    const json = JSON.stringify({ report: "r", formatted });
    const llm = makeLlm(json);
    const adapter = mockAdapter({ [FILE]: sampleWithImg });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, llm, "model", true, [], new AbortController().signal));
    const create = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const callArgs = create.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
    const messages = callArgs.messages;
    const userMsg = messages.find((m) => m.role === "user")!;
    expect(Array.isArray(userMsg.content)).toBe(true);
    const blocks = userMsg.content as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "image_url")).toBe(true);
  });

  it("при hasVision=false image-ссылки в content blocks НЕ добавляет", async () => {
    const sampleWithImg = SAMPLE + "\n\n![схема](images/diagram.png)\n";
    const formatted = sampleWithImg;
    const json = JSON.stringify({ report: "r", formatted });
    const llm = makeLlm(json);
    const adapter = mockAdapter({ [FILE]: sampleWithImg });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal));
    const create = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const callArgs = create.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
    const messages = callArgs.messages;
    const userMsg = messages.find((m) => m.role === "user")!;
    expect(typeof userMsg.content).toBe("string");
  });

  it("включает chat history в messages при refine", async () => {
    const formatted = SAMPLE;
    const json = JSON.stringify({ report: "r", formatted });
    const llm = makeLlm(json);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const history: ChatMessage[] = [
      { role: "user", content: "сделай таблицу из параметров" },
      { role: "assistant", content: "ок, переделал" },
    ];
    await collect(runFormat([FILE], vt, llm, "model", false, history, new AbortController().signal));
    const create = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const callArgs = create.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
    const messages = callArgs.messages;
    expect(messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes("сделай таблицу"))).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("token-retry: LLM дропает токен в первом ответе, восстанавливает во втором", async () => {
    // Первый ответ: formatted без URL
    const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
    const json1 = JSON.stringify({ report: "r", formatted: formatted1 });
    // Второй ответ (token-retry): formatted с URL
    const formatted2 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL https://clickhouse.com/docs `insertBatch`. Яндекс.";
    const json2 = JSON.stringify({ report: "r2", formatted: formatted2 });

    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([json1, json2]);

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    // LLM вызван дважды
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview") as {
      missingTokens: { token: string }[];
      tempPath: string;
    };
    expect(preview).toBeDefined();
    // После retry URL должен быть восстановлен (не в missing)
    expect(preview.missingTokens.map((m) => m.token)).not.toContain("https://clickhouse.com/docs");

    // Записан результат второго ответа
    expect(adapter.write).toHaveBeenCalledWith("note.formatted.md", expect.stringContaining("https://clickhouse.com/docs"));
  });

  it("token-retry: abort во время retry не ломает restored-block", async () => {
    const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
    const json1 = JSON.stringify({ report: "r", formatted: formatted1 });

    const ctrl = new AbortController();
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 2) ctrl.abort();
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                if (ctrl.signal.aborted) return;
                yield { choices: [{ delta: { content: json1 }, finish_reason: null }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, llm, "model", false, [], ctrl.signal));

    const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string | undefined;
    if (written) {
      expect(written).toContain("<!-- restored-lines: token loss after retry -->");
    }
  });

  it("token-retry: оба ответа дропают токен → restored-block добавлен в tempPath", async () => {
    // Оба ответа: formatted без URL
    const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
    const json1 = JSON.stringify({ report: "r", formatted: formatted1 });
    const json2 = JSON.stringify({ report: "r2", formatted: formatted1 });

    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([json1, json2]);

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    // write вызван с restored-block
    const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain("<!-- restored-lines: token loss after retry -->");
    expect(written).toContain("https://clickhouse.com/docs");
  });

  it("truncation error — claude-agent hint", async () => {
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlmTruncated(), "model", false, [], new AbortController().signal, {}, undefined, "claude-agent"),
    );
    const err = events.find((e: unknown) => (e as { kind: string }).kind === "error") as { message: string } | undefined;
    expect(err).toBeDefined();
    expect(err!.message).toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
    expect(err!.message).not.toContain("Settings →");
  });

  it("reads format schema from global _config/ folder", async () => {
    let schemaReadPath = "";
    const adapter = mockAdapter({
      [`${VAULT}/_config/_format_schema.md`]: "schema content",
      [`${VAULT}/${FILE}`]: "# Page\ncontent",
    });
    const origRead = adapter.read as ReturnType<typeof vi.fn>;
    origRead.mockImplementation(async (path: string) => {
      schemaReadPath = path;
      if (path === `${VAULT}/_config/_format_schema.md`) return "schema content";
      if (path === `${VAULT}/${FILE}`) return "# Page\ncontent";
      return "";
    });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([`${VAULT}/${FILE}`], vt,
      makeLlm('{"report":"ok","formatted":"# Page"}'), "model", false, [], new AbortController().signal));
    expect(schemaReadPath).toContain("_config/_format_schema.md");
  });

  it("truncation error — native-agent hint", async () => {
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlmTruncated(), "model", false, [], new AbortController().signal, {}, "native-agent"),
    );
    const err = events.find((e: unknown) => (e as { kind: string }).kind === "error") as { message: string } | undefined;
    expect(err).toBeDefined();
    expect(err!.message).toContain("Settings →");
    expect(err!.message).not.toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
  });
});

describe("runFormat Zod validation", () => {
  it("records structuralErrorCounter on Zod parse failure then retry succeeds", async () => {
    structuralErrorCounter.reset();
    const good = JSON.stringify({ report: "## ok", formatted: "---\n# Page" });
    const bad = '{"report": "ok"}'; // missing `formatted` field
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1 ? bad : good;
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content }, finish_reason: null }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    expect(events.some((e: unknown) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    const stats = structuralErrorCounter.get();
    // format uses a custom retry loop (not parseWithRetry), so retried bucket stays 0;
    // exactly one failure (call 1 bad JSON) and at least one success (call 2+ good)
    expect(stats.failed).toBe(1);
    expect(stats.ok).toBeGreaterThan(0);
  });

  it("emits error on Zod failure after retry", async () => {
    structuralErrorCounter.reset();
    const bad = '{"report": "ok"}'; // missing `formatted` field
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);

    const events = await collect(
      runFormat([FILE], vt, makeLlmSequence([bad, bad]), "model", false, [], new AbortController().signal),
    );
    expect(events.some((e: unknown) => (e as { kind: string }).kind === "error")).toBe(true);
  });
});
