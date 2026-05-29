// tests/phases/init-thinking.test.ts
// Regression tests for thinking-model output in runInit.
// Entity types now propagate via ingest's entity_types_delta (not a separate incremental LLM call).
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

function makeStreamingLlm(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const json = responses[callIndex] ?? responses[responses.length - 1];
          callIndex++;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: json } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

const BOOTSTRAP_JSON = JSON.stringify({
  reasoning: "",
  id: "test-domain",
  name: "Test Domain",
  wiki_folder: "Test",
  source_paths: [],
  entity_types: [{ type: "OldEntity", description: "Old", extraction_cues: ["old"] }],
  language_notes: "",
});

const INGEST_WITH_DELTA = JSON.stringify({
  reasoning: "New entity found",
  pages: [],
  entity_types_delta: [
    { type: "NewEntity", description: "New", extraction_cues: ["new"], wiki_subfolder: "New" },
  ],
});

describe("runInit — entity_types delta propagation via ingest", () => {
  it("applies entity_types_delta from ingest and emits domain_updated with merged types", async () => {
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

    const existingDomain = {
      id: "test-domain",
      name: "Test Domain",
      wiki_folder: "Test",
      entity_types: [{ type: "OldEntity", description: "Old", extraction_cues: ["old"] }],
      language_notes: "",
      source_paths: ["Sources"],
      analyzed_sources: [],
    };

    // Existing domain → no bootstrap call. runIngest now issues TWO LLM calls per source:
    // LLM #1 (entities, EntitiesOutputSchema) and LLM #2 (pages, WikiPagesOutputSchema).
    // An empty entities response makes ingest skip per-entity retrieval and go straight to page synthesis.
    // Call sequence: entities(file0), pages(file0 — no delta), entities(file1), pages(file1 — with delta)
    const ENTITIES_EMPTY = JSON.stringify({ reasoning: "", entities: [] });
    const llm = makeStreamingLlm([
      ENTITIES_EMPTY,
      JSON.stringify({ reasoning: "ok", pages: [] }),
      ENTITIES_EMPTY,
      INGEST_WITH_DELTA,
    ]);

    const events: unknown[] = [];
    for await (const e of runInit(
      ["test-domain", "--sources", "Sources"],
      vt, llm, "model", [existingDomain as any], "vault", new AbortController().signal,
    )) {
      events.push(e);
    }

    const updates = events.filter((e: any) => e.kind === "domain_updated") as any[];
    expect(updates.length, "expected at least one domain_updated").toBeGreaterThan(0);
    // Any update that carries entity_types and includes NewEntity (from ingest delta)
    const hasNewEntity = updates.some(
      (u: any) => Array.isArray(u.patch?.entity_types) &&
        u.patch.entity_types.some((t: any) => t.type === "NewEntity"),
    );
    expect(hasNewEntity, "NewEntity should be in merged entity_types of some domain_updated").toBe(true);
  });
});
