from __future__ import annotations

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
    with patch("lib.backend.subprocess.run") as mock_run:
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
    with patch("lib.backend.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            stdout=json.dumps({"result": "response"}),
            returncode=0,
        )
        lm(messages=[{"role": "user", "content": "msg"}])
    args = mock_run.call_args[0][0]
    assert "msg" in args


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
