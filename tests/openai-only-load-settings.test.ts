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

const { default: LlmWikiPlugin } = await import("../src/main");

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
