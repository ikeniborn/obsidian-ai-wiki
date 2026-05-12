# manifest.json Rules

Источники: [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) · [Submit Plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) · [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)

## Обязательные поля

| Поле | Тип | Ограничение |
|------|-----|------------|
| `id` | string | Уникальный; только `^[a-z0-9-_]+$`; без `obsidian`; не заканчивается на `plugin`; совпадает с `community-plugins.json` |
| `name` | string | Отображаемое имя в сторе |
| `author` | string | Имя автора |
| `version` | string | Строго SemVer `MAJOR.MINOR.PATCH` |
| `minAppVersion` | string | Минимальная версия Obsidian (напр. `"0.15.0"`) |
| `description` | string | ≤250 символов; без слова `Obsidian`; не начинается с `This plugin` / `This is a plugin`; заканчивается `.?!)`; совпадает с записью в `community-plugins.json` |

## Необязательные поля

| Поле | Тип | Назначение |
|------|-----|-----------|
| `authorUrl` | string | Сайт автора |
| `fundingUrl` | string | Ссылка для донатов |
| `isDesktopOnly` | boolean | `true` если используются Node.js / Electron API |

## Версионирование

- Тег GitHub Release — без префикса `v` (правильно: `1.2.3`, не `v1.2.3`).
- Тег должен точно совпадать с `version` в `manifest.json`.
- `manifest.json` должен быть в корне репо **и** в активах Release.

## Пример минимального manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "author": "Author Name",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Does something useful."
}
```
