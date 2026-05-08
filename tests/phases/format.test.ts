import { describe, it, expect, vi } from "vitest";
import { runFormat } from "../../src/phases/format";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient, ChatMessage } from "../../src/types";
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

describe("runFormat", () => {
  it("парсит JSON, пишет temp, эмитит format_preview", async () => {
    const formatted = "---\ntags: [db]\n---\n\n# Заметка про ClickHouse\n\nClickHouse 23.8 SQL https://clickhouse.com/docs `insertBatch`. Яндекс.";
    const json = JSON.stringify({ report: "## Изменения\n- frontmatter", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview");
    expect(preview).toBeDefined();
    expect((preview as { tempPath: string }).tempPath).toBe("!Temp/note.formatted.md");
    expect((preview as { report: string }).report).toContain("frontmatter");
    expect(adapter.write).toHaveBeenCalledWith("!Temp/note.formatted.md", formatted);
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

  it("validator: при потере значимых токенов добавляет их в missingTokens", async () => {
    const formatted = "# Заметка";
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const events = await collect(
      runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal),
    );
    const preview = events.find((e: unknown) => (e as { kind: string }).kind === "format_preview") as { missingTokens: { token: string; context: string }[] };
    expect(preview.missingTokens.length).toBeGreaterThan(0);
    expect(preview.missingTokens.map((m) => m.token)).toContain("https://clickhouse.com/docs");
  });

  it("создаёт !Temp если папки нет", async () => {
    const formatted = SAMPLE;
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    (adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, makeLlm(json), "model", false, [], new AbortController().signal));
    expect(adapter.mkdir).toHaveBeenCalledWith("!Temp");
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
});
