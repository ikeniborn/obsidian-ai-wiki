import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { domainIndexPath, domainWikiFolder } from "./wiki-path";
import { parseIndexAnnotations } from "./wiki-index";

// Old: "- [[pid]] relpath — annotation"  (relpath has no spaces).
const OLD_ENTRY = /^- \[\[([^\]]+)\]\] \S+ — (.+)$/;
// New: "- pid — annotation"  (pid has no spaces).
const NEW_ENTRY = /^- \S+ — .+$/;

interface LineResult {
  out: string;
  changed: boolean;
  unknown: boolean;
}

function migrateLine(line: string): LineResult {
  if (!line.startsWith("- ")) return { out: line, changed: false, unknown: false };
  const old = line.match(OLD_ENTRY);
  if (old) return { out: `- ${old[1]} — ${old[2]}`, changed: true, unknown: false };
  if (NEW_ENTRY.test(line)) return { out: line, changed: false, unknown: false };
  return { out: line, changed: false, unknown: true };
}

/**
 * One-shot, content-detecting migration of every domain's `_index.md` from the old
 * `- [[pid]] relpath — annotation` format to the new bracketless `- pid — annotation`.
 * Idempotent: a file with no old-format lines is left untouched. Non-destructive: a
 * domain is skipped (no write) if any entry-looking line is unrecognized, or if the
 * before/after annotation key sets differ.
 */
export async function migrateIndexFormat(vault: Vault, domains: DomainEntry[]): Promise<void> {
  const adapter = vault.adapter;
  let filesChanged = 0;
  let linesChanged = 0;

  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    const indexPath = domainIndexPath(wikiFolder);
    if (!(await adapter.exists(indexPath))) continue;

    const raw = await adapter.read(indexPath);
    const before = parseIndexAnnotations(raw);

    const out: string[] = [];
    let changed = 0;
    let unknown = false;
    for (const line of raw.split("\n")) {
      const r = migrateLine(line);
      if (r.unknown) {
        console.error(`[AI Wiki] index migration: unrecognized line in ${indexPath}: ${line}`);
        unknown = true;
        break;
      }
      out.push(r.out);
      if (r.changed) changed++;
    }
    if (unknown) continue;   // halt this domain, write nothing
    if (changed === 0) continue; // already migrated / nothing to do

    const newContent = out.join("\n");
    const after = parseIndexAnnotations(newContent);
    // Non-destructive guard: the pid key set must be byte-for-byte preserved.
    const preserved =
      before.size === after.size && [...before.keys()].every((k) => after.has(k));
    if (!preserved) {
      console.error(
        `[AI Wiki] index migration: annotation key mismatch in ${indexPath} ` +
          `(${before.size} → ${after.size}); skipping`,
      );
      continue;
    }

    await adapter.write(indexPath, newContent);
    filesChanged++;
    linesChanged += changed;
  }

  if (filesChanged > 0) {
    new Notice(`AI Wiki: index format migrated — ${filesChanged} files, ${linesChanged} lines`);
  }
}
