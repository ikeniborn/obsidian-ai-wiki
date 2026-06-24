export interface VaultAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** File stat; `mtime` is epoch ms. Resolves null when the path has no stat. */
  stat?(path: string): Promise<{ mtime: number } | null>;
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

/**
 * Hex codepoints of a filename, e.g. "U+304B U+3099". Distinguishes
 * decomposable scripts (kana / Hangul / accented Latin, where NFC != NFD)
 * from pure Han ideographs (NFC == NFD, so normalization is not the cause).
 */
function codePointsHex(name: string): string {
  return Array.from(name)
    .map((ch) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
    .join(" ");
}

/**
 * True when an error means "file not found". The Obsidian adapter does not
 * always set `e.code`, so fall back to matching the message text.
 */
function isNotFound(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  if (err?.code === "ENOENT") return true;
  return /ENOENT|no such file|not exist/i.test(String(err?.message ?? ""));
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
    try {
      return await this.adapter.read(vaultPath); // hot path — no overhead on success
    } catch (e) {
      if (!isNotFound(e)) throw e; // perms / IO → surface the original error immediately
      await this.diagnose(vaultPath);
      const resolved = await this.resolveOnDiskPath(vaultPath);
      if (resolved !== vaultPath) {
        const data = await this.adapter.read(resolved);
        const formLabel = resolved === vaultPath.normalize("NFD") ? "NFD" : "NFC";
        console.warn(`[ai-wiki] read recovered (${formLabel}): ${vaultPath}`);
        return data;
      }
      throw e; // no form matched → re-throw original so caller semantics are preserved
    }
  }

  async write(vaultPath: string, content: string): Promise<void> {
    // Overwrite an existing file in its on-disk normalization form instead of
    // creating a duplicate in the caller's form. New files keep vaultPath as-is.
    const target = await this.resolveOnDiskPath(vaultPath);
    const segments = target.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try { exists = await this.adapter.exists(partial); } catch { /* treat as missing */ }
      if (!exists) {
        try { await this.adapter.mkdir(partial); } catch { /* already exists or race */ }
      }
    }
    if (this.vault) {
      const indexed = this.vault.getAbstractFileByPath(target);
      if (indexed) {
        await this.vault.modify(indexed, content);
      } else {
        try {
          await this.vault.create(target, content);
        } catch {
          // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
          await this.adapter.write(target, content);
        }
      }
    } else {
      await this.adapter.write(target, content);
    }
  }

  /**
   * Return the path form that actually exists on disk (the input, its NFC, or
   * its NFD form), or the input unchanged for a genuinely new file. ASCII paths
   * normalize to themselves, so both retry branches are skipped — zero effect
   * on the common case. Used by both read (recovery) and write (guard).
   */
  private async resolveOnDiskPath(vaultPath: string): Promise<string> {
    if (await this.adapter.exists(vaultPath)) return vaultPath;
    const nfc = vaultPath.normalize("NFC");
    if (nfc !== vaultPath && (await this.adapter.exists(nfc))) return nfc;
    const nfd = vaultPath.normalize("NFD");
    if (nfd !== vaultPath && (await this.adapter.exists(nfd))) return nfd;
    return vaultPath;
  }

  /**
   * Emit one compact console.warn explaining a read miss: filename codepoints,
   * whether the name is decomposable, per-form existence, and the actual parent
   * dirents (capped at 20). Enough to confirm the cause from a single repro.
   */
  private async diagnose(vaultPath: string): Promise<void> {
    const name = vaultPath.split("/").pop() ?? vaultPath;
    const nfc = vaultPath.normalize("NFC");
    const nfd = vaultPath.normalize("NFD");
    const probe = async (p: string): Promise<string> => {
      try { return (await this.adapter.exists(p)) ? "OK" : "ENOENT"; }
      catch { return "ERR"; }
    };
    const nfcResult = await probe(nfc);
    const nfdResult = await probe(nfd);
    let dirents = "n/a";
    try {
      const parent = vaultPath.split("/").slice(0, -1).join("/");
      const { files } = await this.adapter.list(parent);
      dirents = JSON.stringify(files.map((f) => f.split("/").pop()).slice(0, 20));
    } catch { /* parent may be absent — leave "n/a" */ }
    console.warn(
      `[ai-wiki] read miss: ${JSON.stringify(vaultPath)}\n` +
        `  filename codepoints: ${codePointsHex(name)}\n` +
        `  nfc!=nfd: ${nfc !== nfd}\n` +
        `  forms: NFC→${nfcResult} NFD→${nfdResult}\n` +
        `  parent dirents: ${dirents}`,
    );
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

  /** Modification time in epoch ms, or null when unavailable (missing file or no stat support). */
  async mtime(vaultPath: string): Promise<number | null> {
    if (!this.adapter.stat) return null;
    const s = await this.adapter.stat(vaultPath);
    return s ? s.mtime : null;
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
