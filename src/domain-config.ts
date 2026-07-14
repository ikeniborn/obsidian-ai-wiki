import type { VaultTools } from "./vault-tools";
import { domainIndexPath, domainLogPath, legacyDomainIndexPath, legacyDomainLogPath } from "./wiki-path";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  await migrateLegacy(vaultTools, legacyDomainIndexPath(domainFolder), domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, legacyDomainLogPath(domainFolder), domainLogPath(domainFolder));
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  if (!(await vaultTools.exists(oldPath))) return;
  if (!(await vaultTools.exists(newPath))) {
    const content = await vaultTools.read(oldPath);
    await vaultTools.write(newPath, content);
  }
  await vaultTools.remove(oldPath);
}
