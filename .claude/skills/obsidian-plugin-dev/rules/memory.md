# Memory Management Rules

Источник: [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin)

## Авто-очистка

`add*()` и `register*()` — авто-очистка при `onunload()`. Вручную не отслеживать.

```typescript
// Правильно — авто-очистка
this.registerEvent(this.app.vault.on('modify', handler));
this.registerInterval(window.setInterval(fn, 1000));
this.addCommand({ ... });
```

## View cleanup — обязательно

```typescript
// React
export class MyView extends ItemView {
  private root: Root;

  async onOpen() {
    this.root = createRoot(this.containerEl);
    this.root.render(<App />);
  }

  async onClose() {
    this.root.unmount(); // обязательно
  }
}

// Svelte
export class MyView extends ItemView {
  private instance: ReturnType<typeof mount>;

  async onOpen() {
    this.instance = mount(MyComponent, { target: this.containerEl });
  }

  async onClose() {
    unmount(this.instance); // обязательно
  }
}
```

## Запрещено

```typescript
// Неправильно — утечка памяти
class MyPlugin extends Plugin {
  view: MyView; // прямая ссылка на View

  async onload() {
    this.view = this.app.workspace.getLeavesOfType('my-view')[0]?.view as MyView;
  }
}
```

Получать View через `getLeavesOfType()` каждый раз по необходимости, не кешировать.
