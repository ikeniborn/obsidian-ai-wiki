---
review:
  spec_hash: 1357d159ba1d484e
  last_run: 2026-07-15
  phases:
    - name: structure
      status: passed
    - name: coverage
      status: passed
    - name: clarity
      status: passed
    - name: consistency
      status: passed
  findings: []
chain:
  intent: n/a
---
# Duplicate Guards, Sidebar Swap & Query Audit — Design

Date: 2026-07-15
Status: approved (design)
Branch: `dev-dedup-and-sidebar-refinements` (to be created from `master`)

## Scope

Four independent items, bundled because they all touch the query/ingest paths:

1. **P1 — Duplicate-free ingest & retrieval** (design-heavy). Guarantee no
   duplicate content survives a write (`ingest.merge`) and no duplicate chunk
   reaches the LLM at search time. Approach **A + D** (see below).
2. **P2 — Sidebar ask-button swap** (mechanical UI change).
3. **P3 — Graph search scoped to `!Wiki`** (verification + guard test).
4. **P4 — Ask-Wiki parity with Ask-Domain** (verification + parity test).

Non-goals: near-duplicate (fuzzy) chunk merging, enabling `dedupOnIngest` by
default, reworking the reranker.

---

## P1 — Duplicate-free ingest & retrieval

Two guarantees, one at write time, one at search time.

### P1a — Search-time chunk dedup (approach A, deterministic guardrail)

**Problem.** Neither `page-similarity.ts` (`selectRelevantChunks`) nor
`reranker.ts` removes duplicate chunks. When two candidate pages share an
identical section (unmerged duplicate pages, or shared boilerplate), the same
chunk text is sent to the LLM twice — wasted context and biased answers. This
is the "нет мерджа дублей чанков" the user reported.

**Design.** New module `src/chunk-dedup.ts`:

```ts
export function dedupeChunks(chunks: SelectedChunk[]): { chunks: SelectedChunk[]; dropped: number }
```

- Key = `normalizeChunkKey(heading, text)` — lowercase, collapse runs of
  whitespace to a single space, trim. Exact-normalized match only (no fuzzy).
- Keep the chunk with the **highest `score`** per key; preserve first-seen order
  among the kept chunks.
- Return the deduped list plus a `dropped` count for diagnostics.

**Wiring — identical call in both query paths** (this is what makes P4 parity
free):

- `src/phases/query.ts` — after `selectRelevantChunks` (~line 324), before
  `rerankChunks` (~line 331).
- `src/phases/query-cross-domain.ts` — after `selectRelevantChunks` (~line 140),
  before `rerankChunks` (~line 156).

**Diagnostics.** Add an optional `chunkDupsDropped?: number` field to the
existing `query_stats` event, populated from `dropped`. Minimal, no new UI.

### P1b — Write-time merge section guarantee (approach D)

**Problem.** The `ingest.merge` path (`src/phases/ingest.ts` lines 403–441,
gated by `dedupOnIngest`) asks an LLM to merge a near-duplicate incoming draft
into an existing page. The LLM can silently drop the incoming draft's unique
content — the "секция пока не добавляет" symptom. Prompt wording alone cannot
guarantee retention.

**Design.** Deterministic floor applied to the LLM merge output, before writing:

```ts
export function ensureIncomingSections(merged: string, incoming: string): string
```

- Parse `##` headings from both `merged` and `incoming` (reuse the heading
  parser used by chunking, or a small local parser).
- For each incoming `##` section whose normalized heading is **absent** from
  `merged`, append that section verbatim to the end of `merged`.
- Skip the structural sections `## Related` and `## External links` — the merge
  prompt already unions those bullet lists; appending would duplicate them.

**Wiring.** In `ingest.ts`, between `runStructuredWithRetry` (line ~419) and
`vaultTools.write(targetPath, ...)` (line 427), replace the written content with
`ensureIncomingSections(merged.value.content, page.content)`.

**Default stays opt-in.** `dedupOnIngest` remains `false` by default
(`src/types.ts:326`). The always-on guarantee is provided by P1a at search time;
P1b only hardens the opt-in write path.

---

## P2 — Sidebar ask-button swap

**Current** (`src/view.ts:219-220`):

```ts
this.askDomainBtn = askButtons.createEl("button", { text: T.view.askDomain });               // grey (first)
this.askWikiBtn   = askButtons.createEl("button", { text: T.view.askWiki, cls: "mod-cta" });  // accent (second)
```

**Target** — swap both order and style:

```ts
this.askWikiBtn   = askButtons.createEl("button", { text: T.view.askWiki });                  // grey (first)
this.askDomainBtn = askButtons.createEl("button", { text: T.view.askDomain, cls: "mod-cta" }); // accent (second)
```

- "Ask Domain" becomes the primary CTA (accent); "Ask Wiki" becomes secondary
  (grey), keeping its confirm modal.
- Event handlers, the `askWiki` `ConfirmModal`, and
  `updateButtonAvailability()` (lines 438-439) stay keyed to the same button
  fields — no logic change.
- Rebuild `dist`.

---

## P3 — Graph search scoped to `!Wiki`

**Claim to verify.** Graph BFS operates only on pages inside
`!Wiki/<subfolder>`, never on source docs, `_config`, or `*.jsonl` sidecars.

**Current evidence.** In `retrieveDomainCandidates` (`src/phases/query.ts`):
`wikiVaultPath = domainWikiFolder(domain.wiki_folder)` (→ `!Wiki/<subfolder>`),
`allFiles = listFiles(wikiVaultPath)`, `files = allFiles.filter(isWikiPagePath)`
(lines 105-107). The graph is built from `pages` derived from `files`. The
cross-domain path reuses `retrieveDomainCandidates`, so the same scope applies.
`isWikiPagePath` excludes `_config/` and the JSONL/legacy meta basenames
(`src/wiki-path.ts`).

**Deliverable.** A focused test asserting the graph node set is a subset of
`!Wiki` content pages and excludes `_config`, `*.jsonl` sidecars, and paths
outside `!Wiki`. Fix only if the test finds a leak.

---

## P4 — Ask-Wiki parity with Ask-Domain

**Claim to verify.** The cross-domain ("Ask Wiki", `domainId === "*"`) path
processes chunk vectors and reranks identically to the single-domain
("Ask Domain") path.

**Current evidence.** `agent-runner.ts:116` routes `"*"` to
`runCrossDomainQuery`, else `runQuery`; both receive the same `rerankerRuntime`.
Both pipelines run: `retrieveDomainCandidates` (vector + graph + seed +
boilerplate demotion) → `selectRelevantChunks` → `rerankChunks` →
`renderContextChunks` → `answerFromContext`, with
`candidateLimit = rerankerTopN` and `contextLimit = contextTopN` from the shared
`rerankerRuntime.config`.

**Deliverable.** A parity test / checklist confirming both paths use the same
pipeline stages, the same `rerankerRuntime` config values, boilerplate
demotion, and the new `dedupeChunks` (P1a). Fix any divergence found.

---

## Testing

- **Unit** `dedupeChunks`: exact duplicates removed; highest-`score` copy kept;
  first-seen order preserved; non-duplicates untouched.
- **Unit** `ensureIncomingSections`: a missing incoming `##` section is appended;
  an already-present heading is not duplicated; `## Related` / `## External
  links` are not appended.
- **Test** P3: graph nodes ⊆ `!Wiki` pages, sidecars/`_config`/out-of-wiki
  excluded.
- **Test** P4: cross-domain vs single-domain pipeline + config parity.
- **Build** `dist`.
- **Smoke**: Ask-Domain and Ask-Wiki return no duplicate context chunk; an
  `ingest` merge with `dedupOnIngest` on keeps the incoming draft's unique
  section.

## Files touched

- New: `src/chunk-dedup.ts`, `tests/` for the units above.
- Edit: `src/phases/query.ts`, `src/phases/query-cross-domain.ts`,
  `src/phases/ingest.ts`, `src/view.ts`, `src/types.ts` (diag field).
- Rebuild: `dist/`.

## Risks

- `ensureIncomingSections` heading parsing must match the merge prompt's section
  model, or it may append a section the prompt already merged under a slightly
  different heading. Mitigation: normalize headings the same way as the dedup
  key; keep the `## Related` / `## External links` skip list.
- Diagnostics field is additive/optional — no consumer breakage.
