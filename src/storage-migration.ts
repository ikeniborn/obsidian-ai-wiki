import type { Vault } from "obsidian";
import {
  WIKI_ROOT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOMAIN_PATH,
  GLOBAL_AGENT_LOG_PATH,
  GLOBAL_DEV_LOG_PATH,
} from "./wiki-path";

const OLD_GLOBAL_CONFIG = `${WIKI_ROOT}/.config`;
const OLD_DOMAIN_PATH = `${OLD_GLOBAL_CONFIG}/_domain.json`;

export class StorageMigrationConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "StorageMigrationConflictError";
  }
}

export async function runStorageMigration(vault: Vault): Promise<void> {
  const adapter = vault.adapter;

  if (!(await adapter.exists(OLD_DOMAIN_PATH))) return;

  if (await adapter.exists(GLOBAL_DOMAIN_PATH)) {
    throw new StorageMigrationConflictError(
      `Both ${OLD_GLOBAL_CONFIG} and ${GLOBAL_CONFIG_DIR} exist — interrupted migration. Remove one manually.`
    );
  }

  await vault.createFolder(GLOBAL_CONFIG_DIR).catch(() => {});

  // Move domain registry
  if (await adapter.exists(OLD_DOMAIN_PATH)) {
    const content = await adapter.read(OLD_DOMAIN_PATH);
    await adapter.write(GLOBAL_DOMAIN_PATH, content);
  }

  // Load domain list
  let domains: Array<{ wiki_folder: string }> = [];
  if (await adapter.exists(GLOBAL_DOMAIN_PATH)) {
    try { domains = JSON.parse(await adapter.read(GLOBAL_DOMAIN_PATH)) as Array<{ wiki_folder: string }>; } catch { /* ignore */ }
  }

  // Schemas are no longer migrated — they live bundled in the plugin and are
  // delivered via release. Any old `.config` schema copies are dropped by the
  // cleanDir calls below; the global `_config` copies by cleanupBundledSchemaCopies.

  // Migrate per-domain files
  for (const domain of domains) {
    const oldConfig = `${WIKI_ROOT}/${domain.wiki_folder}/.config`;
    const newConfig = `${WIKI_ROOT}/${domain.wiki_folder}/_config`;
    const domainHasOldConfig = (await adapter.list(oldConfig)).files.length > 0;
    if (!domainHasOldConfig) continue;

    await vault.createFolder(newConfig).catch(() => {});

    for (const file of ["_index.md", "_log.md"]) {
      const src = `${oldConfig}/${file}`;
      if (await adapter.exists(src)) {
        await adapter.write(`${newConfig}/${file}`, await adapter.read(src));
      }
    }

    for (const [file, globalPath] of [
      ["_agent.jsonl", GLOBAL_AGENT_LOG_PATH],
      ["_dev.jsonl", GLOBAL_DEV_LOG_PATH],
    ] as const) {
      const src = `${oldConfig}/${file}`;
      if (await adapter.exists(src)) {
        await adapter.append(globalPath, await adapter.read(src));
      }
    }

    await cleanDir(adapter, oldConfig, ["_index.md", "_log.md", "_agent.jsonl", "_dev.jsonl",
      "_wiki_schema.md", "_format_schema.md"]);
  }

  // Clean global old config
  await cleanDir(adapter, OLD_GLOBAL_CONFIG, ["_domain.json", "_wiki_schema.md",
    "_format_schema.md", "_agent.jsonl", "_dev.jsonl"]);
}

const GLOBAL_SCHEMA_COPIES = [
  `${GLOBAL_CONFIG_DIR}/_wiki_schema.md`,
  `${GLOBAL_CONFIG_DIR}/_format_schema.md`,
];

/**
 * Remove stale vault copies of the bundled schemas. Schemas are now compiled
 * into the plugin and delivered via release; any `_config` copy is ignored at
 * runtime, so delete it best-effort. Runs unconditionally on plugin load,
 * independent of the `.config` → `_config` migration.
 */
export async function cleanupBundledSchemaCopies(vault: Vault): Promise<void> {
  const adapter = vault.adapter;
  for (const p of GLOBAL_SCHEMA_COPIES) {
    try {
      if (await adapter.exists(p)) await adapter.remove(p);
    } catch { /* best-effort */ }
  }
}

/**
 * Relocate the dev-mode logs out of the synced vault into the plugin dir.
 * `_dev.jsonl` → `<pluginDir>/eval.jsonl`, `_agent.jsonl` → `<pluginDir>/agent.jsonl`.
 * Appends vault content to the plugin-dir file, then removes the vault copy.
 * Idempotent — a no-op when no vault copies exist. Best-effort; never throws.
 */
export async function migrateLogsToPluginDir(vault: Vault, pluginDir: string): Promise<void> {
  const adapter = vault.adapter;
  const moves: Array<[string, string]> = [
    [GLOBAL_DEV_LOG_PATH, `${pluginDir}/eval.jsonl`],
    [GLOBAL_AGENT_LOG_PATH, `${pluginDir}/agent.jsonl`],
  ];
  for (const [src, dst] of moves) {
    try {
      if (!(await adapter.exists(src))) continue;
      const content = await adapter.read(src);
      if (content) {
        if (await adapter.exists(dst)) await adapter.append(dst, content);
        else await adapter.write(dst, content);
      }
      await adapter.remove(src);
    } catch { /* best-effort */ }
  }
}

async function cleanDir(
  adapter: Vault["adapter"],
  dir: string,
  knownFiles: string[],
): Promise<void> {
  for (const f of knownFiles) {
    const p = `${dir}/${f}`;
    if (await adapter.exists(p)) await adapter.remove(p);
  }
  try {
    const listing = await adapter.list(dir);
    if (listing.files.length === 0 && listing.folders.length === 0) {
      await adapter.rmdir(dir, false).catch(() => { /* ignore rmdir failure */ });
    }
  } catch { /* ignore */ }
}

/**
 * Remove empty `_config` folders left behind by the storage migrations: the
 * global `!Wiki/_config` and each per-domain `!Wiki/<domain>/_config`. Runs
 * unconditionally on load; a no-op when the folders are absent or non-empty.
 * Best-effort — never throws.
 */
export async function removeEmptyConfigDirs(vault: Vault): Promise<void> {
  const adapter = vault.adapter;
  await rmdirIfEmpty(adapter, GLOBAL_CONFIG_DIR);
  try {
    const wiki = await adapter.list(WIKI_ROOT);
    for (const folder of wiki.folders) {
      await rmdirIfEmpty(adapter, `${folder}/_config`);
    }
  } catch { /* !Wiki absent — nothing to clean */ }
}

async function rmdirIfEmpty(adapter: Vault["adapter"], dir: string): Promise<void> {
  try {
    if (!(await adapter.exists(dir))) return;
    const listing = await adapter.list(dir);
    if (listing.files.length === 0 && listing.folders.length === 0) {
      await adapter.rmdir(dir, false).catch(() => { /* ignore */ });
    }
  } catch { /* best-effort */ }
}
