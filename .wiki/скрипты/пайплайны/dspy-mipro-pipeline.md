---
wiki_sources:
  - "scripts/dspy/optimize.py"
  - "scripts/dspy/lib/optimizer.py"
  - "scripts/dspy/lib/loader.py"
  - "scripts/dspy/README.md"
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[dspy-optimizer]]"
  - "[[dspy-env-config]]"
wiki_external_links:
  - "https://dspy.ai"
tags:
  - scripts
  - dspy
  - python
  - optimization
aliases:
  - "MIPROv2 pipeline"
  - "DSPy optimization pipeline"
  - "prompt optimization flow"
---

# DSPy MIPROv2 Оптимизационный пайплайн

Рабочий процесс автоматической оптимизации промптов: от накопленных примеров в JSONL-логе до улучшенного промпта в файловой системе. Реализован в `scripts/dspy/` как последовательность: загрузка → оптимизация → запись.

## Основные характеристики

### Общий поток данных

```
dev-лог (JSONL)
  → loader.py        # читает примеры, фильтрует по операции и min_examples
  → optimizer.py     # запускает MIPROv2 с LLM-оценщиком
  → writer.py        # пишет улучшенный промпт в OUTPUT_DIR/{operation}.md
```

### Шаг 1: Загрузка примеров (loader.py)

`load_examples()` читает JSONL-лог построчно. Для каждой строки:
- Пропускает невалидный JSON
- Пропускает строки без `operation`, `userMessage`, `result`
- Пропускает строки без `eval.score`
- Фильтрует по `operations` если задан список
- Группирует по операции

После чтения отфильтровывает операции с менее чем `min_examples` примеров (default: 5).

### Шаг 2: Оптимизация MIPROv2 (optimizer.py)

`run_mipro()` выполняет оптимизацию инструкции:

1. `dspy.configure(lm=lm)` — конфигурирует глобальный LM
2. `make_signature(template_content)` — создаёт DSPy Signature с текущим промптом как инструкцией
3. `dspy.Predict(sig)` — программа с одним predict-шагом
4. Преобразование trainset: каждый `{"userMessage": ..., "result": ..., "eval": {"score": ...}}` → `dspy.Example(...).with_inputs("user_message")`
5. `MIPROv2(metric=metric, auto="light", num_threads=1)` — оптимизатор с LLM-оценщиком как метрикой
6. `optimizer.compile(max_bootstrapped_demos=0, max_labeled_demos=0)` — оптимизирует только инструкцию, без демонстрационных примеров
7. Извлечение `compiled.signature.instructions` — оптимизированный текст инструкции

### Шаг 3: Восстановление плейсхолдеров

После MIPROv2 из оптимизированной инструкции могут исчезнуть `{{placeholder}}`-переменные (вроде `{{domain_name}}`, `{{entity_types_block}}`). Функция `restore_placeholders()`:

1. Находит все `{{...}}` в оригинальном шаблоне
2. Проверяет их наличие в оптимизированном тексте
3. Если что-то пропало — вызывает LM с промптом: «Rewrite OPTIMIZED so that ALL required placeholders appear»
4. Проверяет результат, бросает `ValueError` если плейсхолдеры всё ещё отсутствуют

### Шаг 4: Запись результата (writer.py)

`write_optimized(operation, text, output_dir)` — создаёт `output_dir` при необходимости, пишет оптимизированный промпт в `{output_dir}/{operation}.md`.

### Метрика оценки (call_evaluator)

На каждой итерации Optuna для оценки кандидата-инструкции:
1. Рендерит `evaluator_template` подстановкой `{{operation}}`, `{{task_input}}`, `{{result}}`
2. Вызывает LM с оценочным промптом
3. Парсит `"score"` из JSON-ответа regex'ом `"score"\s*:\s*(\d+(?:\.\d+)?)`
4. Нормализует: `score / 10.0` → значение метрики [0, 1]

## Применение в контексте скрипты

### Формат входного JSONL

Каждая строка — один пример:

```json
{"operation": "ingest", "userMessage": "Добавь статью про трансформеры", "result": "Создана страница transformer.md", "eval": {"score": 8.5, "reasoning": "Верно определил домен"}}
```

Поля `operation`, `userMessage`, `result`, `eval.score` обязательны.

### Результат оптимизации

Оптимизированные промпты записываются в `OUTPUT_DIR/{operation}.md`. Структура совпадает с оригинальными промптами в `PROMPTS_DIR`, но инструкция переписана MIPROv2 для повышения оценки LLM-судьи.
