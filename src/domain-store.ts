import type { Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { migrateDomainsV2, migrateDomainsV3 } from "./domain";
import {
  domainEntryToMetadataRecords,
  metadataRecordsToDomainEntry,
  parseDomainMetadata,
  stringifyDomainMetadata,
  type MetadataRecord,
} from "./domain-metadata";
import { parseJsonl } from "./jsonl";
import { WIKI_ROOT, LEGACY_GLOBAL_DOMAIN_PATH, domainMetadataPath, domainWikiFolder } from "./wiki-path";

const WIKI_DIR = WIKI_ROOT;

export interface ExactDomainMetadataSnapshot {
  path: string;
  raw: string;
  entry: DomainEntry;
  records: MetadataRecord[];
  /** Exact non-blank source lines, index-aligned with records. Blank lines normalize on update. */
  rawRecordLines: string[];
}

const governedMetadataKinds = new Set(["domain", "entity_type", "source_state"]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metadataError(
  path: string,
  kind: string,
  line: number,
  detail: string,
): Error {
  return new Error(`${path}: malformed ${kind} record at line ${line}: ${detail}`);
}

function assertSafeKnownNumbers(
  value: unknown,
  path: string,
  kind: string,
  line: number,
  fieldPath = "",
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)
      || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error(
        `${path}: ${kind} record at line ${line} contains unsafe integer at ${fieldPath || "<root>"}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeKnownNumbers(item, path, kind, line, `${fieldPath}[${index}]`);
    });
    return;
  }
  if (!isObjectRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    assertSafeKnownNumbers(
      item,
      path,
      kind,
      line,
      fieldPath ? `${fieldPath}.${key}` : key,
    );
  }
}

function assertStringField(
  record: Record<string, unknown>,
  field: string,
  path: string,
  kind: string,
  line: number,
  allowEmpty = true,
): void {
  if (typeof record[field] !== "string"
    || (!allowEmpty && record[field].length === 0)) {
    throw metadataError(path, kind, line, `${field} must be a${allowEmpty ? "" : " non-empty"} string`);
  }
}

function assertOptionalNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
  kind: string,
  line: number,
): void {
  if (record[field] !== undefined && typeof record[field] !== "number") {
    throw metadataError(path, kind, line, `${field} must be a number`);
  }
}

function validateExactMetadataRecords(
  values: unknown[],
  path: string,
  allowOpaque = true,
): asserts values is MetadataRecord[] {
  let domainCount = 0;
  const entityTypes = new Set<string>();
  const sourcePaths = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const line = index + 1;
    if (!isObjectRecord(value)) {
      throw new Error(`${path}: metadata record at line ${line} must be an object`);
    }
    if (typeof value.kind !== "string" || value.kind.length === 0) {
      throw new Error(`${path}: metadata record kind at line ${line} must be a non-empty string`);
    }
    const kind = value.kind;
    if (!governedMetadataKinds.has(kind)) {
      if (!allowOpaque) {
        throw new Error(`${path}: generated metadata record kind ${kind} is not governed`);
      }
      continue;
    }
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
      throw new Error(`${path}: unsupported schema version for ${kind} record at line ${line}`);
    }
    assertSafeKnownNumbers(value, path, kind, line);
    if (kind === "domain") {
      domainCount++;
      if (domainCount > 1) {
        throw new Error(`${path}: duplicate domain record at line ${line}`);
      }
      if (value.schemaVersion !== 1) {
        throw metadataError(path, kind, line, "schemaVersion must be 1");
      }
      assertStringField(value, "id", path, kind, line, false);
      assertStringField(value, "name", path, kind, line);
      assertStringField(value, "wiki_folder", path, kind, line);
      if (!Array.isArray(value.source_paths)
        || !value.source_paths.every((sourcePath) => typeof sourcePath === "string")) {
        throw metadataError(path, kind, line, "source_paths must be an array of strings");
      }
      if (value.language_notes !== undefined && typeof value.language_notes !== "string") {
        throw metadataError(path, kind, line, "language_notes must be a string");
      }
      assertOptionalNumber(value, "max_tag_categories", path, kind, line);
      assertOptionalNumber(value, "pageNameVersion", path, kind, line);
      continue;
    }
    if (kind === "entity_type") {
      assertStringField(value, "type", path, kind, line, false);
      const type = value.type as string;
      if (entityTypes.has(type)) {
        throw new Error(`${path}: duplicate entity_type type ${type} at line ${line}`);
      }
      entityTypes.add(type);
      assertStringField(value, "description", path, kind, line);
      if (!Array.isArray(value.extraction_cues)
        || !value.extraction_cues.every((cue) => typeof cue === "string")) {
        throw metadataError(path, kind, line, "extraction_cues must be an array of strings");
      }
      assertOptionalNumber(value, "min_mentions_for_page", path, kind, line);
      if (value.wiki_subfolder !== undefined && typeof value.wiki_subfolder !== "string") {
        throw metadataError(path, kind, line, "wiki_subfolder must be a string");
      }
      continue;
    }
    assertStringField(value, "path", path, kind, line, false);
    const sourcePath = value.path as string;
    if (sourcePaths.has(sourcePath)) {
      throw new Error(`${path}: duplicate source_state path ${sourcePath} at line ${line}`);
    }
    sourcePaths.add(sourcePath);
    assertStringField(value, "hash", path, kind, line);
  }
  if (domainCount !== 1) {
    throw new Error(`${path}: expected exactly one current domain record`);
  }
}

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
    let healed = false;
    if (await adapter.exists(WIKI_DIR)) {
      const listed = await adapter.list(WIKI_DIR);
      for (const folder of [...listed.folders].sort()) {
        const name = folder.split("/").pop() ?? folder;
        if (name.startsWith(".") || name.startsWith("_")) continue;
        const path = domainMetadataPath(folder);
        if (!(await adapter.exists(path))) {
          const recovered = await this.promoteTmpMetadata(adapter, folder, name);
          if (!recovered) continue;
          domains.push(recovered);
          healed = true;
          continue;
        }
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
    if (m2 || m3 || healed) await this.save(domains);
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

  async readExactMetadata(path: string, expectedDomainId: string): Promise<ExactDomainMetadataSnapshot> {
    const raw = await this.vault.adapter.read(path);
    const folder = path.slice(0, path.lastIndexOf("/"));
    const fallback = folder.split("/").pop() ?? folder;
    let entry: DomainEntry;
    let records: MetadataRecord[];
    const rawRecordLines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    try {
      const parsed = parseJsonl<unknown>(raw, path);
      validateExactMetadataRecords(parsed, path);
      records = parsed;
      entry = metadataRecordsToDomainEntry(records, fallback);
    } catch (error) {
      throw new DomainCorruptError(`${path}: ${(error as Error).message}`);
    }
    if (entry.id !== expectedDomainId
      || domainMetadataPath(domainWikiFolder(entry.wiki_folder)) !== path) {
      throw new Error(`domain metadata identity mismatch: ${path}`);
    }
    return { path, raw, entry, records, rawRecordLines };
  }

  async writeExactMetadata(
    snapshot: ExactDomainMetadataSnapshot,
    entry: DomainEntry,
  ): Promise<string> {
    const generated = domainEntryToMetadataRecords(entry);
    validateExactMetadataRecords(generated, snapshot.path, false);
    const desiredDomain = generated.find((record) => record.kind === "domain");
    if (desiredDomain === undefined) {
      throw new Error(`domain metadata missing desired domain record: ${snapshot.path}`);
    }
    const desiredTypes = new Map(
      generated
        .filter((record) => record.kind === "entity_type")
        .map((record) => [String((record as Record<string, unknown>).type), record]),
    );
    const desiredSources = new Map(
      generated
        .filter((record) => record.kind === "source_state")
        .map((record) => [String((record as Record<string, unknown>).path), record]),
    );
    const seenTypes = new Set<string>();
    const seenSources = new Set<string>();
    const patchGoverned = (
      current: MetadataRecord,
      next: MetadataRecord,
      keys: string[],
    ): MetadataRecord => {
      const patched: Record<string, unknown> = { ...current };
      const desiredRecord = next as Record<string, unknown>;
      for (const key of keys) {
        if (desiredRecord[key] === undefined) delete patched[key];
        else patched[key] = desiredRecord[key];
      }
      return patched;
    };
    if (snapshot.records.length !== snapshot.rawRecordLines.length) {
      throw new Error(`domain metadata snapshot line alignment mismatch: ${snapshot.path}`);
    }
    const output: Array<{ record: MetadataRecord; raw?: string }> = [];
    for (let index = 0; index < snapshot.records.length; index++) {
      const record = snapshot.records[index];
      if (record.kind === "domain") {
        output.push({ record: patchGoverned(record, desiredDomain, [
          "schemaVersion",
          "id",
          "name",
          "wiki_folder",
          "source_paths",
          "language_notes",
          "max_tag_categories",
          "pageNameVersion",
        ]) });
        continue;
      }
      if (record.kind === "entity_type" && typeof record.type === "string") {
        const next = desiredTypes.get(record.type);
        if (next !== undefined) {
          output.push({ record: patchGoverned(record, next, [
            "type",
            "description",
            "extraction_cues",
            "min_mentions_for_page",
            "wiki_subfolder",
          ]) });
          seenTypes.add(record.type);
        }
        continue;
      }
      if (record.kind === "source_state" && typeof record.path === "string") {
        const next = desiredSources.get(record.path);
        if (next !== undefined) {
          output.push({ record: patchGoverned(record, next, ["path", "hash"]) });
          seenSources.add(record.path);
        }
        continue;
      }
      output.push({ record, raw: snapshot.rawRecordLines[index] });
    }
    for (const [type, record] of desiredTypes) {
      if (!seenTypes.has(type)) output.push({ record });
    }
    for (const [path, record] of desiredSources) {
      if (!seenSources.has(path)) output.push({ record });
    }
    const lineEnding = snapshot.raw.includes("\r\n") ? "\r\n" : "\n";
    const trailingLineEnding = snapshot.raw.endsWith("\n") ? lineEnding : "";
    const desired = output
      .map(({ record, raw: exactRaw }) => exactRaw ?? JSON.stringify(record))
      .join(lineEnding) + trailingLineEnding;
    const current = await this.vault.adapter.read(snapshot.path);
    if (current !== snapshot.raw) {
      throw new Error(`domain metadata expected-before conflict: ${snapshot.path}`);
    }
    if (desired === snapshot.raw) return desired;
    await this.vault.adapter.write(snapshot.path, desired);
    const actual = await this.vault.adapter.read(snapshot.path);
    if (actual !== desired) {
      throw new Error(`domain metadata write verification failed: ${snapshot.path}`);
    }
    return desired;
  }

  /**
   * Recover a domain whose metadata write was interrupted: the old tmp+rename
   * save left a `metadata.jsonl.tmp` with no `metadata.jsonl`. Promote the tmp
   * to the final path so the domain is selectable again. Returns null when
   * there is no tmp — a folder with content but no tmp is left alone, because
   * that is indistinguishable from an intentionally deleted domain (Delete
   * removes metadata.jsonl but leaves the folder; it never leaves a tmp).
   *
   * Parse BEFORE mutating: a corrupt tmp must be left intact (never written to
   * the final path, never deleted), so it can be inspected manually instead of
   * becoming a corrupt metadata.jsonl that throws DomainCorruptError on every
   * future load.
   */
  private async promoteTmpMetadata(
    adapter: Vault["adapter"],
    folder: string,
    name: string,
  ): Promise<DomainEntry | null> {
    const path = domainMetadataPath(folder);
    const tmpPath = `${path}.tmp`;
    if (!(await adapter.exists(tmpPath))) return null;
    let entry: DomainEntry;
    try {
      const raw = await adapter.read(tmpPath);
      entry = parseDomainMetadata(raw, path, name); // throws first — nothing mutated yet
      await adapter.write(path, raw);
    } catch {
      // Corrupt/unreadable tmp — leave it (and any partial state) for manual inspection.
      return null;
    }
    await adapter.remove(tmpPath).catch(() => {});
    return entry;
  }
}

/**
 * Completely remove a domain's wiki folder — every page, sidecar
 * (metadata/index/log), nested subfolder, and the `!Wiki/<domain>` folder
 * itself. Used when a domain is deleted from settings so no empty folder is
 * left behind. Files are removed bottom-up before each folder is rmdir'd, and
 * the whole thing is best-effort (a locked file or adapter error never throws).
 */
export async function removeDomainFolder(adapter: Vault["adapter"], wikiFolder: string): Promise<void> {
  const folder = domainWikiFolder(wikiFolder);
  if (!(await adapter.exists(folder))) return;
  const removeRec = async (dir: string): Promise<void> => {
    const { files, folders } = await adapter.list(dir);
    for (const f of files) await adapter.remove(f).catch(() => {});
    for (const sub of folders) await removeRec(sub);
    await adapter.rmdir(dir, true).catch(() => {});
  };
  await removeRec(folder);
}
