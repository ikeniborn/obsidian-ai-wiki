#!/usr/bin/env node
// Usage: npx tsx scripts/migrate-wiki-prefix.ts <vault-root> [--apply]
// Default mode is dry-run; pass --apply to actually write changes.

import { readFile, writeFile, readdir, stat, unlink, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import type { VaultAdapter } from "../src/vault-tools.js";
import type { DomainEntry } from "../src/domain.js";
import { migrateDomain, type MigrationReport } from "../src/migrate-wiki-prefix.js";
import { GLOBAL_DOMAIN_PATH } from "../src/wiki-path.js";

function makeNodeAdapter(vaultRoot: string): VaultAdapter {
  const abs = (p: string) => (isAbsolute(p) ? p : join(vaultRoot, p));
  return {
    async read(p) { return readFile(abs(p), "utf8"); },
    async write(p, data) {
      const full = abs(p);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, "utf8");
    },
    async append(p, data) {
      const full = abs(p);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, { encoding: "utf8", flag: "a" });
    },
    async list(p) {
      const full = abs(p);
      if (!existsSync(full)) return { files: [], folders: [] };
      const entries = await readdir(full, { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const e of entries) {
        const rel = `${p ? p + "/" : ""}${e.name}`;
        if (e.isDirectory()) folders.push(rel);
        else files.push(rel);
      }
      return { files, folders };
    },
    async exists(p) { return existsSync(abs(p)); },
    async mkdir(p) { await mkdir(abs(p), { recursive: true }); },
    async remove(p) { await unlink(abs(p)); },
  };
}

function parseArgs(argv: string[]): { vaultRoot: string; apply: boolean } {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const vaultRoot = positional[0];
  if (!vaultRoot) {
    console.error("Usage: npx tsx scripts/migrate-wiki-prefix.ts <vault-root> [--apply]");
    process.exit(1);
  }
  return { vaultRoot: resolve(vaultRoot), apply };
}

function summarize(reports: MigrationReport[], dryRun: boolean): void {
  console.log("");
  console.log(dryRun ? "=== DRY RUN — no files modified ===" : "=== APPLIED ===");
  for (const r of reports) {
    if (r.skipped) {
      console.log(`[${r.domainId}] skipped (already migrated)`);
      continue;
    }
    console.log(`[${r.domainId}] ${r.filesRenamed} page(s) renamed, index=${r.indexUpdated}, log=${r.logUpdated}, emb=${r.embeddingsKeysRenamed}, sources=${r.sourcesUpdated}`);
    for (const [oldStem, newStem] of Object.entries(r.renames)) {
      console.log(`  ${oldStem} -> ${newStem}`);
    }
  }
}

async function main(): Promise<void> {
  const { vaultRoot, apply } = parseArgs(process.argv);
  const dryRun = !apply;
  if (!existsSync(vaultRoot)) {
    console.error(`Vault root not found: ${vaultRoot}`);
    process.exit(1);
  }
  const adapter = makeNodeAdapter(vaultRoot);
  if (!(await adapter.exists(GLOBAL_DOMAIN_PATH))) {
    console.error(`No domain config found at ${GLOBAL_DOMAIN_PATH} inside ${vaultRoot}`);
    process.exit(1);
  }
  const raw = await adapter.read(GLOBAL_DOMAIN_PATH);
  const domains = JSON.parse(raw) as DomainEntry[];

  const reports: MigrationReport[] = [];
  for (const domain of domains) {
    if (domain.wiki_folder?.startsWith("!Wiki/")) {
      domain.wiki_folder = domain.wiki_folder.slice("!Wiki/".length);
    }
    console.log(`\n--- Migrating domain "${domain.id}" ---`);
    reports.push(await migrateDomain(domain, adapter, { dryRun }));
  }

  summarize(reports, dryRun);

  if (!dryRun) {
    await adapter.write(GLOBAL_DOMAIN_PATH, JSON.stringify(domains, null, 2));
    console.log(`\nUpdated ${GLOBAL_DOMAIN_PATH} with pageNameVersion: 1`);
  } else {
    console.log("\nRe-run with --apply to write changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
