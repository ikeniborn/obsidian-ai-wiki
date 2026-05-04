from __future__ import annotations

import os
import tempfile
from pathlib import Path

from lib.writer import write_optimized


def test_write_creates_file():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = write_optimized("ingest", "optimized content", tmpdir)
        assert path.name == "ingest.md"
        assert path.read_text(encoding="utf-8") == "optimized content"


def test_write_creates_output_dir_if_missing():
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = os.path.join(tmpdir, "optimized")
        write_optimized("query", "content", output_dir)
        assert os.path.isdir(output_dir)


def test_write_returns_path_object():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = write_optimized("lint", "text", tmpdir)
        assert isinstance(result, Path)


def test_write_overwrites_existing():
    with tempfile.TemporaryDirectory() as tmpdir:
        write_optimized("ingest", "first", tmpdir)
        write_optimized("ingest", "second", tmpdir)
        path = Path(tmpdir) / "ingest.md"
        assert path.read_text(encoding="utf-8") == "second"
