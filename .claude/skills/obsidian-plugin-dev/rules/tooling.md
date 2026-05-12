# Dev Tooling Rules

Источник: [obsidianmd/eslint-plugin](https://github.com/obsidianmd/eslint-plugin) · [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)

## ESLint — обязательный инструмент

```bash
npm install --save-dev @obsidianmd/eslint-plugin
```

```typescript
// eslint.config.mts
import obsidian from '@obsidianmd/eslint-plugin';
export default [...obsidian.configs.recommended];
```

```bash
npx eslint src/ --fix   # большинство правил автофиксируемо
```

Запускать до публикации. Developer Dashboard также предоставляет preview-скан.

## Рекомендуемый стек

- TypeScript — типизация + документация API
- esbuild — бандлинг (`esbuild.config.mjs`)
- ESLint с `@obsidianmd/eslint-plugin`

## Developer Dashboard Preview

Скан любого branch/tag/commit до официальной публикации:
[obsidian.md/developer](https://obsidian.md/developer)
