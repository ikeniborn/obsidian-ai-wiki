#!/usr/bin/env python3
"""Derive tests/fixtures/recorded-prompts.json from a live agent.jsonl run.

The plugin's run log records prompt LENGTHS and the provider's own input token
count, never prompt text, so a fixture case cannot be lifted verbatim. This
script reconstructs each case's character census from the real material the call
carried and emits counts only — no note text ever reaches the fixture.

    python3 scripts/derive-recorded-prompts.py \
        --log   <vault>/.obsidian/plugins/ai-wiki/agent.jsonl \
        --vault <vault> \
        --tokenizer /path/to/deepseek-tokenizer.json \
        --out   tests/fixtures/recorded-prompts.json

`--tokenizer` takes the provider family's published `tokenizer.json` (for the
recorded runs: DeepSeek-V3) and needs the `tokenizers` package. It is what makes
each reconstruction falsifiable: a census that does not tokenize to the token
count the provider billed is not the composition the provider saw, and this
script drops it.

Procedure, per recorded request:

1. Join `llm_request_fingerprint` (message char lengths, the estimate at the
   time) to the `calibration_sample` that follows it (the provider's `actual`),
   and to the `prompt_breakdown` and the `file_start` note in scope.
2. Recover the Cyrillic character count exactly. With no CJK and no image part
   the pre-fix rules are invertible:
       cyrillic = (estimate - 4*messages - roleChars - chars/4.2) / (1/1.9 - 1/4.2)
   This is algebra over recorded numbers, not an assumption.
3. Rebuild the material: the plugin's own prompts/ and templates/ for the
   instruction part, sized by the recorded section subtotals, then the
   JSON-escaped fenced code and prose of the source note, mixed so the result
   reproduces the recorded total character count and that Cyrillic count.
4. Keep the case only if it round-trips: census sum equals the recorded chars,
   the pre-fix rules reproduce the recorded estimate within 3%, and the
   tokenizer counts the reconstruction within 3% of the provider's count.
5. Emit one case per size band (best tokenizer fidelity in the band), plus a
   second case from a different source note where the band has one.

The character-class RATES in src/token-estimate.ts were fitted by non-negative
least squares of class counts against tokenizer counts over every note in the
vault, this repository's prompts/, templates/, src/**/*.ts and docs/, real
agent.jsonl JSON, and JSON-escaped notes — 973 texts for the shipped numbers.
Rerun that fit with --fit (numpy required); it prints the rates, their residuals
and whether each shipped rate still charges at least what the fit asks, and
writes nothing. It will not reproduce the shipped numbers digit for digit: the
vault is live, so every note added to it moves the fit. The direction is what
has to hold.

The recorded runs were served by `ollama-deepseek-v4-pro-cloud`. The tokenizer
used as its stand-in is DeepSeek-V3's published `tokenizer.json` (128000-entry
BPE vocabulary, sha256
621ac2e32d0dba658404412318818aaa8ce8cda492e59830109d8da6b517fb41, from
huggingface.co/deepseek-ai/DeepSeek-V3). It is not vendored: it is a 7.8 MB file
this repository has no runtime use for. Its standing as a stand-in is checked,
not assumed — see step 4, and the 82 reconstructions it agreed with at a median
of 1.02 of the provider's own count.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
from typing import Dict, List, Optional

CHARS_PER_TOKEN_CYRILLIC_OLD = 1.9
CHARS_PER_TOKEN_DEFAULT_OLD = 4.2
MESSAGE_OVERHEAD_TOKENS = 4
ROLES = ["system", "user", "assistant", "user"]
FENCE = re.compile(r"```.*?```", re.S)
BANDS = [(3400, 3600), (3600, 4000), (4000, 4600), (4600, 6000), (6000, 8000), (8000, 30000)]
CENSUS_TOLERANCE = 0.03


def is_cyrillic(code: int) -> bool:
    return 0x400 <= code <= 0x52F


def is_cjk(code: int) -> bool:
    return (0x3040 <= code <= 0x30FF) or (0x4E00 <= code <= 0x9FFF) or (0xAC00 <= code <= 0xD7AF)


def census(text: str) -> Dict[str, int]:
    """The class and run counts src/token-estimate.ts reads."""
    out = dict(cyrillic=0, cjk=0, word=0, symbols=0, symbolRuns=0, newlines=0)
    previous = None
    for char in text:
        code = ord(char)
        if is_cyrillic(code):
            current = "cyrillic"
        elif is_cjk(code):
            current = "cjk"
        elif char == "\n":
            current = "newlines"
        elif char.isdigit():
            current = "digit"
        elif char.isalpha() or char.isspace():
            current = "word"
        else:
            current = "symbol"
        if current in ("digit", "symbol"):
            out["symbols"] += 1
            if current != previous:
                out["symbolRuns"] += 1
        else:
            out[current] += 1
        previous = current
    return out


def old_estimate(chars: int, cyrillic: int, messages: int) -> int:
    """The pre-fix estimate, used only to check a reconstruction against the log."""
    role_chars = sum(len(role) for role in ROLES[:messages])
    raw = (cyrillic / CHARS_PER_TOKEN_CYRILLIC_OLD
           + (chars - cyrillic + role_chars) / CHARS_PER_TOKEN_DEFAULT_OLD
           + MESSAGE_OVERHEAD_TOKENS * messages)
    return math.ceil(raw)


def recover_cyrillic(chars: int, estimate: int, messages: int) -> float:
    role_chars = sum(len(role) for role in ROLES[:messages])
    raw = estimate - MESSAGE_OVERHEAD_TOKENS * messages - role_chars / CHARS_PER_TOKEN_DEFAULT_OLD
    scale = 1 / CHARS_PER_TOKEN_CYRILLIC_OLD - 1 / CHARS_PER_TOKEN_DEFAULT_OLD
    return max((raw - chars / CHARS_PER_TOKEN_DEFAULT_OLD) / scale, 0.0)


def read_records(log_path: str) -> List[dict]:
    """Join fingerprint -> calibration_sample, carrying breakdown and source file."""
    records: List[dict] = []
    breakdowns: Dict[str, dict] = {}
    current_file: Dict[str, str] = {}
    pending = None
    for line in open(log_path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        event = entry["event"]
        kind = event.get("kind")
        if kind == "file_start":
            current_file[entry["session"]] = event["file"]
        elif kind == "prompt_breakdown":
            breakdowns[event["requestId"]] = event
        elif kind == "llm_request_fingerprint":
            pending = (event, entry, current_file.get(entry["session"]))
        elif kind == "calibration_sample" and pending is not None:
            fingerprint, envelope, source = pending
            records.append(dict(
                requestId=fingerprint["requestId"],
                callSite=fingerprint["callSite"],
                messages=fingerprint["messageCount"],
                messageChars=fingerprint["messageCharLengths"],
                estimateAtTheTime=fingerprint["estimatedInputTokens"],
                actual=event["actual"],
                recordedAt=envelope["ts"],
                session=envelope["session"],
                sourceNote=source,
                breakdown=breakdowns.get(fingerprint["requestId"]),
            ))
            pending = None
    return records


def escape(text: str) -> str:
    """A payload carries note text inside a JSON string, so escaping is part of it."""
    return json.dumps(text, ensure_ascii=False)[1:-1]


def tile(pool: str, length: int) -> str:
    if length <= 0:
        return ""
    repeats = length // max(len(pool), 1) + 2
    return (pool * repeats)[:length]


def cyrillic_share(text: str) -> float:
    sample = text[:40_000]
    return sum(1 for char in sample if is_cyrillic(ord(char))) / max(len(sample), 1)


def reconstruct(record: dict, vault: str, repo: str, pools: dict) -> Optional[dict]:
    """Rebuild one prompt from real material; None when the log lacks a breakdown."""
    if record["breakdown"] is None or not record["sourceNote"]:
        return None
    note_path = os.path.join(vault, record["sourceNote"])
    if not os.path.exists(note_path):
        return None
    note = open(note_path, encoding="utf-8").read()
    code = escape("\n".join(FENCE.findall(note))) or escape(note)
    prose = escape(FENCE.sub("", note))
    sections = record["breakdown"]["breakdown"]
    fixed_tokens = sum(sections.get(key, 0) for key in (
        "contractsTokens", "registryTokens", "contextTokens", "pageDescriptionsTokens"))

    total = sum(record["messageChars"])
    system_chars = record["messageChars"][0]
    payload = total - system_chars
    instruction_chars = min(int(fixed_tokens * CHARS_PER_TOKEN_DEFAULT_OLD), payload - 100)
    source_chars = payload - instruction_chars
    target_cyrillic = recover_cyrillic(total, record["estimateAtTheTime"], record["messages"])

    code_share, prose_share = cyrillic_share(code), cyrillic_share(prose)
    if code_share == prose_share:
        mix = 0.0
    else:
        mix = min(max((target_cyrillic / source_chars - prose_share)
                      / (code_share - prose_share), 0.0), 1.0)
    from_code = int(round(source_chars * mix))
    text = (tile(pools["instructions"], system_chars + instruction_chars)
            + tile(code, from_code)
            + tile(prose, source_chars - from_code))
    if len(text) != total:
        return None
    counts = census(text)
    if counts["cjk"]:
        return None
    reproduced = old_estimate(total, counts["cyrillic"], record["messages"])
    return dict(counts=counts, text=text, reproduced=reproduced)


def build(args: argparse.Namespace) -> None:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    instructions = "".join(
        open(path, encoding="utf-8").read()
        for path in sorted(glob.glob(os.path.join(repo, "prompts", "*.md"))
                           + glob.glob(os.path.join(repo, "templates", "*.md"))))
    pools = {"instructions": instructions}

    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(args.tokenizer)

    candidates = []
    for record in read_records(args.log):
        rebuilt = reconstruct(record, args.vault, repo, pools)
        if rebuilt is None:
            continue
        estimate_error = abs(rebuilt["reproduced"] / record["estimateAtTheTime"] - 1)
        tokens = len(tokenizer.encode(rebuilt["text"], add_special_tokens=False).ids)
        fidelity = tokens / record["actual"]
        if estimate_error > CENSUS_TOLERANCE or abs(fidelity - 1) > CENSUS_TOLERANCE:
            continue
        candidates.append(dict(record=record, counts=rebuilt["counts"],
                               tokenizerTokens=tokens, fidelity=fidelity))

    selected: List[dict] = []
    for low, high in BANDS:
        band = sorted((item for item in candidates if low <= item["record"]["actual"] < high),
                      key=lambda item: abs(item["fidelity"] - 1))
        if not band:
            continue
        selected.append(band[0])
        other = [item for item in band[1:]
                 if item["record"]["sourceNote"] != band[0]["record"]["sourceNote"]]
        if other and high <= 4600:
            selected.append(other[0])
    selected.sort(key=lambda item: -item["record"]["actual"])

    cases = []
    for item in selected:
        record, counts = item["record"], item["counts"]
        cases.append({
            "id": record["requestId"],
            "callSite": record["callSite"],
            "recordedAt": record["recordedAt"],
            "messages": record["messages"],
            "recordedMessageChars": record["messageChars"],
            "actualInputTokens": record["actual"],
            "recordedEstimateAtTheTime": record["estimateAtTheTime"],
            "sourceNote": record["sourceNote"],
            "reconstruction": {
                "cyrillic": counts["cyrillic"],
                "cjk": counts["cjk"],
                "word": counts["word"],
                "symbols": counts["symbols"],
                "symbolRuns": counts["symbolRuns"],
                "newlines": counts["newlines"],
                "tokenizerTokens": item["tokenizerTokens"],
            },
        })
    document = {
        "note": (
            "Cases recorded live by the plugin against ollama-deepseek-v4-pro-cloud over a "
            "Linux/Unix administration vault. Recorded verbatim from agent.jsonl: id "
            "(requestId), callSite, recordedAt, messages and recordedMessageChars "
            "(llm_request_fingerprint.messageCount/messageCharLengths), actualInputTokens "
            "(calibration_sample.actual, the provider's own input count) and "
            "recordedEstimateAtTheTime (llm_request_fingerprint.estimatedInputTokens, "
            "produced by the 1.9/4.2 rules this fixture replaced). The log stores lengths, "
            "never prompt text, so the character census under `reconstruction` is NOT "
            "recorded data - see fittedAgainst."),
        "fittedAgainst": (
            "scripts/derive-recorded-prompts.py rebuilds each census from the real material "
            "the call carried: this repository's prompts/*.md and templates/*.md for the "
            "instruction part, sized by the recorded prompt_breakdown section subtotals, plus "
            "the JSON-escaped fenced code and prose of sourceNote (the vault note file_start "
            "names for that call), mixed so the reconstruction reproduces the recorded total "
            "character count and the Cyrillic count implied by recordedEstimateAtTheTime. A "
            "case is kept only if it round-trips: the census sums to recordedMessageChars "
            "exactly, the pre-fix rules reproduce recordedEstimateAtTheTime within 3%, and "
            "tokenizerTokens - the reconstruction measured with the provider family's "
            "published tokenizer (DeepSeek-V3 tokenizer.json) - is within 3% of "
            "actualInputTokens. Prompts below ~3.4k tokens are absent because the log records "
            "no prompt_breakdown for them, so their composition cannot be reconstructed "
            "honestly. The character-class rates themselves were fitted separately against "
            "tokenizer counts over 973 real texts; the script's docstring states that "
            "procedure."),
        "cases": cases,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(candidates)} candidates round-tripped, {len(cases)} written to {args.out}")
    for case in cases:
        print(f"  {case['id']:22} {case['actualInputTokens']:>6} tokens  {case['sourceNote']}")


def fit_corpus(vault: str, log_path: str, repo: str) -> List[str]:
    """The real texts the rates are fitted over. No synthetic material."""
    texts: List[str] = []
    for path in glob.glob(os.path.join(vault, "**", "*.md"), recursive=True):
        if ".obsidian" in path:
            continue
        try:
            texts.append(open(path, encoding="utf-8").read())
        except OSError:
            continue
    notes = len(texts)
    for pattern in ("prompts/*.md", "templates/*.md", "src/**/*.ts", "docs/**/*.md"):
        for path in glob.glob(os.path.join(repo, pattern), recursive=True):
            texts.append(open(path, encoding="utf-8").read())
    lines = open(log_path, encoding="utf-8").read().split("\n")
    for start in range(0, max(len(lines) - 40, 1), 200):
        texts.append("\n".join(lines[start:start + 40]))
    # The payload carries note text JSON-escaped, so the escaped form is material too.
    for text in texts[:min(notes, 40)]:
        texts.append(json.dumps({"text": text}, ensure_ascii=False))
    return [text for text in texts if len(text) >= 200]


def fit(args: argparse.Namespace) -> None:
    import numpy as np
    from tokenizers import Tokenizer

    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tokenizer = Tokenizer.from_file(args.tokenizer)
    groups = [["cyrillic"], ["word"], ["symbols", "symbolRuns", "newlines"]]
    rows, truth = [], []
    for text in fit_corpus(args.vault, args.log, repo):
        counts = census(text)
        if counts["cjk"]:
            continue
        rows.append([
            counts["cyrillic"],
            counts["word"],
            counts["symbols"],
            counts["symbolRuns"] + counts["newlines"],
        ])
        truth.append(len(tokenizer.encode(text, add_special_tokens=False).ids))
    design, target = np.array(rows, float), np.array(truth, float)
    # Relative error is what the 15% band is about, so weight each row by 1/sqrt(tokens).
    weight = 1 / np.sqrt(target)
    weighted, goal = design * weight[:, None], target * weight
    rate = np.full(design.shape[1], 0.15)
    step = 1.0 / (np.linalg.norm(weighted, 2) ** 2)
    for _ in range(60_000):  # projected gradient: non-negativity is the whole constraint
        rate = np.maximum(rate - step * (weighted.T @ (weighted @ rate - goal)), 0)
    ratio = (design @ rate) / target
    print(f"texts fitted: {len(rows)}  (groups: {groups})")
    print(f"  CHARS_PER_TOKEN_CYRILLIC = {1 / rate[0]:.2f}")
    print(f"  CHARS_PER_TOKEN_WORD     = {1 / rate[1]:.2f}   (letters + non-newline whitespace)")
    print(f"  CHARS_PER_TOKEN_SYMBOL   = {1 / rate[2]:.2f}   (digits and symbols)")
    print(f"  SYMBOL_RUN_TOKENS        = {rate[3]:.2f}   (per digit run, symbol run and newline)")
    print(f"  residual ratio: min {ratio.min():.3f} p05 {np.percentile(ratio, 5):.3f} "
          f"median {np.median(ratio):.3f} p95 {np.percentile(ratio, 95):.3f} max {ratio.max():.3f}")

    # The shipped rates came from this procedure over the corpus as it stood,
    # then scaled up until no recorded case underestimated. They will not
    # reproduce digit for digit later: the vault is live and every note added to
    # it moves the fit. What has to keep holding is the direction - each shipped
    # rate charges at least what the current fit says - so that is checked here.
    source = open(os.path.join(repo, "src", "token-estimate.ts"), encoding="utf-8").read()
    shipped = {name: float(re.search(rf"{name} = ([0-9.]+);", source).group(1)) for name in (
        "CHARS_PER_TOKEN_CYRILLIC", "CHARS_PER_TOKEN_WORD",
        "CHARS_PER_TOKEN_SYMBOL", "SYMBOL_RUN_TOKENS")}
    print("\nshipped versus this fit (shipped must charge at least as much):")
    for index, (name, conservative) in enumerate((
            ("CHARS_PER_TOKEN_CYRILLIC", lambda a, b: a <= b),
            ("CHARS_PER_TOKEN_WORD", lambda a, b: a <= b),
            ("CHARS_PER_TOKEN_SYMBOL", lambda a, b: a <= b),
            ("SYMBOL_RUN_TOKENS", lambda a, b: a >= b))):
        fitted = rate[index] if name == "SYMBOL_RUN_TOKENS" else 1 / rate[index]
        verdict = "ok" if conservative(shipped[name], fitted) else "BELOW THE FIT"
        print(f"  {name:24} shipped {shipped[name]:>6.2f}  fit {fitted:>6.2f}  {verdict}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, help="agent.jsonl from the recorded run")
    parser.add_argument("--vault", required=True, help="vault root the run indexed")
    parser.add_argument("--tokenizer", required=True, help="the provider family's tokenizer.json")
    parser.add_argument("--out", default="tests/fixtures/recorded-prompts.json")
    parser.add_argument("--fit", action="store_true",
                        help="re-run the rate fit and print the rates instead of writing a fixture")
    args = parser.parse_args()
    fit(args) if args.fit else build(args)


if __name__ == "__main__":
    main()
