import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig, ProxyConfig } from "./local-config";

export type EffectiveSettings = LlmWikiPluginSettings & { proxy: ProxyConfig };

export function resolveEffective(
  settings: LlmWikiPluginSettings,
  local: LocalConfig,
): EffectiveSettings {
  const proxyBase = settings.proxy ?? { enabled: false, url: "" };
  return {
    ...settings,
    agentLogEnabled: local.agentLogEnabled ?? settings.agentLogEnabled,
    nativeAgent: {
      ...settings.nativeAgent,
      apiKey: local.nativeAgent?.apiKey ?? settings.nativeAgent.apiKey,
    },
    proxy: { ...proxyBase, password: local.proxy?.password },
  };
}
