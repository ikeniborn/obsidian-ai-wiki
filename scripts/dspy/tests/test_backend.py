from __future__ import annotations

from unittest.mock import patch

import pytest
from lib.backend import make_lm


def test_make_lm_ollama(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "llama3.2")
    with patch("lib.backend.dspy.LM") as mock_lm:
        make_lm()
        mock_lm.assert_called_once_with(
            model="ollama/llama3.2",
            base_url="http://localhost:11434",
            api_key="ollama",
        )


def test_make_lm_rejects_removed_claude_code_backend(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "claude-code")
    monkeypatch.setenv("CLAUDE_PATH", "/usr/bin/claude")
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    with pytest.raises(ValueError, match="ollama, ollama-openai"):
        make_lm()


def test_make_lm_raises_on_unknown_backend(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "unknown")
    with pytest.raises(ValueError, match="DSPY_BACKEND"):
        make_lm()
