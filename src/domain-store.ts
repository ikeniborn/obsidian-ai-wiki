import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { migrateDomainsV2 } from "./domain";

const FILE_PATH = "!Wiki/.config/_domain.json";
const TMP_PATH = `${FILE_PATH}.tmp`;
const WIKI_DIR = "!Wiki";
const CONFIG_DIR = "!Wiki/.config";

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
    if (!(await adapter.exists(FILE_PATH))) return [];
    const raw = await adapter.read(FILE_PATH);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new DomainCorruptError(`${FILE_PATH}: ${(e as Error).message}`); }
    if (!Array.isArray(parsed)) throw new DomainCorruptError(`${FILE_PATH}: expected JSON array`);
    const domains = parsed as DomainEntry[];
    for (const d of domains) {
      if (d.wiki_folder?.startsWith("!Wiki/")) {
        d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      }
    }
    const { migrated } = migrateDomainsV2(domains);
    if (migrated) await this.save(domains);
    return domains;
  }

  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_DIR))) await this.vault.createFolder(WIKI_DIR).catch(() => {});
    if (!(await adapter.exists(CONFIG_DIR))) await this.vault.createFolder(CONFIG_DIR).catch(() => {});
    const body = JSON.stringify(domains, null, 2);
    await adapter.write(TMP_PATH, body);
    if (await adapter.exists(FILE_PATH)) await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
}
