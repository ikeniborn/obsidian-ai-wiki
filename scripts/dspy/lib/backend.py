from __future__ import annotations

import os

import dspy


def make_lm():
    """Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()."""
    backend = os.environ.get("DSPY_BACKEND", "ollama")

    if backend == "ollama":
        return dspy.LM(
            model=f"ollama/{os.environ['OLLAMA_MODEL']}",
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            api_key="ollama",
        )

    if backend == "ollama-openai":
        base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        key = os.environ.get("OLLAMA_API_KEY", "ollama")
        return dspy.LM(
            model=f"openai/{os.environ['OLLAMA_MODEL']}",
            base_url=f"{base}/v1",
            api_key=f"{key}",
        )

    raise ValueError(
        f"DSPY_BACKEND='{backend}' не поддерживается. Допустимые значения: ollama, ollama-openai"
    )
