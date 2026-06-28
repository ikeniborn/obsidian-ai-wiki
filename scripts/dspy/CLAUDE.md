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
eval.jsonl → loader.py → optimizer.py (MIPROv2 + judge-free metric) → writer.py → {operation}.md
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
| `PROMPTS_DIR` | Directory with `{operation}.md` templates (no evaluator.md — judge removed) |
| `OUTPUT_DIR` | Where to write optimized prompts |
| `OPERATIONS` | Comma-separated filter; empty = all operations in log |
| `CLAUDE_PATH` | Path to `claude` CLI binary (claude-code backend) |
| `CLAUDE_MODEL` | Claude model ID (claude-code backend) |
| `OLLAMA_MODEL` | Ollama model name (ollama backend) |

## Input Format

`eval.jsonl` — one JSON object per line, written by the plugin's human 👍/👎 rating flow (no LLM judge):
```json
{"operation": "query", "question": "...", "answer": "...", "ratings": {"answer": "up", "retrieval": "up"}, "comment": "more code examples", "rating": null, "vision": "off", "promptVersion": "abc123", "visionPromptVersion": null, "recognitionRating": null}
```

Key fields:
- `ratings` — `{ "<axis>": "up" | "down" | null }` per-axis human labels (e.g. query → `answer`/`retrieval`). The optimizer uses the **primary axis** per operation (`query→answer, chat→answer, format→formatting, ingest→page, init→coverage, lint→fix, lint-chat→fix, delete→rebuild`).
- `rating` — legacy scalar `"up"|"down"|null`; used only as a fallback when `ratings` is absent.
- `comment` — optional free-form human note (one per run); aggregated into a seed "Human reviewer feedback" block by the optimizer.
- `recognitionRating` — `"up"` | `"down"` | `null` (reserved; vision-recognition axis, not yet optimized)
- `operation` — `query` | `chat` | `format` | `lint-chat` | …
- `vision` — `true` | `false` — used by loader to split `format` into `format:vision-on` / `format:vision-off` buckets
- `promptVersion` / `visionPromptVersion` — content-hash of the prompt used (for tracing, not used by optimizer)

**Metric:** judge-free reference-similarity (`_jaccard` over recorded answers) with a 👍-guard: if the optimized candidate regresses the 👍 set, `run_mipro()` returns `None` and the current prompt is kept.

**`evaluator.md` is removed** — there is no LLM judge.

Templates use `{{placeholder}}` syntax — `restore_placeholders()` in optimizer.py ensures they survive MIPROv2 rewriting.

## ClaudeCodeLM

`lib/backend.py:ClaudeCodeLM` spawns Claude CLI:
```
claude -- --print --dangerously-skip-permissions --model {model} --output-format json {prompt}
```
Parses last JSON object from stdout. The `--` separator is required — `iclaude.sh` reserves `-p`/`--proxy` flags.
