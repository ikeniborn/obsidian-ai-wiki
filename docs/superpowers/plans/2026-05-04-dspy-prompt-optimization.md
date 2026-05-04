# DSPy Prompt Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать скрипты в `scripts/dspy/` для оптимизации промтов из `prompts/*.md` на основе JSONL-логов dev-режима плагина через DSPy MIPROv2.

**Architecture:** Изолированная Python-среда (uv). Читает JSONL-лог с полями `operation`, `userMessage`, `result`, `eval.score`. Для каждой операции запускает MIPROv2 с метрикой через evaluator-LLM. После оптимизации восстанавливает `{{placeholders}}` отдельным LLM-вызовом. Пишет результат в `prompts/optimized/<op>.md`.

**Tech Stack:** Python 3.11, dspy-ai, python-dotenv, pytest, uv

---

## Карта файлов

| Файл | Роль |
|---|---|
| `scripts/dspy/pyproject.toml` | uv project: зависимости, entrypoint |
| `scripts/dspy/.python-version` | pin Python 3.11 |
| `scripts/dspy/.env.example` | все параметры с описанием |
| `scripts/dspy/optimize.py` | CLI точка входа |
| `scripts/dspy/lib/__init__.py` | пустой, делает `lib` пакетом |
| `scripts/dspy/lib/loader.py` | `load_examples()` — чтение JSONL |
| `scripts/dspy/lib/backend.py` | `make_lm()`, `ClaudeCodeLM` |
| `scripts/dspy/lib/signature.py` | `make_signature()` — DSPy Signature |
| `scripts/dspy/lib/optimizer.py` | `call_evaluator()`, `restore_placeholders()`, `run_mipro()` |
| `scripts/dspy/lib/writer.py` | `write_optimized()` |
| `scripts/dspy/tests/test_loader.py` | тесты loader |
| `scripts/dspy/tests/test_backend.py` | тесты backend |
| `scripts/dspy/tests/test_signature.py` | тесты signature |
| `scripts/dspy/tests/test_optimizer.py` | тесты optimizer (без MIPROv2) |
| `scripts/dspy/tests/test_writer.py` | тесты writer |
| `.gitignore` | добавить `scripts/dspy/.venv/` и `scripts/dspy/.env` |

---

## Task 1: Project scaffold

**Files:**
- Create: `scripts/dspy/pyproject.toml`
- Create: `scripts/dspy/.python-version`
- Create: `scripts/dspy/lib/__init__.py`
- Create: `scripts/dspy/tests/__init__.py`
- Modify: `.gitignore`

- [ ] **Step 1: Создать `scripts/dspy/pyproject.toml`**

```toml
[project]
name = "dspy-optimizer"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "dspy-ai>=2.5",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Создать `scripts/dspy/.python-version`**

```
3.11
```

- [ ] **Step 3: Создать пустые `__init__.py`**

```bash
mkdir -p scripts/dspy/lib scripts/dspy/tests
touch scripts/dspy/lib/__init__.py scripts/dspy/tests/__init__.py
```

- [ ] **Step 4: Добавить исключения в `.gitignore`**

Дописать в конец `.gitignore`:

```
scripts/dspy/.venv/
scripts/dspy/.env
```

- [ ] **Step 5: Инициализировать uv-среду**

```bash
cd scripts/dspy
uv sync --extra dev
```

Ожидаемый результат: создана `.venv/`, установлены `dspy-ai` и `pytest`.

- [ ] **Step 6: Коммит**

```bash
git add scripts/dspy/pyproject.toml scripts/dspy/.python-version \
        scripts/dspy/lib/__init__.py scripts/dspy/tests/__init__.py \
        .gitignore
git commit -m "chore: scaffold scripts/dspy uv project"
```

---

## Task 2: loader.py

**Files:**
- Create: `scripts/dspy/lib/loader.py`
- Create: `scripts/dspy/tests/test_loader.py`

- [ ] **Step 1: Написать падающий тест**

`scripts/dspy/tests/test_loader.py`:

```python
import json
import tempfile
import pytest
from lib.loader import load_examples


def _jsonl(entries):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for e in entries:
        f.write(json.dumps(e) + "\n")
    f.close()
    return f.name


def test_groups_by_operation():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
        {"operation": "query",  "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert set(result.keys()) == {"ingest", "query"}
    assert result["ingest"][0]["userMessage"] == "a"


def test_filters_by_operations_arg():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
        {"operation": "query",  "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=["ingest"], min_examples=1)
    assert "ingest" in result
    assert "query" not in result


def test_skips_null_eval():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": None},
        {"operation": "ingest", "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["ingest"]) == 1


def test_excludes_ops_below_min_examples():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=5)
    assert "ingest" not in result


def test_skips_missing_required_fields():
    path = _jsonl([
        {"operation": "ingest", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},  # нет userMessage
        {"operation": "ingest", "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["ingest"]) == 1
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_loader.py -v
```

Ожидаемый результат: `ImportError: cannot import name 'load_examples'`

- [ ] **Step 3: Реализовать `loader.py`**

`scripts/dspy/lib/loader.py`:

```python
import json
from collections import defaultdict


def load_examples(
    log_path: str,
    operations: list[str] | None,
    min_examples: int,
) -> dict[str, list[dict]]:
    """
    Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].
    Отфильтровывает: null eval, отсутствующие поля, операции ниже min_examples.
    Поля в JSONL: operation, userMessage, result, eval.score (camelCase).
    """
    grouped: dict[str, list[dict]] = defaultdict(list)

    with open(log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            op = entry.get("operation")
            if not op:
                continue
            if operations and op not in operations:
                continue
            if not entry.get("userMessage") or not entry.get("result"):
                continue
            if not entry.get("eval") or entry["eval"].get("score") is None:
                continue

            grouped[op].append(entry)

    return {
        op: entries
        for op, entries in grouped.items()
        if len(entries) >= min_examples
    }
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_loader.py -v
```

Ожидаемый результат: `5 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/loader.py scripts/dspy/tests/test_loader.py
git commit -m "feat(dspy): add loader — reads and validates JSONL examples"
```

---

## Task 3: backend.py

**Files:**
- Create: `scripts/dspy/lib/backend.py`
- Create: `scripts/dspy/tests/test_backend.py`

- [ ] **Step 1: Написать падающий тест**

`scripts/dspy/tests/test_backend.py`:

```python
import json
import subprocess
from unittest.mock import MagicMock, patch
import pytest
from lib.backend import ClaudeCodeLM, make_lm


def test_flatten_combines_messages():
    lm = ClaudeCodeLM("/usr/bin/claude", "claude-sonnet-4-6")
    msgs = [
        {"role": "system", "content": "system text"},
        {"role": "user",   "content": "user text"},
    ]
    assert lm._flatten(msgs) == "system text\n\nuser text"


def test_call_with_prompt_string():
    lm = ClaudeCodeLM("/usr/bin/claude", "claude-sonnet-4-6")
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            stdout=json.dumps({"result": "optimized", "cost_usd": 0.01}),
            returncode=0,
        )
        result = lm(prompt="hello")
    assert result == ["optimized"]
    args = mock_run.call_args[0][0]
    assert "--print" in args
    assert "--dangerously-skip-permissions" in args
    assert "--tools" in args
    assert "hello" in args


def test_call_with_messages():
    lm = ClaudeCodeLM("/usr/bin/claude", "claude-sonnet-4-6")
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            stdout=json.dumps({"result": "response"}),
            returncode=0,
        )
        lm(messages=[{"role": "user", "content": "msg"}])
    args = mock_run.call_args[0][0]
    assert "msg" in args


def test_make_lm_ollama(monkeypatch):
    import dspy
    monkeypatch.setenv("DSPY_BACKEND", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "llama3.2")
    with patch.object(dspy, "LM") as mock_lm:
        make_lm()
        mock_lm.assert_called_once_with(
            model="ollama/llama3.2",
            base_url="http://localhost:11434",
            api_key="ollama",
        )


def test_make_lm_claude_code(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "claude-code")
    monkeypatch.setenv("CLAUDE_PATH", "/usr/bin/claude")
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    lm = make_lm()
    assert isinstance(lm, ClaudeCodeLM)
    assert lm.claude_path == "/usr/bin/claude"
    assert lm.model == "claude-sonnet-4-6"


def test_make_lm_raises_on_unknown_backend(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "unknown")
    with pytest.raises(ValueError, match="DSPY_BACKEND"):
        make_lm()
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_backend.py -v
```

Ожидаемый результат: `ImportError: cannot import name 'ClaudeCodeLM'`

- [ ] **Step 3: Реализовать `backend.py`**

`scripts/dspy/lib/backend.py`:

```python
import json
import os
import subprocess
import dspy


class ClaudeCodeLM:
    """DSPy-совместимый LM через claude CLI. Не требует API-ключа."""

    def __init__(self, claude_path: str, model: str):
        self.claude_path = claude_path
        self.model = model
        self.history: list[dict] = []

    def __call__(self, prompt: str = "", messages: list[dict] | None = None, **kwargs) -> list[str]:
        full_prompt = self._flatten(messages) if messages else prompt
        proc = subprocess.run(
            [
                self.claude_path,
                "--print",
                "--dangerously-skip-permissions",
                "--tools", "",
                "--model", self.model,
                "--output-format", "json",
                full_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        result = json.loads(proc.stdout)["result"]
        self.history.append({"prompt": full_prompt, "response": result})
        return [result]

    def _flatten(self, messages: list[dict]) -> str:
        return "\n\n".join(m["content"] for m in messages)


def make_lm() -> dspy.LM | ClaudeCodeLM:
    """Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()."""
    backend = os.environ.get("DSPY_BACKEND", "ollama")

    if backend == "ollama":
        return dspy.LM(
            model=f"ollama/{os.environ['OLLAMA_MODEL']}",
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            api_key="ollama",
        )

    if backend == "claude-code":
        return ClaudeCodeLM(
            claude_path=os.environ["CLAUDE_PATH"],
            model=os.environ["CLAUDE_MODEL"],
        )

    raise ValueError(f"DSPY_BACKEND='{backend}' не поддерживается. Допустимые значения: ollama, claude-code")
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_backend.py -v
```

Ожидаемый результат: `5 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/backend.py scripts/dspy/tests/test_backend.py
git commit -m "feat(dspy): add backend — Ollama and ClaudeCode LM adapters"
```

---

## Task 4: signature.py

**Files:**
- Create: `scripts/dspy/lib/signature.py`
- Create: `scripts/dspy/tests/test_signature.py`

- [ ] **Step 1: Написать падающий тест**

`scripts/dspy/tests/test_signature.py`:

```python
import dspy
from lib.signature import make_signature


def test_make_signature_sets_instructions():
    sig = make_signature("custom instruction text")
    assert "custom instruction text" in sig.instructions


def test_make_signature_has_required_fields():
    sig = make_signature("some instruction")
    assert "user_message" in sig.input_fields
    assert "result" in sig.output_fields


def test_make_signature_is_dspy_signature():
    sig = make_signature("instruction")
    assert issubclass(sig, dspy.Signature)


def test_different_instructions_produce_different_signatures():
    sig_a = make_signature("instruction A")
    sig_b = make_signature("instruction B")
    assert sig_a.instructions != sig_b.instructions
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_signature.py -v
```

Ожидаемый результат: `ImportError: cannot import name 'make_signature'`

- [ ] **Step 3: Реализовать `signature.py`**

`scripts/dspy/lib/signature.py`:

```python
import dspy


def make_signature(instruction: str) -> type[dspy.Signature]:
    """Возвращает DSPy Signature с заданной инструкцией (системным промтом)."""

    class WikiOperation(dspy.Signature):
        user_message: str = dspy.InputField(desc="Task input for the wiki operation")
        result: str = dspy.OutputField(desc="Operation result")

    return WikiOperation.with_instructions(instruction)
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_signature.py -v
```

Ожидаемый результат: `4 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/signature.py scripts/dspy/tests/test_signature.py
git commit -m "feat(dspy): add signature — WikiOperation DSPy Signature"
```

---

## Task 5: optimizer.py — call_evaluator и restore_placeholders

**Files:**
- Create: `scripts/dspy/lib/optimizer.py` (частично)
- Create: `scripts/dspy/tests/test_optimizer.py`

- [ ] **Step 1: Написать падающие тесты**

`scripts/dspy/tests/test_optimizer.py`:

```python
import re
import pytest
from lib.optimizer import call_evaluator, restore_placeholders


class MockLM:
    def __init__(self, response: str):
        self._response = response

    def __call__(self, prompt="", messages=None, **kwargs):
        return [self._response]


EVALUATOR_TEMPLATE = """\
Операция: {{operation}}
Входное задание:
{{task_input}}
Результат:
{{result}}
Верни JSON: {"score": <0-10>, "reasoning": "<строка>"}
"""


def test_call_evaluator_parses_score():
    lm = MockLM('{"score": 8, "reasoning": "хорошо"}')
    score = call_evaluator(lm, "ingest", "задание", "результат", EVALUATOR_TEMPLATE)
    assert score == 8.0


def test_call_evaluator_renders_template_vars():
    captured = []
    class CaptureLM:
        def __call__(self, prompt="", messages=None, **kwargs):
            captured.append(prompt)
            return ['{"score": 5, "reasoning": "ok"}']

    call_evaluator(CaptureLM(), "query", "мой вопрос", "мой ответ", EVALUATOR_TEMPLATE)
    assert "query" in captured[0]
    assert "мой вопрос" in captured[0]
    assert "мой ответ" in captured[0]


def test_call_evaluator_returns_zero_on_invalid_json():
    lm = MockLM("не JSON ответ")
    score = call_evaluator(lm, "ingest", "задание", "результат", EVALUATOR_TEMPLATE)
    assert score == 0.0


def test_call_evaluator_clamps_score():
    lm = MockLM('{"score": 15, "reasoning": "слишком высоко"}')
    score = call_evaluator(lm, "ingest", "задание", "результат", EVALUATOR_TEMPLATE)
    assert score == 10.0


def test_restore_placeholders_injects_all():
    original = "Ты ассистент домена {{domain_name}}.\n{{entity_types_block}}"
    optimized = "Ты улучшенный ассистент для указанного домена."
    lm = MockLM("Ты улучшенный ассистент домена {{domain_name}}.\n{{entity_types_block}}")
    result = restore_placeholders(lm, original, optimized)
    assert "{{domain_name}}" in result
    assert "{{entity_types_block}}" in result


def test_restore_placeholders_raises_if_missing():
    original = "Текст с {{placeholder}}"
    optimized = "Улучшенный текст"
    lm = MockLM("Улучшенный текст без плейсхолдера")
    with pytest.raises(ValueError, match="Placeholders not restored"):
        restore_placeholders(lm, original, optimized)
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_optimizer.py -v
```

Ожидаемый результат: `ImportError: cannot import name 'call_evaluator'`

- [ ] **Step 3: Реализовать `call_evaluator` и `restore_placeholders` в `optimizer.py`**

`scripts/dspy/lib/optimizer.py`:

```python
import re
import dspy
from lib.signature import make_signature

_RESTORE_PROMPT = """\
Below is the ORIGINAL prompt template (contains {{placeholders}} that must be preserved) \
and an OPTIMIZED version (placeholders may be missing).

ORIGINAL:
{original}

OPTIMIZED:
{optimized}

Required placeholders: {placeholders}

Rewrite the OPTIMIZED text so that ALL required placeholders appear at semantically \
appropriate locations. Keep the improved wording from OPTIMIZED. \
Return ONLY the rewritten template text, no explanation.
"""


def call_evaluator(
    lm,
    operation: str,
    user_message: str,
    result: str,
    evaluator_template: str,
) -> float:
    """
    Вызывает LM с evaluator-промтом. Возвращает score 0.0–10.0.
    Возвращает 0.0 если ответ не распарсился.
    """
    prompt = (
        evaluator_template
        .replace("{{operation}}", operation)
        .replace("{{task_input}}", user_message)
        .replace("{{result}}", result)
    )
    try:
        response = lm(prompt=prompt)
        text = response[0] if response else ""
        match = re.search(r'"score"\s*:\s*(\d+(?:\.\d+)?)', text)
        if not match:
            return 0.0
        return min(10.0, float(match.group(1)))
    except Exception:
        return 0.0


def restore_placeholders(lm, original: str, optimized: str) -> str:
    """
    Восстанавливает {{placeholders}} из original в optimized через LLM-вызов.
    Бросает ValueError если какой-либо плейсхолдер отсутствует в результате.
    """
    placeholders = re.findall(r'\{\{(\w+)\}\}', original)
    if not placeholders:
        return optimized

    placeholder_list = ", ".join(f"{{{{{p}}}}}" for p in placeholders)
    prompt = _RESTORE_PROMPT.format(
        original=original,
        optimized=optimized,
        placeholders=placeholder_list,
    )
    response = lm(prompt=prompt)
    restored = response[0] if response else optimized

    missing = [p for p in placeholders if f"{{{{{p}}}}}" not in restored]
    if missing:
        raise ValueError(f"Placeholders not restored: {missing}")

    return restored
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_optimizer.py -v
```

Ожидаемый результат: `7 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/optimizer.py scripts/dspy/tests/test_optimizer.py
git commit -m "feat(dspy): add call_evaluator and restore_placeholders"
```

---

## Task 6: optimizer.py — run_mipro

**Files:**
- Modify: `scripts/dspy/lib/optimizer.py` (добавить `run_mipro`)

Эта функция оборачивает MIPROv2. Тест unit-уровня недостаточен (требует реального LLM). Добавляем smoke-тест с mock DSPy.

- [ ] **Step 1: Написать падающий тест**

Добавить в `scripts/dspy/tests/test_optimizer.py`:

```python
from unittest.mock import MagicMock, patch
from lib.optimizer import run_mipro


def test_run_mipro_returns_string():
    lm = MockLM('{"score": 8, "reasoning": "ok"}')

    mock_compiled = MagicMock()
    mock_compiled.signature.instructions = "optimized instruction {{domain_name}}"

    with patch("dspy.MIPROv2") as mock_mipro_cls:
        mock_optimizer = MagicMock()
        mock_optimizer.compile.return_value = mock_compiled
        mock_mipro_cls.return_value = mock_optimizer

        result = run_mipro(
            lm=lm,
            operation="ingest",
            trainset=[
                {"userMessage": "a", "result": "b", "eval": {"score": 8}},
                {"userMessage": "c", "result": "d", "eval": {"score": 7}},
            ],
            template_content="Системный промт для {{domain_name}}.",
            evaluator_template=EVALUATOR_TEMPLATE,
        )

    assert isinstance(result, str)
    assert "{{domain_name}}" in result
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_optimizer.py::test_run_mipro_returns_string -v
```

Ожидаемый результат: `ImportError` или `AttributeError` для `run_mipro`

- [ ] **Step 3: Добавить `run_mipro` в `optimizer.py`**

Дописать в конец `scripts/dspy/lib/optimizer.py`:

```python
def run_mipro(
    lm,
    operation: str,
    trainset: list[dict],
    template_content: str,
    evaluator_template: str,
) -> str:
    """
    Запускает MIPROv2 для оптимизации template_content.
    Возвращает оптимизированный текст с восстановленными {{placeholders}}.
    """
    dspy.configure(lm=lm)

    sig = make_signature(template_content)
    program = dspy.Predict(sig)

    examples = [
        dspy.Example(
            user_message=entry["userMessage"],
            result=entry["result"],
            score=entry["eval"]["score"],
        ).with_inputs("user_message")
        for entry in trainset
    ]

    def metric(example, prediction, trace=None):
        score = call_evaluator(
            lm, operation,
            example.user_message,
            prediction.result,
            evaluator_template,
        )
        return score / 10.0

    optimizer = dspy.MIPROv2(
        metric=metric,
        auto="light",
        num_threads=1,
    )
    compiled = optimizer.compile(
        program,
        trainset=examples,
        max_bootstrapped_demos=0,
        max_labeled_demos=0,
    )
    optimized_instruction = compiled.signature.instructions

    return restore_placeholders(lm, template_content, optimized_instruction)
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_optimizer.py -v
```

Ожидаемый результат: `8 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/optimizer.py
git commit -m "feat(dspy): add run_mipro — MIPROv2 with placeholder restoration"
```

---

## Task 7: writer.py

**Files:**
- Create: `scripts/dspy/lib/writer.py`
- Create: `scripts/dspy/tests/test_writer.py`

- [ ] **Step 1: Написать падающий тест**

`scripts/dspy/tests/test_writer.py`:

```python
import os
import tempfile
from pathlib import Path
from lib.writer import write_optimized


def test_write_creates_file():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = write_optimized("ingest", "optimized content", tmpdir)
        assert path.name == "ingest.md"
        assert path.read_text(encoding="utf-8") == "optimized content"


def test_write_creates_output_dir_if_missing():
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = os.path.join(tmpdir, "optimized")
        write_optimized("query", "content", output_dir)
        assert os.path.isdir(output_dir)


def test_write_returns_path_object():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = write_optimized("lint", "text", tmpdir)
        assert isinstance(result, Path)


def test_write_overwrites_existing():
    with tempfile.TemporaryDirectory() as tmpdir:
        write_optimized("ingest", "first", tmpdir)
        write_optimized("ingest", "second", tmpdir)
        path = Path(tmpdir) / "ingest.md"
        assert path.read_text(encoding="utf-8") == "second"
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

```bash
cd scripts/dspy
uv run pytest tests/test_writer.py -v
```

Ожидаемый результат: `ImportError: cannot import name 'write_optimized'`

- [ ] **Step 3: Реализовать `writer.py`**

`scripts/dspy/lib/writer.py`:

```python
from pathlib import Path


def write_optimized(operation: str, text: str, output_dir: str) -> Path:
    """Записывает оптимизированный промт в output_dir/<operation>.md."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{operation}.md"
    path.write_text(text, encoding="utf-8")
    return path
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

```bash
cd scripts/dspy
uv run pytest tests/test_writer.py -v
```

Ожидаемый результат: `4 passed`

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/lib/writer.py scripts/dspy/tests/test_writer.py
git commit -m "feat(dspy): add writer — saves optimized prompts to output_dir"
```

---

## Task 8: optimize.py и .env.example

**Files:**
- Create: `scripts/dspy/optimize.py`
- Create: `scripts/dspy/.env.example`

- [ ] **Step 1: Создать `.env.example`**

`scripts/dspy/.env.example`:

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

- [ ] **Step 2: Реализовать `optimize.py`**

`scripts/dspy/optimize.py`:

```python
#!/usr/bin/env python3
"""
DSPy prompt optimizer.
Читает JSONL dev-лог, оптимизирует промты через MIPROv2, пишет в prompts/optimized/.

Все параметры берутся из .env. CLI-аргументы имеют приоритет.
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from lib.backend import make_lm
from lib.loader import load_examples
from lib.optimizer import run_mipro
from lib.writer import write_optimized


def _get(arg_val, env_key: str, default: str | None = None) -> str | None:
    return arg_val if arg_val is not None else os.environ.get(env_key, default)


def main() -> None:
    parser = argparse.ArgumentParser(description="DSPy prompt optimizer")
    parser.add_argument("--log",          help="Путь к JSONL-логу (переопределяет DEV_LOG_PATH)")
    parser.add_argument("--operations",   help="Операции через запятую (переопределяет OPERATIONS)")
    parser.add_argument("--min-examples", type=int, help="Минимум примеров (переопределяет MIN_EXAMPLES)")
    parser.add_argument("--prompts-dir",  help="Папка с шаблонами (переопределяет PROMPTS_DIR)")
    parser.add_argument("--output-dir",   help="Папка для вывода (переопределяет OUTPUT_DIR)")
    args = parser.parse_args()

    log_path    = _get(args.log, "DEV_LOG_PATH")
    ops_raw     = _get(args.operations, "OPERATIONS", "")
    min_ex      = args.min_examples or int(os.environ.get("MIN_EXAMPLES", "5"))
    prompts_dir = _get(args.prompts_dir, "PROMPTS_DIR", "../../prompts")
    output_dir  = _get(args.output_dir,  "OUTPUT_DIR",  "../../prompts/optimized")

    if not log_path:
        print("ERROR: задайте DEV_LOG_PATH в .env или передайте --log", file=sys.stderr)
        sys.exit(1)

    operations = [o.strip() for o in ops_raw.split(",") if o.strip()] if ops_raw else None

    evaluator_template = Path(prompts_dir, "evaluator.md").read_text(encoding="utf-8")

    print(f"Загрузка примеров из {log_path}...")
    grouped = load_examples(log_path, operations=operations, min_examples=min_ex)

    if not grouped:
        print("Нет операций с достаточным количеством примеров. Завершение.")
        sys.exit(0)

    lm = make_lm()

    for op, examples in grouped.items():
        print(f"[{op}] {len(examples)} примеров загружено")
        template_path = Path(prompts_dir) / f"{op}.md"
        if not template_path.exists():
            print(f"[{op}] WARNING: {template_path} не найден, пропускаю")
            continue

        template_content = template_path.read_text(encoding="utf-8")
        print(f"[{op}] MIPROv2 запущен (auto=light)...")

        try:
            optimized = run_mipro(
                lm=lm,
                operation=op,
                trainset=examples,
                template_content=template_content,
                evaluator_template=evaluator_template,
            )
        except ValueError as e:
            print(f"[{op}] ERROR: {e}")
            continue

        print(f"[{op}] Оптимизация завершена. Запись...")
        out_path = write_optimized(op, optimized, output_dir)
        print(f"[{op}] ✓ Записано: {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Проверить синтаксис скрипта**

```bash
cd scripts/dspy
uv run python -c "import optimize; print('OK')"
```

Ожидаемый результат: `OK`

- [ ] **Step 4: Запустить все тесты**

```bash
cd scripts/dspy
uv run pytest tests/ -v
```

Ожидаемый результат: `23 passed` (все задачи вместе)

- [ ] **Step 5: Коммит**

```bash
git add scripts/dspy/optimize.py scripts/dspy/.env.example
git commit -m "feat(dspy): add optimize.py entrypoint and .env.example"
```

---

## Task 9: Финальный smoke-тест и документация в README

**Files:**
- Modify: `scripts/dspy/pyproject.toml` (добавить `[tool.pytest]`)

- [ ] **Step 1: Добавить конфигурацию pytest в `pyproject.toml`**

Дописать в `scripts/dspy/pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Проверить запуск без аргументов с ошибкой о DEV_LOG_PATH**

```bash
cd scripts/dspy
uv run python optimize.py 2>&1
```

Ожидаемый результат:

```
ERROR: задайте DEV_LOG_PATH в .env или передайте --log
```

- [ ] **Step 3: Проверить справку CLI**

```bash
cd scripts/dspy
uv run python optimize.py --help
```

Ожидаемый результат: вывод argparse с описанием всех флагов.

- [ ] **Step 4: Запустить полный тест-сьют**

```bash
cd scripts/dspy
uv run pytest tests/ -v --tb=short
```

Ожидаемый результат: все тесты зелёные.

- [ ] **Step 5: Финальный коммит**

```bash
git add scripts/dspy/pyproject.toml
git commit -m "chore(dspy): add pytest config to pyproject.toml"
```

---

## Проверка покрытия спецификации

| Требование спеки | Задача |
|---|---|
| Структура `scripts/dspy/` | Task 1 |
| `.env` как источник всех параметров | Task 8 |
| CLI-аргументы перекрывают env | Task 8 (`_get()`) |
| Бэкенд ollama | Task 3 |
| Бэкенд claude-code (без API-ключа) | Task 3 |
| `DEV_LOG_PATH` в env | Task 8 |
| Чтение camelCase-полей из JSONL | Task 2 |
| Фильтр по `--operations` | Task 2 |
| `--min-examples` с дефолтом 5 | Task 2 + Task 8 |
| DSPy Signature с динамической инструкцией | Task 4 |
| MIPROv2 только инструкция (без few-shot) | Task 6 |
| Метрика через evaluator-LLM | Task 5 |
| Восстановление `{{placeholders}}` | Task 5 |
| Валидация плейсхолдеров | Task 5 |
| Запись в `prompts/optimized/` | Task 7 |
| Вывод прогресса в stdout | Task 8 |
