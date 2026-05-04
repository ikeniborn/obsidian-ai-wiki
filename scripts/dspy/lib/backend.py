from __future__ import annotations

import json
import os
import subprocess

import dspy


class ClaudeCodeLM:
    """DSPy-совместимый LM через claude CLI. Не требует API-ключа."""

    def __init__(self, claude_path: str, model: str) -> None:
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
