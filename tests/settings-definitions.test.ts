import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";

const obsidianModule = `
export class App {}
export class Component {}
export class ItemView {}
export class Modal {}
export class WorkspaceLeaf {}
export class TFile {}
export class TFolder {}
export class ToggleComponent {}
export class Vault {}
export class Plugin {}
export class Setting {}
export class Notice {}
export class AbstractInputSuggest {
  onSelect(callback) { this.callback = callback; }
  setValue() {}
  close() { globalThis.__settingsSuggestCloseCount = (globalThis.__settingsSuggestCloseCount ?? 0) + 1; }
}
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; }
  update() {
    globalThis.__settingsDefinitionUpdateCount = (globalThis.__settingsDefinitionUpdateCount ?? 0) + 1;
    this.getSettingDefinitions();
  }
}
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

/**
 * `SettingDefinitionItem` is a union and only its group and list members carry
 * `type` and `items`, so a bare `definition.type === "group"` check does not
 * narrow it. This predicate does.
 */
function isGroupDefinition(
  definition: SettingDefinitionItem,
): definition is Extract<SettingDefinitionItem, { type: "group" | "list" }> {
  return (definition as { type?: string }).type === "group"
    && Array.isArray((definition as { items?: unknown }).items);
}

/** A group's items may be a definition or a sub-page; only the former renders. */
function isRenderableRow(
  item: SettingGroupItem,
): item is Extract<SettingGroupItem, { render: unknown }> {
  return typeof (item as { render?: unknown }).render === "function";
}



const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

const [{ LlmWikiSettingTab }, { DEFAULT_SETTINGS }] = await Promise.all([
  import("../src/settings"),
  import("../src/types"),
]);

function sourceBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing source marker: ${marker}`);
  const open = source.indexOf("{", start + marker.length - 1);
  assert.notEqual(open, -1, `missing opening brace after: ${marker}`);

  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return source.slice(open + 1, index);
  }

  assert.fail(`missing closing brace after: ${marker}`);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("settings tab exposes concrete indexed Setting Definition groups and rows", () => {
  assert.match(
    settingsSource,
    /import\s+type\s+\{[^}]*SettingDefinitionItem[^}]*\}\s+from\s+"obsidian";/s,
  );
  const definitions = sourceBlock(
    settingsSource,
    "getSettingDefinitions(): SettingDefinitionItem[] {",
  );
  assert.match(definitions, /const definitions: SettingDefinitionItem\[\] = \[\];/);
  assert.match(definitions, /definitions\.push\(\{\s*type: "group",/);
  assert.match(definitions, /render:/, "settings rows must remain individually indexed definitions");
  assert.match(definitions, /return definitions;/);
});

test("settings tab no longer implements or invokes the legacy display lifecycle", () => {
  assert.doesNotMatch(settingsSource, /\bdisplay\(\): void/);
  assert.doesNotMatch(settingsSource, /this\.display\(\)/);
});

test("cached settings state loads asynchronously and refreshes definitions without persistence", () => {
  const constructor = sourceBlock(settingsSource, "constructor(app: App, private plugin: LlmWikiPlugin) {");
  assert.match(constructor, /this\.requestRefresh\(\);/);

  const refresh = sourceBlock(settingsSource, "private async refresh(): Promise<void> {");
  assert.match(refresh, /this\.plugin\.domainStore\.load\(\)/);
  assert.match(refresh, /this\.plugin\.localConfigStore\.load\(\)/);
  assert.match(refresh, /this\.update\(\);/);
  assert.doesNotMatch(refresh, /saveSettings|localConfigStore\.save/);
});

test("every definitions request schedules one deduplicated cache reload without recursive refresh", () => {
  assert.match(settingsSource, /private refreshPromise: Promise<void> \| null = null;/);
  assert.match(settingsSource, /private refreshingDefinitions = false;/);

  const request = sourceBlock(settingsSource, "private requestRefresh(): void {");
  assert.match(request, /if \(this\.refreshingDefinitions \|\| this\.refreshPromise !== null\) return;/);
  assert.match(request, /const refreshPromise = this\.refresh\(\);/);
  assert.match(request, /this\.refreshPromise = refreshPromise;/);
  assert.match(request, /refreshPromise\.then\(finish, finish\)/);
  assert.match(request, /this\.refreshPromise = null;/);
  assert.doesNotMatch(request, /saveSettings|localConfigStore\.save/);

  const definitions = sourceBlock(
    settingsSource,
    "getSettingDefinitions(): SettingDefinitionItem[] {",
  );
  assert.match(definitions, /^\s*this\.requestRefresh\(\);/);

  const refresh = sourceBlock(settingsSource, "private async refresh(): Promise<void> {");
  assert.match(refresh, /this\.refreshingDefinitions = true;/);
  assert.match(refresh, /try \{\s*this\.update\(\);\s*\} finally \{\s*this\.refreshingDefinitions = false;/);
});

test("repeated definitions requests reload changed domains once and never persist", async () => {
  const globals = globalThis as unknown as { __settingsDefinitionUpdateCount?: number };
  globals.__settingsDefinitionUpdateCount = 0;
  let domainLoads = 0;
  let localLoads = 0;
  let writes = 0;
  let domains: Array<{ id: string; name: string; wiki_folder: string }> = [];
  const plugin = {
    app: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    controller: { running: false },
    domainStore: {
      load: async () => { domainLoads++; return structuredClone(domains); },
      save: async () => { writes++; },
    },
    localConfigStore: {
      load: async () => { localLoads++; return {}; },
      save: async () => { writes++; },
    },
    saveSettings: async () => { writes++; },
  };
  const tab = new LlmWikiSettingTab(plugin.app as never, plugin as never);
  const pendingRefresh = (): Promise<void> | null =>
    (tab as unknown as { refreshPromise: Promise<void> | null }).refreshPromise;

  const initialRefresh = pendingRefresh();
  assert.ok(initialRefresh);
  await initialRefresh;
  assert.equal(domainLoads, 1);
  assert.equal(localLoads, 1);
  assert.equal(globals.__settingsDefinitionUpdateCount, 1, "initial caches must render once");

  domains = [{ id: "fresh", name: "Fresh domain", wiki_folder: "fresh" }];
  tab.getSettingDefinitions();
  const reload = pendingRefresh();
  assert.ok(reload);
  tab.getSettingDefinitions();
  assert.equal(domainLoads, 2, "second request must share the in-flight reload");
  assert.equal(localLoads, 1, "local reload begins only after the shared domain load settles");
  await reload;
  assert.equal(localLoads, 2);
  assert.equal(globals.__settingsDefinitionUpdateCount, 2, "changed domains must update once");

  const refreshedDefinitions = tab.getSettingDefinitions();
  const refreshedNames = refreshedDefinitions.flatMap((definition) =>
    isGroupDefinition(definition) ? (definition.items ?? []).map((item) => item.name) : [],
  );
  assert.ok(refreshedNames.includes("Fresh domain"));
  assert.equal(domainLoads, 3, "a later host request schedules the next reload");
  assert.equal(writes, 0);
  await pendingRefresh();
  assert.equal(
    globals.__settingsDefinitionUpdateCount,
    2,
    "an unchanged delayed reload must not tear down the current controls",
  );
});

test("overlapping local saves prevent stale refresh snapshots from replacing live credentials", async () => {
  type LocalSnapshot = { nativeAgent?: { apiKey: string } };
  type Gate = {
    started: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<void>>;
  };
  const globals = globalThis as unknown as { __settingsDefinitionUpdateCount?: number };
  globals.__settingsDefinitionUpdateCount = 0;
  let persisted: LocalSnapshot = { nativeAgent: { apiKey: "old" } };
  let nextLoad: Gate | null = null;
  let nextSave: Gate | null = null;
  let saves = 0;
  const plugin = {
    app: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    controller: { running: false },
    domainStore: { load: async () => [], save: async () => {} },
    localConfigStore: {
      load: async (): Promise<LocalSnapshot> => {
        const snapshot = structuredClone(persisted);
        const gate = nextLoad;
        nextLoad = null;
        if (gate) {
          gate.started.resolve();
          await gate.release.promise;
        }
        return snapshot;
      },
      save: async (patch: Partial<LocalSnapshot>): Promise<void> => {
        saves++;
        const gate = nextSave;
        nextSave = null;
        if (gate) {
          gate.started.resolve();
          await gate.release.promise;
        }
        persisted = { ...persisted, ...patch };
      },
    },
    saveSettings: async () => {},
  };
  const tab = new LlmWikiSettingTab(plugin.app as never, plugin as never);
  const internals = tab as unknown as {
    refreshPromise: Promise<void> | null;
    localCache: LocalSnapshot;
    patchLocal(patch: Partial<LocalSnapshot>): Promise<void>;
  };
  await internals.refreshPromise;
  assert.equal(globals.__settingsDefinitionUpdateCount, 1);

  const staleLoad = { started: deferred<void>(), release: deferred<void>() };
  nextLoad = staleLoad;
  tab.getSettingDefinitions();
  const firstRefresh = internals.refreshPromise;
  assert.ok(firstRefresh);
  await staleLoad.started.promise;

  const pendingSave = { started: deferred<void>(), release: deferred<void>() };
  nextSave = pendingSave;
  const firstPatch = internals.patchLocal({ nativeAgent: { apiKey: "fresh" } });
  await pendingSave.started.promise;
  staleLoad.release.resolve();
  await firstRefresh;
  assert.equal(internals.localCache.nativeAgent?.apiKey, "fresh");
  assert.equal(globals.__settingsDefinitionUpdateCount, 1, "stale snapshot must not update definitions");
  pendingSave.release.resolve();
  await firstPatch;

  const alreadyPendingSave = { started: deferred<void>(), release: deferred<void>() };
  nextSave = alreadyPendingSave;
  const secondPatch = internals.patchLocal({ nativeAgent: { apiKey: "newer" } });
  await alreadyPendingSave.started.promise;

  const secondStaleLoad = { started: deferred<void>(), release: deferred<void>() };
  nextLoad = secondStaleLoad;
  tab.getSettingDefinitions();
  const secondRefresh = internals.refreshPromise;
  assert.ok(secondRefresh);
  await secondStaleLoad.started.promise;
  alreadyPendingSave.release.resolve();
  await secondPatch;
  secondStaleLoad.release.resolve();
  await secondRefresh;

  assert.equal(internals.localCache.nativeAgent?.apiKey, "newer");
  assert.equal(globals.__settingsDefinitionUpdateCount, 1, "pending-at-start save must block stale update");
  assert.equal(saves, 2);
});

test("model suggesters close when their declarative rows are torn down", () => {
  assert.match(
    settingsSource,
    /private addModelControl\([\s\S]*?\n\s*\): \(\) => void \{/,
  );
  const controlStart = settingsSource.indexOf("private addModelControl(");
  const controlEnd = settingsSource.indexOf("\n  getSettingDefinitions", controlStart);
  assert.notEqual(controlStart, -1);
  assert.notEqual(controlEnd, -1);
  const control = settingsSource.slice(controlStart, controlEnd);
  assert.match(control, /let suggest: ModelInputSuggest \| null = null;/);
  assert.match(control, /suggest = new ModelInputSuggest\(/);
  assert.match(control, /return \(\) => \{ suggest\?\.close\(\); \};/);

  const definitions = sourceBlock(
    settingsSource,
    "getSettingDefinitions(): SettingDefinitionItem[] {",
  );
  assert.match(
    definitions,
    /render\?: \(setting: Setting, group: SettingGroup\) => void \| \(\(\) => void\)/,
  );
  assert.match(definitions, /render: \(setting, group\) => render\(setting, group\)/);
  assert.equal(
    definitions.match(/return this\.addModelControl\(/g)?.length ?? 0,
    5,
    "every model-control definition must forward its cleanup",
  );
});

test("model definition teardown closes its live suggester", async () => {
  const plugin = {
    app: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    controller: { running: false },
    domainStore: { load: async () => [], save: async () => {} },
    localConfigStore: { load: async () => ({}), save: async () => {} },
    saveSettings: async () => {},
  };
  const tab = new LlmWikiSettingTab(plugin.app as never, plugin as never);
  const pendingRefresh = (): Promise<void> | null =>
    (tab as unknown as { refreshPromise: Promise<void> | null }).refreshPromise;
  await pendingRefresh();

  const definitions = tab.getSettingDefinitions();
  const modelRow = definitions
    .flatMap((definition) => isGroupDefinition(definition) ? definition.items ?? [] : [])
    .filter(isRenderableRow)
    .find((item) => item.name === "Model");
  assert.ok(modelRow?.render);

  const button = {
    setButtonText() { return this; },
    setTooltip() { return this; },
    setIcon() { return this; },
    onClick() { return this; },
  };
  const text = {
    inputEl: { addEventListener() {} },
    setPlaceholder() { return this; },
    setValue() { return this; },
    onChange() { return this; },
  };
  const setting = {
    addButton(callback: (component: typeof button) => void) { callback(button); return this; },
    addText(callback: (component: typeof text) => void) { callback(text); return this; },
  };
  const globals = globalThis as unknown as { __settingsSuggestCloseCount?: number };
  globals.__settingsSuggestCloseCount = 0;
  const cleanup = modelRow.render(setting as never, {} as never);
  assert.equal(typeof cleanup, "function");
  cleanup?.();
  assert.equal(globals.__settingsSuggestCloseCount, 1);
  await pendingRefresh();
});

test("plugin busy-state refresh uses the supported update lifecycle", () => {
  assert.match(mainSource, /this\.controller\.onBusyChange = \(\) => this\.settingTab\?\.update\(\);/);
  assert.doesNotMatch(mainSource, /this\.settingTab\?\.display\(\)/);
});

test("project pins the Obsidian API version consistently", () => {
  assert.equal(packageJson.devDependencies.obsidian, "1.13.1");
  assert.equal(packageLock.packages["node_modules/obsidian"].version, "1.13.1");
});
