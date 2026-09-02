#!/usr/bin/env python3
"""Derive tests/fixtures/recorded-prompts.json from a live agent.jsonl run.

The run log records a prompt's character-class census and the provider's own
input token count for it, never the prompt text. Those two numbers are the whole
ground truth the token estimator needs, so a fixture case is a direct read of the
log — no vault, no tokenizer, no reconstruction.

    python3 scripts/derive-recorded-prompts.py \
        --log <vault>/.obsidian/plugins/ai-wiki/agent.jsonl \
        --out tests/fixtures/recorded-prompts.json

Procedure, per recorded request:

1. Join `llm_request_fingerprint` (the census, the message lengths, the estimate
   the shipped rules produced) to the `calibration_sample` that follows it (the
   provider's `actual`).
2. Score the case by how far that estimate landed from the provider's count.
3. Keep the worst case per (callSite, size band). A fixture is a regression test,
   so it should pin where the rules are weakest, not where they are comfortable.

Every structured call site emits the census, so every call site and every prompt
size can reach the fixture. Requests logged before the census field existed are
counted and skipped; a run that yields only those came from an older build.

The nine `reconstructed` cases in the fixture predate the census field, when the
log carried lengths only. They were rebuilt from this repository's prompts/ and
templates/ sized by the recorded `prompt_breakdown` subtotals plus the source
note's own text, and validated against the DeepSeek-V3 tokenizer — a procedure
that reached `ingest.synthesize` alone, because nothing else emits
`prompt_breakdown`, and only prompts above ~3.4k tokens, because the log keeps no
breakdown below that. They cannot be re-derived, so this script preserves them on
every rebuild and replaces only the `recorded` cases.

The character-class RATES in src/token-estimate.ts were fitted by non-negative
least squares of class counts against tokenizer counts over every note in the
vault, this repository's prompts/, templates/, src/**/*.ts and docs/, real
agent.jsonl JSON, and JSON-escaped notes — 973 texts for the shipped numbers.
Rerun that fit with --fit (numpy, tokenizers, --vault and --tokenizer required);
it prints the rates, their residuals and whether each shipped rate still charges
at least what the fit asks, and writes nothing. It will not reproduce the shipped
numbers digit for digit: the vault is live, so every note added to it moves the
fit. The direction is what has to hold.

The tokenizer the fit depends on is DeepSeek-V3's published `tokenizer.json`
(128000-entry BPE vocabulary, sha256
621ac2e32d0dba658404412318818aaa8ce8cda492e59830109d8da6b517fb41, from
huggingface.co/deepseek-ai/DeepSeek-V3). It is not vendored: it is a 7.8 MB file
this repository has no runtime use for.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
from typing import Dict, List

BANDS = [(0, 1200), (1200, 2400), (2400, 3400), (3400, 4600), (4600, 8000), (8000, 30000)]
CENSUS_FIELDS = ("cyrillic", "cjk", "word", "symbols", "symbolRuns", "newlines", "imageParts")


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


def read_records(log_path: str) -> tuple[List[dict], int]:
    """Join fingerprint -> calibration_sample. Also counts fingerprints with no census."""
    records: List[dict] = []
    censusless = 0
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
        elif kind == "llm_request_fingerprint":
            if event.get("census") is None:
                censusless += 1
                pending = None
                continue
            pending = (event, entry, current_file.get(entry["session"]))
        elif kind == "calibration_sample" and pending is not None:
            fingerprint, envelope, source = pending
            records.append(dict(
                requestId=fingerprint["requestId"],
                callSite=fingerprint["callSite"],
                messages=fingerprint["messageCount"],
                messageChars=fingerprint["messageCharLengths"],
                estimateAtTheTime=fingerprint["estimatedInputTokens"],
                census={field: fingerprint["census"].get(field, 0) for field in CENSUS_FIELDS},
                actual=event["actual"],
                recordedAt=envelope["ts"],
                sourceNote=source,
            ))
            pending = None
    return records, censusless


def band_of(tokens: int) -> tuple[int, int] | None:
    for low, high in BANDS:
        if low <= tokens < high:
            return (low, high)
    return None


def kept_reconstructed(out_path: str) -> List[dict]:
    """The cases no rebuild can produce again. Losing them would lose the ground truth."""
    if not os.path.exists(out_path):
        return []
    document = json.load(open(out_path, encoding="utf-8"))
    return [case for case in document.get("cases", [])
            if case.get("provenance") == "reconstructed"]


def build(args: argparse.Namespace) -> None:
    records, censusless = read_records(args.log)

    # One case per (callSite, band), the one whose shipped estimate landed
    # furthest from the provider's count: a fixture pins the weak spot, not the
    # comfortable middle.
    worst: Dict[tuple, dict] = {}
    for record in records:
        band = band_of(record["actual"])
        if band is None:
            continue
        record["error"] = abs(record["estimateAtTheTime"] / record["actual"] - 1)
        key = (record["callSite"], band)
        if key not in worst or record["error"] > worst[key]["error"]:
            worst[key] = record

    recorded = []
    for record in sorted(worst.values(), key=lambda item: -item["actual"]):
        case = {
            "id": record["requestId"],
            "callSite": record["callSite"],
            "recordedAt": record["recordedAt"],
            "messages": record["messages"],
            "recordedMessageChars": record["messageChars"],
            "actualInputTokens": record["actual"],
            "recordedEstimateAtTheTime": record["estimateAtTheTime"],
        }
        if record["sourceNote"]:
            case["sourceNote"] = record["sourceNote"]
        case["provenance"] = "recorded"
        case["census"] = record["census"]
        recorded.append(case)

    document = json.load(open(args.out, encoding="utf-8"))
    document["cases"] = recorded + kept_reconstructed(args.out)
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(document, ensure_ascii=False, indent=2) + "\n")

    print(f"{len(records)} requests joined, {len(recorded)} recorded cases written to {args.out}")
    if censusless:
        print(f"  {censusless} fingerprints carried no census and were skipped "
              f"(logged by a build older than the census field)")
    for case in recorded:
        print(f"  {case['id']:22} {case['callSite']:24} {case['actualInputTokens']:>6} tokens  "
              f"estimate off by {(case['recordedEstimateAtTheTime'] / case['actualInputTokens'] - 1) * 100:+.1f}%")


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
    parser.add_argument("--out", default="tests/fixtures/recorded-prompts.json")
    parser.add_argument("--vault", help="vault root the run indexed (--fit only)")
    parser.add_argument("--tokenizer", help="the provider family's tokenizer.json (--fit only)")
    parser.add_argument("--fit", action="store_true",
                        help="re-run the rate fit and print the rates instead of writing a fixture")
    args = parser.parse_args()
    if args.fit and not (args.vault and args.tokenizer):
        parser.error("--fit needs --vault and --tokenizer")
    fit(args) if args.fit else build(args)


if __name__ == "__main__":
    main()
