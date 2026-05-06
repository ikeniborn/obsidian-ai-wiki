# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make sync          # uv sync — install/update dependencies
make run           # uv run optimize.py — run optimizer with .env config
make test          # uv run pytest — run all tests

uv run pytest tests/test_backend.py   # single test file
uv run pytest -k test_name            # single test by name
```

Run optimizer with explicit args (no .env needed):
```bash
uv run optimize.py \
  --log /path/to/dev.jsonl \
  --operations ingest,query \
  --prompts-dir /path/to/prompts \
  --output-dir /path/to/output
```

## Architecture

**Purpose:** DSPy MIPROv2-based prompt optimizer. Reads accumulated examples from a JSONL dev log, optimizes system prompts for llm-wiki operations, writes results to output directory.

**Pipeline:**
```
dev.jsonl → loader.py → optimizer.py (MIPROv2 + LLM evaluator) → writer.py → {operation}.md
```

**Key modules:**
- `optimize.py` — CLI entry point; orchestrates pipeline per operation
- `lib/loader.py` — `load_examples()`: parses JSONL, groups by operation, filters by min_examples and `eval` presence
- `lib/backend.py` — `make_lm()` factory: returns `dspy.LM` (Ollama) or `ClaudeCodeLM` (Claude CLI adapter); selection via `DSPY_BACKEND` env var
- `lib/optimizer.py` — `run_mipro()`: configures DSPy, runs MIPROv2 with `auto="light"`, calls `restore_placeholders()` post-optimization
- `lib/signature.py` — `make_signature()`: dynamically creates DSPy Signature from template content
- `lib/writer.py` — `write_optimized()`: writes result to `{output_dir}/{operation}.md`

## Configuration (.env)

Copy `.env.example` → `.env`. Key variables:

| Variable | Purpose |
|---|---|
| `DSPY_BACKEND` | `ollama` or `claude-code` |
| `DEV_LOG_PATH` | Absolute path to JSONL dev log |
| `PROMPTS_DIR` | Directory with `evaluator.md` + `{operation}.md` templates |
| `OUTPUT_DIR` | Where to write optimized prompts |
| `OPERATIONS` | Comma-separated filter; empty = all operations in log |
| `CLAUDE_PATH` | Path to `claude` CLI binary (claude-code backend) |
| `CLAUDE_MODEL` | Claude model ID (claude-code backend) |
| `OLLAMA_MODEL` | Ollama model name (ollama backend) |

## Input Format

JSONL dev log — one JSON object per line:
```json
{"operation": "ingest", "userMessage": "...", "result": "...", "eval": {"score": 8.5}}
```

Templates use `{{placeholder}}` syntax — `restore_placeholders()` in optimizer.py ensures they survive MIPROv2 rewriting.

## ClaudeCodeLM

`lib/backend.py:ClaudeCodeLM` spawns Claude CLI:
```
claude -- --print --dangerously-skip-permissions --model {model} --output-format json {prompt}
```
Parses last JSON object from stdout. The `--` separator is required — `iclaude.sh` reserves `-p`/`--proxy` flags.
