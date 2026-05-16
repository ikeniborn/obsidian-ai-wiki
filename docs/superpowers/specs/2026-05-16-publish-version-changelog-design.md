---
title: publish-version skill — changelog analysis before release
date: 2026-05-16
status: approved
---

# publish-version: changelog analysis before release

## Цель

Расширить навык `publish-version` тремя подготовительными шагами: найти последний релиз, собрать изменения, показать changelog пользователю для правки и подтверждения — до начала версионирования и сборки.

## Изменения в структуре навыка

Текущий навык: 6 шагов (проверка → версия → файлы → сборка → коммит → push).

После доработки: шаги 0a–0c предшествуют шагам 1–6. Шаги 1–6 остаются без изменений, кроме формата коммита (шаг 5) и нового шага записи CHANGELOG.md (между 5 и 6).

## Шаг 0a — найти точку отсчёта

```bash
git log --oneline --grep="chore(release)" | head -1
```

- Извлечь хэш последнего `chore(release)` коммита.
- Fallback 1: если таких коммитов нет → `git describe --tags --abbrev=0` (последний тег).
- Fallback 2: если тегов нет → брать всю историю (`git log --oneline`).

Вывести найденную точку пользователю: `"Последний релиз: <hash> <message>"`.

## Шаг 0b — собрать изменения

```bash
git log <hash>..HEAD --oneline
```

Фильтр включения: строки с префиксом `feat|fix|refactor|perf`.  
Фильтр исключения: `chore`, `docs`, `test`, `ci`, строки `up`, `build`.

Группировать по типу:
- `feat` → раздел «Новое»
- `fix` → раздел «Исправления»
- `refactor`, `perf` → раздел «Прочее»

Дедупликация: несколько коммитов одного скоупа по одной теме объединять в один пункт.

## Шаг 0c — draft changelog и согласование

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
- Разделы без заголовка, если пусты.
- Описания — из сообщения коммита, без хэша.

Claude показывает draft и ждёт явного подтверждения. Пользователь может:
- удалить пункты,
- переформулировать,
- добавить свои.

**Переход к шагу 1 только после явного «ок» / «подтверждаю» / аналога.**

## Шаг 4.5 — обновить CHANGELOG.md (новый, перед коммитом)

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
- Разделы без заголовка, если пусты.

## Шаг 5 — формат коммита (изменён)

```
chore(release): X.Y.NEW — <однострочный summary>

<полный changelog из шага 0c>

🤖 Generated with Claude Code

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

`summary` — краткое описание главной темы релиза (одна фраза).

Файлы в коммите: `package.json src/manifest.json manifest.json dist/manifest.json dist/main.js CHANGELOG.md`.

## Итоговый summary (обновлён)

```
Версия: X.Y.OLD → X.Y.NEW
Changelog: <N> изменений согласовано
Файлы: package.json, src/manifest.json, main.js, CHANGELOG.md
Коммит: chore(release): X.Y.NEW — <summary>
CI: авторелиз запущен
```

## Что не меняется

- Шаги 1–4, 6 — без изменений.
- `minAppVersion` — не трогать.
- Только patch через навык; minor/major — вручную.
- Single-entry guard: если нет изменений feat/fix/refactor/perf — предупредить пользователя, спросить продолжать ли.
