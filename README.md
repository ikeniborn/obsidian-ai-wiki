# LLM Wiki — плагин Obsidian

Автоматически строит и пополняет wiki-базу знаний из ваших заметок с помощью LLM.

**Почему LLM Wiki:**
- **Офлайн по умолчанию** — Ollama или любой OpenAI-compatible сервер; данные не покидают машину
- **Компаундируется** — каждый Ingest обогащает базу; связи и страницы накапливаются сами
- **Прозрачность** — прогресс шагов агента виден в реальном времени в боковой панели
- **Два бэкенда** — Native Agent (Ollama / OpenAI) и Claude Code; переключаются в настройках

> Поддерживаемые бэкенды: **Ollama / OpenAI-compatible** (без облака) · **Claude Code** (Anthropic)

## Что умеет

- **Ingest** — разбирает заметку, извлекает сущности (люди, технологии, процессы, термины), создаёт и обновляет wiki-страницы
- **Query** — отвечает на вопрос по базе знаний; опционально сохраняет ответ как новую страницу с `[[WikiLinks]]`
- **Lint** — проверяет качество wiki-домена, находит неполные и устаревшие страницы
- **Init** — инициализирует новый домен с нуля (структура папок, `_schema.md`, `_index.md`)

Прогресс каждой операции виден в реальном времени в боковой панели Obsidian.

---

## Быстрый старт: Native Agent (Ollama)

Не требует внешних аккаунтов — LLM работает локально.

### 1. Установите Ollama

Скачайте с [ollama.com](https://ollama.com) и запустите:

```bash
ollama pull llama3.2
```

### 2. Установите плагин

Скопируйте папку плагина в vault:

```bash
# вариант — симлинк для разработки
ln -s /path/to/obsidian-llm-wiki ~/.config/obsidian/Plugins/obsidian-llm-wiki
```

Или скопируйте папку вручную в `<vault>/.obsidian/plugins/obsidian-llm-wiki/`.

### 3. Включите плагин

Obsidian → Settings → Community plugins → найти «LLM Wiki» → включить.

### 4. Настройте

Settings → LLM Wiki:

| Параметр | Значение |
|---|---|
| Backend | Native Agent (OpenAI-compatible) |
| Base URL | `http://localhost:11434/v1` |
| API Key | `ollama` |
| Модель | `llama3.2` |
| Temperature | `0.2` |
| Max tokens | `4096` |

### 5. Создайте домен

Домен — это пара «папка с источниками → папка wiki». Команда:

`Command Palette` → `LLM Wiki: Init домена` → введите имя домена (например, `work`) → снимите флаг Dry Run → запустите.

Плагин создаст структуру папок и служебные файлы (`_schema.md`, `_index.md`).

### 6. Первый Ingest

1. Откройте любую заметку в Obsidian
2. `Command Palette` → `LLM Wiki: Ingest активного файла`
3. Следите за прогрессом в боковой панели
4. После завершения — новые wiki-страницы появятся в папке домена

---

## Быстрый старт: Claude Code

Для пользователей с установленным [Claude Code CLI](https://claude.ai/code).

### 1. Требования

- Установленный `iclaude.sh` / `iclaude` / `claude` (Claude Code CLI)
- Скилл `llm-wiki` в директории `<repo>/.claude-isolated/skills/llm-wiki/`

### 2. Установите плагин

Аналогично шагам 2–3 секции Native Agent выше.

### 3. Настройте

Settings → LLM Wiki:

| Параметр | Значение |
|---|---|
| Backend | Claude Code |
| Путь к Claude Code | `/home/user/Documents/Project/iclaude/iclaude.sh` |
| Путь к навыку llm-wiki | `/home/user/Documents/Project/iclaude/.claude-isolated/skills/llm-wiki` |
| Модель | `sonnet` |
| Таймауты | `300/300/600/3600` |

### 4. Первый Ingest

Аналогично шагу 6 секции Native Agent выше.

---

## Команды

Все команды доступны через `Command Palette` (Ctrl+P / Cmd+P).

| Команда | Действие | Результат |
|---|---|---|
| `LLM Wiki: Открыть панель` | Показать боковую панель | Живой лог операций, история |
| `LLM Wiki: Ingest активного файла` | Извлечь сущности из текущей заметки | Новые/обновлённые wiki-страницы |
| `LLM Wiki: Query` | Задать вопрос по базе знаний | Ответ в панели с `[[WikiLinks]]` |
| `LLM Wiki: Query + сохранить` | Вопрос + сохранить ответ | Новая wiki-страница, открывается автоматически |
| `LLM Wiki: Lint домена` | Проверить качество wiki | Отчёт о проблемах в панели |
| `LLM Wiki: Init домена` | Инициализировать новый домен | Структура wiki-папок и служебные файлы |
| `LLM Wiki: Отменить операцию` | Остановить текущую операцию | SIGTERM → SIGKILL через 3с |

---

## Справочник настроек

### Общие (оба бэкенда)

| Параметр | Описание | По умолчанию |
|---|---|---|
| Backend | `claude-code` или `native-agent` | `claude-code` |
| Лимит истории | Максимум записей в истории панели | `20` |
| Лог агента (JSONL) | Абсолютный путь к файлу лога; пусто — отключено | — |

### Native Agent

| Параметр | Описание | По умолчанию |
|---|---|---|
| Base URL | OpenAI-compatible endpoint | `http://localhost:11434/v1` |
| API Key | `ollama` для Ollama; `sk-...` для OpenAI | `ollama` |
| Модель | Имя модели: `llama3.2`, `mistral`, `gpt-4o`... | `llama3.2` |
| Temperature | `0.0`–`1.0`. Низкая (`0.1`–`0.3`) = точные факты | `0.2` |
| Max tokens | Макс. токенов в ответе; ≥ 4096 для wiki-страниц | `4096` |
| Top-p | Nucleus sampling `0.0`–`1.0`; пусто = отключено | — |
| Request timeout (сек) | Таймаут HTTP; для больших моделей Ollama ≥ 300 | `300` |
| num_ctx | Размер контекста (только Ollama); пусто = дефолт модели | — |
| System prompt | Системный промпт; перезаписывает встроенный при изменении | встроенный |

### Claude Code

| Параметр | Описание | По умолчанию |
|---|---|---|
| Путь к Claude Code | Полный путь к `iclaude.sh` / `iclaude` / `claude` | — |
| Путь к навыку llm-wiki | Полный путь к папке навыка (содержит `shared/domain-map-*.json`) | — |
| Allowed tools | Список через запятую | `Read,Edit,Write,Glob,Grep` |
| Модель | Пресет (`opus`/`sonnet`/`haiku`) или произвольный ID (`claude-opus-4-7`) | дефолт claude |
| Таймауты | `ingest/query/lint/init` в секундах через `/` | `300/300/600/3600` |
| Показывать raw JSON | Отображать сырые JSON-события в панели | выкл |

---

## Документация

- [docs/dev.md](docs/dev.md) — сборка, установка, smoke-test чеклист для разработчиков
- [docs/publishing.md](docs/publishing.md) — публикация релиза
