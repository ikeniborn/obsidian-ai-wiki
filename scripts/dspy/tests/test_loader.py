import json
import tempfile
import pytest
from lib.loader import load_examples


def _jsonl(entries):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for e in entries:
        f.write(json.dumps(e) + "\n")
    f.close()
    return f.name


def test_groups_by_operation():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
        {"operation": "query",  "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert set(result.keys()) == {"ingest", "query"}
    assert result["ingest"][0]["userMessage"] == "a"


def test_filters_by_operations_arg():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
        {"operation": "query",  "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=["ingest"], min_examples=1)
    assert "ingest" in result
    assert "query" not in result


def test_skips_null_eval():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": None},
        {"operation": "ingest", "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["ingest"]) == 1


def test_excludes_ops_below_min_examples():
    path = _jsonl([
        {"operation": "ingest", "userMessage": "a", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=5)
    assert "ingest" not in result


def test_skips_missing_required_fields():
    path = _jsonl([
        {"operation": "ingest", "result": "b", "eval": {"score": 8, "reasoning": "ok"}},  # нет userMessage
        {"operation": "ingest", "userMessage": "c", "result": "d", "eval": {"score": 7, "reasoning": "ok"}},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert len(result["ingest"]) == 1
