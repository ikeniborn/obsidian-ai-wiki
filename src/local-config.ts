import type { Plugin } from "obsidian";

export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
  };
  migrated_v1?: boolean;
}

const DEFAULTS: LocalConfig = { iclaudePath: "" };

export class LocalConfigStore {
  private cache: LocalConfig | null = null;

  constructor(private plugin: Plugin) {}

  private path(): string {
    const dir = this.plugin.manifest.dir;
    if (!dir) throw new Error("LocalConfigStore: plugin manifest.dir is undefined");
    return `${dir}/local.json`;
  }

  async load(): Promise<LocalConfig> {
    if (this.cache) return this.cache;
    const adapter = this.plugin.app.vault.adapter;
    const p = this.path();
    if (!(await adapter.exists(p))) {
      this.cache = { ...DEFAULTS };
      return this.cache;
    }
    try {
      const raw = await adapter.read(p);
      this.cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalConfig>) };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }

  async save(patch: Partial<LocalConfig>): Promise<void> {
    const cur = await this.load();
    const next = { ...cur, ...patch };
    await this.plugin.app.vault.adapter.write(this.path(), JSON.stringify(next, null, 2));
    this.cache = next;
  }
}
