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
};

export class Notice {}

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
