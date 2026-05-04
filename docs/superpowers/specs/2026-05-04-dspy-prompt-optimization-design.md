# DSPy: оптимизация промтов на основе dev-логов

**Дата**: 2026-05-04  
**Статус**: утверждён

---

## Цель

Автономный Python-скрипт, который читает JSONL-логи dev-режима плагина, запускает DSPy MIPROv2 для оптимизации системных промтов и сохраняет результат в `prompts/optimized/`.

---

## 1. Расположение и структура файлов

```
scripts/dspy/
  pyproject.toml          # uv project: dspy-ai, python-dotenv
  .python-version         # 3.11
  .env.example            # все параметры с описанием
  optimize.py             # точка входа, CLI + main loop
  lib/
    loader.py             # load_examples(log_path, operations, min_examples)
    backend.py            # make_lm(backend, env) → OllamaLM | ClaudeCodeLM
    signature.py          # WikiOperation Signature + with_instructions()
    optimizer.py          # run_mipro() + restore_placeholders()
    writer.py             # write_optimized(op, text, output_dir)
```

`.venv/` и `.env` добавляются в `.gitignore`.

---

## 2. Конфигурация через `.env`

Все параметры описываются в `.env`. CLI-опция имеет приоритет и перекрывает env-переменную. В обычном сценарии достаточно настроить `.env` и запускать `uv run optimize.py` без аргументов.

```dotenv
# --- бэкенд ---
DSPY_BACKEND=ollama          # ollama | claude-code

# ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# claude-code (использует существующую сессию Claude Code, API-ключ не нужен)
CLAUDE_PATH=/usr/local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6

# --- данные ---
DEV_LOG_PATH=/tmp/llm-wiki-dev.jsonl

# --- параметры оптимизации ---
OPERATIONS=ingest,query      # если пусто — все операции из лога
MIN_EXAMPLES=5
PROMPTS_DIR=../../prompts
OUTPUT_DIR=../../prompts/optimized
```

---

## 3. Поток выполнения

```
optimize.py (CLI args > env vars > defaults)
  → loader.py        читает JSONL, фильтрует по operation, проверяет min_examples
  → backend.py       создаёт LM по DSPY_BACKEND
  → для каждой операции:
      optimizer.py   загружает prompts/<op>.md как начальную инструкцию
                     строит trainset из JSONL-примеров
                     запускает MIPROv2
                     извлекает оптимизированную инструкцию
                     восстанавливает {{placeholders}} через LLM-вызов
                     валидирует наличие всех оригинальных плейсхолдеров
      writer.py      пишет в prompts/optimized/<op>.md
```

Вывод в stdout:

```
[ingest] 12 примеров загружено
[ingest] MIPROv2 запущен (auto=light)...
[ingest] Оптимизация завершена. Восстановление плейсхолдеров...
[ingest] ✓ Записано: prompts/optimized/ingest.md
[query]  3 примера — меньше --min-examples=5, пропускаю
```

---

## 4. Бэкенды

### Ollama

Использует `dspy.LM` с OpenAI-совместимым endpoint:

```python
lm = dspy.LM(
    model=f"ollama/{model}",
    base_url=base_url,
    api_key="ollama",
)
```

### Claude Code CLI

Адаптер вызывает `claude` бинарник напрямую (не через `iclaude.sh`):

```python
class ClaudeCodeLM:
    def __call__(self, prompt="", messages=None, **kwargs):
        full_prompt = self._flatten(messages) if messages else prompt
        proc = subprocess.run(
            [self.claude_path, "--print", "--dangerously-skip-permissions",
             "--tools", "", "--model", self.model,
             "--output-format", "json", full_prompt],
            capture_output=True, text=True, timeout=120,
        )
        return [json.loads(proc.stdout)["result"]]

    def _flatten(self, messages):
        return "\n\n".join(m["content"] for m in messages)
```

**Промт передаётся позиционным аргументом** после флагов. `--print` включает non-interactive режим. `--tools ""` отключает все инструменты. Вызов `claude` напрямую — нет конфликта с `-p`/`--proxy` из `iclaude.sh`.

---

## 5. DSPy Signature и MIPROv2

### Signature

```python
class WikiOperation(dspy.Signature):
    """<инструкция задаётся динамически из prompts/<op>.md>"""
    user_message: str = dspy.InputField(desc="Task input")
    result: str = dspy.OutputField(desc="Operation result")

sig = WikiOperation.with_instructions(template_content)
program = dspy.Predict(sig)
```

### Trainset

```python
dspy.Example(
    user_message=entry["user_message"],
    result=entry["result"],
    score=entry["eval"]["score"],   # 0-10, из evaluator-фазы плагина
).with_inputs("user_message")
```

### Метрика

MIPROv2 генерирует новые предсказания под каждым кандидатом инструкции и оценивает их через evaluator-LLM (тот же бэкенд, тот же промт `evaluator.md`):

```python
def make_metric(lm, operation):
    def metric(example, prediction, trace=None):
        score = call_evaluator(lm, operation,
                               example.user_message,
                               prediction.result)
        return score / 10.0
    return metric
```

### MIPROv2

```python
optimizer = dspy.MIPROv2(
    metric=make_metric(lm, operation),
    auto="light",         # мало итераций, подходит для малых датасетов
    num_threads=1,        # последовательно, без параллелизма
)
compiled = optimizer.compile(
    program,
    trainset=trainset,
    max_bootstrapped_demos=0,   # только инструкция, без few-shot
    max_labeled_demos=0,
)
optimized_instruction = compiled.predict.signature.instructions
```

`max_bootstrapped_demos=0` + `max_labeled_demos=0` — оптимизируется **только текст инструкции**.

---

## 6. Восстановление плейсхолдеров

После оптимизации MIPROv2 возвращает инструкцию без `{{placeholders}}`. Восстановление:

```python
# 1. Найти все плейсхолдеры оригинала
placeholders = re.findall(r'\{\{(\w+)\}\}', original_template)

# 2. LLM-вызов для восстановления
restored = call_lm(RESTORE_PROMPT.format(
    original=original_template,
    optimized=optimized_instruction,
    placeholders=", ".join(f"{{{{{p}}}}}" for p in placeholders),
))

# 3. Валидация
missing = [p for p in placeholders if f"{{{{{p}}}}}" not in restored]
if missing:
    raise ValueError(f"Placeholders not restored: {missing}")
```

`RESTORE_PROMPT` просит LLM вставить плейсхолдеры в семантически подходящие места оптимизированного текста, сохраняя его смысл.

---

## 7. CLI

```bash
cd scripts/dspy
uv run optimize.py                          # все параметры из .env
uv run optimize.py --operations ingest      # переопределить операции
uv run optimize.py --log /other/path.jsonl  # переопределить путь к логу
uv run optimize.py --min-examples 10        # переопределить порог
```

Приоритет: CLI arg > env var > default.

---

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `scripts/dspy/pyproject.toml` | новый — uv project |
| `scripts/dspy/.python-version` | новый — 3.11 |
| `scripts/dspy/.env.example` | новый — все параметры |
| `scripts/dspy/optimize.py` | новый — точка входа |
| `scripts/dspy/lib/loader.py` | новый |
| `scripts/dspy/lib/backend.py` | новый |
| `scripts/dspy/lib/signature.py` | новый |
| `scripts/dspy/lib/optimizer.py` | новый |
| `scripts/dspy/lib/writer.py` | новый |
| `.gitignore` | добавить `scripts/dspy/.venv/` и `scripts/dspy/.env` |
