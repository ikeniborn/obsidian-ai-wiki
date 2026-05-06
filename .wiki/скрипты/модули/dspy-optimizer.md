---
wiki_sources:
  - "scripts/dspy/optimize.py"
  - "scripts/dspy/lib/loader.py"
  - "scripts/dspy/lib/backend.py"
  - "scripts/dspy/lib/optimizer.py"
  - "scripts/dspy/lib/signature.py"
  - "scripts/dspy/lib/writer.py"
  - "scripts/dspy/README.md"
  - "scripts/dspy/pyproject.toml"
  - "scripts/dspy/tests/test_optimizer.py"
  - "scripts/dspy/tests/test_backend.py"
  - "scripts/dspy/tests/test_loader.py"
  - "scripts/dspy/tests/test_signature.py"
  - "scripts/dspy/tests/test_writer.py"
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[dspy-env-config]]"
  - "[[dspy-mipro-pipeline]]"
wiki_external_links:
  - "https://dspy.ai"
tags:
  - scripts
  - dspy
  - python
  - optimization
aliases:
  - "DSPy Optimizer"
  - "optimize.py"
  - "dspy-prompt-optimizer"
---

# DSPy Prompt Optimizer

Python-скрипт (`scripts/dspy/`), который автоматически улучшает системные промпты операций llm-wiki через DSPy MIPROv2 на основе накопленных примеров из dev-лога. Реализует паттерн: примеры из JSONL → оптимизация Optuna → улучшенный промпт на диск.

## Основные характеристики

| Файл | Роль |
|---|---|
| `optimize.py` | Точка входа — CLI-парсинг аргументов, оркестрация pipeline |
| `lib/loader.py` | Чтение и фильтрация JSONL-лога |
| `lib/backend.py` | `make_lm()` + `ClaudeCodeLM` адаптер |
| `lib/signature.py` | DSPy Signature с полями `user_message → result` |
| `lib/optimizer.py` | `run_mipro()`, `call_evaluator()`, `restore_placeholders()` |
| `lib/writer.py` | Запись результата в файл |

### Зависимости

- `dspy-ai >= 2.5` — MIPROv2, Optuna-backed оптимизация
- `python-dotenv >= 1.0` — загрузка конфигурации из `.env`
- `optuna >= 4.0` — backend для перебора вариантов инструкции

Требует Python >= 3.11. Запуск через `uv run optimize.py`.

### Модуль loader.py

`load_examples(log_path, operations, min_examples)` — читает JSONL построчно, фильтрует строки без обязательных полей (`operation`, `userMessage`, `result`, `eval.score`), группирует по операции. Возвращает только операции с количеством примеров >= `min_examples`.

### Модуль backend.py

`make_lm()` — фабрика LM-объекта по переменной `DSPY_BACKEND`:
- `ollama` → `dspy.LM(model="ollama/{OLLAMA_MODEL}", ...)` — локальный inference, без API-ключа
- `claude-code` → `ClaudeCodeLM(claude_path, model)` — через установленный `claude` CLI

`ClaudeCodeLM(dspy.BaseLM)` — DSPy-совместимый адаптер для Claude CLI. Метод `forward()` запускает `subprocess.run(claude -- --print --dangerously-skip-permissions --model ... --output-format json ...)`, парсит последнюю JSON-строку из stdout, возвращает `result`-поле. Flatten messages через `\n\n`-конкатенацию.

### Модуль optimizer.py

Три функции:

**`call_evaluator(lm, operation, user_message, result, evaluator_template)`** — рендерит шаблон оценщика, вызывает LM, парсит `"score"` из JSON-ответа через regex. Clamping: max 10.0.

**`restore_placeholders(lm, original, optimized)`** — после оптимизации MIPROv2 может потерять `{{placeholder}}`-переменные. Функция находит все плейсхолдеры regex'ом в `original`, проверяет их наличие в `optimized`. Если что-то пропало — вызывает LM с промптом восстановления, проверяет результат. Бросает `ValueError` если плейсхолдеры не восстановлены.

**`run_mipro(lm, operation, trainset, template_content, evaluator_template)`** — основная оптимизация: конфигурирует `dspy.configure(lm=lm)`, создаёт `dspy.Predict(sig)`, превращает trainset в `dspy.Example`, запускает `MIPROv2(auto="light", num_threads=1).compile(max_bootstrapped_demos=0, max_labeled_demos=0)`, возвращает `restore_placeholders(optimized_instruction)`.

### Модуль signature.py

`make_signature(instruction)` — динамически создаёт подкласс `dspy.Signature` с двумя полями: `user_message` (InputField) и `result` (OutputField), переопределяет инструкцию через `with_instructions(instruction)`.

### Модуль writer.py

`write_optimized(operation, text, output_dir)` — создаёт `output_dir` при необходимости, записывает `text` в `{output_dir}/{operation}.md` в UTF-8.

## Применение в контексте скрипты

Запуск:

```bash
cd scripts/dspy
uv sync
cp .env.example .env
uv run optimize.py
```

Или через аргументы без `.env`:

```bash
uv run optimize.py \
  --log /path/to/dev.jsonl \
  --operations ingest,query \
  --prompts-dir /path/to/prompts \
  --output-dir /path/to/prompts/optimized
```

Приоритет: CLI-аргументы переопределяют переменные окружения.

## Тесты

Тесты в `tests/` используют `pytest` + `unittest.mock`. Все тесты изолированы — DSPy, subprocess и файловая система мокируются.

### test_optimizer.py

Покрывает `call_evaluator`, `restore_placeholders`, `run_mipro`:

- Парсинг `"score"` из JSON-ответа LM; clamping max 10.0
- Возврат `0.0` при невалидном JSON (нет regex-совпадения)
- Подстановка `{{operation}}`, `{{task_input}}`, `{{result}}` в evaluator-шаблон перед вызовом LM
- `restore_placeholders`: вызов LM с промптом восстановления если плейсхолдеры исчезли после оптимизации; `ValueError` если плейсхолдеры не восстановлены
- `run_mipro` end-to-end: MIPROv2 мокируется через `patch("lib.optimizer.dspy.MIPROv2")`; проверяется что результат — строка с сохранёнными плейсхолдерами

### test_backend.py

Покрывает `ClaudeCodeLM` и `make_lm()`:

- `_flatten()`: объединяет `content` из messages через `\n\n`
- `lm(prompt=...)` вызов через `__call__`: subprocess mock; проверяется наличие флагов `--print`, `--dangerously-skip-permissions` в argv и наличие prompt в аргументах
- `lm(messages=[...])` вызов через `__call__`: flatten и передача в subprocess
- `make_lm()` с `DSPY_BACKEND=ollama`: проверяет вызов `dspy.LM(model="ollama/{OLLAMA_MODEL}", base_url=..., api_key="ollama")`, env vars задаются через `monkeypatch.setenv`
- `make_lm()` с `DSPY_BACKEND=claude-code`: проверяет создание `ClaudeCodeLM` с атрибутами `claude_path`, `_claude_model` и `model="claude-code/{CLAUDE_MODEL}"`; env vars (`CLAUDE_PATH`, `CLAUDE_MODEL`) задаются через `monkeypatch.setenv`
- `make_lm()` с `DSPY_BACKEND=unknown`: бросает `ValueError` с упоминанием `DSPY_BACKEND`


### test_loader.py

Покрывает `load_examples()` через временные JSONL-файлы:

- Группировка по операции (`ingest`, `query`)
- Фильтрация по аргументу `operations`
- Пропуск строк с `eval: null`
- Исключение операций с количеством примеров ниже `min_examples`
- Пропуск строк без обязательного поля (`userMessage` или `result`)

### test_signature.py

Покрывает `make_signature()`:

- Инструкция передаётся в `sig.instructions`
- Поля `user_message` (input) и `result` (output) присутствуют
- Результат — подкласс `dspy.Signature`
- Разные инструкции → разные `sig.instructions`

### test_writer.py

Покрывает `write_optimized()`:

- Создаёт файл `{output_dir}/{operation}.md` с переданным текстом
- Создаёт `output_dir` если не существует
- Возвращает объект `Path`
- Перезаписывает существующий файл
