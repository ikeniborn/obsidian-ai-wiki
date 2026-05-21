// tests/phases/init-thinking.test.ts
// Regression tests for thinking-model output in runInit.
// These tests FAIL until init.ts uses parseStructured() instead of raw JSON.parse().
import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** LLM that succeeds non-streaming but rejects streaming — simulates thinking model fallback path. */
function makeLlmNonStreaming(content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params: any) => {
          if (params.stream) {
            return Promise.reject(Object.assign(new Error("stream fail"), { name: "Error" }));
          }
          return Promise.resolve({ choices: [{ message: { content } }] });
        }),
      },
    },
  } as unknown as LlmClient;
}

const VALID_DELTA_JSON = JSON.stringify({
  reasoning: "New entity found",
  entity_types: [
    { type: "NewEntity", description: "New", extraction_cues: ["new"], wiki_subfolder: "New" },
  ],
});

describe("runInit — incremental delta (--sources, file 2+) with thinking model output", () => {
  it("applies EntityTypesDelta patch when LLM wraps delta in <think> tags", async () => {
    // The <think> block contains a valid JSON that would be picked up by the greedy regex
    // before the real delta JSON. parseStructured() must strip <think> and parse the real JSON.
    const thinkOutput = `<think>{"wrong": true}</think>\n${VALID_DELTA_JSON}`;
    const llm = makeLlmNonStreaming(thinkOutput);

    const existingDomain = {
      id: "test-domain",
      name: "Test Domain",
      wiki_folder: "Test",
      entity_types: [
        { type: "OldEntity", description: "Old", extraction_cues: ["old"], wiki_subfolder: "Old" },
      ],
      language_notes: "",
      source_paths: ["Sources"],
      analyzed_sources: [],
    };

    // Two source files so the second triggers the incremental path (file index > 0).
    const vaultFiles = ["Sources/file0.md", "Sources/file1.md"];
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((dir: string) => {
        if (dir === "Sources") return Promise.resolve({ files: vaultFiles, folders: [] });
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockResolvedValue("# Content"),
    });
    const vt = new VaultTools(adapter, "/vault");

    const events: unknown[] = [];
    for await (const e of runInit(
      ["test-domain", "--sources", "Sources"],
      vt, llm, "model", [existingDomain as any], "vault", new AbortController().signal,
    )) {
      events.push(e);
    }

    const updates = events.filter((e: any) => e.kind === "domain_updated") as any[];
    expect(updates.length, "expected at least one domain_updated").toBeGreaterThan(0);
    // Find an update that carries entity_types (not just analyzed_sources)
    const withTypes = updates.find((u: any) => Array.isArray(u.patch?.entity_types));
    expect(withTypes, "expected domain_updated with entity_types").toBeDefined();
    expect(
      (withTypes.patch.entity_types as any[]).some((t: any) => t.type === "NewEntity"),
      "NewEntity should be in merged entity_types",
    ).toBe(true);
  });
});
