import { describe, it, expect, vi } from "vitest";
import { runFormat } from "../src/phases/format";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient } from "../src/types";
import { analyzeSingleAttachment } from "../src/phases/attachment-analyzer";
import { VisionTempStore } from "../src/phases/vision-temp-store";

// Mock attachment-analyzer so vision analysis doesn't hit real I/O
vi.mock("../src/phases/attachment-analyzer", () => ({
  extractObsidianEmbedPaths: (text: string) => {
    const matches = [...text.matchAll(/!\[\[([^\]|]+)/g)];
    return matches.map((m) => m[1]);
  },
  analyzeSingleAttachment: vi.fn().mockResolvedValue("A diagram description"),
}));

const VAULT = "/vault";
const FILE = "note.md";
const SAMPLE = "# Test Note\n\nSome content here with details.";

// GOOD_FORMATTED must contain significant tokens from SAMPLE to avoid triggering token-retry
const GOOD_FORMATTED = "---\ntags: []\n---\n\n# Test Note\n\nSome content here with details.";

function makeSentinel(report: string, formatted: string): string {
  return `<<<REPORT>>>\n${report}\n<<<FORMATTED>>>\n${formatted}\n<<<END>>>`;
}

function makeVisionSentinel(report: string, formatted: string, visionCount: number, embeds: string[]): string {
  return `<<<REPORT>>>\n${report}\n<<<FORMATTED>>>\n${formatted}\n<<<VISION_COUNT>>>\n${visionCount}\n<<<EMBEDS>>>\n${embeds.join("|")}\n<<<END>>>`;
}

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

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const BAD_RESPONSE = "<<<REPORT>>>\nok\n<<<END>>>"; // no FORMATTED marker → parseSentinelOutput returns null

describe("format sentinel retry/salvage", () => {
  // @lat: [[tests#Format Sentinel Retry#First attempt fails retry succeeds]]
  it("first attempt fails → retry → format_preview emitted, no error event", async () => {
    const good = makeSentinel("ok", GOOD_FORMATTED);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([BAD_RESPONSE, good]);

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    expect(events.some((e) => (e as { kind: string }).kind === "error")).toBe(false);
    expect(events.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // @lat: [[tests#Format Sentinel Retry#Retry system prompt contains hint]]
  it("retry system prompt contains hint text 'Предыдущая попытка не прошла'", async () => {
    const good = makeSentinel("ok", GOOD_FORMATTED);
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([BAD_RESPONSE, good]);

    await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    const create = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    expect(create.mock.calls.length).toBe(2);
    const retryCallArgs = create.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> };
    const systemMsg = retryCallArgs.messages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("Предыдущая попытка не прошла");
  });

  // @lat: [[tests#Format Sentinel Retry#Both attempts fail]]
  it("both attempts fail → error event emitted", async () => {
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([BAD_RESPONSE, BAD_RESPONSE]);

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    expect(events.some((e) => (e as { kind: string }).kind === "error")).toBe(true);
    expect(events.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(false);
  });

  // @lat: [[tests#Format Sentinel Retry#Salvage no END marker]]
  it("salvage (no END marker): info_text with salvage warning emitted, write succeeds", async () => {
    const salvageResponse = `<<<REPORT>>>\nok\n<<<FORMATTED>>>\n${GOOD_FORMATTED}`; // no <<<END>>>
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    const llm = makeLlmSequence([salvageResponse]);

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    // Should emit a warning info_text about truncation/salvage
    const infoEvents = events.filter(
      (e) => (e as { kind: string }).kind === "info_text",
    ) as Array<{ kind: string; summary: string; details: string[] }>;
    const salvageWarning = infoEvents.find(
      (e) => e.summary.toLowerCase().includes("salvage") || e.summary.toLowerCase().includes("обрезан"),
    );
    expect(salvageWarning).toBeDefined();

    // Write should still succeed (salvage path)
    expect(adapter.write).toHaveBeenCalled();
    expect(events.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
  });

  // @lat: [[tests#Format Sentinel Retry#Vision embed preserved]]
  it("vision sentinel: embed preserved in formatted → no Zod error, format_preview emitted", async () => {
    const embedPath = "img/diagram.png";
    const sampleWithEmbed = `# Test Note\n\nSome content here.\n\n![[${embedPath}]]\n`;
    const formattedWithEmbed = `---\ntags: []\n---\n\nFormatted content.\n\n![[${embedPath}]]`;
    const visionResponse = makeVisionSentinel("ok", formattedWithEmbed, 1, [embedPath]);

    const adapter = mockAdapter({ [FILE]: sampleWithEmbed });
    const vt = new VaultTools(adapter, VAULT);
    // LLM is called for vision analysis (first call returns description) and for format (returns sentinel)
    // But analyzeSingleAttachment is mocked at module level, so only format calls go to LLM
    const llm = makeLlmSequence([visionResponse]);

    const events = await collect(
      runFormat(
        [FILE],
        vt,
        llm,
        "model",
        false,
        [],
        new AbortController().signal,
        {},
        "native-agent",
        undefined,
        3,
        { enabled: true, model: "vision-model" },
      ),
    );

    expect(events.some((e) => (e as { kind: string }).kind === "error")).toBe(false);
    expect(events.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
  });

  // @lat: [[tests#Format Sentinel Retry#Vision resume from temp store]]
  it("resume: second runFormat with same store does not re-analyze (cache hit)", async () => {
    const analyzeMock = vi.mocked(analyzeSingleAttachment);
    analyzeMock.mockClear();
    analyzeMock.mockResolvedValue("Cached diagram");

    const embed = "img/d.png";
    const src = `# Note\n\n![[${embed}]]\n`;
    const formatted = `---\ntags: []\n---\n\n# Note\n\n![[${embed}]]`;
    const sentinel = makeVisionSentinel("ok", formatted, 1, [embed]);

    // Persisting in-memory adapter so the store survives between the two runs.
    const text = new Map<string, string>([[FILE, src]]);
    const adapter: VaultAdapter = {
      read: (p: string) => Promise.resolve(text.get(p) ?? ""),
      write: (p: string, d: string) => { text.set(p, d); return Promise.resolve(); },
      append: () => Promise.resolve(),
      list: () => Promise.resolve({ files: [], folders: [] }),
      exists: (p: string) => Promise.resolve(text.has(p)),
      mkdir: () => Promise.resolve(),
      rmdir: () => Promise.resolve(),
    };
    const vt = new VaultTools(adapter, VAULT);
    const store = new VisionTempStore(vt, ".obsidian/plugins/x/.vision-tmp/run1");

    const run = () => collect(runFormat(
      [FILE], vt, makeLlmSequence([sentinel]), "model", false, [],
      new AbortController().signal, {}, "native-agent", undefined, 3,
      { enabled: true, model: "vm" }, store,
    ));

    const first = await run();
    expect(first.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    expect(analyzeMock).toHaveBeenCalledTimes(1);

    const second = await run();
    expect(second.some((e) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    expect(analyzeMock).toHaveBeenCalledTimes(1); // served from cache — no second LLM call
  });
});
