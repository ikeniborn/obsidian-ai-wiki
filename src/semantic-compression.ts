import maximum from "../prompts/compression-maximum.md";
import balanced from "../prompts/compression-balanced.md";
import minimum from "../prompts/compression-minimum.md";
import type { SemanticCompression } from "./types";

const profiles = { maximum, balanced, minimum } as const;
const invariants = {
  ingest: "Preserve every evidence packet ID, exact source range, link, entity relationship, and generated knowledge fact. Do not drop any covered packet or range.",
  query: "Preserve every claim needed to answer the current question and every citation supporting those claims. Do not invent citations.",
  lint: "Preserve every finding, severity, file path, section location, and repair instruction. Do not merge distinct findings.",
  vision: "Preserve recognized OCR, objects, relationships, layout and structure, page identity, and uncertainty. Do not change recognized meaning.",
} as const;

export function compressionInstruction(value: SemanticCompression): string {
  return [
    "## Semantic compression",
    profiles[value.profile].trim(),
    "## Preservation rules",
    invariants[value.operation],
  ].join("\n");
}
