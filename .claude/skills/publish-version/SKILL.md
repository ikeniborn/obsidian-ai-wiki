---
name: publish-version
description: Use when releasing a new version of the obsidian-llm-wiki plugin — bumps patch across package.json, src/manifest.json, package-lock.json, versions.json, both READMEs and the release-validation test, builds, commits with conventional format, pushes to trigger CI auto-release. Use when user says "release", "publish", "bump version", "новая версия", "выпустить релиз".
---

# publish-version

Публикация новой patch-версии obsidian-llm-wiki с автоматическим CI-релизом.

## Когда использовать

- Пользователь говорит «release», «publish», «bump version», «новая версия», «выпустить»
- После завершения фичи/фикса, готового к релизу
- **Не использовать** для minor/major — только вручную

## Процесс (шаги 0a–0c, затем 1–7)

### 0a. Найти точку отсчёта

```bash
git log --oneline --no-merges --grep="^chore(release)" | head -1
```

- Извлечь хэш последнего `chore(release)` коммита.
- `--no-merges` и якорь `^` обязательны: merge-коммит цитирует subject ветки в теле, поэтому без них первым совпадением приходит `Merge pull request #NNN from ...` — чужой хэш и вводящее в заблуждение сообщение.
- Fallback 1: если таких коммитов нет → `git describe --tags --abbrev=0`.
- Fallback 2: если тегов нет → брать всю историю (`git log --oneline`).

Вывести пользователю: `"Последний релиз: <hash> <message>"`.

### 0b. Собрать изменения

```bash
git log <hash>..HEAD --oneline --no-merges
```

Фильтр включения: строки с префиксом `feat|fix|refactor|perf`.  
Фильтр исключения: коммиты с типом или scope `chore`, `docs`, `test`, `ci`, `build`; строки, содержащие только `up` или `build` в subject.

Группировать по типу:
- `feat` → раздел «New»
- `fix` → раздел «Fixes»
- `refactor`, `perf` → раздел «Other»

Дедупликация: если два коммита имеют одинаковый `scope` И совпадают ≥2 значимых слова в subject — объединять в один пункт, оставляя наиболее полное описание.

**Single-entry guard:** если нет коммитов с типами `feat/fix/refactor/perf` — предупредить пользователя и спросить, продолжать ли.

### 0c. Draft changelog и согласование

Сначала вычисли tentative-версию: прочитай `package.json` → возьми `version` → инкрементируй patch. Не записывай файлы — только вычисли номер для заголовка changelog.

Claude формирует changelog:

```markdown
## X.Y.NEW

### New
- feat(scope): description

### Fixes
- fix(scope): description

### Other
- refactor(scope): description
- perf(scope): description
```

Правила формата:
- Версия без префикса `v` (`X.Y.NEW`, не `vX.Y.NEW`).
- Пустые разделы не выводить (без заголовка).
- Описания — из сообщения коммита, без хэша.
- **Весь changelog — только английский.** Заголовки разделов и описания пунктов.

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

### 3. Обновить версию и синхронизировать метаданные

Релизные метаданные проверяются гейтом `scripts/validate-release.mjs`: рассинхрон любого из файлов ниже валит `npm run release:validate:pre` и CI.

**3.1. Версия в манифестах и пакете**

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

**3.2. `package-lock.json`**

```bash
npm install --package-lock-only
```

Обновляет `version` и `packages[""].version` в lockfile. Вручную не редактировать — валидатор сверяет оба поля с `package.json`.

**3.3. `versions.json`**

Добавить одну запись в конец: `"X.Y.NEW": "<minAppVersion из src/manifest.json>"`.

```json
  "X.Y.OLD": "1.13.0",
  "X.Y.NEW": "1.13.0"
```

**Существующие записи не менять** — история совместимости неизменяема (в частности `"0.3.5": "1.7.2"`).

**3.4. `README.md` и `docs/README.ru.md`**

Заменить `X.Y.OLD` на `X.Y.NEW` в двух местах каждого файла: предложение о поддерживаемой версии Obsidian и предложение про синхронизированные релизные метаданные.

```bash
grep -n "X.Y.OLD" README.md docs/README.ru.md
```

Ожидается по два совпадения в каждом файле. Оба README держать эквивалентными — различается только язык.

**3.5. `tests/release-validation.test.ts`**

В тесте `repository release metadata preserves prior compatibility mappings and synchronizes X.Y.OLD`:
- переименовать тест на `X.Y.NEW`;
- заменить `X.Y.OLD` на `X.Y.NEW` в шести `assert.equal` (package, lock, `packages[""]`, source/root/dist manifest);
- добавить строку `assert.equal(versionsJson["X.Y.NEW"], "1.13.0");` после проверки `X.Y.OLD`.

**3.6. Проверить синхронизацию**

```bash
npm run release:validate:pre
```

**Ошибка гейта — стоп.** Досинхронизировать файлы из шагов 3.1–3.5, не переходить к сборке.

### 4. Собрать

```bash
npm run build
npm run release:validate:post
npm test
```

Ожидаемый результат: `dist/main.js` обновлён без ошибок. Build также синкает `manifest.json` (root) и `dist/manifest.json`. `release:validate:post` подтверждает, что сгенерированные файлы совпадают с метаданными, `npm test` — что обновлённый `tests/release-validation.test.ts` проходит.

### 4.5. Обновить CHANGELOG.md

Используй текст из changelog, согласованного на шаге 0c — без изменений.

Prepend новую секцию в начало `CHANGELOG.md`:

```markdown
## X.Y.NEW — YYYY-MM-DD

### New
...

### Fixes
...

### Other
...

---
```

- Если `CHANGELOG.md` не существует — создать с заголовком `# Changelog` и первой секцией.
- **Заголовки разделов — только английские** (`New`, `Fixes`, `Other`), как в шаге 0c и в существующих секциях файла.
- Пустые разделы не выводить (без заголовка).
- Дата — сегодняшняя в формате `YYYY-MM-DD`.
- `X.Y.NEW` — tentative-версия, вычисленная в шаге 0c.

### 5. Закоммитить (git-workflow)

```bash
git add package.json package-lock.json src/manifest.json manifest.json dist/manifest.json dist/main.js versions.json README.md docs/README.ru.md tests/release-validation.test.ts CHANGELOG.md
git commit -m "chore(release): X.Y.NEW — <summary>

<полный changelog из шага 0c>

Co-Authored-By: <модель> <noreply@anthropic.com>"
```

Где `<summary>` — subject первого `feat` из согласованного changelog; если `feat` нет — первый `fix`; если нет ни того ни другого — «minor improvements».

Trailer — единственный, и модель в нём та, что выполняет релиз, из глобальных инструкций проекта. Не копировать имя модели из прошлого релиза: `0.3.13` и `0.3.14` оба несут `Claude Opus 5`, и захардкоженное здесь другое имя разошлось с историей. Строку `🤖 Generated with Claude Code` релизные коммиты не несут.

**Только эти одиннадцать файлов.** Не включать другие изменения в релизный коммит.

Исключение — `dist/styles.css`: build пересобирает и его, поэтому если релиз содержит правку CSS, файлов будет двенадцать. Ориентир — `git status --short` после сборки, а не список выше: лишним считается всё, чего сборка и шаги 3.1–3.5 не породили.

```bash
git status --short   # ожидается ровно 11 изменённых файлов
```

### 6. Push → CI авторелиз

```bash
git push origin master
```

CI (`ci: auto-release on manifest version bump`) подхватывает изменение `manifest.json` и создаёт GitHub Release автоматически.

### 7. Перезаписать ноты релиза

**Обязательный шаг.** CI генерирует ноты автоматически по PR-заголовкам — они не совпадают с согласованным changelog. Дождаться появления релиза (~30 сек), затем перезаписать:

```bash
# Подождать появления релиза
sleep 30

# Проверить что релиз создан
gh release view X.Y.NEW

# Перезаписать ноты
gh release edit X.Y.NEW --notes "<полный changelog из шага 0c>

**Full Changelog**: https://github.com/ikeniborn/obsidian-ai-wiki/compare/X.Y.OLD...X.Y.NEW"
```

Формат нот — тот же markdown, что в шаге 0c (разделы `New`, `Fixes`, `Other`).

**Если `gh release view` возвращает ошибку** — CI ещё не завершился. Повторить через 15 сек.

## Итоговый summary

```
Версия: X.Y.OLD → X.Y.NEW
Changelog: <N> изменений согласовано
Файлы (11): package.json, package-lock.json, src/manifest.json, manifest.json,
       dist/manifest.json, dist/main.js, versions.json, README.md,
       docs/README.ru.md, tests/release-validation.test.ts, CHANGELOG.md
Коммит: chore(release): X.Y.NEW — <summary>
GitHub Release: ноты перезаписаны вручную
CI: авторелиз запущен
```

## Частые ошибки

| Ошибка | Исправление |
|--------|-------------|
| Обновил только `package.json` | Обновить и `src/manifest.json` — CI не сработает |
| Незакоммиченные изменения в рабочем дереве | Закоммитить или стэшнуть перед релизом |
| Добавил лишние файлы в релизный коммит | Только одиннадцать файлов из шага 5 |
| Не обновил `package-lock.json` | `npm install --package-lock-only`; валидатор сверяет `version` и `packages[""].version` |
| Не добавил запись в `versions.json` | Добавить `"X.Y.NEW": "<minAppVersion>"`; существующие записи не менять |
| Не обновил версию в `README.md` / `docs/README.ru.md` | По два вхождения в каждом файле; оба README держать эквивалентными |
| Не обновил `tests/release-validation.test.ts` | Имя теста, шесть `assert.equal` и новая строка для `versions.json` — иначе `npm test` падает |
| Изменил `minAppVersion` | Не трогать — только при явном использовании нового Obsidian API |
| Тесты падали, но продолжил | Релиз с багами — исправить тесты сначала |
| Minor/major через этот навык | Только patch; minor/major — вручную |
| Нет коммитов feat/fix/refactor/perf | Показать предупреждение и спросить пользователя; не переходить к шагу 1 без явного ответа |
| Не дождался подтверждения changelog | Вернуться к шагу 0c, показать draft, дождаться «ок» |
| Не включил CHANGELOG.md в коммит | Одиннадцать файлов: добавить CHANGELOG.md в `git add` |
| Заголовки CHANGELOG на русском | Только `New`, `Fixes`, `Other` — как в существующих секциях файла |
| Описания пунктов на русском | Язык описаний — только английский |
| Не перезаписал ноты релиза | CI пишет автоноты по PR — всегда выполнять шаг 7 |
| `gh release view` — ошибка сразу после push | CI ещё не завершился, подождать 15 сек и повторить |
