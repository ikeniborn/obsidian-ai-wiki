import type { Vault } from "obsidian";
import { parse as yamlParse } from "yaml";
import type { DomainEntry } from "./domain";
import { domainEntryToMetadataRecords, stringifyDomainMetadata } from "./domain-metadata";
import { stringifyJsonl } from "./jsonl";
import { parseIndexAnnotations, parseDescriptionFromFm, deriveFallbackDescription } from "./wiki-index";
import { parseLegacyLogBlocks } from "./wiki-log";
import {
  LEGACY_GLOBAL_DOMAIN_PATH,
  WIKI_ROOT,
  domainIndexPath,
  domainLogPath,
  domainMetadataPath,
  domainWikiFolder,
  legacyDomainEmbeddingsPath,
  legacyDomainIndexPath,
  legacyDomainLogPath,
} from "./wiki-path";
import type { PageIndexRecord, WikiIndexRecord } from "./wiki-index-jsonl";

interface AdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface JsonlMigrationReport {
  ok: boolean;
  migrated: boolean;
  backupPath?: string;
  domains: string[];
  errors: string[];
}

export interface JsonlMigrationOptions {
  now?: string;
}

interface BackupEntry {
  source: string;
  backup: string;
  size: number;
  hash: string;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function hashString(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const partial = parts.slice(0, i).join("/");
    if (!partial) continue;
    if (!(await vault.adapter.exists(partial))) await vault.createFolder(partial).catch(() => {});
  }
}

async function readIfExists(adapter: AdapterLike, path: string): Promise<string | null> {
  return await adapter.exists(path) ? adapter.read(path) : null;
}

async function collectMarkdownPages(adapter: AdapterLike, root: string): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  async function walk(folder: string): Promise<void> {
    const listed = await adapter.list(folder);
    for (const file of listed.files) {
      if (file.endsWith(".md") && !file.includes("/_config/")) out.push({ path: file, content: await adapter.read(file) });
    }
    for (const child of listed.folders) {
      if (child.endsWith("/_config")) continue;
      await walk(child);
    }
  }
  if (await adapter.exists(root)) await walk(root);
  return out;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = FM_RE.exec(content);
  if (!match) return {};
  try {
    return (yamlParse(match[1]) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

function pageRecordFromPage(
  page: { path: string; content: string },
  descriptions: Map<string, string>,
): PageIndexRecord {
  const articleId = page.path.split("/").pop()!.replace(/\.md$/, "");
  const fm = parseFrontmatter(page.content);
  const description = parseDescriptionFromFm(page.content) || descriptions.get(articleId) || deriveFallbackDescription(page.content, String(fm.type ?? "concept"));
  return {
    kind: "page",
    schemaVersion: 1,
    articleId,
    path: page.path,
    type: typeof fm.type === "string" ? fm.type : "concept",
    description,
    resource: asStringArray(fm.resource),
    timestamp: typeof fm.timestamp === "string" ? fm.timestamp : undefined,
    tags: asStringArray(fm.tags),
    bodyHash: hashString(page.content),
    descriptionHash: hashString(description),
  };
}

async function copyBackup(
  vault: Vault,
  sourcePaths: string[],
  backupPath: string,
): Promise<BackupEntry[]> {
  const adapter = vault.adapter as unknown as AdapterLike;
  await ensureFolder(vault, backupPath);
  const entries: BackupEntry[] = [];
  for (const source of sourcePaths) {
    const content = await readIfExists(adapter, source);
    if (content === null) continue;
    const backup = `${backupPath}/${source.replace(/[/:]/g, "__")}`;
    await adapter.write(backup, content);
    entries.push({ source, backup, size: content.length, hash: hashString(content) });
  }
  await adapter.write(`${backupPath}/manifest.json`, JSON.stringify({ version: 1, entries }, null, 2));
  return entries;
}

export async function detectLegacyJsonlStorageState(vault: Vault): Promise<boolean> {
  const adapter = vault.adapter as unknown as AdapterLike;
  if (await adapter.exists(LEGACY_GLOBAL_DOMAIN_PATH)) return true;
  if (!(await adapter.exists(WIKI_ROOT))) return false;
  const listed = await adapter.list(WIKI_ROOT);
  for (const folder of listed.folders) {
    if (await adapter.exists(legacyDomainIndexPath(folder))) return true;
    if (await adapter.exists(legacyDomainLogPath(folder))) return true;
    if (await adapter.exists(legacyDomainEmbeddingsPath(folder))) return true;
  }
  return false;
}

export async function migrateJsonlDomainStorage(
  vault: Vault,
  opts: JsonlMigrationOptions = {},
): Promise<JsonlMigrationReport> {
  const adapter = vault.adapter as unknown as AdapterLike;
  if (!(await detectLegacyJsonlStorageState(vault))) {
    return { ok: true, migrated: false, domains: [], errors: [] };
  }
  const errors: string[] = [];
  const rawDomains = await readIfExists(adapter, LEGACY_GLOBAL_DOMAIN_PATH);
  if (rawDomains === null) {
    return { ok: false, migrated: false, domains: [], errors: [`Missing ${LEGACY_GLOBAL_DOMAIN_PATH}`] };
  }

  let domains: DomainEntry[];
  try {
    const parsed = JSON.parse(rawDomains) as unknown;
    if (!Array.isArray(parsed)) throw new Error("expected JSON array");
    domains = parsed as DomainEntry[];
  } catch (e) {
    return { ok: false, migrated: false, domains: [], errors: [`${LEGACY_GLOBAL_DOMAIN_PATH}: ${(e as Error).message}`] };
  }

  const backupPath = `${WIKI_ROOT}/.backup/jsonl-domain-storage-${opts.now ?? stamp()}`;
  const legacyPaths = [LEGACY_GLOBAL_DOMAIN_PATH];
  for (const domain of domains) {
    const folder = domainWikiFolder(domain.wiki_folder);
    legacyPaths.push(legacyDomainIndexPath(folder), legacyDomainLogPath(folder), legacyDomainEmbeddingsPath(folder));
  }
  const backupEntries = await copyBackup(vault, legacyPaths, backupPath);
  if (backupEntries.length === 0 || !(await adapter.exists(`${backupPath}/manifest.json`))) {
    return { ok: false, migrated: false, backupPath, domains: [], errors: ["Backup manifest was not written"] };
  }

  for (const domain of domains) {
    const folder = domainWikiFolder(domain.wiki_folder);
    await ensureFolder(vault, folder);
    await adapter.write(domainMetadataPath(folder), stringifyDomainMetadata(domainEntryToMetadataRecords(domain)));

    const indexMarkdown = await readIfExists(adapter, legacyDomainIndexPath(folder));
    const descriptions = indexMarkdown ? parseIndexAnnotations(indexMarkdown) : new Map<string, string>();
    const pages = await collectMarkdownPages(adapter, folder);
    const records: WikiIndexRecord[] = pages.map((page) => pageRecordFromPage(page, descriptions));
    await adapter.write(domainIndexPath(folder), stringifyJsonl(records));

    const legacyLog = await readIfExists(adapter, legacyDomainLogPath(folder));
    if (legacyLog !== null) {
      await adapter.write(domainLogPath(folder), stringifyJsonl(parseLegacyLogBlocks(legacyLog, domain.id)));
    } else {
      await adapter.write(domainLogPath(folder), "");
    }
  }

  for (const domain of domains) {
    const folder = domainWikiFolder(domain.wiki_folder);
    if (!(await adapter.exists(domainMetadataPath(folder)))) errors.push(`Missing ${domainMetadataPath(folder)}`);
    if (!(await adapter.exists(domainIndexPath(folder)))) errors.push(`Missing ${domainIndexPath(folder)}`);
    if (!(await adapter.exists(domainLogPath(folder)))) errors.push(`Missing ${domainLogPath(folder)}`);
  }
  if (errors.length > 0) return { ok: false, migrated: false, backupPath, domains: domains.map((d) => d.id), errors };

  for (const path of legacyPaths) {
    if (await adapter.exists(path)) await adapter.remove(path);
  }

  return { ok: true, migrated: true, backupPath, domains: domains.map((d) => d.id), errors: [] };
}
