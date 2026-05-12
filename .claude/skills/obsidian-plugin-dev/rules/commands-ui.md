# Commands & UI Rules

Источник: [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin)

## Команды

- ID команды — без слова `command` и без `pluginId` в начале.
- Имя команды — без слова `command` и без имени плагина.
- Хоткеи по умолчанию — **не назначать** (только пользователь решает).

```typescript
this.addCommand({
  id: 'open-view',     // не 'my-plugin:open-view', не 'open-view-command'
  name: 'Open view',   // не 'My Plugin: Open view', не 'Open view command'
  // hotkeys: []       // не задавать по умолчанию
  callback: () => { ... }
});
```

## Текст UI

- Sentence case: `'Open note'`, `'Clear history'` — не `'Open Note'`, не `'Clear History'`.
- Заголовки в Settings Tab — через `createEl('h3')`, не `innerHTML`.

## Стили

- Только CSS-классы — не `element.style.xxx`.
- CSS-переменные Obsidian — для совместимости с темами.
- Расширять стили Obsidian, не перезаписывать.

```typescript
// Правильно
el.addClass('my-plugin-header');

// Неправильно
el.style.color = 'red';
el.style.fontSize = '16px';
```
