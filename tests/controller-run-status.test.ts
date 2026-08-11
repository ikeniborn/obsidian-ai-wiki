import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { RunEvent, RunHistoryEntry, WikiOperation } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

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

const [{ WikiController }, { graphCache }] = await Promise.all([
  import("../src/controller"),
  import("../src/wiki-graph-cache"),
]);

type FakeView = {
  events: RunEvent[];
  entries: RunHistoryEntry[];
  setRunning(operation: WikiOperation, args: string[]): void;
  appendEvent(event: RunEvent): void;
  finish(entry: RunHistoryEntry): Promise<void>;
};

type DispatchController = {
  dispatch(
    operation: WikiOperation,
    args: string[],
    domainId?: string,
  ): Promise<void>;
  ensureView(): Promise<void>;
  activeView(): FakeView;
  buildAgentRunner(): Promise<{
    run(): AsyncGenerator<RunEvent, void, void>;
  }>;
  logEvent(
    vaultRoot: string,
    sessionId: string,
    operation: WikiOperation,
    domainId: string | undefined,
    event: RunEvent,
  ): Promise<void>;
};

function controllerFixture(
  events: () => AsyncGenerator<RunEvent, void, void>,
  options: { loadDomains?: () => Promise<unknown[]> } = {},
): {
  controller: DispatchController;
  view: FakeView;
  loggedEvents: RunEvent[];
  settings: typeof DEFAULT_SETTINGS;
} {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.history = [];
  settings.timeouts = { ...settings.timeouts, init: 0, query: 0 };
  const plugin = {
    settings,
    manifest: {
      id: "obsidian-ai-wiki",
      dir: ".obsidian/plugins/obsidian-ai-wiki",
    },
    saveSettings: async () => {},
  };
  const app = {
    vault: {
      adapter: {
        getBasePath: () => "/vault",
      },
      configDir: ".obsidian",
    },
  };
  const view: FakeView = {
    events: [],
    entries: [],
    setRunning: () => {},
    appendEvent(event) { this.events.push(event); },
    async finish(entry) { this.entries.push(entry); },
  };
  const loggedEvents: RunEvent[] = [];
  const controller = new WikiController(
    app as never,
    plugin as never,
    { load: options.loadDomains ?? (async () => [{ id: "demo" }]) } as never,
    { load: async () => ({}) } as never,
  ) as unknown as DispatchController;
  controller.ensureView = async () => {};
  controller.activeView = () => view;
  controller.buildAgentRunner = async () => ({ run: events });
  controller.logEvent = async (_root, _session, _operation, _domainId, event) => {
    loggedEvents.push(event);
  };
  return { controller, view, loggedEvents, settings };
}

async function* events(...values: RunEvent[]): AsyncGenerator<RunEvent, void, void> {
  for (const value of values) yield value;
}

test("mutating operation invalidates graph cache after a partial error outcome", async () => {
  const invalidated: string[] = [];
  const originalInvalidate = graphCache.invalidate;
  graphCache.invalidate = (domainId) => { invalidated.push(domainId); };
  try {
    const init = controllerFixture(() => events(
      { kind: "file_outcome", file: "a.md", status: "done" },
      { kind: "file_outcome", file: "b.md", status: "skipped" },
    ));
    await init.controller.dispatch("init", [], "demo");

    assert.equal(init.view.entries[0]?.status, "error");
    assert.deepEqual(invalidated, ["demo"]);

    invalidated.length = 0;
    const query = controllerFixture(() => events(
      { kind: "error", message: "synthetic query failure" },
    ));
    await query.controller.dispatch("query", ["question"], "demo");
    assert.deepEqual(invalidated, []);
  } finally {
    graphCache.invalidate = originalInvalidate;
  }
});

test("zero-mutation init failure preserves its outcome without cache lookup", async () => {
  let domainLoads = 0;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const fixture = controllerFixture(async function* () {
      throw new Error("primary operation failure");
    }, {
      loadDomains: async () => {
        domainLoads++;
        throw new Error("cache lookup failure");
      },
    });

    await assert.doesNotReject(
      fixture.controller.dispatch("init", []),
    );

    assert.equal(domainLoads, 0);
    assert.equal(fixture.view.entries[0]?.status, "error");
    assert.match(fixture.view.entries[0]?.finalText ?? "", /primary operation failure/);
    assert.equal(
      fixture.loggedEvents.some((event) =>
        event.kind === "error" && event.message.includes("primary operation failure")),
      true,
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("cache cleanup failure cannot mask a partial mutation outcome", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const fixture = controllerFixture(() => events(
      { kind: "file_outcome", file: "a.md", status: "done" },
      { kind: "file_outcome", file: "b.md", status: "skipped" },
    ), {
      loadDomains: async () => { throw new Error("cache cleanup failure"); },
    });

    await assert.doesNotReject(
      fixture.controller.dispatch("init", []),
    );
    assert.equal(fixture.view.entries.length, 1);
    assert.equal(fixture.view.entries[0]?.status, "error");
  } finally {
    console.error = originalConsoleError;
  }
});

test("timeout owns presentation when generator throws after abort", async () => {
  let fireTimeout: (() => void) | undefined;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void) {
        fireTimeout = callback;
        return 1;
      },
      clearTimeout() {},
    },
  });
  try {
    const fixture = controllerFixture(async function* () {
      yield { kind: "result", durationMs: 1, text: "intermediate result" };
      assert.ok(fireTimeout);
      fireTimeout();
      throw new DOMException("backend abort", "AbortError");
    });
    fixture.settings.timeouts.init = 1;

    await fixture.controller.dispatch("init", [], "demo");

    const entry = fixture.view.entries[0];
    assert.equal(entry?.status, "error");
    assert.match(entry?.finalText ?? "", /^Timeout after 1s/);
    const visibleErrors = fixture.view.events.filter((event) => event.kind === "error");
    assert.equal(visibleErrors.length, 1);
    assert.match(visibleErrors[0]?.message ?? "", /^Timeout after 1s/);
    const loggedErrors = fixture.loggedEvents.filter((event) => event.kind === "error");
    assert.equal(loggedErrors.length, 1);
    assert.match(loggedErrors[0]?.message ?? "", /^Timeout after 1s/);
    assert.doesNotMatch(JSON.stringify(fixture.loggedEvents), /backend abort/);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
