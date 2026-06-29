---
review:
  plan_hash: adfd94a6cb800f30
  spec_hash: 616638c9814f9f17
  last_run: 2026-06-29
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-29-ask-wiki-domain-stats-comment-design.md
result_check:
  verdict: OK
  plan_hash: adfd94a6cb800f30
  last_run: 2026-06-30
---

# Ask Wiki / Ask Domain Buttons, Search Stats, Comment Box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cross-domain scope `<select>` with explicit `Ask Domain` / `Ask Wiki` buttons, show a per-query search-stats block (pages analyzed / selected / tokens) for both query kinds, and rework the dev-mode comment box.

**Architecture:** A new `query_stats` `RunEvent` is emitted by `runQuery` (single-domain) and `runCrossDomainQuery` (cross-domain) right before the LLM answer; the sidebar view renders it as a block above the answer and fills the "tokens sent" line later from the existing `llm_call_stats` event. The scope selector and its persistence are removed; two buttons drive routing (`Ask Domain` → selected domain, `Ask Wiki` → `"*"` cross-domain behind a `ConfirmModal`). The comment textarea is enlarged and its Save button becomes a `Saved` confirmation.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, ESLint, tsx (out-of-vault eval harness).

## Global Constraints

- **No new settings, no settings migration.** Every retrieval knob is reused as-is.
- **i18n keys go into all three locales** (`en` / `ru` / `es`) in `src/i18n.ts`.
- **Stats are query-only** — never emitted for `chat` / `format` / `init` / `ingest` / `lint`.
- **The legacy `domainId === undefined` path is untouched** (only `"*"` and concrete-domain routing change at the view layer).
- **Docs, code comments, commit messages: English.**
- **`dist/` is committed** — run `npm run build` and commit the rebuilt bundle in the final task.
- **Verification commands:** `npm run lint` (ESLint), `npx tsc --noEmit` (typecheck), `npx tsx eval/cross-domain/run.ts` (eval), `npm run build` (bundle).

---

### Task 1: `query_stats` event type + `pagesScanned` candidate field

**Files:**
- Modify: `src/types.ts:60` (add a `query_stats` member to the `RunEvent` union)
- Modify: `src/phases/query.ts:34-49` (add `pagesScanned` to `DomainCandidates`), `src/phases/query.ts:165-169` (populate it)
- Modify: `eval/cross-domain/run.ts:29-34` (add `pagesScanned` to the `fakeCandidates` fixture)

**Interfaces:**
- Produces: `RunEvent` variant `{ kind: "query_stats"; crossDomain: boolean; pagesScanned: number; pagesSelected: number; domainName?: string; domainsStudied?: number; domainsTotal?: number; fromDomains?: string[] }`; `DomainCandidates.pagesScanned: number`.

- [ ] **Step 1: Add the `query_stats` member to the `RunEvent` union**

In `src/types.ts`, after the `llm_call_stats` block (ends at line 60, before `| { kind: "error"; ... }`), insert:

```ts
  | {
      kind: "query_stats";
      crossDomain: boolean;
      pagesScanned: number;        // pages read/analyzed
      pagesSelected: number;       // pages handed to the LLM
      domainName?: string;         // Ask Domain only
      domainsStudied?: number;     // Ask Wiki only — domains that yielded candidates
      domainsTotal?: number;       // Ask Wiki only — domains configured
      fromDomains?: string[];      // Ask Wiki only — domain names in the final set
    }
```

- [ ] **Step 2: Add `pagesScanned` to `DomainCandidates`**

In `src/phases/query.ts`, inside `interface DomainCandidates` (line 34-49), add after `seedOutputTokens` (line 48):

```ts
  pagesScanned: number;              // total pages in the domain (files.length)
```

- [ ] **Step 3: Populate `pagesScanned` in the `retrieveDomainCandidates` return**

In `src/phases/query.ts`, the return object at line 165-169 currently ends with `seedFallback, seedFallbackReason, seedOutputTokens,`. Add `pagesScanned: files.length,` to it (the `files` array is already in scope — its `.length` is emitted in `graph_stats.total` at line 155):

```ts
  return {
    domainId: domain.id, pages: candidatePages, seeds, candidateIds: selectedIds,
    seedScores, expandedScores, graph: graphResult.graph, annotations, indexContent,
    retrievalMode, denseMax, seedFallback, seedFallbackReason, seedOutputTokens,
    pagesScanned: files.length,
  };
```

- [ ] **Step 4: Update the eval `fakeCandidates` fixture to satisfy the new field**

In `eval/cross-domain/run.ts`, the `fakeCandidates` return (line 29-33) is missing `pagesScanned`. Add it so the fixture type-checks:

```ts
  return {
    domainId, pages, seeds: ids, candidateIds: new Set(ids),
    seedScores, expandedScores: {}, graph, annotations, indexContent: "",
    retrievalMode: "jaccard", denseMax: 0, seedFallback: "none", seedOutputTokens: 0,
    pagesScanned: ids.length,
  };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — the new union member and field are consistent).

- [ ] **Step 6: Run the eval to confirm the fixture still drives the pipeline**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: `OK — N passed, 0 failed` (unchanged behavior; fixture now carries `pagesScanned`).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/phases/query.ts eval/cross-domain/run.ts
git commit -m "feat(query): query_stats event type + pagesScanned candidate field"
```

---

### Task 2: Emit `query_stats` from `runQuery` and `runCrossDomainQuery`

**Files:**
- Modify: `src/phases/query.ts:251` (emit `query_stats` before `answerFromContext`)
- Modify: `src/phases/query-cross-domain.ts:135` (emit `query_stats` before `answerFromContext`)
- Modify: `eval/cross-domain/run.ts` (add asserts; import `runQuery`)

**Interfaces:**
- Consumes: `DomainCandidates.pagesScanned` (Task 1); `query_stats` `RunEvent` (Task 1); existing `merged.finalIds`, `poolList`, `finalNames` in `runCrossDomainQuery`; existing `cand`, `selectedIds`, `domain` in `runQuery`.

- [ ] **Step 1: Add the failing cross-domain assert**

In `eval/cross-domain/run.ts`, inside the `runCrossDomainQuery` section, after the existing `check("per-domain progress emitted", …)` (line 117), add:

```ts
    const qs = evs.find((e) => e.kind === "query_stats") as Extract<RunEvent, { kind: "query_stats" }> | undefined;
    check("emits query_stats (cross)", !!qs && qs.crossDomain === true);
    check("query_stats.pagesSelected == finalIds length",
      !!qs && !!evalMeta && qs.pagesSelected === (evalMeta.fields.found_pages as string[]).length,
      `pagesSelected=${qs?.pagesSelected}`);
    check("query_stats.pagesScanned > 0", !!qs && qs.pagesScanned > 0, `pagesScanned=${qs?.pagesScanned}`);
    check("query_stats.fromDomains non-empty", !!qs && Array.isArray(qs.fromDomains) && qs.fromDomains.length > 0);
```

- [ ] **Step 2: Run the eval to verify it fails**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: FAIL — `emits query_stats (cross)` (no `query_stats` event yet).

- [ ] **Step 3: Emit `query_stats` from `runCrossDomainQuery`**

In `src/phases/query-cross-domain.ts`, after `domainName` is built (line 117) and before the `const ans = yield* answerFromContext({…})` call (line 136), insert:

```ts
  yield {
    kind: "query_stats",
    crossDomain: true,
    domainsStudied: poolList.length,
    domainsTotal: domains.length,
    fromDomains: finalNames,
    pagesScanned: poolList.reduce((sum, c) => sum + c.pagesScanned, 0),
    pagesSelected: merged.finalIds.length,
  };
```

- [ ] **Step 4: Run the eval to verify the cross asserts pass**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: PASS for all four new cross asserts.

- [ ] **Step 5: Add the failing single-domain assert (import `runQuery`)**

In `eval/cross-domain/run.ts`, change the import on line 9 from:

```ts
import { retrieveDomainCandidates } from "../../src/phases/query";
```

to:

```ts
import { retrieveDomainCandidates, runQuery } from "../../src/phases/query";
```

Then, after the `retrieveDomainCandidates (jaccard, single domain)` section (after line 152), add a new section:

```ts
  section("runQuery query_stats (single domain)");
  {
    const files = {
      "!Wiki/work/_config/_index.md": "- [[wiki_work_neural]] — neural networks deep learning",
      "!Wiki/work/EntityType/wiki_work_neural.md": "# Neural\nneural networks deep learning models",
    };
    const vault = fakeVault(files);
    const { llm } = fakeLlm("Answer about [[wiki_work_neural]].");
    const signal = new AbortController().signal;
    const evs = await drive(runQuery(
      ["neural networks"], false, vault, llm, "fake-model", [dom("work")], "", signal,
      1, {}, 5, 0, 10, undefined, 3, 0, false, 60,
    ) as AsyncGenerator<RunEvent, void>);
    const qs = evs.find((e) => e.kind === "query_stats") as Extract<RunEvent, { kind: "query_stats" }> | undefined;
    check("single emits query_stats crossDomain false", !!qs && qs.crossDomain === false);
    check("single query_stats.pagesSelected > 0", !!qs && qs.pagesSelected > 0, `pagesSelected=${qs?.pagesSelected}`);
    check("single query_stats.pagesScanned > 0", !!qs && qs.pagesScanned > 0, `pagesScanned=${qs?.pagesScanned}`);
    check("single query_stats.domainName set", !!qs && qs.domainName === "work");
  }
```

- [ ] **Step 6: Run the eval to verify it fails**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: FAIL — `single emits query_stats crossDomain false` (no emission in `runQuery` yet).

- [ ] **Step 7: Emit `query_stats` from `runQuery`**

In `src/phases/query.ts`, immediately before `const ans = yield* answerFromContext({…})` (line 252), insert:

```ts
  yield {
    kind: "query_stats",
    crossDomain: false,
    domainName: domain.name,
    pagesScanned: cand.pagesScanned,
    pagesSelected: selectedIds.size,
  };
```

- [ ] **Step 8: Run the eval to verify all asserts pass**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: `OK — N passed, 0 failed`.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/phases/query.ts src/phases/query-cross-domain.ts eval/cross-domain/run.ts
git commit -m "feat(query): emit query_stats (single + cross) before the answer"
```

---

### Task 3: Render the search-stats block in the sidebar + fill tokens

**Files:**
- Modify: `src/view.ts` (new fields near line 150; `query_stats` branch + `llm_call_stats` token fill in `handleEvent` near line 772; `renderQueryStats`/`fillQueryStatsTokens` methods; cleanup in `setRunning` near line 647)
- Modify: `src/styles.css` (new `.ai-wiki-cross-stats` rules)
- Modify: `src/i18n.ts` (stats labels in en/ru/es)

**Interfaces:**
- Consumes: `query_stats` `RunEvent` (Task 1/2); existing `llm_call_stats` event with `inputTokens`; `this.resultSection`, `this.finalEl` (existing view members).
- Produces: `private queryStatsEl: HTMLElement | null`, `private queryStatsTokensEl: HTMLElement | null`; i18n keys `statsDomain`, `statsDomainsStudied`, `statsInfoFrom`, `statsAnalyzed`, `statsSelected`, `statsInAnswer`, `statsTokensSent`.

- [ ] **Step 1: Add i18n stats labels (en / ru / es)**

In `src/i18n.ts`, inside each locale's `view` object, add these keys. For `en` (near line 190, alongside `commentSave`):

```ts
    statsDomain: "Domain:",
    statsDomainsStudied: "Domains studied:",
    statsInfoFrom: "Info from:",
    statsAnalyzed: "Pages analyzed:",
    statsSelected: "Selected for LLM:",
    statsInAnswer: "In answer:",
    statsTokensSent: "Tokens sent:",
```

For `ru` (near line 539):

```ts
    statsDomain: "Домен:",
    statsDomainsStudied: "Изучено доменов:",
    statsInfoFrom: "Информация из:",
    statsAnalyzed: "Проанализировано страниц:",
    statsSelected: "Выбрано для LLM:",
    statsInAnswer: "Попало в ответ:",
    statsTokensSent: "Отправлено токенов:",
```

For `es` (near line 867):

```ts
    statsDomain: "Dominio:",
    statsDomainsStudied: "Dominios estudiados:",
    statsInfoFrom: "Información de:",
    statsAnalyzed: "Páginas analizadas:",
    statsSelected: "Seleccionadas para LLM:",
    statsInAnswer: "En la respuesta:",
    statsTokensSent: "Tokens enviados:",
```

- [ ] **Step 2: Add view fields for the stats block**

In `src/view.ts`, near the other live-status fields (around line 150-152, alongside `liveStatusSection`), add:

```ts
  private queryStatsEl: HTMLElement | null = null;
  private queryStatsTokensEl: HTMLElement | null = null;
```

- [ ] **Step 3: Add the `renderQueryStats` and `fillQueryStatsTokens` methods**

In `src/view.ts`, add these two private methods (e.g. just above `renderCommentBox`, near line 935):

```ts
  /** Search-stats block shown above the answer, for both Ask Domain and Ask Wiki.
   *  Retrieval metrics are known up front; the tokens line is filled later from llm_call_stats. */
  private renderQueryStats(ev: Extract<RunEvent, { kind: "query_stats" }>): void {
    this.queryStatsEl?.remove();
    this.resultSection.removeClass("ai-wiki-hidden");
    const T = i18n().view;
    const box = this.resultSection.createDiv("ai-wiki-cross-stats");
    this.resultSection.insertBefore(box, this.finalEl);
    const line = (label: string, value: string) => {
      const row = box.createDiv("ai-wiki-cross-stats-row");
      row.createSpan({ cls: "ai-wiki-cross-stats-label", text: label });
      row.createSpan({ cls: "ai-wiki-cross-stats-value", text: value });
    };
    if (ev.crossDomain) {
      line(T.statsDomainsStudied, `${ev.domainsStudied ?? 0} / ${ev.domainsTotal ?? 0}`);
      line(T.statsInfoFrom, (ev.fromDomains ?? []).join(", ") || "—");
      line(T.statsAnalyzed, String(ev.pagesScanned));
      line(T.statsInAnswer, String(ev.pagesSelected));
    } else {
      line(T.statsDomain, ev.domainName ?? "—");
      line(T.statsAnalyzed, String(ev.pagesScanned));
      line(T.statsSelected, String(ev.pagesSelected));
    }
    const tokRow = box.createDiv("ai-wiki-cross-stats-row");
    tokRow.createSpan({ cls: "ai-wiki-cross-stats-label", text: T.statsTokensSent });
    this.queryStatsTokensEl = tokRow.createSpan({ cls: "ai-wiki-cross-stats-value", text: "…" });
    this.queryStatsEl = box;
  }

  /** Fill the "tokens sent" line once the LLM call reports usage. No-op if no stats block is live. */
  private fillQueryStatsTokens(inputTokens: number): void {
    this.queryStatsTokensEl?.setText(String(inputTokens));
  }
```

- [ ] **Step 4: Wire the `query_stats` branch and token fill into `handleEvent`**

In `src/view.ts`, the `llm_call_stats` branch at line 772 is currently:

```ts
    if (ev.kind === "llm_call_stats") { this.llmStats.push(ev); return; }
```

Replace it with (handle `query_stats` and fill tokens from `llm_call_stats`):

```ts
    if (ev.kind === "query_stats") { this.renderQueryStats(ev); return; }
    if (ev.kind === "llm_call_stats") { this.llmStats.push(ev); this.fillQueryStatsTokens(ev.inputTokens); return; }
```

- [ ] **Step 5: Clear the stale stats block in `setRunning`**

In `src/view.ts`, inside `setRunning`, next to the result-section reset (around line 647, where `this.resultSection.addClass("ai-wiki-hidden")` is), add:

```ts
    this.queryStatsEl?.remove();
    this.queryStatsEl = null;
    this.queryStatsTokensEl = null;
```

- [ ] **Step 6: Add the stats block styles**

In `src/styles.css`, append:

```css
.ai-wiki-cross-stats { border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; font-size: 0.85em; }
.ai-wiki-cross-stats-row { display: flex; justify-content: space-between; gap: 8px; }
.ai-wiki-cross-stats-label { color: var(--text-muted); }
.ai-wiki-cross-stats-value { font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (the i18n keys exist in all three locales; `Extract<RunEvent, …>` resolves).

- [ ] **Step 8: Commit**

```bash
git add src/view.ts src/styles.css src/i18n.ts
git commit -m "feat(view): search-stats block above the answer + token fill"
```

---

### Task 4: `Ask Domain` / `Ask Wiki` buttons; remove the scope selector

**Files:**
- Modify: `src/view.ts` (fields near line 95-99; remove scope row + `syncScope` lines 209-244; rewrite ask-row lines 246-251; `submitQuery` lines 613-622; `updateButtonAvailability` line 458; `setRunning` line 630)
- Modify: `src/local-config.ts:23` (remove `lastQueryScope`)
- Modify: `src/i18n.ts` (remove scope keys; rename `ask`→`askDomain`; add `askWiki` + confirm strings in en/ru/es)
- Modify: `src/styles.css` (add `.ai-wiki-ask-buttons`; remove `.ai-wiki-scope-*` if present)

**Interfaces:**
- Consumes: `ConfirmModal(app, title, lines, onConfirm)` from `src/modals.ts`; `controller.query(question, domainId)`.
- Produces: `private askDomainBtn!: HTMLButtonElement`, `private askWikiBtn!: HTMLButtonElement`; `submitQuery(domainArg: string)`.

- [ ] **Step 1: Update i18n — remove scope keys, rename `ask`, add buttons + confirm (en/ru/es)**

In `src/i18n.ts`, in the `en` `view` block: delete `scopeAll`, `scopeDomain`, `scopeHint` (lines 170-172); replace `ask: "Ask",` (line 165) with:

```ts
    askDomain: "Ask Domain",
    askWiki: "Ask Wiki",
    askWikiConfirmTitle: "Ask across all wiki domains?",
    askWikiConfirmBody: "This searches every domain in your wiki and answers from the combined result.",
```

In the `ru` block: delete `scopeAll`/`scopeDomain`/`scopeHint` (lines 520-522); replace `ask: "Спросить",` (line 515) with:

```ts
    askDomain: "Спросить домен",
    askWiki: "Спросить вики",
    askWikiConfirmTitle: "Искать по всем доменам вики?",
    askWikiConfirmBody: "Поиск выполняется по всем доменам вики; ответ формируется из объединённого результата.",
```

In the `es` block: delete `scopeAll`/`scopeDomain`/`scopeHint` (lines 848-850); replace `ask: "Preguntar",` (line 843) with:

```ts
    askDomain: "Preguntar dominio",
    askWiki: "Preguntar wiki",
    askWikiConfirmTitle: "¿Buscar en todos los dominios del wiki?",
    askWikiConfirmBody: "Busca en todos los dominios del wiki y responde a partir del resultado combinado.",
```

- [ ] **Step 2: Replace the view button fields**

In `src/view.ts`, remove the `scopeToggle` field (line 95), the `desiredScope` field (lines 96-98), and the `askBtn` field (line 99). In their place add:

```ts
  private askDomainBtn!: HTMLButtonElement;
  private askWikiBtn!: HTMLButtonElement;
```

(Keep `domainSelect` on line 100.)

- [ ] **Step 2b: Confirm `ConfirmModal` is imported**

`ConfirmModal` is already imported in `src/view.ts:2`. No import change needed. (Verify the line still lists `ConfirmModal`.)

- [ ] **Step 3: Remove the scope row + `syncScope` and rewrite the ask row**

In `src/view.ts`, delete the entire block from line 209 (`const T2 = i18n().view;`) through line 251 (the old `cancelBtn` click listener) — this removes `scopeRow`, `scopeToggle`, `syncScope`, the persisted-scope restore, and the old single `Ask` button — and replace it with:

```ts
    const askRow = ask.createDiv("ai-wiki-ask-row");
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
    const askButtons = askRow.createDiv("ai-wiki-ask-buttons");
    this.askDomainBtn = askButtons.createEl("button", { text: T.view.askDomain });
    this.askWikiBtn = askButtons.createEl("button", { text: T.view.askWiki, cls: "mod-cta" });
    this.cancelBtn.disabled = true;
    this.askDomainBtn.addEventListener("click", () => {
      const d = this.domainSelect?.value;
      if (!d) { new Notice(i18n().view.enterQuestion); return; } // defensive — button is disabled without a domain
      this.submitQuery(d);
    });
    this.askWikiBtn.addEventListener("click", () => {
      const T2 = i18n().view;
      new ConfirmModal(this.app, T2.askWikiConfirmTitle, [T2.askWikiConfirmBody], () => this.submitQuery("*")).open();
    });
    this.cancelBtn.addEventListener("click", () => this.plugin.controller.cancelCurrent());
```

- [ ] **Step 4: Rewrite `submitQuery` to take a domain argument**

In `src/view.ts`, replace `submitQuery` (lines 613-622) with:

```ts
  private submitQuery(domainArg: string): void {
    const q = this.queryInput.value.trim();
    if (!q) { new Notice(i18n().view.enterQuestion); return; }
    if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
    void this.plugin.controller.query(q, domainArg);
    this.queryInput.value = "";
  }
```

- [ ] **Step 5: Update `updateButtonAvailability`**

In `src/view.ts`, replace line 458 (`if (this.askBtn) this.askBtn.disabled = !hasDomain;`) with:

```ts
    if (this.askDomainBtn) this.askDomainBtn.disabled = !hasDomain;
    if (this.askWikiBtn)   this.askWikiBtn.disabled   = false;
```

- [ ] **Step 6: Update `setRunning`**

In `src/view.ts`, replace line 630 (`this.askBtn.disabled = true;`) with:

```ts
    this.askDomainBtn.disabled = true;
    this.askWikiBtn.disabled = true;
```

(Restoration after a run already happens via `updateButtonAvailability` at line 1042 in the finish path — no extra change needed.)

- [ ] **Step 7: Remove `lastQueryScope` from `LocalConfig`**

In `src/local-config.ts`, delete line 23 (`lastQueryScope?: "all" | "domain";`).

- [ ] **Step 8: Add the ask-buttons style**

In `src/styles.css`, after the existing `.ai-wiki-ask-row` rules (lines 27-28), add:

```css
.ai-wiki-ask-buttons { display: flex; gap: 6px; }
```

If a `.ai-wiki-scope-row` / `.ai-wiki-scope-select` rule exists in `src/styles.css`, remove it (grep first: `grep -n scope src/styles.css`).

- [ ] **Step 9: Typecheck + lint (catches any leftover `askBtn` / `scope` / `lastQueryScope` reference)**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. If a leftover reference to `askBtn`, `scopeToggle`, `desiredScope`, `scopeAll/Domain/Hint`, or `lastQueryScope` remains, the typecheck fails — fix it at the reported line.

- [ ] **Step 10: Run the eval (routing untouched downstream — must stay green)**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: `OK — N passed, 0 failed`.

- [ ] **Step 11: Commit**

```bash
git add src/view.ts src/local-config.ts src/i18n.ts src/styles.css
git commit -m "feat(view): Ask Domain / Ask Wiki buttons, remove scope selector"
```

---

### Task 5: Comment box — full-width, taller, right-aligned Saved button

**Files:**
- Modify: `src/view.ts:936-952` (rewrite `renderCommentBox`)
- Modify: `src/styles.css` (add `.ai-wiki-comment-*` rules)
- Modify: `src/i18n.ts` (add `commentSavedBtn`; the old status-style `commentSaved` is removed)

**Interfaces:**
- Consumes: `controller.commentRun(runId, comment)` → `Promise<string | undefined>`; i18n `commentPlaceholder`, `commentSave`.
- Produces: i18n key `commentSavedBtn`.

- [ ] **Step 1: Add `commentSavedBtn` and remove `commentSaved` (en/ru/es)**

In `src/i18n.ts`, in each `view` block, replace the `commentSaved` line with `commentSavedBtn`:
- `en` (line 190): `commentSaved: "saved",` → `commentSavedBtn: "Saved",`
- `ru` (line 540): `commentSaved: "сохранено",` → `commentSavedBtn: "Сохранено",`
- `es` (line 868): `commentSaved: "guardado",` → `commentSavedBtn: "Guardado",`

- [ ] **Step 2: Rewrite `renderCommentBox`**

In `src/view.ts`, replace `renderCommentBox` (lines 936-952) with (drop the status `<span>`; Save → Saved + disabled; re-enable on edit):

```ts
  /** One free-form comment per run, persisted to eval.jsonl via commentRun. Dev mode only. */
  private renderCommentBox(parent: HTMLElement, runId: string, initial: string): void {
    if (!this.plugin.settings.devMode?.enabled) return;
    const T = i18n();
    const box = parent.createDiv("ai-wiki-comment-box");
    const ta = box.createEl("textarea", {
      cls: "ai-wiki-comment-input",
      attr: { placeholder: T.view.commentPlaceholder, rows: "4" },
    });
    ta.value = initial;
    let savedValue = initial;
    const actions = box.createDiv("ai-wiki-comment-actions");
    const saveBtn = actions.createEl("button", { text: T.view.commentSave });
    ta.addEventListener("input", () => {
      if (ta.value !== savedValue) {
        saveBtn.disabled = false;
        saveBtn.setText(T.view.commentSave);
      }
    });
    saveBtn.addEventListener("click", () => void (async () => {
      const saved = await this.plugin.controller.commentRun(runId, ta.value);
      if (saved !== undefined) {
        savedValue = ta.value;
        saveBtn.setText(T.view.commentSavedBtn);
        saveBtn.disabled = true;
      }
    })());
  }
```

- [ ] **Step 3: Add the comment-box styles**

In `src/styles.css`, append:

```css
.ai-wiki-comment-box { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.ai-wiki-comment-input { width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit; padding: 6px; }
.ai-wiki-comment-actions { display: flex; justify-content: flex-end; }
```

If a `.ai-wiki-comment-status` rule exists in `src/styles.css`, remove it (grep: `grep -n comment src/styles.css`).

- [ ] **Step 4: Typecheck + lint (catches any leftover `commentSaved` reference)**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. A leftover `T.view.commentSaved` reference fails the typecheck — confirm Step 2 removed the only usage (was `src/view.ts:950`).

- [ ] **Step 5: Commit**

```bash
git add src/view.ts src/styles.css src/i18n.ts
git commit -m "feat(view): resize comment box, right-aligned Saved confirmation"
```

---

### Task 6: Build, verify, update docs

**Files:**
- Modify: `dist/` (rebuilt bundle — committed)
- Modify: `docs/wiki/llm-pipeline.md`, `docs/wiki/retrieval.md` (via iwiki ingest)

- [ ] **Step 1: Full typecheck + lint + eval**

Run: `npx tsc --noEmit && npm run lint && npx tsx eval/cross-domain/run.ts`
Expected: typecheck clean, ESLint clean, eval `OK — N passed, 0 failed`.

- [ ] **Step 2: Rebuild the dist bundle**

Run: `npm run build`
Expected: build completes with no errors (esbuild production bundle written to `dist/`).

- [ ] **Step 3: Manual verification in Obsidian (UI-only behaviors)**

Load the plugin in an Obsidian vault with ≥2 domains and dev mode enabled. Confirm:
- No `Scope:` selector under the query input; `Cancel`, `Ask Domain`, `Ask Wiki` buttons present.
- With `(all)` selected: `Ask Domain` is disabled, `Ask Wiki` enabled.
- With a concrete domain: both enabled; `Ask Domain` queries that domain.
- `Ask Wiki` opens a confirmation dialog; the query runs only on confirm.
- Ask Domain result shows a stats block (Domain / Pages analyzed / Selected for LLM / Tokens sent), tokens filling in after the answer.
- Ask Wiki result shows the cross block (Domains studied N/M / Info from / analyzed / In answer / Tokens sent).
- Comment box is full-width and ~4 rows tall; `Save comment` is right-aligned; clicking it shows `Saved` (disabled); editing the text re-enables `Save comment`.

- [ ] **Step 4: Commit the dist bundle**

```bash
git add dist
git commit -m "chore(build): rebuild dist for ask buttons + search stats + comment box"
```

- [ ] **Step 5: Update the wiki docs via iwiki**

Invoke the `iwiki:iwiki-ingest` skill on `src/view.ts` and on `src/phases/query-cross-domain.ts` to refresh the query/stats UI description in `docs/wiki/llm-pipeline.md` (LLM Progress Events) and the Cross-Domain Query section in `docs/wiki/retrieval.md`.

- [ ] **Step 6: Lint the wiki**

Invoke the `iwiki:iwiki-lint` skill. Expected: no broken `[[refs]]`, no orphans, no stale pages.

- [ ] **Step 7: Commit the doc updates**

```bash
git add docs/wiki
git commit -m "docs(wiki): query search-stats UI + Ask Domain/Ask Wiki buttons"
```

---

## Self-Review

**Spec coverage:**
- Remove scope selector → Task 4 (Steps 1-3, 7-8). ✓
- `Ask Domain` (disabled without domain) → Task 4 (Steps 3, 5). ✓
- `Ask Wiki` (always enabled, ConfirmModal → cross-domain) → Task 4 (Steps 3, 5). ✓
- Stats block both kinds, tokens from `llm_call_stats` → Tasks 1-3. ✓
- `pagesScanned` = whole domain (single) / Σ (cross) → Task 1 (Step 3), Task 2 (Steps 3, 7). ✓
- Comment box width/height, right-aligned Saved, re-enable on edit, status removed → Task 5. ✓
- i18n drop scope keys / rename / add labels (en/ru/es) → Task 3 (Step 1), Task 4 (Step 1), Task 5 (Step 1). ✓
- Remove `lastQueryScope` → Task 4 (Step 7). ✓
- Testing (eval asserts) → Task 2 (Steps 1, 5). ✓
- Docs (iwiki) → Task 6 (Steps 5-6). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; eval asserts have concrete expressions.

**Type consistency:** `query_stats` field names (`crossDomain`, `pagesScanned`, `pagesSelected`, `domainName`, `domainsStudied`, `domainsTotal`, `fromDomains`) are identical across the type definition (Task 1), the emitters (Task 2), and the renderer (Task 3). `DomainCandidates.pagesScanned` defined in Task 1, consumed in Task 2. `submitQuery(domainArg: string)` signature consistent across Task 4 callers. `commentSavedBtn` defined (Task 5 Step 1) and used (Task 5 Step 2).
