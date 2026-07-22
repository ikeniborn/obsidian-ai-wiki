import assert from "node:assert/strict";
import test from "node:test";
import {
  fileImage,
  rollbackFileMutations,
  TransactionVaultTools,
  type FileMutation,
} from "../src/file-transaction";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

class TransactionAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  noOpWrite = false;
  noOpRemove = false;
  failWriteOnce?: string;
  throwAfterWrite?: { path: string; content: string; error: Error };

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    if (this.failWriteOnce === path) {
      this.failWriteOnce = undefined;
      throw new Error(`synthetic rollback write failure: ${path}`);
    }
    if (this.throwAfterWrite?.path === path) {
      const action = this.throwAfterWrite;
      this.throwAfterWrite = undefined;
      this.files.set(path, action.content);
      throw action.error;
    }
    if (!this.noOpWrite) this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(): Promise<void> {}

  async remove(path: string): Promise<void> {
    if (!this.noOpRemove) this.files.delete(path);
  }
}

test("transaction rejects a no-op write without invalidating rollback authority", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "before");
  adapter.noOpWrite = true;
  const transaction = new TransactionVaultTools(new VaultTools(adapter, ""));

  await assert.rejects(transaction.write("a.md", "after"), /verification failed/i);
  assert.equal(transaction.manifestComplete, true);
  assert.deepEqual(transaction.mutations, []);
  assert.equal(adapter.files.get("a.md"), "before");
});

test("transaction rejects a no-op removal without invalidating rollback authority", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "before");
  adapter.noOpRemove = true;
  const transaction = new TransactionVaultTools(new VaultTools(adapter, ""));

  await assert.rejects(transaction.remove("a.md"), /verification failed/i);
  assert.equal(transaction.manifestComplete, true);
  assert.deepEqual(transaction.mutations, []);
  assert.equal(adapter.files.get("a.md"), "before");
});

test("throw-after-third-state is untrusted and preserves prior trusted rollback authority", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "before-a");
  adapter.files.set("b.md", "before-b");
  const vaultTools = new VaultTools(adapter, "");
  const transaction = new TransactionVaultTools(vaultTools);
  await transaction.remove("a.md");
  adapter.throwAfterWrite = {
    path: "b.md",
    content: "third-state-b",
    error: new Error("synthetic partial write"),
  };

  await assert.rejects(transaction.write("b.md", "expected-b"), /untrusted|verification/i);

  assert.equal(transaction.manifestComplete, false);
  assert.deepEqual(transaction.mutations.map((mutation) => mutation.path), ["a.md"]);
  await rollbackFileMutations(vaultTools, transaction.mutations);
  assert.equal(adapter.files.get("a.md"), "before-a");
  assert.equal(adapter.files.get("b.md"), "third-state-b");
});

test("conditional remove rejects a stale expected before-image without adopting changed bytes", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "planned");
  const transaction = new TransactionVaultTools(new VaultTools(adapter, ""));
  const expected = fileImage("planned");
  adapter.files.set("a.md", "concurrent");

  await assert.rejects(
    (transaction as TransactionVaultTools & {
      removeIfCurrent(path: string, before: ReturnType<typeof fileImage>): Promise<void>;
    }).removeIfCurrent("a.md", expected),
    /transaction conflict/i,
  );

  assert.equal(adapter.files.get("a.md"), "concurrent");
  assert.equal(transaction.manifestComplete, true);
  assert.deepEqual(transaction.mutations, []);
});

test("transaction rejects identical before and after images before WAL persistence", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "same");
  let walCalls = 0;
  const transaction = new TransactionVaultTools(new VaultTools(adapter, ""), async () => {
    walCalls++;
  });

  await assert.rejects(
    transaction.writeIfCurrent("a.md", fileImage("same"), "same"),
    /identical|no-op/i,
  );

  assert.equal(walCalls, 0);
  assert.deepEqual(transaction.mutations, []);
  assert.equal(adapter.files.get("a.md"), "same");
});

test("post-WAL expected-after state is external and never becomes rollback authority", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "planned");
  let delegateWrites = 0;
  const delegate = new VaultTools(adapter, "");
  const originalWrite = delegate.write.bind(delegate);
  delegate.write = async (path, content) => {
    delegateWrites++;
    await originalWrite(path, content);
  };
  const transaction = new TransactionVaultTools(delegate, async () => {
    adapter.files.set("a.md", "desired");
  });

  await assert.rejects(
    transaction.writeIfCurrent("a.md", fileImage("planned"), "desired"),
    /ambiguous|external|conflict/i,
  );

  assert.equal(delegateWrites, 0);
  assert.equal(adapter.files.get("a.md"), "desired");
  assert.deepEqual(transaction.mutations, []);
  assert.equal(transaction.manifestComplete, false);
});

test("ambiguous prepared step rolls back only the prior trusted prefix", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "before-a");
  adapter.files.set("b.md", "before-b");
  let prepared = 0;
  const vaultTools = new VaultTools(adapter, "");
  const transaction = new TransactionVaultTools(vaultTools, async (mutation) => {
    prepared++;
    if (mutation.path === "b.md") adapter.files.set("b.md", "external-b");
  });

  await transaction.removeIfCurrent("a.md", fileImage("before-a"));
  await assert.rejects(
    transaction.writeIfCurrent("b.md", fileImage("before-b"), "external-b"),
    /ambiguous|external|conflict/i,
  );
  await rollbackFileMutations(vaultTools, transaction.mutations);

  assert.equal(prepared, 2);
  assert.deepEqual(transaction.mutations.map((mutation) => mutation.path), ["a.md"]);
  assert.equal(adapter.files.get("a.md"), "before-a");
  assert.equal(adapter.files.get("b.md"), "external-b");
});

test("post-WAL write CAS preserves bytes changed while authority is persisted", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "planned");
  let delegateWrites = 0;
  const delegate = new VaultTools(adapter, "");
  const originalWrite = delegate.write.bind(delegate);
  delegate.write = async (path, content) => {
    delegateWrites++;
    await originalWrite(path, content);
  };
  const transaction = new TransactionVaultTools(delegate, async () => {
    adapter.files.set("a.md", "concurrent");
  });

  await assert.rejects(
    transaction.writeIfCurrent("a.md", fileImage("planned"), "desired"),
    /transaction conflict/i,
  );

  assert.equal(delegateWrites, 0);
  assert.equal(adapter.files.get("a.md"), "concurrent");
  assert.equal(transaction.manifestComplete, false);
  assert.equal(transaction.mutations.length, 0, "ambiguous WAL step is not trusted rollback authority");
});

test("post-WAL remove CAS preserves bytes changed while authority is persisted", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "planned");
  let delegateRemoves = 0;
  const delegate = new VaultTools(adapter, "");
  const originalRemove = delegate.remove.bind(delegate);
  delegate.remove = async (path) => {
    delegateRemoves++;
    await originalRemove(path);
  };
  const transaction = new TransactionVaultTools(delegate, async () => {
    adapter.files.set("a.md", "concurrent");
  });

  await assert.rejects(
    transaction.removeIfCurrent("a.md", fileImage("planned")),
    /transaction conflict/i,
  );

  assert.equal(delegateRemoves, 0);
  assert.equal(adapter.files.get("a.md"), "concurrent");
  assert.equal(transaction.manifestComplete, false);
  assert.equal(transaction.mutations.length, 0, "ambiguous WAL step is not trusted rollback authority");
});

test("rollback is restart-idempotent after one path was already restored", async () => {
  const adapter = new TransactionAdapter();
  adapter.files.set("a.md", "after-a");
  adapter.files.set("b.md", "after-b");
  const vaultTools = new VaultTools(adapter, "");
  const mutations: FileMutation[] = [
    { path: "a.md", before: fileImage("before-a"), after: fileImage("after-a") },
    { path: "b.md", before: fileImage("before-b"), after: fileImage("after-b") },
  ];
  adapter.failWriteOnce = "b.md";

  await assert.rejects(rollbackFileMutations(vaultTools, mutations), /synthetic rollback/);
  assert.equal(adapter.files.get("a.md"), "before-a");
  assert.equal(adapter.files.get("b.md"), "after-b");

  await rollbackFileMutations(vaultTools, mutations);
  assert.equal(adapter.files.get("a.md"), "before-a");
  assert.equal(adapter.files.get("b.md"), "before-b");
});
