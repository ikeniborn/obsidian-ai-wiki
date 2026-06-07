export interface VaultAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  remove?(path: string): Promise<void>;
  rmdir?(path: string, recursive: boolean): Promise<void>;
  readBinary?(path: string): Promise<ArrayBuffer>;
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
  /** Resolve an Obsidian wiki-link to a vault-relative path; null if not found. */
  resolveLink?(linkpath: string, sourcePath: string): string | null;
  /** Render an Excalidraw file (by resolved vault path) to a base64 PNG; null if unavailable. */
  renderExcalidrawPng?(resolvedPath: string): Promise<string | null>;
}

export interface VaultIndexer {
  getAbstractFileByPath(path: string): { path: string } | null;
  create(path: string, content: string): Promise<{ path: string }>;
  modify(file: { path: string }, content: string): Promise<void>;
}

export class VaultTools {
  constructor(
    public readonly adapter: VaultAdapter,
    private basePath: string,
    public readonly vault?: VaultIndexer,
  ) {}

  get vaultRoot(): string {
    return this.basePath;
  }

  async read(vaultPath: string): Promise<string> {
    return this.adapter.read(vaultPath);
  }

  async write(vaultPath: string, content: string): Promise<void> {
    const segments = vaultPath.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    if (this.vault) {
      const indexed = this.vault.getAbstractFileByPath(vaultPath);
      if (indexed) {
        await this.vault.modify(indexed, content);
      } else {
        try {
          await this.vault.create(vaultPath, content);
        } catch {
          // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
          await this.adapter.write(vaultPath, content);
        }
      }
    } else {
      await this.adapter.write(vaultPath, content);
    }
  }

  async listFiles(vaultDir: string): Promise<string[]> {
    const exists = await this.adapter.exists(vaultDir);
    if (!exists) return [];
    return this._listRecursive(vaultDir);
  }

  private async _listRecursive(vaultDir: string): Promise<string[]> {
    const result = await this.adapter.list(vaultDir);
    const deeper = await Promise.all(result.folders.map((f) => this._listRecursive(f)));
    return [...result.files, ...deeper.flat()];
  }

  async readAll(paths: string[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
      paths.map(async (p) => {
        try {
          return [p, await this.read(p)] as const;
        } catch {
          return null;
        }
      }),
    );
    return new Map(entries.filter((e): e is [string, string] => e !== null));
  }

  async exists(vaultPath: string): Promise<boolean> {
    return this.adapter.exists(vaultPath);
  }

  async readBinary(vaultPath: string): Promise<ArrayBuffer> {
    if (!this.adapter.readBinary) throw new Error("readBinary not supported by this adapter");
    return this.adapter.readBinary(vaultPath);
  }

  async writeBinary(vaultPath: string, data: ArrayBuffer): Promise<void> {
    if (!this.adapter.writeBinary) throw new Error("writeBinary not supported by this adapter");
    const segments = vaultPath.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    await this.adapter.writeBinary(vaultPath, data);
  }

  /**
   * Resolve an Obsidian wiki-link to a vault-relative path. Returns null when the
   * adapter cannot resolve it: falling back to the raw linkpath would let an
   * unresolved embed like `![[../../secret.png]]` reach read/readBinary, which on
   * desktop escapes the vault root via path.join. Callers must skip on null.
   */
  resolveLink(linkpath: string, sourcePath: string): string | null {
    return this.adapter.resolveLink?.(linkpath, sourcePath) ?? null;
  }

  /**
   * Render an Excalidraw file to a base64 PNG via the host plugin (wired in
   * controller). Returns null when no renderer is available (no host plugin,
   * mobile, or render error) — callers treat null as "Vision skipped".
   */
  async renderExcalidrawPng(resolvedPath: string): Promise<string | null> {
    return (await this.adapter.renderExcalidrawPng?.(resolvedPath)) ?? null;
  }

  async mkdir(vaultPath: string): Promise<void> {
    return this.adapter.mkdir(vaultPath);
  }

  async remove(vaultPath: string): Promise<void> {
    await this.adapter.remove?.(vaultPath);
  }

  async removeSubfolders(vaultDir: string): Promise<void> {
    const exists = await this.adapter.exists(vaultDir);
    if (!exists) return;
    const { folders } = await this.adapter.list(vaultDir);
    for (const folder of folders) {
      try { await this.adapter.rmdir?.(folder, true); } catch { /* skip locked */ }
    }
  }

  toVaultPath(absolutePath: string): string | null {
    const base = this.basePath.endsWith("/") ? this.basePath : this.basePath + "/";
    if (!absolutePath.startsWith(base)) return null;
    return absolutePath.slice(base.length);
  }
}
