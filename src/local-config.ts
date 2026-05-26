import type { Plugin } from "obsidian";

export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
  noProxy?: string;
}

export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    embeddingModel?: string;
    embeddingDimensions?: number;
    relevantPagesTopK?: number;
  };
  proxy?: ProxyConfig;
  migrated_v1?: boolean;
  shellConsentGiven?: boolean;
  lastDomain?: string;
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
      const parsed = JSON.parse(raw) as Partial<LocalConfig> & { nativeAgent?: Record<string, unknown> };
      if (parsed.nativeAgent && "numCtx" in parsed.nativeAgent) {
        const na = { ...parsed.nativeAgent };
        delete na.numCtx;
        parsed.nativeAgent = na as LocalConfig["nativeAgent"];
      }
      this.cache = { ...DEFAULTS, ...parsed };
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
