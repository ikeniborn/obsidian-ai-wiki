from __future__ import annotations
import json
from collections import defaultdict

# Primary 👍/👎 axis per operation — the axis whose rating reflects output-prompt
# quality (mirrors src/eval-log.ts OPERATION_AXES + the spec PRIMARY_AXIS table).
PRIMARY_AXIS: dict[str, str] = {
    "query": "answer",
    "chat": "answer",
    "format": "formatting",
    "ingest": "page",
    "init": "coverage",
    "lint": "fix",
    "lint-chat": "fix",
    "delete": "rebuild",
}


def resolve_signal(entry: dict, axis_override: str | None = None) -> str | None:
    """Resolve the up/down training signal. Precedence: ratings[primary axis]
    (valid up/down) → legacy scalar `rating` → None. `axis_override` selects a
    non-primary axis (e.g. "recognition" for the deferred recognition pass)."""
    op = entry.get("operation")
    axis = axis_override or PRIMARY_AXIS.get(op)
    ratings = entry.get("ratings")
    if isinstance(ratings, dict) and axis and ratings.get(axis) in ("up", "down"):
        return ratings[axis]
    scalar = entry.get("recognitionRating") if axis_override == "recognition" else entry.get("rating")
    if scalar in ("up", "down"):
        return scalar
    return None


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
    vision on/off), keep only records carrying a resolvable up/down signal (per-axis
    ratings map, or legacy scalar `rating`). Skips legacy judge-score lines and
    unlabeled rows. The free-form `comment` is carried through untouched.
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
            # require a resolvable human label (per-axis or legacy scalar)
            if resolve_signal(entry) is None:
                continue

            grouped[_bucket(entry)].append(entry)

    return {
        b: entries
        for b, entries in grouped.items()
        if len(entries) >= min_examples
    }
