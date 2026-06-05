// Mock for obsidian module in tests

// Global window mock for setTimeout/clearTimeout in tests
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

function makeEl() {
  const el: any = {
    empty: () => {},
    createEl: (_tag: string, opts?: any) => makeElWithText(opts?.text ?? ""),
    createDiv: (_opts?: any) => makeEl(),
    addClass: () => {},
    removeClass: () => {},
    textContent: "",
    value: "",
    rows: 0,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0 }),
  };
  return el;
}

function makeElWithText(text: string) {
  const el = makeEl();
  el.textContent = text;
  return el;
}

// activeDocument export for Obsidian compatibility
export const activeDocument = {
  body: makeEl(),
};

export class App {}

export class Plugin {}

export class PluginSettingTab {
  constructor(app: App, plugin: Plugin) {}
}

export class Setting {
  constructor(containerEl: any) {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addDropdown() { return this; }
  addToggle() { return this; }
  addButton(cb?: (b: any) => any) {
    const btn = {
      setButtonText: () => btn,
      setCta: () => btn,
      setWarning: () => btn,
      onClick: () => btn,
    };
    cb?.(btn);
    return this;
  }
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
  isDesktopApp: true,
};

/** Test helper — flip isMobile/isDesktop atomically. */
export function __setPlatformMobile(isMobile: boolean): void {
  Platform.isMobile = isMobile;
  Platform.isDesktop = !isMobile;
  Platform.isDesktopApp = !isMobile;
}

export class Notice {
  static __messages: string[] = [];
  constructor(message: string) {
    Notice.__messages.push(message);
  }
}

/** Test helper — clear Notice capture between tests. */
export function __clearNotices(): void {
  Notice.__messages.length = 0;
}

/** Test helper — get captured Notices. */
export function __getNotices(): string[] {
  return Notice.__messages;
}


export class AbstractInputSuggest<T> {
  app: any;
  inputEl: HTMLInputElement;
  constructor(app: any, inputEl: HTMLInputElement) {
    this.app = app;
    this.inputEl = inputEl;
  }
  close() {}
}

export class TAbstractFile {
  path: string = "";
}

export class TFolder extends TAbstractFile {}

export class TFile extends TAbstractFile {
  stat?: any;
}

export class Modal {
  app: any;
  contentEl = makeEl();
  constructor(app?: any) { this.app = app; }
  open() { (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); }
}

export class ItemView {
  app: any;
  constructor(leaf?: any) { this.app = leaf?.app; }
  registerEvent(_ref: any): void {}
}

export const moment = { locale: () => "en" };

/* eslint-disable @typescript-eslint/no-explicit-any */
export const __requestUrlCalls: any[] = [];
export let __requestUrlResponse: { status: number; text: string; headers: Record<string, string> } = {
  status: 200, text: "{}", headers: { "content-type": "application/json" },
};
export function __setRequestUrlResponse(r: typeof __requestUrlResponse): void {
  __requestUrlResponse = r;
}
export function __clearRequestUrlCalls(): void { __requestUrlCalls.length = 0; }

let __requestUrlDelayMs = 0;
export function __setRequestUrlDelay(ms: number): void { __requestUrlDelayMs = ms; }
export function __resetRequestUrlDelay(): void { __requestUrlDelayMs = 0; }

export async function requestUrl(param: any) {
  __requestUrlCalls.push(param);
  if (__requestUrlDelayMs > 0) {
    await new Promise((r) => setTimeout(r, __requestUrlDelayMs));
  }
  return __requestUrlResponse;
}

/** Test helper — in-memory VaultAdapter compatible with src/vault-tools.ts. */
export function createMockAdapter() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    exists: async (p: string) => files.has(p) || dirs.has(p),
    read: async (p: string) => {
      const v = files.get(p);
      if (v == null) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    write: async (p: string, data: string) => { files.set(p, data); },
    append: async (p: string, data: string) => {
      files.set(p, (files.get(p) ?? "") + data);
    },
    mkdir: async (p: string) => { dirs.add(p); },
    list: async (_p: string) => ({ files: [], folders: [] }),
  };
}
