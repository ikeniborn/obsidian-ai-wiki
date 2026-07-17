import { JsonlParseError, parseJsonl, stringifyJsonl } from "./jsonl";

export interface PageIndexRecord {
  kind: "page";
  schemaVersion: 1;
  articleId: string;
  path: string;
  type: string;
  description: string;
  resource: string[];
  timestamp?: string;
  tags?: string[];
  bodyHash: string;
  descriptionHash: string;
}

export interface ChunkIndexRecord {
  kind: "chunk";
  schemaVersion: 1;
  articleId: string;
  path: string;
  heading: string;
  ordinal: number;
  bodyHash: string;
  embedTextHash: string;
  vector: number[];
  vectorModel: string;
  dimensions: number;
  updatedAt: string;
}

export type WikiIndexRecord = PageIndexRecord | ChunkIndexRecord | Record<string, unknown>;

export interface ChunkRecordInput {
  articleId: string;
  path: string;
  heading: string;
  ordinal: number;
  bodyHash: string;
  embedTextHash: string;
  vector: number[];
  vectorModel: string;
  dimensions: number;
  updatedAt: string;
}

export interface NumberVectorCache {
  model: string;
  dimensions: number;
  entries: Record<string, { chunks: ChunkRecordInput[] }>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isPageIndexRecord(record: unknown): record is PageIndexRecord {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
  const value = record as Record<string, unknown>;
  return value.kind === "page" &&
    value.schemaVersion === 1 &&
    typeof value.articleId === "string" &&
    typeof value.path === "string" &&
    typeof value.type === "string" &&
    typeof value.description === "string" &&
    isStringArray(value.resource) &&
    (value.timestamp === undefined || typeof value.timestamp === "string") &&
    (value.tags === undefined || isStringArray(value.tags)) &&
    typeof value.bodyHash === "string" &&
    typeof value.descriptionHash === "string";
}

export function isChunkIndexRecord(record: unknown): record is ChunkIndexRecord {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
  const value = record as Record<string, unknown>;
  return value.kind === "chunk" &&
    value.schemaVersion === 1 &&
    typeof value.articleId === "string" &&
    typeof value.path === "string" &&
    typeof value.heading === "string" &&
    Number.isInteger(value.ordinal) && Number(value.ordinal) >= 0 &&
    typeof value.bodyHash === "string" &&
    typeof value.embedTextHash === "string" &&
    Array.isArray(value.vector) && value.vector.every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
    typeof value.vectorModel === "string" &&
    Number.isInteger(value.dimensions) && Number(value.dimensions) >= 0 &&
    value.vector.length === value.dimensions &&
    typeof value.updatedAt === "string";
}

export function parseWikiIndexJsonl(text: string, path: string): WikiIndexRecord[] {
  const records = parseJsonl<WikiIndexRecord>(text, path);
  let recordIndex = 0;
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (!lines[lineIndex].trim()) continue;
    const record = records[recordIndex++];
    if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
    const value = record as Record<string, unknown>;
    if (value.schemaVersion !== 1) continue;
    if (value.kind === "page" && !isPageIndexRecord(record)) {
      throw new JsonlParseError(path, lineIndex + 1, new Error("Invalid current page record"));
    }
    if (value.kind === "chunk" && !isChunkIndexRecord(record)) {
      throw new JsonlParseError(path, lineIndex + 1, new Error("Invalid current chunk record"));
    }
  }
  return records;
}

export function stringifyWikiIndexJsonl(records: WikiIndexRecord[]): string {
  return stringifyJsonl(records);
}

export function pageRecordId(record: PageIndexRecord): string {
  return `page:${record.articleId}`;
}

export function chunkRecordId(record: ChunkIndexRecord): string {
  return `chunk:${record.articleId}:${record.ordinal}`;
}

export function embeddingChunkToChunkRecord(input: ChunkRecordInput): ChunkIndexRecord {
  return {
    kind: "chunk",
    schemaVersion: 1,
    articleId: input.articleId,
    path: input.path,
    heading: input.heading,
    ordinal: input.ordinal,
    bodyHash: input.bodyHash,
    embedTextHash: input.embedTextHash,
    vector: input.vector,
    vectorModel: input.vectorModel,
    dimensions: input.dimensions,
    updatedAt: input.updatedAt,
  };
}

export function chunkRecordToEmbeddingChunk(record: ChunkIndexRecord): ChunkRecordInput {
  return {
    articleId: record.articleId,
    path: record.path,
    heading: record.heading,
    ordinal: record.ordinal,
    bodyHash: record.bodyHash,
    embedTextHash: record.embedTextHash,
    vector: record.vector,
    vectorModel: record.vectorModel,
    dimensions: record.dimensions,
    updatedAt: record.updatedAt,
  };
}

export function chunkRecordsToEmbeddingCache(
  records: WikiIndexRecord[],
  model: string,
  dimensions: number,
): NumberVectorCache {
  const entries: NumberVectorCache["entries"] = {};
  for (const record of records) {
    if (!isChunkIndexRecord(record)) continue;
    if (record.vectorModel !== model || record.dimensions !== dimensions) continue;
    (entries[record.articleId] ??= { chunks: [] }).chunks.push(chunkRecordToEmbeddingChunk(record));
  }
  return { model, dimensions, entries };
}

export function collectPageDescriptions(records: WikiIndexRecord[]): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const record of records) {
    if (isPageIndexRecord(record)) descriptions.set(record.articleId, record.description);
  }
  return descriptions;
}

export function upsertPageRecord(
  records: WikiIndexRecord[],
  incoming: PageIndexRecord,
): WikiIndexRecord[] {
  let replaced = false;
  const next: WikiIndexRecord[] = [];
  for (const record of records) {
    if (isPageIndexRecord(record) && record.articleId === incoming.articleId) {
      if (!replaced) {
        next.push(incoming);
        replaced = true;
      }
      continue;
    }
    next.push(record);
  }
  if (!replaced) next.push(incoming);
  return next;
}

export function removePageRecord(records: WikiIndexRecord[], articleId: string): WikiIndexRecord[] {
  return records.filter((record) => !(isPageIndexRecord(record) && record.articleId === articleId));
}

export function removeArticleRecords(records: WikiIndexRecord[], articleId: string): WikiIndexRecord[] {
  return records.filter((record) => {
    if (isPageIndexRecord(record) || isChunkIndexRecord(record)) return record.articleId !== articleId;
    return true;
  });
}

export function reconcilePageRecords(
  records: WikiIndexRecord[],
  pages: PageIndexRecord[],
): WikiIndexRecord[] {
  const nonPages = records.filter((record) => !isPageIndexRecord(record));
  return [...nonPages, ...[...pages].sort((a, b) =>
    a.articleId < b.articleId ? -1 : a.articleId > b.articleId ? 1 : 0)];
}
