# Submission & Repository Rules

Источники: [Submit Plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) · [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)

## Файлы репозитория

| Файл | Обязателен | Примечание |
|------|-----------|-----------|
| `manifest.json` | Да | В корне репо **и** в Release |
| `README.md` | Да | Описание и инструкции |
| `LICENSE` | Да | С copyright notice |
| `main.js` | Да (в Release) | Скомпилированный плагин |
| `styles.css` | Нет | В Release, если используется |

## Процесс публикации

1. [Developer Dashboard](https://obsidian.md/developer) → подключить GitHub → выбрать репо.
2. Automated review — старт немедленно, результат за минуты.
3. После одобрения — обновления через GitHub Release, PR в obsidian-releases больше не нужен.
4. Пользователи получают авто-уведомление при новом Release с совпадающим тегом.

## community-plugins.json запись

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "author": "Author Name",
  "description": "Does something useful.",
  "repo": "username/repo-name"
}
```

Только эти 5 ключей. `branch` опционален (default: master).

## Аттестация разработчика

При публикации автор подтверждает: высокое качество кода, готовность поддерживать плагин или найти преемника.

## Объявление после публикации

- Форум Obsidian Community
- Discord `#updates` (требует developer role)
