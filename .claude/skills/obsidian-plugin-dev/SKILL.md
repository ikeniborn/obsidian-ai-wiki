---
name: obsidian-plugin-dev
description: Use when developing, reviewing, or submitting an Obsidian community plugin — covers manifest requirements, API rules, memory management, security, and submission process.
---

# Obsidian Plugin Development

Официальные требования к разработке плагинов Obsidian. Правила разбиты по темам — загружай только нужное.

## Когда использовать

- Создание нового плагина или фичи
- Ревью кода плагина (PR, самопроверка)
- Подготовка к публикации в Community Plugins
- Диагностика ошибок ревью

## Быстрая проверка (pre-submit checklist)

```
[ ] manifest.json — все обязательные поля (id, name, author, version, minAppVersion, description)
[ ] version без префикса v, тег Release = version
[ ] normalizePath() на все пути файлов
[ ] Platform.isDesktop() перед любым Node.js API
[ ] Нет инлайн-стилей (element.style.xxx) — только CSS-классы
[ ] Нет хоткеев по умолчанию
[ ] Нет ссылок на View в полях класса плагина
[ ] React/Svelte: unmount() вызван в onClose()
[ ] README.md и LICENSE в корне репо
[ ] isDesktopOnly: true в manifest — если используется Node.js/Electron
```

## Ключевые правила

### Пути к файлам — обязательно

```typescript
// Всегда:
const path = normalizePath(userInput);
const fullPath = normalizePath(`${folder}/${filename}`);

// Самая частая причина провала ревью
```

### Node.js API — только с guard

```typescript
import { Platform } from 'obsidian';

if (Platform.isDesktop()) {
  const fs = require('fs');
  // ...
}
// Без guard — сломается на mobile
```

### Очистка View

```typescript
// React
async onClose() {
  this.root?.unmount(); // обязательно
}

// Svelte
async onClose() {
  unmount(this.instance); // обязательно
}
```

### DOM — хелперы, не нативные методы

```typescript
// Правильно:
const div = containerEl.createDiv({ cls: 'my-class' });
const span = div.createSpan({ text: 'Hello' });

// Неправильно:
const div = document.createElement('div'); // не activeDocument
div.style.color = 'red'; // инлайн-стиль
```

### Команды

```typescript
this.addCommand({
  id: 'open-view',      // без pluginId в начале, без слова 'command'
  name: 'Open view',    // sentence case, без имени плагина
  // hotkeys: [] — не назначать по умолчанию
  callback: () => { ... }
});
```

## Разделы правил (загружай по необходимости)

| Файл | Когда загружать |
|------|----------------|
| [rules/manifest.md](rules/manifest.md) | Поля manifest.json, версионирование, id-ограничения |
| [rules/api.md](rules/api.md) | normalizePath, Platform, DOM-хелперы, запрещённые паттерны |
| [rules/commands-ui.md](rules/commands-ui.md) | Нейминг команд, sentence case, стили |
| [rules/memory.md](rules/memory.md) | Очистка View (React/Svelte), запрет ссылок на View |
| [rules/security.md](rules/security.md) | Модель разрешений, автоскан, закрытый код |
| [rules/submission.md](rules/submission.md) | Файлы репо, процесс публикации, community-plugins.json |
| [rules/performance.md](rules/performance.md) | Startup, выбор фреймворка, размер бандла |
| [rules/tooling.md](rules/tooling.md) | ESLint setup, Developer Dashboard Preview |

## ESLint

```bash
npm install --save-dev @obsidianmd/eslint-plugin

# eslint.config.mts — добавить:
import obsidian from '@obsidianmd/eslint-plugin';
export default [...obsidian.configs.recommended];

# Запуск:
npx eslint src/ --fix
```

Автофикс покрывает большинство правил UI и API.

## Связанные ресурсы

- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Submit Plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Developer Policies](https://docs.obsidian.md/Developer+policies)
- [ESLint Plugin](https://github.com/obsidianmd/eslint-plugin)
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [TypeScript API Reference](https://docs.obsidian.md/Reference/TypeScript+API)
- [obsidian-plugin-release](../obsidian-plugin-release/SKILL.md) — публикация Release
