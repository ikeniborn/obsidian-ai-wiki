#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parse as yamlParse } from "yaml";

const runRoot = path.resolve(process.argv[2]
  ?? process.env.AIWIKI_TEST_VAULT
  ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run");
const beforeRoot = path.resolve(process.argv[3]
  ?? path.join(path.dirname(runRoot), "before"));
const resultsPath = path.resolve(process.argv[4]
  ?? "docs/loen/dynamic-llm-budget-routing/evidence/os-unix-query-quality.json");
const outputPath = process.argv[5] ? path.resolve(process.argv[5]) : undefined;
const domainRoot = path.join(runRoot, "!Wiki", "os-unix");

function walkMarkdown(root) {
  const files = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(filePath);
    }
  };
  visit(root);
  return files.sort();
}

function parseMarkdown(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  return {
    frontmatter: yamlParse(match[1]) ?? {},
    body: content.slice(match[0].length),
  };
}

function asStrings(value) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function normalize(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function safeReadResource(resource) {
  const filePath = path.resolve(beforeRoot, resource);
  const relative = path.relative(beforeRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf8");
}

function extractTechnicalUnits(markdown) {
  const units = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line && !line.startsWith("#")) units.push(normalize(line));
    if (!inFence) {
      for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
        const value = match[1].trim();
        if (value.length >= 3) units.push(normalize(value));
      }
    }
  }
  return unique(units);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

const pages = new Map(walkMarkdown(domainRoot).map((filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseMarkdown(content);
  return [path.basename(filePath, ".md"), {
    body: parsed.body,
    resources: asStrings(parsed.frontmatter.resource),
  }];
}));
const queryResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

const cases = queryResults.results.map((result) => {
  const foundPages = result.foundPages
    .map((stem) => pages.get(stem))
    .filter(Boolean);
  const pageCorpus = normalize(foundPages.map((page) => page.body).join("\n"));
  const resources = unique(foundPages.flatMap((page) => page.resources));
  const sourceCorpus = normalize(resources.map(safeReadResource).filter(Boolean).join("\n"));
  const units = extractTechnicalUnits(result.answer ?? "");
  const pageGrounded = units.filter((unit) => pageCorpus.includes(unit));
  const sourceGrounded = units.filter((unit) => sourceCorpus.includes(unit));
  return {
    id: result.id,
    status: result.status,
    foundPages: result.foundPages,
    resources,
    technicalUnits: units,
    pageGrounded,
    sourceGrounded,
    missingFromPages: units.filter((unit) => !pageGrounded.includes(unit)),
    missingFromSources: units.filter((unit) => !sourceGrounded.includes(unit)),
    pageGrounding: ratio(pageGrounded.length, units.length),
    sourceGrounding: ratio(sourceGrounded.length, units.length),
  };
});

const completed = cases.filter((item) => item.status === "done");
const totals = completed.reduce((acc, item) => {
  acc.units += item.technicalUnits.length;
  acc.page += item.pageGrounded.length;
  acc.source += item.sourceGrounded.length;
  return acc;
}, { units: 0, page: 0, source: 0 });
const output = {
  runRoot,
  beforeRoot,
  resultsPath,
  summary: {
    completedCases: completed.length,
    technicalUnits: totals.units,
    pageGroundedUnits: totals.page,
    sourceGroundedUnits: totals.source,
    pageGrounding: ratio(totals.page, totals.units),
    sourceGrounding: ratio(totals.source, totals.units),
  },
  cases,
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
console.log(serialized);
