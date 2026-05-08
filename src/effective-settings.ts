import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig } from "./local-config";

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): LlmWikiPluginSettings {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...(l.claudeAgent ?? {}) },
    nativeAgent: { ...s.nativeAgent, ...(l.nativeAgent ?? {}) },
  };
}
