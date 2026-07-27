#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parse as yamlParse } from "yaml";

const domainId = process.argv[2] ?? "os-unix";
const vaultRoot = process.argv[3]
  ?? process.env.AIWIKI_TEST_VAULT
  ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run";
const domainRoot = path.join(vaultRoot, "!Wiki", domainId);

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function normalizeIdentity(value) {
  const stripped = value.normalize("NFD").replace(/\p{M}+/gu, "");
  const split = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  return split.replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || undefined;
}

function canonicalIdentity(raw) {
  let value = String(raw).normalize("NFC").trim();
  const wikilink = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(value);
  if (wikilink) value = wikilink[1];
  value = value.split("/").at(-1)?.replace(/\.md$/i, "") ?? value;
  const prefix = `wiki_${domainId}_`;
  if (value.toLowerCase().startsWith(prefix)) value = value.slice(prefix.length);
  return normalizeIdentity(value);
}

function addOwner(registry, identity, owner) {
  if (!identity) return;
  const owners = registry.get(identity) ?? new Set();
  owners.add(owner);
  registry.set(identity, owners);
}

const metadata = readJsonl(path.join(domainRoot, "metadata.jsonl"));
const typeByFolder = new Map(metadata
  .filter((row) => row.kind === "entity_type")
  .map((row) => [row.wiki_subfolder || row.type, row.type]));
const indexRows = readJsonl(path.join(domainRoot, "index.jsonl"));
const indexByPath = new Map(indexRows
  .filter((row) => row.kind === "page")
  .map((row) => [row.path, row]));
const files = fs.readdirSync(domainRoot, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory()
    ? fs.readdirSync(path.join(domainRoot, entry.name))
      .filter((name) => name.endsWith(".md"))
      .map((name) => path.join(domainRoot, entry.name, name))
    : [])
  .sort();

const failures = [];
const primaryOwners = new Map();
const aliasOwners = new Map();
for (const filePath of files) {
  const relativePath = path.relative(domainRoot, filePath);
  const wikiPath = `!Wiki/${domainId}/${relativePath}`;
  const content = fs.readFileSync(filePath, "utf8");
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!frontmatterMatch) {
    failures.push(`${relativePath}: missing frontmatter`);
    continue;
  }

  let frontmatter;
  try {
    frontmatter = yamlParse(frontmatterMatch[1]);
  } catch (error) {
    failures.push(`${relativePath}: YAML ${error.message}`);
    continue;
  }

  const folder = relativePath.split(path.sep)[0];
  const expectedType = typeByFolder.get(folder);
  if (!expectedType) failures.push(`${relativePath}: unconfigured folder ${folder}`);
  if (frontmatter?.type !== expectedType) {
    failures.push(`${relativePath}: type ${JSON.stringify(frontmatter?.type)} != ${JSON.stringify(expectedType)}`);
  }
  if (typeof frontmatter?.description !== "string" || !frontmatter.description.trim()) {
    failures.push(`${relativePath}: missing description`);
  }

  const resources = Array.isArray(frontmatter?.resource) ? frontmatter.resource : [];
  if (resources.length === 0) failures.push(`${relativePath}: missing resource`);
  for (const resource of resources) {
    if (typeof resource !== "string" || !fs.existsSync(path.join(vaultRoot, resource))) {
      failures.push(`${relativePath}: missing source ${JSON.stringify(resource)}`);
    }
  }

  const tags = Array.isArray(frontmatter?.tags) ? frontmatter.tags : [];
  if (!tags.some((tag) => tag === expectedType || tag.startsWith(`${expectedType}/`))) {
    failures.push(`${relativePath}: missing type tag ${JSON.stringify(expectedType)}`);
  }
  if (!/^#\s+\S/m.test(content)) failures.push(`${relativePath}: missing H1`);
  if (!/^## Sources$/m.test(content)) failures.push(`${relativePath}: missing Sources section`);
  if (/^<<<[A-Z][A-Z0-9_]*>>>$/m.test(content)) failures.push(`${relativePath}: reserved marker persisted`);

  const indexRecord = indexByPath.get(wikiPath);
  if (!indexRecord) {
    failures.push(`${relativePath}: missing page index record`);
  } else {
    if (indexRecord.type !== expectedType) {
      failures.push(`${relativePath}: index type ${JSON.stringify(indexRecord.type)} != ${JSON.stringify(expectedType)}`);
    }
    if (JSON.stringify(indexRecord.resource) !== JSON.stringify(resources)) {
      failures.push(`${relativePath}: index resource differs`);
    }
  }

  addOwner(primaryOwners, canonicalIdentity(path.basename(filePath, ".md")), relativePath);
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (title) addOwner(primaryOwners, canonicalIdentity(title), relativePath);
  const aliases = typeof frontmatter?.aliases === "string"
    ? [frontmatter.aliases]
    : Array.isArray(frontmatter?.aliases) ? frontmatter.aliases : [];
  for (const alias of aliases) {
    if (typeof alias === "string") addOwner(aliasOwners, canonicalIdentity(alias), relativePath);
  }
}

const duplicateAliasOwners = [...aliasOwners]
  .filter(([, owners]) => owners.size > 1)
  .map(([identity, owners]) => ({ identity, owners: [...owners].sort() }));
const aliasPrimaryConflicts = [...aliasOwners].flatMap(([identity, owners]) => {
  const primaries = primaryOwners.get(identity) ?? new Set();
  const combined = new Set([...owners, ...primaries]);
  return combined.size > 1
    ? [{ identity, aliasOwners: [...owners].sort(), primaryOwners: [...primaries].sort() }]
    : [];
});
const output = {
  domainId,
  pages: files.length,
  typeByFolder: Object.fromEntries(typeByFolder),
  failures,
  duplicateAliasOwners,
  aliasPrimaryConflicts,
  ok: failures.length === 0
    && duplicateAliasOwners.length === 0
    && aliasPrimaryConflicts.length === 0,
};

console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
