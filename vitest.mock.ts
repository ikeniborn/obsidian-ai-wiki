// Mock for obsidian module in tests
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
};

/** Test helper — flip isMobile/isDesktop atomically. */
export function __setPlatformMobile(isMobile: boolean): void {
  Platform.isMobile = isMobile;
  Platform.isDesktop = !isMobile;
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
  };
  return el;
}
function makeElWithText(text: string) {
  const el = makeEl();
  el.textContent = text;
  return el;
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

export class TFolder {
  path: string = "";
}

export class Modal {
  app: any;
  contentEl = makeEl();
  constructor(app?: any) { this.app = app; }
  open() { (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); }
}

export class ItemView {}

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
export async function requestUrl(param: any) {
  __requestUrlCalls.push(param);
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
