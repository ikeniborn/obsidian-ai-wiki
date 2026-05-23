import type { VaultTools } from "./vault-tools";
import { domainConfigDir, domainIndexPath, domainLogPath } from "./wiki-path";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  try { await vaultTools.mkdir(domainConfigDir(domainFolder)); } catch { /* already exists */ }
  await migrateLegacy(vaultTools, `${domainFolder}/_index.md`, domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, `${domainFolder}/_log.md`, domainLogPath(domainFolder));
  // Re-save any existing .config files so they enter the vault index (idempotent)
  await reindex(vaultTools, domainIndexPath(domainFolder));
  await reindex(vaultTools, domainLogPath(domainFolder));
}

async function reindex(vaultTools: VaultTools, vaultPath: string): Promise<void> {
  if (!vaultTools.vault) return;
  if (vaultTools.vault.getAbstractFileByPath(vaultPath)) return;
  if (!(await vaultTools.exists(vaultPath))) return;
  const content = await vaultTools.read(vaultPath);
  await vaultTools.write(vaultPath, content);
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  if (!(await vaultTools.exists(oldPath))) return;
  if (!(await vaultTools.exists(newPath))) {
    const content = await vaultTools.read(oldPath);
    await vaultTools.write(newPath, content);
  }
  await vaultTools.remove(oldPath);
}
