from __future__ import annotations

import dspy
from lib.signature import make_signature


def test_make_signature_sets_instructions():
    sig = make_signature("You are a helpful assistant")
    assert "You are a helpful assistant" in sig.instructions


def test_make_signature_has_required_fields():
    sig = make_signature("test instruction")
    assert "user_message" in sig.input_fields
    assert "result" in sig.output_fields


def test_make_signature_is_dspy_signature():
    sig = make_signature("test instruction")
    assert issubclass(sig, dspy.Signature)


def test_different_instructions_produce_different_signatures():
    sig1 = make_signature("instruction one")
    sig2 = make_signature("instruction two")
    assert sig1.instructions != sig2.instructions
