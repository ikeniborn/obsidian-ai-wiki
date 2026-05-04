from __future__ import annotations

from pathlib import Path


def write_optimized(operation: str, text: str, output_dir: str) -> Path:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{operation}.md"
    path.write_text(text, encoding="utf-8")
    return path
