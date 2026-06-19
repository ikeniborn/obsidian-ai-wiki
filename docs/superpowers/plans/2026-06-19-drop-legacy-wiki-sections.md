---
review:
  plan_hash: e5c859a48cc6f91d
  spec_hash: 5a11c7d464f29ff9
  last_run: 2026-06-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Task 4: Auto-migration on load"
      section_hash: c6062508076e7eb0
      text: "Spec Component 3 lists 'trigger refreshCache' after rewriting pages; the plan intentionally omits the load-time refreshCache call and relies on the spec's own 'Current state' self-heal property (cache reconciles on next ingest/lint). Documented in the plan's Self-Review and the migration docstring. User-confirmed decision — accepted deviation, not a coverage gap."
      verdict: accepted
      verdict_at: 2026-06-19
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-19-drop-legacy-wiki-sections-design.md
---
# Drop legacy wiki sections (Related concepts + Change history) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generating the `Связанные концепции`/`Related concepts` and `История изменений`/`Change history` wiki sections, and remove them from existing pages via a one-shot on-load migration, so they stop polluting the vector index.

**Architecture:** A pure `stripLegacySections` helper removes the two H2 sections (3 languages each) from a page; a safety-net `addOutgoingLinks` unions any `[[links]]` from the related section into `wiki_outgoing_links` frontmatter before stripping (the graph reads body links too, so this guarantees no edge is lost). The schema/template stop emitting the sections. An idempotent on-load migration (config-flag guarded) rewrites existing pages. The embeddings cache **self-heals** on the next ingest/lint (`refreshCache` diffs chunks by content hash) — no load-time embedding calls. A standalone TS eval proves the chunk set shrinks to exactly the two noise chunks and (with a key) that retrieval precision rises with recall unchanged.

**Tech Stack:** TypeScript, esbuild (bundle), Obsidian plugin API, the `yaml` package, OpenAI-compatible embeddings.

---

## Background facts (verified in the codebase)

- `src/phases/llm-utils.ts#wikiSections` (line 22) renders the section list into `_wiki_schema.md` via the `{{section_conventions}}` placeholder. It holds `related` and `history` keys in three language maps (ru/en/es) and lists them under "Optional sections".
- `templates/_wiki_schema.md` line 71 (`## Content`) carries the change-history rule: *"When adding information from a new source — record the date and source in the change-history section"*.
- `src/wiki-graph.ts#buildWikiGraph` (line 18) extracts `[[links]]` from the **entire page content** (frontmatter **and** body), not only `wiki_outgoing_links`. Therefore stripping the related section *could* drop a graph edge if a body-only link existed there — the migration's union safety-net (Component 3 step 1) prevents this.
- `src/page-similarity.ts#buildChunkInputs` (line 164) → `splitSections` (line 135): each H2 becomes one embedding chunk. `maxCosine` (line 201) scores a page as the best cosine across its chunk vectors.
- Migration enumeration: `src/utils/vault-walk.ts#collectMdInPaths` walks a wiki folder. Service files are `_`-prefixed (`_index.md`, `_log.md` under `_config/`; `_wiki_schema.md` is bundled, not in the vault) — skip by `file.basename.startsWith("_")`.
- Migration guard pattern: a boolean flag in `local.json` via `LocalConfigStore`, exactly like `migrated_v1` / `migrated_v2` (`src/local-config.ts`, `src/main.ts`).
- Embeddings cache **self-heal**: `refreshCache` (`src/page-similarity.ts:750`) keeps cached vectors only for matching chunk hashes; a shrunk body drops the stale chunks on the next ingest/lint. Decided: the migration does **not** call `refreshCache` on load (no network at startup).
- The eval is run by bundling with esbuild + an `obsidian` stub (pattern: `eval/format-frontmatter/`). The only `obsidian` symbol in `page-similarity.ts`'s transitive tree is `requestUrl` (and `VaultTools` is a type-only import). `wiki-graph.ts` imports `basename` from `path-browserify` (a real npm package — bundles for node without a shim).
- **Docs note:** this project has **no `lat.md/` directory and no `lat` CLI** (despite `CLAUDE.md` mentioning them). Documentation lives in `docs/wiki/` and is maintained via the **iwiki** skills (per the global `CLAUDE.md` mandate). Spec Component 5's "Update lat.md/ … run lat check" is implemented here as "iwiki-ingest the changed sources, then iwiki-lint". The relevant page is `docs/wiki/domain-model.md` (line 56 documents `wikiSections`).

## File Structure

- **Create** `src/strip-legacy-sections.ts` — pure helpers: `stripLegacySections`, `extractRelatedLinks`, `addOutgoingLinks`. One real module reused by the migration and the eval.
- **Create** `src/migrate-drop-sections.ts` — the one-shot, idempotent on-load migration.
- **Create** `eval/legacy-sections/run.ts` — standalone A/B harness (deterministic always; embedding A/B when a key is set).
- **Create** `eval/legacy-sections/obsidian-stub.ts` — minimal `requestUrl` stub for bundling.
- **Create** `eval/legacy-sections/.gitignore` — ignore the bundled `*.cjs`.
- **Create** `docs/superpowers/evals/2026-06-19-legacy-sections-eval.md` — how to run, env vars, expected output.
- **Modify** `src/phases/llm-utils.ts` — drop `related`/`history` from `wikiSections`.
- **Modify** `templates/_wiki_schema.md` — drop the change-history rule.
- **Modify** `src/local-config.ts` — add the `migrated_drop_sections` flag.
- **Modify** `src/main.ts` — wire the migration into `onload()`.
- **Update** `docs/wiki/` via iwiki (Task 5).

---

## Task 1: Stop generating both sections (schema + template)

**Files:**
- Modify: `src/phases/llm-utils.ts:22-68`
- Modify: `templates/_wiki_schema.md:71`

- [ ] **Step 1: Remove `related` and `history` from all three heading maps and the optional list**

In `src/phases/llm-utils.ts`, replace the `wikiSections` function body (lines 22-68) with:

```ts
export function wikiSections(lang: OutputLanguage): string {
  const headings = {
    ru: {
      mandatory: "## Основные характеристики",
      usage: "## Применение в контексте [Домен]",
      examples: "## Примеры",
      limitations: "## Ограничения",
      best: "## Best Practices",
    },
    en: {
      mandatory: "## Key characteristics",
      usage: "## Usage in the [Domain] context",
      examples: "## Examples",
      limitations: "## Limitations",
      best: "## Best Practices",
    },
    es: {
      mandatory: "## Características principales",
      usage: "## Uso en el contexto de [Dominio]",
      examples: "## Ejemplos",
      limitations: "## Limitaciones",
      best: "## Best Practices",
    },
  };
  const h = lang === "en" ? headings.en : lang === "es" ? headings.es : headings.ru;
  return [
    "Page structure (mandatory order). The headings below are already in the configured output language — use them verbatim:",
    "1. Frontmatter (YAML)",
    "2. H1 heading — the page title",
    "3. Intro paragraph — 1-3 sentences without a heading, immediately after H1",
    `4. ${h.mandatory} — key properties and parameters (MANDATORY on every page)`,
    "",
    "Optional sections (include only when relevant, use these exact headings):",
    `- ${h.usage}`,
    `- ${h.examples}`,
    `- ${h.limitations}`,
    `- ${h.best}`,
  ].join("\n");
}
```

This removes the `related` and `history` keys from `ru`/`en`/`es` and the two trailing `- ${h.related} …` / `- ${h.history} …` bullets.

- [ ] **Step 2: Remove the change-history rule from the template**

In `templates/_wiki_schema.md`, delete line 71 entirely:

```
- When adding information from a new source — record the date and source in the change-history section (see the section conventions above)
```

The surrounding `## Content` bullets (synthesis-not-copying above it, forbidden-placeholder below it) stay unchanged.

- [ ] **Step 3: Confirm no other code re-adds or requires these headings**

Run:
```bash
grep -rn "Связанные концепции\|Related concepts\|Conceptos relacionados\|История изменений\|Change history\|Historial de cambios\|change-history" src/ templates/
```
Expected: **no matches** (every occurrence has been removed). `src/phases/format.ts` and `src/phases/lint.ts` were already verified to neither inject nor flag these headings.

- [ ] **Step 4: Build to confirm the change compiles**

Run: `npm run build`
Expected: esbuild completes with no errors; `main.js` is produced.

- [ ] **Step 5: Commit**

```bash
git add src/phases/llm-utils.ts templates/_wiki_schema.md
git commit -m "feat(schema): stop generating related-concepts and change-history sections"
```

---

## Task 2: Pure helper `stripLegacySections` + deterministic eval (TDD)

We write the eval's deterministic assertions first (they fail to bundle because the module is missing), then implement the helper to make them pass.

**Files:**
- Create: `eval/legacy-sections/obsidian-stub.ts`
- Create: `eval/legacy-sections/.gitignore`
- Create: `eval/legacy-sections/run.ts` (deterministic part only in this task; embedding part added in Task 3)
- Create: `src/strip-legacy-sections.ts`

- [ ] **Step 1: Create the obsidian stub and .gitignore**

`eval/legacy-sections/obsidian-stub.ts`:
```ts
// Minimal `obsidian` stub for the out-of-vault legacy-sections eval.
// The only symbol the eval's import tree pulls from `obsidian` is `requestUrl`
// (in src/page-similarity.ts). The deterministic chunk logic never calls it, and the
// embedding A/B path uses the global `fetch` directly — so this stub only needs to exist.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the legacy-sections eval");
}
```

`eval/legacy-sections/.gitignore`:
```
*.cjs
```

- [ ] **Step 2: Write the deterministic eval (red — module not yet present)**

Create `eval/legacy-sections/run.ts`:
```ts
/**
 * Out-of-vault A/B eval for the "drop legacy wiki sections" branch.
 *
 * Deterministic part (no key required): runs the REAL splitSections / buildChunkInputs
 * from src/page-similarity.ts on an inlined wiki-page fixture, before and after the REAL
 * stripLegacySections from src/strip-legacy-sections.ts. Asserts the two noise chunks
 * (related concepts + change history) disappear and the content chunks are byte-identical.
 *
 * Retrieval A/B (only when EVAL_EMBED_BASE_URL + EVAL_EMBED_API_KEY + EVAL_EMBED_MODEL are
 * set): embeds both chunk variants plus a small query set and checks precision rises while
 * on-topic scores stay flat. Added in Task 3.
 *
 * Run: see docs/superpowers/evals/2026-06-19-legacy-sections-eval.md
 */
import { buildChunkInputs, splitSections, DEFAULT_CHUNKING } from "../../src/page-similarity";
import { stripLegacySections, extractRelatedLinks, addOutgoingLinks } from "../../src/strip-legacy-sections";

// ---------- tiny assert framework (mirrors eval/format-frontmatter/run.ts) ----------
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// ---------- inlined fixture: a realistic SCD1 wiki page WITH both legacy sections ----------
// Note: "[[перезапись-таблицы]]" appears only inside the related section, NOT in
// wiki_outgoing_links — it exercises the union safety-net (Task 4 / addOutgoingLinks).
const ANNOTATION = "SCD1 — стратегия медленно меняющихся измерений с перезаписью значений без хранения истории.";
const FIXTURE = `---
wiki_updated: 2026-06-10
wiki_status: developing
wiki_outgoing_links:
  - "[[scd2]]"
tags:
  - databases/dwh
---
# SCD1 (Slowly Changing Dimension Type 1)

SCD1 — стратегия обработки медленно меняющихся измерений, при которой новое значение атрибута перезаписывает старое без сохранения истории.

## Основные характеристики

- При изменении атрибута старое значение перезаписывается новым.
- История предыдущих значений не сохраняется.
- Таблица измерения остаётся компактной: одна строка на бизнес-ключ.

## Применение в контексте [Домен]

Используется для атрибутов, чья историчность не важна для аналитики: исправление опечаток, обновление справочных кодов.

## Примеры

\`\`\`sql
UPDATE dim_customer SET city = 'Москва' WHERE customer_id = 42;
\`\`\`

## Связанные концепции

- [[scd2]] — стратегия с сохранением истории через версии строк.
- [[перезапись-таблицы]] — низкоуровневый механизм, лежащий в основе SCD1.

## История изменений

- 2026-06-10 — создано из источника [[etl-обзор]].
- 2026-06-05 — добавлен пример SQL.
`;

// =====================================================================
// Deterministic part — chunk set before/after stripLegacySections
// =====================================================================
section("Deterministic — chunk set");

const NOISE_HEADINGS = ["## Связанные концепции", "## История изменений"];

const strippedBody = stripLegacySections(FIXTURE);

const sectionsWith = splitSections(FIXTURE, DEFAULT_CHUNKING);
const sectionsWithout = splitSections(strippedBody, DEFAULT_CHUNKING);

const headingsWith = sectionsWith.map((s) => s.heading);
const headingsWithout = sectionsWithout.map((s) => s.heading);

check("D1 both noise sections present before strip",
  NOISE_HEADINGS.every((h) => headingsWith.includes(h)),
  `headingsWith=${JSON.stringify(headingsWith)}`);
check("D2 no noise sections after strip",
  NOISE_HEADINGS.every((h) => !headingsWithout.includes(h)),
  `headingsWithout=${JSON.stringify(headingsWithout)}`);
check("D3 exactly two chunks removed",
  sectionsWith.length - sectionsWithout.length === 2,
  `before=${sectionsWith.length} after=${sectionsWithout.length}`);

// Content windows for surviving headings must be byte-identical across variants.
const survivingHeadings = headingsWithout.filter((h) => h.length > 0);
let contentIdentical = true;
for (const h of survivingHeadings) {
  const a = sectionsWith.find((s) => s.heading === h)?.window;
  const b = sectionsWithout.find((s) => s.heading === h)?.window;
  if (a !== b) { contentIdentical = false; console.log(`        window differs for ${h}`); }
}
check("D4 surviving content windows byte-identical", contentIdentical);

// buildChunkInputs: same conclusion at the embed-text level (annotation prefix included).
const inputsWith = buildChunkInputs(ANNOTATION, FIXTURE, DEFAULT_CHUNKING);
const inputsWithout = buildChunkInputs(ANNOTATION, strippedBody, DEFAULT_CHUNKING);
check("D5 buildChunkInputs drops exactly two section chunks",
  inputsWith.length - inputsWithout.length === 2,
  `with=${inputsWith.length} without=${inputsWithout.length}`);

// =====================================================================
// Deterministic part — helpers
// =====================================================================
section("Deterministic — helpers");

check("H1 stripLegacySections is idempotent", stripLegacySections(strippedBody) === strippedBody);
check("H2 stripLegacySections preserves frontmatter + H1 + intro",
  strippedBody.includes("wiki_outgoing_links:") &&
  strippedBody.includes("# SCD1 (Slowly Changing Dimension Type 1)") &&
  strippedBody.includes("новое значение атрибута перезаписывает старое"));
check("H3 stripLegacySections keeps the mandatory content section",
  strippedBody.includes("## Основные характеристики"));

const related = extractRelatedLinks(FIXTURE);
check("H4 extractRelatedLinks finds both related links",
  related.includes("[[scd2]]") && related.includes("[[перезапись-таблицы]]"),
  `related=${JSON.stringify(related)}`);
check("H5 extractRelatedLinks ignores links outside the related section",
  !related.includes("[[etl-обзор]]"),
  `related=${JSON.stringify(related)}`);

const unioned = addOutgoingLinks(FIXTURE, related);
check("H6 addOutgoingLinks unions the body-only link into wiki_outgoing_links",
  unioned.includes("[[перезапись-таблицы]]") &&
  /wiki_outgoing_links:/.test(unioned.slice(0, unioned.indexOf("# SCD1"))));
check("H7 addOutgoingLinks is a no-op when all links already present",
  addOutgoingLinks(unioned, ["[[scd2]]"]) === unioned);

// ---------- summary ----------
console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
```

- [ ] **Step 3: Bundle the eval and confirm it fails (red)**

Run:
```bash
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs
```
Expected: esbuild **fails** with `Could not resolve "../../src/strip-legacy-sections"` — the module does not exist yet.

- [ ] **Step 4: Implement the pure helper module**

Create `src/strip-legacy-sections.ts`:
```ts
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

/** The two legacy H2 sections, in all three supported output languages. */
const LEGACY_HEADINGS = new Set([
  "## Связанные концепции",
  "## Related concepts",
  "## Conceptos relacionados",
  "## История изменений",
  "## Change history",
  "## Historial de cambios",
]);

/** Just the related-concepts heading variants (links here feed the migration safety-net). */
const RELATED_HEADINGS = new Set([
  "## Связанные концепции",
  "## Related concepts",
  "## Conceptos relacionados",
]);

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function isH2(line: string): boolean {
  return /^##\s+/.test(line);
}

/**
 * Remove the two legacy H2 sections (related concepts + change history) from a wiki page,
 * in all three supported languages. Each section is removed from its heading line up to
 * (but not including) the next H2 heading or EOF. Frontmatter (its lines never start with
 * "## "), H1, intro, and every other section are preserved. Pure and idempotent.
 */
export function stripLegacySections(content: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of content.split("\n")) {
    if (isH2(line)) {
      skipping = LEGACY_HEADINGS.has(line.trim());
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  // Collapse blank-line runs left by a removed section; end with a single trailing newline.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

/** All distinct `[[link]]` targets found inside the related-concepts section(s). */
export function extractRelatedLinks(content: string): string[] {
  const links: string[] = [];
  let inRelated = false;
  for (const line of content.split("\n")) {
    if (isH2(line)) { inRelated = RELATED_HEADINGS.has(line.trim()); continue; }
    if (inRelated) {
      for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) {
        const t = m[1].trim();
        if (t) links.push(`[[${t}]]`);
      }
    }
  }
  return [...new Set(links)];
}

/**
 * Safety-net: union `links` into the page's `wiki_outgoing_links` frontmatter. The wiki
 * graph reads `[[links]]` from the whole page body, so links living only inside the
 * related section must be lifted into frontmatter before that section is stripped, or the
 * graph edge is lost. Returns the content unchanged when every link is already present
 * (the common case — lint enforces this invariant) or when there is no parseable
 * frontmatter to union into.
 */
export function addOutgoingLinks(content: string, links: string[]): string {
  if (links.length === 0) return content;
  const m = FM_RE.exec(content);
  if (!m) return content;
  let fm: Record<string, unknown>;
  try {
    const parsed: unknown = yamlParse(m[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return content;
    fm = parsed as Record<string, unknown>;
  } catch { return content; }
  const existing = Array.isArray(fm.wiki_outgoing_links)
    ? (fm.wiki_outgoing_links as unknown[]).map((x) => String(x))
    : [];
  const existingSet = new Set(existing);
  const missing = links.filter((l) => !existingSet.has(l));
  if (missing.length === 0) return content;
  fm.wiki_outgoing_links = [...existing, ...missing];
  return `---\n${yamlStringify(fm)}---\n${content.slice(m[0].length)}`;
}
```

- [ ] **Step 5: Re-bundle and run the eval (green)**

Run:
```bash
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs
node eval/legacy-sections/run.cjs
```
Expected: bundle succeeds; output ends with `TOTAL: 12 passed, 0 failed` (D1–D5, H1–H7).

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: eslint reports no errors for the new file; esbuild completes.

- [ ] **Step 7: Commit**

```bash
git add src/strip-legacy-sections.ts eval/legacy-sections/run.ts eval/legacy-sections/obsidian-stub.ts eval/legacy-sections/.gitignore
git commit -m "feat: stripLegacySections helper + deterministic legacy-sections eval"
```

---

## Task 3: Retrieval A/B (embedding) extension of the eval + eval doc

Adds the key-gated embedding A/B to the same harness and documents how to run it.

**Files:**
- Modify: `eval/legacy-sections/run.ts` (append the embedding section before the summary)
- Create: `docs/superpowers/evals/2026-06-19-legacy-sections-eval.md`

- [ ] **Step 1: Append the embedding A/B block**

In `eval/legacy-sections/run.ts`, insert the following **immediately before** the `// ---------- summary ----------` line:

```ts
// =====================================================================
// Retrieval A/B — only when an embedding key is configured
// =====================================================================
section("Retrieval A/B (embeddings)");

// Explicit, named assertion bounds (from the spec).
const EPS_ONTOPIC = 0.02;     // max allowed cosine delta for on-topic queries
const MIN_NOISE_DROP = 0.05;  // min required cosine drop for noise-probe queries

const EMBED_BASE_URL = process.env.EVAL_EMBED_BASE_URL;
const EMBED_API_KEY = process.env.EVAL_EMBED_API_KEY;
const EMBED_MODEL = process.env.EVAL_EMBED_MODEL;
const EMBED_DIMENSIONS = process.env.EVAL_EMBED_DIMENSIONS
  ? Number(process.env.EVAL_EMBED_DIMENSIONS) : undefined;

const ON_TOPIC = ["SCD1 версионирование", "перезапись таблицы"];
const NOISE_PROBES = ["когда создана страница", "история изменений", "связанные концепции"];

async function embed(texts: string[]): Promise<number[][]> {
  const url = `${EMBED_BASE_URL!.replace(/\/$/, "")}/embeddings`;
  const body: Record<string, unknown> = { model: EMBED_MODEL, input: texts };
  if (EMBED_DIMENSIONS && EMBED_DIMENSIONS > 0) body.dimensions = EMBED_DIMENSIONS;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EMBED_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Page score = best cosine of `query` over `chunks`, plus the winning chunk's embed-text. */
function maxChunk(query: number[], chunks: { vec: number[]; embedText: string }[]): { score: number; winner: string } {
  let best = { score: 0, winner: "" };
  for (const c of chunks) {
    const s = cosine(query, c.vec);
    if (s > best.score) best = { score: s, winner: c.embedText };
  }
  return best;
}

if (!EMBED_BASE_URL || !EMBED_API_KEY || !EMBED_MODEL) {
  console.log("  SKIP  embedding A/B — set EVAL_EMBED_BASE_URL, EVAL_EMBED_API_KEY, EVAL_EMBED_MODEL to enable");
} else {
  try {
    const withTexts = inputsWith.map((c) => c.embedText);
    const withoutTexts = inputsWithout.map((c) => c.embedText);
    const queries = [...ON_TOPIC, ...NOISE_PROBES];

    const [withVecs, withoutVecs, queryVecs] = await Promise.all([
      embed(withTexts), embed(withoutTexts), embed(queries),
    ]);
    const withChunks = inputsWith.map((c, i) => ({ vec: withVecs[i], embedText: c.embedText }));
    const withoutChunks = inputsWithout.map((c, i) => ({ vec: withoutVecs[i], embedText: c.embedText }));

    queries.forEach((q, qi) => {
      const qv = queryVecs[qi];
      const a = maxChunk(qv, withChunks);
      const b = maxChunk(qv, withoutChunks);
      const isNoise = qi >= ON_TOPIC.length;
      const delta = a.score - b.score; // with − without (noise: expected positive = a drop)
      console.log(`  [${isNoise ? "noise" : "ontopic"}] "${q}"  with=${a.score.toFixed(4)} without=${b.score.toFixed(4)} Δ=${delta.toFixed(4)}`);
      console.log(`        winner(with)=${a.winner.split("\\n").slice(-2, -1)[0] ?? a.winner.slice(0, 40)}`);
      if (isNoise) {
        check(`E noise "${q}" drops ≥ ${MIN_NOISE_DROP}`, delta >= MIN_NOISE_DROP, `Δ=${delta.toFixed(4)}`);
      } else {
        check(`E ontopic "${q}" |Δ| < ${EPS_ONTOPIC}`, Math.abs(delta) < EPS_ONTOPIC, `Δ=${delta.toFixed(4)}`);
      }
    });
  } catch (e) {
    check("E embedding A/B ran", false, (e as Error).message);
  }
}
```

Note: top-level `await` is valid because esbuild bundles to CJS with `--format=cjs` and the file is run as a module; if the bundler complains, wrap the embedding block in an `async function main(){…}` and call `void main()` after the summary. (The format-frontmatter eval is fully synchronous, so this harness is the first to need `await` — prefer the `main()` wrapper if unsure.)

- [ ] **Step 2: Re-run the deterministic part (no key) to confirm the SKIP path**

Run:
```bash
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs
node eval/legacy-sections/run.cjs
```
Expected: deterministic block still `12 passed, 0 failed`, plus a `SKIP  embedding A/B …` line; exit code 0.

- [ ] **Step 3 (optional, if a key is available): run the embedding A/B**

Run:
```bash
EVAL_EMBED_BASE_URL=... EVAL_EMBED_API_KEY=... EVAL_EMBED_MODEL=... \
  node eval/legacy-sections/run.cjs
```
Expected: each on-topic query shows `|Δ| < 0.02` and PASS; each noise probe shows `Δ ≥ 0.05` and PASS; per-query `winner(with)` lines show a noise chunk winning only for the noise probes. If no key is available, skip this step (the deterministic proof plus the analytical argument stand).

- [ ] **Step 4: Write the eval doc**

Create `docs/superpowers/evals/2026-06-19-legacy-sections-eval.md`:
```markdown
# Eval — Drop Legacy Wiki Sections

**Date:** 2026-06-19
**Branch:** `dev/drop-legacy-wiki-sections`
**Spec:** `docs/superpowers/specs/2026-06-19-drop-legacy-wiki-sections-design.md`
**Plan:** `docs/superpowers/plans/2026-06-19-drop-legacy-wiki-sections.md`

## Purpose & scope

Prove, outside any Obsidian vault, that removing the `Связанные концепции`/`Related concepts`
and `История изменений`/`Change history` sections **strictly removes false positives**: it
deletes exactly the two noise chunks, leaves every content chunk byte-identical, and (with a
key) lowers retrieval scores only for off-topic noise probes while on-topic scores stay flat.

The harness exercises the **real** `splitSections` / `buildChunkInputs` (`src/page-similarity.ts`)
and the **real** `stripLegacySections` / `extractRelatedLinks` / `addOutgoingLinks`
(`src/strip-legacy-sections.ts`) against an inlined single-page SCD1 fixture.

## How to run

```bash
# Deterministic part (no key):
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs
node eval/legacy-sections/run.cjs

# Retrieval A/B (real embeddings):
EVAL_EMBED_BASE_URL=... EVAL_EMBED_API_KEY=... EVAL_EMBED_MODEL=... \
  [EVAL_EMBED_DIMENSIONS=...] node eval/legacy-sections/run.cjs
```

`obsidian-stub.ts` supplies the only `obsidian` symbol the import tree references
(`requestUrl`, never actually called). The embedding path uses the global `fetch`.

## Thresholds

- `EPS_ONTOPIC = 0.02` — max allowed cosine |Δ| for on-topic queries.
- `MIN_NOISE_DROP = 0.05` — min required cosine drop for noise-probe queries.

## Cases

| Case | What it checks |
|------|----------------|
| D1–D5 | The two noise chunks vanish; exactly two chunks removed; content windows byte-identical. |
| H1–H7 | `stripLegacySections` idempotent + structure-preserving; `extractRelatedLinks` scope; `addOutgoingLinks` union + no-op. |
| E (ontopic) | `\|score_with − score_without\| < EPS_ONTOPIC` for "SCD1 версионирование", "перезапись таблицы". |
| E (noise) | `score_with − score_without ≥ MIN_NOISE_DROP` for the three noise probes. |

## Results (current)

Deterministic: `TOTAL: 12 passed, 0 failed` (embedding A/B SKIPPED without a key).
Fill in the embedding-A/B numbers here after running with a key.
```

- [ ] **Step 5: Commit**

```bash
git add eval/legacy-sections/run.ts docs/superpowers/evals/2026-06-19-legacy-sections-eval.md
git commit -m "feat(eval): retrieval A/B for legacy-sections removal + eval doc"
```

---

## Task 4: Auto-migration on load

**Files:**
- Modify: `src/local-config.ts:11-21` (add the flag to `LocalConfig`)
- Create: `src/migrate-drop-sections.ts`
- Modify: `src/main.ts` (import + wire into `onload()`)

- [ ] **Step 1: Add the migration flag to LocalConfig**

In `src/local-config.ts`, add `migrated_drop_sections?: boolean;` to the `LocalConfig` interface, right after `migrated_v2?: boolean;`:
```ts
  migrated_v1?: boolean;
  migrated_v2?: boolean;
  migrated_drop_sections?: boolean;
```

- [ ] **Step 2: Create the migration module**

Create `src/migrate-drop-sections.ts`:
```ts
import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import type { LocalConfigStore } from "./local-config";
import { collectMdInPaths } from "./utils/vault-walk";
import { domainWikiFolder } from "./wiki-path";
import {
  stripLegacySections,
  extractRelatedLinks,
  addOutgoingLinks,
} from "./strip-legacy-sections";

/**
 * One-shot, idempotent on-load migration: removes the legacy `Связанные концепции` /
 * `История изменений` sections (all languages) from every domain wiki page. Before
 * stripping, it unions any `[[links]]` from the related section into `wiki_outgoing_links`
 * so no graph edge is lost. Guarded by the `migrated_drop_sections` local-config flag;
 * a second run is a no-op. Service files (`_`-prefixed: `_index.md`, `_log.md`,
 * `_wiki_schema.md`) are skipped. The embeddings cache self-heals on the next ingest/lint
 * (refreshCache diffs chunks by content hash), so no embedding calls happen here.
 */
export async function migrateDropSections(
  vault: Vault,
  domains: DomainEntry[],
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_drop_sections) return;

  const adapter = vault.adapter;
  let filesChanged = 0;

  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    for (const file of collectMdInPaths(vault, [wikiFolder])) {
      if (file.basename.startsWith("_")) continue; // skip service files
      try {
        const content = await adapter.read(file.path);
        const related = extractRelatedLinks(content);
        const stripped = stripLegacySections(addOutgoingLinks(content, related));
        if (stripped !== content) {
          await adapter.write(file.path, stripped);
          filesChanged++;
        }
      } catch (e) {
        console.error(`[AI Wiki] drop-sections migration: error processing ${file.path}`, e);
      }
    }
  }

  await localConfigStore.save({ migrated_drop_sections: true });
  if (filesChanged > 0) {
    new Notice(`AI Wiki: legacy wiki sections removed — ${filesChanged} pages`);
  }
}
```

- [ ] **Step 3: Wire the migration into `onload()`**

In `src/main.ts`, add the import next to the other migration imports (after line 13):
```ts
import { migrateDropSections } from "./migrate-drop-sections";
```

Then, in `onload()`, **after** the existing `migrateIndexFormat` try/catch block (the one ending at line 46, right before `this.controller = new WikiController(...)`), insert:
```ts
    try {
      const domains = await this.domainStore.load();
      await migrateDropSections(this.app.vault, domains, this.localConfigStore);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: drop-sections migration failed — ${msg}`, 0);
      console.error("[AI Wiki] drop-sections migration error:", e);
    }
```

- [ ] **Step 4: Build and lint**

Run: `npm run build && npm run lint`
Expected: esbuild produces `main.js`; eslint reports no errors.

- [ ] **Step 5: Re-run the eval to confirm the helper still behaves (no regression)**

Run:
```bash
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs && node eval/legacy-sections/run.cjs
```
Expected: `12 passed, 0 failed` (+ SKIP line).

- [ ] **Step 6: Manual in-vault smoke check (the harness cannot cover Obsidian load)**

In a throwaway vault with a domain whose pages still carry the two sections:
1. Load the plugin → expect a `legacy wiki sections removed — N pages` notice; open a page and confirm both sections are gone, frontmatter/H1/intro/content sections intact, and any related-section link is now in `wiki_outgoing_links`.
2. Reload the plugin → expect **no** notice and **no** further file changes (idempotent; `migrated_drop_sections` is set).
3. Confirm `local.json` contains `"migrated_drop_sections": true`.
4. Run an ingest or lint on one page → confirm the embeddings cache no longer holds the two noise chunks (the chunk count for that page drops by two).

- [ ] **Step 7: Commit**

```bash
git add src/local-config.ts src/migrate-drop-sections.ts src/main.ts
git commit -m "feat: one-shot on-load migration removing legacy wiki sections"
```

---

## Task 5: Documentation (iwiki) + final verification

**Files:**
- Update: `docs/wiki/` (via iwiki skills)

- [ ] **Step 1: Re-ingest the changed sources into the wiki**

Run the iwiki ingest skill for each changed source so `docs/wiki/` reflects that the two sections are no longer part of the page schema and that a migration removes them:
- `iwiki:iwiki-ingest src/phases/llm-utils.ts`  (updates the section-conventions note in `docs/wiki/domain-model.md`)
- `iwiki:iwiki-ingest src/strip-legacy-sections.ts`
- `iwiki:iwiki-ingest src/migrate-drop-sections.ts`

Confirm `docs/wiki/domain-model.md` no longer implies `Связанные концепции` / `История изменений` are emitted, and that the new migration + helper are documented (a brief note under the retrieval/chunking or migration area).

- [ ] **Step 2: Lint the wiki**

Run: `iwiki:iwiki-lint`
Expected: no broken `[[refs]]`, no orphan or stale pages introduced by the new pages. (There is no `lat` CLI in this repo; iwiki-lint is the equivalent of the spec's "lat check".)

- [ ] **Step 3: Final full verification**

Run:
```bash
npm run build
npm run lint
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs && node eval/legacy-sections/run.cjs
grep -rn "Связанные концепции\|Related concepts\|Conceptos relacionados\|История изменений\|Change history\|Historial de cambios\|change-history" src/ templates/
```
Expected: build green; lint clean; eval `12 passed, 0 failed`; the `grep` returns **no matches** in `src/` and `templates/` (only the eval fixture under `eval/` and the docs/spec mention these strings — which is correct).

- [ ] **Step 4: Commit the doc updates**

```bash
git add docs/wiki
git commit -m "docs(wiki): legacy related/history sections removed from page schema"
```

- [ ] **Step 5: Open the PR**

Per the project branch workflow, push `dev/drop-legacy-wiki-sections` and open a pull request targeting `master`:
```bash
git push -u origin dev/drop-legacy-wiki-sections
gh pr create --base master --title "Drop legacy wiki sections (related concepts + change history)" \
  --body "Implements docs/superpowers/specs/2026-06-19-drop-legacy-wiki-sections-design.md. See docs/superpowers/plans/2026-06-19-drop-legacy-wiki-sections.md and the eval at docs/superpowers/evals/2026-06-19-legacy-sections-eval.md."
```

---

## Self-Review notes

- **Spec coverage:** Component 1 → Task 1; Component 2 → Task 2; Component 3 → Task 4 (with the union safety-net justified by `buildWikiGraph` reading body links); Component 4 → Tasks 2–3; Component 5 → Task 5 (mapped from the nonexistent `lat.md/` to `docs/wiki/`+iwiki). Verification section → Task 5 Step 3 + Task 4 Step 6.
- **Embeddings cache:** spec Component 3 literally says "trigger refreshCache". Decision (confirmed): rely on the spec's own "Current state" self-heal property instead — the migration makes **no** embedding calls on load; the cache reconciles on the next ingest/lint. Documented in the migration's docstring and Task 4 Step 6.4.
- **Type consistency:** `stripLegacySections(content)`, `extractRelatedLinks(content)`, `addOutgoingLinks(content, links)` signatures are identical across the helper, the eval, and the migration. `migrated_drop_sections` is the single flag name used in `LocalConfig`, the migration guard, and the manual check.
- **No `lat.md`:** the repo has neither the `lat.md/` directory nor the `lat` CLI; docs are maintained in `docs/wiki/` via iwiki. This deviation from the spec's wording is intentional and noted in Task 5.
