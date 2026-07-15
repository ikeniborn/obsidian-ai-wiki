---
chain:
  intent: n/a
review:
  spec_hash: 410ced405739635e
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
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Design / F4"
      section_hash: 11b63173bd802d8c
      fragment: "the post-parse assistant_text{ isReasoning } emit … is kept or dropped per callsite"
      text: >-
        "kept or dropped per callsite" gave no firm per-callsite rule for which
        of bootstrap/extract/synthesise/merge retains vs removes the post-parse
        reasoning emit.
      fix: >-
        Enumerated the decision per callsite: drop the ingest synthesise
        ingest.ts:273 emit (reasoning now streams live), keep init.bootstrap
        ingest fullText (JSON, not reasoning), no change for extract/merge.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Root causes / R2"
      section_hash: 5f4d5eea4a085d48
      fragment: "call parseWithRetry with onEvent: (e) => arr.push(e)"
      text: >-
        Named the wrong function for 2 of 4 callsites: ingest synthesise
        (ingest.ts:252) and merge (ingest.ts:419) call runStructuredWithRetry
        directly with a framed-zod profile, not parseWithRetry. Only
        init.bootstrap and ingest extract use parseWithRetry.
      fix: >-
        Split the four callsites: bootstrap + extract use parseWithRetry
        (json-zod wrapper); synthesise + merge call runStructuredWithRetry with
        a framed-zod profile. Corrected in R2 and the F4 consumer switch.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "Design / F3"
      section_hash: 11b63173bd802d8c
      fragment: "but ${folder}.jsonl.tmp does (a metadata.jsonl.tmp leftover), promote it"
      text: >-
        Wrong path expression: folder is the full subfolder path, so
        ${folder}.jsonl.tmp resolves to sibling !Wiki/foo.jsonl.tmp, not the
        intended in-folder leftover.
      fix: >-
        Corrected to ${domainMetadataPath(folder)}.tmp =
        !Wiki/<folder>/metadata.jsonl.tmp (matches old save's tmpPath).
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-004
      phase: consistency
      severity: INFO
      section: "Design / F4"
      section_hash: 11b63173bd802d8c
      fragment: "runStructuredStreaming({ … profile, … onEvent: () => {} }, sink)"
      text: >-
        The two schema-based callsites (bootstrap, extract) supply a schema via
        parseWithRetry, not a profile object required by
        runStructuredStreaming→runStructuredWithRetry.
      fix: >-
        Noted that schema-based callsites must build { kind: "json-zod", schema }
        when switching to the streaming bridge.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-005
      phase: coverage
      severity: WARNING
      section: "Design / F3"
      section_hash: 11b63173bd802d8c
      fragment: "reconstruct a minimal DomainEntry ... when the folder looks like a real domain"
      text: >-
        Found during Task 2 implementation: content-based self-heal resurrects
        intentionally deleted domains. Delete-domain (settings.ts:398-402) does
        save(filter) — removes metadata.jsonl but leaves the folder, index.jsonl,
        and pages — so reconstructing from content would revive every deleted
        domain on the next load (zombie), and broke the existing
        domain-store-jsonl "removes metadata for domains omitted from save" test.
      fix: >-
        Narrowed self-heal to metadata.jsonl.tmp promotion only (the unambiguous
        interrupted-write signal, which Delete never leaves). Dropped
        content-based reconstruction from F3, the Decisions bullet, and the
        finding map. User-approved.
      verdict: fixed
      verdict_at: 2026-07-15
---
# Robust Domain Metadata & Live LLM Stream — Design

Date: 2026-07-15
Status: draft (design)
Branch: `dev-domain-metadata-live-stream`

## Problem

Two independent defects observed during domain creation via the **Add domain**
wizard:

1. **Metadata not persisted.** After creating a domain, the domain folder
   `!Wiki/<folder>/` exists (with pages / `index.jsonl`), but
   `!Wiki/<folder>/metadata.jsonl` is **missing**. Because `DomainStore.load`
   discovers domains by scanning for that file, the domain never appears in the
   domain selector — it cannot be picked for query / reinit / lint.
2. **No live LLM feedback.** During domain creation the progress panel shows the
   step chips (`Initialising domain`, `Extracting entities`, `Synthesising
   pages`) but no live streaming of the model's tokens or reasoning while each
   structured call runs — "не на всех шагах". The panel sits on a spinner until
   the call completes, then dumps the parsed `reasoning` in one block.

Both share the shape "the plumbing exists, but a value is swallowed instead of
surfaced": Bug 1 swallows a write failure; Bug 2 swallows the token stream.

## Root causes

### R1 — fragile atomic write in `DomainStore.save`

`DomainStore.save` (`src/domain-store.ts:77-85`) persists each domain with a
tmp-then-rename dance:

```
adapter.write(`${path}.tmp`, content)
if (exists(path)) remove(path)
rename(`${path}.tmp`, path)
```

In Obsidian the `rename` step can throw (adapter/file-cache races, the `!`
prefix in `!Wiki`, or a concurrent `list`/`read` from `load`). The thrown error
is **swallowed**:

- In `registerDomain` (`src/controller.ts:459-481`) `await
  this.domainStore.save(next)` is **not** wrapped, so a throw rejects the async
  IIFE in `openAddDomain` (`src/view.ts:483`, invoked via `void (async …)()`)
  and is lost. The `Domain added` Notice never fires, but no error is shown.
- In the run-event handler (`src/controller.ts:819-831`) a save throw is caught,
  sets `status = "error"`, aborts — but leaves the folder created (by ingest)
  and `metadata.jsonl` absent, plus a leftover `metadata.jsonl.tmp`.

Net effect: `!Wiki/<folder>/` with content but no `metadata.jsonl` → invisible
to `load`.

`metadata.jsonl` lives at `domainMetadataPath(domainWikiFolder(wiki_folder))` =
`!Wiki/<folder>/metadata.jsonl` (`src/wiki-path.ts:74`), and `load`
(`src/domain-store.ts:19-35`) only reads that exact path under each **subfolder**
of `!Wiki`. A missing file there yields a silently-absent domain.

### R2 — structured stream is not surfaced

`streamOnce` (`src/phases/structured-output.ts:171-212`) consumes the streaming
response and accumulates chunks into `fullText`, but never forwards the
per-chunk deltas. `extractStreamDeltas` (`src/phases/llm-utils.ts:105`) already
splits each chunk into `{ reasoning, content }`, yet `streamOnce` only reads
`content` (and token counts) and discards it into the accumulator. `onEvent` is
threaded into `runStructuredWithRetry` but only ever emits `structural_error`,
`rule_fired`, and stats events — never token deltas.

The consumers compound this. Two callsites use `parseWithRetry` (the thin
json-zod wrapper over `runStructuredWithRetry`): `init.bootstrap`
(`src/phases/init.ts:226`) and ingest **extract** (`src/phases/ingest.ts:136`).
Two call `runStructuredWithRetry` directly with a framed-zod profile: ingest
**synthesise** (`src/phases/ingest.ts:252`) and **merge**
(`src/phases/ingest.ts:419`). All four pass `onEvent: (e) => arr.push(e)` and
replay the buffered array **after** the `await` completes, so even if deltas
were emitted they would arrive as one post-hoc lump, not live.

The UI is already capable of live rendering: `view.appendEvent`
(`src/view.ts:799-824`) renders `assistant_text` with `isReasoning:true` as a
throttled 🧠 reasoning block and updates the live status line; non-reasoning
`assistant_text` only nudges the 💬 status (it is **not** written into the run
panel as text, so streaming raw JSON content is harmless). The missing piece is
purely the event source and a live (non-buffered) path from the structured call
to the view.

## Finding map & scope

| ID | Symptom | Root | In scope |
|----|---------|------|----------|
| F1 | `metadata.jsonl` missing → domain not selectable | R1 | ✅ |
| F2 | save failure swallowed, no user feedback | R1 | ✅ |
| F3 | already-broken domain (leftover `.tmp`, no metadata) stays invisible | R1 | ✅ (tmp promotion) |
| F4 | no live token/reasoning stream on structured steps | R2 | ✅ |
| F5 | one corrupt `metadata.jsonl` throws `DomainCorruptError`, hides **all** domains | load policy | ➖ out of scope (see Decisions) |

### Decisions

- **Direct write over tmp/rename.** `metadata.jsonl` is a small local file;
  crash-mid-write is far less likely than the observed `rename` failure. Replace
  tmp+remove+rename with a single `adapter.write(path, content)` and a
  post-write `exists` verification. This removes the failing step entirely
  rather than retrying it.
- **Surface, don't swallow.** `registerDomain` wraps `save` and returns
  `{ ok: false, error }` + `Notice` on failure, so a persist failure is visible
  and the wizard does not proceed into `init` on a broken domain.
- **Self-heal on load (tmp-only).** A domain folder with a leftover
  `metadata.jsonl.tmp` but no `metadata.jsonl` (interrupted old-style write) has
  its tmp promoted to the final path, so domains broken by the old code become
  selectable again after one load. Reconstruction from bare folder content is
  deliberately **not** done — it would resurrect intentionally deleted domains
  (see F3).
- **Stream reasoning live; content only as status.** Emit `assistant_text`
  reasoning deltas (🧠) live; emit content deltas too but rely on the view not
  rendering them as panel text (they only drive the 💬 status). No raw JSON is
  shown.
- **F5 left alone.** The "one corrupt file hides everything" behaviour is a
  separate robustness bug unrelated to a *missing* file; changing it now would
  widen the diff. Noted as a follow-up.

## Design

### F1/F2 — robust `DomainStore.save`

In `src/domain-store.ts`, the per-domain write loop (`:77-85`) becomes:

- Ensure the domain folder exists (unchanged).
- Remove a stale `${path}.tmp` if present (cleanup from prior broken runs).
- `await adapter.write(path, stringifyDomainMetadata(domainEntryToMetadataRecords(domain)))`
  directly (no tmp, no rename).
- Verify: `if (!(await adapter.exists(path))) throw new Error("metadata write failed: " + path)`.

The stale-metadata cleanup loop (`:62-76`, which removes metadata whose
`wiki_folder` relocated) is unchanged.

`registerDomain` (`src/controller.ts:459-481`) wraps the save:

```ts
try {
  await this.domainStore.save(next);
} catch (e) {
  const msg = (e as Error).message;
  new Notice(i18n().ctrl.domainAddFailed(msg));
  return { ok: false, error: msg };
}
```

(Existing `domainAddFailed` i18n key is reused.) The `openAddDomain` flow
already checks `if (!r.ok) return;` before `refreshDomains`/`init`, so a failed
persist now stops cleanly instead of silently continuing.

### F3 — self-heal in `DomainStore.load`

Recover **only** from a leftover `metadata.jsonl.tmp` — the unambiguous
signature of an interrupted old-style write. In `src/domain-store.ts:19-35`,
when iterating `!Wiki` subfolders and `domainMetadataPath(folder)` does **not**
exist:

- If `${domainMetadataPath(folder)}.tmp` exists — i.e.
  `!Wiki/<folder>/metadata.jsonl.tmp`, the leftover from the old `save`'s
  `tmpPath` after a failed `rename` — promote it: read it, write it to the final
  path, remove the tmp, parse it, and mark the set dirty.
- Otherwise (metadata absent, no tmp) — leave the folder alone (`continue`).
- After the scan, if any domain was promoted, `await this.save(domains)` to
  canonicalize (guarded to run once, folded into the existing `m2 || m3`
  migration save so a single write suffices).

**Why not reconstruct from folder content.** The reported failure (old
`write(tmp)` → `rename` throws) always leaves a `metadata.jsonl.tmp`, so tmp
promotion recovers exactly the reported bug. Reconstructing from mere content
(index/pages) would be indistinguishable from an **intentionally deleted**
domain: Delete-domain (`settings.ts:398-402`) does `save(filter)`, which removes
`metadata.jsonl` but leaves the folder, `index.jsonl`, and pages on disk. A
content-based self-heal would resurrect every deleted domain (a zombie) on the
next load. The `.tmp` signal is unique to an interrupted write — Delete never
leaves one — so tmp-only recovery fixes the bug without the collision.

Accepted tradeoff: a domain broken with **no** leftover `.tmp` (e.g. metadata
deleted by hand) is not auto-recovered — that state is indistinguishable from an
intentional deletion, and Task 1's robust write prevents the failure going
forward. This keeps the discovery contract (a domain is a `!Wiki` subfolder with
`metadata.jsonl`) intact.

### F4 — live structured stream

**Emit deltas.** Thread `onEvent` into `streamOnce` and
`callWithFormatFallback` (`src/phases/structured-output.ts`). In the chunk loop
of `streamOnce`, per chunk:

```ts
const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
if (reasoning) onEvent({ kind: "assistant_text", delta: reasoning, isReasoning: true });
if (content) { fullText += content; onEvent({ kind: "assistant_text", delta: content }); }
if (tok !== undefined) outputTokens = tok;
```

The non-streaming fallback path emits nothing (acceptable — mobile/degraded).

**Live bridge helper.** Add `runStructuredStreaming` to
`src/phases/structured-output.ts`:

```ts
export interface StructuredSink<T> { value?: T; outputTokens?: number; fullText?: string; }

export async function* runStructuredStreaming<T>(
  args: RunStructuredArgs<T>,   // args.onEvent is ignored; the bridge supplies its own
  sink: StructuredSink<T>,
): AsyncGenerator<RunEvent> {
  const queue: RunEvent[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let error: unknown = null;
  const onEvent = (ev: RunEvent) => { queue.push(ev); wake?.(); };

  const p = runStructuredWithRetry({ ...args, onEvent })
    .then((r) => { sink.value = r.value; sink.outputTokens = r.outputTokens; sink.fullText = r.fullText; })
    .catch((e) => { error = e; })
    .finally(() => { settled = true; wake?.(); });

  while (!settled || queue.length) {
    while (queue.length) yield queue.shift()!;
    if (!settled) await new Promise<void>((res) => { wake = () => { wake = null; res(); }; });
  }
  await p;
  if (error) throw error;
}
```

Because the deltas from `streamOnce` flow through this same `onEvent`, they are
queued and yielded **live** while the model generates.

**Consumer switch.** Replace the buffer-then-replay pattern at the four
domain-creation callsites. `runStructuredStreaming` takes a `StructuredProfile`
(same as `runStructuredWithRetry`), so each callsite supplies its existing
profile:

- `init.bootstrap` (`src/phases/init.ts:226`) — currently `parseWithRetry({ schema })`; build `{ kind: "json-zod", schema: DomainEntrySchema }`.
- ingest **extract** (`src/phases/ingest.ts:136`) — currently `parseWithRetry({ schema })`; build `{ kind: "json-zod", schema }`.
- ingest **synthesise** (`src/phases/ingest.ts:252`) — already `runStructuredWithRetry({ profile: framed-zod })`; pass that profile through.
- ingest **merge** (`src/phases/ingest.ts:419`) — already `runStructuredWithRetry({ profile: framed-zod })`; pass that profile through.

From (generic, per current form):
```ts
const collected: RunEvent[] = [];
const r = await runStructuredWithRetry({ …, profile, onEvent: (e) => collected.push(e) });
… ; for (const ev of collected) yield ev;
```
To:
```ts
const sink: StructuredSink<T> = {};
for await (const ev of runStructuredStreaming({ llm, model, baseMessages, opts, profile, maxRetries, callSite, signal, onEvent: () => {} }, sink)) {
  yield ev;
}
const r = { value: sink.value!, outputTokens: sink.outputTokens ?? 0, fullText: sink.fullText ?? "" };
```
`try/catch` around the `for await` preserves each callsite's existing
error/abort handling (bootstrap fail-loud, embedding-stop, per-file retry).

**Per-callsite post-parse emit (DoD):**
- ingest synthesise emits the parsed reasoning post-hoc at `ingest.ts:273`
  (`assistant_text{ isReasoning:true }`). **Keep** it. `wikiPagesProfile()` is
  framed-zod: its `reasoning` field is parsed from the `<<<REPORT>>>` frame
  carried in the model's **content** stream, which `streamOnce` emits as
  non-`isReasoning` deltas (a 💬 status nudge, not a 🧠 block). Only a model's
  native `delta.reasoning` tokens stream as a live 🧠 block. Dropping the `:273`
  emit would therefore remove the visible reasoning block for models that carry
  reasoning only inside the frame — so the post-parse block stays. Live
  streaming still adds a progress signal (💬 activity, plus native 🧠 tokens
  when the model emits them).
- init.bootstrap emits `r.fullText` (JSON content, not reasoning) at
  `init.ts:237`; that is unaffected by live reasoning — **keep** it.
- ingest extract and merge have no post-parse `isReasoning` emit — **no change**.

**Scope:** init + ingest (the domain-creation path). `lint` / `format` / `query`
keep their current behaviour; adopting the helper there is an optional
follow-up.

## Testing

Framework: `node:test` + `node:assert/strict` run via `tsx`, with the shared
`MemoryAdapter` fake (see `tests/domain-store-jsonl.test.ts`) and the mock
`LlmClient` pattern (see `tests/structured-output.test.ts`).

- **F1 — rename-hostile adapter.** Extend `MemoryAdapter` so `rename` throws;
  `DomainStore.save` still leaves a parseable `metadata.jsonl` at
  `!Wiki/<folder>/metadata.jsonl`, and a subsequent `load` returns the domain.
- **F1 — verification.** With an adapter whose `write` is a no-op, `save`
  throws `metadata write failed: …` (no silent success).
- **F2 — registerDomain.** With a `save` that throws, `registerDomain` resolves
  to `{ ok: false }` (not a rejection).
- **F3 — self-heal.** Seed a `MemoryAdapter` with `!Wiki/foo/index.jsonl` and at
  least one page but no `metadata.jsonl`; `load` returns a `foo` domain and the
  adapter now contains `!Wiki/foo/metadata.jsonl`. Second variant: a leftover
  `metadata.jsonl.tmp` is promoted to `metadata.jsonl`.
- **F4 — delta emit.** A mock stream yielding chunks with `delta.reasoning`
  and `delta.content` makes `runStructuredWithRetry` emit ordered
  `assistant_text` events (`isReasoning:true` for reasoning, plain for content),
  interleaved before the final parse.
- **F4 — live bridge.** `runStructuredStreaming` yields the queued events and
  sets `sink.value`/`sink.outputTokens`/`sink.fullText`; a thrown structured
  error propagates out of the generator.
- **Regression:** existing `tests/*.test.ts` (esp. `structured-output`,
  `domain-store-jsonl`, `init-*`) pass unchanged.

## Out of scope / follow-ups

- F5: `DomainCorruptError` from one bad `metadata.jsonl` aborting the whole
  `load` (all domains hidden). Separate robustness fix.
- Extending the live stream to `lint` / `format` / `query` callsites.
