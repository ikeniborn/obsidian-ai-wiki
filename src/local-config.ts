import type { Plugin } from "obsidian";
import type { ContextWindowSource } from "./types";
export type { ProxyConfig } from "./proxy";

export interface LocalConfig {
  agentLogEnabled?: boolean;
  nativeAgent?: { apiKey: string };
  proxy?: { password?: string };
  migrated_v1?: boolean;
  migrated_v2?: boolean;
  migrated_drop_sections?: boolean;
  migrated_okf_frontmatter?: boolean;
  lastDomain?: string;
  migrated_auto_budget?: boolean;
  /** Keyed by `${baseUrl}::${model}`. */
  modelContext?: Record<string, {
    contextWindow: number;
    source: ContextWindowSource;
    calibration: number;
    samples: number;
    expiresAt?: number;
  }>;
}

const DEFAULTS: LocalConfig = {};

export function sanitizeLocalConfig(value: unknown): LocalConfig {
  const raw = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result: LocalConfig = {};
  if (typeof raw.agentLogEnabled === "boolean") result.agentLogEnabled = raw.agentLogEnabled;
  if (raw.nativeAgent !== null && typeof raw.nativeAgent === "object" && !Array.isArray(raw.nativeAgent)) {
    const apiKey = (raw.nativeAgent as { apiKey?: unknown }).apiKey;
    if (typeof apiKey === "string") result.nativeAgent = { apiKey };
  }
  if (raw.proxy !== null && typeof raw.proxy === "object" && !Array.isArray(raw.proxy)) {
    const password = (raw.proxy as { password?: unknown }).password;
    if (typeof password === "string") result.proxy = { password };
  }
  for (const key of [
    "migrated_v1",
    "migrated_v2",
    "migrated_drop_sections",
    "migrated_okf_frontmatter",
    "migrated_auto_budget",
  ] as const) {
    if (typeof raw[key] === "boolean") result[key] = raw[key];
  }
  if (typeof raw.lastDomain === "string") result.lastDomain = raw.lastDomain;
  if (raw.modelContext !== null && typeof raw.modelContext === "object" && !Array.isArray(raw.modelContext)) {
    result.modelContext = raw.modelContext as NonNullable<LocalConfig["modelContext"]>;
  }
  return result;
}

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
      const parsed: unknown = JSON.parse(raw);
      this.cache = sanitizeLocalConfig(parsed);
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
