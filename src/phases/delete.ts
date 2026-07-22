import type {
  DeleteEntityTypeDelta,
  DeleteStateCommitEvent,
  IngestOutcome,
  LlmCallOptions,
  RunEvent,
  LlmClient,
} from "../types";
import type { VaultTools } from "../vault-tools";
import { applyDomainEvent, type DomainEntry, type EntityType } from "../domain";
import type { ExactDomainMetadataSnapshot } from "../domain-store";
import type { PageSimilarityService } from "../page-similarity";
import {
  domainIndexPath,
  domainLogPath,
  domainMetadataPath,
  domainWikiFolder,
  legacyDomainIndexPath,
  legacyDomainLogPath,
  validateArticlePath,
  isWikiPagePath,
} from "../wiki-path";
import {
  fileImage,
  readFileImage,
  rollbackFileMutations,
  sameFileImage,
  TransactionVaultTools,
  type FileImage,
  type FileMutation,
} from "../file-transaction";
import { removeArticleIndex } from "../wiki-index-store";
import { pageId } from "../wiki-graph";
import { parseResourceFromFm, stripInvalidWikiArticles } from "../utils/raw-frontmatter";
import { computeDeletionPlan, isSourceFile, sourceStem } from "../source-deletion";
import { runIngest } from "./ingest";
import ingestTemplate from "../../prompts/ingest.md";
import { promptVersionOf } from "../prompt-version";
import { appendWikiLog, type IngestLogEntry } from "../wiki-log";
import { contentHash } from "../content-hash";

type EntityTypeMutation = DeleteEntityTypeDelta;

interface DeleteJournal {
  version: 3;
  status: "prepared" | "active" | "committed" | "publishing" | "published" | "rollback";
  domainId: string;
  sourcePath: string;
  manifestComplete: boolean;
  mutations: FileMutation[];
  preparedMutation?: FileMutation;
  analyzedRemoval: { path: string; beforeHash?: string };
  entityTypeDeltas: EntityTypeMutation[];
  deleted: number;
  rebuilt: number;
  sourcePathAdds?: string[];
  publicationHash?: string;
}

function deleteJournalPath(domainRoot: string): string {
  return `${domainRoot}/delete-journal.json`;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export async function deleteJournalDigest(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function sameEntityType(left: EntityType | undefined, right: EntityType | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.type === right.type
    && left.description === right.description
    && left.wiki_subfolder === right.wiki_subfolder
    && left.min_mentions_for_page === right.min_mentions_for_page
    && left.extraction_cues.length === right.extraction_cues.length
    && left.extraction_cues.every((cue, index) => cue === right.extraction_cues[index]);
}

function entityTypeMutations(before: EntityType[], after: EntityType[]): EntityTypeMutation[] {
  const beforeByType = new Map(before.map((entry) => [entry.type, entry]));
  const afterByType = new Map(after.map((entry) => [entry.type, entry]));
  const result: EntityTypeMutation[] = [];
  for (const entry of after) {
    const prior = beforeByType.get(entry.type);
    if (!sameEntityType(prior, entry)) {
      result.push({
        type: entry.type,
        ...(prior === undefined ? {} : { before: prior }),
        after: entry,
      });
    }
  }
  for (const entry of before) {
    if (!afterByType.has(entry.type)) {
      result.push({ type: entry.type, before: entry });
    }
  }
  return result;
}

function applyJournalDomainDeltas(
  domain: DomainEntry,
  journal: DeleteJournal,
): {
  analyzedSources: Record<string, string>;
  analyzedChanged: boolean;
  entityTypes: EntityType[];
  entityTypesChanged: boolean;
} {
  const analyzedSources = { ...(domain.analyzed_sources ?? {}) };
  const currentHash = analyzedSources[journal.analyzedRemoval.path];
  let analyzedChanged = false;
  if (currentHash === journal.analyzedRemoval.beforeHash) {
    if (currentHash !== undefined) {
      delete analyzedSources[journal.analyzedRemoval.path];
      analyzedChanged = true;
    }
  } else if (currentHash !== undefined) {
    throw new Error(
      `delete: domain analyzed source conflict at ${journal.analyzedRemoval.path}`,
    );
  }

  const entityTypes = [...(domain.entity_types ?? [])];
  let entityTypesChanged = false;
  for (const mutation of journal.entityTypeDeltas) {
    const index = entityTypes.findIndex((entry) => entry.type === mutation.type);
    const current = index < 0 ? undefined : entityTypes[index];
    if (sameEntityType(current, mutation.after)) continue;
    if (!sameEntityType(current, mutation.before)) {
      throw new Error(`delete: domain entity type conflict at ${mutation.type}`);
    }
    if (mutation.after === undefined) {
      if (index >= 0) entityTypes.splice(index, 1);
    } else if (index >= 0) {
      entityTypes[index] = mutation.after;
    } else {
      entityTypes.push(mutation.after);
    }
    entityTypesChanged = true;
  }
  return { analyzedSources, analyzedChanged, entityTypes, entityTypesChanged };
}

function parseDeleteJournal(
  raw: string,
  expectedDomainId: string,
  expectedSourcePath: string,
  domainRoot: string,
  domain: DomainEntry,
): DeleteJournal {
  const parsed = JSON.parse(raw) as Partial<DeleteJournal>;
  const validImage = (image: unknown): image is FileImage => {
    if (image === null || typeof image !== "object") return false;
    const candidate = image as Partial<FileImage>;
    if (candidate.exists === false) return true;
    return candidate.exists === true
      && typeof candidate.content === "string"
      && typeof candidate.hash === "string"
      && contentHash(candidate.content) === candidate.hash;
  };
  const validMutation = (entry: unknown): entry is FileMutation => entry !== null
    && typeof entry === "object"
    && typeof (entry as Partial<FileMutation>).path === "string"
    && validImage((entry as Partial<FileMutation>).before)
    && validImage((entry as Partial<FileMutation>).after);
  const validEntityType = (value: unknown): value is EntityType => value !== null
    && typeof value === "object"
    && typeof (value as EntityType).type === "string"
    && typeof (value as EntityType).description === "string"
    && Array.isArray((value as EntityType).extraction_cues)
    && (value as EntityType).extraction_cues.every((cue) => typeof cue === "string");
  const validEntityMutation = (value: unknown): value is EntityTypeMutation => {
    if (value === null || typeof value !== "object") return false;
    const mutation = value as Partial<EntityTypeMutation>;
    return (typeof mutation.type === "string"
      && mutation.type.length > 0
      && (mutation.before !== undefined || mutation.after !== undefined))
      ? (mutation.before === undefined
          || (validEntityType(mutation.before) && mutation.before.type === mutation.type))
        && (mutation.after === undefined
          || (validEntityType(mutation.after) && mutation.after.type === mutation.type))
      : false;
  };
  const analyzedRemoval = parsed.analyzedRemoval as
    | { path?: unknown; beforeHash?: unknown }
    | undefined;
  const validMutationPath = (path: string): boolean =>
    validateArticlePath(path, domainRoot)
    || path === domainIndexPath(domainRoot)
    || path === domainLogPath(domainRoot)
    || path === legacyDomainIndexPath(domainRoot)
    || path === legacyDomainLogPath(domainRoot)
    || path === expectedSourcePath
    || isSourceFile(path, domain);
  if (parsed.version !== 3
    || (parsed.status !== "prepared"
      && parsed.status !== "active"
      && parsed.status !== "committed"
      && parsed.status !== "publishing"
      && parsed.status !== "published"
      && parsed.status !== "rollback")
    || parsed.domainId !== expectedDomainId
    || parsed.sourcePath !== expectedSourcePath
    || typeof parsed.manifestComplete !== "boolean"
    || !Array.isArray(parsed.mutations)
    || !parsed.mutations.every(validMutation)
    || (parsed.preparedMutation !== undefined && !validMutation(parsed.preparedMutation))
    || analyzedRemoval === undefined
    || analyzedRemoval.path !== expectedSourcePath
    || (analyzedRemoval.beforeHash !== undefined
      && typeof analyzedRemoval.beforeHash !== "string")
    || !Array.isArray(parsed.entityTypeDeltas)
    || !parsed.entityTypeDeltas.every(validEntityMutation)
    || new Set(parsed.entityTypeDeltas.map((entry) => entry.type)).size
      !== parsed.entityTypeDeltas.length
    || !Number.isSafeInteger(parsed.deleted)
    || !Number.isSafeInteger(parsed.rebuilt)
    || (parsed.sourcePathAdds !== undefined
      && (!Array.isArray(parsed.sourcePathAdds)
        || !parsed.sourcePathAdds.every((path) =>
          typeof path === "string"
          && path.length > 0
          && !path.split("/").some((segment) => segment === "." || segment === ".."))))
    || (parsed.publicationHash !== undefined
      && (typeof parsed.publicationHash !== "string"
        || !/^sha256:[0-9a-f]{64}$/.test(parsed.publicationHash)))
    || parsed.mutations.some((entry) => !validMutationPath(entry.path))) {
    throw new Error("delete: invalid or mismatched durable journal");
  }
  const committedStatus = parsed.status === "committed"
    || parsed.status === "publishing"
    || parsed.status === "published";
  if ((parsed.status === "prepared"
      && (!parsed.manifestComplete
        || parsed.mutations.length !== 0
        || parsed.preparedMutation !== undefined))
    || (committedStatus
      && (!parsed.manifestComplete || parsed.preparedMutation !== undefined))) {
    throw new Error("delete: invalid or mismatched durable journal");
  }
  if ((parsed.status === "published") !== (parsed.publicationHash !== undefined)) {
    throw new Error("delete: invalid or mismatched durable journal");
  }
  const previousAfter = new Map<string, FileImage>();
  for (const mutation of parsed.mutations) {
    const prior = previousAfter.get(mutation.path);
    if (prior !== undefined && !sameFileImage(prior, mutation.before)) {
      throw new Error("delete: invalid or mismatched durable journal");
    }
    previousAfter.set(mutation.path, mutation.after);
  }
  if (parsed.preparedMutation !== undefined) {
    const prior = previousAfter.get(parsed.preparedMutation.path);
    if (prior !== undefined && !sameFileImage(prior, parsed.preparedMutation.before)) {
      throw new Error("delete: invalid or mismatched durable journal");
    }
  }
  if (committedStatus) {
    const targetMutations = parsed.mutations.filter((mutation) =>
      mutation.path === expectedSourcePath);
    if (targetMutations.length === 0
      || !targetMutations[0].before.exists
      || targetMutations[targetMutations.length - 1].after.exists) {
      throw new Error("delete: invalid or mismatched durable journal");
    }
  }
  return parsed as DeleteJournal;
}

async function writeJournalCasExact(
  vaultTools: VaultTools,
  path: string,
  expectedRaw: string | undefined,
  journal: DeleteJournal,
  domainRoot: string,
  domain: DomainEntry,
): Promise<string> {
  const nextRaw = JSON.stringify(journal);
  parseDeleteJournal(nextRaw, journal.domainId, journal.sourcePath, domainRoot, domain);
  const current = await readFileImage(vaultTools, path);
  if (expectedRaw === undefined
    ? current.exists
    : !current.exists || current.content !== expectedRaw || current.hash !== contentHash(expectedRaw)) {
    throw new Error(`delete: journal CAS conflict for ${journal.status} transition`);
  }
  await vaultTools.write(path, nextRaw);
  const actual = await vaultTools.read(path);
  if (actual !== nextRaw || contentHash(actual) !== contentHash(nextRaw)) {
    throw new Error(`delete: journal verification failed for ${journal.status} transition`);
  }
  const persisted = parseDeleteJournal(
    actual,
    journal.domainId,
    journal.sourcePath,
    domainRoot,
    domain,
  );
  if (persisted.status !== journal.status) {
    throw new Error(`delete: journal verification failed for ${journal.status} transition`);
  }
  return nextRaw;
}

async function removeJournalCasExact(
  vaultTools: VaultTools,
  path: string,
  expectedRaw: string,
): Promise<void> {
  const current = await readFileImage(vaultTools, path);
  if (!current.exists || current.content !== expectedRaw || current.hash !== contentHash(expectedRaw)) {
    throw new Error("delete: journal CAS conflict before removal");
  }
  await removeAndVerify(vaultTools, path);
}

async function cleanupPublishedJournal(
  vaultTools: VaultTools,
  path: string,
  expectedRaw: string,
  journal: DeleteJournal,
): Promise<void> {
  const current = await readFileImage(vaultTools, path);
  if (!current.exists
    || current.content !== expectedRaw
    || current.hash !== contentHash(expectedRaw)) {
    throw new Error("delete: journal CAS conflict before published cleanup");
  }
  await verifyCommittedManifest(vaultTools, journal);
  await removeAndVerify(vaultTools, path);
}

async function verifyCommittedManifest(
  vaultTools: VaultTools,
  journal: DeleteJournal,
): Promise<void> {
  const finalByPath = new Map<string, FileImage>();
  for (const mutation of journal.mutations) finalByPath.set(mutation.path, mutation.after);
  for (const [path, expected] of finalByPath) {
    const current = await readFileImage(vaultTools, path);
    if (!sameFileImage(current, expected)) {
      throw new Error(`delete: committed manifest conflict at ${path}`);
    }
  }
}

async function verifyPublishedPredecessor(journal: DeleteJournal): Promise<void> {
  if (journal.status !== "published" || journal.publicationHash === undefined) {
    throw new Error("delete: durable publication receipt missing");
  }
  const predecessor: DeleteJournal = {
    ...journal,
    status: "publishing",
  };
  delete predecessor.publicationHash;
  if (await deleteJournalDigest(JSON.stringify(predecessor)) !== journal.publicationHash) {
    throw new Error("delete: publication predecessor integrity mismatch");
  }
}

async function readPublishedReceipt(
  vaultTools: VaultTools,
  domain: DomainEntry,
  event: DeleteStateCommitEvent,
): Promise<{ journal: DeleteJournal; raw: string }> {
  const raw = await vaultTools.read(event.journalPath);
  const journal = parseDeleteJournal(
    raw,
    event.domainId,
    event.sourcePathRemoved,
    domainWikiFolder(domain.wiki_folder),
    domain,
  );
  if (event.receiptHash === undefined
    || await deleteJournalDigest(raw) !== event.receiptHash
    || journal.status !== "published"
    || journal.publicationHash !== event.journalHash) {
    throw new Error("delete: durable publication receipt missing or mismatched");
  }
  await verifyPublishedPredecessor(journal);
  await verifyCommittedManifest(vaultTools, journal);
  return { journal, raw };
}

async function deleteStateCommitEvent(
  journal: DeleteJournal,
  journalPath: string,
  journalRaw: string,
): Promise<DeleteStateCommitEvent> {
  return {
    kind: "delete_state_commit",
    domainId: journal.domainId,
    journalPath,
    journalHash: await deleteJournalDigest(journalRaw),
    metadataPath: domainMetadataPath(journalPath.slice(0, journalPath.lastIndexOf("/"))),
    sourcePathAdds: [...(journal.sourcePathAdds ?? [])],
    sourcePathRemoved: journal.sourcePath,
    analyzedRemoval: { ...journal.analyzedRemoval },
    entityTypeDeltas: journal.entityTypeDeltas.map((delta) => ({ ...delta })),
  };
}

export function applyDeleteStateCommitEvent(
  domains: DomainEntry[],
  event: DeleteStateCommitEvent,
  vaultRoot: string,
): DomainEntry[] {
  const domain = domains.find((entry) => entry.id === event.domainId);
  if (domain === undefined) throw new Error(`delete: domain ${event.domainId} not found`);
  const applied = applyJournalDomainDeltas(domain, {
    version: 3,
    status: "publishing",
    domainId: event.domainId,
    sourcePath: event.sourcePathRemoved,
    manifestComplete: true,
    mutations: [],
    analyzedRemoval: event.analyzedRemoval,
    entityTypeDeltas: event.entityTypeDeltas,
    sourcePathAdds: event.sourcePathAdds,
    deleted: 0,
    rebuilt: 0,
  });
  let next = domains;
  for (const path of event.sourcePathAdds) {
    next = applyDomainEvent(next, {
      kind: "source_path_added",
      domainId: event.domainId,
      path,
    }, { vaultRoot });
  }
  next = applyDomainEvent(next, {
    kind: "source_path_removed",
    domainId: event.domainId,
    path: event.sourcePathRemoved,
  }, { vaultRoot });
  if (applied.analyzedChanged || applied.entityTypesChanged) {
    next = applyDomainEvent(next, {
      kind: "domain_updated",
      domainId: event.domainId,
      patch: {
        ...(applied.entityTypesChanged ? { entity_types: applied.entityTypes } : {}),
        ...(applied.analyzedChanged ? { analyzed_sources: applied.analyzedSources } : {}),
      },
    }, { vaultRoot });
  }
  return next;
}

export async function verifyDeleteStateCommitEvent(
  vaultTools: VaultTools,
  domain: DomainEntry,
  event: DeleteStateCommitEvent,
): Promise<void> {
  const raw = await vaultTools.read(event.journalPath);
  if (await deleteJournalDigest(raw) !== event.journalHash) {
    throw new Error("delete: publication journal precondition conflict");
  }
  const domainRoot = domainWikiFolder(domain.wiki_folder);
  if (event.journalPath !== deleteJournalPath(domainRoot)) {
    throw new Error("delete: publication journal path mismatch");
  }
  if (event.metadataPath !== domainMetadataPath(domainRoot)) {
    throw new Error("delete: publication metadata path mismatch");
  }
  const journal = parseDeleteJournal(
    raw,
    event.domainId,
    event.sourcePathRemoved,
    domainRoot,
    domain,
  );
  if (journal.status !== "publishing"
    || JSON.stringify(journal.sourcePathAdds ?? []) !== JSON.stringify(event.sourcePathAdds)
    || JSON.stringify(journal.analyzedRemoval) !== JSON.stringify(event.analyzedRemoval)
    || JSON.stringify(journal.entityTypeDeltas) !== JSON.stringify(event.entityTypeDeltas)) {
    throw new Error("delete: publication journal payload mismatch");
  }
  await verifyCommittedManifest(vaultTools, journal);
}

export async function persistDeleteStateCommitEvent(
  store: {
    readExactMetadata(
      path: string,
      expectedDomainId: string,
    ): Promise<ExactDomainMetadataSnapshot>;
    writeExactMetadata(
      snapshot: ExactDomainMetadataSnapshot,
      entry: DomainEntry,
    ): Promise<string>;
  },
  vaultTools: VaultTools,
  event: DeleteStateCommitEvent,
  vaultRoot: string,
): Promise<{ journalHash: string }> {
  const snapshot = await store.readExactMetadata(event.metadataPath, event.domainId);
  await verifyDeleteStateCommitEvent(vaultTools, snapshot.entry, event);
  const next = applyDeleteStateCommitEvent([snapshot.entry], event, vaultRoot)[0];
  await verifyDeleteStateCommitEvent(vaultTools, snapshot.entry, event);
  await store.writeExactMetadata(snapshot, next);
  await verifyDeleteStateCommitEvent(vaultTools, snapshot.entry, event);

  const publishingRaw = await vaultTools.read(event.journalPath);
  if (await deleteJournalDigest(publishingRaw) !== event.journalHash) {
    throw new Error("delete: publication journal changed before receipt");
  }
  const domainRoot = domainWikiFolder(snapshot.entry.wiki_folder);
  const journal = parseDeleteJournal(
    publishingRaw,
    event.domainId,
    event.sourcePathRemoved,
    domainRoot,
    snapshot.entry,
  );
  if (journal.status !== "publishing") {
    throw new Error("delete: publication receipt requires publishing journal");
  }
  await verifyCommittedManifest(vaultTools, journal);
  const published: DeleteJournal = {
    ...journal,
    status: "published",
    publicationHash: event.journalHash,
  };
  const publishedRaw = await writeJournalCasExact(
    vaultTools,
    event.journalPath,
    publishingRaw,
    published,
    domainRoot,
    snapshot.entry,
  );
  await verifyCommittedManifest(vaultTools, published);
  return { journalHash: await deleteJournalDigest(publishedRaw) };
}

async function removeAndVerify(vaultTools: VaultTools, path: string): Promise<void> {
  try {
    await vaultTools.remove(path);
  } catch (error) {
    if (await vaultTools.exists(path)) throw error;
  }
  if (await vaultTools.exists(path)) throw new Error(`Removal did not remove ${path}`);
}

/**
 * Delete a source file and its wiki artifacts; rebuild multi-source pages on
 * their remaining sources. args = [sourceVaultPath, domainId].
 */
export async function* runDelete(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  graphDepth: number = 1,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const sourcePath = args[0];
  const domainId = args[1];
  if (!sourcePath || !domainId) {
    yield { kind: "error", message: "delete: source path and domain id required" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const domain = domains.find((d) => d.id === domainId);
  if (!domain) {
    yield { kind: "error", message: `delete: domain ${domainId} not found` };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const wikiFolder = domainWikiFolder(domain.wiki_folder);
  const journalPath = deleteJournalPath(wikiFolder);

  if (await vaultTools.exists(journalPath)) {
    let pendingRaw = await vaultTools.read(journalPath);
    const pending = parseDeleteJournal(
      pendingRaw,
      domainId,
      sourcePath,
      wikiFolder,
      domain,
    );
    if (pending.status === "publishing") {
      throw new Error(
        "delete: publishing journal is ambiguous after interruption; manual recovery required",
      );
    }
    if (pending.status === "committed") {
      try {
        await verifyCommittedManifest(vaultTools, pending);
      } catch (error) {
        const rollbackJournal = { ...pending, status: "rollback" as const };
        pendingRaw = await writeJournalCasExact(
          vaultTools,
          journalPath,
          pendingRaw,
          rollbackJournal,
          wikiFolder,
          domain,
        );
        let rollbackError: unknown;
        try {
          await rollbackFileMutations(vaultTools, rollbackJournal.mutations);
        } catch (caught) {
          rollbackError = caught;
        }
        similarity?.invalidateCache();
        if (rollbackError === undefined) await similarity?.loadCache(wikiFolder, vaultTools);
        const detail = rollbackError instanceof Error
          ? rollbackError.message
          : (error as Error).message;
        throw new Error(`delete: committed pre-publication conflict; rollback retained — ${detail}`);
      }
      applyJournalDomainDeltas(domain, pending);
      pending.status = "publishing";
      pendingRaw = await writeJournalCasExact(
        vaultTools,
        journalPath,
        pendingRaw,
        pending,
        wikiFolder,
        domain,
      );
      const event = await deleteStateCommitEvent(pending, journalPath, pendingRaw);
      yield event;
      const receipt = await readPublishedReceipt(vaultTools, domain, event);
      await cleanupPublishedJournal(vaultTools, journalPath, receipt.raw, receipt.journal);
      yield {
        kind: "result",
        durationMs: Date.now() - start,
        text: `Deleted source ${sourceStem(sourcePath)}, pages deleted ${pending.deleted}, rebuilt ${pending.rebuilt}.`,
      };
      return;
    }
    if (pending.status === "published") {
      await verifyPublishedPredecessor(pending);
      await cleanupPublishedJournal(vaultTools, journalPath, pendingRaw, pending);
      yield {
        kind: "result",
        durationMs: Date.now() - start,
        text: `Deleted source ${sourceStem(sourcePath)}, pages deleted ${pending.deleted}, rebuilt ${pending.rebuilt}.`,
      };
      return;
    }
    if (pending.status === "active" || pending.status === "rollback") {
      let rollbackError: unknown;
      try {
        await rollbackFileMutations(vaultTools, pending.mutations);
      } catch (error) {
        rollbackError = error;
      }
      similarity?.invalidateCache();
      if (rollbackError !== undefined
        || !pending.manifestComplete
        || pending.preparedMutation !== undefined) {
        throw new Error(
          `delete: interrupted active journal rollback incomplete — ${
            rollbackError instanceof Error
              ? rollbackError.message
              : pending.preparedMutation !== undefined
                ? "ambiguous prepared mutation"
                : "untrustworthy manifest"
          }`,
        );
      }
      await similarity?.loadCache(wikiFolder, vaultTools);
      if (pending.status === "rollback") {
        throw new Error("delete: prior committed conflict rolled back; durable journal retained");
      }
    }
    await removeJournalCasExact(vaultTools, journalPath, pendingRaw);
    yield {
      kind: "info_text",
      icon: "rotate-ccw",
      summary: `Recovered interrupted delete for ${sourceStem(sourcePath)}`,
    };
    if (signal.aborted) {
      yield {
        kind: "result",
        durationMs: Date.now() - start,
        text: `Delete cancelled after restoring ${sourceStem(sourcePath)}.`,
      };
      return;
    }
  }

  // --- Build pages map + remaining-source map (vaultTools-based) ---
  const pageFiles = (await vaultTools.listFiles(wikiFolder))
    .filter(isWikiPagePath)
    .sort(compareCodePoints);
  const pages = new Map<string, string>();
  for (const p of pageFiles) {
    pages.set(p, await vaultTools.read(p));
  }
  const sourceImages = new Map<string, FileImage>();
  for (const configuredPath of domain.source_paths ?? []) {
    const files = configuredPath.endsWith(".md")
      ? [configuredPath]
      : (await vaultTools.listFiles(configuredPath))
        .filter((path) => path.endsWith(".md"))
        .sort(compareCodePoints);
    for (const path of files) {
      if (sourceImages.has(path)) continue;
      sourceImages.set(path, fileImage(await vaultTools.read(path)));
    }
  }
  const targetImage = sourceImages.get(sourcePath);
  if (targetImage === undefined) {
    throw new Error(`delete: target ${sourcePath} is not an exact member of governed source inventory`);
  }
  const targetStem = sourceStem(sourcePath);
  const matchingTargetStems = [...sourceImages.keys()]
    .filter((path) => sourceStem(path) === targetStem)
    .sort(compareCodePoints);
  if (matchingTargetStems.length !== 1) {
    throw new Error(
      `delete: target stem ${targetStem} must resolve uniquely; found ${matchingTargetStems.length}`,
    );
  }
  const sourceCandidates = new Map<string, string[]>();
  for (const path of sourceImages.keys()) {
    if (path === sourcePath) continue;
    const stem = sourceStem(path);
    sourceCandidates.set(stem, [...(sourceCandidates.get(stem) ?? []), path]);
  }
  const sourceStemToPath = new Map<string, string>();
  for (const [stem, paths] of sourceCandidates) {
    const unique = [...new Set(paths)].sort(compareCodePoints);
    if (unique.length === 1) sourceStemToPath.set(stem, unique[0]);
  }

  const plan = computeDeletionPlan(sourcePath, pages, sourceStemToPath);
  const targetTokens = new Set([sourcePath, targetStem]);
  const sourcePathSet = new Set(sourceImages.keys());
  for (const [pagePath, content] of pages) {
    const resources = parseResourceFromFm(content);
    if (!resources.some((resource) => targetTokens.has(resource)) || resources.length < 2) continue;
    for (const resource of resources) {
      if (targetTokens.has(resource)) continue;
      if (resource.includes("/") || resource.endsWith(".md")) {
        if (!sourcePathSet.has(resource)) {
          throw new Error(
            `delete: resource ${resource} on ${pagePath} must resolve uniquely; found 0`,
          );
        }
        continue;
      }
      const matches = [...new Set(sourceCandidates.get(resource) ?? [])];
      if (matches.length !== 1) {
        throw new Error(
          `delete: resource ${resource} on ${pagePath} must resolve uniquely; found ${matches.length}`,
        );
      }
    }
  }
  yield {
    kind: "info_text", icon: "trash", summary: `Deleting source: ${sourceStem(sourcePath)}`,
    details: [`${plan.toDelete.length} page(s) to delete`, `${plan.toRebuild.length} page(s) to rebuild`],
  };

  // Prepare domain state changes, but do not expose them until page/index cleanup succeeds.
  const curAnalyzed = domain.analyzed_sources ?? {};
  const journal: DeleteJournal = {
    version: 3,
    status: "prepared",
    domainId,
    sourcePath,
    manifestComplete: true,
    mutations: [],
    analyzedRemoval: {
      path: sourcePath,
      ...(curAnalyzed[sourcePath] === undefined
        ? {}
        : { beforeHash: curAnalyzed[sourcePath] }),
    },
    entityTypeDeltas: [],
    deleted: 0,
    rebuilt: plan.toRebuild.length,
  };
  let journalRaw = await writeJournalCasExact(
    vaultTools,
    journalPath,
    undefined,
    journal,
    wikiFolder,
    domain,
  );
  journal.status = "active";
  journal.manifestComplete = true;
  journalRaw = await writeJournalCasExact(
    vaultTools,
    journalPath,
    journalRaw,
    journal,
    wikiFolder,
    domain,
  );

  // WAL protocol: CAS-append every operation step before its vault mutation.
  // Recovery accepts either side of each step and rolls the sequence back in reverse.
  const transactionVault = new TransactionVaultTools(vaultTools, {
    async prepare(mutation) {
      const nextJournal: DeleteJournal = {
        ...journal,
        status: "active",
        manifestComplete: true,
        preparedMutation: mutation,
      };
      const nextRaw = await writeJournalCasExact(
        vaultTools,
        journalPath,
        journalRaw,
        nextJournal,
        wikiFolder,
        domain,
      );
      Object.assign(journal, nextJournal);
      journalRaw = nextRaw;
    },
    async commit(mutation) {
      if (journal.preparedMutation === undefined
        || JSON.stringify(journal.preparedMutation) !== JSON.stringify(mutation)) {
        throw new Error("delete: prepared mutation authority mismatch");
      }
      const nextJournal: DeleteJournal = {
        ...journal,
        status: "active",
        manifestComplete: true,
        mutations: [...journal.mutations, mutation],
      };
      delete nextJournal.preparedMutation;
      const nextRaw = await writeJournalCasExact(
        vaultTools,
        journalPath,
        journalRaw,
        nextJournal,
        wikiFolder,
        domain,
      );
      delete journal.preparedMutation;
      Object.assign(journal, nextJournal);
      journalRaw = nextRaw;
    },
    async abort(mutation) {
      if (journal.preparedMutation === undefined
        || JSON.stringify(journal.preparedMutation) !== JSON.stringify(mutation)) {
        throw new Error("delete: prepared mutation authority mismatch");
      }
      const nextJournal: DeleteJournal = {
        ...journal,
        status: "active",
        manifestComplete: true,
      };
      delete nextJournal.preparedMutation;
      const nextRaw = await writeJournalCasExact(
        vaultTools,
        journalPath,
        journalRaw,
        nextJournal,
        wikiFolder,
        domain,
      );
      delete journal.preparedMutation;
      Object.assign(journal, nextJournal);
      journalRaw = nextRaw;
    },
  });
  const safeRemovePage = async (p: string): Promise<boolean> => {
    if (!validateArticlePath(p, wikiFolder)) return false;
    const planned = pages.get(p);
    if (planned === undefined) {
      throw new Error(`delete: planned page changed before removal: ${p}`);
    }
    const expected = fileImage(planned);
    if (!sameFileImage(await readFileImage(transactionVault, p), expected)) {
      throw new Error(`delete: planned page changed before removal: ${p}`);
    }
    await transactionVault.removeIfCurrent(p, expected);
    await removeArticleIndex(transactionVault, wikiFolder, pageId(p));
    return true;
  };

  const failedSources: string[] = [];
  const deferredSourcePaths = new Map<string, { domainId: string; path: string }>();
  const deferredLogs: Array<{
    sourcePath: string;
    entries: IngestLogEntry[];
    outputTokens: number;
  }> = [];
  let currentDomain = domain;
  let deleted = 0;
  let controlledFailure = false;
  let caughtFailure: unknown;
  try {
    // --- 2. Wipe rebuild pages ---
    for (const p of plan.toRebuild) {
      if (signal.aborted) {
        controlledFailure = true;
        break;
      }
      if (!(await safeRemovePage(p))) {
        controlledFailure = true;
        yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
        break;
      }
    }

    // --- 3. Rebuild: re-ingest each remaining source (continue + collect) ---
    if (!controlledFailure) {
      for (const src of plan.remainingSources) {
        if (signal.aborted) {
          controlledFailure = true;
          break;
        }
        let outcome: IngestOutcome | undefined;
        try {
          const generator = runIngest(
            [src],
            transactionVault,
            llm,
            model,
            domains.map((entry) => entry.id === currentDomain.id ? currentDomain : entry),
            vaultRoot,
            signal,
            opts,
            similarity,
            undefined,
            graphDepth,
            wikiLinkValidationRetries,
            { deferCommitEffects: true, transaction: transactionVault },
          );
          while (true) {
            const next = await generator.next();
            if (next.done) {
              outcome = next.value;
              break;
            }
            const ev = next.value;
            // Suppress the inner per-source `result` event — runDelete emits its own
            // final `result`; forwarding it would trip the view's stopWaiting() early.
            if (ev.kind === "result" || ev.kind === "eval_meta") continue;
            yield ev;
          }
        } catch (error) {
          yield { kind: "error", message: `Rebuild failed for ${src}: ${(error as Error).message}` };
        }
        if (!outcome?.ok) {
          failedSources.push(src);
        } else {
          const effects = outcome.deferred;
          if (effects === undefined || !effects.manifestComplete) {
            failedSources.push(src);
            continue;
          }
          if (effects.domainPatch !== undefined) {
            currentDomain = { ...currentDomain, ...effects.domainPatch };
          }
          if (effects.sourcePathAdded !== undefined) {
            deferredSourcePaths.set(effects.sourcePathAdded.path, effects.sourcePathAdded);
          }
          if (effects.log !== undefined) {
            deferredLogs.push(effects.log);
          }
        }
      }
    }

    controlledFailure ||= failedSources.length > 0 || signal.aborted;

    // --- 4. Delete sole-source pages only after every rebuild succeeded ---
    if (!controlledFailure) {
      for (const p of plan.toDelete) {
        if (signal.aborted) {
          controlledFailure = true;
          break;
        }
        if (await safeRemovePage(p)) deleted++;
        else {
          controlledFailure = true;
          yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
          break;
        }
      }
    }

    // --- 5. Backlink cleanup after every rebuild and sole-source deletion succeeded ---
    if (!controlledFailure) {
      const remainingPageStems = new Set(
        (await transactionVault.listFiles(wikiFolder))
          .filter(isWikiPagePath)
          .map((p) => pageId(p)),
      );
      for (const src of sourceStemToPath.values()) {
        const content = await transactionVault.read(src);
        const { content: cleaned, warnings } = stripInvalidWikiArticles(content, remainingPageStems);
        if (warnings.length > 0 && cleaned !== content) {
          await transactionVault.writeIfCurrent(src, fileImage(content), cleaned);
        }
      }
    }

    // --- 6. Delete source file only after every governed operation succeeded ---
    if (!controlledFailure) {
      if (!sameFileImage(await readFileImage(transactionVault, sourcePath), targetImage)) {
        throw new Error(`delete: target source changed before removal: ${sourcePath}`);
      }
      await transactionVault.removeIfCurrent(sourcePath, targetImage);
      for (const log of deferredLogs) {
        await appendWikiLog(transactionVault, wikiFolder, domain.id, {
          op: "ingest",
          ...log,
        });
      }
      journal.status = "committed";
      journal.manifestComplete = transactionVault.manifestComplete;
      journal.deleted = deleted;
      journal.entityTypeDeltas = entityTypeMutations(
        domain.entity_types ?? [],
        currentDomain.entity_types ?? [],
      );
      journal.sourcePathAdds = [...deferredSourcePaths.keys()];
      journalRaw = await writeJournalCasExact(
        vaultTools,
        journalPath,
        journalRaw,
        journal,
        wikiFolder,
        domain,
      );
      await verifyCommittedManifest(vaultTools, journal);
    }
  } catch (error) {
    caughtFailure = error;
  }

  if (controlledFailure || caughtFailure !== undefined) {
    let journalUpdateError: unknown;
    const committedConflict = journal.status === "committed";
    if (committedConflict) {
      try {
        const nextJournal = { ...journal, status: "rollback" as const };
        journalRaw = await writeJournalCasExact(
          vaultTools,
          journalPath,
          journalRaw,
          nextJournal,
          wikiFolder,
          domain,
        );
        Object.assign(journal, nextJournal);
      } catch (error) {
        journalUpdateError = error;
      }
    } else if (!transactionVault.manifestComplete) {
      try {
        const nextJournal = { ...journal, status: "active" as const, manifestComplete: false };
        journalRaw = await writeJournalCasExact(
          vaultTools,
          journalPath,
          journalRaw,
          nextJournal,
          wikiFolder,
          domain,
        );
        Object.assign(journal, nextJournal);
      } catch (error) {
        journalUpdateError = error;
      }
    }
    let rollbackError: unknown;
    try {
      await rollbackFileMutations(vaultTools, journal.mutations);
    } catch (error) {
      rollbackError = error;
    }
    similarity?.invalidateCache();
    if (rollbackError === undefined && journalUpdateError === undefined
      && transactionVault.manifestComplete && !committedConflict) {
      try {
        await similarity?.loadCache(wikiFolder, vaultTools);
        await removeJournalCasExact(vaultTools, journalPath, journalRaw);
      } catch (error) {
        rollbackError = error;
      }
    }
    if (rollbackError !== undefined || journalUpdateError !== undefined
      || !transactionVault.manifestComplete || committedConflict) {
      const failure = rollbackError ?? journalUpdateError
        ?? (committedConflict
          ? new Error("delete: committed pre-publication conflict; rollback journal retained")
          : new Error("delete: rollback manifest is incomplete"));
      const failureError = failure instanceof Error ? failure : new Error(String(failure));
      yield {
        kind: "error",
        message: `delete: rollback failed — ${failureError.message}`,
      };
      throw failureError;
    }
    if (failedSources.length > 0) {
      yield { kind: "info_text", icon: "alert-triangle", summary: "Rebuild failures", details: failedSources };
    }
    if (caughtFailure !== undefined) {
      throw caughtFailure instanceof Error
        ? caughtFailure
        : new Error(String(caughtFailure));
    }
    const reason = signal.aborted ? "cancelled" : "retry";
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Delete ${reason}; restored ${targetStem}, source kept — ${reason}.`,
    };
    return;
  }

  // Publish all external state through one controller save. The publishing
  // journal is the file-manifest precondition and makes replay idempotent.
  applyJournalDomainDeltas(domain, journal);
  journal.status = "publishing";
  journalRaw = await writeJournalCasExact(
    vaultTools,
    journalPath,
    journalRaw,
    journal,
    wikiFolder,
    domain,
  );
  const event = await deleteStateCommitEvent(journal, journalPath, journalRaw);
  yield event;
  const receipt = await readPublishedReceipt(vaultTools, domain, event);
  await cleanupPublishedJournal(vaultTools, journalPath, receipt.raw, receipt.journal);

  // --- 7. Result ---
  const parts = [
    `Deleted source ${targetStem}`,
    `pages deleted ${deleted}`,
    `rebuilt ${plan.toRebuild.length}`,
  ];
  const text = parts.filter(Boolean).join(", ") + ".";
  yield {
    kind: "eval_meta",
    fields: {
      deleted_source: sourcePath,
      rebuilt_pages: plan.toRebuild,
      promptVersion: promptVersionOf(ingestTemplate),
    },
  };
  yield { kind: "result", durationMs: Date.now() - start, text };
}
