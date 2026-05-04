from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch
from lib.optimizer import call_evaluator, restore_placeholders, run_mipro


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


def test_run_mipro_returns_string():
    lm = MockLM('{"score": 8, "reasoning": "ok"}')

    mock_compiled = MagicMock()
    mock_compiled.signature.instructions = "optimized instruction {{domain_name}}"

    with patch("lib.optimizer.dspy.MIPROv2") as mock_mipro_cls:
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
