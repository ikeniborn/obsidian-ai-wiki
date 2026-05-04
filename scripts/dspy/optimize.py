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
    prompts_dir = _get(args.prompts_dir, "PROMPTS_DIR") or "../../prompts"
    output_dir  = _get(args.output_dir,  "OUTPUT_DIR") or "../../prompts/optimized"

    if not log_path:
        print("ERROR: задайте DEV_LOG_PATH в .env или передайте --log", file=sys.stderr)
        sys.exit(1)

    operations = [o.strip() for o in ops_raw.split(",") if o.strip()] if ops_raw else None

    print(f"Загрузка примеров из {log_path}...")
    grouped = load_examples(log_path, operations=operations, min_examples=min_ex)

    if not grouped:
        print("Нет операций с достаточным количеством примеров. Завершение.")
        sys.exit(0)

    evaluator_template = Path(prompts_dir, "evaluator.md").read_text(encoding="utf-8")

    lm = make_lm()

    for op, examples in grouped.items():
        print(f"[{op}] {len(examples)} примеров загружено")
        template_path = Path(prompts_dir) / f"{op}.md"
        if not template_path.exists():
            print(f"[{op}] WARNING: {template_path} не найден, пропускаю")
            continue

        template_content = template_path.read_text(encoding="utf-8")
        print(f"[{op}] MIPROv2 запущен (auto=light)...")

        try:
            optimized = run_mipro(
                lm=lm,
                operation=op,
                trainset=examples,
                template_content=template_content,
                evaluator_template=evaluator_template,
            )
        except ValueError as e:
            print(f"[{op}] ERROR: {e}")
            continue

        print(f"[{op}] Оптимизация завершена. Запись...")
        out_path = write_optimized(op, optimized, output_dir)
        print(f"[{op}] Записано: {out_path}")


if __name__ == "__main__":
    main()
