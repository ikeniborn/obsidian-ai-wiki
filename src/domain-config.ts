import type { VaultTools } from "./vault-tools";
import { domainIndexPath, domainLogPath, legacyDomainIndexPath, legacyDomainLogPath } from "./wiki-path";
import { readFileImage, TransactionVaultTools } from "./file-transaction";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  await migrateLegacy(vaultTools, legacyDomainIndexPath(domainFolder), domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, legacyDomainLogPath(domainFolder), domainLogPath(domainFolder));
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  const oldImage = await readFileImage(vaultTools, oldPath);
  if (!oldImage.exists) return;
  const newImage = await readFileImage(vaultTools, newPath);
  if (!newImage.exists) {
    if (vaultTools instanceof TransactionVaultTools) {
      await vaultTools.writeIfCurrent(newPath, newImage, oldImage.content);
    } else {
      await vaultTools.write(newPath, oldImage.content);
    }
  }
  if (vaultTools instanceof TransactionVaultTools) {
    await vaultTools.removeIfCurrent(oldPath, oldImage);
  } else {
    await vaultTools.remove(oldPath);
  }
}
