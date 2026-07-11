#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { domainEntryToMetadataRecords, stringifyDomainMetadata } from "../src/domain-metadata";
import { stringifyJsonl } from "../src/jsonl";
import { tokenize, scoreSeed } from "../src/wiki-seeds";
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
}

export interface QueryEvalResult extends HldQuery {
  status: QueryEvalStatus;
  baselineTop: string[];
  jsonlTop: string[];
  chunkTop: Array<{ path: string; heading: string; score: number }>;
  overlapAt5: number;
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

const QUERY_EXPANSIONS: Record<string, string[]> = {
  "data-export-s3-clickhouse": ["экспорт", "выгрузка", "данных", "s3", "clickhouse", "кх", "витрин"],
  "airflow-ha-balancing": ["airflow", "ha", "отказоустойчивый", "отказоустойчивая", "кластер", "балансировка", "балансировке", "active", "dns", "rabbitmq", "redis"],
  "integrations-consumers-marts": ["интеграции", "интеграция", "потребителей", "витрин", "витринными", "бд", "дата", "мартами", "data", "mart"],
  "migration-gitflame": ["миграция", "gitflame", "ограничения", "архитектурные"],
  "ownership-components": ["состав", "архитектурных", "компонентов", "компоненты", "зоны", "ответственности", "проектов"],
};

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

function scoreBaseline(query: HldQuery, files: SourceMarkdownFile[]): string[] {
  const q = evalQueryTokens(query);
  return files
    .map((file) => ({
      path: file.vaultPath,
      score: scoreSeed(q, pageId(file.vaultPath), file.content, deriveDescription(file.relPath, file.content)),
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

async function runQueries(files: SourceMarkdownFile[], indexPath: string): Promise<QueryEvalResult[]> {
  const indexText = await readFile(indexPath, "utf8");
  const index = parseWikiIndexJsonl(indexText, indexPath);
  const pageRecords = index.filter(isPageIndexRecord);
  const annotations = new Map(pageRecords.map((record) => [record.articleId, record.description]));
  const allPaths = pageRecords.map((record) => record.path);
  const chunkRecordKeys = new Set(index
    .filter(isChunkIndexRecord)
    .map((record) => `${record.articleId}:${record.ordinal}`));

  const results: QueryEvalResult[] = [];
  for (const query of buildHldQueries()) {
    const started = Date.now();
    const questionTokens = evalQueryTokens(query);
    const baselineTop = scoreBaseline(query, files);
    const seedScores = allPaths
      .map((vaultPath) => {
        const pid = pageId(vaultPath);
        return { path: vaultPath, score: scoreSeed(questionTokens, pid, "", annotations.get(pid)) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
      .slice(0, 10);
    const chunks = files
      .flatMap((file) => splitEvalSections(file.content).map((section) => {
        const pid = pageId(file.vaultPath);
        if (!chunkRecordKeys.has(`${pid}:${section.ordinal}`)) return null;
        const score = jaccardCoeff(questionTokens, tokenize(`${file.relPath}\n${section.heading}\n${section.window}`));
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
    const jsonlTop = uniqueTop([
      ...chunks.map((chunk) => chunk.path),
      ...seedScores.map((item) => item.path),
    ], 10);
    const overlapAt5 = overlapRatio(baselineTop, jsonlTop, 5);
    const status: QueryEvalStatus =
      baselineTop.length === 0 || jsonlTop.length === 0 ? "rejected"
        : chunks.length === 0 || overlapAt5 < 0.2 ? "needs_tuning"
          : "accepted";
    results.push({
      ...query,
      status,
      baselineTop: baselineTop.slice(0, 5),
      jsonlTop: jsonlTop.slice(0, 5),
      chunkTop: chunks.slice(0, 5).map((chunk) => ({ path: chunk.path, heading: chunk.heading, score: chunk.score })),
      overlapAt5,
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
  lines.push("");
  lines.push("## Queries");
  for (const query of result.queries) {
    lines.push(`### ${query.id}`);
    lines.push(`Theme: ${query.theme}`);
    lines.push(`Question: ${query.question}`);
    lines.push(`Status: ${query.status}`);
    lines.push(`Latency: ${query.latencyMs} ms`);
    lines.push(`Overlap@5: ${query.overlapAt5.toFixed(2)}`);
    lines.push("Baseline top:");
    for (const item of query.baselineTop) lines.push(`- \`${item}\``);
    lines.push("JSONL retrieval top:");
    for (const item of query.jsonlTop) lines.push(`- \`${item}\``);
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
  const queryResults = await runQueries(built.files, built.indexPath);
  const regressions = queryResults
    .filter((query) => query.status !== "accepted")
    .map((query) => `${query.id}: ${query.status}`);
  const verdict = classifyAggregateVerdict({
    baselineAvailable: built.files.length > 0 && queryResults.every((query) => query.baselineTop.length > 0),
    regressions,
    formatWorked: pageRecords.length > 0 && chunkRecords.length > 0 && queryResults.every((query) => query.jsonlTop.length > 0),
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
    regressions,
    reportPath: options.outPath,
  };
  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, renderReport(result), "utf8");
  return result;
}

async function writeReport(source: string, outPath: string, evalRoot?: string): Promise<void> {
  await runHldEval({ source, outPath, evalRoot });
}

async function main(args: string[]): Promise<void> {
  const source = argValue(args, "--source");
  const out = argValue(args, "--out");
  const evalRoot = argValue(args, "--eval-root");
  if (!source || !out) {
    throw new Error("Usage: tsx scripts/eval-jsonl-domain-storage.ts --source <HLD path> --out <report.md> [--eval-root <path>]");
  }
  await writeReport(source, out, evalRoot);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[eval-jsonl-domain-storage] ${(err as Error).message}`);
    process.exit(1);
  });
}
