// node:fs/promises VaultTools adapter. Vault paths (e.g. "!Wiki/<domain>/_config/_index.md")
// are joined onto the vault root and read/listed directly from disk.
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";

export function buildVaultTools(vaultRoot: string): VaultTools {
  const abs = (p: string) => join(vaultRoot, p);
  const adapter: VaultAdapter = {
    async read(p) { return fs.readFile(abs(p), "utf-8"); },
    async write(p, data) { await fs.mkdir(dirname(abs(p)), { recursive: true }); await fs.writeFile(abs(p), data); },
    async append(p, data) { await fs.appendFile(abs(p), data); },
    async exists(p) { try { await fs.stat(abs(p)); return true; } catch { return false; } },
    async mkdir(p) { await fs.mkdir(abs(p), { recursive: true }); },
    async list(p) {
      const entries = await fs.readdir(abs(p), { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const e of entries) {
        const child = join(p, e.name); // keep vault-relative so recursion re-joins onto vaultRoot
        if (e.isDirectory()) folders.push(child);
        else files.push(child);
      }
      return { files, folders };
    },
  };
  return new VaultTools(adapter, vaultRoot);
}
