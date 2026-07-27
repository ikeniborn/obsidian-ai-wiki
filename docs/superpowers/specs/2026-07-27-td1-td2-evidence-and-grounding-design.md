---
review:
  spec_hash: 63eddda8ccce5fd0
  last_run: 2026-07-27
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: CRITICAL
      section: "2.1 Facet coverage in context selection"
      fragment: "Facets are derived deterministically from the question text with no model call."
      text: "\"Distinguishable facet\" had no definition, so the selection rule was not implementable as written."
      fix: "Facets defined as the tokens of the existing tokenizeLexical, ordered by first occurrence in the question."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-002
      phase: clarity
      severity: CRITICAL
      section: "1.1 Attribution on shared pages"
      fragment: "the page gains X in `resource` and in its `## Sources` section"
      text: "No component or timing was named for adding the attribution, leaving ownership ambiguous between the gate and page synthesis."
      fix: "Named the gate in src/phases/ingest.ts as the owner, routing pages through reconcilePageProvenance in the same apply step."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "1.4 Line-continuation artifact"
      fragment: "Comparison drops only a trailing shell line continuation"
      text: "The rule did not say whether it applies to the product gate, the audit, or both; a one-sided change would make the audit disagree with the gate."
      fix: "Stated that the rule applies identically in findMissingSynthesisEvidence and audit-domain-quality.mjs."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-004
      phase: clarity
      severity: WARNING
      section: "Phase 0: Deterministic Reproduction"
      fragment: null
      text: "Phase 0 had no explicit done criterion."
      fix: "Added: every class has a failing test against HEAD or is recorded as unreproducible."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-005
      phase: clarity
      severity: WARNING
      section: "Live Verification Protocol"
      fragment: null
      text: "The protocol listed steps but no pass condition for the live run."
      fix: "Added an explicit pass condition and the rule that a failed run does not close the register item."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-006
      phase: consistency
      severity: INFO
      section: "Phase 1: TD-1"
      fragment: "every accepted ledger item of X"
      text: "Terminology drifted between \"accepted ledger item\", \"evidence item\", and \"exact snippet\"."
      fix: "Standardized on \"ledger item\" and \"technical snippet\"."
      verdict: fixed
      verdict_at: 2026-07-27
---

# Exact Evidence Reconciliation and Query Grounding - Design

Date: 2026-07-27
Status: proposed
Register: `docs/loen/dynamic-llm-budget-routing/tech-debt.md` (TD-1, TD-2)
Live baseline: Obsidian reinit session `1785096684125`
Test vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`

## Problem

The live baseline completed 22/22 sources with zero retries, but two quality gaps remain
open in the register.

TD-1: the domain quality audit reported 12 exact-string mismatches out of 537 candidate
technical snippets. The raw number mixes three different failures - genuinely absent
evidence (7 items), evidence that exists in the domain but is not attributed to the source
that produced it or differs only by shell line continuation (3 items), and English prose
sentences that the audit misclassified as exact technical content (2 items).

TD-2: the fixed ten-query replay completed 10/10 with zero retries and zero invalid
WikiLinks, but macro required-fact coverage was 91.809%, below the accepted 92.904% gate.
All five omitted fact groups exist in generated pages, so the loss is downstream of
synthesis: context selection, answer compression, or grounding sanitation.

## Scope and Boundaries

In scope:

- TD-1 product code: `src/phases/synthesis-evidence-ledger.ts` and the source-wide
  evidence gate call site in `src/phases/ingest.ts`.
- TD-1 measurement code: `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs`.
- TD-2 product code: `src/phases/query-grounding-validator.ts` and the context selection
  in `src/phases/query-budget.ts`.
- New file: `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json`.

Out of scope:

- `technicalValuePreservation` and `declaredEntityCoverage` gaps (see Discovered Debt).
- TD-3 (conflict-regeneration integration trigger) and TD-4 (init terminal status after a
  successful file retry).
- Every item in Non-Actions.

## Phase 0: Deterministic Reproduction

No fix is written before a failing test reproduces its cause. This is a hard precondition,
not a preference: the source-wide evidence gate at `src/phases/ingest.ts:1539` passed
during the live baseline even though the audit later found unrepresented evidence, so the
leak cannot be pinned by reading the code alone.

Phase 0 delivers one red test per failure class, built from the real os-unix corpus and
the recorded baseline evidence files:

TD-1 classes:

1. Shared-page attribution: a canonical page that carries evidence from source X but does
   not list X in `resource`.
2. Per-line coverage: a multi-line ledger item whose collapsed join is present while an
   individual line is not.
3. Prose false positive: an English sentence whose only technical content is an inline
   code span, counted as a technical snippet by the audit.
4. Line-continuation artifact: a command that differs from its ledger form only by a
   trailing ` && \` or `\`.

TD-2 classes:

5. Facet omission: a question with two distinguishable facets where the selected context
   covers the correct article but omits the section holding the second facet.
6. False unsupported: a technical unit present in the selected context that
   `findUnsupportedTechnicalUnits` reports as unsupported.
7. Malformed sanitation output: a sanitized line that retains an empty emphasis span such
   as `****`.

Each test states the observed wrong behavior, not the intended fix. A class whose red test
cannot be produced from real data is reported as unreproducible and its fix is dropped from
this spec rather than written blind.

Phase 0 is done when every class above either has a test that fails against current `HEAD`
with the failure message naming the observed value, or is recorded as unreproducible with
the data that was searched.

## Phase 1: TD-1 - Exact Evidence Classification and Reconciliation

Invariant: for each source X, every ledger item of X appears verbatim on a page that lists
X in its `resource` frontmatter. "Ledger item" is the only term used for an entry of the
synthesis evidence ledger.

### 1.1 Attribution on shared pages

When a page satisfies a ledger item of source X but was not prepared by X's own run, the
page gains X in `resource` and in its `## Sources` section, and only then counts as
representation for X. The source-wide gate stops counting representation on pages that
lack X's attribution.

Ownership and timing: the gate in `src/phases/ingest.ts` (currently
`hasCurrentSourceResource` / `representedTechnicalEvidence`, around line 1539) collects
unprepared pages that satisfy a ledger item of the current source, routes each through the
existing `reconcilePageProvenance` with the current source added to `additionalResources`,
and writes those pages in the same apply step as the source's own pages. The gate then
evaluates representation against the reconciled content. `reconcilePageProvenance` already
accumulates `resource` values and regenerates `## Sources`, so this change extends its
input rather than replacing the mechanism. Zero additional model calls.

### 1.2 Per-line coverage

An item counts as represented only when every entry of its `coverageUnits` is present in
the candidate content. Today `findMissingSynthesisEvidence` joins the units and collapses
all whitespace, so a partially copied multi-line block passes. Contiguity and ordering of
a multi-line segment are checked as a separate condition, so reordered fragments do not
satisfy the item. The same function serves both the append decision and the gate, so the
two cannot disagree.

### 1.3 Prose false positives

`extractTechnicalSnippets` in the audit stops treating a complete natural-language
sentence as a technical snippet when its only technical content is inline code spans.
Detection of real commands, paths, configuration lines, and assignments is not weakened.
This is a measurement fix; product classification in `unfencedTechnicalLine` already
rejects these lines because it requires a command-like head, and is not changed.

### 1.4 Line-continuation artifact

Comparison drops only a trailing shell line continuation (` && \` or `\`) before matching,
because that token comes from the source's own formatting rather than from the technical
operation. `sudo` and other qualifiers are not normalized away, and no other
transformation of command text is introduced.

The rule applies in two places and must be identical in both: the product comparison used
by `findMissingSynthesisEvidence` in `src/phases/synthesis-evidence-ledger.ts`, and the
snippet comparison in `audit-domain-quality.mjs`. A mismatch between them would make the
audit disagree with the gate it measures.

### Phase 1 acceptance

- Zero unrepresented ledger items across the fixed 22-source os-unix corpus.
- Zero prose false positives in the exact-evidence audit.
- 100% source URL preservation (baseline 21/21).
- No additional LLM request, retry, or token-ceiling increase.

## Phase 2: TD-2 - Query Context Coverage and Grounding Sanitation

### 2.1 Facet coverage in context selection

`selectQueryContextChunks` currently spends two thirds of the context limit on anchors,
one anchor chunk per distinct article, one third on siblings of those anchors, and the
remainder on global rank. A broad question therefore spends slots on article diversity
while a second section of the correct article - the one holding the exact path or command
- is never selected.

The selection reserves a slot for each question facet that no already-selected chunk
covers, before sibling fill and before the global tail. A facet slot goes to the
highest-ranked chunk that covers that facet.

Facet definition (deterministic, no model call): the facets of a question are the tokens
produced by the existing `tokenizeLexical` (`src/lexical-retrieval.ts:76`) - lowercased,
split on non-letter/digit characters, tokens of two characters or fewer dropped unless
they mix a letter and a digit, stopwords dropped. No new tokenizer is introduced. A chunk
covers a facet when its text, tokenized the same way, contains that token. Facets are
processed in order of first occurrence in the question text, so selection is stable for a
given question.

Budget: facet slots are taken from the sibling allocation (`Math.floor(limit / 3)`), never
from the anchor allocation. The anchor count is therefore unchanged, `contextLimit` is
unchanged, and the final context size is unchanged - only the distribution inside the
sibling third changes. The function receives the question text as an additional argument.

### 2.2 Support validation before deletion

The grounding context already matches what the model saw: `selectedContext` is built from
`packed.selected`, the same chunks rendered into the user message. A supported term can
still be deleted through the comparison itself - whitespace normalization of multi-line
fenced units, or `containsExactNumber` for numeric units. Phase 0 case 6 pins the exact
branch, and the fix lands in `extractTechnicalUnits` or `findUnsupportedTechnicalUnits`.

Fail-closed behavior is preserved: a unit stays unsupported when any of its lines is
absent from the selected context. Widening the match to a looser comparison is not
acceptable.

### 2.3 Markdown repair after sanitation

`cleanSanitizedProseLine` removes empty links and collapses whitespace, and a line made
entirely of residue is already dropped. An empty emphasis span inside a surviving line is
not: `Use **** to mount.` remains. The function gains a pass that removes empty emphasis
spans (`**`, `*`, `__`, `_`), empty list items, and empty code labels created by removal.

### Phase 2 acceptance

- 10/10 fixed cases complete with zero model repair and zero invalid WikiLinks.
- Macro required-fact coverage at or above 92.904%.
- No malformed Markdown after sanitation.
- Unchanged Query input/output ceilings and unchanged final context size.

## Testing

- Phase 0 red tests, as defined above, in a dedicated test file.
- `tests/ingest-synthesis.test.ts`: source-wide gate and shared-page attribution.
- Focused coverage for `src/phases/synthesis-evidence-ledger.ts`: per-line coverage,
  contiguity, ordering, continuation normalization.
- `tests/query-budget.test.ts`: facet reservation. The two existing anchor and sibling
  tests must stay green, which bounds how far the distribution may shift.
- Focused coverage for `src/phases/query-grounding-validator.ts`: false-unsupported case
  and Markdown repair.

Every Phase 0 test turns green, every test above passes, and the existing suite stays
green before the live run starts.

## Live Verification Protocol

The steps run in this order.

1. Create the baseline snapshot at `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/before` by
   copying the current vault state. No such snapshot exists today, and all three audits
   default `beforeRoot` to `dirname(runRoot)/before`, so they cannot run without it.
2. Build the plugin and report the `cp` command and the expected `dist/main.js` SHA-256.
3. The user copies `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into the
   test vault plugin directory, verifies the SHA-256, and restarts Obsidian.
4. The user starts one clean force-reinit of `os-unix`, then a separate force-reinit of
   `os-mac`.
5. The user signals completion. Log reading starts only on that signal - no background
   watcher and no timed polling.
6. Run `analyze-agent-session.mjs`, then `audit-domain-quality.mjs`,
   `audit-page-integrity.mjs`, and `audit-query-grounding.mjs`, and compare against
   baseline session `1785096684125`.

The live run passes when os-unix completes 22/22 sources with terminal status `done`, page
integrity reports zero YAML, canonical-path, alias, provenance, or H1 failures, and both
Phase 1 and Phase 2 acceptance lists hold on the produced evidence files. Any acceptance
item that fails is reported with its measured value; a failed live run does not close the
register item.

## Second Domain: os-mac

`audit-domain-quality.mjs` hardcodes `sourceRoot = path.join(beforeRoot, "ОС", "Unix")`.
The source path becomes a CLI argument with the current value as its default, so the same
script serves both domains.

A new `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json` covers the 16
pages of that domain in the existing case format (`id`, `question`, `expectedPages`,
`requiredFacts`).

os-mac gates are diagnostic, not blocking. The domain has one source file, so it barely
exercises cross-source attribution on shared canonical pages, which is the core of TD-1.
That part of the invariant stays covered only by os-unix.

## Discovered Debt (Out of Scope)

Recorded from the baseline audit, not fixed here, and not currently in the register:

- `technicalValuePreservation` 0.5581 (24/43 values preserved).
- `declaredEntityCoverage` 0.3679 (39/106 declared entities covered).

Both are far worse than the 12/537 exact-snippet gap that TD-1 addresses, and each needs
its own investigation.

## Non-Actions

- Do not increase the 65,536 ingest input ceiling. Maximum provider-reported live input
  was 18,221 tokens.
- Do not increase synthesis batch size above the tested weak-model default of `1`.
- Do not weaken schema, canonical path, alias, page-hash, section-authority, WikiLink, or
  exact-grounding validation.
- Do not encode os-unix or os-mac benchmark vocabulary into production logic.
- Do not change Query input/output ceilings or the final context size.

## Risks

- A class from Phase 0 may prove unreproducible from real data. It is then reported and
  dropped, not fixed speculatively.
- Facet reservation spends part of the sibling third, so a case that depends on an
  adjacent sibling section may lose it. The existing `query-budget` tests and the fixed
  ten-case corpus catch this; the anchor allocation is never touched.
