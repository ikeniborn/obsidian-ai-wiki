#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parse as yamlParse } from "yaml";

const domainId = process.argv[2] ?? "os-unix";
const runRoot = path.resolve(process.argv[3]
  ?? process.env.AIWIKI_TEST_VAULT
  ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run");
const beforeRoot = path.resolve(process.argv[4]
  ?? path.join(path.dirname(runRoot), "before"));
const outputPath = process.argv[5] ? path.resolve(process.argv[5]) : undefined;
const expectedTimestamp = process.argv[6];
const sourceRoot = path.join(beforeRoot, "ОС", "Unix");
const domainRoot = path.join(runRoot, "!Wiki", domainId);

function walkMarkdown(root) {
  const files = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(filePath);
    }
  };
  visit(root);
  return files.sort();
}

function parseMarkdown(content, filePath) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  let frontmatter;
  try {
    frontmatter = yamlParse(match[1]) ?? {};
  } catch (error) {
    throw new Error(`${filePath}: ${error.message}`);
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

function asStrings(value) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function wikilinkTarget(value) {
  const match = /^!?\[\[([^\]]+)\]\]$/.exec(String(value).trim());
  return (match?.[1] ?? String(value)).split("|")[0].split("#")[0].trim();
}

function normalizeIdentity(raw) {
  let value = wikilinkTarget(raw).normalize("NFC").trim();
  value = value.replace(/\\/g, "/").split("/").at(-1) ?? value;
  value = value.replace(/\.md$/i, "");
  const prefix = `wiki_${domainId}_`;
  if (value.toLowerCase().startsWith(prefix)) value = value.slice(prefix.length);
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([^\p{L}\p{N}])+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizedText(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function markdownH1Count(markdown) {
  let count = 0;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#\s+\S/.test(line)) count++;
  }
  return count;
}

function h2At(markdown, index) {
  return [...markdown.slice(0, index).matchAll(/^##\s+(.+)$/gm)].at(-1)?.[1]?.trim();
}

const commandStart = /^(?:\$\s*)?(?:sudo\b|apt(?:-get)?\b|dnf\b|yum\b|curl\b|wget\b|git\b|systemctl\b|journalctl\b|ufw\b|iptables\b|nft\b|ss\b|nstat\b|netstat\b|nmcli\b|ip\b|mount\b|umount\b|lsblk\b|fdisk\b|du\b|cp\b|mv\b|rm\b|mkdir\b|chmod\b|chown\b|nano\b|vim\b|echo\b|export\b|source\b|nvm\b|npm\b|grub-mkconfig\b|update-grub\b|sysctl\b|swapoff\b|swapon\b|mkswap\b|ssh(?:-keygen|-copy-id|-add)?\b|scp\b|useradd\b|usermod\b|passwd\b|groupadd\b|modprobe\b|lspci\b|lsusb\b|cat\b|grep\b|sed\b|awk\b|find\b|dd\b|tee\b)/i;

function extractTechnicalSnippets(markdown) {
  const snippets = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line && !line.startsWith("#")) snippets.push(normalizedText(line));
    if (!inFence && commandStart.test(line)) snippets.push(normalizedText(line.replace(/^\$\s*/, "")));
    if (!inFence && /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_.-]*)=\S/.test(line)) {
      snippets.push(normalizedText(line));
    }
    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const value = normalizedText(match[1]);
      if (value.length >= 4 && (/[\s=|]/.test(value) || value.includes("/") || value.includes("--"))) {
        snippets.push(value);
      }
    }
  }
  return unique(snippets);
}

function extractUrls(markdown) {
  return unique([...markdown.matchAll(/https?:\/\/[^\s<>)\]}"'`]+/g)]
    .map((match) => match[0].replace(/[.,;:]+$/, "")));
}

function extractTechnicalValues(markdown) {
  const patterns = [
    /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    /\b\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?\b/g,
    /\b\d+(?:\.\d+)?\s*(?:%|[KMGT]i?B|ms|s|sec|min|h)\b/gi,
  ];
  return unique(patterns.flatMap((pattern) => [...markdown.matchAll(pattern)].map((match) => match[0])));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

const sourceFiles = walkMarkdown(sourceRoot);
const pageFiles = walkMarkdown(domainRoot);
const pages = pageFiles.map((filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseMarkdown(content, filePath);
  const relativePath = path.relative(runRoot, filePath).split(path.sep).join("/");
  const title = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const identities = unique([
    path.basename(filePath, ".md"),
    title,
    ...asStrings(parsed.frontmatter.aliases),
  ].map(normalizeIdentity));
  return {
    filePath,
    relativePath,
    content,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    resources: asStrings(parsed.frontmatter.resource),
    identities,
    h1Count: markdownH1Count(parsed.body),
    urls: extractUrls(parsed.body),
  };
});

const pageIdentities = new Set(pages.flatMap((page) => page.identities));
const pagesByResource = new Map();
for (const page of pages) {
  for (const resource of page.resources) {
    const current = pagesByResource.get(resource) ?? [];
    current.push(page);
    pagesByResource.set(resource, current);
  }
}

const allVaultMarkdown = walkMarkdown(runRoot).filter((filePath) => {
  const relative = path.relative(runRoot, filePath).split(path.sep);
  return relative.every((segment) => !segment.startsWith("."));
});
const vaultLinkIdentities = new Set();
const vaultPaths = new Set();
for (const filePath of allVaultMarkdown) {
  const relative = path.relative(runRoot, filePath).split(path.sep).join("/");
  vaultPaths.add(relative.toLowerCase());
  vaultPaths.add(relative.replace(/\.md$/i, "").toLowerCase());
  vaultLinkIdentities.add(normalizeIdentity(path.basename(filePath, ".md")));
}
for (const identity of pageIdentities) vaultLinkIdentities.add(identity);

const unresolvedLinks = [];
const selfLinks = [];
for (const page of pages) {
  for (const match of page.body.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    const rawTarget = match[1].split("|")[0].split("#")[0].trim();
    if (!rawTarget) continue;
    const pathTarget = rawTarget.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    const section = h2At(page.body, match.index ?? 0);
    const resolved = vaultPaths.has(pathTarget)
      || vaultPaths.has(`${pathTarget}.md`)
      || vaultLinkIdentities.has(normalizeIdentity(rawTarget));
    if (!resolved) unresolvedLinks.push({ page: page.relativePath, target: rawTarget, section });
    if (page.identities.includes(normalizeIdentity(rawTarget))) {
      selfLinks.push({ page: page.relativePath, target: rawTarget, section });
    }
  }
}

const unsupportedPageUrls = [];
for (const page of pages) {
  const resourceCorpus = page.resources.map((resource) => {
    const filePath = path.resolve(beforeRoot, resource);
    const relative = path.relative(beforeRoot, filePath);
    return !relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8")
      : "";
  }).join("\n");
  const sourceUrls = new Set(extractUrls(resourceCorpus));
  for (const url of page.urls) {
    if (!sourceUrls.has(url)) unsupportedPageUrls.push({ page: page.relativePath, url });
  }
}

const sourceResults = sourceFiles.map((filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseMarkdown(content, filePath);
  const sourceRelative = path.relative(beforeRoot, filePath).split(path.sep).join("/");
  const runResource = sourceRelative;
  const attributedPages = pagesByResource.get(runResource) ?? [];
  const corpus = normalizedText(attributedPages.map((page) => page.body).join("\n"));
  const declared = unique(asStrings(parsed.frontmatter.wiki_articles).map(wikilinkTarget));
  const resolvedDeclared = declared.filter((target) => pageIdentities.has(normalizeIdentity(target)));
  const technicalSnippets = extractTechnicalSnippets(parsed.body);
  const preservedTechnicalSnippets = technicalSnippets.filter((snippet) => corpus.includes(snippet));
  const urls = extractUrls(parsed.body);
  const preservedUrls = urls.filter((url) => corpus.includes(normalizedText(url)));
  const technicalValues = extractTechnicalValues(parsed.body);
  const preservedTechnicalValues = technicalValues.filter((value) => corpus.includes(normalizedText(value)));
  return {
    source: sourceRelative,
    pages: attributedPages.map((page) => page.relativePath),
    sourceStem: path.basename(filePath, ".md"),
    sourceStemResolved: pageIdentities.has(normalizeIdentity(path.basename(filePath, ".md"))),
    declaredEntities: declared,
    resolvedDeclaredEntities: resolvedDeclared,
    missingDeclaredEntities: declared.filter((target) => !resolvedDeclared.includes(target)),
    technicalSnippets,
    preservedTechnicalSnippets,
    missingTechnicalSnippets: technicalSnippets.filter((snippet) => !preservedTechnicalSnippets.includes(snippet)),
    urls,
    preservedUrls,
    missingUrls: urls.filter((url) => !preservedUrls.includes(url)),
    technicalValues,
    preservedTechnicalValues,
    missingTechnicalValues: technicalValues.filter((value) => !preservedTechnicalValues.includes(value)),
  };
});

const totals = sourceResults.reduce((acc, source) => {
  acc.declared += source.declaredEntities.length;
  acc.declaredResolved += source.resolvedDeclaredEntities.length;
  acc.technical += source.technicalSnippets.length;
  acc.technicalPreserved += source.preservedTechnicalSnippets.length;
  acc.urls += source.urls.length;
  acc.urlsPreserved += source.preservedUrls.length;
  acc.values += source.technicalValues.length;
  acc.valuesPreserved += source.preservedTechnicalValues.length;
  return acc;
}, {
  declared: 0,
  declaredResolved: 0,
  technical: 0,
  technicalPreserved: 0,
  urls: 0,
  urlsPreserved: 0,
  values: 0,
  valuesPreserved: 0,
});

const duplicateUnresolved = new Map();
for (const item of unresolvedLinks) duplicateUnresolved.set(`${item.page}\0${item.target}`, item);
const counts = (values) => Object.fromEntries([...new Set(values)].sort()
  .map((value) => [value, values.filter((candidate) => candidate === value).length]));
const output = {
  domainId,
  runRoot,
  beforeRoot,
  summary: {
    sources: sourceResults.length,
    pages: pages.length,
    sourcesWithPages: sourceResults.filter((source) => source.pages.length > 0).length,
    sourcePageCoverage: ratio(sourceResults.filter((source) => source.pages.length > 0).length, sourceResults.length),
    sourceStemsResolved: sourceResults.filter((source) => source.sourceStemResolved).length,
    declaredEntities: totals.declared,
    declaredEntitiesResolved: totals.declaredResolved,
    declaredEntityCoverage: ratio(totals.declaredResolved, totals.declared),
    technicalSnippets: totals.technical,
    technicalSnippetsPreserved: totals.technicalPreserved,
    technicalSnippetPreservation: ratio(totals.technicalPreserved, totals.technical),
    urls: totals.urls,
    urlsPreserved: totals.urlsPreserved,
    urlPreservation: ratio(totals.urlsPreserved, totals.urls),
    technicalValues: totals.values,
    technicalValuesPreserved: totals.valuesPreserved,
    technicalValuePreservation: ratio(totals.valuesPreserved, totals.values),
    pagesWithInvalidH1Count: pages.filter((page) => page.h1Count !== 1).length,
    unresolvedLinks: duplicateUnresolved.size,
    selfLinks: selfLinks.length,
    nonSourceSelfLinks: selfLinks.filter((link) => link.section !== "Sources").length,
    unsupportedPageUrls: unsupportedPageUrls.length,
    ...(expectedTimestamp ? {
      expectedTimestamp,
      pagesWithExpectedTimestamp: pages.filter((page) => page.frontmatter.timestamp === expectedTimestamp).length,
      pagesWithOtherTimestamp: pages.filter((page) => page.frontmatter.timestamp !== expectedTimestamp).length,
    } : {}),
  },
  typeCounts: counts(pages.map((page) => String(page.frontmatter.type ?? "<missing>"))),
  statusCounts: counts(pages.map((page) => String(page.frontmatter.status ?? "<missing>"))),
  timestampCounts: counts(pages.map((page) => String(page.frontmatter.timestamp ?? "<missing>"))),
  zeroEffectSources: sourceResults.filter((source) => source.pages.length === 0).map((source) => source.source),
  invalidH1Pages: pages.filter((page) => page.h1Count !== 1)
    .map((page) => ({ page: page.relativePath, h1Count: page.h1Count })),
  unresolvedLinks: [...duplicateUnresolved.values()],
  selfLinks,
  unsupportedPageUrls,
  sources: sourceResults,
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
console.log(serialized);
