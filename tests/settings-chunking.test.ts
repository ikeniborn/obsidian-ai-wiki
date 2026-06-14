import { describe, it, expect } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { DEFAULT_SETTINGS } from "../src/types";
import { DEFAULT_CHUNKING } from "../src/page-similarity";

function similarityConfigOf(settings: typeof DEFAULT_SETTINGS) {
  const runner = new AgentRunner(
    {} as never,           // llm — unused by buildSimilarity
    settings,
    [] as never,           // vaultTools — unused by buildSimilarity
    "vault",               // vaultName
    [],                    // domains
  );
  const svc = (runner as unknown as { buildSimilarity: () => unknown }).buildSimilarity();
  return (svc as { config: { chunking?: typeof DEFAULT_CHUNKING } }).config;
}

describe("buildSimilarity chunking threading", () => {
  it("applies chunking defaults when chunk* settings are absent", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.nativeAgent.embeddingModel = "text-embedding-3-small";
    settings.nativeAgent.embeddingDimensions = 512;
    const cfg = similarityConfigOf(settings);
    expect(cfg.chunking).toEqual(DEFAULT_CHUNKING);
  });

  it("uses explicit chunk* values when present", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.nativeAgent.embeddingModel = "text-embedding-3-small";
    settings.nativeAgent.embeddingDimensions = 512;
    settings.nativeAgent.chunkMaxChars = 800;
    settings.nativeAgent.chunkOverlapChars = 100;
    settings.nativeAgent.chunkMinChars = 150;
    settings.nativeAgent.chunkMaxCount = 6;
    const cfg = similarityConfigOf(settings);
    expect(cfg.chunking).toEqual({ maxChars: 800, overlapChars: 100, minChars: 150, maxCount: 6 });
  });
});
