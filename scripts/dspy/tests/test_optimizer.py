from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch
from lib.optimizer import restore_placeholders, run_mipro


class MockLM:
    def __init__(self, response: str = ""):
        self._response = response

    def __call__(self, prompt="", messages=None, **kwargs):
        return [self._response]


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
    # All records have rating="down" so up_examples is empty → 👍-guard is skipped.
    lm = MockLM("optimized instruction {{domain_name}}")

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
                {"question": "a", "answer": "b", "rating": "down"},
                {"question": "c", "answer": "d", "rating": "down"},
            ],
            template_content="Системный промт для {{domain_name}}.",
        )

    assert isinstance(result, str)
    assert "{{domain_name}}" in result


def test_run_mipro_rejects_regression():
    # 👍-guard: original program scores high on the 👍 set, compiled scores low → return None.
    lm = MockLM("")

    mock_program = MagicMock()
    mock_program.return_value.result = "hello world foo"  # jaccard 1.0 vs reference

    mock_compiled = MagicMock()
    mock_compiled.return_value.result = "zzz"             # jaccard 0.0 vs reference
    mock_compiled.signature.instructions = "some optimized instruction"

    with (
        patch("lib.optimizer.dspy.Predict", return_value=mock_program),
        patch("lib.optimizer.dspy.MIPROv2") as mock_mipro_cls,
    ):
        mock_optimizer = MagicMock()
        mock_optimizer.compile.return_value = mock_compiled
        mock_mipro_cls.return_value = mock_optimizer

        result = run_mipro(
            lm=lm,
            operation="ingest",
            trainset=[
                {"question": "q", "answer": "hello world foo", "rating": "up"},
            ],
            template_content="Промт для {{domain_name}}.",
        )

    assert result is None
