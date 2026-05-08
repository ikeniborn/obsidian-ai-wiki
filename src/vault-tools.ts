export interface VaultAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

export class VaultTools {
  constructor(
    public readonly adapter: VaultAdapter,
    private basePath: string,
  ) {}

  get vaultRoot(): string {
    return this.basePath;
  }

  async read(vaultPath: string): Promise<string> {
    return this.adapter.read(vaultPath);
  }

  async write(vaultPath: string, content: string): Promise<void> {
    const dir = vaultPath.split("/").slice(0, -1).join("/");
    if (dir) {
      const dirExists = await this.adapter.exists(dir);
      if (!dirExists) await this.adapter.mkdir(dir);
    }
    await this.adapter.write(vaultPath, content);
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

  toVaultPath(absolutePath: string): string | null {
    const base = this.basePath.endsWith("/") ? this.basePath : this.basePath + "/";
    if (!absolutePath.startsWith(base)) return null;
    return absolutePath.slice(base.length);
  }
}
