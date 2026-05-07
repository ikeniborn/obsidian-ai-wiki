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
  contentEl = makeEl();
  close() {}
}

export class ItemView {}

export const moment = { locale: () => "en" };
