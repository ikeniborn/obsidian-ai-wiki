import assert from "node:assert/strict";
import test from "node:test";
import {
  domainEntryToMetadataRecords,
  metadataRecordsToDomainEntry,
  parseDomainMetadata,
  stringifyDomainMetadata,
} from "../src/domain-metadata";
import type { DomainEntry } from "../src/domain";

const entry: DomainEntry = {
  id: "hld",
  name: "HLD",
  wiki_folder: "hld",
  source_paths: ["Ростелеком/HLD"],
  entity_types: [{
    type: "system",
    description: "Architecture system",
    extraction_cues: ["system name"],
    min_mentions_for_page: 2,
    wiki_subfolder: "systems",
  }],
  analyzed_sources: { "Ростелеком/HLD/СКИТ.md": "abc" },
  analyzed_sources_v2: true,
  analyzed_sources_v3: true,
  pageNameVersion: 2,
  max_tag_categories: 12,
};

test("DomainEntry round-trips through metadata records", () => {
  const records = domainEntryToMetadataRecords(entry);
  const roundTrip = metadataRecordsToDomainEntry(records, "hld");
  assert.deepEqual(roundTrip, entry);
});

test("metadata JSONL preserves managed entity types and source states", () => {
  const text = stringifyDomainMetadata(domainEntryToMetadataRecords(entry));
  const parsed = parseDomainMetadata(text, "!Wiki/hld/metadata.jsonl", "hld");
  assert.equal(parsed.entity_types?.[0].type, "system");
  assert.equal(parsed.analyzed_sources?.["Ростелеком/HLD/СКИТ.md"], "abc");
});
