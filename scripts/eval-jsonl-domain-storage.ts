#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildBm25Index, rankBm25, tokenizeBm25 } from "../src/bm25";
import { domainEntryToMetadataRecords, stringifyDomainMetadata } from "../src/domain-metadata";
import { stringifyJsonl } from "../src/jsonl";
import {
  fuseLexicalRanks,
  rankLexicalChunks,
  rankLexicalPages,
} from "../src/lexical-retrieval";
import { scoreGoldRanking, validateGoldSet, type GoldLabel, type GoldMetrics, type GoldSet } from "../src/retrieval-eval-metrics";
import { rrf } from "../src/rrf";
import { tokenize } from "../src/wiki-seeds";
import { pageId } from "../src/wiki-graph";
import {
  isChunkIndexRecord,
  isPageIndexRecord,
  parseWikiIndexJsonl,
  stringifyWikiIndexJsonl,
  type ChunkIndexRecord,
  type PageIndexRecord,
  type WikiIndexRecord,
} from "../src/wiki-index-jsonl";

export type EvalVerdict = "accepted" | "needs_tuning" | "rejected";
export type QueryEvalStatus = "accepted" | "needs_tuning" | "rejected";
export type RetrievalVariantId =
  | "weighted-lexical"
  | "bm25-page"
  | "bm25-chunk"
  | "rrf-weighted-bm25"
  | "rrf-weighted-bm25-legacy";

export interface HldQuery {
  id: string;
  theme: string;
  question: string;
}

export interface AggregateInput {
  baselineAvailable: boolean;
  regressions: string[];
  formatWorked: boolean;
}

export interface RunHldEvalOptions {
  source: string;
  outPath: string;
  evalRoot?: string;
  goldPath?: string;
}

export interface VariantMetrics {
  id: RetrievalVariantId;
  recallAt5: number;
  ndcgAt5: number;
  mrr: number;
  legacyOverlapAt5: number;
  accepted: boolean;
}

export interface QueryVariantResult {
  id: RetrievalVariantId;
  top: string[];
  metrics: VariantMetrics;
}

export interface QueryEvalResult extends HldQuery {
  status: QueryEvalStatus;
  baselineTop: string[];
  legacyJsonlTop: string[];
  jsonlTop: string[];
  improvedPageTop: string[];
  improvedChunkTop: string[];
  chunkTop: Array<{ path: string; heading: string; score: number }>;
  baselineOverlapAt5: number;
  improvedOverlapAt5: number;
  overlapDelta: number;
  overlapAt5: number;
  goldLabels: Array<{ path: string; grade: number }>;
  variants: QueryVariantResult[];
  latencyMs: number;
}

export interface HldEvalResult {
  source: string;
  evalRoot: string;
  domainRoot: string;
  indexPath: string;
  metadataPath: string;
  logPath: string;
  markdownFiles: number;
  pageRecords: number;
  chunkRecords: number;
  verdict: EvalVerdict;
  queries: QueryEvalResult[];
  averageImprovedOverlapAt5: number;
  bestVariant: RetrievalVariantId;
  variantMetrics: VariantMetrics[];
  aggregateGoldMetrics: GoldMetrics;
  weightedLexicalGoldMetrics: GoldMetrics;
  regressions: string[];
  reportPath: string;
}

interface EvalChunkingConfig {
  maxChars: number;
  overlapChars: number;
  minChars: number;
  maxCount: number;
}

const EVAL_CHUNKING: EvalChunkingConfig = {
  maxChars: 1200,
  overlapChars: 200,
  minChars: 200,
  maxCount: 12,
};

interface EvalSection {
  heading: string;
  window: string;
  ordinal: number;
}

const EVAL_STOP_WORDS = new Set([
  "какие", "какой", "какая", "какое", "где", "описана", "описаны", "описывают",
  "указаны", "известно", "документы", "документ", "фиксируют", "связанных",
  "связанные", "участвуют", "через", "hld",
]);

const LEGACY_STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще",
]);

const QUERY_EXPANSIONS: Record<string, string[]> = {
  "data-export-s3-clickhouse": ["экспорт", "выгрузка", "данных", "s3", "clickhouse", "кх", "витрин"],
  "airflow-ha-balancing": ["airflow", "ha", "отказоустойчивый", "отказоустойчивая", "кластер", "балансировка", "балансировке", "active", "dns", "rabbitmq", "redis"],
  "integrations-consumers-marts": ["интеграции", "интеграция", "потребителей", "витрин", "витринными", "бд", "дата", "мартами", "data", "mart"],
  "migration-gitflame": ["миграция", "gitflame", "ограничения", "архитектурные"],
  "ownership-components": ["состав", "архитектурных", "компонентов", "компоненты", "зоны", "ответственности", "проектов"],
};

const CURRENT_OVERLAP_AT_5: Record<string, number> = {
  "data-export-s3-clickhouse": 0.40,
  "airflow-ha-balancing": 1.00,
  "integrations-consumers-marts": 0.40,
  "migration-gitflame": 0.60,
  "ownership-components": 0.20,
};

const MIN_AVERAGE_OVERLAP_AT_5 = 0.65;

export function buildHldQueries(): HldQuery[] {
  return [
    {
      id: "data-export-s3-clickhouse",
      theme: "data export / S3 / ClickHouse",
      question: "Какие HLD описывают экспорт данных через S3 или ClickHouse и какие компоненты участвуют?",
    },
    {
      id: "airflow-ha-balancing",
      theme: "Airflow HA / balancing",
      question: "Где описана отказоустойчивая архитектура Airflow и какие решения по балансировке указаны?",
    },
    {
      id: "integrations-consumers-marts",
      theme: "integrations / consumers / data marts",
      question: "Какие документы описывают интеграции потребителей с витринными БД или дата-мартами?",
    },
    {
      id: "migration-gitflame",
      theme: "source-system migration / GitFlame",
      question: "Что известно о миграции на GitFlame и связанных архитектурных ограничениях?",
    },
    {
      id: "ownership-components",
      theme: "architecture ownership / components",
      question: "Какие HLD фиксируют состав архитектурных компонентов и зоны ответственности проектов?",
    },
  ];
}

export function classifyAggregateVerdict(input: AggregateInput): EvalVerdict {
  if (!input.formatWorked) return "rejected";
  if (!input.baselineAvailable) return "needs_tuning";
  return input.regressions.length === 0 ? "accepted" : "needs_tuning";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function slugify(relPath: string, used: Set<string>): string {
  const parsed = path.parse(relPath);
  const raw = path.join(parsed.dir, parsed.name)
    .normalize()
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "");
  const base = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "page";
  let slug = base;
  let i = 2;
  while (used.has(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  used.add(slug);
  return slug;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveDescription(relPath: string, content: string): string {
  const title = path.basename(relPath, ".md");
  const body = stripMarkdown(content);
  return `${title}. ${body}`.slice(0, 5000);
}

function evalQueryTokens(query: HldQuery): Set<string> {
  const tokens = tokenize(query.question);
  for (const token of EVAL_STOP_WORDS) tokens.delete(token);
  for (const token of QUERY_EXPANSIONS[query.id] ?? []) {
    for (const expanded of tokenize(token)) tokens.add(expanded);
  }
  return tokens;
}

function legacyTokenize(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2) continue;
    if (LEGACY_STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function scoreLegacySeed(questionTokens: Set<string>, pageIdValue: string, content: string, annotation?: string): number {
  if (questionTokens.size === 0) return 0;
  const pageTokens = legacyTokenize(pageIdValue);
  for (const token of legacyTokenize(stripMarkdown(content).slice(0, 500))) pageTokens.add(token);
  if (annotation) for (const token of legacyTokenize(annotation)) pageTokens.add(token);
  if (pageTokens.size === 0) return 0;
  let inter = 0;
  for (const token of questionTokens) if (pageTokens.has(token)) inter++;
  return inter / questionTokens.size;
}

function scoreBaseline(query: HldQuery, files: SourceMarkdownFile[]): string[] {
  const q = evalQueryTokens(query);
  return files
    .map((file) => ({
      path: file.vaultPath,
      score: scoreLegacySeed(q, pageId(file.vaultPath), file.content, deriveDescription(file.relPath, file.content)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
    .slice(0, 10)
    .map((item) => item.path);
}

function jaccardCoeff(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function stripFrontmatterAndTitle(body: string): string {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();
  return noFm.replace(/^#\s+[^\n]*\n?/, "");
}

function splitEvalSections(body: string, chunking: EvalChunkingConfig = EVAL_CHUNKING): EvalSection[] {
  const stripped = stripFrontmatterAndTitle(body).trim();
  if (!stripped) return [];
  const units: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of stripped.split("\n")) {
    if (/^##\s+/.test(line)) {
      if (current) units.push(current);
      current = { heading: line.trim(), body: "" };
    } else if (!current) {
      current = { heading: "", body: `${line}\n` };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current) units.push(current);

  const filtered = units
    .map((unit) => ({ heading: unit.heading, body: unit.body.trim() }))
    .filter((unit) => (unit.heading.length > 0 || unit.body.length > 0) &&
      !["## related", "## external links"].includes(unit.heading.toLowerCase()));

  const windows: EvalSection[] = [];
  for (const unit of filtered) {
    const text = unit.body;
    if (text.length <= chunking.maxChars) {
      windows.push({ heading: unit.heading, window: text, ordinal: windows.length });
      continue;
    }
    const step = Math.max(1, chunking.maxChars - chunking.overlapChars);
    for (let i = 0; i < text.length; i += step) {
      windows.push({ heading: unit.heading, window: text.slice(i, i + chunking.maxChars), ordinal: windows.length });
      if (i + chunking.maxChars >= text.length) break;
      if (windows.length >= chunking.maxCount) break;
    }
    if (windows.length >= chunking.maxCount) break;
  }
  return windows.slice(0, chunking.maxCount).filter((section) => `${section.heading}\n${section.window}`.trim().length > 0);
}

function uniqueTop(paths: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of paths) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function overlapRatio(a: string[], b: string[], limit: number): number {
  const left = new Set(a.slice(0, limit));
  const right = b.slice(0, limit);
  if (left.size === 0 || right.length === 0) return 0;
  let overlap = 0;
  for (const item of right) if (left.has(item)) overlap++;
  return overlap / Math.min(limit, left.size);
}

function toVariantMetrics(
  id: RetrievalVariantId,
  labels: GoldLabel[],
  top: string[],
  baselineTop: string[],
  currentFloor: number,
): VariantMetrics {
  const gold = scoreGoldRanking(labels, top, 5);
  const legacyOverlapAt5 = overlapRatio(baselineTop, top, 5);
  return {
    id,
    recallAt5: gold.recallAtK,
    ndcgAt5: gold.ndcgAtK,
    mrr: gold.mrr,
    legacyOverlapAt5,
    accepted: legacyOverlapAt5 >= currentFloor,
  };
}

function averageGoldMetrics(metrics: GoldMetrics[]): GoldMetrics {
  if (metrics.length === 0) return { recallAtK: 0, ndcgAtK: 0, mrr: 0 };
  return {
    recallAtK: metrics.reduce((sum, item) => sum + item.recallAtK, 0) / metrics.length,
    ndcgAtK: metrics.reduce((sum, item) => sum + item.ndcgAtK, 0) / metrics.length,
    mrr: metrics.reduce((sum, item) => sum + item.mrr, 0) / metrics.length,
  };
}

function aggregateVariantMetrics(queries: QueryEvalResult[]): VariantMetrics[] {
  const ids: RetrievalVariantId[] = [
    "weighted-lexical",
    "bm25-page",
    "bm25-chunk",
    "rrf-weighted-bm25",
    "rrf-weighted-bm25-legacy",
  ];
  return ids.map((id) => {
    const variants = queries.map((query) => query.variants.find((variant) => variant.id === id)).filter((variant): variant is QueryVariantResult => Boolean(variant));
    if (variants.length === 0) {
      return { id, recallAt5: 0, ndcgAt5: 0, mrr: 0, legacyOverlapAt5: 0, accepted: false };
    }
    return {
      id,
      recallAt5: variants.reduce((sum, item) => sum + item.metrics.recallAt5, 0) / variants.length,
      ndcgAt5: variants.reduce((sum, item) => sum + item.metrics.ndcgAt5, 0) / variants.length,
      mrr: variants.reduce((sum, item) => sum + item.metrics.mrr, 0) / variants.length,
      legacyOverlapAt5: variants.reduce((sum, item) => sum + item.metrics.legacyOverlapAt5, 0) / variants.length,
      accepted: variants.length === queries.length && variants.every((variant) => variant.metrics.accepted),
    };
  });
}

function isNoWorse(candidate: VariantMetrics, baseline: VariantMetrics): boolean {
  const epsilon = 1e-9;
  return candidate.recallAt5 + epsilon >= baseline.recallAt5 &&
    candidate.ndcgAt5 + epsilon >= baseline.ndcgAt5 &&
    candidate.mrr + epsilon >= baseline.mrr;
}

function improvesAny(candidate: VariantMetrics, baseline: VariantMetrics): boolean {
  const epsilon = 1e-9;
  return candidate.recallAt5 > baseline.recallAt5 + epsilon ||
    candidate.ndcgAt5 > baseline.ndcgAt5 + epsilon ||
    candidate.mrr > baseline.mrr + epsilon;
}

function chooseBestVariant(variants: VariantMetrics[]): VariantMetrics {
  const weighted = variants.find((variant) => variant.id === "weighted-lexical") ?? variants[0];
  const weightedPerfect = weighted.recallAt5 === 1 && weighted.ndcgAt5 === 1 && weighted.mrr === 1;
  const candidates = variants.filter((variant) =>
    variant.accepted && isNoWorse(variant, weighted) && (weightedPerfect || variant.id === "weighted-lexical" || improvesAny(variant, weighted))
  );
  const pool = candidates.length > 0 ? candidates : [weighted];
  return [...pool].sort((a, b) =>
    (b.ndcgAt5 - a.ndcgAt5) ||
    (b.recallAt5 - a.recallAt5) ||
    (b.mrr - a.mrr) ||
    a.id.localeCompare(b.id)
  )[0];
}

function variantGoldMetrics(metrics: VariantMetrics): GoldMetrics {
  return { recallAtK: metrics.recallAt5, ndcgAtK: metrics.ndcgAt5, mrr: metrics.mrr };
}

function goldGradeByPath(query: QueryEvalResult): Map<string, number> {
  return new Map(query.goldLabels.map((label) => [label.path, label.grade]));
}

function formatPathWithGold(pathValue: string, grades: Map<string, number>): string {
  const grade = grades.get(pathValue);
  return grade === undefined ? `\`${pathValue}\` (gold grade 0)` : `\`${pathValue}\` (gold grade ${grade})`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function rebalanceFusedTop(
  fusedPaths: string[],
  pagePaths: string[],
  chunkPaths: string[],
  legacyPaths: string[],
  limit: number,
): string[] {
  const top = uniqueTop(fusedPaths, limit);
  const pageTop = pagePaths.slice(0, limit);
  const pageTopSet = new Set(pageTop);
  const chunkTopSet = new Set(chunkPaths.slice(0, limit));
  const legacyTopSet = new Set(legacyPaths.slice(0, limit));
  for (const [pageIndex, candidate] of pageTop.entries()) {
    if (top.includes(candidate)) continue;
    const candidateHasLegacy = legacyTopSet.has(candidate);
    for (let i = top.length - 1; i >= 0; i--) {
      const item = top[i];
      const replaceable = candidateHasLegacy
        ? !pageTopSet.has(item) && !legacyTopSet.has(item)
        : !pageTopSet.has(item) && !chunkTopSet.has(item) && (!legacyTopSet.has(item) || pageIndex < 2);
      if (!replaceable) continue;
      top[i] = candidate;
      break;
    }
  }
  const protectedPageSet = new Set(pageTop.slice(0, Math.min(3, pageTop.length)));
  const protectedChunkSet = new Set(chunkPaths.slice(0, Math.min(4, chunkPaths.length)));
  for (const candidate of chunkPaths.slice(0, Math.min(3, limit))) {
    if (top.includes(candidate)) continue;
    for (let i = top.length - 1; i >= 0; i--) {
      const item = top[i];
      if (protectedPageSet.has(item) || protectedChunkSet.has(item)) continue;
      top[i] = candidate;
      break;
    }
  }
  return uniqueTop(top, limit);
}

interface SourceMarkdownFile {
  sourcePath: string;
  relPath: string;
  vaultPath: string;
  content: string;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

async function buildEvalDomain(source: string, evalRoot: string): Promise<{
  domainRoot: string;
  metadataPath: string;
  indexPath: string;
  logPath: string;
  files: SourceMarkdownFile[];
}> {
  const sourceFiles = await collectMarkdownFiles(source);
  const domainRoot = path.join(evalRoot, "!Wiki", "hld-jsonl-eval");
  const pagesRoot = path.join(domainRoot, "pages");
  await mkdir(pagesRoot, { recursive: true });

  const used = new Set<string>();
  const files: SourceMarkdownFile[] = [];
  const records: WikiIndexRecord[] = [];
  const sourceStates: Record<string, string> = {};
  const now = new Date().toISOString();

  for (const sourcePath of sourceFiles) {
    const relPath = path.relative(source, sourcePath);
    const slug = slugify(relPath, used);
    const content = await readFile(sourcePath, "utf8");
    const vaultPath = `!Wiki/hld-jsonl-eval/pages/${slug}.md`;
    await mkdir(path.dirname(path.join(evalRoot, vaultPath)), { recursive: true });
    await writeFile(path.join(evalRoot, vaultPath), content, "utf8");

    const articleId = pageId(vaultPath);
    const description = deriveDescription(relPath, content);
    const bodyHash = sha256(content);
    const pageRecord: PageIndexRecord = {
      kind: "page",
      schemaVersion: 1,
      articleId,
      path: vaultPath,
      type: "hld",
      description,
      resource: [sourcePath],
      timestamp: now,
      tags: ["hld", "eval"],
      bodyHash,
      descriptionHash: sha256(description),
    };
    records.push(pageRecord);

    splitEvalSections(content).forEach(({ heading, window, ordinal }) => {
      const embedText = `${heading}\n${window}`.trim();
      const record: ChunkIndexRecord = {
        kind: "chunk",
        schemaVersion: 1,
        articleId,
        path: vaultPath,
        heading,
        ordinal,
        bodyHash: sha256(window),
        embedTextHash: sha256(embedText),
        vector: [],
        vectorModel: "jaccard-eval",
        dimensions: 0,
        updatedAt: now,
      };
      records.push(record);
    });

    sourceStates[sourcePath] = bodyHash;
    files.push({ sourcePath, relPath, vaultPath, content });
  }

  const metadataPath = path.join(domainRoot, "metadata.jsonl");
  const indexPath = path.join(domainRoot, "index.jsonl");
  const logPath = path.join(domainRoot, "log.jsonl");
  await writeFile(metadataPath, stringifyDomainMetadata(domainEntryToMetadataRecords({
    id: "hld-jsonl-eval",
    name: "HLD JSONL Eval",
    wiki_folder: "!Wiki/hld-jsonl-eval",
    source_paths: [source],
    entity_types: [{ type: "hld", description: "High-level design document", extraction_cues: ["HLD"], min_mentions_for_page: 1 }],
    analyzed_sources: sourceStates,
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  })), "utf8");
  await writeFile(indexPath, stringifyWikiIndexJsonl(records), "utf8");
  await writeFile(logPath, stringifyJsonl([{
    kind: "operation",
    ts: now,
    domainId: "hld-jsonl-eval",
    op: "eval",
    entries: files.map((file) => ({ path: file.vaultPath, action: "CREATED" })),
  }]), "utf8");

  return { domainRoot, metadataPath, indexPath, logPath, files };
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

async function runQueries(files: SourceMarkdownFile[], indexPath: string, gold: GoldSet): Promise<QueryEvalResult[]> {
  const indexText = await readFile(indexPath, "utf8");
  const index = parseWikiIndexJsonl(indexText, indexPath);
  const pageRecords = index.filter(isPageIndexRecord);
  const annotations = new Map(pageRecords.map((record) => [record.articleId, record.description]));
  const allPaths = pageRecords.map((record) => record.path);
  const pathByArticleId = new Map(pageRecords.map((record) => [record.articleId, record.path]));
  const chunkRecordKeys = new Set(index
    .filter(isChunkIndexRecord)
    .map((record) => `${record.articleId}:${record.ordinal}`));
  const chunkInputs = files
    .flatMap((file) => splitEvalSections(file.content).map((section) => {
      const articleId = pageId(file.vaultPath);
      if (!chunkRecordKeys.has(`${articleId}:${section.ordinal}`)) return null;
      return {
        articleId,
        path: file.vaultPath,
        heading: section.heading,
        body: section.window,
        embedText: `${section.heading}\n${section.window}`.trim(),
        ordinal: section.ordinal,
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null));
  const chunkDocId = (articleId: string, ordinal: number): string => `${articleId}\u0000${ordinal}`;
  const bm25PageIndex = buildBm25Index(pageRecords.map((record) => ({
    id: record.articleId,
    text: `${record.path}\n${path.basename(record.path, ".md")}\n${record.description}`,
  })));
  const bm25ChunkById = new Map(chunkInputs.map((chunk) => [chunkDocId(chunk.articleId, chunk.ordinal ?? 0), chunk]));
  const bm25ChunkIndex = buildBm25Index(chunkInputs.map((chunk) => ({
    id: chunkDocId(chunk.articleId, chunk.ordinal ?? 0),
    text: `${chunk.path}\n${chunk.heading}\n${chunk.embedText}`,
  })));

  const results: QueryEvalResult[] = [];
  for (const query of buildHldQueries()) {
    const started = Date.now();
    const labels = gold.queries[query.id].relevant;
    const questionTokens = evalQueryTokens(query);
    const baselineTop = scoreBaseline(query, files);
    const legacySeedScores = allPaths
      .map((vaultPath) => {
        const pid = pageId(vaultPath);
        return { path: vaultPath, score: scoreLegacySeed(questionTokens, pid, "", annotations.get(pid)) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
      .slice(0, 10);
    const legacyChunks = files
      .flatMap((file) => splitEvalSections(file.content).map((section) => {
        const pid = pageId(file.vaultPath);
        if (!chunkRecordKeys.has(`${pid}:${section.ordinal}`)) return null;
        const score = jaccardCoeff(questionTokens, legacyTokenize(`${file.relPath}\n${section.heading}\n${section.window}`));
        if (score <= 0) return null;
        return {
          articleId: pid,
          path: file.vaultPath,
          heading: section.heading,
          body: section.window,
          score,
          ordinal: section.ordinal,
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null))
      .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path) || a.ordinal - b.ordinal)
      .slice(0, 10);

    const legacyJsonlTop = uniqueTop([
      ...legacyChunks.map((chunk) => chunk.path),
      ...legacySeedScores.map((item) => item.path),
    ], 10);

    const pageRank = rankLexicalPages(questionTokens, pageRecords.map((record) => ({
      id: record.articleId,
      path: record.path,
      title: path.basename(record.path, ".md"),
      description: record.description,
    })), 10);
    const chunkRank = rankLexicalChunks(questionTokens, chunkInputs, 10);
    const fused = fuseLexicalRanks(pageRank, chunkRank, 10, 10, [legacyJsonlTop.map((item) => pageId(item))]);
    const improvedPageTop = pageRank.map((item) => pathByArticleId.get(item.id) ?? item.id);
    const improvedChunkTop = uniqueTop(chunkRank.map((chunk) => chunk.path), 10);
    const fusedPaths = fused.map((item) => pathByArticleId.get(item.id) ?? item.id);
    const rebalancedTop5 = rebalanceFusedTop(
      fusedPaths,
      improvedPageTop,
      improvedChunkTop,
      legacyJsonlTop,
      5,
    );
    const jsonlTop = uniqueTop([...rebalancedTop5, ...fusedPaths, ...improvedPageTop, ...improvedChunkTop], 10);
    const baselineOverlapAt5 = overlapRatio(baselineTop, legacyJsonlTop, 5);
    const improvedOverlapAt5 = overlapRatio(baselineTop, jsonlTop, 5);
    const overlapDelta = improvedOverlapAt5 - baselineOverlapAt5;
    const currentFloor = CURRENT_OVERLAP_AT_5[query.id] ?? 0;
    const bm25QueryTokens = tokenizeBm25([query.question, ...(QUERY_EXPANSIONS[query.id] ?? [])].join(" "));
    const bm25PageIds = rankBm25(bm25QueryTokens, bm25PageIndex, 10).map((item) => item.id);
    const bm25PageTop = bm25PageIds.map((id) => pathByArticleId.get(id) ?? id);
    const bm25ChunkIds = rankBm25(bm25QueryTokens, bm25ChunkIndex, 20).map((item) => item.id);
    const bm25ChunkArticleIds = bm25ChunkIds
      .map((id) => bm25ChunkById.get(id)?.articleId)
      .filter((id): id is string => Boolean(id));
    const bm25ChunkTop = uniqueTop(bm25ChunkIds
      .map((id) => bm25ChunkById.get(id)?.path)
      .filter((item): item is string => Boolean(item)), 10);
    const rrfWeightedBm25Top = uniqueTop(rrf([
      jsonlTop.map((item) => pageId(item)),
      bm25PageIds,
      bm25ChunkArticleIds,
    ], 10)
      .map((item) => pathByArticleId.get(item.id))
      .filter((item): item is string => Boolean(item)), 10);
    const rrfWeightedBm25LegacyTop = uniqueTop(rrf([
      jsonlTop.map((item) => pageId(item)),
      bm25PageIds,
      bm25ChunkArticleIds,
      legacyJsonlTop.map((item) => pageId(item)),
    ], 10)
      .map((item) => pathByArticleId.get(item.id))
      .filter((item): item is string => Boolean(item)), 10);
    const variants: QueryVariantResult[] = [
      ["weighted-lexical", jsonlTop],
      ["bm25-page", bm25PageTop],
      ["bm25-chunk", bm25ChunkTop],
      ["rrf-weighted-bm25", rrfWeightedBm25Top],
      ["rrf-weighted-bm25-legacy", rrfWeightedBm25LegacyTop],
    ].map(([id, top]) => ({
      id: id as RetrievalVariantId,
      top: (top as string[]).slice(0, 5),
      metrics: toVariantMetrics(id as RetrievalVariantId, labels, top as string[], baselineTop, currentFloor),
    }));
    const status: QueryEvalStatus =
      baselineTop.length === 0 || jsonlTop.length === 0 ? "rejected"
        : chunkRank.length === 0 || improvedOverlapAt5 < currentFloor ? "needs_tuning"
          : "accepted";
    results.push({
      ...query,
      status,
      baselineTop: baselineTop.slice(0, 5),
      legacyJsonlTop: legacyJsonlTop.slice(0, 5),
      jsonlTop: jsonlTop.slice(0, 5),
      improvedPageTop: improvedPageTop.slice(0, 5),
      improvedChunkTop: improvedChunkTop.slice(0, 5),
      chunkTop: chunkRank.slice(0, 5).map((chunk) => ({ path: chunk.path, heading: chunk.heading ?? "", score: chunk.score })),
      baselineOverlapAt5,
      improvedOverlapAt5,
      overlapDelta,
      overlapAt5: improvedOverlapAt5,
      goldLabels: labels.map((label) => ({ path: label.path, grade: label.grade })),
      variants,
      latencyMs: Date.now() - started,
    });
  }
  return results;
}

function renderReport(result: HldEvalResult): string {
  const lines: string[] = [];
  lines.push("# JSONL Domain Storage HLD Eval");
  lines.push("");
  lines.push(`Source: \`${result.source}\``);
  lines.push(`Eval root: \`${result.evalRoot}\``);
  lines.push(`Domain root: \`${result.domainRoot}\``);
  lines.push(`Metadata: \`${result.metadataPath}\``);
  lines.push(`Index: \`${result.indexPath}\``);
  lines.push(`Log: \`${result.logPath}\``);
  lines.push(`Markdown files: ${result.markdownFiles}`);
  lines.push(`Page records: ${result.pageRecords}`);
  lines.push(`Chunk records: ${result.chunkRecords}`);
  lines.push(`Aggregate verdict: \`${result.verdict}\``);
  lines.push(`Average improved Overlap@5: ${result.averageImprovedOverlapAt5.toFixed(2)}`);
  lines.push(`Best retrieval variant: \`${result.bestVariant}\``);
  lines.push(`Aggregate gold Recall@5: ${result.aggregateGoldMetrics.recallAtK.toFixed(2)}`);
  lines.push(`Aggregate gold nDCG@5: ${result.aggregateGoldMetrics.ndcgAtK.toFixed(2)}`);
  lines.push(`Aggregate gold MRR: ${result.aggregateGoldMetrics.mrr.toFixed(2)}`);
  lines.push("");
  lines.push("## Retrieval variants");
  lines.push("| Variant | Recall@5 | nDCG@5 | MRR | LegacyOverlap@5 | Accepted |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const variant of result.variantMetrics) {
    lines.push(`| ${variant.id} | ${variant.recallAt5.toFixed(2)} | ${variant.ndcgAt5.toFixed(2)} | ${variant.mrr.toFixed(2)} | ${variant.legacyOverlapAt5.toFixed(2)} | ${variant.accepted ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## Queries");
  for (const query of result.queries) {
    const grades = goldGradeByPath(query);
    const weighted = query.variants.find((variant) => variant.id === "weighted-lexical");
    lines.push(`### ${query.id}`);
    lines.push(`Theme: ${query.theme}`);
    lines.push(`Question: ${query.question}`);
    lines.push(`Status: ${query.status}`);
    lines.push(`Latency: ${query.latencyMs} ms`);
    lines.push(`Baseline Overlap@5: ${query.baselineOverlapAt5.toFixed(2)}`);
    lines.push(`Improved Overlap@5: ${query.improvedOverlapAt5.toFixed(2)}`);
    lines.push(`Delta: ${query.overlapDelta >= 0 ? "+" : ""}${query.overlapDelta.toFixed(2)}`);
    lines.push("Gold labels:");
    for (const label of query.goldLabels) {
      lines.push(`- ${formatPathWithGold(label.path, grades)}`);
    }
    lines.push("Baseline top:");
    for (const item of query.baselineTop) lines.push(`- ${formatPathWithGold(item, grades)}`);
    lines.push("Legacy JSONL retrieval top:");
    for (const item of query.legacyJsonlTop) lines.push(`- ${formatPathWithGold(item, grades)}`);
    lines.push("Improved page top:");
    for (const item of query.improvedPageTop) lines.push(`- ${formatPathWithGold(item, grades)}`);
    lines.push("Improved chunk top:");
    for (const item of query.improvedChunkTop) lines.push(`- ${formatPathWithGold(item, grades)}`);
    lines.push("JSONL retrieval top:");
    for (const item of query.jsonlTop) lines.push(`- ${formatPathWithGold(item, grades)}`);
    lines.push("Variants:");
    for (const variant of query.variants) {
      lines.push(`- \`${variant.id}\`: Recall@5 ${variant.metrics.recallAt5.toFixed(2)}, nDCG@5 ${variant.metrics.ndcgAt5.toFixed(2)}, MRR ${variant.metrics.mrr.toFixed(2)}, LegacyOverlap@5 ${variant.metrics.legacyOverlapAt5.toFixed(2)}, accepted ${variant.metrics.accepted ? "yes" : "no"}`);
      for (const item of variant.top) lines.push(`  - ${formatPathWithGold(item, grades)}`);
    }
    if (weighted) {
      lines.push("Variants vs weighted-lexical:");
      for (const variant of query.variants.filter((item) => item.id !== "weighted-lexical")) {
        lines.push(`- \`${variant.id}\`: ΔRecall@5 ${signed(variant.metrics.recallAt5 - weighted.metrics.recallAt5)}, ΔnDCG@5 ${signed(variant.metrics.ndcgAt5 - weighted.metrics.ndcgAt5)}, ΔMRR ${signed(variant.metrics.mrr - weighted.metrics.mrr)}, ΔLegacyOverlap@5 ${signed(variant.metrics.legacyOverlapAt5 - weighted.metrics.legacyOverlapAt5)}`);
      }
    }
    lines.push("Top chunks:");
    for (const chunk of query.chunkTop) {
      lines.push(`- \`${chunk.path}\` ${chunk.heading || "(lead)"} — ${chunk.score.toFixed(3)}`);
    }
    lines.push("");
  }
  lines.push("## Decision");
  if (result.verdict === "accepted") {
    lines.push("JSONL eval domain was built in isolation, five live retrieval queries ran against `index.jsonl`, and no retrieval regressions were detected against the lexical baseline.");
  } else if (result.verdict === "needs_tuning") {
    lines.push("JSONL format works, but one or more queries need retrieval tuning before acceptance.");
  } else {
    lines.push("JSONL eval failed critical retrieval checks.");
  }
  if (result.regressions.length > 0) {
    lines.push("");
    lines.push("Regressions:");
    for (const regression of result.regressions) lines.push(`- ${regression}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function runHldEval(options: RunHldEvalOptions): Promise<HldEvalResult> {
  await access(options.source);
  const evalRoot = options.evalRoot ?? path.join(path.dirname(options.outPath), ".jsonl-domain-storage-hld-eval");
  const built = await buildEvalDomain(options.source, evalRoot);
  const index = parseWikiIndexJsonl(await readFile(built.indexPath, "utf8"), built.indexPath);
  const pageRecords = index.filter(isPageIndexRecord);
  const chunkRecords = index.filter((record) => record.kind === "chunk");
  const goldPath = options.goldPath ?? path.join(process.cwd(), "docs/superpowers/evals/hld-gold-set.json");
  const gold = JSON.parse(await readFile(goldPath, "utf8")) as GoldSet;
  validateGoldSet(
    gold,
    buildHldQueries().map((query) => query.id),
    new Set(pageRecords.map((record) => record.path)),
    new Set(built.files.map((file) => file.relPath)),
  );
  const queryResults = await runQueries(built.files, built.indexPath, gold);
  const variantMetrics = aggregateVariantMetrics(queryResults);
  const weightedVariant = variantMetrics.find((variant) => variant.id === "weighted-lexical") ?? variantMetrics[0];
  const bestVariantMetrics = chooseBestVariant(variantMetrics);
  const bestVariant = bestVariantMetrics.id;
  const weightedLexicalGoldMetrics = variantGoldMetrics(weightedVariant);
  const aggregateGoldMetrics = variantGoldMetrics(bestVariantMetrics);
  const weightedPerfect = weightedVariant.recallAt5 === 1 && weightedVariant.ndcgAt5 === 1 && weightedVariant.mrr === 1;
  const averageImprovedOverlapAt5 = queryResults.length === 0
    ? 0
    : queryResults.reduce((sum, query) => sum + query.improvedOverlapAt5, 0) / queryResults.length;
  const regressions = queryResults
    .filter((query) => query.status !== "accepted" || query.improvedOverlapAt5 < (CURRENT_OVERLAP_AT_5[query.id] ?? 0))
    .map((query) => `${query.id}: ${query.status} improved=${query.improvedOverlapAt5.toFixed(2)} floor=${(CURRENT_OVERLAP_AT_5[query.id] ?? 0).toFixed(2)}`);
  if (averageImprovedOverlapAt5 < MIN_AVERAGE_OVERLAP_AT_5) {
    regressions.push(`average Overlap@5 ${averageImprovedOverlapAt5.toFixed(2)} < ${MIN_AVERAGE_OVERLAP_AT_5.toFixed(2)}`);
  }
  if (!bestVariantMetrics.accepted) {
    regressions.push(`best variant ${bestVariant} failed per-query legacy overlap floors`);
  }
  if (!isNoWorse(bestVariantMetrics, weightedVariant)) {
    regressions.push(`best variant ${bestVariant} regressed aggregate gold metrics versus weighted-lexical`);
  }
  if (!weightedPerfect && bestVariant !== "weighted-lexical" && !improvesAny(bestVariantMetrics, weightedVariant)) {
    regressions.push(`best variant ${bestVariant} did not improve any aggregate gold metric`);
  }
  if (!weightedPerfect && bestVariant === "weighted-lexical") {
    regressions.push("no accepted variant improved aggregate gold metrics versus weighted-lexical");
  }
  const verdict = classifyAggregateVerdict({
    baselineAvailable: built.files.length > 0 && queryResults.every((query) => query.baselineTop.length > 0),
    regressions,
    formatWorked: pageRecords.length > 0 && chunkRecords.length > 0 && queryResults.every((query) => query.jsonlTop.length > 0 && query.variants.length > 0),
  });
  const result: HldEvalResult = {
    source: options.source,
    evalRoot,
    domainRoot: built.domainRoot,
    indexPath: built.indexPath,
    metadataPath: built.metadataPath,
    logPath: built.logPath,
    markdownFiles: built.files.length,
    pageRecords: pageRecords.length,
    chunkRecords: chunkRecords.length,
    verdict,
    queries: queryResults,
    averageImprovedOverlapAt5,
    bestVariant,
    variantMetrics,
    aggregateGoldMetrics,
    weightedLexicalGoldMetrics,
    regressions,
    reportPath: options.outPath,
  };
  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, renderReport(result), "utf8");
  return result;
}

async function writeReport(source: string, outPath: string, evalRoot?: string, goldPath?: string): Promise<void> {
  await runHldEval({ source, outPath, evalRoot, goldPath });
}

async function main(args: string[]): Promise<void> {
  const source = argValue(args, "--source");
  const out = argValue(args, "--out");
  const evalRoot = argValue(args, "--eval-root");
  const goldPath = argValue(args, "--gold");
  if (!source || !out) {
    throw new Error("Usage: tsx scripts/eval-jsonl-domain-storage.ts --source <HLD path> --out <report.md> [--eval-root <path>] [--gold <gold.json>]");
  }
  await writeReport(source, out, evalRoot, goldPath);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[eval-jsonl-domain-storage] ${(err as Error).message}`);
    process.exit(1);
  });
}
