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


def _jaccard(a: str, b: str) -> float:
    sa, sb = set(a.lower().split()), set(b.lower().split())
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / (len(sa | sb) or 1)


def run_mipro(
    lm,
    operation: str,
    trainset: list[dict],
    template_content: str,
    evaluator_template: str = "",  # unused with the rating metric; kept for signature compat
) -> str | None:
    """Returns the optimized template text, or None when the candidate regressed
    the held-out 👍 set (spec §8 reject condition)."""
    dspy.configure(lm=lm)

    sig = make_signature(template_content)
    program = dspy.Predict(sig)  # original (pre-optimization) prompt

    # recognition bucket uses recognitionRating; ":recognition" is reserved for the
    # deferred vision-recognition pass (not produced by optimize.py yet — Task 18).
    field = "recognitionRating" if operation.endswith(":recognition") else "rating"

    examples = [
        dspy.Example(
            user_message=entry.get("question", ""),
            reference=entry.get("answer", ""),
            up=(entry.get(field) == "up"),
        ).with_inputs("user_message")
        for entry in trainset
    ]

    def metric(example, prediction, trace=None):
        sim = _jaccard(getattr(prediction, "result", "") or "", example.reference)
        return sim if example.up else (1.0 - sim)

    optimizer = dspy.MIPROv2(metric=metric, auto="light", num_threads=1)
    compiled = optimizer.compile(
        program,
        trainset=examples,
        max_bootstrapped_demos=0,
        max_labeled_demos=0,
    )

    # 👍-guard (spec §8): reject if the optimized prompt regresses the 👍 set.
    up_examples = [e for e in examples if e.up]
    if up_examples:
        def mean_on_up(prog) -> float:
            return sum(metric(e, prog(user_message=e.user_message)) for e in up_examples) / len(up_examples)
        baseline = mean_on_up(program)    # original prompt
        candidate = mean_on_up(compiled)  # optimized prompt
        if candidate < baseline:
            return None  # regressed the 👍 set — reject the candidate

    return restore_placeholders(lm, template_content, compiled.signature.instructions)
