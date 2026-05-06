# Публикация плагина в Obsidian Community Plugins

## Статус

- PR: https://github.com/obsidianmd/obsidian-releases/pull/12351
- Release: https://github.com/ikeniborn/obsidian-llm-wiki/releases/tag/0.1.0

## Правила валидации (бот github-actions)

Бот проверяет PR автоматически при каждом пуше в ветку. Ошибки — блокирующие.

### Plugin ID

- Не содержит слово `obsidian` (регистр не важен)
- Не заканчивается на `plugin`
- Только строчные буквы, цифры, дефисы и подчёркивания: `^[a-z0-9-_]+$`
- Должен совпадать с `id` в `manifest.json` репозитория и в ассете `manifest.json` релиза

### Описание (description)

- Не содержит слово `Obsidian`
- Не начинается с `This plugin` / `This is a plugin`
- Заканчивается одним из символов: `.` `?` `!` `)`
- Максимум 250 символов
- Должно совпадать с `description` в `manifest.json` репозитория

### Запись в community-plugins.json

Допустимые ключи: `id`, `name`, `author`, `description`, `repo`. Лишние ключи — ошибка.

```json
{
  "id": "llm-wiki",
  "name": "LLM Wiki",
  "author": "ikeniborn",
  "description": "AI-powered compoundable knowledge base — extracts, synthesizes and maintains a wiki from raw sources.",
  "repo": "ikeniborn/obsidian-llm-wiki"
}
```

### Шаблон PR-тела

Бот проверяет наличие **этих точных строк** (substring match) в теле PR:

```
I have tested the plugin on
My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
GitHub release name matches the exact version number specified in my manifest.json
The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
My README.md describes the plugin's purpose and provides clear usage instructions.
I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugin
I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls
I have added a license in the LICENSE file.
My project respects and is compatible with the original license of any code from other plugins that I'm using.
I have given proper attribution to these other projects in my `README.md`.
```

Внимание на апострофы: `plugin's`, `I'm using` — именно так, не `plugin purpose` и не `I am using`.

### Manifest.json

Обязательные поля: `id`, `name`, `description`, `author`, `version`, `minAppVersion`, `isDesktopOnly`.
Допустимые дополнительные: `authorUrl`, `fundingUrl`, `helpUrl`.
`authorUrl` не должен указывать на `https://obsidian.md` или на репозиторий плагина.

### Релиз

- Тег релиза должен совпадать с `version` в `manifest.json` (без префикса `v`)
- Релиз должен содержать `main.js` и `manifest.json` как отдельные файлы
- `manifest.json` в релизе должен иметь тот же `id` и `description`, что и запись в PR

## Форк obsidian-releases

Форк `ikeniborn/obsidian-releases` (от `obsidianmd/obsidian-releases`) — **временный артефакт** процесса публикации.

- Нужен только для создания PR #12351 в `obsidianmd/obsidian-releases`
- Пока PR открыт — форк удалять нельзя (GitHub удалит ветку-источник PR)
- После принятия PR форк можно удалить

Активный PR: https://github.com/obsidianmd/obsidian-releases/pull/12351 (статус: OPEN)

## Процесс публикации

### 1. Собрать релиз

```bash
npm run build
```

Артефакты: `dist/main.js`, `dist/manifest.json`, `dist/styles.css`.

### 2. Создать GitHub Release

```bash
gh release create <version> \
  dist/main.js dist/manifest.json dist/styles.css \
  --title "<version>"
```

Тег и название без префикса `v`.

### 3. Добавить запись в obsidian-releases

В форке `obsidianmd/obsidian-releases` добавить объект в конец `community-plugins.json`.
PR создаётся из ветки форка в `master` репозитория `obsidianmd/obsidian-releases`.

### 4. Тело PR — точный шаблон

```markdown
# I am submitting a new Community Plugin

- [x] I attest that I have done my best to deliver a high-quality plugin, am proud of the code I have written, and would recommend it to others. I commit to maintaining the plugin and being responsive to bug reports. If I am no longer able to maintain it, I will make reasonable efforts to find a successor maintainer or withdraw the plugin from the directory.

## Repo URL

<!--- Paste a link to your repo here for easy access -->
Link to my plugin: https://github.com/ikeniborn/obsidian-llm-wiki

## Release Checklist
- [x] I have tested the plugin on
  - [x]  Windows
  - [x]  macOS
  - [x]  Linux
  - [ ]  Android _(if applicable)_
  - [ ]  iOS _(if applicable)_
- [x] My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
  - [x] `main.js`
  - [x] `manifest.json`
  - [ ] `styles.css` _(optional)_
- [x] GitHub release name matches the exact version number specified in my manifest.json (_**Note:** Use the exact version number, don't include a prefix `v`_)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugin's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using.
      I have given proper attribution to these other projects in my `README.md`.
```

### 5. Повторная валидация

Бот запускается на каждый пуш в ветку PR (только если `additions > deletions` на уровне всего PR).
Для ручного перезапуска: закрыть и переоткрыть PR.

## Выпуск новой версии

1. Обновить `version` в `manifest.json` и `package.json`
2. `npm run build`
3. `gh release create <версия> dist/main.js dist/manifest.json dist/styles.css`

PR в `obsidian-releases` для обновлений **не нужен** — Obsidian подхватывает новый Release автоматически.
