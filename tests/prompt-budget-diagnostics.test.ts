import assert from "node:assert/strict";
import test from "node:test";
import {
  createPromptBudgetEvent,
  type PromptBudgetMetadata,
} from "../src/prompt-budget";

const approvedFields = [
  "actualInputTokens",
  "callSite",
  "compressionProfile",
  "configuredInputBudget",
  "contextUnits",
  "effectiveInputBudget",
  "estimatedInputTokens",
  "kind",
  "outputBudget",
  "reductionDepth",
  "requestId",
  "retryReason",
  "sourceChunks",
] as const;

const numericFields = [
  "actualInputTokens",
  "configuredInputBudget",
  "contextUnits",
  "effectiveInputBudget",
  "estimatedInputTokens",
  "outputBudget",
  "reductionDepth",
  "sourceChunks",
] as const;

function assertMetadataOnlyPromptBudgetDiagnostics(): void {
  const markers = {
    sourceText: "SOURCE_TEXT_MARKER_7fbc",
    evidence: "EVIDENCE_MARKER_2a91",
    imageBase64: "data:image/png;base64,IMAGE_MARKER_d312",
    apiKey: "sk-API_KEY_MARKER_8ae4",
    authorization: "Bearer AUTHORIZATION_MARKER_48c1",
  };
  const metadata: PromptBudgetMetadata & typeof markers = {
    requestId: "request-1",
    kind: "not-an-event-field",
    callSite: "ingest.synthesize",
    configuredInputBudget: 16_384,
    effectiveInputBudget: 12_288,
    estimatedInputTokens: 11_900,
    actualInputTokens: 11_750,
    outputBudget: 4_096,
    compressionProfile: "balanced",
    contextUnits: 8,
    sourceChunks: 5,
    reductionDepth: 2,
    retryReason: "provider_context_error",
    ...markers,
  };

  const event = createPromptBudgetEvent(metadata);
  const serialized = JSON.stringify(event);

  assert.deepEqual(Object.keys(event).sort(), [...approvedFields].sort());
  for (const field of approvedFields) {
    assert.equal(Object.hasOwn(event, field), true, field);
  }
  for (const field of numericFields) {
    assert.equal(typeof event[field], "number", field);
    assert.equal(Number.isFinite(event[field]), true, field);
  }
  for (const marker of Object.values(markers)) {
    assert.equal(serialized.includes(marker), false, marker);
  }
}

test("prompt_budget diagnostics expose approved metadata only", () => {
  assertMetadataOnlyPromptBudgetDiagnostics();
});
