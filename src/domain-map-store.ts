import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain-map";

const FILE_PATH = "!Wiki/_domain-map.json";
const TMP_PATH = `${FILE_PATH}.tmp`;
const WIKI_DIR = "!Wiki";

export class DomainMapCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainMapCorruptError";
  }
}

export class DomainMapStore {
  constructor(private vault: Vault) {}

  async load(): Promise<DomainEntry[]> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(FILE_PATH))) return [];
    const raw = await adapter.read(FILE_PATH);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new DomainMapCorruptError(`${FILE_PATH}: ${(e as Error).message}`); }
    if (!Array.isArray(parsed)) throw new DomainMapCorruptError(`${FILE_PATH}: expected JSON array`);
    return parsed as DomainEntry[];
  }

  async save(domains: DomainEntry[]): Promise<void> {
    const adapter = this.vault.adapter;
    if (!(await adapter.exists(WIKI_DIR))) await adapter.mkdir(WIKI_DIR);
    const body = JSON.stringify(domains, null, 2);
    await adapter.write(TMP_PATH, body);
    if (await adapter.exists(FILE_PATH)) await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
}
