# README: ценностное предложение + ссылка на docs/dev.md — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить ценностный блок в README.md и заменить blockquote-ссылку в конце на секцию `## Документация`.

**Architecture:** Два точечных изменения в одном файле `README.md`. Тесты не нужны — изменения документационные, верификация визуальная (рендер на GitHub / локально).

**Tech Stack:** Markdown, git

---

### Task 1: Вставить ценностный блок

**Files:**
- Modify: `README.md:3-5` (вставка после строки 3, перед blockquote бэкендов)

- [ ] **Step 1: Открыть README.md и найти позицию вставки**

Строки 1–5 сейчас выглядят так:
```
1: # LLM Wiki — плагин Obsidian
2: (пустая)
3: Автоматически строит и пополняет wiki-базу знаний из ваших заметок с помощью LLM.
4: (пустая)
5: > Поддерживаемые бэкенды: **Ollama / OpenAI-compatible** (без облака) · **Claude Code** (Anthropic)
```

Вставить **после строки 3** (после описания, перед пустой строкой 4):

```markdown
Автоматически строит и пополняет wiki-базу знаний из ваших заметок с помощью LLM.

Превращает необработанные заметки в структурированную wiki — локально, без облака, без подписок.

**Почему LLM Wiki:**
- **Офлайн по умолчанию** — Ollama или любой OpenAI-compatible сервер; данные не покидают машину
- **Компаундируется** — каждый Ingest обогащает базу; связи и страницы накапливаются сами
- **Прозрачность** — прогресс шагов агента виден в реальном времени в боковой панели
- **Два бэкенда** — Native Agent (Ollama / OpenAI) и Claude Code; переключаются в настройках

> Поддерживаемые бэкенды: **Ollama / OpenAI-compatible** (без облака) · **Claude Code** (Anthropic)
```

- [ ] **Step 2: Применить правку через Edit**

old_string:
```
Автоматически строит и пополняет wiki-базу знаний из ваших заметок с помощью LLM.

> Поддерживаемые бэкенды: **Ollama / OpenAI-compatible** (без облака) · **Claude Code** (Anthropic)
```

new_string:
```
Автоматически строит и пополняет wiki-базу знаний из ваших заметок с помощью LLM.

Превращает необработанные заметки в структурированную wiki — локально, без облака, без подписок.

**Почему LLM Wiki:**
- **Офлайн по умолчанию** — Ollama или любой OpenAI-compatible сервер; данные не покидают машину
- **Компаундируется** — каждый Ingest обогащает базу; связи и страницы накапливаются сами
- **Прозрачность** — прогресс шагов агента виден в реальном времени в боковой панели
- **Два бэкенда** — Native Agent (Ollama / OpenAI) и Claude Code; переключаются в настройках

> Поддерживаемые бэкенды: **Ollama / OpenAI-compatible** (без облака) · **Claude Code** (Anthropic)
```

- [ ] **Step 3: Проверить результат**

Открыть `README.md`, убедиться что:
- Ценностный блок стоит между описанием и blockquote бэкендов
- Нет дублирующихся строк
- Форматирование сохранено

---

### Task 2: Заменить blockquote в конце на секцию ## Документация

**Files:**
- Modify: `README.md` (последняя строка)

- [ ] **Step 1: Применить правку через Edit**

old_string:
```
> Инструкции для разработчиков, сборка и smoke-test чеклист — в [docs/dev.md](docs/dev.md).
```

new_string:
```
## Документация

- [docs/dev.md](docs/dev.md) — сборка, установка, smoke-test чеклист для разработчиков
- [docs/publishing.md](docs/publishing.md) — публикация релиза
```

- [ ] **Step 2: Проверить что оба файла существуют**

```bash
ls docs/dev.md docs/publishing.md
```

Ожидание: оба файла присутствуют без ошибок.

---

### Task 3: Коммит

- [ ] **Step 1: Проверить diff**

```bash
git diff README.md
```

Убедиться: только ожидаемые строки изменены.

- [ ] **Step 2: Закоммитить**

```bash
git add README.md
git commit -m "docs(readme): add value proposition and dev docs section"
```
