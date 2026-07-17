import { contentHash } from "./content-hash";
import { VaultTools } from "./vault-tools";

export type FileImage =
  | { exists: false }
  | { exists: true; content: string; hash: string };

export interface FileMutation {
  path: string;
  before: FileImage;
  after: FileImage;
}

export type BeforeFileMutation = (mutation: FileMutation) => Promise<void>;

export interface FileMutationJournal {
  prepare(mutation: FileMutation): Promise<void>;
  commit(mutation: FileMutation): Promise<void>;
  abort(mutation: FileMutation): Promise<void>;
}

export function fileImage(content?: string): FileImage {
  return content === undefined
    ? { exists: false }
    : { exists: true, content, hash: contentHash(content) };
}

export async function readFileImage(vaultTools: VaultTools, path: string): Promise<FileImage> {
  if (!await vaultTools.exists(path)) return { exists: false };
  return fileImage(await vaultTools.read(path));
}

export function sameFileImage(left: FileImage, right: FileImage): boolean {
  if (left.exists !== right.exists) return false;
  if (!left.exists || !right.exists) return true;
  return left.hash === right.hash && left.content === right.content;
}

/**
 * Captures each write/remove as a before/expected-after step. A caller-supplied
 * hook can durably persist that authority before the underlying mutation.
 */
export class TransactionVaultTools extends VaultTools {
  private readonly recorded: FileMutation[] = [];
  private trustworthy = true;

  constructor(
    private readonly delegate: VaultTools,
    private readonly journal?: BeforeFileMutation | FileMutationJournal,
  ) {
    super(delegate.adapter, delegate.vaultRoot, delegate.vault);
  }

  get manifestComplete(): boolean {
    return this.trustworthy;
  }

  get mutations(): FileMutation[] {
    return [...this.recorded];
  }

  private async captureMutation(
    path: string,
    expectedBefore: FileImage | undefined,
    expectedAfter: FileImage,
    mutate: () => Promise<void>,
  ): Promise<void> {
    let prior: FileMutation | undefined;
    for (let index = this.recorded.length - 1; index >= 0; index--) {
      if (this.recorded[index].path === path) {
        prior = this.recorded[index];
        break;
      }
    }
    const operationBefore = await readFileImage(this.delegate, path);
    if (expectedBefore !== undefined && !sameFileImage(operationBefore, expectedBefore)) {
      throw new Error(`transaction conflict at ${path}`);
    }
    if (prior !== undefined && !sameFileImage(operationBefore, prior.after)) {
      this.trustworthy = false;
      throw new Error(`transaction verification failed at ${path}: untrusted third state`);
    }
    if (sameFileImage(operationBefore, expectedAfter)) {
      throw new Error(`transaction no-op at ${path}: before and after images are identical`);
    }
    const authority = { path, before: operationBefore, after: expectedAfter };
    let authorityPrepared = false;
    if (this.journal !== undefined) {
      if (typeof this.journal === "function") {
        await this.journal(authority);
      } else {
        await this.journal.prepare(authority);
      }
      authorityPrepared = true;
      const postWal = await readFileImage(this.delegate, path);
      if (sameFileImage(postWal, expectedAfter)) {
        this.trustworthy = false;
        throw new Error(
          `transaction conflict at ${path}: ambiguous external expected-after state`,
        );
      }
      if (!sameFileImage(postWal, operationBefore)) {
        this.trustworthy = false;
        throw new Error(`transaction conflict at ${path}: target changed after WAL persistence`);
      }
    }
    let mutationError: unknown;
    try {
      await mutate();
    } catch (error) {
      mutationError = error;
    }

    let actual: FileImage;
    try {
      actual = await readFileImage(this.delegate, path);
    } catch (error) {
      this.trustworthy = false;
      throw new Error(
        `transaction verification failed at ${path}: ${(error as Error).message}`,
      );
    }
    if (sameFileImage(actual, operationBefore)) {
      if (authorityPrepared
        && this.journal !== undefined
        && typeof this.journal !== "function") {
        try {
          await this.journal.abort(authority);
          authorityPrepared = false;
        } catch (error) {
          this.trustworthy = false;
          throw error;
        }
      } else if (authorityPrepared) {
        this.trustworthy = false;
      }
      if (mutationError !== undefined) {
        throw mutationError instanceof Error ? mutationError : new Error(String(mutationError));
      }
      throw new Error(`transaction verification failed at ${path}: mutation had no effect`);
    }
    if (!sameFileImage(actual, expectedAfter)) {
      this.trustworthy = false;
      throw new Error(`transaction verification failed at ${path}: untrusted third state`);
    }
    if (authorityPrepared
      && this.journal !== undefined
      && typeof this.journal !== "function") {
      try {
        await this.journal.commit(authority);
      } catch (error) {
        this.trustworthy = false;
        throw error;
      }
    }
    this.recorded.push({ path, before: operationBefore, after: actual });
    if (mutationError !== undefined) {
      throw mutationError instanceof Error ? mutationError : new Error(String(mutationError));
    }
  }

  override async write(path: string, content: string): Promise<void> {
    await this.captureMutation(path, undefined, fileImage(content), () => this.delegate.write(path, content));
  }

  async writeIfCurrent(path: string, before: FileImage, content: string): Promise<void> {
    await this.captureMutation(path, before, fileImage(content), () => this.delegate.write(path, content));
  }

  override async remove(path: string): Promise<void> {
    await this.captureMutation(path, undefined, { exists: false }, () => this.delegate.remove(path));
  }

  async removeIfCurrent(path: string, before: FileImage): Promise<void> {
    await this.captureMutation(path, before, { exists: false }, () => this.delegate.remove(path));
  }
}

export async function rollbackFileMutations(
  vaultTools: VaultTools,
  mutations: FileMutation[],
): Promise<void> {
  let firstError: unknown;
  for (let index = mutations.length - 1; index >= 0; index--) {
    const mutation = mutations[index];
    try {
      const current = await readFileImage(vaultTools, mutation.path);
      if (sameFileImage(current, mutation.before)) continue;
      if (!sameFileImage(current, mutation.after)) {
        throw new Error(`rollback conflict at ${mutation.path}`);
      }
      if (mutation.before.exists) {
        await vaultTools.write(mutation.path, mutation.before.content);
      } else if (await vaultTools.exists(mutation.path)) {
        await vaultTools.remove(mutation.path);
      }
      const restored = await readFileImage(vaultTools, mutation.path);
      if (!sameFileImage(restored, mutation.before)) {
        throw new Error(`rollback verification failed at ${mutation.path}`);
      }
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }
}
