import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { migrateDomainsV2, migrateDomainsV3 } from "./domain";
import { domainEntryToMetadataRecords, parseDomainMetadata, stringifyDomainMetadata } from "./domain-metadata";
import { WIKI_ROOT, LEGACY_GLOBAL_DOMAIN_PATH, domainMetadataPath, domainWikiFolder } from "./wiki-path";

const WIKI_DIR = WIKI_ROOT;

export class DomainCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainCorruptError";
  }
}

export class DomainStore {
  constructor(private vault: Vault) {}

  async load(): Promise<DomainEntry[]> {
    const adapter = this.vault.adapter;
    const domains: DomainEntry[] = [];
    if (await adapter.exists(WIKI_DIR)) {
      const listed = await adapter.list(WIKI_DIR);
      for (const folder of [...listed.folders].sort()) {
        const name = folder.split("/").pop() ?? folder;
        if (name.startsWith(".") || name.startsWith("_")) continue;
        const path = domainMetadataPath(folder);
        if (!(await adapter.exists(path))) continue;
        try {
          domains.push(parseDomainMetadata(await adapter.read(path), path, name));
        } catch (e) {
          throw new DomainCorruptError(`${path}: ${(e as Error).message}`);
        }
      }
    }
    if (domains.length === 0 && await adapter.exists(LEGACY_GLOBAL_DOMAIN_PATH)) {
      const raw = await adapter.read(LEGACY_GLOBAL_DOMAIN_PATH);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch (e) {
        throw new DomainCorruptError(`${LEGACY_GLOBAL_DOMAIN_PATH}: ${(e as Error).message}`);
      }
      if (!Array.isArray(parsed)) throw new DomainCorruptError(`${LEGACY_GLOBAL_DOMAIN_PATH}: expected JSON array`);
      domains.push(...parsed as DomainEntry[]);
    }
    for (const d of domains) {
      if (d.wiki_folder?.startsWith("!Wiki/")) {
        d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      }
    }
    const { migrated: m2 } = migrateDomainsV2(domains);
    const { migrated: m3 } = migrateDomainsV3(domains);
    if (m2 || m3) await this.save(domains);
    return domains;
  }

  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_DIR))) await this.vault.createFolder(WIKI_DIR).catch(() => {});
    if (await adapter.exists(LEGACY_GLOBAL_DOMAIN_PATH)) await adapter.remove(LEGACY_GLOBAL_DOMAIN_PATH);
    const desiredPathsById = new Map(domains.map((domain) => [domain.id, domainMetadataPath(domainWikiFolder(domain.wiki_folder))]));
    const desiredPaths = new Set(desiredPathsById.values());
    const listed = await adapter.list(WIKI_DIR);
    for (const folder of [...listed.folders].sort()) {
      const name = folder.split("/").pop() ?? folder;
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const path = domainMetadataPath(folder);
      if (!(await adapter.exists(path)) || desiredPaths.has(path)) continue;
      try {
        const existing = parseDomainMetadata(await adapter.read(path), path, name);
        if (!desiredPathsById.has(existing.id) || desiredPathsById.get(existing.id) !== path) {
          await adapter.remove(path);
        }
      } catch {
        // Preserve unknown/corrupt metadata; load() remains responsible for reporting it.
      }
    }
    for (const domain of domains) {
      const folder = domainWikiFolder(domain.wiki_folder);
      if (!(await adapter.exists(folder))) await this.vault.createFolder(folder).catch(() => {});
      const path = domainMetadataPath(folder);
      const tmpPath = `${path}.tmp`;
      // Clean up a leftover tmp from a previously-interrupted write.
      if (await adapter.exists(tmpPath)) await adapter.remove(tmpPath).catch(() => {});
      // Direct in-place write. Obsidian's adapter.rename is the flaky step that
      // left domain folders with content but no metadata.jsonl; a small local
      // file does not need the tmp+rename dance. Verify the file landed.
      await adapter.write(path, stringifyDomainMetadata(domainEntryToMetadataRecords(domain)));
      if (!(await adapter.exists(path))) {
        throw new Error(`domain metadata write failed: ${path}`);
      }
    }
  }
}
