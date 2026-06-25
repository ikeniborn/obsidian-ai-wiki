from __future__ import annotations
import json
from collections import defaultdict


def _bucket(entry: dict) -> str:
    """Group key: format runs split by vision on/off; others by operation."""
    op = entry.get("operation")
    if op == "format":
        return "format:vision-on" if entry.get("vision") == "on" else "format:vision-off"
    return str(op)


def load_examples(
    log_path: str,
    operations: list[str] | None,
    min_examples: int,
) -> dict[str, list[dict]]:
    """
    Read the eval.jsonl dataset, group by bucket (operation, with format split by
    vision on/off), keep only records carrying a 👍/👎 `rating`. Skips legacy
    judge-score lines (no `rating`). Fields: operation, question, answer, rating,
    recognitionRating?, vision?, promptVersion, visionPromptVersion?.
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
            # require a human label (👍/👎); skip legacy/unlabeled rows
            if entry.get("rating") not in ("up", "down"):
                continue

            grouped[_bucket(entry)].append(entry)

    return {
        b: entries
        for b, entries in grouped.items()
        if len(entries) >= min_examples
    }
