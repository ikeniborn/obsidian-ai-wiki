# DSPy Оптимизация промтов

Скрипт `scripts/dspy/optimize.py` автоматически улучшает промты операций через DSPy MIPROv2.

## Как это работает

1. Читает JSONL-лог с примерами выполненных операций (`DEV_LOG_PATH`)
2. Для каждой операции запускает MIPROv2 — автоматически улучшает инструкции промта
3. Восстанавливает `{{placeholders}}` в оптимизированном тексте
4. Записывает результат в `OUTPUT_DIR/{operation}.md`

## Подготовка

```bash
cd scripts/dspy

# Создать venv и установить зависимости
~/.local/bin/uv venv && source .venv/bin/activate
~/.local/bin/uv pip install -e .

# Скопировать и заполнить конфиг
cp .env.example .env
```

## Конфиг `.env`

### Вариант 1 — ollama (локальная модель)

```bash
DSPY_BACKEND=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

DEV_LOG_PATH=/tmp/llm-wiki-dev.jsonl
PROMPTS_DIR=/абсолютный/путь/к/prompts
OUTPUT_DIR=/абсолютный/путь/к/prompts/optimized
```

### Вариант 2 — claude-code (через CLI, API-ключ не нужен)

```bash
DSPY_BACKEND=claude-code
CLAUDE_PATH=/usr/local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6   # или алиас: sonnet | haiku | opus

DEV_LOG_PATH=/tmp/llm-wiki-dev.jsonl
PROMPTS_DIR=/абсолютный/путь/к/prompts
OUTPUT_DIR=/абсолютный/путь/к/prompts/optimized
```

Обязательные параметры: `PROMPTS_DIR` и `OUTPUT_DIR` — только абсолютные пути.

## Запуск

```bash
# Оптимизировать все операции с >=5 примеров (настройки из .env)
python optimize.py

# Только операция ingest
python optimize.py --operations ingest

# Несколько операций, снизить порог примеров
python optimize.py --operations ingest,query --min-examples 3

# Переопределить пути без редактирования .env
python optimize.py \
  --log /tmp/wiki-log.jsonl \
  --prompts-dir /home/user/prompts \
  --output-dir /home/user/prompts/optimized
```

## Структура prompts-dir

```
PROMPTS_DIR/
├── evaluator.md   # шаблон оценки качества (обязателен)
├── ingest.md      # промт операции ingest
├── query.md       # промт операции query
└── ...
```

`evaluator.md` должен содержать `{{operation}}`, `{{task_input}}`, `{{result}}` и возвращать JSON `{"score": 0-10, "reasoning": "..."}`.

## Формат JSONL-лога

Каждая строка — один пример:

```jsonl
{"operation": "ingest", "userMessage": "...", "result": "...", "eval": {"score": 8}}
{"operation": "query",  "userMessage": "...", "result": "...", "eval": {"score": 6}}
```

Строки без `eval.score` или `userMessage`/`result` пропускаются.

## Тесты

```bash
pytest               # все тесты
pytest tests/test_loader.py -v   # конкретный модуль
```

## Особенности и известные ограничения

- **Время работы**: с бэкендом `claude-code` каждый вызов CLI занимает 30–120 секунд. Полный прогон MIPROv2 (auto=light, 9 trials × 5 примеров) занимает ~40–60 минут.
- **Прокси-баннер в stdout**: если `.env` задаёт прокси-переменные, Claude CLI выводит баннер инициализации прямо в stdout перед JSON-ответом. Скрипт автоматически находит JSON-строку в stdout и игнорирует баннер.
- **Лог dev.jsonl**: если `DEV_LOG_PATH` указывает на несуществующий файл, скрипт завершится с ошибкой. По умолчанию iclaude записывает лог в `tmp/dev.jsonl` относительно корня репозитория.
- **MIN_EXAMPLES**: операции с числом примеров ниже порога молча пропускаются. При 7 примерах `ingest` проходит (≥5), при 2 примерах `query` — нет.
