---
title: publish-version skill — changelog analysis before release
date: 2026-05-16
status: approved
review:
  spec_hash: 9b4adc46e7ce79b8
  last_run: 2026-05-16
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  section_hashes:
    "## Цель": c75c4ae6e6d09e97
    "## Изменения в структуре навыка": effcd84af3955050
    "## Шаг 0a — найти точку отсчёта": f37f13d7e1f190ea
    "## Шаг 0b — собрать изменения": 230d2cc63f00bcd7
    "## Шаг 0c — draft changelog и согласование": 1d6d111e8858b9e2
    "## Шаг 4.5 — обновить CHANGELOG.md (новый, перед коммитом)": 5e7d8e717a52f088
    "## Шаг 5 — формат коммита (изменён)": ca766f6e96542fc4
    "## Итоговый summary (обновлён)": df9ae95e2d325fea
    "## Что не меняется": 246a4c95f4779100
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "## Шаг 0b — собрать изменения"
      section_hash: 230d2cc63f00bcd7
      text: >
        "по одной теме" — критерий дедупликации не определён. Нет правила, по которому Claude решает,
        что два коммита одного скоупа — «одна тема». Можно исправить: добавить конкретное правило
        (например, «одинаковый scope И совпадение ≥2 слов в subject → объединить»).
      verdict: fixed
      verdict_at: 2026-05-16
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "## Шаг 5 — формат коммита (изменён)"
      section_hash: ca766f6e96542fc4
      text: >
        "краткое описание главной темы релиза" — нет критерия выбора. Если в changelog несколько
        feat — как Claude выбирает «главную»? Вариант: «первый feat из списка» или «тема с наибольшим
        числом связанных коммитов».
      verdict: fixed
      verdict_at: 2026-05-16
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

Дедупликация: если два коммита имеют одинаковый `scope` И совпадают ≥2 значимых слова в subject — объединять в один пункт, оставляя наиболее полное описание.

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

`summary` — subject первого `feat` из согласованного changelog; если `feat` нет — первый `fix`; если нет ни того ни другого — «minor improvements».

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
