# publish-version: changelog analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить навык `publish-version` тремя предварительными шагами (0a–0c) — найти последний релиз, собрать изменения, согласовать changelog с пользователем — плюс записать CHANGELOG.md и обновить формат коммита.

**Architecture:** Один файл SKILL.md — добавить шаги 0a/0b/0c перед шагом 1, добавить шаг 4.5 между шагами 4 и 5, заменить формат коммита в шаге 5, обновить итоговый summary. Никакого кода — навык является документом-инструкцией для Claude.

**Tech Stack:** Markdown, bash (git log, git describe)

---

## File Map

| Действие | Файл |
|----------|------|
| Modify | `.claude/skills/publish-version/SKILL.md` |

---

### Task 1: Добавить шаги 0a, 0b, 0c в SKILL.md

Вставить три новых шага перед разделом `## Процесс (6 шагов)`. Заменить этот заголовок на `## Процесс (шаги 0a–0c, затем 1–6)`.

**Files:**
- Modify: `.claude/skills/publish-version/SKILL.md`

- [ ] **Step 1: Прочитать текущий файл**

```bash
cat .claude/skills/publish-version/SKILL.md
```

Зафиксировать содержимое перед правками.

- [ ] **Step 2: Заменить заголовок раздела и добавить шаги 0a–0c**

Заменить строку:

```
## Процесс (6 шагов)
```

на:

```markdown
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
Фильтр исключения: `chore`, `docs`, `test`, `ci`, строки `up`, `build`.

Группировать по типу:
- `feat` → раздел «Новое»
- `fix` → раздел «Исправления»
- `refactor`, `perf` → раздел «Прочее»

Дедупликация: если два коммита имеют одинаковый `scope` И совпадают ≥2 значимых слова в subject — объединять в один пункт, оставляя наиболее полное описание.

**Single-entry guard:** если нет коммитов с типами `feat/fix/refactor/perf` — предупредить пользователя и спросить, продолжать ли.

### 0c. Draft changelog и согласование

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

```

- [ ] **Step 3: Верифицировать, что шаги 0a–0c появились, заголовок обновлён**

Открыть файл, убедиться визуально что:
- заголовок стал `## Процесс (шаги 0a–0c, затем 1–6)`
- разделы `### 0a`, `### 0b`, `### 0c` присутствуют перед `### 1. Проверка предусловий`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/publish-version/SKILL.md
git commit -m "feat(publish-version): add steps 0a-0c changelog collection and user confirmation"
```

---

### Task 2: Добавить шаг 4.5 — запись CHANGELOG.md

Вставить шаг 4.5 между существующими шагами 4 и 5.

**Files:**
- Modify: `.claude/skills/publish-version/SKILL.md`

- [ ] **Step 1: Вставить шаг 4.5 после раздела `### 4. Собрать`**

Найти строку `### 5. Закоммитить` и вставить перед ней:

```markdown
### 4.5. Обновить CHANGELOG.md

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

```

- [ ] **Step 2: Верифицировать порядок шагов**

В файле должен быть порядок: `### 4. Собрать` → `### 4.5. Обновить CHANGELOG.md` → `### 5. Закоммитить`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/publish-version/SKILL.md
git commit -m "feat(publish-version): add step 4.5 CHANGELOG.md update before commit"
```

---

### Task 3: Обновить шаг 5 — новый формат коммита и список файлов

Заменить шаблон коммита в шаге 5 и список файлов в `git add`.

**Files:**
- Modify: `.claude/skills/publish-version/SKILL.md`

- [ ] **Step 1: Заменить содержимое раздела `### 5. Закоммитить`**

Найти блок:

```markdown
Коммит по шаблону из истории проекта:

```bash
git add package.json src/manifest.json manifest.json dist/manifest.json dist/main.js
git commit -m "chore: bump version to X.Y.NEW, build

🤖 Generated with Claude Code

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Только эти пять файлов.** Не включать другие изменения в релизный коммит.
```

Заменить на:

```markdown
```bash
git add package.json src/manifest.json manifest.json dist/manifest.json dist/main.js CHANGELOG.md
git commit -m "chore(release): X.Y.NEW — <summary>

<полный changelog из шага 0c>

🤖 Generated with Claude Code

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Где `<summary>` — subject первого `feat` из согласованного changelog; если `feat` нет — первый `fix`; если нет ни того ни другого — «minor improvements».

**Только эти шесть файлов.** Не включать другие изменения в релизный коммит.
```

- [ ] **Step 2: Верифицировать изменения**

В шаге 5 должно быть:
- `git add` включает `CHANGELOG.md` (шестой файл)
- Формат: `chore(release): X.Y.NEW — <summary>`
- Тело коммита содержит полный changelog

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/publish-version/SKILL.md
git commit -m "feat(publish-version): update step 5 commit format with changelog body and summary rule"
```

---

### Task 4: Обновить итоговый summary и «Частые ошибки»

Привести блок `## Итоговый summary` и таблицу `## Частые ошибки` в соответствие с новым процессом.

**Files:**
- Modify: `.claude/skills/publish-version/SKILL.md`

- [ ] **Step 1: Заменить блок `## Итоговый summary`**

Найти:

```markdown
## Итоговый summary

```
Версия: X.Y.OLD → X.Y.NEW
Файлы: package.json, src/manifest.json, main.js
Коммит: chore: bump version to X.Y.NEW, build
CI: авторелиз запущен (manifest version bump)
```
```

Заменить на:

```markdown
## Итоговый summary

```
Версия: X.Y.OLD → X.Y.NEW
Changelog: <N> изменений согласовано
Файлы: package.json, src/manifest.json, main.js, CHANGELOG.md
Коммит: chore(release): X.Y.NEW — <summary>
CI: авторелиз запущен
```
```

- [ ] **Step 2: Обновить таблицу `## Частые ошибки`**

Добавить строки:

```markdown
| Нет коммитов feat/fix/refactor/perf | Навык предупредит и спросит о продолжении |
| Не дождался подтверждения changelog | Шаг 0c требует явного «ок» перед шагом 1 |
| Не включил CHANGELOG.md в коммит | Шесть файлов: добавить CHANGELOG.md в `git add` |
```

- [ ] **Step 3: Верифицировать итоговый вид файла**

Прочитать весь SKILL.md и проверить порядок разделов:
1. frontmatter
2. `# publish-version`
3. `## Когда использовать`
4. `## Процесс (шаги 0a–0c, затем 1–6)` → `### 0a` → `### 0b` → `### 0c` → `### 1` → `### 2` → `### 3` → `### 4` → `### 4.5` → `### 5` → `### 6`
5. `## Итоговый summary`
6. `## Частые ошибки`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/publish-version/SKILL.md
git commit -m "feat(publish-version): update summary and error table to reflect changelog flow"
```
