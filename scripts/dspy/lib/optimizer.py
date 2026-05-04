from __future__ import annotations

import re
import dspy
from lib.signature import make_signature

_RESTORE_PROMPT = """\
Below is the ORIGINAL prompt template (contains {{placeholders}} that must be preserved) \
and an OPTIMIZED version (placeholders may be missing).

ORIGINAL:
{original}

OPTIMIZED:
{optimized}

Required placeholders: {placeholders}

Rewrite the OPTIMIZED text so that ALL required placeholders appear at semantically \
appropriate locations. Keep the improved wording from OPTIMIZED. \
Return ONLY the rewritten template text, no explanation.
"""


def call_evaluator(
    lm,
    operation: str,
    user_message: str,
    result: str,
    evaluator_template: str,
) -> float:
    prompt = (
        evaluator_template
        .replace("{{operation}}", operation)
        .replace("{{task_input}}", user_message)
        .replace("{{result}}", result)
    )
    response = lm(prompt=prompt)
    text = response[0] if response else ""
    try:
        match = re.search(r'"score"\s*:\s*(\d+(?:\.\d+)?)', text)
        if not match:
            return 0.0
        return min(10.0, float(match.group(1)))
    except Exception:
        return 0.0


def restore_placeholders(lm, original: str, optimized: str) -> str:
    placeholders = re.findall(r'\{\{(\w+)\}\}', original)
    if not placeholders:
        return optimized

    missing_before = [p for p in placeholders if f"{{{{{p}}}}}" not in optimized]
    if not missing_before:
        return optimized

    placeholder_list = ", ".join(f"{{{{{p}}}}}" for p in placeholders)
    prompt = _RESTORE_PROMPT.format(
        original=original,
        optimized=optimized,
        placeholders=placeholder_list,
    )
    response = lm(prompt=prompt)
    restored = response[0] if response and response[0] else optimized

    missing = [p for p in placeholders if f"{{{{{p}}}}}" not in restored]
    if missing:
        raise ValueError(f"Placeholders not restored: {missing}")

    return restored


def run_mipro(
    lm,
    operation: str,
    trainset: list[dict],
    template_content: str,
    evaluator_template: str,
) -> str:
    dspy.configure(lm=lm)

    sig = make_signature(template_content)
    program = dspy.Predict(sig)

    examples = [
        dspy.Example(
            user_message=entry["userMessage"],
            result=entry["result"],
            score=entry["eval"]["score"],
        ).with_inputs("user_message")
        for entry in trainset
    ]

    def metric(example, prediction, trace=None):
        score = call_evaluator(
            lm, operation,
            example.user_message,
            prediction.result,
            evaluator_template,
        )
        return score / 10.0

    optimizer = dspy.MIPROv2(
        metric=metric,
        auto="light",
        num_threads=1,
    )
    compiled = optimizer.compile(
        program,
        trainset=examples,
        max_bootstrapped_demos=0,
        max_labeled_demos=0,
    )
    optimized_instruction = compiled.signature.instructions

    return restore_placeholders(lm, template_content, optimized_instruction)
