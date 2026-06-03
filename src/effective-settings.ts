import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig, ProxyConfig } from "./local-config";

export type EffectiveSettings = LlmWikiPluginSettings & { proxy: ProxyConfig };

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): EffectiveSettings {
  const proxyBase = s.proxy ?? { enabled: false, url: "" };
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    nativeAgent: { ...s.nativeAgent, apiKey: l.nativeAgent?.apiKey ?? s.nativeAgent.apiKey },
    proxy: { ...proxyBase, password: l.proxy?.password },
  };
}
