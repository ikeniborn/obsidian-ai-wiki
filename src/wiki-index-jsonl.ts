import { parseJsonl, stringifyJsonl } from "./jsonl";

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

export function isPageIndexRecord(record: WikiIndexRecord): record is PageIndexRecord {
  return record.kind === "page";
}

export function isChunkIndexRecord(record: WikiIndexRecord): record is ChunkIndexRecord {
  return record.kind === "chunk";
}

export function parseWikiIndexJsonl(text: string, path: string): WikiIndexRecord[] {
  return parseJsonl<WikiIndexRecord>(text, path);
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
