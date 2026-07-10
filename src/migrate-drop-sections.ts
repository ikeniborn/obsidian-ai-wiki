import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import type { LocalConfigStore } from "./local-config";
import { collectMdInPaths } from "./utils/vault-walk";
import { domainWikiFolder } from "./wiki-path";
import {
  stripLegacySections,
  extractRelatedLinks,
  addOutgoingLinks,
} from "./strip-legacy-sections";

/**
 * One-shot, idempotent on-load migration: removes the legacy `Связанные концепции` /
 * `История изменений` sections (all languages) from every domain wiki page. Before
 * stripping, it unions any `[[links]]` from the related section into the canonical
 * `## Related` body section so no graph edge is lost. Guarded by the `migrated_drop_sections`
 * local-config flag;
 * a second run is a no-op. Service files (`_`-prefixed: `_index.md`, `_log.md`,
 * `_wiki_schema.md`) are skipped. The embeddings cache self-heals on the next ingest/lint
 * (refreshCache diffs chunks by content hash), so no embedding calls happen here.
 */
export async function migrateDropSections(
  vault: Vault,
  domains: DomainEntry[],
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_drop_sections) return;

  const adapter = vault.adapter;
  let filesChanged = 0;

  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    for (const file of collectMdInPaths(vault, [wikiFolder])) {
      if (file.basename.startsWith("_")) continue; // skip service files
      try {
        const content = await adapter.read(file.path);
        const related = extractRelatedLinks(content);
        const stripped = stripLegacySections(addOutgoingLinks(content, related));
        if (stripped !== content) {
          await adapter.write(file.path, stripped);
          filesChanged++;
        }
      } catch (e) {
        console.error(`[AI Wiki] drop-sections migration: error processing ${file.path}`, e);
      }
    }
  }

  await localConfigStore.save({ migrated_drop_sections: true });
  if (filesChanged > 0) {
    new Notice(`AI Wiki: legacy wiki sections removed — ${filesChanged} pages`);
  }
}
