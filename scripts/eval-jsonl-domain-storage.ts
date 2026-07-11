#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type EvalVerdict = "accepted" | "needs_tuning" | "rejected";

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

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

async function writeReport(source: string, outPath: string): Promise<void> {
  await access(source);
  const files = await collectMarkdownFiles(source);
  const queries = buildHldQueries();
  const verdict = classifyAggregateVerdict({
    baselineAvailable: false,
    regressions: ["Baseline retrieval snapshot is not produced by this dry-run harness."],
    formatWorked: files.length > 0,
  });
  const samples = await Promise.all(files.slice(0, 5).map(async (file) => {
    const text = await readFile(file, "utf8");
    return { file, chars: text.length };
  }));

  const lines: string[] = [];
  lines.push("# JSONL Domain Storage HLD Eval");
  lines.push("");
  lines.push(`Source: \`${source}\``);
  lines.push(`Markdown files: ${files.length}`);
  lines.push(`Aggregate verdict: \`${verdict}\``);
  lines.push("");
  lines.push("## Sampled Files");
  for (const sample of samples) lines.push(`- \`${sample.file}\` — ${sample.chars} chars`);
  lines.push("");
  lines.push("## Queries");
  for (const query of queries) {
    lines.push(`### ${query.id}`);
    lines.push(`Theme: ${query.theme}`);
    lines.push(`Question: ${query.question}`);
    lines.push("Status: blocked — retrieval baseline and live query execution are not wired into this dry-run harness yet.");
    lines.push("");
  }
  lines.push("## Decision");
  lines.push("The harness is operational and source-safe, but aggregate verdict remains `needs_tuning` until baseline and live retrieval evidence are captured.");
  lines.push("");

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");
}

async function main(args: string[]): Promise<void> {
  const source = argValue(args, "--source");
  const out = argValue(args, "--out");
  if (!source || !out) {
    throw new Error("Usage: tsx scripts/eval-jsonl-domain-storage.ts --source <HLD path> --out <report.md>");
  }
  await writeReport(source, out);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[eval-jsonl-domain-storage] ${(err as Error).message}`);
    process.exit(1);
  });
}
