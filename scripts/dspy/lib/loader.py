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
