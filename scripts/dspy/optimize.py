#!/usr/bin/env python3
from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from lib.backend import make_lm
from lib.loader import load_examples
from lib.optimizer import run_mipro
from lib.writer import write_optimized


def _get(arg_val, env_key: str, default: str | None = None) -> str | None:
    return arg_val if arg_val is not None else os.environ.get(env_key, default)


def main() -> None:
    parser = argparse.ArgumentParser(description="DSPy prompt optimizer")
    parser.add_argument("--log",          help="Путь к JSONL-логу (переопределяет DEV_LOG_PATH)")
    parser.add_argument("--operations",   help="Операции через запятую (переопределяет OPERATIONS)")
    parser.add_argument("--min-examples", type=int, help="Минимум примеров (переопределяет MIN_EXAMPLES)")
    parser.add_argument("--prompts-dir",  help="Папка с шаблонами (переопределяет PROMPTS_DIR)")
    parser.add_argument("--output-dir",   help="Папка для вывода (переопределяет OUTPUT_DIR)")
    args = parser.parse_args()

    log_path    = _get(args.log, "DEV_LOG_PATH")
    ops_raw     = _get(args.operations, "OPERATIONS", "")
    min_ex      = args.min_examples or int(os.environ.get("MIN_EXAMPLES", "5"))
    prompts_dir = _get(args.prompts_dir, "PROMPTS_DIR")
    output_dir  = _get(args.output_dir,  "OUTPUT_DIR")

    if not log_path:
        print("ERROR: задайте DEV_LOG_PATH в .env или передайте --log", file=sys.stderr)
        sys.exit(1)
    if not prompts_dir:
        print("ERROR: задайте PROMPTS_DIR в .env или передайте --prompts-dir", file=sys.stderr)
        sys.exit(1)
    if not output_dir:
        print("ERROR: задайте OUTPUT_DIR в .env или передайте --output-dir", file=sys.stderr)
        sys.exit(1)

    operations = [o.strip() for o in ops_raw.split(",") if o.strip()] if ops_raw else None

    print(f"Загрузка примеров из {log_path}...")
    grouped = load_examples(log_path, operations=operations, min_examples=min_ex)

    if not grouped:
        print("Нет операций с достаточным количеством примеров. Завершение.")
        sys.exit(0)

    lm = make_lm()

    # bucket → which prompt template to optimize
    def template_for(bucket: str) -> str:
        if bucket.startswith("format:"):
            return "format"
        return bucket  # query / chat / lint-chat / ...

    for bucket, examples in grouped.items():
        print(f"[{bucket}] {len(examples)} примеров загружено")
        tpl_name = template_for(bucket)
        template_path = Path(prompts_dir) / f"{tpl_name}.md"
        if not template_path.exists():
            print(f"[{bucket}] WARNING: {template_path} не найден, пропускаю")
            continue

        template_content = template_path.read_text(encoding="utf-8")
        up_n = sum(1 for e in examples if e.get("rating") == "up")
        print(f"[{bucket}] MIPROv2 (auto=light) · 👍-guard over {up_n} cases")

        try:
            optimized = run_mipro(
                lm=lm,
                operation=bucket,
                trainset=examples,
                template_content=template_content,
            )
        except ValueError as e:
            print(f"[{bucket}] ERROR: {e}")
            continue

        if optimized is None:
            print(f"[{bucket}] REJECTED: candidate regressed the 👍 set — keeping current prompt")
            continue

        out_path = write_optimized(tpl_name, optimized, output_dir)
        print(f"[{bucket}] Записано: {out_path}")


if __name__ == "__main__":
    main()
