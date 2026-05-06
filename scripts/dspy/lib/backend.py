from __future__ import annotations

import json
import os
import subprocess
from types import SimpleNamespace

import dspy


class ClaudeCodeLM(dspy.BaseLM):
    """DSPy-совместимый LM через claude CLI. Не требует API-ключа."""

    def __init__(self, claude_path: str, model: str) -> None:
        super().__init__(model=f"claude-code/{model}")
        self.claude_path = claude_path
        self._claude_model = model

    def forward(self, prompt: str | None = None, messages: list[dict] | None = None, **kwargs) -> object:
        full_prompt = self._flatten(messages) if messages else (prompt or "")
        proc = subprocess.run(
            [
                self.claude_path,
                "--",
                "--print",
                "--dangerously-skip-permissions",
                "--model", self._claude_model,
                "--output-format", "json",
                full_prompt,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        json_line = next(
            (line for line in reversed(proc.stdout.splitlines()) if line.startswith("{")),
            "",
        )
        if not json_line:
            raise RuntimeError(
                f"claude returned no JSON (exit={proc.returncode}).\n"
                f"stderr: {proc.stderr[-500:]}"
            )
        result = json.loads(json_line)["result"]
        choice = SimpleNamespace(message=SimpleNamespace(content=result))
        return SimpleNamespace(choices=[choice], model=self.model)

    def _flatten(self, messages: list[dict]) -> str:
        return "\n\n".join(m["content"] for m in messages)


def make_lm():
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

    raise ValueError(
        f"DSPY_BACKEND='{backend}' не поддерживается. Допустимые значения: ollama, claude-code"
    )
