import type { Vault } from "obsidian";
import {
  WIKI_ROOT,
  GLOBAL_CONFIG_DIR,
  GLOBAL_DOMAIN_PATH,
  GLOBAL_WIKI_SCHEMA_PATH,
  GLOBAL_FORMAT_SCHEMA_PATH,
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
    try { domains = JSON.parse(await adapter.read(GLOBAL_DOMAIN_PATH)); } catch { /* ignore */ }
  }

  // Pick best schema from per-domain copies (latest mtime wins)
  await pickAndWriteSchema(adapter, domains, "_wiki_schema.md", GLOBAL_WIKI_SCHEMA_PATH);
  await pickAndWriteSchema(adapter, domains, "_format_schema.md", GLOBAL_FORMAT_SCHEMA_PATH);

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

async function pickAndWriteSchema(
  adapter: Vault["adapter"],
  domains: Array<{ wiki_folder: string }>,
  filename: string,
  dest: string,
): Promise<void> {
  let bestContent: string | null = null;
  let bestMtime = -1;

  for (const domain of domains) {
    const p = `${WIKI_ROOT}/${domain.wiki_folder}/.config/${filename}`;
    if (!(await adapter.exists(p))) continue;
    const stat = await (adapter as any).stat?.(p);
    const mtime = (stat?.mtime as number | undefined) ?? 0;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      bestContent = await adapter.read(p);
    }
  }

  if (bestContent === null) {
    const globalOld = `${OLD_GLOBAL_CONFIG}/${filename}`;
    if (await adapter.exists(globalOld)) {
      bestContent = await adapter.read(globalOld);
    }
  }

  if (bestContent === null) {
    const bundled = `prompts/templates/${filename}`;
    if (await adapter.exists(bundled)) {
      bestContent = await adapter.read(bundled);
    }
  }

  if (bestContent !== null) {
    await adapter.write(dest, bestContent);
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
      await (adapter as any).rmdir?.(dir, false).catch?.(() => {});
    }
  } catch { /* ignore */ }
}
