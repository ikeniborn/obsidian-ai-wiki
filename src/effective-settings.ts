import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig, ProxyConfig } from "./local-config";

export type EffectiveSettings = LlmWikiPluginSettings & { proxy: ProxyConfig };

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): EffectiveSettings {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...(l.claudeAgent ?? {}) },
    nativeAgent: { ...s.nativeAgent, ...(l.nativeAgent ?? {}) },
    proxy: l.proxy ?? { enabled: false, url: "" },
  };
}
