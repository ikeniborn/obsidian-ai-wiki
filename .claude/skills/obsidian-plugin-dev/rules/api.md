# API Usage Rules

Источник: [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin)

## Обязательно

- `normalizePath()` — **все** пользовательские и конструируемые пути. Самая частая причина провала ревью. [Source](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- `Platform.isDesktop()` — охранник перед любым Node.js / Electron API.
- `FileManager.trashFile()` — вместо `Vault.trash()` / `Vault.delete()` (уважает настройки пользователя).
- `activeDocument` / `activeWindow` — вместо `document` / `global` / `globalThis` (поддержка popout-окон).
- `createEl()` / `createDiv()` / `createSpan()` / `createSvg()` / `createFragment()` — DOM-хелперы вместо `document.createElement()`.
- `window.setTimeout()` / `window.setInterval()` — вместо голых таймеров (popout-совместимость).
- `registerInterval()` — обёртка над `window.setInterval()` для авто-отписки в `onunload`.
- `registerEvent()` — обёртка над событиями для авто-отписки.
- `.instanceOf(T)` — вместо `instanceof` (безопасно между окнами).

## Запрещено

- Node.js-модули без `Platform.isDesktop()` guard → сломается на mobile.
- Lookbehind-регулярки (`(?<=...)`) → не поддерживаются на iOS.
- Хранить прямые ссылки на кастомные `View` в полях плагина → утечка памяти.
- `element.style.xxx = ...` → только CSS-классы.
- API, недоступные в задекларированном `minAppVersion`.

## Примеры

```typescript
// Пути
const path = normalizePath(userInput);
const full = normalizePath(`${folder}/${file}`);

// Node.js guard
if (Platform.isDesktop()) {
  const fs = require('fs');
}

// DOM
const div = containerEl.createDiv({ cls: 'my-class' });
const span = div.createSpan({ text: 'Hello' });

// Файл в корзину
await this.app.fileManager.trashFile(file);

// Таймер с авто-очисткой
this.registerInterval(window.setInterval(() => { ... }, 5000));
```
