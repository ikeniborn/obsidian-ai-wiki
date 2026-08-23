import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") {
    return { url: "node:path", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const obsidianModule = `
export class App {}
export class Component {}
export class ItemView {}
export class Modal {}
export class WorkspaceLeaf {}
export class TFile {}
export class TFolder {}
export class AbstractInputSuggest {}
export class DropdownComponent {}
export class PluginSettingTab {}
export class Setting {}
export class ToggleComponent {}
export class Plugin {}
export class Notice {}
export const MarkdownRenderer = { render: async () => {} };
export const Platform = { isDesktopApp: true, isMobile: false };
export const moment = { locale: () => "en" };
export const requestUrl = async () => { throw new Error("requestUrl unavailable in test"); };
export const setIcon = () => {};
`;
const obsidianUrl = `data:text/javascript,${encodeURIComponent(obsidianModule)}`;
const obsidianLoader = `
const moduleUrl = ${JSON.stringify(obsidianUrl)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "obsidian") return { url: moduleUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(obsidianLoader)}`);

const [{ default: LlmWikiPlugin, migrateToLocalV2 }, { LocalConfigStore }, { hydrateSettings }] =
  await Promise.all([
    import("../src/main"),
    import("../src/local-config"),
    import("../src/settings-persistence"),
  ]);

test("legacy Claude fields do not cause a write during plugin load", async () => {
  let writes = 0;
  const plugin = Object.create(LlmWikiPlugin.prototype) as InstanceType<typeof LlmWikiPlugin> & {
    loadData(): Promise<unknown>;
    saveData(value: unknown): Promise<void>;
  };
  plugin.loadData = async () => ({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet", allowedTools: "Read" },
    nativeAgent: {
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      model: "gpt-compatible",
      maxTokens: 4_096,
      operations: {
        format: { model: "gpt-compatible", temperature: 0.2, maxTokens: 4_096 },
      },
    },
  });
  plugin.saveData = async () => { writes++; };

  await plugin.loadSettings();

  assert.equal(writes, 0);
  assert.equal(plugin.settings.nativeAgent.baseUrl, "https://llm.example/v1");
  assert.equal(plugin.settings.nativeAgent.apiKey, "test-key");
  assert.equal(plugin.settings.nativeAgent.model, "gpt-compatible");
  assert.equal(plugin.settings.nativeAgent.maxTokens, 4_096);
  assert.equal(plugin.settings.nativeAgent.operations.format.maxTokens, 4_096);
  assert.equal("backend" in plugin.settings, false);
  assert.equal("claudeAgent" in plugin.settings, false);
});

test("local v2 startup migration preserves all supported sanitized local state", async () => {
  const pluginDir = ".obsidian/plugins/ai-wiki";
  const localPath = `${pluginDir}/local.json`;
  const modelContext = {
    "https://llm.example/v1::model": {
      contextWindow: 32_768,
      source: "configured",
      calibration: 1,
      samples: 0,
    },
  };
  let localJson = JSON.stringify({
    iclaudePath: "/usr/bin/claude",
    backend: "claude-agent",
    claudeAgent: { model: "sonnet" },
    shellConsentGiven: true,
    agentLogEnabled: true,
    nativeAgent: {
      apiKey: "secret",
      baseUrl: "https://llm.example/v1",
      model: "gpt-compatible",
      temperature: 0.4,
    },
    proxy: {
      password: "proxy-secret",
      enabled: true,
      url: "https://proxy.example",
      username: "proxy-user",
      noProxy: "localhost",
    },
    migrated_v1: false,
    migrated_v2: false,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: true,
    migrated_auto_budget: true,
    lastDomain: "work",
    modelContext,
    unknownFutureField: "ignored",
  });
  const writes: string[] = [];
  const adapter = {
    exists: async (path: string) => path === localPath,
    read: async () => localJson,
    write: async (_path: string, value: string) => {
      writes.push(value);
      localJson = value;
    },
  };
  let settingsWrites = 0;
  const plugin = {
    manifest: { dir: pluginDir },
    app: { vault: { adapter } },
    settings: hydrateSettings({}),
    saveSettings: async () => { settingsWrites++; },
  } as unknown as Parameters<typeof migrateToLocalV2>[0];
  const store = new LocalConfigStore(plugin);

  await migrateToLocalV2(plugin, store);

  assert.equal(settingsWrites, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(localJson), {
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret" },
    proxy: { password: "proxy-secret" },
    migrated_v1: true,
    migrated_v2: true,
    migrated_drop_sections: true,
    migrated_okf_frontmatter: true,
    migrated_auto_budget: true,
    lastDomain: "work",
    modelContext,
  });
  assert.equal(plugin.settings.nativeAgent.baseUrl, "https://llm.example/v1");
  assert.equal(plugin.settings.nativeAgent.model, "gpt-compatible");
  assert.equal(plugin.settings.nativeAgent.temperature, 0.4);
  assert.deepEqual(plugin.settings.proxy, {
    enabled: true,
    url: "https://proxy.example",
    username: "proxy-user",
    noProxy: "localhost",
  });
});
