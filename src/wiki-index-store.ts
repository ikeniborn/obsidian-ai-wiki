import type { VaultTools } from "./vault-tools";
import {
  collectPageDescriptions,
  parseWikiIndexJsonl,
  reconcilePageRecords,
  removeArticleRecords,
  removePageRecord,
  stringifyWikiIndexJsonl,
  upsertPageRecord,
  type PageIndexRecord,
  type WikiIndexRecord,
} from "./wiki-index-jsonl";
import { pageIndexRecordFromMarkdown } from "./wiki-index";
import { domainIndexPath } from "./wiki-path";

const writeQueues = new WeakMap<object, Map<string, Promise<void>>>();

export async function readWikiIndexRecords(
  vaultTools: VaultTools,
  domainRoot: string,
): Promise<WikiIndexRecord[]> {
  const path = domainIndexPath(domainRoot);
  if (!await vaultTools.exists(path)) return [];
  return parseWikiIndexJsonl(await vaultTools.read(path), path);
}

export async function readPageDescriptions(
  vaultTools: VaultTools,
  domainRoot: string,
): Promise<Map<string, string>> {
  return collectPageDescriptions(await readWikiIndexRecords(vaultTools, domainRoot));
}

export async function transformWikiIndexRecords(
  vaultTools: VaultTools,
  domainRoot: string,
  transform: (records: WikiIndexRecord[]) => WikiIndexRecord[],
): Promise<void> {
  const path = domainIndexPath(domainRoot);
  const queueOwner = vaultTools.adapter;
  let queues = writeQueues.get(queueOwner);
  if (!queues) {
    queues = new Map();
    writeQueues.set(queueOwner, queues);
  }
  const previous = queues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const records = await readWikiIndexRecords(vaultTools, domainRoot);
    await vaultTools.write(path, stringifyWikiIndexJsonl(transform(records)));
  });
  queues.set(path, current);
  try {
    await current;
  } finally {
    if (queues.get(path) === current) queues.delete(path);
  }
}

export async function upsertPageIndex(
  vaultTools: VaultTools,
  domainRoot: string,
  record: PageIndexRecord,
): Promise<void> {
  await transformWikiIndexRecords(vaultTools, domainRoot, (records) => upsertPageRecord(records, record));
}

export async function removePageIndex(
  vaultTools: VaultTools,
  domainRoot: string,
  articleId: string,
): Promise<void> {
  await transformWikiIndexRecords(vaultTools, domainRoot, (records) => removePageRecord(records, articleId));
}

export async function removeArticleIndex(
  vaultTools: VaultTools,
  domainRoot: string,
  articleId: string,
): Promise<void> {
  await transformWikiIndexRecords(vaultTools, domainRoot, (records) => removeArticleRecords(records, articleId));
}

export async function reconcilePageIndex(
  vaultTools: VaultTools,
  domainRoot: string,
  pages: Array<{ path: string; content: string }>,
): Promise<void> {
  const records = pages.map(({ path, content }) => pageIndexRecordFromMarkdown(domainRoot, path, content));
  await transformWikiIndexRecords(vaultTools, domainRoot, (existing) => reconcilePageRecords(existing, records));
}
