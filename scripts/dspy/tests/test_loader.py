import json
import tempfile
from lib.loader import load_examples


def _jsonl(entries):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for e in entries:
        f.write(json.dumps(e) + "\n")
    f.close()
    return f.name


def test_groups_by_bucket():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "rating": "up"},
        {"operation": "query", "question": "q2", "answer": "a2", "rating": "down"},
        {"operation": "chat",  "question": "q3", "answer": "a3", "rating": "up"},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert set(result.keys()) == {"query", "chat"}
    assert len(result["query"]) == 2
    assert len(result["chat"]) == 1


def test_filters_by_operations_arg():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "rating": "up"},
        {"operation": "chat",  "question": "q2", "answer": "a2", "rating": "up"},
    ])
    result = load_examples(path, operations=["query"], min_examples=1)
    assert "query" in result
    assert "chat" not in result


def test_skips_unlabeled_and_legacy():
    path = _jsonl([
        # rating: null — should be skipped
        {"operation": "query", "question": "q1", "answer": "a1", "rating": None},
        # no rating key at all — legacy judge line
        {"operation": "query", "question": "q2", "answer": "a2", "score": 7},
        # valid human label — should be kept
        {"operation": "query", "question": "q3", "answer": "a3", "rating": "up"},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert "query" in result
    assert len(result["query"]) == 1
    assert result["query"][0]["question"] == "q3"


def test_excludes_buckets_below_min_examples():
    path = _jsonl([
        {"operation": "query", "question": "q1", "answer": "a1", "rating": "up"},
    ])
    result = load_examples(path, operations=None, min_examples=5)
    assert "query" not in result


def test_format_vision_split():
    path = _jsonl([
        # vision on → format:vision-on
        {"operation": "format", "question": "q1", "answer": "a1", "rating": "up", "vision": "on"},
        # vision off → format:vision-off
        {"operation": "format", "question": "q2", "answer": "a2", "rating": "down", "vision": "off"},
        # no vision field → format:vision-off (falsy path)
        {"operation": "format", "question": "q3", "answer": "a3", "rating": "up"},
    ])
    result = load_examples(path, operations=None, min_examples=1)
    assert "format:vision-on" in result
    assert "format:vision-off" in result
    assert "format" not in result  # plain "format" key must not appear
    assert len(result["format:vision-on"]) == 1
    assert len(result["format:vision-off"]) == 2
