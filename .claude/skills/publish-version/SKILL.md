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

## Процесс (шаги 0a–0c, затем 1–6)

### 0a. Найти точку отсчёта

```bash
git log --oneline --grep="chore(release)" | head -1
```

- Извлечь хэш последнего `chore(release)` коммита.
- Fallback 1: если таких коммитов нет → `git describe --tags --abbrev=0`.
- Fallback 2: если тегов нет → брать всю историю (`git log --oneline`).

Вывести пользователю: `"Последний релиз: <hash> <message>"`.

### 0b. Собрать изменения

```bash
git log <hash>..HEAD --oneline
```

Фильтр включения: строки с префиксом `feat|fix|refactor|perf`.  
Фильтр исключения: коммиты с типом или scope `chore`, `docs`, `test`, `ci`, `build`; строки, содержащие только `up` или `build` в subject.

Группировать по типу:
- `feat` → раздел «Новое»
- `fix` → раздел «Исправления»
- `refactor`, `perf` → раздел «Прочее»

Дедупликация: если два коммита имеют одинаковый `scope` И совпадают ≥2 значимых слова в subject — объединять в один пункт, оставляя наиболее полное описание.

**Single-entry guard:** если нет коммитов с типами `feat/fix/refactor/perf` — предупредить пользователя и спросить, продолжать ли.

### 0c. Draft changelog и согласование

Сначала вычисли tentative-версию: прочитай `package.json` → возьми `version` → инкрементируй patch. Не записывай файлы — только вычисли номер для заголовка changelog.

Claude формирует changelog:

```markdown
## X.Y.NEW

### Новое
- feat(scope): описание

### Исправления
- fix(scope): описание

### Прочее
- refactor(scope): описание
- perf(scope): описание
```

Правила формата:
- Версия без префикса `v` (`X.Y.NEW`, не `vX.Y.NEW`).
- Пустые разделы не выводить (без заголовка).
- Описания — из сообщения коммита, без хэша.

Claude показывает draft и ждёт явного подтверждения. Пользователь может удалять пункты, переформулировать, добавлять свои.

**Переход к шагу 1 только после явного «ок» / «подтверждаю» / аналога.**

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

### 4.5. Обновить CHANGELOG.md

Используй текст из changelog, согласованного на шаге 0c — без изменений.

Prepend новую секцию в начало `CHANGELOG.md`:

```markdown
## X.Y.NEW — YYYY-MM-DD

### Новое
...

### Исправления
...

### Прочее
...

---
```

- Если `CHANGELOG.md` не существует — создать с заголовком `# Changelog` и первой секцией.
- Пустые разделы не выводить (без заголовка).
- Дата — сегодняшняя в формате `YYYY-MM-DD`.
- `X.Y.NEW` — tentative-версия, вычисленная в шаге 0c.

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
