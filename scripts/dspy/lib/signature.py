from __future__ import annotations

import dspy


def make_signature(instruction: str) -> type[dspy.Signature]:
    class WikiOperation(dspy.Signature):
        user_message: str = dspy.InputField(desc="Task input for the wiki operation")
        result: str = dspy.OutputField(desc="Operation result")

    return WikiOperation.with_instructions(instruction)
