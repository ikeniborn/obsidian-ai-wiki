// tests/phases/lint-thinking.test.ts
// Regression tests for thinking-model output in runLint / actualizeDomainConfig.
// These tests FAIL until lint.ts uses parseStructured() instead of raw JSON.parse().
import { describe, it, expect, vi } from "vitest";
import { runLint } from "../../src/phases/lint";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const VAULT_ROOT = "/vaults/Work";

// call 1: combined assess+fix (LintOutputSchema JSON)
// call 2: actualizeDomainConfig via parseWithRetry — returns thinking-model output with <think> + real JSON patch
function makeLlmWithThinkingPatch(patchJson: string): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((_params: any) => {
          const call = ++callCount;
          const content = call === 2
            ? patchJson
            : JSON.stringify({ reasoning: "ok", report: "Lint report: all good.", fixes: [] });
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}

const VALID_PATCH_JSON = JSON.stringify({
  reasoning: "Added Patched entity type.",
  entity_types: [
    { type: "Patched", description: "Patched entity", extraction_cues: ["patched"], wiki_subfolder: "Patched" },
  ],
  language_notes: "Use Russian.",
});

describe("runLint — actualizeDomainConfig with thinking model output", () => {
  it("applies entity_types patch when LLM wraps patch in <think> tags", async () => {
    // <think> block contains a JSON object — greedy regex picks it up instead of real patch.
    // parseStructured() must strip <think> and return the real JSON.
    const thinkOutput = `<think>{"bad": "json inside think"}</think>\n${VALID_PATCH_JSON}`;
    const llm = makeLlmWithThinkingPatch(thinkOutput);

    const domain: DomainEntry = {
      id: "test",
      name: "Test",
      wiki_folder: "Test",
      entity_types: [],
      language_notes: "",
      source_paths: [],
    };

    const pageContent = "---\nwiki_updated: 2024-01-01\n---\n# Page\nContent about Patched things.";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((dir: string) => {
        // The lint phase calls listFiles on the wiki folder (toVaultPath-based)
        return Promise.resolve({ files: [`${dir}/Page.md`], folders: [] });
      }),
      read: vi.fn().mockResolvedValue(pageContent),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const events: unknown[] = [];
    for await (const e of runLint(
      ["test"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal,
    )) {
      events.push(e);
    }

    // Should have a domain_updated event with a valid entity_types patch
    const updates = events.filter((e: any) => e.kind === "domain_updated") as any[];
    expect(updates.length, "expected at least one domain_updated event").toBeGreaterThan(0);
    const withTypes = updates.find((u: any) => Array.isArray(u.patch?.entity_types));
    expect(withTypes, "expected domain_updated with entity_types array").toBeDefined();
    expect(
      (withTypes.patch.entity_types as any[]).some((t: any) => t.type === "Patched"),
      "Patched entity type should be in patch",
    ).toBe(true);
  });
});
