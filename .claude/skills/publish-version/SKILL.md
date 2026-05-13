---
name: publish-version
description: Use when releasing a new version of the obsidian-llm-wiki plugin — bumps patch in package.json and src/manifest.json, builds, commits with conventional format, pushes to trigger CI auto-release. Use when user says "release", "publish", "bump version", "новая версия", "выпустить релиз".
---

# publish-version

Публикация новой patch-версии obsidian-llm-wiki с автоматическим CI-релизом.

## Когда использовать

- Пользователь говорит «release», «publish», «bump version», «новая версия», «выпустить»
- После завершения фичи/фикса, готового к релизу
- **Не использовать** для minor/major — только вручную

## Процесс (6 шагов)

### 1. Проверка предусловий

```bash
git status        # рабочее дерево должно быть чистым
npm test          # все тесты должны проходить
git branch --show-current  # убедиться: master
```

**Если тесты падают или есть незакоммиченные изменения — стоп. Исправить сначала.**

### 2. Вычислить новую версию

```bash
# Прочитать текущую версию
node -p "require('./package.json').version"
```

Формула: `X.Y.Z` → `X.Y.(Z+1)` (только patch)

### 3. Обновить версию в двух файлах

`package.json`:
```json
{ "version": "X.Y.NEW" }
```

`src/manifest.json`:
```json
{ "version": "X.Y.NEW" }
```

**Оба файла обязательны.** CI триггерится именно по изменению `manifest.json`.

**`minAppVersion` не трогать** — статичное поле, меняется только при явном использовании нового Obsidian API.

### 4. Собрать

```bash
npm run build
```

Ожидаемый результат: `dist/main.js` обновлён без ошибок. Build также синкает `manifest.json` (root) и `dist/manifest.json`.

### 5. Закоммитить (git-workflow)

Коммит по шаблону из истории проекта:

```bash
git add package.json src/manifest.json manifest.json dist/manifest.json dist/main.js
git commit -m "chore: bump version to X.Y.NEW, build

🤖 Generated with Claude Code

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Только эти пять файлов.** Не включать другие изменения в релизный коммит.

### 6. Push → CI авторелиз

```bash
git push origin master
```

CI (`ci: auto-release on manifest version bump`) подхватывает изменение `manifest.json` и создаёт GitHub Release автоматически.

## Итоговый summary

```
Версия: X.Y.OLD → X.Y.NEW
Файлы: package.json, src/manifest.json, main.js
Коммит: chore: bump version to X.Y.NEW, build
CI: авторелиз запущен (manifest version bump)
```

## Частые ошибки

| Ошибка | Исправление |
|--------|-------------|
| Обновил только `package.json` | Обновить и `src/manifest.json` — CI не сработает |
| Незакоммиченные изменения в рабочем дереве | Закоммитить или стэшнуть перед релизом |
| Добавил лишние файлы в релизный коммит | Только `package.json`, `src/manifest.json`, `manifest.json`, `dist/*` |
| Изменил `minAppVersion` | Не трогать — только при явном использовании нового Obsidian API |
| Тесты падали, но продолжил | Релиз с багами — исправить тесты сначала |
| Minor/major через этот навык | Только patch; minor/major — вручную |
